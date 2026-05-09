(function () {
    'use strict';

    const GOOGLE_POPUP_MESSAGE_TYPE = 'zaoyoe:google-auth-popup';
    const GOOGLE_POPUP_WINDOW_NAME = 'google_login';
    const GOOGLE_POPUP_RESULT_STORAGE_KEY = 'zaoyoe_google_popup_auth_result_v1';
    const GOOGLE_POPUP_STATE_PREFIX = 'zaoyoe_google_popup:';
    const GOOGLE_REDIRECT_STATE_PREFIX = 'zaoyoe_google_redirect:';

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

    function dispatchPopupResult(message, options = {}) {
        const shouldBroadcast = options?.broadcast === true;
        notifyOpener(message, { broadcast: shouldBroadcast });

        // Repeat a couple of times before closing so slower production tabs still receive it,
        // without visibly holding the popup open like the old ack-wait path did.
        setTimeout(() => notifyOpener(message, { broadcast: shouldBroadcast }), 28);
        setTimeout(() => notifyOpener(message, { broadcast: shouldBroadcast }), 72);
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
        dispatchPopupResult(errorMessage, { broadcast: true });
        setTimeout(() => {
            attemptClosePopup(true);
        }, 88);
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
        dispatchPopupResult(credentialMessage, { broadcast: false });
        setTimeout(() => {
            attemptClosePopup(true);
        }, 88);
        return;
    }

    fallbackToFullCallback();
}());
