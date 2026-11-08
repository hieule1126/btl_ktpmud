import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireManager } from "../middleware/auth.js";
import { planIssue, adjustIssue, allocationReviewToken } from "../services/issue-allocation.js";
import { documentCode, normalizeItems, validateReceipt, checkProducts, textField, requestIdentity, digest } from "../services/document-validation.js";

const router = Router();
router.use(requireAuth);

async function replayCreation(conn, table, identity, userId, res) {
  const [[existing]] = await conn.query(`SELECT id, code, request_hash FROM ${table} WHERE created_by = ? AND request_key = ?`, [userId, identity.key]);
  if (!existing) return false;
  if (existing.request_hash !== identity.hash) throw new Error("Mã yêu cầu đã dùng cho nội dung khác. Vui lòng tạo phiếu mới.");
  res.json({ id: existing.id, code: existing.code, message: "Phiếu đã được ghi nhận trước đó; không tạo thêm phiếu trùng." });
  return true;
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
    const supplier = textField(req.body.supplier ?? "", "Nhà cung cấp", 180);
    const note = textField(req.body.note ?? "", "Ghi chú", 5000);
    const items = normalizeItems(req.body.items, true);
    const identity = requestIdentity(req.body, { supplier, note, items });
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      if (await replayCreation(conn, "stock_receipts", identity, req.user.id, res)) { await conn.commit(); return; }
      const code = documentCode("PN");
      const [receipt] = await conn.query(
        "INSERT INTO stock_receipts (code, supplier, note, status, created_by, request_key, request_hash) VALUES (?, ?, ?, 'PENDING', ?, ?, ?)",
        [code, supplier, note, req.user.id, identity.key, identity.hash]
      );
      await validateReceipt(conn, items, { lock: true });
      for (const item of items) {
        await conn.query(`INSERT INTO stock_receipt_items
          (receipt_id, product_id, batch_code, quantity, expiry_date, location)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [receipt.insertId, item.productId, item.batchCode, Number(item.quantity), item.expiryDate, item.location]);
      }
      await conn.commit();
      res.status(201).json({ id: receipt.insertId, code, message: "Đã gửi phiếu nhập chờ phê duyệt." });
    } catch (error) {
      await conn.rollback();
      if (error.code === "ER_DUP_ENTRY" && await replayCreation(conn, "stock_receipts", identity, req.user.id, res)) return;
      throw error;
    } finally { conn.release(); }
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
    const { strategy = "FEFO" } = req.body;
    if (!['FEFO', 'FIFO', 'LIFO'].includes(strategy)) return res.status(400).json({ message: "Chỉ hỗ trợ chính sách xuất FEFO, FIFO hoặc LIFO." });
    const requestedBy = textField(req.body.requestedBy ?? "", "Bộ phận yêu cầu", 180);
    const note = textField(req.body.note ?? "", "Ghi chú", 5000);
    const items = normalizeItems(req.body.items);
    const identity = requestIdentity(req.body, { requestedBy, note, strategy, items });
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      if (await replayCreation(conn, "stock_issues", identity, req.user.id, res)) { await conn.commit(); return; }
      const code = documentCode("PX");
      const [issue] = await conn.query(
        "INSERT INTO stock_issues (code, requested_by, note, strategy, status, created_by, request_key, request_hash) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)",
        [code, requestedBy, note, strategy, req.user.id, identity.key, identity.hash]
      );
      await checkProducts(conn, items);
      for (const item of items) {
        await conn.query("INSERT INTO stock_issue_items (issue_id, product_id, quantity) VALUES (?, ?, ?)",
          [issue.insertId, item.productId, Number(item.quantity)]);
      }
      await conn.commit();
      res.status(201).json({ id: issue.insertId, code, message: "Đã gửi phiếu xuất chờ phê duyệt." });
    } catch (error) {
      await conn.rollback();
      if (error.code === "ER_DUP_ENTRY" && await replayCreation(conn, "stock_issues", identity, req.user.id, res)) return;
      throw error;
    } finally { conn.release(); }
  } catch (error) { next(error); }
});

router.get("/:kind/:id", async (req, res, next) => {
  const isReceipt = req.params.kind === "receipts";
  if (!isReceipt && req.params.kind !== "issues") return res.status(404).json({ message: "Loại phiếu không hợp lệ." });
  const table = isReceipt ? "stock_receipts" : "stock_issues";
  const itemTable = isReceipt ? "stock_receipt_items" : "stock_issue_items";
  const foreignKey = isReceipt ? "receipt_id" : "issue_id";
  try {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[document]] = await conn.query(`SELECT d.*, u.full_name AS creator_name, a.full_name AS approver_name
        FROM ${table} d JOIN users u ON u.id = d.created_by
        LEFT JOIN users a ON a.id = d.approved_by WHERE d.id = ?`, [req.params.id]);
      if (!document) {
        await conn.rollback();
        return res.status(404).json({ message: "Không tìm thấy phiếu." });
      }
      let [items] = await conn.query(`SELECT i.*, p.sku, p.name AS product_name, p.unit
        FROM ${itemTable} i JOIN products p ON p.id = i.product_id
        WHERE i.${foreignKey} = ? ORDER BY i.id`, [document.id]);
      if (isReceipt && document.status === "PENDING") {
        try {
          const normalized = normalizeItems(items, true, true);
          await validateReceipt(conn, normalized);
          document.can_approve = true;
          document.review_token = digest(normalized);
        } catch (error) {
          document.can_approve = false;
          document.validation_error = error.message;
        }
      } else if (!isReceipt && document.status === "PENDING") {
        items = await planIssue(conn, items, document.strategy);
        document.can_approve = items.length > 0 && items.every(item => item.shortage_quantity === 0);
        document.review_token = allocationReviewToken(items);
      } else if (!isReceipt) {
        const [allocations] = await conn.query(`SELECT a.issue_item_id, a.batch_id, a.quantity,
          b.batch_code, b.expiry_date, b.received_at, b.location
          FROM stock_issue_allocations a JOIN batches b ON b.id = a.batch_id
          JOIN stock_issue_items i ON i.id = a.issue_item_id WHERE i.issue_id = ? ORDER BY a.id`, [document.id]);
        items = items.map(item => ({ ...item, allocations: allocations.filter(row => row.issue_item_id === item.id) }));
        const [[adjustment]] = await conn.query(`SELECT a.*, u.full_name AS adjusted_by_name
          FROM stock_issue_adjustments a JOIN users u ON u.id = a.adjusted_by WHERE a.issue_id = ?`, [document.id]);
        document.adjustment = adjustment || null;
      }
      await conn.commit();
      res.json({ ...document, items });
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
      const [items] = await conn.query("SELECT * FROM stock_receipt_items WHERE receipt_id = ? ORDER BY id", [receipt.id]);
      const normalized = normalizeItems(items, true, true);
      await validateReceipt(conn, normalized, { lock: true });
      if (req.body?.reviewToken !== digest(normalized)) throw new Error("Nội dung phiếu đã thay đổi hoặc chưa được xem. Vui lòng tải lại chi tiết phiếu trước khi duyệt.");
      for (const item of items) {
        await conn.query(`INSERT INTO batches (product_id, batch_code, quantity, expiry_date, location, received_at)
          VALUES (?, ?, ?, ?, ?, CURDATE()) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`, [item.product_id, item.batch_code.trim(), item.quantity, item.expiry_date, item.location.trim()]);
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
      const [items] = await conn.query("SELECT * FROM stock_issue_items WHERE issue_id = ? ORDER BY id", [issue.id]);
      const suggestedPlan = await planIssue(conn, items, issue.strategy, { lock: true });
      if (!suggestedPlan.length || suggestedPlan.some(item => item.shortage_quantity > 0)) {
        const shortages = suggestedPlan.filter(item => item.shortage_quantity > 0).map(item => `Sản phẩm #${item.product_id}: yêu cầu ${item.quantity}, khả dụng cho dòng ${item.available_quantity}, thiếu ${item.shortage_quantity}`).join("; ");
        throw new Error(`Không đủ tồn kho khả dụng sau khi loại lô hết hạn. ${shortages}. Vui lòng xem lại chi tiết phiếu.`);
      }
      if (req.body?.reviewToken !== allocationReviewToken(suggestedPlan)) {
        throw new Error("Phân bổ lô đã thay đổi hoặc chưa được xem. Vui lòng tải lại chi tiết phiếu trước khi duyệt.");
      }
      let plan = suggestedPlan;
      const adjustment = req.body?.adjustment;
      if (adjustment !== undefined) {
        const reason = typeof adjustment?.reason === "string" ? adjustment.reason.trim() : "";
        if (!reason || reason.length > 1000) throw new Error("Lý do điều chỉnh lô là bắt buộc và không được quá 1.000 ký tự.");
        plan = adjustIssue(suggestedPlan, adjustment.items);
        const snapshot = rows => JSON.stringify(rows.map(item => ({ item_id: item.id, allocations: item.allocations })));
        await conn.query(`INSERT INTO stock_issue_adjustments
          (issue_id, reason, adjusted_by, suggested_allocations, selected_allocations) VALUES (?, ?, ?, ?, ?)`,
          [issue.id, reason, req.user.id, snapshot(suggestedPlan), snapshot(plan)]);
      }
      for (const item of plan) {
        for (const allocation of item.allocations) {
          await conn.query("UPDATE batches SET quantity = quantity - ? WHERE id = ?", [allocation.quantity, allocation.batch_id]);
          await conn.query("INSERT INTO stock_issue_allocations (issue_item_id, batch_id, quantity) VALUES (?, ?, ?)", [item.id, allocation.batch_id, allocation.quantity]);
        }
      }
      await conn.query("UPDATE stock_issues SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ?", [req.user.id, issue.id]);
      await conn.commit();
      res.json({ message: adjustment ? "Đã phê duyệt phiếu xuất, lưu lý do điều chỉnh lô và cập nhật tồn kho." : "Đã phê duyệt phiếu xuất và trừ tồn kho theo chính sách đã chọn." });
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  } catch (error) { next(error); }
});

router.post("/:kind/:id/reject", requireManager, async (req, res, next) => {
  try {
    const table = req.params.kind === "receipts" ? "stock_receipts" : req.params.kind === "issues" ? "stock_issues" : null;
    if (!table) return res.status(404).json({ message: "Loại phiếu không hợp lệ." });
    const reason = textField(req.body?.reason, "Lý do từ chối", 1000, true);
    const [result] = await db.query(`UPDATE ${table} SET status = 'REJECTED', rejection_reason = ?, approved_by = ?, approved_at = NOW() WHERE id = ? AND status = 'PENDING'`, [reason, req.user.id, req.params.id]);
    if (!result.affectedRows) return res.status(400).json({ message: "Phiếu không còn ở trạng thái chờ duyệt." });
    res.json({ message: "Đã từ chối phiếu." });
  } catch (error) { next(error); }
});

export default router;

