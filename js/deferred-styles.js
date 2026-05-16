(() => {
  const SELECTOR = 'link[data-deferred-style="1"]';
  let idleActivated = false;
  let allActivated = false;
  const activatedGroups = new Set();

  function activateDeferredStyles(mode = 'all') {
    if (mode === 'all' && allActivated) {
      return;
    }
    if (mode === 'idle' && idleActivated) {
      return;
    }

    document.querySelectorAll(SELECTOR).forEach((link) => {
      if (!(link instanceof HTMLLinkElement)) {
        return;
      }

      const activationMode = String(link.dataset.deferredStyleMode || 'idle').trim().toLowerCase();
      if (mode === 'idle' && activationMode === 'interaction') {
        return;
      }
      if (activationMode === 'manual') {
        return;
      }

      link.media = 'all';
      link.dataset.deferredStyleActive = '1';
    });

    if (mode === 'idle') {
      idleActivated = true;
    } else {
      idleActivated = true;
      allActivated = true;
    }
  }

  function activateDeferredStyleGroup(groupName) {
    const normalizedGroup = String(groupName || '').trim();
    if (!normalizedGroup || activatedGroups.has(normalizedGroup)) {
      return;
    }

    let activatedAny = false;
    document.querySelectorAll(SELECTOR).forEach((link) => {
      if (!(link instanceof HTMLLinkElement)) {
        return;
      }
      if (String(link.dataset.deferredStyleGroup || '').trim() !== normalizedGroup) {
        return;
      }

      link.media = 'all';
      link.dataset.deferredStyleActive = '1';
      activatedAny = true;
    });

    if (activatedAny) {
      activatedGroups.add(normalizedGroup);
    }
  }

  function scheduleDeferredStyles() {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => activateDeferredStyles('idle'), { timeout: 1200 });
    } else {
      window.setTimeout(() => activateDeferredStyles('idle'), 180);
    }
  }

  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((eventName) => {
    window.addEventListener(eventName, () => activateDeferredStyles('all'), { once: true, passive: true });
  });

  // 20260515_HOME_HARDREFRESH_STABILITY_1: activate idle-eligible deferred styles as soon as the DOM is parsed,
  // so the homepage stops flashing unstyled section text on hard refresh while we wait for `load`.
  function activateOnDomReady() {
    activateDeferredStyles('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateOnDomReady, { once: true });
  } else {
    activateOnDomReady();
  }

  if (document.readyState === 'complete') {
    scheduleDeferredStyles();
  } else {
    window.addEventListener('load', scheduleDeferredStyles, { once: true });
  }

  window.activateDeferredStyleGroup = activateDeferredStyleGroup;
})();
