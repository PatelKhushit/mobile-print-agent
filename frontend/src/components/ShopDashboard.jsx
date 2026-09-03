import { useEffect, useState } from 'react';
import {
  adminTestPrint,
  generateAgentPairingCode,
  getMyShop,
  getMyShopAgents,
  getMyShopJobs,
  getMyShopPrinters,
} from '../api';
import SetupWizard from './SetupWizard';

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
  const [agents, setAgents] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [pairing, setPairing] = useState(null); // { pairingCode, expiresAt }
  const [pairingBusy, setPairingBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [showWizard, setShowWizard] = useState(false);

  async function load() {
    try {
      const [me, printerList, agentList, jobList] = await Promise.all([
        getMyShop(),
        getMyShopPrinters(),
        getMyShopAgents(),
        getMyShopJobs(30),
      ]);
      setShop(me.shop);
      setQrDataUrl(me.qrDataUrl);
      setPrinters(printerList);
      setAgents(agentList);
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

  useEffect(() => {
    if (!pairing) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setPairing(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  async function handleGeneratePairingCode() {
    setPairingBusy(true);
    setMsg('');
    try {
      const result = await generateAgentPairingCode();
      setPairing({ pairingCode: result.pairingCode, expiresAt: result.expiresAt });
    } catch (err) {
      setMsg(err.response?.data?.error || 'Could not generate a pairing code.');
    } finally {
      setPairingBusy(false);
    }
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

  const setupIncomplete = agents.length === 0 || printers.length === 0;

  return (
    <div className="card admin-card">
      <h1>{shop.shopName.toUpperCase()}</h1>
      <div className="hint">Shop ID: {shop.shopId}</div>

      {setupIncomplete || showWizard ? (
        <>
          <h1>SETUP</h1>
          <SetupWizard
            agents={agents}
            printers={printers}
            qrDataUrl={qrDataUrl}
            shopId={shop.shopId}
            pairing={pairing}
            pairingBusy={pairingBusy}
            secondsLeft={secondsLeft}
            onGeneratePairingCode={handleGeneratePairingCode}
            onTestPrint={handleTestPrint}
            testPrintMsg={msg}
          />
          {!setupIncomplete && (
            <button className="link-btn" onClick={() => setShowWizard(false)}>
              Hide setup guide
            </button>
          )}
        </>
      ) : (
        <>
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
            <span>Print Agent{agents.length > 1 ? 's' : ''}</span>
            <ul className="agent-list">
              {agents.map((a) => (
                <li key={a.agentId}>
                  {a.status === 'online' ? '🟢 Online' : '🔴 Offline'} ({a.agentId})
                </li>
              ))}
            </ul>

            {pairing ? (
              <div className="pairing-code-box">
                <div className="pairing-code">{pairing.pairingCode}</div>
                <small>
                  Enter this code in the Print Agent when it asks for a pairing code. Expires in{' '}
                  {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}.
                </small>
              </div>
            ) : (
              <button className="link-btn" onClick={handleGeneratePairingCode} disabled={pairingBusy}>
                {pairingBusy ? 'Generating...' : '+ Connect another Print Agent'}
              </button>
            )}
            <button className="link-btn" onClick={() => setShowWizard(true)}>
              Show setup guide
            </button>
          </div>
        </>
      )}

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
