/**
 * Image Helper Utilities
 * 
 * Provides functions to:
 * 1. Get images by specific criteria (e.g., "Stone House front exterior")
 * 2. Ensure proper SEO metadata
 * 3. Prevent image misplacement
 */

import { findImagesByCriteria, getImageMetadata, getSEOAlt, getSEOTitle } from '../data/imageMetadata';

/**
 * Get the best matching image for a specific use case
 * @param {object} criteria - Search criteria
 * @param {string} criteria.location - 'cabin' or 'valley'
 * @param {string} criteria.subject - Specific subject (e.g., 'Stone House', 'A-Frame')
 * @param {string} criteria.perspective - 'interior', 'exterior', 'front', 'aerial', etc.
 * @param {string} criteria.feature - Specific feature (e.g., 'entrance', 'porch', 'front')
 * @returns {string|null} - Best matching image path or null
 */
export function getBestImage(criteria) {
  const { location, subject, perspective, feature } = criteria;
  
  // Build search criteria
  const searchCriteria = { location };
  
  if (subject) {
    // Try exact subject match first
    const exactMatch = findImagesByCriteria({
      ...searchCriteria,
      subject
    });
    
    if (exactMatch.length > 0) {
      // Filter by perspective if specified
      if (perspective) {
        const perspectiveMatch = exactMatch.find(img => 
          img.perspective === perspective || 
          img.tags?.some(tag => tag.includes(perspective))
        );
        if (perspectiveMatch) return perspectiveMatch.path;
      }
      
      // Filter by feature if specified
      if (feature) {
        const featureMatch = exactMatch.find(img => 
          img.content?.toLowerCase().includes(feature.toLowerCase()) ||
          img.tags?.some(tag => tag.toLowerCase().includes(feature.toLowerCase()))
        );
        if (featureMatch) return featureMatch.path;
      }
      
      return exactMatch[0].path;
    }
  }
  
  // Try tag-based search
  if (feature || perspective) {
    const tags = [];
    if (feature) tags.push(feature);
    if (perspective) tags.push(perspective);
    
    const tagMatch = findImagesByCriteria({
      ...searchCriteria,
      tags
    });
    
    if (tagMatch.length > 0) {
      return tagMatch[0].path;
    }
  }
  
  return null;
}

/**
 * Get Stone House front exterior image (verified)
 * @returns {string|null} - Image path or null if not found
 */
export function getStoneHouseFrontImage() {
  // Try to find Stone House front exterior
  const candidates = findImagesByCriteria({
    location: 'valley',
    tags: ['stone-house', 'front', 'exterior']
  });
  
  // Look for images with "front" and "exterior" in description
  const frontExterior = candidates.find(img => 
    img.content?.toLowerCase().includes('front') &&
    img.content?.toLowerCase().includes('exterior') &&
    !img.content?.toLowerCase().includes('swing') &&
    !img.note?.includes('DO NOT USE')
  );
  
  return frontExterior?.path || null;
}

/**
 * Get A-Frame exterior image
 * @returns {string|null} - Image path or null
 */
export function getAFrameExteriorImage() {
  const candidates = findImagesByCriteria({
    location: 'valley',
    tags: ['a-frame', 'exterior']
  });
  
  return candidates.length > 0 ? candidates[0].path : null;
}

/**
 * Get Luxury Cabin interior image for Valley
 * @returns {string|null} - Image path or null
 */
export function getValleyLuxuryCabinInterior() {
  const candidates = findImagesByCriteria({
    location: 'valley',
    tags: ['luxury-cabin', 'interior']
  });
  
  return candidates.length > 0 ? candidates[0].path : null;
}

/**
 * Validate image selection before use
 * @param {string} imagePath - Image path to validate
 * @param {object} expectedCriteria - Expected image characteristics
 * @returns {object} - Validation result
 */
export function validateImageSelection(imagePath, expectedCriteria) {
  const metadata = getImageMetadata(imagePath);
  
  if (!metadata) {
    return {
      valid: false,
      error: 'Image metadata not found',
      suggestion: 'Add metadata for this image'
    };
  }
  
  const { location, subject, perspective, tags: _tags = [] } = metadata;
  const { expectedLocation, expectedSubject, expectedPerspective } = expectedCriteria;
  
  const issues = [];
  
  if (expectedLocation && location !== expectedLocation) {
    issues.push(`Location mismatch: expected ${expectedLocation}, got ${location}`);
  }
  
  if (expectedSubject && subject && !subject.toLowerCase().includes(expectedSubject.toLowerCase())) {
    issues.push(`Subject mismatch: expected ${expectedSubject}, got ${subject}`);
  }
  
  if (expectedPerspective && perspective !== expectedPerspective) {
    issues.push(`Perspective mismatch: expected ${expectedPerspective}, got ${perspective}`);
  }
  
  // Check for warnings in metadata
  if (metadata.note && metadata.note.includes('DO NOT USE')) {
    issues.push(`WARNING: ${metadata.note}`);
  }
  
  return {
    valid: issues.length === 0,
    metadata,
    issues,
    suggestion: issues.length > 0 
      ? `Consider using: ${getBestImage(expectedCriteria) || 'verify available images'}`
      : null
  };
}

/**
 * Get all images for a location with their metadata
 * @param {string} location - 'cabin' or 'valley'
 * @returns {Array} - Array of image objects with metadata
 */
export function getLocationImages(location) {
  return findImagesByCriteria({ location });
}

// Export metadata functions
export { getImageMetadata, getSEOAlt, getSEOTitle, findImagesByCriteria };
