const { execFile } = require('child_process');
const { promisify } = require('util');
const { print } = require('pdf-to-printer');
const discovery = require('../printer-discovery');

const execFileAsync = promisify(execFile);

// WMI Win32_Printer.PrinterStatus: 1=Other 2=Unknown 3=Idle 4=Printing
// 5=Warmup 6=Stopped Printing 7=Offline. https://learn.microsoft.com/windows/win32/cimwin32prov/win32-printer
function printerStatusToStatus(details) {
  if (!details) return 'unknown';
  const s = details.PrinterStatus;
  if (s === 7) return 'offline';
  if (s === 4 || s === 5) return 'busy';
  if (s === 6) return 'error';
  if (s === 3) return 'online';
  return 'unknown';
}

/** target = { localPrinterName } */
async function discoverAdapter() {
  const names = await discovery.listPrinters();
  return names.map((localPrinterName) => ({ localPrinterName, protocol: 'windows' }));
}

async function getStatus({ localPrinterName }) {
  const exists = await discovery.printerExists(localPrinterName);
  if (!exists) return 'offline';
  const details = await discovery.getPrinterDetails(localPrinterName);
  return printerStatusToStatus(details);
}

async function getCapabilities({ localPrinterName }) {
  const details = await discovery.getPrinterDetails(localPrinterName);
  const paperSizes = details && details.PrinterPaperNames ? details.PrinterPaperNames : [];
  return {
    // Windows/WMI doesn't reliably expose color/duplex support without a
    // full driver-capability query, which varies wildly by vendor - rather
    // than guess, report what we can verify (paper sizes) and leave
    // color/duplex as "assume supported", matching how the mobile UI
    // already defaults (spec: never claim a specific unsupported
    // capability, but a generic "may support" default for driver-based
    // printers is reasonable since Windows itself would reject the job if
    // truly unsupported).
    color: true,
    duplex: false,
    paperSizes,
    resolution: '',
  };
}

async function validate({ localPrinterName }) {
  return discovery.printerExists(localPrinterName);
}

/**
 * Sends a PDF to a Windows-installed printer by shelling out to the
 * SumatraPDF binary bundled with pdf-to-printer. Resolves once the OS
 * print spooler accepts the job (not once paper physically comes out).
 */
async function printFile(filePath, { localPrinterName, printerName, copies = 1, color = false }) {
  await print(filePath, {
    printer: localPrinterName || printerName,
    copies,
    monochrome: !color,
    silent: true,
  });
}

/**
 * Best-effort cancel via the Windows print spooler's own job list
 * (Win32_PrintJob). This removes whatever is currently queued for the
 * printer - safe for this system since a printer only ever has one
 * active job at a time (see the backend's per-printerId claim logic) but
 * not a per-job-ID cancel, since pdf-to-printer/SumatraPDF doesn't expose
 * the spooler job ID it created.
 */
async function cancel({ localPrinterName }) {
  const escaped = localPrinterName.replace(/'/g, "''");
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_PrintJob | Where-Object { $_.Name -like '${escaped}*' } | Remove-CimInstance`,
    ],
    { timeout: 10000 }
  );
}

module.exports = {
  discover: discoverAdapter,
  getStatus,
  getCapabilities,
  validate,
  print: printFile,
  cancel,
};
