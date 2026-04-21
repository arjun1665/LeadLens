/**
 * service-worker.js — Background Service Worker (Manifest V3)
 * Handles all privileged operations that cannot run in the popup or content script:
 *   - OAuth token management (via chrome.identity)
 *   - Google Sheets API calls (to avoid CORS issues in popup)
 *
 * Communicates with the popup via chrome.runtime.onMessage.
 */

// Import authentication and Sheets API modules
import { getToken, revokeToken } from "../auth/oauth.js";
import { appendLead } from "../sheets/sheets.js";

/**
 * Message listener — routes incoming messages to the appropriate handler.
 * Supported message types:
 *   - "SAVE_LEAD": Authenticates and appends lead data to Google Sheets
 *   - "REVOKE_TOKEN": Signs out the user by revoking their OAuth token
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle lead saving — the primary action of the extension
  if (message.type === "SAVE_LEAD") {
    handleSaveLead(message.data)
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("LeadLens: Failed to save lead:", error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  }

  // Handle token revocation — user clicked "Sign Out"
  if (message.type === "REVOKE_TOKEN") {
    handleRevokeToken()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("LeadLens: Failed to revoke token:", error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  }
});

/**
 * Handles the SAVE_LEAD flow:
 *   1. Obtains a valid OAuth token (may trigger interactive sign-in)
 *   2. Calls the Sheets API to append the lead row
 *   3. Returns the API response to the popup
 *
 * @param {Object} leadData - The lead data object from the popup
 * @returns {Promise<Object>} - The Sheets API response
 */
async function handleSaveLead(leadData) {
  // Step 1: Get OAuth token (triggers sign-in if needed)
  const token = await getToken();

  // Step 2: Append the lead row to Google Sheets
  const result = await appendLead(token, leadData);

  return result;
}

/**
 * Handles the REVOKE_TOKEN flow:
 *   1. Revokes the OAuth token on Google's servers
 *   2. Clears the cached token from Chrome's identity store
 *
 * @returns {Promise<void>}
 */
async function handleRevokeToken() {
  await revokeToken();
}
