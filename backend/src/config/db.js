const mongoose = require('mongoose');
const c = require('./index');

// Keeps retrying so the API (and /health) stay up even if Mongo is briefly unreachable.
async function connectDb({ retry = true } = {}) {
  try {
    await mongoose.connect(c.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('MongoDB connected');
    return true;
  } catch (e) {
    console.error('MongoDB connection failed:', e.message);
    if (!retry) throw e;
    console.error('-> check MONGO_URI / network access. Retrying in 10s...');
    await new Promise((r) => setTimeout(r, 10000));
    return connectDb({ retry });
  }
}
module.exports = connectDb;
