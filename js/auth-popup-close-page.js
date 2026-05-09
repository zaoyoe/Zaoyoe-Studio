(function () {
    'use strict';

    const GOOGLE_POPUP_MESSAGE_TYPE = 'zaoyoe:google-auth-popup';
    const GOOGLE_POPUP_ACK_MESSAGE_TYPE = 'zaoyoe:google-auth-popup-ack';
    const GOOGLE_POPUP_WINDOW_NAME = 'google_login';
    const GOOGLE_POPUP_RESULT_STORAGE_KEY = 'zaoyoe_google_popup_auth_result_v1';
    const GOOGLE_POPUP_STATE_PREFIX = 'zaoyoe_google_popup:';
    const GOOGLE_REDIRECT_STATE_PREFIX = 'zaoyoe_google_redirect:';
    const POPUP_ACK_TIMEOUT_MS = 900;
    const POPUP_ACK_RETRY_INTERVAL_MS = 120;

    const url = new URL(window.location.href);
    const hash = window.location.hash || '';
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
    const state = hashParams.get('state') || url.searchParams.get('state') || '';
    const isPopupState = typeof state === 'string' && state.startsWith(GOOGLE_POPUP_STATE_PREFIX);
    const isRedirectState = typeof state === 'string' && state.startsWith(GOOGLE_REDIRECT_STATE_PREFIX);
    const isPopupMode = url.searchParams.get('popup') === '1' || (isPopupState && !isRedirectState);
    const isCloseOnlyMode = url.searchParams.get('close') === '1';
    const idToken = hashParams.get('id_token');
    const hashError = hashParams.get('error') || url.searchParams.get('error');
    const hashErrorDescription = hashParams.get('error_description') || url.searchParams.get('error_description');

    function createPopupMessage(payload) {
        return {
            type: GOOGLE_POPUP_MESSAGE_TYPE,
            popupEventId: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            emittedAt: Date.now(),
            ...payload
        };
    }

    function broadcastPopupResult(message) {
        try {
            const envelope = JSON.stringify(message);
            localStorage.setItem(GOOGLE_POPUP_RESULT_STORAGE_KEY, envelope);
            setTimeout(() => {
                try {
                    if (localStorage.getItem(GOOGLE_POPUP_RESULT_STORAGE_KEY) === envelope) {
                        localStorage.removeItem(GOOGLE_POPUP_RESULT_STORAGE_KEY);
                    }
                } catch (_) {
                    // ignore cleanup failure
                }
            }, 1500);
        } catch (_) {
            // ignore storage failures
        }
    }

    function postMessageToOpener(message) {
        if (!window.opener || window.opener === window) {
            return false;
        }

        try {
            window.opener.postMessage(message, window.location.origin);
            return true;
        } catch (_) {
            return false;
        }
    }

    function notifyOpener(message, options) {
        const shouldBroadcast = options?.broadcast === true;

        if (shouldBroadcast) {
            broadcastPopupResult(message);
        }

        postMessageToOpener(message);
        return message;
    }

    function waitForPopupAck(message, options) {
        const shouldBroadcast = options?.broadcast === true;
        const timeoutMs = Number.isFinite(options?.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : POPUP_ACK_TIMEOUT_MS;
        const retryIntervalMs = Number.isFinite(options?.retryIntervalMs) && options.retryIntervalMs > 0
            ? options.retryIntervalMs
            : POPUP_ACK_RETRY_INTERVAL_MS;

        return new Promise((resolve) => {
            const expectedId = String(message.popupEventId || message.emittedAt || '');
            let settled = false;
            let retryTimer = null;
            let timeoutTimer = null;

            const cleanup = () => {
                window.removeEventListener('message', handleAckMessage);
                if (retryTimer) clearTimeout(retryTimer);
                if (timeoutTimer) clearTimeout(timeoutTimer);
            };

            const finish = (acked) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(acked);
            };

            const handleAckMessage = (event) => {
                if (event.origin !== window.location.origin) return;
                const payload = event.data;
                if (!payload || payload.type !== GOOGLE_POPUP_ACK_MESSAGE_TYPE) return;
                if (expectedId && String(payload.popupEventId || '') !== expectedId) return;
                finish(true);
            };

            const send = () => {
                if (settled) return;
                notifyOpener(message, { broadcast: shouldBroadcast });
                retryTimer = setTimeout(send, retryIntervalMs);
            };

            window.addEventListener('message', handleAckMessage);
            send();
            timeoutTimer = setTimeout(() => finish(false), timeoutMs);
        });
    }

    function attemptClosePopup(force) {
        const isPopupWindow = Boolean(
            (window.opener && window.opener !== window)
            || window.name === GOOGLE_POPUP_WINDOW_NAME
        );
        if (!force && !isPopupWindow) {
            return false;
        }

        const tryClose = () => {
            try {
                window.close();
            } catch (_) {
                // ignore
            }
        };

        tryClose();
        setTimeout(() => {
            if (window.closed) return;
            try {
                window.open('', '_self');
            } catch (_) {
                // ignore
            }
            tryClose();
        }, 40);
        return true;
    }

    function fallbackToFullCallback() {
        const fallbackUrl = new URL('/auth-callback.html', window.location.origin);
        fallbackUrl.search = url.search;
        fallbackUrl.hash = hash;
        window.location.replace(fallbackUrl.toString());
    }

    if (isCloseOnlyMode) {
        attemptClosePopup(true);
        return;
    }

    if (!isPopupMode) {
        fallbackToFullCallback();
        return;
    }

    if (hashError) {
        if (!window.opener || window.opener === window) {
            fallbackToFullCallback();
            return;
        }

        const errorMessage = createPopupMessage({
            status: 'error',
            message: hashErrorDescription || hashError
        });
        waitForPopupAck(errorMessage, { broadcast: true }).finally(() => {
            setTimeout(() => {
                attemptClosePopup(true);
            }, 40);
        });
        return;
    }

    if (idToken) {
        if (!window.opener || window.opener === window) {
            fallbackToFullCallback();
            return;
        }

        const credentialMessage = createPopupMessage({
            status: 'credential',
            credential: idToken
        });
        waitForPopupAck(credentialMessage, { broadcast: false }).finally(() => {
            setTimeout(() => {
                attemptClosePopup(true);
            }, 40);
        });
        return;
    }

    fallbackToFullCallback();
}());
