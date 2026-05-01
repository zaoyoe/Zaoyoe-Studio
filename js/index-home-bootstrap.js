(function () {
    'use strict';

    const SHOP_PREFETCH_SCHEMA_VERSION = '20260430_SHOP_GUIDANCE_BILINGUAL_1';
    const HOMEPAGE_DEFERRED_STYLE_GROUP = 'homepage-overlays';

    function activateHomepageDeferredOverlays() {
        if (typeof window.activateDeferredStyleGroup === 'function') {
            window.activateDeferredStyleGroup(HOMEPAGE_DEFERRED_STYLE_GROUP);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const checkAuth = setInterval(() => {
            const authBtn = document.getElementById('authBtn');
            if (!authBtn) {
                return;
            }

            clearInterval(checkAuth);
            const authContainer = document.getElementById('auth-container');
            if (authContainer) {
                authContainer.appendChild(authBtn);
            }
        }, 100);

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            if (
                target.closest('[data-home-open-guestbook="1"]')
                || target.closest('#guestbookComposerUploadBtn')
                || target.closest('#guestbookSubmitBtn')
                || target.closest('#removeImageBtn')
            ) {
                activateHomepageDeferredOverlays();
            }
        }, { passive: true });
    });

    const prefetched = {};
    const prefetching = {};

    const site = () => window.SiteConfig?.site || 'cn';

    async function prefetchGuestbook() {
        try {
            const sessionResult = await window.supabaseClient.auth.getSession();
            const userId = sessionResult.data?.session?.user?.id || null;
            const { data, error } = await window.supabaseClient
                .rpc('fn_load_guestbook', { p_site: site(), p_limit: 50, p_user_id: userId });

            if (!error && data) {
                sessionStorage.setItem('guestbook_prefetch', JSON.stringify({
                    data,
                    timestamp: Date.now(),
                    site: site()
                }));
                console.log('⚡ Guestbook prefetched');
            }
        } catch (error) {
            console.warn('Guestbook prefetch failed:', error.message);
        }
    }

    async function prefetchShop() {
        try {
            const currentSite = site();
            const [categoryResult, productResult] = await Promise.all([
                window.supabaseClient.from('shop_categories').select('*').order('sort_order'),
                window.supabaseClient
                    .from('shop_products')
                    .select('*')
                    .eq('is_active', true)
                    .order('display_order', { ascending: false })
            ]);
            const filteredProducts = window.SiteConfig?.filterProductsForCurrentSite
                ? window.SiteConfig.filterProductsForCurrentSite(productResult.data || [])
                : (productResult.data || []);

            if (filteredProducts.length > 0) {
                sessionStorage.setItem('shop_prefetch', JSON.stringify({
                    version: SHOP_PREFETCH_SCHEMA_VERSION,
                    categories: categoryResult.data || [],
                    products: filteredProducts,
                    timestamp: Date.now(),
                    site: currentSite
                }));
                console.log('⚡ Shop prefetched');
            } else {
                console.log('⚡ Shop prefetch skipped (no active products loaded)');
            }
        } catch (error) {
            console.warn('Shop prefetch failed:', error.message);
        }
    }

    async function prefetchPrompts() {
        try {
            const pageLink = document.createElement('link');
            pageLink.rel = 'prefetch';
            pageLink.href = '/prompts.html';
            document.head.appendChild(pageLink);

            const dataLink = document.createElement('link');
            dataLink.rel = 'prefetch';
            dataLink.href = '/prompts-data.js';
            document.head.appendChild(dataLink);

            console.log('⚡ Prompts page prefetched (browser cache)');
        } catch (error) {
            // ignore
        }
    }

    async function prefetchVerify() {
        try {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = '/verify.html';
            document.head.appendChild(link);
            console.log('⚡ Verify page prefetched (browser cache)');
        } catch (error) {
            // ignore
        }
    }

    function getTarget(element) {
        const link = element.closest('a[href], [data-home-open-guestbook]');
        if (!link) {
            return null;
        }

        if (link.hasAttribute('data-home-open-guestbook')) {
            return 'guestbook';
        }

        const href = link.getAttribute('href') || '';
        if (href.includes('guestbook.html')) return 'guestbook';
        if (href.includes('shop.html')) return 'shop';
        if (href.includes('prompts.html')) return 'prompts';
        if (href.includes('verify.html')) return 'verify';
        return null;
    }

    const handlers = {
        guestbook: prefetchGuestbook,
        shop: prefetchShop,
        prompts: prefetchPrompts,
        verify: prefetchVerify
    };

    async function handleHover(target) {
        if (prefetched[target] || prefetching[target]) {
            return;
        }

        prefetching[target] = true;
        try {
            await handlers[target]();
            prefetched[target] = true;
        } catch (error) {
            // ignore
        }
        prefetching[target] = false;
    }

    document.addEventListener('mouseover', (event) => {
        const target = getTarget(event.target);
        if (target) {
            handleHover(target);
        }
    });

    document.addEventListener('touchstart', (event) => {
        if (event.target.closest('a')) {
            return;
        }

        const target = getTarget(event.target);
        if (target) {
            handleHover(target);
        }
    }, { passive: true });

    window._prefetchGuestbook = () => handleHover('guestbook');
}());
