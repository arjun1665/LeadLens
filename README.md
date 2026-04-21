# 🔍 LeadLens — Instagram Lead Scraper for Google Sheets

<p align="center">
  <img src="assets/icons/icon128.png" alt="LeadLens Icon" width="128" />
</p>

**LeadLens** is a Chrome Extension (Manifest V3) that helps marketers save Instagram influencer and prospect data directly into a Google Sheet. It provides two interfaces — a **popup** (via the toolbar icon) and an **in-page floating panel** (injected directly onto Instagram profile pages using Shadow DOM).

---

## ✨ Features

- **Auto-Scrape Instagram Profiles** — Extracts username, full name, bio, follower count, email, and phone from any Instagram profile page
- **In-Page Floating Panel** — A floating action button (FAB) with a slide-in panel injected directly onto Instagram, no need to open the popup
- **Shadow DOM Isolation** — The overlay panel is rendered inside a closed Shadow DOM to prevent CSS conflicts with Instagram
- **3-Tier Scraping Strategy** — Uses meta tags → embedded script payloads → visible DOM elements (in order of reliability) to extract data, avoiding fragile CSS class selectors
- **SPA Navigation Handling** — Automatically detects Instagram's client-side navigation and re-scrapes data when switching between profiles
- **Retry-Based Scraping** — Retries extraction up to 12 times with delays to handle Instagram's asynchronous rendering
- **Follower Tier Classification** — Automatically assigns Nano / Micro / Macro / Mega tier based on follower count
- **Google Sheets Integration** — Saves leads as structured 12-column rows via the Google Sheets API v4
- **Duplicate Detection** — Warns you before saving a profile that's already in your lead list (case-insensitive)
- **Dark Theme UI** — Clean, modern interface with Instagram-inspired accent colours (`#E1306C`)
- **Keyboard Isolation** — Typing in the overlay panel does not trigger Instagram's keyboard shortcuts
- **OAuth2 Token Caching** — Caches access tokens locally with automatic expiry handling
- **No External Dependencies** — Pure vanilla JavaScript, no frameworks or libraries

---

## 📁 Project Structure

```
LeadLens/
├── manifest.json                # Chrome Extension manifest (V3)
├── background/
│   └── service-worker.js        # Background service worker — routes messages, handles OAuth & Sheets API
├── content/
│   ├── scraper.js               # Content script — DOM scraping engine (838 lines)
│   └── overlay.js               # Content script — in-page floating panel with Shadow DOM (1,682 lines)
├── popup/
│   ├── popup.html               # Popup UI layout
│   ├── popup.css                # Dark theme styling (515 lines)
│   └── popup.js                 # Popup logic & event handling
├── auth/
│   └── oauth.js                 # Google OAuth2 via chrome.identity.launchWebAuthFlow
├── sheets/
│   └── sheets.js                # Google Sheets API v4 integration
├── utils/
│   ├── parser.js                # Follower count parsing & tier assignment
│   └── duplicates.js            # Duplicate lead detection via chrome.storage.local
├── config/
│   └── constants.js             # Configuration constants (API IDs, niches, tiers)
├── assets/
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── LICENSE
└── README.md
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Instagram Page                                 │
│  ┌──────────────┐   ┌────────────────────────────────────────────┐  │
│  │  scraper.js   │   │  overlay.js (Shadow DOM)                   │  │
│  │  DOM Scraping │   │  FAB Button → Slide-in Panel → Save Lead  │  │
│  │  Engine       │   │  (Inlined scraping + utilities)            │  │
│  └──────┬───────┘   └────────────────────┬───────────────────────┘  │
│         │                                │                          │
└─────────┼────────────────────────────────┼──────────────────────────┘
          │ GET_SCRAPED_DATA               │ SAVE_LEAD / REVOKE_TOKEN
          ▼                                ▼
┌──────────────────┐             ┌──────────────────────┐
│  popup.js        │────────────▶│  service-worker.js   │
│  Extension Popup │ SAVE_LEAD   │  Message Router      │
└──────────────────┘             └──────────┬───────────┘
                                            │
                                 ┌──────────┴───────────┐
                                 ▼                      ▼
                          ┌────────────┐         ┌────────────┐
                          │  oauth.js  │         │  sheets.js │
                          │  Token Mgmt│────────▶│  Sheets API│
                          └────────────┘  token  └────────────┘
```

---

## 🚀 Setup Instructions

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Google Sheets API** under APIs & Services → Library
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth 2.0 Client ID**
6. Select **Chrome Extension** as the application type
7. Enter your extension's ID (you'll get this after loading the unpacked extension — see step 3 below, then come back and update)
8. Copy the **Client ID**

### 2. Configure the Extension

Open `config/constants.js` and fill in:

```javascript
export const GOOGLE_CLIENT_ID = "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com";
export const SHEET_ID = "YOUR_GOOGLE_SHEET_ID_HERE";
```

**To get your Sheet ID:** Open your Google Sheet — the ID is in the URL:
```
https://docs.google.com/spreadsheets/d/{THIS_IS_YOUR_SHEET_ID}/edit
```

Also paste the same Client ID into `manifest.json` under `oauth2.client_id`:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
  ...
}
```

### 3. Load the Extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer Mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `LeadLens/` directory
5. Note the **Extension ID** shown on the card — use this in your Google Cloud OAuth credential configuration (step 1.7 above)

### 4. Prepare Your Google Sheet

Create a Google Sheet with the following column headers in **Row 1**:

| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Date Added | Username | Profile URL | Full Name | Follower Count | Follower Tier | Bio | Email | Phone | Niche / Category | Location | Notes / Remarks |

---

## 🎯 How to Use

### Option 1: In-Page Floating Panel (Recommended)

1. Navigate to any Instagram profile page (e.g., `https://www.instagram.com/username/`)
2. A **floating action button** (FAB) with the LeadLens icon appears in the top-right corner
3. Click the FAB — a **slide-in panel** opens from the right with auto-scraped data
4. Select a **Niche / Category**, add **Location** and **Notes**
5. Click **Save Lead** — the data is appended to your Google Sheet!
6. Navigate to another profile — the panel automatically re-scrapes the new profile

### Option 2: Extension Popup

1. Navigate to any Instagram profile page
2. Click the **LeadLens** extension icon in your browser toolbar
3. The popup auto-fills scraped data (username, name, bio, followers, email, phone)
4. Fill in the editable fields and click **Save Lead**

---

## 🕷️ Scraping Strategy

LeadLens uses a **3-tier extraction strategy** to reliably scrape data despite Instagram's frequently changing DOM:

| Priority | Source | Stability | Used For |
|----------|--------|-----------|----------|
| 1st | `<meta>` tags (`og:title`, `og:description`) | ⭐⭐⭐ High | Full name, follower count, bio |
| 2nd | Embedded `<script>` JSON payloads | ⭐⭐ Medium | Full name, follower count, bio (via `"biography"`, `"full_name"`, `"edge_followed_by"` keys) |
| 3rd | Visible DOM elements (header, links, spans) | ⭐ Low | Fallback for all fields |

> **Why not CSS class selectors?** Instagram uses randomised CSS class names that change on every build. Meta tags and embedded JSON payloads are far more stable.

### Retry Mechanism

Instagram is a Single Page Application (SPA) — when navigating between profiles, the DOM updates asynchronously. LeadLens retries scraping up to **12 times** with **400ms delays** until both `fullName` and `followerCountRaw` are successfully extracted.

---

## 📊 Follower Tiers

| Tier  | Range               | Badge Colour |
|-------|---------------------|--------------|
| Nano  | 1,000 – 10,000      | 🟢 Green     |
| Micro | 10,001 – 100,000    | 🔵 Blue      |
| Macro | 100,001 – 1,000,000 | 🟣 Purple    |
| Mega  | 1,000,001+          | 🟡 Gold      |

---

## 🔐 Permissions Explained

| Permission | Why It's Needed |
|------------|-----------------|
| `identity` | Google OAuth2 sign-in via `chrome.identity.launchWebAuthFlow` |
| `storage` | Cache OAuth tokens and saved usernames for duplicate detection |
| `activeTab` | Access the currently active Instagram tab |
| `scripting` | Inject content script if not already loaded |
| `host: instagram.com` | Scrape profile data from Instagram pages |
| `host: sheets.googleapis.com` | Make API calls to Google Sheets |

---

## ⚠️ Important Notes

- **Instagram DOM scraping** relies primarily on meta tags (`og:title`, `og:description`) and embedded script JSON payloads for stability. CSS class-based selectors are avoided because Instagram randomises class names on every build.
- **Google Sheets API** calls are made from the service worker (not the popup or content scripts) to avoid CORS issues.
- If the OAuth token expires, the extension will automatically re-authenticate with a 60-second safety buffer before expiry.
- The extension only works on Instagram **profile pages** — it automatically hides on non-profile pages (explore, reels, stories, direct, etc.).
- **Duplicate detection** is case-insensitive — "JohnDoe" and "johndoe" are treated as the same lead.
- The **overlay panel** uses a closed Shadow DOM, so Instagram's styles cannot interfere with the panel and vice versa.
- **Keyboard isolation** prevents typing in the panel's editable fields from triggering Instagram's keyboard shortcuts.
- All missing data fields default to `"not found"` so the Google Sheet never has blank cells.

---

## 🛠️ Development

This extension uses **vanilla JavaScript** with ES modules (for popup and service worker) and inlined dependencies (for content scripts). No build step is required.

To make changes:
1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the **reload** button (🔄) on the LeadLens card
4. Test on an Instagram profile page

### Key Technical Details

| Aspect | Implementation |
|--------|----------------|
| **Module System** | ES modules for `popup.js`, `service-worker.js`, `sheets.js`, `oauth.js`, `parser.js`, `duplicates.js`. IIFE with inlined deps for `overlay.js`. |
| **CSS Isolation** | Shadow DOM (closed mode) for the overlay panel |
| **SPA Detection** | `MutationObserver` on `document.body` watching for URL changes |
| **OAuth Flow** | Implicit grant via `chrome.identity.launchWebAuthFlow` (not `getAuthToken`) |
| **Token Storage** | `chrome.storage.local` with `leadlens_oauth_token` and `leadlens_token_expiry` keys |
| **Duplicate Storage** | `chrome.storage.local` with `savedUsernames` array |

---

## 📄 License

MIT License — feel free to use and modify for your own projects.
