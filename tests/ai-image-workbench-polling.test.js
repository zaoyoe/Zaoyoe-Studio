const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../js/ai-image-workbench.js'), 'utf8');

function declaration(name) {
    const match = source.match(new RegExp(`(?:const|let) ${name} = [^;]+;`));
    assert.ok(match, `missing ${name}`);
    return match[0];
}

function functionSource(name) {
    const match = source.match(new RegExp(`    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n    \\}`));
    assert.ok(match, `missing ${name}`);
    return match[0];
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createHarness({ tasks = [], hidden = false, deferRequests = false } = {}) {
    const state = { tasks, open: true };
    const calls = [];
    const timers = new Map();
    const effects = { renders: 0, persists: 0, recoveries: 0, notices: 0, resets: 0, warnings: [], merges: [] };
    let timerId = 0;
    let summary = {};
    const context = {
        state,
        document: { visibilityState: hidden ? 'hidden' : 'visible' },
        imagePreview: null,
        lastBusyTaskCount: 0,
        global: {
            setTimeout(callback, delay) {
                const id = ++timerId;
                timers.set(id, { callback, delay });
                return id;
            },
            clearTimeout(id) {
                timers.delete(id);
            }
        },
        console: { warn: (...args) => effects.warnings.push(args) },
        getRuntimeSite: () => 'cn',
        requestAiImage(route, options) {
            const response = deferred();
            calls.push({ route, options, ...response });
            if (!deferRequests) {
                response.resolve(route === 'tasks' ? { tasks: state.tasks } : { apiCalls: 1 });
            }
            return response.promise;
        },
        getRemotePollBusyTasks: () => state.tasks.filter((task) => ['queued', 'processing', 'streaming'].includes(task.status)),
        getPendingOriginalTasks: () => state.tasks.filter((task) => task.pendingOriginal),
        getActivitySummarySignature: () => JSON.stringify(summary),
        updateActivitySummary: (payload) => { summary = payload; },
        mergeRemoteTasks(nextTasks) {
            const changed = JSON.stringify(state.tasks) !== JSON.stringify(nextTasks);
            state.tasks = nextTasks;
            effects.merges.push(nextTasks);
            return changed;
        },
        syncImagePreviewFromTasks: () => false,
        preloadImagePreviewOriginal: () => {},
        hasActiveChatStreamInCurrentThread: () => false,
        renderDock: () => {},
        renderHistoryPanelOnly: () => {},
        persistState: () => { effects.persists += 1; },
        render: () => { effects.renders += 1; },
        getActiveTask: () => state.tasks[0],
        scrollChatStageToBottom: () => {},
        getCompletedUnreadTasks: () => state.tasks.filter((task) => task.status === 'succeeded'),
        showDoneNotice: () => { effects.notices += 1; },
        recoverBusyTasksByClientId: async () => { effects.recoveries += 1; },
        resetUserScopedWorkbenchData() {
            effects.resets += 1;
            state.tasks = [];
            context.api.resetRemoteRecordsSync();
        }
    };
    const variables = [
        'MAX_LOCAL_TASKS', 'ORIGINAL_READY_POLL_LIMIT',
        'REMOTE_RECORDS_POLL_DEFAULT_MS', 'REMOTE_RECORDS_POLL_FAST_MS', 'REMOTE_RECORDS_POLL_WARM_MS',
        'REMOTE_RECORDS_FAST_POLL_ROUNDS', 'REMOTE_RECORDS_FAST_POLL_FAST_ROUNDS',
        'remoteRecordsLoaded', 'remoteRecordsRequest', 'remoteRecordsGeneration', 'remoteBusyRefreshPromise',
        'remotePollTimer', 'remotePollDueAt', 'remoteFastPollsRemaining', 'originalReadyPollCounts'
    ];
    const functions = [
        'isBusyTask', 'isImageGenerationMode', 'getBusyImageGenerationTasks', 'shouldPollRemoteRecords',
        'requestFastRemoteRecordsPoll', 'getRemoteRecordsPollDelayMs', 'shouldIncludeUsageForRemotePoll',
        'resetRemoteRecordsSync', 'loadRemoteRecords', 'fetchRemoteRecords',
        'clearRemoteRecordsPoll', 'handleRemoteRecordsVisibilityChange', 'refreshBusyTasksNow', 'scheduleRemoteRecordsPoll'
    ];
    vm.runInNewContext([
        ...variables.map(declaration),
        ...functions.map(functionSource),
        `globalThis.api = {
            ${functions.join(', ')},
            inspect: () => ({
                loaded: remoteRecordsLoaded,
                active: remoteRecordsRequest !== null,
                dueAt: remotePollDueAt,
                fastRounds: remoteFastPollsRemaining,
                originalPollCounts: Object.fromEntries(originalReadyPollCounts)
            }),
            setOriginalPollCount: (id, count) => originalReadyPollCounts.set(id, count)
        };`
    ].join('\n'), context);

    return {
        ...context.api,
        state,
        calls,
        timers,
        effects,
        context,
        get summary() { return summary; },
        async fireTimer() {
            assert.equal(timers.size, 1, 'expected one pending poll');
            const [id, timer] = timers.entries().next().value;
            timers.delete(id);
            await timer.callback();
        },
        async setHidden(value) {
            context.document.visibilityState = value ? 'hidden' : 'visible';
            context.api.handleRemoteRecordsVisibilityChange();
            await flush();
        }
    };
}

test('concurrent initial history loads share one tasks and usage read', async () => {
    const h = createHarness({ deferRequests: true });
    const readers = Array.from({ length: 10 }, () => h.loadRemoteRecords());
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks', 'usage']);
    h.calls[0].resolve({ tasks: [{ id: 'finished', status: 'succeeded' }] });
    h.calls[1].resolve({ apiCalls: 4, downloads: 2 });
    await Promise.all(readers);
    assert.equal(h.calls.length, 2);
    assert.equal(h.effects.merges.length, 1);
    assert.equal(h.state.tasks[0].id, 'finished');
    assert.equal(h.summary.downloads, 2);
    assert.equal(h.inspect().active, false);
    await h.loadRemoteRecords();
    assert.equal(h.calls.length, 2, 'loaded history does not fetch again without force');
});

test('forced readers queue one fresh snapshot and retain the usage refresh after a mutation', async () => {
    const h = createHarness({ deferRequests: true });
    const first = h.loadRemoteRecords({ force: true, includeUsage: false });
    const readers = Array.from({ length: 8 }, (_, i) => h.loadRemoteRecords({ force: true, includeUsage: i === 4 }));
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks'], 'forced reads wait for the current snapshot');
    h.calls[0].resolve({ tasks: [{ id: 'before-mutation', status: 'succeeded' }] });
    await flush();
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks', 'tasks', 'usage']);
    h.calls[1].resolve({ tasks: [{ id: 'after-mutation', status: 'succeeded', chargedPoints: 5 }] });
    h.calls[2].resolve({ apiCalls: 8 });
    await Promise.all([first, ...readers]);
    assert.equal(h.effects.merges.length, 2);
    assert.equal(h.state.tasks[0].id, 'after-mutation');
    assert.equal(h.state.tasks[0].chargedPoints, 5);
    assert.equal(h.summary.apiCalls, 8);
    assert.equal(h.calls.length, 3);
});

test('a caller needing usage is not downgraded by an existing tasks-only request', async () => {
    const h = createHarness({ deferRequests: true });
    const first = h.loadRemoteRecords({ includeUsage: false });
    const fullRefresh = h.loadRemoteRecords();
    h.calls[0].resolve({ tasks: [] });
    await flush();
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks', 'tasks', 'usage']);
    h.calls[1].resolve({ tasks: [] });
    h.calls[2].resolve({ downloads: 3 });
    await Promise.all([first, fullRefresh]);
    assert.equal(h.summary.downloads, 3);
});

test('failed requests release the shared load and a forced retry can recover', async () => {
    const h = createHarness({ deferRequests: true });
    const first = h.loadRemoteRecords({ includeUsage: false });
    h.calls[0].reject(new Error('temporary network failure'));
    await first;
    assert.equal(h.inspect().active, false);
    assert.equal(h.effects.warnings.length, 1);
    const retry = h.loadRemoteRecords({ force: true, includeUsage: false });
    h.calls[1].resolve({ tasks: [{ id: 'recovered', status: 'succeeded' }] });
    await retry;
    assert.equal(h.state.tasks[0].id, 'recovered');
});

test('usage failures preserve task results and completion rendering', async () => {
    const h = createHarness({ tasks: [{ id: 'task', status: 'processing', mode: 'text' }], deferRequests: true });
    const request = h.loadRemoteRecords();
    h.calls[0].resolve({ tasks: [{ id: 'task', status: 'succeeded', images: [{ url: 'preview' }] }] });
    h.calls[1].reject(new Error('usage temporarily unavailable'));
    await request;
    assert.equal(h.state.tasks[0].images[0].url, 'preview');
    assert.ok(h.effects.renders > 0);
    assert.equal(h.effects.resets, 0);
});

test('signing out invalidates in-flight task and usage responses', async () => {
    const h = createHarness({ deferRequests: true });
    const request = h.loadRemoteRecords();
    h.resetRemoteRecordsSync();
    h.calls[0].resolve({ tasks: [{ id: 'previous-user-private-task', status: 'succeeded' }] });
    h.calls[1].resolve({ apiCalls: 99 });
    await request;
    assert.deepEqual(h.state.tasks, []);
    assert.deepEqual(h.summary, {});
    assert.equal(h.effects.merges.length, 0);
    assert.equal(h.inspect().loaded, false);
});

test('an obsolete user request cannot clear or reset the new user request', async () => {
    const h = createHarness({ deferRequests: true });
    const oldRequest = h.loadRemoteRecords({ includeUsage: false });
    h.resetRemoteRecordsSync();
    const newRequest = h.loadRemoteRecords({ includeUsage: false });
    h.calls[0].reject(new Error('unauthorized'));
    await oldRequest;
    assert.equal(h.inspect().active, true);
    assert.equal(h.effects.resets, 0);
    h.calls[1].resolve({ tasks: [{ id: 'new-user-task', status: 'succeeded' }] });
    await newRequest;
    assert.equal(h.state.tasks[0].id, 'new-user-task');
    assert.equal(h.inspect().active, false);
});

test('authentication failure cancels queued refreshes and clears user-scoped records', async () => {
    const h = createHarness({ deferRequests: true });
    const request = h.loadRemoteRecords({ includeUsage: false });
    const queued = h.loadRemoteRecords({ force: true });
    h.calls[0].reject(new Error('unauthorized'));
    await Promise.all([request, queued]);
    assert.equal(h.calls.length, 1);
    assert.equal(h.effects.resets, 1);
    assert.equal(h.inspect().loaded, false);
});

test('hidden pages schedule no poll and consume no original-image retry budget', () => {
    const h = createHarness({ hidden: true, tasks: [{ id: 'original', status: 'succeeded', pendingOriginal: true }] });
    h.scheduleRemoteRecordsPoll();
    h.refreshBusyTasksNow();
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(Object.keys(h.inspect().originalPollCounts), []);
    assert.equal(h.inspect().dueAt, 0);
});

test('hiding a page cancels its pending poll without spending original-image retries', async () => {
    const h = createHarness({ tasks: [{ id: 'original', status: 'succeeded', pendingOriginal: true }] });
    h.scheduleRemoteRecordsPoll();
    assert.equal(h.timers.size, 1);
    assert.deepEqual(Object.keys(h.inspect().originalPollCounts), []);
    await h.setHidden(true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.inspect().dueAt, 0);
    assert.deepEqual(Object.keys(h.inspect().originalPollCounts), []);
    assert.equal(h.calls.length, 0);
});

test('a timer that races with page hiding performs no requests or recovery', async () => {
    const h = createHarness({ tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    h.scheduleRemoteRecordsPoll();
    h.context.document.visibilityState = 'hidden';
    await h.fireTimer();
    assert.equal(h.calls.length, 0);
    assert.equal(h.effects.recoveries, 0);
    assert.equal(h.timers.size, 0);
});

test('visibility and focus share one immediate foreground refresh', async () => {
    const h = createHarness({ hidden: true, deferRequests: true, tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    await h.setHidden(false);
    const focus = h.refreshBusyTasksNow();
    const repeatedFocus = h.refreshBusyTasksNow();
    assert.equal(focus, repeatedFocus);
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks', 'usage']);
    h.calls[0].resolve({ tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    h.calls[1].resolve({ apiCalls: 2 });
    await Promise.all([focus, repeatedFocus]);
    assert.equal(h.calls.length, 2);
    assert.equal(h.effects.recoveries, 1);
    assert.equal(h.timers.size, 1);
});

test('hiding during an in-flight foreground refresh stops follow-up recovery and polling', async () => {
    const h = createHarness({ deferRequests: true, tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    const refresh = h.refreshBusyTasksNow();
    await h.setHidden(true);
    h.calls[0].resolve({ tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    h.calls[1].resolve({ apiCalls: 2 });
    await refresh;
    assert.equal(h.effects.recoveries, 0);
    assert.equal(h.timers.size, 0);
});

test('a busy page keeps one timer and performs client-id recovery on its next poll', async () => {
    const h = createHarness({ tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    h.scheduleRemoteRecordsPoll();
    h.scheduleRemoteRecordsPoll();
    assert.equal(h.timers.size, 1);
    await h.fireTimer();
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks', 'usage']);
    assert.equal(h.effects.recoveries, 1);
    assert.equal(h.timers.size, 1);
});

test('an in-flight client-id recovery shares focus refreshes and defers the next timer', async () => {
    const h = createHarness({ tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    const recovery = deferred();
    h.context.recoverBusyTasksByClientId = async () => {
        h.effects.recoveries += 1;
        await recovery.promise;
    };
    h.scheduleRemoteRecordsPoll();
    const poll = h.fireTimer();
    await flush();
    assert.equal(h.effects.recoveries, 1);
    assert.equal(h.timers.size, 0, 'recovery must finish before another poll is scheduled');
    const focus = h.refreshBusyTasksNow();
    const repeatedFocus = h.refreshBusyTasksNow();
    assert.equal(focus, repeatedFocus);
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks', 'usage']);
    recovery.resolve();
    await Promise.all([poll, focus, repeatedFocus]);
    assert.equal(h.effects.recoveries, 1);
    assert.equal(h.timers.size, 1);
});

test('task completion performs a full usage refresh and then stops polling', async () => {
    const h = createHarness({ deferRequests: true, tasks: [{ id: 'task', status: 'processing', mode: 'text' }] });
    h.requestFastRemoteRecordsPoll();
    h.scheduleRemoteRecordsPoll();
    const poll = h.fireTimer();
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks'], 'fast poll initially skips usage');
    h.calls[0].resolve({ tasks: [{ id: 'task', status: 'succeeded', chargedPoints: 4.25 }] });
    await flush();
    assert.deepEqual(h.calls.map((call) => call.route), ['tasks', 'tasks', 'usage']);
    h.calls[1].resolve({ tasks: [{ id: 'task', status: 'succeeded', chargedPoints: 4.25 }] });
    h.calls[2].resolve({ apiCalls: 3, apiTokens: 700 });
    await poll;
    assert.equal(h.state.tasks[0].chargedPoints, 4.25);
    assert.equal(h.summary.apiTokens, 700);
    assert.ok(h.effects.renders > 0);
    assert.equal(h.timers.size, 0);
});

test('original-image polling resumes in the foreground and retains its retry limit', async () => {
    const h = createHarness({ hidden: true, tasks: [{ id: 'original', status: 'succeeded', pendingOriginal: true }] });
    await h.setHidden(false);
    assert.equal(h.timers.size, 1);
    assert.deepEqual(Object.keys(h.inspect().originalPollCounts), []);
    await h.fireTimer();
    assert.equal(h.inspect().originalPollCounts.original, 1);
    assert.equal(h.timers.size, 1);
    h.clearRemoteRecordsPoll();
    h.setOriginalPollCount('original', 80);
    h.scheduleRemoteRecordsPoll();
    assert.equal(h.timers.size, 0);
});

test('an in-flight poll from the previous account cannot start recovery for the new account', async () => {
    const h = createHarness({ deferRequests: true, tasks: [{ id: 'old-task', status: 'processing', mode: 'text' }] });
    h.scheduleRemoteRecordsPoll();
    const oldPoll = h.fireTimer();
    h.resetRemoteRecordsSync();
    h.state.tasks = [{ id: 'new-task', status: 'processing', mode: 'text' }];
    h.calls[0].resolve({ tasks: [{ id: 'old-task', status: 'succeeded' }] });
    h.calls[1].resolve({ apiCalls: 10 });
    await oldPoll;
    assert.equal(h.state.tasks[0].id, 'new-task');
    assert.equal(h.effects.recoveries, 0);
    assert.equal(h.timers.size, 0);
});
