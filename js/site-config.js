/**
 * Site Config - 双站点识别模块
 * 
 * 通过域名自动识别当前站点 (cn/intl)
 * 本地开发支持 ?site=intl URL 参数切换
 * 
 * 使用方式：
 *   SiteConfig.site          → 'cn' | 'intl'
 *   SiteConfig.currency      → '¥' | '$'
 *   SiteConfig.currencyCode  → 'CNY' | 'USD'
 *   SiteConfig.getPriceField() → 'price_points' | 'price_points_intl'
 *   SiteConfig.getPointsLabel() → 跟随当前语言返回 '积分' | 'Points'
 *   SiteConfig.getAssetCdnOrigin() → 当前站点图片 CDN origin
 *   SiteConfig.isCN()        → true | false
 *   SiteConfig.isIntl()      → true | false
 */
(function () {
    'use strict';

    // 国际站域名列表（可扩展）
    const INTL_DOMAINS = [
        'zaoyoe.xyz',
        'www.zaoyoe.xyz'
    ];
    const ASSET_CDN_ORIGINS = {
        cn: 'https://cdn.fatherkey.com',
        intl: 'https://cdn.zaoyoe.xyz'
    };
    const GONGYI_ORIGINS = {
        cn: 'https://sub2api.fatherkey.com',
        intl: 'https://sub2api.zaoyoe.xyz'
    };
    const GONGYI_HOSTS = new Set([
        'sub2api.fatherkey.com',
        'sub2api.zaoyoe.com',
        'sub2api.zaoyoe.xyz',
        'gongyi.zaoyoe.com',
        'www.gongyi.zaoyoe.com'
    ]);
    const ASSET_CDN_HOSTS = new Set([
        'cdn.fatherkey.com',
        'cdn.zaoyoe.com',
        'cdn.zaoyoe.xyz'
    ]);
    const ASSET_CDN_PATH_PREFIXES = new Set([
        'affiliate-posters',
        'avatars',
        'chat',
        'comments',
        'guestbook',
        'homepage',
        'products',
        'prompts'
    ]);
    const LEGACY_SERVICE_WORKER_CACHE_RE = /^(?:prompts-gallery|static|images)-v/i;

    function isSameOriginUrl(rawUrl) {
        try {
            return new URL(rawUrl, window.location.origin).origin === window.location.origin;
        } catch (error) {
            return false;
        }
    }

    function retireLegacyServiceWorkerCaches() {
        if (!('caches' in window)) {
            return Promise.resolve();
        }

        return window.caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames
                    .filter(cacheName => LEGACY_SERVICE_WORKER_CACHE_RE.test(String(cacheName || '')))
                    .map(cacheName => window.caches.delete(cacheName))
            ))
            .catch(error => {
                console.warn('🌐 [SiteConfig] Legacy cache cleanup failed:', error);
            });
    }

    function retireLegacyServiceWorkers() {
        retireLegacyServiceWorkerCaches();

        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }

        navigator.serviceWorker.getRegistrations()
            .then(registrations => Promise.all(registrations.map(registration => {
                const scope = String(registration?.scope || '');
                const scriptURL = String(
                    registration?.active?.scriptURL
                    || registration?.waiting?.scriptURL
                    || registration?.installing?.scriptURL
                    || ''
                );

                if (!isSameOriginUrl(scope) || (scriptURL && !isSameOriginUrl(scriptURL))) {
                    return false;
                }

                return registration.unregister();
            })))
            .then(results => {
                if (results.some(Boolean)) {
                    return retireLegacyServiceWorkerCaches();
                }
                return null;
            })
            .catch(error => {
                console.warn('🌐 [SiteConfig] Service worker cleanup failed:', error);
            });
    }

    /**
     * 检测当前站点
     * 优先级：URL参数 > 域名
     */
    function detectSite() {
        // 1. 检查 URL 参数（本地开发调试用）
        const urlParams = new URLSearchParams(window.location.search);
        const siteParam = urlParams.get('site');
        if (siteParam === 'intl' || siteParam === 'cn') {
            console.log(`🌐 [SiteConfig] Site overridden by URL param: ${siteParam}`);
            return siteParam;
        }

        // 2. 检查域名
        const hostname = window.location.hostname;
        if (INTL_DOMAINS.includes(hostname)) {
            console.log(`🌐 [SiteConfig] International site detected: ${hostname}`);
            return 'intl';
        }

        // 3. 默认为国内站
        console.log(`🌐 [SiteConfig] Domestic site (default): ${hostname}`);
        return 'cn';
    }

    const site = detectSite();

    function getAssetCdnOriginForSite(siteValue) {
        return ASSET_CDN_ORIGINS[siteValue === 'intl' ? 'intl' : 'cn'];
    }

    function getGongyiOriginForSite(siteValue) {
        return GONGYI_ORIGINS[siteValue === 'intl' ? 'intl' : 'cn'];
    }

    function normalizeAssetUrlForSite(url, siteValue) {
        const source = String(url || '').trim();
        if (!source) return '';

        try {
            const parsed = new URL(source, window.location.origin);
            const parts = String(parsed.pathname || '').split('/').filter(Boolean);
            const isKnownAssetHost = ASSET_CDN_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.r2.dev');
            if (!isKnownAssetHost || !ASSET_CDN_PATH_PREFIXES.has(parts[0])) {
                return source;
            }

            const targetOrigin = new URL(getAssetCdnOriginForSite(siteValue));
            parsed.protocol = targetOrigin.protocol;
            parsed.host = targetOrigin.host;
            return parsed.toString();
        } catch (error) {
            return source;
        }
    }

    function normalizeGongyiUrlForSite(url, siteValue) {
        const source = String(url || '').trim();
        if (!source) return '';

        try {
            const parsed = new URL(source, window.location.origin);
            if (!GONGYI_HOSTS.has(parsed.hostname.toLowerCase())) {
                return source;
            }

            const origin = getGongyiOriginForSite(siteValue);
            const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
            return `${origin}${pathname}${parsed.search}${parsed.hash}`;
        } catch (error) {
            return source;
        }
    }

    function rewriteGongyiLinksForCurrentSite(root = document) {
        if (!root || typeof root.querySelectorAll !== 'function') {
            return;
        }

        root.querySelectorAll('a[href], area[href]').forEach(element => {
            const currentHref = element.getAttribute('href');
            const nextHref = normalizeGongyiUrlForSite(currentHref, site);
            if (nextHref && nextHref !== currentHref) {
                element.setAttribute('href', nextHref);
            }
        });
    }

    function startGongyiLinkRewriter() {
        rewriteGongyiLinksForCurrentSite(document);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => rewriteGongyiLinksForCurrentSite(document), { once: true });
        }

        if (typeof MutationObserver !== 'function' || !document.documentElement) {
            return;
        }

        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node?.nodeType !== 1) {
                        return;
                    }

                    if (typeof node.matches === 'function' && node.matches('a[href], area[href]')) {
                        const currentHref = node.getAttribute('href');
                        const nextHref = normalizeGongyiUrlForSite(currentHref, site);
                        if (nextHref && nextHref !== currentHref) {
                            node.setAttribute('href', nextHref);
                        }
                    }

                    rewriteGongyiLinksForCurrentSite(node);
                });
            });
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    const SiteConfig = {
        /** 当前站点标识: 'cn' | 'intl' */
        site: site,

        /** 货币符号 (统一为积分，充值时按汇率折算) */
        currency: '',

        /** 货币代码 */
        currencyCode: 'POINTS',

        /** 获取商品价格字段名 */
        getPriceField: function () {
            return this.site === 'intl' ? 'price_points_intl' : 'price_points';
        },

        /** 获取当前站点可售价格；未定价则返回 null */
        getProductPrice: function (product) {
            const field = this.getPriceField();
            const rawValue = product && Object.prototype.hasOwnProperty.call(product, field)
                ? product[field]
                : null;

            if (rawValue === null || rawValue === undefined || rawValue === '') {
                return null;
            }

            const numericValue = Number(rawValue);
            return Number.isFinite(numericValue) ? numericValue : null;
        },

        /** 当前商品是否在当前站点可售 */
        isProductAvailableForCurrentSite: function (product) {
            return this.getProductPrice(product) !== null;
        },

        /** 过滤出当前站点可售的商品 */
        filterProductsForCurrentSite: function (products) {
            if (!Array.isArray(products)) return [];
            return products.filter((product) => this.isProductAvailableForCurrentSite(product));
        },

        /** 获取积分显示名称（优先跟随当前页面语言，未就绪时再回退到站点） */
        getPointsLabel: function (options = {}) {
            const lowercaseEnglish = options?.lowercaseEnglish === true;
            const currentLanguage = String(
                window.i18n?.getCurrentLanguage?.()
                || document.documentElement?.lang
                || ''
            ).trim().toLowerCase();

            if (currentLanguage === 'zh') {
                return '积分';
            }

            if (currentLanguage === 'en') {
                return lowercaseEnglish ? 'points' : 'Points';
            }

            return this.site === 'intl'
                ? (lowercaseEnglish ? 'points' : 'Points')
                : '积分';
        },

        /** 获取当前站点的图片 CDN Origin。数据库仍使用 cn 作为 canonical，前台按站点改写。 */
        getAssetCdnOrigin: function () {
            return getAssetCdnOriginForSite(this.site);
        },

        /** 获取数据库 canonical 图片 CDN Origin */
        getCanonicalAssetCdnOrigin: function () {
            return ASSET_CDN_ORIGINS.cn;
        },

        /** 将 R2/CDN 图片 URL 改写到当前站点 CDN */
        normalizeAssetUrlForCurrentSite: function (url) {
            return normalizeAssetUrlForSite(url, this.site);
        },

        /** 将 R2/CDN 图片 URL 改写到数据库 canonical CDN */
        normalizeAssetUrlForCanonicalSite: function (url) {
            return normalizeAssetUrlForSite(url, 'cn');
        },

        /** 获取当前站点的 API 中转入口。 */
        getGongyiOrigin: function () {
            return getGongyiOriginForSite(this.site);
        },

        /** 将 API 中转 URL 改写到当前站点对应入口，避免跨站露出不同商城价格。 */
        normalizeGongyiUrlForCurrentSite: function (url) {
            return normalizeGongyiUrlForSite(url, this.site);
        },

        /** 是否为国内站 */
        isCN: function () {
            return this.site === 'cn';
        },

        /** 是否为国际站 */
        isIntl: function () {
            return this.site === 'intl';
        },

        /** 格式化价格显示 (统一显示积分数) */
        formatPrice: function (amount) {
            if (amount === null || amount === undefined) return '--';
            return `${amount}`;
        },

        /** 获取 localStorage 前缀（避免两站缓存冲突）*/
        getStoragePrefix: function () {
            return `zaoyoe_${this.site}_`;
        }
    };

    // 冻结配置，防止意外修改
    Object.freeze(SiteConfig);

    // 暴露到全局
    window.SiteConfig = SiteConfig;
    startGongyiLinkRewriter();
    retireLegacyServiceWorkers();

    console.log(`🌐 [SiteConfig] Initialized: site=${SiteConfig.site}, currency=${SiteConfig.currency}`);
})();
