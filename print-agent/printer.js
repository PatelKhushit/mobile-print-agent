const { execFile } = require('child_process');
const { promisify } = require('util');
const { print } = require('pdf-to-printer');

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
 * Sends a PDF to the given printer by shelling out to the SumatraPDF binary
 * bundled with pdf-to-printer. This code path never touches the buggy
 * printer-listing logic above - it just runs `SumatraPDF.exe -print-to
 * "<name>" ...`, so it works even though listPrinters() had to be
 * reimplemented. Resolves once the OS print spooler accepts the job (not
 * once paper physically comes out).
 */
async function printFile(filePath, { printerName, copies = 1, color = false }) {
  await print(filePath, {
    printer: printerName,
    copies,
    monochrome: !color,
    silent: true,
  });
}

module.exports = { listPrinters, defaultPrinterName, printerExists, printFile };
