/**
 * i18n.js - Internationalization Module
 * Handles language switching and text translation across all pages
 */

(function () {
    'use strict';

    const I18N_STORAGE_KEY = 'zaoyoe_language';
    const DEFAULT_LANG = 'zh';
    const SUPPORTED_LANGS = ['zh', 'en'];

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
            const response = await fetch(`/lang/${lang}.json?v=${Date.now()}`);
            if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
            translations[lang] = await response.json();
            return translations[lang];
        } catch (err) {
            console.error(`Failed to load translations for ${lang}:`, err);
            return {};
        }
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
