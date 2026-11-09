/**
 * Zaoyoe Studio - Cloudflare Turnstile & Honeypot Client Security Helper
 * 
 * Features:
 * 1. Zero friction for genuine users (Cloudflare Managed / Invisible mode).
 * 2. Honeypot trap check (catches automated DOM scrapers and bots).
 * 3. Timing guard (detects instantaneous bot submissions under 600ms).
 * 4. Graceful degradation (if Turnstile key is unconfigured or blocked by adblock, does not lock out users).
 */

(function (global) {
    'use strict';

    const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    let scriptLoadingPromise = null;
    let defaultWidgetId = null;
    let latestToken = '';

    function getTurnstileSiteKey() {
        return (
            global.__ZAOYOE_TURNSTILE_CONFIG__?.siteKey
            || global.SiteConfig?.turnstileSiteKey
            || global._CF_TURNSTILE_SITE_KEY
            || ''
        );
    }

    function isTurnstileEnabled() {
        return Boolean(getTurnstileSiteKey());
    }

    function loadTurnstileScript() {
        if (!isTurnstileEnabled()) {
            return Promise.resolve(false);
        }

        if (global.turnstile && typeof global.turnstile.render === 'function') {
            return Promise.resolve(true);
        }

        if (scriptLoadingPromise) {
            return scriptLoadingPromise;
        }

        scriptLoadingPromise = new Promise((resolve) => {
            const existingScript = document.querySelector(`script[src*="challenges.cloudflare.com/turnstile"]`);
            if (existingScript) {
                const checkInterval = setInterval(() => {
                    if (global.turnstile && typeof global.turnstile.render === 'function') {
                        clearInterval(checkInterval);
                        resolve(true);
                    }
                }, 100);
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve(Boolean(global.turnstile));
                }, 8000);
                return;
            }

            const script = document.createElement('script');
            script.src = TURNSTILE_SCRIPT_SRC;
            script.async = true;
            script.defer = true;
            script.onload = () => {
                const poll = setInterval(() => {
                    if (global.turnstile && typeof global.turnstile.render === 'function') {
                        clearInterval(poll);
                        resolve(true);
                    }
                }, 50);
                setTimeout(() => {
                    clearInterval(poll);
                    resolve(Boolean(global.turnstile));
                }, 5000);
            };
            script.onerror = (err) => {
                console.warn('[Security] Failed to load Cloudflare Turnstile script, failing open:', err);
                resolve(false);
            };
            (document.head || document.documentElement).appendChild(script);
        });

        return scriptLoadingPromise;
    }

    function scheduleAutoDismiss(container, delayMs = 600) {
        if (!container) return;
        setTimeout(() => {
            container.classList.remove('is-visible');
            container.classList.add('is-dismissed');
            container.style.opacity = '0';
            container.style.maxHeight = '0px';
            container.style.margin = '0px';
            container.style.overflow = 'hidden';
            container.style.pointerEvents = 'none';
        }, delayMs);
    }

    function restoreContainerVisibility(container) {
        if (!container) return;
        container.classList.remove('is-dismissed');
    }

    async function mountTurnstile(containerElementOrId, options = {}) {
        const siteKey = getTurnstileSiteKey();
        if (!siteKey) {
            return null;
        }

        const loaded = await loadTurnstileScript();
        if (!loaded || !global.turnstile) {
            return null;
        }

        const container = typeof containerElementOrId === 'string'
            ? document.querySelector(containerElementOrId)
            : containerElementOrId;

        if (!container) {
            return null;
        }

        restoreContainerVisibility(container);

        try {
            const widgetId = global.turnstile.render(container, {
                sitekey: siteKey,
                theme: options.theme || 'auto',
                size: options.size || 'flexible',
                action: options.action || 'auth',
                callback: function (token) {
                    latestToken = token;
                    if (container.classList.contains('is-visible')) {
                        scheduleAutoDismiss(container, options.dismissDelayMs || 600);
                    } else {
                        container.classList.add('is-dismissed');
                    }
                    if (typeof options.callback === 'function') {
                        options.callback(token);
                    }
                },
                'error-callback': function (errorCode) {
                    console.warn('[Security] Turnstile challenge error:', errorCode);
                    if (typeof options.onError === 'function') {
                        options.onError(errorCode);
                    }
                },
                'expired-callback': function () {
                    latestToken = '';
                    restoreContainerVisibility(container);
                    if (typeof options.onExpired === 'function') {
                        options.onExpired();
                    }
                }
            });

            // If a visible interactive challenge was rendered (Managed mode), smoothly reveal
            setTimeout(() => {
                const iframe = container.querySelector('iframe');
                if (iframe && iframe.offsetHeight > 20) {
                    container.classList.add('is-visible');
                }
            }, 60);

            if (!defaultWidgetId) {
                defaultWidgetId = widgetId;
            }
            return widgetId;
        } catch (error) {
            console.warn('[Security] Failed to render Turnstile widget:', error);
            return null;
        }
    }

    function getTurnstileToken(widgetId = defaultWidgetId) {
        if (!isTurnstileEnabled()) {
            return '';
        }
        if (global.turnstile && widgetId !== null && widgetId !== undefined) {
            try {
                const response = global.turnstile.getResponse(widgetId);
                if (response) {
                    latestToken = response;
                    return response;
                }
            } catch (_) {
                // ignore
            }
        }
        return latestToken || '';
    }

    function resetTurnstile(widgetId = defaultWidgetId) {
        latestToken = '';
        if (global.turnstile && widgetId !== null && widgetId !== undefined) {
            try {
                global.turnstile.reset(widgetId);
            } catch (_) {
                // ignore
            }
        }
    }

    /**
     * Checks if any honeypot trap field in the target element has been filled
     * @param {HTMLElement|string} rootElementOrSelector 
     * @returns {boolean} true if honeypot trap was triggered by a bot
     */
    function isHoneypotTriggered(rootElementOrSelector) {
        const root = typeof rootElementOrSelector === 'string'
            ? document.querySelector(rootElementOrSelector)
            : (rootElementOrSelector || document);

        if (!root) return false;

        const traps = root.querySelectorAll('input.auth-security-hp, input[data-security-hp="true"]');
        for (const input of traps) {
            if (String(input.value || '').trim().length > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Records render time for a form to detect inhuman submission speeds (< 600ms)
     */
    const formRenderTimestamps = new WeakMap();

    function markFormRenderTime(formElement) {
        if (formElement && formElement instanceof HTMLElement) {
            formRenderTimestamps.set(formElement, Date.now());
        }
    }

    function isSubmissionTooFast(formElement, minDurationMs = 600) {
        if (!formElement || !(formElement instanceof HTMLElement)) {
            return false;
        }
        const renderedAt = formRenderTimestamps.get(formElement);
        if (renderedAt && (Date.now() - renderedAt < minDurationMs)) {
            return true;
        }
        return false;
    }

    global.ZaoyoeSecurity = {
        getTurnstileSiteKey,
        isTurnstileEnabled,
        loadTurnstileScript,
        mountTurnstile,
        getTurnstileToken,
        resetTurnstile,
        isHoneypotTriggered,
        markFormRenderTime,
        isSubmissionTooFast
    };
})(typeof window !== 'undefined' ? window : globalThis);
