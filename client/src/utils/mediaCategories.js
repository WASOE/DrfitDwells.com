/**
 * Media Categorization Utility
 * 
 * Prevents using Cabin images in Valley sections and vice versa.
 * Ensures proper media organization for Bachevo (Cabin) vs Chereshovo/Ortsevo (Valley).
 */

// Media categorization database
const MEDIA_CATEGORIES = {
  CABIN: 'cabin',
  VALLEY: 'valley',
  GENERIC: 'generic',
  UNKNOWN: 'unknown'
};

/**
 * Categorize an image/video path based on its location and filename
 * @param {string} path - The file path (relative or absolute)
 * @returns {string} - Category: 'cabin', 'valley', 'generic', or 'unknown'
 */
export function categorizeMedia(path) {
  if (!path) return MEDIA_CATEGORIES.UNKNOWN;

  const normalizedPath = path.toLowerCase();
  const filename = path.split('/').pop().toLowerCase();

  // Direct Cabin images
  if (normalizedPath.includes('/the cabin/') || 
      normalizedPath.includes('/cabins/') && !normalizedPath.includes('valley')) {
    return MEDIA_CATEGORIES.CABIN;
  }

  // Direct Valley images
  if (normalizedPath.includes('/the valley/')) {
    return MEDIA_CATEGORIES.VALLEY;
  }

  // Content website folder - check by filename keywords
  if (normalizedPath.includes('content website') || normalizedPath.includes('content%20website')) {
    // Cabin-specific images
    if (filename.includes('bucephalus') || 
        filename.includes('cabin-journal') ||
        filename.includes('cabin-path') ||
        filename.includes('fern-study') ||
        filename.includes('lake-dawn') ||
        filename.includes('rainy-eaves')) {
      return MEDIA_CATEGORIES.CABIN;
    }

    // Valley-specific images
    if (filename.includes('valley-haven') ||
        filename.includes('meadow-trail') ||
        filename.includes('starlit-mountain') ||
        filename.includes('campfire-night') ||
        filename.includes('fireside-lounge') ||
        filename.includes('river-letters') ||
        filename.includes('sky-view-aframe') ||
        filename.includes('aframe')) {
      return MEDIA_CATEGORIES.VALLEY;
    }

    // Generic/decorative images
    if (filename.includes('sketch') ||
        filename.includes('vintage-map') ||
        filename.includes('lantern-walk')) {
      return MEDIA_CATEGORIES.GENERIC;
    }
  }

  // Video categorization
  if (normalizedPath.includes('/videos/')) {
    if (filename.includes('cabin') || filename.includes('dark-fire-cabin')) {
      return MEDIA_CATEGORIES.CABIN;
    }
    if (filename.includes('valley') || filename.includes('aframe') || filename.includes('aframes')) {
      return MEDIA_CATEGORIES.VALLEY;
    }
  }

  // Check filename for keywords if path doesn't match
  if (filename.includes('cabin') && !filename.includes('valley')) {
    return MEDIA_CATEGORIES.CABIN;
  }
  if (filename.includes('valley') || filename.includes('aframe')) {
    return MEDIA_CATEGORIES.VALLEY;
  }

  return MEDIA_CATEGORIES.UNKNOWN;
}

/**
 * Validate that media matches the expected location
 * @param {string} path - The file path to validate
 * @param {string} expectedLocation - Expected location: 'cabin' or 'valley'
 * @returns {object} - { valid: boolean, category: string, message: string }
 */
export function validateMediaLocation(path, expectedLocation) {
  const category = categorizeMedia(path);
  const expected = expectedLocation.toLowerCase();

  // Generic images can be used anywhere
  if (category === MEDIA_CATEGORIES.GENERIC) {
    return {
      valid: true,
      category,
      message: 'Generic image - safe to use anywhere'
    };
  }

  // Unknown images need review
  if (category === MEDIA_CATEGORIES.UNKNOWN) {
    return {
      valid: false,
      category,
      message: `⚠️ WARNING: Image category is unknown. Please review: ${path}`
    };
  }

  // Check if category matches expected location
  const isValid = category === expected;

  return {
    valid: isValid,
    category,
    message: isValid 
      ? `✅ Correct: ${category} image for ${expected} location`
      : `❌ ERROR: ${category} image used in ${expected} location! Path: ${path}`
  };
}

/**
 * Get all images for a specific location
 * @param {string} location - 'cabin' or 'valley'
 * @returns {object} - Object with categorized image arrays
 */
export function getLocationMedia(location) {
  const loc = location.toLowerCase();

  if (loc === 'cabin') {
    return {
      images: [
        // Direct cabin images
        '/uploads/The Cabin/',
        // Content website cabin images
        '/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif',
        '/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif',
        '/uploads/Content%20website/drift-dwells-bulgaria-cabin-path.png',
        '/uploads/Content%20website/drift-dwells-bulgaria-fern-study.png',
        '/uploads/Content%20website/drift-dwells-bulgaria-lake-dawn.png',
        '/uploads/Content%20website/drift-dwells-bulgaria-rainy-eaves.avif',
      ],
      videos: [
        '/uploads/Videos/The-cabin-header.mp4',
        '/uploads/Videos/Dark-fire-cabin.mp4',
        '/uploads/Videos/Dark-fire-cabin-poster.jpg',
      ]
    };
  }

  if (loc === 'valley') {
    return {
      images: [
        // Direct valley images
        '/uploads/The Valley/',
        // Content website valley images
        '/uploads/Content%20website/drift-dwells-bulgaria-valley-haven.avif',
        '/uploads/Content%20website/drift-dwells-bulgaria-meadow-trail.avif',
        '/uploads/Content%20website/drift-dwells-bulgaria-starlit-mountain.avif',
        '/uploads/Content%20website/drift-dwells-bulgaria-campfire-night.avif',
        '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
        '/uploads/Content%20website/drift-dwells-bulgaria-river-letters.avif',
        '/uploads/Content%20website/SKy-view-Aframe.jpg',
      ],
      videos: [
        '/uploads/Videos/The-Valley-firaplace-video.mp4',
        '/uploads/Videos/The-Valley-From-the-Sky.mp4',
        '/uploads/Videos/The-Valley-Night-Stars.mp4',
        '/uploads/Videos/Light-aframes.mp4',
        '/uploads/Videos/Light-aframes-poster.jpg',
        '/uploads/Videos/The-Valley-firaplace-video-poster.jpg',
      ]
    };
  }

  return { images: [], videos: [] };
}

/**
 * Filter array of media paths by location
 * @param {Array<string>} mediaPaths - Array of file paths
 * @param {string} location - 'cabin', 'valley', or 'generic'
 * @returns {Array<string>} - Filtered array of paths
 */
export function filterMediaByLocation(mediaPaths, location) {
  return mediaPaths.filter(path => categorizeMedia(path) === location.toLowerCase());
}

// Export constants
export { MEDIA_CATEGORIES };
