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
    const pageCss = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const smoke = readRepoFile('js/local-smoke-fixtures.js');

    const requiredHtmlMarkers = [
        'discount-trigger-config-card',
        'discountTriggerRechargeEnabledToggle',
        'data-admin-action="settings-toggle-discount-trigger-section" data-discount-trigger-section="recharge"',
        'discountTriggerRechargeSummary',
        'discountTriggerAddRechargeRuleBtn',
        'data-admin-action="settings-add-discount-trigger-rule" data-discount-trigger-section="recharge"',
        'discountTriggerRechargeRuleList',
        'discountTriggerRechargePresetRow',
        'discountTriggerCheckinEnabledToggle',
        'data-admin-action="settings-toggle-discount-trigger-section" data-discount-trigger-section="checkin"',
        'discountTriggerCheckinSummary',
        'discountTriggerAddCheckinRuleBtn',
        'data-admin-action="settings-add-discount-trigger-rule" data-discount-trigger-section="checkin"',
        'discountTriggerCheckinRuleList',
        'discountTriggerCheckinPresetRow',
        'discountTriggerAffiliateEnabledToggle',
        'data-admin-action="settings-toggle-discount-trigger-section" data-discount-trigger-section="affiliate"',
        'discountTriggerAffiliateSummary',
        'discountTriggerAddAffiliateRuleBtn',
        'data-admin-action="settings-add-discount-trigger-rule" data-discount-trigger-section="affiliate"',
        'discountTriggerAffiliateRuleList',
        'discountTriggerAffiliatePresetRow',
        'data-admin-action="settings-apply-discount-trigger-preset"',
        'discount-trigger-preset-btn__desc',
        'data-discount-trigger-preset-role="recommendation"',
        'discountTriggerRechargeStatusText',
        'discountTriggerRechargeSaveBtn',
        'data-admin-action="settings-save-discount-trigger-rules"'
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
    assert.equal(
        html.includes('discountTriggerPresetHover=20260605_ADMIN_DISCOUNT_TRIGGER_PRESET_HOVER_LOCK_2'),
        true,
        'admin-studio.html should cache-bust the discount trigger preset hover stability styles'
    );
    assert.match(
        html,
        /<button type="button" class="status-toggle" id="discountTriggerRechargeEnabledToggle" role="switch" aria-checked="false" aria-label="切换充值成功自动发券" data-admin-action="settings-toggle-discount-trigger-section" data-discount-trigger-section="recharge"><\/button>/,
        'admin-studio.html should render the recharge discount trigger section toggle as a real switch button'
    );
    assert.equal(
        html.includes('discountTriggerToggle=20260605_DISCOUNT_TRIGGER_SECTION_TOGGLE_1'),
        true,
        'admin-studio.html should cache-bust the discount trigger section toggle interaction fix'
    );
    assert.equal(
        html.includes('discountTriggerActions=20260605_DISCOUNT_TRIGGER_ACTION_ROUTER_1'),
        true,
        'admin-studio.html should cache-bust the discount trigger action router fix'
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
        'function handleDiscountTriggerSectionToggle(sectionKey = \'\', sourceEl = null) {',
        'function resolveDiscountTriggerSectionKeyFromElement(sourceEl = null, fallbackKey = \'recharge\') {',
        'function handleDiscountTriggerAddRule(sectionKey = \'\', sourceEl = null) {',
        'function handleDiscountTriggerApplyPreset(sectionKey = \'\', presetId = \'\', sourceEl = null) {',
        'function handleDiscountTriggerRemoveRule(sourceEl = null) {',
        'async function handleDiscountTriggerSave(sourceEl = null) {',
        'function setupDiscountTriggerSettingsEventListeners() {',
        'async function loadDiscountTriggerDiscountOptions(force = false) {',
        'async function saveDiscountTriggerSettings(options = {}) {',
        "hydrateDiscountTriggerSettingsDraft({ force: true });",
        'renderDiscountTriggerSettings();',
        "await saveConfig('discount_trigger_rules', normalizedConfig);",
        "const requestUrl = `/api/admin/settings/discount-trigger-options?site=${encodeURIComponent(site)}`;",
        "setupDiscountTriggerSettingsEventListeners();",
        'window.handleDiscountTriggerSectionToggle = handleDiscountTriggerSectionToggle;',
        'window.handleDiscountTriggerAddRule = handleDiscountTriggerAddRule;',
        'window.handleDiscountTriggerApplyPreset = handleDiscountTriggerApplyPreset;',
        'window.handleDiscountTriggerRemoveRule = handleDiscountTriggerRemoveRule;',
        'window.handleDiscountTriggerSave = handleDiscountTriggerSave;',
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
    assert.match(
        studioJs,
        /case 'settings-toggle-discount-trigger-section':[\s\S]*window\.handleDiscountTriggerSectionToggle\?\.\([\s\S]*actionEl\.dataset\.discountTriggerSection,[\s\S]*actionEl[\s\S]*\);[\s\S]*break;/,
        'admin-studio.js should delegate discount trigger section switch clicks through the global action router'
    );
    assert.match(
        studioJs,
        /case 'settings-add-discount-trigger-rule':[\s\S]*window\.handleDiscountTriggerAddRule\?\.\([\s\S]*actionEl\.dataset\.discountTriggerSection,[\s\S]*actionEl[\s\S]*\);[\s\S]*break;/,
        'admin-studio.js should delegate discount trigger add-rule clicks through the global action router'
    );
    assert.match(
        studioJs,
        /case 'settings-apply-discount-trigger-preset':[\s\S]*window\.handleDiscountTriggerApplyPreset\?\.\([\s\S]*actionEl\.dataset\.discountTriggerSection,[\s\S]*actionEl\.dataset\.discountTriggerPreset,[\s\S]*actionEl[\s\S]*\);[\s\S]*break;/,
        'admin-studio.js should delegate discount trigger preset clicks through the global action router'
    );
    assert.match(
        studioJs,
        /case 'settings-remove-discount-trigger-rule':[\s\S]*window\.handleDiscountTriggerRemoveRule\?\.\(actionEl\);[\s\S]*break;/,
        'admin-studio.js should delegate discount trigger remove-rule clicks through the global action router'
    );
    assert.match(
        studioJs,
        /case 'settings-save-discount-trigger-rules':[\s\S]*void window\.handleDiscountTriggerSave\?\.\(actionEl\);[\s\S]*break;/,
        'admin-studio.js should delegate discount trigger save clicks through the global action router'
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
    assert.match(
        css,
        /\.discount-trigger-preset-btn\.btn-add-config--compact:is\(:hover, :focus, :focus-visible, :focus-within, :active, \.active, \.is-active, \.is-focused, \.selected, \.is-pressed\) \{[\s\S]*border-color:\s*transparent !important;[\s\S]*border-style:\s*none !important;[\s\S]*outline:\s*none !important;[\s\S]*box-shadow:\s*none !important;[\s\S]*transform:\s*none !important;[\s\S]*filter:\s*none !important;[\s\S]*will-change:\s*auto !important;/,
        'admin-studio.css should keep discount trigger preset buttons from moving under generic hover and pressed states'
    );
    assert.match(
        pageCss,
        /\.discount-trigger-preset-btn\.btn-add-config--compact:is\(:hover, :focus-visible, :active, \.is-pressed\) \{[\s\S]*transform:\s*none !important;[\s\S]*filter:\s*none !important;[\s\S]*box-shadow:\s*none !important;[\s\S]*will-change:\s*auto !important;/,
        'admin-studio-page.css should keep discount trigger preset button shells layout-stable on hover'
    );
    assert.match(
        pageCss,
        /html\[data-theme="light"\] #settings-view-pricing \.discount-trigger-preset-btn\.btn-add-config--compact:is\(:hover, :focus-visible, :active, \.is-pressed\),[\s\S]*html:not\(\[data-theme="dark"\]\) #settings-view-pricing \.discount-trigger-preset-btn\.btn-add-config--compact:is\(:hover, :focus-visible, :active, \.is-pressed\) \{[\s\S]*background:\s*transparent !important;[\s\S]*box-shadow:\s*none !important;[\s\S]*transform:\s*none !important;[\s\S]*filter:\s*none !important;/,
        'admin-studio-page.css should override later light-theme generic button hover styles for discount trigger presets'
    );
    assert.match(
        pageCss,
        /#module-settings #settings-view-pricing \.discount-trigger-preset-btn\.btn-add-config--compact,[\s\S]*#module-settings #settings-view-pricing \.discount-trigger-preset-btn\.btn-add-config--compact:is\(:hover, :focus, :focus-visible, :focus-within, :active, \.active, \.is-active, \.is-focused, \.selected, \.is-pressed\) \{[\s\S]*border:\s*0 !important;[\s\S]*border-color:\s*transparent !important;[\s\S]*border-style:\s*none !important;[\s\S]*outline:\s*none !important;[\s\S]*background:\s*transparent !important;[\s\S]*box-shadow:\s*none !important;[\s\S]*transition:\s*none !important;[\s\S]*will-change:\s*auto !important;/,
        'admin-studio-page.css should keep the discount trigger preset button shell from drawing a second hover or focus border'
    );
    assert.match(
        pageCss,
        /\.discount-trigger-preset-btn__surface \{[\s\S]*transform:\s*none !important;[\s\S]*transition:\s*border-color 0\.2s ease, background 0\.2s ease, box-shadow 0\.2s ease !important;[\s\S]*\.discount-trigger-preset-btn\.btn-add-config--compact:active \.discount-trigger-preset-btn__surface,[\s\S]*\.discount-trigger-preset-btn\.btn-add-config--compact\.is-pressed \.discount-trigger-preset-btn__surface \{[\s\S]*transform:\s*none !important;/,
        'admin-studio-page.css should not translate or scale the preset card surface during hover or pressed feedback'
    );
    assert.match(
        pageCss,
        /20260605_DISCOUNT_TRIGGER_ACTION_BUTTON_CLICKABLE_1[\s\S]*\[data-admin-action="settings-add-discount-trigger-rule"\][\s\S]*\[data-admin-action="settings-remove-discount-trigger-rule"\][\s\S]*\[data-admin-action="settings-save-discount-trigger-rules"\][\s\S]*pointer-events:\s*auto !important;[\s\S]*cursor:\s*pointer !important;[\s\S]*-webkit-text-fill-color:/,
        'admin-studio-page.css should keep discount trigger action buttons readable and clickable'
    );
    assert.match(
        pageCss,
        /html\[data-theme="light"\] #settings-view-pricing \.discount-trigger-rule-card :is\([\s\S]*\.discount-trigger-rule-field > span,[\s\S]*\.discount-trigger-check,[\s\S]*\.discount-trigger-check span[\s\S]*\),[\s\S]*html:not\(\[data-theme="dark"\]\) #settings-view-pricing \.discount-trigger-rule-card :is\([\s\S]*\.discount-trigger-rule-field > span,[\s\S]*\.discount-trigger-check,[\s\S]*\.discount-trigger-check span[\s\S]*\) \{[\s\S]*color:\s*rgba\(51, 65, 85, 0\.9\) !important;[\s\S]*-webkit-text-fill-color:\s*rgba\(51, 65, 85, 0\.9\) !important;/,
        'admin-studio-page.css should keep discount trigger rule labels and checkbox text readable in light mode'
    );
    assert.match(
        pageCss,
        /html\[data-theme="light"\] #settings-view-pricing \.discount-trigger-rule-card :is\([\s\S]*\.config-input,[\s\S]*\.discount-trigger-native-select,[\s\S]*\.discount-trigger-dropdown \.dropdown-trigger,[\s\S]*\.discount-trigger-dropdown \.dropdown-value[\s\S]*\),[\s\S]*html:not\(\[data-theme="dark"\]\) #settings-view-pricing \.discount-trigger-rule-card :is\([\s\S]*\.config-input,[\s\S]*\.discount-trigger-native-select,[\s\S]*\.discount-trigger-dropdown \.dropdown-trigger,[\s\S]*\.discount-trigger-dropdown \.dropdown-value[\s\S]*\) \{[\s\S]*color:\s*#0f172a !important;[\s\S]*-webkit-text-fill-color:\s*#0f172a !important;/,
        'admin-studio-page.css should keep discount trigger rule inputs and dropdown values readable in light mode'
    );
    assert.match(
        css,
        /\.status-toggle \{[\s\S]*appearance:\s*none;[\s\S]*-webkit-appearance:\s*none;[\s\S]*border:\s*0;[\s\S]*pointer-events:\s*auto;/,
        'admin-studio.css should reset status toggle buttons so discount trigger switches remain clickable'
    );

    const requiredSmokeMarkers = [
        "/api/admin/settings/discount-trigger-options",
        "url.pathname === '/api/admin/settings/system-config'",
        "distribution_mode: 'user_assigned'",
        'matchesSmokeSiteScope(row?.applicable_site, site)',
        'async function runDiscountTriggerSettingsSmoke() {',
        "'卡券联动三段配置已渲染'",
        "'卡券联动推荐模板已渲染'",
        "'卡券联动模板说明和候选提示已渲染'",
        "'卡券联动添加规则按钮会按段落新增草稿'",
        "'卡券联动删除规则按钮会按段落移除草稿'",
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
