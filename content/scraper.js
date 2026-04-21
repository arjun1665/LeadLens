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
 * Reads the og:description meta value if present.
 * @returns {string|null}
 */
function getOgDescriptionContent() {
  const ogDesc = document.querySelector('meta[property="og:description"]');
  const content = ogDesc?.getAttribute("content")?.trim();
  return content || null;
}

/**
 * Removes known Instagram boilerplate from meta descriptions.
 * @param {string} text
 * @returns {string}
 */
function stripInstagramBoilerplate(text) {
  return text
    .replace(/See Instagram photos and videos from.*$/i, "")
    .replace(/Instagram:\s*/i, "")
    .trim();
}

/**
 * Cleans candidate bio text extracted from metadata/script payloads.
 * @param {string|null} text
 * @param {string|null} username
 * @param {string|null} fullName
 * @returns {string|null}
 */
function cleanBioCandidate(text, username, fullName) {
  if (!text || typeof text !== "string") return null;

  let candidate = text
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/See Instagram photos and videos from.*$/i, "")
    .trim();

  candidate = candidate
    .replace(/^\s*[\d,.KkMm]+\s*followers?,\s*[\d,.KkMm]+\s*following,\s*[\d,.KkMm]+\s*posts?\s*-\s*/i, "")
    .replace(/\s*\(@[^)]+\)\s*on Instagram\s*:??\s*/i, "")
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, "")
    .trim();

  if (username) {
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    candidate = candidate
      .replace(new RegExp(`\\(@${escapedUsername}\\)`, "ig"), "")
      .replace(new RegExp(`(^|\\s)@${escapedUsername}(\\s|$)`, "ig"), " ")
      .trim();
  }

  if (fullName) {
    const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    candidate = candidate
      .replace(new RegExp(`^${escapedName}\\s*[-:|]\\s*`, "i"), "")
      .trim();
  }

  if (!candidate) return null;
  if (/^(followers?|following|posts?)\b/i.test(candidate)) return null;

  return candidate;
}

/**
 * Attempts to infer biography text from og:description.
 * @returns {string|null}
 */
function getBioFromOgDescription() {
  const content = getOgDescriptionContent();
  if (!content) return null;

  const username = getUsername();
  const fullName = getFullName();

  const instagramPrefixMatch = content.match(/on Instagram\s*:\s*([\s\S]+)$/i);
  if (instagramPrefixMatch?.[1]) {
    const prefixed = cleanBioCandidate(instagramPrefixMatch[1], username, fullName);
    if (prefixed) return prefixed;
  }

  const cleaned = stripInstagramBoilerplate(content);
  if (!cleaned) return null;

  const segments = cleaned
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);

  const statSegmentRegex = /followers?|following|posts?/i;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!statSegmentRegex.test(segment) && !segment.includes("(@")) {
      const candidate = cleanBioCandidate(segment, username, fullName);
      if (candidate) return candidate;
    }
  }

  return null;
}

/**
 * Finds biography text embedded inside script payloads.
 * @param {string|null} username
 * @returns {string|null}
 */
function getBioFromScripts(username) {
  const scripts = document.querySelectorAll("script");
  const fullName = getFullName();

  const extractDecodedBio = (sourceText, pattern) => {
    const match = sourceText.match(pattern);
    if (!match?.[1]) return null;
    try {
      return JSON.parse(`"${match[1]}"`).trim() || null;
    } catch {
      return null;
    }
  };

  if (username) {
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const script of scripts) {
      const text = script.textContent || "";
      const nearUsernameBio = new RegExp(
        `"username":"${escapedUsername}"[\\s\\S]{0,6000}?"biography":"((?:\\\\.|[^"\\\\])*)"`
      );
      const nearUsernameRawBio = new RegExp(
        `"username":"${escapedUsername}"[\\s\\S]{0,6000}?"biography_with_entities":\\{[\\s\\S]{0,500}?"raw_text":"((?:\\\\.|[^"\\\\])*)"`
      );

      const decodedNearUsername =
        extractDecodedBio(text, nearUsernameRawBio) || extractDecodedBio(text, nearUsernameBio);
      const cleanedNearUsername = cleanBioCandidate(decodedNearUsername, username, fullName);
      if (cleanedNearUsername) {
        return cleanedNearUsername;
      }
    }
  }

  return null;
}

/**
 * Attempts to gather biography lines from the visible profile header.
 * @param {string|null} username
 * @param {string|null} fullName
 * @returns {string|null}
 */
function getBioFromDom(username, fullName) {
  const header = document.querySelector("main header") || document.querySelector("header");
  if (!header) return null;

  const blacklist = /followers?|following|posts?|message|follow|edit profile|contact|shop/i;
  const candidates = new Set();
  const nodes = header.querySelectorAll("section span, section div, section h1, section a");

  for (const node of nodes) {
    const rawText = node.textContent || "";
    for (const line of rawText.split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      if (text.length < 3 || text.length > 300) continue;
      if (blacklist.test(text)) continue;
      if (username && text.toLowerCase() === username.toLowerCase()) continue;
      if (fullName && text.toLowerCase() === fullName.toLowerCase()) continue;
      if (text.startsWith("@")) continue;
      if (/^[\d,.]+[KkMm]?$/.test(text)) continue;
      candidates.add(text);
    }
  }

  const joined = Array.from(candidates).slice(0, 4).join("\n").trim();
  if (joined) return joined;

  // Fallback: Instagram sometimes nests bio text in uncommon wrappers.
  const lineCandidates = (header.innerText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.length >= 3 && line.length <= 300)
    .filter((line) => !blacklist.test(line))
    .filter((line) => !(username && line.toLowerCase() === username.toLowerCase()))
    .filter((line) => !(fullName && line.toLowerCase() === fullName.toLowerCase()))
    .filter((line) => !line.startsWith("@"))
    .filter((line) => !/^[\d,.]+[KkMm]?$/.test(line));

  return lineCandidates.slice(0, 4).join("\n") || null;
}

/**
 * Collects visible header text that can help contact extraction.
 * @returns {string}
 */
function getHeaderTextForContactExtraction() {
  const header = document.querySelector("main header") || document.querySelector("header");
  return header?.innerText?.trim() || "";
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
  const username = getUsername();
  const fullName = getFullName();

  return (
    getBioFromScripts(username) ||
    getBioFromOgDescription() ||
    getBioFromDom(username, fullName) ||
    null
  );
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
function getJsonLdData(username) {
  const scripts = document.querySelectorAll(
    'script[type="application/ld+json"]'
  );
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (data && (data["@type"] === "Person" || data["@type"] === "ProfilePage")) {
        const lowerUsername = username?.toLowerCase();
        const url = (data.url || "").toLowerCase();
        const alternateName = (data.alternateName || "").replace(/^@/, "").toLowerCase();
        const sameProfile =
          !lowerUsername ||
          alternateName === lowerUsername ||
          url.includes(`/instagram.com/${lowerUsername}/`) ||
          url.includes(`/www.instagram.com/${lowerUsername}/`);

        if (!sameProfile) {
          continue;
        }

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
  const jsonLdData = getJsonLdData(username);

  // Assemble the profile data, preferring JSON-LD for supported fields
  const fullName = jsonLdData?.fullName || getFullName();
  const bioText = jsonLdData?.bio || bio;
  const followerCountRaw = getFollowerCount();

  // Extract contact info from combined profile text sources to improve hit rate.
  const fullBioText = [
    bioText,
    getOgDescriptionContent(),
    getHeaderTextForContactExtraction(),
  ]
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
