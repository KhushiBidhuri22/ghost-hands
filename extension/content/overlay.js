/**
 * Ghost Hands - Shadow DOM Overlay
 * Visual highlighting inspired by Accessibility Highlighter:
 *  - High-contrast spotlight scrim cutout with pulsing focus glow
 *  - Floating animated Ghost Hand pointer (🖐️)
 *  - WCAG-compliant accessible caption card with step progress chip
 *  - axe-core accessibility warnings (small touch target, missing label)
 *  - Accessible Large Target button for motor accessibility
 */

(function () {
  let overlayHost = null;
  let overlayRoot = null;
  let currentTargetElement = null;
  let currentStepData = null;
  let isLargeTargetActive = false;
  let repositionAnimationFrame = null;

  const OVERLAY_STYLES = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    :host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
      overflow: hidden;
    }

    /* High-contrast spotlight scrim cutout around target element */
    .gh-spotlight {
      position: fixed;
      border: 3.5px solid #2563eb;
      border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.65), 0 0 25px rgba(37, 99, 235, 0.6);
      transition: left 0.22s ease-out, top 0.22s ease-out, width 0.22s ease-out, height 0.22s ease-out, border-color 0.2s ease;
      pointer-events: none;
      z-index: 10;
    }

    .gh-spotlight.gh-success {
      border-color: #10b981;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.65), 0 0 35px rgba(16, 185, 129, 0.8);
    }

    /* Pulsing glow ring */
    .gh-spotlight-ring {
      position: absolute;
      inset: -8px;
      border: 2px dashed rgba(59, 130, 246, 0.75);
      border-radius: 16px;
      animation: gh-ring-spin 6s linear infinite;
      pointer-events: none;
    }

    @keyframes gh-ring-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Animated Ghost Hand pointer */
    .gh-ghost-hand {
      position: fixed;
      font-size: 38px;
      line-height: 1;
      filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
      animation: gh-hand-point 1.3s ease-in-out infinite alternate;
      pointer-events: none;
      z-index: 20;
      user-select: none;
      transition: left 0.22s ease-out, top 0.22s ease-out;
    }

    @keyframes gh-hand-point {
      0% {
        transform: translateY(0px) rotate(-10deg) scale(1);
      }
      100% {
        transform: translateY(-12px) rotate(5deg) scale(1.12);
      }
    }

    /* Accessible Caption Card */
    .gh-caption-card {
      position: fixed;
      width: 390px;
      max-width: calc(100vw - 32px);
      background: #ffffff;
      color: #0f172a;
      border: 2px solid #3b82f6;
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.05);
      pointer-events: auto;
      z-index: 30;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(8px);
    }

    .gh-caption-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      gap: 8px;
    }

    .gh-chip-group {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .gh-progress-chip {
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 9999px;
      border: 1px solid #bfdbfe;
      letter-spacing: 0.02em;
    }

    .gh-badge-sensitive {
      background: #fef2f2;
      color: #b91c1c;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      border: 1px solid #fecaca;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .gh-badge-a11y {
      background: #fffbeb;
      color: #b45309;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      border: 1px solid #fde68a;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .gh-badge-action {
      background: #f1f5f9;
      color: #475569;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
    }

    .gh-close-button {
      background: transparent;
      border: none;
      color: #64748b;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 4px 6px;
      border-radius: 6px;
      transition: all 0.15s ease;
    }

    .gh-close-button:hover {
      background: #fee2e2;
      color: #dc2626;
    }

    .gh-instruction-title {
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.4;
      margin-bottom: 8px;
    }

    .gh-target-hint {
      font-size: 13px;
      color: #475569;
      background: #f8fafc;
      border-left: 3px solid #3b82f6;
      padding: 6px 10px;
      border-radius: 4px;
      margin-bottom: 12px;
      word-break: break-word;
    }

    .gh-a11y-alert {
      font-size: 12px;
      color: #92400e;
      background: #fffbeb;
      border: 1px solid #fde68a;
      padding: 6px 10px;
      border-radius: 6px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .gh-actions-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 10px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
    }

    .gh-btn-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .gh-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 9px 14px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .gh-btn:active {
      transform: scale(0.97);
    }

    .gh-btn-primary {
      background: #2563eb;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
    }

    .gh-btn-primary:hover {
      background: #1d4ed8;
    }

    .gh-btn-confirm {
      background: #16a34a;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);
    }

    .gh-btn-confirm:hover {
      background: #15803d;
    }

    .gh-btn-secondary {
      background: #f1f5f9;
      color: #334155;
      border-color: #cbd5e1;
    }

    .gh-btn-secondary:hover {
      background: #e2e8f0;
      color: #0f172a;
    }

    .gh-btn-stop {
      background: #fee2e2;
      color: #b91c1c;
      border-color: #fca5a5;
    }

    .gh-btn-stop:hover {
      background: #dc2626;
      color: #ffffff;
      border-color: #dc2626;
    }

    /* Large Target Mode Accessible Button */
    .gh-large-target-container {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 40;
      pointer-events: auto;
      animation: gh-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .gh-large-target-btn {
      min-width: 240px;
      min-height: 74px;
      padding: 16px 26px;
      font-size: 18px;
      font-weight: 800;
      line-height: 1.25;
      background: linear-gradient(135deg, #16a34a, #15803d);
      color: #ffffff;
      border: 3.5px solid #ffffff;
      border-radius: 18px;
      cursor: pointer;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4), 0 0 20px rgba(22, 163, 74, 0.4);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
      text-align: center;
    }

    .gh-large-target-btn:hover {
      transform: translateY(-3px) scale(1.02);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45), 0 0 25px rgba(22, 163, 74, 0.6);
      background: linear-gradient(135deg, #15803d, #166534);
    }

    .gh-large-target-btn:active {
      transform: translateY(1px) scale(0.98);
    }

    .gh-large-target-subtext {
      font-size: 12px;
      font-weight: 600;
      opacity: 0.9;
    }

    /* Completed Toast */
    .gh-toast {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #10b981;
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 15px;
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.35);
      z-index: 50;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: gh-toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes gh-pop {
      from { transform: scale(0.85); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    @keyframes gh-toast-in {
      from { transform: translate(-50%, -20px); opacity: 0; }
      to { transform: translate(-50%, 0); opacity: 1; }
    }
  `;

  function ensureOverlay() {
    if (overlayHost && overlayRoot) return overlayRoot;

    const existing = document.getElementById("ghost-hands-overlay-host");
    if (existing) existing.remove();

    overlayHost = document.createElement("div");
    overlayHost.id = "ghost-hands-overlay-host";
    overlayHost.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      pointer-events: none;
      overflow: hidden;
      margin: 0;
      padding: 0;
      border: none;
    `;

    overlayRoot = overlayHost.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = OVERLAY_STYLES;
    overlayRoot.appendChild(style);

    document.documentElement.appendChild(overlayHost);

    window.addEventListener("scroll", handleViewportChange, { passive: true, capture: true });
    window.addEventListener("resize", handleViewportChange, { passive: true });

    return overlayRoot;
  }

  function clearOverlay() {
    if (repositionAnimationFrame) {
      cancelAnimationFrame(repositionAnimationFrame);
      repositionAnimationFrame = null;
    }

    window.removeEventListener("scroll", handleViewportChange, { capture: true });
    window.removeEventListener("resize", handleViewportChange);

    if (currentTargetElement) {
      currentTargetElement.classList.remove("gh-highlighted-native-element");
      currentTargetElement.classList.remove("gh-completed-native-element");
    }

    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      overlayRoot = null;
    }

    currentTargetElement = null;
    currentStepData = null;
  }

  function handleViewportChange() {
    if (!currentTargetElement || !overlayRoot) return;
    if (repositionAnimationFrame) return;

    repositionAnimationFrame = requestAnimationFrame(() => {
      updatePositions();
      repositionAnimationFrame = null;
    });
  }

  function calculateTargetRect(target) {
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: Math.max(rect.width, 24),
      height: Math.max(rect.height, 24),
      right: rect.right,
      bottom: rect.bottom
    };
  }

  function updatePositions() {
    if (!overlayRoot || !currentTargetElement) return;

    const rect = calculateTargetRect(currentTargetElement);
    if (!rect) return;

    const spotlight = overlayRoot.querySelector(".gh-spotlight");
    if (spotlight) {
      spotlight.style.left = `${rect.x - 8}px`;
      spotlight.style.top = `${rect.y - 8}px`;
      spotlight.style.width = `${rect.width + 16}px`;
      spotlight.style.height = `${rect.height + 16}px`;
    }

    const hand = overlayRoot.querySelector(".gh-ghost-hand");
    if (hand) {
      const handLeft = Math.min(window.innerWidth - 60, Math.max(10, rect.x + rect.width - 15));
      const handTop = Math.max(10, rect.y - 45);
      hand.style.left = `${handLeft}px`;
      hand.style.top = `${handTop}px`;
    }

    const card = overlayRoot.querySelector(".gh-caption-card");
    if (card) {
      positionCaptionCard(card, rect);
    }
  }

  function positionCaptionCard(card, targetRect) {
    const cardWidth = Math.min(390, window.innerWidth - 32);
    const cardHeight = card.offsetHeight || 210;
    const margin = 16;

    let top = targetRect.bottom + margin;
    let left = targetRect.x;

    if (top + cardHeight > window.innerHeight - 20) {
      top = targetRect.y - cardHeight - margin;
    }

    if (top < 20 || top + cardHeight > window.innerHeight) {
      top = Math.max(20, window.innerHeight - cardHeight - 24);
      left = Math.max(16, (window.innerWidth - cardWidth) / 2);
    } else {
      if (left + cardWidth > window.innerWidth - 16) {
        left = window.innerWidth - cardWidth - 16;
      }
      if (left < 16) left = 16;
    }

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    card.style.width = `${cardWidth}px`;
  }

  function showGhostStep(step, totalSteps, callbacks = {}) {
    ensureOverlay();
    const root = overlayRoot;

    const elementsToRemove = root.querySelectorAll(".gh-spotlight, .gh-ghost-hand, .gh-caption-card, .gh-large-target-container, .gh-toast");
    elementsToRemove.forEach(el => el.remove());

    if (currentTargetElement) {
      currentTargetElement.classList.remove("gh-highlighted-native-element");
    }

    currentStepData = step;
    const target = callbacks.findTarget ? callbacks.findTarget(step.target_ref) : null;
    currentTargetElement = target;

    if (!target) {
      showUncertainStep(step, totalSteps, callbacks);
      return;
    }

    target.classList.add("gh-highlighted-native-element");

    const initialRect = target.getBoundingClientRect();
    const isOutOfView = (
      initialRect.top < 60 ||
      initialRect.bottom > window.innerHeight - 60 ||
      initialRect.left < 20 ||
      initialRect.right > window.innerWidth - 20
    );

    if (isOutOfView) {
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      } catch (e) {
        target.scrollIntoView(false);
      }
    }

    const rect = calculateTargetRect(target);
    const spotlight = document.createElement("div");
    spotlight.className = "gh-spotlight";
    spotlight.style.left = `${rect.x - 8}px`;
    spotlight.style.top = `${rect.y - 8}px`;
    spotlight.style.width = `${rect.width + 16}px`;
    spotlight.style.height = `${rect.height + 16}px`;

    const ring = document.createElement("div");
    ring.className = "gh-spotlight-ring";
    spotlight.appendChild(ring);
    root.appendChild(spotlight);

    const ghostHand = document.createElement("div");
    ghostHand.className = "gh-ghost-hand";
    ghostHand.textContent = "🖐️";
    const handLeft = Math.min(window.innerWidth - 60, Math.max(10, rect.x + rect.width - 15));
    const handTop = Math.max(10, rect.y - 45);
    ghostHand.style.left = `${handLeft}px`;
    ghostHand.style.top = `${handTop}px`;
    root.appendChild(ghostHand);

    // Floating Caption Card
    const captionCard = document.createElement("div");
    captionCard.className = "gh-caption-card";

    const header = document.createElement("div");
    header.className = "gh-caption-header";

    const chipGroup = document.createElement("div");
    chipGroup.className = "gh-chip-group";

    const progressChip = document.createElement("span");
    progressChip.className = "gh-progress-chip";
    progressChip.textContent = `Step ${step.step_id || 1} of ${totalSteps || 1}`;
    chipGroup.appendChild(progressChip);

    if (step.action_type) {
      const actionBadge = document.createElement("span");
      actionBadge.className = "gh-badge-action";
      actionBadge.textContent = step.action_type;
      chipGroup.appendChild(actionBadge);
    }

    if (step.is_sensitive) {
      const sensitiveBadge = document.createElement("span");
      sensitiveBadge.className = "gh-badge-sensitive";
      sensitiveBadge.innerHTML = "🔒 Sensitive";
      chipGroup.appendChild(sensitiveBadge);
    }

    if (step.needs_large_target) {
      const a11yBadge = document.createElement("span");
      a11yBadge.className = "gh-badge-a11y";
      a11yBadge.innerHTML = "🎯 Small Target";
      chipGroup.appendChild(a11yBadge);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "gh-close-button";
    closeBtn.title = "Stop Guidance";
    closeBtn.setAttribute("aria-label", "Stop Guidance");
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", () => {
      if (callbacks.onStop) callbacks.onStop();
    });

    header.appendChild(chipGroup);
    header.appendChild(closeBtn);
    captionCard.appendChild(header);

    const instruction = document.createElement("div");
    instruction.className = "gh-instruction-title";
    instruction.textContent = step.instruction || "Interact with this field to continue";
    captionCard.appendChild(instruction);

    if (step.visible_label || step.accessible_name) {
      const hint = document.createElement("div");
      hint.className = "gh-target-hint";
      hint.textContent = `Field: ${step.visible_label || step.accessible_name}`;
      captionCard.appendChild(hint);
    }

    if (step.needs_large_target) {
      const a11yAlert = document.createElement("div");
      a11yAlert.className = "gh-a11y-alert";
      a11yAlert.innerHTML = `<span>♿ <strong>WCAG 2.5.5 notice:</strong> Field is &lt;44px. Large Target Mode is active.</span>`;
      captionCard.appendChild(a11yAlert);
    }

    const actionsRow = document.createElement("div");
    actionsRow.className = "gh-actions-row";

    const stopButton = document.createElement("button");
    stopButton.className = "gh-btn gh-btn-stop";
    stopButton.textContent = "🛑 Stop";
    stopButton.addEventListener("click", () => {
      if (callbacks.onStop) callbacks.onStop();
    });
    actionsRow.appendChild(stopButton);

    const rightBtnGroup = document.createElement("div");
    rightBtnGroup.className = "gh-btn-group";

    if (step.requires_confirmation) {
      const confirmButton = document.createElement("button");
      confirmButton.className = "gh-btn gh-btn-confirm";
      confirmButton.textContent = "Confirm Action ✓";
      confirmButton.addEventListener("click", () => {
        if (callbacks.onConfirm) callbacks.onConfirm(step);
      });
      rightBtnGroup.appendChild(confirmButton);
    } else {
      const skipButton = document.createElement("button");
      skipButton.className = "gh-btn gh-btn-secondary";
      skipButton.textContent = (step.step_id >= totalSteps) ? "Finish ✓" : "Skip / Next →";
      skipButton.addEventListener("click", () => {
        if (callbacks.onNext) callbacks.onNext(step);
      });
      rightBtnGroup.appendChild(skipButton);
    }

    actionsRow.appendChild(rightBtnGroup);
    captionCard.appendChild(actionsRow);

    root.appendChild(captionCard);
    positionCaptionCard(captionCard, rect);

    // Large Target Mode (motor accessibility)
    const shouldShowLargeTarget = isLargeTargetActive || step.needs_large_target || (step.alternatives && step.alternatives.includes("large_target"));
    if (shouldShowLargeTarget) {
      renderLargeTargetButton(step, target, callbacks);
    }
  }

  function renderLargeTargetButton(step, target, callbacks) {
    if (!overlayRoot) return;

    const existing = overlayRoot.querySelector(".gh-large-target-container");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.className = "gh-large-target-container";

    const button = document.createElement("button");
    button.className = "gh-large-target-btn";

    const label = step.visible_label || step.accessible_name || "Activate Field";
    button.innerHTML = `
      <span>🎯 ${escapeHtml(label.slice(0, 30))}</span>
      <span class="gh-large-target-subtext">Large Target Mode</span>
    `;

    button.addEventListener("click", () => {
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus();

        if (target.tagName === "BUTTON" || target.tagName === "A" || target.type === "checkbox" || target.type === "radio" || target.getAttribute("role") === "button") {
          target.click();
        }

        showCompletedFeedback("Large target activated!");
        if (callbacks.onTargetActivated) {
          callbacks.onTargetActivated(step, target);
        }
      }
    });

    container.appendChild(button);
    overlayRoot.appendChild(container);
  }

  function showUncertainStep(step, totalSteps, callbacks = {}) {
    ensureOverlay();
    const root = overlayRoot;

    const elementsToRemove = root.querySelectorAll(".gh-spotlight, .gh-ghost-hand, .gh-caption-card, .gh-large-target-container");
    elementsToRemove.forEach(el => el.remove());

    const captionCard = document.createElement("div");
    captionCard.className = "gh-caption-card";
    captionCard.style.left = "24px";
    captionCard.style.bottom = "24px";
    captionCard.style.top = "auto";

    captionCard.innerHTML = `
      <div class="gh-caption-header">
        <span class="gh-progress-chip">Step ${step.step_id || 1} of ${totalSteps || 1}</span>
        <button class="gh-close-button" id="gh-uncertain-close">✕</button>
      </div>
      <div class="gh-instruction-title">I'm not sure which element to highlight</div>
      <div class="gh-target-hint">Instruction: ${escapeHtml(step.instruction || "Please perform this step manually.")}</div>
      <div class="gh-actions-row">
        <button class="gh-btn gh-btn-stop" id="gh-uncertain-stop">🛑 Stop</button>
        <button class="gh-btn gh-btn-primary" id="gh-uncertain-next">Continue →</button>
      </div>
    `;

    root.appendChild(captionCard);

    captionCard.querySelector("#gh-uncertain-close").addEventListener("click", () => {
      if (callbacks.onStop) callbacks.onStop();
    });
    captionCard.querySelector("#gh-uncertain-stop").addEventListener("click", () => {
      if (callbacks.onStop) callbacks.onStop();
    });
    captionCard.querySelector("#gh-uncertain-next").addEventListener("click", () => {
      if (callbacks.onNext) callbacks.onNext(step);
    });
  }

  function showCompletedFeedback(message = "Step Completed! ✓") {
    if (!overlayRoot) return;

    const spotlight = overlayRoot.querySelector(".gh-spotlight");
    if (spotlight) {
      spotlight.classList.add("gh-success");
    }

    if (currentTargetElement) {
      currentTargetElement.classList.add("gh-completed-native-element");
    }

    const toast = document.createElement("div");
    toast.className = "gh-toast";
    toast.textContent = message;
    overlayRoot.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 1200);
  }

  function setLargeTargetMode(enabled) {
    isLargeTargetActive = Boolean(enabled);
    if (overlayRoot && currentStepData && currentTargetElement) {
      if (isLargeTargetActive) {
        renderLargeTargetButton(currentStepData, currentTargetElement, {});
      } else {
        const existing = overlayRoot.querySelector(".gh-large-target-container");
        if (existing) existing.remove();
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.GhostOverlay = {
    ensureOverlay,
    clearOverlay,
    showGhostStep,
    showUncertainStep,
    showCompletedFeedback,
    setLargeTargetMode,
    updatePositions
  };
})();