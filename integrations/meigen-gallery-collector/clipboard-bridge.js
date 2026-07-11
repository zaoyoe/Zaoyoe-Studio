(function fatherKeyMeigenClipboardBridge() {
    'use strict';

    if (window.__FatherKeyMeigenClipboardBridgeInstalled) return;
    window.__FatherKeyMeigenClipboardBridgeInstalled = true;

    let captureUntil = 0;

    function isCaptureEnabled() {
        return Date.now() <= captureUntil;
    }

    function emitPromptText(value = '') {
        const text = String(value || '').trim();
        if (text.length < 12) return false;
        try {
            window.dispatchEvent(new CustomEvent('FatherKeyMeigenPromptCopied', { detail: text }));
        } catch (_) {
            // Best-effort bridge only.
        }
        return true;
    }

    function getActiveSelectionText() {
        const active = document.activeElement;
        if (active && typeof active.value === 'string') {
            const start = Number(active.selectionStart || 0);
            const end = Number(active.selectionEnd || 0);
            const selected = active.value.slice(start, end);
            if (selected) return selected;
            return active.value;
        }
        return String(window.getSelection?.() || '');
    }

    window.addEventListener('FatherKeyMeigenEnablePromptCapture', (event) => {
        const duration = Number(event?.detail?.durationMs || 2500);
        captureUntil = Date.now() + Math.max(500, Math.min(duration, 5000));
    });

    try {
        const clipboard = navigator.clipboard;
        const originalWriteText = clipboard?.writeText?.bind(clipboard);
        if (clipboard && originalWriteText) {
            Object.defineProperty(clipboard, 'writeText', {
                configurable: true,
                value(text) {
                    if (isCaptureEnabled() && emitPromptText(text)) {
                        return Promise.resolve();
                    }
                    return originalWriteText(text);
                }
            });
        }
    } catch (_) {
        // Some browsers lock clipboard descriptors. The execCommand bridge below is still useful.
    }

    try {
        const originalExecCommand = document.execCommand?.bind(document);
        if (originalExecCommand) {
            document.execCommand = function bridgedExecCommand(command, showUi, value) {
                if (isCaptureEnabled() && String(command || '').toLowerCase() === 'copy') {
                    const selectedText = getActiveSelectionText();
                    if (emitPromptText(selectedText)) return true;
                }
                return originalExecCommand(command, showUi, value);
            };
        }
    } catch (_) {
        // Keep the bridge non-fatal.
    }

    const DATA_CACHE_LIMIT = 80;
    const DATA_TEXT_LIMIT = 700000;
    const DATA_RESPONSE_TYPE = 'FatherKeyMeigenDataCacheResponse';
    const DATA_REQUEST_TYPE = 'FatherKeyMeigenDataCacheRequest';
    const dataCache = window.__FatherKeyMeigenDataCache = Array.isArray(window.__FatherKeyMeigenDataCache)
        ? window.__FatherKeyMeigenDataCache
        : [];

    function normalizeBridgeText(value = '', maxLength = DATA_TEXT_LIMIT) {
        return String(value || '').replace(/\u00a0/g, ' ').trim().slice(0, maxLength);
    }

    function isMeigenUrl(value = '') {
        try {
            const parsed = new URL(String(value || ''), window.location.href);
            return parsed.hostname === 'www.meigen.ai' || parsed.hostname === 'meigen.ai';
        } catch (_) {
            return false;
        }
    }

    function looksLikeStructuredPayload(url = '', contentType = '', text = '') {
        const source = `${url} ${contentType}`;
        if (/json|\/api\/|_next\/data|rsc|flight/i.test(source)) return true;
        return /prompt|positivePrompt|fullPrompt|imageUrls?|generatedImages?|twitter|x\.com|status\/\d{5,}/i.test(text.slice(0, 120000));
    }

    function addDataCacheEntry(entry = {}) {
        const url = String(entry.url || '');
        const text = normalizeBridgeText(entry.text || '');
        if (!text || !looksLikeStructuredPayload(url, entry.contentType || '', text)) return false;
        const key = `${entry.kind || 'data'}:${url}:${text.slice(0, 200)}`;
        const existingIndex = dataCache.findIndex((item) => item.key === key);
        const record = {
            key,
            kind: String(entry.kind || 'data').slice(0, 40),
            url,
            contentType: String(entry.contentType || '').slice(0, 120),
            text,
            capturedAt: Date.now()
        };
        if (existingIndex >= 0) {
            dataCache[existingIndex] = record;
        } else {
            dataCache.push(record);
        }
        while (dataCache.length > DATA_CACHE_LIMIT) dataCache.shift();
        return true;
    }

    function collectScriptDataEntries() {
        const scripts = Array.from(document.querySelectorAll('script'));
        const entries = [];
        scripts.forEach((script, index) => {
            const text = normalizeBridgeText(script.textContent || '');
            const type = String(script.type || '').toLowerCase();
            const id = String(script.id || '');
            if (!text) return;
            if (id !== '__NEXT_DATA__'
                && !/json|ld\+json/i.test(type)
                && !/(self\.)?__next_f\.push|prompt|imageUrls?|generatedImages?|x\.com|twitter\.com/i.test(text.slice(0, 120000))) {
                return;
            }
            entries.push({
                kind: id === '__NEXT_DATA__' ? 'next-data' : 'script',
                url: window.location.href,
                contentType: type || 'text/javascript',
                text,
                capturedAt: Date.now() - index
            });
        });
        return entries;
    }

    function getPromptIdFromUrl(value = '') {
        try {
            const parsed = new URL(String(value || ''), window.location.href);
            return parsed.pathname.match(/\/prompt\/(\d{8,25})/i)?.[1] || '';
        } catch (_) {
            const match = String(value || '').match(/\/prompt\/(\d{8,25})/i);
            return match?.[1] || '';
        }
    }

    function getEntryContextIds(entry = {}) {
        const ids = new Set();
        const source = `${entry.url || ''}\n${String(entry.text || '').slice(0, 160000)}`;
        for (const match of source.matchAll(/(?:\/prompt\/|\/tweets\/|status\/)(\d{8,25})/ig)) {
            ids.add(match[1]);
            if (ids.size >= 40) break;
        }
        return ids;
    }

    function pathsMatch(left = '', right = '') {
        try {
            const a = new URL(left || window.location.href, window.location.href);
            const b = new URL(right || window.location.href, window.location.href);
            return a.hostname === b.hostname && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
        } catch (_) {
            return false;
        }
    }

    function dataCacheEntryMatchesContext(entry = {}, currentUrl = window.location.href) {
        const currentPromptId = getPromptIdFromUrl(currentUrl);
        const entryPromptId = getPromptIdFromUrl(entry.url || '');
        if (currentPromptId) {
            if (entryPromptId && entryPromptId !== currentPromptId) return false;
            const ids = getEntryContextIds(entry);
            if (ids.has(currentPromptId)) return true;
            if (ids.size > 0) return false;
            return pathsMatch(entry.url || '', currentUrl);
        }
        if (entryPromptId) return false;
        const ids = getEntryContextIds(entry);
        if (pathsMatch(entry.url || '', currentUrl)) return true;
        return ids.size !== 1;
    }

    function getDataCacheSnapshot(currentUrl = window.location.href) {
        const scriptEntries = collectScriptDataEntries();
        const filteredCache = dataCache.filter((entry) => dataCacheEntryMatchesContext(entry, currentUrl));
        return [...scriptEntries, ...filteredCache]
            .slice(-DATA_CACHE_LIMIT)
            .map((entry) => ({
                kind: entry.kind,
                url: entry.url,
                contentType: entry.contentType,
                text: entry.text,
                capturedAt: entry.capturedAt
            }));
    }

    try {
        const originalFetch = window.fetch?.bind(window);
        if (originalFetch) {
            window.fetch = function fatherKeyMeigenFetchBridge(input, init) {
                const responsePromise = originalFetch(input, init);
                responsePromise.then((response) => {
                    try {
                        const url = response?.url || (typeof input === 'string' ? input : input?.url) || '';
                        if (!isMeigenUrl(url)) return;
                        const contentType = response.headers?.get?.('content-type') || '';
                        if (!looksLikeStructuredPayload(url, contentType, '')) return;
                        response.clone().text().then((text) => {
                            addDataCacheEntry({
                                kind: 'fetch',
                                url,
                                contentType,
                                text
                            });
                        }).catch(() => {});
                    } catch (_) {
                        // Keep page networking untouched.
                    }
                }).catch(() => {});
                return responsePromise;
            };
        }
    } catch (_) {
        // Fetch can be locked by the page; script data is still available on request.
    }

    try {
        const OriginalXhr = window.XMLHttpRequest;
        if (OriginalXhr?.prototype) {
            const originalOpen = OriginalXhr.prototype.open;
            const originalSend = OriginalXhr.prototype.send;
            OriginalXhr.prototype.open = function bridgedOpen(method, url) {
                this.__fatherKeyMeigenUrl = url;
                return originalOpen.apply(this, arguments);
            };
            OriginalXhr.prototype.send = function bridgedSend() {
                try {
                    this.addEventListener('loadend', () => {
                        try {
                            const url = this.responseURL || this.__fatherKeyMeigenUrl || '';
                            if (!isMeigenUrl(url)) return;
                            const contentType = this.getResponseHeader?.('content-type') || '';
                            const text = typeof this.responseText === 'string' ? this.responseText : '';
                            addDataCacheEntry({
                                kind: 'xhr',
                                url,
                                contentType,
                                text
                            });
                        } catch (_) {
                            // Ignore unreadable XHR bodies.
                        }
                    });
                } catch (_) {
                    // Continue with the original send path.
                }
                return originalSend.apply(this, arguments);
            };
        }
    } catch (_) {
        // XHR can be locked by the page; keep the bridge optional.
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.type !== DATA_REQUEST_TYPE) return;
        try {
            window.postMessage({
                type: DATA_RESPONSE_TYPE,
                requestId: data.requestId || '',
                entries: getDataCacheSnapshot(data.currentUrl || window.location.href)
            }, '*');
        } catch (_) {
            window.postMessage({
                type: DATA_RESPONSE_TYPE,
                requestId: data.requestId || '',
                entries: []
            }, '*');
        }
    });
})();
