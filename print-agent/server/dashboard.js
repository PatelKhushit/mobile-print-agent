const express = require('express');
const path = require('path');
const fs = require('fs');
const discovery = require('../printer-discovery');
const printerService = require('../printer-service');
const { buildTestPdf } = require('../utils/testPdf');
const logger = require('../utils/logger');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

/**
 * Local dashboard + local printer utilities (spec section 25 dashboard,
 * section 26 Test Print). Runs on http://localhost:<port> only - never
 * exposed to the internet, matching the "no public printer ports" rule.
 * Every printer this agent detects is auto-registered with the cloud
 * backend (see agent.js), so there's no manual "select default printer"
 * step here anymore - this page is status + diagnostics only.
 */
function startDashboard({ getConfig, state, getCachedPrinters }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/status', (req, res) => {
    const cfg = getConfig();
    res.json({
      agentId: cfg.agentId,
      backendUrl: cfg.backendUrl,
      backendConnected: state.backendConnected,
      printers: getCachedPrinters(),
      lastCheck: state.lastCheck,
      lastJobId: state.lastJobId,
      lastPrintStatus: state.lastPrintStatus,
      jobsPrintedToday: state.jobsPrintedToday,
      startedAt: state.startedAt,
    });
  });

  // GET /api/printers - refresh + return the live local printer list
  app.get('/api/printers', async (req, res) => {
    try {
      const printers = await discovery.listPrinters();
      res.json({ success: true, printers });
    } catch (err) {
      logger.log(`Failed to list printers: ${err.message}`);
      res.status(500).json({ success: false, error: 'Unable to list installed printers.' });
    }
  });

  // POST /api/test-print { printerName } - spec section 26
  app.post('/api/test-print', async (req, res) => {
    const { printerName } = req.body || {};
    if (!printerName) {
      return res.status(400).json({ success: false, error: 'printerName is required.' });
    }
    const exists = await discovery.printerExists(printerName);
    if (!exists) {
      return res.status(400).json({ success: false, error: 'Configured printer was not found.' });
    }
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const testPath = path.join(TMP_DIR, 'test-print.pdf');
    try {
      fs.writeFileSync(testPath, buildTestPdf('Remote Print Agent - Test Page'));
      logger.log(`Sending test page to "${printerName}"...`);
      await printerService.printFile(testPath, { printerName, copies: 1, color: false });
      logger.log('Test print completed.');
      res.json({ success: true, message: 'Test print completed.' });
    } catch (err) {
      logger.log(`Test print failed: ${err.message}`);
      res.status(500).json({ success: false, error: 'Printer is not available.' });
    } finally {
      fs.unlink(testPath, () => {});
    }
  });

  app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs: logger.getRecentLogs() });
  });

  const server = app.listen(getConfig().dashboardPort, () => {
    logger.log(`Dashboard available at http://localhost:${getConfig().dashboardPort}`);
  });

  return server;
}

module.exports = { startDashboard };
