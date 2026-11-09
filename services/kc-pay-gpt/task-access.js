"use strict";

const crypto = require('crypto');
const { resolveSessionEncryptionKey } = require('./session-security');
const TASK_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const validJobKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function signature(jobKey, expiresAt) {
    // Separate purpose/key space from Session encryption and administrator authentication.
    const key = crypto.createHmac('sha256', resolveSessionEncryptionKey())
        .update('kc-public-task-access/key/v1').digest();
    return crypto.createHmac('sha256', key).update(`v1\n${jobKey}\n${expiresAt}`).digest('base64url');
}

function issueTaskAccessToken(jobKey, now = Date.now()) {
    if (!validJobKey(jobKey)) throw new Error('Invalid task identifier');
    const expiresAt = now + TASK_ACCESS_TTL_MS;
    return `v1.${expiresAt}.${signature(jobKey, expiresAt)}`;
}

function verifyTaskAccessToken(jobKey, token, now = Date.now()) {
    if (!validJobKey(jobKey) || typeof token !== 'string' || token.length > 128) return false;
    const match = /^v1\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) return false;
    const expiresAt = Number(match[1]);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + TASK_ACCESS_TTL_MS) return false;
    try {
        const expected = Buffer.from(signature(jobKey, expiresAt));
        const actual = Buffer.from(match[2]);
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (_) { return false; }
}

module.exports = { issueTaskAccessToken, verifyTaskAccessToken, TASK_ACCESS_TTL_MS };
