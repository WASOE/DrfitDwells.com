require('dotenv').config();
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells-booking');
  const cabins = await Cabin.find({ isActive: true }).select('name').lean();
  console.log('Available cabins:');
  cabins.forEach(c => console.log(`  - "${c.name}"`));
  await mongoose.disconnect();
})();
















