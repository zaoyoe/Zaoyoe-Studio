const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const analyticsSource = fs.readFileSync(path.resolve(__dirname, '../admin-analytics.js'), 'utf8');
const panelLoaderSource = fs.readFileSync(path.resolve(__dirname, '../js/admin-analytics-panel-loaders.js'), 'utf8');

function loadAnalyticsRuntime() {
    const context = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        window: {},
        document: {},
        globalThis: null,
        setTimeout,
        clearTimeout,
        URL,
        Math,
        Date
    };
    context.globalThis = context;
    vm.runInNewContext(analyticsSource, context);
    return context;
}

test('verify summary signal helper distinguishes empty summaries from real verify activity', () => {
    const runtime = loadAnalyticsRuntime();

    assert.equal(runtime.hasVerifyServiceSummarySignal({}), false);
    assert.equal(runtime.hasVerifyServiceSummarySignal({
        metrics: {
            requestCount: 3
        }
    }), true);
    assert.equal(runtime.hasVerifyServiceSummarySignal({
        recentItems: [{ title: 'verify-task-1' }]
    }), true);
});

test('verify event funnel compatibility fallback converts verify summary metrics into visible cards', () => {
    const runtime = loadAnalyticsRuntime();
    const view = runtime.buildVerifyEventFunnelFallbackViewData({
        metrics: {
            requestCount: 12,
            successCount: 9,
            activeCount: 2,
            failedCount: 1,
            successRate: 75
        }
    });

    assert.equal(view.compatibilityMode, true);
    assert.equal(Array.isArray(view.items), true);
    assert.equal(view.items.length, 3);
    assert.equal(view.items[0].title, '提交任务');
    assert.match(view.items[0].summary, /兼容口径|回退/);
    assert.equal(view.exportRows[2]['阶段'], '失败 / 阻塞');
});

test('analytics panel loaders retry geo distribution directly when the bundle segment is empty and downgrade verify event funnel explicitly', () => {
    assert.equal(
        panelLoaderSource.includes('allowDirectRetryOnEmpty: true'),
        true,
        'geo distribution loader should retry direct rpc calls when the visual bundle returns empty rows'
    );
    assert.equal(
        panelLoaderSource.includes('buildVerifyEventFunnelFallbackViewData'),
        true,
        'verify event funnel should downgrade to compatibility data instead of rendering an empty panel'
    );
    assert.equal(
        panelLoaderSource.includes('兼容口径：验证任务摘要'),
        true,
        'verify event funnel should surface an explicit compatibility label when real events are unavailable'
    );
});
