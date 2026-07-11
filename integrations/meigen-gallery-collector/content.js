(function fatherKeyMeigenCollectorContent() {
    'use strict';

    const MESSAGE_COLLECT = 'FATHER_KEY_MEIGEN_COLLECT';
    const MESSAGE_PING = 'FATHER_KEY_MEIGEN_PING';
    const MESSAGE_DETAIL_PAUSE = 'FATHER_KEY_MEIGEN_DETAIL_PAUSE';
    const MESSAGE_DETAIL_RESUME = 'FATHER_KEY_MEIGEN_DETAIL_RESUME';
    const MESSAGE_DETAIL_STATUS = 'FATHER_KEY_MEIGEN_DETAIL_STATUS';
    const MESSAGE_SCROLL_COLLECT = 'FATHER_KEY_MEIGEN_SCROLL_COLLECT';
    const MESSAGE_SCROLL_STOP = 'FATHER_KEY_MEIGEN_SCROLL_STOP';
    const MESSAGE_SCROLL_STATUS = 'FATHER_KEY_MEIGEN_SCROLL_STATUS';
    const MESSAGE_CHECK_DUPLICATES = 'FATHER_KEY_CHECK_IMPORT_DUPLICATES';
    const MESSAGE_PAGE_BATCH_COLLECT = 'FATHER_KEY_MEIGEN_PAGE_BATCH_COLLECT';
    const MESSAGE_PAGE_BATCH_STOP = 'FATHER_KEY_MEIGEN_PAGE_BATCH_STOP';
    const MESSAGE_PAGE_BATCH_STATUS = 'FATHER_KEY_MEIGEN_PAGE_BATCH_STATUS';
    const MESSAGE_DIAGNOSTICS = 'FATHER_KEY_MEIGEN_DIAGNOSTICS';
    const MESSAGE_SESSION_STATE = 'FATHER_KEY_MEIGEN_SESSION_STATE';
    const MESSAGE_STAGE = 'FATHER_KEY_STAGE_IMPORT';
    const DATA_CACHE_REQUEST_TYPE = 'FatherKeyMeigenDataCacheRequest';
    const DATA_CACHE_RESPONSE_TYPE = 'FatherKeyMeigenDataCacheResponse';
    const DETAIL_FETCH_DELAY_MS = 900;
    const DETAIL_FRAME_TIMEOUT_MS = 12000;
    const DETAIL_FRAME_POLL_MS = 500;
    const DETAIL_FRAME_MIN_SETTLE_MS = 2500;
    const DETAIL_FRAME_STABLE_ROUNDS = 3;
    const HOVER_REVEAL_DELAY_MS = 80;
    const SCROLL_COLLECT_DELAY_MS = 1200;
    const SCROLL_BATCH_SETTLE_POLL_MS = 350;
    const SCROLL_BATCH_SETTLE_LIMIT = 8;
    const SCROLL_COLLECT_MAX_STEPS = 30;
    const SCROLL_COLLECT_STABLE_LIMIT = 3;
    const PAGE_BATCH_DELAY_MS = 1500;
    const PAGE_BATCH_MAX_PAGES = 5;
    const PROMPT_COPY_CLICK_DELAY_MS = 650;
    const PROMPT_COPY_CAPTURE_TIMEOUT_MS = 2200;
    const DATA_CACHE_CAPTURE_TIMEOUT_MS = 900;
    const NEXT_PAGE_TEXT_PATTERN = /^(下一页|下页|更多|加载更多|查看更多|next|more|load more|show more)$/i;
    const PROMPT_COPY_TEXT_PATTERN = /(复制\s*(Prompt|提示词)|Copy\s*Prompt|copy[-_\s]*prompt|prompt[-_\s]*copy)/i;
    const PROMPT_EXPAND_TEXT_PATTERN = /^(展开|显示更多|查看更多|Show more|More)$/i;
    const COLLAPSED_PROMPT_MARKER_PATTERN = /(\.\.\.|…)\s*$/;
    const DETAIL_PROMPT_LABEL_PATTERN = /(^|\n)\s*(提示词|Prompt)\s*($|\n|[:：])/i;
    const DETAIL_AUTHOR_HANDLE_PATTERN = /@[a-zA-Z0-9_]{1,20}\b/;
    const HOVER_SCOPE_SELECTOR = [
        'article',
        '[role="article"]',
        'li',
        '[data-id]',
        '[data-item-id]',
        '[data-prompt-id]',
        '[class*="card" i]',
        '[class*="item" i]',
        '[class*="post" i]',
        '[class*="pin" i]'
    ].join(',');
    const DIAGNOSTIC_LOG_LIMIT = 120;
    const SESSION_STORAGE_KEY = 'fatherKeyMeigenCollectorSessionV1';

    const detailJob = {
        running: false,
        paused: false,
        processed: 0,
        total: 0,
        phase: '',
        failed: [],
        lastPayload: null,
        lastSummary: null,
        lastError: ''
    };

    const scrollJob = {
        running: false,
        stopRequested: false,
        processed: 0,
        total: 0,
        discovered: 0,
        lastPayload: null,
        lastSummary: null,
        lastError: ''
    };

    const pageBatchJob = {
        running: false,
        stopRequested: false,
        processed: 0,
        total: 0,
        discovered: 0,
        currentUrl: '',
        lastPayload: null,
        lastSummary: null,
        lastError: ''
    };

    const sessionState = {
        lastPayload: null,
        lastSummary: null,
        updatedAt: ''
    };
    const streamStageState = {
        batchId: '',
        bufferedItems: [],
        sentRevisions: new Map(),
        acceptedKeys: new Set(),
        promise: Promise.resolve(),
        attemptedCount: 0,
        stagedCount: 0,
        skippedDuplicateCount: 0,
        rejectedCount: 0,
        lastError: ''
    };

    function getImportIdentityKey(item = {}) {
        return String(item.source_item_id || item.original_work_url || item.source_page_url || '').trim().toLowerCase();
    }

    function getNumericIdentityFromUrl(value = '', segment = '') {
        try {
            const parts = new URL(String(value || '')).pathname.split('/').filter(Boolean);
            const index = segment ? parts.findIndex((part) => part.toLowerCase() === segment) : -1;
            const candidate = index >= 0 ? parts[index + 1] : '';
            return /^\d{12,25}$/.test(candidate || '') ? candidate : '';
        } catch (_) {
            return '';
        }
    }

    function getMeigenIdentityConflictReason(item = {}) {
        const sourceItemId = /^\d{12,25}$/.test(String(item.source_item_id || '').trim())
            ? String(item.source_item_id).trim()
            : '';
        const detailId = getNumericIdentityFromUrl(item.source_page_url, 'prompt');
        const originalId = getNumericIdentityFromUrl(item.original_work_url, 'status');
        const imageIds = new Set((Array.isArray(item.image_sources) ? item.image_sources : [])
            .map((entry) => getNumericIdentityFromUrl(entry?.url, 'tweets'))
            .filter(Boolean));
        const identities = [sourceItemId, detailId, originalId, ...imageIds].filter(Boolean);
        return new Set(identities).size > 1 ? '作品详情、X 原帖或图片身份不一致' : '';
    }

    function getStreamItemRevision(item = {}) {
        const images = Array.isArray(item.image_sources) ? item.image_sources.length : 0;
        return [
            String(item.prompt_text || '').trim().length,
            images,
            Boolean(String(item.original_work_url || '').trim()),
            Boolean(String(item.author_name || '').trim()),
            Boolean(String(item.author_handle || '').trim()),
            item.stream_pending_detail === true ? 0 : 1
        ].join(':');
    }

    function isStreamItemRevisionImproved(previous = '', next = '') {
        if (!previous) return true;
        const left = previous.split(':').map(Number);
        const right = next.split(':').map(Number);
        return right.some((value, index) => value > (left[index] || 0));
    }

    async function filterRepositoryDuplicates(items = [], message = {}, checkedKeys = new Set()) {
        let identityConflictCount = 0;
        const candidates = (Array.isArray(items) ? items : []).filter((item) => {
            const key = getImportIdentityKey(item);
            if (!key || checkedKeys.has(key)) return false;
            checkedKeys.add(key);
            if (getMeigenIdentityConflictReason(item)) {
                identityConflictCount += 1;
                return false;
            }
            return true;
        });
        if (!candidates.length) return { uniqueItems: [], duplicateCount: 0, identityConflictCount };
        const response = await chrome.runtime.sendMessage({
            type: MESSAGE_CHECK_DUPLICATES,
            payload: { source: 'meigen', items: candidates },
            adminBaseUrl: message.adminBaseUrl,
            maxItems: candidates.length
        });
        if (!response?.ok) throw new Error(response?.message || '提示词仓库去重预检失败');
        const duplicateIds = new Set((response.result?.duplicateSourceItemIds || []).map((value) => String(value || '')));
        const rejectedIdentityIds = new Set((response.result?.rejectedIdentitySourceItemIds || []).map((value) => String(value || '')));
        return {
            uniqueItems: candidates.filter((item) => (
                !duplicateIds.has(String(item.source_item_id || ''))
                && !rejectedIdentityIds.has(String(item.source_item_id || ''))
            )),
            duplicateCount: duplicateIds.size,
            identityConflictCount: identityConflictCount + rejectedIdentityIds.size
        };
    }

    function isStreamReadyItem(item = {}) {
        return !needsInteractiveDetail(item, { requireFavoriteCount: false });
    }

    function getStreamItemKey(item = {}) {
        return String(item.source_item_id || item.source_page_url || item.original_work_url || '').trim().toLowerCase();
    }

    function resetStreamStageState(batchId = '') {
        streamStageState.batchId = String(batchId || '').trim();
        streamStageState.bufferedItems = [];
        streamStageState.sentRevisions = new Map();
        streamStageState.acceptedKeys = new Set();
        streamStageState.promise = Promise.resolve();
        streamStageState.attemptedCount = 0;
        streamStageState.stagedCount = 0;
        streamStageState.skippedDuplicateCount = 0;
        streamStageState.rejectedCount = 0;
        streamStageState.lastError = '';
    }

    function queueStreamStage(items = [], message = {}, { flush = false, force = false } = {}) {
        (Array.isArray(items) ? items : []).forEach((item) => {
            const key = getStreamItemKey(item);
            if (!key || getMeigenIdentityConflictReason(item)) return;
            const revision = getStreamItemRevision(item);
            if (!force && !isStreamItemRevisionImproved(streamStageState.sentRevisions.get(key), revision)) return;
            streamStageState.sentRevisions.set(key, revision);
            const bufferedIndex = streamStageState.bufferedItems.findIndex((entry) => getStreamItemKey(entry) === key);
            if (bufferedIndex >= 0) {
                streamStageState.bufferedItems[bufferedIndex] = item;
            } else {
                streamStageState.bufferedItems.push(item);
            }
        });
        if (!streamStageState.bufferedItems.length || (!flush && streamStageState.bufferedItems.length < 3)) {
            return streamStageState.promise;
        }
        const stagedItems = streamStageState.bufferedItems.splice(0, flush ? streamStageState.bufferedItems.length : 3);
        streamStageState.promise = streamStageState.promise.then(async () => {
            streamStageState.attemptedCount += stagedItems.length;
            try {
                const response = await chrome.runtime.sendMessage({
                    type: MESSAGE_STAGE,
                    payload: { source: 'meigen', items: stagedItems },
                    batchId: streamStageState.batchId,
                    adminBaseUrl: message.adminBaseUrl,
                    site: message.site,
                    defaultStatus: message.defaultStatus,
                    maxItems: message.maxItems,
                    minFavorites: message.minFavorites,
                    maxFavorites: message.maxFavorites
                });
                if (!response?.ok) throw new Error(response?.message || '流式送入队列失败');
                const result = response.result || {};
                const acceptedCount = Number(result.stagedCount ?? result.items?.length ?? 0);
                const duplicateCount = Number(result.skippedDuplicateCount || 0);
                streamStageState.batchId = result.batch?.id || streamStageState.batchId;
                (Array.isArray(result.items) ? result.items : []).forEach((item) => {
                    const key = getStreamItemKey(item);
                    if (key) streamStageState.acceptedKeys.add(key);
                });
                streamStageState.stagedCount = streamStageState.acceptedKeys.size || (streamStageState.stagedCount + acceptedCount);
                streamStageState.skippedDuplicateCount += duplicateCount;
                streamStageState.rejectedCount += Math.max(0, stagedItems.length - acceptedCount - duplicateCount);
            } catch (error) {
                streamStageState.rejectedCount += stagedItems.length;
                streamStageState.lastError = error?.message || '流式送入队列失败';
                throw error;
            }
        });
        return streamStageState.promise;
    }

    async function stageStreamItemsToTarget(items = [], message = {}, maxItems = 20, options = {}) {
        const remaining = Math.max(0, maxItems - streamStageState.stagedCount);
        if (!remaining) return;
        const stagedItems = (Array.isArray(items) ? items : [])
            .slice(0, remaining)
            .map((item) => options.pendingDetail === true ? { ...item, stream_pending_detail: true } : item);
        queueStreamStage(stagedItems, message, { flush: true });
        await streamStageState.promise;
    }
    let sessionRestorePromise = Promise.resolve(false);

    const diagnosticLog = [];

    function getCollector() {
        return window.FatherKeyMeigenCollector || null;
    }

    function summarizeDiagnosticValue(value, maxLength = 900) {
        if (value == null) return value;
        if (typeof value === 'string') return normalizeText(value, maxLength);
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.slice(0, 12).map((entry) => summarizeDiagnosticValue(entry, 240));
        if (typeof value === 'object') {
            const output = {};
            Object.entries(value).slice(0, 20).forEach(([key, entry]) => {
                output[key] = summarizeDiagnosticValue(entry, 360);
            });
            return output;
        }
        return String(value).slice(0, maxLength);
    }

    function logDiagnostic(step, details = {}) {
        diagnosticLog.push({
            time: new Date().toISOString(),
            step,
            details: summarizeDiagnosticValue(details)
        });
        while (diagnosticLog.length > DIAGNOSTIC_LOG_LIMIT) diagnosticLog.shift();
    }

    function summarizePayload(payload = {}) {
        const items = Array.isArray(payload.items) ? payload.items : [];
        return {
            collector_version: payload.collector_version || getCollector()?.VERSION || '',
            total: items.length,
            with_prompt: items.filter((item) => String(item.prompt_text || '').trim()).length,
            with_source: items.filter((item) => String(item.original_work_url || '').trim()).length,
            images: items.reduce((sum, item) => sum + (Array.isArray(item.image_sources) ? item.image_sources.length : 0), 0),
            detail_failures: detailJob.failed.length,
            scroll_steps: scrollJob.processed,
            batch_pages: pageBatchJob.processed
        };
    }

    function rememberSessionPayload(payload = null, summary = null) {
        if (!payload) return;
        sessionState.lastPayload = payload;
        sessionState.lastSummary = summary || summarizePayload(payload);
        sessionState.updatedAt = new Date().toISOString();
        void persistSessionSnapshot();
    }

    async function persistSessionSnapshot() {
        if (!chrome?.storage?.session || !sessionState.lastPayload) return false;
        try {
            await chrome.storage.session.set({
                [SESSION_STORAGE_KEY]: {
                    payload: sessionState.lastPayload,
                    summary: sessionState.lastSummary,
                    updatedAt: sessionState.updatedAt,
                    pageUrl: window.location.href
                }
            });
            return true;
        } catch (error) {
            logDiagnostic('session-persist-failed', {
                message: error?.message || 'storage.session 写入失败'
            });
            return false;
        }
    }

    async function restoreSessionSnapshot() {
        if (!chrome?.storage?.session) return false;
        try {
            const stored = await chrome.storage.session.get(SESSION_STORAGE_KEY);
            const snapshot = stored?.[SESSION_STORAGE_KEY];
            if (!Array.isArray(snapshot?.payload?.items) || !snapshot.payload.items.length) return false;
            sessionState.lastPayload = snapshot.payload;
            sessionState.lastSummary = snapshot.summary || summarizePayload(snapshot.payload);
            sessionState.updatedAt = snapshot.updatedAt || '';
            detailJob.lastPayload = snapshot.payload;
            detailJob.lastSummary = sessionState.lastSummary;
            scrollJob.lastPayload = snapshot.payload;
            scrollJob.lastSummary = sessionState.lastSummary;
            pageBatchJob.lastPayload = snapshot.payload;
            pageBatchJob.lastSummary = sessionState.lastSummary;
            logDiagnostic('session-restored', {
                items: snapshot.payload.items.length,
                updatedAt: sessionState.updatedAt,
                previousPageUrl: snapshot.pageUrl || ''
            });
            return true;
        } catch (error) {
            logDiagnostic('session-restore-failed', {
                message: error?.message || 'storage.session 读取失败'
            });
            return false;
        }
    }

    function getLastJobPayload() {
        return sessionState.lastPayload || pageBatchJob.lastPayload || scrollJob.lastPayload || detailJob.lastPayload || null;
    }

    function getLastJobSummary(payload = getLastJobPayload()) {
        return sessionState.lastSummary
            || pageBatchJob.lastSummary
            || scrollJob.lastSummary
            || detailJob.lastSummary
            || (payload ? summarizePayload(payload) : null);
    }

    function getSessionState() {
        const payload = getLastJobPayload();
        return {
            ok: true,
            version: getCollector()?.VERSION || payload?.collector_version || '',
            pageUrl: window.location.href,
            updatedAt: sessionState.updatedAt,
            payload,
            summary: getLastJobSummary(payload),
            detailStatus: getDetailStatus(),
            scrollStatus: getScrollStatus(),
            pageBatchStatus: getPageBatchStatus()
        };
    }

    sessionRestorePromise = restoreSessionSnapshot();

    function getDiagnostics() {
        const payload = getLastJobPayload();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        return {
            collector_version: getCollector()?.VERSION || payload?.collector_version || '',
            page_url: window.location.href,
            summary: summarizePayload(payload || {}),
            detail_status: getDetailStatus(),
            scroll_status: getScrollStatus(),
            repository_duplicate_count: Number(payload?.scroll_collect?.repository_duplicates || 0),
            page_batch_status: getPageBatchStatus(),
            items: items.slice(0, 20).map((item, index) => ({
                index: index + 1,
                source_item_id: item.source_item_id || '',
                source_page_url: item.source_page_url || '',
                prompt_length: String(item.prompt_text || '').trim().length,
                prompt_preview: normalizeText(item.prompt_text || '', 160),
                image_count: Array.isArray(item.image_sources) ? item.image_sources.length : 0,
                image_urls: getItemImageUrlPreview(item, 4),
                expected_image_count: item.expected_image_count || 0,
                favorite_count: item.favorite_count || 0,
                author_name: item.author_name || '',
                author_handle: item.author_handle || '',
                author_identity_source: item.author_identity_source || '',
                original_work_url: item.original_work_url || ''
            })),
            recent_log: diagnosticLog.slice(-80)
        };
    }

    function getDetailStatus() {
        return {
            running: detailJob.running,
            paused: detailJob.paused,
            processed: detailJob.processed,
            total: detailJob.total,
            phase: detailJob.phase,
            failed: detailJob.failed,
            lastError: detailJob.lastError
        };
    }

    function getScrollStatus() {
        return {
            running: scrollJob.running,
            stopRequested: scrollJob.stopRequested,
            processed: scrollJob.processed,
            total: scrollJob.total,
            discovered: scrollJob.discovered,
            staged: streamStageState.stagedCount,
            duplicates: streamStageState.skippedDuplicateCount,
            lastError: scrollJob.lastError
        };
    }

    function getPageBatchStatus() {
        return {
            running: pageBatchJob.running,
            stopRequested: pageBatchJob.stopRequested,
            processed: pageBatchJob.processed,
            total: pageBatchJob.total,
            discovered: pageBatchJob.discovered,
            currentUrl: pageBatchJob.currentUrl,
            lastError: pageBatchJob.lastError
        };
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function normalizeText(value = '', maxLength = 12000) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, maxLength);
    }

    function getItemImageUrlPreview(item = {}, limit = 4) {
        return (Array.isArray(item.image_sources) ? item.image_sources : [])
            .map((entry) => String(entry?.url || '').trim())
            .filter(Boolean)
            .slice(0, limit);
    }

    function getStructuredEntryContextIds(entry = {}) {
        const ids = new Set();
        const source = `${entry.url || ''}\n${String(entry.text || '').slice(0, 160000)}`;
        for (const match of source.matchAll(/(?:\/prompt\/|\/tweets\/|status\/)(\d{8,25})/ig)) {
            ids.add(match[1]);
            if (ids.size >= 40) break;
        }
        return ids;
    }

    function structuredEntryUrlMatchesCurrentPath(entryUrl = '', currentUrl = window.location.href) {
        try {
            const entry = new URL(String(entryUrl || ''), currentUrl);
            const current = new URL(String(currentUrl || ''), window.location.href);
            return entry.hostname === current.hostname
                && entry.pathname.replace(/\/$/, '') === current.pathname.replace(/\/$/, '');
        } catch (_) {
            return false;
        }
    }

    function structuredEntryMatchesCurrentContext(entry = {}, currentUrl = window.location.href) {
        const currentPromptId = getPromptIdFromUrl(currentUrl);
        const entryPromptId = getPromptIdFromUrl(entry.url || '');
        if (currentPromptId) {
            if (entryPromptId && entryPromptId !== currentPromptId) return false;
            const entryIds = getStructuredEntryContextIds(entry);
            if (entryIds.has(currentPromptId)) return true;
            if (entryIds.size > 0) return false;
            return structuredEntryUrlMatchesCurrentPath(entry.url || '', currentUrl);
        }
        if (entryPromptId) return false;
        const entryIds = getStructuredEntryContextIds(entry);
        return entryIds.size !== 1;
    }

    function filterStructuredEntriesForCurrentContext(entries = [], currentUrl = window.location.href) {
        return (Array.isArray(entries) ? entries : [])
            .filter((entry) => structuredEntryMatchesCurrentContext(entry, currentUrl));
    }

    function requestPageDataCache(timeoutMs = DATA_CACHE_CAPTURE_TIMEOUT_MS) {
        return new Promise((resolve) => {
            const requestId = `fk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            let settled = false;
            const finish = (entries = []) => {
                if (settled) return;
                settled = true;
                window.removeEventListener('message', onMessage);
                resolve(Array.isArray(entries) ? entries : []);
            };
            const onMessage = (event) => {
                if (event.source !== window) return;
                const data = event.data || {};
                if (data.type !== DATA_CACHE_RESPONSE_TYPE || data.requestId !== requestId) return;
                finish(data.entries);
            };
            window.addEventListener('message', onMessage);
            try {
                window.postMessage({
                    type: DATA_CACHE_REQUEST_TYPE,
                    requestId,
                    currentUrl: window.location.href
                }, '*');
            } catch (_) {
                finish([]);
                return;
            }
            setTimeout(() => finish([]), timeoutMs);
        });
    }

    async function refreshStructuredDataCache() {
        const rawEntries = await requestPageDataCache();
        const entries = filterStructuredEntriesForCurrentContext(rawEntries, window.location.href);
        window.__FatherKeyMeigenStructuredEntries = entries;
        logDiagnostic('structured-cache', {
            entries: entries.length,
            rawEntries: rawEntries.length,
            pageUrl: window.location.href
        });
        return entries;
    }

    function getStructuredEntriesForCollection() {
        return Array.isArray(window.__FatherKeyMeigenStructuredEntries)
            ? window.__FatherKeyMeigenStructuredEntries
            : [];
    }

    function getItemExpectedImageUrls(item = {}) {
        return (Array.isArray(item.image_sources) ? item.image_sources : [])
            .map((entry) => String(entry?.url || '').trim())
            .filter(Boolean);
    }

    function buildCollectionOptions(extra = {}, item = null) {
        const structuredEntries = Array.isArray(extra.structuredEntries)
            ? extra.structuredEntries
            : getStructuredEntriesForCollection();
        const itemOptions = item ? {
            expectedImageUrls: getItemExpectedImageUrls(item),
            expectedOriginalWorkUrl: item.original_work_url || '',
            expectedAuthorHandle: item.author_handle || '',
            sourceItemId: item.source_item_id || ''
        } : {};
        return {
            ...extra,
            ...itemOptions,
            structuredEntries
        };
    }

    function getDetailFavoriteCountFromPromptPanel(documentRef = document, collector = getCollector()) {
        const promptPanel = findDetailPromptPanel(documentRef);
        const parser = collector?.parseFavoriteCount;
        if (!promptPanel || typeof parser !== 'function') return 0;
        const lines = normalizeText(promptPanel.innerText || promptPanel.textContent || '', 1200)
            .split(/\n+/)
            .map((line) => normalizeText(line, 80))
            .filter(Boolean);
        const copyIndex = lines.findIndex((line) => /^(复制\s*(Prompt|提示词)|Copy\s*Prompt)$/i.test(line));
        const candidates = copyIndex >= 0 ? lines.slice(0, copyIndex) : lines.slice(0, 8);
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
            const line = candidates[index];
            if (!/^\d{1,7}$/.test(line)) continue;
            const parsed = Number.parseInt(line, 10);
            if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        }
        return parser(candidates.join('\n'));
    }

    function getControlText(element) {
        return normalizeText([
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
            element?.getAttribute?.('data-testid'),
            element?.getAttribute?.('class'),
            element?.innerText,
            element?.textContent
        ].filter(Boolean).join(' '), 400);
    }

    function getShortControlText(element) {
        const attributeText = normalizeText([
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
            element?.getAttribute?.('data-testid'),
            element?.getAttribute?.('class')
        ].filter(Boolean).join(' '), 240);
        const visibleText = normalizeText(element?.innerText || element?.textContent || '', 120);
        return normalizeText([attributeText, visibleText].filter(Boolean).join(' '), 320);
    }

    function isInteractivePromptControl(element) {
        return Boolean(element?.matches?.([
            'button',
            '[role="button"]',
            'a[href]',
            '[tabindex]',
            '[data-prompt]',
            '[data-prompt-text]',
            '[data-clipboard-text]',
            '[data-copy-text]'
        ].join(',')));
    }

    function dispatchSyntheticClick(element, { preventNavigation = false } = {}) {
        if (!element?.dispatchEvent) return false;
        const eventOptions = { bubbles: true, cancelable: true, view: element.ownerDocument?.defaultView || window };
        const navigationAnchor = preventNavigation ? element.closest?.('a[href]') : null;
        const preventAnchorNavigation = (event) => event.preventDefault();
        if (navigationAnchor) {
            navigationAnchor.addEventListener('click', preventAnchorNavigation, { capture: true, once: true });
        }
        try {
            element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
            element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        } catch (_) {
            element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
            element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        }
        const result = element.dispatchEvent(new MouseEvent('click', eventOptions));
        navigationAnchor?.removeEventListener('click', preventAnchorNavigation, { capture: true });
        return result;
    }

    async function readClipboardText(documentRef = document) {
        const readers = [
            globalThis.navigator?.clipboard,
            documentRef?.defaultView?.navigator?.clipboard
        ].filter(Boolean);
        for (const clipboard of readers) {
            try {
                const text = await clipboard.readText();
                if (text) return text;
            } catch (_) {
                // Clipboard can be blocked without extension permission or page focus.
            }
        }
        return '';
    }

    function cleanCopiedPromptText(value = '', collector = getCollector()) {
        const cleaner = collector?._private?.cleanPromptText;
        const cleaned = typeof cleaner === 'function'
            ? cleaner(value)
            : normalizeText(value);
        if (isLikelyNonPromptListText(cleaned)) return '';
        if (cleaned.length < 12 || /^https?:\/\//i.test(cleaned)) return '';
        return cleaned;
    }

    function isLikelyNonPromptListText(value = '') {
        const text = normalizeText(value, 5000);
        if (!text) return false;
        const lines = text.split(/\n+/).map((line) => normalizeText(line, 160)).filter(Boolean);
        const handleCount = (text.match(/@[a-zA-Z0-9_]{1,20}\b/g) || []).length;
        const creativeActionCount = (text.match(/使用创意|Use\s+creative|Use\s+Prompt/gi) || []).length;
        const numericLineCount = lines.filter((line) => /^\d+(?:[,.]\d+)?(?:[kK万千])?$/.test(line)).length;
        if (creativeActionCount >= 2 && handleCount >= 2) return true;
        if (handleCount >= 3 && numericLineCount >= 2) return true;
        if (/^(Lab|最热|最新|热门|推荐)$/i.test(lines[0] || '') && handleCount >= 2 && creativeActionCount >= 1) return true;
        return false;
    }

    function getClipboardPromptAttributeText(control, collector = getCollector()) {
        const cleaner = collector?._private?.cleanPromptText;
        const nodes = [
            control,
            ...Array.from(control?.querySelectorAll?.([
                '[data-prompt]',
                '[data-prompt-text]',
                '[data-clipboard-text]',
                '[data-copy-text]'
            ].join(',')) || [])
        ].filter(Boolean);
        for (let parent = control?.parentElement, depth = 0; parent && depth < 3; parent = parent.parentElement, depth += 1) {
            nodes.push(parent);
        }
        for (const node of nodes) {
            const value = [
                node?.getAttribute?.('data-prompt'),
                node?.getAttribute?.('data-prompt-text'),
                node?.getAttribute?.('data-clipboard-text'),
                node?.getAttribute?.('data-copy-text'),
                node?.getAttribute?.('value')
            ].find(Boolean);
            const prompt = cleanCopiedPromptText(typeof cleaner === 'function' ? cleaner(value) : value, collector);
            if (prompt) return prompt;
        }
        return '';
    }

    function getVisiblePromptPrefix(documentRef, collector = getCollector()) {
        const visible = cleanCopiedPromptText(collector?._private?.extractPromptText?.(documentRef) || '', collector);
        return visible
            .replace(COLLAPSED_PROMPT_MARKER_PATTERN, '')
            .slice(0, 42)
            .trim();
    }

    function getCompletePromptTextFromDocument(documentRef, collector = getCollector()) {
        const extractor = collector?._private?.extractPromptText;
        if (typeof extractor !== 'function') return '';
        const prompt = cleanCopiedPromptText(extractor(documentRef), collector);
        if (!prompt) return '';
        const isCollapsedPromptText = collector?._private?.isCollapsedPromptText;
        if (typeof isCollapsedPromptText === 'function' && isCollapsedPromptText(prompt)) return '';
        if (COLLAPSED_PROMPT_MARKER_PATTERN.test(normalizeText(prompt, 800))) return '';
        return prompt;
    }

    function getPromptPanelText(element) {
        return normalizeText(element?.innerText || element?.textContent || '', 9000);
    }

    function isDetailPromptPanelCandidate(node) {
        const text = getPromptPanelText(node);
        return Boolean(text && DETAIL_PROMPT_LABEL_PATTERN.test(text) && PROMPT_COPY_TEXT_PATTERN.test(text));
    }

    function findDetailPromptPanel(documentRef = document) {
        if (!documentRef?.querySelectorAll) return null;
        const candidates = [
            ...(documentRef.nodeType === 9 ? [] : [documentRef]),
            ...Array.from(documentRef.querySelectorAll([
            'aside',
            'section',
            'article',
            'main',
            '[role="dialog"]',
            '[class*="side" i]',
            '[class*="detail" i]',
            '[class*="drawer" i]',
            '[class*="panel" i]',
            'div'
            ].join(','))).slice(0, 900)
        ];
        const scored = candidates
            .map((node) => {
                const text = getPromptPanelText(node);
                if (!isDetailPromptPanelCandidate(node)) return null;
                let score = 100;
                if (DETAIL_AUTHOR_HANDLE_PATTERN.test(text)) score += 35;
                if (/更多相关内容|More related content/i.test(text)) score -= 12;
                if (text.length < 2500) score += 30;
                if (text.length > 7000) score -= 35;
                return {
                    node,
                    score,
                    textLength: text.length
                };
            })
            .filter(Boolean)
            .sort((a, b) => (b.score - a.score) || (a.textLength - b.textLength));
        return scored[0]?.node || null;
    }

    function shouldAttemptPromptCopyClick(documentRef = document) {
        return Boolean(
            globalThis.__FatherKeyMeigenDisablePromptCopyClick !== true
            && documentRef?.defaultView?.__FatherKeyMeigenDisablePromptCopyClick !== true
        );
    }

    function focusPromptCopyControl(control) {
        try {
            control?.scrollIntoView?.({ block: 'center', inline: 'center' });
        } catch (_) {
            // Best-effort only.
        }
        if (typeof control?.focus === 'function') {
            try {
                control.focus({ preventScroll: true });
            } catch (_) {
                control.focus();
            }
        }
    }

    function enablePromptCopyCapture(documentRef = document, durationMs = PROMPT_COPY_CAPTURE_TIMEOUT_MS) {
        try {
            const event = new CustomEvent('FatherKeyMeigenEnablePromptCapture', {
                detail: { durationMs },
                bubbles: false,
                cancelable: false
            });
            (documentRef?.defaultView || window).dispatchEvent(event);
        } catch (_) {
            // Bridge may be unavailable on older injected pages.
        }
    }

    function waitForPromptCopyCapture(documentRef = document, collector = getCollector(), timeoutMs = PROMPT_COPY_CAPTURE_TIMEOUT_MS) {
        return new Promise((resolve) => {
            const view = documentRef?.defaultView || window;
            let settled = false;
            const cleanup = () => {
                try {
                    view.removeEventListener('FatherKeyMeigenPromptCopied', onPromptCopied);
                } catch (_) {
                    // Ignore cleanup failure.
                }
            };
            const finish = (value = '') => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(cleanCopiedPromptText(value, collector));
            };
            const onPromptCopied = (event) => {
                const prompt = cleanCopiedPromptText(event?.detail || '', collector);
                if (prompt) finish(prompt);
            };
            try {
                view.addEventListener('FatherKeyMeigenPromptCopied', onPromptCopied);
            } catch (_) {
                resolve('');
                return;
            }
            setTimeout(() => finish(''), timeoutMs);
        });
    }

    function isCopiedPromptForCurrentDetail(copiedText = '', beforeText = '', documentRef = document, collector = getCollector()) {
        const copied = cleanCopiedPromptText(copiedText, collector);
        if (!copied) return false;
        const before = cleanCopiedPromptText(beforeText, collector);
        const visiblePrefix = getVisiblePromptPrefix(documentRef, collector);
        if (visiblePrefix.length >= 16 && copied.startsWith(visiblePrefix)) return true;
        return copied !== before && copied.length >= 40;
    }

    function findPromptActionControls(documentRef, pattern) {
        if (!documentRef?.querySelectorAll) return [];
        const allowPromptAttributeMatch = pattern === PROMPT_COPY_TEXT_PATTERN;
        const interactiveNodes = Array.from(documentRef.querySelectorAll([
            'button',
            '[role="button"]',
            'a[href]',
            '[aria-label]',
            '[title]',
            '[data-testid]',
            '[data-clipboard-text]',
            '[data-copy-text]',
            '[data-prompt]',
            '[data-prompt-text]'
        ].join(',')));
        const textNodes = Array.from(documentRef.querySelectorAll([
            'svg',
            'span',
            'div'
        ].join(',')));
        const candidates = [];
        interactiveNodes.forEach((element) => {
            if (pattern.test(getShortControlText(element))
                || (allowPromptAttributeMatch && getClipboardPromptAttributeText(element))) {
                candidates.push(element);
            }
        });
        textNodes.forEach((element) => {
            const text = normalizeText(element?.innerText || element?.textContent || '', 120);
            if (text.length > 60 || !pattern.test(text)) return;
            const control = element.closest?.('button, [role="button"], a[href], [tabindex], [data-prompt], [data-prompt-text], [data-clipboard-text], [data-copy-text]');
            candidates.push(control || element);
        });
        const seen = new Set();
        return candidates
            .filter(Boolean)
            .filter((element) => {
                const key = element;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => Number(!isInteractivePromptControl(a)) - Number(!isInteractivePromptControl(b)))
            .slice(0, 10);
    }

    async function expandPromptSection(documentRef) {
        const expandControls = findPromptActionControls(documentRef, PROMPT_EXPAND_TEXT_PATTERN);
        if (!expandControls.length) return false;
        expandControls.forEach(dispatchSyntheticClick);
        await sleep(180);
        return true;
    }

    async function readPromptFromCopyButton(documentRef, collector = getCollector()) {
        const promptPanel = findDetailPromptPanel(documentRef);
        const promptRoot = promptPanel || documentRef;
        const extractedPrompt = getCompletePromptTextFromDocument(promptRoot, collector);
        logDiagnostic('prompt-panel', {
            hasPanel: Boolean(promptPanel),
            visiblePromptLength: extractedPrompt.length,
            panelTextPreview: promptPanel ? getPromptPanelText(promptPanel).slice(0, 220) : ''
        });
        if (extractedPrompt && !promptNeedsDetailEnrichment(extractedPrompt)) return extractedPrompt;

        const copyControls = findPromptActionControls(promptRoot, PROMPT_COPY_TEXT_PATTERN);
        logDiagnostic('prompt-copy-controls', {
            count: copyControls.length,
            labels: copyControls.slice(0, 4).map((control) => getShortControlText(control))
        });
        if (!copyControls.length) return '';
        const before = await readClipboardText(documentRef);
        for (const control of copyControls) {
            const attributePrompt = getClipboardPromptAttributeText(control, collector);
            if (attributePrompt) {
                logDiagnostic('prompt-copy-attribute', {
                    length: attributePrompt.length,
                    preview: attributePrompt.slice(0, 180)
                });
                return attributePrompt;
            }
            if (!shouldAttemptPromptCopyClick(documentRef)) continue;
            focusPromptCopyControl(control);
            await sleep(PROMPT_COPY_CLICK_DELAY_MS);
            enablePromptCopyCapture(documentRef);
            const capturedPrompt = waitForPromptCopyCapture(documentRef, collector);
            dispatchSyntheticClick(control);
            await sleep(250);
            const bridgedPrompt = await capturedPrompt;
            if (bridgedPrompt) {
                logDiagnostic('prompt-copy-bridge', {
                    length: bridgedPrompt.length,
                    preview: bridgedPrompt.slice(0, 180)
                });
                return bridgedPrompt;
            }
            const after = await readClipboardText(documentRef);
            if (isCopiedPromptForCurrentDetail(after, before, promptRoot, collector)) {
                const prompt = cleanCopiedPromptText(after, collector);
                logDiagnostic('prompt-copy-clipboard', {
                    length: prompt.length,
                    preview: prompt.slice(0, 180)
                });
                return prompt;
            }
        }
        logDiagnostic('prompt-copy-missing', {
            beforeLength: before.length
        });
        return '';
    }

    function promptLooksCollapsed(value = '') {
        return COLLAPSED_PROMPT_MARKER_PATTERN.test(normalizeText(value, 600));
    }

    function enrichItemsWithCopiedPrompt(items = [], copiedPrompt = '', collector = getCollector()) {
        const prompt = cleanCopiedPromptText(copiedPrompt, collector);
        if (!prompt) return items;
        return (Array.isArray(items) ? items : []).map((item) => ({
            ...item,
            prompt_text: prompt,
            prompt_complete: true
        }));
    }

    function getLatestPayload(collector) {
        return pageBatchJob.lastPayload
            || scrollJob.lastPayload
            || detailJob.lastPayload
            || collector.buildPayload();
    }

    function findHoverScopeFromImage(image) {
        let node = image;
        for (let depth = 0; node && depth < 7; depth += 1) {
            if (node.matches?.(HOVER_SCOPE_SELECTOR)) return node;
            node = node.parentElement;
        }
        return image.closest?.('a[href]') || image.parentElement || image;
    }

    function dispatchHoverEvents(target) {
        if (!target?.dispatchEvent) return;
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        try {
            target.dispatchEvent(new PointerEvent('pointerover', eventOptions));
            target.dispatchEvent(new PointerEvent('pointerenter', { ...eventOptions, bubbles: false }));
        } catch (_) {
            target.dispatchEvent(new MouseEvent('mouseover', eventOptions));
        }
        target.dispatchEvent(new MouseEvent('mouseover', eventOptions));
        target.dispatchEvent(new MouseEvent('mouseenter', { ...eventOptions, bubbles: false }));
        if (typeof target.focus === 'function') {
            try {
                target.focus({ preventScroll: true });
            } catch (_) {
                target.focus();
            }
        }
    }

    function getHoverChildTargets(target) {
        if (!target?.querySelectorAll) return [];
        return Array.from(target.querySelectorAll('a, button, [role="button"], [aria-label], [title]'))
            .filter((node) => {
                const label = String(
                    node.getAttribute?.('aria-label')
                    || node.getAttribute?.('title')
                    || node.textContent
                    || node.className
                    || ''
                );
                return /\bX\b|Twitter|在\s*X\s*上查看|查看|share|source|原作|原作品/i.test(label);
            })
            .slice(0, 8);
    }

    function cacheHoverAuthorIdentity(target, collector = getCollector()) {
        const handleGetter = collector?._private?.getAuthorHandle;
        const nameGetter = collector?._private?.getAuthorName;
        if (!target || typeof handleGetter !== 'function' || typeof nameGetter !== 'function') return null;
        const handle = String(handleGetter(target, '') || '').trim();
        const name = String(nameGetter(target, handle) || '').trim();
        if (!handle || !name) return null;
        const prompt = String(collector?._private?.extractPromptText?.(target) || '').trim();
        if (prompt && normalizeText(prompt).toLowerCase() === normalizeText(name).toLowerCase()) return null;
        target.dataset ||= {};
        target.dataset.authorHandle = handle;
        target.dataset.authorName = name;
        target.dataset.authorIdentitySource = 'hover';
        const cache = window.__FatherKeyMeigenHoverAuthors instanceof Map
            ? window.__FatherKeyMeigenHoverAuthors
            : new Map();
        window.__FatherKeyMeigenHoverAuthors = cache;
        const links = Array.from(target.querySelectorAll?.('a[href]') || [])
            .map((link) => String(link.href || link.getAttribute?.('href') || '').trim())
            .filter(Boolean);
        const keys = new Set([
            ...links,
            ...links.map((url) => getLongNumericIdFromText(url)),
            getLongNumericIdFromText(target.innerText || target.textContent || '')
        ].filter(Boolean));
        keys.forEach((key) => cache.set(String(key).toLowerCase(), { name, handle }));
        logDiagnostic('hover-author', {
            name,
            handle,
            keys: Array.from(keys).slice(0, 6)
        });
        return { name, handle };
    }

    async function revealHoverControls(root = document, maxTargets = 20) {
        if (root !== document || !root?.querySelectorAll) return;
        const collector = getCollector();
        const targetLimit = Math.min(80, Math.max(1, Number(maxTargets) || 20));
        const targets = Array.from(root.querySelectorAll('img'))
            .map((image) => findHoverScopeFromImage(image))
            .filter(Boolean)
            .slice(0, targetLimit);
        const seen = new Set();
        for (const target of targets) {
            if (seen.has(target)) continue;
            seen.add(target);
            dispatchHoverEvents(target);
            getHoverChildTargets(target).forEach(dispatchHoverEvents);
            await sleep(HOVER_REVEAL_DELAY_MS);
            cacheHoverAuthorIdentity(target, collector);
        }
    }

    async function waitWhilePaused() {
        while (detailJob.paused) {
            await sleep(300);
        }
    }

    function normalizeScrollStepCount(value) {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return SCROLL_COLLECT_MAX_STEPS;
        return Math.min(parsed, 80);
    }

    function normalizePageBatchCount(value) {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return PAGE_BATCH_MAX_PAGES;
        return Math.min(parsed, 200);
    }

    function normalizeMaxItems(value) {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return 20;
        return Math.min(parsed, 200);
    }

    function normalizeFavoriteRange(message = {}) {
        const minFavorites = Number.parseInt(String(message.minFavorites || ''), 10);
        const maxFavorites = Number.parseInt(String(message.maxFavorites || ''), 10);
        return {
            minFavorites: Number.isFinite(minFavorites) && minFavorites > 0 ? minFavorites : 0,
            maxFavorites: Number.isFinite(maxFavorites) && maxFavorites > 0 ? maxFavorites : 0
        };
    }

    function limitPayloadItems(payload = {}, maxItems = 20) {
        const limit = normalizeMaxItems(maxItems);
        const items = Array.isArray(payload.items) ? payload.items.slice(0, limit) : [];
        return {
            ...payload,
            items
        };
    }

    function filterPayloadByFavoriteRange(payload = {}, favoriteRange = {}) {
        const collector = getCollector();
        const matcher = collector?._private?.itemMatchesFavoriteRange;
        const items = Array.isArray(payload.items) ? payload.items : [];
        const filteredItems = typeof matcher === 'function'
            ? items.filter((item) => matcher(item, favoriteRange))
            : items;
        return {
            ...payload,
            items: filteredItems
        };
    }

    function applyPayloadLimits(payload = {}, { maxItems = 20, favoriteRange = {} } = {}) {
        return limitPayloadItems(filterPayloadByFavoriteRange(payload, favoriteRange), maxItems);
    }

    function getScrollableRoot() {
        return document.scrollingElement || document.documentElement || document.body;
    }

    function getScrollSnapshot() {
        const root = getScrollableRoot();
        return {
            y: window.scrollY || root.scrollTop || 0,
            height: root.scrollHeight || document.body?.scrollHeight || 0,
            viewport: window.innerHeight || root.clientHeight || 800
        };
    }

    function scrollOneViewport() {
        const snapshot = getScrollSnapshot();
        const distance = Math.max(520, Math.round(snapshot.viewport * 0.86));
        window.scrollBy({ top: distance, behavior: 'smooth' });
    }

    async function scrollAndWaitForGalleryBatch() {
        let previousSnapshot = getScrollSnapshot();
        let stableRounds = 0;
        window.scrollTo({ top: previousSnapshot.height, behavior: 'auto' });
        for (let attempt = 0; attempt < SCROLL_BATCH_SETTLE_LIMIT; attempt += 1) {
            await sleep(SCROLL_BATCH_SETTLE_POLL_MS);
            const nextSnapshot = getScrollSnapshot();
            const grew = nextSnapshot.height > previousSnapshot.height + 12;
            stableRounds = grew ? 0 : stableRounds + 1;
            if (grew) window.scrollTo({ top: nextSnapshot.height, behavior: 'auto' });
            previousSnapshot = nextSnapshot;
            if (attempt >= 3 && stableRounds >= 3) break;
        }
        return previousSnapshot;
    }

    function isSameMeigenUrl(url = '') {
        try {
            const parsed = new URL(url, window.location.href);
            return parsed.hostname === 'www.meigen.ai' || parsed.hostname === 'meigen.ai';
        } catch (_) {
            return false;
        }
    }

    function normalizeBatchUrl(value = '', baseUrl = window.location.href) {
        try {
            const url = new URL(String(value || ''), baseUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
            if (!isSameMeigenUrl(url.toString())) return '';
            return url.toString();
        } catch (_) {
            return '';
        }
    }

    function isDisabledNextControl(element) {
        if (!element) return true;
        return element.disabled
            || element.getAttribute?.('aria-disabled') === 'true'
            || /\b(disabled|is-disabled|inactive)\b/i.test(element.className || '');
    }

    function getNextControlLabel(element) {
        return String(
            element?.getAttribute?.('aria-label')
            || element?.getAttribute?.('title')
            || element?.textContent
            || ''
        ).replace(/\s+/g, ' ').trim();
    }

    function findNextPageTarget(root = document, baseUrl = window.location.href) {
        if (!root?.querySelectorAll) return null;

        const relNext = root.querySelector('a[rel~="next" i][href], link[rel~="next" i][href]');
        const relNextUrl = normalizeBatchUrl(relNext?.getAttribute?.('href'), baseUrl);
        if (relNextUrl) return { type: 'url', url: relNextUrl };

        const controls = Array.from(root.querySelectorAll('a[href], button, [role="button"], [aria-label], [title]'));
        for (const control of controls) {
            if (isDisabledNextControl(control)) continue;
            const label = getNextControlLabel(control);
            if (!NEXT_PAGE_TEXT_PATTERN.test(label)) continue;

            const href = control.getAttribute?.('href');
            const url = normalizeBatchUrl(href, baseUrl);
            if (url) return { type: 'url', url };
            if (root === document && typeof control.click === 'function') {
                return { type: 'click', element: control, label };
            }
        }

        const pageLinks = Array.from(root.querySelectorAll('a[href]'));
        const currentUrl = new URL(baseUrl, window.location.href);
        const currentPage = Number.parseInt(currentUrl.searchParams.get('page') || currentUrl.searchParams.get('p') || '0', 10);
        for (const link of pageLinks) {
            const url = normalizeBatchUrl(link.getAttribute('href'), baseUrl);
            if (!url) continue;
            const parsed = new URL(url);
            const page = Number.parseInt(parsed.searchParams.get('page') || parsed.searchParams.get('p') || '0', 10);
            if (Number.isFinite(page) && Number.isFinite(currentPage) && page === currentPage + 1) {
                return { type: 'url', url };
            }
        }

        return null;
    }

    async function fetchBatchDocument(url) {
        const response = await fetch(url, {
            credentials: 'include',
            headers: {
                Accept: 'text/html,application/xhtml+xml'
            }
        });
        if (!response.ok) {
            throw new Error(`页面读取失败 (${response.status})`);
        }
        const html = await response.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    function getDetailUrls(items = []) {
        const seen = new Set();
        const urls = [];
        for (const item of Array.isArray(items) ? items : []) {
            const url = String(item?.source_page_url || '').trim();
            if (!url || seen.has(url) || !isSameMeigenUrl(url)) continue;
            seen.add(url);
            urls.push(url);
        }
        return urls;
    }

    function getDetailResolutionKeys(item = {}) {
        return [
            item.source_item_id ? `source:${String(item.source_item_id).trim()}` : '',
            item.source_page_url ? `detail:${String(item.source_page_url).trim().toLowerCase()}` : '',
            item.original_work_url ? `original:${String(item.original_work_url).trim().toLowerCase()}` : ''
        ].filter(Boolean);
    }

    function markDetailResolved(resolvedKeys, item = {}, detailItems = []) {
        getDetailResolutionKeys(item).forEach((key) => resolvedKeys.add(key));
        (Array.isArray(detailItems) ? detailItems : [])
            .forEach((detailItem) => getDetailResolutionKeys(detailItem).forEach((key) => resolvedKeys.add(key)));
    }

    function isDetailResolved(resolvedKeys, item = {}) {
        return getDetailResolutionKeys(item).some((key) => resolvedKeys.has(key));
    }

    function hasUsefulDetailData(items = []) {
        return Array.isArray(items) && items.some((item) => {
            return String(item?.prompt_text || '').trim()
                || String(item?.original_work_url || '').trim()
                || String(item?.author_name || '').trim()
                || String(item?.author_handle || '').trim();
        });
    }

    function hasCompletePromptData(items = [], collector = getCollector()) {
        const isCollapsedPromptText = collector?._private?.isCollapsedPromptText;
        return Array.isArray(items) && items.some((item) => {
            const prompt = cleanCopiedPromptText(item?.prompt_text || '', collector);
            if (!prompt) return false;
            if (item?.prompt_complete) return true;
            if (promptNeedsDetailEnrichment(prompt)) return false;
            return typeof isCollapsedPromptText !== 'function' || !isCollapsedPromptText(prompt);
        });
    }

    function promptNeedsDetailEnrichment(value = '') {
        const text = normalizeText(value, 20000);
        if (!text) return true;
        if (text.length < 180) return true;
        if (/Free\s+GPT\s+Image|Copy,\s*paste,\s*generate|no\s+prompt\s+engineering/i.test(text)) return true;
        return false;
    }

    function itemPromptNeedsDetailEnrichment(item = {}) {
        return !item?.prompt_complete && promptNeedsDetailEnrichment(item?.prompt_text || '');
    }

    function expandDetailItemImagesToExpectedCount(item = {}, expectedCount = 0, collector = getCollector()) {
        const count = Number(expectedCount || item.expected_image_count || 0);
        if (!count || count <= 1) return item;
        const images = Array.isArray(item.image_sources) ? item.image_sources : [];
        if (images.length >= count) return item;
        const expander = collector?._private?.expandTweetImageSequence;
        if (typeof expander !== 'function') return item;
        const expandedUrls = expander(images.map((entry) => entry?.url).filter(Boolean), count);
        if (!expandedUrls.length || expandedUrls.length <= images.length) return item;
        return {
            ...item,
            expected_image_count: count,
            detail_expected_count_authoritative: true,
            detail_image_count_authoritative: expandedUrls.length >= count,
            image_sources: expandedUrls.slice(0, count).map((url) => ({ url }))
        };
    }

    function expandDetailItemsToExpectedCount(items = [], expectedCount = 0, collector = getCollector()) {
        return (Array.isArray(items) ? items : [])
            .map((item) => expandDetailItemImagesToExpectedCount(item, expectedCount, collector));
    }

    function mergeDetailItemsWithCopiedPrompt(items = [], copiedPrompt = '', collector = getCollector()) {
        return enrichItemsWithCopiedPrompt(items, copiedPrompt, collector);
    }

    function hasRealDetailImage(item = {}) {
        return getTrustedImageSourcesForItem(item)
            .some((entry) => /\/(?:tweets|generations)\//i.test(String(entry?.url || '')));
    }

    function filterUsableDetailItems(items = [], collector = getCollector()) {
        return (Array.isArray(items) ? items : []).filter((item) => (
            !itemPromptNeedsDetailEnrichment(item)
            || hasRealDetailImage(item)
            || String(item?.original_work_url || '').trim()
        ));
    }

    function mergeImageSources(left = [], right = [], limit = 24) {
        const seen = new Set();
        const images = [];
        [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].forEach((entry) => {
            const url = String(entry?.url || '').trim();
            if (!url) return;
            const key = url.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            images.push({ ...entry, url });
        });
        return images.slice(0, limit);
    }

    function isDetailImageCountAuthoritative(item = {}) {
        return Boolean(item.detail_image_count_authoritative && Number(item.expected_image_count || 0) > 0);
    }

    function isDetailExpectedCountAuthoritative(item = {}) {
        return Boolean(item.detail_expected_count_authoritative && Number(item.expected_image_count || 0) > 0);
    }

    function hasExpectedDetailImages(items = []) {
        return (Array.isArray(items) ? items : []).some((item) => {
            const expectedCount = Number(item?.expected_image_count || 0);
            const imageCount = getTrustedImageSourcesForItem(item).length;
            if (expectedCount > 0) return imageCount >= expectedCount;
            return imageCount > 0;
        });
    }

    function getDetailExpectedCountFromDocument(documentRef = document) {
        const getter = getCollector()?._private?.getTrustedDetailArtworkExpectedCount;
        if (typeof getter !== 'function') return 0;
        const scopes = [
            documentRef.querySelector?.('[role="dialog"]'),
            documentRef.querySelector?.('main'),
            documentRef.body,
            documentRef
        ].filter(Boolean);
        for (const scope of scopes) {
            const count = Number(getter(scope) || 0);
            if (count > 0) return count;
        }
        return 0;
    }

    function getItemDetailIdentity(item = {}) {
        return normalizeBatchUrl(item.source_page_url || item.original_work_url || '')
            || String(item.source_item_id || '').trim();
    }

    function detailItemMatchesTarget(detailItem = {}, targetItem = {}) {
        const targetUrl = normalizeBatchUrl(targetItem.source_page_url || '');
        const detailUrl = normalizeBatchUrl(detailItem.source_page_url || '');
        const targetOriginal = String(targetItem.original_work_url || '').trim();
        const detailOriginal = String(detailItem.original_work_url || '').trim();
        const targetId = String(targetItem.source_item_id || '').trim();
        const detailId = String(detailItem.source_item_id || '').trim();
        if (targetUrl && detailUrl && urlsLooselyMatch(targetUrl, detailUrl)) return true;
        if (targetOriginal && detailOriginal && urlsLooselyMatch(targetOriginal, detailOriginal)) return true;
        if (targetId && detailId && targetId === detailId) return true;
        return false;
    }

    function currentDetailUrlMatchesTarget(item = {}, currentUrl = window.location.href) {
        const targetUrl = normalizeBatchUrl(item.source_page_url || '');
        const current = normalizeBatchUrl(currentUrl || '');
        const targetPromptId = getPromptIdFromUrl(targetUrl)
            || getLongNumericIdFromText(item.original_work_url || '')
            || getLongNumericIdFromText(item.source_item_id || '');
        const currentPromptId = getPromptIdFromUrl(current);
        if (targetPromptId && currentPromptId) return targetPromptId === currentPromptId;
        if (targetUrl && current) return urlsLooselyMatch(targetUrl, current);
        return false;
    }

    function getLongNumericIdFromText(value = '') {
        return String(value || '').match(/\b\d{12,25}\b/)?.[0] || '';
    }

    function getTweetStatusIdFromImageUrl(value = '') {
        let decoded = String(value || '');
        try {
            decoded = decodeURIComponent(decoded);
        } catch (_) {
            // Use the raw URL if decoding fails.
        }
        return decoded.match(/\/tweets\/(\d{12,25})(?:\/|$)/i)?.[1] || '';
    }

    function getTargetStatusIds(item = {}) {
        return new Set([
            getPromptIdFromUrl(item.source_page_url || ''),
            getLongNumericIdFromText(item.original_work_url || ''),
            ...((Array.isArray(item.image_sources) ? item.image_sources : [])
                .map((entry) => getTweetStatusIdFromImageUrl(entry?.url || '')))
        ].filter(Boolean));
    }

    function getTrustedImageSourcesForItem(item = {}, referenceItem = item, collector = getCollector()) {
        const images = Array.isArray(item.image_sources) ? item.image_sources : [];
        const checker = collector?._private?.isImageUrlTrustedForStatus;
        const statusIdGetter = collector?._private?.getStatusIdFromImageUrl;
        const communityChecker = collector?._private?.isCommunityDetailUrl;
        if (
            typeof communityChecker === 'function'
            && communityChecker(referenceItem?.source_page_url || item?.source_page_url || '')
            && typeof statusIdGetter === 'function'
        ) {
            return images.filter((entry) => !statusIdGetter(entry?.url || ''));
        }
        const targetStatusIds = getTargetStatusIds(referenceItem || item);
        if (typeof checker !== 'function' || targetStatusIds.size <= 0) {
            return images.filter((entry) => String(entry?.url || '').trim());
        }
        return images.filter((entry) => {
            const url = String(entry?.url || '').trim();
            if (!url) return false;
            return Array.from(targetStatusIds).some((statusId) => checker(url, statusId));
        });
    }

    function getDetailImageStatusIds(item = {}) {
        return new Set((Array.isArray(item.image_sources) ? item.image_sources : [])
            .map((entry) => getTweetStatusIdFromImageUrl(entry?.url || ''))
            .filter(Boolean));
    }

    function scoreDetailCandidate(detailItem = {}, targetItem = {}, expectedCount = 0) {
        const imageCount = getTrustedImageSourcesForItem(detailItem, {
            ...detailItem,
            source_page_url: targetItem.source_page_url || detailItem.source_page_url || '',
            original_work_url: targetItem.original_work_url || detailItem.original_work_url || '',
            image_sources: [
                ...(Array.isArray(targetItem.image_sources) ? targetItem.image_sources : []),
                ...(Array.isArray(detailItem.image_sources) ? detailItem.image_sources : [])
            ]
        }).length;
        const expected = Number(detailItem.expected_image_count || 0) || expectedCount || 0;
        const targetStatusIds = getTargetStatusIds(targetItem);
        const detailImageStatusIds = getDetailImageStatusIds(detailItem);
        const hasMatchingImageStatus = targetStatusIds.size > 0
            && Array.from(detailImageStatusIds).some((id) => targetStatusIds.has(id));
        const hasConflictingImageStatus = targetStatusIds.size > 0
            && detailImageStatusIds.size > 0
            && !hasMatchingImageStatus;
        let score = 0;
        if (detailItemMatchesTarget(detailItem, targetItem)) score += 160;
        if (hasMatchingImageStatus) score += 180;
        if (hasConflictingImageStatus) score -= 260;
        if (String(detailItem.prompt_text || '').trim()) score += 60;
        if (String(detailItem.original_work_url || '').trim()) score += 30;
        if (normalizeAuthorNameForMerge(detailItem.author_name || '')) score += 24;
        if (String(detailItem.author_handle || '').trim()) score += 16;
        if (imageCount) score += Math.min(80, imageCount * 18);
        if (expected > 0 && imageCount >= expected) score += 80;
        if (isDetailImageCountAuthoritative(detailItem)) score += 60;
        if (expected > 0 && imageCount > 0 && imageCount < expected) score -= 15;
        return score;
    }

    function selectBestDetailItemsForTarget(items = [], targetItem = {}, options = {}) {
        const expectedCount = Number(options.expectedCount || 0);
        const targetIdentity = getItemDetailIdentity(targetItem);
        const candidates = (Array.isArray(items) ? items : [])
            .filter(Boolean)
            .filter((item) => {
                if (detailItemMatchesTarget(item, targetItem)) return true;
                const itemIdentity = getItemDetailIdentity(item);
                return !targetIdentity || !itemIdentity;
            })
            .map((item, index) => ({
                item,
                index,
                score: scoreDetailCandidate(item, targetItem, expectedCount)
            }))
            .sort((a, b) => (b.score - a.score) || (b.index - a.index));
        const best = candidates[0]?.item;
        return best ? [best] : [];
    }

    function chooseBetterPrompt(currentPrompt = '', detailPrompt = '') {
        const current = normalizeText(currentPrompt, 20000);
        const next = normalizeText(detailPrompt, 20000);
        if (!next) return current;
        if (!current) return next;
        if (promptLooksCollapsed(current) && next.length > current.length) return next;
        return next.length > current.length ? next : current;
    }

    function normalizeAuthorNameForMerge(value = '') {
        const text = normalizeText(value, 240)
            .replace(/^作者[:：]\s*/i, '')
            .trim();
        if (!text) return '';
        if (DETAIL_AUTHOR_HANDLE_PATTERN.test(text) && text.replace(DETAIL_AUTHOR_HANDLE_PATTERN, '').trim() === '') return '';
        if (/^(Web\s*Page|WebPage)$/i.test(text)) return '';
        if (/^(?:Model|模型)\s*[:：]\s*[^\n]{1,48}$/i.test(text)) return '';
        if (/^(最热|最新|热门|推荐|展开|更多相关内容|相关内容|Related creations?|More related content|使用\s*Prompt|用作参考图|复制\s*Prompt|Copy\s*Prompt|提示词|Prompt|Nanobanana|Nano Banana|GPT Image|Gemini|Imagen|Seedream|Midjourney|Sora)$/i.test(text)) return '';
        if (/(likes?|views?|喜欢|浏览|收藏|bookmarks?)/i.test(text) && /[\d,.万千kK]/.test(text)) return '';
        if (/\b(?:prompt|prompts)\s+by\s+@?[a-zA-Z0-9_]{1,20}\b|\|\s*MeiGen\b/i.test(text)) return '';
        if (/^\(?\(?[a-z](?:,[a-z]){2,}\)?=>|document\.|function\s*\(|const\s+|let\s+|var\s+/i.test(text)) return '';
        if (text.length > 40 && /\b(create|design|masterpiece|premium|product|poster|advertising|advertisement|composition|cinematic|realistic|futuristic|style)\b/i.test(text)) return '';
        if (text.length > 48) return '';
        return text;
    }

    function extractAuthorNameFromVisibleText(value = '', expectedHandle = '', collector = getCollector()) {
        const normalizer = collector?._private?.normalizeAuthorName || normalizeAuthorNameForMerge;
        const handle = String(expectedHandle || '').trim();
        const lines = normalizeText(value, 2400)
            .split(/\n+/)
            .map((line) => normalizeText(line, 160))
            .filter(Boolean);
        const handleIndex = lines.findIndex((line) => {
            if (handle) return line.toLowerCase() === handle.toLowerCase();
            return DETAIL_AUTHOR_HANDLE_PATTERN.test(line);
        });
        if (handleIndex < 0) return '';
        const candidates = [
            ...lines.slice(Math.max(0, handleIndex - 3), handleIndex).reverse()
        ];
        for (const line of candidates) {
            const name = normalizer(line);
            if (name) return name;
        }
        return '';
    }

    function getAuthorNameFromDocument(documentRef = document, detailItem = {}, collector = getCollector()) {
        const handle = detailItem.author_handle || '';
        const getter = collector?._private?.getAuthorName;
        const scopes = [
            findDetailPromptPanel(documentRef),
            documentRef.querySelector?.('[role="dialog"]'),
            documentRef.querySelector?.('main'),
            documentRef.body,
            documentRef
        ].filter(Boolean);
        for (const scope of scopes) {
            if (typeof getter === 'function') {
                const name = getter(scope, handle);
                if (name) return name;
            }
            const text = scope.innerText || scope.textContent || '';
            const name = extractAuthorNameFromVisibleText(text, handle, collector);
            if (name) return name;
        }
        return '';
    }

    function enrichDetailItemsWithVisibleAuthor(items = [], documentRef = document, collector = getCollector()) {
        return (Array.isArray(items) ? items : []).map((item) => {
            const currentName = normalizeAuthorNameForMerge(item?.author_name || '');
            const authorName = getAuthorNameFromDocument(documentRef, item, collector);
            if (!authorName) return currentName ? item : { ...item, author_name: '' };
            return currentName && currentName === authorName ? item : { ...item, author_name: authorName };
        });
    }

    function chooseBetterAuthorName(currentName = '', detailName = '') {
        const current = normalizeAuthorNameForMerge(currentName);
        const next = normalizeAuthorNameForMerge(detailName);
        if (!current) return next;
        if (!next) return current;
        return next;
    }

    function applyDetailItemToTarget(target, detailItem = {}) {
        const detailExpectedCount = Number(detailItem.expected_image_count || 0);
        const detailExpectedCountIsAuthoritative = isDetailExpectedCountAuthoritative(detailItem);
        const trustContextItem = {
            ...detailItem,
            source_page_url: target.source_page_url || detailItem.source_page_url || '',
            original_work_url: target.original_work_url || detailItem.original_work_url || '',
            image_sources: [
                ...(Array.isArray(target.image_sources) ? target.image_sources : []),
                ...(Array.isArray(detailItem.image_sources) ? detailItem.image_sources : [])
            ]
        };
        const trustedCurrentImages = getTrustedImageSourcesForItem(target, trustContextItem);
        const trustedDetailImages = getTrustedImageSourcesForItem(detailItem, trustContextItem);
        const detailCountIsAuthoritative = isDetailImageCountAuthoritative(detailItem)
            && (detailExpectedCount <= 0 || trustedDetailImages.length >= detailExpectedCount);
        const currentExpectedCount = Number(target.expected_image_count || 0);
        const currentImageCount = trustedCurrentImages.length;
        const currentCountIsAuthoritative = isDetailImageCountAuthoritative(target);
        const currentExpectedCountIsAuthoritative = isDetailExpectedCountAuthoritative(target);
        const detailImageCount = trustedDetailImages.length;
        const shouldPreferCurrentExpectedCount = currentExpectedCount > detailExpectedCount
            && currentImageCount >= currentExpectedCount
            && (currentCountIsAuthoritative || currentExpectedCountIsAuthoritative);
        const shouldKeepCurrentImages = currentImageCount > 0
            && currentExpectedCount > 0
            && currentImageCount >= currentExpectedCount
            && (currentCountIsAuthoritative || detailImageCount < currentImageCount);
        let expectedCount = Math.max(currentExpectedCount, detailExpectedCount);
        if (detailCountIsAuthoritative || detailExpectedCountIsAuthoritative) {
            expectedCount = detailExpectedCount;
        }
        if (shouldPreferCurrentExpectedCount) {
            expectedCount = currentExpectedCount;
        }
        const imageLimit = expectedCount > 0 ? expectedCount : 24;
        target.source_item_id = target.source_item_id || detailItem.source_item_id || '';
        target.source_page_url = target.source_page_url || detailItem.source_page_url || '';
        target.original_work_url = target.original_work_url || detailItem.original_work_url || '';
        const targetAuthorSource = String(target.author_identity_source || '');
        const detailAuthorSource = String(detailItem.author_identity_source || '');
        const targetAuthorName = normalizeAuthorNameForMerge(target.author_name || '');
        const targetPrompt = normalizeText(target.prompt_text || '', 20000);
        const targetAuthorMatchesPrompt = Boolean(
            targetAuthorName
            && targetPrompt
            && targetAuthorName.toLowerCase() === targetPrompt.toLowerCase()
        );
        const targetHasReliableHoverAuthor = targetAuthorSource === 'hover'
            && Boolean(targetAuthorName)
            && !targetAuthorMatchesPrompt;
        if (detailAuthorSource === 'hover' && !targetHasReliableHoverAuthor) {
            target.author_name = normalizeAuthorNameForMerge(detailItem.author_name || '');
            target.author_handle = detailItem.author_handle || target.author_handle || '';
            target.author_identity_source = 'hover';
        } else if (!targetHasReliableHoverAuthor) {
            target.author_name = chooseBetterAuthorName(target.author_name, detailItem.author_name);
            target.author_handle = detailItem.author_handle || target.author_handle || '';
            target.author_identity_source = detailAuthorSource || targetAuthorSource;
        }
        target.favorite_count = detailCountIsAuthoritative && Number(detailItem.favorite_count || 0) > 0
            ? Number(detailItem.favorite_count || 0)
            : Math.max(Number(target.favorite_count || 0), Number(detailItem.favorite_count || 0));
        target.expected_image_count = expectedCount || target.expected_image_count || detailItem.expected_image_count || 0;
        target.detail_expected_count_authoritative = Boolean(target.detail_expected_count_authoritative || detailExpectedCountIsAuthoritative);
        target.detail_image_count_authoritative = Boolean(target.detail_image_count_authoritative || detailCountIsAuthoritative);
        if (detailItem.prompt_complete && detailItem.prompt_text) {
            target.prompt_text = detailItem.prompt_text;
            target.prompt_complete = true;
        } else if (!target.prompt_complete) {
            target.prompt_text = chooseBetterPrompt(target.prompt_text, detailItem.prompt_text);
        }
        const detailImagesAreIncomplete = detailExpectedCount > 0 && detailImageCount > 0 && detailImageCount < detailExpectedCount;
        target.image_sources = shouldKeepCurrentImages
            ? mergeImageSources(trustedCurrentImages, trustedDetailImages, imageLimit)
            : detailCountIsAuthoritative
            ? mergeImageSources(trustedDetailImages, trustedCurrentImages, imageLimit)
            : mergeImageSources(
                detailImagesAreIncomplete ? trustedDetailImages : trustedCurrentImages,
                detailImagesAreIncomplete ? trustedCurrentImages : trustedDetailImages,
                imageLimit
            );
        const expandedTarget = expandDetailItemImagesToExpectedCount(target, expectedCount, getCollector());
        target.expected_image_count = expandedTarget.expected_image_count;
        target.detail_expected_count_authoritative = Boolean(
            target.detail_expected_count_authoritative
            || expandedTarget.detail_expected_count_authoritative
        );
        target.detail_image_count_authoritative = Boolean(
            target.detail_image_count_authoritative
            || expandedTarget.detail_image_count_authoritative
        );
        target.image_sources = expandedTarget.image_sources;
        logDiagnostic('detail-merge-applied', {
            sourceItemId: target.source_item_id || '',
            promptLength: String(target.prompt_text || '').trim().length,
            imageCount: Array.isArray(target.image_sources) ? target.image_sources.length : 0,
            expectedImageCount: target.expected_image_count || 0,
            detailCountAuthoritative: detailCountIsAuthoritative,
            sourcePageUrl: target.source_page_url || ''
        });
        return target;
    }

    function getIdentityPreservingMergeKey(item = {}, index = 0) {
        const sourceId = String(item.source_item_id || '').trim();
        if (sourceId) return `source-id:${sourceId}`;
        const sourceUrl = String(item.source_page_url || '').trim().toLowerCase();
        if (sourceUrl) return `source-url:${sourceUrl}`;
        const originalUrl = String(item.original_work_url || '').trim().toLowerCase();
        if (originalUrl) return `original-url:${originalUrl}`;
        const promptKey = normalizeText(item.prompt_text || '', 800).toLowerCase();
        if (promptKey) return `prompt:${promptKey}`;
        const firstImage = String(item.image_sources?.[0]?.url || '').trim().toLowerCase();
        if (firstImage) return `image:${firstImage}`;
        return `row:${index}`;
    }

    function cloneItemForPreservedMerge(item = {}) {
        const expectedCount = Number(item.expected_image_count || 0);
        return {
            ...item,
            author_name: normalizeAuthorNameForMerge(item.author_name || ''),
            image_sources: mergeImageSources([], item.image_sources, expectedCount > 0 ? expectedCount : 24)
        };
    }

    function mergeItemsPreservingSourceIds(items = []) {
        const grouped = new Map();
        (Array.isArray(items) ? items : []).forEach((item, index) => {
            if (!item) return;
            const key = getIdentityPreservingMergeKey(item, index);
            const current = grouped.get(key);
            if (!current) {
                grouped.set(key, cloneItemForPreservedMerge(item));
                return;
            }
            applyDetailItemToTarget(current, item);
        });
        return Array.from(grouped.values());
    }

    function mergeDetailItemsIntoBase(baseItems = [], detailItems = [], collector = getCollector()) {
        if (!collector?.mergeCollectedItems) {
            return Array.isArray(baseItems) ? baseItems : [];
        }
        const mergedItems = collector.mergeCollectedItems([...(Array.isArray(baseItems) ? baseItems : [])]);
        const detailRows = Array.isArray(detailItems) ? detailItems : [];
        for (const detailItem of detailRows) {
            if (!detailItem) continue;
            const detailUrl = String(detailItem.source_page_url || '').trim();
            const originalUrl = String(detailItem.original_work_url || '').trim();
            const detailId = String(detailItem.source_item_id || '').trim();
            const detailImages = new Set((Array.isArray(detailItem.image_sources) ? detailItem.image_sources : [])
                .map((entry) => String(entry?.url || '').toLowerCase())
                .filter(Boolean));
            const targetById = detailId
                ? mergedItems.find((item) => String(item.source_item_id || '').trim() === detailId)
                : null;
            const target = targetById || mergedItems.find((item) => {
                return (detailUrl && urlsLooselyMatch(String(item.source_page_url || '').trim(), detailUrl))
                    || (originalUrl && urlsLooselyMatch(String(item.original_work_url || '').trim(), originalUrl))
                    || (detailImages.size > 0 && (Array.isArray(item.image_sources) ? item.image_sources : [])
                        .some((entry) => {
                            const itemUrl = String(entry?.url || '').toLowerCase();
                            return detailImages.has(itemUrl)
                                || Array.from(detailImages).some((detailImageUrl) => urlsLooselyMatch(itemUrl, detailImageUrl));
                        }));
            });
            if (!target) {
                mergedItems.push(detailItem);
                continue;
            }
            applyDetailItemToTarget(target, detailItem);
        }
        const preservedItems = mergeItemsPreservingSourceIds(mergedItems);
        logDiagnostic('detail-identity-merge-finish', {
            before: mergedItems.length,
            after: preservedItems.length,
            withSourceIds: preservedItems.filter((item) => String(item.source_item_id || '').trim()).length
        });
        return preservedItems;
    }

    function getItemImageUrlSet(item = {}) {
        return new Set((Array.isArray(item.image_sources) ? item.image_sources : [])
            .map((entry) => String(entry?.url || '').toLowerCase())
            .filter(Boolean));
    }

    function normalizeUrlForLooseMatch(value = '') {
        try {
            const url = new URL(String(value || ''), window.location.href);
            url.hash = '';
            return {
                full: url.toString().replace(/\/$/, '').toLowerCase(),
                origin: url.origin.toLowerCase(),
                path: url.pathname.replace(/\/$/, '').toLowerCase(),
                file: (url.pathname.split('/').pop() || '').toLowerCase()
            };
        } catch (_) {
            return {
                full: '',
                origin: '',
                path: '',
                file: ''
            };
        }
    }

    function urlsLooselyMatch(left = '', right = '') {
        const a = normalizeUrlForLooseMatch(left);
        const b = normalizeUrlForLooseMatch(right);
        if (!a.full || !b.full) return false;
        if (a.full === b.full) return true;
        if (a.origin === b.origin && a.path && a.path === b.path) return true;
        return Boolean(a.file && b.file && a.file === b.file && a.file.length >= 10);
    }

    function getPromptIdFromUrl(value = '') {
        try {
            const url = new URL(String(value || ''), window.location.href);
            return url.pathname.match(/\/prompt\/(\d{8,25})/i)?.[1] || '';
        } catch (_) {
            const match = String(value || '').match(/\/prompt\/(\d{8,25})/i);
            return match?.[1] || '';
        }
    }

    function getBestCardScopeFromDetailLink(detailUrl = '') {
        const targetUrl = normalizeBatchUrl(detailUrl);
        const targetId = getPromptIdFromUrl(targetUrl);
        if (!targetUrl && !targetId) return null;
        const links = Array.from(document.querySelectorAll('a[href]'));
        const link = links.find((candidate) => {
            const href = normalizeBatchUrl(candidate.getAttribute?.('href') || candidate.href || '');
            return (targetUrl && urlsLooselyMatch(href, targetUrl))
                || (targetId && getPromptIdFromUrl(href) === targetId);
        });
        if (!link) return null;
        return link.closest?.(HOVER_SCOPE_SELECTOR) || findHoverScopeFromImage(link.querySelector?.('img') || link);
    }

    function getScopeDetailUrls(scope) {
        if (!scope?.querySelectorAll) return [];
        return Array.from(scope.querySelectorAll('a[href]'))
            .map((link) => normalizeBatchUrl(link.getAttribute('href') || link.href || ''))
            .filter(Boolean);
    }

    function findCurrentPageCardScopeForItem(item = {}, collector = getCollector()) {
        const targetImages = Array.from(getItemImageUrlSet(item));
        const targetDetailUrl = normalizeBatchUrl(item.source_page_url || '');
        if (!targetImages.length && !targetDetailUrl) return null;
        if (!collector?.collectImageUrls) return null;
        const scopes = [];
        const exactScope = getBestCardScopeFromDetailLink(targetDetailUrl);
        if (exactScope) scopes.push(exactScope);
        document.querySelectorAll('img').forEach((image) => {
            const scope = findHoverScopeFromImage(image);
            if (scope) scopes.push(scope);
        });
        document.querySelectorAll('a[href]').forEach((link) => {
            const scope = findHoverScopeFromImage(link.querySelector?.('img') || link);
            if (scope) scopes.push(scope);
        });
        const seen = new Set();
        let best = null;
        let bestScore = 0;
        for (const scope of scopes) {
            if (seen.has(scope)) continue;
            seen.add(scope);
            const urls = collector.collectImageUrls(scope)
                .map((url) => String(url || '').toLowerCase())
                .filter(Boolean);
            const detailUrls = getScopeDetailUrls(scope);
            let score = 0;
            if (targetDetailUrl && detailUrls.some((url) => urlsLooselyMatch(url, targetDetailUrl))) {
                score += 120;
            }
            for (const url of urls) {
                if (targetImages.includes(url)) {
                    score += 90;
                    continue;
                }
                if (targetImages.some((targetUrl) => urlsLooselyMatch(url, targetUrl))) {
                    score += 65;
                }
            }
            if (score > bestScore) {
                best = scope;
                bestScore = score;
            }
        }
        return bestScore >= 60 ? best : null;
    }

    function getCardDetailClickTarget(scope, item = {}) {
        if (!scope?.querySelectorAll) return scope;
        const targetDetailUrl = normalizeBatchUrl(item.source_page_url || '');
        const targetId = getPromptIdFromUrl(targetDetailUrl);
        const exactLink = Array.from(scope.querySelectorAll('a[href]'))
            .find((link) => {
                const href = normalizeBatchUrl(link.getAttribute?.('href') || link.href || '');
                return (targetDetailUrl && urlsLooselyMatch(href, targetDetailUrl))
                    || (targetId && getPromptIdFromUrl(href) === targetId);
            });
        if (exactLink) return exactLink;
        const imageLink = Array.from(scope.querySelectorAll('a[href]'))
            .find((link) => link.querySelector?.('img') && isSameMeigenUrl(link.href || link.getAttribute?.('href') || ''));
        if (imageLink) return imageLink;
        return scope.querySelector('img') || scope.querySelector('a[href]') || scope;
    }

    function closeOpenDetailView() {
        const closeControl = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title]'))
            .find((element) => /^(关闭|Close|esc|Esc|ESC|×|X)$/i.test(getControlText(element)));
        if (closeControl) {
            dispatchSyntheticClick(closeControl);
            return true;
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
        return false;
    }

    function isDetailViewVisible() {
        return Boolean(
            findDetailPromptPanel(document)
            || Array.from(document.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]') || []).some((node) => {
                const text = normalizeText(node.innerText || node.textContent || '', 2500);
                return DETAIL_PROMPT_LABEL_PATTERN.test(text) || PROMPT_COPY_TEXT_PATTERN.test(text);
            })
        );
    }

    async function prepareListPageForCollection() {
        if (!isDetailViewVisible()) return false;
        logDiagnostic('list-collect-close-detail', {
            pageUrl: window.location.href
        });
        closeOpenDetailView();
        await sleep(500);
        if (isDetailViewVisible()) {
            closeOpenDetailView();
            await sleep(500);
        }
        return true;
    }

    function needsInteractiveDetail(item = {}, { requireFavoriteCount = false } = {}) {
        const images = Array.isArray(item.image_sources) ? item.image_sources : [];
        const expectedImageCount = Number(item.expected_image_count || 0);
        const hasAuthoritativeImageCount = Boolean(
            item.detail_expected_count_authoritative || item.detail_image_count_authoritative
        );
        const imageCountIncomplete = hasAuthoritativeImageCount
            ? images.length < Math.max(1, expectedImageCount)
            : images.length <= 1;
        const missingSource = !String(item.original_work_url || '').trim()
            || !String(item.author_name || '').trim()
            || !String(item.author_handle || '').trim();
        return itemPromptNeedsDetailEnrichment(item)
            || imageCountIncomplete
            || missingSource
            || (requireFavoriteCount && Number(item.favorite_count || 0) <= 0);
    }

    function hasBetterDetailThanBase(detailItems = [], item = {}, collector = getCollector()) {
        const expectedCount = Math.max(0, ...detailItems.map((detailItem) => Number(detailItem?.expected_image_count || 0)));
        const wantedImages = expectedCount > 0 ? expectedCount : Math.max(2, (item.image_sources || []).length + 1);
        const hasEnoughImages = detailItems.some((detailItem) => (detailItem.image_sources || []).length >= wantedImages);
        const hasPrompt = hasCompletePromptData(detailItems, collector);
        const basePromptNeedsDetail = itemPromptNeedsDetailEnrichment(item);
        if (basePromptNeedsDetail && !hasPrompt) return false;
        if (basePromptNeedsDetail && hasPrompt) return true;
        if ((item.image_sources || []).length <= 1 && hasEnoughImages) return true;
        return hasPrompt && hasEnoughImages;
    }

    async function collectDetailItemsFromCurrentCard(item = {}, collector = getCollector()) {
        logDiagnostic('detail-current-start', {
            sourceItemId: item.source_item_id || '',
            sourcePageUrl: item.source_page_url || '',
            promptLength: String(item.prompt_text || '').trim().length,
            imageCount: Array.isArray(item.image_sources) ? item.image_sources.length : 0
        });
        const scope = findCurrentPageCardScopeForItem(item, collector);
        if (!scope) {
            logDiagnostic('detail-current-card-missing', {
                sourceItemId: item.source_item_id || '',
                sourcePageUrl: item.source_page_url || ''
            });
            throw new Error('未定位到当前作品卡片，已尝试用详情链接补抓');
        }
        const target = getCardDetailClickTarget(scope, item);
        const beforeUrl = window.location.href;
        const navigationAnchor = target?.closest?.('a[href]');
        if (navigationAnchor) {
            logDiagnostic('detail-current-navigation-guarded', {
                sourceItemId: item.source_item_id || '',
                href: navigationAnchor.href || navigationAnchor.getAttribute?.('href') || ''
            });
        }
        try {
            try {
                target.scrollIntoView?.({ block: 'center', inline: 'center' });
            } catch (_) {
                // Best-effort only.
            }
            dispatchSyntheticClick(target, { preventNavigation: true });
            await sleep(700);
            await refreshStructuredDataCache();
            logDiagnostic('detail-current-opened', {
                beforeUrl,
                currentUrl: window.location.href,
                hasPromptPanel: Boolean(findDetailPromptPanel(document)),
                currentMatchesTarget: currentDetailUrlMatchesTarget(item, window.location.href)
            });

            let copiedPrompt = '';
            let lastItems = [];
            const startedAt = Date.now();
            while (Date.now() - startedAt < DETAIL_FRAME_TIMEOUT_MS) {
                const promptPanel = findDetailPromptPanel(document);
                const currentMatchesTarget = currentDetailUrlMatchesTarget(item, window.location.href)
                    || (window.location.href === beforeUrl && Boolean(promptPanel));
                const detailExpectedCount = currentMatchesTarget ? getDetailExpectedCountFromDocument(document) : 0;
                if (promptPanel && currentMatchesTarget) await expandPromptSection(promptPanel);
                if (!copiedPrompt && promptPanel && currentMatchesTarget) {
                    copiedPrompt = await readPromptFromCopyButton(promptPanel, collector);
                }
                const detailViewReady = Boolean(currentMatchesTarget && (promptPanel || detailExpectedCount > 0));
                if (!detailViewReady) {
                    lastItems = [];
                    logDiagnostic('detail-current-not-ready', {
                        sourceItemId: item.source_item_id || '',
                        targetUrl: item.source_page_url || '',
                        currentUrl: window.location.href,
                        currentMatchesTarget,
                        hasPromptPanel: Boolean(promptPanel),
                        detailExpectedCount
                    });
                    await sleep(DETAIL_FRAME_POLL_MS);
                    continue;
                }
                lastItems = collector.collectMeigenGalleryItems(document, buildCollectionOptions({
                    baseUrl: window.location.href,
                    expectedDetailUrl: item.source_page_url || window.location.href,
                    expectedDetailImageCount: detailExpectedCount,
                    detailFavoriteCount: getDetailFavoriteCountFromPromptPanel(document, collector),
                    detailOnly: true,
                    structuredEntries: []
                }, item));
                lastItems = mergeDetailItemsWithCopiedPrompt(lastItems, copiedPrompt, collector)
                    .map((detailItem) => ({
                        ...detailItem,
                        source_item_id: item.source_item_id || detailItem.source_item_id || '',
                        source_page_url: item.source_page_url || ''
                    }));
                lastItems = expandDetailItemsToExpectedCount(lastItems, detailExpectedCount, collector);
                lastItems = enrichDetailItemsWithVisibleAuthor(lastItems, document, collector);
                lastItems = selectBestDetailItemsForTarget(lastItems, item, {
                    expectedCount: detailExpectedCount
                });
                lastItems = filterUsableDetailItems(lastItems, collector);
                logDiagnostic('detail-current-poll', {
                    itemCount: lastItems.length,
                    currentMatchesTarget,
                    hasPromptPanel: Boolean(promptPanel),
                    detailExpectedCount,
                    copiedPromptLength: copiedPrompt.length,
                    promptLengths: lastItems.map((detailItem) => String(detailItem.prompt_text || '').trim().length),
                    imageCounts: lastItems.map((detailItem) => Array.isArray(detailItem.image_sources) ? detailItem.image_sources.length : 0),
                    expectedImageCounts: lastItems.map((detailItem) => Number(detailItem.expected_image_count || 0)),
                    favoriteCounts: lastItems.map((detailItem) => Number(detailItem.favorite_count || 0)),
                    imageUrls: lastItems.map((detailItem) => getItemImageUrlPreview(detailItem, 4))
                });
                const hasReliableDetail = hasUsefulDetailData(lastItems)
                    && hasCompletePromptData(lastItems, collector)
                    && hasExpectedDetailImages(lastItems);
                const hasUsefulCountDetail = lastItems.some((detailItem) => isDetailExpectedCountAuthoritative(detailItem));
                if (hasReliableDetail
                    || (hasUsefulDetailData(lastItems) && hasBetterDetailThanBase(lastItems, item, collector))
                    || (hasUsefulCountDetail && hasUsefulDetailData(lastItems))) {
                    logDiagnostic('detail-current-success', {
                        itemCount: lastItems.length,
                        reliable: hasReliableDetail
                    });
                    return lastItems;
                }
                await sleep(DETAIL_FRAME_POLL_MS);
            }
            logDiagnostic('detail-current-timeout', {
                itemCount: lastItems.length,
                targetUrl: item.source_page_url || '',
                currentUrl: window.location.href,
                currentMatchesTarget: currentDetailUrlMatchesTarget(item, window.location.href),
                promptLengths: lastItems.map((detailItem) => String(detailItem.prompt_text || '').trim().length),
                imageUrls: lastItems.map((detailItem) => getItemImageUrlPreview(detailItem, 4))
            });
            return lastItems;
        } finally {
            closeOpenDetailView();
            if (window.location.href !== beforeUrl && typeof history.replaceState === 'function') {
                history.replaceState(history.state, '', beforeUrl);
            }
            await sleep(300);
        }
    }

    function itemMatchesFailureTarget(item = {}, failure = {}) {
        const failureId = String(failure.sourceItemId || '').trim();
        const failureUrl = String(failure.url || '').trim();
        if (failureId && String(item.source_item_id || '').trim() === failureId) return true;
        if (failureUrl && urlsLooselyMatch(String(item.source_page_url || '').trim(), failureUrl)) return true;
        if (failureUrl && urlsLooselyMatch(String(item.original_work_url || '').trim(), failureUrl)) return true;
        return failureUrl && (Array.isArray(item.image_sources) ? item.image_sources : [])
            .some((entry) => urlsLooselyMatch(String(entry?.url || ''), failureUrl));
    }

    function removeResolvedDetailFailures(failures = [], items = []) {
        return failures.filter((failure) => {
            const matched = items.find((item) => itemMatchesFailureTarget(item, failure));
            if (!matched) return true;
            return !String(matched.prompt_text || '').trim();
        });
    }

    function createHiddenDetailFrame(url) {
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.loading = 'eager';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = [
            'position:fixed',
            'left:0',
            'top:0',
            'width:min(1024px, 100vw)',
            'height:min(900px, 100vh)',
            'opacity:0.001',
            'z-index:-2147483647',
            'pointer-events:none',
            'border:0'
        ].join(';');
        document.documentElement.appendChild(frame);
        return frame;
    }

    async function collectDetailItemsFromFrame(url, collector) {
        const frame = createHiddenDetailFrame(url);
        const startedAt = Date.now();
        let lastItems = [];
        let copiedPrompt = '';
        let detailActionAttempts = 0;
        let stableSignature = '';
        let stableRounds = 0;
        try {
            await new Promise((resolve) => {
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    resolve();
                };
                frame.addEventListener('load', finish, { once: true });
                setTimeout(finish, DETAIL_FRAME_POLL_MS);
            });

            while (Date.now() - startedAt < DETAIL_FRAME_TIMEOUT_MS) {
                let documentRef = null;
                try {
                    documentRef = frame.contentDocument;
                } catch (_) {
                    documentRef = null;
                }
                if (documentRef?.querySelectorAll) {
                    if (!copiedPrompt && detailActionAttempts < 8) {
                        detailActionAttempts += 1;
                        await expandPromptSection(findDetailPromptPanel(documentRef) || documentRef);
                        copiedPrompt = await readPromptFromCopyButton(documentRef, collector);
                    }
                    const detailExpectedCount = getDetailExpectedCountFromDocument(documentRef);
                    lastItems = collector.collectMeigenGalleryItems(documentRef, buildCollectionOptions({
                        baseUrl: url,
                        expectedDetailUrl: url,
                        expectedDetailImageCount: detailExpectedCount,
                        detailOnly: true,
                        structuredEntries: []
                    }));
                    lastItems = mergeDetailItemsWithCopiedPrompt(lastItems, copiedPrompt, collector);
                    lastItems = expandDetailItemsToExpectedCount(lastItems, detailExpectedCount, collector);
                    lastItems = enrichDetailItemsWithVisibleAuthor(lastItems, documentRef, collector);
                    lastItems = filterUsableDetailItems(lastItems, collector);
                    const signature = JSON.stringify({
                        expected: detailExpectedCount,
                        images: lastItems.map((item) => getItemImageUrlPreview(item, 24)),
                        prompts: lastItems.map((item) => String(item.prompt_text || '').trim().length)
                    });
                    if (signature === stableSignature) {
                        stableRounds += 1;
                    } else {
                        stableSignature = signature;
                        stableRounds = 0;
                    }
                    const elapsedMs = Date.now() - startedAt;
                    const frameSettled = detailExpectedCount > 0
                        || (elapsedMs >= DETAIL_FRAME_MIN_SETTLE_MS && stableRounds >= DETAIL_FRAME_STABLE_ROUNDS);
                    if (frameSettled
                        && hasUsefulDetailData(lastItems)
                        && hasCompletePromptData(lastItems, collector)
                        && hasExpectedDetailImages(lastItems)) {
                        return lastItems;
                    }
                }
                await sleep(DETAIL_FRAME_POLL_MS);
            }
            return lastItems;
        } finally {
            frame.remove();
        }
    }

    async function fetchDetailItems(url, collector) {
        let fetchedItems = [];
        let fetchedExpectedCount = 0;
        let fetchError = null;
        try {
            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    Accept: 'text/html,application/xhtml+xml'
                }
            });
            if (!response.ok) {
                throw new Error(`详情页读取失败 (${response.status})`);
            }

            const html = await response.text();
            const documentRef = new DOMParser().parseFromString(html, 'text/html');
            const detailExpectedCount = getDetailExpectedCountFromDocument(documentRef);
            fetchedExpectedCount = detailExpectedCount;
            fetchedItems = collector.collectMeigenGalleryItems(documentRef, buildCollectionOptions({
                baseUrl: url,
                expectedDetailUrl: url,
                expectedDetailImageCount: detailExpectedCount,
                detailOnly: true,
                structuredEntries: []
            }));
            fetchedItems = expandDetailItemsToExpectedCount(fetchedItems, detailExpectedCount, collector);
            fetchedItems = enrichDetailItemsWithVisibleAuthor(fetchedItems, documentRef, collector);
            fetchedItems = filterUsableDetailItems(fetchedItems, collector);
        } catch (error) {
            fetchError = error;
        }

        if (fetchedExpectedCount > 0
            && hasUsefulDetailData(fetchedItems)
            && hasCompletePromptData(fetchedItems, collector)
            && hasExpectedDetailImages(fetchedItems)) {
            return fetchedItems;
        }

        const framedItems = await collectDetailItemsFromFrame(url, collector);
        const mergedItems = filterUsableDetailItems(
            collector.mergeCollectedItems([...fetchedItems, ...framedItems]),
            collector
        );
        if (mergedItems.length) return mergedItems;
        if (fetchError) throw fetchError;
        return mergedItems;
    }

    async function enrichPayloadWithDetails(basePayload, {
        retryFailed = false,
        requireFavoriteCount = false,
        streamMessage = null
    } = {}) {
        const collector = getCollector();
        if (!collector?.mergeCollectedItems) return basePayload;

        const baseItems = Array.isArray(basePayload.items) ? basePayload.items : [];
        const retryDetailUrls = retryFailed
            ? detailJob.failed.map((failure) => failure.url).filter(Boolean)
            : [];
        const interactiveItems = retryFailed
            ? []
            : baseItems.filter((item) => needsInteractiveDetail(item, { requireFavoriteCount }));
        const totalJobs = retryDetailUrls.length + interactiveItems.length;
        logDiagnostic('detail-enrich-start', {
            retryFailed,
            baseItems: baseItems.length,
            interactiveItems: interactiveItems.length,
            detailUrls: retryDetailUrls.length,
            missingPrompts: baseItems.filter((item) => !String(item.prompt_text || '').trim()).length
        });

        detailJob.running = true;
        detailJob.paused = false;
        detailJob.processed = 0;
        detailJob.total = totalJobs;
        detailJob.phase = retryFailed ? 'fallback' : 'card';
        detailJob.failed = [];
        detailJob.lastError = '';
        rememberSessionPayload(basePayload, summarizePayload(basePayload));
        await persistSessionSnapshot();
        const markPendingDetail = (items = []) => items.map((item) => ({ ...item, stream_pending_detail: true }));
        if (streamMessage) queueStreamStage(markPendingDetail(baseItems), streamMessage);

        const detailItems = [];
        const resolvedKeys = new Set();
        const saveCheckpoint = () => {
            const checkpointItems = mergeDetailItemsIntoBase(baseItems, detailItems, collector);
            const checkpointPayload = {
                ...basePayload,
                collected_at: new Date().toISOString(),
                items: checkpointItems,
                detail_fetch: {
                    attempted: detailJob.processed,
                    failed: detailJob.failed.length
                }
            };
            detailJob.lastPayload = checkpointPayload;
            detailJob.lastSummary = summarizePayload(checkpointPayload);
            rememberSessionPayload(checkpointPayload, detailJob.lastSummary);
        };
        try {
            for (const item of interactiveItems) {
                await waitWhilePaused();
                try {
                    const currentDetailItems = await collectDetailItemsFromCurrentCard(item, collector);
                    const hasReliableDetail = hasUsefulDetailData(currentDetailItems)
                        && (hasCompletePromptData(currentDetailItems, collector) || !itemPromptNeedsDetailEnrichment(item))
                        && hasExpectedDetailImages(currentDetailItems);
                    const hasUsefulPromptDetail = hasUsefulDetailData(currentDetailItems)
                        && hasCompletePromptData(currentDetailItems, collector)
                        && (itemPromptNeedsDetailEnrichment(item) || hasBetterDetailThanBase(currentDetailItems, item, collector));
                    const hasUsefulCountDetail = currentDetailItems.some((detailItem) => isDetailExpectedCountAuthoritative(detailItem));
                    if (hasReliableDetail) {
                        detailItems.push(...currentDetailItems);
                        markDetailResolved(resolvedKeys, item, currentDetailItems);
                    } else if (hasUsefulPromptDetail || hasUsefulCountDetail) {
                        detailItems.push(...currentDetailItems);
                    } else {
                        const failure = {
                            url: item.source_page_url || item.image_sources?.[0]?.url || '',
                            sourceItemId: item.source_item_id || '',
                            message: itemPromptNeedsDetailEnrichment(item)
                                ? '详情已打开，但还没有读到提示词'
                                : '详情已打开，但图片数量仍需复核'
                        };
                        if (!String(item.source_page_url || '').trim()) {
                            detailJob.failed.push(failure);
                            detailJob.lastError = failure.message;
                        }
                    }
                } catch (error) {
                    const failure = {
                        url: item.source_page_url || item.image_sources?.[0]?.url || '',
                        sourceItemId: item.source_item_id || '',
                        message: error?.message || '当前页详情补抓失败'
                    };
                    if (!String(item.source_page_url || '').trim()) {
                        detailJob.failed.push(failure);
                        detailJob.lastError = failure.message;
                    }
                } finally {
                    detailJob.processed += 1;
                }
                saveCheckpoint();
                if (streamMessage) queueStreamStage(markPendingDetail(detailJob.lastPayload?.items || []), streamMessage);
                if (detailJob.processed < totalJobs) {
                    await sleep(DETAIL_FETCH_DELAY_MS);
                }
            }

            const fallbackUrls = retryFailed
                ? retryDetailUrls
                : getDetailUrls(interactiveItems.filter((item) => !isDetailResolved(resolvedKeys, item)));
            if (!retryFailed) detailJob.total += fallbackUrls.length;
            if (fallbackUrls.length) detailJob.phase = 'fallback';

            for (let fallbackIndex = 0; fallbackIndex < fallbackUrls.length; fallbackIndex += 1) {
                const url = fallbackUrls[fallbackIndex];
                await waitWhilePaused();
                try {
                    detailItems.push(...await fetchDetailItems(url, collector));
                } catch (error) {
                    const failure = {
                        url,
                        message: error?.message || '详情页补抓失败'
                    };
                    detailJob.failed.push(failure);
                    detailJob.lastError = failure.message;
                } finally {
                    detailJob.processed += 1;
                }
                saveCheckpoint();
                if (streamMessage) queueStreamStage(markPendingDetail(detailJob.lastPayload?.items || []), streamMessage);

                if (fallbackIndex + 1 < fallbackUrls.length) {
                    await sleep(DETAIL_FETCH_DELAY_MS);
                }
            }

            const mergedItems = mergeDetailItemsIntoBase(baseItems, detailItems, collector)
                .map(({ stream_pending_detail: _pendingDetail, streamPendingDetail: _pendingDetailAlias, ...item }) => (
                    needsInteractiveDetail(item, { requireFavoriteCount })
                        ? { ...item, stream_pending_detail: true }
                        : item
                ));
            if (streamMessage) {
                queueStreamStage(mergedItems, streamMessage, { flush: true, force: true });
                await streamStageState.promise;
            }
            detailJob.failed = removeResolvedDetailFailures(detailJob.failed, mergedItems);
            detailJob.lastError = detailJob.failed[detailJob.failed.length - 1]?.message || '';
            logDiagnostic('detail-enrich-finish', {
                mergedItems: mergedItems.length,
                missingPrompts: mergedItems.filter((item) => !String(item.prompt_text || '').trim()).length,
                failures: detailJob.failed.length,
                failureMessages: detailJob.failed.map((failure) => failure.message)
            });
            const payload = {
                ...basePayload,
                collected_at: new Date().toISOString(),
                items: mergedItems,
                detail_fetch: {
                    attempted: detailJob.processed,
                    failed: detailJob.failed.length
                }
            };
            detailJob.lastPayload = payload;
            detailJob.lastSummary = summarizePayload(payload);
            rememberSessionPayload(payload, detailJob.lastSummary);
            return payload;
        } finally {
            detailJob.running = false;
            detailJob.paused = false;
            detailJob.phase = '';
        }
    }

    async function runScrollCollect(message = {}) {
        const collector = getCollector();
        if (!collector?.mergeCollectedItems) {
            return {
                ok: false,
                message: '采集器还没准备好，请刷新 Meigen 页面后重试'
            };
        }
        if (detailJob.running) {
            return {
                ok: false,
                message: '详情页补抓正在进行中'
            };
        }
        if (scrollJob.running) {
            return {
                ok: false,
                message: '滚动采集正在进行中'
            };
        }

        const maxSteps = normalizeScrollStepCount(message.maxSteps);
        const maxItems = normalizeMaxItems(message.maxItems);
        const favoriteRange = normalizeFavoriteRange(message);
        await prepareListPageForCollection();
        await refreshStructuredDataCache();
        const checkedKeys = new Set();
        let repositoryDuplicateCount = 0;
        const initialPayload = collector.buildPayload(collector.collectMeigenGalleryItems(document, buildCollectionOptions(favoriteRange)));
        const initialCheck = message.preflightDuplicates
            ? await filterRepositoryDuplicates(initialPayload.items, message, checkedKeys)
            : { uniqueItems: initialPayload.items, duplicateCount: 0 };
        repositoryDuplicateCount += initialCheck.duplicateCount;
        let payload = applyPayloadLimits({ ...initialPayload, items: initialCheck.uniqueItems }, { maxItems, favoriteRange });
        let previousSnapshot = getScrollSnapshot();
        let stableRounds = 0;

        if (message.streamToQueue) {
            resetStreamStageState(message.batchId);
            await stageStreamItemsToTarget(initialCheck.uniqueItems, message, maxItems, { pendingDetail: true });
        }

        scrollJob.running = true;
        scrollJob.stopRequested = false;
        scrollJob.processed = 0;
        scrollJob.total = maxSteps;
        scrollJob.discovered = Array.isArray(payload.items) ? payload.items.length : 0;
        scrollJob.lastError = '';
        scrollJob.lastPayload = payload;
        scrollJob.lastSummary = summarizePayload(payload);
        detailJob.lastPayload = payload;
        detailJob.lastSummary = scrollJob.lastSummary;
        rememberSessionPayload(payload, scrollJob.lastSummary);

        try {
            for (let index = 0; index < maxSteps; index += 1) {
                if (scrollJob.stopRequested) break;
                if (message.streamToQueue && streamStageState.stagedCount >= maxItems) break;

                const nextSnapshot = await scrollAndWaitForGalleryBatch();
                scrollJob.processed = index + 1;

                await revealHoverControls(document, maxItems + 6);
                await refreshStructuredDataCache();
                const currentItems = collector.collectMeigenGalleryItems(document, buildCollectionOptions(favoriteRange));
                const duplicateCheck = message.preflightDuplicates
                    ? await filterRepositoryDuplicates(currentItems, message, checkedKeys)
                    : { uniqueItems: currentItems, duplicateCount: 0 };
                repositoryDuplicateCount += duplicateCheck.duplicateCount;
                if (message.streamToQueue && duplicateCheck.uniqueItems.length) {
                    await stageStreamItemsToTarget(duplicateCheck.uniqueItems, message, maxItems, { pendingDetail: true });
                }
                payload = {
                    ...payload,
                    collected_at: new Date().toISOString(),
                    items: collector.mergeCollectedItems([
                        ...(Array.isArray(payload.items) ? payload.items : []),
                        ...duplicateCheck.uniqueItems
                    ]).slice(0, maxItems),
                    scroll_collect: {
                        attempted: index + 1,
                        stopped: false,
                        repository_duplicates: repositoryDuplicateCount
                    }
                };
                scrollJob.discovered = payload.items.length;
                scrollJob.lastPayload = payload;
                scrollJob.lastSummary = summarizePayload(payload);
                detailJob.lastPayload = payload;
                detailJob.lastSummary = scrollJob.lastSummary;
                rememberSessionPayload(payload, scrollJob.lastSummary);
                const targetCount = message.streamToQueue ? streamStageState.stagedCount : payload.items.length;
                if (targetCount >= maxItems) {
                    break;
                }
                const moved = nextSnapshot.y > previousSnapshot.y + 12;
                const grew = nextSnapshot.height > previousSnapshot.height + 12;
                const nearBottom = nextSnapshot.y + nextSnapshot.viewport >= nextSnapshot.height - 24;
                stableRounds = moved || grew ? 0 : stableRounds + 1;
                previousSnapshot = nextSnapshot;

                if (nearBottom && stableRounds >= SCROLL_COLLECT_STABLE_LIMIT) {
                    break;
                }
            }

            payload = {
                ...payload,
                collected_at: new Date().toISOString(),
                scroll_collect: {
                    attempted: scrollJob.processed,
                    stopped: scrollJob.stopRequested,
                    repository_duplicates: repositoryDuplicateCount
                }
            };
            scrollJob.running = false;
            scrollJob.stopRequested = false;
            scrollJob.lastPayload = payload;
            scrollJob.lastSummary = summarizePayload(payload);
            detailJob.lastPayload = payload;
            detailJob.lastSummary = scrollJob.lastSummary;
            rememberSessionPayload(payload, scrollJob.lastSummary);
            return {
                ok: true,
                payload,
                summary: scrollJob.lastSummary,
                scrollStatus: getScrollStatus(),
                repositoryDuplicateCount,
                streamResult: message.streamToQueue ? {
                    batchId: streamStageState.batchId,
                    attemptedCount: streamStageState.attemptedCount,
                    stagedCount: streamStageState.stagedCount,
                    skippedDuplicateCount: streamStageState.skippedDuplicateCount,
                    rejectedCount: streamStageState.rejectedCount,
                    lastError: streamStageState.lastError
                } : null
            };
        } catch (error) {
            scrollJob.lastError = error?.message || '滚动采集失败';
            throw error;
        } finally {
            scrollJob.running = false;
            scrollJob.stopRequested = false;
        }
    }

    async function runPageBatchCollect(message = {}) {
        const collector = getCollector();
        if (!collector?.mergeCollectedItems) {
            return {
                ok: false,
                message: '采集器还没准备好，请刷新 Meigen 页面后重试'
            };
        }
        if (detailJob.running) {
            return {
                ok: false,
                message: '详情页补抓正在进行中'
            };
        }
        if (scrollJob.running) {
            return {
                ok: false,
                message: '滚动采集正在进行中'
            };
        }
        if (pageBatchJob.running) {
            return {
                ok: false,
                message: '翻页采集正在进行中'
            };
        }

        const maxPages = normalizePageBatchCount(message.maxPages);
        const maxItems = normalizeMaxItems(message.maxItems);
        const favoriteRange = normalizeFavoriteRange(message);
        await prepareListPageForCollection();
        await refreshStructuredDataCache();
        const checkedKeys = new Set();
        let repositoryDuplicateCount = 0;
        let payload = message.continueExisting
            ? applyPayloadLimits(getLatestPayload(collector), { maxItems, favoriteRange })
            : applyPayloadLimits(
                collector.buildPayload(collector.collectMeigenGalleryItems(document, buildCollectionOptions(favoriteRange))),
                { maxItems, favoriteRange }
            );
        let currentUrl = window.location.href;
        let currentRoot = document;
        const visited = new Set();

        pageBatchJob.running = true;
        pageBatchJob.stopRequested = false;
        pageBatchJob.processed = 0;
        pageBatchJob.total = maxPages;
        pageBatchJob.discovered = Array.isArray(payload.items) ? payload.items.length : 0;
        pageBatchJob.currentUrl = currentUrl;
        pageBatchJob.lastError = '';
        pageBatchJob.lastPayload = payload;
        pageBatchJob.lastSummary = summarizePayload(payload);
        scrollJob.lastPayload = payload;
        scrollJob.lastSummary = pageBatchJob.lastSummary;
        detailJob.lastPayload = payload;
        detailJob.lastSummary = pageBatchJob.lastSummary;
        rememberSessionPayload(payload, pageBatchJob.lastSummary);

        try {
            for (let index = 0; index < maxPages; index += 1) {
                if (pageBatchJob.stopRequested) break;
                if (message.streamToQueue && streamStageState.stagedCount >= maxItems) break;

                const normalizedCurrentUrl = normalizeBatchUrl(currentUrl) || currentUrl;
                if (visited.has(normalizedCurrentUrl) && currentRoot !== document) break;
                if (!visited.has(normalizedCurrentUrl)) {
                    visited.add(normalizedCurrentUrl);
                }

                await revealHoverControls(currentRoot, maxItems + 6);
                if (currentRoot === document) {
                    await refreshStructuredDataCache();
                }
                const currentItems = collector.collectMeigenGalleryItems(currentRoot, buildCollectionOptions({
                    baseUrl: normalizedCurrentUrl,
                    ...favoriteRange,
                    structuredEntries: currentRoot === document ? getStructuredEntriesForCollection() : []
                }));
                const duplicateCheck = message.preflightDuplicates
                    ? await filterRepositoryDuplicates(currentItems, message, checkedKeys)
                    : { uniqueItems: currentItems, duplicateCount: 0 };
                repositoryDuplicateCount += duplicateCheck.duplicateCount;
                if (message.streamToQueue && duplicateCheck.uniqueItems.length) {
                    await stageStreamItemsToTarget(duplicateCheck.uniqueItems, message, maxItems, { pendingDetail: true });
                }
                payload = {
                    ...payload,
                    page_url: normalizeBatchUrl(window.location.href) || payload.page_url,
                    collected_at: new Date().toISOString(),
                    items: collector.mergeCollectedItems([
                        ...(Array.isArray(payload.items) ? payload.items : []),
                        ...duplicateCheck.uniqueItems
                    ]).slice(0, maxItems),
                    page_batch: {
                        attempted: index + 1,
                        stopped: false,
                        repository_duplicates: repositoryDuplicateCount
                    }
                };
                pageBatchJob.processed = index + 1;
                pageBatchJob.discovered = payload.items.length;
                pageBatchJob.currentUrl = normalizedCurrentUrl;
                pageBatchJob.lastPayload = payload;
                pageBatchJob.lastSummary = summarizePayload(payload);
                scrollJob.lastPayload = payload;
                scrollJob.lastSummary = pageBatchJob.lastSummary;
                detailJob.lastPayload = payload;
                detailJob.lastSummary = pageBatchJob.lastSummary;
                rememberSessionPayload(payload, pageBatchJob.lastSummary);

                const targetCount = message.streamToQueue ? streamStageState.stagedCount : payload.items.length;
                if (targetCount >= maxItems || pageBatchJob.stopRequested || index + 1 >= maxPages) break;

                const nextTarget = findNextPageTarget(currentRoot, normalizedCurrentUrl);
                if (!nextTarget) break;

                await sleep(PAGE_BATCH_DELAY_MS);
                if (nextTarget.type === 'url') {
                    currentUrl = nextTarget.url;
                    currentRoot = await fetchBatchDocument(nextTarget.url);
                    continue;
                }

                if (nextTarget.type === 'click' && nextTarget.element) {
                    const beforeSnapshot = getScrollSnapshot();
                    nextTarget.element.click();
                    await sleep(PAGE_BATCH_DELAY_MS);
                    const afterSnapshot = getScrollSnapshot();
                    currentRoot = document;
                    currentUrl = window.location.href;
                    if (afterSnapshot.height <= beforeSnapshot.height && afterSnapshot.y === beforeSnapshot.y) {
                        await sleep(PAGE_BATCH_DELAY_MS);
                    }
                }
            }

            payload = {
                ...payload,
                collected_at: new Date().toISOString(),
                page_batch: {
                    attempted: pageBatchJob.processed,
                    stopped: pageBatchJob.stopRequested,
                    repository_duplicates: repositoryDuplicateCount
                }
            };
            pageBatchJob.running = false;
            pageBatchJob.stopRequested = false;
            pageBatchJob.lastPayload = payload;
            pageBatchJob.lastSummary = summarizePayload(payload);
            scrollJob.lastPayload = payload;
            scrollJob.lastSummary = pageBatchJob.lastSummary;
            detailJob.lastPayload = payload;
            detailJob.lastSummary = pageBatchJob.lastSummary;
            rememberSessionPayload(payload, pageBatchJob.lastSummary);
            return {
                ok: true,
                payload,
                summary: pageBatchJob.lastSummary,
                pageBatchStatus: getPageBatchStatus(),
                repositoryDuplicateCount,
                streamResult: message.streamToQueue ? {
                    batchId: streamStageState.batchId,
                    attemptedCount: streamStageState.attemptedCount,
                    stagedCount: streamStageState.stagedCount,
                    skippedDuplicateCount: streamStageState.skippedDuplicateCount,
                    rejectedCount: streamStageState.rejectedCount,
                    lastError: streamStageState.lastError
                } : null
            };
        } catch (error) {
            pageBatchJob.lastError = error?.message || '翻页采集失败';
            throw error;
        } finally {
            pageBatchJob.running = false;
            pageBatchJob.stopRequested = false;
        }
    }

    async function collectPayload(message = {}) {
        const collector = getCollector();
        if (!collector?.buildPayload) {
            return {
                ok: false,
                message: '采集器还没准备好，请刷新 Meigen 页面后重试'
            };
        }
        if (detailJob.running) {
            return {
                ok: false,
                message: '详情页补抓正在进行中'
            };
        }
        if (scrollJob.running) {
            return {
                ok: false,
                message: '滚动采集正在进行中'
            };
        }
        if (pageBatchJob.running) {
            return {
                ok: false,
                message: '翻页采集正在进行中'
            };
        }

        logDiagnostic('collect-start', {
            collectorVersion: collector.VERSION || '',
            enrichDetails: Boolean(message.enrichDetails),
            retryFailed: Boolean(message.retryFailed),
            maxItems: message.maxItems || '',
            minFavorites: message.minFavorites || 0,
            maxFavorites: message.maxFavorites || 0,
            pageUrl: window.location.href
        });
        if (!message.enrichDetails && !message.retryFailed) {
            await prepareListPageForCollection();
        }
        const maxItems = normalizeMaxItems(message.maxItems);
        await revealHoverControls(document, maxItems + 6);
        await refreshStructuredDataCache();
        const favoriteRange = normalizeFavoriteRange(message);
        const hasFavoriteRange = Number(favoriteRange.min || 0) > 0 || Number(favoriteRange.max || 0) > 0;
        let payload = (message.enrichDetails || message.retryFailed)
            ? getLatestPayload(collector)
            : collector.buildPayload(collector.collectMeigenGalleryItems(document, buildCollectionOptions(favoriteRange)));
        payload = applyPayloadLimits(payload, {
            maxItems,
            favoriteRange: (message.enrichDetails || message.retryFailed || hasFavoriteRange) ? {} : favoriteRange
        });
        detailJob.lastPayload = payload;
        detailJob.lastSummary = summarizePayload(payload);
        rememberSessionPayload(payload, detailJob.lastSummary);

        if (message.enrichDetails || message.retryFailed) {
            if (message.streamToQueue && String(streamStageState.batchId || '') !== String(message.batchId || '')) {
                resetStreamStageState(message.batchId);
            }
            payload = await enrichPayloadWithDetails(payload, {
                retryFailed: Boolean(message.retryFailed),
                requireFavoriteCount: hasFavoriteRange,
                streamMessage: message.streamToQueue ? message : null
            });
            payload = applyPayloadLimits(payload, { maxItems, favoriteRange });
        }

        const summary = summarizePayload(payload);
        logDiagnostic('collect-finish', {
            summary
        });
        detailJob.lastPayload = payload;
        detailJob.lastSummary = summary;
        rememberSessionPayload(payload, summary);
        return {
            ok: true,
            payload,
            summary,
            detailStatus: getDetailStatus(),
            scrollStatus: getScrollStatus(),
            pageBatchStatus: getPageBatchStatus(),
            streamResult: message.streamToQueue ? {
                batchId: streamStageState.batchId,
                attemptedCount: streamStageState.attemptedCount,
                stagedCount: streamStageState.stagedCount,
                skippedDuplicateCount: streamStageState.skippedDuplicateCount,
                rejectedCount: streamStageState.rejectedCount,
                lastError: streamStageState.lastError
            } : null
        };
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === MESSAGE_PING) {
            sendResponse({ ok: true, version: getCollector()?.VERSION || '' });
            return false;
        }

        if (message?.type === MESSAGE_DIAGNOSTICS) {
            sendResponse({ ok: true, diagnostics: getDiagnostics() });
            return false;
        }

        if (message?.type === MESSAGE_SESSION_STATE) {
            sessionRestorePromise
                .then(() => sendResponse(getSessionState()))
                .catch(() => sendResponse(getSessionState()));
            return true;
        }

        if (message?.type === MESSAGE_DETAIL_STATUS) {
            sendResponse({
                ok: true,
                status: getDetailStatus(),
                summary: getLastJobSummary()
            });
            return false;
        }

        if (message?.type === MESSAGE_SCROLL_STATUS) {
            sendResponse({
                ok: true,
                status: getScrollStatus(),
                summary: getLastJobSummary()
            });
            return false;
        }

        if (message?.type === MESSAGE_PAGE_BATCH_STATUS) {
            sendResponse({
                ok: true,
                status: getPageBatchStatus(),
                summary: getLastJobSummary()
            });
            return false;
        }

        if (message?.type === MESSAGE_SCROLL_STOP) {
            scrollJob.stopRequested = scrollJob.running;
            sendResponse({ ok: true, status: getScrollStatus() });
            return false;
        }

        if (message?.type === MESSAGE_PAGE_BATCH_STOP) {
            pageBatchJob.stopRequested = pageBatchJob.running;
            sendResponse({ ok: true, status: getPageBatchStatus() });
            return false;
        }

        if (message?.type === MESSAGE_DETAIL_PAUSE) {
            detailJob.paused = detailJob.running;
            sendResponse({ ok: true, status: getDetailStatus() });
            return false;
        }

        if (message?.type === MESSAGE_DETAIL_RESUME) {
            detailJob.paused = false;
            sendResponse({ ok: true, status: getDetailStatus() });
            return false;
        }

        if (message?.type !== MESSAGE_COLLECT) {
            if (message?.type === MESSAGE_SCROLL_COLLECT) {
                runScrollCollect(message)
                    .then((response) => sendResponse(response))
                    .catch((error) => sendResponse({
                        ok: false,
                        message: error?.message || '滚动采集失败',
                        scrollStatus: getScrollStatus()
                    }));
                return true;
            }
            if (message?.type === MESSAGE_PAGE_BATCH_COLLECT) {
                runPageBatchCollect(message)
                    .then((response) => sendResponse(response))
                    .catch((error) => sendResponse({
                        ok: false,
                        message: error?.message || '翻页采集失败',
                        pageBatchStatus: getPageBatchStatus()
                    }));
                return true;
            }
            return false;
        }

        collectPayload(message)
            .then((response) => sendResponse(response))
            .catch((error) => sendResponse({
                ok: false,
                message: error?.message || '采集失败',
                detailStatus: getDetailStatus()
            }));

        return true;
    });
})();
