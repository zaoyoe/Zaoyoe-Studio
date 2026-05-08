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

    function broadcastPopupResult(payload) {
        try {
            const envelope = JSON.stringify({
                type: GOOGLE_POPUP_MESSAGE_TYPE,
                emittedAt: Date.now(),
                ...payload
            });
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

    function notifyOpener(payload, options) {
        const shouldBroadcast = options?.broadcast !== false;
        const message = {
            type: GOOGLE_POPUP_MESSAGE_TYPE,
            emittedAt: Date.now(),
            ...payload
        };

        if (shouldBroadcast) {
            broadcastPopupResult(message);
        }

        if (!window.opener || window.opener === window) {
            return;
        }

        try {
            window.opener.postMessage(message, window.location.origin);
        } catch (_) {
            // ignore postMessage failures
        }
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
        notifyOpener({
            status: 'error',
            message: hashErrorDescription || hashError
        });
        setTimeout(() => {
            attemptClosePopup(true);
        }, 0);
        return;
    }

    if (idToken) {
        notifyOpener({
            status: 'credential',
            credential: idToken
        }, {
            broadcast: false
        });
        setTimeout(() => {
            attemptClosePopup(true);
        }, 0);
        return;
    }

    fallbackToFullCallback();
}());
