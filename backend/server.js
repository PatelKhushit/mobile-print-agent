const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const logger = require('./src/utils/logger');
const { JobStore } = require('./src/db/jobStore');
const { AgentRegistry } = require('./src/db/agentRegistry');
const { buildTestPdf } = require('./src/utils/testPdf');
const uploadRouter = require('./src/routes/upload');
const buildPrintJobsRouter = require('./src/routes/printJobs');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Regenerate the sample test PDF on every boot so its timestamp is fresh.
fs.writeFileSync(path.join(PUBLIC_DIR, 'sample-test-page.pdf'), buildTestPdf());

const jobStore = new JobStore(path.join(DATA_DIR, 'jobs.json'));
const agentRegistry = new AgentRegistry();

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

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/public', express.static(PUBLIC_DIR));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString() });
});

app.get('/api/sample-pdf', (req, res) => {
  res.json({ success: true, fileUrl: `${config.publicBaseUrl}/public/sample-test-page.pdf` });
});

// GET /api/printers - printers currently online across all connected agents,
// so the mobile page can offer a real printer picker instead of a blind text field.
app.get('/api/printers', (req, res) => {
  res.json({ success: true, printers: agentRegistry.listOnlinePrinters() });
});

app.use('/api/upload', uploadRouter);
app.use('/api/print-jobs', buildPrintJobsRouter(jobStore, agentRegistry));

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('[server] Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

app.listen(config.port, () => {
  logger.info(`Print system backend listening on port ${config.port}`);
  logger.info(`Public base URL: ${config.publicBaseUrl}`);
  logger.info(`Configured agents: ${Array.from(config.agentCredentials.keys()).join(', ') || '(none)'}`);
});
