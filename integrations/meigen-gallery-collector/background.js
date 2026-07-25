(function fatherKeyMeigenCollectorBackground() {
    'use strict';

    const MESSAGE_STAGE = 'FATHER_KEY_STAGE_IMPORT';
    const MESSAGE_CHECK_DUPLICATES = 'FATHER_KEY_CHECK_IMPORT_DUPLICATES';
    const MESSAGE_LOAD_BATCH = 'FATHER_KEY_LOAD_IMPORT_BATCH';
    const MESSAGE_FIND_RECOVERABLE_BATCH = 'FATHER_KEY_FIND_RECOVERABLE_IMPORT_BATCH';
    const MESSAGE_CLEANUP_PENDING = 'FATHER_KEY_CLEANUP_PENDING_IMPORT';
    const MESSAGE_DOWNLOAD = 'FATHER_KEY_DOWNLOAD_IMPORT';
    const MESSAGE_STAGE_VIA_ADMIN_TAB = 'FATHER_KEY_STAGE_IMPORT_VIA_ADMIN_TAB';
    const DEFAULT_ADMIN_BASE_URL = 'https://www.fatherkey.com';
    const videoFingerprintCache = new Map();

    async function enableContentScriptSessionStorage() {
        if (!chrome.storage?.session?.setAccessLevel) return false;
        try {
            await chrome.storage.session.setAccessLevel({
                accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
            });
            return true;
        } catch (_) {
            return false;
        }
    }

    void enableContentScriptSessionStorage();

    function normalizeAdminBaseUrl(value = '') {
        const raw = String(value || '').trim() || DEFAULT_ADMIN_BASE_URL;
        try {
            const url = new URL(raw);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_ADMIN_BASE_URL;
            return url.origin;
        } catch (_) {
            return DEFAULT_ADMIN_BASE_URL;
        }
    }

    function getItemsFromPayload(payload = {}) {
        return Array.isArray(payload.items) ? payload.items : [];
    }

    function normalizeMaxItems(value) {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return 20;
        return Math.min(parsed, 1000);
    }

    function normalizeOptionalCount(value) {
        const parsed = Number.parseInt(String(value || ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function buildStageItemsBody({
        payload,
        site = 'cn',
        defaultStatus = 'review',
        maxItems = 20,
        minFavorites = 0,
        maxFavorites = 0,
        batchId = ''
    } = {}) {
        return {
            action: 'stage_items',
            batch_id: String(batchId || '').trim(),
            site,
            source: 'meigen',
            mode: 'crawl_only',
            settings: {
                default_status: defaultStatus,
                max_items: normalizeMaxItems(maxItems),
                min_favorites: normalizeOptionalCount(minFavorites),
                max_favorites: normalizeOptionalCount(maxFavorites),
                duplicate_policy: 'skip',
                auto_cleanup: true,
                analyze_after_save: true
            },
            items: getItemsFromPayload(payload)
        };
    }

    function buildDuplicateCheckBody({ payload, maxItems = 20 } = {}) {
        return {
            action: 'check_duplicates',
            source: 'meigen',
            settings: { max_items: normalizeMaxItems(maxItems) },
            items: getItemsFromPayload(payload)
        };
    }

    function normalizeStrongEtag(value = '') {
        const normalized = String(value || '').trim().replace(/^W\//i, '').replace(/^"|"$/g, '').toLowerCase();
        return /^[a-f0-9]{16,128}$/.test(normalized) ? normalized : '';
    }

    async function resolveVideoSourceFingerprint(url = '') {
        const normalizedUrl = String(url || '').trim();
        if (!normalizedUrl) return null;
        if (videoFingerprintCache.has(normalizedUrl)) return videoFingerprintCache.get(normalizedUrl);
        const promise = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(normalizedUrl, {
                    method: 'HEAD',
                    redirect: 'follow',
                    signal: controller.signal,
                    headers: { Accept: 'video/*,*/*;q=0.5' }
                });
                if (!response.ok) return null;
                const etag = normalizeStrongEtag(response.headers.get('etag'));
                const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
                if (!etag || !Number.isFinite(contentLength) || contentLength < 1) return null;
                return {
                    source_fingerprint: `http-etag:${etag}:${contentLength}`,
                    source_etag: etag,
                    source_content_length: contentLength
                };
            } catch (_) {
                return null;
            } finally {
                clearTimeout(timer);
            }
        })();
        videoFingerprintCache.set(normalizedUrl, promise);
        return promise;
    }

    async function resolvePosterContentHash(url = '') {
        const normalizedUrl = String(url || '').trim();
        if (!normalizedUrl || !globalThis.crypto?.subtle) return '';
        const cacheKey = `poster:${normalizedUrl}`;
        if (videoFingerprintCache.has(cacheKey)) return videoFingerprintCache.get(cacheKey);
        const promise = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(normalizedUrl, { redirect: 'follow', signal: controller.signal });
                if (!response.ok) return '';
                const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
                if (Number.isFinite(contentLength) && contentLength > 8 * 1024 * 1024) return '';
                const buffer = await response.arrayBuffer();
                if (!buffer.byteLength || buffer.byteLength > 8 * 1024 * 1024) return '';
                const digest = await crypto.subtle.digest('SHA-256', buffer);
                const hex = Array.from(new Uint8Array(digest))
                    .map((value) => value.toString(16).padStart(2, '0'))
                    .join('');
                return `poster-sha256:${hex}`;
            } catch (_) {
                return '';
            } finally {
                clearTimeout(timer);
            }
        })();
        videoFingerprintCache.set(cacheKey, promise);
        return promise;
    }

    async function enrichPayloadVideoFingerprints(payload = {}) {
        const items = getItemsFromPayload(payload);
        const enrichedItems = await Promise.all(items.map(async (item) => {
            const videoSources = Array.isArray(item?.video_sources) ? item.video_sources : [];
            if (!videoSources.length) return item;
            const enrichedSources = await Promise.all(videoSources.map(async (entry) => {
                const source = typeof entry === 'string' ? { url: entry } : { ...(entry || {}) };
                const fingerprint = source.source_fingerprint || source.sourceFingerprint
                    ? null
                    : await resolveVideoSourceFingerprint(source.url || source.original || source.src || '');
                const posterUrl = source.poster_url || source.posterUrl || source.poster || '';
                const posterContentHash = source.poster_content_hash
                    || source.posterContentHash
                    || await resolvePosterContentHash(posterUrl);
                return {
                    ...source,
                    ...(fingerprint || {}),
                    ...(posterContentHash ? { poster_content_hash: posterContentHash } : {})
                };
            }));
            return { ...item, video_sources: enrichedSources };
        }));
        return { ...payload, items: enrichedItems };
    }

    function isUnauthorizedResponse(response = {}, result = {}) {
        const status = Number(response.status || 0);
        const message = String(result?.message || '').trim();
        return status === 401 || status === 403 || /^Unauthorized$/i.test(message);
    }

    function getAdminTabOrigins(baseUrl = DEFAULT_ADMIN_BASE_URL) {
        const origins = [];
        try {
            origins.push(new URL(baseUrl).origin);
        } catch (_) {
            // Fall back to known production origins below.
        }
        [
            'https://www.fatherkey.com',
            'https://fatherkey.com',
            'https://www.zaoyoe.xyz',
            'https://zaoyoe.xyz'
        ].forEach((origin) => origins.push(origin));
        return [...new Set(origins)];
    }

    async function queryAdminTabs(baseUrl) {
        const origins = getAdminTabOrigins(baseUrl);
        let allTabs = [];
        try {
            allTabs = await chrome.tabs.query({});
        } catch (_) {
            allTabs = [];
        }
        return allTabs.filter((tab) => {
            try {
                const url = new URL(tab?.url || '');
                const isAllowedOrigin = origins.includes(url.origin)
                    || url.hostname === 'localhost'
                    || url.hostname === '127.0.0.1';
                return isAllowedOrigin && /^\/admin-studio(?:\.html)?\/?$/i.test(url.pathname);
            } catch (_) {
                return false;
            }
        });
    }

    function isMissingMessageReceiver(error = {}) {
        return /receiving end does not exist|could not establish connection/i.test(String(error?.message || ''));
    }

    async function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function ensureAdminBridgeInjected(tabId) {
        if (!chrome.scripting?.executeScript) return false;
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['admin-bridge.js']
            });
            await sleep(120);
            return true;
        } catch (_) {
            return false;
        }
    }

    function createAdminBridgeConnectionError(error = {}) {
        const message = isMissingMessageReceiver(error)
            ? '送入队列连接失败：请刷新 Admin Studio 页面，确认已登录后再点送入队列'
            : (error?.message || 'Admin Studio 送入队列失败，请刷新 Admin Studio 后重试');
        const wrappedError = new Error(message);
        wrappedError.status = error?.status || 0;
        return wrappedError;
    }

    async function sendStageMessageToAdminTab(tab, body, request = {}) {
        try {
            return await chrome.tabs.sendMessage(tab.id, {
                type: MESSAGE_STAGE_VIA_ADMIN_TAB,
                body,
                request
            });
        } catch (error) {
            if (!isMissingMessageReceiver(error) || !await ensureAdminBridgeInjected(tab.id)) {
                throw createAdminBridgeConnectionError(error);
            }
            try {
                return await chrome.tabs.sendMessage(tab.id, {
                    type: MESSAGE_STAGE_VIA_ADMIN_TAB,
                    body,
                    request
                });
            } catch (retryError) {
                throw createAdminBridgeConnectionError(retryError);
            }
        }
    }

    async function stageImportPayloadViaAdminTab({ body, adminBaseUrl, request = {} } = {}) {
        const tabs = await queryAdminTabs(adminBaseUrl);
        if (!tabs.length) {
            throw new Error('请先打开 Admin Studio 并保持登录，再点送入队列');
        }

        let lastError = null;
        for (const tab of tabs) {
            try {
                const response = await sendStageMessageToAdminTab(tab, body, request);
                if (response?.ok) {
                    return {
                        ...response.result,
                        via_admin_tab: true
                    };
                }
                lastError = new Error(response?.message || 'Admin Studio 送入队列失败');
                lastError.status = response?.status || 0;
            } catch (error) {
                lastError = error;
            }
        }

        throw createAdminBridgeConnectionError(lastError || new Error('Admin Studio 送入队列失败，请刷新 Admin Studio 后重试'));
    }

    async function stageImportPayload({
        payload,
        adminBaseUrl,
        site = 'cn',
        defaultStatus = 'review',
        maxItems = 20,
        minFavorites = 0,
        maxFavorites = 0,
        batchId = ''
    } = {}) {
        const enrichedPayload = await enrichPayloadVideoFingerprints(payload);
        const items = getItemsFromPayload(enrichedPayload);
        if (!items.length) {
            throw new Error('当前页面没有可送入队列的内容');
        }

        if (items.length > 3) {
            let currentBatchId = batchId;
            const aggregate = {
                items: [],
                attemptedCount: 0,
                stagedCount: 0,
                skippedDuplicateCount: 0,
                ignoredExistingCount: 0,
                capacityDeferredCount: 0,
                capacityDeferredSourceItemIds: [],
                rejectedIdentityCount: 0,
                batch: null
            };
            for (let index = 0; index < items.length; index += 3) {
                const result = await stageImportPayload({
                    payload: { ...payload, items: items.slice(index, index + 3) },
                    adminBaseUrl,
                    site,
                    defaultStatus,
                    maxItems,
                    minFavorites,
                    maxFavorites,
                    batchId: currentBatchId
                });
                currentBatchId = result.batch?.id || currentBatchId;
                aggregate.batch = result.batch || aggregate.batch;
                aggregate.items.push(...(Array.isArray(result.items) ? result.items : []));
                aggregate.attemptedCount += Number(result.attemptedCount || 0);
                aggregate.stagedCount += Number(result.stagedCount || 0);
                aggregate.skippedDuplicateCount += Number(result.skippedDuplicateCount || 0);
                aggregate.ignoredExistingCount += Number(result.ignoredExistingCount || 0);
                aggregate.capacityDeferredCount += Number(result.capacityDeferredCount || 0);
                aggregate.capacityDeferredSourceItemIds.push(...(
                    Array.isArray(result.capacityDeferredSourceItemIds)
                        ? result.capacityDeferredSourceItemIds
                        : []
                ));
                aggregate.rejectedIdentityCount += Number(result.rejectedIdentityCount || 0);
            }
            return aggregate;
        }

        const baseUrl = normalizeAdminBaseUrl(adminBaseUrl);
        const body = buildStageItemsBody({
            payload: enrichedPayload,
            site,
            defaultStatus,
            maxItems,
            minFavorites,
            maxFavorites,
            batchId
        });
        let response = null;
        try {
            response = await fetch(`${baseUrl}/api/admin/prompts/imports`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
        } catch (error) {
            try {
                return await stageImportPayloadViaAdminTab({ body, adminBaseUrl: baseUrl });
            } catch (bridgeError) {
                const message = bridgeError?.message
                    && !/receiving end does not exist|could not establish connection/i.test(bridgeError.message)
                    ? bridgeError.message
                    : '送入队列连接失败：请确认 Admin Studio 页面已打开、本地预览服务正在运行，并已登录后重试';
                const wrappedError = new Error(message);
                wrappedError.status = bridgeError?.status || error?.status || 0;
                throw wrappedError;
            }
        }

        let result = {};
        try {
            result = await response.json();
        } catch (_) {
            result = {};
        }

        if (isUnauthorizedResponse(response, result)) {
            return stageImportPayloadViaAdminTab({ body, adminBaseUrl: baseUrl });
        }

        if (!response.ok || result.success === false) {
            const message = result.message || (response.status === 401 || response.status === 403
                ? '请先打开 Admin Studio 并登录后重试'
                : '送入队列失败');
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }

        return result;
    }

    async function checkImportDuplicates({ payload, adminBaseUrl, maxItems = 20 } = {}) {
        const enrichedPayload = await enrichPayloadVideoFingerprints(payload);
        const body = buildDuplicateCheckBody({ payload: enrichedPayload, maxItems });
        if (!body.items.length) return { checkedCount: 0, duplicateCount: 0, duplicateSourceItemIds: [] };
        const baseUrl = normalizeAdminBaseUrl(adminBaseUrl);
        let response;
        try {
            response = await fetch(`${baseUrl}/api/admin/prompts/imports`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (_) {
            return stageImportPayloadViaAdminTab({ body, adminBaseUrl: baseUrl });
        }
        let result = {};
        try {
            result = await response.json();
        } catch (_) {
            result = {};
        }
        if (isUnauthorizedResponse(response, result)) {
            return stageImportPayloadViaAdminTab({ body, adminBaseUrl: baseUrl });
        }
        if (!response.ok || result.success === false) {
            throw new Error(result.message || '提示词仓库去重预检失败');
        }
        return result;
    }

    async function requestImportApi({ adminBaseUrl, method = 'GET', path = '/api/admin/prompts/imports', body = null } = {}) {
        const baseUrl = normalizeAdminBaseUrl(adminBaseUrl);
        const request = { method, path };
        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                credentials: 'include',
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined
            });
            let result = {};
            try {
                result = await response.json();
            } catch (_) {
                result = {};
            }
            if (isUnauthorizedResponse(response, result)) {
                return stageImportPayloadViaAdminTab({ body, adminBaseUrl: baseUrl, request });
            }
            if (!response.ok || result.success === false) {
                const error = new Error(result.message || 'Admin Studio 请求失败');
                error.status = response.status;
                throw error;
            }
            return result;
        } catch (error) {
            if (error?.status) throw error;
            return stageImportPayloadViaAdminTab({ body, adminBaseUrl: baseUrl, request });
        }
    }

    async function loadImportBatch({ batchId, adminBaseUrl } = {}) {
        const normalizedBatchId = String(batchId || '').trim();
        if (!normalizedBatchId) return { batch: null, items: [] };
        return requestImportApi({
            adminBaseUrl,
            path: `/api/admin/prompts/imports?batchId=${encodeURIComponent(normalizedBatchId)}&limit=1000&includeCleaned=true`
        });
    }

    async function findRecoverableImportBatch({ adminBaseUrl, site = 'cn' } = {}) {
        const batchesResult = await requestImportApi({
            adminBaseUrl,
            path: `/api/admin/prompts/imports?limit=20&site=${encodeURIComponent(site)}`
        });
        const batch = (Array.isArray(batchesResult.batches) ? batchesResult.batches : []).find((entry) => {
            const stats = entry?.stats || {};
            return String(entry?.source || '') === 'meigen'
                && Number(stats.retry_pending || stats.cleaned_unpublished || 0) > 0;
        });
        if (!batch?.id) return { batch: null, items: [] };
        return loadImportBatch({ batchId: batch.id, adminBaseUrl });
    }

    async function cleanupPendingImport({ batchId, adminBaseUrl, site = 'cn' } = {}) {
        const normalizedBatchId = String(batchId || '').trim();
        if (!normalizedBatchId) return { batch: null, items: [], cleanedCount: 0 };
        return requestImportApi({
            adminBaseUrl,
            method: 'POST',
            body: {
                action: 'cleanup_pending_detail_items',
                batch_id: normalizedBatchId,
                site
            }
        });
    }

    function buildImportFilename() {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `meigen-gallery-import-${stamp}.json`;
    }

    async function downloadImportPayload(payload = {}) {
        const json = JSON.stringify(payload, null, 2);
        const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
        return chrome.downloads.download({
            url,
            filename: buildImportFilename(),
            saveAs: false
        });
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === MESSAGE_LOAD_BATCH) {
            loadImportBatch(message)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({ ok: false, message: error?.message || '读取原批次失败' }));
            return true;
        }
        if (message?.type === MESSAGE_FIND_RECOVERABLE_BATCH) {
            findRecoverableImportBatch(message)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({ ok: false, message: error?.message || '查找待重新采集批次失败' }));
            return true;
        }
        if (message?.type === MESSAGE_CLEANUP_PENDING) {
            cleanupPendingImport(message)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({ ok: false, message: error?.message || '清理待补占位项失败' }));
            return true;
        }
        if (message?.type === MESSAGE_CHECK_DUPLICATES) {
            checkImportDuplicates(message)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({ ok: false, message: error?.message || '提示词仓库去重预检失败' }));
            return true;
        }
        if (message?.type === MESSAGE_STAGE) {
            stageImportPayload(message)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({
                    ok: false,
                    message: error?.message || '送入队列失败',
                    status: error?.status || 0
                }));
            return true;
        }

        if (message?.type === MESSAGE_DOWNLOAD) {
            downloadImportPayload(message.payload)
                .then((downloadId) => sendResponse({ ok: true, downloadId }))
                .catch((error) => sendResponse({
                    ok: false,
                    message: error?.message || '下载失败'
                }));
            return true;
        }

        return false;
    });
})();
