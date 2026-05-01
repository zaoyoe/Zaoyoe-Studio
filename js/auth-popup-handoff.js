(() => {
    try {
        const hash = window.location.hash || '';
        if (!hash) return;

        const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
        const state = hashParams.get('state') || '';
        const isGooglePopupState = state.startsWith('zaoyoe_google_popup:');
        const isGoogleRedirectState = state.startsWith('zaoyoe_google_redirect:');
        const hasPopupResult = hashParams.has('id_token') || hashParams.has('access_token') || hashParams.has('error');
        if ((!isGooglePopupState && !isGoogleRedirectState) || !hasPopupResult) return;

        document.documentElement.classList.add('auth-popup-handoff');
        const callbackUrl = new URL('/auth-callback.html', window.location.origin);
        callbackUrl.hash = hash;
        window.location.replace(callbackUrl.toString());
    } catch (error) {
        console.warn('Google popup callback handoff failed:', error);
    }
})();
