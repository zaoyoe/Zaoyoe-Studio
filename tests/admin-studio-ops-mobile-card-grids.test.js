const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('ops and payment issue cards keep two mobile columns where practical', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const marker = '20260430_ADMIN_STUDIO_OPS_METRIC_GRIDS_2UP_1';
    const markerIndex = styles.indexOf(marker);

    assert.notEqual(markerIndex, -1, 'ops mobile two-up card fix should carry a unique marker');

    const nextMarkerIndex = styles.indexOf('20260430_ADMIN_STUDIO_OPS_ALERT_OVERVIEW_MOBILE_1UP_1', markerIndex);
    assert.notEqual(nextMarkerIndex, -1, 'ops alert overview mobile one-up override should follow the two-up block');

    const block = styles.slice(markerIndex, nextMarkerIndex);

    assert.match(
        block,
        /@media \(min-width: 361px\) and \(max-width: 768px\)/,
        'ops two-up card override should avoid the smallest phone widths'
    );
    assert.match(
        block,
        /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'ops and payment issue card groups should explicitly use two equal mobile columns'
    );

    [
        '#module-business-overview',
        '.analytics-ops-cockpit__stats',
        '.analytics-ops-cockpit__issue-grid',
        '#module-payments :is(',
        '#paymentsIssueSummary',
        '#paymentsPrioritySummary',
        '.admin-workbench-context-note__chips'
    ].forEach((selector) => {
        assert.equal(block.includes(selector), true, `${selector} should be covered by the ops mobile two-up fix`);
    });

    assert.match(
        block,
        /\.analytics-ops-cockpit__issue-top \{[\s\S]*flex-direction: column !important;[\s\S]*align-items: flex-start !important;/,
        'ops issue card headers should stack safely inside two-column phone cards'
    );
    assert.match(
        block,
        /\.analytics-ops-cockpit__feedback-status \{[\s\S]*align-items: flex-start !important;/,
        'ops issue feedback metadata should align left after header stacking'
    );
    assert.match(
        block,
        /#module-payments :is\([\s\S]*#paymentsIssueSummary,[\s\S]*#paymentsPrioritySummary[\s\S]*\) \.admin-workbench-context-note__chip \{[\s\S]*justify-content: center !important;[\s\S]*white-space: normal !important;/,
        'payment issue summary chips should wrap and center inside grid cells'
    );
    assert.equal(
        block.includes('.ops-alert-overview-banner'),
        false,
        'large ops overview banners should not be forced into the compact two-up card grid'
    );
    assert.equal(
        block.includes('#module-ops-alerts .ops-alert-overview-grid'),
        false,
        'ops alert overview cards should not be forced into the compact two-up card grid'
    );
    assert.equal(
        html.includes('opsMetricGridsMobile=20260430_ADMIN_STUDIO_OPS_METRIC_GRIDS_2UP_1'),
        true,
        'admin studio should cache-bust the ops mobile two-up card fix'
    );
});

test('ops alert overview cards stack full-width on mobile', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const marker = '20260430_ADMIN_STUDIO_OPS_ALERT_OVERVIEW_MOBILE_1UP_1';
    const markerIndex = styles.indexOf(marker);

    assert.notEqual(markerIndex, -1, 'ops alert overview mobile one-up fix should carry a unique marker');

    const block = styles.slice(markerIndex);

    assert.match(
        block,
        /@media \(max-width: 768px\)/,
        'ops alert overview one-up override should apply across mobile widths'
    );
    assert.match(
        block,
        /#module-ops-alerts \.ops-alert-overview-grid \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: 1fr !important;[\s\S]*gap: 12px !important;/,
        'ops alert overview cards should use a single full-width mobile column'
    );
    assert.match(
        block,
        /#module-ops-alerts \.ops-alert-overview-card \{[\s\S]*width: 100% !important;/,
        'each ops alert overview card should fill the mobile row'
    );
    assert.equal(
        html.includes('opsAlertsOverviewMobile=20260430_ADMIN_STUDIO_OPS_ALERT_OVERVIEW_MOBILE_1UP_1'),
        true,
        'admin studio should cache-bust the ops alert overview mobile one-up fix'
    );
});

test('ops alert save config button stays compact and centered on mobile', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const marker = '20260430_ADMIN_STUDIO_OPS_ALERT_SAVE_BUTTON_MOBILE_COMPACT_1';
    const markerIndex = styles.indexOf(marker);

    assert.notEqual(markerIndex, -1, 'ops alert save button mobile compact fix should carry a unique marker');

    const block = styles.slice(markerIndex);

    assert.match(
        block,
        /@media \(max-width: 768px\)/,
        'ops alert save button compact override should apply across mobile widths'
    );
    assert.match(
        block,
        /#module-ops-alerts :is\([\s\S]*\.ops-alert-save-row,[\s\S]*\.ops-alert-strategy-savebar__actions[\s\S]*\) \.btn-add-config\[data-admin-action="settings-save-ops-alerts"\] \{[\s\S]*display: inline-flex !important;[\s\S]*align-self: center !important;[\s\S]*justify-content: center !important;[\s\S]*width: auto !important;/,
        'save config buttons should shrink to content and center their text on mobile'
    );
    assert.match(
        block,
        /padding-inline: 14px !important;[\s\S]*text-align: center !important;[\s\S]*white-space: nowrap !important;/,
        'save config button label should stay centered inside the compact button'
    );
    assert.equal(
        html.includes('opsAlertsSaveButtonMobile=20260430_ADMIN_STUDIO_OPS_ALERT_SAVE_BUTTON_MOBILE_COMPACT_1'),
        true,
        'admin studio should cache-bust the ops alert save button mobile compact fix'
    );
});

test('ops alert strategy child cards and monitor inputs use two mobile columns', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const marker = '20260430_ADMIN_STUDIO_OPS_ALERT_STRATEGY_MONITOR_2UP_1';
    const markerIndex = styles.indexOf(marker);

    assert.notEqual(markerIndex, -1, 'ops alert strategy and monitor mobile two-up fix should carry a unique marker');

    const block = styles.slice(markerIndex);

    assert.match(
        block,
        /@media \(min-width: 361px\) and \(max-width: 768px\)/,
        'strategy and monitor two-up override should avoid the narrowest phone widths'
    );
    assert.match(
        block,
        /#ops-alerts-view-strategy :is\([\s\S]*\.ops-alert-strategy-summary-card__metrics,[\s\S]*\.ops-alert-strategy-card-grid--dual,[\s\S]*\.ops-alert-strategy-inline-grid,[\s\S]*\.ops-alert-strategy-inline-grid--triple[\s\S]*\) \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'strategy summary metrics and child strategy cards should use two mobile columns'
    );
    assert.match(
        block,
        /#ops-alerts-view-monitors \.ops-alert-config-card > \.config-card-body \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'monitor rule card bodies should become a two-column input grid on mobile'
    );
    assert.match(
        block,
        /#ops-alerts-view-monitors \.ops-alert-config-card > \.config-card-body > \.config-row:has\(> label\):has\(\.config-input\) \{[\s\S]*grid-column: auto !important;[\s\S]*flex-direction: column !important;/,
        'monitor input rows should occupy one grid cell and stack label over control'
    );
    assert.match(
        block,
        /#ops-alerts-view-monitors \.ops-alert-config-card > \.config-card-body > :is\([\s\S]*\.config-inline-note,[\s\S]*\.ops-alert-quick-reply-config,[\s\S]*\.ops-alert-save-row,[\s\S]*\.ops-alert-actions-grid[\s\S]*\),[\s\S]*\.config-row:has\(> \.config-info\) \{[\s\S]*grid-column: 1 \/ -1 !important;/,
        'monitor notes, action blocks, and toggle rows should stay full-width'
    );
    assert.equal(
        html.includes('opsAlertsStrategyMonitorMobile=20260430_ADMIN_STUDIO_OPS_ALERT_STRATEGY_MONITOR_2UP_1'),
        true,
        'admin studio should cache-bust the strategy and monitor mobile two-up fix'
    );
});

test('ops alert unified summary orchestration has mobile breathing room', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const marker = '20260430_ADMIN_STUDIO_OPS_ALERT_SUMMARY_ORCHESTRATION_BREATHING_1';
    const markerIndex = styles.indexOf(marker);

    assert.notEqual(markerIndex, -1, 'ops alert unified summary breathing fix should carry a unique marker');

    const block = styles.slice(markerIndex);

    assert.match(
        block,
        /@media \(max-width: 768px\)/,
        'unified summary breathing override should apply on mobile'
    );
    assert.match(
        block,
        /\[data-config="ops-alerts-summary-orchestration"\] \.config-card-body \{[\s\S]*gap: 16px !important;[\s\S]*padding: 16px !important;/,
        'unified summary card body should get more internal spacing'
    );
    assert.match(
        block,
        /\[data-config="ops-alerts-summary-orchestration"\] \.ops-alert-summary-orchestration-panel \{[\s\S]*gap: 18px !important;[\s\S]*padding: 18px !important;[\s\S]*border-radius: 18px !important;/,
        'unified summary panels should have roomier padding and radius'
    );
    assert.match(
        block,
        /\[data-config="ops-alerts-summary-orchestration"\] \.ops-alert-summary-orchestration-panel__head p \{[\s\S]*margin-top: 10px !important;[\s\S]*line-height: 1\.68 !important;/,
        'unified summary descriptive text should breathe vertically'
    );
    assert.match(
        block,
        /\[data-config="ops-alerts-summary-orchestration"\] \.ops-alert-summary-orchestration-row \{[\s\S]*gap: 10px 12px !important;[\s\S]*padding: 14px 16px !important;[\s\S]*border-radius: 16px !important;/,
        'unified summary rows should not hug their borders on mobile'
    );
    assert.match(
        block,
        /\[data-config="ops-alerts-summary-orchestration"\] \.ops-alert-summary-orchestration-panel \.config-row \{[\s\S]*padding: 15px 16px !important;[\s\S]*border: 1px solid rgba\(107, 158, 206, 0\.22\) !important;[\s\S]*border-radius: 16px !important;/,
        'unified summary draft controls should regain card-like breathing room'
    );
    assert.equal(
        html.includes('opsAlertsSummaryBreathing=20260430_ADMIN_STUDIO_OPS_ALERT_SUMMARY_ORCHESTRATION_BREATHING_1'),
        true,
        'admin studio should cache-bust the unified summary breathing fix'
    );
});
