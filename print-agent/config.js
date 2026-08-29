const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.join(__dirname, '.env');
dotenv.config({ path: ENV_PATH });

function readConfig() {
  return {
    backendUrl: (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, ''),
    agentId: process.env.PRINT_AGENT_ID || '',
    agentSecret: process.env.PRINT_AGENT_SECRET || '',
    printerName: process.env.PRINTER_NAME || '',
    pollInterval: parseInt(process.env.POLL_INTERVAL, 10) || 5000,
    dashboardPort: parseInt(process.env.DASHBOARD_PORT, 10) || 3001,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT, 10) || 8000,
  };
}

/**
 * Persists PRINTER_NAME=... into the .env file (creating it from
 * .env.example if it doesn't exist yet) and updates process.env so the
 * running agent picks up the change immediately.
 */
function savePrinterName(printerName) {
  let contents = '';
  if (fs.existsSync(ENV_PATH)) {
    contents = fs.readFileSync(ENV_PATH, 'utf8');
  } else {
    const examplePath = path.join(__dirname, '.env.example');
    contents = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
  }

  const line = `PRINTER_NAME=${printerName}`;
  if (/^PRINTER_NAME=.*$/m.test(contents)) {
    contents = contents.replace(/^PRINTER_NAME=.*$/m, line);
  } else {
    contents += `${contents.endsWith('\n') || contents === '' ? '' : '\n'}${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, contents);
  process.env.PRINTER_NAME = printerName;
}

module.exports = { readConfig, savePrinterName, ENV_PATH };
