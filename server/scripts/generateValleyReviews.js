/* server/scripts/generateValleyReviews.js */
require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../models/Review');
const Cabin = require('../models/Cabin');

// Realistic first names for diversity
const FIRST_NAMES = [
  'Sarah', 'Michael', 'Emma', 'James', 'Olivia', 'David', 'Sophia', 'Daniel', 'Isabella', 'Matthew',
  'Emily', 'Christopher', 'Ava', 'Andrew', 'Mia', 'Joshua', 'Charlotte', 'Joseph', 'Amelia', 'William',
  'Harper', 'Alexander', 'Evelyn', 'Ryan', 'Abigail', 'Noah', 'Elizabeth', 'Ethan', 'Sofia', 'Benjamin',
  'Avery', 'Samuel', 'Ella', 'Jacob', 'Madison', 'Nathan', 'Scarlett', 'Jonathan', 'Victoria', 'Tyler',
  'Aria', 'Nicholas', 'Grace', 'Brandon', 'Chloe', 'Christian', 'Lily', 'Justin', 'Natalie', 'Kevin',
  'Zoe', 'Thomas', 'Hannah', 'Jason', 'Lillian', 'Eric', 'Addison', 'Brian', 'Aubrey', 'Adam',
  'Eleanor', 'Steven', 'Nora', 'Timothy', 'Layla', 'Richard', 'Riley', 'Charles', 'Zoey', 'Mark',
  'Penelope', 'Paul', 'Leah', 'George', 'Stella', 'Kenneth', 'Hazel', 'Jeremy', 'Ellie', 'Frank',
  'Paisley', 'Raymond', 'Lucy', 'Lawrence', 'Anna', 'Sean', 'Caroline', 'Patrick', 'Nova', 'Jack',
  'Claire', 'Dylan', 'Savannah', 'Jose', 'Aurora', 'Rachel', 'Matthew', 'Luna', 'Lucas', 'Willow'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee',
  'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams',
  'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips',
  'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris',
  'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera', 'Cooper', 'Richardson',
  'Cox', 'Howard', 'Ward', 'Torres', 'Peterson', 'Gray', 'Ramirez', 'James', 'Watson', 'Brooks',
  'Kelly', 'Sanders', 'Price', 'Bennett', 'Wood', 'Barnes', 'Ross', 'Henderson', 'Coleman', 'Jenkins'
];

// Generate realistic reviewer names
function generateName() {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  // Sometimes use couples/families
  if (Math.random() < 0.15) {
    const firstName2 = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    return `${firstName} & ${firstName2}`;
  }
  if (Math.random() < 0.05) {
    return `${firstName} ${lastName} Family`;
  }
  return `${firstName} ${lastName}`;
}

// Generate dates spread over the past 2 years
function generateDate() {
  const now = new Date();
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  const randomTime = twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime());
  return new Date(randomTime);
}

// A-Frame review templates (75 reviews)
const A_FRAME_REVIEW_TEMPLATES = [
  // Secret valley / once in a lifetime
  "This was truly a once-in-a-lifetime experience. The secret valley location is unlike anything I've ever seen. Surrounded by nothing but forest, the sound of creeks, and wildlife - it's pure magic.",
  "I've traveled extensively, but I've never been to a place like this. The valley feels completely removed from the world. The A-frame was perfect - simple, cozy, and exactly what we needed to disconnect.",
  "What an incredible hidden gem! The valley is absolutely breathtaking. Waking up to the sounds of nature and seeing the mountain peaks at eye level was surreal. The A-frame is beautifully minimal.",
  "This place is a secret paradise. The valley location is so remote and peaceful - just forest, animals, and the sound of water. The A-frame cabin was cozy and had everything we needed, including the toilet and shower which was great!",
  "Once in a lifetime doesn't even begin to describe this. The secret valley is magical - completely surrounded by nature with no other signs of civilization. The A-frame was perfect for our stay.",
  
  // Activities - horse riding, ATV
  "The horse riding experience was incredible! We rode through the forest trails and it felt like stepping back in time. The A-frame was cozy and the valley location is absolutely stunning.",
  "We did the ATV tour and it was amazing! Seeing the highest village in the Balkans from above the clouds was unforgettable. The A-frame cabin was perfect - simple, clean, and had great amenities.",
  "The activities here are fantastic. We went horseback riding through the mountains and did an ATV tour. The views of the highest village in the Balkans are breathtaking. The A-frame was cozy and comfortable.",
  "Horse riding through the valley was a highlight! The A-frame cabin was perfect - minimal design, great shower and toilet, and the internet worked well. The valley location is truly special.",
  "The ATV tour above the clouds was incredible! We saw all the mountain peaks at eye level. The A-frame was cozy and had everything we needed. This valley is a hidden treasure.",
  
  // Highest village / mountain peaks
  "Being at the highest inhabited village in the Balkans is surreal. All the mountain peaks are at eye level - the views are absolutely stunning. The A-frame was cozy and perfect.",
  "The altitude here is incredible - 1,550m! Seeing all the mountain peaks at eye level was breathtaking. The A-frame cabin was simple, clean, and had great amenities including internet.",
  "This is the highest village in the Balkans and you can feel it! The mountain peaks are right there at eye level. The A-frame was perfect - minimal, cozy, and had everything including toilet and shower.",
  "The views from this valley are indescribable. Being at 1,550m with all the peaks at eye level is something I'll never forget. The A-frame cabin was beautifully simple and comfortable.",
  "The highest village in the Balkans - what an experience! The mountain peaks surrounding you at eye level is incredible. The A-frame was cozy and had great amenities.",
  
  // Forest, animals, creeks
  "Surrounded by nothing but forest, the sound of creeks, and wildlife. This valley is pure nature. The A-frame was perfect - simple, clean, and had great facilities including internet.",
  "The forest here is incredible - so peaceful with just the sound of creeks and animals. The A-frame cabin was cozy and had everything we needed. The valley location is truly special.",
  "Waking up to the sound of creeks and forest animals was magical. The valley is completely surrounded by nature. The A-frame was perfect - minimal design with great amenities.",
  "The natural setting here is breathtaking - pure forest, creeks, and wildlife. The A-frame was cozy and comfortable. Having internet and proper facilities made it even better.",
  "This valley is nature at its finest - forest, creeks, and animals everywhere. The A-frame cabin was simple and perfect. The toilet, shower, and internet were great additions.",
  
  // Stargazing / night sky
  "The stargazing here is incredible! With no light pollution, the night sky is breathtaking. The A-frame was cozy and the valley location is perfect for disconnecting.",
  "We spent hours stargazing - the night sky here is unlike anything I've seen. The A-frame cabin was perfect and had great amenities. The valley is truly magical.",
  "The stars at night are incredible! The A-frame's large window was perfect for stargazing. The valley location is so peaceful and the facilities were great.",
  "Stargazing from the A-frame was unforgettable. The night sky is crystal clear. The valley is so remote and peaceful - perfect for a digital detox while still having internet when needed.",
  
  // Internet / facilities
  "Great to have internet here! The A-frame was cozy and had everything - toilet, shower, and connectivity. The valley location is stunning and the activities are fantastic.",
  "The A-frame had all the modern comforts we needed - toilet, shower, and internet - while still feeling completely immersed in nature. The valley is breathtaking.",
  "Perfect balance of nature and comfort. The A-frame had great facilities including internet, which was helpful. The valley location is incredible and the activities are amazing.",
  "The A-frame was cozy with great amenities - toilet, shower, and internet. The valley location is stunning and we loved the horse riding and ATV tours.",
  
  // General positive
  "Absolutely loved our stay! The A-frame was perfect - simple, cozy, and had everything we needed. The valley location is stunning and the activities are fantastic.",
  "This was exactly what we needed. The A-frame cabin was beautiful and minimal. The valley is peaceful and the activities like horse riding were incredible.",
  "Perfect getaway! The A-frame was cozy and comfortable. The valley location is stunning and we loved exploring the highest village in the Balkans.",
  "Incredible experience! The A-frame was perfect - simple design, great amenities. The valley is magical and the mountain views are breathtaking.",
  "We had an amazing time! The A-frame cabin was cozy and had everything we needed. The valley location is stunning and the activities are fantastic.",
  "This place is special. The A-frame was perfect - minimal, clean, and comfortable. The valley is beautiful and the mountain peaks at eye level are incredible.",
  "Loved every moment! The A-frame was cozy and had great facilities. The valley location is stunning and we enjoyed the horse riding and ATV tours.",
  "Perfect escape! The A-frame cabin was beautiful and simple. The valley is peaceful and the views of the highest village in the Balkans are amazing.",
  "Incredible stay! The A-frame was cozy and comfortable. The valley location is stunning and we loved the forest, creeks, and wildlife.",
  "Amazing experience! The A-frame was perfect - minimal design, great amenities. The valley is magical and the activities are fantastic.",
  
  // Longer detailed reviews
  "We spent three nights in the A-frame and it was incredible. The secret valley location is unlike anything - completely surrounded by forest with just the sound of creeks and animals. The cabin itself is beautifully minimal with everything you need - toilet, shower, and even internet. We did the horse riding tour and an ATV adventure, both were amazing. Seeing the highest village in the Balkans from above the clouds was unforgettable. All the mountain peaks are at eye level here - the views are breathtaking. This is truly a once-in-a-lifetime experience.",
  "This was our second visit and it was just as magical. The A-frame is perfect - simple, cozy, and has all the amenities you need. The valley location is stunning - pure nature with forest, creeks, and wildlife everywhere. We loved the horse riding through the trails and the ATV tour was incredible. Being at 1,550m with all the peaks at eye level is surreal. The internet worked great which was helpful. This place is a hidden treasure.",
  "What an incredible find! The secret valley is absolutely magical - surrounded by nothing but nature. The A-frame cabin was perfect - minimal design, cozy, and had great facilities including toilet, shower, and internet. We did both the horse riding and ATV tours - both were fantastic. The highest village in the Balkans is something special, and seeing all the mountain peaks at eye level is breathtaking. This is a once-in-a-lifetime experience.",
  "We came for a weekend and ended up staying longer. The A-frame is beautiful - simple, clean, and comfortable. The valley location is stunning - pure forest, creeks, and wildlife. The activities are fantastic - horse riding through the mountains and ATV tours above the clouds. The views of the highest village in the Balkans are incredible, and having all the peaks at eye level is surreal. Great amenities too - toilet, shower, and internet. Highly recommend!",
  "This place exceeded all expectations. The secret valley location is breathtaking - completely surrounded by nature with no signs of civilization. The A-frame cabin was perfect - minimal, cozy, and had everything we needed. We loved the horse riding and ATV tours. Being at the highest village in the Balkans with all the peaks at eye level is something I'll never forget. The facilities were great - toilet, shower, and internet. Truly a once-in-a-lifetime experience.",
  
  // Seasonal variations
  "Winter stay was magical! The A-frame was cozy and warm. The valley covered in snow is breathtaking. We did the ATV tour and saw the highest village in the Balkans - incredible views. The mountain peaks at eye level covered in snow are stunning.",
  "Summer in the valley is perfect! The A-frame was comfortable and the forest is lush. We loved the horse riding and the creeks are beautiful. The highest village in the Balkans has amazing views. Great facilities including internet.",
  "Autumn colors were incredible! The A-frame was cozy and the valley is stunning in fall. We did both horse riding and ATV tours - both amazing. The mountain peaks at eye level with autumn colors are breathtaking.",
  "Spring visit was beautiful! The A-frame was perfect and the valley is coming to life. The forest, creeks, and wildlife are amazing. We loved the activities and the views of the highest village in the Balkans.",
  
  // Solo travelers
  "Perfect for a solo retreat! The A-frame was cozy and peaceful. The valley location is stunning - pure nature with forest and creeks. I loved the horse riding and the views of the highest village in the Balkans. Great facilities too.",
  "Solo stay was incredible! The A-frame is perfect for one person - cozy, simple, and comfortable. The valley is so peaceful and the mountain peaks at eye level are breathtaking. Great amenities including internet.",
  
  // Couples
  "Perfect romantic getaway! The A-frame was cozy and intimate. The valley location is stunning and we loved stargazing. The horse riding was romantic and the views are incredible. Great facilities including toilet and shower.",
  "Amazing couples retreat! The A-frame was perfect for two. The secret valley location is magical and we loved the activities. The highest village in the Balkans has incredible views. Great amenities and internet.",
  
  // Digital nomads
  "Great for remote work! The A-frame had internet which was perfect. The valley location is stunning and peaceful. I worked during the day and explored in the evenings. The horse riding and ATV tours were amazing.",
  "Perfect workation spot! The A-frame had great internet and the valley is peaceful. The highest village in the Balkans has incredible views. I loved the balance of work and nature. Great facilities.",
  
  // Adventure seekers
  "Adventure paradise! The A-frame was our base for exploring. The valley location is perfect for outdoor activities. We did horse riding, ATV tours, and hiking. The highest village in the Balkans has amazing views.",
  "Incredible adventure base! The A-frame was cozy and comfortable. The valley is perfect for activities - we did everything! The mountain peaks at eye level are breathtaking. Great facilities.",
  
  // Nature lovers
  "Nature lover's paradise! The A-frame is surrounded by pure forest, creeks, and wildlife. The valley location is stunning. We loved the horse riding and seeing the highest village in the Balkans. Perfect escape.",
  "Perfect for nature lovers! The A-frame is in the heart of nature. The valley is beautiful with forest, creeks, and animals everywhere. The mountain peaks at eye level are incredible. Great facilities.",
  
  // Repeat visitors
  "Our third visit and it gets better every time! The A-frame is perfect and the valley is stunning. We love the activities and the highest village in the Balkans. The mountain peaks at eye level never get old.",
  "Came back for more! The A-frame was just as perfect. The secret valley location is magical and we did all the activities again. The highest village in the Balkans has incredible views. Highly recommend!",
  
  // Photography
  "Photographer's dream! The A-frame and valley are incredibly photogenic. The mountain peaks at eye level make for stunning shots. The highest village in the Balkans is beautiful. Great facilities too.",
  "Incredible photography opportunities! The A-frame, valley, and mountain views are stunning. The highest village in the Balkans is perfect for photos. Great amenities and activities.",
  
  // Peace and quiet
  "Perfect peace and quiet! The A-frame is in a stunning valley location. Just forest, creeks, and nature. The highest village in the Balkans is peaceful. Great facilities including internet when needed.",
  "Ultimate peace! The A-frame is surrounded by pure nature. The valley is so quiet and peaceful. The mountain peaks at eye level are calming. Great amenities and activities.",
  
  // Unique experience
  "Most unique place I've stayed! The A-frame in this secret valley is incredible. The highest village in the Balkans is something special. The mountain peaks at eye level are breathtaking. Great facilities.",
  "Truly unique experience! The A-frame and valley location are one-of-a-kind. The highest village in the Balkans is amazing. The activities are fantastic. Great amenities including internet.",
  
  // Value
  "Incredible value! The A-frame is perfect and the valley location is stunning. The activities are great and the highest village in the Balkans has amazing views. Great facilities too.",
  "Great value for money! The A-frame was cozy and comfortable. The valley is beautiful and the activities are fantastic. The highest village in the Balkans is incredible. Highly recommend!",
  
  // Host
  "Jose is an amazing host! The A-frame was perfect and the valley location is stunning. He helped us with activities and the highest village in the Balkans. Great facilities and internet.",
  "Wonderful host! Jose made our stay special. The A-frame was cozy and the valley is beautiful. The activities were fantastic and the highest village in the Balkans is incredible. Great amenities.",
  
  // Detailed experience
  "We spent a week here and it was incredible. The A-frame is perfectly minimal with everything you need - toilet, shower, and internet. The secret valley location is breathtaking - pure forest, creeks, and wildlife. We did the horse riding tour which was amazing, and the ATV tour above the clouds was unforgettable. Being at the highest village in the Balkans (1,550m) with all the mountain peaks at eye level is surreal. The stargazing is incredible with no light pollution. This is truly a once-in-a-lifetime experience that we'll never forget.",
  "This place is magical. The A-frame cabin is beautifully simple and cozy, with great amenities including toilet, shower, and internet. The valley location is stunning - completely surrounded by nature with just forest, creeks, and animals. We did both the horse riding and ATV tours - both were fantastic. The highest village in the Balkans is something special, and seeing all the mountain peaks at eye level is breathtaking. The activities are well-organized and the views are incredible. This is a hidden treasure that everyone should experience.",
  "Incredible stay! The A-frame was perfect - minimal design, cozy, and had all the amenities we needed. The secret valley location is unlike anything - pure nature with forest, creeks, and wildlife everywhere. We loved the horse riding through the mountain trails and the ATV tour was amazing. Being at 1,550m with all the peaks at eye level is surreal. The highest village in the Balkans has incredible views. The internet worked great which was helpful. This is truly a once-in-a-lifetime experience that exceeded all expectations."
];

// Stone House review templates (90 reviews) - families and groups
const STONE_HOUSE_REVIEW_TEMPLATES = [
  // Families of 4
  "Perfect for our family of 4! The Stone House is incredible - a renovated 400-year-old house that breathes and smells so natural. The kids loved exploring the valley and we all enjoyed the activities. The highest village in the Balkans has amazing views.",
  "Our family of 4 had an amazing time! The Stone House is beautiful - historic, natural, and spacious. The valley location is stunning and the activities are perfect for families. The highest village in the Balkans is incredible.",
  "Great family stay! The Stone House accommodated our family of 4 perfectly. The 400-year-old house has such character and natural beauty. The valley is beautiful and the kids loved the horse riding and ATV tours.",
  "Perfect family getaway! The Stone House is spacious and beautiful - a renovated 400-year-old house that feels so natural. Our family of 4 loved it. The valley location is stunning and the activities are fantastic.",
  "Amazing family experience! The Stone House is incredible - historic, natural, and perfect for families. Our 4-person family had plenty of space. The valley is beautiful and the highest village in the Balkans has great views.",
  "Our family of 4 loved it! The Stone House is beautiful - a 400-year-old house that breathes naturally. The valley location is stunning and we all enjoyed the activities. The highest village in the Balkans is special.",
  "Perfect for families! The Stone House accommodated our family of 4 comfortably. The historic house has such natural character. The valley is beautiful and the activities are great for kids and adults.",
  "Family of 4 had a wonderful time! The Stone House is spacious and beautiful. The 400-year-old house feels so natural and authentic. The valley location is stunning and the activities are fantastic.",
  "Great family stay! The Stone House is perfect for our family of 4. The historic house is beautiful and natural. The valley is stunning and we loved the horse riding and ATV tours. The highest village in the Balkans is incredible.",
  "Amazing family experience! The Stone House is incredible - a renovated 400-year-old house that's perfect for families. Our 4-person family had plenty of space. The valley is beautiful and the activities are fantastic.",
  
  // Groups of friends
  "Perfect for our group of friends! The Stone House is incredible - a renovated 400-year-old house with so much character. The natural stone and wood smell amazing. The valley location is stunning and the activities are fantastic.",
  "Our group of 6 friends had an amazing time! The Stone House is spacious and beautiful. The 400-year-old house breathes naturally and has such character. The valley is stunning and we loved the activities.",
  "Great for groups! The Stone House accommodated our group of friends perfectly. The historic house is beautiful and natural. The valley location is stunning and the activities like horse riding and ATV are amazing.",
  "Perfect friends getaway! The Stone House is incredible - a 400-year-old house that feels so authentic. Our group loved it. The valley is beautiful and the highest village in the Balkans has incredible views.",
  "Amazing group stay! The Stone House is spacious and perfect for groups. The renovated 400-year-old house has natural beauty. The valley location is stunning and the activities are fantastic.",
  "Our group of friends loved it! The Stone House is beautiful - historic, natural, and spacious. The 400-year-old house breathes and smells amazing. The valley is stunning and we enjoyed all the activities.",
  "Great for friend groups! The Stone House is perfect - a renovated 400-year-old house with character. Our group had plenty of space. The valley is beautiful and the activities are amazing.",
  "Perfect group experience! The Stone House is incredible - a 400-year-old house that's natural and beautiful. Our friends loved it. The valley location is stunning and the highest village in the Balkans is special.",
  "Amazing friends retreat! The Stone House is spacious and beautiful. The historic house feels so natural and authentic. The valley is stunning and the activities are fantastic.",
  "Our group had a wonderful time! The Stone House is perfect for groups. The 400-year-old house is beautiful and natural. The valley location is stunning and we loved the horse riding and ATV tours.",
  
  // Historic house / natural
  "The Stone House is incredible - a renovated 400-year-old house that breathes and smells so natural. The historic character is amazing. The valley location is stunning and the activities are fantastic.",
  "This 400-year-old house is beautiful! The Stone House has been renovated perfectly while keeping its natural character. It breathes and smells amazing. The valley is stunning and the highest village in the Balkans is incredible.",
  "The historic Stone House is stunning! A renovated 400-year-old house that feels so natural and authentic. The valley location is beautiful and the activities are amazing.",
  "Incredible historic house! The Stone House is a 400-year-old renovation that breathes naturally. The natural stone and wood smell amazing. The valley is stunning and we loved the activities.",
  "The Stone House is beautiful - a 400-year-old house that's been renovated with care. It breathes and smells so natural. The valley location is stunning and the highest village in the Balkans is special.",
  "Amazing historic character! The Stone House is a renovated 400-year-old house that feels authentic. The natural materials breathe and smell incredible. The valley is beautiful and the activities are fantastic.",
  "The Stone House is incredible - 400 years of history in a beautiful renovation. It breathes naturally and smells amazing. The valley location is stunning and we loved the activities.",
  "Perfect historic house! The Stone House is a renovated 400-year-old building with natural beauty. It breathes and has such character. The valley is stunning and the highest village in the Balkans is incredible.",
  "The Stone House is beautiful - a 400-year-old house that's been renovated perfectly. The natural materials breathe and smell amazing. The valley location is stunning and the activities are fantastic.",
  "Incredible renovation! The Stone House is a 400-year-old house that breathes naturally. The historic character is amazing. The valley is beautiful and we loved the horse riding and ATV tours.",
  
  // Valley activities
  "The Stone House is perfect and the valley activities are amazing! We did horse riding and ATV tours - both incredible. The highest village in the Balkans has stunning views. The 400-year-old house is beautiful.",
  "Great activities in the valley! The Stone House was our base and it's beautiful - a renovated 400-year-old house. We loved the horse riding and ATV tours. The highest village in the Balkans is special.",
  "The valley activities are fantastic! The Stone House is incredible - historic and natural. We did horse riding through the mountains and ATV tours above the clouds. The highest village in the Balkans has amazing views.",
  "Amazing activities! The Stone House is perfect - a 400-year-old house that breathes naturally. We loved the horse riding and ATV tours. The valley location is stunning and the highest village in the Balkans is incredible.",
  "The activities here are incredible! The Stone House is beautiful and spacious. We did horse riding and ATV tours - both amazing. The 400-year-old house is historic and natural. The highest village in the Balkans is special.",
  "Perfect activities! The Stone House accommodated our group perfectly. We loved the horse riding and ATV tours. The 400-year-old house is beautiful and natural. The valley is stunning.",
  "Great activities in the valley! The Stone House is incredible - a renovated 400-year-old house. We did horse riding and ATV tours - both fantastic. The highest village in the Balkans has incredible views.",
  "The valley activities are amazing! The Stone House is perfect for groups. We loved the horse riding and ATV tours. The 400-year-old house is historic and natural. The highest village in the Balkans is beautiful.",
  "Incredible activities! The Stone House is spacious and beautiful. We did horse riding through the mountains and ATV tours above the clouds. The 400-year-old house breathes naturally. The valley is stunning.",
  "Amazing activities! The Stone House is perfect - a renovated 400-year-old house. We loved the horse riding and ATV tours. The valley location is stunning and the highest village in the Balkans is incredible.",
  
  // Highest village / mountain peaks
  "The Stone House is beautiful and the highest village in the Balkans is incredible! All the mountain peaks are at eye level - the views are breathtaking. The 400-year-old house is historic and natural.",
  "Being at the highest village in the Balkans is surreal! The Stone House is perfect - a renovated 400-year-old house. The mountain peaks at eye level are stunning. The valley location is beautiful.",
  "The highest village in the Balkans is amazing! The Stone House is incredible - a 400-year-old house that breathes naturally. The mountain peaks at eye level are breathtaking. The valley is stunning.",
  "Incredible views! The Stone House is beautiful and the highest village in the Balkans is special. All the peaks at eye level are stunning. The 400-year-old house is historic and natural.",
  "The highest village in the Balkans is incredible! The Stone House is perfect - a renovated 400-year-old house. The mountain peaks at eye level are breathtaking. The valley location is beautiful.",
  "Amazing altitude! The Stone House is beautiful and being at the highest village in the Balkans is surreal. The peaks at eye level are stunning. The 400-year-old house is historic and natural.",
  "The highest village in the Balkans is special! The Stone House is incredible - a 400-year-old house that breathes naturally. The mountain peaks at eye level are breathtaking. The valley is stunning.",
  "Incredible location! The Stone House is perfect and the highest village in the Balkans is amazing. All the peaks at eye level are stunning. The 400-year-old house is historic and beautiful.",
  "The highest village in the Balkans is incredible! The Stone House is beautiful - a renovated 400-year-old house. The mountain peaks at eye level are breathtaking. The valley location is stunning.",
  "Amazing views! The Stone House is perfect and the highest village in the Balkans is special. The peaks at eye level are stunning. The 400-year-old house is historic and natural.",
  
  // Starlink / internet
  "The Stone House has Starlink internet which was perfect! The 400-year-old house is beautiful and natural. The valley location is stunning and the activities are fantastic. The highest village in the Balkans is incredible.",
  "Great internet at the Stone House! The renovated 400-year-old house is beautiful and breathes naturally. The valley is stunning and we loved the activities. The highest village in the Balkans has amazing views.",
  "Perfect for remote work! The Stone House has Starlink internet and the 400-year-old house is beautiful. The valley location is stunning and the activities are amazing. The highest village in the Balkans is special.",
  "The Stone House has great internet! The 400-year-old house is historic and natural. The valley is beautiful and we loved the horse riding and ATV tours. The highest village in the Balkans is incredible.",
  "Starlink internet was perfect! The Stone House is beautiful - a renovated 400-year-old house. The valley location is stunning and the activities are fantastic. The highest village in the Balkans has amazing views.",
  
  // Spacious / groups
  "The Stone House is spacious and perfect for groups! The 400-year-old house is beautiful and natural. The valley location is stunning and the activities are amazing. The highest village in the Balkans is incredible.",
  "Perfect for large groups! The Stone House is spacious and beautiful. The renovated 400-year-old house breathes naturally. The valley is stunning and we loved the activities.",
  "Great for groups! The Stone House accommodated our group perfectly. The 400-year-old house is historic and natural. The valley location is stunning and the activities are fantastic.",
  "Spacious and beautiful! The Stone House is perfect for groups. The 400-year-old house is renovated beautifully and breathes naturally. The valley is stunning and the highest village in the Balkans is special.",
  "Perfect group accommodation! The Stone House is spacious and beautiful. The 400-year-old house has natural character. The valley location is stunning and the activities are amazing.",
  
  // Detailed family reviews
  "Our family of 4 spent a week here and it was incredible. The Stone House is a renovated 400-year-old house that breathes and smells so natural - the kids loved the historic character. The valley location is stunning with forest, creeks, and wildlife. We did the horse riding tour which the whole family enjoyed, and the ATV tour was amazing. Being at the highest village in the Balkans (1,550m) with all the mountain peaks at eye level is breathtaking. The Starlink internet was great for the kids. This is a perfect family adventure.",
  "Perfect family experience! The Stone House accommodated our family of 4 comfortably. The 400-year-old house is beautiful - historic, natural, and spacious. The valley is stunning and we all loved the activities. The horse riding was great for the kids and the ATV tour was exciting. The highest village in the Balkans has incredible views with all the peaks at eye level. The Starlink internet was helpful. Highly recommend for families!",
  "Amazing family stay! The Stone House is perfect for families - spacious, historic, and natural. Our family of 4 loved the 400-year-old house that breathes and smells amazing. The valley location is stunning and the activities are fantastic. The kids loved the horse riding and we all enjoyed the ATV tour. The highest village in the Balkans is incredible with mountain peaks at eye level. Great facilities including Starlink internet. This is a special place for families.",
  
  // Detailed group reviews
  "Our group of 6 friends had an incredible stay! The Stone House is spacious and beautiful - a renovated 400-year-old house that breathes and smells so natural. The valley location is stunning and we loved all the activities. The horse riding through the mountains was amazing and the ATV tour above the clouds was unforgettable. Being at the highest village in the Balkans with all the peaks at eye level is surreal. The Starlink internet was great. This is a perfect group getaway.",
  "Perfect friends retreat! The Stone House accommodated our group of 8 perfectly. The 400-year-old house is incredible - historic, natural, and spacious. The valley is beautiful and the activities are fantastic. We did horse riding and ATV tours - both amazing. The highest village in the Balkans has stunning views with mountain peaks at eye level. The Starlink internet was helpful. Highly recommend for groups!",
  "Amazing group experience! The Stone House is perfect for groups - spacious, beautiful, and historic. Our group of friends loved the 400-year-old house that breathes naturally. The valley location is stunning and we enjoyed all the activities. The horse riding and ATV tours were incredible. The highest village in the Balkans is special with all the peaks at eye level. Great facilities including Starlink internet. This is a unique group destination.",
  
  // Coworking / digital nomads
  "Perfect for remote work! The Stone House has Starlink internet and coworking space. The 400-year-old house is beautiful and natural. The valley location is stunning and the activities are amazing. The highest village in the Balkans is incredible.",
  "Great coworking space! The Stone House is perfect for digital nomads. The 400-year-old house is historic and natural. The Starlink internet is fast and the valley is beautiful. The activities are fantastic.",
  "Perfect workation! The Stone House has great coworking facilities and Starlink internet. The 400-year-old house is beautiful and breathes naturally. The valley is stunning and the highest village in the Balkans is special.",
  
  // Seasonal
  "Winter stay was magical! The Stone House is cozy and warm. The 400-year-old house is beautiful in winter. The valley covered in snow is breathtaking. The highest village in the Balkans has incredible winter views.",
  "Summer in the Stone House is perfect! The 400-year-old house is cool and natural. The valley is lush and beautiful. We loved the activities and the highest village in the Balkans has amazing summer views.",
  "Autumn colors were incredible! The Stone House is beautiful and the 400-year-old house looks amazing in fall. The valley is stunning with autumn colors. The highest village in the Balkans is special.",
  "Spring visit was beautiful! The Stone House is perfect and the 400-year-old house is coming to life. The valley is lush and the activities are amazing. The highest village in the Balkans has great spring views.",
  
  // General positive
  "Absolutely loved our stay! The Stone House is incredible - a renovated 400-year-old house that's beautiful and natural. The valley location is stunning and the activities are fantastic. The highest village in the Balkans is special.",
  "This was exactly what we needed! The Stone House is perfect - historic, natural, and spacious. The valley is beautiful and we loved the activities. The highest village in the Balkans has incredible views.",
  "Perfect getaway! The Stone House is beautiful - a 400-year-old house that breathes naturally. The valley location is stunning and the activities are amazing. The highest village in the Balkans is incredible.",
  "Incredible experience! The Stone House is perfect - a renovated 400-year-old house with natural beauty. The valley is stunning and we loved the horse riding and ATV tours. The highest village in the Balkans is special.",
  "We had an amazing time! The Stone House is beautiful and spacious. The 400-year-old house is historic and natural. The valley location is stunning and the activities are fantastic.",
  "This place is special! The Stone House is incredible - a 400-year-old house that breathes and smells amazing. The valley is beautiful and the highest village in the Balkans has stunning views.",
  "Loved every moment! The Stone House is perfect - historic, natural, and comfortable. The valley location is stunning and we enjoyed all the activities. The highest village in the Balkans is incredible.",
  "Perfect escape! The Stone House is beautiful - a renovated 400-year-old house. The valley is peaceful and the activities are fantastic. The highest village in the Balkans has amazing views.",
  "Incredible stay! The Stone House is spacious and comfortable. The 400-year-old house is historic and natural. The valley location is stunning and we loved the activities.",
  "Amazing experience! The Stone House is perfect - a 400-year-old house that breathes naturally. The valley is beautiful and the activities are fantastic. The highest village in the Balkans is special.",
  
  // Host
  "Jose is an amazing host! The Stone House is beautiful and he helped us with everything. The 400-year-old house is incredible. The valley is stunning and the activities are fantastic. The highest village in the Balkans is special.",
  "Wonderful host! Jose made our stay perfect. The Stone House is beautiful - a renovated 400-year-old house. The valley is stunning and we loved the activities. The highest village in the Balkans has incredible views.",
  "Great host! Jose is helpful and friendly. The Stone House is perfect - a 400-year-old house that breathes naturally. The valley is beautiful and the activities are amazing. The highest village in the Balkans is incredible.",
  
  // Value
  "Incredible value! The Stone House is spacious and beautiful. The 400-year-old house is historic and natural. The valley is stunning and the activities are fantastic. The highest village in the Balkans is special.",
  "Great value for money! The Stone House is perfect - a renovated 400-year-old house. The valley is beautiful and the activities are amazing. The highest village in the Balkans has incredible views. Highly recommend!",
  
  // Repeat visitors
  "Our second visit and it was just as amazing! The Stone House is perfect - a 400-year-old house that breathes naturally. The valley is stunning and we did all the activities again. The highest village in the Balkans is incredible.",
  "Came back with friends! The Stone House is beautiful and spacious. The 400-year-old house is historic and natural. The valley is stunning and the activities are fantastic. The highest village in the Balkans is special.",
  
  // Photography
  "Photographer's dream! The Stone House is incredibly photogenic - a 400-year-old house with natural beauty. The valley and mountain views are stunning. The highest village in the Balkans is perfect for photos.",
  "Incredible photography opportunities! The Stone House, valley, and mountain views are stunning. The 400-year-old house is beautiful. The highest village in the Balkans is perfect for photos.",
  
  // Peace and quiet
  "Perfect peace and quiet! The Stone House is in a stunning valley location. The 400-year-old house is peaceful and natural. The highest village in the Balkans is quiet. Great for relaxation.",
  "Ultimate peace! The Stone House is surrounded by nature. The 400-year-old house is peaceful and breathes naturally. The valley is quiet and the highest village in the Balkans is calming.",
  
  // Unique experience
  "Most unique place I've stayed! The Stone House is a 400-year-old house that's incredible. The valley location is stunning and the highest village in the Balkans is special. The activities are fantastic.",
  "Truly unique experience! The Stone House and valley location are one-of-a-kind. The 400-year-old house is historic and natural. The highest village in the Balkans is amazing. The activities are great.",
  
  // Detailed comprehensive
  "We spent a week at the Stone House with our family of 4 and it was incredible. The renovated 400-year-old house is beautiful - it breathes and smells so natural, with historic character that the kids loved. The valley location is stunning - surrounded by forest, creeks, and wildlife. We did the horse riding tour which the whole family enjoyed, and the ATV tour above the clouds was unforgettable. Being at the highest village in the Balkans (1,550m) with all the mountain peaks at eye level is breathtaking. The Starlink internet was great for staying connected. The house is spacious and perfect for families. This is a truly special place.",
  "Our group of 6 friends had an amazing stay at the Stone House. The renovated 400-year-old house is incredible - historic, natural, and spacious. It breathes and smells amazing with authentic character. The valley location is stunning and we loved all the activities. The horse riding through the mountain trails was fantastic and the ATV tour above the clouds was unforgettable. The highest village in the Balkans is something special - all the mountain peaks are at eye level with incredible views. The Starlink internet was perfect for remote work. This is a unique destination that everyone should experience.",
  "The Stone House exceeded all expectations. This renovated 400-year-old house is beautiful - it breathes and smells so natural, with historic character that's incredible. The valley location is stunning - pure nature with forest, creeks, and wildlife. We did both the horse riding and ATV tours - both were amazing. Being at the highest village in the Balkans with all the peaks at eye level is surreal. The house is spacious and perfect for families or groups. The Starlink internet was great. This is a once-in-a-lifetime experience that we'll never forget."
];

// Generate reviews
function generateReviews(templates, count, cabinId, cabinName) {
  const reviews = [];
  const usedNames = new Set();
  
  for (let i = 0; i < count; i++) {
    let name = generateName();
    // Ensure unique names
    let attempts = 0;
    while (usedNames.has(name) && attempts < 10) {
      name = generateName();
      attempts++;
    }
    usedNames.add(name);
    
    const template = templates[Math.floor(Math.random() * templates.length)];
    const date = generateDate();
    const externalId = `manual-${cabinName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${i}`;
    
    reviews.push({
      cabinId,
      externalId,
      source: 'manual',
      rating: 5,
      text: template,
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

    // Find A-frame cabin (could be CabinType or Cabin)
    console.log('Looking for A-frame cabin...');
    let aFrameCabin = await Cabin.findOne({ 
      $or: [
        { name: /A-frame/i },
        { name: /A Frame/i },
        { name: /aframe/i }
      ]
    });
    
    // If not found, try CabinType
    if (!aFrameCabin) {
      const CabinType = require('../models/CabinType');
      aFrameCabin = await CabinType.findOne({ 
        $or: [
          { name: /A-frame/i },
          { name: /A Frame/i },
          { name: /aframe/i }
        ]
      });
    }
    
    if (!aFrameCabin) {
      console.log('⚠️  A-frame not found. Available cabins:');
      const allCabins = await Cabin.find({}, 'name');
      allCabins.forEach(c => console.log(`  - ${c.name}`));
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
      console.log('⚠️  Stone House not found. Available cabins:');
      const allCabins = await Cabin.find({}, 'name');
      allCabins.forEach(c => console.log(`  - ${c.name}`));
      throw new Error('Stone House not found');
    }
    console.log(`✅ Found Stone House: ${stoneHouse.name} (${stoneHouse._id})\n`);

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
        if (err.code !== 11000) { // Skip duplicate key errors
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
          deletedAt: { $exists: false }
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
    
    if (aFrameCabin.constructor.modelName === 'Cabin') {
      await Cabin.findByIdAndUpdate(aFrameCabin._id, {
        reviewsCount: aFrameStats[0]?.count || 0,
        averageRating: Math.round((aFrameStats[0]?.avgRating || 0) * 10) / 10
      });
    }
    
    // Recalculate Stone House stats
    const stoneHouseStats = await Review.aggregate([
      {
        $match: {
          cabinId: stoneHouse._id,
          status: 'approved',
          rating: { $gte: 2 },
          deletedAt: { $exists: false }
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
