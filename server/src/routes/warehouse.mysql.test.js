import test from "node:test";
import assert from "node:assert/strict";
import router from "./warehouse.js";
import { db } from "../db.js";

// Optional integration check: all test rows and stock changes are rolled back.
test("MySQL: adjusted approval persists its audit and exactly deducts the selected lots", async t => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [user] = await conn.query("INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'WAREHOUSE_MANAGER')",
      ["QA rollback", `qa-${Date.now()}@example.invalid`, "unused"]);
    const [product] = await conn.query("INSERT INTO products (sku, name, unit) VALUES (?, ?, ?)", [`QA-${Date.now()}`, "QA rollback", "hộp"]);
    const ids = [];
    for (const [code, days] of [["QA-EARLY", 30], ["QA-LATE", 60]]) {
      const [batch] = await conn.query(`INSERT INTO batches (product_id, batch_code, quantity, expiry_date, location, received_at)
        VALUES (?, ?, 10, DATE_ADD(CURDATE(), INTERVAL ? DAY), 'QA', CURDATE())`, [product.insertId, code, days]);
      ids.push(batch.insertId);
    }
    const [issue] = await conn.query("INSERT INTO stock_issues (code, strategy, created_by) VALUES (?, 'FEFO', ?)", [`QA-${Date.now()}`, user.insertId]);
    const [item] = await conn.query("INSERT INTO stock_issue_items (issue_id, product_id, quantity) VALUES (?, ?, 5)", [issue.insertId, product.insertId]);
    t.mock.method(db, "getConnection", async () => ({
      query: conn.query.bind(conn),
      beginTransaction: () => conn.query("SAVEPOINT route_check"),
      commit: () => conn.query("RELEASE SAVEPOINT route_check"),
      rollback: () => conn.query("ROLLBACK TO SAVEPOINT route_check"),
      release() {}
    }));
    const call = async (path, method, body = {}) => {
      const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
      let result;
      let error;
      await route.stack.at(-1).handle({ params: { kind: "issues", id: issue.insertId }, body, user: { id: user.insertId, role: "WAREHOUSE_MANAGER" } },
        { json(value) { result = value; }, status() { return this; } }, value => { error = value; });
      assert.ifError(error);
      return result;
    };
    const detail = await call("/:kind/:id", "get");
    assert.equal(detail.items[0].available_batches.length, 2);
    assert.equal(detail.items[0].allocations[0].batch_id, ids[0]);
    await call("/issues/:id/approve", "post", {
      reviewToken: detail.review_token,
      adjustment: { reason: "Kiểm thử SQL trong giao dịch hoàn tác", items: [
        { itemId: item.insertId, allocations: [{ batchId: ids[0], quantity: 1.25 }, { batchId: ids[1], quantity: 3.75 }] }
      ] }
    });
    const approved = await call("/:kind/:id", "get");
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.adjustment.adjusted_by_name, "QA rollback");
    assert.ok(approved.adjustment.adjusted_at);
    assert.equal(approved.adjustment.suggested_allocations[0].allocations[0].quantity, 5);
    assert.deepEqual(approved.items[0].allocations.map(row => Number(row.quantity)), [1.25, 3.75]);
    const [stock] = await conn.query("SELECT quantity FROM batches WHERE product_id = ? ORDER BY id", [product.insertId]);
    assert.deepEqual(stock.map(row => Number(row.quantity)), [8.75, 6.25]);
  } finally {
    await conn.rollback();
    conn.release();
    await db.end();
  }
});
