/**
 * duplicates.js
 * Manages duplicate detection for saved leads using chrome.storage.local.
 * Stores an array of previously saved usernames and checks against it.
 */

/**
 * Checks whether a username has already been saved as a lead.
 *
 * @param {string} username - The Instagram username to check
 * @returns {Promise<boolean>} - True if the username was previously saved
 */
export async function isDuplicate(username) {
  if (!username) return false;

  // Retrieve the saved usernames array from local storage
  const result = await chrome.storage.local.get("savedUsernames");
  const savedUsernames = result.savedUsernames || [];

  // Case-insensitive comparison to avoid duplicates like "JohnDoe" vs "johndoe"
  return savedUsernames.some(
    (saved) => saved.toLowerCase() === username.toLowerCase()
  );
}

/**
 * Adds a username to the saved leads list in chrome.storage.local.
 * Called after a successful save to Google Sheets.
 *
 * @param {string} username - The Instagram username to mark as saved
 * @returns {Promise<void>}
 */
export async function markAsSaved(username) {
  if (!username) return;

  // Get current list, append new username, and persist
  const result = await chrome.storage.local.get("savedUsernames");
  const savedUsernames = result.savedUsernames || [];

  // Only add if not already present (safety check)
  if (
    !savedUsernames.some(
      (saved) => saved.toLowerCase() === username.toLowerCase()
    )
  ) {
    savedUsernames.push(username);
    await chrome.storage.local.set({ savedUsernames });
  }
}
