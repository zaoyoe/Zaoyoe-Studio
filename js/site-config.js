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
 *   SiteConfig.getPointsLabel() → '积分' | 'Credits'
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

    const SiteConfig = {
        /** 当前站点标识: 'cn' | 'intl' */
        site: site,

        /** 货币符号 */
        currency: site === 'intl' ? '$' : '¥',

        /** 货币代码 */
        currencyCode: site === 'intl' ? 'USD' : 'CNY',

        /** 获取商品价格字段名 */
        getPriceField: function () {
            return this.site === 'intl' ? 'price_points_intl' : 'price_points';
        },

        /** 获取积分显示名称 */
        getPointsLabel: function () {
            return this.site === 'intl' ? 'Credits' : '积分';
        },

        /** 是否为国内站 */
        isCN: function () {
            return this.site === 'cn';
        },

        /** 是否为国际站 */
        isIntl: function () {
            return this.site === 'intl';
        },

        /** 格式化价格显示 */
        formatPrice: function (amount) {
            if (amount === null || amount === undefined) return '--';
            return `${this.currency}${amount}`;
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
