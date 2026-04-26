const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin studio keeps the website light theme as an explicit data-theme state', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');

    assert.match(
        adminStudioSource,
        /setAttribute\('data-theme', nextTheme\)/,
        'admin studio should write an explicit light/dark data-theme value instead of relying on a missing attribute'
    );
    assert.equal(
        adminStudioSource.includes("removeAttribute('data-theme')"),
        false,
        'admin studio should not remove data-theme for light mode because light-specific CSS selectors depend on it'
    );
    assert.match(
        adminStudioSource,
        /savedTheme === 'dark' \|\| savedTheme === 'light'/,
        'admin studio should honor both saved website theme values'
    );
});

test('admin studio has a light-theme bridge for legacy dark admin surfaces', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const chatStylesSource = readRepoFile(path.join('css', 'admin-chat.css'));

    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_BRIDGE_1'),
        true,
        'admin studio styles should include the light theme bridge marker'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] body'),
        true,
        'admin studio light bridge should target the explicit website light theme'
    );
    assert.equal(
        stylesSource.includes('.shop-custom-select__trigger'),
        true,
        'admin studio light bridge should cover custom selects that were authored with dark inline styles'
    );
    assert.equal(
        stylesSource.includes('.admin-command-center'),
        true,
        'admin studio light bridge should cover the command center dock and panel'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_POLISH_1'),
        true,
        'admin studio styles should include the light theme polish layer'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_POLISH_1') > stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_BRIDGE_1'),
        true,
        'admin studio light polish layer should load after the broad bridge so it can override the earlier gradient'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"],\nhtml[data-theme="light"] body,\nhtml[data-theme="light"] .admin-main-content,\nhtml[data-theme="light"] .admin-access-screen {\n    background: #ffffff !important;'),
        true,
        'admin studio light theme should use a pure white page background instead of a page gradient'
    );
    assert.equal(
        stylesSource.includes('backdrop-filter: blur(18px) saturate(145%) !important;'),
        true,
        'admin studio light theme should preserve frosted glass blur on light surfaces'
    );
    assert.equal(
        stylesSource.includes('.shop-admin-product-title'),
        true,
        'admin studio light theme should explicitly restore product-card title contrast'
    );
    assert.equal(
        stylesSource.includes('.filter-tab'),
        true,
        'admin studio light theme should explicitly restore product category filter contrast'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_POLISH_2'),
        true,
        'admin studio styles should include the second light polish layer for remaining dark admin surfaces'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #discountGenerateModal .admin-discount-form-modal__header'),
        true,
        'admin studio light theme should cover the discount editor modal header'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-security :is('),
        true,
        'admin studio light theme should cover the security settings and audit monitor cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery .admin-card-site-metric'),
        true,
        'admin studio light theme should cover prompt manage card site metrics'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery .admin-card-media-skeleton'),
        true,
        'admin studio light theme should cover prompt manage skeleton cards'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SYSTEMIC_1'),
        true,
        'admin studio styles should include the systemic light theme layer for component families beyond the first screenshots'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings :is('),
        true,
        'admin studio light theme should cover settings family surfaces such as Google One API'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-ops-alerts :is('),
        true,
        'admin studio light theme should cover ops alert family cards, panels, rows, and templates'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-payments :is('),
        true,
        'admin studio light theme should cover payments family charts, trend panels, tables, and anomaly cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-points :is('),
        true,
        'admin studio light theme should cover points management batch and catalog surfaces'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-homepage :is('),
        true,
        'admin studio light theme should cover homepage editor surfaces and generated list cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(.admin-table, .users-table, .payments-table, .payments-business-table, .points-catalog-table, .shop-table, .codes-table) th'),
        true,
        'admin studio light theme should normalize table headers that were authored as dark navy blocks'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_BALANCE_1'),
        true,
        'admin studio styles should include the light theme balance layer that reduces card lift and heavy shadows'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-light-glass-shadow: 0 6px 18px rgba(15, 23, 42, 0.045);'),
        true,
        'admin studio light theme should lower the shared glass shadow scale'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-skeleton-panel-bg: rgba(255, 255, 255, 0.72);'),
        true,
        'admin studio light theme should override dark skeleton panel variables'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-ops-alerts :is(\n    .ops-alert-channel-card'),
        true,
        'admin studio light theme should cover ops alert channel, workspace, monitor, and health sub-surfaces'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    .payments-kpi-card-skeleton'),
        true,
        'admin studio light theme should cover payments and analytics skeleton panels'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-comments :is(\n    .comment-admin-item--skeleton'),
        true,
        'admin studio light theme should cover comment and guestbook skeleton cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery :is(\n    .admin-card,'),
        true,
        'admin studio light theme should use module-level overrides to reduce prompt card lift despite earlier high-specificity rules'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #discountGenerateModal .admin-discount-form-modal__dialog'),
        true,
        'admin studio light theme should reduce heavy modal shadows from earlier light-theme polish rules'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_INTERACTION_1'),
        true,
        'admin studio styles should include the light interaction layer that disables floating hover cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    [class*="-card"],'),
        true,
        'admin studio light theme should broadly prevent card and panel hover transforms'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .admin-tab.active'),
        true,
        'admin studio light theme should flatten module navigation tabs instead of rendering them as floating cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #settings-view-pricing :is(\n    .settings-package-shortcut,'),
        true,
        'admin studio light theme should cover pricing settings shortcuts and discount trigger panels'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #settings-view-general :is(\n    .settings-section,'),
        true,
        'admin studio light theme should cover the general settings API relay panel'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-homepage :is(\n    .hp-control-bar,'),
        true,
        'admin studio light theme should restore homepage editor surface and label contrast'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_BLUE_UNIFY_1'),
        true,
        'admin studio styles should include the light blue unification layer'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-ui-blue: #769dca;'),
        true,
        'admin studio light theme should use the coupon UI blue sampled from the reference'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .admin-tab,\nhtml[data-theme="light"] .admin-main-content .admin-tab:is(:hover, :focus-visible, .active)'),
        true,
        'admin studio light theme should remove the rectangular active tab fill and keep only the indicator'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-discounts .filter-dropdowns .filter-btn:is(:hover, :focus, :focus-visible, .active)'),
        true,
        'discount status filter chips should highlight their border when focused or selected'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_USER_MODAL_1'),
        true,
        'admin studio styles should include the user modal light theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(\n    .user-modal,'),
        true,
        'admin studio light theme should cover the user detail modal surface'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal-right .user-tab-btn.active'),
        true,
        'user detail modal tabs should keep readable active text in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .users-coupon-summary-card:is(:hover, :focus-visible, .is-active)'),
        true,
        'user detail coupon summary cards should focus without a lifted active card'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(\n    .modal-loading--skeleton,'),
        true,
        'admin studio light theme should cover modal skeleton loading panels'
    );
    assert.equal(
        stylesSource.includes('.user-modal .users-tab-skeleton-card'),
        true,
        'admin studio light theme should cover user detail tab skeleton cards'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_NO_LIFT_1'),
        true,
        'admin studio styles should include the light theme no-lift interaction layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-comments :is(\n    .stat-badge,'),
        true,
        'comments management filters and queue chips should be covered by the no-lift layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-comments .filter-dropdown.open .filter-btn'),
        true,
        'comments management open filter buttons should focus without lifted shadows'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(\n    #module-settings,\n    #module-ops-alerts\n) :is(\n    .settings-section,'),
        true,
        'settings and ops alert cards should be covered by the no-lift layer'
    );
    assert.equal(
        stylesSource.includes('.payment-provider-accordion.active-provider'),
        true,
        'payment channel active cards should keep focus styling without hover lift'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SECURITY_DROPDOWN_STACK_1'),
        true,
        'admin studio styles should include the security dropdown stack fix'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-security .security-setting-card:has(.custom-dropdown.open)'),
        true,
        'security setting dropdown cards should rise above following cards while open'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-security .security-subcards-grid'),
        true,
        'security setting dropdown stack fix should keep lower cards behind open dropdowns'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_PRODUCT_ANALYTICS_1'),
        true,
        'admin studio styles should include the product analytics light theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-analytics :is(\n    #analytics-tab-product .chart-card,'),
        true,
        'product analytics cards and shells should use light surfaces in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-analytics :is(\n    .analytics-product-dashboard--skeleton,'),
        true,
        'product analytics loading skeletons should be explicitly covered in light mode'
    );
    assert.equal(
        stylesSource.includes('.analytics-product-detail__surface,'),
        true,
        'product detail surfaces should be covered so they do not keep dark panels in light mode'
    );
    assert.equal(
        stylesSource.includes('.analytics-operating-focus__action-card,\n    .analytics-product-alert-card,'),
        true,
        'product and operating focus cards should keep focus styling without hover lift'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_ANALYTICS_SCOPE_FIX_1'),
        true,
        'admin studio styles should include the analytics scope fix layer for the real business overview module root'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-business-overview :is(\n    .analytics-business-center-shell,'),
        true,
        'light theme analytics overrides should target the real business overview module container'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-business-overview .analytics-operating-focus__action-card:is(:hover, :focus-visible)'),
        true,
        'current operating focus cards should explicitly cancel hover lift inside the real analytics module root'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_ANALYTICS_FLAT_DEPTH_1'),
        true,
        'admin studio styles should include the analytics flat-depth layer for overview cards in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-business-overview :is(\n    .glass-panel,'),
        true,
        'analytics light theme should flatten the business overview shell panels'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-business-overview :is(\n    .kpi-card,'),
        true,
        'analytics light theme should flatten KPI, navigator, duty, and focus cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-business-overview .kpi-card:hover,'),
        true,
        'analytics light theme should explicitly cancel KPI and quick-action hover lift'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_GROWTH_CENTER_FLAT_DEPTH_1'),
        true,
        'admin studio styles should include the growth center flat-depth layer for split analytics hosts'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-growth-center :is(\n    .glass-panel,'),
        true,
        'growth center light theme should flatten shell panels in its real sidebar host'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-growth-center :is(\n    .glass-panel,\n    .chart-card,\n    .kpi-card,'),
        true,
        'growth center light theme should flatten KPI, navigator, duty, and operating focus cards'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_GROWTH_CENTER_SKELETON_MARKETING_1'),
        true,
        'admin studio styles should include the growth center skeleton and marketing asset light layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-growth-center :is(\n    .analytics-product-dashboard--skeleton,'),
        true,
        'growth center light theme should cover analytics skeleton panels in the split host'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-growth-center :is(\n    .marketing-asset-center__summary-card,'),
        true,
        'growth center light theme should restyle marketing asset center cards'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_COMMERCE_CENTER_FLAT_DEPTH_1'),
        true,
        'admin studio styles should include the commerce center flat-depth layer for split analytics hosts'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-commerce-center :is(\n    .glass-panel,'),
        true,
        'commerce center light theme should flatten shell panels in its real sidebar host'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-commerce-center :is(\n    .glass-panel,\n    .chart-card,\n    .kpi-card,'),
        true,
        'commerce center light theme should flatten KPI, navigator, product, and operating focus cards'
    );
    assert.equal(
        stylesSource.includes('.analytics-product-alert-card__digest,'),
        true,
        'commerce center light theme should include product nested cards in the no-lift coverage'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_COMMERCE_CENTER_PRODUCT_DETAIL_1'),
        true,
        'admin studio styles should include the commerce center product detail light surface layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-commerce-center :is(\n    .analytics-product-detail-panel-shell,'),
        true,
        'commerce center product detail shells should use light surfaces in the split host'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-commerce-center :is(\n    .analytics-product-dashboard--skeleton,'),
        true,
        'commerce center loading skeletons should be explicitly covered in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-commerce-center :is(\n    .analytics-product-detail__surface-title,'),
        true,
        'commerce center product detail text should be restored to light-theme contrast'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_COMMERCE_CENTER_HOVER_FLAT_1'),
        true,
        'commerce center structural cards should keep a flat hover state in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-commerce-center :is(\n    .analytics-product-detail__surface,\n    .analytics-product-detail-section,\n    .analytics-product-detail-card,'),
        true,
        'commerce center structural detail blocks should not use the interactive blue hover fill'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_ANALYTICS_OPS_FLAT_DEPTH_1'),
        true,
        'admin studio styles should include the split-host ops cockpit flat-depth layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(\n    #module-business-overview,\n    #module-growth-center,\n    #module-commerce-center\n) :is(\n    .analytics-ops-cockpit__overview,'),
        true,
        'ops cockpit panels should be flattened in every split analytics host'
    );
    assert.equal(
        stylesSource.includes('.analytics-ops-cockpit__issue-card,\n    .analytics-writeback-note,'),
        true,
        'ops cockpit issue and writeback cards should be included in no-lift coverage'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_LOADING_SKELETON_2'),
        true,
        'admin studio styles should include the light loading skeleton layer'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-light-loading-panel-border: rgba(100, 116, 139, 0.14);'),
        true,
        'light loading skeletons should keep enough visible contrast on white cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .chart-body .loading-text,'),
        true,
        'generic chart loading text skeletons should be restyled for light mode'
    );
    assert.equal(
        stylesSource.includes('.analytics-operating-focus__body,\n    .analytics-chart-pane,\n    .analytics-detail-pane\n) > .loading-text'),
        true,
        'analytics split-host loading placeholders should use the light skeleton treatment'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_POINTS_VISIBILITY_1'),
        true,
        'admin studio styles should include the points management light visibility layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .admin-tab-indicator'),
        true,
        'light theme tabs should hide the duplicate sliding indicator and keep one active underline'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-points .points-batch-quick-filter__count'),
        true,
        'points batch quick filter counts should remain readable in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-points :is(#points-view-batches .admin-table, .points-catalog-table) th'),
        true,
        'points batch and package tables should restore light-theme table header contrast'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SHOP_CARD_HOVER_1'),
        true,
        'admin studio styles should include the shop card hover and tab visibility layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop .shop-tabs'),
        true,
        'shop tabs should be explicitly restyled so their labels stay readable in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop .shop-tab.active::after'),
        true,
        'shop tabs should use a single active underline instead of inheriting the dark inline border'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop :is(.shop-card, .shop-admin-product-card):not(.shop-admin-product-card--skeleton):not(.shop-admin-product-card--skeleton-create):hover'),
        true,
        'shop product cards should use the same subtle hover pattern as comment cards in light mode'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SHOP_SUBVIEW_LIGHT_1'),
        true,
        'admin studio styles should include the shop subview light theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop :is(\n    .shop-product-toolbar-shell,'),
        true,
        'shop search and filter toolbar shells should be flattened in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop :is(\n    .import-sidebar,'),
        true,
        'shop import, inventory, orders, and fulfillment panels should be explicitly light-themed'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop :is(\n    .shop-product-toolbar-search-box,'),
        true,
        'shop search inputs should use flat light controls instead of floating glass shadows'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop :is(\n    .shop-delivery-tone--success,'),
        true,
        'shop fulfillment status tones should be remapped for light mode'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SHOP_READABILITY_1'),
        true,
        'admin studio styles should include the shop readability light theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop .shop-delivery-field label'),
        true,
        'shop API fulfillment field labels should stay readable in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop :is(\n    .shop-delivery-subcard-meta.shop-delivery-subcard-meta--rich,'),
        true,
        'shop fulfillment rich summaries should not inherit the blue badge panel background'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-orders .shop-order-row--focused td'),
        true,
        'shop order focused rows should keep readable foreground colors in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .shop-order-content-modal,\nhtml[data-theme="light"] .shop-order-detail-modal'),
        true,
        'shop order detail modal should restore light surface contrast'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .shop-order-detail-modal :is(\n    .shop-order-detail-user,'),
        true,
        'shop order detail modal panels should not keep dark-card styling in light mode'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_TICKETS_READABILITY_1'),
        true,
        'admin studio styles should include the tickets readability light theme layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_LEGACY_DARK_SURFACES_1'),
        true,
        'admin studio styles should include the broader legacy dark surface light theme layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_POINTS_BATCH_MODALS_1'),
        true,
        'admin studio styles should include the points batch modal light theme layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SUBTLE_PLACEHOLDERS_1'),
        true,
        'admin studio styles should include the subtle placeholder light theme layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SUBTLE_HINT_TEXT_1'),
        true,
        'admin studio styles should include the subtle hint text light theme layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_COMMENT_DETAIL_DRAWER_1'),
        true,
        'admin studio styles should include the comment detail drawer light theme layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_MUTED_BLUEGRAY_BACKDROPS_2'),
        true,
        'admin studio styles should include the light-theme muted blue-gray modal backdrop layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_RISK_COMPOSER_1'),
        true,
        'admin studio styles should include the risk composer light surface layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_REMAINING_SURFACES_1'),
        true,
        'admin studio styles should include the remaining light surface cleanup layer'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_STATIC_HOVER_FLAT_1'),
        true,
        'admin studio styles should include the static hover flattening layer for non-interactive light surfaces'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_CARD_TITLEBARS_3'),
        true,
        'admin studio styles should include the light card titlebar color layer'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-light-titlebar-bg: #d4e3f1;'),
        true,
        'light card titlebars should use a solid deeper shared blue-tinted titlebar background'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-light-card-hover-border: rgba(var(--admin-studio-ui-blue-rgb, 118, 157, 202), 0.58);'),
        true,
        'light cards should expose a shared hover border color'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    .glass-panel > .section-title,'),
        true,
        'light card titlebar layer should start from the same titlebar scope as the dark card header definition'
    );
    assert.equal(
        stylesSource.includes('    .ops-alert-strategy-panel__header,'),
        true,
        'ops alert strategy titlebars should be included in the unified titlebar color layer'
    );
    assert.equal(
        stylesSource.includes('    .points-catalog-list-shell__header,'),
        true,
        'points catalog titlebars should be included in the unified titlebar color layer'
    );
    assert.equal(
        stylesSource.includes('    #module-homepage .hp-analytics-module-card__head,'),
        true,
        'homepage card titlebars should be included in the unified titlebar color layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .config-card-header[data-admin-action="settings-toggle-config-card"]:hover .config-card-arrow'),
        true,
        'collapsible config card titlebars should not introduce a distinct hover effect on the arrow in light mode'
    );
    assert.equal(
        stylesSource.includes('button[class*="title"],\n    button[class*="headline"],'),
        true,
        'titlebar hover cleanup should target title-like buttons without flattening normal titlebar action buttons'
    );
    assert.equal(
        stylesSource.includes('text-decoration: none !important;\n    text-shadow: none !important;\n    transform: none !important;'),
        true,
        'titlebar titles should not keep link-like hover decoration, glow, or lift in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    .glass-panel,\n    .settings-section,\n    .users-table-panel,'),
        true,
        'light card hover border should cover broad admin studio card and panel surfaces'
    );
    assert.equal(
        stylesSource.includes('border-color: var(--admin-studio-light-card-hover-border) !important;\n    box-shadow: inset 0 0 0 1px var(--admin-studio-light-card-hover-outline) !important;'),
        true,
        'light card hover should highlight the border without adding a lifted outer shadow'
    );
    assert.equal(
        stylesSource.includes('[class*="-card__"],'),
        true,
        'light card hover should not treat BEM card child text such as card__value as whole cards'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SETTINGS_HOVER_FLAT_1'),
        true,
        'admin studio styles should include the Google One and security settings hover flattening layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-google-one :is(\n    .settings-google-one-hero,\n    .settings-google-one-card,\n    .verify-monitor-card,\n    .verify-monitor-list-card,\n    .verify-monitor-fact-card\n):is(:hover, :focus-within)'),
        true,
        'Google One cards should receive the unified light card hover border'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-google-one :is(\n    .settings-google-one-top-grid,\n    .settings-google-one-monitor-grid,\n    .settings-google-one-monitor-columns,'),
        true,
        'Google One columns, rows, and list interiors should be explicitly flattened on hover'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-security :is(\n    .security-setting-card,\n    .security-subcard,\n    .admin-audit-monitor-card,\n    .admin-audit-monitor-panel\n):is(:hover, :focus-within)'),
        true,
        'security settings cards should receive the unified light card hover border'
    );
    assert.equal(
        stylesSource.includes('.security-setting-card .config-label > span,\n    .security-setting-card .config-hint,'),
        true,
        'security setting titles and hint text should be protected from text-box hover artifacts'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings :is(\n    .settings-section,\n    .config-card,\n    .config-row,'),
        true,
        'settings static cards and config rows should be covered by the light static hover layer'
    );
    assert.equal(
        stylesSource.includes('    .settings-google-one-hero,\n    .settings-google-one-card,\n    .verify-monitor-card,'),
        true,
        'Google One and verify monitor static cards should be covered by hover flattening'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-google-one :is(\n    .settings-google-one-hero,'),
        true,
        'Google One high-specificity hover rules should be overridden in the final flat layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #settings-view-pricing .config-row:is(:hover, :focus-within)'),
        true,
        'pricing reward rows should not inherit card-style hover lift when hovered or focused'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_SETTINGS_CARDS_NO_LIFT_1'),
        true,
        'admin studio styles should include the settings cards no-lift light theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-security :is(\n    .security-setting-card,\n    .security-subcard\n):is(:hover, :focus-within, :active)'),
        true,
        'security setting cards should not use lifted hover treatment in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings :is(\n    .settings-section,\n    .config-card,\n    .settings-package-shortcut,'),
        true,
        'settings family static cards should share the no-lift cleanup'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-ops-alerts :is(\n    .ops-alert-overview-card,'),
        true,
        'ops alert structural cards should be included in static hover flattening'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-points :is(\n    .points-package-editor-shell,'),
        true,
        'points management structural cards should be included in static hover flattening'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(\n    .user-modal .users-coupon-summary-card,'),
        true,
        'user modal summary cards should not keep floating hover shadows in light mode'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_SUBTLE_PLACEHOLDERS_1') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_POINTS_BATCH_MODALS_1'),
        true,
        'subtle placeholder cleanup should load after points modal rules so hints stay muted'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_SUBTLE_HINT_TEXT_1') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_SUBTLE_PLACEHOLDERS_1'),
        true,
        'subtle hint text cleanup should load after placeholder cleanup and module-specific hint colors'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_COMMENT_DETAIL_DRAWER_1') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_SUBTLE_HINT_TEXT_1'),
        true,
        'comment detail drawer cleanup should load after shared light-theme hint cleanup'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_MUTED_BLUEGRAY_BACKDROPS_2') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_COMMENT_DETAIL_DRAWER_1'),
        true,
        'muted blue-gray modal backdrops should load after drawer and modal-specific light surface cleanup'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_RISK_COMPOSER_1') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_MUTED_BLUEGRAY_BACKDROPS_2'),
        true,
        'risk composer cleanup should load after the shared backdrop layer so its high-specificity modal rules stay light'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_REMAINING_SURFACES_1') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_RISK_COMPOSER_1'),
        true,
        'remaining surface cleanup should load after risk composer fixes so late high-specificity dark rules are neutralized'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_STATIC_HOVER_FLAT_1') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_REMAINING_SURFACES_1'),
        true,
        'static hover flattening should load last so late module hover rules cannot reintroduce lifted static cards'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_CARD_TITLEBARS_3') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_STATIC_HOVER_FLAT_1'),
        true,
        'card titlebar color, title hover cleanup, and card hover border should load after the static hover flattening layer'
    );
    assert.equal(
        stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_SETTINGS_CARDS_NO_LIFT_1') >
            stylesSource.indexOf('20260424_ADMIN_STUDIO_LIGHT_THEME_CARD_TITLEBARS_3'),
        true,
        'settings cards no-lift cleanup should load after shared card titlebar hover borders'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-tickets .admin-ticket-function-tab'),
        true,
        'tickets workspace tabs should stay readable in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-tickets .glass-panel.users-table-panel'),
        true,
        'tickets table panel should use an explicit light surface'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-tickets .users-table tbody tr.admin-ticket-row:hover'),
        true,
        'tickets table row hover should remain subtle and readable in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-tickets .admin-ticket-secondary-badge--user_ticket'),
        true,
        'tickets source and issue badges should be remapped for light mode contrast'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(\n    .admin-ticket-reply-modal > .admin-ticket-reply-modal__panel,'),
        true,
        'tickets reply and summary modals should restore light surface contrast'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    .admin-workbench-context-note,'),
        true,
        'shared workbench context notes should not keep dark surfaces in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .comment-detail-drawer__backdrop'),
        true,
        'comment detail drawer backdrop should receive an explicit light-theme overlay'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-modal-backdrop: rgba(34, 41, 52, 0.48);'),
        true,
        'light theme modal and drawer backdrops should use a restrained blue-gray base'
    );
    assert.equal(
        stylesSource.includes('backdrop-filter: blur(12px) saturate(106%) !important;'),
        true,
        'light theme modal and drawer backdrops should keep a softer blur over the restrained blue-gray base'
    );
    assert.equal(
        stylesSource.includes('overscroll-behavior: contain !important;'),
        true,
        'light theme modal and drawer backdrops should contain scroll chaining'
    );
    assert.equal(
        adminStudioSource.includes("'.comment-detail-drawer.is-open',"),
        true,
        'comment detail drawer should participate in admin studio background scroll locking'
    );
    assert.equal(
        adminStudioSource.includes("'.admin-discount-detail-overlay.is-visible',"),
        true,
        'discount detail overlays should participate in admin studio background scroll locking'
    );
    assert.equal(
        adminStudioSource.includes("'.admin-shop-risk-case-modal.is-visible',"),
        true,
        'settings risk case overlays should participate in admin studio background scroll locking'
    );
    assert.equal(
        stylesSource.includes('    .comment-detail-drawer__backdrop'),
        true,
        'the unified soft backdrop layer should include the comment detail drawer backdrop'
    );
    assert.equal(
        stylesSource.includes('    .user-modal-overlay,'),
        true,
        'the unified soft backdrop layer should include user detail modals'
    );
    assert.equal(
        stylesSource.includes('    .shop-order-content-overlay,'),
        true,
        'the unified soft backdrop layer should include shop order popups'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .comment-detail-drawer__panel'),
        true,
        'comment detail drawer panel should not keep dark surface styling in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .comment-detail-drawer :is(\n    .comment-detail-drawer__section,'),
        true,
        'comment detail drawer internal cards should be remapped to readable light surfaces'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .comment-detail-note-input'),
        true,
        'comment detail drawer note input should be readable in light mode'
    );
    assert.equal(
        stylesSource.includes('    .admin-ticket-overview-reminder-section--status,'),
        true,
        'tickets SLA reminder panels should be covered by the legacy dark surface cleanup'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #shopRiskCaseComposerModal .admin-shop-risk-case-modal__dialog'),
        true,
        'ops alert risk composer dialog should override its id-scoped dark surface in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #shopRiskCaseComposerModal .admin-shop-risk-case-modal__field .shop-custom-select__trigger'),
        true,
        'ops alert risk composer custom select trigger should not keep the dark field background in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #opsAlertBatchMuteModal .admin-shop-risk-case-modal__dialog'),
        true,
        'ops alert batch mute modal should share the light risk modal surface treatment'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop :is(#shop-view-orders, #shop-view-fulfillment) .shop-table tbody tr'),
        true,
        'shop order and fulfillment mobile card rows should not keep dark card backgrounds in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-affiliate .affiliate-poster-card:not(.active):hover'),
        true,
        'affiliate poster card hover should override the id-scoped dark hover border in light mode'
    );
    assert.equal(
        stylesSource.includes('    .analytics-ops-cockpit__overview,'),
        true,
        'analytics cockpit panels should be covered by the legacy dark surface cleanup'
    );
    assert.equal(
        stylesSource.includes('    .shop-delivery-panel,'),
        true,
        'shop delivery panels should be covered by the legacy dark surface cleanup'
    );
    assert.equal(
        stylesSource.includes('#discountDetailOverlay .admin-discount-detail-dialog'),
        true,
        'discount detail overlays should restore light surface contrast'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(.edit-modal-overlay, .codes-modal-overlay, .batch-modal-overlay)'),
        true,
        'points modal overlays should use an explicit softened dark overlay in light mode'
    );
    assert.equal(
        stylesSource.includes('    .edit-modal--batch .points-batch-edit-aside,'),
        true,
        'points batch edit modal panels should not keep dark-card styling in light mode'
    );
    assert.equal(
        stylesSource.includes('    .points-batch-edit-overview-card,'),
        true,
        'points batch edit overview cards should be remapped to light surfaces'
    );
    assert.equal(
        stylesSource.includes('    .codes-modal--batch .points-batch-codes-hero,'),
        true,
        'points batch detail modal should share the light modal surface cleanup'
    );
    assert.equal(
        stylesSource.includes('-webkit-text-fill-color: rgba(100, 116, 139, 0.4) !important;'),
        true,
        'light theme modal placeholders should not inherit the main input text fill color'
    );
    assert.equal(
        stylesSource.includes('font-size: min(0.9em, 13px) !important;'),
        true,
        'light theme help text should be visually smaller than primary content'
    );
    assert.equal(
        chatStylesSource.includes('20260424_ADMIN_CHAT_LIGHT_THEME_FLAT_DUTY_CONTEXT_1'),
        true,
        'admin chat styles should include the flat light-theme duty/context layer'
    );
    assert.equal(
        chatStylesSource.includes('html[data-theme="light"] #module-chat .chat-sidebar-insights'),
        true,
        'admin chat light theme should explicitly restyle the duty overview panel'
    );
    assert.equal(
        chatStylesSource.includes('html[data-theme="light"] #module-chat :is(\n    .user-context-shell,\n    .chat-reply-templates,\n    .chat-context-panel__state\n)'),
        true,
        'admin chat light theme should flatten user 360 and quick reply panels'
    );
    assert.equal(
        chatStylesSource.includes('box-shadow: none !important;'),
        true,
        'admin chat light theme should remove floating card shadows from contextual panels'
    );
    assert.equal(
        chatStylesSource.includes('20260426_ADMIN_CHAT_LIGHT_THEME_FROSTED_CONTEXT_FLAT_ALERTS_2'),
        true,
        'admin chat styles should restore frosted context panels while keeping them flat'
    );
    assert.equal(
        chatStylesSource.includes('backdrop-filter: blur(22px) saturate(150%) !important;'),
        true,
        'user 360 and quick reply panels should keep a light frosted texture'
    );
    assert.equal(
        chatStylesSource.includes('html[data-theme="light"] #module-chat .admin-alert-toolbar'),
        true,
        'admin chat light theme should flatten the ops alert filter scope toolbar'
    );
    assert.equal(
        chatStylesSource.includes('position: static !important;'),
        true,
        'ops alert filter scope toolbar should not stay sticky/floating in light mode'
    );
    assert.equal(
        chatStylesSource.includes('.chat-search input::placeholder,\n    .chat-input::placeholder'),
        true,
        'admin chat light theme should keep chat input placeholder text subdued'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('css/admin-studio-page.css?v=20260424_ADMIN_LIGHT_THEME_SETTINGS_CARDS_NO_LIFT_1'),
        true,
        'admin studio should cache-bust the updated light theme stylesheet'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('admin-studio.js?v=20260424_ADMIN_MODAL_SCROLL_LOCK_SOFT_BACKDROP_1'),
        true,
        'admin studio should cache-bust the updated scroll lock runtime'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('css/admin-chat.css?v=20260426_ADMIN_CHAT_LIGHT_THEME_FROSTED_CONTEXT_FLAT_ALERTS_2'),
        true,
        'admin studio should cache-bust the updated admin chat stylesheet'
    );
});

test('theme preload can bootstrap a saved light preference before admin studio renders', () => {
    const preloadSource = readRepoFile(path.join('js', 'theme-preload.js'));

    assert.match(
        preloadSource,
        /savedTheme === 'dark' \|\| savedTheme === 'light'/,
        'theme preload should recognize saved light and dark preferences'
    );
    assert.equal(
        preloadSource.includes('theme = savedTheme;'),
        true,
        'theme preload should apply the saved website theme directly'
    );
});
