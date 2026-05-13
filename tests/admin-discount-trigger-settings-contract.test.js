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
    assert.equal(
        html.includes('修改后记得保存，规则会立即影响后续充值、签到和推广奖励发券。'),
        false,
        'admin-studio.html should not render save-row helper copy beside the discount trigger save button'
    );
    assert.equal(
        html.includes('id="discountTriggerRechargeStatusText" hidden'),
        true,
        'admin-studio.html should keep the discount trigger status node hidden from the save-row layout'
    );

    const requiredJsMarkers = [
        "let discountTriggerSettingsState = getDefaultDiscountTriggerSettingsState();",
        'async function initSettingsModule(options = {}) {',
        'function resolveSettingsModuleViewName(context = {}, options = {}) {',
        'async function activateSettingsModule(context = {}, options = {}) {',
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
        'function pulseAdminConfigButton(buttonEl) {',
        'function showDiscountTriggerFeedback(message, type = \'info\', options = {}) {',
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
        "const requestUrl = `/api/admin/settings/discount-trigger-options?site=${encodeURIComponent(site)}`;",
        "setupDiscountTriggerSettingsEventListeners();",
        "dropdownId.endsWith('_discount_id')",
        'void loadDiscountTriggerDiscountOptions(true);',
        'window.initSettingsModule = initSettingsModule;',
        'window.warmSettingsViewConfigInBackground = warmSettingsViewConfigInBackground;',
        'window.normalizeSettingsViewName = normalizeSettingsViewName;',
        "window.AdminShell.registerModule('settings', {",
        'activate: activateSettingsModule',
        "getDiscountTriggerSectionKeys().forEach((sectionKey) => {",
        "discountTriggerAddCheckinRuleBtn",
        "discountTriggerAddAffiliateRuleBtn",
        'feedbackToast: null',
        "showDiscountTriggerFeedback('正在保存卡券联动规则...', 'info', {",
        'reuseSaveToast: true',
        "showDiscountTriggerFeedback('当前没有需要保存的卡券联动改动', 'info');",
        "showDiscountTriggerFeedback('卡券联动规则保存失败，请稍后重试', 'error', {",
        'showDiscountTriggerFeedback(`已新增${meta.label}规则草稿，选择到账型卡券后保存生效。`, \'info\');',
        'showDiscountTriggerFeedback(`已套用“${presetTitle}”模板，保存后生效。`, \'success\');',
        'showDiscountTriggerFeedback(`已删除${meta.label}规则草稿，保存后生效。`, \'info\');'
    ];

    for (const marker of requiredJsMarkers) {
        assert.equal(js.includes(marker), true, `admin-config.js should contain ${marker}`);
    }
    assert.equal(
        js.includes('当前还没配置卡券联动规则。'),
        false,
        'admin-config.js should not show the removed empty discount trigger status copy'
    );

    assert.equal(
        studioJs.includes('initSystemConfig();'),
        false,
        'admin-studio.js should not eagerly initialize the entire settings payload during page bootstrap'
    );
    assert.match(
        studioJs,
        /function switchSettingsView\(viewName, options = \{\}\) \{[\s\S]*window\.warmSettingsViewConfigInBackground\?\.\(\{[\s\S]*viewName: normalizedViewName[\s\S]*\}\);[\s\S]*\}/,
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
        'justify-content: flex-start;',
        '.discount-trigger-save-row .btn-add-config {',
        'margin-left: 0;',
        '.discount-trigger-rule-card__warning {',
        '.discount-trigger-remove-btn {',
        '.toast.is-content-entering i,',
        '@keyframes toastContentIn'
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
