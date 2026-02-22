require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../models/Review');
const CabinType = require('../models/CabinType');
const Cabin = require('../models/Cabin');

(async () => {
  const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/drift-dwells-booking';
  await mongoose.connect(MONGO);
  
  const aFrame = await CabinType.findOne({ name: /A-frame/i });
  const stoneHouse = await Cabin.findOne({ name: /Stone House/i });
  
  const aFrameReviews = await Review.find({ cabinId: aFrame._id }).limit(20);
  const stoneHouseReviews = await Review.find({ cabinId: stoneHouse._id }).limit(20);
  
  console.log('=== NEW A-FRAME REVIEW NAMES (sample) ===');
  aFrameReviews.forEach((r, i) => {
    console.log(`${i+1}. ${r.reviewerName}`);
  });
  
  console.log('\n=== NEW STONE HOUSE REVIEW NAMES (sample) ===');
  stoneHouseReviews.forEach((r, i) => {
    console.log(`${i+1}. ${r.reviewerName}`);
  });
  
  console.log('\n=== SAMPLE REVIEW TEXTS ===');
  const samples = [...aFrameReviews.slice(0, 5), ...stoneHouseReviews.slice(0, 5)];
  samples.forEach((r, i) => {
    const hasJose = r.text.toLowerCase().includes('jose');
    const isCasual = r.text.charAt(0) === r.text.charAt(0).toLowerCase();
    console.log(`\n${i+1}. [${r.rating}★] ${r.reviewerName}${hasJose ? ' (mentions Jose)' : ''}${isCasual ? ' (casual)' : ''}`);
    console.log(`   ${r.text.substring(0, 200)}...`);
  });
  
  // Count Bulgarian names
  const allNames = [...aFrameReviews, ...stoneHouseReviews].map(r => r.reviewerName);
  const bulgarianNames = ['Mariya', 'Stoyan', 'Mariia', 'Sofia', 'Iva', 'Irena', 'Ilina', 'Lyubomira', 'Tsvetelina', 'Georgi', 'Dimitar', 'Ivan', 'Petar', 'Nikolay', 'Vasil', 'Stefan', 'Hristo', 'Boris', 'Elena', 'Maria', 'Anna', 'Viktoria', 'Desislava', 'Krasimir', 'Plamen', 'Radoslav', 'Gergana', 'Ralitsa', 'Silvia', 'Vladimir', 'Rumen', 'Svetoslav'];
  const bulgarianCount = allNames.filter(name => bulgarianNames.some(bn => name.includes(bn))).length;
  console.log(`\n=== STATISTICS ===`);
  console.log(`Bulgarian names: ${bulgarianCount}/${allNames.length} (${Math.round(bulgarianCount/allNames.length*100)}%)`);
  console.log(`Jose mentions: ${allNames.filter((_, i) => [...aFrameReviews, ...stoneHouseReviews][i].text.toLowerCase().includes('jose')).length}`);
  console.log(`Casual style: ${allNames.filter((_, i) => [...aFrameReviews, ...stoneHouseReviews][i].text.charAt(0) === [...aFrameReviews, ...stoneHouseReviews][i].text.charAt(0).toLowerCase()).length}`);
  
  await mongoose.disconnect();
})();
