const axios = require('axios');
const { readConfig } = require('./config');

/** Thin wrapper around the backend's HTTP API used by agent.js. */
function authHeaders(cfg) {
  return { 'X-Agent-Id': cfg.agentId, 'X-Agent-Secret': cfg.agentToken };
}

async function register(agentId, name, shopId, pairingCode) {
  const cfg = readConfig();
  const { data } = await axios.post(
    `${cfg.backendUrl}/api/agents/register`,
    { agentId, name, ...(shopId ? { shopId } : {}), ...(pairingCode ? { pairingCode } : {}) },
    { timeout: cfg.requestTimeout }
  );
  return data; // { success, agentId, shopId, token }
}

async function heartbeat(printers, version) {
  const cfg = readConfig();
  await axios.post(
    `${cfg.backendUrl}/api/agents/heartbeat`,
    { printers, version },
    { headers: authHeaders(cfg), timeout: cfg.requestTimeout }
  );
}

async function registerPrinter({ printerId, name, brand, model, location, localPrinterName, protocol, address, capabilities }) {
  const cfg = readConfig();
  await axios.post(
    `${cfg.backendUrl}/api/printers/register`,
    { printerId, name, brand, model, location, localPrinterName, protocol, address, capabilities },
    { headers: authHeaders(cfg), timeout: cfg.requestTimeout }
  );
}

async function syncPrinters(printers) {
  const cfg = readConfig();
  const { data } = await axios.post(
    `${cfg.backendUrl}/api/printers/sync`,
    { printers },
    { headers: authHeaders(cfg), timeout: cfg.requestTimeout }
  );
  return data; // { success, synced: [printerId, ...] }
}

async function getPendingJob() {
  const cfg = readConfig();
  const { data } = await axios.get(`${cfg.backendUrl}/api/print-jobs/pending`, {
    headers: authHeaders(cfg),
    timeout: cfg.requestTimeout,
  });
  return data.job;
}

async function markDownloading(jobId) {
  const cfg = readConfig();
  await axios.post(`${cfg.backendUrl}/api/print-jobs/${jobId}/downloading`, {}, {
    headers: authHeaders(cfg),
    timeout: cfg.requestTimeout,
  });
}

async function markPrinting(jobId) {
  const cfg = readConfig();
  await axios.post(`${cfg.backendUrl}/api/print-jobs/${jobId}/printing`, {}, {
    headers: authHeaders(cfg),
    timeout: cfg.requestTimeout,
  });
}

async function markCompleted(jobId) {
  const cfg = readConfig();
  await axios.post(`${cfg.backendUrl}/api/print-jobs/${jobId}/complete`, { status: 'completed' }, {
    headers: authHeaders(cfg),
    timeout: cfg.requestTimeout,
  });
}

async function markFailed(jobId, error) {
  const cfg = readConfig();
  await axios.post(`${cfg.backendUrl}/api/print-jobs/${jobId}/fail`, { error }, {
    headers: authHeaders(cfg),
    timeout: cfg.requestTimeout,
  });
}

async function downloadFile(url, timeout) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout });
  return response.data;
}

/** Used to check for a mobile-initiated cancel between download and print
 * (spec section 18: never print a job that's already been cancelled). */
async function getJobStatus(jobId) {
  const cfg = readConfig();
  const { data } = await axios.get(`${cfg.backendUrl}/api/print-jobs/${jobId}`, { timeout: cfg.requestTimeout });
  return data.job.status;
}

module.exports = {
  register,
  heartbeat,
  registerPrinter,
  syncPrinters,
  getPendingJob,
  getJobStatus,
  markDownloading,
  markPrinting,
  markCompleted,
  markFailed,
  downloadFile,
};
