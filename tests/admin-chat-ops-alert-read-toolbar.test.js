const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function loadBrowserClass(relativePath, className) {
    const context = {
        console,
        setTimeout,
        clearTimeout,
        window: {
            visualViewport: null,
            addEventListener() {},
            removeEventListener() {}
        },
        document: {},
        navigator: {},
        localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        sessionStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(`${readRepoFile(relativePath)}\nglobalThis.__RuntimeClass = ${className};`, context);
    return context.__RuntimeClass;
}

test('admin chat ops alert toolbar supports unread/read views and scoped mark-read controls', () => {
    const source = readRepoFile('js/admin-chat.js');

    const requiredMarkers = [
        "this.opsAlertReadCategoryFilter = 'all';",
        "this.opsAlertReadTimeFilter = 'visible';",
        'restoreOpsAlertReadReceipts() {',
        "this.opsAlertViewFilter === 'unread'",
        "this.opsAlertViewFilter === 'read'",
        "label: unreadCount > 0 ? `未读 ${this.formatCompactCount(unreadCount)}` : '未读'",
        "{ key: 'read', label: '已读' }",
        "fieldClassName: 'admin-alert-toolbar-filter--scope'",
        "ariaLabel: '选择站内代办筛选范围'",
        "className = 'admin-alert-toolbar-dropdown-trigger';",
        "readWrap.className = 'admin-alert-toolbar-read';",
        "ariaLabel: '选择已读分类'",
        "ariaLabel: '选择已读时间范围'",
        'markFilteredOpsAlertsRead() {',
        "readBadge.textContent = '已读';"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
    }
});

test('admin chat derives stable summary case targets so legacy summary cards remain closable', () => {
    const source = readRepoFile('js/admin-chat.js');

    const requiredMarkers = [
        'buildOpsAlertSummaryTargetId(payload = {}, options = {}) {',
        "return `ops_summary:${summaryAlertType}`;",
        'buildOpsAlertLegacySummaryTargetId(payload = {}, options = {}) {',
        "return `ops_summary:${summaryAlertType}:${summaryDedupeKey}`;",
        'buildOpsAlertSummaryFallbackCaseMap(alerts = [], caseMap = new Map()) {',
        'parseOpsAlertTimestampMs(value = \'\') {',
        'getOpsAlertActivityTimestampMs(alert = {}) {',
        'this.parseOpsAlertTimestampMs(alert.updated_at || alert.updatedAt),',
        'this.parseOpsAlertTimestampMs(alert.delivered_at || alert.deliveredAt),',
        'const alertActivityAt = this.getOpsAlertActivityTimestampMs(alert);',
        'if (this.isOpsAlertClosed(alert)) {',
        "window.showToast?.('这条代办已经关闭，无需重复关闭', 'info');",
        'payloadTargetId.startsWith(`${summaryTargetId}:`)',
        '|| summaryTargetId',
        "const targetId = this.getOpsAlertTargetId(payload, { alertType, dedupeKey: row.dedupe_key || '' });",
        "dedupeKey: String(row.dedupe_key || '').trim(),",
        ".select('id, dedupe_key, alert_type, severity, title, content, payload, status, last_error, created_at, updated_at, delivered_at')"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
    }

    const timestampMethodDefinitions = source.match(/^\s+getOpsAlertTimestampMs\(alert = \{\}\) \{/gm) || [];
    assert.equal(timestampMethodDefinitions.length, 1, 'js/admin-chat.js should keep one read-receipt timestamp helper definition');
});

test('public chat widget keeps summary ops alerts visible after stale resolved cases', () => {
    const source = readRepoFile('js/components/ChatWidget.js');

    const requiredMarkers = [
        'buildOpsAlertSummaryTargetId(payload = {}, options = {}) {',
        "return `ops_summary:${summaryAlertType}`;",
        'buildOpsAlertLegacySummaryTargetId(payload = {}, options = {}) {',
        "return `ops_summary:${summaryAlertType}:${summaryDedupeKey}`;",
        'buildOpsAlertSummaryFallbackCaseMap(alerts = [], caseMap = new Map()) {',
        'isResolvedOpsAlertCaseStaleForAlert(caseRecord = null, alert = {}) {',
        'parseOpsAlertTimestampMs(value = \'\') {',
        'getOpsAlertActivityTimestampMs(alert = {}) {',
        'this.parseOpsAlertTimestampMs(alert.updated_at || alert.updatedAt),',
        'this.parseOpsAlertTimestampMs(alert.delivered_at || alert.deliveredAt),',
        'const alertActivityAt = this.getOpsAlertActivityTimestampMs(alert);',
        "implicit_reopen_reason: 'newer_alert_after_resolved_case'",
        'payloadTargetId.startsWith(`${summaryTargetId}:`)',
        '|| summaryTargetId',
        "buildOpsAlertContext(alertType = '', payload = {}, title = '', options = {}) {",
        '...options,',
        "const dedupeKey = String(row.dedupe_key || '').trim();",
        'const targetId = this.getOpsAlertTargetId(payload, { alertType, dedupeKey });',
        'alert.workspace = this.resolveOpsAlertWorkspace(alertType, payload, alert.title, entryPath, { dedupeKey });',
        'dedupeKey,',
        ".select('id, dedupe_key, alert_type, severity, title, content, payload, status, last_error, created_at, updated_at, delivered_at')"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }

    const contextFunction = source.match(/buildOpsAlertContext\(alertType = '', payload = \{\}, title = '', options = \{\}\) \{[\s\S]*?\n    \}\n\n    resolveOpsAlertEntryWorkspace/);
    assert.notEqual(contextFunction, null, 'js/components/ChatWidget.js should expose an options-aware ops alert context builder');
    assert.equal(contextFunction[0].includes('row.dedupe_key'), false, 'buildOpsAlertContext should not read row-scoped fields directly');

    const timestampMethodDefinitions = source.match(/^\s+getOpsAlertTimestampMs\(alert = \{\}\) \{/gm) || [];
    assert.equal(timestampMethodDefinitions.length, 1, 'js/components/ChatWidget.js should keep one read-receipt timestamp helper definition');
});

test('public chat widget reopens updated summary jobs whose original created_at predates the resolved case', () => {
    const ChatWidget = loadBrowserClass('js/components/ChatWidget.js', 'ChatWidget');
    const widget = Object.create(ChatWidget.prototype);
    const resolvedCase = {
        status: 'resolved',
        last_action_at: '2026-05-11T10:00:00.000Z',
        updated_at: '2026-05-11T10:00:00.000Z',
        created_at: '2026-05-11T09:30:00.000Z'
    };

    assert.equal(widget.isResolvedOpsAlertCaseStaleForAlert(resolvedCase, {
        created_at: '2026-05-11T09:00:00.000Z',
        updated_at: '2026-05-11T12:00:00.000Z'
    }), true);

    assert.equal(widget.isResolvedOpsAlertCaseStaleForAlert(resolvedCase, {
        created_at: '2026-05-11T09:00:00.000Z',
        updated_at: '2026-05-11T09:45:00.000Z'
    }), false);
});

test('admin chat ops alert toolbar remains sticky and avoids clipped pill controls', () => {
    const css = readRepoFile('css/admin-chat.css');

    const requiredMarkers = [
        '.admin-alert-toolbar {',
        'position: sticky;',
        'flex-wrap: nowrap;',
        'box-sizing: border-box;',
        '.admin-alert-toolbar-read {',
        'min-width: 0;',
        'flex: 0 1 auto;',
        '.admin-alert-toolbar-filter--owner {',
        '.admin-alert-toolbar-btn--read-standalone {',
        '.admin-alert-toolbar-filter--scope {',
        '.admin-alert-toolbar-select {',
        'max-width: 100%;',
        '.admin-alert-toolbar-select--compact {',
        '.admin-alert-toolbar-dropdown-trigger {',
        '.admin-alert-toolbar-dropdown-menu {',
        '.admin-alert-toolbar-dropdown-option {',
        '.admin-alert-case-badge--read {'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(css.includes(marker), true, `css/admin-chat.css should contain ${marker}`);
    }
});

test('admin chat command center summary treats unread ops alerts as dock actionable count', () => {
    const source = readRepoFile('js/admin-chat.js');

    const requiredMarkers = [
        '.filter((alert) => !this.isOpsAlertClosed(alert) && !this.isOpsAlertRead(alert))',
        'const unreadSystemAlerts = Math.max(0, Number(this.getOpsAlertUnreadCount() || 0) || 0);',
        'const actionableCount = pendingReply + unreadSystemAlerts;',
        'unreadSystemAlerts,'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
    }
});

test('admin chat lets user 360 mark pending payment prompts as read', () => {
    const source = readRepoFile('js/admin-chat.js');
    const widgetSource = readRepoFile('js/components/ChatWidget.js');

    const requiredMarkers = [
        'this.pendingPaymentReadReceipts = new Map();',
        "const processingStatuses = ['pending', 'processing', 'queued', 'retry_waiting', 'created', 'waiting', 'open', 'unpaid'];",
        "label: '待支付',",
        'isPendingPaymentRead(latestPayment)',
        'getPendingPaymentReadTarget(context = {}) {',
        "key: 'payment_read',",
        "label: '待支付已读',",
        "hint: '不再在列表提示这笔待支付'",
        'markPendingPaymentRead(target || {}, context)'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
        assert.equal(widgetSource.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }
});
