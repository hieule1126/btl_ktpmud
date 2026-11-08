import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { cleanText } from "./text.js";

const number = value => new Intl.NumberFormat("vi-VN").format(Number(value || 0));
const date = value => value ? new Intl.DateTimeFormat("vi-VN").format(new Date(value)) : "—";
const statuses = { PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối" };

export default function DocumentDetail({ kind, id, isManager, onBack, onDone }) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const [selections, setSelections] = useState({});
  const [reason, setReason] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const submitting = useRef(false);
  const isReceipt = kind === "receipts";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDocument(null);
    setAdjusting(false);
    setSelections({});
    setReason("");
    setRejectionReason("");
    api(`/warehouse/${kind}/${id}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setDocument(data); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, id, version]);

  const startAdjustment = () => {
    setSelections(Object.fromEntries(document.items.map(item => [item.id,
      Object.fromEntries(item.allocations.map(allocation => [allocation.batch_id, allocation.quantity]))
    ])));
    setReason("");
    setAdjusting(true);
  };
  const selectedTotal = item => Object.values(selections[item.id] || {}).reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100;
  const adjustmentItems = document?.items.map(item => ({
    itemId: item.id,
    allocations: (item.available_batches || []).filter(batch => Number(selections[item.id]?.[batch.batch_id]) > 0)
      .map(batch => ({ batchId: batch.batch_id, quantity: Number(selections[item.id][batch.batch_id]) }))
  })) || [];
  const batchTotals = new Map();
  for (const item of adjustmentItems) {
    for (const allocation of item.allocations) batchTotals.set(allocation.batchId, (batchTotals.get(allocation.batchId) || 0) + Math.round(allocation.quantity * 100));
  }
  const adjustmentValid = !adjusting || (reason.trim().length > 0 && reason.trim().length <= 1000 && document?.items.every(item =>
    Math.round(selectedTotal(item) * 100) === Math.round(Number(item.quantity) * 100)
    && (item.available_batches || []).every(batch => {
      const quantity = Number(selections[item.id]?.[batch.batch_id] || 0);
      return Number.isFinite(quantity) && quantity >= 0 && Math.abs(quantity * 100 - Math.round(quantity * 100)) < 1e-7
        && (batchTotals.get(batch.batch_id) || 0) <= Math.round(Number(batch.quantity) * 100);
    })
  ));

  const decide = async action => {
    if (submitting.current) return;
    if (action === "approve" && !adjustmentValid) return;
    if (action === "reject" && !rejectionReason.trim()) { setError("Vui lòng nhập lý do từ chối."); return; }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/warehouse/${kind}/${id}/${action}`, {
        method: "POST", body: JSON.stringify({
          reviewToken: document.review_token,
          ...(action === "reject" ? { reason: rejectionReason.trim() } : {}),
          ...(action === "approve" && adjusting ? { adjustment: { reason: reason.trim(), items: adjustmentItems } } : {})
        })
      });
      await onDone(result.message);
    } catch (err) {
      setError(err.message);
      // Fetch current status and stock after a concurrent approval or stock change.
      setVersion(value => value + 1);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const pending = document?.status === "PENDING";

  return <section className="panel document-detail" aria-busy={loading || busy}>
    <div className="panel-head detail-heading">
      <div><h2>Chi tiết phiếu {isReceipt ? "nhập" : "xuất"}</h2><p>{document?.code || "Đang tải thông tin phiếu"}</p></div>
      <div className="detail-controls">
        <button className="secondary" disabled={busy || loading} onClick={() => { setError(""); setVersion(value => value + 1); }}>Tải lại</button>
        <button className="secondary" disabled={busy} onClick={onBack}>Quay lại</button>
      </div>
    </div>
    {error && <div className="toast error" role="alert">{error}</div>}
    {loading && <p role="status">Đang tải các dòng hàng và thông tin lô…</p>}
    {!loading && document && <>
      {document.validation_error && <p className="form-error" role="alert">{document.validation_error}</p>}
      {document.rejection_reason && <p className="detail-info"><strong>Lý do từ chối: </strong>{document.rejection_reason}</p>}
      <dl className="document-meta">
        <div><dt>Mã phiếu</dt><dd>{document.code}</dd></div>
        <div><dt>Trạng thái</dt><dd><span className={`status ${document.status.toLowerCase()}`}>{statuses[document.status]}</span></dd></div>
        <div><dt>Người lập</dt><dd>{document.creator_name}</dd></div>
        <div><dt>Ngày tạo</dt><dd>{date(document.created_at)}</dd></div>
        <div><dt>{isReceipt ? "Nhà cung cấp" : "Bộ phận yêu cầu"}</dt><dd>{(isReceipt ? document.supplier : document.requested_by) || "—"}</dd></div>
        {!isReceipt && <div><dt>Chính sách xuất</dt><dd>{document.strategy}</dd></div>}
        {!pending && <><div><dt>Người xử lý</dt><dd>{document.approver_name || "—"}</dd></div><div><dt>Ngày xử lý</dt><dd>{date(document.approved_at)}</dd></div></>}
        <div className="document-note"><dt>Ghi chú</dt><dd>{document.note || "Không có ghi chú"}</dd></div>
        {document.adjustment && <>
          <div><dt>Người điều chỉnh lô</dt><dd>{document.adjustment.adjusted_by_name}</dd></div>
          <div><dt>Thời điểm điều chỉnh</dt><dd>{new Date(document.adjustment.adjusted_at).toLocaleString("vi-VN")}</dd></div>
          <div className="document-note"><dt>Lý do điều chỉnh lô</dt><dd>{document.adjustment.reason}</dd></div>
        </>}
      </dl>
      {!isReceipt && pending && <div className="detail-info">
        Phân bổ lô dự kiến theo {document.strategy}, chỉ tính lô còn hàng và có hạn sử dụng từ hôm nay trở đi.
        Hệ thống kiểm tra lại khi duyệt; nếu phân bổ thay đổi, bạn cần xem lại trước khi duyệt tiếp.
      </div>}
      {!isReceipt && pending && !document.can_approve && <div className="toast error" role="alert">Không đủ tồn kho khả dụng để duyệt phiếu. Kiểm tra số lượng còn thiếu ở từng dòng hàng.</div>}
      {!isReceipt && pending && isManager && <div className="form-actions">
        {adjusting
          ? <button className="secondary" disabled={busy} onClick={() => { setAdjusting(false); setReason(""); }}>Hủy điều chỉnh, dùng lô đề xuất</button>
          : <button className="secondary" disabled={busy || !document.can_approve} onClick={startAdjustment}>Điều chỉnh lô</button>}
      </div>}
      {adjusting && <div className="document-form">
        <div className="form-grid"><label className="wide">Lý do điều chỉnh lô (bắt buộc)
          <input value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} disabled={busy} placeholder="Ví dụ: khách hàng yêu cầu lô cụ thể" />
        </label></div>
        <p className="allocation-label">Nhập số lượng cho từng lô; để 0 nếu không xuất. Điều chỉnh và lý do được lưu khi phê duyệt.</p>
      </div>}
      <h3 className="detail-section-title">Các dòng hàng ({document.items.length})</h3>
      {isReceipt ? <div className="table-scroll"><table>
        <thead><tr><th>Sản phẩm</th><th>Số lượng nhập</th><th>Đơn vị</th><th>Mã lô</th><th>Hạn sử dụng</th><th>Vị trí</th></tr></thead>
        <tbody>{document.items.map(item => <tr key={item.id}>
          <td><strong>{item.product_name}</strong><small className="inline-small">{item.sku}</small></td>
          <td className="strong-number">{number(item.quantity)}</td><td>{cleanText(item.unit)}</td>
          <td><code>{item.batch_code}</code></td><td>{date(item.expiry_date)}</td><td>{item.location}</td>
        </tr>)}</tbody>
      </table></div> : <div className="issue-detail-items">{document.items.map((item, index) => <article className="issue-detail-item" key={item.id}>
        <h4>{index + 1}. {item.sku} — {item.product_name}</h4>
        <div className="line-quantities">
          <span>Yêu cầu: <strong>{number(item.quantity)} {cleanText(item.unit)}</strong></span>
          {pending && <><span>Khả dụng cho dòng này: <strong>{number(item.available_quantity)}</strong></span>
            <span className={item.shortage_quantity > 0 ? "shortage" : ""}>Còn thiếu: <strong>{number(item.shortage_quantity)}</strong></span></>}
        </div>
        <p className="allocation-label">{adjusting ? `Đã chọn: ${number(selectedTotal(item))} / ${number(item.quantity)} ${cleanText(item.unit)}` : pending ? `Lô đề xuất theo ${document.strategy}` : document.status === "APPROVED" ? "Lô đã xuất" : "Phiếu đã từ chối, không xuất hàng"}</p>
        {(adjusting ? item.available_batches : item.allocations).length ? <div className="table-scroll"><table>
          <thead><tr><th>Mã lô</th>{adjusting && <th>Tồn khả dụng</th>}<th>Số lượng xuất</th><th>Đơn vị</th><th>Hạn sử dụng</th><th>Ngày nhập</th><th>Vị trí</th></tr></thead>
          <tbody>{(adjusting ? item.available_batches : item.allocations).map(allocation => <tr key={allocation.batch_id}>
            <td><code>{allocation.batch_code}</code></td>
            {adjusting && <td>{number(allocation.quantity)}</td>}
            <td className="strong-number">{adjusting ? <input type="number" min="0" max={allocation.quantity} step="0.01" disabled={busy}
              aria-label={`Số lượng xuất ${item.sku} dòng ${index + 1} lô ${allocation.batch_code}`}
              value={selections[item.id]?.[allocation.batch_id] ?? 0}
              onChange={event => setSelections(values => ({ ...values, [item.id]: { ...values[item.id], [allocation.batch_id]: event.target.value } }))} /> : number(allocation.quantity)}</td><td>{cleanText(item.unit)}</td>
            <td>{date(allocation.expiry_date)}</td><td>{date(allocation.received_at)}</td><td>{allocation.location}</td>
          </tr>)}</tbody>
        </table></div> : pending && <p>Không có lô khả dụng cho dòng hàng này.</p>}
      </article>)}</div>}
      {document.adjustment && <details className="detail-info">
        <summary>Lô đề xuất trước khi điều chỉnh</summary>
        {document.adjustment.suggested_allocations.map(item => <p key={item.item_id}>
          <strong>{document.items.find(line => line.id === item.item_id)?.product_name}: </strong>
          {item.allocations.map(allocation => `${allocation.batch_code}: ${number(allocation.quantity)}`).join("; ")}
        </p>)}
      </details>}
      {adjusting && !adjustmentValid && <p className="detail-info" role="status">Nhập lý do và phân bổ đủ số lượng của từng dòng hàng. Tổng xuất từ mỗi lô không được vượt tồn khả dụng, kể cả khi sản phẩm xuất hiện ở nhiều dòng.</p>}
      {pending && isManager && <div className="detail-decision">
        <p>Kiểm tra các dòng hàng và thông tin lô trước khi quyết định. Phê duyệt sẽ cập nhật tồn kho ngay.</p>
        <label>Lý do từ chối (bắt buộc khi từ chối)<textarea maxLength={1000} disabled={busy} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} rows={3} /></label>
        <div className="approval-actions">
          <button className="secondary danger" disabled={busy || !rejectionReason.trim()} onClick={() => decide("reject")}>Từ chối</button>
          <button className="primary" disabled={busy || !adjustmentValid || !document.can_approve || !document.items.length} onClick={() => decide("approve")}>{busy ? "Đang xử lý…" : "Phê duyệt"}</button>
        </div>
      </div>}
      {pending && !isManager && <p className="detail-info">Chỉ quản lý kho có quyền điều chỉnh lô, phê duyệt hoặc từ chối phiếu.</p>}
    </>}
  </section>;
}
