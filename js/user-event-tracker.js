/**
 * Shared user event tracker for Phase 3 analytics events.
 * Writes directly to user_events when possible and falls back to track_event RPC.
 */
(function () {
    'use strict';

    const SESSION_STORAGE_KEY = 'user_event_tracker_session_id_v1';
    const ONCE_STORAGE_PREFIX = 'user_event_tracker_once_v1:';
    const EXPERIMENT_ASSIGNMENT_STORAGE_PREFIX = 'user_event_tracker_experiment_assignment_v1:';
    const USER_CACHE_TTL_MS = 15000;
    const EXPERIMENT_ASSIGNMENT_TTL_MS = 30 * 60 * 1000;

    let trackerInitialized = false;
    let cachedUser = null;
    let cachedUserFetchedAt = 0;
    const experimentAssignmentCache = new Map();

    function getSupabaseClient() {
        return window.supabaseClient || null;
    }

    function getCurrentSiteValue() {
        return String(window.SiteConfig?.site || 'cn').trim() || 'cn';
    }

    function getCurrentPagePath() {
        return String(window.location?.pathname || '/').trim() || '/';
    }

    function getCurrentPageName() {
        const path = getCurrentPagePath();
        if (path === '/' || path === '/index.html') return 'home';
        return path.replace(/^\/+/, '') || 'home';
    }

    function canUseSessionStorage() {
        try {
            return typeof window.sessionStorage !== 'undefined';
        } catch (_error) {
            return false;
        }
    }

    function readSessionValue(key) {
        if (!canUseSessionStorage()) return '';
        try {
            return window.sessionStorage.getItem(key) || '';
        } catch (_error) {
            return '';
        }
    }

    function writeSessionValue(key, value) {
        if (!canUseSessionStorage()) return;
        try {
            window.sessionStorage.setItem(key, value);
        } catch (_error) {
            // Ignore storage failures on privacy-restricted browsers.
        }
    }

    function generateSessionId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `sess_${crypto.randomUUID()}`;
        }
        return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    function getSessionId() {
        const existing = readSessionValue(SESSION_STORAGE_KEY);
        if (existing) return existing;

        const generated = generateSessionId();
        writeSessionValue(SESSION_STORAGE_KEY, generated);
        return generated;
    }

    function sanitizeEventValue(value, depth = 0) {
        if (value === null || value === undefined) return null;
        if (depth > 4) return null;

        if (Array.isArray(value)) {
            return value
                .slice(0, 24)
                .map((item) => sanitizeEventValue(item, depth + 1))
                .filter((item) => item !== undefined);
        }

        if (typeof value === 'object') {
            const entries = Object.entries(value).slice(0, 40);
            return entries.reduce((accumulator, [key, entryValue]) => {
                const normalizedValue = sanitizeEventValue(entryValue, depth + 1);
                if (normalizedValue !== null && normalizedValue !== undefined && normalizedValue !== '') {
                    accumulator[key] = normalizedValue;
                }
                return accumulator;
            }, {});
        }

        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        return String(value);
    }

    function pruneEmptyFields(payload = {}) {
        return Object.entries(payload).reduce((accumulator, [key, value]) => {
            if (value === null || value === undefined || value === '') {
                return accumulator;
            }

            if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
                return accumulator;
            }

            accumulator[key] = value;
            return accumulator;
        }, {});
    }

    function buildEventData(payload = {}) {
        const normalizedPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload
            : {};
        const normalizedMetadata = sanitizeEventValue(normalizedPayload.metadata || {});

        return pruneEmptyFields({
            site: getCurrentSiteValue(),
            page: getCurrentPagePath(),
            module: String(normalizedPayload.module || '').trim() || null,
            entity_type: String(normalizedPayload.entityType || normalizedPayload.entity_type || '').trim() || null,
            entity_id: normalizedPayload.entityId ?? normalizedPayload.entity_id ?? null,
            event_value: normalizedPayload.eventValue ?? normalizedPayload.event_value ?? null,
            points_delta: normalizedPayload.pointsDelta ?? normalizedPayload.points_delta ?? null,
            experiment_id: normalizedPayload.experimentId ?? normalizedPayload.experiment_id ?? null,
            variant_id: normalizedPayload.variantId ?? normalizedPayload.variant_id ?? null,
            referrer: document.referrer || null,
            metadata: normalizedMetadata && typeof normalizedMetadata === 'object' ? normalizedMetadata : {}
        });
    }

    async function getAuthenticatedUser() {
        const supabase = getSupabaseClient();
        if (!supabase?.auth || typeof supabase.auth.getUser !== 'function') {
            return null;
        }

        const now = Date.now();
        if (cachedUserFetchedAt > 0 && (now - cachedUserFetchedAt) < USER_CACHE_TTL_MS) {
            return cachedUser;
        }

        try {
            const { data: { user } = {} } = await supabase.auth.getUser();
            cachedUser = user || null;
            cachedUserFetchedAt = now;
            return cachedUser;
        } catch (_error) {
            cachedUser = null;
            cachedUserFetchedAt = now;
            return null;
        }
    }

    async function insertEventDirectly(userId, eventType, eventName, eventData) {
        const supabase = getSupabaseClient();
        if (!supabase) {
            throw new Error('Supabase client not ready');
        }

        const payload = {
            user_id: userId,
            session_id: getSessionId(),
            event_type: eventType,
            event_name: eventName,
            event_data: eventData,
            page_url: window.location.href,
            referrer: document.referrer || null,
            user_agent: navigator.userAgent || null,
            site: getCurrentSiteValue(),
            created_at: new Date().toISOString()
        };

        const { error } = await supabase.from('user_events').insert(payload);
        if (error) {
            throw error;
        }
        return true;
    }

    async function insertEventViaRpc(eventType, eventName, eventData) {
        const supabase = getSupabaseClient();
        if (!supabase) {
            throw new Error('Supabase client not ready');
        }

        const { data, error } = await supabase.rpc('track_event', {
            p_event_type: eventType,
            p_event_name: eventName,
            p_event_data: eventData,
            p_page_url: window.location.href,
            p_session_id: getSessionId()
        });

        if (error) {
            throw error;
        }

        return data || true;
    }

    function hasTrackedOnce(dedupeKey) {
        if (!dedupeKey) return false;
        return Boolean(readSessionValue(`${ONCE_STORAGE_PREFIX}${dedupeKey}`));
    }

    function markTrackedOnce(dedupeKey) {
        if (!dedupeKey) return;
        writeSessionValue(`${ONCE_STORAGE_PREFIX}${dedupeKey}`, '1');
    }

    function isExperimentControlVariant(variantName = '') {
        const normalized = String(variantName || '').trim().toLowerCase();
        return ['control', 'default', 'baseline', 'original'].includes(normalized);
    }

    function getExperimentAssignmentCacheKey(experimentName = '') {
        return `${getCurrentSiteValue()}:${String(experimentName || '').trim().toLowerCase()}`;
    }

    function readCachedExperimentAssignment(experimentName = '') {
        const cacheKey = getExperimentAssignmentCacheKey(experimentName);
        if (!cacheKey) return null;

        const memoryValue = experimentAssignmentCache.get(cacheKey);
        if (memoryValue && Number(memoryValue.expiresAt || 0) > Date.now()) {
            return memoryValue.assignment || null;
        }
        experimentAssignmentCache.delete(cacheKey);

        const raw = readSessionValue(`${EXPERIMENT_ASSIGNMENT_STORAGE_PREFIX}${cacheKey}`);
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            if (parsed && Number(parsed.expiresAt || 0) > Date.now() && parsed.assignment) {
                experimentAssignmentCache.set(cacheKey, parsed);
                return parsed.assignment;
            }
        } catch (_error) {
            // Ignore malformed cache payloads.
        }

        writeSessionValue(`${EXPERIMENT_ASSIGNMENT_STORAGE_PREFIX}${cacheKey}`, '');
        return null;
    }

    function writeCachedExperimentAssignment(experimentName = '', assignment = null) {
        const cacheKey = getExperimentAssignmentCacheKey(experimentName);
        if (!cacheKey || !assignment) return;

        const payload = {
            expiresAt: Date.now() + EXPERIMENT_ASSIGNMENT_TTL_MS,
            assignment
        };
        experimentAssignmentCache.set(cacheKey, payload);
        writeSessionValue(`${EXPERIMENT_ASSIGNMENT_STORAGE_PREFIX}${cacheKey}`, JSON.stringify(payload));
    }

    function normalizeExperimentAssignment(experimentName = '', rawAssignment = null) {
        if (!rawAssignment) return null;

        const normalizedName = String(experimentName || '').trim();
        const objectPayload = rawAssignment && typeof rawAssignment === 'object' && !Array.isArray(rawAssignment)
            ? rawAssignment
            : { variant_name: rawAssignment };
        const variantName = String(
            objectPayload.variant_name
            || objectPayload.variant
            || objectPayload.name
            || ''
        ).trim();

        if (!normalizedName || !variantName) {
            return null;
        }

        return {
            experimentName: normalizedName,
            variantName,
            isControl: isExperimentControlVariant(variantName),
            assigned: objectPayload.assigned !== false
        };
    }

    const trackerApi = {
        getSessionId,

        async track(eventName, payload = {}, options = {}) {
            const normalizedEventName = String(eventName || '').trim();
            if (!normalizedEventName) return null;

            const dedupeKey = String(options.dedupeKey || '').trim();
            if (dedupeKey && hasTrackedOnce(dedupeKey)) {
                return null;
            }

            const user = await getAuthenticatedUser();
            const userId = String(user?.id || '').trim();
            if (!userId) {
                return null;
            }

            const eventType = String(options.eventType || payload.eventType || 'engagement').trim() || 'engagement';
            const eventData = buildEventData(payload);

            try {
                await insertEventDirectly(userId, eventType, normalizedEventName, eventData);
            } catch (directError) {
                try {
                    await insertEventViaRpc(eventType, normalizedEventName, eventData);
                } catch (rpcError) {
                    console.debug('[UserEventTracker] Failed to track event:', normalizedEventName, directError?.message || directError, rpcError?.message || rpcError);
                    return null;
                }
            }

            if (dedupeKey) {
                markTrackedOnce(dedupeKey);
            }

            return true;
        },

        async trackOnce(dedupeKey, eventName, payload = {}, options = {}) {
            return this.track(eventName, payload, { ...options, dedupeKey });
        },

        async pageView(payload = {}) {
            const pageName = String(payload.page || getCurrentPageName()).trim() || getCurrentPagePath();
            return this.trackOnce(
                `page_view:${getCurrentSiteValue()}:${pageName}`,
                'page_view',
                {
                    module: payload.module || 'site_page',
                    entityType: 'page',
                    entityId: pageName,
                    metadata: {
                        page_name: pageName,
                        page_path: getCurrentPagePath(),
                        ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {})
                    }
                },
                { eventType: 'navigation' }
            );
        },

        async heartbeat(payload = {}) {
            return this.track(
                'heartbeat_ping',
                {
                    module: payload.module || 'heartbeat',
                    entityType: 'page',
                    entityId: getCurrentPageName(),
                    metadata: {
                        visibility: document.visibilityState || 'unknown',
                        ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {})
                    }
                },
                { eventType: 'heartbeat' }
            );
        },

        async getExperimentAssignment(experimentName, options = {}) {
            const normalizedExperimentName = String(experimentName || '').trim();
            if (!normalizedExperimentName) {
                return null;
            }

            const user = await getAuthenticatedUser();
            const userId = String(user?.id || '').trim();
            if (!userId) {
                return null;
            }

            const cachedAssignment = readCachedExperimentAssignment(normalizedExperimentName);
            if (cachedAssignment) {
                if (options.trackExposure !== false) {
                    await this.trackOnce(
                        `experiment_exposure:${getCurrentSiteValue()}:${normalizedExperimentName}:${cachedAssignment.variantName}:${String(options.placement || 'default').trim() || 'default'}`,
                        'experiment_exposure',
                        {
                            module: options.module || 'experiment_runtime',
                            entityType: options.entityType || 'experiment',
                            entityId: options.entityId || normalizedExperimentName,
                            experimentId: normalizedExperimentName,
                            variantId: cachedAssignment.variantName,
                            metadata: {
                                experiment_name: normalizedExperimentName,
                                variant_name: cachedAssignment.variantName,
                                placement: String(options.placement || '').trim() || null,
                                ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {})
                            }
                        },
                        { eventType: 'engagement' }
                    );
                }
                return cachedAssignment;
            }

            const supabase = getSupabaseClient();
            if (!supabase || typeof supabase.rpc !== 'function') {
                return null;
            }

            try {
                const { data, error } = await supabase.rpc('get_experiment_variant', {
                    p_experiment_name: normalizedExperimentName
                });
                if (error) {
                    throw error;
                }

                const assignment = normalizeExperimentAssignment(normalizedExperimentName, data);
                if (!assignment) {
                    return null;
                }

                writeCachedExperimentAssignment(normalizedExperimentName, assignment);

                if (options.trackExposure !== false) {
                    await this.trackOnce(
                        `experiment_exposure:${getCurrentSiteValue()}:${normalizedExperimentName}:${assignment.variantName}:${String(options.placement || 'default').trim() || 'default'}`,
                        'experiment_exposure',
                        {
                            module: options.module || 'experiment_runtime',
                            entityType: options.entityType || 'experiment',
                            entityId: options.entityId || normalizedExperimentName,
                            experimentId: normalizedExperimentName,
                            variantId: assignment.variantName,
                            metadata: {
                                experiment_name: normalizedExperimentName,
                                variant_name: assignment.variantName,
                                placement: String(options.placement || '').trim() || null,
                                ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {})
                            }
                        },
                        { eventType: 'engagement' }
                    );
                }

                return assignment;
            } catch (error) {
                console.debug('[UserEventTracker] Failed to resolve experiment assignment:', normalizedExperimentName, error?.message || error);
                return null;
            }
        }
    };

    function scheduleInitialPageView() {
        const run = () => {
            void trackerApi.pageView();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run, { once: true });
            return;
        }

        run();
    }

    function initTracker() {
        if (trackerInitialized) return;
        trackerInitialized = true;
        window.UserEventTracker = trackerApi;
        scheduleInitialPageView();
    }

    initTracker();
})();
