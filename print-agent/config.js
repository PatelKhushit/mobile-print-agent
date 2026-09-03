const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// AGENT_ENV_FILE lets a second agent process (e.g. a local test run against
// this same directory) point its persisted token at its own file instead of
// silently overwriting a different agent's real .env - see print-agent's
// README and the shared-.env incident notes for why this matters.
const ENV_PATH = process.env.AGENT_ENV_FILE
  ? path.resolve(process.env.AGENT_ENV_FILE)
  : path.join(__dirname, '.env');
dotenv.config({ path: ENV_PATH });

function readConfig() {
  return {
    backendUrl: (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, ''),
    agentId: process.env.PRINT_AGENT_ID || '',
    // Optional. Pairs this agent to a shop created by the platform owner -
    // leave unset for the legacy standalone/personal-use behavior (default,
    // and how this real PC's existing agent keeps working untouched).
    shopId: process.env.SHOP_ID || null,
    // Issued by POST /api/agents/register on first run and persisted here -
    // never hand-set. See agent.js ensureRegistered().
    agentToken: process.env.PRINT_AGENT_TOKEN || '',
    pollInterval: parseInt(process.env.POLL_INTERVAL, 10) || 5000,
    dashboardPort: parseInt(process.env.DASHBOARD_PORT, 10) || 3001,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT, 10) || 8000,
  };
}

/**
 * Persists KEY=value into the .env file (creating it from .env.example if
 * it doesn't exist yet) and updates process.env so the running agent picks
 * up the change immediately, without needing a restart.
 */
function saveEnvValue(key, value) {
  let contents = '';
  if (fs.existsSync(ENV_PATH)) {
    contents = fs.readFileSync(ENV_PATH, 'utf8');
  } else {
    const examplePath = path.join(__dirname, '.env.example');
    contents = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
  }

  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(contents)) {
    contents = contents.replace(pattern, line);
  } else {
    contents += `${contents.endsWith('\n') || contents === '' ? '' : '\n'}${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, contents);
  process.env[key] = value;
}

module.exports = { readConfig, saveEnvValue, ENV_PATH };
