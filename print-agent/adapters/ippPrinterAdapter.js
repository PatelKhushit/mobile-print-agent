const ipp = require('ipp');
const fs = require('fs');
const { discoverIppPrinters } = require('../discovery/ippDiscovery');

/**
 * Real IPP/IPPS client adapter - talks directly to network printers over
 * the Internet Printing Protocol, no OS driver required. Every call here
 * is a genuine IPP operation (RFC 2911); nothing is simulated.
 */

function ippStateToStatus(state) {
  // IPP printer-state (RFC 2911 §4.4.11) is defined as the integers 3/4/5,
  // but the `ipp` library decodes it to its enum keyword string before we
  // ever see it - handle both forms rather than assuming one.
  if (state === 3 || state === 'idle') return 'online';
  if (state === 4 || state === 'processing') return 'busy';
  if (state === 5 || state === 'stopped') return 'error';
  return 'unknown';
}

function getAttr(attrsTag, key) {
  if (!attrsTag) return undefined;
  return attrsTag[key];
}

/** target = { uri } - the printer's IPP endpoint, e.g. http://host:631/ipp/print */
function getPrinterAttributes(uri) {
  return new Promise((resolve, reject) => {
    const printer = ipp.Printer(uri);
    printer.execute('Get-Printer-Attributes', null, (err, res) => {
      if (err) return reject(err);
      if (res.statusCode && res.statusCode !== 'successful-ok') {
        return reject(new Error(`IPP error: ${res.statusCode}`));
      }
      resolve(res['printer-attributes-tag'] || {});
    });
  });
}

async function discover() {
  return discoverIppPrinters();
}

async function getStatus({ uri }) {
  try {
    const attrs = await getPrinterAttributes(uri);
    const state = getAttr(attrs, 'printer-state');
    return ippStateToStatus(state);
  } catch {
    return 'offline';
  }
}

async function getCapabilities({ uri }) {
  const attrs = await getPrinterAttributes(uri);
  const colorSupported = getAttr(attrs, 'color-supported');
  const sides = getAttr(attrs, 'sides-supported') || [];
  const media = getAttr(attrs, 'media-supported') || [];
  const resolution = getAttr(attrs, 'printer-resolution-supported');

  return {
    color: !!colorSupported,
    duplex: Array.isArray(sides) ? sides.some((s) => String(s).includes('two-sided')) : false,
    paperSizes: Array.isArray(media) ? media : [media].filter(Boolean),
    resolution: resolution ? JSON.stringify(resolution) : '',
  };
}

async function validate(target) {
  const status = await getStatus(target);
  return status !== 'offline';
}

/**
 * Sends a real Print-Job request with the PDF as the document body. Copies,
 * color mode, sides (duplex), and media (paper size) are passed as genuine
 * IPP job attributes - the printer itself applies them, not us faking it
 * client-side.
 */
async function print(filePath, { uri, copies = 1, color = false, paperSize, duplex }) {
  const data = fs.readFileSync(filePath);

  const jobAttrs = { copies };
  if (paperSize) jobAttrs.media = paperSize;
  jobAttrs['print-color-mode'] = color ? 'color' : 'monochrome';
  if (duplex) jobAttrs.sides = 'two-sided-long-edge';

  const msg = {
    'operation-attributes-tag': {
      'requesting-user-name': 'remote-print-agent',
      'job-name': 'Remote Print Job',
      'document-format': 'application/pdf',
    },
    'job-attributes-tag': jobAttrs,
    data,
  };

  return new Promise((resolve, reject) => {
    const printer = ipp.Printer(uri);
    printer.execute('Print-Job', msg, (err, res) => {
      if (err) return reject(err);
      if (res.statusCode && res.statusCode !== 'successful-ok') {
        return reject(new Error(`IPP print failed: ${res.statusCode}`));
      }
      const jobId = res['job-attributes-tag'] && res['job-attributes-tag']['job-id'];
      resolve({ ippJobId: jobId });
    });
  });
}

async function cancel({ uri }, ippJobId) {
  if (!ippJobId) throw new Error('No IPP job-id to cancel.');
  return new Promise((resolve, reject) => {
    const printer = ipp.Printer(uri);
    const msg = { 'operation-attributes-tag': { 'job-id': ippJobId } };
    printer.execute('Cancel-Job', msg, (err, res) => {
      if (err) return reject(err);
      resolve(res.statusCode === 'successful-ok');
    });
  });
}

module.exports = { discover, getStatus, getCapabilities, validate, print, cancel };
