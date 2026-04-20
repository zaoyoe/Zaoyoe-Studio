const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin sidebar modules expose warm-load hooks for sibling views', () => {
    const bootstrapSource = readRepoFile('js/admin-studio-bootstrap.js');
    const studioSource = readRepoFile('admin-studio.js');
    const commentsSource = readRepoFile('admin-comments.js');
    const pointsSource = readRepoFile('admin-points.js');
    const paymentsSource = readRepoFile('js/admin-payments.js');

    const bootstrapMarkers = [
        "return () => window.prefetchGalleryModule?.();",
        "return () => window.prefetchCommentsModule?.();",
        "return () => window.prefetchPointsModule?.();",
        "return () => window.AdminPayments?.scheduleTabPrefetch?.(window.AdminPayments?.getActiveTab?.() || 'overview');",
        "return () => window.prefetchSettingsModule?.();",
        "return () => window.prefetchOpsAlertsModule?.();",
        'window.scheduleAdminModulePrefetch = scheduleAdminModulePrefetch;'
    ];

    for (const marker of bootstrapMarkers) {
        assert.equal(
            bootstrapSource.includes(marker),
            true,
            `js/admin-studio-bootstrap.js should contain ${marker}`
        );
    }

    assert.equal(
        bootstrapSource.includes('const ADMIN_BOOTSTRAP_MODULE_PREFETCH_ALLOWLIST = new Set([]);'),
        true,
        'js/admin-studio-bootstrap.js should keep bootstrap module prefetch disabled by default'
    );
    assert.equal(
        bootstrapSource.includes('if (!ADMIN_BOOTSTRAP_MODULE_PREFETCH_ALLOWLIST.has(normalizedModuleId)) {'),
        true,
        'js/admin-studio-bootstrap.js should skip bootstrap prefetch for heavy modules by default'
    );
    assert.match(
        bootstrapSource,
        /function scheduleHomepageModulePrewarm\(activeModule = restoreAdminStudioModuleFromUrl\(\)\) \{[\s\S]*normalizeAdminModuleId\(activeModule\) !== 'homepage'/,
        'js/admin-studio-bootstrap.js should not prewarm homepage config unless homepage is the active startup module'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /window\.addEventListener\('permissionsLoaded', \(\) => \{[\s\S]*scheduleAdminChatPrewarm\(\);[\s\S]*\}\);/,
        'js/admin-studio-bootstrap.js should not eagerly prewarm chat during the permissionsLoaded bootstrap path'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /window\.addEventListener\('load', \(\) => \{[\s\S]*scheduleAdminChatPrewarm\(\);[\s\S]*\}\);/,
        'js/admin-studio-bootstrap.js should not eagerly prewarm chat during the window load bootstrap path'
    );
    assert.match(
        bootstrapSource,
        /} else if \(normalizedModuleId === 'points'\) \{\s+window\.loadBatches\?\.\(\);\s+}/,
        'js/admin-studio-bootstrap.js should avoid eagerly hydrating points generate-view data when opening the points module'
    );
    assert.equal(
        bootstrapSource.includes('function warmOpsAlertsModuleData() {'),
        true,
        'js/admin-studio-bootstrap.js should expose a dedicated warm path for the ops-alerts workspace'
    );
    assert.match(
        bootstrapSource,
        /if \(normalizedModuleId === 'ops-alerts'\) \{\s+window\.initSettingsModule\?\.\(\{ bindListeners: true, loadConfig: false \}\);\s+window\.initOpsAlertsModule\?\.\(\);\s+warmOpsAlertsModuleData\(\);\s+}/,
        'js/admin-studio-bootstrap.js should bind settings listeners and warm ops-alert data only when the ops-alerts module becomes active'
    );

    const studioMarkers = [
        'function prefetchGalleryModule() {',
        'function prefetchSettingsModule() {',
        'function prefetchOpsAlertsModule() {',
        'window.prefetchGalleryModule = prefetchGalleryModule;',
        'window.prefetchSettingsModule = prefetchSettingsModule;',
        'window.prefetchOpsAlertsModule = prefetchOpsAlertsModule;'
    ];

    for (const marker of studioMarkers) {
        assert.equal(
            studioSource.includes(marker),
            true,
            `admin-studio.js should contain ${marker}`
        );
    }

    const commentsMarkers = [
        'const COMMENTS_PREFETCH_VIEWS = [\'guestbook\', \'gallery\'];',
        'function buildCommentsViewCacheKey(requestParams = {}) {',
        'function scheduleCommentsViewPrefetch(activeView = currentCommentView) {',
        'window.prefetchCommentsModule = prefetchCommentsModule;'
    ];

    for (const marker of commentsMarkers) {
        assert.equal(
            commentsSource.includes(marker),
            true,
            `admin-comments.js should contain ${marker}`
        );
    }

    const pointsMarkers = [
        'const POINTS_PREFETCH_VIEWS = [\'catalog\'];',
        'function schedulePointsViewPrefetch(activeView = getActivePointsViewName()) {',
        'window.prefetchPointsModule = prefetchPointsModule;'
    ];

    for (const marker of pointsMarkers) {
        assert.equal(
            pointsSource.includes(marker),
            true,
            `admin-points.js should contain ${marker}`
        );
    }

    const paymentsMarkers = [
        'const PAYMENTS_PREFETCH_TABS = [];',
        'function prefetchTabData(tabId, options = {}) {',
        'function scheduleTabPrefetch(activeTab = state.activeTab) {',
        'scheduleTabPrefetch,',
        'getActiveTab: () => state.activeTab,'
    ];

    for (const marker of paymentsMarkers) {
        assert.equal(
            paymentsSource.includes(marker),
            true,
            `js/admin-payments.js should contain ${marker}`
        );
    }
});
