const crypto = require('crypto');

const VERIFY_MONITOR_INTERNAL_HEADER_NAME = 'X-Verify-Monitor-Key';
const VERIFY_MONITOR_INTERNAL_ENV_NAMES = Object.freeze([
    'VERIFY_MONITOR_INTERNAL_KEY',
    'VERIFY_INTERNAL_ACCESS_KEY'
]);

function normalizeSecret(value = '') {
    return String(value || '').trim();
}

function getVerifyMonitorInternalKey(env = process.env) {
    for (const envName of VERIFY_MONITOR_INTERNAL_ENV_NAMES) {
        const value = normalizeSecret(env?.[envName]);
        if (value) {
            return value;
        }
    }

    return '';
}

function getVerifyMonitorInternalRequestKey(req) {
    const headers = req?.headers;
    if (!headers || typeof headers !== 'object') {
        return '';
    }

    for (const [key, value] of Object.entries(headers)) {
        if (String(key || '').trim().toLowerCase() === VERIFY_MONITOR_INTERNAL_HEADER_NAME.toLowerCase()) {
            return normalizeSecret(value);
        }
    }

    return '';
}

function constantTimeEqual(left, right) {
    const normalizedLeft = normalizeSecret(left);
    const normalizedRight = normalizeSecret(right);
    if (!normalizedLeft || !normalizedRight) {
        return false;
    }

    const leftBuffer = Buffer.from(normalizedLeft);
    const rightBuffer = Buffer.from(normalizedRight);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasVerifyMonitorInternalAccess(req, env = process.env) {
    const expectedKey = getVerifyMonitorInternalKey(env);
    if (!expectedKey) {
        return false;
    }

    const providedKey = getVerifyMonitorInternalRequestKey(req);
    return constantTimeEqual(providedKey, expectedKey);
}

function buildVerifyMonitorProxyHeaders(env = process.env) {
    const internalKey = getVerifyMonitorInternalKey(env);
    if (!internalKey) {
        return null;
    }

    return {
        Accept: 'application/json',
        [VERIFY_MONITOR_INTERNAL_HEADER_NAME]: internalKey
    };
}

module.exports = {
    VERIFY_MONITOR_INTERNAL_HEADER_NAME,
    buildVerifyMonitorProxyHeaders,
    getVerifyMonitorInternalKey,
    getVerifyMonitorInternalRequestKey,
    hasVerifyMonitorInternalAccess
};
