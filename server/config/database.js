const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells-booking';

const connectOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  retryWrites: true
};

const connectDB = async (attempt = 1) => {
  const maxAttempts = 5;
  const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);

  try {
    const conn = await mongoose.connect(uri, connectOptions);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`Database connection error (attempt ${attempt}/${maxAttempts}):`, error.message);
    if (attempt < maxAttempts) {
      console.log(`Retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return connectDB(attempt + 1);
    }
    console.error('Server will start but API routes requiring MongoDB will return 503.');
    return null;
  }
};

const isConnected = () => mongoose.connection.readyState === 1;

module.exports = connectDB;
module.exports.isConnected = isConnected;
module.exports.mongoose = mongoose;
