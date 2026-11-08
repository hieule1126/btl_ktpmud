import { createHash } from "node:crypto";
import { normalizeItems } from "./document-validation.js";

export function allocationReviewToken(items) {
  return createHash("sha256").update(JSON.stringify(items.map(item => ({
    id: item.id, quantity: item.quantity, allocations: item.allocations, available_batches: item.available_batches
  })))).digest("hex");
}

const orderings = {
  FEFO: "expiry_date ASC, received_at ASC, id ASC",
  FIFO: "received_at ASC, id ASC",
  LIFO: "received_at DESC, id DESC"
};

// Quantities are DECIMAL(12,2) in MySQL. Allocate in hundredths to avoid rounding drift.
const units = value => Math.round(Number(value) * 100);

export async function planIssue(conn, items, strategy, { lock = false } = {}) {
  normalizeItems(items, false, true);
  const ordering = orderings[strategy];
  if (!ordering) throw new Error("Chiến lược xuất không hợp lệ.");
  const stock = new Map();
  const candidates = new Map();
  // Lock products in a stable order when approving concurrent documents.
  for (const productId of [...new Set(items.map(item => item.product_id))].sort((a, b) => a - b)) {
    const [batches] = await conn.query(`SELECT * FROM batches
      WHERE product_id = ? AND quantity > 0 AND expiry_date >= CURDATE()
      ORDER BY ${ordering}${lock ? " FOR UPDATE" : ""}`, [productId]);
    stock.set(productId, batches.map(batch => ({ ...batch, remaining: units(batch.quantity) })));
    candidates.set(productId, batches.map(batch => ({
      batch_id: batch.id, batch_code: batch.batch_code, quantity: Number(batch.quantity),
      expiry_date: batch.expiry_date, received_at: batch.received_at, location: batch.location
    })));
  }
  return items.map(item => {
    const batches = stock.get(item.product_id);
    const available = batches.reduce((sum, batch) => sum + batch.remaining, 0);
    let remaining = units(item.quantity);
    const allocations = [];
    for (const batch of batches) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, batch.remaining);
      if (!allocated) continue;
      allocations.push({
        batch_id: batch.id, batch_code: batch.batch_code, quantity: allocated / 100,
        expiry_date: batch.expiry_date, received_at: batch.received_at, location: batch.location
      });
      batch.remaining -= allocated;
      remaining -= allocated;
    }
    return { ...item, available_quantity: available / 100, shortage_quantity: remaining / 100,
      available_batches: candidates.get(item.product_id), allocations };
  });
}

// The caller must hold the batch locks from planIssue until the approval commits.
export function adjustIssue(plan, selections) {
  if (!Array.isArray(selections) || selections.length !== plan.length) {
    throw new Error("Điều chỉnh lô phải có đủ các dòng hàng của phiếu.");
  }
  const seenItems = new Set();
  const remaining = new Map();
  for (const item of plan) {
    for (const batch of item.available_batches) remaining.set(batch.batch_id, units(batch.quantity));
  }
  const selectedItems = new Map();
  for (const selection of selections) {
    if (!selection || !Number.isInteger(selection.itemId) || seenItems.has(selection.itemId)
        || !plan.some(item => item.id === selection.itemId) || !Array.isArray(selection.allocations)
        || !selection.allocations.length) {
      throw new Error("Dòng hàng điều chỉnh không hợp lệ hoặc bị trùng.");
    }
    seenItems.add(selection.itemId);
    selectedItems.set(selection.itemId, selection.allocations);
  }
  return plan.map(item => {
    const seenBatches = new Set();
    let total = 0;
    const allocations = selectedItems.get(item.id).map(selection => {
      const batch = item.available_batches.find(batch => batch.batch_id === selection?.batchId);
      const quantity = selection?.quantity;
      if (!batch || seenBatches.has(batch.batch_id)) throw new Error("Lô điều chỉnh không hợp lệ, hết hạn, hết hàng hoặc bị trùng.");
      if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0
          || !Number.isSafeInteger(units(quantity)) || Math.abs(quantity * 100 - units(quantity)) > 1e-7) {
        throw new Error("Số lượng điều chỉnh phải lớn hơn 0 và có tối đa 2 chữ số thập phân.");
      }
      const requested = units(quantity);
      if (requested > remaining.get(batch.batch_id)) throw new Error(`Lô ${batch.batch_code} không đủ tồn kho khả dụng.`);
      seenBatches.add(batch.batch_id);
      remaining.set(batch.batch_id, remaining.get(batch.batch_id) - requested);
      total += requested;
      return { ...batch, quantity: requested / 100 };
    });
    if (total !== units(item.quantity)) throw new Error("Tổng số lượng điều chỉnh phải bằng số lượng yêu cầu ở từng dòng hàng.");
    return { ...item, allocations, shortage_quantity: 0 };
  });
}
