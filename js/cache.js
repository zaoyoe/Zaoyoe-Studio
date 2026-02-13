/**
 * cache.js - LocalStorage Cache Utility
 * 
 * Provides caching for API data to enable instant second-visit loading.
 * Data is stored with TTL (Time To Live) and automatically expires.
 */

(function () {
    'use strict';

    const SITE_ID = window.SiteConfig?.site || 'cn';
    const CACHE_PREFIX = `zaoyoe_${SITE_ID}_cache_`;
    const CACHE_VERSION = 'v1'; // Bump this to invalidate all caches on update

    /**
     * Load data with cache support
     * 
     * @param {string} key - Cache key
     * @param {Function} fetchFn - Async function to fetch fresh data
     * @param {number} ttlMinutes - Time to live in minutes (default: 30)
     * @returns {Promise<any>} - Cached or fresh data
     */
    async function loadWithCache(key, fetchFn, ttlMinutes = 30) {
        const cacheKey = `${CACHE_PREFIX}${CACHE_VERSION}_${key}`;

        try {
            // Try to load from cache
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;
                const ttl = ttlMinutes * 60 * 1000;

                if (age < ttl) {
                    console.log(`📦 Cache hit: ${key} (${Math.round(age / 1000)}s old)`);
                    return data;
                } else {
                    console.log(`📦 Cache expired: ${key}`);
                }
            }
        } catch (e) {
            console.warn(`📦 Cache read error for ${key}:`, e);
        }

        // Fetch fresh data
        console.log(`📦 Cache miss: ${key}, fetching...`);
        const freshData = await fetchFn();

        // Save to cache
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                data: freshData,
                timestamp: Date.now()
            }));
            console.log(`📦 Cache saved: ${key}`);
        } catch (e) {
            console.warn(`📦 Cache write error for ${key}:`, e);
            // localStorage might be full, try to clean up
            cleanOldCaches();
        }

        return freshData;
    }

    /**
     * Invalidate a specific cache
     */
    function invalidateCache(key) {
        const cacheKey = `${CACHE_PREFIX}${CACHE_VERSION}_${key}`;
        localStorage.removeItem(cacheKey);
        console.log(`📦 Cache invalidated: ${key}`);
    }

    /**
     * Invalidate all caches
     */
    function invalidateAllCaches() {
        const keys = Object.keys(localStorage);
        let count = 0;
        keys.forEach(key => {
            if (key.startsWith(CACHE_PREFIX)) {
                localStorage.removeItem(key);
                count++;
            }
        });
        console.log(`📦 Cleared ${count} cached items`);
    }

    /**
     * Clean up old version caches
     */
    function cleanOldCaches() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(CACHE_PREFIX) && !key.includes(CACHE_VERSION)) {
                localStorage.removeItem(key);
            }
        });
    }

    /**
     * Get cache statistics
     */
    function getCacheStats() {
        const keys = Object.keys(localStorage);
        const cacheKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));
        let totalSize = 0;

        cacheKeys.forEach(key => {
            totalSize += localStorage.getItem(key)?.length || 0;
        });

        return {
            count: cacheKeys.length,
            sizeKB: Math.round(totalSize / 1024)
        };
    }

    // Clean old caches on load
    cleanOldCaches();

    // Expose API globally
    window.Cache = {
        loadWithCache,
        invalidateCache,
        invalidateAllCaches,
        getCacheStats,
        // Convenience aliases
        get: loadWithCache,
        clear: invalidateAllCaches
    };

})();
