import { useRef, useState } from "react";
import { api } from "./api.js";
import { cleanText } from "./text.js";

const blankLine = () => ({ key: crypto.randomUUID(), productId: "", quantity: "1", batchCode: "", expiryDate: "", location: "" });

export default function DocumentForm({ isReceipt, products, onSaved, onCancel }) {
  const [form, setForm] = useState({ partner: "", note: "", strategy: "FEFO" });
  const [items, setItems] = useState(() => [blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const attempt = useRef(null);
  const update = (key, field, value) => setItems(rows => rows.map(row => row.key === key ? { ...row, [field]: value } : row));
  const submit = async event => {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    for (const [index, item] of items.entries()) {
      if (!products.some(product => product.id === Number(item.productId)) || !/^\d+(\.\d{1,2})?$/.test(String(item.quantity))
          || Number(item.quantity) <= 0 || Number(item.quantity) > 9999999999.99) {
        setError(`Dòng ${index + 1}: Chọn sản phẩm và nhập số lượng lớn hơn 0, tối đa 2 chữ số thập phân.`);
        return;
      }
      if (isReceipt && (!item.batchCode.trim() || !item.location.trim() || !item.expiryDate)) {
        setError(`Dòng ${index + 1}: Nhập đủ mã lô, hạn dùng và vị trí.`);
        return;
      }
    }
    const payload = {
      ...(isReceipt ? { supplier: form.partner.trim() } : { requestedBy: form.partner.trim(), strategy: form.strategy }),
      note: form.note.trim(),
      items: items.map(item => ({ productId: Number(item.productId), quantity: Number(item.quantity),
        ...(isReceipt ? { batchCode: item.batchCode.trim(), expiryDate: item.expiryDate, location: item.location.trim() } : {}) }))
    };
    const serialized = JSON.stringify(payload);
    // Retry an unchanged submission with the same key, including after a lost response.
    if (attempt.current?.serialized !== serialized) attempt.current = { serialized, key: crypto.randomUUID() };
    submitting.current = true;
    setBusy(true);
    try {
      const result = await api(`/warehouse/${isReceipt ? "receipts" : "issues"}`, {
        method: "POST", body: JSON.stringify({ ...payload, requestKey: attempt.current.key })
      });
      await onSaved(result);
    } catch (err) { setError(err.message); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form className="document-form" onSubmit={submit} aria-busy={busy}>
    <h3>Tạo phiếu {isReceipt ? "nhập" : "xuất"} kho</h3>
    {error && <p className="form-error" role="alert">{error}</p>}
    <fieldset className="document-fields" disabled={busy}>
      <div className="form-grid">
        <label>{isReceipt ? "Nhà cung cấp" : "Bộ phận yêu cầu"}<input maxLength={180} required value={form.partner} onChange={e => setForm({ ...form, partner: e.target.value })} /></label>
        {!isReceipt && <label>Chính sách xuất<select value={form.strategy} onChange={e => setForm({ ...form, strategy: e.target.value })}>
          <option value="FEFO">FEFO — gần hết hạn trước</option><option value="FIFO">FIFO — nhập trước xuất trước</option><option value="LIFO">LIFO — nhập sau xuất trước</option>
        </select></label>}
        <label className="wide">Ghi chú<input maxLength={5000} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
      </div>
      <p className="document-rule">{isReceipt ? "Nhập bổ sung lô cũ: cùng sản phẩm, hạn dùng và vị trí; giữ ngày nhập ban đầu. Không nhận lô đã hết hạn." : "Chỉ xuất lô còn hàng và chưa hết hạn. Phân bổ được kiểm tra lại khi duyệt; phiếu chờ duyệt chưa giữ chỗ tồn kho."}</p>
      {items.map((item, index) => <fieldset className="document-line" key={item.key}>
        <legend>Dòng hàng {index + 1}</legend>
        <div className="form-grid">
          <label>Sản phẩm<select required value={item.productId} onChange={e => update(item.key, "productId", e.target.value)}>
            <option value="">Chọn sản phẩm</option>{products.map(p => <option key={p.id} value={p.id}>{p.sku} — {p.name} ({cleanText(p.unit)})</option>)}
          </select></label>
          <label>Số lượng<input type="number" min="0.01" max="9999999999.99" step="0.01" required value={item.quantity} onChange={e => update(item.key, "quantity", e.target.value)} /></label>
          {isReceipt && <>
            <label>Mã lô<input maxLength={80} required value={item.batchCode} onChange={e => update(item.key, "batchCode", e.target.value)} /></label>
            <label>Hạn sử dụng<input type="date" required value={item.expiryDate} onChange={e => update(item.key, "expiryDate", e.target.value)} /></label>
            <label>Vị trí kho<input maxLength={80} required placeholder="Ví dụ: A-01-01" value={item.location} onChange={e => update(item.key, "location", e.target.value)} /></label>
          </>}
        </div>
        <button type="button" className="secondary danger" disabled={items.length === 1} onClick={() => setItems(rows => rows.filter(row => row.key !== item.key))}>Xóa dòng {index + 1}</button>
      </fieldset>)}
      <button type="button" className="secondary" disabled={items.length >= 100} onClick={() => setItems(rows => [...rows, blankLine()])}>+ Thêm dòng sản phẩm</button>
      <div className="form-actions"><button className="primary" disabled={!products.length}>{busy ? "Đang gửi…" : `Gửi phê duyệt (${items.length} dòng)`}</button><button type="button" className="secondary" onClick={onCancel}>Hủy</button></div>
    </fieldset>
  </form>;
}
