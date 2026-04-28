const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('ops alerts has a dedicated deep light-theme adaptation layer', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const marker = '20260428_ADMIN_STUDIO_OPS_ALERT_LIGHT_DEEP_ADAPT_1';
    const overviewPolishMarker = '20260428_ADMIN_STUDIO_OPS_ALERT_OVERVIEW_LIGHT_POLISH_2';
    const stripGuardMarker = '20260428_ADMIN_STUDIO_OPS_ALERT_LIGHT_STRIP_GUARD_2';
    const pressedRowsMarker = '20260428_ADMIN_STUDIO_OPS_ALERT_ROWS_PRESSED_DEFAULT_1';
    const rowDividersMarker = '20260428_ADMIN_STUDIO_ROW_DIVIDERS_FLAT_2';
    const healthStaticMarker = '20260428_ADMIN_STUDIO_OPS_ALERT_HEALTH_STATIC_SUBCARDS_1';
    const healthEmptyMarker = '20260428_ADMIN_STUDIO_OPS_ALERT_HEALTH_EMPTY_ERRORS_TEXT_1';
    const mobileCompactMarker = '20260428_ADMIN_STUDIO_OPS_ALERT_MOBILE_COMPACT_1';
    const mobileDockNavMarker = '20260428_ADMIN_STUDIO_OPS_ALERT_MOBILE_DOCK_NAV_FIX_1';

    assert.equal(
        stylesSource.includes(marker),
        true,
        'ops alerts should include a dedicated light-theme adaptation marker'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsLight=${marker}`),
        true,
        'admin studio should cache-bust the ops alerts light-theme layer'
    );
    assert.equal(
        stylesSource.includes(overviewPolishMarker),
        true,
        'ops alerts overview should include a follow-up polish layer for light mode'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsOverview=${overviewPolishMarker}`),
        true,
        'admin studio should cache-bust the ops alerts overview polish layer'
    );
    assert.equal(
        stylesSource.includes(stripGuardMarker),
        true,
        'ops alerts should include a module-wide light strip guard for BEM leaf nodes'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsStripGuard=${stripGuardMarker}`),
        true,
        'admin studio should cache-bust the ops alerts strip guard layer'
    );
    assert.equal(
        stylesSource.includes(pressedRowsMarker),
        true,
        'ops alerts should include a final row-level pressed-default layer'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsRowsPressed=${pressedRowsMarker}`),
        true,
        'admin studio should cache-bust the ops alerts row-level pressed-default layer'
    );
    assert.equal(
        stylesSource.includes(rowDividersMarker),
        true,
        'admin studio should include a final flat divider layer for config rows'
    );
    assert.equal(
        adminStudioHtml.includes(`rowDividersFlat=${rowDividersMarker}`),
        true,
        'admin studio should cache-bust the flat divider layer'
    );
    assert.equal(
        stylesSource.includes(healthStaticMarker),
        true,
        'ops alert health page should include a final static subcard layer'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsHealthStatic=${healthStaticMarker}`),
        true,
        'admin studio should cache-bust the ops alert health static subcard layer'
    );
    assert.equal(
        stylesSource.includes(healthEmptyMarker),
        true,
        'ops alert health empty error text should include a background removal layer'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsHealthEmpty=${healthEmptyMarker}`),
        true,
        'admin studio should cache-bust the ops alert health empty error text layer'
    );
    assert.equal(
        stylesSource.includes(mobileCompactMarker),
        true,
        'ops alerts should include a mobile density adaptation layer'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsMobile=${mobileCompactMarker}`),
        true,
        'admin studio should cache-bust the ops alerts mobile adaptation layer'
    );
    assert.equal(
        stylesSource.includes(mobileDockNavMarker),
        true,
        'ops alerts should include a mobile dock and nav follow-up layer'
    );
    assert.equal(
        adminStudioHtml.includes(`opsAlertsMobileFix=${mobileDockNavMarker}`),
        true,
        'admin studio should cache-bust the ops alerts mobile dock and nav fixes'
    );
    assert.equal(
        stylesSource.indexOf(marker) > stylesSource.indexOf('20260427_ADMIN_STUDIO_POINTS_LIGHT_TABLE_NAV_1'),
        true,
        'ops alerts light-theme layer should load after the shared admin light-theme layers'
    );
    assert.equal(
        stylesSource.indexOf(overviewPolishMarker) > stylesSource.indexOf(marker),
        true,
        'overview polish should load after the broad ops alerts light-theme remap'
    );
    assert.equal(
        stylesSource.indexOf(stripGuardMarker) > stylesSource.indexOf(overviewPolishMarker),
        true,
        'strip guard should load after overview polish and shared flat surface rules'
    );
    assert.equal(
        stylesSource.indexOf(pressedRowsMarker) > stylesSource.indexOf(stripGuardMarker),
        true,
        'row-level pressed-default layer should load after the broad ops alert light-theme remap'
    );
    assert.equal(
        stylesSource.indexOf(rowDividersMarker) > stylesSource.indexOf(pressedRowsMarker),
        true,
        'flat divider layer should load after the row pressed-default layer'
    );
    assert.equal(
        stylesSource.indexOf(healthStaticMarker) > stylesSource.indexOf(rowDividersMarker),
        true,
        'health static subcard layer should load after flat row divider rules'
    );
    assert.equal(
        stylesSource.indexOf(healthEmptyMarker) > stylesSource.indexOf(healthStaticMarker),
        true,
        'empty error text cleanup should load after the health static subcard layer'
    );
    assert.equal(
        stylesSource.indexOf(mobileCompactMarker) > stylesSource.indexOf(healthEmptyMarker),
        true,
        'mobile compact layer should load after ops alert surface cleanup rules'
    );
    assert.equal(
        stylesSource.indexOf(mobileDockNavMarker) > stylesSource.indexOf(mobileCompactMarker),
        true,
        'mobile dock and nav fixes should load after the broad mobile compact layer'
    );
    assert.equal(
        stylesSource.includes('--ops-alert-mobile-dock-safe-space: calc(132px + env(safe-area-inset-bottom, 0px));'),
        true,
        'ops alerts mobile layout should reserve bottom space for the floating dock'
    );
    assert.equal(
        stylesSource.includes('#module-ops-alerts #ops-alerts-view-strategy .ops-alert-config-card[data-config="ops-alerts-strategy"]'),
        true,
        'strategy content card should be explicitly widened on mobile'
    );
    assert.equal(
        stylesSource.includes('#module-ops-alerts > .admin-tabs .admin-tab-indicator {\n        display: block !important;'),
        true,
        'ops alerts mobile nav should restore the active tab indicator'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-ops-alerts :is(\n    .config-card,\n    .ops-alert-config-card,\n    .ops-alert-channel-card,'),
        true,
        'ops alerts light mode should remap the main card and channel surfaces'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-quick-reply-template,\n    .ops-alert-routing-matrix-compact,\n    .ops-alert-mute-table,\n    .ops-alert-routing-matrix,'),
        true,
        'ops alerts light mode should flatten quick replies and routing matrix surfaces'
    );
    assert.equal(
        stylesSource.includes('):is(:hover, :focus-within, :active, .is-focused, .is-active, .active, .selected) {\n    background: var(--ops-alert-light-surface) !important;\n    background-image: none !important;\n    border-color: var(--ops-alert-light-border) !important;\n    box-shadow: none !important;'),
        true,
        'ops alert structural hover states should not reintroduce shadows or lifted chrome'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-monitor-filter-btn,\n    .ops-alert-shift-report__view-chip,\n    .ops-alert-date-picker__nav,'),
        true,
        'ops alert controls that previously floated should be included in the flat control layer'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-date-picker__menu,'),
        true,
        'ops alerts date picker should be remapped away from dark popup surfaces'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-overview-banner__content,\n    .ops-alert-overview-banner__headline,'),
        true,
        'overview banner internals should be reset so they do not render white rectangles'
    );
    assert.equal(
        stylesSource.includes('#module-ops-alerts #opsAlertSummary.ops-alert-overview-banner :is(\n    .ops-alert-overview-banner__content,\n    .ops-alert-overview-banner__content > *,'),
        true,
        'overview banner should clear backgrounds from direct content rows with an id-scoped override'
    );
    assert.equal(
        stylesSource.includes('#opsAlertSummary.ops-alert-overview-banner :is(\n    .ops-alert-overview-banner__content,\n    .ops-alert-overview-banner__content > *,'),
        true,
        'overview banner pseudo-element guard should target the same row scope'
    );
    assert.equal(
        stylesSource.includes('content: none !important;\n    display: none !important;\n    background: transparent !important;'),
        true,
        'overview banner row pseudo-elements should not be able to draw long white strips'
    );
    assert.equal(
        stylesSource.includes('#module-ops-alerts [class*="ops-alert-"][class*="__"]:is(\n    [class*="copy"],\n    [class*="content"],\n    [class*="body"],'),
        true,
        'ops alert BEM leaf nodes should have a module-wide transparent background guard'
    );
    assert.equal(
        stylesSource.includes('[class*="summary"],\n    [class*="detail"],\n    [class*="meta"],\n    [class*="stamp"],'),
        true,
        'ops alert strip guard should cover summary/detail/meta/stamp text rows'
    );
    assert.equal(
        stylesSource.includes('[class*="top"],\n    [class*="eyebrow"],\n    [class*="actions"],'),
        true,
        'ops alert strip guard should cover eyebrow rows that otherwise render long light strips'
    );
    assert.equal(
        stylesSource.includes('[class*="eyebrow"],\n    [class*="actions"],\n    [class*="badges"]\n)::before,'),
        true,
        'ops alert strip guard should also suppress pseudo strips on eyebrow, action, and badge containers'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-overview-card__eyebrow,\n    .ops-alert-overview-card__title,\n    .ops-alert-overview-card__body,'),
        true,
        'overview card text blocks should be reset away from card-like backgrounds'
    );
    assert.equal(
        stylesSource.includes('background: transparent !important;\n    background-color: transparent !important;\n    background-image: none !important;'),
        true,
        'overview internals should explicitly clear the inherited light card background'
    );
    assert.equal(
        stylesSource.includes('.config-row,\n    .config-item-row,\n    .ops-alert-card-delete-row,'),
        true,
        'ops alert config rows should be included in the pressed-default row layer'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-summary-orchestration-cell,\n    .ops-alert-summary-orchestration-type,'),
        true,
        'ops alert orchestration table cells should not render raised column backgrounds'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-save-row,\n    .ops-alert-summary-orchestration-table,'),
        true,
        'ops alert row-adjacent containers should also be reset away from raised surfaces'
    );
    assert.equal(
        stylesSource.includes('--ops-alert-flat-row-divider: rgba(70, 98, 132, 0.18);'),
        true,
        'ops alert row dividers should use a plain line token instead of inset shadows'
    );
    assert.equal(
        stylesSource.includes('#module-ops-alerts .ops-alert-channel-card .config-row'),
        true,
        'ops alert channel config rows should receive the divider-specific override'
    );
    assert.equal(
        stylesSource.includes('border-bottom: 1px solid var(--ops-alert-flat-row-divider) !important;'),
        true,
        'ops alert channel rows should draw one plain divider line'
    );
    assert.equal(
        stylesSource.includes('--ops-alert-health-static-subcard-bg: rgba(255, 255, 255, 0.72);'),
        true,
        'ops alert health subcards should use one static light background token'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-health-card__stats > div:is(:hover, :focus, :focus-visible, :focus-within, :active, .active, .is-active, .is-focused, .selected)'),
        true,
        'ops alert health stat cells should keep the same style on hover'
    );
    assert.equal(
        stylesSource.includes('.ops-alert-health-card__config-item:is(:hover, :focus, :focus-visible, :focus-within, :active, .active, .is-active, .is-focused, .selected)'),
        true,
        'ops alert health config cells should keep the same style on hover'
    );
    assert.equal(
        stylesSource.includes('background: var(--ops-alert-health-static-subcard-bg) !important;\n    background-image: none !important;\n    border-color: var(--ops-alert-health-static-subcard-border) !important;'),
        true,
        'ops alert health subcards should not swap backgrounds or borders during hover'
    );
    assert.equal(
        stylesSource.includes('#module-ops-alerts .ops-alert-health-card__errors.empty'),
        true,
        'ops alert health empty error rows should be targeted separately from error cards'
    );
    assert.equal(
        stylesSource.includes('padding: 0 !important;\n    background: transparent !important;\n    background-color: transparent !important;\n    background-image: none !important;\n    border: 0 !important;'),
        true,
        'ops alert health empty error rows should render as plain text without a white rectangle'
    );

    const trendFillRules = stylesSource.match(/[^{}]*ops-alert-overview-trend__fill[^{}]*\{[^}]*\}/g) || [];
    assert.equal(
        trendFillRules.some((rule) => /background(?:-color|-image)?:/i.test(rule)),
        false,
        'ops alert overview trend fill should not force a static background over runtime stacked colors'
    );
});
