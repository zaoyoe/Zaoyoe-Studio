'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services/kc-pay-gpt/server.js'), 'utf8');
const handlerStart = source.indexOf('async function handleActivationRequest(req, res) {');
const handlerEnd = source.indexOf("\napp.post('/api/run-process'", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handlerSource = source.slice(handlerStart, handlerEnd);
const slotSource = ['reserveForegroundSlot', 'releaseForegroundSlot'].map(name => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end + 2);
}).join('\n');
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function fixture({ storeOverrides = {}, spawn, beforeDispatch } = {}) {
    const activeForegroundJobs = new Set();
    const dispatched = [];
    const unlocked = [];
    const tasks = [];
    const updates = [];
    const retired = [];
    let preparationHookUsed = false;
    const context = {
        console: { log() {}, error() {} }, crypto, activeForegroundJobs,
        getClientIp: () => '', ensureStoreReady: async () => {},
        getRemainingCooldownMinutes: () => 0,
        resolveActivationInput: () => ({ platform: 'grok', planType: 'grok-pro', token: 'synthetic-token',
            storedSession: '{}', tokenPreview: 'synthetic' }),
        logTask(key) { if (key && beforeDispatch && !preparationHookUsed) { preparationHookUsed = true; beforeDispatch(key); } }, issueTaskAccessToken: key => `synthetic-access-${key}`,
        redactSensitiveText: text => String(text || ''),
        formatTaskErrorMessage: (_status, message) => message,
        fireTelegramNotification() {}, extractEmailFromSession: () => null,
        spawnActivationWorker(input) {
            if (spawn) return spawn(input);
            dispatched.push(input);
        },
        store: {
            getMaintenanceModeState: async () => ({ enabled: false }),
            getMaxConcurrentActivations: async () => 1,
            verifyCdkDetails: async cdk => ({ cdk_code: cdk, type: '自助', used_at: null }),
            getRunningTaskByCdk: async () => null,
            hasAvailableCard: async () => true,
            markCdkUsed: async () => true,
            markCdkUnused: async cdk => { unlocked.push(cdk); },
            createTaskLog: async () => { throw new Error('unscoped task creation forbidden'); },
            createActivationTask: async input => {
                const task = { jobKey: `synthetic-job-${tasks.length + 1}` };
                tasks.push({ task, input });
                return { ...task, created: true };
            },
            retireSafeActivationTask: async key => { retired.push(key); return { released: true }; },
            updateTaskLog: async (key, update) => { updates.push({ key, update }); },
            ...storeOverrides
        }
    };
    vm.runInNewContext(`${slotSource}\n${handlerSource}\nthis.handle = handleActivationRequest; this.release = releaseForegroundSlot;`, context);
    async function run(cdk = 'synthetic-code', body = {}) {
        const res = { code: 200, status(code) { this.code = code; return this; },
            json(value) { this.body = value; return this; } };
        await context.handle({ path: '/api/run-process', body: { session: 'synthetic-session', cdk, ...body } }, res);
        return res;
    }
    return { run, context, activeForegroundJobs, dispatched, unlocked, tasks, updates, retired };
}

test('KC real activation handler reserves capacity before the first CDK lookup can yield', async () => {
    const entered = deferred();
    const proceed = deferred();
    const app = fixture({ storeOverrides: { verifyCdkDetails: async cdk => {
        entered.resolve(); await proceed.promise;
        return { cdk_code: cdk, type: '自助', used_at: null };
    } } });
    const first = app.run('synthetic-A');
    await entered.promise;
    assert.equal(app.activeForegroundJobs.size, 1);
    assert.equal((await app.run('synthetic-B')).code, 429);
    assert.equal(app.tasks.length, 0);
    proceed.resolve();
    assert.equal((await first).body.success, true);
    assert.equal(app.dispatched.length, 1);
    assert.deepEqual([...app.activeForegroundJobs], ['synthetic-job-1']);
    assert.equal((await app.run('synthetic-C')).code, 429);
    app.context.release('synthetic-job-1');
    assert.equal((await app.run('synthetic-D')).body.success, true);
});

for (const [name, overrides, expected] of [
    ['invalid CDK', { verifyCdkDetails: async () => null }, 403],
    ['used CDK', { verifyCdkDetails: async () => ({ type: '自助', used_at: 'synthetic-date' }) }, 403],
    ['non-self-service CDK', { verifyCdkDetails: async () => ({ type: '人工', used_at: null }) }, 403],
    ['empty card pool', { hasAvailableCard: async () => false }, 503],
    ['failed CDK compare-and-set', { createActivationTask: async () => { throw Object.assign(new Error('CAS conflict'), { statusCode: 403 }); } }, 403],
    ['CDK lookup failure', { verifyCdkDetails: async () => { throw new Error('synthetic lookup failure'); } }, 500]
]) {
    test(`KC real activation handler releases admission after ${name}`, async () => {
        const app = fixture({ storeOverrides: overrides });
        assert.equal((await app.run()).code, expected);
        assert.equal(app.activeForegroundJobs.size, 0);
        assert.equal(app.dispatched.length, 0);
        assert.equal(app.tasks.length, 0);
        assert.deepEqual(app.unlocked, []);
    });
}
test('KC real activation handler resumes an existing task without reserving another worker slot', async () => {
    const app = fixture({ storeOverrides: { getRunningTaskByCdk: async () => ({ job_key: 'synthetic-running' }) } });
    const res = await app.run();
    assert.equal(res.body.jobKey, 'synthetic-running');
    assert.equal(res.body.taskAccessToken, 'synthetic-access-synthetic-running');
    assert.equal(app.activeForegroundJobs.size, 0);
    assert.equal(app.dispatched.length, 0);
});
test('KC atomic admission failure returns capacity without unscoped CDK compensation', async () => {
    const app = fixture({ storeOverrides: { createActivationTask: async () => { throw new Error('synthetic insert or commit failure'); } } });
    assert.equal((await app.run()).code, 500);
    assert.deepEqual(app.unlocked, []);
    assert.deepEqual(app.retired, []);
    assert.equal(app.activeForegroundJobs.size, 0);
    assert.equal(app.dispatched.length, 0);
});
test('KC synchronous dispatch failure retains the CDK and task capacity for recovery', async () => {
    const app = fixture({ spawn: () => { throw new Error('synthetic uncertain dispatch failure'); } });
    assert.equal((await app.run()).code, 500);
    assert.deepEqual(app.unlocked, []);
    assert.deepEqual(app.retired, []);
    assert.deepEqual([...app.activeForegroundJobs], ['synthetic-job-1']);
    assert.equal(app.updates.length, 0);
});
test('KC failure before dispatch retires only the created task through the atomic primitive', async () => {
    const app = fixture({ beforeDispatch: () => { throw new Error('synthetic preparation failure'); } });
    assert.equal((await app.run()).code, 500);
    assert.deepEqual(app.retired, ['synthetic-job-1']);
    assert.deepEqual(app.unlocked, []);
    assert.equal(app.dispatched.length, 0);
    assert.equal(app.activeForegroundJobs.size, 0);
});
for (const outcome of ['refused', 'throws']) {
    test(`KC never falls back to an unscoped CDK unlock when retirement ${outcome}`, async () => {
        const app = fixture({
            beforeDispatch: () => { throw new Error('synthetic preparation failure'); },
            storeOverrides: { retireSafeActivationTask: async () => {
                if (outcome === 'throws') throw new Error('synthetic uncertain retirement');
                return { released: false, reason: 'TASK_REQUIRES_REVIEW' };
            } }
        });
        assert.equal((await app.run()).code, 500);
        assert.deepEqual(app.unlocked, []);
        assert.equal(app.updates.length, 0);
        assert.equal(app.dispatched.length, 0);
        assert.equal(app.activeForegroundJobs.size, 0);
    });
}
test('KC admission resumes a task discovered under the transaction lock without redispatch', async () => {
    const app = fixture({ storeOverrides: { createActivationTask: async () => ({ created: false, jobKey: 'synthetic-concurrent' }) } });
    const res = await app.run();
    assert.equal(res.body.jobKey, 'synthetic-concurrent');
    assert.equal(res.body.taskAccessToken, 'synthetic-access-synthetic-concurrent');
    assert.equal(app.activeForegroundJobs.size, 0);
    assert.equal(app.dispatched.length, 0);
    assert.deepEqual(app.unlocked, []);
});
test('KC maintenance and missing credentials never claim CDKs or capacity', async () => {
    const app = fixture({ storeOverrides: { getMaintenanceModeState: async () => ({ enabled: true }) } });
    assert.equal((await app.run()).code, 503);
    assert.equal((await app.run('', { session: '' })).code, 400);
    assert.equal(app.activeForegroundJobs.size, 0);
    assert.equal(app.tasks.length, 0);
});

const publicHtml = fs.readFileSync(path.join(root, 'services/kc-pay-gpt/public/index.html'), 'utf8');
function pageFunction(name, endMarker) {
    const start = publicHtml.indexOf(`        function ${name}(`);
    const end = publicHtml.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    return publicHtml.slice(start, end);
}
function element() {
    const classes = new Set();
    return { style: {}, className: '', children: [], writes: [],
        classList: { add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
        set innerHTML(value) { this.writes.push(value); this.children = []; },
        appendChild(child) { this.children.push(child); } };
}
function pageFixture() {
    const statusMsg = element(); const capsuleToast = element();
    const timers = new Map(); let nextTimer = 0;
    const context = { statusMsg, capsuleToast, capsuleTimer: null, capsuleHideTimer: null,
        lockShellTopPosition() {}, morphCardHeight: callback => callback(),
        document: { createElement: () => element() },
        setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id) };
    vm.runInNewContext(`${pageFunction('showStatus', '\n        const capsuleToast')}
        ${pageFunction('showCapsule', '\n        updateFlowUI(1')}
        this.showStatus = showStatus; this.showCapsule = showCapsule;`, context);
    return { context, statusMsg, capsuleToast, timers };
}
test('KC real status renderer displays hostile server messages as text and preserves line breaks', () => {
    const { context, statusMsg } = pageFixture();
    const input = '<img src=x onerror="alert(1)">\nsecond line';
    context.showStatus(input, 'success');
    assert.equal(statusMsg.textContent, input);
    assert.deepEqual(statusMsg.writes, []);
    assert.equal(statusMsg.style.whiteSpace, 'pre-line');
    assert.equal(statusMsg.style.display, 'block');
    assert.equal(statusMsg.className, 'status-message status-success');
});
test('KC real capsule renderer only uses static SVG markup and appends the message as text', () => {
    const { context, capsuleToast } = pageFixture();
    const input = '<svg onload=alert(1)></svg><img onerror=alert(2)>';
    context.showCapsule(input, 'error');
    assert.equal(capsuleToast.children.length, 1);
    assert.equal(capsuleToast.children[0].textContent, input);
    assert.equal(capsuleToast.writes.length, 1);
    assert.match(capsuleToast.writes[0], /^<svg class="capsule-icon"/);
    assert.doesNotMatch(capsuleToast.writes[0], /onload|onerror|alert/);
    assert.equal(capsuleToast.classList.contains('shake'), true);
});
test('KC capsule replacement and manual dismiss retain their timer lifecycle', () => {
    const { context, capsuleToast, timers } = pageFixture();
    context.showCapsule('first', 'error');
    const priorTimer = [...timers.keys()][0];
    context.showCapsule('second', 'success');
    assert.equal(timers.has(priorTimer), false);
    assert.equal(capsuleToast.children[0].textContent, 'second');
    assert.equal(capsuleToast.classList.contains('shake'), false);
    capsuleToast.onclick();
    assert.equal(capsuleToast.classList.contains('is-hiding'), true);
    for (const callback of [...timers.values()]) callback();
    assert.equal(capsuleToast.style.display, 'none');
    assert.equal(capsuleToast.classList.contains('is-hiding'), false);
});
for (const name of fs.readdirSync(path.join(root, 'services/kc-pay-gpt/public')).filter(name => name.endsWith('.html'))) {
    test(`KC inline scripts compile after security changes: ${name}`, () => {
        const html = fs.readFileSync(path.join(root, 'services/kc-pay-gpt/public', name), 'utf8');
        let count = 0;
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (/\bsrc\s*=|\btype\s*=\s*["'](?:application\/ld\+json|application\/json|importmap)["']/i.test(match[1])) continue;
            if (!match[2].trim()) continue;
            new vm.Script(match[2], { filename: `${name}:inline-${++count}` });
        }
        assert.ok(count > 0);
    });
}
