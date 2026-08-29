require('dotenv').config();

function parseAgentCredentials(raw) {
  const map = new Map();
  if (!raw) return map;
  raw.split(',').forEach((pair) => {
    const trimmed = pair.trim();
    if (!trimmed) return;
    const idx = trimmed.indexOf(':');
    if (idx === -1) return;
    const agentId = trimmed.slice(0, idx).trim();
    const secret = trimmed.slice(idx + 1).trim();
    if (agentId && secret) map.set(agentId, secret);
  });
  return map;
}

const config = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  agentCredentials: parseAgentCredentials(process.env.AGENT_CREDENTIALS),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
  jobClaimTimeoutMs: parseInt(process.env.JOB_CLAIM_TIMEOUT_MS, 10) || 120000,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 120,
};

if (config.agentCredentials.size === 0) {
  console.warn('[config] WARNING: No AGENT_CREDENTIALS configured. No print agent will be able to authenticate.');
}

module.exports = config;
