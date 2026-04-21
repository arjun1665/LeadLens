/**
 * popup.js — Main logic for the LeadLens popup UI.
 * Handles:
 *   - Requesting scraped data from the content script
 *   - Populating form fields
 *   - Parsing follower counts and assigning tiers
 *   - Duplicate checking before save
 *   - Communicating with the service worker to save leads
 */

import { NICHES } from "../config/constants.js";
import { parseFollowerCount, assignTier } from "../utils/parser.js";
import { isDuplicate, markAsSaved } from "../utils/duplicates.js";

// ==================== DOM REFERENCES ====================

const errorState = document.getElementById("errorState");
const profileForm = document.getElementById("profileForm");
const saveBtn = document.getElementById("saveBtn");
const saveBtnText = document.querySelector(".save-btn-text");
const saveBtnSpinner = document.getElementById("saveBtnSpinner");
const statusBar = document.getElementById("statusBar");
const statusMessage = document.getElementById("statusMessage");
const signOutBtn = document.getElementById("signOutBtn");
const duplicateModal = document.getElementById("duplicateModal");
const modalCancel = document.getElementById("modalCancel");
const modalConfirm = document.getElementById("modalConfirm");
const tierBadge = document.getElementById("tierBadge");

// Form field references
const fields = {
  username: document.getElementById("username"),
  profileUrl: document.getElementById("profileUrl"),
  fullName: document.getElementById("fullName"),
  followerCount: document.getElementById("followerCount"),
  bio: document.getElementById("bio"),
  email: document.getElementById("email"),
  phone: document.getElementById("phone"),
  niche: document.getElementById("niche"),
  location: document.getElementById("location"),
  notes: document.getElementById("notes"),
};

// Store for the current scraped data (used during save)
let currentData = {};
// Store parsed follower count and tier
let parsedFollowerCount = null;
let followerTier = "Unknown";

// ==================== INITIALIZATION ====================

/**
 * Populate the niche dropdown from the NICHES constant.
 */
function populateNicheDropdown() {
  NICHES.forEach((niche) => {
    const option = document.createElement("option");
    option.value = niche;
    option.textContent = niche;
    fields.niche.appendChild(option);
  });
}

/**
 * On popup open, request scraped data from the active tab's content script.
 * If the current tab is not an Instagram profile, show the error state.
 */
async function initialize() {
  populateNicheDropdown();

  try {
    // Get the active tab in the current window
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // Check if we're on an Instagram page
    if (!tab || !tab.url || !tab.url.includes("instagram.com/")) {
      showError();
      return;
    }

    // Check if this is a profile page (not explore, reels, etc.)
    const url = new URL(tab.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
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

    if (
      pathParts.length === 0 ||
      nonProfilePaths.includes(pathParts[0])
    ) {
      showError();
      return;
    }

    // Send message to content script to get scraped data
    chrome.tabs.sendMessage(
      tab.id,
      { type: "GET_SCRAPED_DATA" },
      (response) => {
        if (chrome.runtime.lastError) {
          // Content script might not be injected yet — try injecting it
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              files: ["content/scraper.js"],
            },
            () => {
              // Retry after injection with a small delay
              setTimeout(() => {
                chrome.tabs.sendMessage(
                  tab.id,
                  { type: "GET_SCRAPED_DATA" },
                  (retryResponse) => {
                    if (
                      retryResponse &&
                      retryResponse.type === "SCRAPED_DATA"
                    ) {
                      populateFields(retryResponse.data);
                    } else {
                      // Fallback: populate with URL-derived data
                      populateFields({
                        username: pathParts[0],
                        profileUrl: tab.url,
                      });
                    }
                    showForm();
                  }
                );
              }, 1000);
            }
          );
        } else if (response && response.type === "SCRAPED_DATA") {
          populateFields(response.data);
          showForm();
        } else {
          // Fallback with minimal data from URL
          populateFields({
            username: pathParts[0],
            profileUrl: tab.url,
          });
          showForm();
        }
      }
    );
  } catch (err) {
    console.error("LeadLens: Initialization error:", err);
    showError();
  }
}

// ==================== UI STATE MANAGEMENT ====================

/**
 * Shows the error state (not on Instagram profile).
 */
function showError() {
  errorState.classList.remove("hidden");
  profileForm.classList.add("hidden");
}

/**
 * Shows the profile form.
 */
function showForm() {
  errorState.classList.add("hidden");
  profileForm.classList.remove("hidden");
}

/**
 * Shows a status message below the save button.
 * @param {string} message - The message text
 * @param {"success"|"error"|"warning"} type - Message type for styling
 */
function showStatus(message, type) {
  statusBar.className = `status-bar ${type}`;
  statusMessage.textContent = message;
  statusBar.classList.remove("hidden");

  // Auto-hide success messages after 5 seconds
  if (type === "success") {
    setTimeout(() => {
      statusBar.classList.add("hidden");
    }, 5000);
  }
}

/**
 * Sets the save button to loading state.
 * @param {boolean} loading - Whether the button should show a loading spinner
 */
function setSaveLoading(loading) {
  saveBtn.disabled = loading;
  saveBtnText.textContent = loading ? "Saving..." : "Save Lead";
  saveBtnSpinner.classList.toggle("hidden", !loading);
}

// ==================== FIELD POPULATION ====================

/**
 * Populates the form fields with scraped data.
 * Also parses follower count and assigns tier.
 *
 * @param {Object} data - The scraped profile data from the content script
 */
function populateFields(data) {
  if (!data) return;

  currentData = data;

  // Set read-only field values (use "Not found" placeholder for empty values)
  fields.username.value = data.username || "";
  fields.profileUrl.value = data.profileUrl || "";
  fields.fullName.value = data.fullName || "";
  fields.bio.value = data.bio || "";
  fields.email.value = data.email || "";
  fields.phone.value = data.phone || "";

  // Parse and display follower count with tier badge
  if (data.followerCountRaw) {
    fields.followerCount.value = data.followerCountRaw;
    parsedFollowerCount = parseFollowerCount(data.followerCountRaw);
    if (parsedFollowerCount !== null) {
      followerTier = assignTier(parsedFollowerCount);
      displayTierBadge(followerTier);
    }
  }
}

/**
 * Displays the follower tier as a coloured badge.
 * @param {string} tier - "Nano", "Micro", "Macro", "Mega", or "Unknown"
 */
function displayTierBadge(tier) {
  tierBadge.textContent = tier;
  // Remove all tier classes and add the current one
  tierBadge.className = "tier-badge";
  tierBadge.classList.add(tier.toLowerCase());
  tierBadge.classList.remove("hidden");
}

// ==================== SAVE LEAD ====================

/**
 * Builds the complete lead object from form values.
 * @returns {Object} - The lead data ready for the Sheets API
 */
function buildLeadObject() {
  return {
    username: fields.username.value,
    profileUrl: fields.profileUrl.value,
    fullName: fields.fullName.value,
    followerCount: parsedFollowerCount || fields.followerCount.value,
    followerTier: followerTier,
    bio: fields.bio.value,
    email: fields.email.value,
    phone: fields.phone.value,
    niche: fields.niche.value,
    location: fields.location.value,
    notes: fields.notes.value,
  };
}

/**
 * Handles the save flow:
 *   1. Check for duplicates
 *   2. If duplicate, show confirmation modal
 *   3. Send SAVE_LEAD message to service worker
 *   4. Handle success/error responses
 *
 * @param {boolean} forceSave - If true, skip duplicate check (user confirmed)
 */
async function handleSave(forceSave = false) {
  const username = fields.username.value;

  // Check for duplicates unless force-saving
  if (!forceSave && username) {
    const duplicate = await isDuplicate(username);
    if (duplicate) {
      // Show the duplicate warning modal
      duplicateModal.classList.remove("hidden");
      return;
    }
  }

  // Hide any previous status or modal
  statusBar.classList.add("hidden");
  duplicateModal.classList.add("hidden");

  // Show loading state
  setSaveLoading(true);

  // Build the lead data object
  const leadData = buildLeadObject();

  // Send to service worker for Sheets API call
  chrome.runtime.sendMessage(
    { type: "SAVE_LEAD", data: leadData },
    async (response) => {
      setSaveLoading(false);

      if (chrome.runtime.lastError) {
        showStatus(
          `Error: ${chrome.runtime.lastError.message}`,
          "error"
        );
        return;
      }

      if (response && response.success) {
        // Mark username as saved in local storage
        if (username) {
          await markAsSaved(username);
        }
        showStatus("Lead saved successfully! ✓", "success");
      } else {
        const errorMsg =
          response?.error || "Unknown error occurred";
        showStatus(`Error: ${errorMsg}`, "error");
      }
    }
  );
}

// ==================== EVENT LISTENERS ====================

// Save button click
saveBtn.addEventListener("click", () => {
  handleSave(false);
});

// Duplicate modal — Cancel
modalCancel.addEventListener("click", () => {
  duplicateModal.classList.add("hidden");
});

// Duplicate modal — Confirm (force save)
modalConfirm.addEventListener("click", () => {
  duplicateModal.classList.add("hidden");
  handleSave(true);
});

// Sign Out button
signOutBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "REVOKE_TOKEN" }, (response) => {
    if (response && response.success) {
      showStatus("Signed out successfully.", "success");
    } else {
      showStatus("Failed to sign out.", "error");
    }
  });
});

// Listen for scraped data messages (proactive send from content script)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCRAPED_DATA" && message.data) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const activeUrl = tab?.url || "";
      const activeMatch = activeUrl.match(/^https:\/\/www\.instagram\.com\/([^/?#]+)\/?/i);
      const activeUsername = activeMatch?.[1]?.toLowerCase();
      const messageUsername = message.data.username?.toLowerCase();

      if (activeUsername && messageUsername && activeUsername !== messageUsername) {
        return;
      }

      populateFields(message.data);
      showForm();
    });
  }
});

// ==================== START ====================
// Initialize the popup when it opens
initialize();
