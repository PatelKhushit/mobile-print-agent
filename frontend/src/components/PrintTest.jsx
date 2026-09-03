import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPrintJob, getAvailablePrinters, getSamplePdfUrl, uploadPdf } from '../api';
import JobStatus from './JobStatus';

// Lazy: pdfjs-dist is a large dependency (~750KB + a 1.2MB worker) that most
// visits to this mobile-first page never need (browsing printers, logging
// in, checking a job's status) - only fetched once a document is actually
// uploaded and there's something to preview.
const PdfPreview = lazy(() => import('./PdfPreview'));

const STATUS_LABEL = {
  online: '🟢 Online',
  unavailable: '🟠 Printer Unavailable',
  offline: '🔴 Offline',
};

/**
 * Doubles as both the legacy personal-use print form (default props - a
 * logged-in user, any standalone printer, an auto-generated sample PDF if
 * they skip picking a file) and the shop QR customer print page (injected
 * shop-scoped fetch/upload/submit functions, a real file required - spec
 * section 32/83). Sharing one component keeps the actual print flow - the
 * part that must never behave differently for the two audiences - in
 * exactly one place.
 *
 * Flow mirrors spec section 1: upload happens as soon as a file is picked
 * (so the customer sees a preview/page count right away, not after
 * clicking Print), then printer + options, then a final review screen
 * before anything is actually queued (spec section 17).
 */
export default function PrintTest({
  onLogout,
  isAdmin,
  onOpenAdmin,
  onOpenSettings,
  onOpenCompatibility,
  title = 'REMOTE PRINT',
  subtitle = null,
  fetchPrinters = getAvailablePrinters,
  uploadFile = uploadPdf,
  submitJob = createPrintJob,
  allowSamplePdf = true,
  showFooterLinks = true,
}) {
  const [printerId, setPrinterId] = useState('');
  const [printers, setPrinters] = useState([]);
  const [printersLoaded, setPrintersLoaded] = useState(false);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState(false);
  const [paperSize, setPaperSize] = useState('');
  const [orientation, setOrientation] = useState('portrait');
  const [duplex, setDuplex] = useState(false);

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState(null); // { fileUrl, fileName, fileSize, pageCount }
  const [uploadError, setUploadError] = useState('');

  const [step, setStep] = useState('select'); // 'select' | 'summary'
  const [status, setStatus] = useState('Waiting...');
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPrinters() {
      try {
        const list = await fetchPrinters();
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
    setStep('select');
    clearFile();
  }

  function clearFile() {
    setFile(null);
    setUploadedDoc(null);
    setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFileChange(e) {
    const picked = e.target.files?.[0] || null;
    setFile(picked);
    setUploadedDoc(null);
    setUploadError('');
    if (!picked) return;

    setUploading(true);
    try {
      const result = await uploadFile(picked);
      setUploadedDoc(result);
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Upload failed. Please try again.');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setUploading(false);
    }
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

  function goToSummary() {
    if (!printerId) {
      setStatus('Select a printer first.');
      return;
    }
    if (!uploadedDoc && !allowSamplePdf) {
      setStatus('Select a document to print.');
      return;
    }
    setStatus('Waiting...');
    setStep('summary');
  }

  async function handleConfirmPrint() {
    setBusy(true);
    try {
      let fileUrl = uploadedDoc?.fileUrl;
      if (!fileUrl) {
        setStatus('Preparing test PDF...');
        fileUrl = await getSamplePdfUrl();
      }

      setStatus('Creating print job...');
      const result = await submitJob({
        printerId,
        fileUrl,
        copies,
        color: supportsColor && color,
        paperSize: paperSizes ? paperSize : undefined,
        orientation,
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
        <h1>{title}</h1>
        {subtitle && <div className="hint">{subtitle}</div>}
        <JobStatus jobId={jobId} onReset={reset} />
      </div>
    );
  }

  if (step === 'summary') {
    const docLabel = uploadedDoc ? uploadedDoc.fileName : 'Sample test page';
    return (
      <div className="card">
        <h1>{title}</h1>
        {subtitle && <div className="hint">{subtitle}</div>}

        <div className="summary-card">
          <div className="summary-row">
            <span>Document</span>
            <strong>{docLabel}</strong>
          </div>
          {uploadedDoc?.pageCount && (
            <div className="summary-row">
              <span>Pages</span>
              <strong>{uploadedDoc.pageCount}</strong>
            </div>
          )}
          <div className="summary-row">
            <span>Printer</span>
            <strong>{selectedPrinter?.name || printerId}</strong>
          </div>
          <div className="summary-row">
            <span>Color</span>
            <strong>{supportsColor && color ? 'Color' : 'Black & White'}</strong>
          </div>
          {paperSizes && (
            <div className="summary-row">
              <span>Paper</span>
              <strong>{paperSize}</strong>
            </div>
          )}
          <div className="summary-row">
            <span>Copies</span>
            <strong>{copies}</strong>
          </div>
          <div className="summary-row">
            <span>Orientation</span>
            <strong>{orientation === 'landscape' ? 'Landscape' : 'Portrait'}</strong>
          </div>
          {supportsDuplex && (
            <div className="summary-row">
              <span>Duplex</span>
              <strong>{duplex ? 'Double-sided' : 'Single-sided'}</strong>
            </div>
          )}
        </div>

        <button className="primary-btn" onClick={handleConfirmPrint} disabled={busy}>
          {busy ? 'Sending...' : 'PRINT NOW'}
        </button>
        <button className="link-btn" onClick={() => setStep('select')} disabled={busy}>
          ← Edit options
        </button>

        {status && status !== 'Waiting...' && <div className="status-line">{status}</div>}
      </div>
    );
  }

  return (
    <div className="card">
      <h1>{title}</h1>
      {subtitle && <div className="hint">{subtitle}</div>}

      <label className="field">
        <span>Document</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={handleFileChange}
          disabled={uploading}
        />
        {uploading && <small>Uploading...</small>}
        {!uploading && uploadError && <small className="field-error">{uploadError}</small>}
        {!uploading && !uploadError && file && uploadedDoc && (
          <div className="uploaded-file">
            <small>
              {uploadedDoc.fileName} ({(uploadedDoc.fileSize / 1024 / 1024).toFixed(2)} MB
              {uploadedDoc.pageCount ? `, ${uploadedDoc.pageCount} page${uploadedDoc.pageCount === 1 ? '' : 's'}` : ''})
            </small>
            <button type="button" className="link-btn" onClick={clearFile}>
              Remove
            </button>
          </div>
        )}
        {!uploading && !file && (
          <small>
            {allowSamplePdf
              ? 'No file selected - a generated test PDF will be used.'
              : 'Select the PDF, JPG, or PNG you want printed.'}
          </small>
        )}
      </label>

      {uploadedDoc && (
        <Suspense fallback={null}>
          <PdfPreview fileUrl={uploadedDoc.fileUrl} pageCount={uploadedDoc.pageCount} />
        </Suspense>
      )}

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

      <label className="field">
        <span>Orientation</span>
        <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </label>

      {supportsDuplex && (
        <label className="field">
          <span>Duplex (double-sided)</span>
          <select value={duplex ? 'duplex' : 'simplex'} onChange={(e) => setDuplex(e.target.value === 'duplex')}>
            <option value="simplex">Single-sided</option>
            <option value="duplex">Double-sided</option>
          </select>
        </label>
      )}

      <button
        className="primary-btn"
        onClick={goToSummary}
        disabled={busy || uploading || !printerId || selectedPrinter?.status !== 'online' || (!uploadedDoc && !allowSamplePdf)}
      >
        Review &amp; Print
      </button>

      <div className="status-line">
        <span className="label">Status:</span> {status}
      </div>

      {showFooterLinks && (
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
      )}
    </div>
  );
}
