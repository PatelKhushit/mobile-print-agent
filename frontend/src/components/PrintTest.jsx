import { useEffect, useRef, useState } from 'react';
import { createPrintJob, getAvailablePrinters, getSamplePdfUrl, uploadPdf } from '../api';
import JobStatus from './JobStatus';

const STATUS_LABEL = {
  online: '🟢 Online',
  unavailable: '🟠 Printer Unavailable',
  offline: '🔴 Offline',
};

export default function PrintTest({ onLogout, isAdmin, onOpenAdmin, onOpenSettings, onOpenCompatibility }) {
  const [printerId, setPrinterId] = useState('');
  const [printers, setPrinters] = useState([]);
  const [printersLoaded, setPrintersLoaded] = useState(false);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState(false);
  const [paperSize, setPaperSize] = useState('');
  const [duplex, setDuplex] = useState(false);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('Waiting...');
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPrinters() {
      try {
        const list = await getAvailablePrinters();
        if (cancelled) return;
        setPrinters(list);
        setPrinterId((current) => {
          if (current && list.some((p) => p.printerId === current)) return current;
          const firstOnline = list.find((p) => p.status === 'online');
          return firstOnline ? firstOnline.printerId : current;
        });
      } catch {
        // Backend unreachable - leave the list as-is, user can retry.
      } finally {
        if (!cancelled) setPrintersLoaded(true);
      }
    }
    loadPrinters();
    const timer = setInterval(loadPrinters, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  function reset() {
    setJobId(null);
    setStatus('Waiting...');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const selectedPrinter = printers.find((p) => p.printerId === printerId);
  const onlinePrinters = printers.filter((p) => p.status === 'online');
  const otherPrinters = printers.filter((p) => p.status !== 'online');
  const caps = selectedPrinter?.capabilities || {};
  const supportsColor = !!caps.color;
  const supportsDuplex = !!caps.duplex;
  const paperSizes = Array.isArray(caps.paperSizes) && caps.paperSizes.length ? caps.paperSizes : null;

  // Never offer an option the printer hasn't actually reported supporting -
  // reset selections whenever the chosen printer (or its known capabilities) changes.
  useEffect(() => {
    if (!supportsColor && color) setColor(false);
    if (!supportsDuplex && duplex) setDuplex(false);
    if (paperSizes && !paperSizes.includes(paperSize)) setPaperSize(paperSizes[0]);
    if (!paperSizes && paperSize) setPaperSize('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerId, caps.color, caps.duplex, paperSizes && paperSizes.join('|')]);

  async function handleTestPrint() {
    if (!printerId) {
      setStatus('Select a printer first.');
      return;
    }
    setBusy(true);
    setStatus('Waiting...');
    try {
      let fileUrl;
      if (file) {
        setStatus('Uploading PDF...');
        const result = await uploadPdf(file);
        fileUrl = result.fileUrl;
      } else {
        setStatus('Preparing test PDF...');
        fileUrl = await getSamplePdfUrl();
      }

      setStatus('Creating print job...');
      const result = await createPrintJob({
        printerId,
        fileUrl,
        copies,
        color: supportsColor && color,
        paperSize: paperSizes ? paperSize : undefined,
        duplex: supportsDuplex && duplex,
      });
      setJobId(result.jobId);
      setStatus('Waiting for print agent...');
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Something went wrong.';
      setStatus(`Error: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  if (jobId) {
    return (
      <div className="card">
        <h1>REMOTE PRINT</h1>
        <JobStatus jobId={jobId} onReset={reset} />
      </div>
    );
  }

  return (
    <div className="card">
      <h1>REMOTE PRINT</h1>

      <label className="field">
        <span>Printer</span>
        <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
          <option value="">Select a printer...</option>
          {onlinePrinters.length > 0 && (
            <optgroup label="Available">
              {onlinePrinters.map((p) => (
                <option key={p.printerId} value={p.printerId}>
                  {p.name} {p.location ? `(${p.location})` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {otherPrinters.length > 0 && (
            <optgroup label="Unavailable">
              {otherPrinters.map((p) => (
                <option key={p.printerId} value={p.printerId}>
                  {p.name} {p.location ? `(${p.location})` : ''} — {p.status}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {printersLoaded && printers.length === 0 && (
          <small>No printers registered yet. Start a Print Agent to register one.</small>
        )}
        {selectedPrinter && (
          <small>
            {STATUS_LABEL[selectedPrinter.status] || selectedPrinter.status}
            {' · '}
            {selectedPrinter.brand && selectedPrinter.brand !== 'Unknown' ? `${selectedPrinter.brand} · ` : ''}
            {selectedPrinter.protocol === 'ipp' || selectedPrinter.protocol === 'ipps'
              ? `Network (${selectedPrinter.protocol.toUpperCase()})`
              : 'Driver-connected'}
          </small>
        )}
      </label>

      <label className="field">
        <span>Copies</span>
        <div className="stepper">
          <button type="button" onClick={() => setCopies((c) => Math.max(1, c - 1))}>
            −
          </button>
          <span className="stepper-value">{copies}</span>
          <button type="button" onClick={() => setCopies((c) => Math.min(50, c + 1))}>
            +
          </button>
        </div>
      </label>

      <label className="field">
        <span>Color</span>
        <select
          value={color ? 'color' : 'bw'}
          onChange={(e) => setColor(e.target.value === 'color')}
          disabled={!selectedPrinter || !supportsColor}
        >
          <option value="bw">B&amp;W</option>
          <option value="color">Color</option>
        </select>
        {selectedPrinter && !supportsColor && <small>This printer only reports black &amp; white support.</small>}
      </label>

      {paperSizes && (
        <label className="field">
          <span>Paper Size</span>
          <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
            {paperSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}

      {supportsDuplex && (
        <label className="field">
          <span>Duplex (double-sided)</span>
          <select value={duplex ? 'duplex' : 'simplex'} onChange={(e) => setDuplex(e.target.value === 'duplex')}>
            <option value="simplex">Single-sided</option>
            <option value="duplex">Double-sided</option>
          </select>
        </label>
      )}

      <label className="field">
        <span>Document</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {!file && <small>No file selected - a generated test PDF will be used.</small>}
      </label>

      <button
        className="primary-btn"
        onClick={handleTestPrint}
        disabled={busy || !printerId || selectedPrinter?.status !== 'online'}
      >
        {busy ? 'Sending...' : 'PRINT'}
      </button>

      <div className="status-line">
        <span className="label">Status:</span> {status}
      </div>

      <div className="footer-links">
        {isAdmin && (
          <button className="link-btn" onClick={onOpenAdmin}>
            Manage Printers
          </button>
        )}
        <button className="link-btn" onClick={onOpenSettings}>
          Settings
        </button>
        <button className="link-btn" onClick={onOpenCompatibility}>
          Printer Compatibility
        </button>
        <button className="link-btn" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
