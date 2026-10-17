/**
 * Ghost Hands - Popup Controller
 */

const intentInput = document.getElementById("intent");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const openSidepanelBtn = document.getElementById("open-sidepanel");
const largeTargetToggle = document.getElementById("large-target-toggle");
const statusPill = document.getElementById("status-pill");
const activeBanner = document.getElementById("active-banner");
const bannerStepCount = document.getElementById("banner-step-count");
const bannerInstruction = document.getElementById("banner-instruction");
const quickChips = document.querySelectorAll(".chip");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Ensures content scripts are active on the target tab
async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (res?.ok) return true;
  } catch (e) {
    // Script not yet injected, inject dynamically
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content/overlay.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          "shared/messages.js",
          "content/overlay.js",
          "content/content-script.js"
        ]
      });
      return true;
    } catch (err) {
      console.warn("Auto-inject failed:", err);
      return false;
    }
  }
  return true;
}

// Quick chip clicks
quickChips.forEach(chip => {
  chip.addEventListener("click", () => {
    intentInput.value = chip.getAttribute("data-intent");
    intentInput.focus();
  });
});

// Load initial state and preferences
async function init() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  // Retrieve saved Large Target preference
  chrome.storage.local?.get(["isLargeTargetMode"], result => {
    if (result && result.isLargeTargetMode !== undefined) {
      largeTargetToggle.checked = result.isLargeTargetMode;
    }
  });

  // Query tab for active session status
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SESSION_STATE" });
    if (response && response.active) {
      updateActiveUI(response);
    }
  } catch (err) {
    // Tab might need injection or is restricted
  }
}

function updateActiveUI(state) {
  if (state && state.active) {
    statusPill.textContent = "Guiding";
    statusPill.classList.add("active");
    activeBanner.classList.add("visible");
    bannerStepCount.textContent = `Step ${(state.currentStepIndex || 0) + 1} of ${state.totalSteps || 1}`;
    if (state.currentStep) {
      bannerInstruction.textContent = state.currentStep.instruction || "Guided step active on page";
    }
    startButton.textContent = "🔄 Restart Guidance";
  } else {
    statusPill.textContent = "Ready";
    statusPill.classList.remove("active");
    activeBanner.classList.remove("visible");
    startButton.textContent = "🖐️ Start Guidance";
  }

  if (state && state.isLargeTargetMode !== undefined) {
    largeTargetToggle.checked = state.isLargeTargetMode;
  }
}

// Start Guidance
startButton.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const intent = intentInput.value.trim() || "Guide me through this webpage";

  startButton.textContent = "⏳ Analyzing Page...";
  startButton.disabled = true;

  try {
    await ensureContentScript(tab.id);

    await chrome.tabs.sendMessage(tab.id, {
      type: "START_GUIDANCE",
      intent
    });

    statusPill.textContent = "Guiding";
    statusPill.classList.add("active");
    setTimeout(() => window.close(), 400); // Close popup so user sees overlay
  } catch (err) {
    console.error("Failed to start guidance:", err);
    startButton.disabled = false;
    startButton.textContent = "🖐️ Start Guidance";
    alert("Could not start guidance on this page. If this is a system tab (chrome://), please test on a web page.");
  }
});

// Emergency Stop
stopButton.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "STOP" });
    } catch (e) {}
  }

  chrome.runtime.sendMessage({ type: "STOP_SESSION" });

  statusPill.textContent = "Stopped";
  statusPill.classList.remove("active");
  activeBanner.classList.remove("visible");
  startButton.disabled = false;
  startButton.textContent = "🖐️ Start Guidance";
});

// Large Target Toggle
largeTargetToggle.addEventListener("change", async () => {
  const enabled = largeTargetToggle.checked;
  chrome.storage.local?.set({ isLargeTargetMode: enabled });

  const tab = await getActiveTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_LARGE_TARGET",
      enabled
    }).catch(() => {});
  }
});

// Open Side Panel
openSidepanelBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (chrome.sidePanel && chrome.sidePanel.open && tab?.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
      window.close();
    }).catch(err => {
      console.warn("Could not open side panel:", err);
    });
  } else {
    chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
  }
});

// Listen for state changes
chrome.runtime.onMessage.addListener(message => {
  if (message.type === "SESSION_STATE_CHANGED" && message.state) {
    updateActiveUI(message.state);
  }
});

document.addEventListener("DOMContentLoaded", init);