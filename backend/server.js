const express = require('express');
// Patches Express so a thrown/rejected error inside an `async` route
// handler reaches the error-handling middleware below, instead of hanging
// the request or crashing the process (Express 4 doesn't do this itself).
require('express-async-errors');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const logger = require('./src/utils/logger');
const { connectDB } = require('./config/db');
const { buildTestPdf } = require('./src/utils/testPdf');
const storage = require('./services/storage');
const uploadRouter = require('./src/routes/upload');
const agentsRouter = require('./routes/agents');
const printersRouter = require('./routes/printers');
const printJobsRouter = require('./routes/printJobs');
const authRouter = require('./routes/auth');
const filesRouter = require('./routes/files');
const { adminRouter: shopsAdminRouter, publicRouter: shopsPublicRouter, ownerRouter: shopOwnerRouter } = require('./routes/shops');

const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Regenerate the sample test PDF on every boot so its timestamp is fresh.
fs.writeFileSync(path.join(PUBLIC_DIR, 'sample-test-page.pdf'), buildTestPdf());

const app = express();
app.disable('x-powered-by');
// Render (and most PaaS hosts) sit one reverse-proxy hop in front of this
// app and set X-Forwarded-For. Without this, express-rate-limit throws on
// every request instead of trusting the client IP it derives from that header.
app.set('trust proxy', 1);
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
  })
);
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.use('/public', express.static(PUBLIC_DIR));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

app.get('/api/sample-pdf', (req, res) => {
  res.json({ success: true, fileUrl: `${config.publicBaseUrl}/public/sample-test-page.pdf` });
});

app.use('/api/auth', authRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/printers', printersRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/files', filesRouter);
app.use('/api/print-jobs', printJobsRouter);
app.use('/api/admin/shops', shopsAdminRouter);
app.use('/api/shops', shopsPublicRouter);
app.use('/api/shop', shopOwnerRouter);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('[server] Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

/** Runs on boot and then every hour - catches uploads whose job never
 * reached a clean terminal state (spec section 22/47: bounded retention,
 * not "keep forever"). Individual job completion/failure/cancellation
 * already deletes its own file immediately; this is only the backstop. */
function scheduleFileRetentionSweep() {
  const retentionMs = config.fileRetentionHours * 60 * 60 * 1000;
  const sweep = async () => {
    try {
      const deleted = await storage.pruneOrphanedFiles(retentionMs);
      if (deleted > 0) logger.info(`[cleanup] Pruned ${deleted} upload(s) older than ${config.fileRetentionHours}h`);
    } catch (err) {
      logger.warn(`[cleanup] File retention sweep failed: ${err.message}`);
    }
  };
  sweep();
  setInterval(sweep, 60 * 60 * 1000);
}

async function start() {
  await connectDB(config.mongodbUri);
  scheduleFileRetentionSweep();
  app.listen(config.port, () => {
    logger.info(`Print system backend listening on port ${config.port}`);
    logger.info(`Public base URL: ${config.publicBaseUrl}`);
  });
}

start().catch((err) => {
  logger.error(`[server] Failed to start: ${err.message}`);
  process.exit(1);
});
