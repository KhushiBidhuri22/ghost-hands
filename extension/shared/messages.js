/**
 * Ghost Hands - Shared Message Protocol
 * Defines all message types and schema helpers between Content Scripts, Service Worker,
 * Popup, and Side Panel.
 */

const MessageTypes = Object.freeze({
  // Guidance Lifecycle
  START_GUIDANCE: "START_GUIDANCE",
  STOP_GUIDANCE: "STOP_GUIDANCE",
  STOP_SESSION: "STOP_SESSION",
  GUIDANCE_STARTED: "GUIDANCE_STARTED",
  GUIDANCE_STOPPED: "GUIDANCE_STOPPED",

  // Step Navigation & Execution
  SHOW_STEP: "SHOW_STEP",
  STEP_COMPLETED: "STEP_COMPLETED",
  NEXT_STEP: "NEXT_STEP",
  PREV_STEP: "PREV_STEP",
  CONFIRM_ACTION: "CONFIRM_ACTION",

  // DOM Mapping & Snapshots
  GET_PAGE_SNAPSHOT: "GET_PAGE_SNAPSHOT",
  SNAPSHOT_RESPONSE: "SNAPSHOT_RESPONSE",

  // Backend Integration
  PLAN_REQUEST: "PLAN_REQUEST",
  PLAN_RESPONSE: "PLAN_RESPONSE",

  // State Synchronization & UI
  GET_SESSION_STATE: "GET_SESSION_STATE",
  SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED",
  TOGGLE_LARGE_TARGET: "TOGGLE_LARGE_TARGET",
  OPEN_SIDEPANEL: "OPEN_SIDEPANEL",
  PING: "PING"
});

// Helper creators
function createPlanRequest(intent, pageSnapshot, accessibilityMode = "visual") {
  return {
    type: MessageTypes.PLAN_REQUEST,
    payload: {
      intent,
      page_snapshot: pageSnapshot,
      accessibility_mode: accessibilityMode
    }
  };
}

function createConfirmAction(sessionId, stepId) {
  return {
    type: MessageTypes.CONFIRM_ACTION,
    sessionId,
    stepId
  };
}

function createStopSession(sessionId) {
  return {
    type: MessageTypes.STOP_SESSION,
    sessionId
  };
}

function createStepCompleted(sessionId, stepId, targetRef = null) {
  return {
    type: MessageTypes.STEP_COMPLETED,
    sessionId,
    stepId,
    targetRef
  };
}

// Universal module export pattern: works in browser scripts, service workers, and modules
const GhostMessages = {
  MessageTypes,
  createPlanRequest,
  createConfirmAction,
  createStopSession,
  createStepCompleted
};

(function (root) {
  if (typeof root !== "undefined") {
    root.MessageTypes = MessageTypes;
    root.GhostMessages = GhostMessages;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
