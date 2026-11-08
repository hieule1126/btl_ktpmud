import test from "node:test";
import assert from "node:assert/strict";
import router from "./warehouse.js";
import { db } from "../db.js";
import { planIssue, adjustIssue, allocationReviewToken } from "../services/issue-allocation.js";
import { requireManager } from "../middleware/auth.js";

const today = "2026-11-07";
const batch = (id, quantity, expiry_date, received_at = "2026-01-01", product_id = 1) => ({
  id, product_id, quantity, expiry_date, received_at, batch_code: `LOT-${id}`, location: `A-${id}`
});
const item = (id, quantity, product_id = 1) => ({ id, product_id, quantity });

// A transactional test double keeps these regression tests isolated from warehouse data.
function connection({ batches = [], items = [item(10, "5.00")], document = { id: 1, code: "PX-TEST", status: "PENDING", strategy: "FEFO" }, allocations = [] } = {}) {
  const state = { batches: structuredClone(batches), items, document: structuredClone(document), allocations: structuredClone(allocations), adjustments: [] };
  const calls = [];
  let snapshot;
  return {
    state, calls, committed: false, rolledBack: false, released: false,
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() { this.committed = true; },
    async rollback() { Object.assign(state, snapshot); this.rolledBack = true; },
    release() { this.released = true; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT * FROM batches")) {
        assert.match(sql, /quantity > 0 AND expiry_date >= CURDATE\(\)/);
        let rows = state.batches.filter(b => b.product_id === params[0] && Number(b.quantity) > 0 && b.expiry_date >= today);
        rows = [...rows].sort((a, b) => {
          if (sql.includes("expiry_date ASC")) return a.expiry_date.localeCompare(b.expiry_date) || a.received_at.localeCompare(b.received_at) || a.id - b.id;
          const order = a.received_at.localeCompare(b.received_at) || a.id - b.id;
          return sql.includes("received_at DESC") ? -order : order;
        });
        return [structuredClone(rows)];
      }
      if (sql.includes("SELECT d.*") || sql.includes("SELECT * FROM stock_issues WHERE")) return [[state.document].filter(Boolean)];
      if (sql.includes("SELECT i.*")) return [state.items.map(i => ({ ...i, sku: "SP-TEST", product_name: "Sản phẩm thử", unit: "hộp" }))];
      if (sql.includes("SELECT * FROM stock_issue_items")) return [state.items];
      if (sql.includes("SELECT a.issue_item_id")) return [state.allocations];
      if (sql.includes("FROM stock_issue_adjustments")) return [state.adjustments];
      if (sql.startsWith("INSERT INTO stock_issue_adjustments")) {
        state.adjustments.push({ issue_id: params[0], reason: params[1], adjusted_by: params[2],
          suggested_allocations: JSON.parse(params[3]), selected_allocations: JSON.parse(params[4]) });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE batches")) {
        state.batches.find(b => b.id === params[1]).quantity -= params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO stock_issue_allocations")) {
        state.allocations.push({ issue_item_id: params[0], batch_id: params[1], quantity: params[2] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE stock_issues")) { state.document.status = "APPROVED"; return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

async function callRoute(t, path, method, conn, { params = { id: 1 }, body = {} } = {}) {
  t.mock.method(db, "getConnection", async () => conn);
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(data) { result.body = data; } };
  await route.stack.at(-1).handle({ params, body, user: { id: 1, role: "WAREHOUSE_MANAGER" } }, res, error => { result.error = error; });
  return result;
}

for (const strategy of ["FEFO", "FIFO"]) {
  test(`${strategy}: ignores expired and empty lots; today remains eligible`, async () => {
    const conn = connection({ batches: [batch(1, 100, "2026-11-06"), batch(2, 2, today), batch(3, 3, "2027-01-01", "2026-02-01"), batch(4, 0, "2027-02-01")] });
    const plan = await planIssue(conn, [item(10, 4)], strategy, { lock: true });
    assert.equal(plan[0].available_quantity, 5);
    assert.equal(plan[0].shortage_quantity, 0);
    assert.deepEqual(plan[0].allocations.map(a => [a.batch_id, a.quantity]), [[2, 2], [3, 2]]);
    assert.match(conn.calls[0].sql, /FOR UPDATE$/);
  });
}

test("expired-only inventory is unavailable", async () => {
  const plan = await planIssue(connection({ batches: [batch(1, 100, "2026-11-06")] }), [item(10, 5)], "FEFO");
  assert.equal(plan[0].available_quantity, 0);
  assert.equal(plan[0].shortage_quantity, 5);
  assert.deepEqual(plan[0].allocations, []);
});

test("repeated products consume shared stock across lines; decimal quantities stay exact", async () => {
  const plan = await planIssue(connection({ batches: [batch(1, "0.30", today)] }), [item(10, "0.10"), item(11, "0.20"), item(12, "0.10")], "FEFO");
  assert.deepEqual(plan.map(i => i.available_quantity), [0.3, 0.2, 0]);
  assert.deepEqual(plan.map(i => i.shortage_quantity), [0, 0, 0.1]);
  assert.equal(plan[1].allocations[0].quantity, 0.2);
});

test("product locks have stable order and tied lots have deterministic allocation", async () => {
  const conn = connection({ batches: [batch(2, 2, today), batch(1, 2, today)] });
  const plan = await planIssue(conn, [item(10, 1, 2), item(11, 1)], "FEFO", { lock: true });
  assert.deepEqual(conn.calls.map(c => c.params[0]), [1, 2]);
  assert.equal(plan[1].allocations[0].batch_id, 1);
});

test("receipt detail contains product, quantity, batch, expiry and location", async t => {
  const conn = connection({ items: [{ ...item(10, 5), batch_code: "IN-01", expiry_date: today, location: "A-01" }] });
  const result = await callRoute(t, "/:kind/:id", "get", conn, { params: { kind: "receipts", id: 1 } });
  assert.equal(result.body.items[0].product_name, "Sản phẩm thử");
  assert.equal(result.body.items[0].quantity, 5);
  assert.equal(result.body.items[0].batch_code, "IN-01");
  assert.equal(result.body.items[0].expiry_date, today);
  assert.equal(result.body.items[0].location, "A-01");
  assert.ok(conn.committed && conn.released);
});

test("issue detail returns eligible preview and approval consumes exactly those lots", async t => {
  const conn = connection({ batches: [batch(1, 100, "2026-11-06"), batch(2, 2, today), batch(3, 5, "2027-01-01")] });
  const detail = await callRoute(t, "/:kind/:id", "get", conn, { params: { kind: "issues", id: 1 } });
  assert.equal(detail.body.can_approve, true);
  assert.equal(conn.state.batches[1].quantity, 2); // Preview does not reserve or mutate stock.
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: { reviewToken: detail.body.review_token } });
  assert.ifError(result.error);
  assert.equal(conn.state.document.status, "APPROVED");
  assert.deepEqual(conn.state.batches.map(b => b.quantity), [100, 0, 2]);
  assert.deepEqual(conn.state.allocations.map(a => [a.batch_id, a.quantity]), [[2, 2], [3, 3]]);
});

test("insufficient eligible stock prevents approval and leaves all lines unchanged", async t => {
  const conn = connection({ batches: [batch(1, 100, "2026-11-06"), batch(2, 5, today)], items: [item(10, 3), item(11, 3)] });
  const detail = await callRoute(t, "/:kind/:id", "get", conn, { params: { kind: "issues", id: 1 } });
  assert.equal(detail.body.can_approve, false);
  assert.equal(detail.body.items[1].shortage_quantity, 1);
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: { reviewToken: detail.body.review_token } });
  assert.match(result.error.message, /Không đủ tồn kho khả dụng/);
  assert.equal(conn.state.document.status, "PENDING");
  assert.deepEqual(conn.state.batches.map(b => b.quantity), [100, 5]);
  assert.deepEqual(conn.state.allocations, []);
  assert.ok(conn.rolledBack && conn.released);
});

test("changed lot allocation requires reviewing again even if total stock is sufficient", async t => {
  const conn = connection({ batches: [batch(1, 5, today), batch(2, 10, "2027-01-01")] });
  const preview = await planIssue(conn, conn.state.items, "FEFO");
  conn.state.batches[0].quantity = 0;
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: { reviewToken: allocationReviewToken(preview) } });
  assert.match(result.error.message, /Phân bổ lô đã thay đổi/);
  assert.equal(conn.state.batches[1].quantity, 10);
  assert.equal(conn.state.document.status, "PENDING");
  assert.ok(conn.rolledBack);
});

test("a lot that expires between preview and approval cannot be shipped", async t => {
  const conn = connection({ batches: [batch(1, 5, today)] });
  const preview = await planIssue(conn, conn.state.items, "FEFO");
  conn.state.batches[0].expiry_date = "2026-11-06";
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: { reviewToken: allocationReviewToken(preview) } });
  assert.match(result.error.message, /Không đủ tồn kho khả dụng/);
  assert.equal(conn.state.batches[0].quantity, 5);
});

test("approval without reviewing allocation is rejected", async t => {
  const conn = connection({ batches: [batch(1, 5, today)] });
  const result = await callRoute(t, "/issues/:id/approve", "post", conn);
  assert.match(result.error.message, /chưa được xem/);
  assert.equal(conn.state.batches[0].quantity, 5);
  assert.equal(conn.state.document.status, "PENDING");
});

test("a database failure after stock deduction rolls back stock and document status", async t => {
  const conn = connection({ batches: [batch(1, 5, today)] });
  const plan = await planIssue(conn, conn.state.items, "FEFO");
  const originalQuery = conn.query.bind(conn);
  conn.query = async (sql, params) => {
    if (sql.startsWith("INSERT INTO stock_issue_allocations")) throw new Error("Simulated write failure");
    return originalQuery(sql, params);
  };
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: { reviewToken: allocationReviewToken(plan) } });
  assert.match(result.error.message, /Simulated write failure/);
  assert.equal(conn.state.batches[0].quantity, 5);
  assert.equal(conn.state.document.status, "PENDING");
  assert.deepEqual(conn.state.allocations, []);
  assert.ok(conn.rolledBack && conn.released);
});

test("approved issue detail shows saved allocations even for a now-expired, depleted lot", async t => {
  const saved = { issue_item_id: 10, batch_id: 1, quantity: 5, batch_code: "HISTORY", expiry_date: "2026-01-01", location: "A-01" };
  const conn = connection({ document: { id: 1, status: "APPROVED", strategy: "FEFO" }, allocations: [saved] });
  const result = await callRoute(t, "/:kind/:id", "get", conn, { params: { kind: "issues", id: 1 } });
  assert.deepEqual(result.body.items[0].allocations, [saved]);
  assert.ok(!conn.calls.some(c => c.sql.includes("SELECT * FROM batches")));
});

test("missing document returns 404 and releases the connection", async t => {
  const conn = connection({ document: null });
  const result = await callRoute(t, "/:kind/:id", "get", conn, { params: { kind: "receipts", id: 999 } });
  assert.equal(result.status, 404);
  assert.ok(conn.rolledBack && conn.released);
});

test("already processed issue cannot be approved twice", async t => {
  const conn = connection({ document: { id: 1, status: "APPROVED" } });
  const result = await callRoute(t, "/issues/:id/approve", "post", conn);
  assert.match(result.error.message, /không còn ở trạng thái chờ duyệt/);
  assert.ok(conn.rolledBack);
});

test("staff cannot approve or reject documents", () => {
  for (const path of ["/receipts/:id/approve", "/issues/:id/approve", "/:kind/:id/reject"]) {
    assert.ok(router.stack.find(layer => layer.route?.path === path).route.stack.some(layer => layer.handle === requireManager));
  }
  let status;
  requireManager({ user: { role: "WAREHOUSE_STAFF" } }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail("Staff was allowed"));
  assert.equal(status, 403);
});

test("FEFO uses expiry while FIFO uses receipt date", async () => {
  const conn = connection({ batches: [batch(1, 10, "2027-05-01", "2026-01-01"), batch(2, 10, "2027-01-01", "2026-02-01")] });
  assert.equal((await planIssue(conn, [item(10, 5)], "FEFO"))[0].allocations[0].batch_id, 2);
  assert.equal((await planIssue(conn, [item(10, 5)], "FIFO"))[0].allocations[0].batch_id, 1);
});

test("LIFO excludes expired stock and allocates newest eligible lots first", async () => {
  const conn = connection({ batches: [batch(1, 10, "2027-01-01", "2026-01-01"), batch(2, 10, "2026-01-01", "2026-11-01"), batch(3, 2, today, "2026-02-01")] });
  const plan = await planIssue(conn, [item(10, 5)], "LIFO");
  assert.deepEqual(plan[0].allocations.map(a => [a.batch_id, a.quantity]), [[3, 2], [1, 3]]);
  assert.equal(plan[0].available_quantity, 12);
});

test("unknown strategies are rejected", async t => {
  await assert.rejects(planIssue(connection(), [item(10, 5)], "RANDOM"), /không hợp lệ/);
  const result = await callRoute(t, "/issues", "post", connection(), { body: { strategy: "RANDOM", items: [{ productId: 1, quantity: 5 }] } });
  assert.equal(result.status, 400);
});

test("manager adjustment deducts selected lots and records both plans and reason", async t => {
  const conn = connection({ batches: [batch(1, 10, today), batch(2, 10, "2027-01-01")] });
  const preview = await planIssue(conn, conn.state.items, "FEFO");
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: {
    reviewToken: allocationReviewToken(preview),
    adjustment: { reason: "  Khách yêu cầu lô LOT-2  ", items: [{ itemId: 10, allocations: [{ batchId: 1, quantity: 1 }, { batchId: 2, quantity: 4 }] }] }
  } });
  assert.ifError(result.error);
  assert.deepEqual(conn.state.batches.map(b => b.quantity), [9, 6]);
  assert.equal(conn.state.adjustments[0].reason, "Khách yêu cầu lô LOT-2");
  assert.equal(conn.state.adjustments[0].adjusted_by, 1);
  assert.deepEqual(conn.state.adjustments[0].suggested_allocations[0].allocations.map(a => [a.batch_id, a.quantity]), [[1, 5]]);
  assert.deepEqual(conn.state.adjustments[0].selected_allocations[0].allocations.map(a => [a.batch_id, a.quantity]), [[1, 1], [2, 4]]);
  const detail = await callRoute(t, "/:kind/:id", "get", conn, { params: { kind: "issues", id: 1 } });
  assert.equal(detail.body.adjustment.reason, "Khách yêu cầu lô LOT-2");
});

for (const reason of ["", "   ", null, 123, "x".repeat(1001)]) {
  test(`adjustment requires a valid reason (${String(reason).slice(0, 10)})`, async t => {
    const conn = connection({ batches: [batch(1, 10, today)] });
    const preview = await planIssue(conn, conn.state.items, "FEFO");
    const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: {
      reviewToken: allocationReviewToken(preview), adjustment: { reason, items: [{ itemId: 10, allocations: [{ batchId: 1, quantity: 5 }] }] }
    } });
    assert.match(result.error.message, /Lý do điều chỉnh/);
    assert.equal(conn.state.batches[0].quantity, 10);
    assert.deepEqual(conn.state.adjustments, []);
    assert.ok(conn.rolledBack);
  });
}

test("adjustment rejects expired, foreign, duplicate and missing lots or lines and invalid quantities", async () => {
  const conn = connection({ batches: [batch(1, 10, today), batch(2, 10, "2026-01-01"), batch(3, 10, today, "2026-01-01", 2)] });
  const plan = await planIssue(conn, conn.state.items, "FEFO");
  for (const allocations of [
    [{ batchId: 2, quantity: 5 }], [{ batchId: 3, quantity: 5 }], [{ batchId: 999, quantity: 5 }],
    [{ batchId: 1, quantity: 11 }], [{ batchId: 1, quantity: 4 }], [{ batchId: 1, quantity: -5 }],
    [{ batchId: 1, quantity: 0 }], [{ batchId: 1, quantity: NaN }], [{ batchId: 1, quantity: Infinity }],
    [{ batchId: 1, quantity: 5.001 }], [{ batchId: 1, quantity: "5" }],
    [{ batchId: 1, quantity: 2 }, { batchId: 1, quantity: 3 }], [], [null]
  ]) assert.throws(() => adjustIssue(plan, [{ itemId: 10, allocations }]));
  for (const selections of [[], null, [null], [{ itemId: 999, allocations: [] }],
    [{ itemId: 10, allocations: [] }, { itemId: 10, allocations: [] }]]) assert.throws(() => adjustIssue(plan, selections));
});

test("adjustment shares stock across repeated product lines and supports exact decimals", async () => {
  const conn = connection({ batches: [batch(1, 0.3, today), batch(2, 0.5, today)], items: [item(10, 0.2), item(11, 0.2)] });
  const plan = await planIssue(conn, conn.state.items, "FEFO");
  assert.throws(() => adjustIssue(plan, [
    { itemId: 10, allocations: [{ batchId: 1, quantity: 0.2 }] },
    { itemId: 11, allocations: [{ batchId: 1, quantity: 0.2 }] }
  ]), /không đủ tồn kho/);
  const selected = adjustIssue(plan, [
    { itemId: 10, allocations: [{ batchId: 1, quantity: 0.2 }] },
    { itemId: 11, allocations: [{ batchId: 1, quantity: 0.1 }, { batchId: 2, quantity: 0.1 }] }
  ]);
  assert.equal(selected[1].allocations[0].quantity, 0.1);
});

test("stock changes in an alternative lot require a new review", async t => {
  const conn = connection({ batches: [batch(1, 10, today), batch(2, 10, "2027-01-01")] });
  const preview = await planIssue(conn, conn.state.items, "FEFO");
  conn.state.batches[1].quantity = 8;
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: {
    reviewToken: allocationReviewToken(preview),
    adjustment: { reason: "Chọn lô khác", items: [{ itemId: 10, allocations: [{ batchId: 2, quantity: 5 }] }] }
  } });
  assert.match(result.error.message, /Phân bổ lô đã thay đổi/);
  assert.deepEqual(conn.state.batches.map(b => b.quantity), [10, 8]);
  assert.deepEqual(conn.state.adjustments, []);
});

test("failed approval rolls back the audit record as well as inventory", async t => {
  const conn = connection({ batches: [batch(1, 10, today)] });
  const preview = await planIssue(conn, conn.state.items, "FEFO");
  const originalQuery = conn.query.bind(conn);
  conn.query = async (sql, params) => {
    if (sql.startsWith("INSERT INTO stock_issue_allocations")) throw new Error("Write failure");
    return originalQuery(sql, params);
  };
  const result = await callRoute(t, "/issues/:id/approve", "post", conn, { body: {
    reviewToken: allocationReviewToken(preview),
    adjustment: { reason: "Theo yêu cầu", items: [{ itemId: 10, allocations: [{ batchId: 1, quantity: 5 }] }] }
  } });
  assert.match(result.error.message, /Write failure/);
  assert.equal(conn.state.batches[0].quantity, 10);
  assert.deepEqual(conn.state.adjustments, []);
  assert.equal(conn.state.document.status, "PENDING");
});
