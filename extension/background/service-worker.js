/**
 * Ghost Hands - Background Service Worker
 * Central message hub for backend API communication, session management,
 * and side panel synchronization.
 */

import "../shared/messages.js";

const BACKEND_URL = "http://localhost:8000";

// In-memory session tracking
let activeSessionState = {
  active: false,
  sessionId: null,
  intent: "",
  currentStepIndex: 0,
  totalSteps: 0,
  plan: [],
  isLargeTargetMode: false,
  tabId: null
};

// Enable Side Panel to open on action click or via message
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

// Generate offline fallback plan when backend is unreachable
function generateFallbackPlan(payload) {
  const elements = payload.page_snapshot || [];
  const intent = payload.intent || "Guided page workflow";

  if (!elements || elements.length === 0) {
    return {
      session_id: `fallback_${Date.now()}`,
      status: "ready",
      steps: [
        {
          step_id: 1,
          target_ref: "el_0",
          instruction: `Exploring page for: "${intent}". No interactive elements found.`,
          action_type: "notice",
          requires_confirmation: false,
          alternatives: ["large_target"]
        }
      ]
    };
  }

  // Filter useful fields (inputs, buttons, links)
  const inputs = elements.filter(el => ["input", "textarea", "select"].includes(el.tag));
  const buttons = elements.filter(el => el.tag === "button" || el.role === "button" || el.input_type === "submit");

  const plannedSteps = [];
  let stepCounter = 1;

  // Add inputs first
  const selectedInputs = inputs.slice(0, 3);
  selectedInputs.forEach(el => {
    const label = el.visible_label || el.accessible_name || el.placeholder || "this field";
    plannedSteps.push({
      step_id: stepCounter++,
      target_ref: el.ref,
      instruction: el.is_sensitive
        ? `Please enter your secure ${label} (data is kept private)`
        : `Fill in ${label}`,
      action_type: el.tag === "select" ? "select" : "input",
      requires_confirmation: false,
      is_sensitive: el.is_sensitive,
      visible_label: label,
      alternatives: ["large_target"]
    });
  });

  // Add button/submit as concluding step
  if (buttons.length > 0) {
    const btn = buttons[0];
    const btnLabel = btn.visible_label || btn.accessible_name || "Submit";
    plannedSteps.push({
      step_id: stepCounter++,
      target_ref: btn.ref,
      instruction: `Click "${btnLabel}" to proceed`,
      action_type: "click",
      requires_confirmation: true,
      visible_label: btnLabel,
      alternatives: ["large_target"]
    });
  } else if (elements.length > plannedSteps.length) {
    const otherEl = elements[plannedSteps.length];
    plannedSteps.push({
      step_id: stepCounter++,
      target_ref: otherEl.ref,
      instruction: `Interact with ${otherEl.visible_label || otherEl.accessible_name || "next element"}`,
      action_type: "click",
      requires_confirmation: false,
      alternatives: ["large_target"]
    });
  }

  return {
    session_id: `demo_${Date.now()}`,
    status: "ready",
    is_offline_fallback: true,
    steps: plannedSteps
  };
}

// Runtime Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderTabId = sender?.tab?.id || activeSessionState.tabId;

  // 1. Plan Request: forward to backend or fallback
  if (message.type === "PLAN_REQUEST") {
    fetch(`${BACKEND_URL}/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(message.payload)
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Backend returned status ${response.status}`);
        }
        const data = await response.json();
        updateActiveSession({
          active: true,
          sessionId: data.session_id,
          plan: data.steps || [],
          currentStepIndex: 0,
          totalSteps: data.steps?.length || 0,
          intent: message.payload?.intent || "",
          tabId: senderTabId
        });
        sendResponse({ ok: true, data });
      })
      .catch(error => {
        console.warn("[Ghost Hands SW] Backend offline or unreachable, using local planner:", error.message);
        const fallback = generateFallbackPlan(message.payload);
        updateActiveSession({
          active: true,
          sessionId: fallback.session_id,
          plan: fallback.steps,
          currentStepIndex: 0,
          totalSteps: fallback.steps.length,
          intent: message.payload?.intent || "",
          tabId: senderTabId
        });
        sendResponse({ ok: true, data: fallback, note: "Local fallback plan used (Backend offline)" });
      });

    return true; // Keep message channel open for async response
  }

  // 2. Confirm Action
  if (message.type === "CONFIRM_ACTION") {
    fetch(`${BACKEND_URL}/sessions/${message.sessionId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step_id: message.stepId,
        confirmed: true
      })
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        sendResponse({ ok: response.ok, data });
      })
      .catch(() => {
        // Offline graceful fallback
        sendResponse({ ok: true, offline: true });
      });

    return true;
  }

  // 3. Step Completed
  if (message.type === "STEP_COMPLETED") {
    if (activeSessionState.sessionId === message.sessionId) {
      activeSessionState.currentStepIndex++;
    }

    // Attempt notifying backend
    fetch(`${BACKEND_URL}/sessions/${message.sessionId}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step_id: message.stepId,
        target_ref: message.targetRef
      })
    }).catch(() => {});

    // Broadcast to sidepanel/popup
    notifyStateChanged();
    sendResponse({ ok: true });
    return true;
  }

  // 4. Stop Session
  if (message.type === "STOP_SESSION" || message.type === "STOP_GUIDANCE") {
    const sessId = message.sessionId || activeSessionState.sessionId;
    if (sessId) {
      fetch(`${BACKEND_URL}/sessions/${sessId}/stop`, {
        method: "POST"
      }).catch(() => {});
    }

    updateActiveSession({
      active: false,
      sessionId: null,
      plan: [],
      currentStepIndex: 0,
      totalSteps: 0,
      intent: ""
    });

    sendResponse({ ok: true });
    return true;
  }

  // 5. Open Side Panel
  if (message.type === "OPEN_SIDEPANEL") {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const windowId = sender.tab?.windowId;
      if (windowId) {
        chrome.sidePanel.open({ windowId }).then(() => {
          sendResponse({ ok: true });
        }).catch(err => {
          sendResponse({ ok: false, error: String(err) });
        });
        return true;
      }
    }
    sendResponse({ ok: false, error: "Side panel API not accessible in this context" });
    return true;
  }

  // 6. State Sync
  if (message.type === "GET_SESSION_STATE") {
    sendResponse({ ok: true, state: activeSessionState });
    return true;
  }

  if (message.type === "SESSION_STATE_CHANGED") {
    if (message.state) {
      updateActiveSession(message.state);
    }
    sendResponse({ ok: true });
    return true;
  }
});

function updateActiveSession(newState) {
  activeSessionState = { ...activeSessionState, ...newState };
  chrome.storage.session?.set({ ghostSession: activeSessionState }).catch(() => {});
  notifyStateChanged();
}

function notifyStateChanged() {
  chrome.runtime.sendMessage({
    type: "SESSION_STATE_CHANGED",
    state: activeSessionState
  }).catch(() => {});
}