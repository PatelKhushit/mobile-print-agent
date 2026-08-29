const windowsAdapter = require('./adapters/windowsPrinterAdapter');
const ippAdapter = require('./adapters/ippPrinterAdapter');

/**
 * Picks the right PrinterAdapter for a printer record and exposes the
 * full adapter interface (discover/getStatus/getCapabilities/validate/
 * print/cancel) without callers needing to know which protocol backs a
 * given printer.
 */
function adapterFor(protocol) {
  return protocol === 'ipp' || protocol === 'ipps' ? ippAdapter : windowsAdapter;
}

function targetFor(printer) {
  if (printer.protocol === 'ipp' || printer.protocol === 'ipps') {
    return { uri: printer.address };
  }
  return { localPrinterName: printer.localPrinterName };
}

/**
 * Runs both discovery mechanisms and normalizes results to one shape:
 * { localPrinterName, protocol, address, model }. address is null for
 * Windows printers (identified by name only) and the real IPP URI for
 * network printers.
 */
async function discoverAll() {
  const [windowsList, ippList] = await Promise.all([
    windowsAdapter.discover().catch(() => []),
    ippAdapter.discover().catch(() => []),
  ]);
  const windowsNormalized = windowsList.map((w) => ({
    localPrinterName: w.localPrinterName,
    protocol: 'windows',
    address: null,
    model: null,
  }));
  const ippNormalized = ippList.map((p) => ({
    localPrinterName: p.name,
    protocol: p.protocol,
    address: p.uri,
    model: p.model,
  }));
  return [...windowsNormalized, ...ippNormalized];
}

function getStatus(printer) {
  return adapterFor(printer.protocol).getStatus(targetFor(printer));
}

function getCapabilities(printer) {
  return adapterFor(printer.protocol).getCapabilities(targetFor(printer));
}

function validate(printer) {
  return adapterFor(printer.protocol).validate(targetFor(printer));
}

async function printFile(filePath, printer, { copies, color, paperSize, duplex }) {
  const adapter = adapterFor(printer.protocol);
  return adapter.print(filePath, { ...targetFor(printer), copies, color, paperSize, duplex });
}

function cancel(printer, jobRef) {
  return adapterFor(printer.protocol).cancel(targetFor(printer), jobRef);
}

module.exports = { discoverAll, getStatus, getCapabilities, validate, printFile, cancel };
