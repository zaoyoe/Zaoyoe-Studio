const packages = [
    { id: "pkg-10", name: "新手尝鲜包", points: 10, price: 10 },
    { id: "pkg-50", name: "超值进阶包", points: 50, price: 50 },
    { id: "pkg-100", name: "新礼包", points: 100, price: 100 }
];

const scenarioText = {
    success: "支付成功",
    review: "平台复核中",
    paymentFail: "支付失败",
    hold: "停留扫码中",
    requestFail: "创建失败"
};

const state = {
    balance: 128.5,
    balanceDisplay: 128.5,
    balanceTarget: 128.51,
    pendingCredit: 0.01,
    lastCredited: 0,
    scenario: "success",
    speed: 1,
    viewport: "desktop",
    timers: [],
    activeSource: null,
    processing: false,
    modalOpen: false,
    qrReady: false,
    finalState: "idle",
    flowNode: "idle",
    currentFlow: null,
    balanceAnimationFrame: 0,
    modalResetTimer: 0,
    rechargeLocked: false,
    logs: []
};

const elements = {
    walletStage: document.getElementById("walletStage"),
    walletContent: document.querySelector(".wallet-content"),
    headerBalanceValue: document.getElementById("headerBalanceValue"),
    headerBalance: document.querySelector(".header-balance"),
    balanceSpotlight: document.getElementById("balanceSpotlight"),
    balanceHeroValue: document.getElementById("balanceHeroValue"),
    balanceIncomingValue: document.getElementById("balanceIncomingValue"),
    balanceTargetValue: document.getElementById("balanceTargetValue"),
    balanceNote: document.getElementById("balanceNote"),
    balancePill: document.getElementById("balancePill"),
    quoteValue: document.getElementById("quoteValue"),
    quoteHint: document.getElementById("quoteHint"),
    flowStateTitle: document.getElementById("flowStateTitle"),
    flowStateHint: document.getElementById("flowStateHint"),
    viewScenarioChip: document.getElementById("viewScenarioChip"),
    packagesGrid: document.getElementById("packagesGrid"),
    customInput: document.getElementById("customInput"),
    customSubmit: document.getElementById("customSubmit"),
    inlineState: document.getElementById("inlineState"),
    scenarioChips: document.getElementById("scenarioChips"),
    speedChips: document.getElementById("speedChips"),
    viewportChips: document.getElementById("viewportChips"),
    stepQrReady: document.getElementById("stepQrReady"),
    stepPolling: document.getElementById("stepPolling"),
    stepReview: document.getElementById("stepReview"),
    stepSuccess: document.getElementById("stepSuccess"),
    stepFailure: document.getElementById("stepFailure"),
    quickCustomStart: document.getElementById("quickCustomStart"),
    quickPackageStart: document.getElementById("quickPackageStart"),
    resetFlow: document.getElementById("resetFlow"),
    eventLog: document.getElementById("eventLog"),
    modalLayer: document.getElementById("modalLayer"),
    paymentModal: document.querySelector(".payment-modal"),
    paymentBody: document.querySelector(".payment-body"),
    modalTitle: document.getElementById("modalTitle"),
    modalSubtitle: document.getElementById("modalSubtitle"),
    modalHint: document.getElementById("modalHint"),
    modalStatus: document.getElementById("modalStatus"),
    qrCard: document.querySelector(".qr-card"),
    qrFrame: document.getElementById("qrFrame"),
    qrBadge: document.getElementById("qrBadge"),
    metaGrid: document.getElementById("metaGrid"),
    metaAmount: document.getElementById("metaAmount"),
    metaPoints: document.getElementById("metaPoints"),
    metaChannel: document.getElementById("metaChannel"),
    resultBanner: document.getElementById("resultBanner"),
    successStage: document.getElementById("successStage"),
    successCaption: document.getElementById("successCaption"),
    modalActions: document.getElementById("modalActions"),
    copyButton: document.getElementById("copyButton"),
    primaryButton: document.getElementById("primaryButton"),
    toastStack: document.getElementById("toastStack")
};

function formatAmount(value) {
    return Number(value || 0).toFixed(2);
}

function formatPoints(value) {
    const num = Number(value || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function nowTime() {
    return new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
}

function addLog(message) {
    state.logs.unshift({ time: nowTime(), message });
    state.logs = state.logs.slice(0, 6);
    renderLogs();
}

function renderLogs() {
    elements.eventLog.innerHTML = state.logs.map((item) => `
        <li>
            <time>${item.time}</time>
            <span>${item.message}</span>
        </li>
    `).join("");
}

function setModalStatus(message = "", tone = "info", options = {}) {
    const normalizedTone = ["info", "success", "error"].includes(tone) ? tone : "info";
    const loading = !!options.loading;
    elements.modalStatus.className = `payment-status ${normalizedTone}`;

    if (!loading) {
        elements.modalStatus.textContent = message;
        return;
    }

    elements.modalStatus.innerHTML = `
        ${message}
        <span class="status-loading-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
        </span>
    `;
}

function schedule(ms, callback) {
    const timer = window.setTimeout(callback, ms / state.speed);
    state.timers.push(timer);
    return timer;
}

function clearTimers() {
    state.timers.forEach((timer) => window.clearTimeout(timer));
    state.timers = [];
}

function requireOpenFlow(actionLabel = "继续推进") {
    if (state.currentFlow && state.modalOpen) {
        return true;
    }
    showToast(`请先发起一次充值，再${actionLabel}。`, "info");
    return false;
}

function clearPendingFlowTimers() {
    clearTimers();
}

function clearModalResetTimer() {
    if (!state.modalResetTimer) return;
    window.clearTimeout(state.modalResetTimer);
    state.modalResetTimer = 0;
}

function resetSuccessPresentation() {
    elements.paymentBody.classList.remove("is-success");
    elements.qrCard.classList.remove("is-success-mode");
    elements.qrFrame.classList.remove("is-exiting");
    elements.qrFrame.classList.remove("is-entering");
    elements.successStage.classList.remove("is-visible");
}

function resetModalContentState() {
    unlockPaymentModalHeight();
    resetSuccessPresentation();
    elements.modalStatus.hidden = false;
    elements.qrFrame.hidden = true;
    elements.qrFrame.innerHTML = "";
    elements.successStage.hidden = true;
    elements.successCaption.hidden = true;
    elements.qrBadge.hidden = false;
    elements.resultBanner.hidden = true;
    elements.resultBanner.className = "result-banner";
    elements.resultBanner.textContent = "";
    elements.metaGrid.hidden = false;
    elements.modalActions.hidden = false;
    elements.copyButton.textContent = "复制付款链接";
    elements.primaryButton.textContent = "打开支付页";
    elements.primaryButton.className = "action-btn primary";
    elements.primaryButton.hidden = false;
    setModalStatus("", "info");
}

function cancelBalanceAnimation() {
    if (!state.balanceAnimationFrame) return;
    window.cancelAnimationFrame(state.balanceAnimationFrame);
    state.balanceAnimationFrame = 0;
}

function unlockPaymentModalHeight() {
    if (!elements.paymentModal) return;
    elements.paymentModal.style.height = "";
    elements.paymentModal.style.minHeight = "";
}

function lockPaymentModalHeight() {
    if (!elements.paymentModal) return;
    const modalHeight = Math.ceil(elements.paymentModal.getBoundingClientRect().height);
    if (!modalHeight) return;
    elements.paymentModal.style.height = `${modalHeight}px`;
    elements.paymentModal.style.minHeight = `${modalHeight}px`;
}

function showToast(message, tone = "info", duration = 3200) {
    const iconMap = {
        success: "✓",
        error: "✕",
        info: "•"
    };
    const toast = document.createElement("div");
    toast.className = `toast ${tone}`;
    toast.innerHTML = `
        <span class="toast-icon">${iconMap[tone] || "•"}</span>
        <span class="toast-text">${message}</span>
    `;
    elements.toastStack.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add("leaving");
        window.setTimeout(() => toast.remove(), 260);
    }, duration);
}

function renderPackages() {
    elements.packagesGrid.innerHTML = packages.map((item) => `
        <button class="package-card" type="button" data-package-id="${item.id}">
            <span class="pkg-tag">${item.name}</span>
            <span class="pkg-points">${item.points} 分</span>
            <span class="pkg-price">¥${formatAmount(item.price)}</span>
        </button>
    `).join("");

    elements.packagesGrid.querySelectorAll(".package-card").forEach((button) => {
        button.addEventListener("click", () => {
            const selected = packages.find((item) => item.id === button.dataset.packageId);
            startRecharge("package", selected);
        });
    });

    setRechargeInteractionLocked(state.rechargeLocked);
}

function renderScenario() {
    elements.viewScenarioChip.textContent = `当前场景：${scenarioText[state.scenario]}`;
    elements.scenarioChips.querySelectorAll(".chip").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.scenario === state.scenario);
    });
}

function renderSpeed() {
    elements.speedChips.querySelectorAll(".chip").forEach((chip) => {
        chip.classList.toggle("active", Number(chip.dataset.speed) === state.speed);
    });
}

function renderViewport() {
    elements.viewportChips.querySelectorAll(".chip").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.viewport === state.viewport);
    });
    elements.walletStage.classList.toggle("is-mobile", state.viewport === "mobile");
    syncPaymentPrimaryButton();
}

function syncPaymentPrimaryButton() {
    const isDesktopPreview = state.viewport === "desktop";
    const isOpenPaymentAction = elements.primaryButton.textContent.trim() === "打开支付页";
    elements.primaryButton.hidden = isDesktopPreview && isOpenPaymentAction;
}

function setActiveMenu(viewId) {
    document.querySelectorAll(".wallet-menu-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.view === viewId);
    });
}

function resetBalanceFocus() {
    elements.headerBalance.classList.remove("is-focus");
    elements.balanceSpotlight.classList.remove("is-focus");
}

function renderBalance() {
    const shownBalance = `${formatPoints(state.balanceDisplay)} 分`;
    elements.headerBalanceValue.textContent = shownBalance;
    elements.balanceHeroValue.textContent = shownBalance;

    elements.balanceIncomingValue.textContent = `+${formatPoints(state.pendingCredit || state.lastCredited || 0)} 分`;
    elements.balanceTargetValue.textContent = `${formatPoints(state.balanceTarget)} 分`;

    if (state.pendingCredit > 0) {
        elements.balancePill.textContent = "待入账";
        elements.balancePill.className = "balance-pill is-incoming";
        elements.balanceNote.textContent = "支付完成后会自动回到这里，并播放余额上涨动画。";
        return;
    }

    if (state.lastCredited > 0) {
        elements.balancePill.textContent = `已到账 +${formatPoints(state.lastCredited)} 分`;
        elements.balancePill.className = "balance-pill is-success";
        elements.balanceNote.textContent = "充值已完成，钱包会自动聚焦这里，让到账结果更明确。";
        return;
    }

    elements.balancePill.textContent = "等待到账";
    elements.balancePill.className = "balance-pill";
    elements.balanceNote.textContent = "支付成功后，会自动回到这里并聚焦余额变化。";
}

function previewIncomingBalance(points) {
    state.pendingCredit = Number(points || 0);
    state.lastCredited = 0;
    state.balanceTarget = state.balance + state.pendingCredit;
    renderBalance();
}

function animateBalanceTo(target, credited) {
    cancelBalanceAnimation();
    const from = state.balanceDisplay;
    const duration = 1400;
    const start = performance.now();
    state.lastCredited = Number(credited || 0);
    state.pendingCredit = 0;
    state.balanceTarget = target;

    const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        state.balanceDisplay = from + ((target - from) * eased);
        renderBalance();
        if (progress < 1) {
            state.balanceAnimationFrame = window.requestAnimationFrame(step);
            return;
        }
        state.balanceAnimationFrame = 0;
        state.balance = target;
        state.balanceDisplay = target;
        state.balanceTarget = target;
        renderBalance();
    };

    state.balanceAnimationFrame = window.requestAnimationFrame(step);
}

function returnToBalanceFocus() {
    hideModal({ preserveVisualState: true });
    setActiveMenu("balance");
    resetBalanceFocus();
    window.requestAnimationFrame(() => {
        elements.walletContent.scrollTo({
            top: Math.max(0, elements.balanceSpotlight.offsetTop - 10),
            behavior: "smooth"
        });
        elements.headerBalance.classList.add("is-focus");
        elements.balanceSpotlight.classList.add("is-focus");
        animateBalanceTo(state.balance + Number(state.currentFlow?.points || 0), state.currentFlow?.points || 0);
    });
    setFlowState("已返回余额", "支付页已自动关闭，钱包焦点回到了余额区，并播放到账动画。");
    addLog("关闭成功页并回到余额区域，开始播放余额上涨动画。");
}

function renderQuote() {
    const value = Math.max(0.01, Number(elements.customInput.value || 0.01));
    elements.quoteValue.textContent = `¥${formatAmount(value)}`;
    elements.quoteHint.textContent = `输入 ${formatPoints(value)} 分时，会生成对应金额的支付单。`;
    if (!state.processing) {
        previewIncomingBalance(value);
    }
}

function setFlowState(title, hint) {
    elements.flowStateTitle.textContent = title;
    elements.flowStateHint.textContent = hint;
    elements.inlineState.innerHTML = `<strong>当前说明：</strong> ${hint}`;
}

function setRechargeInteractionLocked(locked) {
    state.rechargeLocked = !!locked;
    elements.walletStage.classList.toggle("is-recharge-locked", state.rechargeLocked);
    elements.customInput.disabled = state.rechargeLocked;
    elements.customSubmit.disabled = state.rechargeLocked;
    elements.packagesGrid.querySelectorAll(".package-card").forEach((card) => {
        card.disabled = state.rechargeLocked;
    });
}

function setProcessingSource(sourceType, payload) {
    state.processing = !!sourceType;
    state.activeSource = sourceType ? { type: sourceType, payload } : null;

    elements.customSubmit.classList.remove("is-processing");
    elements.customSubmit.innerHTML = "前往易支付";
    elements.packagesGrid.querySelectorAll(".package-card").forEach((card) => {
        card.classList.remove("is-processing");
        const pack = packages.find((item) => item.id === card.dataset.packageId);
        if (!pack) return;
        card.querySelector(".pkg-price").innerHTML = `¥${formatAmount(pack.price)}`;
    });

    if (!sourceType) return;

    if (sourceType === "custom") {
        elements.customSubmit.classList.add("is-processing");
        elements.customSubmit.innerHTML = `<span class="pending-spinner"></span> 拉起中`;
        return;
    }

    if (sourceType === "package" && payload?.id) {
        const target = elements.packagesGrid.querySelector(`[data-package-id="${payload.id}"]`);
        if (!target) return;
        target.classList.add("is-processing");
        target.querySelector(".pkg-price").innerHTML = `<span class="pending-spinner"></span> 创建中`;
    }
}

function hideModal(options = {}) {
    const preserveVisualState = !!options.preserveVisualState;
    clearModalResetTimer();
    state.modalOpen = false;
    state.qrReady = false;
    state.finalState = "idle";
    state.flowNode = "idle";
    setRechargeInteractionLocked(false);
    elements.modalLayer.classList.remove("open");
    elements.modalLayer.setAttribute("aria-hidden", "true");
    if (preserveVisualState) {
        state.modalResetTimer = window.setTimeout(() => {
            state.modalResetTimer = 0;
            resetModalContentState();
        }, 260);
        return;
    }
    resetModalContentState();
}

function cancelFlowObservation(reason) {
    if (!state.modalOpen || state.finalState !== "pending") {
        hideModal();
        return;
    }
    clearTimers();
    setProcessingSource(null);
    state.processing = false;
    hideModal();
    setFlowState("已停止观察", reason || "当前预演已手动停止，不再继续推进后续状态。");
    addLog("中途关闭弹窗，已停止本次流程预演。");
}

function openModal(flow) {
    state.modalOpen = true;
    state.currentFlow = flow;
    state.qrReady = false;
    state.finalState = "pending";
    state.flowNode = "requesting";
    resetSuccessPresentation();
    elements.modalTitle.textContent = flow.title;
    elements.modalSubtitle.textContent = "请使用支付宝扫码支付";
    elements.modalHint.textContent = "";
    elements.modalHint.hidden = true;
    elements.metaAmount.textContent = `¥${formatAmount(flow.paidAmount)}`;
    elements.metaPoints.textContent = formatPoints(flow.points);
    elements.metaChannel.textContent = flow.channel;
    setModalStatus("订单已创建，正在准备二维码资源。", "info");
    elements.modalStatus.hidden = false;
    elements.qrBadge.className = "qr-badge";
    elements.qrBadge.textContent = "";
    elements.qrBadge.hidden = true;
    elements.qrFrame.hidden = true;
    elements.qrFrame.innerHTML = "";
    elements.qrFrame.classList.remove("is-entering");
    elements.successStage.hidden = true;
    elements.successCaption.hidden = true;
    elements.resultBanner.hidden = true;
    elements.resultBanner.className = "result-banner";
    elements.resultBanner.textContent = "";
    elements.metaGrid.hidden = false;
    elements.modalActions.hidden = false;
    elements.copyButton.textContent = "复制付款链接";
    elements.primaryButton.textContent = "打开支付页";
    elements.primaryButton.className = "action-btn primary";
    elements.primaryButton.hidden = false;
    syncPaymentPrimaryButton();
    elements.modalLayer.classList.add("open");
    elements.modalLayer.setAttribute("aria-hidden", "false");
}

function markQrReady() {
    if (!state.currentFlow) return;
    clearPendingFlowTimers();
    state.qrReady = true;
    state.finalState = "pending";
    state.flowNode = "qr-ready";
    resetSuccessPresentation();
    elements.successStage.hidden = true;
    elements.qrFrame.hidden = false;
    elements.qrFrame.classList.add("is-entering");
    elements.qrFrame.innerHTML = "";
    elements.qrFrame.appendChild(buildFakeQrSvg(29));
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            elements.qrFrame.classList.remove("is-entering");
        });
    });
    setModalStatus("请使用支付宝扫码支付。", "info");
    elements.qrBadge.hidden = true;
    setProcessingSource(null);
    state.processing = false;
    setFlowState("等待用户付款", "二维码已经就绪。当前先停留在扫码提示，不会自动切到“结果同步”，这样更接近真实支付链路。");
    addLog("二维码已生成，弹窗进入扫码阶段。");
}

function enterReviewState() {
    if (!state.currentFlow) return;
    clearPendingFlowTimers();
    state.finalState = "review";
    state.flowNode = "review";
    resetSuccessPresentation();
    elements.successStage.hidden = true;
    elements.modalStatus.hidden = false;
    setModalStatus("支付已提交，正在等待平台确认，请稍后。", "info");
    elements.qrBadge.hidden = true;
    elements.resultBanner.hidden = true;
    elements.resultBanner.className = "result-banner";
    elements.resultBanner.textContent = "";
    elements.metaGrid.hidden = false;
    elements.modalActions.hidden = false;
    syncPaymentPrimaryButton();
    setFlowState("等待平台确认", "这个节点用来模拟“用户已付款，但平台仍在复核中”。二维码区域保持不变，只切换上方提示。");
    addLog("支付进入平台复核状态。");
    setProcessingSource(null);
    state.processing = false;
}

function resolvePollingScenario() {
    if (!state.currentFlow || !state.modalOpen) return;

    if (state.scenario === "success") {
        addLog("当前场景预设为支付成功，结果同步后将自动进入成功态。");
        schedule(1480, () => {
            finalizeSuccess();
        });
        return;
    }

    if (state.scenario === "review") {
        addLog("当前场景预设为平台复核中，结果同步后将停在复核态。");
        schedule(1480, () => {
            enterReviewState();
        });
        return;
    }

    if (state.scenario === "paymentFail") {
        addLog("当前场景预设为支付失败，结果同步后将进入失败态。");
        schedule(1480, () => {
            finalizePaymentFail();
        });
        return;
    }

    setFlowState("等待支付结果", "当前预演故意停在结果同步阶段，适合观察加载文案、版面稳定性和按钮显隐。");
    addLog("结果同步已开始，当前场景不会自动推进终态。");
}

function markPolling(options = {}) {
    if (!state.currentFlow) return;
    clearPendingFlowTimers();
    state.finalState = "pending";
    state.flowNode = "polling";
    setModalStatus("正在等待支付结果同步，请保持此页面打开", "info", { loading: true });
    elements.qrBadge.hidden = true;
    setFlowState("等待支付结果", "这里对应真实站内的轮询阶段。只有开始查单后，二维码上方文案才应该切到这个状态。");
    addLog("进入支付轮询阶段，开始等待支付结果。");
    setProcessingSource(null);
    state.processing = false;

    if (options.autoResolve !== false) {
        resolvePollingScenario();
    }
}

function finalizeSuccess() {
    if (!state.currentFlow) return;
    clearPendingFlowTimers();
    state.finalState = "success";
    state.flowNode = "success";
    lockPaymentModalHeight();
    elements.modalStatus.hidden = true;
    elements.modalStatus.textContent = "";
    elements.qrBadge.hidden = true;
    elements.resultBanner.hidden = true;
    elements.resultBanner.className = "result-banner";
    elements.resultBanner.textContent = "";
    elements.metaGrid.hidden = true;
    elements.modalActions.hidden = true;
    elements.paymentBody.classList.add("is-success");
    elements.successStage.hidden = false;
    elements.successCaption.hidden = true;
    elements.successStage.classList.remove("is-visible");
    if (!elements.qrFrame.hidden) {
        elements.qrFrame.classList.add("is-exiting");
    } else {
        elements.qrFrame.hidden = true;
        elements.qrFrame.innerHTML = "";
    }
    setFlowState("支付成功", "二维码已收起，当前展示纯成功反馈，3 秒后会自动返回余额区域。");
    addLog("支付完成，二维码切换为成功态，并准备自动返回余额。");
    showToast(`${state.currentFlow.title}成功：+${formatPoints(state.currentFlow.points)} 积分`, "success", 4200);
    setProcessingSource(null);
    state.processing = false;
    const transitionTimer = schedule(190, () => {
        elements.qrFrame.hidden = true;
        elements.qrFrame.innerHTML = "";
        elements.qrFrame.classList.remove("is-exiting");
        window.requestAnimationFrame(() => {
            elements.successStage.classList.add("is-visible");
        });
    });
    const flowSnapshot = { ...state.currentFlow };
    const timer = window.setTimeout(() => {
        state.currentFlow = flowSnapshot;
        returnToBalanceFocus();
    }, 3000);
    state.timers.push(timer);
}

function finalizePaymentFail() {
    if (!state.currentFlow) return;
    clearPendingFlowTimers();
    state.finalState = "error";
    state.flowNode = "error";
    resetSuccessPresentation();
    elements.successStage.hidden = true;
    setModalStatus("支付状态返回失败，请更换支付方式或重新发起。", "error");
    elements.modalStatus.hidden = false;
    elements.qrBadge.className = "qr-badge";
    elements.qrBadge.textContent = "支付失败";
    elements.resultBanner.hidden = false;
    elements.resultBanner.className = "result-banner error show";
    elements.resultBanner.textContent = "模拟为支付完成前失败。建议这里保留重试与关闭两个出口，避免用户停在不确定状态。";
    elements.metaGrid.hidden = false;
    elements.primaryButton.textContent = "重新发起";
    elements.primaryButton.className = "action-btn danger";
    elements.primaryButton.hidden = false;
    setFlowState("支付失败", "二维码已展示，但支付结果返回失败。当前页面保留弹窗，方便继续调整失败反馈。");
    addLog("支付返回失败，弹窗保留在错误状态。");
    showToast("支付失败：状态查询返回 failed", "error", 4200);
    setProcessingSource(null);
    state.processing = false;
}

function buildFlowPayload(sourceType, payload) {
    if (sourceType === "package") {
        return {
            sourceType,
            id: payload.id,
            title: payload.name,
            points: payload.points,
            paidAmount: payload.price,
            channel: "易支付",
            link: `https://pay.preview.local/checkout/${payload.id}`
        };
    }

    const amount = Math.max(0.01, Number(elements.customInput.value || 0.01));
    return {
        sourceType,
        title: "自定义充值",
        points: amount,
        paidAmount: amount,
        channel: "易支付",
        link: `https://pay.preview.local/checkout/custom-${amount.toFixed(2)}`
    };
}

function startRecharge(sourceType, payload) {
    if (state.processing) return;

    const flow = buildFlowPayload(sourceType, payload);
    cancelBalanceAnimation();
    resetBalanceFocus();
    state.currentFlow = flow;
    state.lastCredited = 0;
    state.pendingCredit = Number(flow.points || 0);
    state.balanceDisplay = state.balance;
    state.balanceTarget = state.balance + state.pendingCredit;
    clearTimers();
    hideModal();
    setActiveMenu("recharge");
    renderBalance();
    setRechargeInteractionLocked(true);
    setProcessingSource(sourceType, payload);
    setFlowState("创建支付请求中", `${flow.title} 正在拉起支付，请观察按钮态、toast 与弹窗出现时机。`);
    addLog(`开始发起 ${flow.title}。`);

    if (state.scenario === "requestFail") {
        state.processing = true;
        schedule(920, () => {
            setProcessingSource(null);
            state.processing = false;
            setRechargeInteractionLocked(false);
            setFlowState("创建失败", "请求尚未返回二维码前就失败了。这个分支适合调 toast、按钮还原和重试提示。");
            addLog("支付请求创建失败，未进入扫码弹窗。");
            showToast(`${flow.title}发起失败，请稍后重试。`, "error", 4200);
        });
        return;
    }

    state.processing = true;
    schedule(520, () => {
        openModal(flow);
        addLog("支付请求已创建，准备展示扫码弹窗。");
    });

    schedule(1180, () => {
        markQrReady();
    });
}

function resetFlowState() {
    clearTimers();
    cancelBalanceAnimation();
    setProcessingSource(null);
    state.processing = false;
    state.currentFlow = null;
    state.lastCredited = 0;
    state.balanceDisplay = state.balance;
    hideModal();
    setActiveMenu("recharge");
    resetBalanceFocus();
    previewIncomingBalance(Math.max(0.01, Number(elements.customInput.value || 0.01)));
    setFlowState("等待发起", "点击任意套餐或自定义充值按钮后，这里会同步展示流程进度。");
    addLog("流程已重置，等待下一次预演。");
}

function copyLink() {
    if (!state.currentFlow?.link) return;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(state.currentFlow.link)
            .then(() => showToast("付款链接已复制到剪贴板", "success"))
            .catch(() => showToast("复制失败，已用预览提示代替", "info"));
        return;
    }
    showToast("当前环境不支持剪贴板，已跳过真实复制", "info");
}

function handlePrimaryAction() {
    if (!state.currentFlow) return;
    if (state.finalState === "success") {
        hideModal();
        addLog("关闭成功态弹窗。");
        return;
    }

    if (state.finalState === "error") {
        const retryPayload = state.currentFlow.sourceType === "package"
            ? packages.find((item) => item.id === state.currentFlow.id)
            : null;
        startRecharge(state.currentFlow.sourceType, retryPayload);
        return;
    }

    showToast("预演页不做真实跳转，这里仅模拟打开支付页。", "info");
    addLog("用户点击了“打开支付页”按钮。");
}

function buildFakeQrSvg(size) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("aria-hidden", "true");

    const bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", size);
    bg.setAttribute("height", size);
    bg.setAttribute("fill", "#fff");
    svg.appendChild(bg);

    const matrix = Array.from({ length: size }, () => Array(size).fill(false));

    function drawFinder(x, y) {
        for (let row = 0; row < 7; row += 1) {
            for (let col = 0; col < 7; col += 1) {
                const border = row === 0 || row === 6 || col === 0 || col === 6;
                const center = row >= 2 && row <= 4 && col >= 2 && col <= 4;
                matrix[y + row][x + col] = border || center;
            }
        }
    }

    drawFinder(0, 0);
    drawFinder(size - 7, 0);
    drawFinder(0, size - 7);

    let seed = 20260419;
    function random() {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
            const inFinderZone =
                (row < 8 && col < 8) ||
                (row < 8 && col >= size - 8) ||
                (row >= size - 8 && col < 8);
            if (inFinderZone) continue;
            matrix[row][col] = random() > 0.52;
        }
    }

    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
            if (!matrix[row][col]) continue;
            const rect = document.createElementNS(ns, "rect");
            rect.setAttribute("x", col);
            rect.setAttribute("y", row);
            rect.setAttribute("width", 1);
            rect.setAttribute("height", 1);
            rect.setAttribute("fill", "#111");
            svg.appendChild(rect);
        }
    }

    return svg;
}

elements.customInput.addEventListener("input", renderQuote);
elements.customSubmit.addEventListener("click", () => startRecharge("custom"));

elements.scenarioChips.addEventListener("click", (event) => {
    const target = event.target.closest("[data-scenario]");
    if (!target) return;
    state.scenario = target.dataset.scenario;
    renderScenario();
    addLog(`场景切换为：${scenarioText[state.scenario]}。`);
});

elements.speedChips.addEventListener("click", (event) => {
    const target = event.target.closest("[data-speed]");
    if (!target) return;
    state.speed = Number(target.dataset.speed) || 1;
    renderSpeed();
    addLog(`播放速度调整为 ${target.textContent}。`);
});

elements.viewportChips.addEventListener("click", (event) => {
    const target = event.target.closest("[data-viewport]");
    if (!target) return;
    state.viewport = target.dataset.viewport;
    renderViewport();
    addLog(`预览尺寸切换为${state.viewport === "mobile" ? "移动" : "桌面"}。`);
});

elements.stepQrReady.addEventListener("click", () => {
    if (!requireOpenFlow("推进到二维码已生成")) return;
    markQrReady();
});

elements.stepPolling.addEventListener("click", () => {
    if (!requireOpenFlow("推进到结果同步")) return;
    if (!state.qrReady) {
        markQrReady();
    }
    markPolling();
});

elements.stepReview.addEventListener("click", () => {
    if (!requireOpenFlow("推进到平台复核")) return;
    if (!state.qrReady) {
        markQrReady();
    }
    enterReviewState();
});

elements.stepSuccess.addEventListener("click", () => {
    if (!requireOpenFlow("切到成功态")) return;
    if (!state.qrReady) {
        markQrReady();
    }
    finalizeSuccess();
});

elements.stepFailure.addEventListener("click", () => {
    if (!requireOpenFlow("切到失败态")) return;
    if (!state.qrReady) {
        markQrReady();
    }
    finalizePaymentFail();
});

elements.quickCustomStart.addEventListener("click", () => startRecharge("custom"));
elements.quickPackageStart.addEventListener("click", () => startRecharge("package", packages[1]));
elements.resetFlow.addEventListener("click", resetFlowState);
elements.copyButton.addEventListener("click", copyLink);
elements.primaryButton.addEventListener("click", handlePrimaryAction);
elements.modalLayer.querySelector(".modal-backdrop").addEventListener("click", () => {
    cancelFlowObservation("你点击遮罩关闭了扫码弹窗。当前预演已停止，方便重新发起。");
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.modalOpen) {
        cancelFlowObservation("你通过 Esc 关闭了扫码弹窗。当前预演已停止，便于再次对比。");
    }
});

renderPackages();
renderScenario();
renderSpeed();
renderViewport();
renderBalance();
renderQuote();
setFlowState("等待发起", "点击任意套餐或自定义充值按钮后，这里会同步展示流程进度。");
addLog("预演页已就绪，可以开始测试充值流程。");
