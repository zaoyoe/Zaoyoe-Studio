(function promptMediaTabsBootstrap(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.FatherKeyPromptMediaTabs = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptMediaTabsApi() {
    'use strict';

    const MEDIA_HEADER_PATTERN = /^[ \t]*\[(IMAGE|VIDEO|图片|图像|视频)\s*(?:·|•|-)\s*(\d{1,3})\][ \t]*$/gim;

    function normalizePromptMediaType(value = '') {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'image' || normalized === '图片' || normalized === '图像') return 'image';
        if (normalized === 'video' || normalized === '视频') return 'video';
        return '';
    }

    function parsePromptMediaSections(value = '') {
        const text = String(value || '').replace(/\r\n?/g, '\n').trim();
        if (!text) return [];
        const matches = Array.from(text.matchAll(MEDIA_HEADER_PATTERN));
        if (!matches.length) return [];
        const seen = new Set();
        return matches.flatMap((match, matchIndex) => {
            const type = normalizePromptMediaType(match[1]);
            const index = Number.parseInt(match[2], 10);
            const bodyStart = Number(match.index || 0) + match[0].length;
            const bodyEnd = matchIndex + 1 < matches.length ? Number(matches[matchIndex + 1].index || text.length) : text.length;
            const sectionText = text.slice(bodyStart, bodyEnd).trim();
            const key = `${type}:${index}:${sectionText}`;
            if (!type || !sectionText || !Number.isFinite(index) || index <= 0 || seen.has(key)) return [];
            seen.add(key);
            return [{ type, index, text: sectionText }];
        });
    }

    function formatPromptMediaSections(sections = []) {
        const normalizedSections = Array.isArray(sections) ? sections.filter((section) => section?.text) : [];
        if (normalizedSections.length === 1) return String(normalizedSections[0].text || '').trim();
        return normalizedSections.map((section) => {
            const label = section.type === 'image' ? 'IMAGE' : 'VIDEO';
            return `[${label} · ${section.index}]\n${String(section.text || '').trim()}`;
        }).join('\n\n');
    }

    function shouldUseFallbackPromptText(localizedText = '', fallbackText = '') {
        const localized = String(localizedText || '').trim();
        const fallback = String(fallbackText || '').trim();
        if (!fallback || !localized) return !localized && Boolean(fallback);

        const localizedSections = parsePromptMediaSections(localized);
        const fallbackSections = parsePromptMediaSections(fallback);
        if (fallbackSections.length && localizedSections.length < fallbackSections.length) return true;

        const fallbackLength = fallback.replace(/\s/g, '').length;
        const localizedLength = localized.replace(/\s/g, '').length;
        return fallbackLength >= 240 && localizedLength < Math.ceil(fallbackLength * 0.2);
    }

    function buildPromptMediaVariants(localizedText = '', fallbackText = '') {
        const useFallback = shouldUseFallbackPromptText(localizedText, fallbackText);
        const localizedSections = useFallback ? [] : parsePromptMediaSections(localizedText);
        const fallbackSections = parsePromptMediaSections(fallbackText);
        const variants = ['image', 'video'].flatMap((type) => {
            const localizedMatches = localizedSections.filter((section) => section.type === type);
            const fallbackMatches = fallbackSections.filter((section) => section.type === type);
            const sections = localizedMatches.length >= fallbackMatches.length && localizedMatches.length
                ? localizedMatches
                : fallbackMatches;
            if (!sections.length) return [];
            return [{
                type,
                sections,
                text: formatPromptMediaSections(sections)
            }];
        });
        return {
            fullText: String(useFallback ? fallbackText : (localizedText || fallbackText) || '').trim(),
            variants
        };
    }

    return {
        normalizePromptMediaType,
        parsePromptMediaSections,
        formatPromptMediaSections,
        buildPromptMediaVariants,
        shouldUseFallbackPromptText
    };
});
