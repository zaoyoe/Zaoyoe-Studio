// Shared analytics AI runtime state helpers.

const analyticsAIState = {
    insightCache: null,
    insightCacheTime: 0,
    insightCacheKey: '',
    cacheDurationMs: 5 * 60 * 1000,
    insightDebounce: false
};

function getAnalyticsAIState() {
    return analyticsAIState;
}

function getAnalyticsInsightCacheValue() {
    return analyticsAIState.insightCache;
}

function getAnalyticsInsightCacheTimeValue() {
    return analyticsAIState.insightCacheTime;
}

function getAnalyticsInsightCacheKeyValue() {
    return analyticsAIState.insightCacheKey;
}

function getAnalyticsInsightCacheDuration() {
    return analyticsAIState.cacheDurationMs;
}

function setAnalyticsInsightCacheValue(value = null, contextKey = getAnalyticsAIContextKey(), timestamp = Date.now()) {
    analyticsAIState.insightCache = value || null;
    analyticsAIState.insightCacheTime = value ? Number(timestamp) || Date.now() : 0;
    analyticsAIState.insightCacheKey = value ? String(contextKey || '') : '';
    return analyticsAIState.insightCache;
}

function isAnalyticsInsightDebouncing() {
    return analyticsAIState.insightDebounce === true;
}

function setAnalyticsInsightDebouncing(isActive) {
    analyticsAIState.insightDebounce = isActive === true;
    return analyticsAIState.insightDebounce;
}

function resetAnalyticsAICache() {
    setAnalyticsInsightCacheValue(null, '', 0);
}

window.AdminAnalyticsAIState = Object.assign({}, window.AdminAnalyticsAIState || {}, {
    getAnalyticsAIState,
    getAnalyticsInsightCacheValue,
    getAnalyticsInsightCacheTimeValue,
    getAnalyticsInsightCacheKeyValue,
    getAnalyticsInsightCacheDuration,
    setAnalyticsInsightCacheValue,
    isAnalyticsInsightDebouncing,
    setAnalyticsInsightDebouncing,
    resetAnalyticsAICache
});
