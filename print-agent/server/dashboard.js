const express = require('express');
const path = require('path');
const fs = require('fs');
const printer = require('../printer');
const { buildTestPdf } = require('../utils/testPdf');
const logger = require('../utils/logger');
const { savePrinterName } = require('../config');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

/**
 * Local dashboard + local printer utilities (spec section 11: "GET
 * /local/printers or equivalent local utility", section 14 dashboard,
 * section 15 Test Printer button). Runs on http://localhost:<port> only -
 * never exposed to the internet, matching the "no public printer ports"
 * security rule.
 */
function startDashboard({ getConfig, state, onPrinterSelected }) {
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
      printerName: cfg.printerName,
      printerReady: state.printerReady,
      lastCheck: state.lastCheck,
      lastJobId: state.lastJobId,
      lastPrintStatus: state.lastPrintStatus,
      jobsPrintedToday: state.jobsPrintedToday,
      startedAt: state.startedAt,
    });
  });

  // GET /api/printers - local printer detection (spec section 11)
  app.get('/api/printers', async (req, res) => {
    try {
      const printers = await printer.listPrinters();
      res.json({ success: true, printers });
    } catch (err) {
      logger.log(`Failed to list printers: ${err.message}`);
      res.status(500).json({ success: false, error: 'Unable to list installed printers.' });
    }
  });

  app.post('/api/select-printer', async (req, res) => {
    const { printerName } = req.body || {};
    if (!printerName || typeof printerName !== 'string') {
      return res.status(400).json({ success: false, error: 'printerName is required.' });
    }
    const exists = await printer.printerExists(printerName);
    if (!exists) {
      return res.status(400).json({ success: false, error: 'Configured printer was not found.' });
    }
    savePrinterName(printerName);
    logger.log(`Printer selected: ${printerName}`);
    if (onPrinterSelected) await onPrinterSelected();
    res.json({ success: true, printerName });
  });

  // POST /api/test-print - spec section 15
  app.post('/api/test-print', async (req, res) => {
    const cfg = getConfig();
    if (!cfg.printerName) {
      return res.status(400).json({ success: false, error: 'No printer configured.' });
    }
    const exists = await printer.printerExists(cfg.printerName);
    if (!exists) {
      return res.status(400).json({ success: false, error: 'Configured printer was not found.' });
    }
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const testPath = path.join(TMP_DIR, 'test-print.pdf');
    try {
      fs.writeFileSync(testPath, buildTestPdf('Local Print Agent - Test Page'));
      logger.log('Sending test page...');
      await printer.printFile(testPath, { printerName: cfg.printerName, copies: 1, color: false });
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
