'use strict';

/**
 * Universal Input Sanitizer & Anti-XSS Security Library
 * Protects against Stored XSS, Reflected XSS, and Dangerous Protocol Injection.
 */

const SCRIPT_STYLE_BLOCKS_PATTERN = /<\s*(?:script|style|iframe|object|embed|applet)[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|iframe|object|embed|applet)\s*>/gi;
const DANGEROUS_TAGS_PATTERN = /<\s*\/?\s*(?:script|iframe|object|embed|applet|meta|link|style|form|input|button|textarea|select|svg|math|base|frame|frameset)[^>]*>/gi;
const DANGEROUS_ATTRIBUTES_PATTERN = /\s+(?:on[a-z]+|autofocus|formaction|action|srcdoc|xlink:href)\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi;
const DANGEROUS_PROTOCOLS_PATTERN = /^(?:\s*javascript:|\s*vbscript:|\s*data:(?!image\/(?:png|jpe?g|gif|webp|svg\+xml)\b)[^,]*,\s*)/i;
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripControlCharacters(value = '') {
    return String(value || '').replace(CONTROL_CHARS_PATTERN, '');
}

function sanitizeUrlForDisplay(value = '') {
    const raw = stripControlCharacters(String(value || '').trim());
    if (!raw) return '';

    if (DANGEROUS_PROTOCOLS_PATTERN.test(raw)) {
        return '';
    }

    try {
        const parsed = new URL(raw, 'https://localhost');
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return '';
        }
        return raw;
    } catch {
        return '';
    }
}

function stripDangerousTags(value = '') {
    let clean = stripControlCharacters(String(value || ''));
    let previous;
    // Iterate until no more dangerous tags are discovered (guards against nested bypasses like <scr<script>ipt>)
    do {
        previous = clean;
        clean = clean.replace(SCRIPT_STYLE_BLOCKS_PATTERN, '');
        clean = clean.replace(DANGEROUS_TAGS_PATTERN, '');
        clean = clean.replace(DANGEROUS_ATTRIBUTES_PATTERN, '');
    } while (clean !== previous);

    return clean;
}

function sanitizeRichText(value = '', { maxLength = 2000, allowHtml = false } = {}) {
    const raw = stripControlCharacters(String(value || '')).trim();
    if (!raw) return '';

    const sliced = raw.slice(0, Math.max(1, maxLength));

    if (!allowHtml) {
        return escapeHtml(sliced);
    }

    return stripDangerousTags(sliced);
}

function sanitizeTicketDescription(description = '', { maxLength = 2000 } = {}) {
    const raw = stripControlCharacters(String(description || '')).trim();
    if (!raw) return '';

    // Defang dangerous script tags and event handlers before saving to database
    const defanged = stripDangerousTags(raw.slice(0, Math.max(1, maxLength)));
    return defanged;
}

module.exports = {
    escapeHtml,
    stripControlCharacters,
    stripDangerousTags,
    sanitizeUrlForDisplay,
    sanitizeRichText,
    sanitizeTicketDescription
};
