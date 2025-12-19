// ========================================
// SERVICE WORKER - Performance Optimization
// ========================================

const CACHE_NAME = 'prompts-gallery-v2';
const STATIC_CACHE = 'static-v2';
const IMAGE_CACHE = 'images-v2';

// Static assets to cache immediately
const STATIC_ASSETS = [
    '/prompts.html',
    '/prompts-poetry.css',
    '/prompts-poetry.js',
    '/prompts-data.js',
    '/supabase-client.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== STATIC_CACHE && cacheName !== IMAGE_CACHE) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - handle requests with appropriate strategy
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests except for images and fonts
    const isSameOrigin = url.origin === location.origin;
    const isImageRequest = event.request.destination === 'image' ||
        url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
    const isFontRequest = event.request.destination === 'font' ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com');
    const isSupabaseStorage = url.hostname.includes('supabase.co') &&
        url.pathname.includes('/storage/');

    // Handle image requests (cache-first with network fallback)
    if (isImageRequest || isSupabaseStorage) {
        event.respondWith(
            caches.open(IMAGE_CACHE).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    if (cachedResponse) {
                        // Return cached image immediately
                        // Also update cache in background
                        fetch(event.request).then(networkResponse => {
                            if (networkResponse.ok) {
                                cache.put(event.request, networkResponse);
                            }
                        }).catch(() => { });
                        return cachedResponse;
                    }

                    // Not in cache, fetch and cache
                    return fetch(event.request).then(networkResponse => {
                        if (networkResponse.ok) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => {
                        // Return a placeholder if offline
                        return new Response('', { status: 404 });
                    });
                });
            })
        );
        return;
    }

    // Handle font requests (cache-first)
    if (isFontRequest) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;

                return fetch(event.request).then(networkResponse => {
                    if (networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(STATIC_CACHE).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // Handle static assets (stale-while-revalidate)
    if (isSameOrigin) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(STATIC_CACHE).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                });

                // Return cached response immediately, update in background
                return cachedResponse || fetchPromise;
            })
        );
    }
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
    if (event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});

console.log('[SW] Service Worker loaded');
