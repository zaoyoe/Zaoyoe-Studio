const FALLBACK_FAIL_CLOSED_ALLOWLIST = '203.0.113.254/32';

function normalizeIpRuleList(value = '') {
    return String(value || '')
        .split(',')
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .join(',');
}

function isFailClosedAfdianAllowlist(value = '') {
    return normalizeIpRuleList(value) === FALLBACK_FAIL_CLOSED_ALLOWLIST;
}

function describeAfdianAllowlist(value = '') {
    const normalized = normalizeIpRuleList(value);
    if (!normalized) {
        return '(missing)';
    }

    if (isFailClosedAfdianAllowlist(normalized)) {
        return `${normalized} (fail-closed placeholder)`;
    }

    return normalized;
}

module.exports = {
    describeAfdianAllowlist,
    FALLBACK_FAIL_CLOSED_ALLOWLIST,
    isFailClosedAfdianAllowlist,
    normalizeIpRuleList
};
