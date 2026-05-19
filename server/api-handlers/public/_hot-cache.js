function normalizePositiveInteger(value, fallback, minimum = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return Math.max(minimum, fallback);
    }
    return Math.max(minimum, Math.floor(numericValue));
}

function cloneHotCacheValue(value) {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (_) {
            // Fall through to the JSON clone for response-shaped payloads.
        }
    }

    return JSON.parse(JSON.stringify(value));
}

function createHotCache(options = {}) {
    const ttlMs = normalizePositiveInteger(options.ttlMs, 0, 0);
    const maxEntries = normalizePositiveInteger(options.maxEntries, 128, 1);
    const entries = new Map();

    function isFresh(entry, nowMs = Date.now()) {
        return Boolean(entry?.hasValue) && nowMs - Number(entry.cachedAt || 0) <= ttlMs;
    }

    function trim() {
        if (entries.size <= maxEntries) return;

        const nowMs = Date.now();
        for (const [key, entry] of entries.entries()) {
            if (!entry?.promise && !isFresh(entry, nowMs)) {
                entries.delete(key);
            }
        }

        while (entries.size > maxEntries) {
            const oldestKey = entries.keys().next().value;
            if (!oldestKey) break;
            entries.delete(oldestKey);
        }
    }

    async function getOrLoad(key, loader, optionsForCall = {}) {
        const normalizedKey = String(key || '').trim();
        const forceRefresh = optionsForCall.forceRefresh === true;

        if (!ttlMs || !normalizedKey || typeof loader !== 'function') {
            return {
                status: 'disabled',
                value: await loader()
            };
        }

        const nowMs = Date.now();
        const existing = entries.get(normalizedKey);
        if (!forceRefresh && isFresh(existing, nowMs)) {
            return {
                status: 'hit',
                value: cloneHotCacheValue(existing.value)
            };
        }

        if (!forceRefresh && existing?.promise) {
            return {
                status: 'wait',
                value: cloneHotCacheValue(await existing.promise)
            };
        }

        const loadPromise = Promise.resolve().then(loader);
        entries.set(normalizedKey, {
            cachedAt: nowMs,
            hasValue: false,
            promise: loadPromise
        });
        trim();

        try {
            const value = await loadPromise;
            const cachedValue = cloneHotCacheValue(value);
            entries.set(normalizedKey, {
                cachedAt: Date.now(),
                hasValue: true,
                value: cachedValue
            });
            trim();

            return {
                status: forceRefresh ? 'refresh' : 'miss',
                value: cloneHotCacheValue(cachedValue)
            };
        } catch (error) {
            if (existing) {
                entries.set(normalizedKey, existing);
            } else {
                entries.delete(normalizedKey);
            }
            throw error;
        }
    }

    function clear() {
        entries.clear();
    }

    return {
        clear,
        getOrLoad
    };
}

function sanitizeServerTimingName(name = '') {
    const normalized = String(name || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-');
    return normalized || 'zaoyoe';
}

function sanitizeServerTimingDescription(value = '') {
    return String(value || '').replace(/["\\]/g, '').slice(0, 80);
}

function formatServerTiming(metrics = []) {
    return (Array.isArray(metrics) ? metrics : [])
        .map((metric) => {
            const name = sanitizeServerTimingName(metric?.name);
            const parts = [name];
            const durationMs = Number(metric?.durationMs);
            if (Number.isFinite(durationMs)) {
                parts.push(`dur=${Math.max(0, Math.round(durationMs))}`);
            }
            const description = sanitizeServerTimingDescription(metric?.description);
            if (description) {
                parts.push(`desc="${description}"`);
            }
            return parts.join(';');
        })
        .filter(Boolean)
        .join(', ');
}

function applyHotCacheResponseHeaders(res, {
    label = 'zaoyoe',
    status = 'miss',
    totalMs = 0,
    loadMs = 0
} = {}) {
    if (!res?.setHeader) return;

    const normalizedLabel = sanitizeServerTimingName(label);
    const normalizedStatus = String(status || 'miss').trim().toLowerCase() || 'miss';
    res.setHeader('X-Zaoyoe-Cache', normalizedStatus);
    res.setHeader('Server-Timing', formatServerTiming([
        {
            name: `${normalizedLabel}-cache`,
            durationMs: loadMs,
            description: normalizedStatus
        },
        {
            name: `${normalizedLabel}-total`,
            durationMs: totalMs
        }
    ]));
}

module.exports = {
    applyHotCacheResponseHeaders,
    cloneHotCacheValue,
    createHotCache,
    formatServerTiming
};
