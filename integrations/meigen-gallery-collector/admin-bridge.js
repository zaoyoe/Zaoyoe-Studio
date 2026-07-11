(function fatherKeyMeigenAdminBridge() {
    'use strict';

    const MESSAGE_STAGE_VIA_ADMIN_TAB = 'FATHER_KEY_STAGE_IMPORT_VIA_ADMIN_TAB';

    async function stageItems(body = {}) {
        const response = await fetch('/api/admin/prompts/imports', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
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

        stageItems(message.body || {})
            .then(sendResponse)
            .catch((error) => sendResponse({
                ok: false,
                status: 0,
                message: error?.message || 'Admin Studio 送入队列失败'
            }));
        return true;
    });
})();
