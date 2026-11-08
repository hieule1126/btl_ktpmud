import { useEffect, useState } from "react";
import { api } from "./api.js";
import { cleanText } from "./text.js";
import DocumentDetail from "./DocumentDetail.jsx";
import DocumentForm from "./DocumentForm.jsx";

function Icon({ name, ...props }) {
  const paths = {
    dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    products: "m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5",
    batches: "M3 4h18v16H3z M3 10h18 M9 4v6 M15 10v10",
    receipts: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
    issues: "M12 16V4 m-5 5 5-5 5 5 M4 16v5h16v-5",
    approvals: "M9 3h6v4H9z M9 5H5v16h14V5h-4 M8 14l3 3 5-6",
    arrow: "M5 12h14 m-5-5 5 5-5 5",
    alert: "m12 3 10 18H2L12 3Z M12 9v5 M12 17h.01",
    logout: "M9 4H4v16h5 M10 12h11 m-4-4 4 4-4 4"
  };
  return <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.products} /></svg>;
}

function Brand({ login = false }) {
  return <div className={login ? "login-logo brand" : "brand"} aria-label="KhoSmart">
    <img className="brand-mark" src="/khosmart.svg" alt="" width="40" height="40" />
    <span className="brand-name">Kho<span>Smart</span></span>
  </div>;
}

const pageMeta = {
  dashboard: ["Tổng quan kho", "Theo dõi tồn kho và phiếu xử lý hôm nay"],
  products: ["Sản phẩm", "Danh mục hàng hóa đang quản lý"],
  batches: ["Lô hàng", "Theo dõi vị trí, số lượng và hạn sử dụng"],
  receipts: ["Phiếu nhập", "Tạo và theo dõi các phiếu nhập kho"],
  issues: ["Phiếu xuất", "Xuất kho theo FEFO/FIFO/LIFO, điều chỉnh lô có ghi lý do"],
  approvals: ["Chờ phê duyệt", "Chỉ quản lý kho có quyền phê duyệt phiếu"]
};

function formatNumber(value) { return new Intl.NumberFormat("vi-VN").format(Number(value || 0)); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("vi-VN").format(new Date(value)) : "—"; }
function statusText(status) { return ({ PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối" })[status] || status; }

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("warehouse_user") || "null"));
  const [page, setPage] = useState("dashboard");
  const [selectedDocument, setSelectedDocument] = useState(null);
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
  const signOut = () => { localStorage.removeItem("warehouse_token"); localStorage.removeItem("warehouse_user"); setSelectedDocument(null); setSession(null); };
  const isManager = session?.role === "WAREHOUSE_MANAGER";
  if (!session) return <Login onLogin={setSession} />;

  const openDocument = (kind, id) => { setError(""); setSelectedDocument({ kind, id }); };
  const onDocumentDone = async message => {
    notify(message);
    await loadData();
    setSelectedDocument(null);
  };
  const pending = [...receipts.filter(x => x.status === "PENDING").map(x => ({ ...x, kind: "receipts", type: "Nhập" })), ...issues.filter(x => x.status === "PENDING").map(x => ({ ...x, kind: "issues", type: "Xuất" }))];

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav aria-label="Điều hướng chính">{Object.keys(pageMeta).map(key => <button key={key} title={pageMeta[key][0]} aria-current={page === key ? "page" : undefined} className={page === key ? "nav-item active" : "nav-item"} onClick={() => { setPage(key); setSelectedDocument(null); }}><Icon name={key} /><span className="nav-label">{key === "dashboard" ? "Tổng quan" : pageMeta[key][0]}</span>{key === "approvals" && pending.length > 0 && <b>{pending.length}</b>}</button>)}</nav>
      <div className="sidebar-foot"><div className="user-avatar">{session.name.slice(0, 1)}</div><div><strong>{session.name}</strong><small>{isManager ? "Quản lý kho" : "Nhân viên kho"}</small></div><button className="logout" title="Đăng xuất" aria-label="Đăng xuất" onClick={signOut}><Icon name="logout" /></button></div>
    </aside>
    <main className="main-content">
      <header><div><p className="eyebrow">KHOSMART / QUẢN LÝ KHO</p><h1>{pageMeta[page][0]}</h1><p className="subtitle">{pageMeta[page][1]}</p></div><div className="today">{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())}</div></header>
      {notice && <div className="toast success">✓ {notice}</div>}{error && <div className="toast error">! {error}</div>}
      {selectedDocument ? <DocumentDetail key={`${selectedDocument.kind}-${selectedDocument.id}`} {...selectedDocument} isManager={isManager} onBack={() => setSelectedDocument(null)} onDone={onDocumentDone} /> : <>
      {page === "dashboard" && <Dashboard data={dashboard} pending={pending} setPage={setPage} onOpen={openDocument} />}
      {page === "products" && <Products products={products} canEdit={isManager} reload={loadData} notify={notify} setError={setError} />}
      {page === "batches" && <Batches batches={batches} />}
      {page === "receipts" && <Documents type="receipt" documents={receipts} products={products} reload={loadData} notify={notify} setError={setError} onOpen={openDocument} />}
      {page === "issues" && <Documents type="issue" documents={issues} products={products} reload={loadData} notify={notify} setError={setError} onOpen={openDocument} />}
      {page === "approvals" && <Approvals items={pending} isManager={isManager} onOpen={openDocument} />}
      </>}
    </main>
  </div>;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("quanly@kho.local"); const [password, setPassword] = useState("123456"); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async e => { e.preventDefault(); setLoading(true); setError(""); try { const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); localStorage.setItem("warehouse_token", data.token); localStorage.setItem("warehouse_user", JSON.stringify(data.user)); onLogin(data.user); } catch (err) { setError(err.message); } finally { setLoading(false); } };
  return <div className="login-page"><div className="login-card"><Brand login /><p>Phần mềm quản lý kho hàng</p><h1>Chào mừng trở lại</h1><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Mật khẩu<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>{error && <div className="form-error">{error}</div>}<button className="primary full" disabled={loading}>{loading ? "Đang đăng nhập..." : "Đăng nhập"}</button></form><small>Tài khoản mẫu đã được điền sẵn.</small></div></div>;
}

function Dashboard({ data, pending, setPage, onOpen }) {
  const cards = [
    { label: "Sản phẩm", value: data?.summary.product_count, icon: "◫", color: "blue", trend: "Trong danh mục quản lý" },
    { label: "Lô hàng đang có", value: data?.summary.batch_count, icon: "▤", color: "orange", trend: "Ổn định" },
    { label: "Tổng đơn vị tồn", value: data?.summary.item_count, icon: "▦", color: "green", trend: "Số lượng tồn kho hiện tại" },
    { label: "Phiếu chờ duyệt", value: data?.summary.pending_count, icon: "✓", color: "purple", trend: "Cần xử lý ngay" }
  ];

  return (
    <>
      <section className="hero">
        <div>
          <span className="hero-badge">VẬN HÀNH ỔN ĐỊNH</span>
          <h2>Kho của bạn đang được<br/>kiểm soát tốt.</h2>
          <p>Theo dõi tập trung, xử lý chính xác và ra quyết định nhanh hơn mỗi ngày.</p>
          <button onClick={() => setPage("approvals")}>Xem phiếu cần xử lý <span>→</span></button>
        </div>
        <div className="hero-shape">
          <div className="box one"/>
          <div className="box two"/>
          <div className="box three"/>
          <span>▦</span>
        </div>
      </section>

      <section className="stats">
        {cards.map(card => (
          <article className="stat-card" key={card.label}>
            <div className={`stat-icon ${card.color}`}>{card.icon}</div>
            <p>{card.label}</p>
            <strong>{formatNumber(card.value)}</strong>
            <small className="stat-trend">{card.trend}</small>
          </article>
        ))}
      </section>

      <section className="pending-section">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Phiếu cần xử lý</h3>
              <p>Các chứng từ mới nhất đang chờ quyết định</p>
            </div>
            <button className="text-button" onClick={() => setPage("approvals")}>Xem tất cả</button>
          </div>
          {pending.length ? (
            <div className="activity-list">
              {pending.slice(0, 4).map(item => (
                <div className="activity" key={`${item.kind}-${item.id}`}>
                  <span className={`activity-icon ${item.kind}`}>{item.kind === "receipts" ? "↓" : "↑"}</span>
                  <div>
                    <button className="document-link" onClick={() => onOpen(item.kind, item.id)}>{item.code}</button>
                    <small>Phiếu {item.type.toLowerCase()} · {formatDate(item.created_at)}</small>
                  </div>
                  <span className="status pending">Chờ duyệt</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Không có phiếu nào đang chờ duyệt." />
          )}
        </div>

      </section>
    </>
  );
}

function Products({ products, canEdit, reload, notify, setError }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ sku: "", name: "", unit: "cái", minimumStock: 0 });

  const submit = async e => {
    e.preventDefault();
    try {
      const result = await api("/catalog/products", { method: "POST", body: JSON.stringify({ ...form, unit: cleanText(form.unit) }) });
      notify(result.message);
      setShowForm(false);
      setForm({ sku: "", name: "", unit: "cái", minimumStock: 0 });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <div>
          <h3>Danh mục sản phẩm</h3>
          <p>{products.length} sản phẩm đang được theo dõi</p>
        </div>
        {canEdit && <button className="primary" onClick={() => setShowForm(true)}>+ Thêm sản phẩm</button>}
      </div>

      {showForm && (
        <form className="inline-form" onSubmit={submit}>
          <input placeholder="Mã sản phẩm" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required/>
          <input placeholder="Tên sản phẩm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required/>
          <input aria-label="Đơn vị tính" placeholder="Đơn vị tính" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}/>
          <input type="number" min="0" placeholder="Tồn tối thiểu" value={form.minimumStock} onChange={e => setForm({ ...form, minimumStock: e.target.value })}/>
          <button className="primary">Lưu</button>
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>Hủy</button>
        </form>
      )}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mã SP</th>
              <th>Tên sản phẩm</th>
              <th>Đơn vị tính</th>
              <th>Tồn hiện có</th>
              <th>Mức tối thiểu</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              // Tự động kiểm tra nếu tồn kho <= mức tối thiểu thì báo "Sắp hết hàng"
              const isLow = Number(p.current_stock) <= Number(p.minimum_stock);
              return (
                <tr key={p.id}>
                  <td><code>{p.sku}</code></td>
                  <td><strong>{p.name}</strong></td>
                  <td>{cleanText(p.unit)}</td>
                  <td className="strong-number">{formatNumber(p.current_stock)}</td>
                  <td>{formatNumber(p.minimum_stock)}</td>
                  <td>
                    <span className={`status ${isLow ? "warning" : "approved"}`}>
                      {Number(p.current_stock) === 0 ? "Hết hàng" : isLow ? "Tồn kho thấp" : "Đủ hàng"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Batches({ batches }) { return <section className="panel table-panel"><div className="panel-head"><div><h3>Tất cả lô hàng</h3><p>Danh sách được sắp theo hạn sử dụng gần nhất</p></div><span className="count-label">{batches.length} lô hàng</span></div><div className="table-scroll"><table><thead><tr><th>Mã lô</th><th>Sản phẩm</th><th>Vị trí</th><th>Hạn sử dụng</th><th>Ngày nhập</th><th>Số lượng</th></tr></thead><tbody>{batches.map(b => <tr key={b.id}><td><code>{b.batch_code}</code></td><td><strong>{b.product_name}</strong><small className="inline-small">{b.sku}</small></td><td><span className="location">{b.location}</span></td><td>{formatDate(b.expiry_date)}</td><td>{formatDate(b.received_at)}</td><td className="strong-number">{formatNumber(b.quantity)} <span className="quantity-unit">{cleanText(b.unit)}</span></td></tr>)}</tbody></table></div></section>; }

function Documents({ type, documents, products, reload, notify, setError, onOpen }) {
  const [showForm, setShowForm] = useState(false);
  const isReceipt = type === "receipt";
  return <section className="panel table-panel"><div className="panel-head"><div><h3>{isReceipt ? "Danh sách phiếu nhập" : "Danh sách phiếu xuất"}</h3><p>{isReceipt ? "Hàng chỉ được cộng vào kho sau khi phê duyệt" : "Hàng chỉ được trừ khỏi kho sau khi phê duyệt"}</p></div><button className="primary" onClick={() => setShowForm(true)}>+ Tạo phiếu {isReceipt ? "nhập" : "xuất"}</button></div>{showForm && <DocumentForm isReceipt={isReceipt} products={products} onCancel={() => setShowForm(false)} onSaved={async result => {
    notify(result.message); setShowForm(false);
    try { await reload(); } catch (error) { setError(error.message); }
  }} />}<div className="table-scroll"><table><thead><tr><th>Mã phiếu</th><th>{isReceipt ? "Nhà cung cấp" : "Bộ phận yêu cầu"}</th>{!isReceipt && <th>Chính sách</th>}<th>Người lập</th><th>Ngày tạo</th><th>Dòng hàng</th><th>Trạng thái</th></tr></thead><tbody>{documents.map(d => <tr key={d.id}><td><button className="document-link" onClick={() => onOpen(isReceipt ? "receipts" : "issues", d.id)}>{d.code}</button></td><td>{isReceipt ? d.supplier : d.requested_by}</td>{!isReceipt && <td><span className="strategy">{d.strategy}</span></td>}<td>{d.creator_name}</td><td>{formatDate(d.created_at)}</td><td>{d.item_lines}</td><td><span className={`status ${d.status.toLowerCase()}`}>{statusText(d.status)}</span></td></tr>)}</tbody></table>{!documents.length && <Empty text="Chưa có phiếu nào." />}</div></section>;
}

function Approvals({ items, isManager, onOpen }) {
  return <section className="panel table-panel">
    <div className="panel-head"><div><h3>Danh sách chờ phê duyệt</h3><p>{isManager ? "Bấm mã phiếu để kiểm tra các dòng hàng trước khi duyệt hoặc từ chối" : "Bấm mã phiếu để xem chi tiết; chỉ quản lý kho có quyền phê duyệt"}</p></div><span className="pending-count">{items.length} phiếu</span></div>
    {items.length ? <div className="approval-list">{items.map(item => <article className="approval-card" key={`${item.kind}-${item.id}`}>
      <div className={`approval-type ${item.kind}`}>{item.kind === "receipts" ? "↓" : "↑"}</div>
      <div className="approval-content"><div>
        <span className="status pending">{item.kind === "receipts" ? "PHIẾU NHẬP" : "PHIẾU XUẤT"}</span>
        <h3><button className="document-link" onClick={() => onOpen(item.kind, item.id)}>{item.code}</button></h3>
        <p>Người lập: <strong>{item.creator_name}</strong> · {formatDate(item.created_at)} · {item.item_lines} dòng hàng</p>
      </div><button className="secondary" onClick={() => onOpen(item.kind, item.id)}>Xem chi tiết</button></div>
    </article>)}</div> : <Empty text="Tất cả phiếu đã được xử lý." />}
  </section>;
}
function Empty({ text }) { return <div className="empty"><span>□</span><p>{text}</p></div>; }

