const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin studio exposes the marketing asset center workspace inside the growth tab shell', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminApiSource = readRepoFile('api/admin.js');

    const htmlMarkers = [
        'id="marketingAssetCenterWorkspace"',
        'id="marketingAssetCenterMeta"',
        '营销资产中心',
        'js/admin-growth-center.js?v=20260421_GROWTH_CENTER_CONTEXT_ROUTING_P3&workflowRails=20260430_ADMIN_STUDIO_WORKFLOW_CARD_RAIL_VISIBILITY_1'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    assert.equal(
        adminApiSource.includes("'marketing/assets-center': marketingAssetsCenterHandler"),
        true,
        'api/admin.js should register the marketing assets center route'
    );
});

test('growth center runtime and styles expose unified asset and workflow surfaces', () => {
    const growthSource = readRepoFile('js/admin-growth-center.js');
    const stylesSource = readRepoFile('css/admin-studio-page.css');

    const runtimeMarkers = [
        'const AdminGrowthCenter = {',
        "buildUrl('marketing/assets-center'",
        'renderSummaryCards(summary = {})',
        'renderUnifiedAssets(items = [])',
        'resolveWorkflowRailTone(workflow = {})',
        'renderWorkflows(workflows = [])',
        "mode: 'summary'",
        "mode: 'details'",
        'mergeDetailsPayload(payload = {})',
        'payload?.unified_assets_mode',
        'scheduleDetailLoad({ force',
        'details_pending',
        '明细补齐中',
        'marketing-asset-center__workflow-card--${this.escapeHtml(workflowTone)}',
        'data-workflow-tone="${this.escapeHtml(workflowTone)}"',
        "data-growth-center-action=\"run-workflow\"",
        "data-growth-center-action=\"open-asset\"",
        "async openModule(moduleId = '', context = {}) {",
        "async openAsset(moduleId = '', assetType = '', id = '') {",
        'async function openAdminGrowthCenterShellContext(context = {}, options = {}) {',
        'window.openAdminGrowthCenterShellContext = openAdminGrowthCenterShellContext;',
        "return window.AdminShell.activateModule(normalizedModuleId, {",
        "reason: 'growth-center-open-module'",
        "typeof window.openAdminPointsShellContext === 'function'",
        "typeof window.openAdminDiscountsShellContext === 'function'",
        'window.AdminGrowthCenter = AdminGrowthCenter;'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(growthSource.includes(marker), true, `js/admin-growth-center.js should contain ${marker}`);
    }

    const styleMarkers = [
        '.marketing-asset-center__summary-grid',
        '.marketing-asset-center__family-card',
        '.marketing-asset-center__workflow-card',
        '20260430_ADMIN_STUDIO_WORKFLOW_CARD_RAIL_VISIBILITY_1',
        '.marketing-asset-center__workflow-card--emerald',
        '.marketing-asset-center__workflow-card--warning',
        '20260430_ADMIN_STUDIO_MARKETING_RECENT_ASSET_GRID_1',
        'grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));',
        '.marketing-asset-center__list-item',
        '.marketing-asset-center__detail-btn',
        '.marketing-asset-center__error'
    ];

    for (const marker of styleMarkers) {
        assert.equal(stylesSource.includes(marker), true, `css/admin-studio-page.css should contain ${marker}`);
    }

    assert.equal(
        readRepoFile('admin-studio.html').includes('workflowRails=20260430_ADMIN_STUDIO_WORKFLOW_CARD_RAIL_VISIBILITY_1'),
        true,
        'admin-studio.html should cache-bust the visible workflow rail stylesheet update'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('marketingRecentAssetGrid=20260430_ADMIN_STUDIO_MARKETING_RECENT_ASSET_GRID_1'),
        true,
        'admin-studio.html should cache-bust the adaptive recent asset grid stylesheet update'
    );
});

test('growth center local smoke uses dedicated marketing asset center fixtures and dispatcher', () => {
    const smokeSource = readRepoFile('js/local-smoke-fixtures.js');
    const pointsSource = readRepoFile('admin-points.js');

    const smokeMarkers = [
        'async function runGrowthCenterSmoke()',
        "url.pathname === '/api/admin/marketing/assets-center'",
        'buildSmokeMarketingAssetsResponse(',
        'runSmokeMarketingWorkflow(',
        "if (moduleParam === 'growth-center') {",
        'await runGrowthCenterSmoke();'
    ];

    for (const marker of smokeMarkers) {
        assert.equal(smokeSource.includes(marker), true, `js/local-smoke-fixtures.js should contain ${marker}`);
    }

    assert.equal(
        pointsSource.includes('window.openPointsPackageEditor = openPointsPackageEditor;'),
        true,
        'admin-points.js should expose package editor linkage for growth center asset jumps'
    );
});

test('growth center merges marketing asset detail overlays into the summary cache', () => {
    const source = readRepoFile('js/admin-growth-center.js');
    const context = {
        URL,
        Element: class Element {},
        window: {
            location: { origin: 'https://admin.example.test' },
            addEventListener() {},
            AdminShell: null
        },
        document: {
            documentElement: { dataset: {} },
            addEventListener() {},
            querySelector() {
                return null;
            },
            getElementById() {
                return null;
            }
        }
    };
    context.globalThis = context;
    vm.runInNewContext(source, context, { filename: 'js/admin-growth-center.js' });

    const growthCenter = context.window.AdminGrowthCenter;
    growthCenter.state.payload = {
        success: true,
        load_mode: 'summary',
        details_pending: true,
        summary: {
            discount_count: 1,
            package_count: 1,
            issued_asset_count: 0,
            recent_revenue_net: 0
        },
        asset_families: [
            {
                key: 'discount',
                label: '优惠券',
                summary: {
                    total_count: 1,
                    asset_issued_count: 0
                },
                primary_action: { module: 'discounts' }
            },
            {
                key: 'points_package',
                label: '兑换码/套餐',
                summary: {
                    package_count: 1,
                    used_code_count: 3
                },
                primary_action: { module: 'points' }
            }
        ],
        unified_assets: [
            {
                type: 'discount',
                id: 'discount_1',
                destination_id: 'discount_1',
                recent_activity_at: '2026-04-01T08:00:00.000Z',
                metrics: ['0 单净核销']
            },
            {
                type: 'points_package',
                id: 'package_1',
                destination_id: 'package_1',
                recent_activity_at: '2026-04-02T08:00:00.000Z',
                metrics: ['3/10 已核销']
            }
        ],
        workflows: []
    };

    const merged = growthCenter.mergeDetailsPayload({
        success: true,
        load_mode: 'details',
        details_pending: false,
        summary: {
            issued_asset_count: 4,
            recent_revenue_net: 180
        },
        asset_families: [
            {
                key: 'discount',
                summary: {
                    asset_issued_count: 4
                }
            }
        ],
        unified_assets_mode: 'discount_patch',
        unified_assets: [
            {
                type: 'discount',
                id: 'discount_1',
                destination_id: 'discount_1',
                recent_activity_at: '2026-04-03T08:00:00.000Z',
                metrics: ['2 单净核销']
            }
        ],
        workflows: [
            {
                workflow_key: 'discount_lifecycle_sync',
                latest_run: { summary: 'done' }
            }
        ]
    });

    assert.equal(merged.load_mode, 'full');
    assert.equal(merged.details_pending, false);
    assert.equal(merged.summary.discount_count, 1);
    assert.equal(merged.summary.package_count, 1);
    assert.equal(merged.summary.issued_asset_count, 4);
    assert.equal(merged.summary.recent_revenue_net, 180);
    assert.equal(merged.asset_families.length, 2);
    assert.equal(merged.asset_families.find((family) => family.key === 'discount').summary.asset_issued_count, 4);
    assert.equal(merged.asset_families.find((family) => family.key === 'points_package').summary.used_code_count, 3);
    assert.equal(merged.unified_assets.length, 2);
    assert.equal(merged.unified_assets[0].type, 'discount');
    assert.deepEqual(merged.unified_assets[0].metrics, ['2 单净核销']);
    assert.equal(merged.workflows[0].latest_run.summary, 'done');
});
