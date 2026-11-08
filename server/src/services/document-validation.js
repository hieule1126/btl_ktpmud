import { createHash, randomUUID } from "node:crypto";

export const MAX_QUANTITY = 9999999999.99;
export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const documentCode = prefix => `${prefix}-${randomUUID()}`;
export function quantity(value) {
  if (!["number", "string"].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value))
      || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > MAX_QUANTITY) {
    throw new Error("Số lượng phải lớn hơn 0, tối đa 9.999.999.999,99 và có tối đa 2 chữ số thập phân.");
  }
  return Number(value);
}
export function textField(value, label, max, required = false) {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new Error(`${label} ${required ? "là bắt buộc và " : ""}không được quá ${max} ký tự.`);
  }
  return value.trim();
}
export function dateOnly(value) {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return value;
}
export function normalizeItems(items, receipt = false, stored = false) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error("Phiếu cần có từ 1 đến 100 dòng hàng.");
  return items.map((item, index) => {
    try {
      if (!item || typeof item !== "object") throw new Error("Dòng hàng không hợp lệ.");
      const id = stored ? item.product_id : item.productId;
      if (!["string", "number"].includes(typeof id) || !/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error("Sản phẩm không hợp lệ.");
      const result = { productId: Number(id), quantity: quantity(item.quantity) };
      if (receipt) {
        result.batchCode = textField(stored ? item.batch_code : item.batchCode, "Mã lô", 80, true);
        result.location = textField(item.location, "Vị trí kho", 80, true);
        const date = dateOnly(stored ? item.expiry_date : item.expiryDate);
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "1000-01-01"
            || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Hạn sử dụng không hợp lệ.");
        result.expiryDate = date;
      }
      return result;
    } catch (error) { throw new Error(`Dòng ${index + 1}: ${error.message}`); }
  });
}

export async function checkProducts(conn, items, lock = false) {
  for (const id of [...new Set(items.map(item => item.productId))].sort((a, b) => a - b)) {
    const [[product]] = await conn.query(`SELECT id FROM products WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
    if (!product) throw new Error(`Sản phẩm #${id} không tồn tại.`);
  }
}

// The product locks serialize receipts even when the batch does not exist yet.
export async function validateReceipt(conn, items, { lock = false } = {}) {
  await checkProducts(conn, items, lock);
  const [[clock]] = await conn.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
  const totals = new Map();
  for (const [index, item] of items.entries()) {
    if (item.expiryDate < clock.today) throw new Error(`Dòng ${index + 1}: Không được nhập lô đã hết hạn.`);
    const [[batch]] = await conn.query(`SELECT * FROM batches WHERE product_id = ? AND batch_code = ?${lock ? " FOR UPDATE" : ""}`, [item.productId, item.batchCode]);
    let prior;
    // Match MySQL's batch-code collation, including case, accents and trailing spaces.
    for (const row of items.slice(0, index).filter(row => row.productId === item.productId)) {
      const [[comparison]] = await conn.query("SELECT CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci AS same_code", [row.batchCode, item.batchCode]);
      if (comparison.same_code) { prior = row; break; }
    }
    const existing = batch ? { expiryDate: dateOnly(batch.expiry_date), location: batch.location } : prior;
    if (existing && (existing.expiryDate !== item.expiryDate || existing.location !== item.location)
        || prior && (prior.expiryDate !== item.expiryDate || prior.location !== item.location)) {
      throw new Error(`Dòng ${index + 1}: Lô ${item.batchCode} có hạn dùng hoặc vị trí không khớp. Nhập bổ sung phải giữ nguyên thông tin lô.`);
    }
    const key = batch ? `batch:${batch.id}` : `${item.productId}:${(prior || item).batchCode}`;
    const total = (totals.get(key) ?? Math.round(Number(batch?.quantity || 0) * 100)) + Math.round(item.quantity * 100);
    if (total > Math.round(MAX_QUANTITY * 100)) throw new Error(`Dòng ${index + 1}: Tổng tồn lô ${item.batchCode} vượt giới hạn số lượng.`);
    totals.set(key, total);
  }
}

export function requestIdentity(body, payload) {
  if (typeof body.requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
    throw new Error("Mã yêu cầu chống trùng không hợp lệ. Vui lòng mở lại form tạo phiếu.");
  }
  return { key: body.requestKey.toLowerCase(), hash: digest(payload) };
}
