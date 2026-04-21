/**
 * parser.js
 * Utility functions for parsing and extracting data from Instagram profile content.
 * Handles follower count conversion, tier assignment, and contact extraction.
 */

import { TIERS } from "../config/constants.js";

/**
 * Converts Instagram-formatted follower count strings to integers.
 * Examples:
 *   "12.5K" → 12500
 *   "1.3M"  → 1300000
 *   "500"   → 500
 *   "2,345" → 2345
 *
 * @param {string} str - The raw follower count string from Instagram
 * @returns {number|null} - Parsed integer count, or null if unparseable
 */
export function parseFollowerCount(str) {
  if (!str || typeof str !== "string") return null;

  // Remove commas and extra whitespace
  let cleaned = str.trim().replace(/,/g, "");

  // Match patterns like "12.5K", "1.3M", "500"
  const match = cleaned.match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!match) return null;

  let num = parseFloat(match[1]);
  const suffix = match[2].toUpperCase();

  // Apply multiplier based on suffix
  if (suffix === "K") {
    num *= 1000;
  } else if (suffix === "M") {
    num *= 1000000;
  }

  return Math.round(num);
}

/**
 * Assigns an influencer tier based on follower count.
 *
 * @param {number} count - The numeric follower count
 * @returns {string} - Tier label: "Nano", "Micro", "Macro", "Mega", or "Unknown"
 */
export function assignTier(count) {
  if (typeof count !== "number" || isNaN(count) || count < 0) return "Unknown";

  // Iterate through tier definitions to find matching range
  for (const [tierName, range] of Object.entries(TIERS)) {
    if (count >= range.min && count <= range.max) {
      return tierName;
    }
  }

  // Below Nano threshold
  return "Unknown";
}

/**
 * Extracts the first email address found in a text string.
 *
 * @param {string} bioText - Text to search (typically the Instagram bio)
 * @returns {string|null} - First email found, or null
 */
export function extractEmail(bioText) {
  if (!bioText || typeof bioText !== "string") return null;

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  const match = bioText.match(emailRegex);
  return match ? match[0] : null;
}

/**
 * Extracts the first phone number found in a text string.
 *
 * @param {string} bioText - Text to search (typically the Instagram bio)
 * @returns {string|null} - First phone number found, or null
 */
export function extractPhone(bioText) {
  if (!bioText || typeof bioText !== "string") return null;

  const phoneRegex = /(\+?\d[\d\s\-().]{7,}\d)/;
  const match = bioText.match(phoneRegex);
  return match ? match[1].trim() : null;
}
