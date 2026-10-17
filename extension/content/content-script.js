/**
 * Ghost Hands - Content Script & DOM Mapper
 * Integrates open-source patterns:
 *  - Browser-Use: DOM tree simplification, sequential highlight indexing, and viewport tracking
 *  - Stagehand: act(), observe(), extract() primitives for deterministic guidance
 *  - axe-core: Accessibility rule engine (touch target sizing, form labels, WCAG compliance)
 *  - AgentQL: Semantic role and element classification
 */

(function () {
  let currentSession = null;
  let currentPlan = [];
  let currentStepIndex = 0;
  let isLargeTargetMode = false;
  let elementRefCache = new Map();
  let currentCompletionCleanup = null;

  // Sensitive keywords for privacy redaction
  const SENSITIVE_KEYWORDS = [
    "password", "passwd", "pwd", "otp", "pin", "cvv", "cvc",
    "card", "credit", "debit", "aadhaar", "passport", "ssn",
    "upi", "secret", "token", "auth", "security code", "pan"
  ];

  /**
   * axe-core Inspired Accessibility Rule Engine
   * Evaluates WCAG 2.5.5 / 2.5.8 Target Size, Form Labels, and Button Names
   */
  const AxeRules = {
    checkTargetSize(element, rect) {
      // WCAG 2.5.5 (AAA): 44x44px target size, WCAG 2.5.8 (AA): 24x24px
      const minAccessibleSize = 44;
      if (rect.width < minAccessibleSize || rect.height < minAccessibleSize) {
        return {
          id: "target-size",
          rule: "WCAG 2.5.5 / 2.5.8 Target Size",
          impact: rect.width < 24 || rect.height < 24 ? "critical" : "moderate",
          message: `Touch target is ${Math.round(rect.width)}×${Math.round(rect.height)}px (< 44×44px). Large Target Mode recommended.`,
          needs_large_target: true
        };
      }
      return null;
    },

    checkLabel(element, accessibleName) {
      if (!accessibleName || accessibleName.trim().length === 0) {
        return {
          id: "label",
          rule: "WCAG 4.1.2 Name, Role, Value",
          impact: "critical",
          message: "Form control is missing an accessible name or <label>.",
          needs_large_target: false
        };
      }
      return null;
    },

    checkButtonName(element, accessibleName) {
      if (!accessibleName || accessibleName.trim().length === 0) {
        return {
          id: "button-name",
          rule: "WCAG 4.1.2 Name, Role, Value",
          impact: "critical",
          message: "Button does not have discernible text or aria-label.",
          needs_large_target: false
        };
      }
      return null;
    }
  };

  /**
   * Sensitive Field Detection & Redaction
   */
  function isSensitiveElement(element) {
    const type = (element.type || "").toLowerCase();
    if (type === "password") return true;

    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
    if (
      autocomplete.includes("password") ||
      autocomplete.includes("cc-number") ||
      autocomplete.includes("cc-csc") ||
      autocomplete.includes("one-time-code")
    ) {
      return true;
    }

    const identifiers = [
      element.getAttribute("aria-label"),
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("data-testid"),
      getAssociatedLabelText(element)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return SENSITIVE_KEYWORDS.some(kw => identifiers.includes(kw));
  }

  function getAssociatedLabelText(element) {
    if (element.labels && element.labels.length > 0) {
      return element.labels[0].innerText || element.labels[0].textContent || "";
    }
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) return label.innerText || label.textContent || "";
    }
    const ariaLabelledBy = element.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const labelledEl = document.getElementById(ariaLabelledBy);
      if (labelledEl) return labelledEl.innerText || labelledEl.textContent || "";
    }
    return "";
  }

  function getAccessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const labelText = getAssociatedLabelText(element);
    if (labelText) return labelText.trim();

    const title = element.getAttribute("title");
    if (title) return title.trim();

    const alt = element.getAttribute("alt");
    if (alt) return alt.trim();

    const placeholder = element.placeholder;
    if (placeholder && !isSensitiveElement(element)) return placeholder.trim();

    const innerText = (element.innerText || element.textContent || "").trim();
    if (innerText) return innerText.slice(0, 100);

    return "";
  }

  /**
   * AgentQL-Style Semantic Element Classification
   */
  function classifySemanticType(element, isSensitive, accessibleName) {
    const text = (accessibleName + " " + (element.name || "") + " " + (element.id || "")).toLowerCase();
    if (isSensitive) return "sensitive_credential";
    if (element.type === "submit" || text.includes("submit") || text.includes("confirm") || text.includes("register") || text.includes("continue")) return "submit_action";
    if (element.type === "email" || text.includes("email")) return "email_input";
    if (text.includes("name") && !text.includes("user")) return "name_input";
    if (element.type === "search" || text.includes("search")) return "search_input";
    if (element.tagName === "SELECT") return "select_dropdown";
    if (element.type === "checkbox") return "checkbox_toggle";
    if (element.type === "radio") return "radio_option";
    if (element.tagName === "BUTTON" || element.getAttribute("role") === "button") return "button_action";
    if (element.tagName === "A") return "navigation_link";
    return "generic_interactive";
  }

  function generateSelector(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    if (element.name && element.tagName !== "FORM") {
      return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
    }
    const path = [];
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }
      let sibling = current;
      let nth = 1;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === current.tagName) nth++;
      }
      selector += `:nth-of-type(${nth})`;
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(" > ");
  }

  /**
   * Browser-Use Style DOM Simplification & Element Mapper
   */
  function mapElement(element, index) {
    const rect = element.getBoundingClientRect();
    const isSensitive = isSensitiveElement(element);
    const accessibleName = getAccessibleName(element).slice(0, 100);
    const visibleLabel = getAssociatedLabelText(element).slice(0, 100);
    const ref = `el_${index}`;

    elementRefCache.set(ref, element);

    // Run axe-core accessibility checks
    const a11yIssues = [];
    const sizeIssue = AxeRules.checkTargetSize(element, rect);
    if (sizeIssue) a11yIssues.push(sizeIssue);

    if (["input", "select", "textarea"].includes(element.tagName.toLowerCase())) {
      const labelIssue = AxeRules.checkLabel(element, accessibleName || visibleLabel);
      if (labelIssue) a11yIssues.push(labelIssue);
    } else if (element.tagName.toLowerCase() === "button" || element.getAttribute("role") === "button") {
      const btnIssue = AxeRules.checkButtonName(element, accessibleName);
      if (btnIssue) a11yIssues.push(btnIssue);
    }

    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );

    const semanticType = classifySemanticType(element, isSensitive, accessibleName);

    return {
      ref,
      highlight_index: index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || element.tagName.toLowerCase(),
      accessible_name: accessibleName,
      visible_label: visibleLabel,
      placeholder: isSensitive ? "[REDACTED]" : (element.placeholder || "").slice(0, 80),
      input_type: element.type || "",
      required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
      is_sensitive: isSensitive,
      semantic_type: semanticType,
      is_in_viewport: isInViewport,
      visible: rect.width > 0 && rect.height > 0,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      a11y_issues: a11yIssues,
      needs_large_target: a11yIssues.some(i => i.needs_large_target),
      selector: generateSelector(element)
    };
  }

  function extractPageSnapshot() {
    elementRefCache.clear();

    const selector = [
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "button",
      "a[href]",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='menuitem']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");

    const elements = [...document.querySelectorAll(selector)].filter(element => {
      if (element.closest("#ghost-hands-overlay-host")) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    });

    const mappedElements = elements.map(mapElement);
    const totalA11yIssues = mappedElements.reduce((acc, el) => acc + el.a11y_issues.length, 0);
    const a11yScore = Math.max(20, 100 - (totalA11yIssues * 8));

    return {
      page_title: document.title || "Webpage",
      url: window.location.href,
      accessibility_score: a11yScore,
      total_interactive_elements: mappedElements.length,
      elements: mappedElements
    };
  }

  function findElementByRef(ref) {
    if (elementRefCache.has(ref)) {
      const cached = elementRefCache.get(ref);
      if (document.body.contains(cached)) {
        return cached;
      }
    }

    const index = Number(ref.replace("el_", ""));
    extractPageSnapshot();
    if (elementRefCache.has(ref)) {
      return elementRefCache.get(ref);
    }

    const all = [...elementRefCache.values()];
    return all[index] || null;
  }

  /**
   * Stagehand Primitives (observe, act, extract)
   */
  const Stagehand = {
    observe() {
      const snapshot = extractPageSnapshot();
      return snapshot.elements.map(el => ({
        ref: el.ref,
        selector: el.selector,
        suggested_action: el.tag === "button" || el.role === "button" || el.tag === "a" ? "click" : (el.tag === "select" ? "select" : "fill"),
        semantic_type: el.semantic_type,
        accessible_name: el.accessible_name || el.visible_label,
        is_sensitive: el.is_sensitive,
        needs_large_target: el.needs_large_target
      }));
    },

    act(ref, actionType, value) {
      const el = findElementByRef(ref);
      if (!el) return false;

      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();

      if (actionType === "click") {
        el.click();
      } else if (actionType === "fill" && value !== undefined) {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    },

    extract() {
      return extractPageSnapshot();
    }
  };

  /**
   * Step Execution & Display
   */
  function displayCurrentStep() {
    if (!currentPlan || currentStepIndex >= currentPlan.length) {
      if (window.GhostOverlay) {
        window.GhostOverlay.showCompletedFeedback("All guided steps completed! 🎉");
        setTimeout(stopSession, 2000);
      }
      return;
    }

    const step = currentPlan[currentStepIndex];
    const totalSteps = currentPlan.length;

    if (currentCompletionCleanup) {
      currentCompletionCleanup();
      currentCompletionCleanup = null;
    }

    const target = findElementByRef(step.target_ref);

    // Auto-enable Large Target Mode if element has small touch target or requested
    const stepNeedsLargeTarget = isLargeTargetMode || step.needs_large_target || (step.alternatives && step.alternatives.includes("large_target"));

    if (window.GhostOverlay) {
      window.GhostOverlay.setLargeTargetMode(stepNeedsLargeTarget);
      window.GhostOverlay.showGhostStep(step, totalSteps, {
        findTarget: findElementByRef,
        onNext: () => advanceStep(),
        onStop: () => stopSession(),
        onConfirm: () => confirmStep(step),
        onTargetActivated: (activeStep, targetEl) => {
          handleStepCompletion(activeStep, targetEl);
        }
      });
    }

    if (target) {
      currentCompletionCleanup = attachCompletionListener(step, target);
    }

    broadcastSessionState();
  }

  /**
   * Completion Detection for Diverse Elements
   */
  function attachCompletionListener(step, target) {
    if (!target) return () => {};

    let completed = false;

    const triggerCompletion = () => {
      if (completed) return;
      completed = true;
      handleStepCompletion(step, target);
    };

    const listeners = [];
    const addTrackedListener = (el, event, handler) => {
      el.addEventListener(event, handler);
      listeners.push(() => el.removeEventListener(event, handler));
    };

    const tagName = target.tagName.toUpperCase();
    const type = (target.type || "").toLowerCase();

    if (tagName === "INPUT" || tagName === "TEXTAREA") {
      if (type === "checkbox" || type === "radio") {
        addTrackedListener(target, "change", triggerCompletion);
        addTrackedListener(target, "click", triggerCompletion);
      } else if (type === "submit" || type === "button") {
        addTrackedListener(target, "click", triggerCompletion);
      } else {
        let debounceTimer = null;
        const handleInput = () => {
          if (target.value && target.value.trim().length > 0) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              triggerCompletion();
            }, 1200);
          }
        };

        const handleChangeOrBlur = () => {
          if (target.value && target.value.trim().length > 0) {
            clearTimeout(debounceTimer);
            triggerCompletion();
          }
        };

        addTrackedListener(target, "input", handleInput);
        addTrackedListener(target, "change", handleChangeOrBlur);
        addTrackedListener(target, "blur", handleChangeOrBlur);
      }
    } else if (tagName === "SELECT") {
      addTrackedListener(target, "change", triggerCompletion);
    } else if (tagName === "BUTTON" || tagName === "A" || target.getAttribute("role") === "button") {
      addTrackedListener(target, "click", triggerCompletion);
    } else {
      addTrackedListener(target, "click", triggerCompletion);
    }

    return () => {
      listeners.forEach(cleanup => cleanup());
    };
  }

  function handleStepCompletion(step, target) {
    if (window.GhostOverlay) {
      window.GhostOverlay.showCompletedFeedback("Step Completed! ✓");
    }

    chrome.runtime.sendMessage({
      type: "STEP_COMPLETED",
      sessionId: currentSession,
      stepId: step.step_id,
      targetRef: step.target_ref
    });

    setTimeout(() => {
      advanceStep();
    }, 700);
  }

  function advanceStep() {
    if (currentCompletionCleanup) {
      currentCompletionCleanup();
      currentCompletionCleanup = null;
    }

    currentStepIndex++;
    if (currentStepIndex < currentPlan.length) {
      displayCurrentStep();
    } else {
      if (window.GhostOverlay) {
        window.GhostOverlay.showCompletedFeedback("Flow completed successfully! 🎉");
      }
      setTimeout(() => {
        stopSession();
      }, 1800);
    }
  }

  function prevStep() {
    if (currentStepIndex > 0) {
      currentStepIndex--;
      displayCurrentStep();
    }
  }

  function confirmStep(step) {
    chrome.runtime.sendMessage(
      {
        type: "CONFIRM_ACTION",
        sessionId: currentSession,
        stepId: step.step_id
      },
      () => {
        advanceStep();
      }
    );
  }

  function stopSession() {
    if (currentCompletionCleanup) {
      currentCompletionCleanup();
      currentCompletionCleanup = null;
    }

    if (window.GhostOverlay) {
      window.GhostOverlay.clearOverlay();
    }

    if (currentSession) {
      chrome.runtime.sendMessage({
        type: "STOP_SESSION",
        sessionId: currentSession
      });
    }

    currentSession = null;
    currentPlan = [];
    currentStepIndex = 0;

    broadcastSessionState();
  }

  async function startGuidance(intent) {
    const snapshotData = extractPageSnapshot();

    const response = await chrome.runtime.sendMessage({
      type: "PLAN_REQUEST",
      payload: {
        intent: intent || "Help me complete this task",
        page_snapshot: snapshotData.elements,
        page_title: snapshotData.page_title,
        url: snapshotData.url,
        accessibility_score: snapshotData.accessibility_score,
        accessibility_mode: isLargeTargetMode ? "large_target" : "visual"
      }
    });

    if (!response || !response.ok || !response.data?.steps?.length) {
      if (window.GhostOverlay) {
        window.GhostOverlay.showUncertainStep(
          {
            step_id: 1,
            instruction: response?.error || "Could not generate guidance steps for this page."
          },
          1,
          { onStop: stopSession }
        );
      }
      return;
    }

    currentSession = response.data.session_id || `sess_${Date.now()}`;
    currentPlan = response.data.steps;
    currentStepIndex = 0;

    displayCurrentStep();
  }

  function broadcastSessionState() {
    chrome.runtime.sendMessage({
      type: "SESSION_STATE_CHANGED",
      state: {
        active: Boolean(currentSession),
        sessionId: currentSession,
        currentStepIndex,
        totalSteps: currentPlan.length,
        currentStep: currentPlan[currentStepIndex] || null,
        plan: currentPlan,
        isLargeTargetMode
      }
    }).catch(() => {});
  }

  // Runtime Message Router
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "START_GUIDANCE":
        startGuidance(message.intent);
        sendResponse({ ok: true });
        break;

      case "SHOW_STEP":
        if (typeof message.stepIndex === "number") {
          currentStepIndex = message.stepIndex;
        }
        displayCurrentStep();
        sendResponse({ ok: true });
        break;

      case "NEXT_STEP":
        advanceStep();
        sendResponse({ ok: true });
        break;

      case "PREV_STEP":
        prevStep();
        sendResponse({ ok: true });
        break;

      case "STOP":
      case "STOP_GUIDANCE":
      case "STOP_SESSION":
        stopSession();
        sendResponse({ ok: true });
        break;

      case "GET_PAGE_SNAPSHOT":
        const snapshot = extractPageSnapshot();
        sendResponse({ ok: true, snapshot });
        break;

      case "STAGEHAND_OBSERVE":
        sendResponse({ ok: true, candidates: Stagehand.observe() });
        break;

      case "STAGEHAND_ACT":
        const actResult = Stagehand.act(message.ref, message.action, message.value);
        sendResponse({ ok: actResult });
        break;

      case "TOGGLE_LARGE_TARGET":
        isLargeTargetMode = message.enabled !== undefined ? message.enabled : !isLargeTargetMode;
        if (window.GhostOverlay) {
          window.GhostOverlay.setLargeTargetMode(isLargeTargetMode);
        }
        sendResponse({ ok: true, isLargeTargetMode });
        break;

      case "GET_SESSION_STATE":
        sendResponse({
          active: Boolean(currentSession),
          sessionId: currentSession,
          currentStepIndex,
          totalSteps: currentPlan.length,
          currentStep: currentPlan[currentStepIndex] || null,
          plan: currentPlan,
          isLargeTargetMode
        });
        break;

      case "PING":
        sendResponse({ ok: true, active: Boolean(currentSession) });
        break;

      default:
        break;
    }
    return true;
  });

  // Global APIs for external extensions / testing
  window.GhostContentScript = {
    extractPageSnapshot,
    findElementByRef,
    Stagehand,
    AxeRules,
    startGuidance,
    stopSession
  };
})();