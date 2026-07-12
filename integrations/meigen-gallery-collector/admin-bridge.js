(function fatherKeyMeigenAdminBridge() {
    'use strict';

    const MESSAGE_STAGE_VIA_ADMIN_TAB = 'FATHER_KEY_STAGE_IMPORT_VIA_ADMIN_TAB';

    async function stageItems(body = {}, request = {}) {
        const method = String(request.method || 'POST').toUpperCase();
        const path = String(request.path || '/api/admin/prompts/imports');
        if (!/^\/api\/admin\/prompts\/imports(?:\?|$)/.test(path) || !['GET', 'POST'].includes(method)) {
            return { ok: false, status: 400, message: '不支持的 Admin Studio 请求' };
        }
        const response = await fetch(path, {
            method,
            credentials: 'include',
            headers: method === 'GET' ? undefined : {
                'Content-Type': 'application/json'
            },
            body: method === 'GET' ? undefined : JSON.stringify(body)
        });

        let result = {};
        try {
            result = await response.json();
        } catch (_) {
            result = {};
        }

        if (!response.ok || result.success === false) {
            return {
                ok: false,
                status: response.status,
                message: result.message || (response.status === 401 || response.status === 403
                    ? '请先在 Admin Studio 登录后重试'
                    : '送入队列失败'),
                result
            };
        }

        return {
            ok: true,
            status: response.status,
            result
        };
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== MESSAGE_STAGE_VIA_ADMIN_TAB) return false;

        stageItems(message.body || {}, message.request || {})
            .then(sendResponse)
            .catch((error) => sendResponse({
                ok: false,
                status: 0,
                message: error?.message || 'Admin Studio 送入队列失败'
            }));
        return true;
    });
})();
