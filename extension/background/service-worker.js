/**
 * Ghost Hands - Background Service Worker
 * Central message hub for backend API communication, session management,
 * and side panel synchronization.
 */

import "../shared/messages.js";

const BACKEND_URL = "http://localhost:8000";

const TARGET_FIELD_DEFINITIONS = [
  { id: "full-name", instruction: "Enter your full legal name as per university records", action_type: "input", alternatives: ["large_target"] },
  { id: "university-email", instruction: "Enter your official university email (@nsut.ac.in)", action_type: "input", alternatives: ["large_target"] },
  { id: "student-id", instruction: "Enter your student ID or roll number", action_type: "input", alternatives: ["large_target"] },
  { id: "current-year", instruction: "Select your current academic year", action_type: "select", alternatives: ["large_target"] },
  { id: "degree-programme", instruction: "Select your registered degree programme", action_type: "select", alternatives: ["large_target"] },
  { id: "scholarship-category", instruction: "Choose your eligible scholarship category", action_type: "select", alternatives: ["large_target"] },
  { id: "academic-achievements", instruction: "Provide details of your academic achievements, GPA, and awards", action_type: "input", alternatives: [] },
  { id: "personal-statement", instruction: "Write your personal statement explaining financial need or goals", action_type: "input", alternatives: [] },
  { id: "academic-transcript", instruction: "Upload your official academic transcript (PDF)", action_type: "file", alternatives: ["large_target"] },
  { id: "supporting-document", instruction: "Upload supporting income/category certificate", action_type: "file", alternatives: ["large_target"] },
  { id: "declaration", instruction: "Review the declaration and check the box to confirm", action_type: "click", alternatives: ["large_target"], needs_large_target: true },
  { id: "submit-button", instruction: "Click Submit Application to complete your submission", action_type: "click", requires_confirmation: true, alternatives: ["large_target"] },
  { id: "reset-button", instruction: "Reset form if needed", action_type: "click", requires_confirmation: true, alternatives: ["large_target"] }
];

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

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

// Generate offline fallback plan when backend is unreachable
function generateFallbackPlan(payload) {
  const elements = payload.page_snapshot || [];
  const intent = payload.intent || "Guided application workflow";

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

  // Check if known scholarship fields are present in the page snapshot
  const presentKnownFields = TARGET_FIELD_DEFINITIONS.filter(def => {
    return elements.some(el => el.id === def.id || el.ref === def.id || el.field_id === def.id);
  });

  if (presentKnownFields.length > 0) {
    let stepCounter = 1;
    const steps = presentKnownFields
      .filter(def => def.id !== "reset-button") // Omit reset button from standard forward flow
      .map(def => {
        const matchingEl = elements.find(el => el.id === def.id || el.ref === def.id || el.field_id === def.id);
        return {
          step_id: stepCounter++,
          target_ref: def.id,
          field_id: def.id,
          instruction: def.instruction,
          action_type: def.action_type,
          requires_confirmation: Boolean(def.requires_confirmation),
          needs_large_target: Boolean(def.needs_large_target || matchingEl?.needs_large_target),
          is_sensitive: Boolean(matchingEl?.is_sensitive),
          visible_label: matchingEl?.visible_label || matchingEl?.accessible_name || def.id,
          alternatives: def.alternatives || ["large_target"]
        };
      });

    return {
      session_id: `scholarship_${Date.now()}`,
      status: "ready",
      is_offline_fallback: true,
      steps
    };
  }

  // Generic fallback if page does not match scholarship form
  const inputs = elements.filter(el => ["input", "textarea", "select"].includes(el.tag));
  const buttons = elements.filter(el => el.tag === "button" || el.role === "button" || el.input_type === "submit");

  const plannedSteps = [];
  let stepCounter = 1;

  inputs.slice(0, 4).forEach(el => {
    const label = el.visible_label || el.accessible_name || el.placeholder || el.id || "this field";
    plannedSteps.push({
      step_id: stepCounter++,
      target_ref: el.id || el.ref,
      field_id: el.id || el.ref,
      instruction: el.is_sensitive
        ? `Please enter your secure ${label} (data is kept private)`
        : `Fill in ${label}`,
      action_type: el.tag === "select" ? "select" : "input",
      requires_confirmation: false,
      is_sensitive: el.is_sensitive,
      needs_large_target: el.needs_large_target,
      visible_label: label,
      alternatives: ["large_target"]
    });
  });

  if (buttons.length > 0) {
    const btn = buttons[0];
    const btnLabel = btn.visible_label || btn.accessible_name || btn.id || "Submit";
    plannedSteps.push({
      step_id: stepCounter++,
      target_ref: btn.id || btn.ref,
      field_id: btn.id || btn.ref,
      instruction: `Click "${btnLabel}" to proceed`,
      action_type: "click",
      requires_confirmation: true,
      visible_label: btnLabel,
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
        console.warn("[Ghost Hands SW] Backend offline, using local planner for fields:", error.message);
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

    return true;
  }

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
        sendResponse({ ok: true, offline: true });
      });

    return true;
  }

  if (message.type === "STEP_COMPLETED") {
    if (activeSessionState.sessionId === message.sessionId) {
      activeSessionState.currentStepIndex++;
    }

    fetch(`${BACKEND_URL}/sessions/${message.sessionId}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step_id: message.stepId,
        target_ref: message.targetRef
      })
    }).catch(() => {});

    notifyStateChanged();
    sendResponse({ ok: true });
    return true;
  }

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