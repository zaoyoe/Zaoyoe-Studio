import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serviceRoot = path.dirname(new URL('../server.js', import.meta.url).pathname);
const serverSource = fs.readFileSync(path.join(serviceRoot, 'server.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(serviceRoot, 'public/admin.html'), 'utf8');
const publicSource = fs.readFileSync(path.join(serviceRoot, 'public/index.html'), 'utf8');
const { classifyInterruptedTask } = require('../task-safety');

function snippet(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    if (first < 0 || last < 0) throw new Error(`Missing source boundary: ${start}`);
    return source.slice(first, last);
}

afterEach(() => vi.useRealTimers());

describe('startup task recovery', () => {
    it('includes a recently interrupted task instead of waiting fifteen minutes', async () => {
        const task = { job_key: 'recent', status: 'running', updated_at: new Date(), last_heartbeat_at: new Date() };
        const query = vi.fn(async () => [[task]]);
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(serviceRoot, 'mysql-store.js'), 'utf8'), {
            module, exports: module.exports, __dirname: serviceRoot, Buffer, console, process: { env: {} },
            require: key => key === 'mysql2/promise' ? { createPool: () => ({ query }) }
                : require(key.startsWith('.') ? path.join(serviceRoot, key) : key)
        });
        expect(await module.exports.listRunningTasksForRecovery()).toEqual([task]);
        expect(query.mock.calls[0][0]).toContain("WHERE status = 'running'");
        expect(query.mock.calls[0][0]).not.toMatch(/DATE_SUB|last_heartbeat_at\s*[<>]/);
    });

    it.each([
        ['not_started', 'failed', false], ['declined', 'failed', false],
        ['started', 'manual', true], ['unknown', 'manual', true], ['succeeded', 'manual', true]
    ])('recovers %s without submitting another payment', async (paymentState, status, retainCdk) => {
        const localTask = { job_key: 'recent', cdk_code: 'local-cdk', execution_mode: 'local_card_pool', payment_state: paymentState };
        const store = {
            listRunningTasksForRecovery: vi.fn(async () => [localTask, { job_key: 'external', execution_mode: 'third_party_api' }]),
            updateTaskLog: vi.fn(), markCdkUnused: vi.fn(), resetAllAssetLocks: vi.fn()
        };
        const code = snippet(serverSource, '        const staleTasks = await store.listRunningTasksForRecovery();', '    } catch (error) {\n        console.error(`❌ [任务恢复]');
        await vm.runInNewContext(`(async () => {${code}})()`, {
            store, classifyInterruptedTask, recoverInterruptedCheckoutDiagnostic: async () => false, console: { log() {} }
        });
        expect(store.listRunningTasksForRecovery).toHaveBeenCalledOnce();
        expect(store.updateTaskLog).toHaveBeenCalledExactlyOnceWith('recent', expect.objectContaining({ status, paymentState, recoveryRequired: retainCdk }));
        if (retainCdk) expect(store.markCdkUnused).not.toHaveBeenCalled();
        else expect(store.markCdkUnused).toHaveBeenCalledExactlyOnceWith('local-cdk');
    });
});

function runtimeLogHarness() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(serviceRoot, 'runtime-log.js'), 'utf8'), { module, require, Date });
    const runtimeLog = module.exports;
    let handler;
    vm.runInNewContext(snippet(serverSource, "app.get('/api/admin/runtime-logs'", "app.post('/api/admin/runtime-logs/clear'"), {
        runtimeLog, authenticateAdmin() {}, app: { get: (_route, ...handlers) => { handler = handlers.at(-1); } }
    });
    return { runtimeLog, get(query) {
        let value;
        handler({ query }, { json(data) { value = data; }, status() { return this; } });
        return value;
    } };
}

describe('runtime logs after a backend restart', () => {
    it('resets an old cursor even for an already open legacy page', () => {
        const { runtimeLog, get } = runtimeLogHarness();
        runtimeLog.push({ text: 'new service is ready' });
        const response = get({ after: '9000' });
        expect(response.reset).toBe(true);
        expect(response.nextAfter).toBe(1);
        expect(response.entries.map(entry => entry.text)).toEqual(['new service is ready']);
    });
    it('detects a new process even when its log numbers overlap the old process', () => {
        const old = runtimeLogHarness();
        old.runtimeLog.push({ text: 'old log' });
        const oldStream = old.get({ tail: '1' }).streamId;
        const current = runtimeLogHarness();
        current.runtimeLog.push({ text: 'startup' });
        current.runtimeLog.push({ text: 'ready' });
        const response = current.get({ after: '1', stream: oldStream });
        expect(response.reset).toBe(true);
        expect(response.streamId).not.toBe(oldStream);
        expect(response.entries.map(entry => entry.text)).toEqual(['startup', 'ready']);
    });
    it('continues from the current process without duplicating existing logs', () => {
        const { runtimeLog, get } = runtimeLogHarness();
        runtimeLog.push({ text: 'first' });
        const first = get({ tail: '1' });
        runtimeLog.push({ text: 'second' });
        const next = get({ after: String(first.nextAfter), stream: first.streamId });
        expect(next.reset).toBe(false);
        expect(next.entries.map(entry => entry.text)).toEqual(['second']);
        expect(get({ after: String(next.nextAfter), stream: first.streamId }).entries).toEqual([]);
    });
});

function adminLogHarness() {
    const pre = { textContent: '', parentElement: {} };
    const context = {
        document: { getElementById: id => id === 'runtime_log_pre' ? pre : null },
        runtimeLogText: '', runtimeLogAfter: 0, runtimeLogStreamId: '', runtimeLogPollTimer: null,
        runtimeLogPollInFlight: false, RUNTIME_LOG_TEXT_CAP: 10000,
        formatRuntimeLogLine: entry => entry.text, authFetch: vi.fn(), setAdminConnectionState: vi.fn(),
        AbortController, setTimeout, clearTimeout, clearInterval, setInterval
    };
    vm.createContext(context);
    vm.runInContext(snippet(adminSource, '        function appendRuntimeLogEntries(', '        function updateAdminDataRefreshButton('), context);
    return { context, pre };
}

describe('admin log polling recovery', () => {
    it('replaces the old stream and uses the new cursor', async () => {
        const { context, pre } = adminLogHarness();
        context.authFetch.mockResolvedValueOnce({ json: async () => ({ success: true, entries: [{ text: 'old' }], nextAfter: 9000, streamId: 'old' }) });
        await context.fetchRuntimeLogsTail();
        context.authFetch.mockResolvedValueOnce({ json: async () => ({ success: true, reset: true, entries: [{ text: 'new ready' }], nextAfter: 1, streamId: 'new' }) });
        await context.fetchRuntimeLogsIncremental();
        expect(context.authFetch.mock.calls[1][0]).toContain('after=9000&limit=1000&stream=old');
        expect(pre.textContent).toBe('new ready\n');
        expect(context.runtimeLogAfter).toBe(1);
        expect(context.runtimeLogStreamId).toBe('new');
    });
    it('does not pile up polls while an earlier request is pending', async () => {
        const { context } = adminLogHarness();
        let release;
        context.authFetch.mockReturnValue(new Promise(resolve => { release = resolve; }));
        const pending = context.fetchRuntimeLogsIncremental();
        await context.fetchRuntimeLogsIncremental();
        expect(context.authFetch).toHaveBeenCalledOnce();
        release({ json: async () => ({ success: true, entries: [], nextAfter: 0, streamId: 'current' }) });
        await pending;
        expect(context.runtimeLogPollInFlight).toBe(false);
    });
    it('marks the connection as lost and allows a later retry after a network failure', async () => {
        const { context } = adminLogHarness();
        context.authFetch.mockRejectedValueOnce(new Error('Failed to fetch'));
        await context.fetchRuntimeLogsIncremental();
        expect(context.setAdminConnectionState).toHaveBeenCalledWith(false);
        expect(context.runtimeLogPollInFlight).toBe(false);
    });
});

function socketHarness() {
    const connections = [];
    class FakeWebSocket {
        static OPEN = 1;
        static CONNECTING = 0;
        readyState = 0;
        send = vi.fn();
        constructor() { connections.push(this); }
        close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
    }
    const context = {
        WebSocket: FakeWebSocket, window: { location: { protocol: 'http:', host: 'localhost:3100' } },
        setTimeout, clearTimeout, setInterval, clearInterval, Date, console: { error() {} },
        showStatus: vi.fn(), statusMsg: { style: {} }, applyTaskState: vi.fn(),
        handleCaptchaInteractiveRequired() {}, handleCaptchaClickReceived() {}, handleCaptchaInteractiveStatus() {}
    };
    vm.createContext(context);
    vm.runInContext(snippet(publicSource, '        let socket = null;', '        function resetRedeemFlow('), context);
    vm.runInContext(snippet(publicSource, '        function initWebSocket(', "        startBtn.addEventListener('click'"), context);
    context.initWebSocket('original-task');
    const first = connections[0]; first.readyState = 1; first.onopen();
    return { context, connections, first };
}

describe('recharge task connection recovery', () => {
    it('warns about a disconnect and subscribes to the same task after reconnecting', () => {
        vi.useFakeTimers();
        const { context, first, connections } = socketHarness();
        first.close();
        expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining('请勿重复提交'), 'warning');
        vi.advanceTimersByTime(3000);
        const second = connections[1]; second.readyState = 1; second.onopen();
        expect(JSON.parse(second.send.mock.calls[0][0])).toEqual({ type: 'subscribe', jobKey: 'original-task' });
        second.onmessage({ data: JSON.stringify({ type: 'snapshot', jobKey: 'original-task', status: 'failed' }) });
        expect(context.statusMsg.style.display).toBe('none');
        expect(context.applyTaskState).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });
    it('detects a silent server despite continuing to send client heartbeats', () => {
        vi.useFakeTimers();
        const { first, context } = socketHarness();
        vi.advanceTimersByTime(45000);
        expect(first.close).toHaveBeenCalledOnce();
        expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining('连接已中断'), 'warning');
    });
    it('keeps the connection when server heartbeat replies arrive', () => {
        vi.useFakeTimers();
        const { first } = socketHarness();
        vi.advanceTimersByTime(30000);
        first.onmessage({ data: JSON.stringify({ type: 'pong' }) });
        vi.advanceTimersByTime(30000);
        expect(first.close).not.toHaveBeenCalled();
    });
    it('does not warn or reconnect when a completed task closes its socket', () => {
        vi.useFakeTimers();
        const { first, context, connections } = socketHarness();
        context.closeTaskSocket();
        vi.advanceTimersByTime(60000);
        expect(first.close).toHaveBeenCalledOnce();
        expect(context.showStatus).not.toHaveBeenCalled();
        expect(connections).toHaveLength(1);
    });
    it('ignores late close events from the previous connection', () => {
        vi.useFakeTimers();
        const { first, context, connections } = socketHarness();
        first.close();
        vi.advanceTimersByTime(3000);
        const second = connections[1]; second.readyState = 1; second.onopen();
        first.onclose();
        context.initWebSocket('original-task');
        expect(connections).toHaveLength(2);
        expect(second.send).toHaveBeenCalledTimes(2);
    });
});
