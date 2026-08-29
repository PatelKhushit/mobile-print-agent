const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'agent.log');

const RING_SIZE = 300;
const ring = [];

function timeOnly() {
  return new Date().toTimeString().slice(0, 8);
}

function write(line) {
  ring.push(line);
  if (ring.length > RING_SIZE) ring.shift();
  console.log(line);
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}

function log(message) {
  write(`[${timeOnly()}] ${message}`);
}

function getRecentLogs() {
  return ring.slice();
}

module.exports = { log, getRecentLogs, LOG_FILE };
