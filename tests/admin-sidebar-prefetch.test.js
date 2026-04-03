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
        'const POINTS_PREFETCH_VIEWS = [\'batches\', \'catalog\', \'generate\'];',
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
        'const PAYMENTS_PREFETCH_TABS = [\'overview\', \'finance\', \'ops\'];',
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
