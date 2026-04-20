const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin pricing settings expose discount trigger rule controls and wiring', () => {
    const html = readRepoFile('admin-studio.html');
    const js = readRepoFile('admin-config.js');
    const studioJs = readRepoFile('admin-studio.js');
    const css = readRepoFile('admin-studio.css');
    const smoke = readRepoFile('js/local-smoke-fixtures.js');

    const requiredHtmlMarkers = [
        'discount-trigger-config-card',
        'discountTriggerRechargeEnabledToggle',
        'discountTriggerRechargeSummary',
        'discountTriggerAddRechargeRuleBtn',
        'discountTriggerRechargeRuleList',
        'discountTriggerRechargePresetRow',
        'discountTriggerCheckinEnabledToggle',
        'discountTriggerCheckinSummary',
        'discountTriggerAddCheckinRuleBtn',
        'discountTriggerCheckinRuleList',
        'discountTriggerCheckinPresetRow',
        'discountTriggerAffiliateEnabledToggle',
        'discountTriggerAffiliateSummary',
        'discountTriggerAddAffiliateRuleBtn',
        'discountTriggerAffiliateRuleList',
        'discountTriggerAffiliatePresetRow',
        'discount-trigger-preset-btn__desc',
        'data-discount-trigger-preset-role="recommendation"',
        'discountTriggerRechargeStatusText',
        'discountTriggerRechargeSaveBtn'
    ];

    for (const marker of requiredHtmlMarkers) {
        assert.equal(html.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const requiredJsMarkers = [
        "let discountTriggerSettingsState = getDefaultDiscountTriggerSettingsState();",
        'async function initSettingsModule(options = {}) {',
        'await initSettingsModule({ bindListeners: true });',
        'const SETTINGS_VIEW_DOMAIN_MAP = Object.freeze({',
        "pricing: ['commerce', 'affiliate'],",
        "general: ['growth']",
        'function renderSettingsViewSections(viewName = \'\') {',
        'async function warmSettingsDomainsInBackground(domains = [], options = {}) {',
        'async function warmSettingsViewConfigInBackground(options = {}) {',
        'void warmSettingsViewConfigInBackground({ force: options.force === true, viewName });',
        'async function warmSettingsSecondaryPanelsInBackground({ force = false, viewName = \'\' } = {}) {',
        'function normalizeDiscountTriggerRulesConfig(raw, options = {}) {',
        'function getDiscountTriggerSectionMeta(sectionKey) {',
        'function createDiscountTriggerCheckinRuleDraft(overrides = {}) {',
        'function createDiscountTriggerAffiliateRuleDraft(overrides = {}) {',
        'function createDiscountTriggerPresetRule(sectionKey, presetId) {',
        'function getDiscountTriggerPresetAutoSelectedOption(sectionKey, presetId, targetSite = \'all\') {',
        'function getDiscountTriggerPresetRecommendation(sectionKey, presetId) {',
        'function applyDiscountTriggerPresetAutoSelection(rule = null, sectionKey, presetId) {',
        'function applyDiscountTriggerPresetRecommendations() {',
        'function renderDiscountTriggerSettings() {',
        'function setupDiscountTriggerSettingsEventListeners() {',
        'async function loadDiscountTriggerDiscountOptions(force = false) {',
        'async function saveDiscountTriggerSettings(options = {}) {',
        "hydrateDiscountTriggerSettingsDraft({ force: true });",
        'renderDiscountTriggerSettings();',
        "await saveConfig('discount_trigger_rules', normalizedConfig);",
        '/api/admin/settings/discount-trigger-options?site=all',
        "setupDiscountTriggerSettingsEventListeners();",
        "dropdownId.endsWith('_discount_id')",
        'void loadDiscountTriggerDiscountOptions(true);',
        'window.initSettingsModule = initSettingsModule;',
        'window.warmSettingsViewConfigInBackground = warmSettingsViewConfigInBackground;',
        "getDiscountTriggerSectionKeys().forEach((sectionKey) => {",
        "discountTriggerAddCheckinRuleBtn",
        "discountTriggerAddAffiliateRuleBtn"
    ];

    for (const marker of requiredJsMarkers) {
        assert.equal(js.includes(marker), true, `admin-config.js should contain ${marker}`);
    }

    assert.equal(
        studioJs.includes('initSystemConfig();'),
        false,
        'admin-studio.js should not eagerly initialize the entire settings payload during page bootstrap'
    );
    assert.match(
        studioJs,
        /function switchSettingsView\(viewName\) \{[\s\S]*warmSettingsViewConfigInBackground\?\.\(\{ viewName \}\);[\s\S]*\}/,
        'admin-studio.js should warm the active settings view lazily when switching tabs'
    );

    const requiredCssMarkers = [
        '.discount-trigger-config-card .config-card-body {',
        '.discount-trigger-section {',
        '.discount-trigger-presets {',
        '.discount-trigger-preset-btn {',
        '.discount-trigger-preset-btn__recommendation {',
        '.discount-trigger-rule-grid {',
        '.discount-trigger-save-row {',
        '.discount-trigger-rule-card__warning {',
        '.discount-trigger-remove-btn {'
    ];

    for (const marker of requiredCssMarkers) {
        assert.equal(css.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const requiredSmokeMarkers = [
        "/api/admin/settings/discount-trigger-options",
        "url.pathname === '/api/admin/settings/system-config'",
        "distribution_mode: 'user_assigned'",
        'matchesSmokeSiteScope(row?.applicable_site, site)',
        'async function runDiscountTriggerSettingsSmoke() {',
        "'卡券联动三段配置已渲染'",
        "'卡券联动推荐模板已渲染'",
        "'卡券联动模板说明和候选提示已渲染'",
        "'卡券联动推荐模板会按段落插入预填规则'",
        "'卡券联动模板会自动预选推荐卡券'",
        "'卡券联动保存后会写回 system-config'",
        "'卡券联动重载后会保留已保存规则'",
        "moduleParam === 'settings'"
    ];

    for (const marker of requiredSmokeMarkers) {
        assert.equal(smoke.includes(marker), true, `js/local-smoke-fixtures.js should contain ${marker}`);
    }
});
