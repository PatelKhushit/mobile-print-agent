import { useEffect, useRef, useState } from 'react';
import { createPrintJob, getAvailablePrinters, getSamplePdfUrl, uploadPdf } from '../api';
import JobStatus from './JobStatus';

export default function PrintTest() {
  const [printerId, setPrinterId] = useState('DEFAULT');
  const [printers, setPrinters] = useState([]);
  const [printersLoaded, setPrintersLoaded] = useState(false);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState(false);
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
        if (!cancelled) setPrinters(list);
      } catch {
        // Backend unreachable - keep the DEFAULT-only option available.
      } finally {
        if (!cancelled) setPrintersLoaded(true);
      }
    }
    loadPrinters();
    const timer = setInterval(loadPrinters, 10000);
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

  async function handleTestPrint() {
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
      const result = await createPrintJob({ fileUrl, copies, color, printerId });
      setJobId(result.jobId);
      setStatus('Waiting for PC...');
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
        <h1>MOBILE PRINT TEST</h1>
        <JobStatus jobId={jobId} onReset={reset} />
      </div>
    );
  }

  return (
    <div className="card">
      <h1>MOBILE PRINT TEST</h1>

      <label className="field">
        <span>Printer</span>
        <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
          <option value="DEFAULT">Any available printer (DEFAULT)</option>
          {printers.map((p) => (
            <option key={`${p.agentId}-${p.printerName}`} value={p.printerName}>
              {p.agentId} — {p.printerName}
            </option>
          ))}
        </select>
        {printersLoaded && printers.length === 0 && (
          <small>No printers currently online. Start a Local Print Agent, or use DEFAULT.</small>
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
        <select value={color ? 'color' : 'bw'} onChange={(e) => setColor(e.target.value === 'color')}>
          <option value="bw">B&amp;W</option>
          <option value="color">Color</option>
        </select>
      </label>

      <label className="field">
        <span>PDF</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {!file && <small>No file selected - a generated test PDF will be used.</small>}
      </label>

      <button className="primary-btn" onClick={handleTestPrint} disabled={busy}>
        {busy ? 'Sending...' : 'TEST PRINT'}
      </button>

      <div className="status-line">
        <span className="label">Status:</span> {status}
      </div>
    </div>
  );
}
