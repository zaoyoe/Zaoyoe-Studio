/**
 * i18n.js - Internationalization Module
 * Handles language switching and text translation across all pages
 */

(function () {
    'use strict';

    const I18N_STORAGE_KEY = 'zaoyoe_language';
    const DEFAULT_LANG = 'zh';
    const SUPPORTED_LANGS = ['zh', 'en'];
    const I18N_ASSET_VERSION_FALLBACK = '20260512_NAV_AUTH_I18N_CACHE_1';
    const I18N_ASSET_VERSION = (() => {
        try {
            const scriptUrl = new URL(document.currentScript?.src || '', window.location.href);
            return scriptUrl.searchParams.get('v') || I18N_ASSET_VERSION_FALLBACK;
        } catch (error) {
            return I18N_ASSET_VERSION_FALLBACK;
        }
    })();
    const LEGACY_TRANSLATION_FIXUPS = Object.freeze({
        zh: Object.freeze({
            'nav.verify': Object.freeze({ value: 'Gemini Pro', legacy: ['验证'] }),
            'nav.gongyi': Object.freeze({ value: 'API中转', legacy: ['公益站', '公益站点'] }),
            'home.entries.verify': Object.freeze({ value: 'Gemini Pro', legacy: ['验证'] }),
            'home.entries.gongyi': Object.freeze({ value: 'API中转', legacy: ['公益站', '公益站点', 'API 中转'] })
        }),
        en: Object.freeze({
            'nav.verify': Object.freeze({ value: 'Gemini Pro', legacy: ['Verify'] }),
            'nav.gongyi': Object.freeze({ value: 'API Relay', legacy: ['Community Access', 'Gongyi'] }),
            'home.entries.verify': Object.freeze({ value: 'Gemini Pro', legacy: ['Verify'] }),
            'home.entries.gongyi': Object.freeze({ value: 'API Relay', legacy: ['Community Access', 'Gongyi'] })
        })
    });

    let translations = {};
    let currentLang = DEFAULT_LANG;
    let readyResolver = null;
    const readyPromise = new Promise(resolve => { readyResolver = resolve; });

    /**
     * Initialize i18n system
     */
    async function init() {
        // Load saved language preference
        const savedLang = localStorage.getItem(I18N_STORAGE_KEY);
        if (savedLang && SUPPORTED_LANGS.includes(savedLang)) {
            currentLang = savedLang;
        }

        // Preload translations
        await loadTranslations(currentLang);

        // Apply translations to page
        applyTranslations();

        // Set HTML lang attribute
        document.documentElement.lang = currentLang;

        console.log(`🌐 i18n initialized: ${currentLang}`);

        // Signal that i18n is ready
        if (readyResolver) readyResolver();
    }

    /**
     * Load translation JSON for a language
     */
    async function loadTranslations(lang) {
        if (translations[lang]) return translations[lang];

        try {
            const response = await fetch(`/lang/${lang}.json?v=${encodeURIComponent(I18N_ASSET_VERSION)}`, {
                cache: 'no-cache'
            });
            if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
            translations[lang] = normalizeLoadedTranslations(lang, await response.json());
            return translations[lang];
        } catch (err) {
            console.error(`Failed to load translations for ${lang}:`, err);
            return {};
        }
    }

    function getNestedValue(source, key) {
        return key.split('.').reduce((value, part) => {
            if (!value || typeof value !== 'object') return undefined;
            return value[part];
        }, source);
    }

    function setNestedValue(source, key, value) {
        const parts = key.split('.');
        let target = source;
        for (let index = 0; index < parts.length - 1; index += 1) {
            const part = parts[index];
            if (!target[part] || typeof target[part] !== 'object') {
                target[part] = {};
            }
            target = target[part];
        }
        target[parts[parts.length - 1]] = value;
    }

    function normalizeLoadedTranslations(lang, payload) {
        const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        const fixups = LEGACY_TRANSLATION_FIXUPS[lang] || {};

        Object.entries(fixups).forEach(([key, config]) => {
            const currentValue = getNestedValue(data, key);
            const currentText = String(currentValue || '').trim();
            if (!currentText || config.legacy.includes(currentText)) {
                setNestedValue(data, key, config.value);
            }
        });

        return data;
    }

    /**
     * Get translation by key (dot notation)
     * Example: t('shop.redeem') returns '兑换' or 'Redeem'
     * Returns null if translation not found and no fallback given,
     * so `i18n.t('key') || '默认值'` pattern works during loading.
     */
    function t(key, fallback) {
        const keys = key.split('.');
        let value = translations[currentLang];

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return fallback || null;
            }
        }

        return value || fallback || null;
    }

    /**
     * Apply translations to all elements with data-i18n attribute
     */
    function applyTranslations() {
        const elements = document.querySelectorAll('[data-i18n]');

        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = t(key);
            if (translation === null) return; // Translation not loaded, keep HTML default

            // Check for special attributes
            const attr = el.getAttribute('data-i18n-attr');
            if (attr) {
                el.setAttribute(attr, translation);
            } else {
                el.textContent = translation;
            }
        });

        // Handle placeholders
        const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
        placeholders.forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const translation = t(key);
            if (translation !== null) el.placeholder = translation;
        });

        // Handle titles
        const titles = document.querySelectorAll('[data-i18n-title]');
        titles.forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const translation = t(key);
            if (translation !== null) el.title = translation;
        });
    }

    /**
     * Switch language
     */
    async function switchLanguage(lang) {
        if (!SUPPORTED_LANGS.includes(lang)) {
            console.warn(`Unsupported language: ${lang}`);
            return;
        }

        if (lang === currentLang) return;

        currentLang = lang;
        localStorage.setItem(I18N_STORAGE_KEY, lang);

        // Load translations if not cached
        await loadTranslations(lang);

        // Apply translations
        applyTranslations();

        // Update HTML lang
        document.documentElement.lang = lang;

        // Update language toggle button active state
        const langZh = document.getElementById('langZh');
        const langEn = document.getElementById('langEn');
        const langZhDropdown = document.getElementById('langZhDropdown');
        const langEnDropdown = document.getElementById('langEnDropdown');

        if (langZh && langEn) {
            if (lang === 'zh') {
                langZh.classList.add('active');
                langEn.classList.remove('active');
            } else {
                langZh.classList.remove('active');
                langEn.classList.add('active');
            }
        }

        // Update dropdown button state
        if (langZhDropdown && langEnDropdown) {
            if (lang === 'zh') {
                langZhDropdown.classList.add('active');
                langEnDropdown.classList.remove('active');
            } else {
                langZhDropdown.classList.remove('active');
                langEnDropdown.classList.add('active');
            }
        }

        // Dispatch event for custom handlers
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));

        console.log(`🌐 Language switched to: ${lang}`);
    }

    /**
     * Toggle between zh and en
     */
    function toggleLanguage() {
        const newLang = currentLang === 'zh' ? 'en' : 'zh';
        switchLanguage(newLang);
    }

    /**
     * Get current language
     */
    function getCurrentLanguage() {
        return currentLang;
    }

    /**
     * Check if current language is English
     */
    function isEnglish() {
        return currentLang === 'en';
    }

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose API globally
    window.i18n = {
        t,
        switchLanguage,
        toggleLanguage,
        getCurrentLanguage,
        isEnglish,
        applyTranslations,
        ready: () => readyPromise // Returns a promise that resolves when i18n is initialized
    };

})();
