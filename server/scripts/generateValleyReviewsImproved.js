/* server/scripts/generateValleyReviewsImproved.js */
require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../models/Review');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');

// Bulgarian/Eastern European first names (70% of reviews)
const BULGARIAN_FIRST_NAMES = [
  'Mariya', 'Stoyan', 'Mariia', 'Sofia', 'Iva', 'Irena', 'Ilina', 'Lyubomira', 'Tsvetelina', 'Nia-Mihaela',
  'Karyna', 'Georgi', 'Dimitar', 'Ivan', 'Petar', 'Nikolay', 'Vasil', 'Stefan', 'Hristo', 'Boris',
  'Elena', 'Maria', 'Anna', 'Viktoria', 'Desislava', 'Radostina', 'Yana', 'Nadezhda', 'Milena', 'Daniela',
  'Krasimir', 'Plamen', 'Radoslav', 'Zdravko', 'Valentin', 'Emil', 'Martin', 'Aleksandar', 'Todor', 'Atanas',
  'Gergana', 'Ralitsa', 'Silvia', 'Teodora', 'Gabriela', 'Kristina', 'Maya', 'Nina', 'Petya', 'Rumyana',
  'Vladimir', 'Rumen', 'Svetoslav', 'Tsvetan', 'Yordan', 'Zlatko', 'Boyan', 'Dobromir', 'Kalin', 'Lyubomir'
];

// Western first names (20% of reviews)
const WESTERN_FIRST_NAMES = [
  'Philip', 'Nicolas', 'Christopher', 'David', 'James', 'Michael', 'Thomas', 'Robert', 'Daniel', 'Matthew',
  'Sarah', 'Emma', 'Olivia', 'Sophia', 'Isabella', 'Charlotte', 'Amelia', 'Emily', 'Harper', 'Evelyn',
  'Alexander', 'Benjamin', 'William', 'Henry', 'Joseph', 'Samuel', 'John', 'Andrew', 'Ryan', 'Nathan'
];

// Bulgarian/Eastern European last names
const BULGARIAN_LAST_NAMES = [
  'Ivanov', 'Petrov', 'Georgiev', 'Dimitrov', 'Nikolov', 'Stoyanov', 'Todorov', 'Stefanov', 'Vasilev', 'Kostov',
  'Hristov', 'Borisov', 'Atanasov', 'Radev', 'Yordanov', 'Zlatev', 'Krastev', 'Marinov', 'Popov', 'Mladenov',
  'Stanchev', 'Angelov', 'Kolev', 'Mitev', 'Pavlov', 'Rusev', 'Simeonov', 'Tsvetanov', 'Valentinov', 'Emilov'
];

// Western last names
const WESTERN_LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White'
];

// Generate realistic reviewer names (40% Bulgarian, 60% International, 10% couples/families)
function generateName() {
  const rand = Math.random();
  
  if (rand < 0.1) {
    // Couples (10%)
    const isBulgarian = Math.random() < 0.4;
    const namePool = isBulgarian ? BULGARIAN_FIRST_NAMES : WESTERN_FIRST_NAMES;
    const name1 = namePool[Math.floor(Math.random() * namePool.length)];
    const name2 = namePool[Math.floor(Math.random() * namePool.length)];
    return `${name1} & ${name2}`;
  } else if (rand < 0.12) {
    // Families (2%)
    const isBulgarian = Math.random() < 0.4;
    const namePool = isBulgarian ? BULGARIAN_FIRST_NAMES : WESTERN_FIRST_NAMES;
    const lastNamePool = isBulgarian ? BULGARIAN_LAST_NAMES : WESTERN_LAST_NAMES;
    const firstName = namePool[Math.floor(Math.random() * namePool.length)];
    const lastName = lastNamePool[Math.floor(Math.random() * lastNamePool.length)];
    return `${firstName} ${lastName} Family`;
  } else if (rand < 0.5) {
    // Bulgarian names (38%)
    const firstName = BULGARIAN_FIRST_NAMES[Math.floor(Math.random() * BULGARIAN_FIRST_NAMES.length)];
    const lastName = BULGARIAN_LAST_NAMES[Math.floor(Math.random() * BULGARIAN_LAST_NAMES.length)];
    return `${firstName} ${lastName}`;
  } else {
    // International/Western names (50%)
    const firstName = WESTERN_FIRST_NAMES[Math.floor(Math.random() * WESTERN_FIRST_NAMES.length)];
    const lastName = WESTERN_LAST_NAMES[Math.floor(Math.random() * WESTERN_LAST_NAMES.length)];
    return `${firstName} ${lastName}`;
  }
}

// Generate dates spread over the past 2 years
function generateDate() {
  const now = new Date();
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  const randomTime = twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime());
  return new Date(randomTime);
}

// Helper to add occasional typos/casual language
function addCasualTouches(text, probability = 0.15) {
  if (Math.random() > probability) return text;
  
  // Sometimes lowercase first letter
  if (Math.random() < 0.3) {
    text = text.charAt(0).toLowerCase() + text.slice(1);
  }
  
  // Sometimes add casual punctuation
  if (Math.random() < 0.2) {
    text = text.replace(/\./g, (match, offset) => {
      if (offset < text.length - 1 && Math.random() < 0.1) return '!';
      return match;
    });
  }
  
  return text;
}

// A-Frame review templates - MUCH more varied and realistic
const A_FRAME_REVIEW_TEMPLATES = [
  // Short, casual reviews
  () => addCasualTouches("The place is unique. Very cozy. We spent unforgettable time in nature. Very quiet and peaceful. This is exactly what we needed."),
  
  () => addCasualTouches("amazing place to disconnect and really rest. the cabin has a raw charm that makes it feel truly off grid, which we loved."),
  
  () => "Perfect escape! The A-frame was cozy and the valley is stunning. We loved the horse riding and ATV tours.",
  
  // Medium length with specific details
  () => {
    const details = [
      "The road to there was really tough, but it was worth it. If you don't have 4x4, the journey from the village takes around half an hour for the last 5km, so keep that in mind.",
      "We didn't have a 4x4 car but managed to arrive without any problems. Even though I would recommend considering a 4x4 vehicle to feel more confident on the road.",
      "The dirt road for the last 1km is quite difficult for a low car, but can be done if the weather is good!",
      "Try to arrive before sunset - finding your way in the dark could be a bit of a challenge."
    ];
    return `This experience will definitely be unforgettable. The A-frame is so cozy and has everything you need for a short stay. It's located in a hidden valley, surrounded by forest with just the sound of creeks and animals. ${details[Math.floor(Math.random() * details.length)]} The cabin itself is small but really cosy, made with attention to detail.`;
  },
  
  () => {
    const activities = [
      "We did the horse riding tour which was incredible - riding through the mountain trails felt like stepping back in time.",
      "The ATV tour above the clouds was unforgettable. Seeing the highest village in the Balkans from that perspective is something I'll never forget.",
      "We went horseback riding through the valley and it was magical. The views of all the mountain peaks at eye level are breathtaking.",
      "The activities here are fantastic. We did both horse riding and ATV tours - both were amazing experiences."
    ];
    return `${activities[Math.floor(Math.random() * activities.length)]} The A-frame cabin was perfect - simple, clean, and had great amenities including toilet, shower, and internet. The valley location is truly special.`;
  },
  
  // Longer, detailed reviews
  () => {
    const hostMention = Math.random() < 0.4 ? "Jose is a great host - super responsive, friendly, and always ready to help. " : "";
    const weather = Math.random() < 0.3 ? "Unfortunately we couldn't do many activities because it was raining almost all the time, but still managed to go for quick walks in nature and enjoy the cosy fireplace. " : "";
    return `${hostMention}We spent three nights in the A-frame and it was incredible. The secret valley location is unlike anything - completely surrounded by forest with just the sound of creeks and wildlife. ${weather}The cabin itself is beautifully minimal with everything you need - toilet, shower, and even internet which was helpful. We did the horse riding tour and an ATV adventure, both were amazing. Being at 1,550m with all the mountain peaks at eye level is surreal. This is truly a once-in-a-lifetime experience.`;
  },
  
  () => {
    const practical = [
      "Make sure to come prepared: bring your own water and snacks, as the nearest shop is quite far.",
      "Bring a power bank if you'd like to use your phone, though the internet worked well when we needed it.",
      "This place isn't for everyone - but if you love the wild, embrace the rustic, and enjoy being adaptable, it might just be perfect for you.",
      "Please read the instructions and come prepared - this experience requires some planning but with the right preparation you'll have a great time."
    ];
    return `A magical retreat into nature! The A-frame is absolutely lovely – peaceful, quiet, and surrounded by stunning forest. It's perfect for adventurers and nature lovers who are ready to be self-sufficient. ${practical[Math.floor(Math.random() * practical.length)]} The valley is stunning and we loved exploring the highest village in the Balkans.`;
  },
  
  // Reviews with personal touches
  () => {
    const personal = [
      "I came by myself for a few nights and it was perfect for a solo retreat.",
      "We came with our dog and he loved it too - so much space to explore!",
      "This was our anniversary trip and it couldn't have been more perfect.",
      "We came for a weekend and ended up staying longer - it's that kind of place."
    ];
    return `${personal[Math.floor(Math.random() * personal.length)]} The A-frame was cozy and comfortable. The valley location is stunning - pure forest, creeks, and wildlife everywhere. The activities like horse riding and ATV tours are fantastic. Great facilities including internet when needed.`;
  },
  
  () => {
    const season = [
      "Winter stay was magical! The A-frame was cozy and warm. The valley covered in snow is breathtaking.",
      "Summer in the valley is perfect! The A-frame was comfortable and the forest is lush. We loved the creeks and the activities.",
      "Autumn colors were incredible! The A-frame was cozy and the valley is stunning in fall. The mountain peaks with autumn colors are breathtaking.",
      "Spring visit was beautiful! The A-frame was perfect and the valley is coming to life. The forest, creeks, and wildlife are amazing."
    ];
    return `${season[Math.floor(Math.random() * season.length)]} We did both horse riding and ATV tours - both amazing. The highest village in the Balkans has incredible views. Great facilities too.`;
  },
  
  // Stargazing/night sky
  () => {
    const stars = [
      "We have never seen so many stars in our life. It felt like a private planetarium above our heads.",
      "The stargazing here is incredible! With no light pollution, the night sky is breathtaking.",
      "The stars at night are unlike anything I've seen. The A-frame's large window was perfect for stargazing.",
      "Spent hours stargazing - the night sky here is crystal clear and absolutely stunning."
    ];
    return `${stars[Math.floor(Math.random() * stars.length)]} The A-frame was cozy and the valley location is so peaceful. The facilities were great including internet when needed.`;
  },
  
  // Digital nomads/remote work
  () => {
    const work = [
      "Perfect for remote work! The A-frame had internet which was great. I worked during the day and explored in the evenings.",
      "Great workation spot! The internet worked well and the valley is peaceful. I loved the balance of work and nature.",
      "Spent a week here working remotely. The A-frame had great internet and the valley is the perfect place to focus.",
      "Did some remote work here and it was perfect. The internet connection was reliable and the peaceful setting helped me focus."
    ];
    return `${work[Math.floor(Math.random() * work.length)]} The horse riding and ATV tours were amazing. The highest village in the Balkans has incredible views.`;
  },
  
  // Repeat visitors
  () => {
    const repeat = [
      "Our second visit and it was just as magical. The A-frame is perfect - simple, cozy, and has all the amenities you need.",
      "Our third visit and it gets better every time! The A-frame is perfect and the valley is stunning.",
      "Came back for more! The A-frame was just as perfect. The secret valley location is magical.",
      "This was our second stay and we'll definitely be back. The A-frame and valley are incredible."
    ];
    return `${repeat[Math.floor(Math.random() * repeat.length)]} We did all the activities again - horse riding and ATV tours. The highest village in the Balkans never gets old.`;
  },
  
  // Nature-focused
  () => {
    const nature = [
      "Nature lover's paradise! The A-frame is surrounded by pure forest, creeks, and wildlife. The valley location is stunning.",
      "Perfect for nature lovers! The A-frame is in the heart of nature. The valley is beautiful with forest, creeks, and animals everywhere.",
      "The natural setting here is breathtaking - pure forest, creeks, and wildlife. The A-frame was cozy and comfortable.",
      "This valley is nature at its finest - forest, creeks, and animals everywhere. The A-frame cabin was simple and perfect."
    ];
    return `${nature[Math.floor(Math.random() * nature.length)]} We loved the horse riding and seeing the highest village in the Balkans. The mountain peaks at eye level are incredible.`;
  },
  
  // Host-focused
  () => {
    const host = [
      "Jose is an incredible host - super responsive, friendly, and thoughtful. He's really put a lot of care into this place and it shows.",
      "Jose is a great host. He was always responsive, friendly and always ready to help. His place is a true experience.",
      "Thank you, Jose, for the paradise you've created. This is exactly what we needed.",
      "Jose was super communicative and helpful throughout our stay. The A-frame is beautiful and the valley is stunning."
    ];
    return `${host[Math.floor(Math.random() * host.length)]} The A-frame was cozy and had everything we needed. The valley location is stunning and the activities are fantastic.`;
  },
  
  // Adventure-focused
  () => {
    const adventure = [
      "This place is a serious adventure. Go here if you're ready to work a bit to have a good time.",
      "Adventure paradise! The A-frame was our base for exploring. The valley location is perfect for outdoor activities.",
      "Incredible adventure base! The A-frame was cozy and comfortable. The valley is perfect for activities.",
      "Perfect for adventurers! The A-frame is in a stunning location. We did everything - horse riding, ATV tours, and hiking."
    ];
    return `${adventure[Math.floor(Math.random() * adventure.length)]} The highest village in the Balkans has amazing views. The mountain peaks at eye level are breathtaking. Great facilities.`;
  },
  
  // Comprehensive detailed reviews
  () => {
    const hostMention = Math.random() < 0.4 ? "Jose is a great host - always responsive and helpful. " : "";
    const weather = Math.random() < 0.25 ? "Despite the weather being challenging at times, " : "";
    const personal = Math.random() < 0.3 ? "I came by myself for a few nights and " : "We ";
    return `${hostMention}${weather}${personal}spent a week at the A-frame and it was incredible. The renovated cabin is beautiful - it's simple, cozy, and has all the amenities you need including toilet, shower, and internet. The secret valley location is stunning - surrounded by forest, creeks, and wildlife. We did the horse riding tour which was amazing, and the ATV tour above the clouds was unforgettable. Being at the highest village in the Balkans (1,550m) with all the mountain peaks at eye level is surreal. The stargazing is incredible with no light pollution. This is a truly special place that everyone should experience.`;
  }
];

// Stone House review templates - families and groups, more varied
const STONE_HOUSE_REVIEW_TEMPLATES = [
  // Short family reviews
  () => "Perfect for our family of 4! The Stone House is incredible - a renovated 400-year-old house that breathes and smells so natural. The kids loved exploring the valley.",
  
  () => addCasualTouches("our family of 4 had an amazing time! the stone house is beautiful - historic, natural, and spacious. the valley is stunning."),
  
  // Medium length with specific details
  () => {
    const family = [
      "Our family of 4 spent a week here and it was incredible. The Stone House is a renovated 400-year-old house that breathes and smells so natural - the kids loved the historic character.",
      "Perfect for families! The Stone House accommodated our family of 4 comfortably. The 400-year-old house is beautiful and natural.",
      "Great family stay! The Stone House is perfect for our family of 4. The historic house has such natural character that the kids loved."
    ];
    return `${family[Math.floor(Math.random() * family.length)]} The valley location is stunning and we all enjoyed the activities. The horse riding was great for the kids and the ATV tour was exciting. The highest village in the Balkans has incredible views.`;
  },
  
  () => {
    const group = [
      "Our group of 6 friends had an amazing time! The Stone House is spacious and beautiful - a renovated 400-year-old house with so much character.",
      "Perfect for our group of friends! The Stone House is incredible - historic, natural, and spacious. Our group loved it.",
      "Great for groups! The Stone House accommodated our group of 8 perfectly. The 400-year-old house is beautiful and natural."
    ];
    return `${group[Math.floor(Math.random() * group.length)]} The valley is stunning and we loved all the activities. We did horse riding and ATV tours - both amazing. The highest village in the Balkans is special.`;
  },
  
  // Activities-focused
  () => {
    const activities = [
      "The valley activities are amazing! We did horse riding through the mountains and ATV tours above the clouds. Both were fantastic.",
      "The activities here are incredible! We loved the horse riding and ATV tours. The highest village in the Balkans has stunning views.",
      "Great activities in the valley! We did horse riding and ATV tours - both amazing. The Stone House was our perfect base."
    ];
    return `${activities[Math.floor(Math.random() * activities.length)]} The Stone House is beautiful - a renovated 400-year-old house that breathes naturally. The Starlink internet was great.`;
  },
  
  // Historic house focus
  () => {
    const historic = [
      "The Stone House is incredible - a renovated 400-year-old house that breathes and smells so natural. The historic character is amazing.",
      "This 400-year-old house is beautiful! The Stone House has been renovated perfectly while keeping its natural character. It breathes and smells amazing.",
      "The historic Stone House is stunning! A renovated 400-year-old house that feels so natural and authentic. The valley location is beautiful."
    ];
    return `${historic[Math.floor(Math.random() * historic.length)]} The valley is stunning and the activities are amazing. We loved the horse riding and ATV tours. The highest village in the Balkans is incredible.`;
  },
  
  // Highest village/mountain peaks
  () => {
    const altitude = [
      "Being at the highest village in the Balkans is surreal! The Stone House is perfect - a renovated 400-year-old house. All the mountain peaks at eye level are stunning.",
      "The highest village in the Balkans is incredible! The Stone House is beautiful and being at 1,550m with all the peaks at eye level is breathtaking.",
      "Amazing altitude! The Stone House is beautiful and being at the highest village in the Balkans is surreal. The peaks at eye level are stunning."
    ];
    return `${altitude[Math.floor(Math.random() * altitude.length)]} The 400-year-old house is historic and natural. The valley is stunning and we loved the activities.`;
  },
  
  // Starlink/internet
  () => {
    const internet = [
      "The Stone House has Starlink internet which was perfect! The 400-year-old house is beautiful and natural. Great for remote work.",
      "Great internet at the Stone House! The renovated 400-year-old house is beautiful and breathes naturally. The Starlink connection was fast.",
      "Perfect for remote work! The Stone House has Starlink internet and the 400-year-old house is beautiful. The valley is peaceful and perfect for focusing."
    ];
    return `${internet[Math.floor(Math.random() * internet.length)]} The valley location is stunning and the activities are amazing. The highest village in the Balkans has incredible views.`;
  },
  
  // Spacious/groups
  () => {
    const space = [
      "The Stone House is spacious and perfect for groups! The 400-year-old house is beautiful and natural. We had plenty of room.",
      "Perfect for large groups! The Stone House is spacious and beautiful. The renovated 400-year-old house breathes naturally.",
      "Great for groups! The Stone House accommodated our group perfectly. The 400-year-old house is historic and natural."
    ];
    return `${space[Math.floor(Math.random() * space.length)]} The valley is stunning and we loved the activities. The horse riding and ATV tours were incredible.`;
  },
  
  // Host mentions
  () => {
    const host = [
      "Jose is an amazing host! The Stone House is beautiful and he helped us with everything. The 400-year-old house is incredible.",
      "Wonderful host! Jose made our stay perfect. The Stone House is beautiful - a renovated 400-year-old house. The valley is stunning.",
      "Great host! Jose is helpful and friendly. The Stone House is perfect - a 400-year-old house that breathes naturally."
    ];
    return `${host[Math.floor(Math.random() * host.length)]} The valley is beautiful and the activities are amazing. The highest village in the Balkans has incredible views.`;
  },
  
  // Seasonal
  () => {
    const season = [
      "Winter stay was magical! The Stone House is cozy and warm. The 400-year-old house is beautiful in winter. The valley covered in snow is breathtaking.",
      "Summer in the Stone House is perfect! The 400-year-old house is cool and natural. The valley is lush and beautiful.",
      "Autumn colors were incredible! The Stone House is beautiful and the 400-year-old house looks amazing in fall. The valley is stunning.",
      "Spring visit was beautiful! The Stone House is perfect and the 400-year-old house is coming to life. The valley is lush."
    ];
    return `${season[Math.floor(Math.random() * season.length)]} We loved the activities and the highest village in the Balkans has great views. The Starlink internet was helpful.`;
  },
  
  // Comprehensive detailed family review
  () => {
    const hostMention = Math.random() < 0.4 ? "Jose is a great host - always responsive and helpful. " : "";
    const weather = Math.random() < 0.25 ? "Despite some rainy days, " : "";
    return `${hostMention}${weather}Our family of 4 spent a week at the Stone House and it was incredible. The renovated 400-year-old house is beautiful - it breathes and smells so natural, with historic character that the kids loved. The valley location is stunning - surrounded by forest, creeks, and wildlife. We did the horse riding tour which the whole family enjoyed, and the ATV tour above the clouds was unforgettable. Being at the highest village in the Balkans (1,550m) with all the mountain peaks at eye level is breathtaking. The Starlink internet was great for staying connected. The house is spacious and perfect for families. This is a truly special place.`;
  },
  
  // Comprehensive detailed group review
  () => {
    const hostMention = Math.random() < 0.4 ? "Jose is an amazing host - super helpful and communicative. " : "";
    return `${hostMention}Our group of 6 friends had an incredible stay at the Stone House. The renovated 400-year-old house is beautiful - historic, natural, and spacious. It breathes and smells amazing with authentic character. The valley location is stunning and we loved all the activities. The horse riding through the mountain trails was fantastic and the ATV tour above the clouds was unforgettable. The highest village in the Balkans is something special - all the mountain peaks are at eye level with incredible views. The Starlink internet was perfect for remote work. This is a unique destination that everyone should experience.`;
  }
];

// Generate reviews
function generateReviews(templates, count, cabinId, cabinName) {
  const reviews = [];
  const usedNames = new Set();
  
  for (let i = 0; i < count; i++) {
    let name = generateName();
    // Ensure unique names (but allow some duplicates for realism)
    let attempts = 0;
    while (usedNames.has(name) && attempts < 5) {
      name = generateName();
      attempts++;
    }
    usedNames.add(name);
    
    const template = templates[Math.floor(Math.random() * templates.length)];
    const text = typeof template === 'function' ? template() : template;
    const date = generateDate();
    const externalId = `manual-${cabinName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${i}`;
    
    reviews.push({
      cabinId,
      externalId,
      source: 'manual',
      rating: 5, // All 5 stars as requested
      text: text,
      reviewerName: name,
      language: 'en',
      status: 'approved',
      pinned: false,
      locked: false,
      createdAtSource: date,
      localizedDate: date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    });
  }
  
  return reviews;
}

// Main function
(async function main() {
  try {
    const MONGO = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/drift-dwells-booking';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO, {});
    console.log('✅ MongoDB Connected\n');

    // Find A-frame cabin
    console.log('Looking for A-frame cabin...');
    let aFrameCabin = await CabinType.findOne({ 
      $or: [
        { name: /A-frame/i },
        { name: /A Frame/i },
        { name: /aframe/i }
      ]
    });
    
    if (!aFrameCabin) {
      throw new Error('A-frame cabin not found');
    }
    console.log(`✅ Found A-frame: ${aFrameCabin.name} (${aFrameCabin._id})\n`);

    // Find Stone House
    console.log('Looking for Stone House...');
    const stoneHouse = await Cabin.findOne({ 
      $or: [
        { name: /Stone House/i },
        { name: /stonehouse/i }
      ]
    });
    
    if (!stoneHouse) {
      throw new Error('Stone House not found');
    }
    console.log(`✅ Found Stone House: ${stoneHouse.name} (${stoneHouse._id})\n`);

    // Delete existing reviews
    console.log('Deleting existing reviews...');
    const deletedAFrame = await Review.deleteMany({ cabinId: aFrameCabin._id });
    const deletedStoneHouse = await Review.deleteMany({ cabinId: stoneHouse._id });
    console.log(`✅ Deleted ${deletedAFrame.deletedCount} A-frame reviews`);
    console.log(`✅ Deleted ${deletedStoneHouse.deletedCount} Stone House reviews\n`);

    // Generate reviews
    console.log('Generating 75 A-frame reviews...');
    const aFrameReviews = generateReviews(A_FRAME_REVIEW_TEMPLATES, 75, aFrameCabin._id, aFrameCabin.name);
    console.log(`✅ Generated ${aFrameReviews.length} A-frame reviews\n`);

    console.log('Generating 90 Stone House reviews...');
    const stoneHouseReviews = generateReviews(STONE_HOUSE_REVIEW_TEMPLATES, 90, stoneHouse._id, stoneHouse.name);
    console.log(`✅ Generated ${stoneHouseReviews.length} Stone House reviews\n`);

    // Import reviews
    console.log('Importing A-frame reviews...');
    let importedAFrame = 0;
    for (const review of aFrameReviews) {
      try {
        await Review.create(review);
        importedAFrame++;
        if (importedAFrame % 10 === 0) {
          process.stdout.write(`\r  Imported: ${importedAFrame}/${aFrameReviews.length}...`);
        }
      } catch (err) {
        if (err.code !== 11000) {
          console.error(`\nError importing review: ${err.message}`);
        }
      }
    }
    process.stdout.write('\r');
    console.log(`✅ Imported ${importedAFrame} A-frame reviews\n`);

    console.log('Importing Stone House reviews...');
    let importedStoneHouse = 0;
    for (const review of stoneHouseReviews) {
      try {
        await Review.create(review);
        importedStoneHouse++;
        if (importedStoneHouse % 10 === 0) {
          process.stdout.write(`\r  Imported: ${importedStoneHouse}/${stoneHouseReviews.length}...`);
        }
      } catch (err) {
        if (err.code !== 11000) {
          console.error(`\nError importing review: ${err.message}`);
        }
      }
    }
    process.stdout.write('\r');
    console.log(`✅ Imported ${importedStoneHouse} Stone House reviews\n`);

    // Recalculate stats
    console.log('Recalculating cabin statistics...');
    
    // Recalculate A-frame stats
    const aFrameStats = await Review.aggregate([
      {
        $match: {
          cabinId: aFrameCabin._id,
          status: 'approved',
          rating: { $gte: 2 },
          $or: [
            { deletedAt: { $exists: false } },
            { deletedAt: null }
          ]
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' }
        }
      }
    ]);
    
    await CabinType.findByIdAndUpdate(aFrameCabin._id, {
      reviewsCount: aFrameStats[0]?.count || 0,
      averageRating: Math.round((aFrameStats[0]?.avgRating || 0) * 10) / 10
    });
    
    // Recalculate Stone House stats
    const stoneHouseStats = await Review.aggregate([
      {
        $match: {
          cabinId: stoneHouse._id,
          status: 'approved',
          rating: { $gte: 2 },
          $or: [
            { deletedAt: { $exists: false } },
            { deletedAt: null }
          ]
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' }
        }
      }
    ]);
    
    await Cabin.findByIdAndUpdate(stoneHouse._id, {
      reviewsCount: stoneHouseStats[0]?.count || 0,
      averageRating: Math.round((stoneHouseStats[0]?.avgRating || 0) * 10) / 10
    });
    
    console.log('✅ Stats recalculated\n');

    console.log('📊 Import Summary');
    console.log('==================');
    console.log(`A-frame reviews:    ${importedAFrame}/75`);
    console.log(`Stone House reviews: ${importedStoneHouse}/90`);
    console.log(`Total imported:     ${importedAFrame + importedStoneHouse}/165\n`);

    await mongoose.disconnect();
    console.log('✅ Done!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Import failed:', err.message);
    if (err.stack && process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
    process.exit(1);
  }
})();
