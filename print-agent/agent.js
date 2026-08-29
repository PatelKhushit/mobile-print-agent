const fs = require('fs');
const path = require('path');

const { readConfig, saveEnvValue } = require('./config');
const logger = require('./utils/logger');
const discovery = require('./printer-discovery');
const printerService = require('./printer-service');
const cloud = require('./cloud-client');
const { startDashboard } = require('./server/dashboard');
const { state, bumpJobsPrintedToday } = require('./state');

const TMP_DIR = path.join(__dirname, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

let cfg = readConfig();
let polling = false;
let stopped = false;
let cachedDiscovered = []; // [{ localPrinterName, protocol, address, model }]

/**
 * First-run flow from spec section 8: register once, get a secret token
 * back, store it locally. Every run after the first just reuses the saved
 * token - nothing is ever hardcoded.
 */
async function ensureRegistered() {
  cfg = readConfig();
  if (cfg.agentToken) return;
  if (!cfg.agentId) {
    throw new Error('PRINT_AGENT_ID is not set in .env');
  }
  logger.log(`Registering agent "${cfg.agentId}" with backend...`);
  const result = await cloud.register(cfg.agentId, cfg.agentId);
  saveEnvValue('PRINT_AGENT_TOKEN', result.token);
  cfg = readConfig();
  logger.log('Agent registered and token saved to .env');
}

/** Printer names conventionally start with the brand - a reasonable,
 * honest best-effort guess, not a fabricated capability claim. */
function guessBrand(name) {
  if (!name) return 'Unknown';
  const first = name.trim().split(/\s+/)[0];
  return first || 'Unknown';
}

async function refreshPrinterList() {
  try {
    const discovered = await printerService.discoverAll();
    const previousNames = new Set(cachedDiscovered.map((d) => d.localPrinterName));
    const currentNames = new Set(discovered.map((d) => d.localPrinterName));
    for (const name of currentNames) {
      if (!previousNames.has(name)) logger.log(`New printer detected: "${name}"`);
    }
    for (const name of previousNames) {
      if (!currentNames.has(name)) logger.log(`Printer no longer detected: "${name}"`);
    }
    cachedDiscovered = discovered;
    state.printers = cachedDiscovered.map((d) => d.localPrinterName);
  } catch (err) {
    logger.log(`Printer discovery failed: ${err.message}`);
  }
}

/** Auto-registers every detected printer - Windows-installed or a real
 * network IPP device found via mDNS - as its own addressable Printer
 * record (spec sections 7, 9, 34), in one batched sync call rather than
 * one HTTP round-trip per printer. Nothing to configure by hand. */
async function registerLocalPrinters() {
  if (!cachedDiscovered.length) return;

  const printers = [];
  for (const d of cachedDiscovered) {
    const printerId = discovery.printerIdFor(cfg.agentId, d.localPrinterName);
    let capabilities = {};
    try {
      capabilities = await printerService.getCapabilities(d);
    } catch (err) {
      logger.log(`Could not read capabilities for "${d.localPrinterName}": ${err.message}`);
    }
    printers.push({
      printerId,
      name: d.localPrinterName,
      brand: guessBrand(d.model || d.localPrinterName),
      model: d.model || 'Unknown',
      localPrinterName: d.localPrinterName,
      protocol: d.protocol,
      address: d.address,
      capabilities,
    });
  }

  try {
    await cloud.syncPrinters(printers);
  } catch (err) {
    logger.log(`Failed to sync printers with backend: ${err.message}`);
  }
}

function cleanup(tmpPath) {
  fs.unlink(tmpPath, () => {});
  logger.log('Temporary file deleted');
}

async function reportFailure(jobId, message) {
  logger.log(`Reporting failure for ${jobId}: ${message}`);
  try {
    await cloud.markFailed(jobId, message);
  } catch (err) {
    logger.log(`Warning: could not report failure to backend: ${err.message}`);
  }
}

async function handleJob(job) {
  state.lastJobId = job.jobId;
  logger.log(`Job received: ${job.jobId}`);
  const tmpPath = path.join(TMP_DIR, `${job.jobId}.pdf`);

  try {
    await cloud.markDownloading(job.jobId);
  } catch (err) {
    logger.log(`Warning: could not mark job as downloading (${err.message})`);
  }

  try {
    logger.log('Downloading PDF');
    const buffer = await cloud.downloadFile(job.fileUrl, cfg.requestTimeout);
    fs.writeFileSync(tmpPath, buffer);
    logger.log('PDF downloaded');
  } catch (err) {
    logger.log(`Unable to download print document (${err.message})`);
    await reportFailure(job.jobId, 'Unable to download print document.');
    state.lastPrintStatus = 'Failed';
    return;
  }

  // A mobile user may have cancelled between claim and now - never print
  // a job that's already been called off (spec section 18/28).
  try {
    const currentStatus = await cloud.getJobStatus(job.jobId);
    if (currentStatus === 'cancelled') {
      logger.log(`Job ${job.jobId} was cancelled - skipping print.`);
      cleanup(tmpPath);
      return;
    }
  } catch (err) {
    logger.log(`Warning: could not verify job wasn't cancelled (${err.message})`);
  }

  // The backend resolves job.printerId to the exact protocol/address/local
  // name server-side (see routes/printJobs.js), so the agent never guesses.
  const printer = { protocol: job.protocol || 'windows', localPrinterName: job.localPrinterName, address: job.address };
  const printerReady = job.protocol === 'windows' || job.protocol === undefined
    ? !!job.localPrinterName && cachedDiscovered.some((d) => d.localPrinterName === job.localPrinterName)
    : !!job.address;

  if (!printerReady || !(await printerService.validate(printer).catch(() => false))) {
    logger.log(`Configured printer was not found ("${job.localPrinterName || job.address || '(none)'}")`);
    await reportFailure(job.jobId, 'Configured printer was not found.');
    cleanup(tmpPath);
    state.lastPrintStatus = 'Failed';
    return;
  }

  try {
    await cloud.markPrinting(job.jobId);
  } catch (err) {
    logger.log(`Warning: could not mark job as printing (${err.message})`);
  }

  try {
    logger.log(`Printing to "${job.localPrinterName}" (${printer.protocol})...`);
    await printerService.printFile(tmpPath, printer, {
      copies: job.copies,
      color: job.color,
      paperSize: job.paperSize,
      duplex: job.duplex,
    });
    logger.log('Print completed');

    await cloud.markCompleted(job.jobId);
    logger.log('Backend updated');
    state.lastPrintStatus = 'Completed';
    bumpJobsPrintedToday();
  } catch (err) {
    logger.log(`Print failed (${err.message})`);
    await reportFailure(job.jobId, err.message || 'Printer unavailable');
    state.lastPrintStatus = 'Failed';
  } finally {
    cleanup(tmpPath);
  }
}

async function pollOnce() {
  if (polling) return; // never run two polls concurrently
  polling = true;
  try {
    cfg = readConfig();
    const printerNames = cachedDiscovered.map((d) => d.localPrinterName);

    try {
      await cloud.heartbeat(printerNames, '1.0.0');
      state.backendConnected = true;
    } catch (err) {
      state.backendConnected = false;
      state.lastCheck = new Date().toISOString();
      if (err.response && err.response.status === 401) {
        logger.log('Print agent authentication failed.');
      } else {
        logger.log(`Cannot connect to cloud backend. Retrying... (${err.message})`);
      }
      return;
    }

    logger.log('Checking jobs');
    const job = await cloud.getPendingJob();
    state.lastCheck = new Date().toISOString();
    if (job) {
      await handleJob(job);
    }
  } finally {
    polling = false;
  }
}

function scheduleLoop() {
  if (stopped) return;
  pollOnce().finally(() => {
    if (!stopped) setTimeout(scheduleLoop, cfg.pollInterval);
  });
}

async function start() {
  logger.log('Agent started');

  try {
    await ensureRegistered();
  } catch (err) {
    logger.log(`FATAL: ${err.message}`);
    process.exit(1);
  }

  await refreshPrinterList();
  await registerLocalPrinters();
  setInterval(async () => {
    await refreshPrinterList();
    await registerLocalPrinters();
  }, 30000);

  startDashboard({
    getConfig: () => cfg,
    state,
    getCachedPrinters: () => cachedDiscovered.map((d) => d.localPrinterName),
  });

  scheduleLoop();
}

process.on('SIGINT', () => {
  logger.log('Agent stopping (SIGINT)');
  stopped = true;
  process.exit(0);
});

start();
