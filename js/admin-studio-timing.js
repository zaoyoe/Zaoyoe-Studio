(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : globalThis;
    if (root.AdminStudioTiming?.version) {
        return;
    }

    const VERSION = '20260430_ADMIN_STUDIO_TIMING_1';
    const PERFORMANCE_PREFIX = 'admin-studio:';
    const MAX_DETAIL_KEYS = 24;
    const MAX_DETAIL_ARRAY_ITEMS = 12;
    const MAX_DETAIL_TEXT_LENGTH = 180;
    const state = {
        marks: [],
        measures: []
    };

    function normalizeName(name = '') {
        return String(name || '').trim().replace(/\s+/g, '-').slice(0, 160);
    }

    function normalizeDetailValue(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === 'string') {
            return value.slice(0, MAX_DETAIL_TEXT_LENGTH);
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            return value
                .slice(0, MAX_DETAIL_ARRAY_ITEMS)
                .map((item) => normalizeDetailValue(item));
        }
        return String(value).slice(0, MAX_DETAIL_TEXT_LENGTH);
    }

    function normalizeDetail(detail = {}) {
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
            return {};
        }

        return Object.keys(detail)
            .slice(0, MAX_DETAIL_KEYS)
            .reduce((memo, key) => {
                memo[key] = normalizeDetailValue(detail[key]);
                return memo;
            }, {});
    }

    function getNow() {
        const performanceRef = root.performance;
        if (performanceRef && typeof performanceRef.now === 'function') {
            return performanceRef.now();
        }
        return Date.now();
    }

    function markPerformance(name, detail) {
        const performanceRef = root.performance;
        if (!performanceRef || typeof performanceRef.mark !== 'function') {
            return;
        }
        try {
            performanceRef.mark(`${PERFORMANCE_PREFIX}${name}`, { detail });
        } catch (error) {
            try {
                performanceRef.mark(`${PERFORMANCE_PREFIX}${name}`);
            } catch (_) {
                // Ignore browsers that expose partial Performance APIs.
            }
        }
    }

    function measurePerformance(name, startName, endName) {
        const performanceRef = root.performance;
        if (!performanceRef || typeof performanceRef.measure !== 'function') {
            return;
        }
        try {
            if (endName) {
                performanceRef.measure(
                    `${PERFORMANCE_PREFIX}${name}`,
                    `${PERFORMANCE_PREFIX}${startName}`,
                    `${PERFORMANCE_PREFIX}${endName}`
                );
            } else {
                performanceRef.measure(`${PERFORMANCE_PREFIX}${name}`, `${PERFORMANCE_PREFIX}${startName}`);
            }
        } catch (error) {
            // User Timing marks are best-effort; in-memory timing remains available.
        }
    }

    function cloneEntry(entry) {
        return {
            ...entry,
            detail: { ...(entry.detail || {}) }
        };
    }

    function findLastMark(name = '') {
        const normalizedName = normalizeName(name);
        for (let index = state.marks.length - 1; index >= 0; index -= 1) {
            if (state.marks[index].name === normalizedName) {
                return state.marks[index];
            }
        }
        return null;
    }

    function mark(name = '', detail = {}) {
        const normalizedName = normalizeName(name);
        if (!normalizedName) {
            return null;
        }

        const normalizedDetail = normalizeDetail(detail);
        const entry = {
            name: normalizedName,
            at: getNow(),
            timestamp: Date.now(),
            detail: normalizedDetail
        };
        state.marks.push(entry);
        markPerformance(normalizedName, normalizedDetail);
        return cloneEntry(entry);
    }

    function markOnce(name = '', detail = {}) {
        const normalizedName = normalizeName(name);
        const existing = findLastMark(normalizedName);
        if (existing) {
            return cloneEntry(existing);
        }
        return mark(normalizedName, detail);
    }

    function measure(name = '', startName = '', endName = '', detail = {}) {
        const normalizedName = normalizeName(name);
        const normalizedStartName = normalizeName(startName);
        const normalizedEndName = normalizeName(endName);
        const startEntry = findLastMark(normalizedStartName);
        if (!normalizedName || !startEntry) {
            return null;
        }

        const endEntry = normalizedEndName ? findLastMark(normalizedEndName) : null;
        const endAt = endEntry ? endEntry.at : getNow();
        const normalizedDetail = normalizeDetail(detail);
        const entry = {
            name: normalizedName,
            startName: normalizedStartName,
            endName: normalizedEndName,
            at: endAt,
            duration: Math.max(0, endAt - startEntry.at),
            timestamp: Date.now(),
            detail: normalizedDetail
        };
        state.measures.push(entry);
        measurePerformance(normalizedName, normalizedStartName, normalizedEndName);
        return cloneEntry(entry);
    }

    function getMarks() {
        return state.marks.map(cloneEntry);
    }

    function getMeasures() {
        return state.measures.map(cloneEntry);
    }

    function snapshot() {
        return {
            version: VERSION,
            marks: getMarks(),
            measures: getMeasures()
        };
    }

    function reset() {
        state.marks.length = 0;
        state.measures.length = 0;
        return snapshot();
    }

    root.AdminStudioTiming = {
        version: VERSION,
        mark,
        markOnce,
        measure,
        getMarks,
        getMeasures,
        snapshot,
        reset
    };
})();
