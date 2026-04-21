# 🔍 LeadLens — Instagram Lead Scraper for Google Sheets

<p align="center">
  <img src="assets/icons/icon128.png" alt="LeadLens Icon" width="128" />
</p>

**LeadLens** is a Chrome Extension (Manifest V3) that overlays on Instagram profile pages and helps marketers save influencer/prospect data directly into a Google Sheet.

---

## ✨ Features

- **Auto-Scrape Instagram Profiles** — Extracts username, full name, bio, follower count, email, and phone from any Instagram profile page
- **Follower Tier Classification** — Automatically assigns Nano / Micro / Macro / Mega tier based on follower count
- **Google Sheets Integration** — Saves leads as structured rows via the Google Sheets API v4
- **Duplicate Detection** — Warns you before saving a profile that's already in your lead list
- **Dark Theme UI** — Clean, modern popup with Instagram-inspired accent colours
- **No External Dependencies** — Pure vanilla JavaScript, no frameworks or libraries

---

## 📁 Project Structure

```
leadlens/
├── manifest.json              # Chrome Extension manifest (V3)
├── background/
│   └── service-worker.js      # Background service worker — handles OAuth & Sheets API
├── content/
│   └── scraper.js             # Content script — scrapes Instagram profile data
├── popup/
│   ├── popup.html             # Popup UI layout
│   ├── popup.css              # Dark theme styling
│   └── popup.js               # Popup logic & event handling
├── auth/
│   └── oauth.js               # Google OAuth2 via chrome.identity
├── sheets/
│   └── sheets.js              # Google Sheets API v4 integration
├── utils/
│   ├── parser.js              # Follower count parsing & tier assignment
│   └── duplicates.js          # Duplicate lead detection
├── config/
│   └── constants.js           # Configuration constants (API IDs, niches, tiers)
├── assets/
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── README.md
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
4. Select the `leadlens/` directory
5. Note the **Extension ID** shown on the card — use this in your Google Cloud OAuth credential configuration (step 1.7 above)

### 4. Prepare Your Google Sheet

Create a Google Sheet with the following column headers in **Row 1**:

| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Date Added | Username | Profile URL | Full Name | Follower Count | Follower Tier | Bio | Email | Phone | Niche / Category | Location | Notes / Remarks |

---

## 🎯 How to Use

1. Navigate to any Instagram profile page (e.g., `https://www.instagram.com/username/`)
2. Click the **LeadLens** extension icon in your browser toolbar
3. The popup auto-fills scraped data (username, name, bio, followers, email, phone)
4. Select a **Niche / Category** from the dropdown
5. Optionally add **Location** and **Notes**
6. Click **Save Lead** — the data is appended to your Google Sheet!

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
| `identity` | Google OAuth2 sign-in for Sheets API access |
| `storage` | Store saved usernames locally for duplicate detection |
| `activeTab` | Access the currently active Instagram tab |
| `scripting` | Inject content script if not already loaded |
| `host: instagram.com` | Scrape profile data from Instagram pages |
| `host: sheets.googleapis.com` | Make API calls to Google Sheets |

---

## ⚠️ Important Notes

- **Instagram DOM scraping** relies on meta tags (`og:title`, `og:description`) for stability. Instagram frequently changes their DOM structure and class names, so class-based selectors are avoided.
- **Google Sheets API** calls are made from the service worker (not the popup) to avoid CORS issues.
- If the OAuth token expires, the extension will automatically re-authenticate.
- The extension only works on Instagram **profile pages** — it will show an error message on other Instagram pages (explore, reels, etc.).

---

## 🛠️ Development

This extension uses **vanilla JavaScript** with ES modules. No build step is required.

To make changes:
1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the **reload** button (🔄) on the LeadLens card
4. Test on an Instagram profile page

---

## 📄 License

MIT License — feel free to use and modify for your own projects.
