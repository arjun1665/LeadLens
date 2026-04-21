/**
 * oauth.js
 * Handles Google OAuth2 authentication using chrome.identity.launchWebAuthFlow.
 * This approach is more reliable than getAuthToken for Manifest V3 extensions
 * and avoids the "Custom URI scheme is not supported" error.
 */

const SCOPES = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_STORAGE_KEY = "leadlens_oauth_token";
const TOKEN_EXPIRY_KEY = "leadlens_token_expiry";

/**
 * Gets the OAuth2 Client ID from the manifest's oauth2 block.
 * @returns {string} - The configured client ID
 */
function getClientId() {
  return chrome.runtime.getManifest().oauth2.client_id;
}

/**
 * Gets the redirect URL for this extension.
 * Format: https://<extension-id>.chromiumapp.org/
 * @returns {string} - The redirect URL
 */
function getRedirectUrl() {
  return chrome.identity.getRedirectURL();
}

/**
 * Retrieves a valid OAuth2 access token.
 * First checks for a cached (non-expired) token in chrome.storage.local.
 * If no valid token exists, launches an interactive OAuth flow in a popup.
 *
 * @returns {Promise<string>} - A valid Google OAuth2 access token
 * @throws {Error} - If authentication fails or user cancels
 */
export async function getToken() {
  // Step 1: Check for a cached, non-expired token
  const cached = await chrome.storage.local.get([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY]);
  if (cached[TOKEN_STORAGE_KEY] && cached[TOKEN_EXPIRY_KEY]) {
    if (Date.now() < cached[TOKEN_EXPIRY_KEY]) {
      console.log("LeadLens: Using cached OAuth token");
      return cached[TOKEN_STORAGE_KEY];
    }
    // Token expired — clear it
    console.log("LeadLens: Cached token expired, re-authenticating...");
    await chrome.storage.local.remove([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY]);
  }

  // Step 2: Build the Google OAuth2 authorization URL
  const clientId = getClientId();
  const redirectUrl = getRedirectUrl();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUrl);
  authUrl.searchParams.set("scope", SCOPES);

  // Step 3: Launch the OAuth flow in a browser popup
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!responseUrl) {
          reject(new Error("Authentication was cancelled or failed"));
          return;
        }

        // Step 4: Parse the access token from the redirect URL's hash fragment
        // Google returns: redirect_uri#access_token=xxx&token_type=Bearer&expires_in=3600
        try {
          const url = new URL(responseUrl);
          const params = new URLSearchParams(url.hash.substring(1));
          const accessToken = params.get("access_token");
          const expiresIn = parseInt(params.get("expires_in"), 10);

          if (!accessToken) {
            reject(new Error("No access token received from Google"));
            return;
          }

          // Step 5: Cache the token with an expiry timestamp (60s safety buffer)
          const expiryTime = Date.now() + (expiresIn - 60) * 1000;
          chrome.storage.local.set({
            [TOKEN_STORAGE_KEY]: accessToken,
            [TOKEN_EXPIRY_KEY]: expiryTime,
          });

          console.log("LeadLens: Authentication successful");
          resolve(accessToken);
        } catch (err) {
          reject(new Error("Failed to parse authentication response"));
        }
      }
    );
  });
}

/**
 * Revokes the current OAuth token and clears it from local storage.
 * Used when the user clicks "Sign Out" in the popup.
 *
 * @returns {Promise<void>}
 */
export async function revokeToken() {
  const cached = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  const token = cached[TOKEN_STORAGE_KEY];

  if (token) {
    // Revoke the token on Google's servers
    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
      console.log("LeadLens: Token revoked successfully");
    } catch (err) {
      // Even if server revocation fails, clear local cache
      console.warn("LeadLens: Server revocation failed:", err);
    }
  }

  // Clear the cached token and expiry from local storage
  await chrome.storage.local.remove([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY]);
}
