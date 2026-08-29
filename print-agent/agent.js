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
let cachedPrinters = []; // local OS printer names detected right now

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

async function refreshPrinterList() {
  try {
    cachedPrinters = await discovery.listPrinters();
    state.printers = cachedPrinters;
  } catch (err) {
    logger.log(`Failed to list printers: ${err.message}`);
  }
}

/** Auto-registers every detected local printer as its own addressable
 * Printer record (spec section 7) - nothing to configure by hand. */
async function registerLocalPrinters() {
  for (const localName of cachedPrinters) {
    const printerId = discovery.printerIdFor(cfg.agentId, localName);
    try {
      await cloud.registerPrinter({
        printerId,
        name: localName,
        location: '',
        localPrinterName: localName,
        capabilities: {},
      });
    } catch (err) {
      logger.log(`Failed to register printer "${localName}": ${err.message}`);
    }
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

  // The backend resolves job.printerId to the exact local OS printer name
  // server-side (see routes/printJobs.js), so the agent never has to guess.
  if (!job.localPrinterName || !cachedPrinters.includes(job.localPrinterName)) {
    logger.log(`Configured printer was not found ("${job.localPrinterName || '(none)'}")`);
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
    logger.log(`Printing to "${job.localPrinterName}"...`);
    await printerService.printFile(tmpPath, {
      printerName: job.localPrinterName,
      copies: job.copies,
      color: job.color,
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

    try {
      await cloud.heartbeat(cachedPrinters, '1.0.0');
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
    getCachedPrinters: () => cachedPrinters,
  });

  scheduleLoop();
}

process.on('SIGINT', () => {
  logger.log('Agent stopping (SIGINT)');
  stopped = true;
  process.exit(0);
});

start();
