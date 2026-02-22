const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Image optimization configuration
const CONFIG = {
  // Target file sizes (in KB)
  desktop: { maxWidth: 1920, quality: 85, maxSizeKB: 400 },
  mobile: { maxWidth: 768, quality: 80, maxSizeKB: 200 },
  thumbnail: { maxWidth: 300, quality: 75, maxSizeKB: 50 },
  
  // Source directory
  sourceDir: path.join(__dirname, '../../uploads/The Valley/Lux Cabin'),
  
  // Output directory
  outputDir: path.join(__dirname, '../../uploads/The Valley/Lux Cabin/optimized'),
};

// Images to optimize (from MEDIA_LIBRARY)
const IMAGES_TO_OPTIMIZE = [
  // Exterior images
  {
    id: 'exterior-hero',
    source: 'Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
  },
  {
    id: 'exterior-roof',
    source: 'Lux-cabin-exterior-watermark-remover-20260113071503(1).jpg',
  },
  {
    id: 'exterior-windows',
    source: 'Lux-cabin-exterior-watermark-remover-20260113071503(2).jpg',
  },
  {
    id: 'exterior-angle',
    source: 'Lux-cabin-exterior-watermark-remover-20260113071503(3).jpg',
  },
  // Interior images
  {
    id: 'interior-main',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (2).jpeg',
  },
  {
    id: 'interior-planks',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (4).jpeg',
  },
  {
    id: 'interior-overview',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (1).jpeg',
  },
  {
    id: 'interior-detail',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM (5).jpeg',
  },
  {
    id: 'interior-bathroom',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.40 AM (1).jpeg',
  },
  {
    id: 'interior-kitchen',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.42 AM (1).jpeg',
  },
  {
    id: 'interior-bedroom',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.46 AM.jpeg',
  },
  {
    id: 'interior-lighting',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.51 AM.jpeg',
  },
  {
    id: 'interior-space',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.52 AM.jpeg',
  },
  {
    id: 'interior-window',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.41 AM.jpeg',
  },
  // Systems
  {
    id: 'systems-ready',
    source: 'Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.47 AM.jpeg',
  },
];

async function optimizeImage(imageConfig, sizeConfig, sizeName) {
  const sourcePath = path.join(CONFIG.sourceDir, imageConfig.source);
  const outputFilename = `${imageConfig.id}-${sizeName}.webp`;
  const outputPath = path.join(CONFIG.outputDir, outputFilename);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`⚠️  Source file not found: ${sourcePath}`);
    return null;
  }

  try {
    const metadata = await sharp(sourcePath).metadata();
    const targetWidth = Math.min(sizeConfig.maxWidth, metadata.width);
    
    // Calculate quality to meet size target
    let quality = sizeConfig.quality;
    let result;
    
    // Try to get close to target size
    do {
      result = await sharp(sourcePath)
        .resize(targetWidth, null, {
          withoutEnlargement: true,
          fit: 'inside',
        })
        .webp({ 
          quality,
          effort: 6, // Higher effort = better compression
        })
        .toFile(outputPath);
      
      const fileSizeKB = result.size / 1024;
      
      if (fileSizeKB <= sizeConfig.maxSizeKB || quality <= 60) {
        break;
      }
      
      quality -= 5;
    } while (quality > 60);

    const fileSizeKB = result.size / 1024;
    const originalSizeKB = metadata.size / 1024;
    const reduction = ((originalSizeKB - fileSizeKB) / originalSizeKB * 100).toFixed(1);

    console.log(`✅ ${outputFilename}: ${fileSizeKB.toFixed(1)}KB (${reduction}% reduction)`);
    
    return {
      id: imageConfig.id,
      size: sizeName,
      path: `/uploads/The Valley/Lux Cabin/optimized/${outputFilename}`,
      width: result.width,
      sizeKB: fileSizeKB,
    };
  } catch (error) {
    console.error(`❌ Error optimizing ${imageConfig.id}-${sizeName}:`, error.message);
    return null;
  }
}

async function optimizeAllImages() {
  console.log('🚀 Starting image optimization...\n');
  
  // Create output directory
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    console.log(`📁 Created output directory: ${CONFIG.outputDir}\n`);
  }

  const results = {
    desktop: [],
    mobile: [],
    thumbnail: [],
  };

  for (const imageConfig of IMAGES_TO_OPTIMIZE) {
    console.log(`\n📸 Processing: ${imageConfig.id}`);
    
    // Optimize for each size
    const desktop = await optimizeImage(imageConfig, CONFIG.desktop, 'desktop');
    if (desktop) results.desktop.push(desktop);
    
    const mobile = await optimizeImage(imageConfig, CONFIG.mobile, 'mobile');
    if (mobile) results.mobile.push(mobile);
    
    const thumbnail = await optimizeImage(imageConfig, CONFIG.thumbnail, 'thumbnail');
    if (thumbnail) results.thumbnail.push(thumbnail);
  }

  // Generate summary
  console.log('\n\n📊 Optimization Summary:');
  console.log('='.repeat(50));
  
  const totalOriginalSize = IMAGES_TO_OPTIMIZE.reduce((sum, img) => {
    const sourcePath = path.join(CONFIG.sourceDir, img.source);
    if (fs.existsSync(sourcePath)) {
      const stats = fs.statSync(sourcePath);
      return sum + stats.size / 1024;
    }
    return sum;
  }, 0);

  const totalDesktopSize = results.desktop.reduce((sum, img) => sum + img.sizeKB, 0);
  const totalMobileSize = results.mobile.reduce((sum, img) => sum + img.sizeKB, 0);
  const totalThumbnailSize = results.thumbnail.reduce((sum, img) => sum + img.sizeKB, 0);

  console.log(`Original total: ${totalOriginalSize.toFixed(1)}KB`);
  console.log(`Desktop total: ${totalDesktopSize.toFixed(1)}KB (${((totalOriginalSize - totalDesktopSize) / totalOriginalSize * 100).toFixed(1)}% reduction)`);
  console.log(`Mobile total: ${totalMobileSize.toFixed(1)}KB (${((totalOriginalSize - totalMobileSize) / totalOriginalSize * 100).toFixed(1)}% reduction)`);
  console.log(`Thumbnail total: ${totalThumbnailSize.toFixed(1)}KB`);
  console.log('='.repeat(50));

  // Save results to JSON for reference
  const resultsPath = path.join(CONFIG.outputDir, 'optimization-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to: ${resultsPath}`);

  return results;
}

// Run optimization
optimizeAllImages()
  .then(() => {
    console.log('\n✨ Image optimization complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Optimization failed:', error);
    process.exit(1);
  });
