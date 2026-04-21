/**
 * oauth.js
 * Handles Google OAuth2 authentication using chrome.identity API.
 * Provides functions to obtain and revoke OAuth tokens for Google Sheets access.
 */

/**
 * Retrieves a valid OAuth2 access token using Chrome's identity API.
 * If no cached token exists, opens an interactive sign-in prompt.
 * On failure (e.g. token expired), clears the cache and retries once.
 *
 * @returns {Promise<string>} - A valid Google OAuth2 access token
 * @throws {Error} - If authentication fails after retry
 */
export async function getToken() {
  return new Promise((resolve, reject) => {
    // Request an auth token — interactive: true opens the consent screen if needed
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        // If we get an error, it may be due to an expired/invalid cached token
        // Attempt to remove the bad token and retry once
        const errorMessage = chrome.runtime.lastError.message;
        console.warn("LeadLens: Initial auth failed, retrying:", errorMessage);

        // Try to clear any cached token and re-authenticate
        chrome.identity.getAuthToken({ interactive: false }, (badToken) => {
          if (badToken) {
            // Remove the invalid cached token
            chrome.identity.removeCachedAuthToken({ token: badToken }, () => {
              // Retry with interactive prompt
              chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
                if (chrome.runtime.lastError || !newToken) {
                  reject(
                    new Error(
                      chrome.runtime.lastError?.message ||
                        "Authentication failed after retry"
                    )
                  );
                } else {
                  resolve(newToken);
                }
              });
            });
          } else {
            reject(new Error(errorMessage));
          }
        });
      } else if (token) {
        resolve(token);
      } else {
        reject(new Error("No token received from Chrome identity API"));
      }
    });
  });
}

/**
 * Revokes the current OAuth token and clears it from Chrome's cache.
 * Used when the user clicks "Sign Out" in the popup.
 *
 * @returns {Promise<void>}
 */
export async function revokeToken() {
  return new Promise((resolve, reject) => {
    // First, get the current cached token (non-interactive)
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        // Remove the token from Chrome's cache
        chrome.identity.removeCachedAuthToken({ token }, () => {
          // Also revoke the token on Google's servers
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
            .then(() => {
              console.log("LeadLens: Token revoked successfully");
              resolve();
            })
            .catch((err) => {
              // Even if server revocation fails, the local cache is cleared
              console.warn("LeadLens: Server revocation failed:", err);
              resolve();
            });
        });
      } else {
        // No token to revoke
        resolve();
      }
    });
  });
}
