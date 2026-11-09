/** Reuse only resolved layout text; keep uncached defaults hidden until config arrives. */
(function () {
    'use strict';
    try {
        const forcedSite = new URLSearchParams(window.location.search).get('site');
        const site = forcedSite === 'cn' || forcedSite === 'intl'
            ? forcedSite
            : (/^(www\.)?zaoyoe\.xyz$/i.test(window.location.hostname) ? 'intl' : 'cn');
        const language = (window.__i18nBoot?.language || document.documentElement.lang) === 'en' ? 'en' : 'zh';
        const raw = sessionStorage.getItem('homepage_hero_text');
        if (!raw) return;
        const cached = JSON.parse(raw);
        if (cached?.schemaVersion !== '20260508_HOME_TEXT_BILINGUAL_RUNTIME_1'
            || cached.source !== 'homepage-config'
            || cached.site !== site
            || cached.language !== language
            || typeof cached.title !== 'string'
            || !cached.title.trim()
            || (language === 'en' && /[\u3400-\u9fff\uf900-\ufaff]/.test(cached.title))) return;
        const age = Date.now() - cached.timestamp;
        const updatedAt = Number.parseInt(localStorage.getItem(`homepage_config_last_updated_at_${site}`) || '0', 10) || 0;
        if (!Number.isFinite(age) || age < 0 || age >= 300000
            || (cached.configUpdatedAt || 0) < updatedAt || cached.timestamp < updatedAt) return;
        const section = document.getElementById('hero-section');
        for (const field of ['title', 'subtitle']) {
            const element = section?.querySelector(`.hero-${field}`);
            if (!element) continue;
            element.textContent = String(cached[field] || '');
            element.removeAttribute('data-home-hero-text-pending');
        }
    } catch (_) {
        // Malformed or unavailable storage must never release the static default text.
    }
}());
