/**
 * Escape a string for safe use as a literal inside a MongoDB $regex pattern.
 */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };
