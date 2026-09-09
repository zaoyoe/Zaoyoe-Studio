(function (global) {
    'use strict';

    const PAGE_REGISTRY = Object.freeze({
        home: Object.freeze({
            key: 'home',
            label: '首页',
            href: '/'
        }),
        shop: Object.freeze({
            key: 'shop',
            label: '商城',
            href: '/shop.html'
        }),
        prompts: Object.freeze({
            key: 'prompts',
            label: '提示词',
            href: '/prompts.html'
        }),
        verify: Object.freeze({
            key: 'verify',
            label: 'Gemini Pro',
            href: '/verify.html'
        }),
        guestbook: Object.freeze({
            key: 'guestbook',
            label: '留言板',
            href: '/guestbook.html'
        }),
        gongyi: Object.freeze({
            key: 'gongyi',
            label: 'API中转',
            href: 'gongyi'
        })
    });
    const GONGYI_ORIGINS = Object.freeze({
        cn: 'https://new.fatherkey.com',
        intl: 'https://sub2api.zaoyoe.xyz'
    });
    const DEFAULT_FOOTER_CONTACTS = Object.freeze({
        support_url: 'https://afdian.com/a/zaoyoe',
        telegram_url: 'https://t.me/zaoyoe',
        telegram_group_url: 'https://t.me/+I86eX5sPF1c0OTc1',
        contact_email: 'zaoyoe@gmail.com'
    });
    const SUPPORT_ACTIONS = new Set(['link', 'email', 'copy', 'chat', 'detail']);
    const SUPPORT_ICON_PRESETS = Object.freeze({
        none: { noIcon: true, label: '无' },
        telegram: { className: 'fab fa-telegram', label: 'Telegram' },
        wechat: { className: 'fab fa-weixin', label: 'WeChat' },
        qq: { className: 'fab fa-qq', label: 'QQ' },
        email: { className: 'fas fa-envelope', label: 'Email' },
        discord: { className: 'fab fa-discord', label: 'Discord' },
        whatsapp: { className: 'fab fa-whatsapp', label: 'WhatsApp' },
        x: { className: 'fab fa-x-twitter', fallbackClassName: 'fab fa-twitter', label: 'X' },
        github: { className: 'fab fa-github', label: 'GitHub' },
        instagram: { className: 'fab fa-instagram', label: 'Instagram' },
        tiktok: { className: 'fab fa-tiktok', label: 'TikTok' },
        youtube: { className: 'fab fa-youtube', label: 'YouTube' },
        bilibili: { text: 'B', label: 'Bilibili' },
        xiaohongshu: { text: 'RED', label: '小红书' },
        weibo: { className: 'fab fa-weibo', label: '微博' },
        support_bot: { className: 'fas fa-headset', label: '客服' },
        heart: { className: 'fas fa-heart', label: '赞助' },
        link: { className: 'fas fa-link', label: '链接' }
    });
    const SUPPORT_PLACEMENTS = new Set([
        'nav',
        'mobile_nav',
        'footer_brand',
        'footer_resources',
        'footer_about',
        'footer_bottom'
    ]);
    const DEFAULT_LAYOUTS = Object.freeze({
        cn: Object.freeze({
            root_page_key: 'home',
            logo_target_mode: 'follow_root',
            logo_page_key: 'home',
            footer_contacts: DEFAULT_FOOTER_CONTACTS
        }),
        intl: Object.freeze({
            root_page_key: 'shop',
            logo_target_mode: 'follow_root',
            logo_page_key: 'shop',
            footer_contacts: DEFAULT_FOOTER_CONTACTS
        })
    });
    const LOGO_TARGET_MODES = new Set(['follow_root', 'custom']);
    const CACHE_KEY = 'zaoyoe_site_layouts_v2_support_channels';
    let activeLayouts = null;
    let dynamicDomObserver = null;
    let dynamicDomApplyScheduled = false;
    let supportActionDelegatesBound = false;
    let supportFeedbackToastTimer = null;
    let pendingSupportPointerActivation = null;
    const supportFeedbackStateByKey = new Map();
    const supportFeedbackStateTimers = new Map();
    let supportDetailDialog = null;
    let supportDetailLastActiveElement = null;

    function normalizeSite(site) {
        return site === 'intl' ? 'intl' : 'cn';
    }

    function normalizePageKey(value, fallback = 'home') {
        const normalized = String(value || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(PAGE_REGISTRY, normalized)) {
            return normalized;
        }
        return Object.prototype.hasOwnProperty.call(PAGE_REGISTRY, fallback) ? fallback : 'home';
    }

    function normalizeContactUrl(value, fallback) {
        const source = String(value || '').trim();
        const fallbackValue = String(fallback || '').trim();
        if (!source) return fallbackValue;

        try {
            const parsed = new URL(source);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.toString();
            }
        } catch (_error) {
            return fallbackValue;
        }

        return fallbackValue;
    }

    function normalizeSupportActionUrl(value, fallback = '') {
        const source = String(value || '').trim();
        const fallbackValue = String(fallback || '').trim();
        if (!source) return fallbackValue;

        if (source.startsWith('/') || source.startsWith('#')) {
            return source;
        }

        try {
            const parsed = new URL(source);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.toString();
            }
        } catch (_error) {
            return fallbackValue;
        }

        return fallbackValue;
    }

    function normalizeSupportImageUrl(value, fallback = '') {
        const source = String(value || '').trim();
        const fallbackValue = String(fallback || '').trim();
        if (!source) return fallbackValue;

        if (source.startsWith('/')) {
            return source;
        }

        try {
            const parsed = new URL(source);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.toString();
            }
        } catch (_error) {
            return fallbackValue;
        }

        return fallbackValue;
    }

    function normalizeContactEmail(value, fallback) {
        const source = String(value || '').trim().slice(0, 320);
        const fallbackValue = String(fallback || '').trim().slice(0, 320);
        if (!source) return fallbackValue;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source) ? source : fallbackValue;
    }

    function normalizeFooterContacts(value, fallback = DEFAULT_FOOTER_CONTACTS) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
            ? fallback
            : DEFAULT_FOOTER_CONTACTS;

        return {
            support_url: normalizeContactUrl(source.support_url, defaults.support_url),
            telegram_url: normalizeContactUrl(source.telegram_url, defaults.telegram_url),
            telegram_group_url: normalizeContactUrl(source.telegram_group_url, defaults.telegram_group_url),
            contact_email: normalizeContactEmail(source.contact_email, defaults.contact_email)
        };
    }

    function buildDefaultSupportChannels(footerContacts = DEFAULT_FOOTER_CONTACTS) {
        const contacts = normalizeFooterContacts(footerContacts);
        return [
            {
                id: 'sponsor',
                name: '赞助支持',
                short_name: '赞助',
                description: '跳转到赞助支持页面',
                icon: 'heart',
                action: 'link',
                target_url: contacts.support_url,
                target_email: '',
                copy_text: '',
                detail_title: '',
                detail_body: '',
                detail_image_url: '',
                detail_copy_label: '',
                detail_link_label: '',
                enabled: true,
                order: 10,
                placements: ['footer_resources', 'footer_bottom']
            },
            {
                id: 'telegram',
                name: 'TG',
                short_name: 'TG',
                description: 'Telegram 联系入口',
                icon: 'telegram',
                action: 'link',
                target_url: contacts.telegram_url,
                target_email: '',
                copy_text: '',
                detail_title: '',
                detail_body: '',
                detail_image_url: '',
                detail_copy_label: '',
                detail_link_label: '',
                enabled: true,
                order: 20,
                placements: ['nav', 'mobile_nav', 'footer_brand']
            },
            {
                id: 'telegram_group',
                name: 'TG群组',
                short_name: 'TG群组',
                description: 'Telegram 社群入口',
                icon: 'telegram',
                action: 'link',
                target_url: contacts.telegram_group_url,
                target_email: '',
                copy_text: '',
                detail_title: '',
                detail_body: '',
                detail_image_url: '',
                detail_copy_label: '',
                detail_link_label: '',
                enabled: true,
                order: 30,
                placements: ['nav', 'mobile_nav', 'footer_about']
            },
            {
                id: 'email',
                name: '邮箱',
                short_name: '邮箱',
                description: '公开联系邮箱',
                icon: 'email',
                action: 'email',
                target_url: '',
                target_email: contacts.contact_email,
                copy_text: '',
                detail_title: '',
                detail_body: '',
                detail_image_url: '',
                detail_copy_label: '',
                detail_link_label: '',
                enabled: true,
                order: 40,
                placements: ['footer_about']
            }
        ];
    }

    function normalizeSupportPlacements(value, fallback = []) {
        const source = Array.isArray(value) ? value : fallback;
        return Array.from(new Set(source
            .map((entry) => String(entry || '').trim().toLowerCase())
            .filter((entry) => SUPPORT_PLACEMENTS.has(entry))));
    }

    function normalizeSupportChannel(value, index = 0, fallback = {}) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
            ? fallback
            : {};
        const action = SUPPORT_ACTIONS.has(String(source.action || '').trim().toLowerCase())
            ? String(source.action || '').trim().toLowerCase()
            : (SUPPORT_ACTIONS.has(defaults.action) ? defaults.action : 'link');
        const icon = Object.prototype.hasOwnProperty.call(SUPPORT_ICON_PRESETS, String(source.icon || '').trim().toLowerCase())
            ? String(source.icon || '').trim().toLowerCase()
            : (Object.prototype.hasOwnProperty.call(SUPPORT_ICON_PRESETS, defaults.icon) ? defaults.icon : 'link');
        const name = String(source.name || defaults.name || `站点入口 ${index + 1}`).trim().slice(0, 120);
        const shortName = String(source.short_name || source.shortName || defaults.short_name || defaults.shortName || name).trim().slice(0, 80);
        const rawId = String(source.id || defaults.id || `support-${index + 1}`).trim().toLowerCase();
        const hasTargetUrl = Object.prototype.hasOwnProperty.call(source, 'target_url')
            || Object.prototype.hasOwnProperty.call(source, 'url');
        const hasTargetEmail = Object.prototype.hasOwnProperty.call(source, 'target_email')
            || Object.prototype.hasOwnProperty.call(source, 'email');
        const hasCopyText = Object.prototype.hasOwnProperty.call(source, 'copy_text')
            || Object.prototype.hasOwnProperty.call(source, 'copyText');
        const hasDetailTitle = Object.prototype.hasOwnProperty.call(source, 'detail_title')
            || Object.prototype.hasOwnProperty.call(source, 'detailTitle');
        const hasDetailBody = Object.prototype.hasOwnProperty.call(source, 'detail_body')
            || Object.prototype.hasOwnProperty.call(source, 'detailBody')
            || Object.prototype.hasOwnProperty.call(source, 'content')
            || Object.prototype.hasOwnProperty.call(source, 'body');
        const hasDetailImageUrl = Object.prototype.hasOwnProperty.call(source, 'detail_image_url')
            || Object.prototype.hasOwnProperty.call(source, 'detailImageUrl')
            || Object.prototype.hasOwnProperty.call(source, 'qr_code_url')
            || Object.prototype.hasOwnProperty.call(source, 'qrCodeUrl');
        const hasDetailCopyLabel = Object.prototype.hasOwnProperty.call(source, 'detail_copy_label')
            || Object.prototype.hasOwnProperty.call(source, 'detailCopyLabel');
        const hasDetailLinkLabel = Object.prototype.hasOwnProperty.call(source, 'detail_link_label')
            || Object.prototype.hasOwnProperty.call(source, 'detailLinkLabel');

        return {
            id: rawId.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `support-${index + 1}`,
            name,
            short_name: shortName || name,
            description: String(source.description || defaults.description || '').trim().slice(0, 240),
            icon,
            action,
            target_url: normalizeSupportActionUrl(source.target_url || source.url, hasTargetUrl ? '' : (defaults.target_url || defaults.url || '')),
            target_email: normalizeContactEmail(source.target_email || source.email, hasTargetEmail ? '' : (defaults.target_email || defaults.email || '')),
            copy_text: String(source.copy_text || source.copyText || (hasCopyText ? '' : (defaults.copy_text || defaults.copyText || ''))).trim().slice(0, 800),
            detail_title: String(source.detail_title || source.detailTitle || (hasDetailTitle ? '' : (defaults.detail_title || defaults.detailTitle || ''))).trim().slice(0, 120),
            detail_body: String(source.detail_body || source.detailBody || source.content || source.body || (hasDetailBody ? '' : (defaults.detail_body || defaults.detailBody || defaults.content || defaults.body || ''))).trim().slice(0, 1200),
            detail_image_url: normalizeSupportImageUrl(source.detail_image_url || source.detailImageUrl || source.qr_code_url || source.qrCodeUrl, hasDetailImageUrl ? '' : (defaults.detail_image_url || defaults.detailImageUrl || defaults.qr_code_url || defaults.qrCodeUrl || '')),
            detail_copy_label: String(source.detail_copy_label || source.detailCopyLabel || (hasDetailCopyLabel ? '' : (defaults.detail_copy_label || defaults.detailCopyLabel || ''))).trim().slice(0, 80),
            detail_link_label: String(source.detail_link_label || source.detailLinkLabel || (hasDetailLinkLabel ? '' : (defaults.detail_link_label || defaults.detailLinkLabel || ''))).trim().slice(0, 80),
            enabled: source.enabled !== false,
            order: Number.isFinite(Number(source.order)) ? Math.max(0, Math.min(999, Math.round(Number(source.order)))) : (Number(defaults.order) || (index + 1) * 10),
            placements: normalizeSupportPlacements(source.placements, defaults.placements || [])
        };
    }

    function normalizeSupportChannels(value, footerContacts = DEFAULT_FOOTER_CONTACTS) {
        const defaults = buildDefaultSupportChannels(footerContacts);
        const source = Array.isArray(value) ? value : defaults;
        const seenIds = new Set();

        return source
            .map((entry, index) => normalizeSupportChannel(entry, index, defaults[index] || {}))
            .map((channel, index) => {
                let id = channel.id || `support-${index + 1}`;
                let suffix = 2;
                while (seenIds.has(id)) {
                    id = `${channel.id || 'support'}-${suffix}`;
                    suffix += 1;
                }
                seenIds.add(id);
                return { ...channel, id };
            })
            .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }

    function buildDefaultLayout(site) {
        const normalizedSite = normalizeSite(site);
        const defaults = DEFAULT_LAYOUTS[normalizedSite] || DEFAULT_LAYOUTS.cn;
        return {
            root_page_key: defaults.root_page_key,
            logo_target_mode: defaults.logo_target_mode,
            logo_page_key: defaults.logo_page_key,
            footer_contacts: normalizeFooterContacts(defaults.footer_contacts),
            support_channels: normalizeSupportChannels(null, defaults.footer_contacts)
        };
    }

    function normalizeLayoutRecord(value, site) {
        const defaults = buildDefaultLayout(site);
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        const rootPageKey = normalizePageKey(source.root_page_key, defaults.root_page_key);
        const logoTargetMode = LOGO_TARGET_MODES.has(String(source.logo_target_mode || '').trim().toLowerCase())
            ? String(source.logo_target_mode || '').trim().toLowerCase()
            : defaults.logo_target_mode;
        const logoPageKey = normalizePageKey(
            source.logo_page_key,
            logoTargetMode === 'custom' ? defaults.logo_page_key : rootPageKey
        );

        const footerContacts = normalizeFooterContacts(source.footer_contacts, defaults.footer_contacts);

        return {
            root_page_key: rootPageKey,
            logo_target_mode: logoTargetMode,
            logo_page_key: logoTargetMode === 'custom' ? logoPageKey : rootPageKey,
            footer_contacts: footerContacts,
            support_channels: normalizeSupportChannels(source.support_channels, footerContacts)
        };
    }

    function normalizeLayouts(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};

        return {
            cn: normalizeLayoutRecord(source.cn, 'cn'),
            intl: normalizeLayoutRecord(source.intl, 'intl')
        };
    }

    function getCurrentSite() {
        return normalizeSite(global.SiteConfig?.site);
    }

    function getPageHref(pageKey, site = getCurrentSite()) {
        const key = normalizePageKey(pageKey);
        if (key === 'gongyi') {
            return GONGYI_ORIGINS[normalizeSite(site)];
        }
        return PAGE_REGISTRY[key]?.href || '/';
    }

    function getRootHref(layout) {
        return getPageHref(layout?.root_page_key);
    }

    function getLogoHref(layout) {
        if ((layout?.logo_target_mode || 'follow_root') === 'custom') {
            return getPageHref(layout?.logo_page_key);
        }
        return getRootHref(layout);
    }

    function saveLayoutsToCache(layouts) {
        try {
            global.localStorage?.setItem(CACHE_KEY, JSON.stringify(layouts));
        } catch (_error) {
            // ignore cache errors
        }
    }

    function loadLayoutsFromCache() {
        try {
            const raw = global.localStorage?.getItem(CACHE_KEY);
            if (!raw) {
                return null;
            }
            return normalizeLayouts(JSON.parse(raw));
        } catch (_error) {
            return null;
        }
    }

    function applyLogoTargets(layout) {
        const href = getLogoHref(layout);
        document.querySelectorAll('a.nav-logo').forEach((anchor) => {
            if (anchor.getAttribute('href') !== href) {
                anchor.setAttribute('href', href);
            }
            if (anchor.dataset.siteLayoutResolvedHref !== href) {
                anchor.dataset.siteLayoutResolvedHref = href;
            }
        });
    }

    function setContactHref(element, href) {
        if (!element || element.tagName !== 'A' || !href) return;
        if (element.getAttribute('href') !== href) {
            element.setAttribute('href', href);
        }
        if (element.dataset.siteLayoutResolvedHref !== href) {
            element.dataset.siteLayoutResolvedHref = href;
        }
    }

    function applyFooterContacts(layout) {
        const contacts = normalizeFooterContacts(layout?.footer_contacts);
        document.querySelectorAll('[data-site-layout-contact]').forEach((element) => {
            const contactKey = String(element.dataset.siteLayoutContact || '').trim();
            if (contactKey === 'support') {
                setContactHref(element, contacts.support_url);
            } else if (contactKey === 'telegram') {
                setContactHref(element, contacts.telegram_url);
            } else if (contactKey === 'telegram_group') {
                setContactHref(element, contacts.telegram_group_url);
            } else if (contactKey === 'email') {
                element.textContent = contacts.contact_email;
                if (element.tagName === 'A') {
                    setContactHref(element, `mailto:${contacts.contact_email}`);
                }
                element.dataset.siteLayoutResolvedEmail = contacts.contact_email;
            }
        });
        document.querySelectorAll('a[href]').forEach((anchor) => {
            if (anchor.dataset.siteLayoutSupportAction) {
                return;
            }
            const href = String(anchor.getAttribute('href') || '').trim();
            if (href === DEFAULT_FOOTER_CONTACTS.support_url) {
                setContactHref(anchor, contacts.support_url);
            } else if (href === DEFAULT_FOOTER_CONTACTS.telegram_url) {
                setContactHref(anchor, contacts.telegram_url);
            } else if (href === DEFAULT_FOOTER_CONTACTS.telegram_group_url) {
                setContactHref(anchor, contacts.telegram_group_url);
            } else if (href === `mailto:${DEFAULT_FOOTER_CONTACTS.contact_email}`) {
                anchor.textContent = contacts.contact_email;
                setContactHref(anchor, `mailto:${contacts.contact_email}`);
                anchor.dataset.siteLayoutResolvedEmail = contacts.contact_email;
            }
        });
    }

    function getSupportIconPreset(icon) {
        return SUPPORT_ICON_PRESETS[String(icon || '').trim().toLowerCase()] || SUPPORT_ICON_PRESETS.link;
    }

    function createSupportIconElement(icon) {
        const preset = getSupportIconPreset(icon);
        if (preset.noIcon) {
            return null;
        }
        if (preset.text) {
            const badge = document.createElement('span');
            badge.className = 'site-support-icon site-support-icon--text';
            badge.textContent = preset.text;
            badge.setAttribute('aria-hidden', 'true');
            return badge;
        }
        const element = document.createElement('i');
        element.className = `site-support-icon ${preset.className || 'fas fa-link'}`;
        element.setAttribute('aria-hidden', 'true');
        return element;
    }

    function getSupportChannelLabel(channel, placement) {
        if (placement === 'nav' || placement === 'mobile_nav' || placement === 'footer_brand') {
            return channel.short_name || channel.name || '支持';
        }
        return channel.name || channel.short_name || '支持';
    }

    function resolveSupportChannelHref(channel) {
        if (channel.action === 'email' && channel.target_email) {
            return `mailto:${channel.target_email}`;
        }
        if (channel.action === 'copy' || channel.action === 'chat' || channel.action === 'detail') {
            return '#';
        }
        return channel.target_url || '#';
    }

    function isExternalHref(href) {
        if (!href || href.startsWith('/') || href.startsWith('#') || href.startsWith('mailto:')) {
            return false;
        }
        try {
            const parsed = new URL(href, global.location.href);
            return parsed.origin !== global.location.origin;
        } catch (_error) {
            return false;
        }
    }

    function createSupportChannelAnchor(channel, placement) {
        const anchor = document.createElement('a');
        const label = getSupportChannelLabel(channel, placement);
        const href = resolveSupportChannelHref(channel);
        anchor.href = href;
        anchor.dataset.siteLayoutSupportAction = channel.action || 'link';
        anchor.dataset.siteLayoutSupportChannel = channel.id || '';
        anchor.dataset.siteLayoutSupportPlacement = placement || '';
        anchor.dataset.siteLayoutSupportLabel = label;
        anchor.className = `site-layout-support-link site-layout-support-link--${placement || 'default'}`;
        if (channel.copy_text) {
            anchor.dataset.siteLayoutSupportCopy = channel.copy_text;
        }
        if (channel.target_url) {
            anchor.dataset.siteLayoutSupportUrl = channel.target_url;
        }
        if (channel.action === 'email' && channel.target_email) {
            anchor.dataset.siteLayoutSupportEmail = channel.target_email;
        }
        if (channel.detail_title) {
            anchor.dataset.siteLayoutSupportDetailTitle = channel.detail_title;
        }
        if (channel.detail_body) {
            anchor.dataset.siteLayoutSupportDetailBody = channel.detail_body;
        }
        if (channel.detail_image_url) {
            anchor.dataset.siteLayoutSupportDetailImageUrl = channel.detail_image_url;
        }
        if (channel.detail_copy_label) {
            anchor.dataset.siteLayoutSupportDetailCopyLabel = channel.detail_copy_label;
        }
        if (channel.detail_link_label) {
            anchor.dataset.siteLayoutSupportDetailLinkLabel = channel.detail_link_label;
        }
        anchor.dataset.siteLayoutSupportTitle = '';

        if (channel.action === 'copy' || channel.action === 'chat' || channel.action === 'detail') {
            anchor.setAttribute('role', 'button');
            anchor.setAttribute('aria-label', channel.description || label);
        }
        if (channel.action === 'detail') {
            anchor.setAttribute('aria-haspopup', 'dialog');
        }

        if (channel.action === 'link' && isExternalHref(href)) {
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
        }
        if (placement === 'mobile_nav') {
            anchor.classList.add('mobile-menu-link');
        }

        const icon = createSupportIconElement(channel.icon);
        if (icon) {
            anchor.appendChild(icon);
        }
        if (placement === 'footer_brand') {
            anchor.setAttribute('aria-label', label);
            restoreSupportLinkFeedback(anchor);
            return anchor;
        }

        const text = document.createElement('span');
        text.textContent = label;
        anchor.appendChild(text);
        restoreSupportLinkFeedback(anchor);
        return anchor;
    }

    function getEnabledSupportChannels(layout) {
        const contacts = normalizeFooterContacts(layout?.footer_contacts);
        return normalizeSupportChannels(layout?.support_channels, contacts)
            .filter((channel) => channel.enabled !== false);
    }

    function getSupportChannelsForPlacement(layout, placement) {
        return getEnabledSupportChannels(layout)
            .filter((channel) => Array.isArray(channel.placements) && channel.placements.includes(placement));
    }

    function uniqueElements(elements = []) {
        return Array.from(new Set(elements.filter(Boolean)));
    }

    function getSupportListElements(placement) {
        const selectors = [`[data-site-layout-support-list="${placement}"]`];
        if (placement === 'nav') selectors.push('#dropdown-support');
        if (placement === 'mobile_nav') selectors.push('#support-mobile');
        if (placement === 'footer_brand') selectors.push('.footer-social');
        return uniqueElements(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))));
    }

    function getSupportListRenderSignature(channels, placement) {
        return JSON.stringify((channels || []).map((channel) => ({
            id: channel.id || '',
            name: channel.name || '',
            short_name: channel.short_name || '',
            icon: channel.icon || '',
            action: channel.action || '',
            target_url: channel.target_url || '',
            target_email: channel.target_email || '',
            copy_text: channel.copy_text || '',
            detail_title: channel.detail_title || '',
            detail_body: channel.detail_body || '',
            detail_image_url: channel.detail_image_url || '',
            detail_copy_label: channel.detail_copy_label || '',
            detail_link_label: channel.detail_link_label || '',
            description: channel.description || '',
            placement: placement || ''
        })));
    }

    function pruneLegacySupportContactNodes(element) {
        if (!element?.querySelectorAll) return false;
        let pruned = false;
        element.querySelectorAll('[data-site-layout-contact]').forEach((node) => {
            node.remove();
            pruned = true;
        });
        return pruned;
    }

    function renderSupportListElement(element, channels, placement) {
        if (!element) return;
        const signature = getSupportListRenderSignature(channels, placement);
        const prunedLegacyContacts = pruneLegacySupportContactNodes(element);
        if (element.dataset.siteLayoutSupportRendered === '1' && element.dataset.siteLayoutSupportSignature === signature) {
            if (!prunedLegacyContacts) {
                element.hidden = channels.length === 0;
                return;
            }
        }
        element.innerHTML = '';
        channels.forEach((channel) => {
            const anchor = createSupportChannelAnchor(channel, placement);
            restoreSupportLinkFeedback(anchor);
            element.appendChild(anchor);
        });
        element.hidden = channels.length === 0;
        element.dataset.siteLayoutSupportRendered = '1';
        element.dataset.siteLayoutSupportSignature = signature;
    }

    function syncSupportTriggers(layout) {
        const navChannels = getSupportChannelsForPlacement(layout, 'nav');
        const mobileChannels = getSupportChannelsForPlacement(layout, 'mobile_nav');
        document.querySelectorAll('.nav-trigger[data-dropdown="support"]').forEach((trigger) => {
            trigger.hidden = navChannels.length === 0;
            trigger.setAttribute('aria-hidden', navChannels.length === 0 ? 'true' : 'false');
        });
        document.querySelectorAll('#support-mobile').forEach((submenu) => {
            const item = submenu.closest('.mobile-menu-item');
            if (item) {
                item.hidden = mobileChannels.length === 0;
                item.setAttribute('aria-hidden', mobileChannels.length === 0 ? 'true' : 'false');
            }
        });
    }

    function applySupportChannels(layout) {
        SUPPORT_PLACEMENTS.forEach((placement) => {
            const channels = getSupportChannelsForPlacement(layout, placement);
            getSupportListElements(placement).forEach((element) => {
                renderSupportListElement(element, channels, placement);
            });
        });
        syncSupportTriggers(layout);
        bindSupportActionDelegates();
    }

    function restoreSupportCopySelection(selection, ranges, activeElement) {
        try {
            if (selection) {
                selection.removeAllRanges();
                ranges.forEach((range) => selection.addRange(range));
            }
        } catch (_error) {
            // Restoring the user's prior selection is best-effort only.
        }
        try {
            activeElement?.focus?.({ preventScroll: true });
        } catch (_error) {
            try {
                activeElement?.focus?.();
            } catch (_focusError) {
                // ignore focus restoration errors
            }
        }
    }

    function createSupportCopyNode(value, type = 'textarea') {
        const node = type === 'content'
            ? document.createElement('span')
            : document.createElement('textarea');
        if (type === 'content') {
            node.textContent = value;
            node.setAttribute('contenteditable', 'true');
            node.style.whiteSpace = 'pre';
            node.style.userSelect = 'text';
            node.style.webkitUserSelect = 'text';
        } else {
            node.value = value;
            node.setAttribute('readonly', '');
        }
        node.setAttribute('aria-hidden', 'true');
        node.tabIndex = -1;
        node.style.position = 'fixed';
        node.style.left = '0';
        node.style.top = '0';
        node.style.width = '2px';
        node.style.height = '2px';
        node.style.padding = '0';
        node.style.border = '0';
        node.style.margin = '0';
        node.style.outline = '0';
        node.style.boxShadow = 'none';
        node.style.background = 'transparent';
        node.style.color = 'transparent';
        node.style.caretColor = 'transparent';
        node.style.opacity = '0.01';
        node.style.pointerEvents = 'none';
        node.style.fontSize = '16px';
        node.style.lineHeight = '1';
        node.style.zIndex = '2147483647';
        return node;
    }

    function tryExecCommandCopyFromNode(node, value) {
        document.body.appendChild(node);
        try {
            node.focus?.({ preventScroll: true });
        } catch (_error) {
            try {
                node.focus?.();
            } catch (_focusError) {
                // ignore focus errors and still try selection
            }
        }

        if (node.tagName === 'TEXTAREA') {
            node.select();
            node.setSelectionRange?.(0, value.length);
        } else {
            const selection = global.getSelection?.();
            const range = document.createRange();
            range.selectNodeContents(node);
            selection?.removeAllRanges();
            selection?.addRange(range);
        }

        return document.execCommand('copy') === true;
    }

    function tryLegacyCopySupportText(value) {
        const body = document.body;
        if (!body || typeof document.execCommand !== 'function') {
            throw new Error('复制失败');
        }

        const activeElement = document.activeElement;
        const selection = global.getSelection?.();
        const ranges = selection
            ? Array.from({ length: selection.rangeCount }, (_item, index) => selection.getRangeAt(index).cloneRange())
            : [];
        const nodes = [];

        try {
            const textarea = createSupportCopyNode(value, 'textarea');
            nodes.push(textarea);
            if (tryExecCommandCopyFromNode(textarea, value)) {
                return true;
            }

            textarea.remove();
            const contentNode = createSupportCopyNode(value, 'content');
            nodes.push(contentNode);
            if (tryExecCommandCopyFromNode(contentNode, value)) {
                return true;
            }
        } finally {
            nodes.forEach((node) => node.remove());
            restoreSupportCopySelection(selection, ranges, activeElement);
        }

        throw new Error('复制失败');
    }

    function legacyCopySupportText(value) {
        return new Promise((resolve, reject) => {
            try {
                tryLegacyCopySupportText(value);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    function shouldPreferLegacySupportCopy() {
        const ua = String(navigator.userAgent || '');
        const platform = String(navigator.platform || '');
        const isIOS = /iP(ad|hone|od)/.test(ua)
            || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
        const isTouchBrowser = Number(navigator.maxTouchPoints || 0) > 0
            && global.matchMedia?.('(pointer: coarse)')?.matches === true;
        return isIOS || isTouchBrowser;
    }

    function copySupportText(text) {
        const value = String(text || '').trim();
        if (!value) return Promise.reject(new Error('没有可复制的内容'));
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(value).catch((clipboardError) => {
                if (shouldPreferLegacySupportCopy()) {
                    return Promise.reject(clipboardError);
                }
                return legacyCopySupportText(value);
            });
        }
        if (shouldPreferLegacySupportCopy()) {
            return Promise.reject(new Error('复制失败'));
        }
        return legacyCopySupportText(value);
    }

    function isEnglishLocale() {
        const lang = String(
            global.i18n?.currentLanguage
            || global.i18n?.language
            || document.documentElement.getAttribute('lang')
            || global.SiteConfig?.locale
            || ''
        ).trim().toLowerCase();
        return lang.startsWith('en') || getCurrentSite() === 'intl';
    }

    function getSupportFeedbackText(type, value) {
        const english = isEnglishLocale();
        if (type === 'link') {
            return english ? 'Opening site entry' : '正在打开站点入口';
        }
        if (type === 'link-short') {
            return english ? 'Opening' : '正在打开';
        }
        if (type === 'chat') {
            return english ? 'Opening support chat' : '正在打开客服';
        }
        if (type === 'chat-short') {
            return english ? 'Opening' : '正在打开';
        }
        if (type === 'detail') {
            return english ? 'Entry details' : '入口详情';
        }
        if (type === 'detail-copy') {
            return english ? 'Copied contact' : '已复制联系方式';
        }
        if (type === 'email') {
            return english ? 'Opening email app' : '正在打开邮箱';
        }
        if (type === 'email-short') {
            return english ? 'Opening' : '正在打开';
        }
        if (type === 'copy-success-short') {
            return english ? 'Copied' : '已复制';
        }
        if (type === 'copy-pending') {
            return english ? 'Copying entry content' : '正在复制入口内容';
        }
        if (type === 'copy-pending-short') {
            return english ? 'Copying' : '处理中';
        }
        if (type === 'copy-error-short') {
            return english ? 'Copy failed' : '复制失败';
        }
        if (type === 'copy-error') {
            const suffix = value ? (english ? `: ${value}` : `：${value}`) : '';
            return english ? `Copy failed${suffix}` : `复制失败${suffix}`;
        }
        return english ? 'Copied entry content' : '已复制入口内容';
    }

    function getSupportLinkLabelElement(link) {
        if (!link) return null;
        return Array.from(link.children || []).find((child) => {
            return child.tagName === 'SPAN'
                && !child.classList.contains('site-support-icon')
                && !child.classList.contains('site-support-inline-feedback');
        }) || null;
    }

    function shouldUseOverlaySupportFeedback(link) {
        const placement = String(link?.dataset?.siteLayoutSupportPlacement || '').trim();
        return placement === 'footer_about'
            || placement === 'footer_resources'
            || placement === 'footer_bottom';
    }

    function getSupportLinkInlineFeedbackElement(link) {
        if (!link) return null;
        return Array.from(link.children || []).find((child) => {
            return child.classList?.contains('site-support-inline-feedback');
        }) || null;
    }

    function rememberSupportLinkOriginalLabel(link) {
        if (!link || Object.prototype.hasOwnProperty.call(link, '__siteLayoutSupportOriginalLabel')) {
            return;
        }
        link.__siteLayoutSupportOriginalAriaLabel = link.getAttribute('aria-label') || '';
        link.__siteLayoutSupportOriginalTitle = link.getAttribute('title') || '';
        const label = getSupportLinkLabelElement(link);
        if (label) {
            link.__siteLayoutSupportOriginalLabel = label.textContent || '';
            return;
        }
        link.__siteLayoutSupportOriginalLabel = '';
    }

    function setSupportLinkInlineFeedback(link, message) {
        const text = String(message || '').trim();
        if (!link || !text) return;
        rememberSupportLinkOriginalLabel(link);
        const label = getSupportLinkLabelElement(link);
        const useOverlayFeedback = shouldUseOverlaySupportFeedback(link);
        link.classList.add('site-layout-support-link--inline-feedback-active');
        if (label && !useOverlayFeedback) {
            label.textContent = text;
        } else {
            let feedback = getSupportLinkInlineFeedbackElement(link);
            if (!feedback) {
                feedback = document.createElement('span');
                feedback.className = 'site-support-inline-feedback';
                link.appendChild(feedback);
            }
            feedback.textContent = text;
        }
        link.setAttribute('aria-label', text);
        link.removeAttribute('title');
    }

    function clearSupportLinkInlineFeedback(link) {
        if (!link) return;
        getSupportLinkInlineFeedbackElement(link)?.remove();
        link.classList.remove('site-layout-support-link--inline-feedback-active');
    }

    function restoreSupportLinkOriginalLabel(link) {
        clearSupportLinkInlineFeedback(link);
        if (!link || !Object.prototype.hasOwnProperty.call(link, '__siteLayoutSupportOriginalLabel')) {
            return;
        }
        const label = getSupportLinkLabelElement(link);
        const fallbackLabel = link.dataset.siteLayoutSupportLabel || '';
        if (label) {
            label.textContent = link.__siteLayoutSupportOriginalLabel || '';
            if (link.__siteLayoutSupportOriginalAriaLabel) {
                link.setAttribute('aria-label', link.__siteLayoutSupportOriginalAriaLabel);
            } else {
                link.removeAttribute('aria-label');
            }
            if (link.__siteLayoutSupportOriginalTitle) {
                link.title = link.__siteLayoutSupportOriginalTitle;
            } else {
                link.removeAttribute('title');
            }
        } else {
            if (link.__siteLayoutSupportOriginalAriaLabel || fallbackLabel) {
                link.setAttribute('aria-label', link.__siteLayoutSupportOriginalAriaLabel || fallbackLabel);
            } else {
                link.removeAttribute('aria-label');
            }
            if (link.__siteLayoutSupportOriginalTitle) {
                link.title = link.__siteLayoutSupportOriginalTitle;
            } else {
                link.removeAttribute('title');
            }
        }
        delete link.__siteLayoutSupportOriginalLabel;
        delete link.__siteLayoutSupportOriginalAriaLabel;
        delete link.__siteLayoutSupportOriginalTitle;
    }

    function ensureSupportFeedbackToast() {
        let toast = document.getElementById('siteLayoutSupportFeedbackToast');
        if (toast) return toast;
        if (!document.body) return null;
        toast = document.createElement('div');
        toast.id = 'siteLayoutSupportFeedbackToast';
        toast.className = 'site-layout-support-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.setAttribute('aria-atomic', 'true');
        document.body.appendChild(toast);
        return toast;
    }

    function showSupportFeedback(message, variant = 'success') {
        const text = String(message || '').trim();
        if (!text) return;
        const toast = ensureSupportFeedbackToast();
        if (!toast) {
            console.info(`[SiteLayoutSupport:${variant}]`, text);
            return;
        }
        toast.textContent = text;
        toast.dataset.variant = variant;
        toast.classList.add('is-visible');
        if (supportFeedbackToastTimer) {
            global.clearTimeout(supportFeedbackToastTimer);
        }
        supportFeedbackToastTimer = global.setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 2200);
    }

    function getSupportLinkFeedbackTargets(link) {
        if (!link) return [];
        const channel = String(link.dataset.siteLayoutSupportChannel || '').trim();
        const placement = String(link.dataset.siteLayoutSupportPlacement || '').trim();
        const selector = channel
            ? `[data-site-layout-support-channel="${channel}"]${placement ? `[data-site-layout-support-placement="${placement}"]` : ''}`
            : '';
        return uniqueElements([
            link,
            ...(selector ? Array.from(document.querySelectorAll(selector)) : [])
        ]);
    }

    function getSupportFeedbackKey(channel, placement) {
        const normalizedChannel = String(channel || '').trim();
        const normalizedPlacement = String(placement || '').trim();
        if (!normalizedChannel || !normalizedPlacement) return '';
        return `${normalizedChannel}::${normalizedPlacement}`;
    }

    function getSupportFeedbackKeyForLink(link) {
        return getSupportFeedbackKey(
            link?.dataset?.siteLayoutSupportChannel,
            link?.dataset?.siteLayoutSupportPlacement
        );
    }

    function applySupportLinkFeedbackState(target, state, message) {
        if (!target) return;
        if (target.__siteLayoutSupportFeedbackTimer) {
            global.clearTimeout(target.__siteLayoutSupportFeedbackTimer);
            target.__siteLayoutSupportFeedbackTimer = null;
            restoreSupportLinkOriginalLabel(target);
        }
        target.classList.remove('is-copied', 'is-copy-failed', 'is-opening');
        if (state === 'copied') {
            target.classList.add('is-copied');
        } else if (state === 'error') {
            target.classList.add('is-copy-failed');
        } else if (state === 'opening') {
            target.classList.add('is-opening');
        }
        target.dataset.siteLayoutSupportState = state;
        delete target.dataset.siteLayoutSupportFeedback;
        setSupportLinkInlineFeedback(target, message);
        target.__siteLayoutSupportFeedbackTimer = global.setTimeout(() => {
            target.classList.remove('is-copied', 'is-copy-failed', 'is-opening');
            delete target.dataset.siteLayoutSupportState;
            delete target.dataset.siteLayoutSupportFeedback;
            restoreSupportLinkOriginalLabel(target);
            target.__siteLayoutSupportFeedbackTimer = null;
        }, 2200);
    }

    function clearSupportFeedbackStateByKey(key) {
        if (!key) return;
        supportFeedbackStateByKey.delete(key);
        if (supportFeedbackStateTimers.has(key)) {
            global.clearTimeout(supportFeedbackStateTimers.get(key));
            supportFeedbackStateTimers.delete(key);
        }
        const [channel, placement] = key.split('::');
        if (!channel || !placement) return;
        document.querySelectorAll(`[data-site-layout-support-channel="${channel}"][data-site-layout-support-placement="${placement}"]`).forEach((target) => {
            if (target.__siteLayoutSupportFeedbackTimer) {
                global.clearTimeout(target.__siteLayoutSupportFeedbackTimer);
                target.__siteLayoutSupportFeedbackTimer = null;
            }
            target.classList.remove('is-copied', 'is-copy-failed', 'is-opening');
            delete target.dataset.siteLayoutSupportState;
            delete target.dataset.siteLayoutSupportFeedback;
            restoreSupportLinkOriginalLabel(target);
        });
    }

    function rememberSupportLinkFeedback(link, state, message) {
        const key = getSupportFeedbackKeyForLink(link);
        if (!key) return;
        supportFeedbackStateByKey.set(key, {
            state,
            message: String(message || '').trim()
        });
        if (supportFeedbackStateTimers.has(key)) {
            global.clearTimeout(supportFeedbackStateTimers.get(key));
        }
        supportFeedbackStateTimers.set(key, global.setTimeout(() => {
            clearSupportFeedbackStateByKey(key);
        }, 2200));
    }

    function restoreSupportLinkFeedback(link) {
        const key = getSupportFeedbackKeyForLink(link);
        const feedback = key ? supportFeedbackStateByKey.get(key) : null;
        if (!feedback) return;
        applySupportLinkFeedbackState(link, feedback.state, feedback.message);
    }

    function setSupportLinkFeedback(link, state, message) {
        if (!link) return;
        rememberSupportLinkFeedback(link, state, message);
        const apply = () => {
            getSupportLinkFeedbackTargets(link).forEach((target) => {
                applySupportLinkFeedbackState(target, state, message);
            });
        };
        apply();
        global.setTimeout(apply, 50);
    }

    function getSupportDetailDefaultText(type) {
        const english = isEnglishLocale();
        if (type === 'eyebrow') return english ? 'Entry' : '站点入口';
        if (type === 'copy') return english ? 'Copy' : '复制';
        if (type === 'copied') return english ? 'Copied' : '已复制';
        if (type === 'open-link') return english ? 'Open link' : '打开链接';
        return '';
    }

    function setSupportDetailText(element, value) {
        if (!element) return;
        const text = String(value || '').trim();
        element.textContent = text;
        element.hidden = !text;
    }

    function closeSupportDetailDialog() {
        const dialog = supportDetailDialog;
        if (!dialog || dialog.hidden) return;
        dialog.hidden = true;
        dialog.classList.remove('is-visible');
        document.body?.classList?.remove('site-layout-support-detail-open');
        try {
            supportDetailLastActiveElement?.focus?.();
        } catch (_error) {
            // ignore focus restoration errors
        }
        supportDetailLastActiveElement = null;
    }

    function ensureSupportDetailDialog() {
        if (supportDetailDialog?.isConnected) {
            return supportDetailDialog;
        }
        if (!document.body) return null;

        const dialog = document.createElement('div');
        dialog.id = 'siteLayoutSupportDetailDialog';
        dialog.className = 'site-layout-support-detail-dialog';
        dialog.hidden = true;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'siteLayoutSupportDetailTitle');
        dialog.innerHTML = `
            <div class="site-layout-support-detail-dialog__backdrop" data-site-layout-support-detail-close></div>
            <section class="site-layout-support-detail-dialog__panel" tabindex="-1">
                <button type="button" class="site-layout-support-detail-dialog__close" data-site-layout-support-detail-close aria-label="关闭">×</button>
                <div class="site-layout-support-detail-dialog__head">
                    <span class="site-layout-support-detail-dialog__eyebrow" data-site-layout-support-detail-eyebrow></span>
                    <h2 id="siteLayoutSupportDetailTitle" data-site-layout-support-detail-title></h2>
                    <p data-site-layout-support-detail-description></p>
                </div>
                <div class="site-layout-support-detail-dialog__image" data-site-layout-support-detail-image-wrap hidden>
                    <img alt="" data-site-layout-support-detail-image>
                </div>
                <p class="site-layout-support-detail-dialog__body" data-site-layout-support-detail-body></p>
                <div class="site-layout-support-detail-dialog__copy" data-site-layout-support-detail-copy-wrap hidden>
                    <code data-site-layout-support-detail-copy-value></code>
                    <button type="button" data-site-layout-support-detail-copy></button>
                </div>
                <div class="site-layout-support-detail-dialog__actions" data-site-layout-support-detail-actions hidden>
                    <a class="site-layout-support-detail-dialog__primary" data-site-layout-support-detail-link></a>
                </div>
            </section>
        `;

        dialog.querySelectorAll('[data-site-layout-support-detail-close]').forEach((button) => {
            button.addEventListener('click', closeSupportDetailDialog);
        });
        dialog.querySelector('[data-site-layout-support-detail-copy]')?.addEventListener('click', (event) => {
            const button = event.currentTarget;
            const copyValue = dialog.dataset.siteLayoutSupportDetailCopy || '';
            const defaultLabel = dialog.dataset.siteLayoutSupportDetailCopyLabel || getSupportDetailDefaultText('copy');
            copySupportText(copyValue)
                .then(() => {
                    button.textContent = getSupportDetailDefaultText('copied');
                    showSupportFeedback(getSupportFeedbackText('detail-copy'), 'success');
                    if (dialog.__siteLayoutSupportDetailCopyTimer) {
                        global.clearTimeout(dialog.__siteLayoutSupportDetailCopyTimer);
                    }
                    dialog.__siteLayoutSupportDetailCopyTimer = global.setTimeout(() => {
                        button.textContent = defaultLabel;
                    }, 1800);
                })
                .catch((error) => {
                    showSupportFeedback(error?.message || getSupportFeedbackText('copy-error', copyValue), 'error');
                });
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && supportDetailDialog && !supportDetailDialog.hidden) {
                closeSupportDetailDialog();
            }
        });

        document.body.appendChild(dialog);
        supportDetailDialog = dialog;
        return dialog;
    }

    function getSupportDetailPayload(link) {
        const label = String(link?.dataset?.siteLayoutSupportLabel || link?.textContent || '').trim();
        const detailTitle = String(link?.dataset?.siteLayoutSupportDetailTitle || '').trim();
        const description = String(link?.getAttribute?.('aria-label') || '').trim();
        const targetUrl = normalizeSupportActionUrl(link?.dataset?.siteLayoutSupportUrl || '', '');
        return {
            label,
            title: detailTitle || label || getSupportFeedbackText('detail'),
            description: description && description !== label ? description : '',
            body: String(link?.dataset?.siteLayoutSupportDetailBody || '').trim(),
            imageUrl: normalizeSupportImageUrl(link?.dataset?.siteLayoutSupportDetailImageUrl || '', ''),
            copyText: String(link?.dataset?.siteLayoutSupportCopy || '').trim(),
            copyLabel: String(link?.dataset?.siteLayoutSupportDetailCopyLabel || '').trim(),
            linkUrl: targetUrl && targetUrl !== '#' ? targetUrl : '',
            linkLabel: String(link?.dataset?.siteLayoutSupportDetailLinkLabel || '').trim()
        };
    }

    function renderSupportDetailDialog(dialog, payload) {
        if (!dialog) return;
        const panel = dialog.querySelector('.site-layout-support-detail-dialog__panel');
        setSupportDetailText(dialog.querySelector('[data-site-layout-support-detail-eyebrow]'), getSupportDetailDefaultText('eyebrow'));
        setSupportDetailText(dialog.querySelector('[data-site-layout-support-detail-title]'), payload.title);
        setSupportDetailText(dialog.querySelector('[data-site-layout-support-detail-description]'), payload.description);
        setSupportDetailText(dialog.querySelector('[data-site-layout-support-detail-body]'), payload.body);

        const imageWrap = dialog.querySelector('[data-site-layout-support-detail-image-wrap]');
        const image = dialog.querySelector('[data-site-layout-support-detail-image]');
        if (imageWrap && image) {
            if (payload.imageUrl) {
                image.src = payload.imageUrl;
                image.alt = payload.title || payload.label || '';
                imageWrap.hidden = false;
            } else {
                image.removeAttribute('src');
                image.alt = '';
                imageWrap.hidden = true;
            }
        }

        const copyWrap = dialog.querySelector('[data-site-layout-support-detail-copy-wrap]');
        const copyValue = dialog.querySelector('[data-site-layout-support-detail-copy-value]');
        const copyButton = dialog.querySelector('[data-site-layout-support-detail-copy]');
        if (copyWrap && copyValue && copyButton) {
            if (payload.copyText) {
                dialog.dataset.siteLayoutSupportDetailCopy = payload.copyText;
                dialog.dataset.siteLayoutSupportDetailCopyLabel = payload.copyLabel || getSupportDetailDefaultText('copy');
                copyValue.textContent = payload.copyText;
                copyButton.textContent = dialog.dataset.siteLayoutSupportDetailCopyLabel;
                copyWrap.hidden = false;
            } else {
                delete dialog.dataset.siteLayoutSupportDetailCopy;
                delete dialog.dataset.siteLayoutSupportDetailCopyLabel;
                copyValue.textContent = '';
                copyButton.textContent = getSupportDetailDefaultText('copy');
                copyWrap.hidden = true;
            }
        }

        const actions = dialog.querySelector('[data-site-layout-support-detail-actions]');
        const link = dialog.querySelector('[data-site-layout-support-detail-link]');
        if (actions && link) {
            if (payload.linkUrl) {
                link.href = payload.linkUrl;
                link.textContent = payload.linkLabel || getSupportDetailDefaultText('open-link');
                if (isExternalHref(payload.linkUrl)) {
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                } else {
                    link.removeAttribute('target');
                    link.removeAttribute('rel');
                }
                actions.hidden = false;
            } else {
                link.removeAttribute('href');
                link.textContent = '';
                actions.hidden = true;
            }
        }

        panel?.focus?.({ preventScroll: true });
    }

    function openSupportDetailDialog(link) {
        try {
            global.closeActiveMobileMenu?.();
        } catch (_error) {
            // ignore menu close errors
        }
        const dialog = ensureSupportDetailDialog();
        if (!dialog) return false;
        supportDetailLastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : link;
        renderSupportDetailDialog(dialog, getSupportDetailPayload(link));
        dialog.hidden = false;
        document.body?.classList?.add('site-layout-support-detail-open');
        global.requestAnimationFrame?.(() => dialog.classList.add('is-visible'));
        if (typeof global.requestAnimationFrame !== 'function') {
            dialog.classList.add('is-visible');
        }
        return true;
    }

    function openSupportChat() {
        try {
            global.closeActiveMobileMenu?.();
        } catch (_error) {
            // ignore menu close errors
        }
        if (typeof global.ZaoyoeChatWidgetBootstrap?.open === 'function') {
            return global.ZaoyoeChatWidgetBootstrap.open();
        }
        if (typeof global.chatWidget?.openChat === 'function') {
            return global.chatWidget.openChat();
        }
        global.dispatchEvent?.(new CustomEvent('zaoyoe:chat-widget-runtime-pending-open', {
            detail: { source: 'site-layout-support-channel' }
        }));
        return true;
    }

    function getSupportActionTarget(event) {
        const target = event?.target?.nodeType === 1
            ? event.target
            : event?.target?.parentElement;
        return target?.closest?.('[data-site-layout-support-action]') || null;
    }

    function getSupportLinkHref(link) {
        const href = String(link?.getAttribute?.('href') || '').trim();
        if (!href || href === '#') return '';
        try {
            return new URL(href, global.location.href).toString();
        } catch (_error) {
            return href;
        }
    }

    function activateSupportHref(link, href, event) {
        if (!href) return false;
        event?.preventDefault?.();
        const target = String(link?.getAttribute?.('target') || '').trim();
        if (target && target !== '_self') {
            const openedWindow = global.open?.(href, target, 'noopener,noreferrer');
            if (openedWindow) {
                try {
                    openedWindow.opener = null;
                } catch (_error) {
                    // ignore cross-browser opener protection errors
                }
            }
            return true;
        }
        try {
            global.location.assign(href);
        } catch (_error) {
            global.location.href = href;
        }
        return true;
    }

    function openSupportLink(link, event, options = {}) {
        const href = getSupportLinkHref(link);
        if (!href) {
            event.preventDefault();
            const message = getSupportFeedbackText('copy-error', '');
            setSupportLinkFeedback(link, 'error', getSupportFeedbackText('copy-error-short', ''));
            showSupportFeedback(message, 'error');
            return;
        }

        const message = getSupportFeedbackText('link');
        setSupportLinkFeedback(link, 'opening', getSupportFeedbackText('link-short'));
        showSupportFeedback(message, 'info');
        if (options.manualNavigation === true) {
            activateSupportHref(link, href, event);
        }
    }

    function shouldHandleSupportActionEarly(action) {
        return action === 'chat' || action === 'detail';
    }

    function wasSupportActionHandledRecently(link) {
        const handledAt = Number(link?.__siteLayoutSupportActionHandledAt || 0);
        return handledAt > 0 && (Date.now() - handledAt) < 900;
    }

    function markSupportActionHandled(link, eventType) {
        if (!link) return;
        link.__siteLayoutSupportActionHandledAt = Date.now();
        link.__siteLayoutSupportActionHandledEvent = eventType || '';
    }

    function shouldHandleSupportActionOnPointerUp(_action) {
        // Let ordinary links and mailto anchors keep native click navigation as a fallback.
        return false;
    }

    function rememberPendingSupportPointerActivation(event, link, action) {
        if (!link || !shouldHandleSupportActionOnPointerUp(action)) {
            pendingSupportPointerActivation = null;
            return;
        }
        pendingSupportPointerActivation = {
            action,
            link,
            pointerId: Number(event?.pointerId || 0)
        };
    }

    function clearPendingSupportPointerActivation() {
        pendingSupportPointerActivation = null;
    }

    function matchesPendingSupportPointerActivation(event, link, action) {
        const pending = pendingSupportPointerActivation;
        if (!pending || !link || pending.link !== link || pending.action !== action) {
            return false;
        }
        const pointerId = Number(event?.pointerId || 0);
        return !pending.pointerId || !pointerId || pending.pointerId === pointerId;
    }

    function handleSupportActionEvent(event, options = {}) {
        const link = getSupportActionTarget(event);
        if (!link) return;
        const action = String(link.dataset.siteLayoutSupportAction || 'link').trim().toLowerCase();
        const isEarlyEvent = options.early === true;

        if (isEarlyEvent && !shouldHandleSupportActionEarly(action)) {
            return;
        }

        if (!isEarlyEvent && wasSupportActionHandledRecently(link)) {
            event.preventDefault();
            return;
        }

        if (shouldHandleSupportActionEarly(action) || options.manualNavigation === true) {
            markSupportActionHandled(link, event?.type || '');
        }

        if (action === 'chat') {
            event.preventDefault();
            openSupportChat();
            setSupportLinkFeedback(link, 'opening', getSupportFeedbackText('chat-short'));
            showSupportFeedback(getSupportFeedbackText('chat'), 'info');
            return;
        }
        if (action === 'detail') {
            event.preventDefault();
            openSupportDetailDialog(link);
            return;
        }
        if (action === 'email') {
            setSupportLinkFeedback(link, 'opening', getSupportFeedbackText('email-short'));
            showSupportFeedback(getSupportFeedbackText('email'), 'info');
            if (options.manualNavigation === true) {
                activateSupportHref(link, getSupportLinkHref(link), event);
            }
            return;
        }
        if (action === 'copy') {
            event.preventDefault();
            const copyValue = link.dataset.siteLayoutSupportCopy || link.textContent || '';
            copySupportText(copyValue)
                .then(() => {
                    setSupportLinkFeedback(link, 'copied', getSupportFeedbackText('copy-success-short', copyValue));
                })
                .catch((error) => {
                    setSupportLinkFeedback(link, 'error', getSupportFeedbackText('copy-error-short', copyValue));
                    if (error?.message === '没有可复制的内容') {
                        showSupportFeedback(error.message, 'error');
                    }
                });
            return;
        }
        openSupportLink(link, event, {
            manualNavigation: options.manualNavigation === true
        });
    }

    function handleSupportPointerDownEvent(event) {
        const link = getSupportActionTarget(event);
        if (!link) return;
        const action = String(link.dataset.siteLayoutSupportAction || 'link').trim().toLowerCase();
        if (shouldHandleSupportActionEarly(action)) {
            handleSupportActionEvent(event, { early: true });
            return;
        }
        rememberPendingSupportPointerActivation(event, link, action);
    }

    function handleSupportPointerUpEvent(event) {
        const link = getSupportActionTarget(event);
        if (!link) {
            clearPendingSupportPointerActivation();
            return;
        }
        const action = String(link.dataset.siteLayoutSupportAction || 'link').trim().toLowerCase();
        const pending = pendingSupportPointerActivation;
        const shouldActivate = shouldHandleSupportActionOnPointerUp(action)
            && (!pending || matchesPendingSupportPointerActivation(event, link, action));
        clearPendingSupportPointerActivation();
        if (!shouldActivate) return;
        handleSupportActionEvent(event, { manualNavigation: true });
    }

    function bindSupportActionDelegates() {
        if (supportActionDelegatesBound) return;
        supportActionDelegatesBound = true;
        document.addEventListener('pointerdown', handleSupportPointerDownEvent, true);
        document.addEventListener('pointerup', handleSupportPointerUpEvent, true);
        document.addEventListener('pointercancel', clearPendingSupportPointerActivation, true);
        document.addEventListener('click', (event) => handleSupportActionEvent(event), true);
    }

    function hasFallbackContactHref(node) {
        if (!node || node.nodeType !== 1) return false;
        const anchors = node.matches?.('a[href]')
            ? [node]
            : Array.from(node.querySelectorAll?.('a[href]') || []);
        return anchors.some((anchor) => {
            const href = String(anchor.getAttribute('href') || '').trim();
            return href === DEFAULT_FOOTER_CONTACTS.support_url
                || href === DEFAULT_FOOTER_CONTACTS.telegram_url
                || href === DEFAULT_FOOTER_CONTACTS.telegram_group_url
                || href === `mailto:${DEFAULT_FOOTER_CONTACTS.contact_email}`;
        });
    }

    function hasLayoutManagedNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches?.('a.nav-logo, [data-site-layout-contact], [data-site-layout-support-list], [data-site-layout-support-action], #dropdown-support, #support-mobile')) {
            return true;
        }
        return Boolean(node.querySelector?.('a.nav-logo, [data-site-layout-contact], [data-site-layout-support-list], [data-site-layout-support-action], #dropdown-support, #support-mobile'))
            || hasFallbackContactHref(node);
    }

    function isSupportListRenderMutation(mutation) {
        const target = mutation?.target;
        if (!target?.matches?.('[data-site-layout-support-list][data-site-layout-support-rendered="1"]')) {
            return false;
        }
        const addedNodes = Array.from(mutation.addedNodes || []);
        if (!addedNodes.length) return false;
        return addedNodes.every((node) => {
            if (!node || node.nodeType !== 1) return true;
            return node.matches?.('[data-site-layout-support-action]')
                || Boolean(node.querySelector?.('[data-site-layout-support-action]'));
        });
    }

    function scheduleDynamicDomApply() {
        if (!activeLayouts || dynamicDomApplyScheduled) return;
        dynamicDomApplyScheduled = true;
        const apply = () => {
            dynamicDomApplyScheduled = false;
            applyLayout(activeLayouts);
        };
        if (typeof global.requestAnimationFrame === 'function') {
            global.requestAnimationFrame(apply);
        } else {
            global.setTimeout(apply, 0);
        }
    }

    function ensureDynamicDomObserver() {
        if (dynamicDomObserver || typeof MutationObserver !== 'function') {
            return;
        }
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', ensureDynamicDomObserver, { once: true });
            return;
        }
        dynamicDomObserver = new MutationObserver((mutations) => {
            const hasManagedAddition = mutations.some((mutation) => (
                !isSupportListRenderMutation(mutation)
                &&
                Array.from(mutation.addedNodes || []).some(hasLayoutManagedNode)
            ));
            if (hasManagedAddition) {
                scheduleDynamicDomApply();
            }
        });
        dynamicDomObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function applySeoMeta() {
        const currentUrl = new URL(global.location.pathname + global.location.search, global.location.origin);
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            canonical.setAttribute('href', currentUrl.toString());
        }
        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) {
            ogUrl.setAttribute('content', currentUrl.toString());
        }
    }

    function maybeRedirectRoot(layout) {
        const pathname = global.location.pathname || '/';
        if (pathname !== '/') {
            return false;
        }

        const targetHref = getRootHref(layout);
        if (!targetHref || targetHref === '/') {
            return false;
        }

        const targetUrl = new URL(targetHref, global.location.origin);
        if (!targetUrl.search && global.location.search) {
            targetUrl.search = global.location.search;
        }
        if (!targetUrl.hash && global.location.hash) {
            targetUrl.hash = global.location.hash;
        }

        if (targetUrl.toString() === global.location.href) {
            return false;
        }

        global.location.replace(targetUrl.toString());
        return true;
    }

    function fetchLayoutsFromPublicApi() {
        return fetch('/api/public?scope=config&route=site-layout', {
            method: 'GET',
            credentials: 'same-origin'
        })
            .then((response) => response.json().catch(() => ({})).then((payload) => ({ response, payload })))
            .then(({ response, payload }) => {
                if (!response.ok || payload?.success !== true) {
                    throw new Error(payload?.message || 'Failed to load site layout config');
                }
                return normalizeLayouts(payload.layouts || {});
            });
    }

    function applyLayout(layouts) {
        const site = getCurrentSite();
        const layout = layouts[site] || buildDefaultLayout(site);
        activeLayouts = layouts;
        global.__ZAOYOE_SITE_LAYOUTS__ = layouts;
        global.__ZAOYOE_SITE_LAYOUT__ = layout;

        const redirected = maybeRedirectRoot(layout);
        if (redirected) {
            return;
        }

        applyLogoTargets(layout);
        applySupportChannels(layout);
        applyFooterContacts(layout);
        applySeoMeta();
        ensureDynamicDomObserver();
    }

    function ensureAppliedWithCurrentDom(layouts) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => applyLayout(layouts), { once: true });
            return;
        }
        applyLayout(layouts);
    }

    const cachedLayouts = loadLayoutsFromCache();
    if (cachedLayouts) {
        ensureAppliedWithCurrentDom(cachedLayouts);
    }

    fetchLayoutsFromPublicApi()
        .then((layouts) => {
            saveLayoutsToCache(layouts);
            ensureAppliedWithCurrentDom(layouts);
        })
        .catch((error) => {
            if (!cachedLayouts) {
                console.warn('[SiteLayoutRuntime] Failed to load public site layout config:', error?.message || error);
            }
        });

    global.SiteLayoutRuntime = Object.freeze({
        defaults: DEFAULT_LAYOUTS,
        pageRegistry: PAGE_REGISTRY,
        normalizeLayouts,
        normalizeSupportChannels,
        supportIconPresets: SUPPORT_ICON_PRESETS,
        getCurrentSite,
        getCurrentLayout: function () {
            const site = getCurrentSite();
            return (global.__ZAOYOE_SITE_LAYOUTS__ && global.__ZAOYOE_SITE_LAYOUTS__[site])
                || buildDefaultLayout(site);
        },
        resolveRootHref: function (site = getCurrentSite()) {
            const normalizedSite = normalizeSite(site);
            const layout = (global.__ZAOYOE_SITE_LAYOUTS__ && global.__ZAOYOE_SITE_LAYOUTS__[normalizedSite])
                || buildDefaultLayout(normalizedSite);
            return getRootHref(layout);
        },
        resolveLogoHref: function (site = getCurrentSite()) {
            const normalizedSite = normalizeSite(site);
            const layout = (global.__ZAOYOE_SITE_LAYOUTS__ && global.__ZAOYOE_SITE_LAYOUTS__[normalizedSite])
                || buildDefaultLayout(normalizedSite);
            return getLogoHref(layout);
        }
    });
}(typeof window !== 'undefined' ? window : globalThis));
