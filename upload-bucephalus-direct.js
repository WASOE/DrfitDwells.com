#!/usr/bin/env node
/**
 * Direct upload script - uploads images directly to database and file system
 * No admin token required - uses same logic as admin API
 * Usage: node upload-bucephalus-direct.js [path-to-images]
 */

const fs = require('fs');
const path = require('path');

// Add server node_modules to path
const serverPath = path.join(__dirname, 'server');
process.env.NODE_PATH = path.join(serverPath, 'node_modules') + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
require('module').Module._initPaths();

const mongoose = require('mongoose');
const Cabin = require(path.join(serverPath, 'models', 'Cabin'));

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, 'server', '.env') });

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/drift-dwells';
const IMAGES_DIR = process.argv[2] || '/home/wasoe/Pictures/Cabin pictures';

async function findBucephalusCabin() {
  try {
    // Try exact match first
    let cabin = await Cabin.findOne({ name: /bucephalus/i });
    
    if (!cabin) {
      // List all cabins to help debug
      const allCabins = await Cabin.find({}).select('name _id').limit(10);
      console.log('Available cabins in database:');
      allCabins.forEach(c => console.log(`  - ${c.name} (ID: ${c._id})`));
      
      // Try case-insensitive partial match
      cabin = await Cabin.findOne({ name: { $regex: /bucephalus/i } });
    }
    
    if (!cabin) {
      throw new Error('Bucephalus cabin not found in database');
    }
    return cabin;
  } catch (error) {
    throw new Error(`Error finding cabin: ${error.message}`);
  }
}

async function deleteExistingImages(cabinId) {
  try {
    const cabin = await Cabin.findById(cabinId);
    if (!cabin) {
      throw new Error('Cabin not found');
    }

    // Delete physical files from both possible locations
    const uploadsDir1 = path.join(__dirname, 'uploads', 'cabins', cabinId.toString());
    const uploadsDir2 = path.join(__dirname, 'server', 'uploads', 'cabins', cabinId.toString());
    
    if (fs.existsSync(uploadsDir1)) {
      console.log(`Deleting existing images from ${uploadsDir1}`);
      fs.rmSync(uploadsDir1, { recursive: true, force: true });
    }
    if (fs.existsSync(uploadsDir2)) {
      console.log(`Deleting existing images from ${uploadsDir2}`);
      fs.rmSync(uploadsDir2, { recursive: true, force: true });
    }

    // Clear images array in database
    cabin.images = [];
    await cabin.save();
    console.log('Existing images deleted from database');
  } catch (error) {
    throw new Error(`Error deleting existing images: ${error.message}`);
  }
}

async function copyImageToUploads(cabinId, sourcePath) {
  try {
    // Save to project root uploads directory (where server serves from)
    const uploadsDir = path.join(__dirname, 'uploads', 'cabins', cabinId.toString(), 'original');
    fs.mkdirSync(uploadsDir, { recursive: true });
    
    const fileName = path.basename(sourcePath);
    const destPath = path.join(uploadsDir, fileName);
    
    // Copy file
    fs.copyFileSync(sourcePath, destPath);
    
    const stats = fs.statSync(destPath);
    const relPath = `/uploads/cabins/${cabinId}/original/${fileName}`;
    
    return {
      url: relPath.replace(/\\/g, '/'),
      bytes: stats.size,
      path: destPath
    };
  } catch (error) {
    throw new Error(`Error copying image: ${error.message}`);
  }
}

async function addImageToCabin(cabin, imageData) {
  try {
    const imageDoc = {
      url: imageData.url,
      alt: '',
      sort: cabin.images.length,
      isCover: cabin.images.length === 0, // first image becomes cover
      width: 0,
      height: 0,
      bytes: imageData.bytes
    };
    
    cabin.images.push(imageDoc);
    
    // Sync imageUrl to cover image
    if (imageDoc.isCover) {
      cabin.imageUrl = imageDoc.url;
    }
    
    await cabin.save();
    return imageDoc;
  } catch (error) {
    throw new Error(`Error adding image to cabin: ${error.message}`);
  }
}

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`Error: Directory not found at ${IMAGES_DIR}`);
    process.exit(1);
  }

  const stats = fs.statSync(IMAGES_DIR);
  if (!stats.isDirectory()) {
    console.error(`Error: ${IMAGES_DIR} is not a directory`);
    process.exit(1);
  }

  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find Bucephalus cabin
    console.log('Finding Bucephalus cabin...');
    const cabin = await findBucephalusCabin();
    console.log(`Found cabin: ${cabin.name} (ID: ${cabin._id})`);

    // Delete existing images
    console.log('Deleting existing images...');
    await deleteExistingImages(cabin._id);

    // Find image files
    console.log('Scanning directory for images...');
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const imageFiles = [];
    
    function findImages(dir) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          findImages(filePath);
        } else {
          const ext = path.extname(file).toLowerCase();
          if (imageExtensions.includes(ext)) {
            imageFiles.push(filePath);
          }
        }
      }
    }

    findImages(IMAGES_DIR);
    console.log(`Found ${imageFiles.length} image files\n`);

    if (imageFiles.length === 0) {
      console.error('Error: No image files found');
      process.exit(1);
    }

    // Upload images
    console.log('Uploading images...');
    let uploaded = 0;
    for (let i = 0; i < imageFiles.length; i++) {
      const imagePath = imageFiles[i];
      const fileName = path.basename(imagePath);
      process.stdout.write(`[${i + 1}/${imageFiles.length}] ${fileName}... `);
      
      try {
        // Copy image to uploads directory
        const imageData = await copyImageToUploads(cabin._id, imagePath);
        
        // Add to database
        await addImageToCabin(cabin, imageData);
        
        uploaded++;
        console.log('✓');
      } catch (error) {
        console.log(`✗ Error: ${error.message}`);
      }
    }

    console.log(`\n✅ Successfully uploaded ${uploaded}/${imageFiles.length} images to Bucephalus cabin`);
    console.log(`   Cover image: ${cabin.images[0]?.url || 'none'}`);
    
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');

  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findBucephalusCabin, deleteExistingImages, copyImageToUploads, addImageToCabin };

