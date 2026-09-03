import { useEffect, useState } from 'react';
import {
  adminCreateShop,
  adminDeletePrinter,
  adminListPrinters,
  adminListShops,
  adminRegenerateShopQr,
  adminTestPrint,
  adminUpdatePrinter,
  adminUpdateShop,
  getAuditLog,
} from '../api';

const STATUS_LABEL = {
  online: '🟢 Online',
  unavailable: '🟠 Unavailable',
  offline: '🔴 Offline',
  disabled: '⚪ Disabled',
};

const RESULT_LABEL = {
  completed: '✓ Completed',
  failed: '✕ Failed',
  cancelled: '⊘ Cancelled',
};

export default function AdminPanel({ onBack }) {
  const [tab, setTab] = useState('printers'); // 'printers' | 'shops'
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [showAudit, setShowAudit] = useState(false);

  async function load() {
    try {
      setPrinters(await adminListPrinters());
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to load printers.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAuditLog() {
    try {
      setAuditLog(await getAuditLog(100));
    } catch {
      // Non-critical panel - printer table above still works if this fails.
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showAudit) return undefined;
    loadAuditLog();
    const timer = setInterval(loadAuditLog, 10000);
    return () => clearInterval(timer);
  }, [showAudit]);

  async function handleRename(printer) {
    const name = window.prompt('New name for this printer:', printer.name);
    if (!name || name === printer.name) return;
    await adminUpdatePrinter(printer.printerId, { name });
    load();
  }

  async function handleToggleDisabled(printer) {
    const disabled = printer.status !== 'disabled';
    await adminUpdatePrinter(printer.printerId, { disabled });
    load();
  }

  async function handleDelete(printer) {
    if (!window.confirm(`Delete "${printer.name}"? This cannot be undone.`)) return;
    await adminDeletePrinter(printer.printerId);
    load();
  }

  async function handleTestPrint(printer) {
    setMsg(`Sending test print to ${printer.name}...`);
    try {
      const result = await adminTestPrint(printer.printerId);
      setMsg(`Test print job ${result.jobId} created.`);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Test print failed.');
    }
  }

  return (
    <div className="card admin-card">
      <div className="footer-links">
        <button className={tab === 'printers' ? 'primary-btn' : 'link-btn'} onClick={() => setTab('printers')}>
          Printers
        </button>
        <button className={tab === 'shops' ? 'primary-btn' : 'link-btn'} onClick={() => setTab('shops')}>
          Shops
        </button>
      </div>

      {tab === 'shops' ? (
        <ShopsTab />
      ) : (
        <>
      <h1>PRINTERS</h1>

      {loading ? (
        <div className="hint">Loading...</div>
      ) : printers.length === 0 ? (
        <div className="hint">No printers registered yet.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Printer</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {printers.map((p) => (
                <tr key={p.printerId}>
                  <td>
                    {p.name}
                    {p.location ? <small className="printer-location"> · {p.location}</small> : null}
                  </td>
                  <td>{p.agentId}</td>
                  <td>{STATUS_LABEL[p.status] || p.status}</td>
                  <td className="admin-actions">
                    <button onClick={() => handleRename(p)}>Rename</button>
                    <button onClick={() => handleTestPrint(p)}>Test Print</button>
                    <button onClick={() => handleToggleDisabled(p)}>
                      {p.status === 'disabled' ? 'Enable' : 'Disable'}
                    </button>
                    <button onClick={() => handleDelete(p)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && <div className="hint">{msg}</div>}

      <button className="link-btn" onClick={() => setShowAudit((v) => !v)}>
        {showAudit ? 'Hide audit log' : 'Show audit log'}
      </button>

      {showAudit && (
        <>
          {auditLoading ? (
            <div className="hint">Loading audit log...</div>
          ) : auditLog.length === 0 ? (
            <div className="hint">No print activity recorded yet.</div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Printer</th>
                    <th>Copies</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry) => (
                    <tr key={entry._id}>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td>{entry.userEmail || '—'}</td>
                      <td>{entry.printerName || entry.printerId}</td>
                      <td>{entry.copies}</td>
                      <td title={entry.error || ''}>{RESULT_LABEL[entry.status] || entry.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
        </>
      )}

      <button className="link-btn" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}

function ShopsTab() {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [qrPreview, setQrPreview] = useState(null); // { shopId, qrDataUrl }
  const [form, setForm] = useState({
    shopName: '',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    ownerEmail: '',
    ownerPassword: '',
  });

  async function load() {
    try {
      setShops(await adminListShops());
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to load shops.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await adminCreateShop(form);
      setForm({ shopName: '', ownerName: '', phone: '', email: '', address: '', ownerEmail: '', ownerPassword: '' });
      setShowCreate(false);
      setMsg('Shop created.');
      load();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to create shop.');
    }
  }

  async function handleToggleStatus(shop) {
    const status = shop.status === 'active' ? 'suspended' : 'active';
    await adminUpdateShop(shop.shopId, { status });
    load();
  }

  async function handleRegenerateQr(shop) {
    if (!window.confirm(`Regenerate the QR code for "${shop.shopName}"? The old printed QR will stop working.`)) return;
    const result = await adminRegenerateShopQr(shop.shopId);
    setQrPreview({ shopId: shop.shopId, qrDataUrl: result.qrDataUrl });
  }

  return (
    <>
      <h1>SHOPS</h1>

      {loading ? (
        <div className="hint">Loading...</div>
      ) : shops.length === 0 ? (
        <div className="hint">No shops yet.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Status</th>
                <th>Agents</th>
                <th>Printers</th>
                <th>Jobs Today</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((s) => (
                <tr key={s.shopId}>
                  <td>
                    {s.shopName}
                    <small className="printer-location"> · {s.shopId}</small>
                  </td>
                  <td>{s.status === 'active' ? '🟢 Active' : '⚪ Suspended'}</td>
                  <td>{s.agents.total === 0 ? '— Not paired' : `${s.agents.online}/${s.agents.total} online`}</td>
                  <td>
                    {s.printers.online}/{s.printers.total} online
                  </td>
                  <td>
                    {s.jobsToday.total} ({s.jobsToday.completed} ok, {s.jobsToday.failed} failed)
                  </td>
                  <td className="admin-actions">
                    <button onClick={() => handleToggleStatus(s)}>
                      {s.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                    <button onClick={() => handleRegenerateQr(s)}>Regenerate QR</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {qrPreview && (
        <div className="field">
          <span>New QR for {qrPreview.shopId}</span>
          <img src={qrPreview.qrDataUrl} alt="Regenerated QR" style={{ width: 180, height: 180 }} />
          <button className="link-btn" onClick={() => setQrPreview(null)}>
            Dismiss
          </button>
        </div>
      )}

      {msg && <div className="hint">{msg}</div>}

      <button className="link-btn" onClick={() => setShowCreate((v) => !v)}>
        {showCreate ? 'Cancel' : '+ New Shop'}
      </button>

      {showCreate && (
        <form onSubmit={handleCreate}>
          <label className="field">
            <span>Shop Name</span>
            <input value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} required />
          </label>
          <label className="field">
            <span>Owner Name</span>
            <input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="field">
            <span>Address</span>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <label className="field">
            <span>Owner Login Email</span>
            <input
              type="email"
              value={form.ownerEmail}
              onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Owner Login Password</span>
            <input
              type="password"
              minLength={8}
              value={form.ownerPassword}
              onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
              required
            />
          </label>
          <button className="primary-btn" type="submit">
            Create Shop
          </button>
        </form>
      )}
    </>
  );
}
