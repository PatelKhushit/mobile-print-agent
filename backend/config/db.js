const mongoose = require('mongoose');
const logger = require('../src/utils/logger');

async function connectDB(uri) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  mongoose.connection.on('disconnected', () => logger.warn('[db] MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('[db] MongoDB reconnected'));
  await mongoose.connect(uri);
  logger.info('[db] MongoDB connected');
}

module.exports = { connectDB };
