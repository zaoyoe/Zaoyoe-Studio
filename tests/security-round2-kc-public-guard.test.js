'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPublicRequestGuard, securityHeaders } = require('../services/kc-pay-gpt/public-request-security');
function request(guard, { ip = '1.2.3.4', cdk = '', path = '/api/cdk/query', method = 'POST', headers = {} } = {}) {
    const res = new EventEmitter();
    Object.assign(res, { headers: {}, code: 200, passed: false, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(v) { this.body = v; this.end(); return this; }, end() {} });
    guard({ method, path, ip, body: { cdk }, headers }, res, () => { res.passed = true; });
    return res;
}
test('KC shares the IP budget across expensive public endpoints and XFF variants', () => {
    const guard = createPublicRequestGuard({ perIp: 2 });
    request(guard, { path: '/api/verify-cdk' }).end();
    request(guard, { path: '/api/public/probe-account', headers: { 'x-forwarded-for': '8.8.8.8' } }).end();
    const denied = request(guard, { path: '/api/run-process', headers: { 'x-forwarded-for': '9.9.9.9' } });
    assert.equal(denied.code, 429);
    assert.equal(denied.headers['Cache-Control'], 'no-store');
    assert.equal(denied.headers['Retry-After'], '60');
});
test('KC case and trailing-slash routes cannot bypass the budget', () => {
    const guard = createPublicRequestGuard({ perIp: 1 });
    request(guard).end();
    for (const path of ['/API/CDK/QUERY', '/api/cdk/query/', '/API/CDK/QUERY///']) assert.equal(request(guard, { path }).code, 429);
});
test('KC per-CDK budget survives different IPs and case variants', () => {
    const guard = createPublicRequestGuard({ perCdk: 1 });
    request(guard, { cdk: 'AbC-123' }).end();
    assert.equal(request(guard, { ip: '2.3.4.5', cdk: ' abc-123 ' }).code, 429);
});
test('KC global budget bounds rotating IPs and codes', () => {
    const guard = createPublicRequestGuard({ globalLimit: 2 });
    request(guard, { ip: '1', cdk: '1' }).end();
    request(guard, { ip: '2', cdk: '2' }).end();
    assert.equal(request(guard, { ip: '3', cdk: '3' }).code, 429);
});
test('KC global and per-IP inflight budgets release exactly once on completion', () => {
    const guard = createPublicRequestGuard({ maxConcurrent: 2, perIpConcurrent: 1 });
    const a = request(guard);
    assert.equal(request(guard).code, 429);
    const b = request(guard, { ip: '2' });
    assert.equal(b.passed, true);
    assert.equal(request(guard, { ip: '3' }).code, 429);
    a.emit('finish'); a.end(); a.emit('close');
    const c = request(guard, { ip: '3' });
    assert.equal(c.passed, true);
    assert.equal(request(guard, { ip: '4' }).code, 429, 'duplicate release must not create capacity');
});
test('KC early client disconnect keeps upstream concurrency occupied until handler ends', () => {
    const guard = createPublicRequestGuard({ maxConcurrent: 1 });
    const active = request(guard);
    active.emit('close');
    assert.equal(request(guard, { ip: '2' }).code, 429);
    active.end();
    assert.equal(request(guard, { ip: '2' }).passed, true);
});
test('KC expired budgets recover and Map exhaustion fails closed', () => {
    let time = 0;
    const guard = createPublicRequestGuard({ now: () => time, maxEntries: 3, perIp: 1, windowMs: 1000 });
    request(guard, { ip: '1', cdk: '1' }).end();
    assert.equal(request(guard, { ip: '2', cdk: '2' }).code, 429);
    time = 1001;
    assert.equal(request(guard, { ip: '2', cdk: '2' }).passed, true);
});
test('KC unrelated routes bypass this public guard', () => {
    const guard = createPublicRequestGuard({ perIp: 0 });
    assert.equal(request(guard, { path: '/api/admin/config' }).passed, true);
    assert.equal(request(guard, { path: '/api/cdk/query', method: 'GET' }).passed, true);
});
test('KC IPv4-mapped address shares the same IP budget', () => {
    const guard = createPublicRequestGuard({ perIp: 1 });
    request(guard).end();
    assert.equal(request(guard, { ip: '::ffff:1.2.3.4' }).code, 429);
});
test('KC sends compatible page security headers', () => {
    const values = {};
    let next = false;
    securityHeaders({}, { setHeader(k, v) { values[k] = v; } }, () => { next = true; });
    assert.equal(next, true);
    assert.equal(values['X-Content-Type-Options'], 'nosniff');
    assert.equal(values['X-Frame-Options'], 'DENY');
    assert.match(values['Content-Security-Policy'], /object-src 'none'/);
    assert.match(values['Content-Security-Policy'], /frame-ancestors 'none'/);
});
