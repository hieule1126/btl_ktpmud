import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireManager } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/products", async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*, COALESCE(SUM(b.quantity), 0) AS current_stock
      FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.quantity > 0
      GROUP BY p.id ORDER BY p.created_at DESC`);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post("/products", requireManager, async (req, res, next) => {
  try {
    const { sku, name, unit = "cái", minimumStock = 0 } = req.body;
    if (!sku || !name) return res.status(400).json({ message: "Mã và tên sản phẩm là bắt buộc." });
    const [result] = await db.query(
      "INSERT INTO products (sku, name, unit, minimum_stock) VALUES (?, ?, ?, ?)",
      [sku.trim(), name.trim(), unit, Number(minimumStock)]
    );
    res.status(201).json({ id: result.insertId, message: "Đã thêm sản phẩm." });
  } catch (error) { next(error); }
});

router.get("/batches", async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT b.*, p.sku, p.name AS product_name, p.unit
      FROM batches b JOIN products p ON p.id = b.product_id
      ORDER BY b.expiry_date ASC, b.received_at ASC`);
    res.json(rows);
  } catch (error) { next(error); }
});

export default router;

