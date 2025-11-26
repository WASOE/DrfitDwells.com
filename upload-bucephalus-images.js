#!/usr/bin/env node
/**
 * Script to upload images from a zip file to the Bucephalus cabin
 * Usage: node upload-bucephalus-images.js <path-to-zip-file>
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const mongoose = require('mongoose');
const Cabin = require('./server/models/Cabin');
const FormData = require('form-data');
const axios = require('axios');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/drift-dwells';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''; // You'll need to set this

async function findBucephalusCabin() {
  try {
    const cabin = await Cabin.findOne({ name: /bucephalus/i });
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

    // Delete physical files
    const uploadsDir = path.join(__dirname, 'server', 'uploads', 'cabins', cabinId.toString());
    if (fs.existsSync(uploadsDir)) {
      console.log(`Deleting existing images from ${uploadsDir}`);
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }

    // Clear images array in database
    cabin.images = [];
    await cabin.save();
    console.log('Existing images deleted from database');
  } catch (error) {
    throw new Error(`Error deleting existing images: ${error.message}`);
  }
}

async function uploadImage(cabinId, imagePath, adminToken) {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(imagePath));

    const response = await axios.post(
      `${API_BASE_URL}/api/admin/cabins/${cabinId}/images`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${adminToken}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`Upload failed: ${error.response.data.message || error.response.statusText}`);
    }
    throw new Error(`Upload failed: ${error.message}`);
  }
}

async function main() {
  const inputPath = process.argv[2] || '/home/wasoe/Pictures/Cabin pictures';

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Path not found at ${inputPath}`);
    process.exit(1);
  }

  const stats = fs.statSync(inputPath);
  const isDirectory = stats.isDirectory();
  const isZipFile = inputPath.toLowerCase().endsWith('.zip');

  if (!ADMIN_TOKEN) {
    console.error('Error: ADMIN_TOKEN environment variable is required');
    console.error('Please login to admin panel and get your token, then run:');
    console.error('export ADMIN_TOKEN=your_token_here');
    console.error('node upload-bucephalus-images.js', inputPath);
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

    if (isZipFile) {
      // Extract zip file
      console.log('Extracting zip file...');
      const zip = new AdmZip(inputPath);
      const tempDir = path.join(__dirname, 'temp-upload');
      
      // Clean up temp dir if it exists
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });

      zip.extractAllTo(tempDir, true);
      findImages(tempDir);
      
      // Clean up temp directory after finding images
      fs.rmSync(tempDir, { recursive: true, force: true });
    } else if (isDirectory) {
      // Use directory directly
      console.log('Scanning directory for images...');
      findImages(inputPath);
    } else {
      console.error('Error: Input must be a directory or zip file');
      process.exit(1);
    }

    console.log(`Found ${imageFiles.length} image files`);

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
      console.log(`Uploading ${i + 1}/${imageFiles.length}: ${fileName}`);
      
      try {
        await uploadImage(cabin._id, imagePath, ADMIN_TOKEN);
        uploaded++;
      } catch (error) {
        console.error(`Failed to upload ${fileName}: ${error.message}`);
      }
    }

    console.log(`\n✅ Successfully uploaded ${uploaded}/${imageFiles.length} images to Bucephalus cabin`);
    
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findBucephalusCabin, deleteExistingImages, uploadImage };

