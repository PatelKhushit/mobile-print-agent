const windowsAdapter = require('./adapters/windowsPrinterAdapter');
const ippAdapter = require('./adapters/ippPrinterAdapter');

/**
 * Picks the right PrinterAdapter for a printer and sends the file through
 * it. Every printer this agent registers today is a Windows-installed
 * printer, so windowsPrinterAdapter is always selected in practice; the
 * branch exists so a future printer record with capabilities.ipp = true
 * can be routed to ippPrinterAdapter without touching call sites.
 */
async function printFile(filePath, { printerName, copies, color, capabilities }) {
  const adapter = capabilities?.ipp ? ippAdapter : windowsAdapter;
  await adapter.printFile(filePath, { printerName, copies, color });
}

module.exports = { printFile };
