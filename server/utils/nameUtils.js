/**
 * Name sanitization and privacy-friendly formatting utilities
 */

/**
 * Sanitizes a name string:
 * - Trims whitespace
 * - Removes email domain (if email detected, keeps only the part before @)
 * - Removes URLs
 * - Truncates to max 60 characters
 * - Returns null if empty or only whitespace
 */
function sanitizeName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  
  let cleaned = rawName.trim();
  
  // If it looks like an email, extract the part before @
  if (cleaned.includes('@')) {
    const emailMatch = cleaned.match(/^([^@]+)@/);
    if (emailMatch) {
      cleaned = emailMatch[1].trim();
    } else {
      // If email format is malformed, blank it
      return null;
    }
  }
  
  // Remove URLs (basic pattern)
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '').trim();
  
  // Remove any remaining suspicious patterns (multiple dots, special chars that look like spam)
  cleaned = cleaned.replace(/\.{2,}/g, '').trim();
  
  // If empty after cleaning, return null
  if (!cleaned || cleaned.length === 0) return null;
  
  // Truncate to 60 chars
  if (cleaned.length > 60) {
    cleaned = cleaned.substring(0, 60).trim();
  }
  
  return cleaned || null;
}

/**
 * Formats a name privacy-friendly:
 * - Two words: "First L." (first word capitalized + last word's first letter capitalized with dot)
 * - One word: "First" (capitalized)
 * - Empty/null: returns null
 */
function formatPrivacyName(name) {
  if (!name || typeof name !== 'string') return null;
  
  const cleaned = name.trim();
  if (!cleaned) return null;
  
  // Split into words, filter out empty strings
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) return null;
  
  // Capitalize first word
  const first = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  
  // If only one word, return it
  if (words.length === 1) {
    return first;
  }
  
  // Two or more words: "First L."
  const lastInitial = words[words.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

/**
 * Derives a display name from review object with fallbacks:
 * Priority: reviewerName → name → authorName → author → userName → null
 * Then sanitizes and formats privacy-friendly
 */
function deriveDisplayName(review) {
  if (!review || typeof review !== 'object') return null;
  
  // Try all possible keys in priority order
  const candidates = [
    review.reviewerName,
    review.name,
    review.authorName,
    review.author,
    review.userName,
    review.user_name
  ];
  
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.trim()) {
      const sanitized = sanitizeName(candidate);
      if (sanitized) {
        return formatPrivacyName(sanitized);
      }
    }
  }
  
  return null;
}

/**
 * Gets avatar initials from a display name:
 * - Two words: "FL" (first letter of each word)
 * - One word: "F" (first letter)
 * - No name: "G" (Guest)
 */
function getAvatarInitials(displayName) {
  if (!displayName || typeof displayName !== 'string') return 'G';
  
  const cleaned = displayName.trim();
  if (!cleaned) return 'G';
  
  // Remove trailing dot if present (from "First L.")
  const withoutDot = cleaned.replace(/\.$/, '');
  const words = withoutDot.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) return 'G';
  
  // Get first letter of first word
  const first = words[0].charAt(0).toUpperCase();
  
  // If only one word, return single letter
  if (words.length === 1) {
    return first;
  }
  
  // Two or more words: return first letter of first and last word
  const last = words[words.length - 1].charAt(0).toUpperCase();
  return (first + last).substring(0, 2);
}

module.exports = {
  sanitizeName,
  formatPrivacyName,
  deriveDisplayName,
  getAvatarInitials
};
















