/**
 * Name formatting utilities for frontend
 */

/**
 * Sanitizes a name string (client-side version):
 * - Trims whitespace
 * - Removes email domain (if email detected)
 * - Returns null if empty
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
      return null;
    }
  }
  
  // Remove URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, '').trim();
  
  if (!cleaned || cleaned.length === 0) return null;
  
  return cleaned;
}

/**
 * Formats a name privacy-friendly:
 * - Two words: "First L." (first word capitalized + last word's first letter with dot)
 * - One word: "First" (capitalized)
 * - Empty/null: returns null
 */
export function formatPrivacyName(name) {
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
 * Priority: reviewerName → name → authorName → author → userName
 * Then sanitizes and formats privacy-friendly
 * Returns "Guest" if no name found
 */
export function deriveDisplayName(review) {
  if (!review || typeof review !== 'object') return 'Guest';
  
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
    if (candidate && typeof candidate === 'string') {
      // Skip 'Guest' as it's the default fallback, not a real name
      const trimmed = candidate.trim();
      if (!trimmed || trimmed.toLowerCase() === 'guest') {
        continue;
      }
      
      const sanitized = sanitizeName(candidate);
      if (sanitized && sanitized.toLowerCase() !== 'guest') {
        const formatted = formatPrivacyName(sanitized);
        if (formatted && formatted.toLowerCase() !== 'guest') {
          return formatted;
        }
      }
    }
  }
  
  return 'Guest';
}

/**
 * Gets avatar initials from a display name:
 * - Two words: "FL" (first letter of first and last word)
 * - One word: "F" (first letter)
 * - No name: "G" (Guest)
 */
export function getAvatarInitials(displayName) {
  if (!displayName || typeof displayName !== 'string' || displayName === 'Guest') {
    return 'G';
  }
  
  const cleaned = displayName.trim();
  if (!cleaned || cleaned === 'Guest') return 'G';
  
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
  
  // Two or more words: return first letter of first and last word (max 2 chars)
  const last = words[words.length - 1].charAt(0).toUpperCase();
  return (first + last).substring(0, 2);
}

