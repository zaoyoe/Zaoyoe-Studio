// ========================================
// SERVICE WORKER - Legacy cache retirement
// ========================================

const LEGACY_CACHE_NAME_RE = /^(?:prompts-gallery|static|images)-v/i;

function shouldDeleteLegacyCache(cacheName) {
    return LEGACY_CACHE_NAME_RE.test(String(cacheName || ''));
}

async function clearLegacyCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames
            .filter(shouldDeleteLegacyCache)
            .map((cacheName) => caches.delete(cacheName))
    );
}

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await clearLegacyCaches();
        await self.clients.claim();
        await self.registration.unregister();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.action === 'skipWaiting' || event.data?.action === 'retireLegacyCaches') {
        event.waitUntil(clearLegacyCaches());
    }
});

console.log('[SW] Legacy Service Worker retired');
