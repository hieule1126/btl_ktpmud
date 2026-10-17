import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireManager } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function documentCode(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
}

async function assertProductItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Phiếu cần có ít nhất một dòng hàng.");
  for (const item of items) {
    if (!item.productId || Number(item.quantity) <= 0) throw new Error("Sản phẩm và số lượng phải hợp lệ.");
  }
}

router.get("/dashboard", async (_req, res, next) => {
  try {
    const [[summary]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM products) AS product_count,
        (SELECT COUNT(*) FROM batches WHERE quantity > 0) AS batch_count,
        (SELECT COALESCE(SUM(quantity), 0) FROM batches) AS item_count,
        (SELECT COUNT(*) FROM stock_receipts WHERE status = 'PENDING') +
        (SELECT COUNT(*) FROM stock_issues WHERE status = 'PENDING') AS pending_count`);
    const [pending] = await db.query(`
      SELECT id, code, 'IMPORT' AS type, created_at FROM stock_receipts WHERE status = 'PENDING'
      UNION ALL
      SELECT id, code, 'EXPORT' AS type, created_at FROM stock_issues WHERE status = 'PENDING'
      ORDER BY created_at DESC LIMIT 6`);
    res.json({ summary, pending });
  } catch (error) { next(error); }
});

router.get("/receipts", async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT r.*, u.full_name AS creator_name, a.full_name AS approver_name,
        COUNT(ri.id) AS item_lines
      FROM stock_receipts r JOIN users u ON u.id = r.created_by
      LEFT JOIN users a ON a.id = r.approved_by LEFT JOIN stock_receipt_items ri ON ri.receipt_id = r.id
      GROUP BY r.id ORDER BY r.created_at DESC`);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post("/receipts", async (req, res, next) => {
  try {
    const { supplier = "", note = "", items } = req.body;
    await assertProductItems(items);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [receipt] = await conn.query(
        "INSERT INTO stock_receipts (code, supplier, note, status, created_by) VALUES (?, ?, ?, 'PENDING', ?)",
        [documentCode("PN"), supplier, note, req.user.id]
      );
      for (const item of items) {
        if (!item.batchCode || !item.expiryDate || !item.location) throw new Error("Lô nhập cần mã lô, hạn sử dụng và vị trí kho.");
        await conn.query(`INSERT INTO stock_receipt_items
          (receipt_id, product_id, batch_code, quantity, expiry_date, location)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [receipt.insertId, item.productId, item.batchCode, Number(item.quantity), item.expiryDate, item.location]);
      }
      await conn.commit();
      res.status(201).json({ message: "Đã gửi phiếu nhập chờ phê duyệt." });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  } catch (error) { next(error); }
});

router.get("/issues", async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT i.*, u.full_name AS creator_name, a.full_name AS approver_name, COUNT(ii.id) AS item_lines
      FROM stock_issues i JOIN users u ON u.id = i.created_by
      LEFT JOIN users a ON a.id = i.approved_by LEFT JOIN stock_issue_items ii ON ii.issue_id = i.id
      GROUP BY i.id ORDER BY i.created_at DESC`);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post("/issues", async (req, res, next) => {
  try {
    const { requestedBy = "", note = "", strategy = "FEFO", items } = req.body;
    if (!['FEFO', 'FIFO', 'LIFO'].includes(strategy)) return res.status(400).json({ message: "Chiến lược xuất không hợp lệ." });
    await assertProductItems(items);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [issue] = await conn.query(
        "INSERT INTO stock_issues (code, requested_by, note, strategy, status, created_by) VALUES (?, ?, ?, ?, 'PENDING', ?)",
        [documentCode("PX"), requestedBy, note, strategy, req.user.id]
      );
      for (const item of items) {
        await conn.query("INSERT INTO stock_issue_items (issue_id, product_id, quantity) VALUES (?, ?, ?)",
          [issue.insertId, item.productId, Number(item.quantity)]);
      }
      await conn.commit();
      res.status(201).json({ message: "Đã gửi phiếu xuất chờ phê duyệt." });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  } catch (error) { next(error); }
});

router.post("/receipts/:id/approve", requireManager, async (req, res, next) => {
  try {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[receipt]] = await conn.query("SELECT * FROM stock_receipts WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!receipt || receipt.status !== "PENDING") throw new Error("Phiếu nhập không còn ở trạng thái chờ duyệt.");
      const [items] = await conn.query("SELECT * FROM stock_receipt_items WHERE receipt_id = ?", [receipt.id]);
      for (const item of items) {
        await conn.query(`INSERT INTO batches (product_id, batch_code, quantity, expiry_date, location, received_at)
          VALUES (?, ?, ?, ?, ?, CURDATE())`, [item.product_id, item.batch_code, item.quantity, item.expiry_date, item.location]);
      }
      await conn.query("UPDATE stock_receipts SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ?", [req.user.id, receipt.id]);
      await conn.commit();
      res.json({ message: "Đã phê duyệt phiếu nhập và cập nhật tồn kho." });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  } catch (error) { next(error); }
});

router.post("/issues/:id/approve", requireManager, async (req, res, next) => {
  try {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[issue]] = await conn.query("SELECT * FROM stock_issues WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!issue || issue.status !== "PENDING") throw new Error("Phiếu xuất không còn ở trạng thái chờ duyệt.");
      const [items] = await conn.query("SELECT * FROM stock_issue_items WHERE issue_id = ?", [issue.id]);
      const ordering = issue.strategy === "FEFO" ? "expiry_date ASC, received_at ASC" : issue.strategy === "FIFO" ? "received_at ASC" : "received_at DESC";
      for (const item of items) {
        const [batches] = await conn.query(`SELECT * FROM batches WHERE product_id = ? AND quantity > 0 ORDER BY ${ordering} FOR UPDATE`, [item.product_id]);
        let remaining = Number(item.quantity);
        if (batches.reduce((sum, batch) => sum + Number(batch.quantity), 0) < remaining) {
          throw new Error("Không đủ tồn kho để phê duyệt phiếu xuất.");
        }
        for (const batch of batches) {
          if (remaining <= 0) break;
          const allocated = Math.min(remaining, Number(batch.quantity));
          await conn.query("UPDATE batches SET quantity = quantity - ? WHERE id = ?", [allocated, batch.id]);
          await conn.query("INSERT INTO stock_issue_allocations (issue_item_id, batch_id, quantity) VALUES (?, ?, ?)", [item.id, batch.id, allocated]);
          remaining -= allocated;
        }
      }
      await conn.query("UPDATE stock_issues SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ?", [req.user.id, issue.id]);
      await conn.commit();
      res.json({ message: "Đã phê duyệt phiếu xuất và trừ tồn kho theo chiến lược đã chọn." });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  } catch (error) { next(error); }
});

router.post("/:kind/:id/reject", requireManager, async (req, res, next) => {
  try {
    const table = req.params.kind === "receipts" ? "stock_receipts" : req.params.kind === "issues" ? "stock_issues" : null;
    if (!table) return res.status(404).json({ message: "Loại phiếu không hợp lệ." });
    const [result] = await db.query(`UPDATE ${table} SET status = 'REJECTED', approved_by = ?, approved_at = NOW() WHERE id = ? AND status = 'PENDING'`, [req.user.id, req.params.id]);
    if (!result.affectedRows) return res.status(400).json({ message: "Phiếu không còn ở trạng thái chờ duyệt." });
    res.json({ message: "Đã từ chối phiếu." });
  } catch (error) { next(error); }
});

export default router;

