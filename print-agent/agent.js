const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { readConfig } = require('./config');
const logger = require('./utils/logger');
const printer = require('./printer');
const { startDashboard } = require('./server/dashboard');
const { state, bumpJobsPrintedToday } = require('./state');

const TMP_DIR = path.join(__dirname, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

let cfg = readConfig();
let polling = false;
let stopped = false;
let cachedPrinters = [];

function authHeaders() {
  return {
    'X-Agent-Id': cfg.agentId,
    'X-Agent-Secret': cfg.agentSecret,
    'X-Agent-Printers': encodeURIComponent(JSON.stringify(cachedPrinters)),
  };
}

/**
 * Refreshed on a slower timer than the job poll loop (printer lists rarely
 * change and listing them shells out to PowerShell) but sent with every
 * poll so the backend knows which printers this agent can currently serve
 * (spec section 21: multi-printer support).
 */
async function refreshPrinterList() {
  try {
    cachedPrinters = await printer.listPrinters();
  } catch (err) {
    logger.log(`Failed to list printers: ${err.message}`);
  }
}

async function refreshPrinterReadiness() {
  cfg = readConfig();
  state.printerName = cfg.printerName;
  if (!cfg.printerName) {
    state.printerReady = false;
    return;
  }
  try {
    state.printerReady = await printer.printerExists(cfg.printerName);
  } catch {
    state.printerReady = false;
  }
}

async function downloadFile(url, destPath) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: cfg.requestTimeout });
  fs.writeFileSync(destPath, response.data);
}

function cleanup(tmpPath) {
  fs.unlink(tmpPath, () => {});
  logger.log('Temporary file deleted');
}

async function reportFailure(jobId, message) {
  logger.log(`Reporting failure for ${jobId}: ${message}`);
  try {
    await axios.post(
      `${cfg.backendUrl}/api/print-jobs/${jobId}/fail`,
      { error: message },
      { headers: authHeaders(), timeout: cfg.requestTimeout }
    );
  } catch (err) {
    logger.log(`Warning: could not report failure to backend: ${err.message}`);
  }
}

async function handleJob(job) {
  state.lastJobId = job.jobId;
  logger.log(`Job received: ${job.jobId}`);
  const tmpPath = path.join(TMP_DIR, `${job.jobId}.pdf`);

  try {
    logger.log('Downloading PDF');
    await downloadFile(job.fileUrl, tmpPath);
    logger.log('PDF downloaded');
  } catch (err) {
    logger.log(`Unable to download print document (${err.message})`);
    await reportFailure(job.jobId, 'Unable to download print document.');
    state.lastPrintStatus = 'Failed';
    return;
  }

  await refreshPrinterReadiness();
  cfg = readConfig();
  // A job may request a specific printer on this PC (job.printerId); "DEFAULT"
  // means "use whatever this agent is configured with" (spec section 21).
  const targetPrinterName = job.printerId && job.printerId !== 'DEFAULT' ? job.printerId : cfg.printerName;
  const targetExists = await printer.printerExists(targetPrinterName).catch(() => false);

  if (!targetPrinterName || !targetExists) {
    logger.log(`Configured printer was not found ("${targetPrinterName || '(none)'}")`);
    await reportFailure(job.jobId, 'Configured printer was not found.');
    cleanup(tmpPath);
    state.lastPrintStatus = 'Failed';
    return;
  }

  try {
    await axios.post(
      `${cfg.backendUrl}/api/print-jobs/${job.jobId}/printing`,
      {},
      { headers: authHeaders(), timeout: cfg.requestTimeout }
    );
  } catch (err) {
    logger.log(`Warning: could not mark job as printing (${err.message})`);
  }

  try {
    logger.log(`Printing to "${targetPrinterName}"...`);
    await printer.printFile(tmpPath, {
      printerName: targetPrinterName,
      copies: job.copies,
      color: job.color,
    });
    logger.log('Print completed');

    await axios.post(
      `${cfg.backendUrl}/api/print-jobs/${job.jobId}/complete`,
      { status: 'completed' },
      { headers: authHeaders(), timeout: cfg.requestTimeout }
    );
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
    logger.log('Checking jobs');
    const res = await axios.get(`${cfg.backendUrl}/api/print-jobs/pending`, {
      headers: authHeaders(),
      timeout: cfg.requestTimeout,
    });
    state.backendConnected = true;
    state.lastCheck = new Date().toISOString();

    const job = res.data && res.data.job;
    if (job) {
      await handleJob(job);
    }
  } catch (err) {
    state.backendConnected = false;
    state.lastCheck = new Date().toISOString();
    if (err.response && err.response.status === 401) {
      logger.log('Print agent authentication failed.');
    } else {
      logger.log(`Cannot connect to cloud backend. Retrying... (${err.message})`);
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

  if (!cfg.agentId || !cfg.agentSecret) {
    logger.log('WARNING: PRINT_AGENT_ID / PRINT_AGENT_SECRET are not configured in .env');
  }
  if (!cfg.printerName) {
    logger.log('WARNING: PRINTER_NAME is not configured. Run "npm run setup-printer" or use the dashboard.');
  }

  await refreshPrinterReadiness();
  await refreshPrinterList();
  setInterval(refreshPrinterList, 30000);

  startDashboard({
    getConfig: () => cfg,
    state,
    onPrinterSelected: refreshPrinterReadiness,
  });

  scheduleLoop();
}

process.on('SIGINT', () => {
  logger.log('Agent stopping (SIGINT)');
  stopped = true;
  process.exit(0);
});

start();
