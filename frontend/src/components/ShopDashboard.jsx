import { useEffect, useState } from 'react';
import { adminTestPrint, getMyShop, getMyShopAgent, getMyShopJobs, getMyShopPrinters } from '../api';

const PRINTER_STATUS_LABEL = {
  online: '🟢 Online',
  unavailable: '🟠 Unavailable',
  offline: '🔴 Offline',
  disabled: '⚪ Disabled',
};

const RESULT_LABEL = {
  completed: '✓ Completed',
  failed: '✕ Failed',
  cancelled: '⊘ Cancelled',
  queued: 'Queued',
  assigned: 'Assigned',
  downloading: 'Downloading',
  printing: 'Printing',
};

/**
 * The shopkeeper's whole job, day to day, is "hand over the pages" (spec
 * section 42) - this dashboard is the one-time setup + occasional check-in
 * screen: the QR to put outside the shop, whether the Print Agent + its
 * printers are actually online, and recent print activity.
 */
export default function ShopDashboard({ onBack }) {
  const [shop, setShop] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [agent, setAgent] = useState(null);
  const [printers, setPrinters] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const [me, printerList, agentInfo, jobList] = await Promise.all([
        getMyShop(),
        getMyShopPrinters(),
        getMyShopAgent(),
        getMyShopJobs(30),
      ]);
      setShop(me.shop);
      setQrDataUrl(me.qrDataUrl);
      setPrinters(printerList);
      setAgent(agentInfo);
      setJobs(jobList);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to load shop dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  async function handleTestPrint(printer) {
    setMsg(`Sending test print to ${printer.name}...`);
    try {
      const result = await adminTestPrint(printer.printerId);
      setMsg(`Test print job ${result.jobId} created.`);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Test print failed.');
    }
  }

  if (loading) {
    return (
      <div className="card admin-card">
        <h1>MY SHOP</h1>
        <div className="hint">Loading...</div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="card admin-card">
        <h1>MY SHOP</h1>
        <div className="hint error">{msg || 'Shop not found.'}</div>
        <button className="link-btn" onClick={onBack}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="card admin-card">
      <h1>{shop.shopName.toUpperCase()}</h1>
      <div className="hint">Shop ID: {shop.shopId}</div>

      <div className="field">
        <span>Shop QR - place this outside your shop</span>
        {qrDataUrl && <img src={qrDataUrl} alt="Shop QR code" style={{ width: 200, height: 200, marginTop: 8 }} />}
        <div className="footer-links">
          {qrDataUrl && (
            <a className="link-btn" href={qrDataUrl} download={`${shop.shopId}-qr.png`}>
              Download QR
            </a>
          )}
        </div>
      </div>

      <div className="field">
        <span>Print Agent</span>
        <div>
          {agent ? (
            <>
              {agent.status === 'online' ? '🟢 Online' : '🔴 Offline'} ({agent.agentId})
            </>
          ) : (
            '⚪ Not paired yet - add SHOP_ID to the Print Agent .env on your shop PC'
          )}
        </div>
      </div>

      <h1>MY PRINTERS</h1>
      {printers.length === 0 ? (
        <div className="hint">No printers yet - once your Print Agent is paired and running, printers appear here automatically.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Printer</th>
                <th>Connection</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {printers.map((p) => (
                <tr key={p.printerId}>
                  <td>{p.name}</td>
                  <td>{p.protocol === 'ipp' || p.protocol === 'ipps' ? 'Wi-Fi / Network' : 'USB / Driver'}</td>
                  <td>{PRINTER_STATUS_LABEL[p.status] || p.status}</td>
                  <td className="admin-actions">
                    <button onClick={() => handleTestPrint(p)}>Test Print</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && <div className="hint">{msg}</div>}

      <h1>PRINT HISTORY</h1>
      {jobs.length === 0 ? (
        <div className="hint">No print jobs yet.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Printer</th>
                <th>Copies</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.jobId}>
                  <td>{new Date(j.createdAt).toLocaleString()}</td>
                  <td>{j.printerId}</td>
                  <td>{j.copies}</td>
                  <td title={j.error || ''}>{RESULT_LABEL[j.status] || j.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button className="link-btn" onClick={onBack}>
        Sign out
      </button>
    </div>
  );
}
