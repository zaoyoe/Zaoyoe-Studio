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
    const MESSAGE_AUTOMATION_START = 'FATHER_KEY_MEIGEN_AUTOMATION_START';
    const MESSAGE_AUTOMATION_STOP = 'FATHER_KEY_MEIGEN_AUTOMATION_STOP';
    const MESSAGE_AUTOMATION_STATUS = 'FATHER_KEY_MEIGEN_AUTOMATION_STATUS';
    const MESSAGE_RESET_STATE = 'FATHER_KEY_MEIGEN_RESET_STATE';
    const MESSAGE_STAGE = 'FATHER_KEY_STAGE_IMPORT';
    const MESSAGE_LOAD_BATCH = 'FATHER_KEY_LOAD_IMPORT_BATCH';
    const MESSAGE_CLEANUP_PENDING = 'FATHER_KEY_CLEANUP_PENDING_IMPORT';
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
    const SCROLL_BATCH_SETTLE_LIMIT = 12;
    const SCROLL_MEDIA_MIN_WAIT_ATTEMPTS = 6;
    const SCROLL_COLLECT_MAX_STEPS = 30;
    const SCROLL_COLLECT_STABLE_LIMIT = 8;
    const AUTOMATION_SCROLL_MAX_STEPS = 1000;
    const AUTOMATION_STAGNANT_LIMIT = 3;
    const AUTOMATION_DETAIL_BATCH_SIZE = 8;
    const AUTOMATION_DETAIL_RETRY_PASSES = 2;
    const AUTOMATION_RECOVERY_SWEEP_LIMIT = 2;
    const AUTOMATION_RETRY_RESERVATION_MIN_DEFERRED = 12;
    const AUTOMATION_RETRY_RESERVATION_MULTIPLIER = 3;
    const AUTOMATION_RETRY_RESERVATION_MAX_DEFERRED = 60;
    const IMPORT_REQUEST_MAX_ATTEMPTS = 3;
    const IMPORT_REQUEST_RETRY_BASE_DELAY_MS = 1200;
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
    const MEDIA_PROMPT_HEADER_PATTERN = /\[(?:IMAGE|VIDEO)\s*·\s*\d{1,3}\]/i;
    const DETAIL_DIALOG_SELECTOR = '[role="dialog"], dialog, [aria-modal="true"]';
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
    const DIAGNOSTIC_LOG_LIMIT = 400;
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
    const automationJob = {
        running: false,
        stopRequested: false,
        phase: '',
        target: 0,
        completed: false,
        startedAt: '',
        updatedAt: '',
        lastError: ''
    };
    const streamStageState = {
        batchId: '',
        bufferedItems: [],
        sentRevisions: new Map(),
        acceptedKeys: new Set(),
        checkedKeys: new Set(),
        checkedRevisions: new Map(),
        capacityDeferredKeys: new Set(),
        retryItems: new Map(),
        retryAttemptCounts: new Map(),
        retryReservationActive: true,
        retryReservationDeferredKeys: new Set(),
        promise: Promise.resolve(),
        attemptedCount: 0,
        stagedCount: 0,
        skippedDuplicateCount: 0,
        checkedCandidateCount: 0,
        repositoryDuplicateCount: 0,
        candidateDuplicateCount: 0,
        repositoryDuplicateKeys: new Set(),
        candidateDuplicateKeys: new Set(),
        identityRejectedCount: 0,
        rejectedCount: 0,
        processableCount: 0,
        pendingDetailCount: 0,
        cleanedPublishedCount: 0,
        batchTargetCount: 0,
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
        const videoIds = new Set((Array.isArray(item.video_sources) ? item.video_sources : [])
            .map((entry) => getNumericIdentityFromUrl(entry?.url, 'videos'))
            .filter(Boolean));
        const identities = [sourceItemId, detailId, originalId, ...imageIds, ...videoIds].filter(Boolean);
        return new Set(identities).size > 1 ? '作品详情、X 原帖或媒体身份不一致' : '';
    }

    function getStreamItemRevision(item = {}) {
        const images = Array.isArray(item.image_sources) ? item.image_sources.length : 0;
        const videos = Array.isArray(item.video_sources) ? item.video_sources.length : 0;
        return [
            String(item.prompt_text || '').trim().length,
            images,
            videos,
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

    function isTransientImportRequestError(value = '') {
        return /(canceling statement due to statement timeout|statement timeout|timed?\s*out|timeout|temporar(?:y|ily)|network|failed to fetch|gateway|\b50[234]\b)/i
            .test(String(value?.message || value || ''));
    }

    async function sendImportRuntimeMessageWithRetry(request = {}, operation = 'import-request') {
        let lastError = null;
        for (let attempt = 1; attempt <= IMPORT_REQUEST_MAX_ATTEMPTS; attempt += 1) {
            let response = null;
            try {
                response = await chrome.runtime.sendMessage(request);
            } catch (error) {
                lastError = error;
            }
            if (response?.ok) return response;
            const message = response?.message || lastError?.message || 'Admin Studio 请求失败';
            lastError = new Error(message);
            if (!isTransientImportRequestError(message) || attempt >= IMPORT_REQUEST_MAX_ATTEMPTS) {
                throw lastError;
            }
            const delayMs = IMPORT_REQUEST_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
            logDiagnostic('import-request-retry', {
                operation,
                attempt,
                maxAttempts: IMPORT_REQUEST_MAX_ATTEMPTS,
                delayMs,
                message
            });
            await sleep(delayMs);
        }
        throw lastError || new Error('Admin Studio 请求失败');
    }

    async function filterRepositoryDuplicates(
        items = [],
        message = {},
        checkedKeys = new Set(),
        checkedRevisions = new Map()
    ) {
        let identityConflictCount = 0;
        const identityConflictSourceItemIds = [];
        const pendingRevisions = new Map();
        const pendingCapacityDeferredKeys = new Set();
        const candidates = (Array.isArray(items) ? items : []).filter((item) => {
            const key = getImportIdentityKey(item);
            if (!key) return false;
            const revision = getStreamItemRevision(item);
            const wasCapacityDeferred = message.streamToQueue
                && streamStageState.capacityDeferredKeys.has(key);
            const previousRevision = pendingRevisions.get(key) || checkedRevisions.get(key);
            if ((checkedKeys.has(key) || pendingRevisions.has(key))
                && !wasCapacityDeferred
                && !isStreamItemRevisionImproved(previousRevision, revision)) return false;
            pendingRevisions.set(key, revision);
            if (wasCapacityDeferred) pendingCapacityDeferredKeys.add(key);
            if (getMeigenIdentityConflictReason(item)) {
                identityConflictCount += 1;
                identityConflictSourceItemIds.push(String(item.source_item_id || ''));
                return false;
            }
            return true;
        });
        const commitPendingChecks = () => {
            pendingRevisions.forEach((revision, key) => {
                checkedKeys.add(key);
                checkedRevisions.set(key, revision);
            });
            pendingCapacityDeferredKeys.forEach((key) => streamStageState.capacityDeferredKeys.delete(key));
        };
        if (!candidates.length) {
            commitPendingChecks();
            if (message.streamToQueue) {
                streamStageState.checkedCandidateCount = checkedKeys.size;
                streamStageState.identityRejectedCount += identityConflictCount;
            }
            return {
                uniqueItems: [],
                duplicateCount: 0,
                repositoryDuplicateCount: 0,
                candidateDuplicateCount: 0,
                repositoryDuplicateSourceItemIds: [],
                candidateDuplicateSourceItemIds: [],
                identityConflictCount
            };
        }
        const response = await sendImportRuntimeMessageWithRetry({
            type: MESSAGE_CHECK_DUPLICATES,
            payload: { source: 'meigen', items: candidates },
            adminBaseUrl: message.adminBaseUrl,
            maxItems: candidates.length
        }, 'duplicate-preflight');
        commitPendingChecks();
        const duplicateIds = new Set((response.result?.duplicateSourceItemIds || []).map((value) => String(value || '')));
        const hasDuplicateBreakdown = Array.isArray(response.result?.repositoryDuplicateSourceItemIds)
            || Array.isArray(response.result?.candidateDuplicateSourceItemIds);
        const repositoryDuplicateIds = new Set((hasDuplicateBreakdown
            ? response.result?.repositoryDuplicateSourceItemIds
            : response.result?.duplicateSourceItemIds || []).map((value) => String(value || '')));
        const candidateDuplicateIds = new Set((response.result?.candidateDuplicateSourceItemIds || [])
            .map((value) => String(value || '')));
        const rejectedIdentityIds = new Set((response.result?.rejectedIdentitySourceItemIds || []).map((value) => String(value || '')));
        const uniqueItems = candidates.filter((item) => (
            !duplicateIds.has(String(item.source_item_id || ''))
            && !rejectedIdentityIds.has(String(item.source_item_id || ''))
        ));
        if (message.streamToQueue) {
            repositoryDuplicateIds.forEach((key) => streamStageState.repositoryDuplicateKeys.add(key));
            candidateDuplicateIds.forEach((key) => streamStageState.candidateDuplicateKeys.add(key));
            streamStageState.checkedCandidateCount = checkedKeys.size;
            streamStageState.repositoryDuplicateCount = streamStageState.repositoryDuplicateKeys.size;
            streamStageState.candidateDuplicateCount = streamStageState.candidateDuplicateKeys.size;
            streamStageState.identityRejectedCount += identityConflictCount + rejectedIdentityIds.size;
        }
        logDiagnostic('duplicate-preflight', {
            checked: candidates.length + identityConflictCount,
            unique: uniqueItems.length,
            repositoryDuplicates: repositoryDuplicateIds.size,
            candidateDuplicates: candidateDuplicateIds.size,
            identityRejected: identityConflictCount + rejectedIdentityIds.size,
            duplicateSourceItemIds: Array.from(duplicateIds).slice(0, 30),
            repositoryDuplicateSourceItemIds: Array.from(repositoryDuplicateIds).slice(0, 30),
            candidateDuplicateSourceItemIds: Array.from(candidateDuplicateIds).slice(0, 30),
            identityRejectedSourceItemIds: [...identityConflictSourceItemIds, ...rejectedIdentityIds].slice(0, 30),
        });
        return {
            uniqueItems,
            duplicateCount: duplicateIds.size,
            repositoryDuplicateCount: repositoryDuplicateIds.size,
            candidateDuplicateCount: candidateDuplicateIds.size,
            repositoryDuplicateSourceItemIds: Array.from(repositoryDuplicateIds),
            candidateDuplicateSourceItemIds: Array.from(candidateDuplicateIds),
            identityConflictCount: identityConflictCount + rejectedIdentityIds.size,
        };
    }

    function mergeDuplicateSourceItemIds(target = new Set(), result = {}, field = '') {
        (Array.isArray(result?.[field]) ? result[field] : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .forEach((value) => target.add(value));
        return target.size;
    }

    function isStreamReadyItem(item = {}) {
        return !needsRequiredDetail(item);
    }

    function getStreamItemKey(item = {}) {
        return String(item.source_item_id || item.source_page_url || item.original_work_url || '').trim().toLowerCase();
    }

    function rememberStreamRetryItem(item = {}, { incrementAttempt = true } = {}) {
        const key = getStreamItemKey(item);
        if (!key) return '';
        const previousItem = streamStageState.retryItems.get(key);
        const mergedRetryItems = previousItem
            ? getCollector()?.mergeCollectedItems?.([previousItem, item])
            : [];
        const retryItem = mergedRetryItems?.find((entry) => getStreamItemKey(entry) === key)
            || (previousItem ? { ...previousItem, ...item } : { ...item });
        const previousAttemptCount = Math.max(0, Number(streamStageState.retryAttemptCounts.get(key) || 0));
        const attemptCount = previousAttemptCount + (incrementAttempt ? 1 : 0);
        streamStageState.retryItems.set(key, {
            ...retryItem,
            stream_pending_detail: false,
            stream_retry_pending: true,
            stream_retry_attempts: attemptCount,
            stream_server_released: true
        });
        streamStageState.retryAttemptCounts.set(key, attemptCount);
        streamStageState.capacityDeferredKeys.add(key);
        return key;
    }

    function resolveStreamRetryItem(item = {}) {
        const key = getStreamItemKey(item);
        if (!key) return;
        streamStageState.retryItems.delete(key);
        streamStageState.retryAttemptCounts.delete(key);
        streamStageState.capacityDeferredKeys.delete(key);
        streamStageState.retryReservationDeferredKeys.clear();
        if (!streamStageState.retryItems.size) streamStageState.retryReservationActive = false;
    }

    function resetStreamStageState(batchId = '') {
        streamStageState.batchId = String(batchId || '').trim();
        streamStageState.bufferedItems = [];
        streamStageState.sentRevisions = new Map();
        streamStageState.acceptedKeys = new Set();
        streamStageState.checkedKeys = new Set();
        streamStageState.checkedRevisions = new Map();
        streamStageState.capacityDeferredKeys = new Set();
        streamStageState.retryItems = new Map();
        streamStageState.retryAttemptCounts = new Map();
        streamStageState.retryReservationActive = true;
        streamStageState.retryReservationDeferredKeys = new Set();
        streamStageState.promise = Promise.resolve();
        streamStageState.attemptedCount = 0;
        streamStageState.stagedCount = 0;
        streamStageState.skippedDuplicateCount = 0;
        streamStageState.checkedCandidateCount = 0;
        streamStageState.repositoryDuplicateCount = 0;
        streamStageState.candidateDuplicateCount = 0;
        streamStageState.repositoryDuplicateKeys = new Set();
        streamStageState.candidateDuplicateKeys = new Set();
        streamStageState.identityRejectedCount = 0;
        streamStageState.rejectedCount = 0;
        streamStageState.processableCount = 0;
        streamStageState.pendingDetailCount = 0;
        streamStageState.cleanedPublishedCount = 0;
        streamStageState.batchTargetCount = 0;
        streamStageState.lastError = '';
    }

    function getStreamActiveCount() {
        return streamStageState.processableCount + streamStageState.pendingDetailCount;
    }

    function getStreamProcessableCount() {
        return streamStageState.processableCount;
    }

    function getStreamFulfilledCount() {
        return streamStageState.processableCount + streamStageState.cleanedPublishedCount;
    }

    function getStreamCandidateCount() {
        return getStreamFulfilledCount() + streamStageState.pendingDetailCount;
    }

    function getStreamDeferredCandidateCount() {
        return Array.from(streamStageState.capacityDeferredKeys).filter((key) => (
            !streamStageState.acceptedKeys.has(key)
            && !streamStageState.retryItems.has(key)
        )).length;
    }

    function getStreamRetryCapacity(
        remaining = 0,
        retryKeys = [],
        acceptedKeys = null,
        selectedRetryCount = 0,
        reservationActive = true
    ) {
        const stagedKeys = acceptedKeys || new Set();
        const unstagedRetryCount = Array.from(retryKeys).filter((key) => !stagedKeys.has(key)).length;
        const retryReservedCount = Math.min(
            remaining,
            reservationActive ? unstagedRetryCount : selectedRetryCount
        );
        return {
            unstagedRetryCount,
            retryReservedCount,
            regularCapacity: Math.max(0, remaining - retryReservedCount)
        };
    }

    function getStreamRetryReservationReleaseThreshold(retryCount = 0) {
        return Math.min(
            AUTOMATION_RETRY_RESERVATION_MAX_DEFERRED,
            Math.max(
                AUTOMATION_RETRY_RESERVATION_MIN_DEFERRED,
                Math.max(0, Number(retryCount || 0)) * AUTOMATION_RETRY_RESERVATION_MULTIPLIER
            )
        );
    }

    function shouldReleaseStreamRetryReservation(
        batchRemaining = 0,
        unstagedRetryCount = 0,
        retryCandidateCount = 0,
        deferredCandidateCount = 0
    ) {
        return batchRemaining > 0
            && batchRemaining <= unstagedRetryCount
            && retryCandidateCount === 0
            && deferredCandidateCount >= getStreamRetryReservationReleaseThreshold(unstagedRetryCount);
    }

    function releaseStreamRetryReservation(reason = '') {
        if (!streamStageState.retryReservationActive) return false;
        const deferredCandidateCount = streamStageState.retryReservationDeferredKeys.size;
        streamStageState.retryReservationActive = false;
        streamStageState.retryReservationDeferredKeys.clear();
        logDiagnostic('stream-retry-reservation-released', {
            reason: reason || '待重采卡片未在限定候选窗口内出现',
            retryQueueCount: streamStageState.retryItems.size,
            deferredCandidateCount
        });
        return true;
    }

    function syncStreamBatchStats(batch = {}) {
        const stats = batch?.stats || {};
        streamStageState.processableCount = ['staged', 'queued', 'uploading', 'saving', 'imported']
            .reduce((sum, key) => sum + Number(stats[key] || 0), 0);
        streamStageState.pendingDetailCount = Number(stats.needs_review || 0);
        streamStageState.cleanedPublishedCount = Number(stats.cleaned_published || 0);
        streamStageState.batchTargetCount = Math.max(
            0,
            Number(batch?.settings?.max_items || batch?.settings?.maxItems || streamStageState.batchTargetCount || 0)
        );
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
        streamStageState.promise = streamStageState.promise.then(async () => {
            do {
                const stagedItems = streamStageState.bufferedItems.splice(0, 3);
                if (!stagedItems.length) break;
                streamStageState.attemptedCount += stagedItems.length;
                try {
                    const response = await sendImportRuntimeMessageWithRetry({
                        type: MESSAGE_STAGE,
                        payload: { source: 'meigen', items: stagedItems },
                        batchId: streamStageState.batchId,
                        adminBaseUrl: message.adminBaseUrl,
                        site: message.site,
                        defaultStatus: message.defaultStatus,
                        maxItems: message.maxItems,
                        minFavorites: message.minFavorites,
                        maxFavorites: message.maxFavorites
                    }, 'stream-stage');
                    const result = response.result || {};
                    const acceptedCount = Number(result.stagedCount ?? result.items?.length ?? 0);
                    const duplicateCount = Number(result.skippedDuplicateCount || 0);
                    const ignoredExistingCount = Number(result.ignoredExistingCount || 0);
                    const capacityDeferredCount = Number(result.capacityDeferredCount || 0);
                    (Array.isArray(result.capacityDeferredSourceItemIds)
                        ? result.capacityDeferredSourceItemIds
                        : [])
                        .map((value) => String(value || '').trim().toLowerCase())
                        .filter(Boolean)
                        .forEach((key) => {
                            streamStageState.capacityDeferredKeys.add(key);
                            streamStageState.sentRevisions.delete(key);
                        });
                    streamStageState.batchId = result.batch?.id || streamStageState.batchId;
                    (Array.isArray(result.items) ? result.items : []).forEach((item) => {
                        const key = getStreamItemKey(item);
                        if (key) streamStageState.acceptedKeys.add(key);
                        if (String(item?.status || '') !== 'needs_review') resolveStreamRetryItem(item);
                    });
                    streamStageState.stagedCount = streamStageState.acceptedKeys.size || (streamStageState.stagedCount + acceptedCount);
                    streamStageState.skippedDuplicateCount += duplicateCount;
                    streamStageState.rejectedCount += Math.max(
                        0,
                        stagedItems.length
                            - acceptedCount
                            - duplicateCount
                            - ignoredExistingCount
                            - capacityDeferredCount
                    );
                    syncStreamBatchStats(result.batch);
                } catch (error) {
                    streamStageState.bufferedItems.unshift(...stagedItems);
                    streamStageState.lastError = error?.message || '流式送入队列失败';
                    throw error;
                }
            } while (flush && streamStageState.bufferedItems.length);
        });
        return streamStageState.promise;
    }

    async function stageStreamItemsToTarget(items = [], message = {}, maxItems = 20, options = {}) {
        const candidates = Array.isArray(items) ? items : [];
        const revisionItems = candidates.filter((item) => streamStageState.acceptedKeys.has(getStreamItemKey(item)));
        const newCandidates = candidates.filter((item) => !streamStageState.acceptedKeys.has(getStreamItemKey(item)));
        const retryCandidates = newCandidates.filter((item) => streamStageState.retryItems.has(getStreamItemKey(item)));
        const regularCandidates = newCandidates.filter((item) => !streamStageState.retryItems.has(getStreamItemKey(item)));
        const remaining = Math.max(0, maxItems - getStreamCandidateCount());
        let selectedRetryItems = retryCandidates.slice(0, remaining);
        let { unstagedRetryCount, retryReservedCount, regularCapacity } = getStreamRetryCapacity(
            remaining,
            streamStageState.retryItems.keys(),
            streamStageState.acceptedKeys,
            selectedRetryItems.length,
            streamStageState.retryReservationActive
        );
        let selectedRegularItems = regularCandidates.slice(0, regularCapacity);
        const batchRemaining = Math.max(
            0,
            normalizeMaxItems(message.maxItems || maxItems) - getStreamCandidateCount()
        );
        const retryReservationAtFinalCapacity = batchRemaining > 0
            && batchRemaining <= unstagedRetryCount;
        if (retryCandidates.length > 0) {
            streamStageState.retryReservationDeferredKeys.clear();
        } else if (streamStageState.retryReservationActive
            && retryReservationAtFinalCapacity
            && regularCandidates.length > selectedRegularItems.length) {
            regularCandidates
                .slice(regularCapacity)
                .map((item) => getStreamItemKey(item))
                .filter(Boolean)
                .forEach((key) => streamStageState.retryReservationDeferredKeys.add(key));
            if (shouldReleaseStreamRetryReservation(
                batchRemaining,
                unstagedRetryCount,
                retryCandidates.length,
                streamStageState.retryReservationDeferredKeys.size
            )) {
                releaseStreamRetryReservation('已发现足够多的普通候选，仍未遇到待重新采集卡片');
                ({ unstagedRetryCount, retryReservedCount, regularCapacity } = getStreamRetryCapacity(
                    remaining,
                    streamStageState.retryItems.keys(),
                    streamStageState.acceptedKeys,
                    selectedRetryItems.length,
                    false
                ));
                selectedRegularItems = regularCandidates.slice(0, regularCapacity);
            }
        } else if (!retryReservationAtFinalCapacity) {
            streamStageState.retryReservationDeferredKeys.clear();
        }
        const newItems = [...selectedRetryItems, ...selectedRegularItems];
        const selectedNewKeys = new Set(newItems.map((item) => getStreamItemKey(item)).filter(Boolean));
        const deferredRegularCount = Math.max(0, regularCandidates.length - selectedRegularItems.length);
        if (retryReservedCount > selectedRetryItems.length && deferredRegularCount > 0) {
            logDiagnostic('stream-capacity-reserved-for-retry', {
                retryQueueCount: unstagedRetryCount,
                retryCandidates: retryCandidates.length,
                reservedRetrySlots: retryReservedCount - selectedRetryItems.length,
                acceptedNewCandidates: selectedRegularItems.length,
                deferredNewCandidates: deferredRegularCount
            });
        }
        const capacityDeferredItems = candidates.filter((item) => {
            const key = getStreamItemKey(item);
            return key
                && !streamStageState.acceptedKeys.has(key)
                && !selectedNewKeys.has(key);
        });
        const stagedItems = [...revisionItems, ...newItems]
            .map((item) => options.pendingDetail === true
                && needsRequiredDetail(item)
                ? { ...item, stream_pending_detail: true }
                : item);
        selectedNewKeys.forEach((key) => streamStageState.capacityDeferredKeys.delete(key));
        if (stagedItems.length) {
            queueStreamStage(stagedItems, message, { flush: true });
            await streamStageState.promise;
        }
        capacityDeferredItems
            .map((item) => getStreamItemKey(item))
            .filter(Boolean)
            .forEach((key) => streamStageState.capacityDeferredKeys.add(key));
        streamStageState.checkedCandidateCount = streamStageState.checkedKeys.size;
        if (capacityDeferredItems.length) {
            logDiagnostic('stream-candidates-capacity-deferred', {
                count: capacityDeferredItems.length,
                sourceItemIds: capacityDeferredItems
                    .map((item) => item.source_item_id)
                    .filter(Boolean)
                    .slice(0, 30)
            });
        }
    }

    function alignPayloadItemsWithStreamBatch(items = []) {
        const candidates = Array.isArray(items) ? items : [];
        const alignedItems = candidates.filter((item) => {
            const key = getStreamItemKey(item);
            return key && streamStageState.acceptedKeys.has(key);
        });
        if (alignedItems.length !== candidates.length) {
            logDiagnostic('stream-payload-aligned', {
                before: candidates.length,
                after: alignedItems.length,
                omittedSourceItemIds: candidates
                    .filter((item) => !streamStageState.acceptedKeys.has(getStreamItemKey(item)))
                    .map((item) => item.source_item_id)
                    .filter(Boolean)
                    .slice(0, 30)
            });
        }
        return alignedItems;
    }

    async function restoreStreamBatch(message = {}, collector = getCollector()) {
        const batchId = String(message.batchId || '').trim();
        if (!batchId) return null;
        const response = await chrome.runtime.sendMessage({
            type: MESSAGE_LOAD_BATCH,
            batchId,
            adminBaseUrl: message.adminBaseUrl
        });
        if (!response?.ok) throw new Error(response?.message || '读取原批次失败');
        const result = response.result || {};
        const restoredItems = Array.isArray(result.items) ? result.items : [];
        const activeItems = restoredItems.filter((item) => String(item?.status || '') !== 'cleaned');
        const retryItems = restoredItems.filter((item) => (
            String(item?.status || '') === 'cleaned'
            && !String(item?.final_prompt_id || '').trim()
            && !String(item?.duplicate_of_prompt_id || '').trim()
        ));
        const items = activeItems.map((item) => (
            String(item?.status || '') === 'needs_review'
                ? { ...item, stream_pending_detail: true }
                : item
        ));
        resetStreamStageState(result.batch?.id || batchId);
        items.forEach((item) => {
            const key = getStreamItemKey(item);
            if (!key) return;
            streamStageState.acceptedKeys.add(key);
            streamStageState.checkedKeys.add(key);
            streamStageState.checkedRevisions.set(key, getStreamItemRevision(item));
        });
        retryItems.forEach((item) => rememberStreamRetryItem(item, { incrementAttempt: false }));
        streamStageState.stagedCount = items.length;
        syncStreamBatchStats(result.batch);
        logDiagnostic('stream-batch-restored', {
            activeItems: items.length,
            retryItems: retryItems.length,
            batchId: streamStageState.batchId
        });
        if (!items.length) return null;
        const currentPayload = getLastJobPayload() || collector?.buildPayload?.() || {};
        const payload = {
            ...currentPayload,
            source: 'meigen',
            collected_at: new Date().toISOString(),
            items: collector.mergeCollectedItems(items)
        };
        rememberSessionPayload(payload, summarizePayload(payload));
        detailJob.lastPayload = payload;
        detailJob.lastSummary = summarizePayload(payload);
        return payload;
    }

    async function cleanupPendingStreamItems(message = {}, payload = null) {
        if (!streamStageState.batchId || !streamStageState.pendingDetailCount) return payload;
        const payloadItems = Array.isArray(payload?.items) ? payload.items : [];
        const pendingPayloadItems = payloadItems.filter((item) => item?.stream_pending_detail === true);
        const retryableItems = pendingPayloadItems
            .filter((item) => item?.stream_pending_detail === true && needsRequiredDetail(item));
        const unmatchedPendingCount = Math.max(
            0,
            streamStageState.pendingDetailCount - pendingPayloadItems.length
        );
        const previousPendingDetailCount = streamStageState.pendingDetailCount;
        pendingPayloadItems.forEach((item) => rememberStreamRetryItem(item));
        const response = await sendImportRuntimeMessageWithRetry({
            type: MESSAGE_CLEANUP_PENDING,
            batchId: streamStageState.batchId,
            adminBaseUrl: message.adminBaseUrl,
            site: message.site
        }, 'pending-detail-cleanup');
        const result = response.result || {};
        const cleanedKeys = new Set((Array.isArray(result.items) ? result.items : [])
            .map((item) => getStreamItemKey(item))
            .filter(Boolean));
        (Array.isArray(result.items) ? result.items : []).forEach((item) => {
            if (!streamStageState.retryItems.has(getStreamItemKey(item))) rememberStreamRetryItem(item);
        });
        cleanedKeys.forEach((key) => {
            streamStageState.acceptedKeys.delete(key);
            streamStageState.sentRevisions.delete(key);
            streamStageState.capacityDeferredKeys.add(key);
        });
        streamStageState.stagedCount = streamStageState.acceptedKeys.size;
        if (result.batch) {
            syncStreamBatchStats(result.batch);
        } else {
            streamStageState.pendingDetailCount = Math.max(0, previousPendingDetailCount - cleanedKeys.size);
        }
        const nextPayload = payload && cleanedKeys.size
            ? {
                ...payload,
                items: (payload.items || []).map((item) => cleanedKeys.has(getStreamItemKey(item))
                    ? {
                        ...item,
                        stream_pending_detail: false,
                        stream_retry_pending: true,
                        stream_retry_attempts: streamStageState.retryAttemptCounts.get(getStreamItemKey(item)) || 1,
                        stream_server_released: true,
                        stream_final_reason: '详情补全后仍不完整，已释放服务端名额并保留为待重新采集'
                    }
                    : item)
            }
            : payload;
        logDiagnostic('pending-detail-finalized', {
            cleanedCount: cleanedKeys.size,
            retryableCount: retryableItems.length,
            unmatchedPendingCount,
            retryQueueCount: streamStageState.retryItems.size,
            sourceItemIds: Array.from(cleanedKeys).slice(0, 50),
            batchId: streamStageState.batchId
        });
        if (nextPayload) rememberSessionPayload(nextPayload, summarizePayload(nextPayload));
        return nextPayload;
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
            videos: items.reduce((sum, item) => sum + (Array.isArray(item.video_sources) ? item.video_sources.length : 0), 0),
            detail_failures: detailJob.failed.length,
            finalized_unresolved: items.filter((item) => item.stream_final_status === 'unresolved').length,
            retry_pending: streamStageState.retryItems.size,
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
                    pageUrl: window.location.href,
                    automationStatus: getAutomationStatus(),
                    streamDedupState: {
                        checkedKeys: Array.from(streamStageState.checkedKeys),
                        checkedRevisions: Array.from(streamStageState.checkedRevisions.entries()),
                        capacityDeferredKeys: Array.from(streamStageState.capacityDeferredKeys),
                        retryItems: Array.from(streamStageState.retryItems.entries()),
                        retryAttemptCounts: Array.from(streamStageState.retryAttemptCounts.entries()),
                        retryReservationActive: streamStageState.retryReservationActive,
                        retryReservationDeferredKeys: Array.from(streamStageState.retryReservationDeferredKeys),
                        repositoryDuplicateKeys: Array.from(streamStageState.repositoryDuplicateKeys),
                        candidateDuplicateKeys: Array.from(streamStageState.candidateDuplicateKeys)
                    }
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
            if (snapshot.automationStatus?.phase) {
                const dedupState = snapshot.streamDedupState || {};
                const checkedRevisionEntries = (Array.isArray(dedupState.checkedRevisions)
                    ? dedupState.checkedRevisions
                    : []).filter((entry) => Array.isArray(entry) && entry.length >= 2);
                Object.assign(automationJob, snapshot.automationStatus, {
                    running: false,
                    completed: snapshot.automationStatus.completed === true,
                    phase: snapshot.automationStatus.running ? 'failed' : snapshot.automationStatus.phase,
                    lastError: snapshot.automationStatus.running
                        ? '页面曾刷新或关闭，原任务已中断，请重新启动全自动采集'
                        : (snapshot.automationStatus.lastError || '')
                });
                streamStageState.checkedKeys = new Set(Array.isArray(dedupState.checkedKeys) ? dedupState.checkedKeys : []);
                streamStageState.checkedRevisions = new Map(checkedRevisionEntries);
                streamStageState.capacityDeferredKeys = new Set(
                    Array.isArray(dedupState.capacityDeferredKeys) ? dedupState.capacityDeferredKeys : []
                );
                streamStageState.retryItems = new Map(
                    (Array.isArray(dedupState.retryItems) ? dedupState.retryItems : [])
                        .filter((entry) => Array.isArray(entry) && entry.length >= 2)
                );
                streamStageState.retryAttemptCounts = new Map(
                    (Array.isArray(dedupState.retryAttemptCounts) ? dedupState.retryAttemptCounts : [])
                        .filter((entry) => Array.isArray(entry) && entry.length >= 2)
                );
                streamStageState.retryReservationActive = dedupState.retryReservationActive !== false;
                streamStageState.retryReservationDeferredKeys = new Set(
                    Array.isArray(dedupState.retryReservationDeferredKeys)
                        ? dedupState.retryReservationDeferredKeys
                        : []
                );
                streamStageState.repositoryDuplicateKeys = new Set(
                    Array.isArray(dedupState.repositoryDuplicateKeys) ? dedupState.repositoryDuplicateKeys : []
                );
                streamStageState.candidateDuplicateKeys = new Set(
                    Array.isArray(dedupState.candidateDuplicateKeys) ? dedupState.candidateDuplicateKeys : []
                );
                streamStageState.batchId = String(snapshot.automationStatus.batchId || '').trim();
                streamStageState.stagedCount = Math.max(0, Number(snapshot.automationStatus.staged || 0));
                streamStageState.skippedDuplicateCount = Math.max(0, Number(snapshot.automationStatus.stageDuplicates || 0));
                streamStageState.checkedCandidateCount = streamStageState.checkedKeys.size;
                streamStageState.repositoryDuplicateCount = streamStageState.repositoryDuplicateKeys.size;
                streamStageState.candidateDuplicateCount = streamStageState.candidateDuplicateKeys.size;
                streamStageState.identityRejectedCount = Math.max(0, Number(snapshot.automationStatus.identityRejected || 0));
                streamStageState.rejectedCount = Math.max(0, Number(snapshot.automationStatus.rejected || 0));
                streamStageState.processableCount = Math.max(0, Number(snapshot.automationStatus.processable || 0));
                streamStageState.pendingDetailCount = Math.max(0, Number(snapshot.automationStatus.pendingDetail || 0));
                streamStageState.cleanedPublishedCount = Math.max(0, Number(snapshot.automationStatus.published || 0));
                streamStageState.batchTargetCount = Math.max(0, Number(snapshot.automationStatus.batchTarget || 0));
            }
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

    function updateAutomationJob(updates = {}) {
        Object.assign(automationJob, updates, { updatedAt: new Date().toISOString() });
        void persistSessionSnapshot();
    }

    function getAutomationStatus() {
        const payload = getLastJobPayload();
        const summary = getLastJobSummary(payload) || summarizePayload(payload || {});
        const missingDetailCount = (Array.isArray(payload?.items) ? payload.items : [])
            .filter((item) => needsRequiredDetail(item)).length;
        return {
            running: automationJob.running,
            stopRequested: automationJob.stopRequested,
            phase: automationJob.phase,
            target: automationJob.target,
            completed: automationJob.completed,
            startedAt: automationJob.startedAt,
            updatedAt: sessionState.updatedAt || automationJob.updatedAt,
            lastError: automationJob.lastError,
            discovered: Number(summary.total || 0),
            missingDetailCount,
            staged: streamStageState.stagedCount,
            checkedCandidates: streamStageState.checkedKeys.size || streamStageState.checkedCandidateCount,
            duplicates: streamStageState.repositoryDuplicateCount + streamStageState.candidateDuplicateCount + streamStageState.skippedDuplicateCount,
            repositoryDuplicates: streamStageState.repositoryDuplicateCount,
            candidateDuplicates: streamStageState.candidateDuplicateCount,
            stageDuplicates: streamStageState.skippedDuplicateCount,
            identityRejected: streamStageState.identityRejectedCount,
            rejected: streamStageState.rejectedCount,
            processable: streamStageState.processableCount,
            pendingDetail: streamStageState.pendingDetailCount,
            published: streamStageState.cleanedPublishedCount,
            fulfilled: getStreamFulfilledCount(),
            retryPending: streamStageState.retryItems.size,
            retryReserved: getStreamRetryCapacity(
                Math.max(0, automationJob.target - getStreamCandidateCount()),
                streamStageState.retryItems.keys(),
                streamStageState.acceptedKeys,
                0,
                streamStageState.retryReservationActive
            ).retryReservedCount,
            deferredCandidates: getStreamDeferredCandidateCount(),
            batchTarget: streamStageState.batchTargetCount,
            batchId: streamStageState.batchId,
            detailProcessed: detailJob.processed,
            detailTotal: detailJob.total,
            scrollProcessed: scrollJob.processed,
            scrollTotal: scrollJob.total,
            pageProcessed: pageBatchJob.processed,
            pageTotal: pageBatchJob.total
        };
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
            pageBatchStatus: getPageBatchStatus(),
            automationStatus: getAutomationStatus()
        };
    }

    async function resetCollectorState() {
        if (automationJob.running || detailJob.running || scrollJob.running || pageBatchJob.running) {
            return {
                ok: false,
                message: '请先停止当前任务，任务完全停止后再重置'
            };
        }
        Object.assign(detailJob, {
            running: false,
            paused: false,
            processed: 0,
            total: 0,
            phase: '',
            failed: [],
            lastPayload: null,
            lastSummary: null,
            lastError: ''
        });
        Object.assign(scrollJob, {
            running: false,
            stopRequested: false,
            processed: 0,
            total: 0,
            discovered: 0,
            lastPayload: null,
            lastSummary: null,
            lastError: ''
        });
        Object.assign(pageBatchJob, {
            running: false,
            stopRequested: false,
            processed: 0,
            total: 0,
            discovered: 0,
            currentUrl: '',
            lastPayload: null,
            lastSummary: null,
            lastError: ''
        });
        Object.assign(automationJob, {
            running: false,
            stopRequested: false,
            phase: '',
            target: 0,
            completed: false,
            startedAt: '',
            updatedAt: '',
            lastError: ''
        });
        Object.assign(sessionState, {
            lastPayload: null,
            lastSummary: null,
            updatedAt: ''
        });
        resetStreamStageState('');
        diagnosticLog.length = 0;
        window.__FatherKeyMeigenStructuredEntries = [];
        window.__FatherKeyMeigenHoverAuthors = new Map();
        document.querySelectorAll('[data-father-key-hover-revision]').forEach((node) => {
            delete node.dataset.fatherKeyHoverRevision;
        });
        if (chrome?.storage?.session) {
            await chrome.storage.session.remove(SESSION_STORAGE_KEY);
        }
        logDiagnostic('collector-reset', {
            pageUrl: window.location.href,
            scrollY: getScrollSnapshot().y
        });
        return {
            ...getSessionState(),
            ok: true,
            version: getCollector()?.VERSION || ''
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
            counters: {
                checked_candidates: streamStageState.checkedKeys.size || streamStageState.checkedCandidateCount,
                repository_duplicates: streamStageState.repositoryDuplicateCount,
                candidate_duplicates: streamStageState.candidateDuplicateCount,
                stage_duplicates: streamStageState.skippedDuplicateCount,
                identity_rejected: streamStageState.identityRejectedCount,
                active_server_items: getStreamActiveCount(),
                target_fulfilled_items: getStreamFulfilledCount(),
                finalized_unresolved: items.filter((item) => item.stream_final_status === 'unresolved').length
            },
            page_batch_status: getPageBatchStatus(),
            automation_status: getAutomationStatus(),
            items: items.slice(0, 20).map((item, index) => ({
                index: index + 1,
                source_item_id: item.source_item_id || '',
                source_page_url: item.source_page_url || '',
                prompt_length: String(item.prompt_text || '').trim().length,
                prompt_preview: normalizeText(item.prompt_text || '', 160),
                image_count: Array.isArray(item.image_sources) ? item.image_sources.length : 0,
                image_urls: getItemImageUrlPreview(item, 4),
                video_count: Array.isArray(item.video_sources) ? item.video_sources.length : 0,
                video_urls: (Array.isArray(item.video_sources) ? item.video_sources : [])
                    .map((entry) => String(entry?.url || '').trim())
                    .filter(Boolean)
                    .slice(0, 4),
                expected_image_count: item.expected_image_count || 0,
                favorite_count: item.favorite_count || 0,
                author_name: item.author_name || '',
                author_handle: item.author_handle || '',
                author_identity_source: item.author_identity_source || '',
                original_work_url: item.original_work_url || ''
            })),
            recent_log: diagnosticLog.slice(-300)
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
            duplicates: streamStageState.repositoryDuplicateCount + streamStageState.candidateDuplicateCount + streamStageState.skippedDuplicateCount,
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
        const mediaPromptBlocks = getCollector()?._private?.extractMediaPromptBlocks?.(node) || [];
        return Boolean(
            mediaPromptBlocks.length
            || (text && DETAIL_PROMPT_LABEL_PATTERN.test(text) && PROMPT_COPY_TEXT_PATTERN.test(text))
        );
    }

    function findDetailPromptPanel(documentRef = document) {
        if (!documentRef?.querySelectorAll) return null;
        const dialogs = Array.from(documentRef.querySelectorAll(DETAIL_DIALOG_SELECTOR));
        const broadCandidates = Array.from(documentRef.querySelectorAll([
            'aside',
            'section',
            'article',
            'main',
            '[class*="side" i]',
            '[class*="detail" i]',
            '[class*="drawer" i]',
            '[class*="panel" i]',
            'div'
        ].join(','))).slice(0, 900);
        const candidates = [
            ...(documentRef.nodeType === 9 ? [] : [documentRef]),
            ...dialogs,
            ...broadCandidates
        ];
        const seen = new Set();
        const scored = candidates
            .filter((node) => {
                if (!node || seen.has(node)) return false;
                seen.add(node);
                return true;
            })
            .map((node) => {
                const text = getPromptPanelText(node);
                if (!isDetailPromptPanelCandidate(node)) return null;
                const mediaPromptBlocks = getCollector()?._private?.extractMediaPromptBlocks?.(node) || [];
                let score = mediaPromptBlocks.length ? 180 + (mediaPromptBlocks.length * 120) : 100;
                if (mediaPromptBlocks.length > 1) score += 100;
                if (node.matches?.(DETAIL_DIALOG_SELECTOR)) score += 240;
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
        const copyControls = findPromptActionControls(promptRoot, PROMPT_COPY_TEXT_PATTERN);
        logDiagnostic('prompt-copy-controls', {
            count: copyControls.length,
            labels: copyControls.slice(0, 4).map((control) => getShortControlText(control))
        });
        const mediaPromptBlocks = collector?._private?.extractMediaPromptBlocks?.(promptRoot) || [];
        if (mediaPromptBlocks.length && extractedPrompt && !promptNeedsDetailEnrichment(extractedPrompt)) {
            return extractedPrompt;
        }
        if (!copyControls.length) return extractedPrompt;
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
        return extractedPrompt;
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
        return sessionState.lastPayload
            || pageBatchJob.lastPayload
            || scrollJob.lastPayload
            || detailJob.lastPayload
            || collector.buildPayload();
    }

    function getContinuablePayload(payload = {}) {
        return {
            ...payload,
            items: (Array.isArray(payload?.items) ? payload.items : [])
                .filter((item) => item?.stream_final_status !== 'unresolved')
        };
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

    function getHoverTargetRevision(target) {
        if (!target?.querySelectorAll) return '';
        const images = Array.from(target.querySelectorAll('img'))
            .map((image) => String(image.currentSrc || image.src || image.getAttribute?.('src') || '').trim())
            .filter(Boolean)
            .slice(0, 6);
        const links = Array.from(target.querySelectorAll('a[href]'))
            .map((link) => String(link.href || link.getAttribute?.('href') || '').trim())
            .filter((url) => /\/prompt\/|\/status\//i.test(url))
            .slice(0, 6);
        return [...images, ...links].join('|')
            || normalizeText(target.innerText || target.textContent || '', 240);
    }

    function isHoverTargetNearViewport(target) {
        if (typeof target?.getBoundingClientRect !== 'function') return true;
        const rect = target.getBoundingClientRect();
        const viewportHeight = window.innerHeight || 800;
        const margin = Math.max(240, Math.round(viewportHeight * 0.35));
        return Number(rect.bottom || 0) >= -margin
            && Number(rect.top || 0) <= viewportHeight + margin;
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

    function getActiveCollectionRoot(collector = getCollector()) {
        return collector?._private?.getActiveCollectionPanel?.(document) || document;
    }

    async function revealHoverControls(root = document, maxTargets = 20) {
        if (!root?.querySelectorAll) return;
        const rootDocument = root.nodeType === 9 ? root : root.ownerDocument;
        if (rootDocument !== document) return;
        const collector = getCollector();
        const targetLimit = Math.min(24, Math.max(1, Number(maxTargets) || 20));
        const targets = Array.from(root.querySelectorAll('img'))
            .filter((image) => isHoverTargetNearViewport(image))
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect?.() || {};
                const rightRect = right.getBoundingClientRect?.() || {};
                const viewportHeight = window.innerHeight || 800;
                const distance = (rect = {}) => {
                    const top = Number(rect.top || 0);
                    const bottom = Number(rect.bottom || top);
                    if (bottom >= 0 && top <= viewportHeight) return 0;
                    return top > viewportHeight ? top - viewportHeight : Math.abs(bottom);
                };
                return distance(leftRect) - distance(rightRect);
            })
            .map((image) => findHoverScopeFromImage(image))
            .filter(Boolean)
            .filter((target) => isHoverTargetNearViewport(target))
            .filter((target, index, targetsList) => targetsList.indexOf(target) === index)
            .filter((target) => {
                const revision = getHoverTargetRevision(target);
                return !revision || target.dataset?.fatherKeyHoverRevision !== revision;
            })
            .slice(0, targetLimit);
        const seen = new Set();
        for (const target of targets) {
            if (seen.has(target)) continue;
            seen.add(target);
            dispatchHoverEvents(target);
            getHoverChildTargets(target).forEach(dispatchHoverEvents);
            await sleep(HOVER_REVEAL_DELAY_MS);
            cacheHoverAuthorIdentity(target, collector);
            const revision = getHoverTargetRevision(target);
            if (revision) {
                target.dataset ||= {};
                target.dataset.fatherKeyHoverRevision = revision;
            }
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
        return Math.min(parsed, 1000);
    }

    function normalizePageBatchCount(value) {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return PAGE_BATCH_MAX_PAGES;
        return Math.min(parsed, 1000);
    }

    function normalizeMaxItems(value) {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return 20;
        return Math.min(parsed, 1000);
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
        const distance = Math.max(360, Math.round(snapshot.viewport * 0.62));
        window.scrollBy({ top: distance, behavior: 'auto' });
    }

    function getVisibleGalleryMediaState() {
        const viewport = Number(window.innerHeight || document.documentElement?.clientHeight || 800);
        const margin = Math.max(240, Math.round(viewport * 0.35));
        const collectionRoot = getActiveCollectionRoot();
        const entries = Array.from(collectionRoot.querySelectorAll('img, video'))
            .filter((media) => {
                const rect = media.getBoundingClientRect?.() || {};
                return Number(rect.width || 0) > 100
                    && Number(rect.height || 0) > 100
                    && Number(rect.bottom || 0) >= -margin
                    && Number(rect.top || 0) <= viewport + margin;
            })
            .map((media) => {
                const tagName = String(media.tagName || '').toLowerCase();
                const sources = [
                    media.currentSrc,
                    media.src,
                    media.getAttribute?.('src'),
                    media.getAttribute?.('data-src'),
                    ...Array.from(media.querySelectorAll?.('source') || []).flatMap((source) => [
                        source.src,
                        source.getAttribute?.('src'),
                        source.getAttribute?.('data-src')
                    ])
                ].map((value) => String(value || '').trim()).filter(Boolean);
                const durableSource = sources.find((value) => /^https?:\/\//i.test(value)) || '';
                const pending = tagName === 'video'
                    ? !durableSource
                    : (!durableSource || media.complete === false);
                return {
                    tagName,
                    pending,
                    signature: [
                        tagName,
                        durableSource,
                        String(media.currentSrc || ''),
                        String(media.getAttribute?.('poster') || media.poster || ''),
                        Number(media.readyState || 0),
                        Number(media.naturalWidth || media.videoWidth || 0),
                        Number(media.naturalHeight || media.videoHeight || 0)
                    ].join(':')
                };
            });
        return {
            count: entries.length,
            pending: entries.filter((entry) => entry.pending).length,
            signature: entries.map((entry) => entry.signature).join('|')
        };
    }

    async function waitForVisibleGalleryBatch() {
        let previousSnapshot = getScrollSnapshot();
        let previousMediaState = getVisibleGalleryMediaState();
        let stableRounds = 0;
        for (let attempt = 0; attempt < SCROLL_BATCH_SETTLE_LIMIT; attempt += 1) {
            await sleep(SCROLL_BATCH_SETTLE_POLL_MS);
            const nextSnapshot = getScrollSnapshot();
            const nextMediaState = getVisibleGalleryMediaState();
            const grew = nextSnapshot.height > previousSnapshot.height + 12;
            const moved = Math.abs(nextSnapshot.y - previousSnapshot.y) > 12;
            const mediaChanged = nextMediaState.signature !== previousMediaState.signature;
            const waitingForMedia = nextMediaState.pending > 0 && attempt < SCROLL_MEDIA_MIN_WAIT_ATTEMPTS;
            stableRounds = grew || moved || mediaChanged || waitingForMedia ? 0 : stableRounds + 1;
            previousSnapshot = nextSnapshot;
            previousMediaState = nextMediaState;
            if (attempt >= 2 && stableRounds >= 2) break;
        }
        return {
            ...previousSnapshot,
            mediaCandidates: previousMediaState.count,
            pendingMedia: previousMediaState.pending
        };
    }

    async function scrollAndWaitForGalleryBatch() {
        scrollOneViewport();
        return waitForVisibleGalleryBatch();
    }

    async function beginSweepAtCurrentPosition() {
        const before = getScrollSnapshot();
        const snapshot = await waitForVisibleGalleryBatch();
        logDiagnostic('current-sweep-start', {
            startingY: before.y,
            snapshot
        });
        return snapshot;
    }

    async function beginRecoverySweep() {
        const before = getScrollSnapshot();
        window.scrollTo({ top: 0, behavior: 'auto' });
        const snapshot = await waitForVisibleGalleryBatch();
        logDiagnostic('retry-recovery-sweep-start', {
            retryQueueCount: streamStageState.retryItems.size,
            startingY: before.y,
            snapshot
        });
        return snapshot;
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
        const rawValue = String(value || '').trim();
        if (!rawValue) return '';
        try {
            const url = new URL(rawValue, baseUrl);
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
            if (Array.isArray(item?.video_sources) && item.video_sources.length) continue;
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
        if (MEDIA_PROMPT_HEADER_PATTERN.test(text)) {
            return text
                .split(/(?=\[(?:IMAGE|VIDEO)\s*·\s*\d{1,3}\])/i)
                .some((section) => COLLAPSED_PROMPT_MARKER_PATTERN.test(normalizeText(section, 20000)));
        }
        if (text.length < 180) return true;
        if (/Free\s+GPT\s+Image|Copy,\s*paste,\s*generate|no\s+prompt\s+engineering/i.test(text)) return true;
        return false;
    }

    function itemPromptNeedsDetailEnrichment(item = {}) {
        if (item?.prompt_complete) return false;
        const hasVideo = (Array.isArray(item?.video_sources) && item.video_sources.length > 0)
            || Number(item?.expected_video_count || 0) > 0;
        return hasVideo || promptNeedsDetailEnrichment(item?.prompt_text || '');
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

    function mergeVideoSources(left = [], right = [], limit = 4) {
        const seen = new Set();
        const videos = [];
        [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].forEach((entry) => {
            const url = String(entry?.url || '').trim();
            if (!url) return;
            const key = url.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            videos.push({ ...entry, url });
        });
        return videos.slice(0, limit);
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
        const targetPromptIdentity = getPromptIdentityFromUrl(targetUrl);
        const currentPromptIdentity = getPromptIdentityFromUrl(current);
        if (targetPromptIdentity && currentPromptIdentity) {
            return targetPromptIdentity === currentPromptIdentity;
        }
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
        return decoded.match(/\/(?:tweets|videos)\/(\d{12,25})(?:\/|$)/i)?.[1] || '';
    }

    function getTargetStatusIds(item = {}) {
        const sourceItemId = /^\d{12,25}$/.test(String(item.source_item_id || '').trim())
            ? String(item.source_item_id).trim()
            : '';
        return new Set([
            sourceItemId,
            getPromptIdFromUrl(item.source_page_url || ''),
            getLongNumericIdFromText(item.original_work_url || ''),
            ...((Array.isArray(item.image_sources) ? item.image_sources : [])
                .map((entry) => getTweetStatusIdFromImageUrl(entry?.url || ''))),
            ...((Array.isArray(item.video_sources) ? item.video_sources : [])
                .flatMap((entry) => [entry?.url, entry?.poster_url, entry?.posterUrl])
                .map((url) => getTweetStatusIdFromImageUrl(url || '')))
        ].filter(Boolean));
    }

    function getObservedDetailStatusIds(item = {}) {
        const sourceItemId = /^\d{12,25}$/.test(String(item.source_item_id || '').trim())
            ? String(item.source_item_id).trim()
            : '';
        return new Set([
            sourceItemId,
            getLongNumericIdFromText(item.original_work_url || ''),
            ...((Array.isArray(item.image_sources) ? item.image_sources : [])
                .map((entry) => getTweetStatusIdFromImageUrl(entry?.url || ''))),
            ...((Array.isArray(item.video_sources) ? item.video_sources : [])
                .flatMap((entry) => [entry?.url, entry?.poster_url, entry?.posterUrl])
                .map((url) => getTweetStatusIdFromImageUrl(url || '')))
        ].filter(Boolean));
    }

    function detailItemMatchesTargetIdentity(detailItem = {}, targetItem = {}) {
        const targetStatusIds = getTargetStatusIds(targetItem);
        const observedStatusIds = getObservedDetailStatusIds(detailItem);
        if (targetStatusIds.size > 1) return false;
        if (targetStatusIds.size === 1) {
            if (!observedStatusIds.size) return false;
            const targetStatusId = Array.from(targetStatusIds)[0];
            return Array.from(observedStatusIds).every((id) => id === targetStatusId);
        }
        return detailItemMatchesTarget(detailItem, targetItem);
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
        const candidates = (Array.isArray(items) ? items : [])
            .filter(Boolean)
            .filter((item) => detailItemMatchesTargetIdentity(item, targetItem))
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

    function getAuthorHandleFromOriginalWorkUrl(value = '') {
        try {
            const parts = new URL(String(value || '')).pathname.split('/').filter(Boolean);
            if (parts.length >= 3 && parts[1].toLowerCase() === 'status') {
                return `@${parts[0].replace(/^@/, '')}`;
            }
        } catch (_) {
            // Preserve the existing handle when the original URL cannot be parsed.
        }
        return '';
    }

    function applyDetailItemToTarget(target, detailItem = {}) {
        const targetStatusIds = getTargetStatusIds(target);
        const detailStatusIds = getObservedDetailStatusIds(detailItem);
        const hasIdentityConflict = targetStatusIds.size > 0
            && detailStatusIds.size > 0
            && Array.from(detailStatusIds).some((id) => !targetStatusIds.has(id));
        if (hasIdentityConflict) {
            logDiagnostic('detail-merge-skipped-identity-conflict', {
                sourceItemId: target.source_item_id || '',
                targetStatusIds: Array.from(targetStatusIds),
                detailStatusIds: Array.from(detailStatusIds)
            });
            return target;
        }
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
        const originalAuthorHandle = getAuthorHandleFromOriginalWorkUrl(target.original_work_url);
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
        if (originalAuthorHandle) {
            target.author_handle = originalAuthorHandle;
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
        target.video_sources = mergeVideoSources(target.video_sources, detailItem.video_sources);
        target.expected_video_count = Math.max(
            Number(target.expected_video_count || 0),
            Number(detailItem.expected_video_count || 0),
            target.video_sources.length
        );
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
            image_sources: mergeImageSources([], item.image_sources, expectedCount > 0 ? expectedCount : 24),
            video_sources: mergeVideoSources([], item.video_sources)
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

    function getItemMediaUrlSet(item = {}) {
        return new Set([
            ...getItemImageUrlSet(item),
            ...(Array.isArray(item.video_sources) ? item.video_sources : [])
                .flatMap((entry) => [entry?.url, entry?.poster_url, entry?.posterUrl])
                .map((value) => String(value || '').toLowerCase())
                .filter(Boolean)
        ]);
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

    function getPromptIdentityFromUrl(value = '') {
        try {
            const url = new URL(String(value || ''), window.location.href);
            return url.pathname.match(/\/prompt\/([a-z0-9_-]{5,})\/?$/i)?.[1]?.toLowerCase() || '';
        } catch (_) {
            return String(value || '').match(/\/prompt\/([a-z0-9_-]{5,})(?:[/?#]|$)/i)?.[1]?.toLowerCase() || '';
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
            .filter((url) => Boolean(getPromptIdentityFromUrl(url)));
    }

    function getCardDetailUrl(scope, item = {}) {
        if (!scope) return '';
        const target = getCardDetailClickTarget(scope, item);
        const targetAnchor = target?.closest?.('a[href]');
        const candidates = [
            targetAnchor?.getAttribute?.('href'),
            targetAnchor?.href,
            ...Array.from(scope.querySelectorAll?.('a[href]') || [])
                .flatMap((link) => [link.getAttribute?.('href'), link.href])
        ];
        return candidates
            .map((value) => normalizeBatchUrl(value || ''))
            .find((url) => Boolean(getPromptIdentityFromUrl(url))) || '';
    }

    function bindItemToDetailUrl(item = {}, detailUrl = '') {
        const normalizedDetailUrl = normalizeBatchUrl(detailUrl || '');
        const promptIdentity = getPromptIdentityFromUrl(normalizedDetailUrl);
        if (!promptIdentity) return item;
        return {
            ...item,
            source_item_id: promptIdentity,
            source_page_url: normalizedDetailUrl
        };
    }

    function bindCollectedItemsToVisibleCardDetails(items = [], collector = getCollector()) {
        if (!collector?.mergeCollectedItems) return Array.isArray(items) ? items : [];
        const boundItems = (Array.isArray(items) ? items : []).map((item) => {
            if (getPromptIdentityFromUrl(item?.source_page_url || '')) {
                return bindItemToDetailUrl(item, item.source_page_url);
            }
            const scope = findCurrentPageCardScopeForItem(item, collector);
            const detailUrl = getCardDetailUrl(scope, item);
            if (!detailUrl) return item;
            return bindItemToDetailUrl(item, detailUrl);
        });
        return collector.mergeCollectedItems(boundItems);
    }

    function getMediaNodeStatusIds(node) {
        return new Set([
            node?.currentSrc,
            node?.src,
            node?.poster,
            node?.getAttribute?.('src'),
            node?.getAttribute?.('data-src'),
            node?.getAttribute?.('poster')
        ].map((value) => getTweetStatusIdFromImageUrl(value || '')).filter(Boolean));
    }

    function getScopeMediaStatusIds(scope) {
        const ids = new Set();
        Array.from(scope?.querySelectorAll?.('img, video, source') || []).forEach((node) => {
            getMediaNodeStatusIds(node).forEach((id) => ids.add(id));
        });
        return ids;
    }

    function getCardArtworkClickTarget(scope, item = {}) {
        const targetStatusIds = getTargetStatusIds(item);
        const mediaNodes = Array.from(scope?.querySelectorAll?.('img, video') || []);
        if (targetStatusIds.size) {
            const exactMedia = mediaNodes.find((node) => (
                Array.from(getMediaNodeStatusIds(node)).some((id) => targetStatusIds.has(id))
            ));
            if (exactMedia) return exactMedia;
        }
        return mediaNodes.find((node) => {
            const text = normalizeText([
                node?.getAttribute?.('alt'),
                node?.getAttribute?.('class')
            ].filter(Boolean).join(' '), 400);
            return !/(avatar|profile|作者头像|用户头像)/i.test(text);
        }) || null;
    }

    function findCurrentPageCardScopeForItem(item = {}, collector = getCollector()) {
        const targetMediaUrls = Array.from(getItemMediaUrlSet(item));
        const targetStatusIds = getTargetStatusIds(item);
        const targetDetailUrl = normalizeBatchUrl(item.source_page_url || '');
        if (!targetMediaUrls.length && !targetDetailUrl && !targetStatusIds.size) return null;
        if (!collector?.collectImageUrls) return null;
        const scopes = [];
        const exactScope = getBestCardScopeFromDetailLink(targetDetailUrl);
        if (exactScope) scopes.push(exactScope);
        document.querySelectorAll('img, video').forEach((media) => {
            const scope = findHoverScopeFromImage(media);
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
            const videoSources = collector?._private?.collectVideoSources?.(scope) || [];
            videoSources.forEach((entry) => {
                [entry?.url, entry?.poster_url, entry?.posterUrl]
                    .map((value) => String(value || '').toLowerCase())
                    .filter(Boolean)
                    .forEach((url) => urls.push(url));
            });
            const detailUrls = getScopeDetailUrls(scope);
            let score = 0;
            if (targetDetailUrl && detailUrls.some((url) => urlsLooselyMatch(url, targetDetailUrl))) {
                score += 120;
            }
            const observedStatusIds = getScopeMediaStatusIds(scope);
            if (targetStatusIds.size && Array.from(observedStatusIds).some((id) => targetStatusIds.has(id))) {
                score += 100;
            }
            for (const url of urls) {
                if (targetMediaUrls.includes(url)) {
                    score += 90;
                    continue;
                }
                if (targetMediaUrls.some((targetUrl) => urlsLooselyMatch(url, targetUrl))) {
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
        const draggableTarget = scope.matches?.('[draggable="true"]')
            ? scope
            : scope.querySelector?.('[draggable="true"]');
        if (draggableTarget) return draggableTarget;
        const artworkTarget = getCardArtworkClickTarget(scope, item);
        if (artworkTarget) return artworkTarget;
        const imageLink = Array.from(scope.querySelectorAll('a[href]'))
            .find((link) => link.querySelector?.('img') && isSameMeigenUrl(link.href || link.getAttribute?.('href') || ''));
        if (imageLink) return imageLink;
        return scope.querySelector('img') || scope.querySelector('a[href]') || scope;
    }

    function activateCardDetailTarget(target) {
        const navigationAnchor = target?.closest?.('a[href]');
        if (!navigationAnchor && typeof target?.click === 'function') {
            target.click();
            return true;
        }
        return dispatchSyntheticClick(target, { preventNavigation: true });
    }

    function getOpenDetailDialog(documentRef = document) {
        const dialogs = Array.from(documentRef?.querySelectorAll?.(DETAIL_DIALOG_SELECTOR) || []);
        return dialogs.find((node) => (
            node?.hidden !== true
            && node?.getAttribute?.('aria-hidden') !== 'true'
        )) || null;
    }

    function getCloseControlLabel(element) {
        const values = [
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
            element?.innerText,
            element?.textContent
        ].map((value) => normalizeText(value, 120)).filter(Boolean);
        return values[0] || '';
    }

    function closeOpenDetailView() {
        const dialog = getOpenDetailDialog(document);
        const controlRoot = dialog || document;
        const closeControl = Array.from(controlRoot.querySelectorAll('button, [role="button"], [aria-label], [title]'))
            .find((element) => /^(关闭|Close|esc|×|X)$/i.test(getCloseControlLabel(element)));
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
            || Array.from(document.querySelectorAll(DETAIL_DIALOG_SELECTOR) || []).some((node) => {
                const text = normalizeText(node.innerText || node.textContent || '', 2500);
                return DETAIL_PROMPT_LABEL_PATTERN.test(text) || PROMPT_COPY_TEXT_PATTERN.test(text);
            })
        );
    }

    function detailDialogMatchesTarget(dialog, item = {}) {
        if (!dialog) return false;
        const targetStatusIds = getTargetStatusIds(item);
        const observedStatusIds = getScopeMediaStatusIds(dialog);
        if (targetStatusIds.size) {
            if (!observedStatusIds.size) return false;
            return Array.from(observedStatusIds).every((id) => targetStatusIds.has(id));
        }
        const expectedMediaUrls = [
            ...(Array.isArray(item.image_sources) ? item.image_sources.map((entry) => entry?.url) : []),
            ...(Array.isArray(item.video_sources) ? item.video_sources.flatMap((entry) => [entry?.url, entry?.poster_url, entry?.posterUrl]) : [])
        ].filter(Boolean);
        const observedMediaUrls = Array.from(dialog.querySelectorAll('img, video, source'))
            .flatMap((node) => [
                node?.currentSrc,
                node?.src,
                node?.poster,
                node?.getAttribute?.('src'),
                node?.getAttribute?.('data-src'),
                node?.getAttribute?.('poster')
            ])
            .filter(Boolean);
        return expectedMediaUrls.some((expectedUrl) => (
            observedMediaUrls.some((observedUrl) => urlsLooselyMatch(expectedUrl, observedUrl))
        ));
    }

    async function ensureDetailViewClosed() {
        if (!getOpenDetailDialog(document) && !findDetailPromptPanel(document)) return true;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            closeOpenDetailView();
            await sleep(300);
            if (!getOpenDetailDialog(document) && !findDetailPromptPanel(document)) return true;
        }
        return false;
    }

    async function prepareListPageForCollection() {
        if (!isDetailViewVisible()) return false;
        logDiagnostic('list-collect-close-detail', {
            pageUrl: window.location.href
        });
        await ensureDetailViewClosed();
        return true;
    }

    function needsInteractiveDetail(item = {}, { requireFavoriteCount = false } = {}) {
        if (item.stream_final_status === 'unresolved') return false;
        const images = Array.isArray(item.image_sources) ? item.image_sources : [];
        const videos = Array.isArray(item.video_sources) ? item.video_sources : [];
        const expectedImageCount = Number(item.expected_image_count || 0);
        const hasAuthoritativeImageCount = Boolean(
            item.detail_expected_count_authoritative || item.detail_image_count_authoritative
        );
        const imageCountIncomplete = hasAuthoritativeImageCount
            ? images.length < Math.max(1, expectedImageCount)
            : (videos.length > 0 ? images.length < 1 : images.length <= 1);
        const missingSource = !String(item.original_work_url || '').trim()
            || !String(item.author_name || '').trim()
            || !String(item.author_handle || '').trim();
        return itemPromptNeedsDetailEnrichment(item)
            || imageCountIncomplete
            || missingSource
            || (requireFavoriteCount && Number(item.favorite_count || 0) <= 0);
    }

    function needsRequiredDetail(item = {}) {
        if (item.stream_final_status === 'unresolved') return false;
        const images = Array.isArray(item.image_sources) ? item.image_sources : [];
        const videos = Array.isArray(item.video_sources) ? item.video_sources : [];
        const expectedImageCount = Number(item.expected_image_count || 0);
        const hasAuthoritativeImageCount = Boolean(
            item.detail_expected_count_authoritative || item.detail_image_count_authoritative
        );
        const missingRequiredMedia = images.length === 0 && videos.length === 0;
        const confirmedMissingImages = hasAuthoritativeImageCount
            && expectedImageCount > 0
            && images.length < expectedImageCount;
        const missingSource = !String(item.original_work_url || '').trim()
            || !String(item.author_name || '').trim()
            || !String(item.author_handle || '').trim();
        return itemPromptNeedsDetailEnrichment(item)
            || missingRequiredMedia
            || confirmedMissingImages
            || missingSource;
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
        if (!await ensureDetailViewClosed()) {
            throw new Error('上一个作品详情未能关闭，已停止读取以避免提示词串门');
        }
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
        const itemDetailUrl = normalizeBatchUrl(item.source_page_url || '');
        let effectiveDetailUrl = getPromptIdentityFromUrl(itemDetailUrl)
            ? itemDetailUrl
            : getCardDetailUrl(scope, item);
        let effectiveItem = bindItemToDetailUrl(item, effectiveDetailUrl);
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
            activateCardDetailTarget(target);
            await sleep(700);
            await refreshStructuredDataCache();
            const openedDetailUrl = normalizeBatchUrl(window.location.href);
            const openedPromptIdentity = getPromptIdentityFromUrl(openedDetailUrl);
            if (openedPromptIdentity
                && openedPromptIdentity !== getPromptIdentityFromUrl(effectiveDetailUrl)) {
                effectiveDetailUrl = openedDetailUrl;
                effectiveItem = bindItemToDetailUrl(item, effectiveDetailUrl);
                logDiagnostic('detail-current-target-bound', {
                    sourceItemId: effectiveItem.source_item_id || '',
                    detailUrl: effectiveDetailUrl
                });
            }
            const openedDialog = getOpenDetailDialog(document);
            logDiagnostic('detail-current-opened', {
                beforeUrl,
                currentUrl: window.location.href,
                hasPromptPanel: Boolean(findDetailPromptPanel(openedDialog || document)),
                currentMatchesTarget: currentDetailUrlMatchesTarget(effectiveItem, window.location.href)
                    || detailDialogMatchesTarget(openedDialog, effectiveItem),
                dialogMatchesTarget: detailDialogMatchesTarget(openedDialog, effectiveItem),
                observedStatusIds: Array.from(getScopeMediaStatusIds(openedDialog))
            });

            let copiedPrompt = '';
            let lastItems = [];
            const startedAt = Date.now();
            while (Date.now() - startedAt < DETAIL_FRAME_TIMEOUT_MS) {
                const dialog = getOpenDetailDialog(document);
                const detailRoot = dialog || document;
                const promptPanel = findDetailPromptPanel(detailRoot);
                const currentMatchesTarget = currentDetailUrlMatchesTarget(effectiveItem, window.location.href)
                    || (window.location.href === beforeUrl
                        && Boolean(promptPanel)
                        && detailDialogMatchesTarget(dialog, effectiveItem));
                const detailExpectedCount = currentMatchesTarget ? getDetailExpectedCountFromDocument(detailRoot) : 0;
                if (promptPanel && currentMatchesTarget) await expandPromptSection(promptPanel);
                if (!copiedPrompt && promptPanel && currentMatchesTarget) {
                    copiedPrompt = await readPromptFromCopyButton(promptPanel, collector);
                }
                const detailViewReady = Boolean(currentMatchesTarget && (promptPanel || detailExpectedCount > 0));
                if (!detailViewReady) {
                    lastItems = [];
                    logDiagnostic('detail-current-not-ready', {
                        sourceItemId: effectiveItem.source_item_id || '',
                        targetUrl: effectiveItem.source_page_url || '',
                        currentUrl: window.location.href,
                        currentMatchesTarget,
                        hasPromptPanel: Boolean(promptPanel),
                        hasDialog: Boolean(dialog),
                        dialogMatchesTarget: detailDialogMatchesTarget(dialog, effectiveItem),
                        observedStatusIds: Array.from(getScopeMediaStatusIds(dialog)),
                        detailExpectedCount
                    });
                    await sleep(DETAIL_FRAME_POLL_MS);
                    continue;
                }
                lastItems = collector.collectMeigenGalleryItems(detailRoot, buildCollectionOptions({
                    baseUrl: window.location.href,
                    expectedDetailUrl: effectiveItem.source_page_url || '',
                    expectedDetailImageCount: detailExpectedCount,
                    detailFavoriteCount: getDetailFavoriteCountFromPromptPanel(detailRoot, collector),
                    detailOnly: true,
                    structuredEntries: []
                }, effectiveItem));
                lastItems = mergeDetailItemsWithCopiedPrompt(lastItems, copiedPrompt, collector);
                lastItems = expandDetailItemsToExpectedCount(lastItems, detailExpectedCount, collector);
                lastItems = enrichDetailItemsWithVisibleAuthor(lastItems, detailRoot, collector);
                lastItems = selectBestDetailItemsForTarget(lastItems, effectiveItem, {
                    expectedCount: detailExpectedCount
                }).map((detailItem) => ({
                    ...detailItem,
                    source_item_id: effectiveItem.source_item_id || detailItem.source_item_id || '',
                    source_page_url: effectiveItem.source_page_url || detailItem.source_page_url || '',
                    detail_identity_verified: true
                }));
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
                targetUrl: effectiveItem.source_page_url || '',
                currentUrl: window.location.href,
                currentMatchesTarget: currentDetailUrlMatchesTarget(effectiveItem, window.location.href),
                promptLengths: lastItems.map((detailItem) => String(detailItem.prompt_text || '').trim().length),
                imageUrls: lastItems.map((detailItem) => getItemImageUrlPreview(detailItem, 4))
            });
            return lastItems;
        } finally {
            await ensureDetailViewClosed();
            if (window.location.href !== beforeUrl && typeof history.replaceState === 'function') {
                history.replaceState(history.state, '', beforeUrl);
            }
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
        requiredDetailsOnly = false,
        streamMessage = null
    } = {}) {
        const collector = getCollector();
        if (!collector?.mergeCollectedItems) return basePayload;

        const baseItems = bindCollectedItemsToVisibleCardDetails(
            Array.isArray(basePayload.items) ? basePayload.items : [],
            collector
        );
        basePayload = { ...basePayload, items: baseItems };
        const retryDetailUrls = retryFailed
            ? detailJob.failed.map((failure) => failure.url).filter(Boolean)
            : [];
        const interactiveItems = retryFailed
            ? []
            : baseItems.filter((item) => requiredDetailsOnly
                ? needsRequiredDetail(item)
                : needsInteractiveDetail(item, { requireFavoriteCount }));
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
        if (streamMessage) {
            const unstagedItems = baseItems.filter((item) => !streamStageState.acceptedKeys.has(getStreamItemKey(item)));
            if (unstagedItems.length) {
                queueStreamStage(markPendingDetail(unstagedItems), streamMessage, { flush: true });
                await streamStageState.promise;
            }
        }

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
        const streamCheckpointForItem = async (targetItem = {}) => {
            if (!streamMessage) return;
            const checkpointItems = Array.isArray(detailJob.lastPayload?.items)
                ? detailJob.lastPayload.items
                : [];
            const targetKey = getStreamItemKey(targetItem);
            const checkpointItem = checkpointItems.find((item) => (
                (targetKey && getStreamItemKey(item) === targetKey)
                || getDetailResolutionKeys(targetItem).some((key) => getDetailResolutionKeys(item).includes(key))
            ));
            if (!checkpointItem) return;
            const {
                stream_pending_detail: _pendingDetail,
                streamPendingDetail: _pendingDetailAlias,
                ...cleanItem
            } = checkpointItem;
            const stagedItem = needsInteractiveDetail(cleanItem, { requireFavoriteCount })
                && needsRequiredDetail(cleanItem)
                ? { ...cleanItem, stream_pending_detail: true }
                : cleanItem;
            queueStreamStage([stagedItem], streamMessage, { flush: true, force: true });
            await streamStageState.promise;
        };
        try {
            for (const item of interactiveItems) {
                if (automationJob.stopRequested) break;
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
                await streamCheckpointForItem(item);
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
                if (automationJob.stopRequested) break;
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
                await streamCheckpointForItem({ source_page_url: url });

                if (fallbackIndex + 1 < fallbackUrls.length) {
                    await sleep(DETAIL_FETCH_DELAY_MS);
                }
            }

            const mergedItems = mergeDetailItemsIntoBase(baseItems, detailItems, collector)
                .map(({ stream_pending_detail: _pendingDetail, streamPendingDetail: _pendingDetailAlias, ...item }) => (
                    needsRequiredDetail(item)
                        ? { ...item, stream_pending_detail: true }
                        : item
                ));
            mergedItems.filter((item) => !needsRequiredDetail(item)).forEach((item) => resolveStreamRetryItem(item));
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
        const streamTarget = message.streamToQueue
            ? Math.min(maxItems, normalizeMaxItems(message.streamTarget || maxItems))
            : maxItems;
        const favoriteRange = normalizeFavoriteRange(message);
        const collectionRoot = getActiveCollectionRoot(collector);
        await prepareListPageForCollection();
        await waitForVisibleGalleryBatch();
        const initialScanStartedAt = Date.now();
        await revealHoverControls(collectionRoot, maxItems + 6);
        await waitForVisibleGalleryBatch();
        const initialHoverFinishedAt = Date.now();
        await refreshStructuredDataCache();
        const initialCacheFinishedAt = Date.now();
        if (message.streamToQueue && !message.continueExisting) resetStreamStageState(message.batchId);
        const checkedKeys = message.streamToQueue ? streamStageState.checkedKeys : new Set();
        const checkedRevisions = message.streamToQueue ? streamStageState.checkedRevisions : new Map();
        const repositoryDuplicateKeys = new Set();
        let repositoryDuplicateCount = 0;
        const initialPayload = collector.buildPayload(bindCollectedItemsToVisibleCardDetails(
            collector.collectMeigenGalleryItems(document, buildCollectionOptions({
                ...favoriteRange,
                viewportOnly: true
            })),
            collector
        ));
        const initialCollectFinishedAt = Date.now();
        const initialCheck = message.preflightDuplicates
            ? await filterRepositoryDuplicates(initialPayload.items, message, checkedKeys, checkedRevisions)
            : { uniqueItems: initialPayload.items, duplicateCount: 0 };
        const initialPreflightFinishedAt = Date.now();
        repositoryDuplicateCount = mergeDuplicateSourceItemIds(
            repositoryDuplicateKeys,
            initialCheck,
            'repositoryDuplicateSourceItemIds'
        );
        const previousItems = message.continueExisting
            ? getContinuablePayload(getLastJobPayload() || {}).items
            : [];
        let previousSnapshot = getScrollSnapshot();
        let stableRounds = 0;
        logDiagnostic('scroll-initial-scan', {
            snapshot: previousSnapshot,
            domCandidates: initialPayload.items.length,
            newlyChecked: initialCheck.uniqueItems.length
                + Number(initialCheck.duplicateCount || 0)
                + Number(initialCheck.identityConflictCount || 0),
            unique: initialCheck.uniqueItems.length,
            repositoryDuplicates: Number(initialCheck.repositoryDuplicateCount ?? initialCheck.duplicateCount ?? 0),
            candidateDuplicates: Number(initialCheck.candidateDuplicateCount || 0),
            identityRejected: Number(initialCheck.identityConflictCount || 0),
            checkedCandidates: checkedKeys.size,
            activeServerItems: getStreamActiveCount(),
            timings: {
                hoverMs: initialHoverFinishedAt - initialScanStartedAt,
                structuredCacheMs: initialCacheFinishedAt - initialHoverFinishedAt,
                collectMs: initialCollectFinishedAt - initialCacheFinishedAt,
                preflightMs: initialPreflightFinishedAt - initialCollectFinishedAt,
                totalMs: initialPreflightFinishedAt - initialScanStartedAt
            }
        });

        if (message.streamToQueue) {
            await stageStreamItemsToTarget(initialCheck.uniqueItems, message, streamTarget, {
                pendingDetail: true
            });
        }
        const initialMergedItems = collector.mergeCollectedItems([...previousItems, ...initialCheck.uniqueItems]);
        let payload = applyPayloadLimits({
            ...initialPayload,
            items: message.streamToQueue
                ? alignPayloadItemsWithStreamBatch(initialMergedItems)
                : initialMergedItems
        }, { maxItems, favoriteRange });

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
                if (message.streamToQueue && getStreamCandidateCount() >= streamTarget) break;

                const nextSnapshot = await scrollAndWaitForGalleryBatch();
                scrollJob.processed = index + 1;

                const scanStartedAt = Date.now();
                await revealHoverControls(collectionRoot, maxItems + 6);
                await waitForVisibleGalleryBatch();
                const hoverFinishedAt = Date.now();
                await refreshStructuredDataCache();
                const cacheFinishedAt = Date.now();
                const currentItems = bindCollectedItemsToVisibleCardDetails(
                    collector.collectMeigenGalleryItems(document, buildCollectionOptions({
                        ...favoriteRange,
                        viewportOnly: true
                    })),
                    collector
                );
                const collectFinishedAt = Date.now();
                const duplicateCheck = message.preflightDuplicates
                    ? await filterRepositoryDuplicates(currentItems, message, checkedKeys, checkedRevisions)
                    : { uniqueItems: currentItems, duplicateCount: 0 };
                const preflightFinishedAt = Date.now();
                repositoryDuplicateCount = mergeDuplicateSourceItemIds(
                    repositoryDuplicateKeys,
                    duplicateCheck,
                    'repositoryDuplicateSourceItemIds'
                );
                if (message.streamToQueue && duplicateCheck.uniqueItems.length) {
                    await stageStreamItemsToTarget(duplicateCheck.uniqueItems, message, streamTarget, {
                        pendingDetail: true
                    });
                }
                const mergedPayloadItems = collector.mergeCollectedItems([
                    ...(Array.isArray(payload.items) ? payload.items : []),
                    ...duplicateCheck.uniqueItems
                ]);
                payload = {
                    ...payload,
                    collected_at: new Date().toISOString(),
                    items: (message.streamToQueue
                        ? alignPayloadItemsWithStreamBatch(mergedPayloadItems)
                        : mergedPayloadItems).slice(0, maxItems),
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
                const targetCount = message.streamToQueue
                    ? getStreamCandidateCount()
                    : payload.items.length;
                if (message.streamToQueue && streamStageState.pendingDetailCount > 0) {
                    logDiagnostic('scroll-paused-for-detail', {
                        step: index + 1,
                        pendingDetail: streamStageState.pendingDetailCount,
                        activeServerItems: getStreamActiveCount()
                    });
                    break;
                }
                logDiagnostic('scroll-scan', {
                    step: index + 1,
                    snapshot: nextSnapshot,
                    domCandidates: currentItems.length,
                    newlyChecked: duplicateCheck.uniqueItems.length
                        + Number(duplicateCheck.duplicateCount || 0)
                        + Number(duplicateCheck.identityConflictCount || 0),
                    unique: duplicateCheck.uniqueItems.length,
                    repositoryDuplicates: Number(duplicateCheck.repositoryDuplicateCount ?? duplicateCheck.duplicateCount ?? 0),
                    candidateDuplicates: Number(duplicateCheck.candidateDuplicateCount || 0),
                    identityRejected: Number(duplicateCheck.identityConflictCount || 0),
                    checkedCandidates: checkedKeys.size,
                    activeServerItems: getStreamActiveCount(),
                    staged: streamStageState.stagedCount,
                    processable: streamStageState.processableCount,
                    pendingDetail: streamStageState.pendingDetailCount,
                    timings: {
                        hoverMs: hoverFinishedAt - scanStartedAt,
                        structuredCacheMs: cacheFinishedAt - hoverFinishedAt,
                        collectMs: collectFinishedAt - cacheFinishedAt,
                        preflightMs: preflightFinishedAt - collectFinishedAt,
                        totalMs: preflightFinishedAt - scanStartedAt
                    }
                });
                if (targetCount >= streamTarget) {
                    await waitForVisibleGalleryBatch();
                    await refreshStructuredDataCache();
                    const verificationItems = bindCollectedItemsToVisibleCardDetails(
                        collector.collectMeigenGalleryItems(document, buildCollectionOptions({
                            ...favoriteRange,
                            viewportOnly: true
                        })),
                        collector
                    );
                    const verificationCheck = message.preflightDuplicates
                        ? await filterRepositoryDuplicates(verificationItems, message, checkedKeys, checkedRevisions)
                        : { uniqueItems: verificationItems, duplicateCount: 0 };
                    repositoryDuplicateCount = mergeDuplicateSourceItemIds(
                        repositoryDuplicateKeys,
                        verificationCheck,
                        'repositoryDuplicateSourceItemIds'
                    );
                    if (message.streamToQueue && verificationCheck.uniqueItems.length) {
                        await stageStreamItemsToTarget(verificationCheck.uniqueItems, message, streamTarget, {
                            pendingDetail: true
                        });
                    }
                    const verifiedPayloadItems = collector.mergeCollectedItems([
                        ...(Array.isArray(payload.items) ? payload.items : []),
                        ...verificationCheck.uniqueItems
                    ]);
                    payload = {
                        ...payload,
                        collected_at: new Date().toISOString(),
                        items: (message.streamToQueue
                            ? alignPayloadItemsWithStreamBatch(verifiedPayloadItems)
                            : verifiedPayloadItems).slice(0, maxItems)
                    };
                    scrollJob.lastPayload = payload;
                    scrollJob.lastSummary = summarizePayload(payload);
                    rememberSessionPayload(payload, scrollJob.lastSummary);
                    logDiagnostic('scroll-final-verification', {
                        domCandidates: verificationItems.length,
                        improved: verificationCheck.uniqueItems.length,
                        checkedCandidates: checkedKeys.size,
                        activeServerItems: getStreamActiveCount()
                    });
                    break;
                }
                const moved = nextSnapshot.y > previousSnapshot.y + 12;
                const grew = nextSnapshot.height > previousSnapshot.height + 12;
                const nearBottom = nextSnapshot.y + nextSnapshot.viewport >= nextSnapshot.height - 24;
                const foundNewCandidates = duplicateCheck.uniqueItems.length > 0 || duplicateCheck.duplicateCount > 0;
                stableRounds = moved || grew || foundNewCandidates ? 0 : stableRounds + 1;
                previousSnapshot = nextSnapshot;

                if (nearBottom && stableRounds >= SCROLL_COLLECT_STABLE_LIMIT) {
                    logDiagnostic('scroll-source-exhausted', {
                        stableRounds,
                        checkedCandidates: checkedKeys.size,
                        stagedCount: streamStageState.stagedCount,
                        target: maxItems
                    });
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
                checkedCandidateCount: checkedKeys.size,
                exhausted: getStreamCandidateCount() < streamTarget
                    && stableRounds >= SCROLL_COLLECT_STABLE_LIMIT,
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
        const streamTarget = message.streamToQueue
            ? Math.min(maxItems, normalizeMaxItems(message.streamTarget || maxItems))
            : maxItems;
        const favoriteRange = normalizeFavoriteRange(message);
        await prepareListPageForCollection();
        await refreshStructuredDataCache();
        const checkedKeys = message.streamToQueue ? streamStageState.checkedKeys : new Set();
        const checkedRevisions = message.streamToQueue ? streamStageState.checkedRevisions : new Map();
        const repositoryDuplicateKeys = new Set();
        let repositoryDuplicateCount = 0;
        const continuablePayload = getContinuablePayload(getLatestPayload(collector));
        let payload = message.continueExisting
            ? applyPayloadLimits({
                ...continuablePayload,
                items: message.streamToQueue
                    ? alignPayloadItemsWithStreamBatch(continuablePayload.items)
                    : continuablePayload.items
            }, { maxItems, favoriteRange })
            : applyPayloadLimits(
                collector.buildPayload(bindCollectedItemsToVisibleCardDetails(
                    collector.collectMeigenGalleryItems(document, buildCollectionOptions(favoriteRange)),
                    collector
                )),
                { maxItems, favoriteRange }
            );
        let currentUrl = window.location.href;
        let currentRoot = document;
        const visited = new Set();
        let sourceExhausted = false;

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
                if (message.streamToQueue && getStreamCandidateCount() >= streamTarget) break;

                const normalizedCurrentUrl = normalizeBatchUrl(currentUrl) || currentUrl;
                if (visited.has(normalizedCurrentUrl) && currentRoot !== document) {
                    sourceExhausted = true;
                    break;
                }
                if (!visited.has(normalizedCurrentUrl)) {
                    visited.add(normalizedCurrentUrl);
                }

                await revealHoverControls(currentRoot, maxItems + 6);
                if (currentRoot === document) {
                    await waitForVisibleGalleryBatch();
                    await refreshStructuredDataCache();
                }
                const currentItems = collector.collectMeigenGalleryItems(currentRoot, buildCollectionOptions({
                    baseUrl: normalizedCurrentUrl,
                    ...favoriteRange,
                    structuredEntries: currentRoot === document ? getStructuredEntriesForCollection() : []
                }));
                const duplicateCheck = message.preflightDuplicates
                    ? await filterRepositoryDuplicates(currentItems, message, checkedKeys, checkedRevisions)
                    : { uniqueItems: currentItems, duplicateCount: 0 };
                repositoryDuplicateCount = mergeDuplicateSourceItemIds(
                    repositoryDuplicateKeys,
                    duplicateCheck,
                    'repositoryDuplicateSourceItemIds'
                );
                if (message.streamToQueue && duplicateCheck.uniqueItems.length) {
                    await stageStreamItemsToTarget(duplicateCheck.uniqueItems, message, streamTarget, {
                        pendingDetail: true
                    });
                }
                const mergedPayloadItems = collector.mergeCollectedItems([
                    ...(Array.isArray(payload.items) ? payload.items : []),
                    ...duplicateCheck.uniqueItems
                ]);
                payload = {
                    ...payload,
                    page_url: normalizeBatchUrl(window.location.href) || payload.page_url,
                    collected_at: new Date().toISOString(),
                    items: (message.streamToQueue
                        ? alignPayloadItemsWithStreamBatch(mergedPayloadItems)
                        : mergedPayloadItems).slice(0, maxItems),
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

                const targetCount = message.streamToQueue
                    ? getStreamCandidateCount()
                    : payload.items.length;
                if (targetCount >= streamTarget || pageBatchJob.stopRequested || index + 1 >= maxPages) break;

                const nextTarget = findNextPageTarget(currentRoot, normalizedCurrentUrl);
                if (!nextTarget) {
                    sourceExhausted = true;
                    break;
                }

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
                checkedCandidateCount: checkedKeys.size,
                exhausted: sourceExhausted,
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
        await revealHoverControls(getActiveCollectionRoot(collector), maxItems + 6);
        await refreshStructuredDataCache();
        const favoriteRange = normalizeFavoriteRange(message);
        const hasFavoriteRange = Number(favoriteRange.min || 0) > 0 || Number(favoriteRange.max || 0) > 0;
        let payload = (message.enrichDetails || message.retryFailed)
            ? getLatestPayload(collector)
            : collector.buildPayload(bindCollectedItemsToVisibleCardDetails(
                collector.collectMeigenGalleryItems(document, buildCollectionOptions(favoriteRange)),
                collector
            ));
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
                requiredDetailsOnly: message.requiredDetailsOnly === true,
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

    async function runFullyAutomaticCollection(message = {}) {
        let maxItems = normalizeMaxItems(message.maxItems);
        const startedAt = new Date().toISOString();
        updateAutomationJob({
            running: true,
            stopRequested: false,
            phase: 'discovering',
            target: maxItems,
            completed: false,
            startedAt,
            lastError: ''
        });
        logDiagnostic('automation-start', { target: maxItems, startedAt });

        try {
            let payload = null;
            updateAutomationJob({ phase: 'discovering' });
            await prepareListPageForCollection();
            if (String(message.batchId || '').trim()) {
                updateAutomationJob({ phase: 'recovering' });
                payload = await restoreStreamBatch(message);
                if (streamStageState.batchTargetCount > 0) {
                    maxItems = normalizeMaxItems(streamStageState.batchTargetCount);
                    updateAutomationJob({ target: maxItems });
                }
            } else {
                resetStreamStageState('');
            }
            if (streamStageState.retryItems.size > 0) {
                await beginRecoverySweep();
            } else {
                await beginSweepAtCurrentPosition();
            }

            const enrichAndReleaseUnresolved = async () => {
                if (automationJob.stopRequested) return;
                payload = getContinuablePayload(payload || {});
                let items = Array.isArray(payload.items) ? payload.items : [];
                if (getStreamCandidateCount() > maxItems && streamStageState.pendingDetailCount > 0) {
                    const remainingProcessableSlots = Math.max(0, maxItems - getStreamFulfilledCount());
                    const processableItems = items.filter((item) => item?.stream_pending_detail !== true);
                    const pendingItems = items.filter((item) => item?.stream_pending_detail === true);
                    const selectedPendingItems = pendingItems.slice(0, remainingProcessableSlots);
                    items = [...processableItems, ...selectedPendingItems];
                    payload = { ...payload, items };
                    logDiagnostic('over-capacity-batch-recovery', {
                        target: maxItems,
                        activeServerItems: getStreamActiveCount(),
                        processable: getStreamProcessableCount(),
                        pendingDetail: streamStageState.pendingDetailCount,
                        selectedPendingForEnrichment: selectedPendingItems.length
                    });
                }
                const needsEnrichment = items.some((item) => needsRequiredDetail(item));
                if (items.length && (needsEnrichment || streamStageState.pendingDetailCount > 0)) {
                    for (let retryPass = 0; retryPass < AUTOMATION_DETAIL_RETRY_PASSES; retryPass += 1) {
                        if (automationJob.stopRequested) break;
                        const unresolvedCount = items.filter((item) => needsRequiredDetail(item)).length;
                        if (!unresolvedCount && streamStageState.pendingDetailCount === 0) break;
                        detailJob.lastPayload = payload;
                        detailJob.lastSummary = summarizePayload(payload);
                        rememberSessionPayload(payload, detailJob.lastSummary);
                        updateAutomationJob({ phase: retryPass > 0 ? 'retrying' : 'enriching' });
                        logDiagnostic('detail-retry-pass', {
                            pass: retryPass + 1,
                            unresolvedCount,
                            pendingDetail: streamStageState.pendingDetailCount
                        });
                        const detailResponse = await collectPayload({
                            ...message,
                            enrichDetails: true,
                            retryFailed: false,
                            requiredDetailsOnly: true,
                            streamToQueue: true,
                            batchId: streamStageState.batchId,
                            maxItems: Math.max(maxItems, items.length)
                        });
                        payload = detailResponse?.payload || payload;
                        items = Array.isArray(payload?.items) ? payload.items : [];
                    }
                }
                await streamStageState.promise;
                payload = await cleanupPendingStreamItems(message, payload);
                detailJob.lastPayload = payload;
                detailJob.lastSummary = summarizePayload(payload || {});
                rememberSessionPayload(payload, detailJob.lastSummary);
            };

            await enrichAndReleaseUnresolved();

            let response = null;
            let scrollStepsRemaining = AUTOMATION_SCROLL_MAX_STEPS;
            let sourceExhausted = false;
            let stagnantRounds = 0;
            let recoverySweepCount = streamStageState.retryItems.size > 0 ? 1 : 0;
            const scrollChunkSteps = Math.max(8, Math.min(SCROLL_COLLECT_MAX_STEPS, AUTOMATION_DETAIL_BATCH_SIZE * 2));
            while (getStreamFulfilledCount() < maxItems
                && scrollStepsRemaining > 0
                && !automationJob.stopRequested) {
                if (sourceExhausted) {
                    if (streamStageState.retryItems.size === 0
                        || recoverySweepCount >= AUTOMATION_RECOVERY_SWEEP_LIMIT) break;
                    updateAutomationJob({ phase: 'recovering' });
                    await beginRecoverySweep();
                    recoverySweepCount += 1;
                    sourceExhausted = false;
                    stagnantRounds = 0;
                }
                const beforeProgress = {
                    checked: streamStageState.checkedKeys.size,
                    processable: streamStageState.processableCount,
                    pendingDetail: streamStageState.pendingDetailCount,
                    scrollY: getScrollSnapshot().y
                };
                updateAutomationJob({ phase: 'discovering' });
                const streamTarget = Math.min(
                    maxItems,
                    getStreamCandidateCount() + AUTOMATION_DETAIL_BATCH_SIZE
                );
                response = await runScrollCollect({
                    ...message,
                    maxSteps: Math.min(scrollChunkSteps, scrollStepsRemaining),
                    maxItems,
                    streamTarget,
                    continueExisting: true,
                    preflightDuplicates: true,
                    streamToQueue: true,
                    batchId: streamStageState.batchId
                });
                payload = response?.payload || payload || getLastJobPayload();
                await enrichAndReleaseUnresolved();
                const processedSteps = Math.max(0, Number(response?.scrollStatus?.processed || 0));
                scrollStepsRemaining -= Math.max(1, processedSteps);
                sourceExhausted = response?.exhausted === true;
                const afterProgress = {
                    checked: streamStageState.checkedKeys.size,
                    processable: streamStageState.processableCount,
                    pendingDetail: streamStageState.pendingDetailCount,
                    retryPending: streamStageState.retryItems.size,
                    scrollY: getScrollSnapshot().y
                };
                const madeProgress = processedSteps > 0
                    || afterProgress.checked > beforeProgress.checked
                    || afterProgress.processable > beforeProgress.processable
                    || afterProgress.pendingDetail !== beforeProgress.pendingDetail
                    || afterProgress.retryPending !== beforeProgress.retryPending
                    || Math.abs(afterProgress.scrollY - beforeProgress.scrollY) > 12;
                stagnantRounds = madeProgress ? 0 : stagnantRounds + 1;
                if (stagnantRounds >= AUTOMATION_STAGNANT_LIMIT) {
                    sourceExhausted = true;
                    logDiagnostic('automation-stagnant-source', {
                        stagnantRounds,
                        beforeProgress,
                        afterProgress
                    });
                }
            }

            let pagingRound = 0;
            if (sourceExhausted) {
                let previousCheckedCount = -1;
                while (getStreamFulfilledCount() < maxItems
                    && pagingRound < maxItems
                    && !automationJob.stopRequested) {
                    updateAutomationJob({ phase: 'paging' });
                    response = await runPageBatchCollect({
                        ...message,
                        maxPages: Math.max(PAGE_BATCH_MAX_PAGES, maxItems),
                        maxItems,
                        continueExisting: true,
                        preflightDuplicates: true,
                        streamToQueue: true,
                        batchId: streamStageState.batchId
                    });
                    payload = response?.payload || payload;
                    await enrichAndReleaseUnresolved();
                    const checkedCount = streamStageState.checkedKeys.size;
                    sourceExhausted = response?.exhausted === true;
                    pagingRound += 1;
                    if (checkedCount === previousCheckedCount && sourceExhausted) break;
                    previousCheckedCount = checkedCount;
                }
            }

            await streamStageState.promise;
            if (automationJob.stopRequested) {
                updateAutomationJob({
                    running: false,
                    stopRequested: false,
                    phase: 'stopped',
                    completed: false,
                    lastError: '任务已由用户停止'
                });
                logDiagnostic('automation-stopped', getAutomationStatus());
                return payload;
            }
            if (getStreamFulfilledCount() < maxItems) {
                const shortfall = maxItems - getStreamFulfilledCount();
                let reason = `采集提前停止，仍差 ${shortfall} 条可处理内容；再次启动可从当前批次继续`;
                if (sourceExhausted) {
                    reason = `来源已连续稳定到底，仍差 ${shortfall} 条可处理内容；可切换分类后再次继续`;
                } else if (scrollStepsRemaining <= 0) {
                    reason = `已达到 ${AUTOMATION_SCROLL_MAX_STEPS} 步安全滚动上限，仍差 ${shortfall} 条可处理内容；再次启动可从当前批次继续`;
                } else if (pagingRound >= maxItems) {
                    reason = `已达到 ${maxItems} 轮安全翻页上限，仍差 ${shortfall} 条可处理内容；再次启动可从当前批次继续`;
                }
                updateAutomationJob({
                    running: false,
                    phase: 'incomplete',
                    completed: false,
                    lastError: reason
                });
                logDiagnostic('automation-incomplete', getAutomationStatus());
                return payload;
            }
            updateAutomationJob({
                running: false,
                phase: 'completed',
                completed: true,
                lastError: streamStageState.lastError || ''
            });
            logDiagnostic('automation-finish', getAutomationStatus());
            return payload;
        } catch (error) {
            updateAutomationJob({
                running: false,
                phase: 'failed',
                completed: false,
                lastError: error?.message || '全自动采集任务失败'
            });
            logDiagnostic('automation-failed', { message: automationJob.lastError });
            throw error;
        }
    }

    function startFullyAutomaticCollection(message = {}) {
        if (automationJob.running || detailJob.running || scrollJob.running || pageBatchJob.running) {
            return { ok: false, message: '已有采集任务正在运行', automationStatus: getAutomationStatus() };
        }
        void runFullyAutomaticCollection(message).catch(() => {});
        return { ok: true, automationStatus: getAutomationStatus() };
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

        if (message?.type === MESSAGE_RESET_STATE) {
            resetCollectorState()
                .then((response) => sendResponse(response))
                .catch((error) => sendResponse({
                    ok: false,
                    message: error?.message || '插件重置失败'
                }));
            return true;
        }

        if (message?.type === MESSAGE_AUTOMATION_START) {
            sendResponse(startFullyAutomaticCollection(message));
            return false;
        }

        if (message?.type === MESSAGE_AUTOMATION_STATUS) {
            sendResponse({
                ok: true,
                automationStatus: getAutomationStatus(),
                detailStatus: getDetailStatus(),
                scrollStatus: getScrollStatus(),
                pageBatchStatus: getPageBatchStatus(),
                summary: getLastJobSummary()
            });
            return false;
        }

        if (message?.type === MESSAGE_AUTOMATION_STOP) {
            automationJob.stopRequested = automationJob.running;
            scrollJob.stopRequested = scrollJob.running;
            pageBatchJob.stopRequested = pageBatchJob.running;
            detailJob.paused = false;
            updateAutomationJob({});
            sendResponse({ ok: true, automationStatus: getAutomationStatus() });
            return false;
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
