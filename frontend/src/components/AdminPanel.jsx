import { useEffect, useState } from 'react';
import { adminDeletePrinter, adminListPrinters, adminTestPrint, adminUpdatePrinter } from '../api';

const STATUS_LABEL = {
  online: '🟢 Online',
  unavailable: '🟠 Unavailable',
  offline: '🔴 Offline',
  disabled: '⚪ Disabled',
};

export default function AdminPanel({ onBack }) {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      setPrinters(await adminListPrinters());
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to load printers.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

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

      <button className="link-btn" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}
