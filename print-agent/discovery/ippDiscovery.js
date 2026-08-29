const { Bonjour } = require('bonjour-service');

const SCAN_DURATION_MS = 4000;

/**
 * Real mDNS/DNS-SD scan (spec section 9) for _ipp._tcp / _ipps._tcp
 * services on the local network - no manual IP entry required. Runs a
 * short timed scan rather than a persistent listener, since this is
 * called periodically from agent.js alongside Windows printer refresh.
 *
 * We deliberately do NOT scan arbitrary IP ranges or ports (spec: "Do not
 * perform aggressive network scanning") - mDNS multicast only surfaces
 * devices that are themselves advertising a print service.
 */
// mDNS service type -> [enum-compatible protocol name, URI scheme]
const SERVICE_TYPES = { ipp: ['ipp', 'http'], ipps: ['ipps', 'https'] };

function scanOnce(bonjour, mdnsType) {
  const [protocol, uriScheme] = SERVICE_TYPES[mdnsType];
  return new Promise((resolve) => {
    const found = [];
    const browser = bonjour.find({ type: mdnsType }, (service) => {
      const host = service.host || (service.addresses && service.addresses[0]);
      if (!host) return;
      const resourcePath = (service.txt && service.txt.rp) || 'ipp/print';
      const uri = `${uriScheme}://${host}:${service.port}/${resourcePath}`.replace(/([^:]\/)\/+/g, '$1');
      found.push({
        name: service.name || host,
        host,
        port: service.port,
        protocol, // 'ipp' | 'ipps' - matches the backend Printer.protocol enum
        uri,
        model: (service.txt && (service.txt.ty || service.txt.product)) || null,
      });
    });

    setTimeout(() => {
      browser.stop();
      resolve(found);
    }, SCAN_DURATION_MS);
  });
}

async function discoverIppPrinters() {
  const bonjour = new Bonjour(undefined, () => {
    /* swallow mDNS socket errors (e.g. no multicast-capable interface) -
       discovery just returns nothing found rather than crashing the agent */
  });
  try {
    const [ippResults, ippsResults] = await Promise.all([scanOnce(bonjour, 'ipp'), scanOnce(bonjour, 'ipps')]);
    return [...ippResults, ...ippsResults];
  } finally {
    bonjour.destroy();
  }
}

module.exports = { discoverIppPrinters };
