/**
 * constants.js
 * Central configuration file for LeadLens Chrome Extension.
 * Users must fill in GOOGLE_CLIENT_ID and SHEET_ID before using the extension.
 */

// Google OAuth2 Client ID — obtain from Google Cloud Console
export const GOOGLE_CLIENT_ID = "19984992940-46pph6ig1nldsrikdgh0kupoamc4coot.apps.googleusercontent.com"; // <-- Paste your OAuth2 Client ID here

// Google Sheet ID — found in the sheet URL:
// https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
export const SHEET_ID = "19-RKGyE7iOUgjN_lzDqf_XWHKR3Mo_BJj8WaaEX7vQ8"; // <-- Paste your Google Sheet ID here

// Default range for appending rows (appends after last row in Sheet1)
export const SHEET_RANGE = "Sheet1!A:A";

// OAuth scopes required for the Sheets API
export const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// Predefined niche categories for influencer classification
export const NICHES = [
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

// Follower tier definitions with min/max ranges
export const TIERS = {
  Nano: { min: 1000, max: 10000 },
  Micro: { min: 10001, max: 100000 },
  Macro: { min: 100001, max: 1000000 },
  Mega: { min: 1000001, max: Infinity },
};
