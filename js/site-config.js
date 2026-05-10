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
        cn: 'https://cdn.zaoyoe.com',
        intl: 'https://cdn.zaoyoe.xyz'
    };
    const ASSET_CDN_HOSTS = new Set([
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

    console.log(`🌐 [SiteConfig] Initialized: site=${SiteConfig.site}, currency=${SiteConfig.currency}`);
})();
