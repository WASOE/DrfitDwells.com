require('dotenv').config();
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells-booking');
    console.log('MongoDB Connected for seeding');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const sampleCabins = [
  {
    name: "Forest Haven",
    description: "A cozy cabin nestled in the heart of the Bulgarian forest, perfect for couples seeking tranquility. Features a wood-burning stove, private deck, and stunning mountain views.",
    capacity: 2,
    pricePerNight: 120,
    imageUrl: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000.jpg",
    location: "Rila Mountains, Bulgaria",
    amenities: ["Wood-burning stove", "Private deck", "Mountain views", "WiFi", "Kitchenette", "Parking"],
    blockedDates: [],
    transportOptions: [
      { type: "Horse", pricePerPerson: 50, description: "Traditional horse ride through forest trails", duration: "45 minutes", isAvailable: true },
      { type: "ATV", pricePerPerson: 100, description: "Adventure ride on all-terrain vehicle", duration: "30 minutes", isAvailable: true },
      { type: "Jeep", pricePerPerson: 50, description: "Comfortable 4x4 transport to the cabin", duration: "25 minutes", isAvailable: true },
      { type: "Hike", pricePerPerson: 0, description: "Scenic hiking trail through the mountains", duration: "2 hours", isAvailable: true }
    ]
  },
  {
    name: "Mountain Retreat",
    description: "Spacious family cabin with panoramic views of the Balkan Mountains. Ideal for families or groups up to 6 people. Features a large living area, full kitchen, and outdoor fire pit.",
    capacity: 6,
    pricePerNight: 180,
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4.jpg",
    location: "Balkan Mountains, Bulgaria",
    amenities: ["Full kitchen", "Outdoor fire pit", "Large living area", "WiFi", "Parking", "BBQ area", "Hiking trails access"],
    blockedDates: [],
    transportOptions: [
      { type: "Jeep", pricePerPerson: 60, description: "Family-friendly 4x4 transport", duration: "35 minutes", isAvailable: true },
      { type: "ATV", pricePerPerson: 120, description: "Exciting ATV adventure for the family", duration: "40 minutes", isAvailable: true },
      { type: "Hike", pricePerPerson: 0, description: "Family hiking trail with scenic views", duration: "1.5 hours", isAvailable: true }
    ]
  },
  {
    name: "Lakeside Sanctuary",
    description: "Charming cabin overlooking a pristine mountain lake. Perfect for nature lovers and photographers. Features a private dock, fishing equipment, and eco-friendly amenities.",
    capacity: 4,
    pricePerNight: 150,
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4.jpg",
    location: "Seven Rila Lakes, Bulgaria",
    amenities: ["Private dock", "Fishing equipment", "Eco-friendly", "WiFi", "Solar power", "Composting toilet", "Water access"],
    blockedDates: [],
    transportOptions: [
      { type: "Boat", pricePerPerson: 80, description: "Scenic boat ride across the lake", duration: "20 minutes", isAvailable: true },
      { type: "Hike", pricePerPerson: 0, description: "Peaceful lakeside hiking trail", duration: "1 hour", isAvailable: true },
      { type: "Jeep", pricePerPerson: 40, description: "Direct road access to the cabin", duration: "15 minutes", isAvailable: true }
    ]
  },
  {
    name: "Valley Vista",
    description: "Modern eco-cabin with floor-to-ceiling windows offering breathtaking valley views. Features sustainable design, rainwater collection, and organic garden access.",
    capacity: 3,
    pricePerNight: 140,
    imageUrl: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000.jpg",
    location: "Rhodope Mountains, Bulgaria",
    amenities: ["Floor-to-ceiling windows", "Sustainable design", "Rainwater collection", "Organic garden", "WiFi", "Composting", "Solar panels"],
    blockedDates: [],
    transportOptions: [
      { type: "Horse", pricePerPerson: 60, description: "Eco-friendly horse ride through the valley", duration: "50 minutes", isAvailable: true },
      { type: "Jeep", pricePerPerson: 45, description: "Sustainable transport to the eco-cabin", duration: "30 minutes", isAvailable: true },
      { type: "Hike", pricePerPerson: 0, description: "Nature trail through organic gardens", duration: "1.5 hours", isAvailable: true }
    ]
  },
  {
    name: "Wilderness Lodge",
    description: "Rustic cabin for true wilderness enthusiasts. No electricity, but includes gas lighting, wood stove, and access to pristine hiking trails. Perfect for digital detox.",
    capacity: 2,
    pricePerNight: 80,
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4.jpg",
    location: "Pirin National Park, Bulgaria",
    amenities: ["Gas lighting", "Wood stove", "Hiking trails", "Wildlife viewing", "No electricity", "Composting toilet", "Water from spring"],
    blockedDates: [],
    transportOptions: [
      { type: "Hike", pricePerPerson: 0, description: "Authentic wilderness hiking experience", duration: "3 hours", isAvailable: true },
      { type: "Horse", pricePerPerson: 70, description: "Traditional horse ride to the wilderness", duration: "2 hours", isAvailable: true }
    ]
  }
];

const seedDatabase = async () => {
  try {
    await connectDB();

    // Clear existing data
    await Cabin.deleteMany({});
    await Booking.deleteMany({});
    console.log('Cleared existing data');

    // Insert sample cabins
    const cabins = await Cabin.insertMany(sampleCabins);
    console.log(`Inserted ${cabins.length} cabins`);

    // Create some sample bookings for testing
    const sampleBookings = [
      {
        cabinId: cabins[0]._id,
        checkIn: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        checkOut: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
        adults: 2,
        children: 0,
        status: 'confirmed',
        guestInfo: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '+359 88 123 4567'
        },
        totalPrice: 360, // 3 nights * 120
        specialRequests: 'Please prepare the cabin for our anniversary'
      },
      {
        cabinId: cabins[1]._id,
        checkIn: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
        checkOut: new Date(Date.now() + 17 * 24 * 60 * 60 * 1000), // 17 days from now
        adults: 4,
        children: 2,
        status: 'pending',
        guestInfo: {
          firstName: 'Maria',
          lastName: 'Petrova',
          email: 'maria.petrova@example.com',
          phone: '+359 87 987 6543'
        },
        totalPrice: 540, // 3 nights * 180
        specialRequests: 'Family with young children, please provide high chair'
      }
    ];

    const bookings = await Booking.insertMany(sampleBookings);
    console.log(`Inserted ${bookings.length} sample bookings`);

    console.log('✅ Database seeded successfully!');
    console.log('\nSample data created:');
    console.log(`- ${cabins.length} cabins`);
    console.log(`- ${bookings.length} bookings`);
    console.log('\nYou can now start the server and test the booking system.');

  } catch (error) {
    console.error('Seeding error:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
