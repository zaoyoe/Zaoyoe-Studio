/**
 * Announcement Loader - Shared script for public pages
 * This script loads system announcements with full support for banners, modals, and toasts.
 * Version: 2026041005
 */

(function () {
    'use strict';

    let currentAnnouncementElement = null;
    let currentAnnouncementAckKey = '';
    let announcementOwnsScrollLock = false;
    let announcementOverflowRestore = null;
    const acknowledgedAnnouncementKeys = new Set();
    const dismissedAnnouncementKeys = new Set();
    const recordedAnnouncementEventKeys = new Set();
    let announcementConfigWarmPromise = null;
    const ANNOUNCEMENT_ACK_STORAGE_PREFIX = 'announcement_acked_v2_';
    const ANNOUNCEMENT_READER_STORAGE_KEY = 'announcement_reader_v1';
    let announcementBootstrapStarted = false;

    function isLocalAnnouncementTestingHost() {
        const host = String(window.location.hostname || '').trim().toLowerCase();
        return host === 'localhost'
            || host === '127.0.0.1'
            || host === '0.0.0.0'
            || host === '::1';
    }

    function shouldPersistAnnouncementAck() {
        return true;
    }

    function clearLocalAnnouncementAckCache() {
        if (!isLocalAnnouncementTestingHost() || !window.localStorage) {
            return;
        }

        try {
            const staleKeys = [];
            for (let index = 0; index < window.localStorage.length; index += 1) {
                const key = window.localStorage.key(index);
                if (key && key.startsWith('announcement_acked_') && !key.startsWith(ANNOUNCEMENT_ACK_STORAGE_PREFIX)) {
                    staleKeys.push(key);
                }
            }

            staleKeys.forEach((key) => {
                window.localStorage.removeItem(key);
            });
        } catch (error) {
            console.warn('📢 [Loader] 清理本地公告已读缓存失败:', error);
        }
    }

    function toAnnouncementCssPropertyName(name) {
        if (typeof name !== 'string' || !name) return '';
        if (name.startsWith('--')) return name;
        return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    }

    function setAnnouncementStyleState(target, styles = {}) {
        const style = target?.style;
        if (!style) return;

        const setProperty = style['setProperty'].bind(style);
        const removeProperty = style['removeProperty'].bind(style);

        Object.entries(styles).forEach(([name, value]) => {
            const cssName = toAnnouncementCssPropertyName(name);
            if (!cssName) return;
            if (value === null || value === undefined || value === '') {
                removeProperty(cssName);
                return;
            }
            setProperty(cssName, String(value));
        });
    }

    function setAnnouncementTransformState(target, x, y) {
        setAnnouncementStyleState(target, {
            '--announcement-x': `${x}px`,
            '--announcement-y': `${y}px`
        });
    }

    function setAnnouncementOpacityState(target, opacity) {
        setAnnouncementStyleState(target, {
            '--announcement-opacity': opacity
        });
    }

    function lockAnnouncementBackground(lockTarget) {
        if (announcementOwnsScrollLock) return;
        if (window.iOSScrollLock?.isLocked) return;

        announcementOwnsScrollLock = true;
        announcementOverflowRestore = {
            htmlOverflow: document.documentElement.style['overflow'],
            bodyOverflow: document.body.style['overflow']
        };

        setAnnouncementStyleState(document.documentElement, { overflow: 'hidden' });
        setAnnouncementStyleState(document.body, { overflow: 'hidden' });

        if (window.iOSScrollLock) {
            window.iOSScrollLock.lockLight(lockTarget);
        }
    }

    function unlockAnnouncementBackground() {
        if (!announcementOwnsScrollLock) return;

        if (window.iOSScrollLock?.isLocked) {
            window.iOSScrollLock.unlock();
        }

        if (announcementOverflowRestore) {
            setAnnouncementStyleState(document.documentElement, { overflow: announcementOverflowRestore.htmlOverflow });
            setAnnouncementStyleState(document.body, { overflow: announcementOverflowRestore.bodyOverflow });
        } else {
            setAnnouncementStyleState(document.documentElement, { overflow: '' });
            setAnnouncementStyleState(document.body, { overflow: '' });
        }

        announcementOverflowRestore = null;
        announcementOwnsScrollLock = false;
    }

    function clearCurrentAnnouncement() {
        ParticleSystem.stop();

        if (currentAnnouncementElement) {
            currentAnnouncementElement.remove();
            currentAnnouncementElement = null;
        }

        currentAnnouncementAckKey = '';

        unlockAnnouncementBackground();
    }

    function dismissAnnouncement(element, ackKey, acknowledged = true) {
        if (acknowledged && ackKey) {
            acknowledgedAnnouncementKeys.add(ackKey);
            if (shouldPersistAnnouncementAck()) {
                localStorage.setItem(ackKey, 'true');
            }
        } else if (ackKey) {
            dismissedAnnouncementKeys.add(ackKey);
        }

        ParticleSystem.stop();

        if (element === currentAnnouncementElement) {
            currentAnnouncementElement = null;
        }

        if (element && (!currentAnnouncementElement || element === currentAnnouncementElement)) {
            currentAnnouncementAckKey = '';
        }

        window.runSiteModalCloseChromeCleanup?.({
            targets: [element],
            forceHiddenClass: 'announcement-modal-force-hidden',
            restoreDelayMs: 320
        });
        element.remove();
        unlockAnnouncementBackground();
    }

    function normalizeAnnouncementPageId(value) {
        const page = String(value || '').trim().toLowerCase();
        if (!page) return '';
        if (page === 'home' || page === 'homepage' || page === 'index' || page === '/') {
            return 'index';
        }
        return page;
    }

    function normalizeAnnouncementPageTargets(value) {
        const rawTargets = Array.isArray(value) ? value : [value];
        const targets = [];

        rawTargets.forEach((entry) => {
            const normalized = normalizeAnnouncementPageId(entry);
            if (normalized && !targets.includes(normalized)) {
                targets.push(normalized);
            }
        });

        return targets.length ? targets : ['all'];
    }

    function normalizeAnnouncementPageOverrides(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        const overrides = {};

        Object.entries(source).forEach(([rawPage, rawConfig]) => {
            const page = normalizeAnnouncementPageId(rawPage);
            if (!page || page === 'all') {
                return;
            }

            const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
                ? rawConfig
                : { content: rawConfig };
            const content = String(config.content ?? config.announcement_content ?? '');
            if (!content.trim() && config.enabled !== false) {
                return;
            }

            overrides[page] = {
                enabled: config.enabled !== false,
                content,
                updated_at: String(config.updated_at || config.announcement_updated_at || '').trim()
            };
        });

        return overrides;
    }

    function normalizeAnnouncementRule(ruleValue = {}) {
        const rule = ruleValue && typeof ruleValue === 'object' && !Array.isArray(ruleValue)
            ? ruleValue
            : {};
        const priority = Number(rule.priority || 0);
        const status = String(rule.status || 'draft').trim().toLowerCase() || 'draft';

        return {
            announcement_id: String(rule.announcement_id || rule.id || '').trim(),
            announcement_title: String(rule.announcement_title || rule.title || '站内公告').trim() || '站内公告',
            announcement_enabled: rule.announcement_enabled === true || rule.enabled === true,
            announcement_content: String(rule.announcement_content ?? rule.content ?? ''),
            announcement_type: String(rule.announcement_type || rule.type || 'banner').trim().toLowerCase() || 'banner',
            announcement_color: String(rule.announcement_color || rule.color || 'purple').trim().toLowerCase() || 'purple',
            announcement_size: String(rule.announcement_size || rule.size || 'medium').trim().toLowerCase() || 'medium',
            announcement_decoration: String(rule.announcement_decoration || rule.decoration || 'none').trim().toLowerCase() || 'none',
            announcement_pages: normalizeAnnouncementPageTargets(rule.announcement_pages ?? rule.pages),
            announcement_page_overrides: normalizeAnnouncementPageOverrides(rule.announcement_page_overrides ?? rule.page_overrides),
            announcement_updated_at: String(rule.announcement_updated_at || rule.updated_at || '').trim(),
            priority: Number.isFinite(priority) ? priority : 0,
            status,
            starts_at: String(rule.starts_at || '').trim(),
            ends_at: String(rule.ends_at || '').trim()
        };
    }

    function normalizeAnnouncementRules(value = []) {
        return (Array.isArray(value) ? value : [])
            .map(normalizeAnnouncementRule)
            .filter((rule) => rule.announcement_id || rule.announcement_content || Object.keys(rule.announcement_page_overrides || {}).length);
    }

    function normalizeAnnouncementConfig(configValue = {}) {
        const config = configValue && typeof configValue === 'object' && !Array.isArray(configValue)
            ? configValue
            : {};

        return {
            announcement_enabled: config.announcement_enabled === true,
            announcement_content: String(config.announcement_content || ''),
            announcement_type: String(config.announcement_type || 'banner').trim().toLowerCase() || 'banner',
            announcement_color: String(config.announcement_color || 'purple').trim().toLowerCase() || 'purple',
            announcement_size: String(config.announcement_size || 'medium').trim().toLowerCase() || 'medium',
            announcement_decoration: String(config.announcement_decoration || 'none').trim().toLowerCase() || 'none',
            announcement_pages: normalizeAnnouncementPageTargets(config.announcement_pages),
            announcement_page_overrides: normalizeAnnouncementPageOverrides(config.announcement_page_overrides),
            announcement_updated_at: String(config.announcement_updated_at || '').trim(),
            announcement_rules: normalizeAnnouncementRules(config.announcement_rules)
        };
    }

    function isAnnouncementWithinSchedule(config = {}, now = new Date()) {
        const startsAt = config.starts_at ? new Date(config.starts_at) : null;
        const endsAt = config.ends_at ? new Date(config.ends_at) : null;

        if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > now) {
            return false;
        }
        if (endsAt && !Number.isNaN(endsAt.getTime()) && endsAt <= now) {
            return false;
        }
        return true;
    }

    function resolveSingleAnnouncementConfigForPage(config = {}, currentPage = '') {
        const normalizedPage = normalizeAnnouncementPageId(currentPage);
        if (!config.announcement_enabled || !normalizedPage) {
            return null;
        }

        const pageOverride = config.announcement_page_overrides?.[normalizedPage];
        if (pageOverride) {
            if (pageOverride.enabled === false) {
                return null;
            }
            if (pageOverride.content) {
                return {
                    ...config,
                    announcement_content: pageOverride.content,
                    announcement_pages: [normalizedPage],
                    announcement_scope: normalizedPage,
                    announcement_updated_at: pageOverride.updated_at || config.announcement_updated_at || ''
                };
            }
        }

        const targetPages = normalizeAnnouncementPageTargets(config.announcement_pages);
        if (!targetPages.includes('all') && !targetPages.includes(normalizedPage)) {
            return null;
        }

        if (!config.announcement_content) {
            return null;
        }

        return {
            ...config,
            announcement_scope: targetPages.includes('all') ? 'all' : normalizedPage
        };
    }

    function resolveAnnouncementConfigForPage(config = {}, currentPage = '') {
        const normalizedPage = normalizeAnnouncementPageId(currentPage);
        if (!normalizedPage) {
            return null;
        }

        const now = new Date();
        const ruleMatches = (Array.isArray(config.announcement_rules) ? config.announcement_rules : [])
            .filter((rule) => rule.status === 'approved' && isAnnouncementWithinSchedule(rule, now))
            .map((rule) => {
                const resolved = resolveSingleAnnouncementConfigForPage(rule, normalizedPage);
                if (!resolved) {
                    return null;
                }
                return {
                    ...resolved,
                    announcement_id: rule.announcement_id,
                    announcement_title: rule.announcement_title,
                    announcement_rule: true,
                    priority: rule.priority
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
                if (priorityDelta !== 0) {
                    return priorityDelta;
                }
                return String(right.announcement_updated_at || '').localeCompare(String(left.announcement_updated_at || ''));
            });

        if (ruleMatches.length) {
            return ruleMatches[0];
        }

        return resolveSingleAnnouncementConfigForPage(config, normalizedPage);
    }

    function buildAnnouncementAckKey(config = {}, currentPage = '') {
        const normalizedPage = normalizeAnnouncementPageId(currentPage) || 'unknown';
        const normalizedScope = normalizeAnnouncementPageId(config.announcement_scope) || 'all';
        const contentForHash = `${config.announcement_id || ''}|${config.announcement_content || ''}|${config.announcement_updated_at || ''}|${normalizedPage}|${normalizedScope}`;
        let hash = 0;
        for (let i = 0; i < contentForHash.length; i += 1) {
            const char = contentForHash.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash &= hash;
        }
        return `${ANNOUNCEMENT_ACK_STORAGE_PREFIX}${normalizedPage}_${Math.abs(hash).toString(36)}`;
    }

    function getAnnouncementReaderKey() {
        const fallback = `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        if (!window.localStorage) {
            return fallback;
        }

        try {
            const existing = String(localStorage.getItem(ANNOUNCEMENT_READER_STORAGE_KEY) || '').trim();
            if (existing) {
                return existing;
            }

            const nextKey = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
            localStorage.setItem(ANNOUNCEMENT_READER_STORAGE_KEY, nextKey);
            return nextKey;
        } catch (error) {
            console.warn('📢 [Loader] 公告访客标识写入失败:', error);
            return fallback;
        }
    }

    async function recordAnnouncementEvent(config = {}, currentPage = '', ackKey = '', eventType = 'read') {
        const announcementId = String(config.announcement_id || '').trim();
        if (!announcementId) {
            return;
        }

        const normalizedPage = normalizeAnnouncementPageId(currentPage) || 'unknown';
        const normalizedEventType = String(eventType || '').trim().toLowerCase();
        if (!['view', 'read', 'dismiss'].includes(normalizedEventType)) {
            return;
        }

        const eventKey = `${announcementId}:${normalizedPage}:${normalizedEventType}:${ackKey}`;
        if (recordedAnnouncementEventKeys.has(eventKey)) {
            return;
        }
        recordedAnnouncementEventKeys.add(eventKey);

        try {
            const response = await fetch('/api/public?scope=config&route=announcement-event', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    announcement_id: announcementId,
                    reader_key: getAnnouncementReaderKey(),
                    page: normalizedPage,
                    event_type: normalizedEventType,
                    ack_key: ackKey,
                    metadata: {
                        scope: normalizeAnnouncementPageId(config.announcement_scope) || 'all'
                    }
                })
            });

            if (!response.ok) {
                recordedAnnouncementEventKeys.delete(eventKey);
            }
        } catch (error) {
            recordedAnnouncementEventKeys.delete(eventKey);
            console.warn('📢 [Loader] 公告阅读事件上报失败:', error);
        }
    }

    function getEngagementAnnouncementPageId(currentPage = '') {
        const normalizedPage = normalizeAnnouncementPageId(currentPage);
        if (!normalizedPage || normalizedPage === 'index') return 'home';
        if (normalizedPage === 'gongyi' || normalizedPage === 'prompts' || normalizedPage === 'shop' || normalizedPage === 'verify' || normalizedPage === 'guestbook') {
            return normalizedPage;
        }
        return 'home';
    }

    function triggerAnnouncementMaintenanceEngagement(config = {}, currentPage = '', ackKey = '') {
        const trigger = window.ZaoyoeEngagement?.trigger;
        if (typeof trigger !== 'function') {
            window.setTimeout(() => {
                const retryTrigger = window.ZaoyoeEngagement?.trigger;
                if (typeof retryTrigger === 'function') {
                    triggerAnnouncementMaintenanceEngagement(config, currentPage, ackKey);
                }
            }, 1800);
            return;
        }

        const announcementId = String(config.announcement_id || ackKey || '').trim();
        const pageId = getEngagementAnnouncementPageId(currentPage);
        const announcementType = String(config.announcement_type || config.type || 'banner').trim();
        const announcementScope = normalizeAnnouncementPageId(config.announcement_scope) || 'all';
        const contentText = [
            config.title,
            config.message,
            config.content,
            config.description,
            announcementType
        ].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).join(' ');
        const triggerTypes = new Set(['maintenance_notice', 'service_status']);
        if (/rule|rules|policy|terms|规范|规则|须知|说明/.test(contentText)) {
            triggerTypes.add('usage_rules');
        }
        if (/community|comment|guestbook|reply|留言|评论|社区|互动/.test(contentText) || ['guestbook', 'prompts', 'gongyi'].includes(pageId)) {
            triggerTypes.add('community_rule');
        }
        try {
            triggerTypes.forEach((triggerType) => {
                void trigger(triggerType, {
                    source_module: 'announcements',
                    source_event_id: `${triggerType}:${announcementId || pageId}`,
                    page_id: pageId,
                    site: window.SiteConfig?.site || 'cn',
                    announcement_id: announcementId,
                    announcement_type: announcementType,
                    announcement_scope: announcementScope
                }, { once: true });
            });
        } catch (error) {
            console.debug('📢 [Loader] 维护公告触达事件跳过:', error?.message || error);
        }
    }

    const ANNOUNCEMENT_CONFIG_SESSION_KEY = 'zaoyoe_announcement_config_cache_v1';
    const ANNOUNCEMENT_CONFIG_SESSION_TTL_MS = 5 * 60 * 1000;

    function readAnnouncementConfigFromSession() {
        try {
            const raw = sessionStorage.getItem(ANNOUNCEMENT_CONFIG_SESSION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed?.cachedAt || Date.now() - parsed.cachedAt > ANNOUNCEMENT_CONFIG_SESSION_TTL_MS) {
                sessionStorage.removeItem(ANNOUNCEMENT_CONFIG_SESSION_KEY);
                return null;
            }
            return normalizeAnnouncementConfig(parsed.config || {});
        } catch (_error) {
            return null;
        }
    }

    function writeAnnouncementConfigToSession(config) {
        try {
            sessionStorage.setItem(ANNOUNCEMENT_CONFIG_SESSION_KEY, JSON.stringify({
                config,
                cachedAt: Date.now()
            }));
        } catch (_error) {
            // Ignore storage failures.
        }
    }

    async function fetchAnnouncementConfigFromPublicApi() {
        const response = await fetch('/api/public?scope=config&route=notifications', {
            method: 'GET',
            credentials: 'same-origin'
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || 'Failed to load public announcement config');
        }

        const config = normalizeAnnouncementConfig(payload?.config || {});
        writeAnnouncementConfigToSession(payload?.config || {});
        return config;
    }

    async function fetchAnnouncementConfigFromSupabase() {
        if (!window.supabaseClient?.rpc) {
            return null;
        }

        const { data, error } = await window.supabaseClient.rpc('get_system_config', { p_key: 'notifications' });
        if (error) {
            throw error;
        }

        return normalizeAnnouncementConfig(data || {});
    }

    async function fetchAnnouncementConfig() {
        // Try sessionStorage cache first to avoid network request entirely
        const sessionCached = readAnnouncementConfigFromSession();
        if (sessionCached) {
            return sessionCached;
        }

        try {
            return await fetchAnnouncementConfigFromPublicApi();
        } catch (publicError) {
            console.warn('📢 [Loader] 公共公告配置读取失败，回退到 Supabase RPC:', publicError);
        }

        try {
            return await fetchAnnouncementConfigFromSupabase();
        } catch (rpcError) {
            console.error('📢 [Loader] Supabase 公告配置读取失败:', rpcError);
            return null;
        }
    }

    function warmAnnouncementConfig() {
        if (!announcementConfigWarmPromise) {
            announcementConfigWarmPromise = fetchAnnouncementConfig()
                .finally(() => {
                    announcementConfigWarmPromise = null;
                });
        }
        return announcementConfigWarmPromise;
    }

    // Get current page ID for announcement targeting
    function getCurrentPageId() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes('prompts')) return 'prompts';
        if (path.includes('shop')) return 'shop';
        if (path.includes('verify')) return 'verify';
        if (path.includes('guestbook')) return 'guestbook';
        if (path === '/' || path.includes('index') || path.endsWith('/')) return 'index';
        return 'unknown';
    }

    // Main announcement loading function
    async function loadAnnouncement() {
        console.log('📢 [Loader] loadAnnouncement() 开始执行...');

        try {
            const config = await warmAnnouncementConfig();

            if (!config) {
                console.warn('📢 [Loader] notifications 配置不存在');
                return;
            }

            const currentPage = normalizeAnnouncementPageId(getCurrentPageId());
            const pageConfig = resolveAnnouncementConfigForPage(config, currentPage);
            console.log('📢 [Loader] 目标页面:', normalizeAnnouncementPageTargets(config.announcement_pages), '当前页面:', currentPage);

            if (!pageConfig) {
                console.log('📢 [Loader] 当前页面不在公告目标页面中，跳过显示');
                return;
            }

            if (pageConfig.announcement_enabled && pageConfig.announcement_content) {
                const type = pageConfig.announcement_type || 'banner';
                const color = pageConfig.announcement_color || 'purple';
                const size = pageConfig.announcement_size || 'medium';
                const content = pageConfig.announcement_content.replace(/\n/g, '<br>');
                const ackKey = buildAnnouncementAckKey(pageConfig, currentPage);

                if (acknowledgedAnnouncementKeys.has(ackKey)) {
                    console.log('📢 [Loader] 当前会话已确认该公告');
                    return;
                }

                if (dismissedAnnouncementKeys.has(ackKey)) {
                    console.log('📢 [Loader] 当前页面已关闭该公告，跳过重复渲染');
                    return;
                }

                if (shouldPersistAnnouncementAck() && localStorage.getItem(ackKey)) {
                    console.log('📢 [Loader] 该公告已被用户确认');
                    return;
                }

                if (currentAnnouncementElement && currentAnnouncementAckKey === ackKey) {
                    console.log('📢 [Loader] 公告已在当前页面展示，跳过重复渲染');
                    return;
                }

                const decoration = pageConfig.announcement_decoration || 'none';
                showAnnouncement(type, color, size, content, ackKey, decoration, {
                    announcementConfig: pageConfig,
                    currentPage
                });
                void recordAnnouncementEvent(pageConfig, currentPage, ackKey, 'view');
                triggerAnnouncementMaintenanceEngagement(pageConfig, currentPage, ackKey);
                console.log('📢 [Loader] 公告已显示:', type, color, size);
            }
        } catch (err) {
            console.error('📢 [Loader] 加载公告失败:', err);
        }
    }

    function scheduleAnnouncementLoad(delay) {
        window.setTimeout(() => {
            loadAnnouncement().catch((error) => {
                console.error('📢 [Loader] 公告补挂失败:', error);
            });
        }, Math.max(0, Number(delay) || 0));
    }

    function startAnnouncementBootstrap() {
        if (announcementBootstrapStarted) {
            return;
        }

        announcementBootstrapStarted = true;
        clearLocalAnnouncementAckCache();

        // Single immediate load + one delayed fallback (reduced from 5-6 calls)
        void warmAnnouncementConfig();
        scheduleAnnouncementLoad(0);
        scheduleAnnouncementLoad(2000);
    }

    function showAnnouncement(type, color, size, content, ackKey, decoration, context = {}) {
        if (currentAnnouncementElement && currentAnnouncementAckKey === ackKey) {
            return;
        }

        if (currentAnnouncementElement) {
            clearCurrentAnnouncement();
        }

        currentAnnouncementAckKey = ackKey || '';

        if (type === 'banner') {
            showBannerAnnouncement(color, size, content, ackKey, decoration, context);
        } else if (type === 'modal') {
            showModalAnnouncement(color, size, content, ackKey, decoration, context);
        } else if (type === 'toast') {
            showToastAnnouncement(color, size, content, ackKey, decoration, context);
        }
    }

    // Inject required CSS if not already present
    function injectAnnouncementStyles() {
        if (document.getElementById('announcement-loader-styles')) return;

        const style = document.createElement('style');
        style.id = 'announcement-loader-styles';
        style.textContent = `
            /* Announcement Modal */
            .zaoyoe-announcement-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(34, 41, 52, 0.48);
                backdrop-filter: blur(12px) saturate(106%);
                -webkit-backdrop-filter: blur(12px) saturate(106%);
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.3s ease;
            }

            .zaoyoe-announcement-overlay.announcement-modal-force-hidden,
            .zaoyoe-announcement-banner.announcement-modal-force-hidden,
            .zaoyoe-announcement-toast.announcement-modal-force-hidden {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                background: transparent !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                transition: none !important;
                animation: none !important;
            }

            .zaoyoe-announcement-overlay.announcement-modal-force-hidden .zaoyoe-announcement-modal,
            .zaoyoe-announcement-overlay.announcement-modal-force-hidden .zaoyoe-announcement-modal *,
            .zaoyoe-announcement-banner.announcement-modal-force-hidden *,
            .zaoyoe-announcement-toast.announcement-modal-force-hidden * {
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                transition: none !important;
                animation: none !important;
            }
            
            .zaoyoe-announcement-modal {
                --announcement-snow-particle-color: rgba(191, 219, 254, 0.88);
                --announcement-snow-dust-color: rgba(147, 197, 253, 0.76);
                --announcement-snow-soft-color: rgba(125, 211, 252, 0.72);
                --announcement-snow-crystal-color: rgba(191, 219, 254, 0.92);
                background: rgba(30, 41, 59, 0.85);
                backdrop-filter: blur(18px) saturate(115%);
                -webkit-backdrop-filter: blur(18px) saturate(115%);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                width: 90%;
                max-width: 480px;
                color: #fff;
                box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5);
                animation: modalPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                overflow: hidden;
                position: relative;
            }
            
            .zaoyoe-announcement-header {
                padding: 20px 24px 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                position: relative;
                z-index: 10;
            }
            
            .zaoyoe-announcement-header i {
                font-size: 1.3rem;
                color: #6b9ece;
            }
            
            .zaoyoe-announcement-title {
                font-size: 1.15rem;
                font-weight: 600;
                color: #fff;
            }
            
            .zaoyoe-announcement-body {
                padding: 16px 24px 24px;
                position: relative;
                z-index: 10;
            }
            
            /* 磨砂玻璃效果 - 内容区域 */
            .zaoyoe-announcement-text {
                background: rgba(30, 41, 59, 0.35);
                backdrop-filter: blur(14px) saturate(125%);
                -webkit-backdrop-filter: blur(14px) saturate(125%);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 12px;
                padding: 16px;
                color: rgba(255, 255, 255, 0.9);
                font-size: 0.9rem;
                line-height: 1.6;
                max-height: 300px;
                overflow-y: auto;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1);
            }
            
            .zaoyoe-announcement-text a {
                color: #6b9ece;
                text-decoration: underline;
            }
            
            .zaoyoe-announcement-footer {
                padding: 16px 24px 20px;
                display: flex;
                justify-content: center;
                position: relative;
                z-index: 10;
            }
            
            /* 磨砂玻璃按钮 */
            .zaoyoe-announcement-ack-btn {
                padding: 10px 36px;
                background: rgba(255, 255, 255, 0.15);
                backdrop-filter: blur(14px) saturate(125%);
                -webkit-backdrop-filter: blur(14px) saturate(125%);
                border: 1px solid rgba(255, 255, 255, 0.25);
                border-radius: 12px;
                color: #fff;
                font-size: 0.9rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            
            .zaoyoe-announcement-ack-btn:hover {
                background: rgba(255, 255, 255, 0.25);
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }

            [data-theme="dark"] .zaoyoe-announcement-overlay {
                background: rgba(7, 9, 12, 0.28);
                backdrop-filter: blur(14px) saturate(108%);
                -webkit-backdrop-filter: blur(14px) saturate(108%);
            }

            [data-theme="dark"] .zaoyoe-announcement-modal {
                --announcement-snow-particle-color: rgba(191, 219, 254, 0.88);
                --announcement-snow-dust-color: rgba(147, 197, 253, 0.76);
                --announcement-snow-soft-color: rgba(125, 211, 252, 0.72);
                --announcement-snow-crystal-color: rgba(191, 219, 254, 0.92);
                background: rgba(30, 41, 59, 0.85);
                backdrop-filter: blur(18px) saturate(115%);
                -webkit-backdrop-filter: blur(18px) saturate(115%);
                border-color: rgba(255, 255, 255, 0.1);
                color: #fff;
                box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5);
            }

            [data-theme="dark"] .zaoyoe-announcement-header {
                border-bottom-color: rgba(255, 255, 255, 0.06);
            }

            [data-theme="dark"] .zaoyoe-announcement-title {
                color: #fff;
            }

            [data-theme="dark"] .zaoyoe-announcement-text {
                background: rgba(30, 41, 59, 0.35);
                border-color: rgba(255, 255, 255, 0.15);
                color: rgba(255, 255, 255, 0.9);
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1);
            }

            [data-theme="dark"] .zaoyoe-announcement-ack-btn {
                background: rgba(255, 255, 255, 0.15);
                border-color: rgba(255, 255, 255, 0.25);
                color: #fff;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }

            [data-theme="dark"] .zaoyoe-announcement-ack-btn:hover {
                background: rgba(255, 255, 255, 0.25);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            /* Banner Style */
            .zaoyoe-announcement-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                /* 半透明背景，让粒子能透过 */
                background: rgba(30, 41, 59, 0.85);
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding: 12px 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
                z-index: 99998;
                animation: slideDown 0.4s ease;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                overflow: hidden;
            }
            
            .zaoyoe-announcement-banner .zaoyoe-announcement-text {
                color: rgba(255, 255, 255, 0.9);
                font-size: 0.9rem;
                position: relative;
                z-index: 10;
            }
            
            .zaoyoe-announcement-banner .zaoyoe-announcement-close {
                background: rgba(255, 255, 255, 0.1);
                border: none;
                color: #fff;
                padding: 6px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.85rem;
                position: relative;
                z-index: 10;
            }

            .announcement-banner-icon {
                position: relative;
                z-index: 10;
            }
            
            /* Toast Style */
            .zaoyoe-announcement-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                /* 半透明背景，让粒子能透过 */
                background: rgba(30, 41, 59, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                width: 320px;
                max-width: calc(100vw - 48px);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
                z-index: 99997;
                animation: slideUp 0.4s ease;
                overflow: hidden;
            }

            .announcement-particle-host {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                pointer-events: none;
                z-index: 1;
            }

            .announcement-particle-layer {
                position: absolute;
                left: 0;
                top: 0;
                pointer-events: none;
                will-change: transform, opacity;
                transform: translate3d(var(--announcement-x, 0px), var(--announcement-y, 0px), 0);
                opacity: var(--announcement-opacity, 1);
            }

            .announcement-particle-layer--firework-rocket {
                font-size: 8px;
                color: var(--announcement-particle-color, rgba(255, 255, 255, 0.9));
            }

            .announcement-particle-layer--rain-streak {
                width: var(--announcement-rain-width, 1.5px);
                height: var(--announcement-rain-height, 90px);
                background: linear-gradient(to bottom, transparent, rgba(70, 130, 180, 0.6));
                filter: blur(0.5px);
            }

            .announcement-particle-layer--splash {
                width: 2px;
                height: 2px;
                border-radius: 50%;
                background-color: rgba(70, 130, 180, 0.8);
            }

            .announcement-particle-layer--spark {
                width: 4px;
                height: 4px;
                border-radius: 50%;
                background-color: var(--announcement-particle-color, rgba(255, 255, 255, 0.9));
                box-shadow: 0 0 6px 1px var(--announcement-particle-color, rgba(255, 255, 255, 0.9));
            }

            .announcement-particle-svg {
                width: 100%;
                height: 100%;
                display: block;
            }

            .announcement-particle-svg--stroke {
                stroke: currentColor;
                stroke-width: 2;
                stroke-linecap: round;
                fill: none;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes modalPop {
                from {
                    opacity: 0;
                    transform: scale(0.9) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
            
            @keyframes slideDown {
                from { transform: translateY(-100%); }
                to { transform: translateY(0); }
            }
            
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @media (max-width: 768px) {
                .zaoyoe-announcement-modal {
                    width: 95%;
                }

                .zaoyoe-announcement-modal .zaoyoe-announcement-header {
                    padding-top: 21px;
                    padding-bottom: 17px;
                }

                .zaoyoe-announcement-modal .zaoyoe-announcement-body {
                    padding-top: 17px;
                    padding-bottom: 25px;
                }

                .zaoyoe-announcement-modal .zaoyoe-announcement-text {
                    padding-top: 17px;
                    padding-bottom: 17px;
                    max-height: 317px;
                }

                .zaoyoe-announcement-modal .zaoyoe-announcement-footer {
                    padding-top: 17px;
                    padding-bottom: 21px;
                }

                .zaoyoe-announcement-modal .zaoyoe-announcement-ack-btn {
                    padding-top: 11px;
                    padding-bottom: 11px;
                }
            }
            
            /* ========================================
               Decoration Particles (from prompts-poetry.css)
               ======================================== */
            .decoration-particles {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                z-index: 0;
                border-radius: inherit;
                pointer-events: none !important;
                user-select: none !important;
            }
            
            .decoration-particle {
                position: absolute;
                display: block;
                line-height: 1;
                left: var(--announcement-particle-left, 0%);
                width: var(--announcement-particle-size, 12px);
                height: var(--announcement-particle-size, 12px);
                font-size: var(--announcement-particle-size, 12px);
                opacity: var(--announcement-particle-opacity, 1);
                color: var(--announcement-particle-color, currentColor);
                filter: blur(var(--announcement-particle-blur, 0px));
                animation-delay: var(--announcement-particle-delay, 0s);
                animation-duration: var(--announcement-particle-duration, 10s);
                pointer-events: none !important;
                animation-iteration-count: infinite;
                animation-timing-function: linear;
            }
            
            .decoration-particles.snow .decoration-particle {
                animation-name: particle-fall;
                animation-duration: 10s;
            }

            .decoration-particles.snow .announcement-particle--snow-dust,
            .decoration-particles.snow .announcement-particle--snow-soft,
            .decoration-particles.snow .announcement-particle--snow-crystal {
                color: var(--announcement-particle-color, rgba(255, 255, 255, 0.9));
            }

            .announcement-particle-snow-dot,
            .announcement-particle-snow-soft {
                display: block;
                width: 100%;
                height: 100%;
                border-radius: 999px;
                background: currentColor;
            }

            .announcement-particle-snow-dot {
                box-shadow: 0 0 5px rgba(96, 165, 250, 0.38);
            }

            .announcement-particle-snow-soft {
                background: radial-gradient(circle, rgba(191, 219, 254, 0.95) 0%, rgba(125, 211, 252, 0.48) 42%, rgba(125, 211, 252, 0) 74%);
                box-shadow: 0 0 10px rgba(125, 211, 252, 0.35);
            }

            .announcement-particle-svg--snow-crystal {
                filter: drop-shadow(0 0 4px rgba(96, 165, 250, 0.42));
            }
            
            .decoration-particles.sakura .decoration-particle {
                animation-name: particle-fall-sway;
                animation-duration: 12s;
            }
            
            .decoration-particles.hearts .decoration-particle {
                animation-name: particle-float-up;
                animation-duration: 10s;
            }
            
            .decoration-particles.leaves .decoration-particle {
                animation-name: particle-fall-spin;
                animation-duration: 11s;
            }
            
            /* Rain streak effect */
            .decoration-particles.rain {
                background: linear-gradient(180deg, transparent 0%, rgba(70, 130, 180, 0.03) 100%);
            }
            
            .decoration-particles.rain .rain-streak {
                position: absolute;
                width: 2px;
                background: linear-gradient(to bottom, transparent, rgba(70, 130, 180, 0.6));
                border-radius: 0 0 2px 2px;
                pointer-events: none;
                animation: rain-fall linear infinite;
            }
            
            .decoration-particles.rain .rain-splash {
                position: absolute;
                bottom: 0;
                width: 4px;
                height: 4px;
                border-radius: 50%;
                background: rgba(70, 130, 180, 0.6);
                pointer-events: none;
                animation: rain-splash 0.4s ease-out forwards;
                opacity: 0;
            }
            
            @keyframes rain-fall {
                0% { 
                    transform: translateY(-100px);
                    opacity: 0;
                }
                5% {
                    opacity: 0.7;
                }
                95% {
                    opacity: 0.5;
                }
                100% { 
                    transform: translateY(500px);
                    opacity: 0;
                }
            }
            
            @keyframes rain-splash {
                0% {
                    transform: scale(1) translateY(0);
                    opacity: 0.8;
                }
                50% {
                    transform: scale(2) translateY(-8px);
                    opacity: 0.5;
                }
                100% {
                    transform: scale(3) translateY(-12px);
                    opacity: 0;
                }
            }
            
            .decoration-particles.rain .decoration-particle {
                animation-name: particle-fall-fast;
                animation-duration: 3s;
            }
            
            @keyframes particle-fall {
                0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
                10% { opacity: 0.8; }
                90% { opacity: 0.6; }
                100% { transform: translateY(450px) translateX(var(--drift-x, 0px)) rotate(360deg); opacity: 0; }
            }
            
            @keyframes particle-fall-sway {
                0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
                10% { opacity: 0.9; transform: translateY(30px) translateX(5px) rotate(10deg); }
                30% { transform: translateY(150px) translateX(-15px) rotate(45deg); opacity: 0.9; }
                50% { transform: translateY(280px) translateX(10px) rotate(90deg); opacity: 0.8; }
                70% { transform: translateY(400px) translateX(-10px) rotate(135deg); opacity: 0.7; }
                100% { transform: translateY(550px) translateX(var(--drift-x, 20px)) rotate(180deg); opacity: 0; }
            }
            
            @keyframes particle-float-up {
                0% { transform: translateY(400px) scale(0.5); opacity: 0; }
                10% { opacity: 0.9; }
                90% { opacity: 0.7; }
                100% { transform: translateY(-30px) translateX(var(--drift-x, 0px)) scale(1); opacity: 0; }
            }
            
            @keyframes particle-fall-spin {
                0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
                10% { opacity: 0.75; }
                90% { opacity: 0.4; }
                100% { transform: translateY(450px) translateX(var(--drift-x, -15px)) rotate(720deg); opacity: 0; }
            }
            
            @keyframes particle-fall-fast {
                0% { transform: translateY(-10px); opacity: 0; }
                10% { opacity: 0.7; }
                90% { opacity: 0.5; }
                100% { transform: translateY(450px); opacity: 0; }
            }
            
            /* Sunshine decoration - Tyndall Effect */
            .decoration-container.sunlight {
                /* Light Mode - Warm Gold */
                --sun-glow: rgba(255, 200, 120, 0.12);
                --sun-beam-1-color: 255, 210, 150;
                --sun-beam-2-color: 255, 225, 180;
                --dust-bg: rgba(255, 210, 120, 0.5);
                --dust-shadow: rgba(255, 200, 100, 0.15);
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                overflow: hidden;
                z-index: 0;
                pointer-events: none;
                border-radius: inherit;
                background: linear-gradient(135deg, var(--sun-glow) 0%, transparent 60%);
            }
            
            /* Dark Mode - Cool White/Silver */
            [data-theme="dark"] .decoration-container.sunlight {
                --sun-glow: rgba(255, 255, 255, 0.05);
                --sun-beam-1-color: 220, 230, 255;
                --sun-beam-2-color: 200, 220, 255;
                --dust-bg: rgba(255, 255, 255, 0.4);
                --dust-shadow: rgba(200, 220, 255, 0.2);
            }
            
            .sunlight-glow {
                position: absolute;
                top: -25%; left: -25%;
                width: 120%; height: 120%;
                background: radial-gradient(circle at 25% 25%, var(--sun-glow) 0%, transparent 60%);
                animation: sunPulse 10s ease-in-out infinite alternate;
            }
            
            .sunlight-beam {
                position: absolute;
                top: -50%; left: -50%;
                width: 200%; height: 200%;
                filter: blur(3px);
                transform-origin: 40% 40%;
                will-change: transform, opacity;
            }
            
            .sunlight-beam.layer-1 {
                background: linear-gradient(115deg, transparent 25%, rgba(var(--sun-beam-1-color), 0.15) 30%, transparent 35%, rgba(var(--sun-beam-1-color), 0.25) 45%, transparent 50%, rgba(var(--sun-beam-1-color), 0.1) 60%, transparent 70%);
                background-size: 150% 150%;
                animation: sunRayPrimary 18s ease-in-out infinite alternate;
            }
            
            .sunlight-beam.layer-2 {
                background: linear-gradient(110deg, transparent 20%, rgba(var(--sun-beam-2-color), 0.08) 40%, transparent 60%, rgba(var(--sun-beam-2-color), 0.1) 75%, transparent 90%);
                background-size: 150% 150%;
                opacity: 0.7;
                animation: sunRaySecondary 22s ease-in-out infinite alternate-reverse;
            }
            
            .dust-mote {
                position: absolute;
                left: var(--announcement-dust-left, 0%);
                top: var(--announcement-dust-top, 0%);
                width: var(--announcement-dust-size, 1px);
                height: var(--announcement-dust-size, 1px);
                opacity: var(--announcement-dust-opacity, 0.5);
                background: var(--dust-bg);
                box-shadow: 0 0 1px var(--dust-shadow);
                border-radius: 50%;
                animation-duration: var(--announcement-dust-duration, 20s);
                animation-delay: var(--announcement-dust-delay, 0s);
                animation-name: dustFloat;
                animation-timing-function: ease-in-out;
                animation-iteration-count: infinite;
                will-change: transform, opacity;
                pointer-events: none;
            }
            
            @keyframes sunPulse {
                0% { opacity: 0.8; transform: scale(1); }
                100% { opacity: 1; transform: scale(1.05); }
            }
            
            @keyframes sunRayPrimary {
                0% { 
                    transform: rotate(0deg) translateX(0); 
                    opacity: 0.8; 
                    background-position: 0% 50%;
                }
                100% { 
                    transform: rotate(3deg) translateX(10px); 
                    opacity: 1; 
                    background-position: 20% 50%;
                }
            }
            
            @keyframes sunRaySecondary {
                0% { 
                    transform: rotate(-2deg) translateX(-5px); 
                    opacity: 0.4; 
                    background-position: 10% 50%;
                }
                100% { 
                    transform: rotate(1deg) translateX(5px); 
                    opacity: 0.6; 
                    background-position: 0% 50%;
                }
            }
            
            @keyframes dustFloat {
                0% { transform: translate(0, 0); opacity: 0; }
                20% { opacity: 1; }
                70% { opacity: 1; }
                100% { transform: translate(var(--tx), var(--ty)); opacity: 0; }
            }
            
            /* Hearts decoration */
            .decoration-pulsing-bg {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                overflow: hidden;
                z-index: 1;
                pointer-events: none;
                border-radius: inherit;
            }
            
            .heart-container {
                position: absolute;
                will-change: top, left, opacity;
                transition: opacity 2s ease-in-out;
            }
            
            .heart-svg {
                width: 100%; height: 100%;
                filter: blur(16px);
                fill: currentColor;
                display: block;
            }
            
            .container-2 {
                width: 240px; height: 240px;
                top: 20%; left: 20%;
                color: rgba(255, 120, 160, 0.5);
                animation: gentleFloat 8s ease-in-out infinite;
            }
            
            .container-2 .heart-svg {
                animation: realHeartBeat 8s ease-in-out infinite;
            }
            
            .container-3 {
                width: 160px; height: 160px;
                top: 60%; left: 70%;
                color: rgba(255, 140, 180, 0.6);
                animation: gentleFloat 6s ease-in-out infinite reverse;
            }
            
            .container-3 .heart-svg {
                filter: blur(24px);
                animation: realHeartBeat 8s ease-in-out infinite;
                animation-delay: 2s;
            }
            
            @keyframes realHeartBeat {
                0%   { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                5%   { transform: scale(1.08) rotate(0deg); opacity: 0.7; }
                10%  { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                15%  { transform: scale(1.12) rotate(3deg); opacity: 0.8; }
                20%  { transform: scale(1) rotate(-5deg); opacity: 0.5; }
                100% { transform: scale(1) rotate(-5deg); opacity: 0.5; }
            }
            
            @keyframes gentleFloat {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-20px); }
            }
            
            /* Snow theme colors */
            .decoration-particles.snow {
                --snow-color: rgba(255, 255, 255, 0.9);
            }
        `;
        document.head.appendChild(style);
    }

    // Generate decoration HTML based on theme
    function generateDecorationHTML(theme) {
        if (!theme || theme === 'none') return '';

        // Sunshine/Sunlight theme - Tyndall effect with 50 dust motes
        if (theme === 'sunshine' || theme === 'sunlight') {
            let dustParticles = '';
            // Create 50 dust motes (matching prompts-poetry.js)
            for (let i = 0; i < 50; i++) {
                const left = Math.random() * 100;
                const top = Math.random() * 100;
                // Precision Tune: 1.0px to 2.6px (Visible but refined)
                const size = 1.0 + Math.random() * 1.6;
                const duration = 20 + Math.random() * 20;
                const delay = Math.random() * -20;
                const opacity = 0.2 + Math.random() * 0.3;
                // Random Trajectory vars
                const tx = Math.random() * 100 - 50; // -50px to +50px drift
                const ty = Math.random() * -70 - 30; // -30px to -100px rise
                dustParticles += `<div class="dust-mote" data-announcement-dust="1" data-left="${left.toFixed(2)}" data-top="${top.toFixed(2)}" data-size="${size.toFixed(2)}" data-opacity="${opacity.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-delay="${delay.toFixed(2)}" data-tx="${tx.toFixed(2)}" data-ty="${ty.toFixed(2)}"></div>`;
            }
            return `<div class="decoration-container sunlight">
                <div class="sunlight-glow"></div>
                <div class="sunlight-beam layer-1"></div>
                <div class="sunlight-beam layer-2"></div>
                ${dustParticles}
            </div>`;
        }

        // Hearts theme
        if (theme === 'hearts') {
            return `<div class="decoration-pulsing-bg">
                <div class="heart-container container-2">
                    <svg class="heart-svg" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </div>
                <div class="heart-container container-3">
                    <svg class="heart-svg" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </div>
            </div>`;
        }

        // Rain theme - empty container for physics particles
        if (theme === 'rain') {
            return `<div class="decoration-particles rain"></div>`;
        }

        // Fireworks theme - empty container for physics particles
        if (theme === 'fireworks') {
            return `<div class="decoration-particles fireworks"></div>`;
        }

        // Particle-based themes (snow, sakura, leaves)
        const particleCounts = { snow: 24, sakura: 24, leaves: 12 };
        const count = particleCounts[theme] || 20;

        let particles = '';
        for (let i = 0; i < count; i++) {
            const left = Math.random() * 100;
            const depth = Math.random();
            const baseDuration = theme === 'rain' ? 2 : theme === 'snow' ? 15 : 12;
            const duration = baseDuration + ((1 - depth) * 10) + (Math.random() * 4 - 2);
            const delay = -Math.random() * duration;
            const size = 0.3 + (depth * 0.9);
            const driftOffset = Math.random() * 80 - 40;
            const fontSize = theme === 'rain' ? 8 + Math.random() * 4 :
                theme === 'snow' ? 12 + Math.random() * 6 :
                    theme === 'leaves' ? 14 + Math.random() * 8 :
                        theme === 'sakura' ? 16 + Math.random() * 6 : 12;
            const finalFontSize = fontSize * size;
            const opacity = 0.4 + (depth * 0.6);
            const blur = (1 - depth) * 1.5;

            let content = '✨';

            // SVG content for specific themes
            if (theme === 'sakura') {
                const colors = ['#fecdd3', '#fca5a5', '#fda4af', '#f43f5e'];
                const color = colors[Math.floor(Math.random() * colors.length)];
                content = `<svg viewBox="0 0 100 100" fill="currentColor" class="announcement-particle-svg"><path d="M50 90 C50 90 20 60 20 40 C20 25 30 10 45 20 C48 22 50 25 50 25 C50 25 52 22 55 20 C70 10 80 25 80 40 C80 60 50 90 50 90 Z" opacity="0.8"/></svg>`;
                particles += `<span class="decoration-particle" data-announcement-particle="1" data-left="${left.toFixed(2)}" data-delay="${delay.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-drift-x="${driftOffset.toFixed(2)}" data-size="${finalFontSize.toFixed(0)}" data-opacity="${opacity.toFixed(2)}" data-blur="${blur.toFixed(1)}" data-color="${color}">${content}</span>`;
                continue;
            } else if (theme === 'leaves') {
                const colors = ['#e06c75', '#d19a66', '#e5c07b', '#c678dd', '#be5046'];
                const color = colors[Math.floor(Math.random() * colors.length)];
                content = `<svg viewBox="0 0 24 24" fill="currentColor" class="announcement-particle-svg"><path d="M12.5,2C12.5,2 12.8,4.5 11,6C9,7.5 7,6 7,6L6,8C6,8 3,7.5 2,9C1,10.5 4,11 4,11L3,13C3,13 1,12.5 0,14C-1,15.5 2,16 2,16L3,18C3,18 2,19.5 4,20.5C6,21.5 7,19.5 7,19.5L9,21C9,21 10,22 13,22C16,22 16,19 16,19L17,20.5C17,20.5 19,20.5 20,19C21,17.5 19,16 19,16L21,14.5C21,14.5 23,14 22,12C21,10 19,10.5 19,10.5L20,8C20,8 19,6 17,6C15,6 14.5,8 14.5,8L12.5,2Z"/></svg>`;
                particles += `<span class="decoration-particle" data-announcement-particle="1" data-left="${left.toFixed(2)}" data-delay="${delay.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-drift-x="${driftOffset.toFixed(2)}" data-size="${finalFontSize.toFixed(0)}" data-opacity="${opacity.toFixed(2)}" data-blur="${blur.toFixed(1)}" data-color="${color}">${content}</span>`;
                continue;
            } else if (theme === 'snow') {
                const snowVariant = Math.random();
                let snowClass = 'announcement-particle--snow-crystal';
                let snowSize = finalFontSize;
                let snowOpacity = opacity;
                let snowBlur = blur;
                let snowColor = 'var(--announcement-snow-crystal-color, rgba(96,165,250,0.7))';

                if (snowVariant < 0.35) {
                    snowClass = 'announcement-particle--snow-dust';
                    snowSize = 2 + Math.random() * 2.5;
                    snowOpacity = 0.45 + Math.random() * 0.3;
                    snowBlur = 0.2 + Math.random() * 0.9;
                    snowColor = 'var(--announcement-snow-dust-color, rgba(147,197,253,0.58))';
                    content = '<span class="announcement-particle-snow-dot"></span>';
                } else if (snowVariant < 0.68) {
                    snowClass = 'announcement-particle--snow-soft';
                    snowSize = 5 + Math.random() * 5;
                    snowOpacity = 0.4 + Math.random() * 0.35;
                    snowBlur = 0.2 + Math.random() * 0.7;
                    snowColor = 'var(--announcement-snow-soft-color, rgba(125,211,252,0.5))';
                    content = '<span class="announcement-particle-snow-soft"></span>';
                } else {
                    content = `<svg viewBox="0 0 24 24" fill="none" class="announcement-particle-svg announcement-particle-svg--snow-crystal"><path d="M12,2L12,22 M2,12L22,12 M19.07,4.93L4.93,19.07 M19.07,19.07L4.93,4.93" class="announcement-particle-svg--stroke"/></svg>`;
                }

                particles += `<span class="decoration-particle ${snowClass}" data-announcement-particle="1" data-left="${left.toFixed(2)}" data-delay="${delay.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-drift-x="${driftOffset.toFixed(2)}" data-size="${snowSize.toFixed(1)}" data-opacity="${snowOpacity.toFixed(2)}" data-blur="${snowBlur.toFixed(1)}" data-color="${snowColor}">${content}</span>`;
                continue;
            }

            particles += `<span class="decoration-particle" data-announcement-particle="1" data-left="${left.toFixed(2)}" data-delay="${delay.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-drift-x="${driftOffset.toFixed(2)}" data-size="${finalFontSize.toFixed(0)}" data-opacity="${opacity.toFixed(2)}" data-blur="${blur.toFixed(1)}">${content}</span>`;
        }

        return `<div class="decoration-particles ${theme}">${particles}</div>`;
    }

    function hydrateDecorationParticleStyles(root) {
        if (!root) return;

        root.querySelectorAll('[data-announcement-dust="1"]').forEach((node) => {
            setAnnouncementStyleState(node, {
                '--announcement-dust-left': `${node.dataset.left || 0}%`,
                '--announcement-dust-top': `${node.dataset.top || 0}%`,
                '--announcement-dust-size': `${node.dataset.size || 1}px`,
                '--announcement-dust-opacity': node.dataset.opacity || 0.5,
                '--announcement-dust-duration': `${node.dataset.duration || 20}s`,
                '--announcement-dust-delay': `${node.dataset.delay || 0}s`,
                '--tx': `${node.dataset.tx || 0}px`,
                '--ty': `${node.dataset.ty || 0}px`
            });
        });

        root.querySelectorAll('[data-announcement-particle="1"]').forEach((node) => {
            setAnnouncementStyleState(node, {
                '--announcement-particle-left': `${node.dataset.left || 0}%`,
                '--announcement-particle-delay': `${node.dataset.delay || 0}s`,
                '--announcement-particle-duration': `${node.dataset.duration || 10}s`,
                '--drift-x': `${node.dataset.driftX || 0}px`,
                '--announcement-particle-size': `${node.dataset.size || 12}px`,
                '--announcement-particle-opacity': node.dataset.opacity || 1,
                '--announcement-particle-blur': `${node.dataset.blur || 0}px`,
                '--announcement-particle-color': node.dataset.color || ''
            });
        });
    }

    function bindAnnouncementActions(element, ackKey, options = {}) {
        const {
            dismissOnBackdrop = false,
            announcementConfig = null,
            currentPage = ''
        } = options;
        element.querySelector('[data-announcement-action="acknowledge"]')?.addEventListener('click', () => {
            void recordAnnouncementEvent(announcementConfig, currentPage, ackKey, 'read');
            dismissAnnouncement(element, ackKey, true);
        });

        if (dismissOnBackdrop) {
            element.addEventListener('click', (event) => {
                if (event.target === element) {
                    void recordAnnouncementEvent(announcementConfig, currentPage, ackKey, 'dismiss');
                    dismissAnnouncement(element, ackKey, false);
                }
            });
        }
    }

    function showBannerAnnouncement(color, size, content, ackKey, decoration, context = {}) {
        injectAnnouncementStyles();

        const decorationHTML = generateDecorationHTML(decoration);
        const banner = document.createElement('div');
        banner.className = 'zaoyoe-announcement-banner';
        banner.innerHTML = `
            ${decorationHTML}
            <i class="fas fa-bullhorn announcement-banner-icon"></i>
            <span class="zaoyoe-announcement-text">${content}</span>
            <button class="zaoyoe-announcement-close" data-announcement-action="acknowledge">已读</button>
        `;
        hydrateDecorationParticleStyles(banner);
        bindAnnouncementActions(banner, ackKey, context);
        document.body.appendChild(banner);
        currentAnnouncementElement = banner;

        // Start physics particles for rain theme
        startParticlesIfNeeded(banner, decoration);
    }

    function showModalAnnouncement(color, size, content, ackKey, decoration, context = {}) {
        injectAnnouncementStyles();

        const decorationHTML = generateDecorationHTML(decoration);
        const overlay = document.createElement('div');
        overlay.className = 'zaoyoe-announcement-overlay';
        overlay.innerHTML = `
            <div class="zaoyoe-announcement-modal">
                ${decorationHTML}
                <div class="zaoyoe-announcement-header">
                    <i class="fas fa-bullhorn"></i>
                    <span class="zaoyoe-announcement-title">站内公告</span>
                </div>
                <div class="zaoyoe-announcement-body">
                    <div class="zaoyoe-announcement-text">${content}</div>
                </div>
                <div class="zaoyoe-announcement-footer">
                    <button class="zaoyoe-announcement-ack-btn" data-announcement-action="acknowledge">已读</button>
                </div>
            </div>
        `;
        hydrateDecorationParticleStyles(overlay);
        bindAnnouncementActions(overlay, ackKey, { ...context, dismissOnBackdrop: true });

        document.body.appendChild(overlay);
        currentAnnouncementElement = overlay;
        lockAnnouncementBackground(overlay);

        // Start physics particles for rain theme
        const modal = overlay.querySelector('.zaoyoe-announcement-modal');
        if (modal) {
            startParticlesIfNeeded(modal, decoration);
        }
    }

    function showToastAnnouncement(color, size, content, ackKey, decoration, context = {}) {
        injectAnnouncementStyles();

        const decorationHTML = generateDecorationHTML(decoration);
        const toast = document.createElement('div');
        toast.className = 'zaoyoe-announcement-toast';
        toast.innerHTML = `
            ${decorationHTML}
            <div class="zaoyoe-announcement-header">
                <i class="fas fa-bullhorn"></i>
                <span class="zaoyoe-announcement-title">站内公告</span>
            </div>
            <div class="zaoyoe-announcement-body">
                <div class="zaoyoe-announcement-text">${content}</div>
            </div>
            <div class="zaoyoe-announcement-footer">
                <button class="zaoyoe-announcement-ack-btn" data-announcement-action="acknowledge">已读</button>
            </div>
        `;
        hydrateDecorationParticleStyles(toast);
        bindAnnouncementActions(toast, ackKey, context);

        document.body.appendChild(toast);
        currentAnnouncementElement = toast;
        lockAnnouncementBackground(toast);

        // Start physics particles for rain theme
        startParticlesIfNeeded(toast, decoration);
    }

    // ========================================
    // ParticleSystem - 物理粒子系统 (from prompts-poetry.js)
    // ========================================
    const ParticleSystem = {
        timer: null,
        frameId: null,
        particles: [],
        container: null,
        theme: null,
        width: 0,
        height: 0,
        lastTime: 0,

        init(container, theme) {
            this.stop(); // 清理旧的
            if (!container || !theme || theme === 'none') return;

            this.container = container;
            this.theme = theme;
            this.particles = [];

            // 强制容器样式，确保动画环境稳定
            container.classList.add('announcement-particle-host');

            // 更新尺寸
            this.updateDimensions();

            // 立即生成一批 (Pre-warm)
            let initialCount = 6;
            if (theme === 'rain') initialCount = 40;
            if (theme === 'fireworks') {
                // 烟花初始连发 3 个，错开时间
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => this.createParticle(), i * 400 + Math.random() * 200);
                }
                initialCount = 0;
            }

            this.spawnBatch(initialCount, true);

            // 启动循环
            this.frameId = requestAnimationFrame((t) => this.loop(t));

            // 定时生成
            this.scheduleSpawn();
        },

        stop() {
            if (this.timer) clearTimeout(this.timer);
            if (this.frameId) cancelAnimationFrame(this.frameId);
            if (this.container) {
                this.container.innerHTML = '';
            }
            this.particles = [];
            this.timer = null;
            this.frameId = null;
            this.container = null;
        },

        updateDimensions() {
            if (!this.container) return;
            this.width = this.container.clientWidth || 0;
            this.height = this.container.clientHeight || 0;
        },

        spawnBatch(count, preWarm = false) {
            for (let i = 0; i < count; i++) {
                let startY;
                if (preWarm && this.height > 0) {
                    startY = Math.random() * (this.height + 50) - 50;
                } else {
                    startY = -20 - Math.random() * 50;
                }
                this.createParticle(startY);
            }
        },

        scheduleSpawn() {
            let delay = 1800 + Math.random() * 1200;
            let maxParticles = 12;

            // 雨天模式：极速高密度
            if (this.theme === 'rain') {
                delay = 30 + Math.random() * 30;
                maxParticles = 80;
            }

            // 烟花模式：短间隔交错发射
            if (this.theme === 'fireworks') {
                delay = 300 + Math.random() * 500; // 0.3-0.8秒间隔（更密集）
                maxParticles = 150; // 允许更多粒子
            }

            this.timer = setTimeout(() => {
                if (this.container && this.particles.length < maxParticles) {
                    // 烟花连发逻辑：40% 概率触发连发
                    if (this.theme === 'fireworks' && Math.random() < 0.4) {
                        this.fireCombo();
                    } else {
                        this.createParticle();
                    }
                }
                this.scheduleSpawn();
            }, delay);
        },

        // 烟花连发
        fireCombo() {
            const count = 2 + Math.floor(Math.random() * 2); // 2-3个
            for (let i = 0; i < count; i++) {
                setTimeout(() => {
                    this.createParticle();
                }, i * 300 + Math.random() * 200);
            }
        },

        createParticle(startY = -30) {
            if (!this.container) return;

            // 防止宽度过小时堆积
            if (!this.width || this.width < 100) return;

            // --- 烟花火箭逻辑 ---
            if (this.theme === 'fireworks') {
                const el = document.createElement('div');
                const color = `hsl(${Math.random() * 360}, 100%, 70%)`;
                el.className = 'announcement-particle-layer announcement-particle-layer--firework-rocket';
                el.textContent = '✦';
                setAnnouncementStyleState(el, {
                    '--announcement-particle-color': color
                });

                this.container.appendChild(el);

                const p = {
                    el: el,
                    type: 'rocket',
                    subType: ['willow', 'peony', 'ring'][Math.floor(Math.random() * 3)],
                    x: 20 + Math.random() * (this.width - 40),
                    y: this.height,
                    targetY: this.height * 0.05 + Math.random() * (this.height * 0.25),
                    vx: (Math.random() - 0.5) * 1,
                    vy: -4 - Math.random() * 3,
                    state: 'rising',
                    opacity: 1,
                    color
                };
                this.particles.push(p);
                return;
            }

            // --- 雨滴逻辑 (CSS Streaks) ---
            if (this.theme === 'rain') {
                const el = document.createElement('div');
                el.className = 'announcement-particle-layer announcement-particle-layer--rain-streak';
                setAnnouncementStyleState(el, {
                    '--announcement-rain-width': `${1 + Math.random()}px`,
                    '--announcement-rain-height': `${60 + Math.random() * 60}px`,
                    '--announcement-opacity': 0.4 + Math.random() * 0.4
                });

                this.container.appendChild(el);

                const p = {
                    el: el,
                    type: 'rain',
                    x: 20 + Math.random() * Math.max(0, this.width - 40),
                    y: startY < 0 ? startY : -150,
                    speed: 25 + Math.random() * 15,
                    state: 'falling',
                    landingY: this.height
                };
                this.particles.push(p);
                return;
            }
        },

        createSplash(x, y) {
            const splashCount = 3 + Math.floor(Math.random() * 4);
            for (let i = 0; i < splashCount; i++) {
                const el = document.createElement('div');
                el.className = 'announcement-particle-layer announcement-particle-layer--splash';
                setAnnouncementTransformState(el, x, y);

                this.container.appendChild(el);

                this.particles.push({
                    el: el,
                    type: 'splash',
                    x: x,
                    y: y,
                    vx: (Math.random() - 0.5) * 4,
                    vy: -3 - Math.random() * 3,
                    friction: 0.95,
                    gravity: 0.5,
                    opacity: 1,
                    state: 'fading'
                });
            }
        },

        // 烟花爆炸
        explode(rocket) {
            const type = rocket.subType || 'willow';

            if (type === 'willow') {
                const sparkCount = 30 + Math.random() * 20;
                for (let i = 0; i < sparkCount; i++) {
                    this.createSpark(rocket, {
                        speed: 1 + Math.random() * 3,
                        gravity: 0.02,
                        friction: 0.97,
                        decay: 0.003,
                        color: Math.random() > 0.5 ? '#FFD700' : '#E0E0E0'
                    });
                }
            } else if (type === 'peony') {
                const sparkCount = 40 + Math.random() * 20;
                const baseHue = Math.random() * 360;
                for (let i = 0; i < sparkCount; i++) {
                    this.createSpark(rocket, {
                        speed: 2 + Math.random() * 4,
                        gravity: 0.03,
                        friction: 0.95,
                        decay: 0.006,
                        color: `hsl(${baseHue + Math.random() * 40}, 100%, 70%)`
                    });
                }
            } else if (type === 'ring') {
                const sparkCount = 36;
                const ringSpeed = 3 + Math.random() * 1;
                const color = `hsl(${Math.random() * 360}, 100%, 75%)`;
                for (let i = 0; i < sparkCount; i++) {
                    const angle = (i / sparkCount) * Math.PI * 2;
                    this.createSpark(rocket, {
                        vx: Math.cos(angle) * ringSpeed,
                        vy: Math.sin(angle) * ringSpeed,
                        gravity: 0.025,
                        friction: 0.98,
                        decay: 0.004,
                        color: color,
                        fixedSpeed: true
                    });
                }
            }
        },

        createSpark(rocket, cfg) {
            const el = document.createElement('div');
            el.className = 'announcement-particle-layer announcement-particle-layer--spark';
            setAnnouncementStyleState(el, {
                '--announcement-particle-color': cfg.color
            });

            this.container.appendChild(el);

            const angle = Math.random() * Math.PI * 2;
            const speed = cfg.speed || 2;

            this.particles.push({
                el: el,
                type: 'spark',
                x: rocket.x,
                y: rocket.y,
                vx: cfg.fixedSpeed ? cfg.vx : Math.cos(angle) * speed,
                vy: cfg.fixedSpeed ? cfg.vy : Math.sin(angle) * speed,
                gravity: cfg.gravity,
                friction: cfg.friction,
                opacity: 1,
                decay: cfg.decay
            });
        },

        loop(timestamp) {
            if (!this.container) return;

            if (!timestamp) timestamp = performance.now();

            if (!this.lastTime) this.lastTime = timestamp;
            const deltaTime = timestamp - this.lastTime;
            this.lastTime = timestamp;

            const timeScale = Math.min(deltaTime, 100) / 16.67;

            this.updateDimensions();

            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];

                // --- 雨滴物理 ---
                if (p.type === 'rain') {
                    let hzDampener = 1.0;
                    if (deltaTime < 10) hzDampener = 0.6;

                    p.y += p.speed * timeScale * hzDampener;
                    setAnnouncementTransformState(p.el, p.x, p.y);

                    if (p.y > this.height) {
                        this.createSplash(p.x, this.height);
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }

                // --- 烟花火箭物理 ---
                if (p.type === 'rocket') {
                    p.x += p.vx * timeScale;
                    p.y += p.vy * timeScale;
                    setAnnouncementTransformState(p.el, p.x, p.y);

                    if (p.y <= p.targetY) {
                        this.explode(p);
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }

                // --- 烟花火花物理 ---
                if (p.type === 'spark') {
                    p.vx *= Math.pow(p.friction, timeScale);
                    p.vy *= Math.pow(p.friction, timeScale);
                    p.vy += p.gravity * timeScale;
                    p.x += p.vx * timeScale;
                    p.y += p.vy * timeScale;
                    p.opacity -= p.decay * timeScale;

                    setAnnouncementOpacityState(p.el, p.opacity);
                    setAnnouncementTransformState(p.el, p.x, p.y);

                    if (p.opacity <= 0) {
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }

                // --- 水花物理 ---
                if (p.type === 'splash') {
                    p.vy += 0.5 * timeScale;
                    p.x += p.vx * timeScale;
                    p.y += p.vy * timeScale;
                    p.opacity -= 0.05 * timeScale;

                    setAnnouncementOpacityState(p.el, p.opacity);
                    setAnnouncementTransformState(p.el, p.x, p.y);

                    if (p.opacity <= 0) {
                        this.particles.splice(i, 1);
                        p.el.remove();
                    }
                    continue;
                }
            }

            this.frameId = requestAnimationFrame((t) => this.loop(t));
        }
    };

    // Helper to start particles for active physics themes
    function startParticlesIfNeeded(element, decoration) {
        if (decoration === 'rain' || decoration === 'fireworks') {
            // 需要延迟一帧等待 DOM 渲染完成
            requestAnimationFrame(() => {
                const container = element.querySelector('.decoration-particles');
                if (container) {
                    ParticleSystem.init(container, decoration);
                }
            });
        }
    }

    function startAnnouncementWhenBodyReady() {
        if (document.body) {
            startAnnouncementBootstrap();
            return;
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startAnnouncementBootstrap, { once: true });
            return;
        }

        window.setTimeout(startAnnouncementWhenBodyReady, 16);
    }

    void warmAnnouncementConfig();
    startAnnouncementWhenBodyReady();

    // Initialize again when DOM is ready as a safety net for late body insertion.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAnnouncementBootstrap, { once: true });
    } else if (document.body) {
        startAnnouncementBootstrap();
    }

    // Expose for debugging
    window.loadAnnouncementFromLoader = loadAnnouncement;
})();
