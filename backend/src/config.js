require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  mongodbUri: process.env.MONGODB_URI || '',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
  jobClaimTimeoutMs: parseInt(process.env.JOB_CLAIM_TIMEOUT_MS, 10) || 120000,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 120,
};

if (!config.mongodbUri) {
  console.warn('[config] WARNING: MONGODB_URI is not set. The backend cannot start without it.');
}
if (!process.env.JWT_SECRET) {
  console.warn('[config] WARNING: JWT_SECRET is not set. Mobile login will not work.');
}

module.exports = config;
