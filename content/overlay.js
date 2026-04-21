/**
 * overlay.js — Injects a floating "Save Lead" button and slide-in panel
 * directly onto Instagram profile pages.
 *
 * Uses Shadow DOM for complete CSS isolation from Instagram's styles.
 * All dependencies are inlined because content scripts cannot use ES modules.
 */

(function () {
  "use strict";

  // ==================== INLINED CONSTANTS ====================

  const NICHES = [
    "Fashion & Lifestyle",
    "Food & Beverage",
    "Fitness & Health",
    "Travel",
    "Tech & Gadgets",
    "Beauty & Skincare",
    "Business & Finance",
    "Education",
    "Entertainment & Memes",
    "Parenting & Family",
  ];

  const TIERS = {
    Nano: { min: 1000, max: 10000 },
    Micro: { min: 10001, max: 100000 },
    Macro: { min: 100001, max: 1000000 },
    Mega: { min: 1000001, max: Infinity },
  };

  const NON_PROFILE_PATHS = [
    "explore", "reels", "stories", "direct", "accounts", "p", "tv", "reel",
  ];

  // ==================== INLINED UTILITY FUNCTIONS ====================

  function parseFollowerCount(str) {
    if (!str || typeof str !== "string") return null;
    let cleaned = str.trim().replace(/,/g, "");
    const match = cleaned.match(/^([\d.]+)\s*([KkMm]?)$/);
    if (!match) return null;
    let num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    if (suffix === "K") num *= 1000;
    else if (suffix === "M") num *= 1000000;
    return Math.round(num);
  }

  function assignTier(count) {
    if (typeof count !== "number" || isNaN(count) || count < 0) return "Unknown";
    for (const [tierName, range] of Object.entries(TIERS)) {
      if (count >= range.min && count <= range.max) return tierName;
    }
    return "Unknown";
  }

  async function isDuplicate(username) {
    if (!username) return false;
    const result = await chrome.storage.local.get("savedUsernames");
    const saved = result.savedUsernames || [];
    return saved.some((s) => s.toLowerCase() === username.toLowerCase());
  }

  async function markAsSaved(username) {
    if (!username) return;
    const result = await chrome.storage.local.get("savedUsernames");
    const saved = result.savedUsernames || [];
    if (!saved.some((s) => s.toLowerCase() === username.toLowerCase())) {
      saved.push(username);
      await chrome.storage.local.set({ savedUsernames: saved });
    }
  }

  // ==================== SCRAPING FUNCTIONS ====================

  function isProfilePage() {
    const path = window.location.pathname;
    const match = path.match(/^\/([^/]+)\/?$/);
    return match && !NON_PROFILE_PATHS.includes(match[1]);
  }

  function getUsername() {
    const path = window.location.pathname;
    const match = path.match(/^\/([^/]+)\/?$/);
    if (match && !NON_PROFILE_PATHS.includes(match[1])) return match[1];
    return null;
  }

  function extractFollowerCountToken(text) {
    if (!text) return null;

    const trimmed = String(text).trim();
    const followerLabelMatch = trimmed.match(/([\d,.]+\s*[KkMm]?)\s*followers?/i);
    if (followerLabelMatch?.[1]) return followerLabelMatch[1].replace(/\s+/g, "");

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

  function getFullName() {
    const username = getUsername();
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      const content = ogTitle.getAttribute("content");
      if (content) {
        const match = content.match(/^(.+?)\s*\(@/);
        if (match) {
          const cleanMatch = cleanFullNameCandidate(match[1], username);
          if (cleanMatch) return cleanMatch;
        }
        const simpleName = cleanFullNameCandidate(content.split("•")[0], username);
        if (simpleName) return simpleName;
      }
    }

    const scriptSnapshot = getProfileSnapshotFromScripts(username);
    if (scriptSnapshot.fullName) return scriptSnapshot.fullName;

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

    const headerSection = document.querySelector("header");
    if (headerSection) {
      const nodes = headerSection.querySelectorAll("h1, h2, span");
      for (const node of nodes) {
        const candidate = cleanFullNameCandidate(node.textContent, username);
        if (!candidate) continue;
        if (/follow|message|edit profile|contact|shop|professional/i.test(candidate)) continue;
        return candidate;
      }
    }

    return username || null;
  }

  function getOgDescriptionContent() {
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const content = ogDesc?.getAttribute("content")?.trim();
    return content || null;
  }

  function stripInstagramBoilerplate(text) {
    return text
      .replace(/See Instagram photos and videos from.*$/i, "")
      .replace(/Instagram:\s*/i, "")
      .trim();
  }

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

    return dedupeBioText(candidate);
  }

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
      return uiWordPattern.test(text) && text.length <= 50 && !hasBioSignal;
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

        const key = line.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
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

    const actionLineIndex = headerLines.findIndex((line) =>
      /^(follow|following|message|contact|email|edit profile|subscribed|subscribe)$/i.test(line)
    );
    const introLines = actionLineIndex > 0 ? headerLines.slice(0, actionLineIndex) : headerLines;

    let bestLines = normalizeBioLines(introLines.join("\n"));

    if (!bestLines.length) {
      const firstSection = header.querySelector("section");
      bestLines = normalizeBioLines(firstSection?.innerText || firstSection?.textContent || "");
    }

    if (!bestLines.length) {
      bestLines = normalizeBioLines(header.innerText || "");
    }

    return bestLines.slice(0, 6).join("\n") || null;
  }

  function getHeaderTextForContactExtraction() {
    const header = document.querySelector("main header") || document.querySelector("header");
    return header?.innerText?.trim() || "";
  }

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

  function getFollowerCount() {
    const username = getUsername();
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
      const content = ogDesc.getAttribute("content");
      if (content) {
        const match = content.match(/([\d,.]+[KkMm]?)\s*Followers/i);
        if (match) return match[1];
      }
    }

    const scriptSnapshot = getProfileSnapshotFromScripts(username);
    if (scriptSnapshot.followerCountRaw) return scriptSnapshot.followerCountRaw;

    const followerLink = document.querySelector('header a[href$="/followers/"]');
    if (followerLink) {
      const titleToken = extractFollowerCountToken(followerLink.getAttribute("title"));
      if (titleToken) return titleToken;

      const ariaToken = extractFollowerCountToken(followerLink.getAttribute("aria-label"));
      if (ariaToken) return ariaToken;

      const textToken = extractFollowerCountToken(followerLink.textContent);
      if (textToken) return textToken;
    }

    const allElements = document.querySelectorAll("a, span, li");
    for (const el of allElements) {
      const text = el.textContent.trim().toLowerCase();
      if (!text.includes("follower")) continue;

      const numToken = extractFollowerCountToken(el.textContent);
      if (numToken) return numToken;

      const titleToken = extractFollowerCountToken(el.getAttribute("title"));
      if (titleToken) return titleToken;
    }

    return null;
  }

  function extractEmail(text) {
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

  function extractPhone(text) {
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

  function scrapeProfile() {
    const bio = getBio();
    const fullBioText = [bio, getOgDescriptionContent(), getHeaderTextForContactExtraction()]
      .filter(Boolean)
      .join(" ");

    return {
      username: getUsername(),
      profileUrl: window.location.href,
      fullName: getFullName(),
      bio: bio,
      followerCountRaw: getFollowerCount(),
      email: extractEmail(fullBioText),
      phone: extractPhone(fullBioText),
    };
  }

  // ==================== STYLES ====================

  const STYLES = `
    /* ===== FLOATING ACTION BUTTON ===== */
    #leadlens-fab {
      position: fixed;
      top: 28px;
      right: 28px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #E1306C, #833AB4);
      box-shadow: 0 4px 16px rgba(225, 48, 108, 0.4), 0 2px 8px rgba(0,0,0,0.2);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: leadlens-fab-entrance 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    #leadlens-fab:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 24px rgba(225, 48, 108, 0.5), 0 4px 12px rgba(0,0,0,0.3);
    }

    #leadlens-fab:active {
      transform: scale(0.95);
    }

    #leadlens-fab img {
      width: 30px;
      height: 30px;
      border-radius: 4px;
      pointer-events: none;
    }

    #leadlens-fab .fab-pulse {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: linear-gradient(135deg, #E1306C, #833AB4);
      animation: leadlens-pulse 2s ease-in-out infinite;
      z-index: -1;
    }

    @keyframes leadlens-pulse {
      0%, 100% { transform: scale(1); opacity: 0.4; }
      50% { transform: scale(1.3); opacity: 0; }
    }

    @keyframes leadlens-fab-entrance {
      from { transform: scale(0) rotate(-180deg); opacity: 0; }
      to { transform: scale(1) rotate(0deg); opacity: 1; }
    }

    /* ===== BACKDROP ===== */
    #leadlens-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 999998;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    #leadlens-backdrop.open {
      opacity: 1;
    }

    #leadlens-backdrop.hidden {
      display: none;
    }

    /* ===== PANEL ===== */
    #leadlens-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 390px;
      height: 100vh;
      background: #0d0d0d;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #f0f0f0;
    }

    #leadlens-panel.open {
      transform: translateX(0);
    }

    #leadlens-panel.hidden {
      display: none;
    }

    /* Scrollbar */
    #leadlens-panel ::-webkit-scrollbar { width: 5px; }
    #leadlens-panel ::-webkit-scrollbar-track { background: #0d0d0d; }
    #leadlens-panel ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }
    #leadlens-panel ::-webkit-scrollbar-thumb:hover { background: #666; }

    /* ===== PANEL HEADER ===== */
    .ll-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      background: linear-gradient(135deg, #1a1a1a, #252525);
      border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0;
    }

    .ll-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ll-header-icon {
      width: 28px;
      height: 28px;
      border-radius: 6px;
    }

    .ll-header-title {
      font-size: 18px;
      font-weight: 700;
      background: linear-gradient(135deg, #E1306C, #833AB4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: -0.3px;
      margin: 0;
      padding: 0;
    }

    .ll-close-btn {
      background: none;
      border: 1px solid #2a2a2a;
      color: #a0a0a0;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition: all 0.2s ease;
      padding: 0;
    }

    .ll-close-btn:hover {
      border-color: #e74c3c;
      color: #e74c3c;
      background: rgba(231, 76, 60, 0.08);
    }

    /* ===== PANEL BODY ===== */
    .ll-body {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }

    /* ===== FORM SECTIONS ===== */
    .ll-section {
      padding: 14px 18px;
      border-bottom: 1px solid #2a2a2a;
    }

    .ll-section.editable {
      background: #1a1a1a;
    }

    .ll-section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #a0a0a0;
      margin: 0 0 12px 0;
      padding: 0;
    }

    .ll-section-icon {
      font-size: 14px;
    }

    /* ===== FORM FIELDS ===== */
    .ll-field {
      margin-bottom: 10px;
    }

    .ll-field:last-child {
      margin-bottom: 0;
    }

    .ll-field label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #666;
      margin-bottom: 4px;
    }

    .ll-field input,
    .ll-field textarea,
    .ll-field select {
      width: 100%;
      padding: 8px 10px;
      background: #1f1f1f;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      color: #f0f0f0;
      font-size: 13px;
      font-family: inherit;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      outline: none;
      box-sizing: border-box;
    }

    .ll-field input:focus,
    .ll-field textarea:focus,
    .ll-field select:focus {
      border-color: #E1306C;
      box-shadow: 0 0 0 2px rgba(225, 48, 108, 0.25);
    }

    .ll-field input[readonly],
    .ll-field textarea[readonly] {
      background: #161616;
      color: #a0a0a0;
      cursor: default;
    }

    .ll-field input[readonly]:focus,
    .ll-field textarea[readonly]:focus {
      border-color: #2a2a2a;
      box-shadow: none;
    }

    .ll-field input::placeholder,
    .ll-field textarea::placeholder {
      color: #555;
    }

    .ll-field textarea {
      resize: vertical;
      min-height: 52px;
    }

    .ll-field select {
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 28px;
    }

    /* ===== FOLLOWER ROW ===== */
    .ll-follower-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ll-follower-row input {
      flex: 1;
    }

    .ll-tier-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .ll-tier-badge.hidden { display: none; }
    .ll-tier-badge.nano { background: rgba(46,204,113,0.15); color: #2ecc71; border: 1px solid rgba(46,204,113,0.3); }
    .ll-tier-badge.micro { background: rgba(52,152,219,0.15); color: #3498db; border: 1px solid rgba(52,152,219,0.3); }
    .ll-tier-badge.macro { background: rgba(155,89,182,0.15); color: #9b59b6; border: 1px solid rgba(155,89,182,0.3); }
    .ll-tier-badge.mega { background: rgba(241,196,15,0.15); color: #f1c40f; border: 1px solid rgba(241,196,15,0.3); }

    /* ===== PANEL FOOTER ===== */
    .ll-footer {
      padding: 14px 18px;
      border-top: 1px solid #2a2a2a;
      background: #0d0d0d;
      flex-shrink: 0;
    }

    /* ===== SAVE BUTTON ===== */
    .ll-save-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #E1306C, #c9245e);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.3px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .ll-save-btn::before {
      content: "";
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
      transition: left 0.5s ease;
    }

    .ll-save-btn:hover::before { left: 100%; }

    .ll-save-btn:hover {
      background: linear-gradient(135deg, #c9245e, #a01d4d);
      box-shadow: 0 4px 16px rgba(225, 48, 108, 0.25);
      transform: translateY(-1px);
    }

    .ll-save-btn:active { transform: translateY(0); }

    .ll-save-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .ll-save-btn:disabled::before { display: none; }

    /* ===== SPINNER ===== */
    .ll-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: ll-spin 0.6s linear infinite;
    }

    .ll-spinner.hidden { display: none; }

    @keyframes ll-spin {
      to { transform: rotate(360deg); }
    }

    /* ===== STATUS BAR ===== */
    .ll-status {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      text-align: center;
      animation: ll-fade-in 0.3s ease;
    }

    .ll-status.hidden { display: none; }
    .ll-status.success { background: rgba(46,204,113,0.1); color: #2ecc71; border: 1px solid rgba(46,204,113,0.25); }
    .ll-status.error { background: rgba(231,76,60,0.1); color: #e74c3c; border: 1px solid rgba(231,76,60,0.25); }
    .ll-status.warning { background: rgba(243,156,18,0.1); color: #f39c12; border: 1px solid rgba(243,156,18,0.25); }

    @keyframes ll-fade-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ===== DUPLICATE MODAL ===== */
    .ll-modal {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      animation: ll-fade-in 0.2s ease;
    }

    .ll-modal.hidden { display: none; }

    .ll-modal-content {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 24px;
      width: 280px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }

    .ll-modal-icon { font-size: 32px; margin-bottom: 12px; }

    .ll-modal-message {
      font-size: 14px;
      font-weight: 600;
      color: #f39c12;
      margin: 0 0 6px 0;
    }

    .ll-modal-sub {
      font-size: 12px;
      color: #a0a0a0;
      margin: 0 0 18px 0;
    }

    .ll-modal-actions {
      display: flex;
      gap: 10px;
    }

    .ll-modal-btn {
      flex: 1;
      padding: 9px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
    }

    .ll-modal-btn.cancel {
      background: #252525;
      color: #a0a0a0;
      border: 1px solid #2a2a2a;
    }

    .ll-modal-btn.cancel:hover {
      background: #1f1f1f;
      color: #f0f0f0;
    }

    .ll-modal-btn.confirm {
      background: #E1306C;
      color: #fff;
    }

    .ll-modal-btn.confirm:hover {
      background: #c9245e;
    }

    /* ===== SIGN OUT ===== */
    .ll-sign-out-btn {
      background: none;
      border: 1px solid #2a2a2a;
      color: #a0a0a0;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-left: auto;
    }

    .ll-sign-out-btn:hover {
      border-color: #e74c3c;
      color: #e74c3c;
      background: rgba(231,76,60,0.08);
    }

    /* ===== UTILITY ===== */
    .hidden { display: none !important; }
  `;

  // ==================== PANEL HTML ====================

  function buildPanelHTML(iconUrl) {
    const nicheOptions = NICHES.map(
      (n) => `<option value="${n}">${n}</option>`
    ).join("");

    return `
      <div class="ll-header">
        <div class="ll-header-left">
          <img src="${iconUrl}" alt="LeadLens" class="ll-header-icon" />
          <h1 class="ll-header-title">LeadLens</h1>
        </div>
        <button class="ll-sign-out-btn" id="ll-sign-out">Sign Out</button>
        <button class="ll-close-btn" id="ll-close">✕</button>
      </div>

      <div class="ll-body">
        <!-- Auto-Scraped Section -->
        <div class="ll-section">
          <h2 class="ll-section-title">
            <span class="ll-section-icon">🔍</span>
            Auto-Scraped Data
          </h2>

          <div class="ll-field">
            <label>Username</label>
            <input type="text" id="ll-username" readonly placeholder="Not found" />
          </div>

          <div class="ll-field">
            <label>Profile URL</label>
            <input type="text" id="ll-profileUrl" readonly placeholder="Not found" />
          </div>

          <div class="ll-field">
            <label>Full Name</label>
            <input type="text" id="ll-fullName" readonly placeholder="Not found" />
          </div>

          <div class="ll-field">
            <label>Follower Count</label>
            <div class="ll-follower-row">
              <input type="text" id="ll-followerCount" readonly placeholder="Not found" />
              <span id="ll-tierBadge" class="ll-tier-badge hidden">—</span>
            </div>
          </div>

          <div class="ll-field">
            <label>Bio</label>
            <textarea id="ll-bio" readonly rows="3" placeholder="Not found"></textarea>
          </div>

          <div class="ll-field">
            <label>Email</label>
            <input type="text" id="ll-email" readonly placeholder="Not found" />
          </div>

          <div class="ll-field">
            <label>Phone</label>
            <input type="text" id="ll-phone" readonly placeholder="Not found" />
          </div>
        </div>

        <!-- User-Editable Section -->
        <div class="ll-section editable">
          <h2 class="ll-section-title">
            <span class="ll-section-icon">✏️</span>
            You Fill In
          </h2>

          <div class="ll-field">
            <label>Niche / Category</label>
            <select id="ll-niche">
              <option value="">— Select a niche —</option>
              ${nicheOptions}
            </select>
          </div>

          <div class="ll-field">
            <label>Location</label>
            <input type="text" id="ll-location" placeholder="e.g. Los Angeles, CA" />
          </div>

          <div class="ll-field">
            <label>Notes / Remarks</label>
            <textarea id="ll-notes" rows="3" placeholder="Add any notes about this lead..."></textarea>
          </div>
        </div>
      </div>

      <div class="ll-footer">
        <button class="ll-save-btn" id="ll-saveBtn">
          <span id="ll-saveBtnText">Save Lead</span>
          <span id="ll-saveBtnSpinner" class="ll-spinner hidden"></span>
        </button>
        <div id="ll-status" class="ll-status hidden"></div>
      </div>

      <!-- Duplicate Modal -->
      <div id="ll-duplicateModal" class="ll-modal hidden">
        <div class="ll-modal-content">
          <div class="ll-modal-icon">⚠️</div>
          <p class="ll-modal-message">This profile has already been saved as a lead.</p>
          <p class="ll-modal-sub">Do you want to save it again?</p>
          <div class="ll-modal-actions">
            <button id="ll-modalCancel" class="ll-modal-btn cancel">Cancel</button>
            <button id="ll-modalConfirm" class="ll-modal-btn confirm">Save Anyway</button>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== OVERLAY MANAGER ====================

  let shadowRoot = null;
  let isOverlayCreated = false;
  let isPanelOpen = false;
  let currentScrapedData = {};
  let parsedFollowerCount = null;
  let followerTier = "Unknown";
  let scrapeRequestSeq = 0;

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

  async function scrapeProfileWithRetry(options = {}) {
    const attempts = options.attempts ?? 10;
    const delayMs = options.delayMs ?? 350;
    const expectedUsername = options.expectedUsername ?? getUsername();

    let latest = scrapeProfile();
    if (hasReadyProfileData(latest, expectedUsername)) return latest;

    for (let i = 1; i < attempts; i++) {
      await wait(delayMs);
      latest = scrapeProfile();
      if (hasReadyProfileData(latest, expectedUsername)) {
        return latest;
      }
    }

    return latest;
  }

  function isEditableElement(element) {
    if (!element || !(element instanceof Element)) return false;
    if (element.matches('input:not([readonly]), textarea:not([readonly]), select')) return true;
    return element.isContentEditable === true;
  }

  function setupKeyboardIsolation() {
    const panel = shadowRoot.getElementById("leadlens-panel");
    if (!panel) return;

    const stopShortcutPropagation = (event) => {
      if (!isPanelOpen) return;
      if (!isEditableElement(event.target)) return;

      // Let the user type normally, but block page-level shortcut handlers.
      event.stopPropagation();
    };

    panel.addEventListener("keydown", stopShortcutPropagation, true);
    panel.addEventListener("keyup", stopShortcutPropagation, true);
    panel.addEventListener("keypress", stopShortcutPropagation, true);
  }

  /**
   * Creates the overlay UI (FAB button + panel) using Shadow DOM.
   */
  function createOverlay() {
    if (isOverlayCreated) return;

    const host = document.createElement("div");
    host.id = "leadlens-overlay-host";
    shadowRoot = host.attachShadow({ mode: "closed" });

    // Inject styles
    const style = document.createElement("style");
    style.textContent = STYLES;
    shadowRoot.appendChild(style);

    // Create FAB button
    const fab = document.createElement("button");
    fab.id = "leadlens-fab";

    const pulse = document.createElement("div");
    pulse.className = "fab-pulse";
    fab.appendChild(pulse);

    const fabIcon = document.createElement("img");
    fabIcon.src = chrome.runtime.getURL("assets/icons/icon48.png");
    fabIcon.alt = "LeadLens";
    fab.appendChild(fabIcon);

    fab.addEventListener("click", togglePanel);
    shadowRoot.appendChild(fab);

    // Create backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "leadlens-backdrop";
    backdrop.classList.add("hidden");
    backdrop.addEventListener("click", closePanel);
    shadowRoot.appendChild(backdrop);

    // Create panel
    const panel = document.createElement("div");
    panel.id = "leadlens-panel";
    panel.classList.add("hidden");
    const iconUrl = chrome.runtime.getURL("assets/icons/icon48.png");
    panel.innerHTML = buildPanelHTML(iconUrl);
    shadowRoot.appendChild(panel);

    document.body.appendChild(host);
    isOverlayCreated = true;

    // Set up event listeners on panel elements
    setupPanelListeners();
    setupKeyboardIsolation();
  }

  /**
   * Removes the overlay from the page.
   */
  function removeOverlay() {
    const host = document.getElementById("leadlens-overlay-host");
    if (host) host.remove();
    isOverlayCreated = false;
    isPanelOpen = false;
    shadowRoot = null;
  }

  /**
   * Toggles the panel open/closed.
   */
  function togglePanel() {
    if (isPanelOpen) closePanel();
    else openPanel();
  }

  /**
   * Opens the panel and scrapes the current profile.
   */
  function openPanel() {
    if (!shadowRoot) return;

    const backdrop = shadowRoot.getElementById("leadlens-backdrop");
    const panel = shadowRoot.getElementById("leadlens-panel");

    // Show backdrop
    backdrop.classList.remove("hidden");
    requestAnimationFrame(() => backdrop.classList.add("open"));

    // Show and animate panel
    panel.classList.remove("hidden");
    requestAnimationFrame(() => panel.classList.add("open"));

    // Hide FAB while panel is open
    const fab = shadowRoot.getElementById("leadlens-fab");
    if (fab) fab.style.display = "none";

    isPanelOpen = true;

    // Scrape and populate
    scrapeAndPopulate();
  }

  /**
   * Closes the panel.
   */
  function closePanel() {
    if (!shadowRoot) return;

    const backdrop = shadowRoot.getElementById("leadlens-backdrop");
    const panel = shadowRoot.getElementById("leadlens-panel");
    const fab = shadowRoot.getElementById("leadlens-fab");

    backdrop.classList.remove("open");
    panel.classList.remove("open");

    // Wait for animation to finish before hiding
    setTimeout(() => {
      backdrop.classList.add("hidden");
      panel.classList.add("hidden");
      if (fab) fab.style.display = "";
    }, 350);

    isPanelOpen = false;
  }

  /**
   * Scrapes the current profile and populates form fields.
   */
  async function scrapeAndPopulate() {
    const requestSeq = ++scrapeRequestSeq;
    const expectedUsername = getUsername();
    const data = await scrapeProfileWithRetry({ attempts: 10, delayMs: 350, expectedUsername });
    if (requestSeq !== scrapeRequestSeq) return;
    if (!isPanelOpen || !shadowRoot) return;
    if (
      expectedUsername &&
      data.username &&
      data.username.toLowerCase() !== expectedUsername.toLowerCase()
    ) {
      return;
    }

    currentScrapedData = data;

    // Reset follower state so stale values from a previous profile never leak through.
    parsedFollowerCount = null;
    followerTier = "Unknown";

    const $ = (id) => shadowRoot.getElementById(id);

    $("ll-username").value = data.username || "";
    $("ll-profileUrl").value = data.profileUrl || "";
    $("ll-fullName").value = data.fullName || "";
    $("ll-bio").value = data.bio || "";
    $("ll-email").value = data.email || "";
    $("ll-phone").value = data.phone || "";

    // Follower count + tier
    if (data.followerCountRaw) {
      $("ll-followerCount").value = data.followerCountRaw;
      parsedFollowerCount = parseFollowerCount(data.followerCountRaw);
      if (parsedFollowerCount !== null) {
        followerTier = assignTier(parsedFollowerCount);
        const badge = $("ll-tierBadge");
        badge.textContent = followerTier;
        badge.className = "ll-tier-badge";
        badge.classList.add(followerTier.toLowerCase());
      } else {
        $("ll-tierBadge").className = "ll-tier-badge hidden";
      }
    } else {
      $("ll-followerCount").value = "";
      $("ll-tierBadge").className = "ll-tier-badge hidden";
    }

    // Clear editable fields
    $("ll-niche").value = "";
    $("ll-location").value = "";
    $("ll-notes").value = "";

    // Clear status
    $("ll-status").className = "ll-status hidden";
  }

  /**
   * Sets up event listeners on panel elements.
   */
  function setupPanelListeners() {
    const $ = (id) => shadowRoot.getElementById(id);

    // Close button
    $("ll-close").addEventListener("click", closePanel);

    // Save button
    $("ll-saveBtn").addEventListener("click", () => handleSave(false));

    // Duplicate modal — Cancel
    $("ll-modalCancel").addEventListener("click", () => {
      $("ll-duplicateModal").classList.add("hidden");
    });

    // Duplicate modal — Confirm
    $("ll-modalConfirm").addEventListener("click", () => {
      $("ll-duplicateModal").classList.add("hidden");
      handleSave(true);
    });

    // Sign Out
    $("ll-sign-out").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "REVOKE_TOKEN" }, (response) => {
        if (response && response.success) {
          showStatus("Signed out successfully.", "success");
        } else {
          showStatus("Failed to sign out.", "error");
        }
      });
    });
  }

  /**
   * Builds the lead data object from form values.
   */
  function buildLeadObject() {
    const $ = (id) => shadowRoot.getElementById(id);
    const NOT_FOUND = "not found";

    const username = $("ll-username").value;
    const fullName = $("ll-fullName").value;

    return {
      username: username || NOT_FOUND,
      profileUrl: $("ll-profileUrl").value || NOT_FOUND,
      fullName: fullName || username || NOT_FOUND,
      followerCount: parsedFollowerCount || $("ll-followerCount").value || NOT_FOUND,
      followerTier: followerTier || NOT_FOUND,
      bio: $("ll-bio").value || NOT_FOUND,
      email: $("ll-email").value || NOT_FOUND,
      phone: $("ll-phone").value || NOT_FOUND,
      niche: $("ll-niche").value || NOT_FOUND,
      location: $("ll-location").value || NOT_FOUND,
      notes: $("ll-notes").value || NOT_FOUND,
    };
  }

  /**
   * Handles the save flow with duplicate checking.
   */
  async function handleSave(forceSave = false) {
    const $ = (id) => shadowRoot.getElementById(id);
    const username = $("ll-username").value;

    // Check for duplicates
    if (!forceSave && username) {
      const duplicate = await isDuplicate(username);
      if (duplicate) {
        $("ll-duplicateModal").classList.remove("hidden");
        return;
      }
    }

    // Hide previous status/modal
    $("ll-status").classList.add("hidden");
    $("ll-duplicateModal").classList.add("hidden");

    // Loading state
    const saveBtn = $("ll-saveBtn");
    const saveBtnText = $("ll-saveBtnText");
    const spinner = $("ll-saveBtnSpinner");
    saveBtn.disabled = true;
    saveBtnText.textContent = "Saving...";
    spinner.classList.remove("hidden");

    // Build lead data
    const leadData = buildLeadObject();

    // Send to service worker
    chrome.runtime.sendMessage(
      { type: "SAVE_LEAD", data: leadData },
      async (response) => {
        // Reset button
        saveBtn.disabled = false;
        saveBtnText.textContent = "Save Lead";
        spinner.classList.add("hidden");

        if (chrome.runtime.lastError) {
          showStatus(`Error: ${chrome.runtime.lastError.message}`, "error");
          return;
        }

        if (response && response.success) {
          if (username) await markAsSaved(username);
          showStatus("Lead saved successfully! ✓", "success");
        } else {
          const errMsg = response?.error || "Unknown error occurred";
          showStatus(`Error: ${errMsg}`, "error");
        }
      }
    );
  }

  /**
   * Shows a status message in the panel footer.
   */
  function showStatus(message, type) {
    const status = shadowRoot.getElementById("ll-status");
    status.className = `ll-status ${type}`;
    status.textContent = message;

    if (type === "success") {
      setTimeout(() => {
        status.classList.add("hidden");
      }, 5000);
    }
  }

  // ==================== URL CHANGE DETECTION ====================

  let lastUrl = location.href;

  /**
   * Handles URL changes (Instagram SPA navigation).
   * Shows/hides the FAB based on whether we're on a profile page.
   */
  function handleUrlChange() {
    if (isProfilePage()) {
      if (!isOverlayCreated) {
        createOverlay();
      } else {
        // Show the FAB if overlay exists but was hidden
        const fab = shadowRoot?.getElementById("leadlens-fab");
        if (fab) fab.style.display = "";
      }

      // Reset stale follower data from the previous profile
      parsedFollowerCount = null;
      followerTier = "Unknown";
      currentScrapedData = {};

      // If panel is open, re-scrape for the new profile
      if (isPanelOpen) {
        scrapeAndPopulate();
      }
    } else {
      // Not on a profile page — remove the overlay
      if (isPanelOpen) closePanel();
      removeOverlay();
    }
  }

  // Watch for SPA navigation (Instagram uses History API)
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Small delay to let Instagram render the new page
      setTimeout(handleUrlChange, 1000);
    }
  });

  urlObserver.observe(document.body, { subtree: true, childList: true });

  // ==================== INIT ====================

  // Initial check on script load
  setTimeout(() => {
    if (isProfilePage()) {
      createOverlay();
    }
  }, 1500);
})();
