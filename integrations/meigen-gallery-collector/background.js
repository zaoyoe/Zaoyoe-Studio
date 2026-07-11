(function fatherKeyMeigenCollectorBackground() {
    'use strict';

    const MESSAGE_STAGE = 'FATHER_KEY_STAGE_IMPORT';
    const MESSAGE_DOWNLOAD = 'FATHER_KEY_DOWNLOAD_IMPORT';
    const MESSAGE_STAGE_VIA_ADMIN_TAB = 'FATHER_KEY_STAGE_IMPORT_VIA_ADMIN_TAB';
    const DEFAULT_ADMIN_BASE_URL = 'https://www.fatherkey.com';

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
        return Math.min(parsed, 200);
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
        maxFavorites = 0
    } = {}) {
        return {
            action: 'stage_items',
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

    async function sendStageMessageToAdminTab(tab, body) {
        try {
            return await chrome.tabs.sendMessage(tab.id, {
                type: MESSAGE_STAGE_VIA_ADMIN_TAB,
                body
            });
        } catch (error) {
            if (!isMissingMessageReceiver(error) || !await ensureAdminBridgeInjected(tab.id)) {
                throw createAdminBridgeConnectionError(error);
            }
            try {
                return await chrome.tabs.sendMessage(tab.id, {
                    type: MESSAGE_STAGE_VIA_ADMIN_TAB,
                    body
                });
            } catch (retryError) {
                throw createAdminBridgeConnectionError(retryError);
            }
        }
    }

    async function stageImportPayloadViaAdminTab({ body, adminBaseUrl } = {}) {
        const tabs = await queryAdminTabs(adminBaseUrl);
        if (!tabs.length) {
            throw new Error('请先打开 Admin Studio 并保持登录，再点送入队列');
        }

        let lastError = null;
        for (const tab of tabs) {
            try {
                const response = await sendStageMessageToAdminTab(tab, body);
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
        maxFavorites = 0
    } = {}) {
        const items = getItemsFromPayload(payload);
        if (!items.length) {
            throw new Error('当前页面没有可送入队列的内容');
        }

        const baseUrl = normalizeAdminBaseUrl(adminBaseUrl);
        const body = buildStageItemsBody({
            payload,
            site,
            defaultStatus,
            maxItems,
            minFavorites,
            maxFavorites
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
