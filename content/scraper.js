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
  if (/^followed by\b/i.test(candidate)) return null;

  return dedupeBioText(candidate);
}

/**
 * Normalizes and removes repeated bio lines/blocks.
 * @param {string|null} text
 * @returns {string|null}
 */
function dedupeBioText(text) {
  if (!text || typeof text !== "string") return null;

  const rawLines = text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (rawLines.length === 0) return null;

  const uniqueLines = [];
  const seen = new Set();
  for (const line of rawLines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueLines.push(line);
  }

  // If Instagram rendered an identical block twice, keep only the first half.
  if (uniqueLines.length % 2 === 0) {
    const half = uniqueLines.length / 2;
    const firstHalf = uniqueLines.slice(0, half).join("\n").toLowerCase();
    const secondHalf = uniqueLines.slice(half).join("\n").toLowerCase();
    if (firstHalf && firstHalf === secondHalf) {
      return uniqueLines.slice(0, half).join("\n");
    }
  }

  return uniqueLines.join("\n");
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

  // Common format: "77.6M Followers, ... Posts - <bio text>"
  const statsPrefixMatch = cleaned.match(
    /^[\d,.KkMm]+\s*followers?,\s*[\d,.KkMm]+\s*following,\s*[\d,.KkMm]+\s*posts?\s*-\s*([\s\S]+)$/i
  );
  if (statsPrefixMatch?.[1]) {
    const fromStatsTail = cleanBioCandidate(statsPrefixMatch[1], username, fullName);
    if (fromStatsTail) return fromStatsTail;
  }

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
        `"username":"${escapedUsername}"[\\s\\S]{0,20000}?"biography":"((?:\\\\.|[^"\\\\])*)"`
      );
      const nearUsernameRawBio = new RegExp(
        `"username":"${escapedUsername}"[\\s\\S]{0,20000}?"biography_with_entities":\\{[\\s\\S]{0,4000}?"raw_text":"((?:\\\\.|[^"\\\\])*)"`
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

  const isLikelyUiLine = (text) => {
    const lower = text.toLowerCase();
    const compact = lower.replace(/\s+/g, "");

    if (["verified", "options", "verifiedoptions"].includes(compact)) return true;
    if (/^hypewhipverified(options)?$/i.test(compact)) return true;
    if (/^\d+[,.\d]*[kKmM]?\s*(followers?|following|posts?)$/.test(lower)) return true;
    if (/^followed by\b/i.test(lower)) return true;

    const uiWordPattern = /\b(verified|options|follow|message|contact|shop|insights|threads|professional|similar accounts)\b/i;
    const hasBioSignal = /@|https?:\/\/|\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/i.test(text);
    if (uiWordPattern.test(text) && text.length <= 50 && !hasBioSignal) return true;

    const alnumOnly = text.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
    if (
      alnumOnly &&
      alnumOnly.length <= 24 &&
      !/\s/.test(alnumOnly) &&
      !/[a-z]/.test(alnumOnly) &&
      /[A-Z0-9]/.test(alnumOnly)
    ) {
      return true;
    }

    return false;
  };

  const normalizeBioLines = (rawText) => {
    const seen = new Set();
    const out = [];

    for (const rawLine of String(rawText || "").split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (line.length < 2 || line.length > 220) continue;
      if (isLikelyUiLine(line)) continue;
      if (username && line.toLowerCase() === username.toLowerCase()) continue;
      if (fullName && line.toLowerCase() === fullName.toLowerCase()) continue;
      if (/^[\d,.]+[KkMm]?$/.test(line)) continue;
      if (/^(community|digital creator|creator|public figure|athlete|artist)$/i.test(line)) continue;

      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const isExactUsername = Boolean(username && line.toLowerCase() === username.toLowerCase());
      if (!/\p{L}/u.test(line) && !isExactUsername) continue;
      // Story highlight labels tend to be short one-token text (e.g., ARS...SPO).
      if (
        line.length <= 12 &&
        !/\s/.test(line) &&
        !/@|https?:\/\/|\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/i.test(line)
      ) {
        continue;
      }
      out.push(line);
    }

    return out;
  };

  const scoreBioLines = (lines) => {
    if (!lines.length) return 0;
    let score = lines.length * 2;
    for (const line of lines) {
      if (/@|https?:\/\//i.test(line)) score += 2;
      if (/\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/i.test(line)) score += 2;
      if (/\+?\d[\d\s\-().]{7,}\d/.test(line)) score += 1;
    }
    return score;
  };

  const headerLines = (header.innerText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Keep only the intro block above action buttons to avoid story-highlight labels.
  const actionLineIndex = headerLines.findIndex((line) =>
    /^(follow|following|message|contact|email|edit profile|subscribed|subscribe)$/i.test(line)
  );
  const introLines = actionLineIndex > 0 ? headerLines.slice(0, actionLineIndex) : headerLines;

  let bestLines = normalizeBioLines(introLines.join("\n"));

  if (!bestLines.length) {
    // Fallback: use the first section only (usually profile intro, not highlights).
    const firstSection = header.querySelector("section");
    bestLines = normalizeBioLines(firstSection?.innerText || firstSection?.textContent || "");
  }

  if (!bestLines.length) {
    bestLines = normalizeBioLines(header.innerText || "");
  }

  return bestLines.slice(0, 6).join("\n") || null;
}

/**
 * Collects visible header text that can help contact extraction.
 * @returns {string}
 */
function getHeaderTextForContactExtraction() {
  const header = document.querySelector("main header") || document.querySelector("header");
  return header?.innerText?.trim() || "";
}

function extractFollowerCountToken(text) {
  if (!text) return null;

  const trimmed = String(text).trim();
  const followerLabelMatch = trimmed.match(/([\d,.]+\s*[KkMm]?)\s*followers?/i);
  if (followerLabelMatch?.[1]) return followerLabelMatch[1].replace(/\s+/g, "");

  // Fallback only when the whole token is a follower-like number.
  if (/^[\d,.]+\s*[KkMm]?$/.test(trimmed)) {
    return trimmed.replace(/\s+/g, "");
  }

  return null;
}

function cleanFullNameCandidate(value, username) {
  if (!value) return null;

  const firstLine = String(value)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";

  let text = firstLine
    .replace(/["'“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (username) {
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .replace(new RegExp(`\\(@${escapedUsername}\\)`, "ig"), "")
      .replace(new RegExp(`(^|\\s)@${escapedUsername}(\\s|$)`, "ig"), " ")
      .trim();
  }

  text = text.split("|")[0].split("•")[0].trim();

  if (!text || text.length < 2 || text.length > 80) return null;
  if (/instagram|followers?|following|posts?|message|follow|edit profile|contact|shop|professional|followed by|more/i.test(text)) return null;
  if (/^(link icon|profile picture|account icon|open app|open profile|see translation)$/i.test(text)) return null;
  if (/^(community|digital creator|creator|public figure|athlete|artist|musician\/band|personal blog|entrepreneur)$/i.test(text)) return null;
  const isExactUsername = Boolean(username && text.toLowerCase() === username.toLowerCase());
  if (/^[\d,.\sKkMm]+$/.test(text) && !isExactUsername) return null;
  if (/^\d+\s*(post|posts)?$/i.test(text)) return null;
  if (!/\p{L}/u.test(text) && !isExactUsername) return null;
  if (text.split(/\s+/).length > 8) return null;
  if (text.startsWith("@")) return null;

  return text;
}

function getProfileSnapshotFromScripts(username) {
  if (!username) return { fullName: null, followerCountRaw: null };

  const scripts = document.querySelectorAll("script");
  const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const decodeJsonEscaped = (value) => {
    if (!value) return null;
    try {
      return JSON.parse(`"${value}"`).trim() || null;
    } catch {
      return null;
    }
  };

  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes(`"username":"${username}"`)) continue;

    const fullNamePatterns = [
      new RegExp(`"username":"${escapedUsername}"[\\s\\S]{0,12000}?"full_name":"((?:\\\\.|[^"\\\\])*)"`),
      new RegExp(`"full_name":"((?:\\\\.|[^"\\\\])*)"[\\s\\S]{0,12000}?"username":"${escapedUsername}"`),
    ];

    const followerPatterns = [
      new RegExp(`"username":"${escapedUsername}"[\\s\\S]{0,12000}?"edge_followed_by":\\{[^}]*?"count":(\\d+)`),
      new RegExp(`"edge_followed_by":\\{[^}]*?"count":(\\d+)[\\s\\S]{0,12000}?"username":"${escapedUsername}"`),
      new RegExp(`"username":"${escapedUsername}"[\\s\\S]{0,12000}?"follower_count":(\\d+)`),
      new RegExp(`"follower_count":(\\d+)[\\s\\S]{0,12000}?"username":"${escapedUsername}"`),
    ];

    const fullNameMatch = fullNamePatterns
      .map((pattern) => text.match(pattern))
      .find((match) => match?.[1]);
    const fullName = cleanFullNameCandidate(decodeJsonEscaped(fullNameMatch?.[1]), username);

    const followerMatch = followerPatterns
      .map((pattern) => text.match(pattern))
      .find((match) => match?.[1]);

    const followerCountRaw = followerMatch?.[1]
      ? Number(followerMatch[1]).toLocaleString("en-US")
      : null;

    if (fullName || followerCountRaw) {
      return { fullName, followerCountRaw };
    }
  }

  return { fullName: null, followerCountRaw: null };
}

/**
 * Extracts the full name from the Instagram profile page.
 * Tries meta og:title first, then falls back to DOM heading elements.
 *
 * @returns {string|null}
 */
function getFullName() {
  const username = getUsername();

  // Strategy 1: og:title meta tag (format: "Full Name (@username) • Instagram photos and videos")
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const content = ogTitle.getAttribute("content");
    if (content) {
      // Extract "Full Name" from "Full Name (@username) • Instagram ..."
      const match = content.match(/^(.+?)\s*\(@/);
      if (match) {
        const cleanMatch = cleanFullNameCandidate(match[1], username);
        if (cleanMatch) return cleanMatch;
      }

      // Some profiles just have the name without the username format
      const simpleName = cleanFullNameCandidate(content.split("•")[0], username);
      if (simpleName) return simpleName;
    }
  }

  // Strategy 2: profile snapshot payload in scripts
  const scriptSnapshot = getProfileSnapshotFromScripts(username);
  if (scriptSnapshot.fullName) return scriptSnapshot.fullName;

  // Strategy 3: infer from og:description when available.
  const ogDescription = getOgDescriptionContent();
  if (ogDescription) {
    const escapedUsername = username ? username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
    const pattern = escapedUsername
      ? new RegExp(`from\\s+([^\\n]+?)\\s*\\(@${escapedUsername}\\)`, "i")
      : /from\s+([^\n]+?)\s*\(@[^)]+\)/i;
    const match = ogDescription.match(pattern);
    const fromOgDescription = cleanFullNameCandidate(match?.[1], username);
    if (fromOgDescription) return fromOgDescription;
  }

  // Strategy 4: Look for the full name in headings/spans near the top of the profile
  // Instagram renders the display name in a span inside the header section
  const headerSection = document.querySelector("header");
  if (headerSection) {
    const nodes = headerSection.querySelectorAll("h1, h2, section h1, section h2, section span");
    for (const node of nodes) {
      const candidate = cleanFullNameCandidate(node.textContent, username);
      if (!candidate) continue;
      if (/follow|message|edit profile|contact|shop|professional/i.test(candidate)) continue;
      return candidate;
    }
  }

  // Prefer username over wrong values when no reliable full name is found.
  return username || null;
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

  const bio = (
    getBioFromScripts(username) ||
    getBioFromOgDescription() ||
    getBioFromDom(username, fullName) ||
    null
  );

  return dedupeBioText(bio);
}

/**
 * Extracts the follower count string from the Instagram profile page.
 * Returns the raw string (e.g., "12.5K") without conversion.
 *
 * @returns {string|null}
 */
function getFollowerCount() {
  const username = getUsername();

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

  // Strategy 2: profile snapshot payload in scripts
  const scriptSnapshot = getProfileSnapshotFromScripts(username);
  if (scriptSnapshot.followerCountRaw) return scriptSnapshot.followerCountRaw;

  // Strategy 3: followers link and title attributes in profile header.
  const followerLink = document.querySelector('header a[href$="/followers/"]');
  if (followerLink) {
    const titleToken = extractFollowerCountToken(followerLink.getAttribute("title"));
    if (titleToken) return titleToken;

    const ariaToken = extractFollowerCountToken(followerLink.getAttribute("aria-label"));
    if (ariaToken) return ariaToken;

    const textToken = extractFollowerCountToken(followerLink.textContent);
    if (textToken) return textToken;
  }

  // Strategy 4: Search visible DOM for "followers" text and get the adjacent number
  const allElements = document.querySelectorAll("a, span, li");
  for (const el of allElements) {
    const text = el.textContent.trim().toLowerCase();
    if (text.includes("follower")) {
      // Try to extract the number from this element's text
      const numToken = extractFollowerCountToken(el.textContent);
      if (numToken) return numToken;

      // Check the title attribute (Instagram sometimes stores exact counts here)
      const title = el.getAttribute("title");
      if (title) {
        const titleToken = extractFollowerCountToken(title);
        if (titleToken) return titleToken;
      }

      // Check sibling or child span elements for the count
      const countSpan = el.querySelector("span span, span");
      if (countSpan) {
        const spanToken = extractFollowerCountToken(countSpan.textContent.trim());
        if (spanToken) return spanToken;
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

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,24}/g;
  const matches = text.match(emailRegex);
  if (!matches) return null;

  for (const match of matches) {
    const candidate = match.replace(/[.,;:!?]+$/, "").trim();
    const isValid =
      /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,24}$/.test(candidate) &&
      !candidate.includes("..") &&
      !candidate.startsWith(".") &&
      !candidate.endsWith(".");

    if (isValid) {
      return candidate.toLowerCase();
    }
  }

  return null;
}

/**
 * Extracts phone numbers from the bio text using regex.
 * @param {string} text - The bio text to search
 * @returns {string|null} - First phone number found, or null
 */
function extractPhoneFromText(text) {
  if (!text) return null;

  const contactKeywordRegex = /\b(phone|mobile|mob|call|contact|whatsapp|wa|tel)\b/i;
  const phonePattern = /(\+?\d[\d\s\-().]{8,}\d)/g;

  const normalizePhone = (raw, allowPlainTenDigit) => {
    if (!raw) return null;
    const candidate = raw.trim().replace(/[.,;:!?]+$/, "");
    const digitsOnly = candidate.replace(/\D/g, "");

    if (digitsOnly.length < 10 || digitsOnly.length > 15) return null;
    if (/^(\d)\1+$/.test(digitsOnly)) return null;

    const hasFormatSignal = /[+()\-\s]/.test(candidate);
    if (!allowPlainTenDigit && !hasFormatSignal) return null;

    return candidate.startsWith("+") ? `+${digitsOnly}` : digitsOnly;
  };

  // Only accept numbers from lines that signal contact intent.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!contactKeywordRegex.test(line)) continue;

    phonePattern.lastIndex = 0;
    let match;
    while ((match = phonePattern.exec(line)) !== null) {
      const normalized = normalizePhone(match[1], true);
      if (normalized) return normalized;
    }
  }

  return null;
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
  const bioText = dedupeBioText(jsonLdData?.bio || bio);
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

function hasReadyProfileData(data) {
  if (!data) return false;
  const expectedUsername = getUsername();
  if (
    expectedUsername &&
    data.username &&
    data.username.toLowerCase() !== expectedUsername.toLowerCase()
  ) {
    return false;
  }

  const headerText = (document.querySelector("main header")?.innerText || document.querySelector("header")?.innerText || "").toLowerCase();
  if (expectedUsername && headerText && !headerText.includes(expectedUsername.toLowerCase())) {
    return false;
  }

  return Boolean(data.fullName && data.followerCountRaw);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeProfileDataWithRetry(options = {}) {
  const attempts = options.attempts ?? 12;
  const delayMs = options.delayMs ?? 400;
  const expectedUsername = options.expectedUsername ?? getUsername();

  let latest = scrapeProfileData();
  if (hasReadyProfileData(latest, expectedUsername)) return latest;

  for (let i = 1; i < attempts; i++) {
    await wait(delayMs);
    latest = scrapeProfileData();
    if (hasReadyProfileData(latest, expectedUsername)) {
      return latest;
    }
  }

  return latest;
}

/**
 * Listen for messages from the popup requesting scraped data.
 * When the popup opens, it sends a "GET_SCRAPED_DATA" message.
 * We respond with the scraped profile data.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SCRAPED_DATA") {
    scrapeProfileDataWithRetry({ attempts: 12, delayMs: 400, expectedUsername: getUsername() })
      .then((data) => {
        sendResponse({ type: "SCRAPED_DATA", data: data });
      })
      .catch(() => {
        sendResponse({ type: "SCRAPED_DATA", data: scrapeProfileData() });
      });
  }
  // Return true to indicate we may respond asynchronously
  return true;
});

/**
 * Also proactively send scraped data when the content script loads.
 * This covers the case where the popup is already open when navigating to a profile.
 */
(function init() {
  scrapeProfileDataWithRetry({ attempts: 10, delayMs: 350, expectedUsername: getUsername() })
    .then((data) => {
      chrome.runtime.sendMessage({ type: "SCRAPED_DATA", data: data }).catch(() => {
        // Popup may not be open yet — this is expected, suppress the error
      });
    })
    .catch(() => {
      chrome.runtime.sendMessage({ type: "SCRAPED_DATA", data: scrapeProfileData() }).catch(() => {
        // Popup may not be open yet — this is expected, suppress the error
      });
    });
})();
