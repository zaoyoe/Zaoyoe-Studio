/**
 * prefetch-home.js - Homepage Data Prefetch
 * 
 * Loaded on sub-pages. When user hovers over the site logo (which links to homepage),
 * ensures homepage data is ready in sessionStorage for instant loading.
 * 
 * Flow:
 * 1. Homepage loads normally → saves aggregated data to sessionStorage('homepage_prefetch')
 * 2. User navigates to sub-page → sessionStorage persists
 * 3. User hovers logo on sub-page → this script checks freshness, re-fetches if stale
 * 4. User clicks logo → homepage reads sessionStorage → instant render, no network delay
 */
(function () {
    'use strict';

    // Only run on sub-pages (not homepage)
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') return;

    let prefetching = false;

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

    // Event delegation: trigger on logo hover (works for all sub-pages)
    document.addEventListener('mouseover', (e) => {
        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (logo) checkAndPrefetch();
    });
    document.addEventListener('touchstart', (e) => {
        const logo = e.target.closest('a.nav-logo, a.back-link');
        if (logo) checkAndPrefetch();
    }, { passive: true });
})();
