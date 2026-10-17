/**
 * Ghost Hands - Side Panel Controller
 * Integrates open-source patterns:
 *  - Browser-Use DOM tree representation
 *  - Stagehand step state tracking
 *  - axe-core accessibility score rendering
 */

const statusBadge = document.getElementById("sp-status");
const intentCard = document.getElementById("sp-intent-card");
const intentInput = document.getElementById("sp-intent-input");
const startBtn = document.getElementById("sp-start-btn");
const guidanceCard = document.getElementById("sp-guidance-card");
const stepCount = document.getElementById("sp-step-count");
const progressFill = document.getElementById("sp-progress-fill");
const stepList = document.getElementById("sp-step-list");
const prevBtn = document.getElementById("sp-prev-btn");
const nextBtn = document.getElementById("sp-next-btn");
const stopBtn = document.getElementById("sp-stop-btn");
const largeTargetToggle = document.getElementById("sp-large-target-toggle");
const inspectBtn = document.getElementById("sp-inspect-btn");
const inspector = document.getElementById("sp-inspector");
const a11yScoreEl = document.getElementById("sp-a11y-score");

let activeTabId = null;
let currentSessionState = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (res?.ok) return true;
  } catch (e) {
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
      console.warn("Sidepanel auto-inject failed:", err);
      return false;
    }
  }
  return true;
}

async function init() {
  const tab = await getActiveTab();
  if (tab?.id) {
    activeTabId = tab.id;
    refreshState();
    loadAccessibilityScore(tab.id);
  }

  chrome.storage.local?.get(["isLargeTargetMode"], res => {
    if (res && res.isLargeTargetMode !== undefined) {
      largeTargetToggle.checked = res.isLargeTargetMode;
    }
  });
}

async function loadAccessibilityScore(tabId) {
  try {
    await ensureContentScript(tabId);
    const res = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_SNAPSHOT" });
    if (res?.snapshot) {
      const score = res.snapshot.accessibility_score || 90;
      a11yScoreEl.textContent = `${score}/100`;
      a11yScoreEl.style.background = score >= 80 ? "#dcfce7" : (score >= 60 ? "#fef3c7" : "#fee2e2");
      a11yScoreEl.style.color = score >= 80 ? "#15803d" : (score >= 60 ? "#b45309" : "#b91c1c");
    }
  } catch (e) {
    a11yScoreEl.textContent = "Ready";
  }
}

async function refreshState() {
  if (!activeTabId) {
    const tab = await getActiveTab();
    if (tab?.id) activeTabId = tab.id;
    else return;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type: "GET_SESSION_STATE" });
    if (response) {
      renderState(response);
    }
  } catch (err) {
    chrome.runtime.sendMessage({ type: "GET_SESSION_STATE" }, res => {
      if (res?.state) renderState(res.state);
    });
  }
}

function renderState(state) {
  if (!state) return;
  currentSessionState = state;

  if (state.active && state.plan && state.plan.length > 0) {
    statusBadge.textContent = "Guiding";
    statusBadge.classList.add("active");
    intentCard.style.display = "none";
    guidanceCard.style.display = "block";

    const currIdx = state.currentStepIndex || 0;
    const total = state.totalSteps || state.plan.length;
    stepCount.textContent = `Step ${currIdx + 1} of ${total}`;

    const percentage = Math.round(((currIdx) / total) * 100);
    progressFill.style.width = `${percentage}%`;

    // Render Steps List
    stepList.innerHTML = "";
    state.plan.forEach((step, idx) => {
      const item = document.createElement("div");
      item.className = "step-item";
      if (idx < currIdx) item.classList.add("completed");
      else if (idx === currIdx) item.classList.add("active");

      const icon = document.createElement("div");
      icon.className = "step-icon";
      if (idx < currIdx) icon.textContent = "✓";
      else if (idx === currIdx) icon.textContent = "🖐️";
      else icon.textContent = `${idx + 1}`;

      const content = document.createElement("div");
      content.className = "step-content";

      const title = document.createElement("div");
      title.className = "step-title";
      title.textContent = step.instruction || `Step ${step.step_id}`;

      if (step.is_sensitive) {
        const sensitiveBadge = document.createElement("span");
        sensitiveBadge.className = "step-badge sensitive";
        sensitiveBadge.textContent = "🔒 Sensitive";
        title.appendChild(sensitiveBadge);
      }

      if (step.needs_large_target) {
        const a11yBadge = document.createElement("span");
        a11yBadge.className = "step-badge a11y";
        a11yBadge.textContent = "🎯 <44px";
        title.appendChild(a11yBadge);
      }

      const targetText = document.createElement("div");
      targetText.className = "step-target";
      targetText.textContent = `Target: ${step.visible_label || step.accessible_name || step.target_ref || "Page element"}`;

      content.appendChild(title);
      content.appendChild(targetText);
      item.appendChild(icon);
      item.appendChild(content);

      item.addEventListener("click", () => {
        if (activeTabId) {
          chrome.tabs.sendMessage(activeTabId, {
            type: "SHOW_STEP",
            stepIndex: idx
          });
        }
      });

      stepList.appendChild(item);
    });

    prevBtn.disabled = currIdx <= 0;
    nextBtn.textContent = currIdx >= total - 1 ? "Finish ✓" : "Next / Skip →";
  } else {
    statusBadge.textContent = "Ready";
    statusBadge.classList.remove("active");
    intentCard.style.display = "block";
    guidanceCard.style.display = "none";
    progressFill.style.width = "0%";
  }

  if (state.isLargeTargetMode !== undefined) {
    largeTargetToggle.checked = state.isLargeTargetMode;
  }
}

// Event Listeners
startBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  activeTabId = tab.id;

  const intent = intentInput.value.trim() || "Guide me through this webpage";
  startBtn.textContent = "⏳ Analyzing Page...";
  startBtn.disabled = true;

  try {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type: "START_GUIDANCE",
      intent
    });
  } catch (err) {
    alert("Could not start guidance on this page. Please refresh the page and try again.");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "🖐️ Start Guided Steps";
  }
});

prevBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "PREV_STEP" });
  }
});

nextBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "NEXT_STEP" });
  }
});

stopBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "STOP" });
  }
  chrome.runtime.sendMessage({ type: "STOP_SESSION" });
  renderState({ active: false });
});

largeTargetToggle.addEventListener("change", async () => {
  const enabled = largeTargetToggle.checked;
  chrome.storage.local?.set({ isLargeTargetMode: enabled });

  const tab = await getActiveTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_LARGE_TARGET",
      enabled
    });
  }
});

inspectBtn.addEventListener("click", async () => {
  if (inspector.classList.contains("visible")) {
    inspector.classList.remove("visible");
    inspectBtn.textContent = "Inspect DOM";
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    inspector.textContent = "No active tab detected.";
    inspector.classList.add("visible");
    return;
  }

  inspector.textContent = "Extracting Browser-Use sanitized DOM map with axe-core signals...";
  inspector.classList.add("visible");
  inspectBtn.textContent = "Hide DOM";

  try {
    await ensureContentScript(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_SNAPSHOT" });
    if (res?.snapshot) {
      inspector.textContent = JSON.stringify(res.snapshot, null, 2);
    } else {
      inspector.textContent = "No elements returned in snapshot.";
    }
  } catch (e) {
    inspector.textContent = "Error extracting DOM map: " + String(e);
  }
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "SESSION_STATE_CHANGED" && msg.state) {
    renderState(msg.state);
  }
});

document.addEventListener("DOMContentLoaded", init);
