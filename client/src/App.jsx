import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const icons = { dashboard: "▦", products: "◫", batches: "▤", receipt: "↓", issue: "↑", approvals: "✓" };
const pageMeta = {
  dashboard: ["Tổng quan kho", "Theo dõi tồn kho và phiếu xử lý hôm nay"],
  products: ["Sản phẩm", "Danh mục hàng hóa đang quản lý"],
  batches: ["Lô hàng", "Theo dõi vị trí, số lượng và hạn sử dụng"],
  receipts: ["Phiếu nhập", "Tạo và theo dõi các phiếu nhập kho"],
  issues: ["Phiếu xuất", "Xuất kho tự động theo chiến lược đã chọn"],
  approvals: ["Chờ phê duyệt", "Chỉ quản lý kho có quyền phê duyệt phiếu"]
};

function formatNumber(value) { return new Intl.NumberFormat("vi-VN").format(Number(value || 0)); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("vi-VN").format(new Date(value)) : "—"; }
function statusText(status) { return ({ PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối" })[status] || status; }

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("warehouse_user") || "null"));
  const [page, setPage] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadData = async () => {
    try {
      const [productData, batchData, receiptData, issueData, dashboardData] = await Promise.all([
        api("/catalog/products"), api("/catalog/batches"), api("/warehouse/receipts"), api("/warehouse/issues"), api("/warehouse/dashboard")
      ]);
      setProducts(productData); setBatches(batchData); setReceipts(receiptData); setIssues(issueData); setDashboard(dashboardData);
    } catch (err) { setError(err.message); }
  };
  useEffect(() => { if (session) loadData(); }, [session]);

  const notify = (message) => { setNotice(message); setError(""); window.setTimeout(() => setNotice(""), 3200); };
  const signOut = () => { localStorage.removeItem("warehouse_token"); localStorage.removeItem("warehouse_user"); setSession(null); };
  const isManager = session?.role === "WAREHOUSE_MANAGER";
  if (!session) return <Login onLogin={setSession} />;

  const onApproved = async (kind, id, action = "approve") => {
    try {
      const path = action === "approve" ? `/warehouse/${kind}/${id}/approve` : `/warehouse/${kind}/${id}/reject`;
      const result = await api(path, { method: "POST" });
      notify(result.message); await loadData();
    } catch (err) { setError(err.message); }
  };
  const pending = [...receipts.filter(x => x.status === "PENDING").map(x => ({ ...x, kind: "receipts", type: "Nhập" })), ...issues.filter(x => x.status === "PENDING").map(x => ({ ...x, kind: "issues", type: "Xuất" }))];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">K</span><span>Kho<span>Flow</span></span></div>
      <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav>{Object.keys(pageMeta).map(key => <button key={key} className={page === key ? "nav-item active" : "nav-item"} onClick={() => setPage(key)}><i>{icons[key === "approvals" ? "approvals" : key === "receipts" ? "receipt" : key === "issues" ? "issue" : key]}</i>{key === "dashboard" ? "Tổng quan" : pageMeta[key][0]}{key === "approvals" && pending.length > 0 && <b>{pending.length}</b>}</button>)}</nav>
      <div className="sidebar-foot"><div className="user-avatar">{session.name.slice(0, 1)}</div><div><strong>{session.name}</strong><small>{isManager ? "Quản lý kho" : "Nhân viên kho"}</small></div><button className="logout" title="Đăng xuất" onClick={signOut}>↪</button></div>
    </aside>
    <main className="main-content">
      <header><div><p className="eyebrow">KHO HÀNG TRUNG TÂM</p><h1>{pageMeta[page][0]}</h1><p className="subtitle">{pageMeta[page][1]}</p></div><div className="today">01 tháng 10, 2026</div></header>
      {notice && <div className="toast success">✓ {notice}</div>}{error && <div className="toast error">! {error}</div>}
      {page === "dashboard" && <Dashboard data={dashboard} pending={pending} setPage={setPage} />}
      {page === "products" && <Products products={products} canEdit={isManager} reload={loadData} notify={notify} setError={setError} />}
      {page === "batches" && <Batches batches={batches} />}
      {page === "receipts" && <Documents type="receipt" documents={receipts} products={products} reload={loadData} notify={notify} setError={setError} />}
      {page === "issues" && <Documents type="issue" documents={issues} products={products} reload={loadData} notify={notify} setError={setError} />}
      {page === "approvals" && <Approvals items={pending} isManager={isManager} onApproved={onApproved} />}
    </main>
  </div>;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("quanly@kho.local"); const [password, setPassword] = useState("123456"); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async e => { e.preventDefault(); setLoading(true); setError(""); try { const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); localStorage.setItem("warehouse_token", data.token); localStorage.setItem("warehouse_user", JSON.stringify(data.user)); onLogin(data.user); } catch (err) { setError(err.message); } finally { setLoading(false); } };
  return <div className="login-page"><div className="login-card"><div className="login-logo"><span className="brand-mark">K</span><strong>Kho<span>Flow</span></strong></div><p>Phần mềm quản lý kho hàng</p><h1>Chào mừng trở lại</h1><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Mật khẩu<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>{error && <div className="form-error">{error}</div>}<button className="primary full" disabled={loading}>{loading ? "Đang đăng nhập..." : "Đăng nhập"}</button></form><small>Tài khoản mẫu đã được điền sẵn.</small></div></div>;
}

function Dashboard({ data, pending, setPage }) {
  const cards = [{ label: "Sản phẩm", value: data?.summary.product_count, icon: "◫", color: "blue" }, { label: "Lô hàng đang có", value: data?.summary.batch_count, icon: "▤", color: "orange" }, { label: "Tổng đơn vị tồn", value: data?.summary.item_count, icon: "▦", color: "green" }, { label: "Phiếu chờ duyệt", value: data?.summary.pending_count, icon: "✓", color: "purple" }];
  return <><section className="hero"><div><span className="hero-badge">VẬN HÀNH ỔN ĐỊNH</span><h2>Kho của bạn đang được<br/>kiểm soát tốt.</h2><p>Theo dõi tập trung, xử lý chính xác và ra quyết định nhanh hơn mỗi ngày.</p><button onClick={() => setPage("approvals")}>Xem phiếu cần xử lý <span>→</span></button></div><div className="hero-shape"><div className="box one"/><div className="box two"/><div className="box three"/><span>▦</span></div></section><section className="stats">{cards.map(card => <article className="stat-card" key={card.label}><div className={`stat-icon ${card.color}`}>{card.icon}</div><p>{card.label}</p><strong>{formatNumber(card.value)}</strong><small>{card.label === "Phiếu chờ duyệt" ? "Cần xử lý" : "Được cập nhật liên tục"}</small></article>)}</section><section className="split-section"><div className="panel"><div className="panel-head"><div><h3>Phiếu cần xử lý</h3><p>Các chứng từ mới nhất đang chờ quyết định</p></div><button className="text-button" onClick={() => setPage("approvals")}>Xem tất cả</button></div>{pending.length ? <div className="activity-list">{pending.slice(0, 4).map(item => <div className="activity" key={`${item.kind}-${item.id}`}><span className={`activity-icon ${item.kind}`}>{item.kind === "receipts" ? "↓" : "↑"}</span><div><strong>{item.code}</strong><small>Phiếu {item.type.toLowerCase()} · {formatDate(item.created_at)}</small></div><span className="status pending">Chờ duyệt</span></div>)}</div> : <Empty text="Không có phiếu nào đang chờ duyệt." />}</div><div className="panel guide"><span>✦</span><h3>Xuất kho thông minh</h3><p>FEFO đang là chiến lược mặc định, giúp ưu tiên lô hàng gần hết hạn trước.</p><div><b>FEFO</b><b>FIFO</b><b>LIFO</b></div></div></section></>;
}

function Products({ products, canEdit, reload, notify, setError }) {
  const [showForm, setShowForm] = useState(false); const [form, setForm] = useState({ sku: "", name: "", unit: "cái", minimumStock: 0 });
  const submit = async e => { e.preventDefault(); try { const result = await api("/catalog/products", { method: "POST", body: JSON.stringify(form) }); notify(result.message); setShowForm(false); setForm({ sku: "", name: "", unit: "cái", minimumStock: 0 }); await reload(); } catch (err) { setError(err.message); } };
  return <section className="panel table-panel"><div className="panel-head"><div><h3>Danh mục sản phẩm</h3><p>{products.length} sản phẩm đang được theo dõi</p></div>{canEdit && <button className="primary" onClick={() => setShowForm(true)}>+ Thêm sản phẩm</button>}</div>{showForm && <form className="inline-form" onSubmit={submit}><input placeholder="Mã sản phẩm" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required/><input placeholder="Tên sản phẩm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required/><input placeholder="Đơn vị" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}/><input type="number" min="0" placeholder="Tồn tối thiểu" value={form.minimumStock} onChange={e => setForm({ ...form, minimumStock: e.target.value })}/><button className="primary">Lưu</button><button type="button" className="secondary" onClick={() => setShowForm(false)}>Hủy</button></form>}<div className="table-scroll"><table><thead><tr><th>Mã SP</th><th>Tên sản phẩm</th><th>Đơn vị</th><th>Tồn hiện có</th><th>Mức tối thiểu</th><th>Trạng thái</th></tr></thead><tbody>{products.map(p => <tr key={p.id}><td><code>{p.sku}</code></td><td><strong>{p.name}</strong></td><td>{p.unit}</td><td className="strong-number">{formatNumber(p.current_stock)}</td><td>{formatNumber(p.minimum_stock)}</td><td><span className="status approved">Đang quản lý</span></td></tr>)}</tbody></table></div></section>;
}

function Batches({ batches }) { return <section className="panel table-panel"><div className="panel-head"><div><h3>Tất cả lô hàng</h3><p>Danh sách được sắp theo hạn sử dụng gần nhất</p></div><span className="status approved">FEFO sẵn sàng</span></div><div className="table-scroll"><table><thead><tr><th>Mã lô</th><th>Sản phẩm</th><th>Vị trí</th><th>Hạn sử dụng</th><th>Ngày nhập</th><th>Số lượng</th></tr></thead><tbody>{batches.map(b => <tr key={b.id}><td><code>{b.batch_code}</code></td><td><strong>{b.product_name}</strong><small className="inline-small">{b.sku}</small></td><td><span className="location">⌘ {b.location}</span></td><td>{formatDate(b.expiry_date)}</td><td>{formatDate(b.received_at)}</td><td className="strong-number">{formatNumber(b.quantity)} {b.unit}</td></tr>)}</tbody></table></div></section>; }

function Documents({ type, documents, products, reload, notify, setError }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ partner: "", note: "", strategy: "FEFO", productId: products[0]?.id || "", quantity: 1, batchCode: "", expiryDate: "", location: "" });
  useEffect(() => { if (!form.productId && products[0]) setForm(value => ({ ...value, productId: products[0].id })); }, [products]);
  const isReceipt = type === "receipt";
  const submit = async e => {
    e.preventDefault();
    const item = { productId: Number(form.productId), quantity: Number(form.quantity) };
    if (isReceipt) Object.assign(item, { batchCode: form.batchCode, expiryDate: form.expiryDate, location: form.location });
    const payload = isReceipt ? { supplier: form.partner, note: form.note, items: [item] } : { requestedBy: form.partner, note: form.note, strategy: form.strategy, items: [item] };
    try { const result = await api(`/warehouse/${isReceipt ? "receipts" : "issues"}`, { method: "POST", body: JSON.stringify(payload) }); notify(result.message); setShowForm(false); await reload(); } catch (err) { setError(err.message); }
  };
  return <section className="panel table-panel"><div className="panel-head"><div><h3>{isReceipt ? "Danh sách phiếu nhập" : "Danh sách phiếu xuất"}</h3><p>{isReceipt ? "Hàng chỉ được cộng vào kho sau khi phê duyệt" : "Hàng chỉ được trừ khỏi kho sau khi phê duyệt"}</p></div><button className="primary" onClick={() => setShowForm(true)}>+ Tạo phiếu {isReceipt ? "nhập" : "xuất"}</button></div>{showForm && <form className="document-form" onSubmit={submit}><h3>{isReceipt ? "Tạo phiếu nhập kho" : "Tạo phiếu xuất kho"}</h3><div className="form-grid"><label>{isReceipt ? "Nhà cung cấp" : "Bộ phận yêu cầu"}<input value={form.partner} onChange={e => setForm({ ...form, partner: e.target.value })} required /></label><label>Sản phẩm<select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })}>{products.map(p => <option value={p.id} key={p.id}>{p.sku} — {p.name}</option>)}</select></label><label>Số lượng<input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required /></label>{!isReceipt && <label>Chiến lược xuất<select value={form.strategy} onChange={e => setForm({ ...form, strategy: e.target.value })}><option value="FEFO">FEFO — gần hết hạn trước</option><option value="FIFO">FIFO — nhập trước xuất trước</option><option value="LIFO">LIFO — nhập sau xuất trước</option></select></label>}{isReceipt && <><label>Mã lô<input value={form.batchCode} onChange={e => setForm({ ...form, batchCode: e.target.value })} required /></label><label>Hạn sử dụng<input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} required /></label><label>Vị trí kho<input placeholder="Ví dụ: A-01-01" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} required /></label></>}<label className="wide">Ghi chú<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label></div><div className="form-actions"><button className="primary">Gửi phê duyệt</button><button type="button" className="secondary" onClick={() => setShowForm(false)}>Hủy</button></div></form>}<div className="table-scroll"><table><thead><tr><th>Mã phiếu</th><th>{isReceipt ? "Nhà cung cấp" : "Bộ phận yêu cầu"}</th>{!isReceipt && <th>Chiến lược</th>}<th>Người lập</th><th>Ngày tạo</th><th>Dòng hàng</th><th>Trạng thái</th></tr></thead><tbody>{documents.map(d => <tr key={d.id}><td><code>{d.code}</code></td><td>{isReceipt ? d.supplier : d.requested_by}</td>{!isReceipt && <td><span className="strategy">{d.strategy}</span></td>}<td>{d.creator_name}</td><td>{formatDate(d.created_at)}</td><td>{d.item_lines}</td><td><span className={`status ${d.status.toLowerCase()}`}>{statusText(d.status)}</span></td></tr>)}</tbody></table>{!documents.length && <Empty text="Chưa có phiếu nào." />}</div></section>;
}

function Approvals({ items, isManager, onApproved }) { return <section className="panel table-panel"><div className="panel-head"><div><h3>Danh sách chờ phê duyệt</h3><p>{isManager ? "Phê duyệt sẽ cập nhật tồn kho ngay lập tức" : "Bạn có thể theo dõi, nhưng không có quyền phê duyệt"}</p></div><span className="pending-count">{items.length} phiếu</span></div>{items.length ? <div className="approval-list">{items.map(item => <article className="approval-card" key={`${item.kind}-${item.id}`}><div className={`approval-type ${item.kind}`}>{item.kind === "receipts" ? "↓" : "↑"}</div><div className="approval-content"><div><span className="status pending">{item.type === "Nhập" ? "PHIẾU NHẬP" : "PHIẾU XUẤT"}</span><h3>{item.code}</h3><p>Người lập: <strong>{item.creator_name}</strong> · {formatDate(item.created_at)} · {item.item_lines} dòng hàng</p></div>{isManager && <div className="approval-actions"><button className="secondary danger" onClick={() => onApproved(item.kind, item.id, "reject")}>Từ chối</button><button className="primary" onClick={() => onApproved(item.kind, item.id)}>Phê duyệt</button></div>}</div></article>)}</div> : <Empty text="Tất cả phiếu đã được xử lý." />}</section>; }
function Empty({ text }) { return <div className="empty"><span>□</span><p>{text}</p></div>; }

