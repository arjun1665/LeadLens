/**
 * sheets.js
 * Handles all interactions with the Google Sheets API v4.
 * Appends lead data as new rows to the configured spreadsheet.
 */

import { SHEET_ID, SHEET_RANGE } from "../config/constants.js";

/**
 * Appends a lead's data as a new row in the Google Sheet.
 * The row follows this exact column order:
 *   A: Date Added (YYYY-MM-DD)
 *   B: Username
 *   C: Profile URL
 *   D: Full Name
 *   E: Follower Count (numeric)
 *   F: Follower Tier
 *   G: Bio
 *   H: Email
 *   I: Phone
 *   J: Niche / Category
 *   K: Location
 *   L: Notes / Remarks
 *
 * @param {string} token - Valid Google OAuth2 access token
 * @param {Object} leadData - The lead data object with all fields
 * @returns {Promise<Object>} - The Sheets API response
 * @throws {Error} - If the API call fails
 */
export async function appendLead(token, leadData) {
  // Validate required configuration
  if (!SHEET_ID) {
    throw new Error(
      "SHEET_ID is not configured. Please set it in config/constants.js"
    );
  }

  // Build the row array in the exact column order expected by the sheet
  const rowArray = [
    new Date().toISOString().slice(0, 10),        // A: Date Added (date only)
    leadData.username || "",                       // B: Username
    leadData.profileUrl || "",                     // C: Profile URL
    leadData.fullName || "",                       // D: Full Name
    leadData.followerCount || "",                  // E: Follower Count (numeric)
    leadData.followerTier || "",                   // F: Follower Tier
    leadData.bio || "",                            // G: Bio
    leadData.email || "",                          // H: Email
    leadData.phone || "",                          // I: Phone
    leadData.niche || "",                          // J: Niche / Category
    leadData.location || "",                       // K: Location
    leadData.notes || "",                          // L: Notes / Remarks
  ];

  // Construct the Sheets API endpoint URL
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}:append` +
    `?valueInputOption=USER_ENTERED`;

  // Make the POST request to append the row
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      values: [rowArray],
    }),
  });

  // Parse the response
  const data = await response.json();

  // Check for API errors
  if (!response.ok) {
    const errorMessage =
      data.error?.message || `Sheets API error (HTTP ${response.status})`;
    throw new Error(errorMessage);
  }

  return data;
}
