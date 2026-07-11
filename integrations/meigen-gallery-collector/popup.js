(function fatherKeyMeigenCollectorPopup() {
    'use strict';

    const MESSAGE_COLLECT = 'FATHER_KEY_MEIGEN_COLLECT';
    const MESSAGE_PING = 'FATHER_KEY_MEIGEN_PING';
    const MESSAGE_STAGE = 'FATHER_KEY_STAGE_IMPORT';
    const MESSAGE_DOWNLOAD = 'FATHER_KEY_DOWNLOAD_IMPORT';
    const MESSAGE_DETAIL_PAUSE = 'FATHER_KEY_MEIGEN_DETAIL_PAUSE';
    const MESSAGE_DETAIL_RESUME = 'FATHER_KEY_MEIGEN_DETAIL_RESUME';
    const MESSAGE_DETAIL_STATUS = 'FATHER_KEY_MEIGEN_DETAIL_STATUS';
    const MESSAGE_SCROLL_COLLECT = 'FATHER_KEY_MEIGEN_SCROLL_COLLECT';
    const MESSAGE_SCROLL_STOP = 'FATHER_KEY_MEIGEN_SCROLL_STOP';
    const MESSAGE_SCROLL_STATUS = 'FATHER_KEY_MEIGEN_SCROLL_STATUS';
    const MESSAGE_PAGE_BATCH_COLLECT = 'FATHER_KEY_MEIGEN_PAGE_BATCH_COLLECT';
    const MESSAGE_PAGE_BATCH_STOP = 'FATHER_KEY_MEIGEN_PAGE_BATCH_STOP';
    const MESSAGE_PAGE_BATCH_STATUS = 'FATHER_KEY_MEIGEN_PAGE_BATCH_STATUS';
    const MESSAGE_DIAGNOSTICS = 'FATHER_KEY_MEIGEN_DIAGNOSTICS';
    const MESSAGE_SESSION_STATE = 'FATHER_KEY_MEIGEN_SESSION_STATE';
    const DEFAULT_ADMIN_BASE_URL = 'https://www.fatherkey.com';
    const DETAIL_STATUS_POLL_MS = 700;
    const SCROLL_STATUS_POLL_MS = 700;
    const PAGE_BATCH_STATUS_POLL_MS = 700;
    const DEFAULT_SCROLL_STEPS = 30;
    const DEFAULT_PAGE_BATCH_PAGES = 5;

    const state = {
        payload: null,
        automationRunning: false,
        streamedBatchId: '',
        streamStats: null,
        pollTimer: 0,
        scrollPollTimer: 0,
        pageBatchPollTimer: 0,
        detailStatus: {
            running: false,
            paused: false,
            processed: 0,
            total: 0,
            phase: '',
            failed: []
        },
        scrollStatus: {
            running: false,
            stopRequested: false,
            processed: 0,
            total: 0,
            discovered: 0
        },
        pageBatchStatus: {
            running: false,
            stopRequested: false,
            processed: 0,
            total: 0,
            discovered: 0
        },
        summary: {
            collector_version: '',
            total: 0,
            images: 0,
            with_prompt: 0,
            detail_failures: 0
        }
    };

    function getElement(id) {
        return document.getElementById(id);
    }

    function setStatus(text = '') {
        const status = getElement('statusText');
        if (status) status.textContent = text || '等待操作';
    }

    function formatProgress(label = '处理中', current = 0, total = 0, suffix = '') {
        const normalizedCurrent = Math.max(0, Number(current || 0));
        const normalizedTotal = Math.max(normalizedCurrent, Number(total || 0));
        return `${label} ${normalizedCurrent} / ${normalizedTotal}${suffix ? `，${suffix}` : ''}`;
    }

    function setProgressStatus(label, current, total, suffix = '') {
        setStatus(formatProgress(label, current, total, suffix));
    }

    function setCollectorVersion(version = '') {
        state.summary = {
            ...state.summary,
            collector_version: version || state.summary.collector_version || ''
        };
        const versionText = getElement('versionText');
        if (versionText) {
            versionText.textContent = state.summary.collector_version
                ? `版本 ${state.summary.collector_version}`
                : '版本 --';
        }
    }

    function getMaxItemsSetting() {
        const parsed = Number.parseInt(String(getElement('maxItemsInput')?.value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) return 20;
        return Math.min(parsed, 200);
    }

    function getDetailProgressTotal({ retryFailed = false } = {}) {
        if (retryFailed) {
            return state.detailStatus.failed.length
                || Number(state.summary.detail_failures || 0);
        }
        const detailTotal = Array.isArray(state.payload?.items)
            ? state.payload.items.filter((item) => itemNeedsDetailEnrichment(item)).length
            : 0;
        return detailTotal
            || Number(state.summary.detail_failures || 0)
            || getMaxItemsSetting();
    }

    function normalizeOptionalCount(value = '') {
        const parsed = Number.parseInt(String(value || ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function getFavoriteFilterSettings() {
        const minFavorites = normalizeOptionalCount(getElement('minFavoritesInput')?.value || '');
        const maxFavorites = normalizeOptionalCount(getElement('maxFavoritesInput')?.value || '');
        return {
            minFavorites,
            maxFavorites: maxFavorites >= minFavorites || !maxFavorites || !minFavorites ? maxFavorites : minFavorites
        };
    }

    function filterPayloadByFavoriteSettings(payload = {}) {
        const { minFavorites, maxFavorites } = getFavoriteFilterSettings();
        const items = Array.isArray(payload.items) ? payload.items : [];
        return {
            ...payload,
            items: items.filter((item) => {
                const count = Number(item?.favorite_count || 0);
                if (minFavorites > 0 && count < minFavorites) return false;
                if (maxFavorites > 0 && count > maxFavorites) return false;
                return true;
            })
        };
    }

    function updateSummary(summary = state.summary) {
        state.summary = summary || state.summary;
        const total = Number(state.summary.total || 0);
        const images = Number(state.summary.images || 0);
        const withPrompt = Number(state.summary.with_prompt || 0);
        const failures = Number(state.summary.detail_failures || state.detailStatus.failed?.length || 0);
        const missing = Array.isArray(state.payload?.items)
            ? state.payload.items.filter((item) => itemNeedsDetailEnrichment(item)).length
            : Math.max(0, total - withPrompt);
        const version = state.summary.collector_version || state.payload?.collector_version || '';
        setCollectorVersion(version);
        const summaryEl = getElement('summary');
        if (summaryEl) {
            summaryEl.innerHTML = [
                `<span>作品 ${total}</span>`,
                `<span>图片 ${images}</span>`,
                `<span>待补 ${missing}</span>`,
                `<span>失败 ${failures}</span>`
            ].join('');
        }
        const busy = state.automationRunning || state.detailStatus.running || state.scrollStatus.running || state.pageBatchStatus.running;
        getElement('collectBtn').disabled = busy;
        getElement('stageBtn').disabled = !total || busy;
        getElement('downloadBtn').disabled = !total || busy;
        getElement('retryBtn').disabled = !failures || busy;
        getElement('enrichBtn').disabled = state.scrollStatus.running || state.pageBatchStatus.running;
        getElement('scrollBtn').disabled = busy;
        getElement('stopScrollBtn').disabled = !state.scrollStatus.running;
        getElement('pageBatchBtn').disabled = busy;
        getElement('stopPageBatchBtn').disabled = !state.pageBatchStatus.running;
        getElement('pauseBtn').disabled = !state.detailStatus.running || state.scrollStatus.running || state.pageBatchStatus.running;
        getElement('pauseBtn').textContent = state.detailStatus.paused ? '继续' : '暂停';
        getElement('diagnosticsBtn').disabled = busy;
    }

    async function getActiveTab() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs?.[0] || null;
    }

    function isMeigenTab(tab = {}) {
        try {
            const host = new URL(tab.url || '').hostname;
            return host === 'www.meigen.ai' || host === 'meigen.ai';
        } catch (_) {
            return false;
        }
    }

    function sendTabMessage(tabId, message) {
        return chrome.tabs.sendMessage(tabId, message);
    }

    function getFriendlyConnectionMessage(error = {}) {
        const message = String(error?.message || '');
        if (/receiving end does not exist|could not establish connection/i.test(message)) {
            return '送入队列连接失败：请刷新 Admin Studio 页面，确认已登录后再点送入队列';
        }
        return message || '操作失败，请刷新页面后重试';
    }

    function applyDetailStatus(detailStatus = {}) {
        state.detailStatus = {
            running: Boolean(detailStatus.running),
            paused: Boolean(detailStatus.paused),
            processed: Number(detailStatus.processed || 0),
            total: Number(detailStatus.total || 0),
            phase: String(detailStatus.phase || ''),
            failed: Array.isArray(detailStatus.failed) ? detailStatus.failed : [],
            lastError: detailStatus.lastError || ''
        };
        state.summary.detail_failures = state.detailStatus.failed.length;
        updateSummary(state.summary);
        if (state.detailStatus.running) {
            const detailLabel = state.detailStatus.phase === 'fallback' ? '详情页补抓中' : '卡片补抓中';
            setProgressStatus(
                state.detailStatus.paused ? '补抓已暂停' : detailLabel,
                state.detailStatus.processed,
                state.detailStatus.total
            );
        }
    }

    function applyScrollStatus(scrollStatus = {}) {
        state.scrollStatus = {
            running: Boolean(scrollStatus.running),
            stopRequested: Boolean(scrollStatus.stopRequested),
            processed: Number(scrollStatus.processed || 0),
            total: Number(scrollStatus.total || 0),
            discovered: Number(scrollStatus.discovered || 0),
            staged: Number(scrollStatus.staged || 0),
            duplicates: Number(scrollStatus.duplicates || 0),
            lastError: scrollStatus.lastError || ''
        };
        updateSummary(state.summary);
        if (state.scrollStatus.running) {
            setProgressStatus(
                state.scrollStatus.stopRequested ? '停止滚动中' : '滚动采集中',
                state.scrollStatus.processed,
                state.scrollStatus.total,
                `已采集 ${state.scrollStatus.discovered} 条，已入队 ${state.scrollStatus.staged} 条`
            );
        }
    }

    function applyPageBatchStatus(pageBatchStatus = {}) {
        state.pageBatchStatus = {
            running: Boolean(pageBatchStatus.running),
            stopRequested: Boolean(pageBatchStatus.stopRequested),
            processed: Number(pageBatchStatus.processed || 0),
            total: Number(pageBatchStatus.total || 0),
            discovered: Number(pageBatchStatus.discovered || 0),
            currentUrl: pageBatchStatus.currentUrl || '',
            lastError: pageBatchStatus.lastError || ''
        };
        updateSummary(state.summary);
        if (state.pageBatchStatus.running) {
            setProgressStatus(
                state.pageBatchStatus.stopRequested ? '停止翻页中' : '翻页采集中',
                state.pageBatchStatus.processed,
                state.pageBatchStatus.total,
                `已采集 ${state.pageBatchStatus.discovered} 条`
            );
        }
    }

    async function ensureContentScriptReady(tab) {
        try {
            const response = await sendTabMessage(tab.id, { type: MESSAGE_PING });
            if (response?.version) {
                setCollectorVersion(response.version);
                updateSummary(state.summary);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    async function getMeigenTabReady() {
        const tab = await getActiveTab();
        if (!tab || !isMeigenTab(tab)) {
            setStatus('请先切到 Meigen 页面再采集');
            return null;
        }

        const ready = await ensureContentScriptReady(tab);
        if (!ready) {
            setStatus('请刷新 Meigen 页面后再采集');
            return null;
        }
        return tab;
    }

    async function collectCurrentPage({ enrichDetails = false, retryFailed = false, streamToQueue = false } = {}) {
        const tab = await getMeigenTabReady();
        if (!tab) return null;
        const maxItems = getMaxItemsSetting();
        const progressTotal = enrichDetails || retryFailed
            ? getDetailProgressTotal({ retryFailed })
            : maxItems;
        setProgressStatus(
            retryFailed ? '重试失败详情中' : (enrichDetails ? '补抓详情中' : '采集当前页'),
            0,
            progressTotal
        );

        if (enrichDetails || retryFailed) {
            startDetailPolling({ waitForStart: true });
        }

        let response = null;
        try {
            response = await sendTabMessage(tab.id, {
                type: MESSAGE_COLLECT,
                enrichDetails,
                retryFailed,
                streamToQueue,
                batchId: streamToQueue ? state.streamedBatchId : '',
                adminBaseUrl: getElement('adminBaseUrl').value,
                site: getElement('siteSelect').value,
                defaultStatus: getElement('statusSelect').value,
                maxItems,
                ...getFavoriteFilterSettings()
            });
        } catch (error) {
            stopDetailPolling();
            setStatus(error?.message || '采集失败，请刷新 Meigen 页面后重试');
            return null;
        }
        stopDetailPolling();
        if (!response?.ok) {
            setStatus(response?.message || '采集失败');
            if (response?.detailStatus) applyDetailStatus(response.detailStatus);
            return null;
        }

        state.payload = response.payload;
        if (response.streamResult) {
            state.streamStats = response.streamResult;
            if (response.streamResult.batchId) state.streamedBatchId = response.streamResult.batchId;
        }
        if (response.detailStatus) applyDetailStatus(response.detailStatus);
        if (response.scrollStatus) applyScrollStatus(response.scrollStatus);
        if (response.pageBatchStatus) applyPageBatchStatus(response.pageBatchStatus);
        updateSummary(response.summary);
        const failed = response.summary?.detail_failures || 0;
        const total = response.summary?.total || 0;
        const missingPrompt = Math.max(0, total - Number(response.summary?.with_prompt || 0));
        const belowLimitMessage = total < maxItems
            ? `当前页只发现 ${total} 条（设置的是上限 ${maxItems}）；如需继续发现作品，请点“滚动采集”或“翻页采集”`
            : '';
        setStatus(failed
            ? `已采集 ${total} 条，${failed} 个详情待重试`
            : (missingPrompt
                ? `已采集 ${total} 条，${missingPrompt} 条待补提示词`
                : (belowLimitMessage || `已采集 ${total} 条，已达到设置上限，可送入队列`)));
        return response.payload;
    }

    async function writeTextToClipboard(text = '') {
        try {
            await navigator.clipboard?.writeText(text);
            return true;
        } catch (_) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                document.execCommand('copy');
                return true;
            } catch (_) {
                return false;
            } finally {
                textarea.remove();
            }
        }
    }

    async function copyDiagnostics() {
        const tab = await getMeigenTabReady();
        if (!tab) return;
        try {
            const response = await sendTabMessage(tab.id, { type: MESSAGE_DIAGNOSTICS });
            if (!response?.ok) {
                setStatus(response?.message || '诊断读取失败');
                return;
            }
            const text = JSON.stringify(response.diagnostics || {}, null, 2);
            const copied = await writeTextToClipboard(text);
            setStatus(copied ? '诊断已复制，可以直接发给 Codex' : '诊断读取成功，但复制失败');
        } catch (error) {
            setStatus(error?.message || '诊断读取失败，请刷新 Meigen 页面后重试');
        }
    }

    async function refreshDetailStatus() {
        const tab = await getActiveTab();
        if (!tab || !isMeigenTab(tab)) return null;
        try {
            const response = await sendTabMessage(tab.id, { type: MESSAGE_DETAIL_STATUS });
            if (response?.ok) {
                applyDetailStatus(response.status);
                if (response.summary) {
                    state.summary = {
                        ...state.summary,
                        ...response.summary,
                        detail_failures: response.status?.failed?.length || response.summary.detail_failures || 0
                    };
                    updateSummary(state.summary);
                }
                return response.status;
            }
        } catch (_) {
            return null;
        }
        return null;
    }

    function startDetailPolling({ waitForStart = false } = {}) {
        stopDetailPolling();
        let observedRunning = Boolean(state.detailStatus.running);
        const poll = () => {
            void refreshDetailStatus().then((status) => {
                if (status?.running) observedRunning = true;
                if (status && !status.running && (!waitForStart || observedRunning)) {
                    stopDetailPolling();
                }
            });
        };
        state.pollTimer = setInterval(poll, DETAIL_STATUS_POLL_MS);
        poll();
    }

    function stopDetailPolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = 0;
        }
    }

    async function refreshScrollStatus() {
        const tab = await getActiveTab();
        if (!tab || !isMeigenTab(tab)) return null;
        try {
            const response = await sendTabMessage(tab.id, { type: MESSAGE_SCROLL_STATUS });
            if (response?.ok) {
                applyScrollStatus(response.status);
                if (response.summary) {
                    state.summary = {
                        ...state.summary,
                        ...response.summary
                    };
                    updateSummary(state.summary);
                }
                return response.status;
            }
        } catch (_) {
            return null;
        }
        return null;
    }

    function startScrollPolling({ waitForStart = false } = {}) {
        stopScrollPolling();
        let observedRunning = Boolean(state.scrollStatus.running);
        const poll = () => {
            void refreshScrollStatus().then((status) => {
                if (status?.running) observedRunning = true;
                if (status && !status.running && (!waitForStart || observedRunning)) {
                    stopScrollPolling();
                }
            });
        };
        state.scrollPollTimer = setInterval(poll, SCROLL_STATUS_POLL_MS);
        poll();
    }

    function stopScrollPolling() {
        if (state.scrollPollTimer) {
            clearInterval(state.scrollPollTimer);
            state.scrollPollTimer = 0;
        }
    }

    async function refreshPageBatchStatus() {
        const tab = await getActiveTab();
        if (!tab || !isMeigenTab(tab)) return null;
        try {
            const response = await sendTabMessage(tab.id, { type: MESSAGE_PAGE_BATCH_STATUS });
            if (response?.ok) {
                applyPageBatchStatus(response.status);
                if (response.summary) {
                    state.summary = {
                        ...state.summary,
                        ...response.summary
                    };
                    updateSummary(state.summary);
                }
                return response.status;
            }
        } catch (_) {
            return null;
        }
        return null;
    }

    function startPageBatchPolling({ waitForStart = false } = {}) {
        stopPageBatchPolling();
        let observedRunning = Boolean(state.pageBatchStatus.running);
        const poll = () => {
            void refreshPageBatchStatus().then((status) => {
                if (status?.running) observedRunning = true;
                if (status && !status.running && (!waitForStart || observedRunning)) {
                    stopPageBatchPolling();
                }
            });
        };
        state.pageBatchPollTimer = setInterval(poll, PAGE_BATCH_STATUS_POLL_MS);
        poll();
    }

    function stopPageBatchPolling() {
        if (state.pageBatchPollTimer) {
            clearInterval(state.pageBatchPollTimer);
            state.pageBatchPollTimer = 0;
        }
    }

    function applySessionState(session = {}) {
        if (session.version) {
            setCollectorVersion(session.version);
        }
        if (session.payload?.items?.length) {
            state.payload = session.payload;
        }
        if (session.summary) {
            state.summary = {
                ...state.summary,
                ...session.summary
            };
            updateSummary(state.summary);
        }
        if (session.detailStatus) applyDetailStatus(session.detailStatus);
        if (session.scrollStatus) applyScrollStatus(session.scrollStatus);
        if (session.pageBatchStatus) applyPageBatchStatus(session.pageBatchStatus);
    }

    function resumeStatusPollingForRunningJobs() {
        if (state.detailStatus.running) startDetailPolling();
        if (state.scrollStatus.running) startScrollPolling();
        if (state.pageBatchStatus.running) startPageBatchPolling();
    }

    function hasRunningJob() {
        return state.detailStatus.running || state.scrollStatus.running || state.pageBatchStatus.running;
    }

    async function restoreCollectorSession() {
        const tab = await getActiveTab();
        if (!tab || !isMeigenTab(tab)) {
            setCollectorVersion('');
            setStatus('请先打开 Meigen 页面');
            return false;
        }

        const ready = await ensureContentScriptReady(tab);
        if (!ready) {
            setStatus('请刷新 Meigen 页面后再采集');
            return false;
        }

        setStatus('正在恢复采集进度...');
        try {
            const response = await sendTabMessage(tab.id, { type: MESSAGE_SESSION_STATE });
            if (!response?.ok) {
                setStatus('可以采集当前 Meigen 页面');
                return true;
            }

            applySessionState(response);
            resumeStatusPollingForRunningJobs();

            if (hasRunningJob()) {
                return true;
            }

            const total = Number(response.summary?.total || state.summary.total || 0);
            setStatus(total ? `已恢复上次采集结果：${total} 条` : '可以采集当前 Meigen 页面');
            return true;
        } catch (_) {
            setStatus('请刷新 Meigen 页面后再采集');
            return false;
        }
    }

    async function toggleDetailPause() {
        const tab = await getMeigenTabReady();
        if (!tab) return;
        const nextType = state.detailStatus.paused ? MESSAGE_DETAIL_RESUME : MESSAGE_DETAIL_PAUSE;
        const response = await sendTabMessage(tab.id, { type: nextType });
        if (response?.ok) {
            applyDetailStatus(response.status);
            setStatus(response.status?.paused ? '详情补抓已暂停' : '详情补抓已继续');
        }
    }

    async function scrollCollectCurrentPage({ automatic = false } = {}) {
        const tab = await getMeigenTabReady();
        if (!tab) return null;
        setProgressStatus('滚动采集中', 0, DEFAULT_SCROLL_STEPS, '已采集 0 条');
        startScrollPolling({ waitForStart: true });
        let response = null;
        try {
            response = await sendTabMessage(tab.id, {
                type: MESSAGE_SCROLL_COLLECT,
                maxSteps: automatic ? 80 : DEFAULT_SCROLL_STEPS,
                maxItems: getMaxItemsSetting(),
                preflightDuplicates: automatic,
                streamToQueue: automatic,
                batchId: state.streamedBatchId,
                adminBaseUrl: getElement('adminBaseUrl').value,
                site: getElement('siteSelect').value,
                defaultStatus: getElement('statusSelect').value,
                ...getFavoriteFilterSettings()
            });
        } catch (error) {
            stopScrollPolling();
            setStatus(error?.message || '滚动采集失败，请刷新 Meigen 页面后重试');
            return null;
        }
        stopScrollPolling();

        if (!response?.ok) {
            setStatus(response?.message || '滚动采集失败');
            if (response?.scrollStatus) applyScrollStatus(response.scrollStatus);
            return null;
        }

        state.payload = response.payload;
        if (response.streamResult) {
            state.streamStats = response.streamResult;
            if (response.streamResult.batchId) state.streamedBatchId = response.streamResult.batchId;
        }
        if (response.scrollStatus) applyScrollStatus(response.scrollStatus);
        updateSummary(response.summary);
        const total = Number(response.summary?.total || 0);
        const maxItems = getMaxItemsSetting();
        setStatus(automatic
            ? `自动滚动发现完成：${total} 条库外作品${response.repositoryDuplicateCount ? `，提前跳过仓库重复 ${response.repositoryDuplicateCount} 条` : ''}${total < maxItems ? '，页面已稳定或没有更多作品' : '，已达到设置目标'}`
            : `滚动采集完成：发现 ${total} 条`);
        return response.payload;
    }

    async function stopScrollCollect() {
        const tab = await getMeigenTabReady();
        if (!tab) return;
        const response = await sendTabMessage(tab.id, { type: MESSAGE_SCROLL_STOP });
        if (response?.ok) {
            applyScrollStatus(response.status);
            setStatus('正在停止滚动采集');
        }
    }

    async function pageBatchCollectCurrentPage({ automatic = false } = {}) {
        const tab = await getMeigenTabReady();
        if (!tab) return null;
        const maxPages = automatic ? Math.max(DEFAULT_PAGE_BATCH_PAGES, getMaxItemsSetting()) : DEFAULT_PAGE_BATCH_PAGES;
        setProgressStatus('翻页采集中', 0, maxPages, '已采集 0 条');
        startPageBatchPolling({ waitForStart: true });
        let response = null;
        try {
            response = await sendTabMessage(tab.id, {
                type: MESSAGE_PAGE_BATCH_COLLECT,
                maxPages,
                maxItems: getMaxItemsSetting(),
                continueExisting: automatic,
                preflightDuplicates: automatic,
                streamToQueue: automatic,
                batchId: state.streamedBatchId,
                adminBaseUrl: getElement('adminBaseUrl').value,
                site: getElement('siteSelect').value,
                defaultStatus: getElement('statusSelect').value,
                ...getFavoriteFilterSettings()
            });
        } catch (error) {
            stopPageBatchPolling();
            setStatus(error?.message || '翻页采集失败，请刷新 Meigen 页面后重试');
            return null;
        }
        stopPageBatchPolling();

        if (!response?.ok) {
            setStatus(response?.message || '翻页采集失败');
            if (response?.pageBatchStatus) applyPageBatchStatus(response.pageBatchStatus);
            return null;
        }

        state.payload = response.payload;
        if (response.streamResult) {
            state.streamStats = response.streamResult;
            if (response.streamResult.batchId) state.streamedBatchId = response.streamResult.batchId;
        }
        if (response.pageBatchStatus) applyPageBatchStatus(response.pageBatchStatus);
        updateSummary(response.summary);
        setStatus(`翻页采集完成：发现 ${response.summary?.total || 0} 条`);
        return response.payload;
    }

    async function stopPageBatchCollect() {
        const tab = await getMeigenTabReady();
        if (!tab) return;
        const response = await sendTabMessage(tab.id, { type: MESSAGE_PAGE_BATCH_STOP });
        if (response?.ok) {
            applyPageBatchStatus(response.status);
            setStatus('正在停止翻页采集');
        }
    }

    async function loadSettings() {
        const settings = await chrome.storage.local.get({
            adminBaseUrl: DEFAULT_ADMIN_BASE_URL,
            site: 'cn',
            defaultStatus: 'review',
            maxItems: 20,
            minFavorites: 0,
            maxFavorites: 0
        });
        getElement('adminBaseUrl').value = settings.adminBaseUrl || DEFAULT_ADMIN_BASE_URL;
        getElement('siteSelect').value = settings.site || 'cn';
        getElement('statusSelect').value = settings.defaultStatus || 'review';
        getElement('maxItemsInput').value = String(settings.maxItems || 20);
        getElement('minFavoritesInput').value = settings.minFavorites ? String(settings.minFavorites) : '';
        getElement('maxFavoritesInput').value = settings.maxFavorites ? String(settings.maxFavorites) : '';
    }

    async function saveSettings() {
        const favoriteFilter = getFavoriteFilterSettings();
        await chrome.storage.local.set({
            adminBaseUrl: getElement('adminBaseUrl').value || DEFAULT_ADMIN_BASE_URL,
            site: getElement('siteSelect').value || 'cn',
            defaultStatus: getElement('statusSelect').value || 'review',
            maxItems: getMaxItemsSetting(),
            ...favoriteFilter
        });
    }

    function itemNeedsDetailEnrichment(item = {}) {
        const imageCount = Array.isArray(item?.image_sources) ? item.image_sources.length : 0;
        const expectedImageCount = Number(item?.expected_image_count || 0);
        const hasAuthoritativeImageCount = Boolean(item?.detail_expected_count_authoritative || item?.detail_image_count_authoritative);
        const imageCountIncomplete = hasAuthoritativeImageCount
            ? imageCount < Math.max(1, expectedImageCount)
            : imageCount <= 1;
        const favoriteCount = Number(item?.favorite_count || 0);
        const favoriteFilter = getFavoriteFilterSettings();
        const requireFavoriteCount = favoriteFilter.minFavorites > 0 || favoriteFilter.maxFavorites > 0;
        const missingSource = !String(item?.original_work_url || '').trim()
            || !String(item?.author_name || '').trim()
            || !String(item?.author_handle || '').trim();
        return promptNeedsDetailEnrichment(item?.prompt_text || '')
            || imageCountIncomplete
            || missingSource
            || (requireFavoriteCount && favoriteCount <= 0);
    }

    function payloadNeedsDetailEnrichment(payload = {}) {
        return Array.isArray(payload.items)
            && payload.items.some((item) => itemNeedsDetailEnrichment(item));
    }

    function promptNeedsDetailEnrichment(value = '') {
        const text = String(value || '').trim();
        if (!text) return true;
        if (text.length < 180) return true;
        if (/Free\s+GPT\s+Image|Copy,\s*paste,\s*generate|no\s+prompt\s+engineering/i.test(text)) return true;
        return false;
    }

    function getMissingPromptCount(payload = {}) {
        const items = Array.isArray(payload.items) ? payload.items : [];
        return items.filter((item) => promptNeedsDetailEnrichment(item?.prompt_text || '')).length;
    }

    async function collectCurrentPageWithAutoEnrich({ preflightDuplicates = false } = {}) {
        let payload = await collectCurrentPage();
        const maxItems = getMaxItemsSetting();
        const discovered = Array.isArray(payload?.items) ? payload.items.length : 0;
        if (discovered > 0 && (preflightDuplicates || discovered < maxItems)) {
            setStatus(preflightDuplicates
                ? `当前发现 ${discovered} 条，正在查库跳重并继续滚动，实际入队目标 ${maxItems} 条...`
                : `当前发现 ${discovered} 条，正在自动滚动加载，目标上限 ${maxItems} 条...`);
            payload = await scrollCollectCurrentPage({ automatic: true }) || payload;
            if (Number(state.streamStats?.stagedCount || 0) < maxItems) {
                setStatus(`滚动页面已稳定，继续自动翻页补足实际入队目标 ${maxItems} 条...`);
                payload = await pageBatchCollectCurrentPage({ automatic: true }) || payload;
            }
        }
        if (payloadNeedsDetailEnrichment(payload)) {
            setProgressStatus('发现待补内容，正在补抓详情', 0, getDetailProgressTotal());
            payload = await collectCurrentPage({ enrichDetails: true, streamToQueue: true });
        }
        return payload;
    }

    async function getOrCollectPayload() {
        if (state.payload?.items?.length) return state.payload;
        return collectCurrentPageWithAutoEnrich();
    }

    async function stagePayload() {
        await saveSettings();
        let payload = await getOrCollectPayload();
        if (!payload?.items?.length) return;

        if (payloadNeedsDetailEnrichment(payload)) {
            setProgressStatus('先补抓详情，再送入队列', 0, getDetailProgressTotal());
            payload = await collectCurrentPage({ enrichDetails: true });
            if (!payload?.items?.length) return;
        }
        payload = filterPayloadByFavoriteSettings(payload);
        if (!payload.items.length) {
            setStatus('没有符合收藏条件的作品');
            return;
        }

        setStatus('送入队列中...');
        let response = null;
        try {
            response = await chrome.runtime.sendMessage({
                type: MESSAGE_STAGE,
                payload,
                adminBaseUrl: getElement('adminBaseUrl').value,
                site: getElement('siteSelect').value,
                defaultStatus: getElement('statusSelect').value,
                maxItems: getMaxItemsSetting(),
                ...getFavoriteFilterSettings()
            });
        } catch (error) {
            setStatus(getFriendlyConnectionMessage(error));
            return;
        }

        if (!response?.ok) {
            setStatus(response?.message || '送入队列失败');
            return;
        }

        const count = Array.isArray(response.result?.items)
            ? response.result.items.length
            : payload.items.length;
        const skippedDuplicateCount = Number(response.result?.skippedDuplicateCount || 0);
        const missingPromptCount = getMissingPromptCount(payload);
        const viaAdminTab = response.result?.via_admin_tab ? '，已通过 Admin Studio 登录态提交' : '';
        setStatus(`已送入队列 ${count} 条${skippedDuplicateCount ? `，仓库重复跳过 ${skippedDuplicateCount} 条` : ''}${missingPromptCount ? `，待补 ${missingPromptCount} 条` : ''}${viaAdminTab}`);
        return response;
    }

    async function runFullyAutomaticCollectionTask() {
        if (state.automationRunning) return;
        state.automationRunning = true;
        state.streamedBatchId = '';
        state.streamStats = null;
        updateSummary();
        setStatus(`全自动任务启动，目标实际入队 ${getMaxItemsSetting()} 条...`);
        try {
            const payload = await collectCurrentPageWithAutoEnrich({ preflightDuplicates: true });
            if (!payload?.items?.length) {
                setStatus('没有采集到可送入队列的作品');
                return;
            }
            setStatus(`采集完成 ${payload.items.length} 条，正在自动送入队列...`);
            if (state.streamedBatchId) {
                const attempted = Number(state.streamStats?.attemptedCount || payload.items.length);
                const staged = Number(state.streamStats?.stagedCount || 0);
                const duplicates = Number(state.streamStats?.skippedDuplicateCount || 0);
                const rejected = Number(state.streamStats?.rejectedCount || 0);
                setStatus(
                    `批次 ${state.streamedBatchId.slice(0, 8)}：尝试 ${attempted} 条，实际入队 ${staged} 条`
                    + `${duplicates ? `，仓库重复跳过 ${duplicates} 条` : ''}`
                    + `${rejected ? `，未接收 ${rejected} 条` : ''}`
                    + '；服务端将继续处理'
                );
            } else {
                await stagePayload();
            }
        } catch (error) {
            setStatus(error?.message || '全自动采集任务失败');
        } finally {
            state.automationRunning = false;
            updateSummary();
        }
    }

    async function downloadPayload() {
        let payload = await getOrCollectPayload();
        if (!payload?.items?.length) return;
        if (payloadNeedsDetailEnrichment(payload)) {
            setProgressStatus('先补抓详情，再下载结果', 0, getDetailProgressTotal());
            payload = await collectCurrentPage({ enrichDetails: true });
            if (!payload?.items?.length) return;
        }

        const response = await chrome.runtime.sendMessage({
            type: MESSAGE_DOWNLOAD,
            payload
        });

        setStatus(response?.ok ? '结果已下载' : (response?.message || '下载失败'));
    }

    function bindEvents() {
        getElement('collectBtn').addEventListener('click', () => {
            void runFullyAutomaticCollectionTask();
        });
        getElement('scrollBtn').addEventListener('click', () => {
            void scrollCollectCurrentPage();
        });
        getElement('stopScrollBtn').addEventListener('click', () => {
            void stopScrollCollect();
        });
        getElement('pageBatchBtn').addEventListener('click', () => {
            void pageBatchCollectCurrentPage();
        });
        getElement('stopPageBatchBtn').addEventListener('click', () => {
            void stopPageBatchCollect();
        });
        getElement('enrichBtn').addEventListener('click', () => {
            void collectCurrentPage({ enrichDetails: true });
        });
        getElement('pauseBtn').addEventListener('click', () => {
            void toggleDetailPause();
        });
        getElement('retryBtn').addEventListener('click', () => {
            void collectCurrentPage({ retryFailed: true });
        });
        getElement('stageBtn').addEventListener('click', () => {
            void stagePayload();
        });
        getElement('downloadBtn').addEventListener('click', () => {
            void downloadPayload();
        });
        getElement('diagnosticsBtn').addEventListener('click', () => {
            void copyDiagnostics();
        });
        ['adminBaseUrl', 'siteSelect', 'statusSelect', 'maxItemsInput', 'minFavoritesInput', 'maxFavoritesInput'].forEach((id) => {
            getElement(id).addEventListener('change', () => {
                void saveSettings();
            });
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        bindEvents();
        updateSummary();
        await loadSettings();
        await restoreCollectorSession();
    });
})();
