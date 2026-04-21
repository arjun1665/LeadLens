/**
 * scraper.js — Content Script
 * Injected into Instagram profile pages to scrape publicly visible profile data.
 *
 * Scraping strategy (in order of preference):
 *   1. Meta tags (og:title, og:description) — most stable across DOM changes
 *   2. JSON-LD structured data in <script> tags — if available
 *   3. Visible DOM elements by role/aria attributes — fallback
 *
 * This script does NOT use class-name selectors because Instagram uses
 * randomised CSS class names that change on every build.
 */

/**
 * Extracts the username from the current URL pathname.
 * Instagram profile URLs follow the pattern: https://www.instagram.com/{username}/
 *
 * @returns {string|null} - The username, or null if not on a profile page
 */
function getUsername() {
  const path = window.location.pathname;
  // Match /{username}/ — exclude known non-profile paths
  const nonProfilePaths = [
    "explore",
    "reels",
    "stories",
    "direct",
    "accounts",
    "p",
    "tv",
    "reel",
  ];
  const match = path.match(/^\/([^/]+)\/?$/);
  if (match && !nonProfilePaths.includes(match[1])) {
    return match[1];
  }
  return null;
}

/**
 * Gets the full profile URL.
 * @returns {string} - The current page URL
 */
function getProfileUrl() {
  return window.location.href;
}

/**
 * Extracts the full name from the Instagram profile page.
 * Tries meta og:title first, then falls back to DOM heading elements.
 *
 * @returns {string|null}
 */
function getFullName() {
  // Strategy 1: og:title meta tag (format: "Full Name (@username) • Instagram photos and videos")
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const content = ogTitle.getAttribute("content");
    if (content) {
      // Extract "Full Name" from "Full Name (@username) • Instagram ..."
      const match = content.match(/^(.+?)\s*\(@/);
      if (match) return match[1].trim();

      // Some profiles just have the name without the username format
      const simpleName = content.split("•")[0].trim();
      if (simpleName) return simpleName;
    }
  }

  // Strategy 2: Look for the full name in a heading or span near the top of the profile
  // Instagram renders the display name in a span inside the header section
  const headerSection = document.querySelector("header");
  if (headerSection) {
    // Try to find a span that looks like a display name (not the username)
    const spans = headerSection.querySelectorAll("span");
    for (const span of spans) {
      const text = span.textContent.trim();
      // Skip if it looks like a count, username, or action text
      if (
        text &&
        text.length > 1 &&
        text.length < 60 &&
        !text.match(/^\d/) &&
        !text.includes("Follow") &&
        !text.includes("Message") &&
        !text.includes("Edit") &&
        !text.startsWith("@")
      ) {
        // Check if this span is within a section that could be the name area
        const parent = span.parentElement;
        if (parent && parent.children.length <= 3) {
          return text;
        }
      }
    }
  }

  return null;
}

/**
 * Extracts the bio text from the Instagram profile page.
 * Tries meta og:description first, then falls back to DOM elements.
 *
 * @returns {string|null}
 */
function getBio() {
  // Strategy 1: og:description meta tag
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) {
    const content = ogDesc.getAttribute("content");
    if (content) {
      // The description typically includes follower/following counts before the bio
      // Format: "123 Followers, 45 Following, 67 Posts - See Instagram photos and videos from Name (@user)"
      // Or sometimes the bio is directly in there
      // Try to extract just the meaningful bio text
      const parts = content.split(" - ");
      if (parts.length > 1) {
        // Return everything after the first dash (which has the descriptive part)
        return parts.slice(1).join(" - ").trim();
      }
      return content.trim();
    }
  }

  // Strategy 2: Look for the bio section in the DOM header area
  const headerSection = document.querySelector("header");
  if (headerSection) {
    // Instagram's bio is usually in a div after the stats row
    // Look for a section with longer text that isn't a count
    const allDivs = headerSection.querySelectorAll("div");
    for (const div of allDivs) {
      const text = div.textContent.trim();
      // Bio text is typically between 10 and 500 characters
      if (
        text.length > 10 &&
        text.length < 500 &&
        !text.includes("followers") &&
        !text.includes("following") &&
        !text.includes("posts") &&
        div.children.length <= 5
      ) {
        return text;
      }
    }
  }

  return null;
}

/**
 * Extracts the follower count string from the Instagram profile page.
 * Returns the raw string (e.g., "12.5K") without conversion.
 *
 * @returns {string|null}
 */
function getFollowerCount() {
  // Strategy 1: Look for the meta description and parse follower count
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) {
    const content = ogDesc.getAttribute("content");
    if (content) {
      // Pattern: "1,234 Followers" or "12.5K Followers" or "1.3M Followers"
      const match = content.match(/([\d,.]+[KkMm]?)\s*Followers/i);
      if (match) return match[1];
    }
  }

  // Strategy 2: Search visible DOM for "followers" text and get the adjacent number
  const allElements = document.querySelectorAll("a, span, li");
  for (const el of allElements) {
    const text = el.textContent.trim().toLowerCase();
    if (text.includes("follower")) {
      // Try to extract the number from this element's text
      const numMatch = el.textContent.match(/([\d,.]+[KkMm]?)\s*follower/i);
      if (numMatch) return numMatch[1];

      // Check the title attribute (Instagram sometimes stores exact counts here)
      const title = el.getAttribute("title");
      if (title) {
        const titleMatch = title.match(/([\d,.]+)/);
        if (titleMatch) return titleMatch[1];
      }

      // Check sibling or child span elements for the count
      const countSpan = el.querySelector("span span, span");
      if (countSpan) {
        const spanText = countSpan.textContent.trim();
        if (spanText.match(/^[\d,.]+[KkMm]?$/)) return spanText;
      }
    }
  }

  return null;
}

/**
 * Extracts email addresses from the bio text using regex.
 * @param {string} text - The bio text to search
 * @returns {string|null} - First email found, or null
 */
function extractEmailFromText(text) {
  if (!text) return null;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  const match = text.match(emailRegex);
  return match ? match[0] : null;
}

/**
 * Extracts phone numbers from the bio text using regex.
 * @param {string} text - The bio text to search
 * @returns {string|null} - First phone number found, or null
 */
function extractPhoneFromText(text) {
  if (!text) return null;
  const phoneRegex = /(\+?\d[\d\s\-().]{7,}\d)/;
  const match = text.match(phoneRegex);
  return match ? match[1].trim() : null;
}

/**
 * Attempts to extract profile data from JSON-LD structured data if available.
 * Instagram sometimes embeds structured data in <script type="application/ld+json"> tags.
 *
 * @returns {Object|null} - Partial profile data object, or null
 */
function getJsonLdData() {
  const scripts = document.querySelectorAll(
    'script[type="application/ld+json"]'
  );
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (data && (data["@type"] === "Person" || data["@type"] === "ProfilePage")) {
        return {
          fullName: data.name || null,
          bio: data.description || null,
          // JSON-LD may include other useful fields
          url: data.url || null,
        };
      }
    } catch (e) {
      // Ignore malformed JSON-LD blocks
      continue;
    }
  }
  return null;
}

/**
 * Main scraping function — orchestrates all extraction strategies.
 * Returns a unified profile data object.
 *
 * @returns {Object} - The scraped profile data
 */
function scrapeProfileData() {
  const username = getUsername();
  const profileUrl = getProfileUrl();
  const bio = getBio();

  // Try JSON-LD first for structured data
  const jsonLdData = getJsonLdData();

  // Assemble the profile data, preferring JSON-LD for supported fields
  const fullName = jsonLdData?.fullName || getFullName();
  const bioText = jsonLdData?.bio || bio;
  const followerCountRaw = getFollowerCount();

  // Extract contact info from the full bio text (including og:description)
  const ogDesc = document.querySelector('meta[property="og:description"]');
  const fullBioText = [bioText, ogDesc?.getAttribute("content")]
    .filter(Boolean)
    .join(" ");

  const email = extractEmailFromText(fullBioText);
  const phone = extractPhoneFromText(fullBioText);

  return {
    username: username,
    profileUrl: profileUrl,
    fullName: fullName,
    bio: bioText,
    followerCountRaw: followerCountRaw,
    email: email,
    phone: phone,
  };
}

/**
 * Listen for messages from the popup requesting scraped data.
 * When the popup opens, it sends a "GET_SCRAPED_DATA" message.
 * We respond with the scraped profile data.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SCRAPED_DATA") {
    // Scrape the current page and send back the data
    const data = scrapeProfileData();
    sendResponse({ type: "SCRAPED_DATA", data: data });
  }
  // Return true to indicate we may respond asynchronously
  return true;
});

/**
 * Also proactively send scraped data when the content script loads.
 * This covers the case where the popup is already open when navigating to a profile.
 */
(function init() {
  // Small delay to ensure the DOM is fully rendered (Instagram loads dynamically)
  setTimeout(() => {
    const data = scrapeProfileData();
    chrome.runtime.sendMessage({ type: "SCRAPED_DATA", data: data }).catch(() => {
      // Popup may not be open yet — this is expected, suppress the error
    });
  }, 1500);
})();
