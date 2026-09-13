(function () {
    'use strict';

    var STORAGE_KEY = 'shop-layout-view';
    var MOBILE_MQ = '(max-width: 820px)';

    function isMobileLayout() {
        try {
            return Boolean(window.matchMedia && window.matchMedia(MOBILE_MQ).matches);
        } catch (_error) {
            return false;
        }
    }

    function readStoredView() {
        try {
            var stored = String(localStorage.getItem(STORAGE_KEY) || '').trim();
            return stored === 'list' || stored === 'grid' ? stored : 'list';
        } catch (_error) {
            return 'list';
        }
    }

    function applyShopLayoutBoot() {
        var mobile = isMobileLayout();
        var view = mobile ? 'list' : readStoredView();
        var layoutMode = mobile ? 'mobile' : 'desktop';
        var root = document.documentElement;
        var scriptEl = document.currentScript;
        var main = document.querySelector('.shop-main');

        if (!main && scriptEl && scriptEl.parentElement && scriptEl.parentElement.classList.contains('shop-main')) {
            main = scriptEl.parentElement;
        }

        root.dataset.shopLayout = view;
        root.dataset.layoutMode = layoutMode;
        if (document.body) document.body.dataset.layoutMode = layoutMode;
        if (!main) return false;

        main.classList.toggle('shop-layout--list', view === 'list');
        main.classList.toggle('shop-layout--grid', view === 'grid');
        main.dataset.shopLayout = view;
        return true;
    }

    if (applyShopLayoutBoot()) return;

    var observer = new MutationObserver(function () {
        if (applyShopLayoutBoot()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}());
