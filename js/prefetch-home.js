/**
 * prefetch-home.js - Cross-page prefetch helpers
 *
 * Loaded on sub-pages.
 * 1. Hovering the site logo keeps homepage data warm.
 * 2. Hovering / touching guestbook entry points warms guestbook data too.
 */
(function () {
    'use strict';

    // Only run on sub-pages (not homepage)
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') return;

    let prefetching = false;
    let guestbookPrefetching = false;

    function getCurrentSite() {
        return window.SiteConfig?.site || 'cn';
    }

    function hasFreshPrefetch(storageKey, maxAgeMs = 300000) {
        try {
            const raw = sessionStorage.getItem(storageKey);
            if (!raw) return false;

            const data = JSON.parse(raw);
            return Boolean(data?.timestamp && (Date.now() - data.timestamp < maxAgeMs));
        } catch (e) {
            return false;
        }
    }

    function checkAndPrefetch() {
        if (prefetching) return;

        // Check if fresh data already exists
        try {
            const raw = sessionStorage.getItem('homepage_prefetch');
            if (raw) {
                const data = JSON.parse(raw);
                const age = Date.now() - data.timestamp;
                if (age < 300000) {
                    // Data is fresh (< 5 min), no need to prefetch
                    return;
                }
            }
        } catch (e) { /* ignore */ }

        // No fresh data — prefetch homepage config from Supabase
        prefetching = true;
        prefetchHomepageData().finally(() => { prefetching = false; });
    }

    async function prefetchGuestbookData() {
        if (guestbookPrefetching || hasFreshPrefetch('guestbook_prefetch')) return;
        guestbookPrefetching = true;

        try {
            if (!window.supabaseClient) return;

            const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
            const userId = session?.user?.id || null;
            const { data, error } = await window.supabaseClient
                .rpc('fn_load_guestbook', {
                    p_site: getCurrentSite(),
                    p_limit: 50,
                    p_user_id: userId
                });

            if (error) throw error;
            if (!data) return;

            sessionStorage.setItem('guestbook_prefetch', JSON.stringify({
                data,
                timestamp: Date.now(),
                site: getCurrentSite()
            }));

            console.log('⚡ Guestbook data prefetched on sub-page hover');
        } catch (e) {
            console.warn('Guestbook prefetch failed:', e.message);
        } finally {
            guestbookPrefetching = false;
        }
    }

    async function prefetchHomepageData() {
        try {
            if (!window.supabaseClient) return;

            // Use the same Cache utility if available
            const Cache = window.Cache;

            // Fetch homepage config
            const config = Cache
                ? await Cache.loadWithCache('homepage_config', async () => {
                    const { data, error } = await window.supabaseClient
                        .from('homepage_config')
                        .select('*')
                        .eq('is_visible', true)
                        .order('display_order', { ascending: true });
                    if (error) throw error;
                    const cfg = {};
                    data.forEach(item => { cfg[item.section] = item.content; });
                    return cfg;
                }, 30)
                : null;

            if (!config) return;

            // Fetch key data in parallel (lightweight versions)
            const [shopResult, guestbookResult] = await Promise.all([
                Cache ? Cache.loadWithCache('shop_products', async () => {
                    const { data } = await window.supabaseClient
                        .from('shop_products')
                        .select('*')
                        .eq('is_active', true)
                        .order('sort_order');
                    return data || [];
                }, 30) : Promise.resolve([]),
                Cache ? Cache.loadWithCache('guestbook_messages', async () => {
                    const currentSite = window.SiteConfig?.site || 'cn';
                    const { data } = await window.supabaseClient
                        .from('guestbook_messages')
                        .select('*, profiles:user_id(id, username, avatar_url)')
                        .eq('site', currentSite)
                        .order('created_at', { ascending: false })
                        .limit(5);
                    return data || [];
                }, 10) : Promise.resolve([])
            ]);

            // Build minimal hero data
            const heroConfig = config.hero || {};
            const currentLang = window.i18n?.getCurrentLanguage?.() || 'zh';
            const hero = {
                title: heroConfig[`title_${currentLang}`] || heroConfig.title || window.i18n?.t('home.hero.title') || '早鸟',
                subtitle: heroConfig[`subtitle_${currentLang}`] || heroConfig.subtitle || window.i18n?.t('home.hero.subtitle') || 'AI 驱动的创意资源平台',
                entries: heroConfig.entries || [
                    { icon: 'fa-palette', text: '提示词图库', link: '/prompts.html', color: '#a78bfa' },
                    { icon: 'fa-store', text: '资源商城', link: '/shop.html', color: '#34d399' },
                    { icon: 'fa-robot', text: '验证', link: '/verify.html', color: '#60a5fa' },
                    { icon: 'fa-comment-dots', text: '留言板', link: '#', color: '#f59e0b', action: 'openGuestbookModal', section: 'guestbook' }
                ]
            };

            // Build verify data
            const verifyConfig = config.verify || {};
            const verify = {
                title: verifyConfig.title || 'Gemini 验证',
                subtitle: verifyConfig.subtitle || '快速验证您的 API 密钥',
                features: verifyConfig.features || ['批量验证', '实时反馈', '多模型支持'],
                link: verifyConfig.link || '/verify.html',
                screenshot: verifyConfig.screenshot || '/assets/verify-screenshot.png'
            };

            // Load prompts from local data if available
            const prompts = window.promptsData ? window.promptsData.slice(0, 20) : [];

            // Build ticker data
            const ticker = {
                top: prompts.flatMap(p => p.ai_tags || []).slice(0, 20),
                bottom: shopResult.map(p => p.name).slice(0, 10),
                speed: config.ticker?.scroll_speed || 30
            };

            // Save to sessionStorage
            sessionStorage.setItem('homepage_prefetch', JSON.stringify({
                cachedData: {
                    hero,
                    prompts,
                    shop: shopResult,
                    verify,
                    guestbook: guestbookResult,
                    ticker,
                    shopCategories: []
                },
                config,
                timestamp: Date.now()
            }));

            console.log('⚡ Homepage data prefetched on logo hover');
        } catch (e) {
            console.warn('Homepage prefetch failed:', e.message);
        }
    }

    function shouldPrefetchGuestbook(target) {
        return Boolean(target.closest(
            'a[href="/guestbook.html"], a[href="guestbook.html"], a[href="#guestbook"], [onclick*="openGuestbookModal"]'
        ));
    }

    // Event delegation: logo hover keeps homepage warm, guestbook entry hover warms guestbook data
    document.addEventListener('mouseover', (e) => {
        if (shouldPrefetchGuestbook(e.target)) {
            prefetchGuestbookData();
            return;
        }

        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (logo) checkAndPrefetch();
    });

    document.addEventListener('touchstart', (e) => {
        if (shouldPrefetchGuestbook(e.target)) {
            prefetchGuestbookData();
            return;
        }

        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (logo) checkAndPrefetch();
    }, { passive: true });

    window._prefetchGuestbook = prefetchGuestbookData;
})();
