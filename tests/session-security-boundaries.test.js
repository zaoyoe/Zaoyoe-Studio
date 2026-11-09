'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    detectSessionAnomaly,
    recordSessionReauthentication,
    extractClientFingerprint,
    clearSessionStoreForTest,
    _private: { activeSessions, MAX_TRACKED_SESSIONS, SESSION_TTL_MS }
} = require('../api/_lib/session-security');

const req = {
    headers: { 'user-agent': 'Mozilla/5.0', 'cf-ipcountry': 'US' },
    socket: { remoteAddress: '198.51.100.1' }
};
const options = { env: {}, now: 1_000 };
const fingerprint = extractClientFingerprint(req, options);

function fillStore(now = options.now) {
    for (let i = 0; i < MAX_TRACKED_SESSIONS; i += 1) {
        activeSessions.set(`user-${i}`, { ...fingerprint, firstSeenAt: now, lastSeenAt: now });
    }
}

test.afterEach(clearSessionStoreForTest);

test('session TTL expiry discards a stale baseline at the exact deadline', () => {
    assert.equal(detectSessionAnomaly(req, { id: 'user' }, { ...options, now: 0 }).reason, 'baseline_created');
    const changedReq = { ...req, headers: { ...req.headers, 'user-agent': 'curl/8.0' } };
    const result = detectSessionAnomaly(changedReq, { id: 'user' }, { ...options, now: SESSION_TTL_MS });
    assert.equal(result.anomalyDetected, false);
    assert.equal(result.reason, 'baseline_created');
    assert.equal(activeSessions.get('user').firstSeenAt, SESSION_TTL_MS);
});

test('normal activity extends TTL and preserves a zero-valued firstSeenAt', () => {
    detectSessionAnomaly(req, { id: 'user' }, { ...options, now: 0 });
    detectSessionAnomaly(req, { id: 'user' }, { ...options, now: SESSION_TTL_MS - 1 });
    assert.equal(activeSessions.get('user').firstSeenAt, 0);
    const changedReq = { ...req, headers: { ...req.headers, 'user-agent': 'curl/8.0' } };
    assert.equal(detectSessionAnomaly(changedReq, { id: 'user' }, {
        ...options, now: SESSION_TTL_MS + 1
    }).anomalyDetected, true);
});

test('a full cache retains an existing baseline so capacity does not bypass anomaly detection', () => {
    fillStore();
    const changedReq = { ...req, headers: { ...req.headers, 'user-agent': 'curl/8.0' } };
    const result = detectSessionAnomaly(changedReq, { id: 'user-0' }, { ...options, now: 2_000 });
    assert.equal(result.anomalyDetected, true);
    assert.equal(result.anomalyType, 'automated_tool_agent_switch');
    assert.equal(activeSessions.size, MAX_TRACKED_SESSIONS);
    assert.equal(activeSessions.get('user-0').isTool, false);
});

test('new sessions evict the least recently active baseline and never exceed the cache cap', () => {
    fillStore();
    detectSessionAnomaly(req, { id: 'user-0' }, { ...options, now: 2_000 });
    detectSessionAnomaly(req, { id: 'new-user' }, { ...options, now: 2_001 });
    assert.equal(activeSessions.size, MAX_TRACKED_SESSIONS);
    assert.equal(activeSessions.has('user-0'), true);
    assert.equal(activeSessions.has('new-user'), true);
    assert.equal(activeSessions.has('user-1'), false);
});

test('reauthentication obeys TTL and capacity while replacing only the verified baseline', () => {
    fillStore();
    recordSessionReauthentication('user-0', fingerprint, { now: 2_000 });
    assert.equal(activeSessions.size, MAX_TRACKED_SESSIONS);
    assert.equal(activeSessions.get('user-0').reauthenticatedAt, 2_000);
    recordSessionReauthentication('new-user', fingerprint, { now: 2_001 });
    assert.equal(activeSessions.size, MAX_TRACKED_SESSIONS);
    assert.equal(activeSessions.has('user-0'), true);
    assert.equal(activeSessions.has('user-1'), false);
    recordSessionReauthentication('after-ttl', fingerprint, { now: SESSION_TTL_MS + 2_002 });
    assert.deepEqual([...activeSessions.keys()], ['after-ttl']);
});
