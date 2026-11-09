(() => {
  const mobileGlassQuery = "(hover: none) and (pointer: coarse), (max-width: 768px) and (pointer: coarse)";
  const mobileMedia = window.matchMedia(mobileGlassQuery);
  const mobileGlassModuleURL = new URL("mobile-glass.mjs?v=20261108_RIM_3", document.currentScript?.src || new URL("js/magnifying-dock.js", document.baseURI));
  // Start the entrance only after the decoded desktop lens can be painted.
  // Touch surfaces use their existing native material and need no desktop gate.
  function whenDockMaterialReady(dock, reveal) {
    const script = document.querySelector('script[src*="/desktop-nav-glass.mjs"]');
    let failed = false;
    let finished = false;
    const ready = () => mobileMedia.matches || !script || failed ||
      dock.hasAttribute("data-desktop-glass-ready") ||
      (document.readyState === "complete" && document.documentElement.dataset.desktopGlassState !== "active");
    const check = () => {
      if (finished || !ready()) return;
      finished = true;
      observer.disconnect();
      window.removeEventListener("load", check);
      script?.removeEventListener("error", onError);
      mobileMedia.removeEventListener("change", check);
      reveal();
    };
    const onError = () => { failed = true; check(); };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true, subtree: true,
      attributeFilter: ["data-desktop-glass-ready", "data-desktop-glass-state"]
    });
    window.addEventListener("load", check, { once: true });
    script?.addEventListener("error", onError, { once: true });
    mobileMedia.addEventListener("change", check);
    check();
  }
  // Exclude admin studio management backend
  const pathname = (window.location.pathname || "").toLowerCase();
  if (
    pathname.includes("admin-studio") ||
    pathname.includes("admin_studio") ||
    pathname.includes("admin-entry") ||
    pathname.includes("tg-admin") ||
    document.body?.classList.contains("admin-studio") ||
    document.querySelector(".admin-studio-page")
  ) {
    return;
  }

  const ICONS = {
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>`,
    searchReset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/><path d="m8.2 8.2 5.2 5.2"/><path d="m13.4 8.2-5.2 5.2"/></svg>`,
    prompts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z"/></svg>`,
    shop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    coreKey: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 2.5 2.5"/><path d="m18.5 4.5 2 2"/></svg>`,
    verify: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c0 4.97-4.03 9-9 9 4.97 0 9 4.03 9 9 0-4.97 4.03-9 9-9-4.97 0-9-4.03-9-9Z"/></svg>`,
    guestbook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>`,
    saved: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z"/></svg>`,
    savedActive: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z"/></svg>`,
    sort: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    sortHot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    sortRandom: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>`,
    orders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 10h8"/><path d="M8 14h5"/></svg>`,
    viewGrid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
    viewList: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="5.5" rx="1.8"/><rect x="3" y="13.5" width="18" height="5.5" rx="1.8"/></svg>`,
    wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>`,
    modeSingle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="13" y2="13"/><circle cx="16.5" cy="14.5" r="1.5"/></svg>`,
    modeBatch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/></svg>`,
    history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
    guide: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    compose: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    drawer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`,
    drawerClose: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/><path d="m16 9-3 3 3 3"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
    top: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/><path d="M5 5h14"/></svg>`,
    doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>`,
    cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>`,
    clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    support: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="6" width="16" height="13" rx="5"/><path d="M12 6V3"/><circle cx="12" cy="2" r="0.75" fill="currentColor"/><path d="M2 11a2 2 0 0 1 2-2v6a2 2 0 0 1-2-2z"/><path d="M22 11a2 2 0 0 0-2-2v6a2 2 0 0 0 2-2z"/><circle cx="9" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="11.5" r="1" fill="currentColor" stroke="none"/><path d="M9.5 14.5c.7.7 1.6 1 2.5 1s1.8-.3 2.5-1"/></svg>`,
    tickets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`,
    backList: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5"/><path d="M6 12h13"/></svg>`,
    aiOrb: `
      <span class="ai-image-fab is-idle gdock-ai-orb" aria-hidden="true">
        <span class="ai-image-fab-core">
          <span class="ai-image-fab-particles">
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
          </span>
          <span class="ai-image-fab-depth"></span>
          <span class="ai-image-fab-orbit"></span>
          <span class="ai-image-fab-glass"></span>
          <span class="ai-image-fab-core-inner">
            <span class="ai-image-fab-mark">
              <i class="fas fa-wand-magic-sparkles"></i>
            </span>
          </span>
        </span>
      </span>`
  };

  function detectPageType() {
    if (pathname.includes("guest-orders") || pathname.includes("guest_orders")) return "guest-orders";
    if (pathname.includes("prompts")) return "prompts";
    if (pathname.includes("shop")) return "shop";
    if (pathname.includes("verify")) return "verify";
    if (pathname.includes("guestbook")) return "guestbook";
    if (pathname.includes("privacy")) return "privacy";
    if (pathname.includes("terms")) return "terms";
    if (pathname.includes("refund")) return "refund";
    return "home";
  }

  function openCustomerSupport() {
    if (window.ZaoyoeChatWidgetBootstrap && typeof window.ZaoyoeChatWidgetBootstrap.open === "function") {
      window.ZaoyoeChatWidgetBootstrap.open();
      return;
    }
    if (window.chatWidget) {
      if (typeof window.chatWidget.openChat === "function") {
        window.chatWidget.openChat();
        return;
      }
      if (typeof window.chatWidget.toggleChat === "function") {
        window.chatWidget.toggleChat();
        return;
      }
    }
    const fab = document.querySelector(".chat-widget-fab, [data-chat-widget-fab]");
    if (fab) {
      fab.click();
      return;
    }
    window.dispatchEvent(new CustomEvent("zaoyoe:chat-widget-runtime-pending-open", { detail: { source: "dock-robot" } }));
    const supportTrigger = document.querySelector('.nav-trigger[data-dropdown="support"]');
    if (supportTrigger) {
      supportTrigger.click();
      return;
    }
    window.location.href = "/guestbook.html";
  }

  function openWalletOrAuth() {
    if (typeof window.openWalletModal === "function") {
      window.openWalletModal();
      return;
    }
    const verifyBalance = document.getElementById("verifyBalance");
    if (verifyBalance && !verifyBalance.hidden) {
      verifyBalance.click();
      return;
    }
    const walletTrigger = document.querySelector("[data-wallet-open], [data-verify-action=\"wallet-open\"], #walletTrigger, .wallet-entry-btn");
    if (walletTrigger) {
      walletTrigger.click();
      return;
    }
    const authBtn = document.querySelector("[data-verify-action=\"login-gate\"], #auth-container .user-avatar-btn, #auth-container button, #auth-container a");
    if (authBtn) {
      authBtn.click();
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateItemGlyph(item, glyphKey, newSvgMarkup, options = {}) {
    if (!item) return;
    const glyph = item.querySelector(".gdock-glyph");
    if (!glyph) return;
    const currentKey = glyph.dataset.glyphKey;
    if (currentKey === glyphKey) return;
    glyph.dataset.glyphKey = glyphKey;

    const animate = options.animate !== false;
    const existingSvg = glyph.querySelector("svg:not(.gdock-svg--exit)");
    if (!animate || !existingSvg) {
      glyph.innerHTML = newSvgMarkup;
      return;
    }

    const temp = document.createElement("div");
    temp.innerHTML = newSvgMarkup.trim();
    const newSvg = temp.firstElementChild;
    if (!newSvg) {
      glyph.innerHTML = newSvgMarkup;
      return;
    }

    // Immediately remove any prior exiting node so at most two layers cross-dissolve
    glyph.querySelectorAll(".gdock-svg--exit").forEach((el) => el.remove());

    existingSvg.classList.add("gdock-svg--exit");
    newSvg.classList.add("gdock-svg--enter");
    glyph.appendChild(newSvg);

    const duration = 280;
    const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";

    if (typeof existingSvg.animate === "function" && typeof newSvg.animate === "function") {
      existingSvg.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.92)" }
        ],
        { duration, easing, fill: "forwards" }
      );

      const enterAnim = newSvg.animate(
        [
          { opacity: 0, transform: "scale(1.08)" },
          { opacity: 1, transform: "scale(1)" }
        ],
        { duration, easing, fill: "forwards" }
      );

      const cleanup = () => {
        if (existingSvg.parentNode === glyph) existingSvg.remove();
        newSvg.classList.remove("gdock-svg--enter");
      };

      enterAnim.onfinish = cleanup;
      setTimeout(cleanup, duration + 40);
    } else {
      existingSvg.style.transition = `opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}`;
      newSvg.style.transition = `opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}`;
      newSvg.style.opacity = "0";
      newSvg.style.transform = "scale(1.08)";
      void newSvg.offsetWidth;
      existingSvg.style.opacity = "0";
      existingSvg.style.transform = "scale(0.92)";
      newSvg.style.opacity = "1";
      newSvg.style.transform = "scale(1)";
      setTimeout(() => {
        if (existingSvg.parentNode === glyph) existingSvg.remove();
        newSvg.classList.remove("gdock-svg--enter");
      }, duration + 30);
    }
  }

  function triggerSpin(item) {
    if (!item) return;
    const glyph = item.querySelector(".gdock-glyph");
    if (!glyph) return;
    glyph.classList.remove("is-spinning");
    void glyph.offsetWidth;
    glyph.classList.add("is-spinning");
    setTimeout(() => {
      glyph.classList.remove("is-spinning");
    }, 500);
  }

  function triggerBounce() {
    // Intentionally calm and non-exaggerated
  }

  let sharedCartAudioCtx = null;
  function playCartChime() {
    try {
      const chimesToggle = document.querySelector("#chimes-toggle");
      if (chimesToggle && !chimesToggle.checked) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!sharedCartAudioCtx || sharedCartAudioCtx.state === "closed") {
        sharedCartAudioCtx = new AudioCtx();
      }
      if (sharedCartAudioCtx.state === "suspended") {
        sharedCartAudioCtx.resume().catch(() => {});
      }
      const now = sharedCartAudioCtx.currentTime;
      // Soft ascending crystal double chime (E5 -> A5)
      [659.25, 880].forEach((freq, idx) => {
        const osc = sharedCartAudioCtx.createOscillator();
        const gain = sharedCartAudioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.04, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.18);
        osc.connect(gain);
        gain.connect(sharedCartAudioCtx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.2);
      });
    } catch (_) {}
  }

  let cartBounceTimer = null;
  function triggerCartAddBounce(cartBtn, isIncrease = true) {
    if (!cartBtn) return;
    const badgeEl = cartBtn.querySelector(".gdock-badge");
    cartBtn.classList.remove("is-cart-bumped");
    if (badgeEl) badgeEl.classList.remove("is-popping");
    void cartBtn.offsetWidth; // force reflow
    cartBtn.classList.add("is-cart-bumped");
    if (badgeEl) badgeEl.classList.add("is-popping");

    if (cartBounceTimer) clearTimeout(cartBounceTimer);
    cartBounceTimer = setTimeout(() => {
      cartBtn.classList.remove("is-cart-bumped");
      if (badgeEl) badgeEl.classList.remove("is-popping");
    }, 650);

    if (isIncrease) {
      playCartChime();
    }
  }

  function updateDockCartBadge(targetCount) {
    const dock = document.querySelector(".dock-cluster .gdock, nav.gdock");
    if (!dock) return;
    const cartBtn = dock.querySelector('.gdock-item[data-key="cart"]');
    if (!cartBtn) return;
    let badgeEl = cartBtn.querySelector(".gdock-badge");
    const count = typeof targetCount === "number" ? targetCount : (() => {
      const anchorBadge = document.getElementById("shopCartAnchorBadge");
      const countText = anchorBadge && !anchorBadge.hidden ? (anchorBadge.textContent || "").trim() : "";
      return parseInt(countText, 10) || 0;
    })();

    if (count > 0) {
      if (!badgeEl) {
        badgeEl = document.createElement("span");
        badgeEl.className = "gdock-badge";
        badgeEl.setAttribute("aria-hidden", "true");
        cartBtn.appendChild(badgeEl);
      }
      const prevCount = parseInt(badgeEl.dataset.count || "0", 10);
      badgeEl.textContent = count > 99 ? "99+" : String(count);
      badgeEl.dataset.count = String(count);
      if (prevCount !== count) {
        triggerCartAddBounce(cartBtn, count > prevCount);
      }
    } else {
      cartBtn.classList.remove("is-cart-bumped");
      if (badgeEl) {
        badgeEl.remove();
      }
    }
  }

  window.updateDockCartBadge = updateDockCartBadge;

  window.triggerDockCartBounce = (isIncrease = true) => {
    const cartBtn = document.querySelector('.gdock-item[data-key="cart"]');
    if (cartBtn) triggerCartAddBounce(cartBtn, isIncrease);
  };

  function playSupportChime() {
    try {
      const chimesToggle = document.querySelector("#chimes-toggle");
      if (chimesToggle && !chimesToggle.checked) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!sharedCartAudioCtx || sharedCartAudioCtx.state === "closed") {
        sharedCartAudioCtx = new AudioCtx();
      }
      if (sharedCartAudioCtx.state === "suspended") {
        sharedCartAudioCtx.resume().catch(() => {});
      }
      const now = sharedCartAudioCtx.currentTime;
      // Soft ascending crystal chime (C5 -> G5)
      [523.25, 783.99].forEach((freq, idx) => {
        const osc = sharedCartAudioCtx.createOscillator();
        const gain = sharedCartAudioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.04, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.18);
        osc.connect(gain);
        gain.connect(sharedCartAudioCtx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.2);
      });
    } catch (_) {}
  }

  let supportBounceTimer = null;
  function triggerSupportBounce(supportBtn, isIncrease = true) {
    if (!supportBtn) return;
    const badgeEl = supportBtn.querySelector(".gdock-badge");
    supportBtn.classList.remove("is-support-bumped");
    if (badgeEl) badgeEl.classList.remove("is-popping");
    void supportBtn.offsetWidth; // force reflow
    supportBtn.classList.add("is-support-bumped");
    if (badgeEl) badgeEl.classList.add("is-popping");

    if (supportBounceTimer) clearTimeout(supportBounceTimer);
    supportBounceTimer = setTimeout(() => {
      supportBtn.classList.remove("is-support-bumped");
      if (badgeEl) badgeEl.classList.remove("is-popping");
    }, 650);

    if (isIncrease) {
      playSupportChime();
    }
  }

  window.triggerDockSupportBounce = (isIncrease = true) => {
    const supportBtns = document.querySelectorAll('.gdock-item[data-key="support"]');
    supportBtns.forEach((btn) => triggerSupportBounce(btn, isIncrease));
  };

  function isGuestOrdersVerified() {
    const tabsWrapper = document.getElementById("guestOrdersTabsWrapper");
    if (!tabsWrapper || tabsWrapper.hidden) return false;
    const resultCard = document.getElementById("guestOrdersResultCard");
    const myTicketsSection = document.getElementById("myTicketsSection");
    const hasOrdersResult = Boolean(resultCard && !resultCard.hidden);
    const isTicketsActive = Boolean(myTicketsSection && !myTicketsSection.hidden);
    return hasOrdersResult || isTicketsActive;
  }

  function isGuestOrderDetailActive() {
    if (!isGuestOrdersVerified()) return false;
    const ticketsSection = document.getElementById("myTicketsSection");
    const isTicketsActive = Boolean(ticketsSection && !ticketsSection.hidden);
    if (isTicketsActive) return false;
    const detailEl = document.getElementById("guestOrdersDetail");
    const backBtn = document.getElementById("guestOrdersBackToListBtn");
    return Boolean(
      detailEl && !detailEl.hidden &&
      backBtn && !backBtn.hidden
    );
  }

  function getPageConfig(pageType) {
    switch (pageType) {
      case "guest-orders": {
        const isVerifiedInitial = typeof document !== "undefined" && isGuestOrdersVerified();
        const isTicketsInitial = isVerifiedInitial && Boolean(
          (typeof document !== "undefined" && document.getElementById("myTicketsSection") && !document.getElementById("myTicketsSection").hidden)
        );

        let initialLabel = "查询订单";
        let initialGlyph = "search";
        let initialIcon = ICONS.search;

        if (isVerifiedInitial) {
          if (isTicketsInitial) {
            initialLabel = "订单查询";
            initialGlyph = "search";
            initialIcon = ICONS.search;
          } else {
            initialLabel = "我的工单";
            initialGlyph = "tickets";
            initialIcon = ICONS.tickets;
          }
        }

        return {
          orbDock: false,
          items: [
            {
              key: "home",
              label: "返回首页",
              glyphKey: "home",
              icon: ICONS.home,
              active: false,
              action: () => { window.location.href = "/index.html"; }
            },
            {
              key: "shop",
              label: "返回商城",
              glyphKey: "shop",
              icon: ICONS.shop,
              active: false,
              action: () => { window.location.href = "/shop.html"; }
            },
            {
              key: "query",
              label: initialLabel,
              glyphKey: initialGlyph,
              icon: initialIcon,
              active: false,
              action: (item) => {
                triggerBounce(item);
                const isVerified = isGuestOrdersVerified();
                if (!isVerified) {
                  // 未验证邮箱和密码，严禁提前展示或进入我的工单，执行表单聚焦与提交
                  const emailInput = document.getElementById("guestOrdersEmail");
                  const pwdInput = document.getElementById("guestOrdersPassword");
                  const submitBtn = document.getElementById("guestOrdersSubmitBtn");
                  if (!emailInput?.value?.trim()) {
                    emailInput?.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(() => emailInput?.focus({ preventScroll: true }), 150);
                  } else if (!pwdInput?.value?.trim()) {
                    pwdInput?.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(() => pwdInput?.focus({ preventScroll: true }), 150);
                  } else if (submitBtn) {
                    triggerSpin(item);
                    submitBtn.click();
                  }
                  return;
                }

                // 凭证验证无误后，支持在订单查询与我的工单之间切换
                const ticketsSection = document.getElementById("myTicketsSection");
                const isTicketsActive = Boolean(ticketsSection && !ticketsSection.hidden);
                if (isTicketsActive) {
                  const ordersTab = document.getElementById("tabBtnOrders");
                  if (ordersTab) ordersTab.click();
                } else {
                  const ticketsTab = document.getElementById("tabBtnTickets");
                  if (ticketsTab) ticketsTab.click();
                }
              }
            },
            {
              key: "back-list",
              label: "返回列表",
              glyphKey: "backList",
              icon: ICONS.backList,
              active: false,
              action: (item) => {
                triggerBounce(item);
                const backBtn = document.getElementById("guestOrdersBackToListBtn");
                if (backBtn && !backBtn.hidden) {
                  backBtn.click();
                  const resultCard = document.getElementById("guestOrdersResultCard");
                  if (resultCard) {
                    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }
              }
            },
            {
              key: "clear",
              label: "清空输入",
              glyphKey: "clear",
              icon: ICONS.clear,
              active: false,
              action: (item) => {
                triggerBounce(item);
                const emailInput = document.getElementById("guestOrdersEmail");
                const pwdInput = document.getElementById("guestOrdersPassword");
                const orderNoInput = document.getElementById("guestOrdersOrderNo");
                const errorBox = document.getElementById("guestOrdersError");
                if (emailInput) emailInput.value = "";
                if (pwdInput) pwdInput.value = "";
                if (orderNoInput) orderNoInput.value = "";
                if (errorBox) {
                  errorBox.hidden = true;
                  errorBox.textContent = "";
                }
                if (emailInput) {
                  emailInput.scrollIntoView({ behavior: "smooth", block: "center" });
                  setTimeout(() => emailInput.focus({ preventScroll: true }), 100);
                }
              }
            },
            {
              key: "support",
              label: "在线客服",
              glyphKey: "support",
              icon: ICONS.support,
              active: false,
              action: (item) => {
                triggerBounce(item);
                openCustomerSupport();
              }
            },
            {
              key: "top",
              label: "回到顶部",
              glyphKey: "top",
              icon: ICONS.top,
              active: false,
              action: (item) => {
                triggerBounce(item);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }
          ]
        };
      }

      case "prompts":
        return {
          orbDock: true,
          items: [
            {
              key: "home",
              label: "返回首页",
              glyphKey: "home",
              icon: ICONS.home,
              active: false,
              action: () => { window.location.href = "/index.html"; }
            },
            {
              key: "search",
              label: "搜索提示词",
              glyphKey: "search",
              icon: ICONS.search,
              active: false,
              action: () => {
                const isFiltered = (typeof window.isPromptSearchActive === "function" && window.isPromptSearchActive())
                  || (typeof currentFilter !== "undefined" && currentFilter === "search")
                  || Boolean(document.getElementById("gallerySearch")?.value.trim());

                if (isFiltered) {
                  // Direct 1-click in-place reset to all prompts
                  if (window.PromptSpotlight && typeof window.PromptSpotlight.resetSearch === "function") {
                    window.PromptSpotlight.resetSearch();
                    syncLivePageState("prompts");
                    return;
                  }
                  if (typeof window.renderGallery === "function") {
                    const gallerySearch = document.getElementById("gallerySearch");
                    if (gallerySearch) gallerySearch.value = "";
                    window.renderGallery("all", true, { preserveScroll: true });
                    const allItem = document.querySelector('.nav-item[data-filter="all"]');
                    if (allItem) {
                      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
                      allItem.classList.add("active");
                    }
                    syncLivePageState("prompts");
                    return;
                  }
                }

                if (window.PromptSpotlight && typeof window.PromptSpotlight.toggle === "function") {
                  window.PromptSpotlight.toggle();
                  return;
                }
                const input = document.getElementById("gallerySearch");
                if (input) {
                  input.scrollIntoView({ behavior: "smooth", block: "center" });
                  setTimeout(() => input.focus({ preventScroll: true }), 220);
                } else {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }
            },
            {
              key: "ai-workbench",
              label: "AI 创作台",
              glyphKey: "aiOrb",
              icon: ICONS.aiOrb,
              isAiOrb: true,
              active: false,
              action: () => {
                if (window.AIImageWorkbench && typeof window.AIImageWorkbench.open === "function") {
                  window.AIImageWorkbench.open();
                  return;
                }
                if (typeof window.__AI_IMAGE_WORKBENCH_OPEN__ === "function") {
                  window.__AI_IMAGE_WORKBENCH_OPEN__();
                  return;
                }
                const fabHit = document.querySelector("[data-aiw-native-hit], .ai-image-fab");
                if (fabHit) fabHit.click();
              }
            },
            {
              key: "saved",
              label: "我的收藏",
              glyphKey: "saved",
              icon: ICONS.saved,
              active: false,
              action: () => {
                const navItems = [...document.querySelectorAll("#navItems .nav-item")];
                const savedItem = navItems.find((el) => {
                  const text = (el.textContent || "").toLowerCase();
                  const cat = (el.dataset.category || el.dataset.filter || "").toLowerCase();
                  return cat.includes("fav") || cat.includes("save") || text.includes("收藏") || text.includes("saved");
                });
                const allItem = navItems[0];
                if (!savedItem) return;
                const isAlreadySaved = savedItem.classList.contains("active") || savedItem.getAttribute("aria-selected") === "true";
                if (isAlreadySaved && allItem && allItem !== savedItem) {
                  allItem.click();
                } else {
                  savedItem.click();
                }
                setTimeout(() => syncLivePageState("prompts"), 40);
              }
            },
            {
              key: "sort",
              label: "随机漫游",
              glyphKey: "sortHot",
              icon: ICONS.sortHot,
              active: false,
              action: () => {
                const hotBtn = document.querySelector(".prompt-sort-filter__button[data-prompt-sort=\"hot\"]");
                const randomBtn = document.querySelector(".prompt-sort-filter__button[data-prompt-sort=\"random\"]");
                if (hotBtn && randomBtn) {
                  const isHot = hotBtn.classList.contains("is-active") || hotBtn.getAttribute("aria-pressed") === "true";
                  (isHot ? randomBtn : hotBtn).click();
                  setTimeout(() => syncLivePageState("prompts"), 40);
                } else {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }
            }
          ]
        };

      case "shop": {
        const isShopList = typeof document !== "undefined" && Boolean(
          document.querySelector(".view-toggle__btn[data-view-target=\"list\"].is-active") ||
          document.querySelector(".shop-main.shop-layout--list") ||
          (document.documentElement && document.documentElement.dataset.shopLayout === "list") ||
          (window.localStorage && window.localStorage.getItem("zaoyoe_shop_view") !== "grid")
        );
        return {
          orbDock: false,
          items: [
            {
              key: "home",
              label: "返回首页",
              glyphKey: "home",
              icon: ICONS.home,
              active: false,
              action: () => { window.location.href = "/index.html"; }
            },
            {
              key: "search",
              label: "搜索商品",
              glyphKey: "search",
              icon: ICONS.search,
              active: false,
              action: () => {
                const isFiltered = (typeof window.isShopSearchActive === "function" && window.isShopSearchActive())
                  || Boolean(document.getElementById("listSearchInput")?.value?.trim())
                  || Boolean(window.ShopListLayout?.getSearchQuery?.());

                if (isFiltered) {
                  // Direct 1-click in-place reset to all products
                  if (window.PromptSpotlight && typeof window.PromptSpotlight.resetSearch === "function") {
                    window.PromptSpotlight.resetSearch();
                    syncLivePageState("shop");
                    return;
                  }
                  if (window.ShopListLayout && typeof window.ShopListLayout.resetSearch === "function") {
                    window.ShopListLayout.resetSearch({ preserveScroll: true });
                    syncLivePageState("shop");
                    return;
                  }
                  const input = document.getElementById("listSearchInput");
                  if (input) {
                    input.value = "";
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                  }
                  syncLivePageState("shop");
                  return;
                }

                if (window.PromptSpotlight && typeof window.PromptSpotlight.toggle === "function") {
                  window.PromptSpotlight.toggle();
                  return;
                }
                const input = document.getElementById("listSearchInput");
                if (input) {
                  input.scrollIntoView({ behavior: "smooth", block: "center" });
                  setTimeout(() => input.focus({ preventScroll: true }), 220);
                } else {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }
            },
            {
              key: "orders",
              label: "订单查询",
              glyphKey: "orders",
              icon: ICONS.orders,
              active: false,
              action: (item) => {
                triggerBounce(item);
                const currentSite = new URLSearchParams(window.location.search).get("site") || window.SiteConfig?.site || "cn";
                window.location.href = `/guest-orders.html?site=${encodeURIComponent(currentSite)}`;
              }
            },
            {
              key: "cart",
              label: "购物车",
              glyphKey: "cart",
              icon: ICONS.cart,
              active: false,
              action: (item) => {
                triggerBounce(item);
                if (window.ShopClient && typeof window.ShopClient.openCart === "function") {
                  window.ShopClient.openCart();
                  return;
                }
                const anchor = document.getElementById("shopCartAnchor");
                if (anchor) {
                  anchor.click();
                  return;
                }
                const drawer = document.getElementById("shopCartDrawer");
                if (drawer) {
                  drawer.classList.add("active");
                  document.body.dataset.shopCartOpen = "true";
                }
              }
            },
            {
              key: "view",
              label: isShopList ? "卡片模式" : "列表模式",
              glyphKey: isShopList ? "viewList" : "viewGrid",
              icon: isShopList ? ICONS.viewList : ICONS.viewGrid,
              active: isShopList,
              action: () => {
                const listBtn = document.querySelector(".view-toggle__btn[data-view-target=\"list\"]");
                const gridBtn = document.querySelector(".view-toggle__btn[data-view-target=\"grid\"]");
                if (listBtn && gridBtn) {
                  const isGrid = gridBtn.classList.contains("is-active") || Boolean(document.querySelector(".shop-main")?.classList.contains("shop-layout--grid"));
                  (isGrid ? listBtn : gridBtn).click();
                  setTimeout(() => syncLivePageState("shop"), 40);
                }
              }
            },
            {
              key: "top",
              label: "回到顶部",
              glyphKey: "top",
              icon: ICONS.top,
              active: false,
              action: (item) => {
                const isMobile = (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) || window.innerWidth <= 820;
                if (isMobile) {
                  const isDrawerOpen = Boolean(
                    document.body.classList.contains("shop-list-drawer-open") ||
                    document.querySelector(".shop-main.is-list-drawer-open")
                  );
                  triggerBounce(item);
                  if (isDrawerOpen) {
                    if (window.ShopListLayout && typeof window.ShopListLayout.setListDrawer === "function") {
                      window.ShopListLayout.setListDrawer(false);
                    } else {
                      const closeBtn = document.querySelector("[data-list-drawer-close]");
                      if (closeBtn) closeBtn.click();
                      document.body.classList.remove("shop-list-drawer-open");
                      document.querySelector(".shop-main")?.classList.remove("is-list-drawer-open");
                    }
                  } else {
                    if (window.ShopListLayout && typeof window.ShopListLayout.setListDrawer === "function") {
                      window.ShopListLayout.setListDrawer(true);
                    } else {
                      const mobileDrawerBtn = document.querySelector("[data-list-drawer-open]");
                      if (mobileDrawerBtn) {
                        mobileDrawerBtn.click();
                      } else {
                        document.body.classList.add("shop-list-drawer-open");
                        const shopMain = document.querySelector(".shop-main");
                        if (shopMain) {
                          shopMain.classList.add("is-list-drawer-open");
                          shopMain.classList.add("is-list-drawer-ready");
                        }
                      }
                    }
                  }
                  setTimeout(() => syncLivePageState("shop"), 60);
                  return;
                }
                triggerBounce(item);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            },
            {
              key: "support",
              label: "在线客服",
              glyphKey: "support",
              icon: ICONS.support,
              active: false,
              action: (item) => {
                const isMobile = (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) || window.innerWidth <= 820;
                const isScrolled = window.scrollY > 160;
                triggerBounce(item);
                if (isMobile && isScrolled) {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  return;
                }
                openCustomerSupport();
              }
            }
          ]
        };
      }

      case "verify": {
        const isBatchInit = typeof window !== "undefined" && typeof window.getVerifySubmitMode === "function"
          ? window.getVerifySubmitMode() === "batch"
          : (typeof document !== "undefined" && Boolean(
              document.querySelector("[data-verify-mode=\"batch\"].active, [data-verify-mode=\"batch\"][aria-pressed=\"true\"]")
            ));
        return {
          orbDock: false,
          items: [
            {
              key: "home",
              label: "返回首页",
              glyphKey: "home",
              icon: ICONS.home,
              active: false,
              action: () => { window.location.href = "/index.html"; }
            },
            {
              key: "mode",
              label: isBatchInit ? "单号验证" : "批量任务",
              glyphKey: isBatchInit ? "modeBatch" : "modeSingle",
              icon: isBatchInit ? ICONS.modeBatch : ICONS.modeSingle,
              active: isBatchInit,
              action: () => {
                if (typeof window.toggleVerifySubmitMode === "function") {
                  window.toggleVerifySubmitMode();
                  syncLivePageState("verify");
                  return;
                }
                const singleBtn = document.querySelector("[data-verify-mode=\"single\"]");
                const batchBtn = document.querySelector("[data-verify-mode=\"batch\"]");
                if (singleBtn && batchBtn && !singleBtn.closest("[hidden]")) {
                  const isBatch = batchBtn.classList.contains("active") || batchBtn.getAttribute("aria-pressed") === "true";
                  (isBatch ? singleBtn : batchBtn).click();
                  syncLivePageState("verify");
                }
              }
            },
            {
              key: "history",
              label: "任务历史",
              glyphKey: "history",
              icon: ICONS.history,
              active: false,
              action: (item) => {
                triggerSpin(item);
                void window.ZaoyoeVerifyFocusHistory?.();
              }
            },
            {
              key: "guide",
              label: "使用说明",
              glyphKey: "guide",
              icon: ICONS.guide,
              active: false,
              action: (item) => {
                triggerBounce(item);
                window.location.href = "/google-2fa-tutorial.html";
              }
            },
            {
              key: "wallet",
              label: "钱包",
              glyphKey: "wallet",
              icon: ICONS.wallet,
              active: false,
              action: () => { openWalletOrAuth(); }
            },
            {
              key: "support",
              label: "在线客服",
              glyphKey: "support",
              icon: ICONS.support,
              active: false,
              action: (item) => {
                triggerBounce(item);
                openCustomerSupport();
              }
            }
          ]
        };
      }

      case "guestbook":
        return {
          orbDock: false,
          items: [
            {
              key: "home",
              label: "返回首页",
              glyphKey: "home",
              icon: ICONS.home,
              active: false,
              action: () => { window.location.href = "/index.html"; }
            },
            {
              key: "compose",
              label: "写留言",
              glyphKey: "compose",
              icon: ICONS.compose,
              active: false,
              action: () => {
                const modal = document.getElementById("guestbookModal");
                const isModalOpen = Boolean(modal && (modal.classList.contains("active") || modal.classList.contains("show") || modal.getAttribute("aria-hidden") === "false"));
                if (isModalOpen && modal) {
                  const closeBtn = modal.querySelector(".modal-close, [data-dismiss], .btn-close");
                  if (closeBtn) closeBtn.click();
                  else {
                    modal.classList.remove("active", "show");
                    modal.setAttribute("aria-hidden", "true");
                  }
                  setTimeout(() => syncLivePageState("guestbook"), 60);
                  return;
                }
                const launcher = document.getElementById("guestbookComposerLauncher") || document.querySelector("[data-guestbook-open=\"1\"]");
                if (launcher) {
                  launcher.click();
                  setTimeout(() => syncLivePageState("guestbook"), 80);
                  return;
                }
                if (modal) {
                  modal.classList.add("active", "show");
                  modal.setAttribute("aria-hidden", "false");
                  const textarea = document.getElementById("guestMessage");
                  if (textarea) setTimeout(() => textarea.focus(), 120);
                  setTimeout(() => syncLivePageState("guestbook"), 80);
                }
              }
            },
            {
              key: "refresh",
              label: "刷新动态",
              glyphKey: "refresh",
              icon: ICONS.refresh,
              active: false,
              action: (item) => {
                triggerSpin(item);
                const capsule = document.getElementById("smart-capsule");
                if (capsule && capsule.classList.contains("show")) {
                  capsule.click();
                  return;
                }
                window.scrollTo({ top: 0, behavior: "smooth" });
                if (typeof window.loadMessages === "function") {
                  window.loadMessages(true);
                }
              }
            },
            {
              key: "prompts",
              label: "提示词",
              glyphKey: "prompts",
              icon: ICONS.prompts,
              active: false,
              action: () => { window.location.href = "/prompts.html"; }
            },
            {
              key: "top",
              label: "回到顶部",
              glyphKey: "top",
              icon: ICONS.top,
              active: false,
              action: (item) => {
                triggerBounce(item);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }
          ]
        };

      case "privacy":
      case "terms":
      case "refund":
        return {
          orbDock: false,
          items: [
            {
              key: "home",
              label: "返回首页",
              glyphKey: "home",
              icon: ICONS.home,
              active: false,
              action: () => { window.location.href = "/index.html"; }
            },
            {
              key: "privacy",
              label: "隐私政策",
              glyphKey: "privacy",
              icon: ICONS.doc,
              active: pageType === "privacy",
              action: () => { window.location.href = "/privacy.html"; }
            },
            {
              key: "terms",
              label: "服务条款",
              glyphKey: "terms",
              icon: ICONS.guide,
              active: pageType === "terms",
              action: () => { window.location.href = "/terms.html"; }
            },
            {
              key: "refund",
              label: "退款政策",
              glyphKey: "refund",
              icon: ICONS.orders,
              active: pageType === "refund",
              action: () => { window.location.href = "/refund-policy.html"; }
            },
            {
              key: "top",
              label: "回到顶部",
              glyphKey: "top",
              icon: ICONS.top,
              active: false,
              action: (item) => {
                triggerBounce(item);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }
          ]
        };

      case "home":
      default:
        return {
          orbDock: false,
          items: [
            {
              key: "home",
              label: "首页",
              glyphKey: "home",
              icon: ICONS.home,
              active: true,
              action: (item) => {
                if (window.scrollY > 280) triggerBounce(item);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            },
            {
              key: "prompts",
              label: "提示词",
              glyphKey: "prompts",
              icon: ICONS.prompts,
              active: false,
              action: () => { window.location.href = "/prompts.html"; }
            },
            {
              key: "shop",
              label: "资源商城",
              glyphKey: "shop",
              icon: ICONS.shop,
              active: false,
              action: () => { window.location.href = "/shop.html"; }
            },
            {
              key: "coreKey",
              label: "核心秘钥",
              glyphKey: "coreKey",
              icon: ICONS.coreKey,
              active: false,
              action: () => { window.location.href = "https://new.fatherkey.com"; }
            },
            {
              key: "verify",
              label: "Gemini Pro",
              glyphKey: "verify",
              icon: ICONS.verify,
              active: false,
              action: () => { window.location.href = "/verify.html"; }
            },
            {
              key: "guestbook",
              label: "留言板",
              glyphKey: "guestbook",
              icon: ICONS.guestbook,
              active: false,
              action: () => { window.location.href = "/guestbook.html"; }
            }
          ]
        };
    }
  }

  function syncLivePageState(pageType) {
    const dock = document.querySelector(".dock-cluster .gdock, nav.gdock");
    if (!dock) return;

    if (pageType === "guest-orders") {
      const isVerified = isGuestOrdersVerified();
      const ticketsSection = document.getElementById("myTicketsSection");
      const isTicketsView = Boolean(isVerified && ticketsSection && !ticketsSection.hidden);

      const queryBtn = dock.querySelector('.gdock-item[data-key="query"]');
      if (queryBtn) {
        let targetLabel = "查询订单";
        let targetGlyph = "search";
        let targetIcon = ICONS.search;

        if (isVerified) {
          targetLabel = isTicketsView ? "订单查询" : "我的工单";
          targetGlyph = isTicketsView ? "search" : "tickets";
          targetIcon = isTicketsView ? ICONS.search : ICONS.tickets;
        }

        if (queryBtn.getAttribute("aria-label") !== targetLabel) {
          queryBtn.setAttribute("aria-label", targetLabel);
          updateItemGlyph(queryBtn, targetGlyph, targetIcon);
          const tip = dock.querySelector(".gdock-tip");
          if (tip && tip.dataset.on === "true") {
            const tipWord = tip.querySelector("span");
            if (tipWord && (tipWord.textContent === "我的工单" || tipWord.textContent === "订单查询" || tipWord.textContent === "查询订单")) {
              tipWord.textContent = targetLabel;
              tip.style.width = `${Math.ceil(tipWord.scrollWidth) + 24}px`;
            }
          }
        }

        const loading = document.getElementById("guestOrdersLoading");
        const isLoading = Boolean(loading && !loading.hidden);
        const resultCard = document.getElementById("guestOrdersResultCard");
        const hasResult = Boolean(resultCard && !resultCard.hidden);
        const ticketBadge = document.getElementById("myTicketsBadgeCount");
        const hasTicketBadge = Boolean(isVerified && ticketBadge && !ticketBadge.hidden && parseInt(ticketBadge.textContent || "0", 10) > 0);

        const isDotOn = isVerified ? (isTicketsView ? (isLoading || hasResult) : hasTicketBadge) : (isLoading || hasResult);
        queryBtn.dataset.active = String(isLoading || (isVerified && hasResult));
        const dot = queryBtn.querySelector(".gdock-dot");
        if (dot) dot.dataset.on = String(isDotOn);
      }

      const backListBtn = dock.querySelector('.gdock-item[data-key="back-list"], .gdock-item[data-key="backList"]');
      if (backListBtn) {
        const isDetailActive = isGuestOrderDetailActive();
        const shouldCollapse = !isDetailActive;
        const collapsedStr = String(shouldCollapse);

        if (backListBtn.dataset.collapsed !== collapsedStr) {
          backListBtn.dataset.collapsed = collapsedStr;
          if (shouldCollapse) {
            backListBtn.setAttribute("aria-hidden", "true");
            backListBtn.tabIndex = -1;
            const tip = dock.querySelector(".gdock-tip");
            if (tip && tip.querySelector("span")?.textContent === "返回列表") {
              tip.dataset.on = "false";
            }
          } else {
            backListBtn.removeAttribute("aria-hidden");
            backListBtn.tabIndex = 0;
          }
        }
      }
    } else if (pageType === "prompts") {
      const searchBtn = dock.querySelector('.gdock-item[data-key="search"]');
      if (searchBtn) {
        const isSearchOpen = Boolean(window.PromptSpotlight && typeof window.PromptSpotlight.isOpen === "function" && window.PromptSpotlight.isOpen());
        const isSearchFiltered = (typeof window.isPromptSearchActive === "function" && window.isPromptSearchActive())
          || (typeof currentFilter !== "undefined" && currentFilter === "search")
          || Boolean(document.getElementById("gallerySearch")?.value.trim());

        const isActive = isSearchOpen || isSearchFiltered;
        const activeStr = String(isActive);
        const filteredStr = String(isSearchFiltered);
        if (searchBtn.dataset.active !== activeStr) searchBtn.dataset.active = activeStr;
        if (searchBtn.dataset.searchFiltered !== filteredStr) searchBtn.dataset.searchFiltered = filteredStr;
        const dot = searchBtn.querySelector(".gdock-dot");
        if (dot && dot.dataset.on !== activeStr) dot.dataset.on = activeStr;

        const targetLabel = isSearchFiltered ? "清除搜索 (恢复全部)" : "搜索提示词";
        if (searchBtn.getAttribute("aria-label") !== targetLabel) {
          searchBtn.setAttribute("aria-label", targetLabel);
        }
        if (isSearchFiltered) {
          updateItemGlyph(searchBtn, "searchReset", ICONS.searchReset);
        } else {
          updateItemGlyph(searchBtn, "search", ICONS.search);
        }
      }

      const savedBtn = dock.querySelector('.gdock-item[data-key="saved"]');
      if (savedBtn) {
        const navItems = [...document.querySelectorAll("#navItems .nav-item")];
        const savedItem = navItems.find((el) => {
          const text = (el.textContent || "").toLowerCase();
          const cat = (el.dataset.category || el.dataset.filter || "").toLowerCase();
          return cat.includes("fav") || cat.includes("save") || text.includes("收藏") || text.includes("saved");
        });
        const isSavedActive = Boolean(savedItem && (savedItem.classList.contains("active") || savedItem.getAttribute("aria-selected") === "true"));
        const savedStr = String(isSavedActive);
        if (savedBtn.dataset.active !== savedStr) savedBtn.dataset.active = savedStr;
        const dot = savedBtn.querySelector(".gdock-dot");
        if (dot && dot.dataset.on !== savedStr) dot.dataset.on = savedStr;
        if (isSavedActive) {
          updateItemGlyph(savedBtn, "savedActive", ICONS.savedActive);
        } else {
          updateItemGlyph(savedBtn, "saved", ICONS.saved);
        }
      }

      const sortBtn = dock.querySelector('.gdock-item[data-key="sort"]');
      if (sortBtn) {
        const hotBtn = document.querySelector('.prompt-sort-filter__button[data-prompt-sort="hot"]');
        const isHot = Boolean(hotBtn && (hotBtn.classList.contains("is-active") || hotBtn.getAttribute("aria-pressed") === "true"));
        const hotStr = String(isHot);
        if (sortBtn.dataset.active !== hotStr) sortBtn.dataset.active = hotStr;
        const dot = sortBtn.querySelector(".gdock-dot");
        if (dot && dot.dataset.on !== hotStr) dot.dataset.on = hotStr;
        const sortLabel = isHot ? "随机漫游" : "热度排序";
        if (sortBtn.getAttribute("aria-label") !== sortLabel) {
          sortBtn.setAttribute("aria-label", sortLabel);
          if (isHot) {
            updateItemGlyph(sortBtn, "sortHot", ICONS.sortHot);
          } else {
            updateItemGlyph(sortBtn, "sortRandom", ICONS.sortRandom);
          }
        }
      }

      const dockOrb = dock.querySelector(".gdock-ai-orb");
      const sourceFab = document.querySelector(".ai-image-workbench-root .ai-image-fab");
      if (dockOrb) {
        let hasStatusDot = false;
        let isBusy = false;
        let isComplete = false;
        let isFailed = false;

        if (sourceFab) {
          hasStatusDot = sourceFab.classList.contains("has-status-dot") || Boolean(sourceFab.querySelector(".ai-image-fab-status-dot"));
          isBusy = sourceFab.classList.contains("is-busy");
          isComplete = sourceFab.classList.contains("is-complete");
          isFailed = sourceFab.classList.contains("is-failed");
        } else {
          try {
            for (let i = 0; i < window.localStorage.length; i += 1) {
              const k = window.localStorage.key(i);
              if (k && k.startsWith("zaoyoe_ai_image_workbench_state_v1:user:")) {
                const parsed = JSON.parse(window.localStorage.getItem(k) || "{}");
                const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
                const dismissed = new Set(parsed.historyPrefs?.dockDismissedTaskIds || []);
                const visibleTasks = tasks.filter((t) => t && t.id && !dismissed.has(t.id));
                if (visibleTasks.length > 0) {
                  hasStatusDot = true;
                  break;
                }
              }
            }
          } catch (_) {
            // Ignore localStorage read errors during early boot
          }
        }

        dockOrb.classList.toggle("has-status-dot", hasStatusDot);
        dockOrb.classList.toggle("is-busy", isBusy);
        dockOrb.classList.toggle("is-complete", isComplete);
        dockOrb.classList.toggle("is-failed", isFailed);
        let statusDot = dockOrb.querySelector(".ai-image-fab-status-dot");
        if (hasStatusDot && !statusDot) {
          dockOrb.insertAdjacentHTML("beforeend", '<span class="ai-image-fab-status-dot" aria-hidden="true"></span>');
        } else if (!hasStatusDot && statusDot) {
          statusDot.remove();
        }
      }
    } else if (pageType === "shop") {
      const searchBtn = dock.querySelector('.gdock-item[data-key="search"]');
      if (searchBtn) {
        const isSearchOpen = Boolean(window.PromptSpotlight && typeof window.PromptSpotlight.isOpen === "function" && window.PromptSpotlight.isOpen());
        const isSearchFiltered = (typeof window.isShopSearchActive === "function" && window.isShopSearchActive())
          || Boolean(document.getElementById("listSearchInput")?.value?.trim())
          || Boolean(window.ShopListLayout?.getSearchQuery?.());

        const isActive = isSearchOpen || isSearchFiltered;
        const activeStr = String(isActive);
        const filteredStr = String(isSearchFiltered);
        if (searchBtn.dataset.active !== activeStr) searchBtn.dataset.active = activeStr;
        if (searchBtn.dataset.searchFiltered !== filteredStr) searchBtn.dataset.searchFiltered = filteredStr;
        const dot = searchBtn.querySelector(".gdock-dot");
        if (dot && dot.dataset.on !== activeStr) dot.dataset.on = activeStr;

        const targetLabel = isSearchFiltered ? "清除搜索 (恢复全部)" : "搜索商品";
        if (searchBtn.getAttribute("aria-label") !== targetLabel) {
          searchBtn.setAttribute("aria-label", targetLabel);
        }
        if (isSearchFiltered) {
          updateItemGlyph(searchBtn, "searchReset", ICONS.searchReset);
        } else {
          updateItemGlyph(searchBtn, "search", ICONS.search);
        }
      }

      updateDockCartBadge();

      const viewBtn = dock.querySelector('.gdock-item[data-key="view"]');
      if (viewBtn) {
        const isList = Boolean(
          document.querySelector('.view-toggle__btn[data-view-target="list"].is-active') ||
          document.querySelector(".shop-main.shop-layout--list") ||
          (document.documentElement && document.documentElement.dataset.shopLayout === "list") ||
          document.querySelector(".view-toggle")?.dataset?.view === "list"
        );
        const isListStr = String(isList);
        if (viewBtn.dataset.active !== isListStr) viewBtn.dataset.active = isListStr;
        const targetViewLabel = isList ? "卡片模式" : "列表模式";
        if (viewBtn.getAttribute("aria-label") !== targetViewLabel) viewBtn.setAttribute("aria-label", targetViewLabel);
        const dot = viewBtn.querySelector(".gdock-dot");
        if (dot && dot.dataset.on !== isListStr) dot.dataset.on = isListStr;
        if (isList) {
          updateItemGlyph(viewBtn, "viewList", ICONS.viewList);
        } else {
          updateItemGlyph(viewBtn, "viewGrid", ICONS.viewGrid);
        }
      }

      const topBtn = dock.querySelector('.gdock-item[data-key="top"]');
      if (topBtn) {
        const isMobile = (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) || window.innerWidth <= 820;
        const isDrawerOpen = Boolean(
          document.body.classList.contains("shop-list-drawer-open") ||
          document.querySelector(".shop-main.is-list-drawer-open")
        );

        let targetTopLabel = "回到顶部";
        let targetGlyph = "top";
        let targetIcon = ICONS.top;

        if (isMobile) {
          if (isDrawerOpen) {
            targetTopLabel = "关闭分类";
            targetGlyph = "drawerClose";
            targetIcon = ICONS.drawerClose;
          } else {
            targetTopLabel = "商品分类";
            targetGlyph = "drawer";
            targetIcon = ICONS.drawer;
          }
        }

        if (topBtn.getAttribute("aria-label") !== targetTopLabel) {
          topBtn.setAttribute("aria-label", targetTopLabel);
          updateItemGlyph(topBtn, targetGlyph, targetIcon);
        }
      }

      const supportBtn = dock.querySelector('.gdock-item[data-key="support"]');
      if (supportBtn) {
        const isMobile = (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) || window.innerWidth <= 820;
        const isScrolled = window.scrollY > 160;

        let targetSupportLabel = "在线客服";
        let targetGlyph = "support";
        let targetIcon = ICONS.support;

        if (isMobile && isScrolled) {
          targetSupportLabel = "回到顶部";
          targetGlyph = "top";
          targetIcon = ICONS.top;
        }

        if (supportBtn.getAttribute("aria-label") !== targetSupportLabel) {
          supportBtn.setAttribute("aria-label", targetSupportLabel);
          updateItemGlyph(supportBtn, targetGlyph, targetIcon);
        }
      }
    } else if (pageType === "verify") {
      const modeBtn = dock.querySelector('.gdock-item[data-key="mode"]');
      if (modeBtn) {
        const isBatch = typeof window.getVerifySubmitMode === "function"
          ? window.getVerifySubmitMode() === "batch"
          : Boolean(
              document.querySelector('[data-verify-mode="batch"]')?.classList.contains("active") ||
              (document.getElementById("verifyBatchField") && !document.getElementById("verifyBatchField").hidden)
            );
        modeBtn.dataset.active = String(isBatch);
        modeBtn.setAttribute("aria-label", isBatch ? "单号验证" : "批量任务");
        const dot = modeBtn.querySelector(".gdock-dot");
        if (dot) dot.dataset.on = String(isBatch);
        if (isBatch) {
          updateItemGlyph(modeBtn, "modeBatch", ICONS.modeBatch);
        } else {
          updateItemGlyph(modeBtn, "modeSingle", ICONS.modeSingle);
        }
      }
    } else if (pageType === "guestbook") {
      const composeBtn = dock.querySelector('.gdock-item[data-key="compose"]');
      if (composeBtn) {
        const modal = document.getElementById("guestbookModal");
        const isModalOpen = Boolean(modal && (modal.classList.contains("active") || modal.classList.contains("show") || modal.getAttribute("aria-hidden") === "false"));
        const active = String(isModalOpen);
        if (composeBtn.dataset.active !== active) composeBtn.dataset.active = active;
        const dot = composeBtn.querySelector(".gdock-dot");
        if (dot && dot.dataset.on !== active) dot.dataset.on = active;
        if (isModalOpen) {
          if (composeBtn.getAttribute("aria-label") !== "关闭") composeBtn.setAttribute("aria-label", "关闭");
          updateItemGlyph(composeBtn, "close", ICONS.close);
        } else {
          if (composeBtn.getAttribute("aria-label") !== "写留言") composeBtn.setAttribute("aria-label", "写留言");
          updateItemGlyph(composeBtn, "compose", ICONS.compose);
        }
      }
    } else if (pageType === "home") {
      const homeBtn = dock.querySelector('.gdock-item[data-key="home"]');
      if (homeBtn) {
        const isScrolled = window.scrollY > 280;
        if (isScrolled) {
          homeBtn.setAttribute("aria-label", "回到顶部");
          homeBtn.dataset.active = "false";
          const dot = homeBtn.querySelector(".gdock-dot");
          if (dot) dot.dataset.on = "false";
          updateItemGlyph(homeBtn, "top", ICONS.top);
        } else {
          homeBtn.setAttribute("aria-label", "首页");
          homeBtn.dataset.active = "true";
          const dot = homeBtn.querySelector(".gdock-dot");
          if (dot) dot.dataset.on = "true";
          updateItemGlyph(homeBtn, "home", ICONS.home);
        }
      }
    }

    // Smoothly collapse and hide "Back to Top" when page is already at the top
    const globalTopBtn = dock.querySelector('.gdock-item[data-key="top"]');
    if (globalTopBtn) {
      const isMobile = (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) || window.innerWidth <= 820;
      const isShop = pageType === "shop";
      const isScrolled = window.scrollY > 120;
      // On mobile shop page, item 5 is the category drawer toggle and must NEVER collapse.
      const shouldCollapse = isShop && isMobile ? false : !isScrolled;
      const collapsedStr = String(shouldCollapse);

      if (globalTopBtn.dataset.collapsed !== collapsedStr) {
        globalTopBtn.dataset.collapsed = collapsedStr;
        if (shouldCollapse) {
          globalTopBtn.setAttribute("aria-hidden", "true");
          globalTopBtn.tabIndex = -1;
          const tip = dock.querySelector(".gdock-tip");
          if (tip) tip.dataset.on = "false";
        } else {
          globalTopBtn.removeAttribute("aria-hidden");
          globalTopBtn.tabIndex = 0;
        }
      }
    }

    // Synchronize customer support unread count, badge, and bouncy reaction
    const supportBtns = dock.querySelectorAll('.gdock-item[data-key="support"]');
    supportBtns.forEach((btn) => {
      const fab = document.querySelector(".chat-widget-fab");
      const fabBadge = fab?.querySelector(".notification-badge");
      const hasPreview = Boolean(fab?.querySelector(".message-preview"));
      const countFromBadge = parseInt(fabBadge?.textContent || "0", 10);
      const widgetUnread = typeof window.chatWidget?.unreadCount === "number" ? window.chatWidget.unreadCount : 0;
      const unreadCount = Math.max(countFromBadge, widgetUnread, hasPreview ? 1 : 0);

      let badgeEl = btn.querySelector(".gdock-badge");
      if (unreadCount > 0) {
        if (!badgeEl) {
          badgeEl = document.createElement("span");
          badgeEl.className = "gdock-badge";
          badgeEl.setAttribute("aria-hidden", "true");
          btn.appendChild(badgeEl);
        }
        const prevCount = parseInt(badgeEl.dataset.count || "0", 10);
        badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        badgeEl.dataset.count = String(unreadCount);
        if (prevCount !== unreadCount) {
          triggerSupportBounce(btn, unreadCount > prevCount);
        }
      } else if (badgeEl) {
        badgeEl.remove();
      }
    });
  }

  let dockMounted = false;

  function initDock() {
    if (dockMounted) return;
    if (!document.body) return;
    dockMounted = true;

    if (!document.querySelector("link[href*=\"magnifying-dock.css\"]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./css/magnifying-dock.css?v=20261108_RIM_3&homeSpacing=20261108_2&overlayNav=20261108_1";
      document.head.appendChild(link);
    }

    const pageType = detectPageType();
    const pageConfig = getPageConfig(pageType);

    let dock = document.querySelector(".dock-cluster .gdock, nav.gdock");
    if (!dock) {
      const container = document.createElement("div");
      container.className = "stage dock-stage";
      container.style.cssText = "position: static; padding: 0; min-height: auto; border: none; background: transparent;";

      const isScrolledInitial = typeof window !== "undefined" && window.scrollY > 120;
      const isShopInitial = pageType === "shop";
      const isMobileInitial = typeof window !== "undefined" && ((window.matchMedia && window.matchMedia("(max-width: 820px)").matches) || window.innerWidth <= 820);
      const isOrderDetailInitial = pageType === "guest-orders" && isGuestOrderDetailActive();
      const buttonsHtml = pageConfig.items
        .map((item, idx) => {
          const isTopItem = item.key === "top";
          const isBackListItem = item.key === "back-list" || item.key === "backList";
          const shouldCollapseInitial = isTopItem
            ? (isShopInitial && isMobileInitial ? false : !isScrolledInitial)
            : (isBackListItem ? !isOrderDetailInitial : false);
          return `
          <button class="gdock-item${item.isAiOrb ? " gdock-item--ai-orb" : ""}" type="button" aria-label="${item.label}" ${item.active ? 'aria-current="page"' : ""} data-active="${Boolean(item.active)}" data-near="${idx === 0 ? "0" : ""}" data-key="${item.key}"${shouldCollapseInitial ? ' data-collapsed="true" aria-hidden="true" tabindex="-1"' : ""}>
            <span class="gdock-glyph" data-glyph-key="${item.glyphKey || item.key}">${item.icon}</span><span class="gdock-dot" data-on="${Boolean(item.active)}"></span>
          </button>
        `;})
        .join("");

      container.innerHTML = `
        <div class="dock-cluster" data-fill="dark" data-stroke="on">
          <nav class="gdock" aria-label="Dock navigation" data-fill="dark" data-stroke="on" data-rim="glass">
            <span class="gdock-glass" aria-hidden="true"></span>
            ${buttonsHtml}
            <span class="gdock-tip" aria-hidden="true" data-on="false"><span>${pageConfig.items[0].label}</span></span>
          </nav>
        </div>
        <div style="display:none;" aria-hidden="true">
          <span id="selected-label">${pageConfig.items[0].label}</span>
          <input id="labels-toggle" type="checkbox" checked />
          <input id="chimes-toggle" type="checkbox" checked />
          <input id="magnify-control" type="range" min="1" max="1.5" step="0.01" value="1.18" />
          <output id="magnify-value" for="magnify-control">1.18×</output>
          <input id="lift-control" type="range" min="0" max="16" step="1" value="7" />
          <output id="lift-value" for="lift-control">7px</output>
          <input id="reach-control" type="range" min="0" max="3" step="1" value="1" />
          <output id="reach-value" for="reach-value">1</output>
        </div>
      `;
      document.body.appendChild(container);
    }

    (() => {
      const dock = document.querySelector(".dock-cluster .gdock, nav.gdock");
      if (!dock) return;
      const dockCluster = dock.closest(".dock-cluster");
      if (!dockCluster) return;
      const AVATAR_DROPDOWN_SVGS = {
        bell: `<svg class="dropdown-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
        sun: `<svg class="dropdown-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2"/><path d="M12 19.3v2.2"/><path d="m4.93 4.93 1.56 1.56"/><path d="m17.51 17.51 1.56 1.56"/><path d="M2.5 12h2.2"/><path d="M19.3 12h2.2"/><path d="m4.93 19.07 1.56-1.56"/><path d="m17.51 6.49 1.56-1.56"/></svg>`,
        moon: `<svg class="dropdown-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"/></svg>`,
        profile: `<svg class="dropdown-svg-icon dropdown-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>`,
        wallet: `<svg class="dropdown-svg-icon dropdown-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>`,
        orders: `<svg class="dropdown-svg-icon dropdown-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
        "switch-account": `<svg class="dropdown-svg-icon dropdown-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 3 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 21-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
        studio: `<svg class="dropdown-svg-icon dropdown-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.8"/></svg>`,
        logout: `<svg class="dropdown-svg-icon dropdown-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
        login: `<svg class="dropdown-svg-icon dropdown-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`
      };

      const upgradeAvatarDropdownIcons = (popup) => {
        if (!popup || !popup.classList.contains("avatar-dropdown")) return;
        const notifBtn = popup.querySelector("#dropdownNotifBtn");
        if (notifBtn) {
          const oldBell = notifBtn.querySelector("i");
          if (oldBell) oldBell.outerHTML = AVATAR_DROPDOWN_SVGS.bell;
        }
        const sunIcon = popup.querySelector(".theme-icon-sun");
        if (sunIcon && !sunIcon.querySelector("svg")) {
          sunIcon.innerHTML = AVATAR_DROPDOWN_SVGS.sun;
        }
        const moonIcon = popup.querySelector(".theme-icon-moon");
        if (moonIcon && !moonIcon.querySelector("svg")) {
          moonIcon.innerHTML = AVATAR_DROPDOWN_SVGS.moon;
        }
        popup.querySelectorAll(".dropdown-action").forEach((actionEl) => {
          const actionKey = actionEl.getAttribute("data-auth-action");
          const svgMarkup = actionKey && AVATAR_DROPDOWN_SVGS[actionKey];
          if (!svgMarkup) return;
          const legacyIcon = actionEl.querySelector("i");
          if (legacyIcon) {
            legacyIcon.outerHTML = svgMarkup;
          } else if (!actionEl.querySelector(".dropdown-svg-icon")) {
            actionEl.insertAdjacentHTML("afterbegin", svgMarkup);
          }
        });
      };

      // Glass is owned by desktop-nav-glass.mjs / mobile-glass.mjs.
      // This public hook only upgrades dynamically inserted avatar icons.
      const syncAllNavPopups = () => {
        document.querySelectorAll(".avatar-dropdown").forEach(upgradeAvatarDropdownIcons);
      };
      window.syncDockNavPopups = syncAllNavPopups;
      window.syncMagnifyingDockState = (page) => syncLivePageState(page || pageType);

      const handleDockResize = () => syncLivePageState(pageType);
      syncAllNavPopups();
      window.addEventListener("resize", handleDockResize, { passive: true });
      const resizeObserver = new ResizeObserver(handleDockResize);
      resizeObserver.observe(dock);
      resizeObserver.observe(dockCluster);

      const MODAL_OPEN_SELECTOR = [
        "#myTicketDetailModal.active",
        "#guestOrdersTicketModal.active",
        ".guest-orders-modal-overlay.active",
        "#myTicketDetailModal:not([hidden])",
        "#guestOrdersTicketModal:not([hidden])",
        "#shopPurchaseModal.active",
        "#shopCartDrawer.active",
        "#shopCartCheckoutModal.active",
        "#shopSuccessModal.active",
        "#guestCashPurchaseModal.active",
        ".guest-shop-modal.active",
        "#profileModal.active",
        "#guestbookModal.active",
        "#commentModal.active",
        "#loginModal.active",
        "#authModal.active",
        "#adminLoginModal.active",
        ".auth-sheet-overlay.active",
        "#walletModal.active",
        "#wallet-modal-overlay.active",
        ".wallet-order-modal-overlay.active",
        ".wallet-overlay.active",
        ".lightbox-overlay:not([hidden])",
        ".image-lightbox.active",
        ".image-modal.active",
        ".notif-backdrop.active",
        ".login-overlay.active",
        ".zaoyoe-announcement-overlay:not(.announcement-modal-force-hidden)",
        "#promptModal.active",
        ".poetry-modal.active",
        "#promptSpotlightOverlay.is-open",
        ".prompt-spotlight-overlay.is-open",
        ".modal-overlay.active",
        ".modal.active",
        ".modal.open",
        ".modal-layer.open",
        ".codes-modal-overlay.is-visible",
        "dialog[open]"
      ].join(",");

      // Keep full-screen dialogs separate from the cart: only the cart leaves
      // the full-width navigation visible at the top of the page.
      const FULLSCREEN_MODAL_CLASSES = [
        "modal-open", "auth-sheet-open", "guestbook-composer-open",
        "wallet-modal-lock", "guest-shop-modal-open", "ai-image-workbench-open",
        "prompt-spotlight-active", "ticket-detail-modal-open", "ticket-modal-open",
        "notif-scroll-locked"
      ];
      const isRenderedModal = (el) => {
        if (el.hidden || el.closest('[hidden], [aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" &&
          el.getClientRects().length > 0;
      };
      const syncActiveModalState = () => {
        const hasExplicitModal = FULLSCREEN_MODAL_CLASSES.some((name) =>
          document.body.classList.contains(name) || document.documentElement.classList.contains(name)
        ) || document.body.dataset.shopPurchaseModalOpen === "true";
        // A hidden first match must not mask a second, still-open dialog.
        const activeModals = [...document.querySelectorAll(MODAL_OPEN_SELECTOR)].filter(isRenderedModal);
        const isCartActive = document.body.classList.contains("shop-cart-open") ||
          document.body.dataset.shopCartOpen === "true" ||
          activeModals.some((el) => el.id === "shopCartDrawer");
        const isScrollLocked = Boolean(window.iOSScrollLock?.isLocked);
        const isModalActive = hasExplicitModal || isCartActive || isScrollLocked || activeModals.length > 0;
        const hidesTopNavigation = hasExplicitModal ||
          activeModals.some((el) => el.id !== "shopCartDrawer") ||
          (isScrollLocked && !isCartActive);

        for (const root of [document.body, document.documentElement]) {
          if (root.classList.contains("has-active-modal") !== isModalActive) {
            root.classList.toggle("has-active-modal", isModalActive);
          }
        }
        // Avoid feeding our own observer when the derived state is unchanged.
        if (hidesTopNavigation) {
          if (document.body.dataset.navModalOpen !== "true") document.body.dataset.navModalOpen = "true";
        } else if (document.body.dataset.navModalOpen !== undefined) {
          delete document.body.dataset.navModalOpen;
        }
      };

      syncActiveModalState();
      if (typeof MutationObserver === "function" && document.body) {
        const popupDomObserver = new MutationObserver(() => {
          syncAllNavPopups();
          syncActiveModalState();
        });
        popupDomObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "hidden", "aria-hidden", "data-shop-cart-open", "data-shop-purchase-modal-open"]
        });
        popupDomObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      }
      window.addEventListener("DOMContentLoaded", () => {
        syncAllNavPopups();
        syncActiveModalState();
      }, { once: true });
      window.addEventListener("load", () => {
        syncAllNavPopups();
        syncActiveModalState();
      }, { once: true });
      window.addEventListener("zaoyoe:auth-markup-ready", () => {
        syncAllNavPopups();
        syncActiveModalState();
      });

      const items = [...dock.querySelectorAll(".gdock-item")];
      const tip = dock.querySelector(".gdock-tip");
      const tipWord = tip.querySelector("span");
      const selectedLabel = document.querySelector("#selected-label");
      const downPointer = { active: false, type: "" };
      const chimeNotes = [392, 440, 494, 523, 587];
      let audioContext = null;
      let pendingChime = null;
      let audioResumePending = false;
      let chimesEnabled = document.querySelector("#chimes-toggle").checked;
      let hoverIndex = null;
      let magnify = 1.18;
      let lift = 7;
      let reach = 1;
      let labels = true;

      const at = (clientX) => {
        let best = null;
        let gap = Infinity;
        items.forEach((item, index) => {
          if (item.dataset.collapsed === "true" || item.offsetWidth === 0 || item.getAttribute("aria-hidden") === "true") return;
          const rect = item.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          const distance = Math.abs(clientX - (rect.left + rect.width / 2));
          if (distance < gap) {
            best = index;
            gap = distance;
          }
        });
        return best;
      };

      const unlockAudio = () => {
        if (!chimesEnabled) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass();
        const flushPendingChime = () => {
          audioResumePending = false;
          if (audioContext.state !== "running" || pendingChime === null) return;
          const index = pendingChime;
          pendingChime = null;
          playChime(index);
        };
        if (audioContext.state === "running") {
          flushPendingChime();
          return;
        }
        audioResumePending = true;
        audioContext.resume().then(flushPendingChime).catch(() => {
          audioResumePending = false;
          if (hoverIndex === null) pendingChime = null;
        });
      };

      const playChime = (index) => {
        if (!chimesEnabled) return;
        if (!audioContext || audioContext.state !== "running") {
          pendingChime = index;
          unlockAudio();
          return;
        }
        const now = audioContext.currentTime;
        const frequency = chimeNotes[index % chimeNotes.length];
        const voice = audioContext.createOscillator();
        const overtone = audioContext.createOscillator();
        const voiceGain = audioContext.createGain();
        const overtoneGain = audioContext.createGain();
        voice.type = "sine";
        overtone.type = "sine";
        voice.frequency.setValueAtTime(frequency * 1.035, now);
        voice.frequency.exponentialRampToValueAtTime(frequency, now + 0.045);
        overtone.frequency.setValueAtTime(frequency * 2.01, now);
        voiceGain.gain.setValueAtTime(0.0001, now);
        voiceGain.gain.exponentialRampToValueAtTime(0.075, now + 0.009);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
        overtoneGain.gain.setValueAtTime(0.0001, now);
        overtoneGain.gain.exponentialRampToValueAtTime(0.009, now + 0.008);
        overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
        voice.connect(voiceGain).connect(audioContext.destination);
        overtone.connect(overtoneGain).connect(audioContext.destination);
        voice.start(now);
        overtone.start(now);
        voice.stop(now + 0.18);
        overtone.stop(now + 0.07);
      };

      window.addEventListener("pointerdown", unlockAudio, { capture: true, passive: true });
      window.addEventListener("keydown", unlockAudio, { capture: true });
      unlockAudio();

      const setHover = (index, soundOnEnter = false) => {
        if (index !== null) {
          const target = items[index];
          if (!target || target.dataset.collapsed === "true" || target.offsetWidth === 0 || target.getAttribute("aria-hidden") === "true") {
            index = null;
          }
        }
        const previousIndex = hoverIndex;
        hoverIndex = index;
        if (index === null && !audioResumePending) pendingChime = null;
        if (soundOnEnter && index !== null && index !== previousIndex) playChime(index);
        items.forEach((item, itemIndex) => {
          if (item.dataset.collapsed === "true" || item.offsetWidth === 0 || item.getAttribute("aria-hidden") === "true") {
            const glyph = item.querySelector(".gdock-glyph");
            if (glyph) glyph.style.transform = "";
            item.dataset.near = "";
            return;
          }
          const distance = index === null ? Infinity : Math.abs(itemIndex - index);
          const influence = distance > reach ? 0 : (1 + Math.cos((Math.PI * distance) / (reach + 1))) / 2;
          const scale = 1 + (magnify - 1) * influence;
          const glyph = item.querySelector(".gdock-glyph");
          item.dataset.near = distance <= 1 ? String(distance) : "";
          if (glyph) glyph.style.transform = `translateY(${-lift * influence}px) scale(${scale})`;
        });
        updateTip();
      };

      const updateTip = () => {
        if (!labels || hoverIndex === null) {
          tip.dataset.on = "false";
          return;
        }
        const item = items[hoverIndex];
        if (!item || item.dataset.collapsed === "true" || item.offsetWidth === 0 || item.getAttribute("aria-hidden") === "true") {
          tip.dataset.on = "false";
          return;
        }
        tipWord.textContent = item.getAttribute("aria-label");
        tip.style.width = `${Math.ceil(tipWord.scrollWidth) + 24}px`;
        const center = item.offsetLeft + item.offsetWidth / 2;
        tip.style.transform = `translateX(${center - parseFloat(tip.style.width) / 2}px)`;
        tip.dataset.on = "true";
      };

      const triggerItem = (item, index) => {
        if (!item || item.dataset.collapsed === "true" || item.offsetWidth === 0 || item.getAttribute("aria-hidden") === "true") return;
        const configItem = pageConfig.items[index];
        selectedLabel.textContent = item.getAttribute("aria-label");
        if (configItem && typeof configItem.action === "function") {
          configItem.action(item);
        }
        updateTip();
      };

      let pendingTouchActivation = null;
      let handledTouchClick = false;

      const track = (event) => {
        if (event.pointerType !== "mouse" && !downPointer.active) return;

        const index = at(event.clientX);
        if (downPointer.active && event.pointerType === "touch" && index !== downPointer.index) {
          downPointer.slid = true;
        }
        setHover(index, event.pointerType === "mouse" && !downPointer.active);
      };

      dock.addEventListener("pointerdown", (event) => {
        downPointer.active = true;
        downPointer.type = event.pointerType;
        downPointer.index = at(event.clientX);
        downPointer.slid = false;
        pendingTouchActivation = null;

        // Avoid focusing a bottom-fixed button during pointer handling.
        // touch-action: pan-y still lets the browser cancel a vertical pan.
        if (event.pointerType === "touch" || event.pointerType === "pen") {
          event.preventDefault();
        }
        setHover(downPointer.index);
      }, true);

      dock.addEventListener("pointermove", track, true);

      dock.addEventListener("pointerup", (event) => {
        if (downPointer.active && event.pointerType !== "mouse") {
          const index = at(event.clientX);
          if (event.pointerType === "touch") {
            pendingTouchActivation = {
              index,
              slid: downPointer.slid || index !== downPointer.index
            };
          }
          setHover(null);
        }
        downPointer.active = false;
      }, true);

      // Cancel the touch default before navigating or opening an overlay. A
      // pointerdown cancellation alone still allows the browser's later click
      // and focus handling. Treat taps and horizontal slides the same way.
      dock.addEventListener("touchend", (event) => {
        const activation = pendingTouchActivation;
        pendingTouchActivation = null;
        if (activation === null) return;
        if (event.cancelable) {
          event.preventDefault();
          if (!event.defaultPrevented) return;
        } else if (!activation.slid) {
          return;
        }
        // Chrome can make touchend non-cancelable after a horizontal slide
        // and omit its native click. Complete that selection here as well.
        handledTouchClick = true;
        triggerItem(items[activation.index], activation.index);
      }, { capture: true, passive: false });

      // Some WebViews may still deliver a compatibility click. Catch only a
      // touch-origin click, including if an overlay now covers the Dock. Any
      // new pointer gesture clears the guard; keyboard activation is preserved.
      window.addEventListener("pointerdown", () => {
        handledTouchClick = false;
      }, true);
      window.addEventListener("click", (event) => {
        const fromTouch = event.pointerType === "touch" || event.sourceCapabilities?.firesTouchEvents === true;
        if (!handledTouchClick || event.detail === 0 || !fromTouch) return;
        handledTouchClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);

      dock.addEventListener("pointercancel", () => {
        pendingTouchActivation = null;
        downPointer.active = false;
        setHover(null);

      }, true);

      dock.addEventListener("pointerleave", () => {
        if (!downPointer.active) {
          setHover(null);

        }
      });

      window.addEventListener("pointerup", () => {
        if (downPointer.active) {
          downPointer.active = false;
          setHover(null);

        }
      });

      window.addEventListener("pointercancel", () => {
        pendingTouchActivation = null;
        downPointer.active = false;
        setHover(null);

      });

      // Mouse, pen, keyboard and non-cancelable taps use native click.
      // Never activate in pointerup: a later click could hit a new overlay.
      dock.addEventListener("click", (event) => {
        pendingTouchActivation = null;
        const pointerType = event.pointerType || downPointer.type;
        const isTouchClick = event.detail !== 0 && (pointerType === "touch" || pointerType === "pen");
        const index = isTouchClick
          ? at(event.clientX)
          : items.indexOf(event.target.closest(".gdock-item"));
        if (index !== null && index >= 0) triggerItem(items[index], index);
      });

      items.forEach((item) => {
        item.addEventListener("pointerdown", (event) => event.stopPropagation());
      });

      if (pageType === "prompts" || pageType === "shop") {
        window.addEventListener("prompt-spotlight-change", () => {
          syncLivePageState(pageType);
        });
        window.addEventListener("prompt-search-change", () => {
          syncLivePageState(pageType);
        });
        window.addEventListener("shop-search-change", () => {
          syncLivePageState(pageType);
        });
      }

      if (pageType === "guest-orders") {
        window.addEventListener("guest-orders-view-change", () => {
          syncLivePageState(pageType);
        });
      }

      // Real-time synchronization on scrolling (e.g. Home ⇄ Top, Drawer ⇄ Top)
      let scrollTicking = false;
      window.addEventListener("scroll", () => {
        if (!scrollTicking) {
          scrollTicking = true;
          requestAnimationFrame(() => {
            syncLivePageState(pageType);
            if (hoverIndex !== null) updateTip();
            scrollTicking = false;
          });
        }
      }, { passive: true });

      // Keep Dock active indicators synchronized with page interactions
      document.addEventListener("click", () => {
        setTimeout(() => {
          syncLivePageState(pageType);
          if (hoverIndex !== null) updateTip();
        }, 40);
        setTimeout(() => {
          syncLivePageState(pageType);
          if (hoverIndex !== null) updateTip();
        }, 180);
      }, { passive: true });

      // Observe DOM and view/layout mutations across pages
      if (typeof MutationObserver === "function" && document.body) {
        const pageDomObserver = new MutationObserver(() => {
          syncLivePageState(pageType);
          if (hoverIndex !== null) updateTip();
        });
        const observeTargetNodes = [
          document.querySelector(".view-toggle"),
          document.querySelector(".shop-main"),
          document.querySelector(".prompt-sort-filter"),
          document.getElementById("navItems"),
          document.getElementById("guestbookModal"),
          document.querySelector("[data-verify-mode]")?.parentElement,
          document.getElementById("guestOrdersOrdersView"),
          document.getElementById("myTicketsSection"),
          document.getElementById("guestOrdersDetail"),
          document.getElementById("guestOrdersBackToListBtn"),
          document.getElementById("guestOrdersResultCard"),
          document.getElementById("guestOrdersProtectedContent")
        ].filter(Boolean);

        observeTargetNodes.forEach((node) => {
          pageDomObserver.observe(node, {
            attributes: true,
            attributeFilter: ["class", "data-view", "data-shop-layout", "aria-pressed", "aria-selected", "aria-hidden", "hidden"],
            childList: true
          });
        });
      }

      syncLivePageState(pageType);
      setTimeout(() => syncLivePageState(pageType), 300);
      window.addEventListener("DOMContentLoaded", () => syncLivePageState(pageType), { once: true });
      window.addEventListener("load", () => syncLivePageState(pageType), { once: true });

      if (pageType === "prompts" && typeof MutationObserver === "function") {
        let fabObserverBound = false;
        const bindWorkbenchObserver = () => {
          if (fabObserverBound) return;
          const aiRoot = document.querySelector(".ai-image-workbench-root");
          if (aiRoot) {
            fabObserverBound = true;
            syncLivePageState("prompts");
            const aiObserver = new MutationObserver(() => syncLivePageState("prompts"));
            aiObserver.observe(aiRoot, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ["class"]
            });
          }
        };
        bindWorkbenchObserver();
        if (!fabObserverBound && document.body) {
          const bodyObserver = new MutationObserver(() => {
            bindWorkbenchObserver();
            if (fabObserverBound) bodyObserver.disconnect();
          });
          bodyObserver.observe(document.body, { childList: true });
        }
      }

      // Measure the starting position while hidden; reveal the complete material
      // from the beginning of the float, rather than halfway through its motion.
      whenDockMaterialReady(dock, () => {
        void dockCluster.offsetHeight;
        requestAnimationFrame(() => {
          tip.dataset.ready = "true";
          requestAnimationFrame(() => {
            dockCluster.classList.add("is-ready");

            // Load optional canvas optics only for touch surfaces. Theme material
            // lives in CSS; query changes dispose optics before desktop effects.
            let mobileGlassController = null;
            let mobileGlassLoading = null;
            const syncMobileGlasswork = () => {
              if (mobileMedia.matches) {
                dockCluster.dataset.refract = "native";
                if (!mobileGlassLoading) {
                  mobileGlassLoading = import(mobileGlassModuleURL.href).then(({ createMobileGlassController }) => {
                    mobileGlassController = createMobileGlassController();
                    if (mobileMedia.matches) mobileGlassController.start();
                  }).catch((error) => {
                    mobileGlassLoading = null;
                    console.warn("Mobile glass uses theme defaults:", error.message);
                  });
                } else if (mobileGlassController) mobileGlassController.start();
              } else {
                mobileGlassController?.stop();
                dockCluster.removeAttribute("data-refract");
              }
            };
            syncMobileGlasswork();
            mobileMedia.addEventListener("change", syncMobileGlasswork);
          });
        });
      });
    })();
  }

  function mountWhenPageStructureReady() {
    const isStructureReady = () =>
      Boolean(document.body && (document.querySelector("main, #main-content, .framer-nav") || document.readyState !== "loading"));

    if (isStructureReady()) {
      initDock();
      return;
    }
    if (typeof MutationObserver === "function") {
      const observer = new MutationObserver(() => {
        if (isStructureReady()) {
          observer.disconnect();
          initDock();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", () => {
        observer.disconnect();
        initDock();
      }, { once: true });
    } else {
      document.addEventListener("DOMContentLoaded", initDock, { once: true });
    }
  }

  mountWhenPageStructureReady();
})();
