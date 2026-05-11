(function (global) {
    'use strict';

    function normalizeSite(value, fallback = 'cn') {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'cn' || normalized === 'intl') {
            return normalized;
        }
        return fallback;
    }

    function detectRuntimeSite(rawSite = '') {
        const explicitSite = String(rawSite || '').trim().toLowerCase();
        if (explicitSite === 'cn' || explicitSite === 'intl') {
            return explicitSite;
        }

        const siteConfigSite = String(global.SiteConfig?.site || '').trim().toLowerCase();
        if (siteConfigSite === 'cn' || siteConfigSite === 'intl') {
            return siteConfigSite;
        }

        try {
            const siteParam = new URLSearchParams(global.location?.search || '').get('site');
            if (siteParam === 'cn' || siteParam === 'intl') {
                return siteParam;
            }
        } catch (_) {
            // ignore URL parsing failures
        }

        const host = String(global.location?.hostname || '').trim().toLowerCase();
        if (host === 'zaoyoe.xyz' || host.endsWith('.zaoyoe.xyz')) {
            return 'intl';
        }

        return normalizeSite(global.__ZAOYOE_RUNTIME_SITE__, 'cn');
    }

    function normalizeGoogleClientIds(rawValue, fallbackClientId = '') {
        const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
        const sharedFallback = String(fallbackClientId || '').trim();
        return {
            cn: String(source.cn || source.default || sharedFallback).trim(),
            intl: String(source.intl || source.default || sharedFallback).trim()
        };
    }

    function normalizeConfig(rawConfig) {
        const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const url = String(source.url || global.SUPABASE_URL || '').trim().replace(/\/+$/, '');
        const publishableKey = String(
            source.publishableKey
            || source.anonKey
            || global.SUPABASE_KEY
            || ''
        ).trim();

        if (!url || !publishableKey) {
            return null;
        }

        const currentSite = detectRuntimeSite(source.site);
        const authSource = source.auth && typeof source.auth === 'object' ? source.auth : {};
        const googleSource = authSource.google && typeof authSource.google === 'object' ? authSource.google : {};
        const fallbackGoogleClientId = String(
            googleSource.clientId
            || source.googleClientId
            || global.__ZAOYOE_GOOGLE_AUTH_CONFIG__?.clientId
            || ''
        ).trim();
        const googleClientIds = normalizeGoogleClientIds(
            googleSource.clientIds || source.googleClientIds || global.__ZAOYOE_GOOGLE_AUTH_CONFIG__?.clientIds,
            fallbackGoogleClientId
        );
        const googleClientId = String(
            googleClientIds[currentSite]
            || fallbackGoogleClientId
            || ''
        ).trim();

        return {
            url,
            publishableKey,
            site: currentSite,
            auth: {
                google: {
                    clientId: googleClientId,
                    clientIds: googleClientIds,
                    source: String(
                        googleSource.source
                        || source.googleClientSource
                        || global.__ZAOYOE_GOOGLE_AUTH_CONFIG__?.source
                        || ''
                    ).trim()
                }
            }
        };
    }

    function getZaoyoeSupabaseConfig() {
        return normalizeConfig(global.__ZAOYOE_SUPABASE_CONFIG__);
    }

    function requireZaoyoeSupabaseConfig() {
        const config = getZaoyoeSupabaseConfig();
        if (!config) {
            throw new Error('Supabase runtime config is unavailable');
        }
        return config;
    }

    function getZaoyoeGoogleAuthConfig(siteOverride = '') {
        const config = requireZaoyoeSupabaseConfig();
        const currentSite = detectRuntimeSite(siteOverride || config.site);
        const googleConfig = config.auth?.google && typeof config.auth.google === 'object'
            ? config.auth.google
            : {};
        const clientIds = normalizeGoogleClientIds(googleConfig.clientIds, googleConfig.clientId);
        return {
            site: currentSite,
            clientId: String(clientIds[currentSite] || googleConfig.clientId || '').trim(),
            clientIds,
            source: String(googleConfig.source || '').trim()
        };
    }

    function getZaoyoeGoogleClientId(siteOverride = '') {
        return getZaoyoeGoogleAuthConfig(siteOverride).clientId;
    }

    function getZaoyoeSupabaseFunctionUrl(functionName) {
        const config = requireZaoyoeSupabaseConfig();
        const normalizedName = String(functionName || '').trim().replace(/^\/+/, '');
        if (!normalizedName) {
            throw new Error('Supabase function name is required');
        }
        return `${config.url}/functions/v1/${normalizedName}`;
    }

    const REALTIME_DEGRADED_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

    function dispatchZaoyoeRealtimeState(detail = {}) {
        try {
            global.dispatchEvent?.(new CustomEvent('zaoyoe:realtime-state', {
                detail
            }));
        } catch (_) {
            // State events are diagnostic only.
        }
    }

    function subscribeZaoyoeRealtime(options = {}) {
        const client = options.client || global.supabaseClient || null;
        const channelName = String(options.channel || '').trim();
        const timeoutMs = Math.max(1000, Number(options.timeoutMs || 2600) || 2600);
        const feature = String(options.feature || channelName || 'realtime').trim();
        const removeOnDegraded = options.removeOnDegraded !== false;
        let channel = null;
        let subscribeTimer = null;
        let state = 'idle';

        const clearSubscribeTimer = () => {
            if (subscribeTimer) {
                global.clearTimeout(subscribeTimer);
                subscribeTimer = null;
            }
        };

        const notifyState = (status, detail = {}) => {
            dispatchZaoyoeRealtimeState({
                feature,
                channel: channelName,
                status,
                ...detail
            });
        };

        const markDegraded = (reason = 'channel_error', detail = {}) => {
            if (state === 'degraded') return;
            state = 'degraded';
            clearSubscribeTimer();

            if (removeOnDegraded && channel) {
                try {
                    if (typeof client?.removeChannel === 'function') {
                        client.removeChannel(channel);
                    } else {
                        channel.unsubscribe?.();
                    }
                } catch (error) {
                    console.warn('[Realtime] Failed to remove degraded channel:', error?.message || error);
                }
            }

            notifyState('degraded', { reason, ...detail });
            try {
                options.onDegraded?.(reason, detail);
            } catch (error) {
                console.warn('[Realtime] Degraded callback failed:', error?.message || error);
            }
        };

        const markActive = (detail = {}) => {
            state = 'active';
            clearSubscribeTimer();
            notifyState('active', detail);
            try {
                options.onActive?.(detail);
            } catch (error) {
                console.warn('[Realtime] Active callback failed:', error?.message || error);
            }
        };

        const unsubscribe = () => {
            clearSubscribeTimer();
            if (!channel) {
                state = 'closed';
                return;
            }
            try {
                if (typeof client?.removeChannel === 'function') {
                    client.removeChannel(channel);
                } else {
                    channel.unsubscribe?.();
                }
            } catch (error) {
                console.warn('[Realtime] Failed to remove channel:', error?.message || error);
            }
            state = 'closed';
            notifyState('closed');
        };

        if (!channelName || typeof client?.channel !== 'function') {
            markDegraded(!channelName ? 'missing_channel_name' : 'missing_realtime_client');
            return {
                channel: null,
                unsubscribe,
                getStatus: () => state
            };
        }

        try {
            state = 'connecting';
            notifyState('connecting');
            channel = client.channel(channelName, options.channelOptions || undefined);
            if (typeof options.build === 'function') {
                channel = options.build(channel) || channel;
            }

            subscribeTimer = global.setTimeout(() => {
                if (state !== 'active') {
                    markDegraded('subscribe_timeout');
                }
            }, timeoutMs);

            channel.subscribe((status, error) => {
                const normalizedStatus = String(status || '').trim().toUpperCase();
                try {
                    options.onStatus?.(normalizedStatus, error);
                } catch (callbackError) {
                    console.warn('[Realtime] Status callback failed:', callbackError?.message || callbackError);
                }

                if (normalizedStatus === 'SUBSCRIBED') {
                    markActive({ reason: 'subscribed' });
                    return;
                }

                if (REALTIME_DEGRADED_STATUSES.has(normalizedStatus)) {
                    markDegraded(normalizedStatus.toLowerCase(), {
                        error: error?.message || ''
                    });
                }
            });
        } catch (error) {
            markDegraded('subscribe_exception', {
                error: error?.message || String(error || '')
            });
        }

        return {
            channel,
            unsubscribe,
            getStatus: () => state
        };
    }

    const CLIENT_MONITORING_ENDPOINT = '/api/monitoring/client-event';
    const CLIENT_MONITORING_MAX_EVENTS = 6;
    const CLIENT_MONITORING_FINGERPRINT_TTL_MS = 60 * 1000;
    const clientMonitoringState = {
        reportedCount: 0,
        fingerprints: new Map()
    };

    function normalizeMonitoringText(value = '', maxLength = 1000) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function getClientMonitoringPath() {
        try {
            return `${global.location?.pathname || ''}${global.location?.search || ''}`.slice(0, 240);
        } catch (_) {
            return '';
        }
    }

    function getClientMonitoringFingerprint(payload = {}) {
        return [
            payload.kind,
            payload.message,
            payload.filename,
            payload.lineno,
            payload.colno,
            payload.path
        ].map((item) => normalizeMonitoringText(item, 160)).join('|');
    }

    function shouldSendClientMonitoringEvent(payload = {}) {
        const config = global.__ZAOYOE_CLIENT_MONITORING__ || {};
        if (config.enabled === false) {
            return false;
        }

        if (clientMonitoringState.reportedCount >= CLIENT_MONITORING_MAX_EVENTS) {
            return false;
        }

        const fingerprint = getClientMonitoringFingerprint(payload);
        const now = Date.now();
        const lastSeenAt = clientMonitoringState.fingerprints.get(fingerprint) || 0;
        if (lastSeenAt && now - lastSeenAt < CLIENT_MONITORING_FINGERPRINT_TTL_MS) {
            return false;
        }

        clientMonitoringState.fingerprints.set(fingerprint, now);
        clientMonitoringState.reportedCount += 1;
        return true;
    }

    function sendClientMonitoringEvent(payload = {}) {
        if (!shouldSendClientMonitoringEvent(payload)) {
            return false;
        }

        const endpoint = normalizeMonitoringText(global.__ZAOYOE_CLIENT_MONITORING__?.endpoint, 240) || CLIENT_MONITORING_ENDPOINT;
        const body = JSON.stringify(payload);

        try {
            if (global.navigator?.sendBeacon && typeof Blob === 'function') {
                const blob = new Blob([body], { type: 'application/json' });
                if (blob.size <= 32 * 1024 && global.navigator.sendBeacon(endpoint, blob)) {
                    return true;
                }
            }
        } catch (_) {
            // Monitoring should never affect the page runtime.
        }

        try {
            if (typeof global.fetch === 'function') {
                void global.fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body,
                    keepalive: true,
                    credentials: 'omit'
                }).catch(() => {});
                return true;
            }
        } catch (_) {
            // Fail-open: browser diagnostics are optional.
        }

        return false;
    }

    function buildClientMonitoringPayload(kind = 'runtime_error', source = {}, overrides = {}) {
        const error = source?.error || source?.reason || source || {};
        const message = normalizeMonitoringText(
            overrides.message
            || source?.message
            || error?.message
            || String(error || ''),
            1000
        ) || 'Frontend runtime error';

        return {
            kind: normalizeMonitoringText(kind, 80) || 'runtime_error',
            level: normalizeMonitoringText(overrides.level || 'error', 40) || 'error',
            message,
            stack: normalizeMonitoringText(overrides.stack || error?.stack || '', 4000),
            filename: normalizeMonitoringText(overrides.filename || source?.filename || '', 500),
            lineno: Number.isFinite(Number(overrides.lineno ?? source?.lineno)) ? Number(overrides.lineno ?? source?.lineno) : null,
            colno: Number.isFinite(Number(overrides.colno ?? source?.colno)) ? Number(overrides.colno ?? source?.colno) : null,
            href: normalizeMonitoringText(global.location?.href || '', 500),
            path: getClientMonitoringPath(),
            referrer: normalizeMonitoringText(global.document?.referrer || '', 500),
            site: detectRuntimeSite(),
            page: normalizeMonitoringText(global.document?.title || global.location?.pathname || '', 160),
            userAgentFamily: normalizeMonitoringText(global.navigator?.userAgent || '', 160),
            component: normalizeMonitoringText(overrides.component || '', 160),
            metadata: overrides.metadata && typeof overrides.metadata === 'object' ? overrides.metadata : null
        };
    }

    function captureZaoyoeClientError(error, context = {}) {
        return sendClientMonitoringEvent(buildClientMonitoringPayload('manual_capture', error, context));
    }

    function captureZaoyoeClientMessage(message = '', context = {}) {
        return sendClientMonitoringEvent(buildClientMonitoringPayload('manual_message', {
            message
        }, {
            ...context,
            level: context.level || 'info'
        }));
    }

    function installZaoyoeClientMonitoring() {
        if (global.__ZAOYOE_CLIENT_MONITORING_BOUND__ === true) {
            return;
        }
        global.__ZAOYOE_CLIENT_MONITORING_BOUND__ = true;

        try {
            global.addEventListener?.('error', (event) => {
                sendClientMonitoringEvent(buildClientMonitoringPayload('window_error', event));
            });
            global.addEventListener?.('unhandledrejection', (event) => {
                sendClientMonitoringEvent(buildClientMonitoringPayload('unhandled_rejection', event));
            });
        } catch (_) {
            // Optional diagnostics only.
        }
    }

    installZaoyoeClientMonitoring();

    global.getZaoyoeSupabaseConfig = getZaoyoeSupabaseConfig;
    global.getZaoyoeGoogleAuthConfig = getZaoyoeGoogleAuthConfig;
    global.getZaoyoeGoogleClientId = getZaoyoeGoogleClientId;
    global.requireZaoyoeSupabaseConfig = requireZaoyoeSupabaseConfig;
    global.getZaoyoeSupabaseFunctionUrl = getZaoyoeSupabaseFunctionUrl;
    global.subscribeZaoyoeRealtime = subscribeZaoyoeRealtime;
    global.ZaoyoeMonitoring = {
        captureException: captureZaoyoeClientError,
        captureMessage: captureZaoyoeClientMessage
    };
}(typeof window !== 'undefined' ? window : globalThis));
