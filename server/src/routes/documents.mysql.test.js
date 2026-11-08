import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { migrateDocuments } from "../../scripts/document-migration.js";

// Concurrency needs real commits. Use an isolated database, never warehouse rows.
test("MySQL document lifecycle and concurrent requests in an isolated database", async t => {
  const database = `warehouse_qa_${randomUUID().replaceAll("-", "")}`;
  const admin = await mysql.createConnection({ ...config.db, multipleStatements: true });
  let db;
  try {
    const schema = (await readFile(new URL("../../../database/schema.sql", import.meta.url), "utf8")).replaceAll("warehouse_management", database);
    await admin.query(schema);
    config.db.database = database;
    const module = await import("./warehouse.js");
    db = (await import("../db.js")).db;
    const router = module.default;
    const call = async (path, method, { kind = "receipts", id, body = {} } = {}) => {
      const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
      const result = { status: 200 };
      await handler({ params: { kind, id }, body, user: { id: 1, role: "WAREHOUSE_MANAGER" } }, {
        status(value) { result.status = value; return this; }, json(value) { result.body = value; }
      }, error => { result.error = error; });
      return result;
    };
    const detail = async (kind, id) => {
      const result = await call("/:kind/:id", "get", { kind, id });
      assert.ifError(result.error);
      return result.body;
    };
    const approve = async (kind, id, reviewToken) => call(`/${kind}/:id/approve`, "post", { kind, id, body: { reviewToken } });
    const [[dates]] = await db.query("SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 30 DAY), '%Y-%m-%d') AS future, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d') AS past");
    const [product] = await db.query("INSERT INTO products (sku, name, unit) VALUES ('QA', 'QA product', 'hộp')");
    const productId = product.insertId;
    const line = { productId, quantity: 2.5, batchCode: "QA-LOT", expiryDate: dates.future, location: "QA-A" };
    const createReceipt = (items = [line], requestKey = randomUUID()) => call("/receipts", "post", { body: { requestKey, supplier: "QA", items } });
    const createIssue = (items, strategy = "FEFO", requestKey = randomUUID()) => call("/issues", "post", { body: { requestKey, requestedBy: "QA", strategy, items } });
    const stock = async () => {
      const [[row]] = await db.query("SELECT COALESCE(SUM(quantity), 0) AS total FROM batches WHERE product_id = ?", [productId]);
      return Number(row.total);
    };

    await t.test("migration upgrades old columns, preserves data and is repeatable", async () => {
      await admin.query("ALTER TABLE stock_receipts ADD INDEX qa_creator (created_by)");
      await admin.query("ALTER TABLE stock_receipts DROP INDEX uq_receipt_request, DROP COLUMN request_key, DROP COLUMN request_hash, DROP COLUMN rejection_reason");
      await admin.query("ALTER TABLE stock_issues MODIFY strategy ENUM('FEFO', 'FIFO') NOT NULL DEFAULT 'FEFO'");
      await migrateDocuments(admin);
      await migrateDocuments(admin);
      const [[row]] = await admin.query("SELECT COUNT(*) AS count FROM products");
      assert.equal(row.count, 5);
    });

    await t.test("invalid last line rolls back the complete receipt", async () => {
      for (const invalid of [{ ...line, quantity: "bad" }, { ...line, quantity: 0.001 }, { ...line, productId: 999999 }, { ...line, expiryDate: dates.past }, { ...line, expiryDate: "2027-02-30" }]) {
        const result = await createReceipt([line, invalid]);
        assert.ok(result.error);
      }
      const [[count]] = await db.query("SELECT COUNT(*) AS count FROM stock_receipts");
      assert.equal(count.count, 0);
      assert.equal(await stock(), 0);
    });

    let receiptId;
    await t.test("concurrent identical submissions create one document and preserve all lines", async () => {
      const key = randomUUID();
      const results = await Promise.all([createReceipt([line, { ...line, quantity: 1.25 }], key), createReceipt([line, { ...line, quantity: 1.25 }], key)]);
      results.forEach(result => assert.ifError(result.error));
      assert.equal(results[0].body.id, results[1].body.id);
      receiptId = results[0].body.id;
      assert.equal((await detail("receipts", receiptId)).items.length, 2);
      assert.equal(await stock(), 0);
      assert.ok((await createReceipt([{ ...line, quantity: 5 }], key)).error);
      const [[count]] = await db.query("SELECT COUNT(*) AS count FROM stock_receipts");
      assert.equal(count.count, 1);
    });

    await t.test("receipt requires a detail review and simultaneous approvals increment once", async () => {
      assert.match((await approve("receipts", receiptId)).error.message, /chưa được xem/);
      const document = await detail("receipts", receiptId);
      assert.equal(document.can_approve, true);
      const results = await Promise.all([approve("receipts", receiptId, document.review_token), approve("receipts", receiptId, document.review_token)]);
      assert.equal(results.filter(result => !result.error).length, 1);
      assert.equal(await stock(), 3.75);
    });

    await t.test("matching old lots accumulate while conflicts and overflow reject atomically", async () => {
      await db.query("UPDATE batches SET received_at = '2020-01-01' WHERE product_id = ?", [productId]);
      assert.match((await createReceipt([{ ...line, location: "elsewhere" }])).error.message, /không khớp/);
      assert.match((await createReceipt([line, { ...line, batchCode: "qa-lot", location: "elsewhere" }])).error.message, /không khớp/);
      assert.match((await createReceipt([{ ...line, quantity: 9999999999 }])).error.message, /vượt giới hạn/);
      const result = await createReceipt();
      assert.ifError(result.error);
      const document = await detail("receipts", result.body.id);
      assert.ifError((await approve("receipts", document.id, document.review_token)).error);
      const [[batch]] = await db.query("SELECT quantity, DATE_FORMAT(received_at, '%Y-%m-%d') AS received FROM batches WHERE product_id = ?", [productId]);
      assert.equal(Number(batch.quantity), 6.25);
      assert.equal(batch.received, "2020-01-01");
    });

    await t.test("metadata changes after creation block approval without a partial inventory write", async () => {
      const result = await createReceipt([{ ...line, batchCode: "NEW-LOT" }, line]);
      assert.ifError(result.error);
      const document = await detail("receipts", result.body.id);
      await db.query("UPDATE batches SET location = 'CHANGED' WHERE product_id = ?", [productId]);
      assert.equal((await detail("receipts", document.id)).can_approve, false);
      assert.match((await approve("receipts", document.id, document.review_token)).error.message, /không khớp/);
      assert.equal(await stock(), 6.25);
      const [[count]] = await db.query("SELECT COUNT(*) AS count FROM batches WHERE product_id = ?", [productId]);
      assert.equal(count.count, 1);
      await db.query("UPDATE batches SET location = 'QA-A' WHERE product_id = ?", [productId]);
    });

    await t.test("rejection requires a reason and records actor, reason and time once", async () => {
      const result = await createReceipt();
      const id = result.body.id;
      const reject = reason => call("/:kind/:id/reject", "post", { id, body: { reason } });
      assert.ok((await reject("  ")).error);
      assert.ifError((await reject("  Sai chứng từ  ")).error);
      assert.equal((await reject("Lặp lại")).status, 400);
      const document = await detail("receipts", id);
      assert.equal(document.status, "REJECTED");
      assert.equal(document.rejection_reason, "Sai chứng từ");
      assert.equal(document.approved_by, 1);
      assert.ok(document.approved_at);
      assert.ok((await approve("receipts", id)).error);
      assert.equal(await stock(), 6.25);
    });

    await db.query("INSERT INTO batches (product_id, batch_code, quantity, expiry_date, location, received_at) VALUES (?, 'EXPIRED', 100, ?, 'QA', CURDATE()), (?, 'NEWEST', 2, ?, 'QA', CURDATE())", [productId, dates.past, productId, dates.future]);
    await t.test("every strategy filters expired stock; repeated lines expose shortages", async () => {
      for (const strategy of ["FEFO", "FIFO", "LIFO"]) {
        const result = await createIssue([{ productId, quantity: 7 }, { productId, quantity: 2 }], strategy);
        assert.ifError(result.error);
        const document = await detail("issues", result.body.id);
        assert.equal(document.can_approve, false);
        assert.equal(document.items[0].available_quantity, 8.25);
        assert.equal(document.items[1].shortage_quantity, 0.75);
        assert.ok(document.items.every(item => item.allocations.every(batch => batch.batch_code !== "EXPIRED")));
        if (strategy === "LIFO") assert.equal(document.items[0].allocations[0].batch_code, "NEWEST");
        assert.match((await approve("issues", document.id, document.review_token)).error.message, /khả dụng cho dòng 1.25, thiếu 0.75/);
      }
      assert.equal(await stock(), 108.25);
    });

    await t.test("concurrent issue creation retries deduplicate; concurrent approvals deduct once", async () => {
      const key = randomUUID();
      const results = await Promise.all([createIssue([{ productId, quantity: 1 }], "LIFO", key), createIssue([{ productId, quantity: 1 }], "LIFO", key)]);
      results.forEach(result => assert.ifError(result.error));
      assert.equal(results[0].body.id, results[1].body.id);
      const document = await detail("issues", results[0].body.id);
      const approvals = await Promise.all([approve("issues", document.id, document.review_token), approve("issues", document.id, document.review_token)]);
      assert.equal(approvals.filter(result => !result.error).length, 1);
      assert.equal(await stock(), 107.25);
      assert.equal((await detail("issues", document.id)).items[0].allocations[0].batch_code, "NEWEST");
    });

    await t.test("competing issue documents cannot oversell shared inventory", async () => {
      const first = await createIssue([{ productId, quantity: 5 }]);
      const second = await createIssue([{ productId, quantity: 5 }]);
      const previews = await Promise.all([detail("issues", first.body.id), detail("issues", second.body.id)]);
      const results = await Promise.all(previews.map(document => approve("issues", document.id, document.review_token)));
      assert.equal(results.filter(result => !result.error).length, 1);
      assert.equal(await stock(), 102.25);
      const [[expired]] = await db.query("SELECT quantity FROM batches WHERE product_id = ? AND batch_code = 'EXPIRED'", [productId]);
      assert.equal(Number(expired.quantity), 100);
    });
  } finally {
    if (db) await db.end();
    // database is generated here and contains only test fixtures.
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
