#!/usr/bin/env node
/**
 * Script to scan all React components for image usage and identify misplacements
 * Checks if Cabin images are used in Valley pages and vice versa
 */

const fs = require('fs');
const path = require('path');

const VALLEY_KEYWORDS = ['valley', 'aframe', 'meadow', 'campfire', 'fireside', 'starlit', 'river-letters', 'valley-haven'];
const CABIN_KEYWORDS = ['bucephalus', 'cabin-journal', 'cabin-path', 'cabin', 'fern-study', 'lake-dawn', 'rainy-eaves'];

const VALLEY_IMAGES = [
  '/uploads/The Valley/',
  'valley-haven',
  'meadow-trail',
  'starlit-mountain',
  'campfire-night',
  'fireside-lounge',
  'river-letters',
  'SKy-view-Aframe',
  'aframe'
];

const CABIN_IMAGES = [
  '/uploads/The Cabin/',
  'bucephalus-suite',
  'cabin-journal',
  'cabin-path',
  'fern-study',
  'lake-dawn',
  'rainy-eaves'
];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const lowerLine = line.toLowerCase();

    // Check for Valley images
    VALLEY_IMAGES.forEach(valleyImg => {
      if (lowerLine.includes(valleyImg.toLowerCase())) {
        // Check if this is in a Cabin-related file
        if (filePath.includes('TheCabin') || filePath.includes('CabinDetails') || filePath.includes('CabinFaq')) {
          issues.push({
            file: filePath,
            line: lineNum,
            type: 'VALLEY_IN_CABIN',
            image: valleyImg,
            code: line.trim()
          });
        }
      }
    });

    // Check for Cabin images
    CABIN_IMAGES.forEach(cabinImg => {
      if (lowerLine.includes(cabinImg.toLowerCase())) {
        // Check if this is in a Valley-related file
        if (filePath.includes('TheValley') || filePath.includes('AFrameDetails')) {
          issues.push({
            file: filePath,
            line: lineNum,
            type: 'CABIN_IN_VALLEY',
            image: cabinImg,
            code: line.trim()
          });
        }
      }
    });
  });

  return issues;
}

function main() {
  const pagesDir = path.join(__dirname, 'client/src/pages');
  const componentsDir = path.join(__dirname, 'client/src/components');
  const allIssues = [];

  // Scan pages
  function scanDirectory(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        scanDirectory(fullPath, relPath);
      } else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
        const issues = scanFile(fullPath);
        if (issues.length > 0) {
          allIssues.push(...issues);
        }
      }
    });
  }

  scanDirectory(pagesDir);
  scanDirectory(componentsDir);

  // Print results
  console.log('\n=== IMAGE MISPLACEMENT SCAN RESULTS ===\n');
  
  if (allIssues.length === 0) {
    console.log('✅ No issues found!');
    return;
  }

  const byType = {
    VALLEY_IN_CABIN: [],
    CABIN_IN_VALLEY: []
  };

  allIssues.forEach(issue => {
    byType[issue.type] = byType[issue.type] || [];
    byType[issue.type].push(issue);
  });

  if (byType.VALLEY_IN_CABIN.length > 0) {
    console.log('❌ VALLEY IMAGES IN CABIN PAGES:');
    console.log('─'.repeat(80));
    byType.VALLEY_IN_CABIN.forEach(issue => {
      console.log(`\nFile: ${issue.file}`);
      console.log(`Line ${issue.line}: ${issue.image}`);
      console.log(`Code: ${issue.code.substring(0, 100)}...`);
    });
    console.log('\n');
  }

  if (byType.CABIN_IN_VALLEY.length > 0) {
    console.log('❌ CABIN IMAGES IN VALLEY PAGES:');
    console.log('─'.repeat(80));
    byType.CABIN_IN_VALLEY.forEach(issue => {
      console.log(`\nFile: ${issue.file}`);
      console.log(`Line ${issue.line}: ${issue.image}`);
      console.log(`Code: ${issue.code.substring(0, 100)}...`);
    });
    console.log('\n');
  }

  console.log(`\nTotal issues found: ${allIssues.length}`);
}

main();
