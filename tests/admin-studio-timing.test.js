const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const timingPath = path.join(REPO_ROOT, 'js/admin-studio-timing.js');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function loadTimingRuntime() {
    const source = fs.readFileSync(timingPath, 'utf8');
    const performanceMarks = [];
    const performanceMeasures = [];
    let now = 10;
    const window = {
        performance: {
            now() {
                now += 7;
                return now;
            },
            mark(name, options = {}) {
                performanceMarks.push({ name, detail: options.detail || null });
            },
            measure(name, startName, endName) {
                performanceMeasures.push({ name, startName, endName });
            }
        }
    };
    window.window = window;
    const context = {
        Date,
        window,
        globalThis: window
    };

    vm.runInNewContext(source, context);
    return { window, performanceMarks, performanceMeasures };
}

test('AdminStudioTiming records marks, once-only marks, and measures', () => {
    const { window, performanceMarks, performanceMeasures } = loadTimingRuntime();

    const first = window.AdminStudioTiming.mark('studio:boot:start', {
        readyState: 'interactive',
        longText: 'x'.repeat(240)
    });
    const once = window.AdminStudioTiming.markOnce('studio:boot:start', { ignored: true });
    const end = window.AdminStudioTiming.mark('studio:boot:ready', { isAdmin: true });
    const measure = window.AdminStudioTiming.measure(
        'studio:boot',
        'studio:boot:start',
        'studio:boot:ready',
        { isAdmin: true }
    );

    assert.equal(window.AdminStudioTiming.version, '20260430_ADMIN_STUDIO_TIMING_1');
    assert.equal(first.name, 'studio:boot:start');
    assert.equal(once.name, 'studio:boot:start');
    assert.equal(end.name, 'studio:boot:ready');
    assert.equal(measure.name, 'studio:boot');
    assert.equal(measure.duration, 7);
    assert.equal(first.detail.longText.length, 180);
    assert.deepEqual(
        performanceMarks.map((entry) => entry.name),
        ['admin-studio:studio:boot:start', 'admin-studio:studio:boot:ready']
    );
    assert.deepEqual(performanceMeasures, [
        {
            name: 'admin-studio:studio:boot',
            startName: 'admin-studio:studio:boot:start',
            endName: 'admin-studio:studio:boot:ready'
        }
    ]);

    const snapshot = window.AdminStudioTiming.snapshot();
    assert.equal(snapshot.marks.length, 2);
    assert.equal(snapshot.measures.length, 1);
    assert.equal(window.AdminStudioTiming.reset().marks.length, 0);
});

test('admin studio loads timing runtime before measured modules', () => {
    const html = readRepoFile('admin-studio.html');
    const timingIndex = html.indexOf('js/admin-studio-timing.js?v=20260430_ADMIN_STUDIO_TIMING_1');
    const commandCenterIndex = html.indexOf('js/admin-command-center.js');
    const analyticsLifecycleIndex = html.indexOf('js/admin-analytics-lifecycle.js');
    const paymentsIndex = html.indexOf('js/admin-payments.js');
    const studioIndex = html.indexOf('admin-studio.js?v=');

    assert.notEqual(timingIndex, -1, 'admin-studio.html should load AdminStudioTiming');
    for (const [label, index] of [
        ['command center', commandCenterIndex],
        ['analytics lifecycle', analyticsLifecycleIndex],
        ['payments', paymentsIndex],
        ['studio boot', studioIndex]
    ]) {
        assert.notEqual(index, -1, `admin-studio.html should load ${label}`);
        assert.equal(timingIndex < index, true, `AdminStudioTiming should load before ${label}`);
    }
});
