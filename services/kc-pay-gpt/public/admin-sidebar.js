(() => {
    'use strict';

    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const mobile = window.matchMedia('(max-width: 900px)');
    const menuButton = document.querySelector('.topbar-mobile-toggle');
    sidebar.id ||= 'admin-sidebar';
    menuButton?.setAttribute('aria-controls', sidebar.id);

    function syncMobileDrawer() {
        const closed = mobile.matches && !sidebar.classList.contains('mobile-open');
        if (closed && sidebar.contains(document.activeElement)) menuButton?.focus();
        sidebar.inert = closed;
        if (closed) sidebar.setAttribute('aria-hidden', 'true');
        else sidebar.removeAttribute('aria-hidden');
        menuButton?.setAttribute('aria-expanded', String(mobile.matches && !closed));
    }

    mobile.addEventListener('change', syncMobileDrawer);
    new MutationObserver(syncMobileDrawer).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    syncMobileDrawer();

    sidebar.querySelectorAll('.nav-item').forEach(item => {
        const label = item.querySelector('span:not(.nav-pill-badge)')?.textContent.trim();
        if (label) {
            item.setAttribute('aria-label', label);
            item.title = label;
        }
        if (item.tagName !== 'DIV') return;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            item.click();
        });
    });

    // Keyboard focus also reveals the labels; a mouse click never pins the rail open.
    sidebar.addEventListener('focusin', event => {
        if (event.target.matches(':focus-visible')) sidebar.classList.add('is-keyboard-expanded');
    });
    sidebar.addEventListener('keydown', event => {
        if (event.key === 'Tab') sidebar.classList.add('is-keyboard-expanded');
    });
    sidebar.addEventListener('focusout', event => {
        if (!sidebar.contains(event.relatedTarget)) sidebar.classList.remove('is-keyboard-expanded');
    });
    sidebar.addEventListener('pointerdown', () => sidebar.classList.remove('is-keyboard-expanded'));
})();
