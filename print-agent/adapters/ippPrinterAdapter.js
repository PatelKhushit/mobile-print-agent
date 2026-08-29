/**
 * Placeholder for direct IPP (Internet Printing Protocol) support, for
 * network printers that don't need a Windows driver installed at all -
 * e.g. talking straight to a printer's IPP port on the local network.
 * Not implemented yet; printer-service.js only selects this adapter for
 * printers explicitly marked capabilities.ipp = true, which nothing sets
 * today. Wire in a real IPP client library (e.g. "ipp") here when needed.
 */
async function printFile() {
  throw new Error('IPP printing is not implemented yet.');
}

module.exports = { printFile };
