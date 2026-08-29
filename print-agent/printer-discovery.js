const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Lists installed Windows printers.
 *
 * We deliberately do NOT use pdf-to-printer's own getPrinters()/
 * getDefaultPrinter(): that library parses PowerShell's default text
 * formatting of Win32_Printer, which line-wraps once a printer reports a
 * long PrinterPaperNames list (common for thermal POS printer drivers) and
 * throws. Asking PowerShell for JSON instead sidesteps that entirely.
 */
async function runPowerShellJson(command) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    timeout: 10000,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

async function listPrinters() {
  const result = await runPowerShellJson(
    'Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'
  );
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

async function defaultPrinterName() {
  try {
    const result = await runPowerShellJson(
      'Get-CimInstance Win32_Printer -Filter "Default=true" | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'
    );
    if (!result) return null;
    return Array.isArray(result) ? result[0] : result;
  } catch {
    return null;
  }
}

async function printerExists(printerName) {
  if (!printerName) return false;
  const printers = await listPrinters();
  return printers.includes(printerName);
}

/**
 * Real per-printer detail from Win32_Printer: driver name (used to guess
 * brand), the printer's own advertised paper sizes, and Windows's own
 * offline/status flags. Note WorkOffline/PrinterStatus reflect what
 * Windows *thinks*, not necessarily physical reality - SumatraPDF (what
 * printer-service.js actually uses to print) talks to the driver directly
 * and has printed successfully here even while WorkOffline was true, so
 * these are surfaced as diagnostic info, not used to block printing.
 */
async function getPrinterDetails(printerName) {
  const escaped = printerName.replace(/'/g, "''");
  const result = await runPowerShellJson(
    `Get-CimInstance Win32_Printer -Filter "Name='${escaped}'" | ` +
      'Select-Object DriverName,WorkOffline,PrinterStatus,PrinterPaperNames | ConvertTo-Json -Compress'
  );
  if (!result) return null;
  return Array.isArray(result) ? result[0] : result;
}

/** Deterministic, stable printerId derived from agent + local printer name -
 * same value every run, so registered printers and existing print jobs
 * referencing them stay valid across agent restarts. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function printerIdFor(agentId, localPrinterName) {
  return `${slugify(agentId)}-${slugify(localPrinterName)}`;
}

module.exports = { listPrinters, defaultPrinterName, printerExists, printerIdFor, getPrinterDetails };
