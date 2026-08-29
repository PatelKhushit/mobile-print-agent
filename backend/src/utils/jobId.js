const { randomUUID } = require('crypto');

function generateJobId() {
  const raw = randomUUID().replace(/-/g, '').toUpperCase();
  return `JOB-${raw.slice(0, 8)}`;
}

module.exports = { generateJobId };
