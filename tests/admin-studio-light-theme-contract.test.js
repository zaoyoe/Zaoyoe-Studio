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

test('admin studio header exposes the transplanted theme toggle beside the site selector', () => {
    const siteFilterSource = readRepoFile(path.join('js', 'admin-site-filter.js'));
    const adminStudioSource = readRepoFile('admin-studio.js');
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));

    assert.match(
        siteFilterSource,
        /admin-site-filter-toolbar[\s\S]*id="adminSiteSelector"[\s\S]*id="adminThemeToggleBtn"/,
        'admin studio should render the site selector to the left of the transplanted theme toggle'
    );
    assert.equal(
        siteFilterSource.includes('class="theme-toggle-btn admin-theme-toggle-btn"'),
        true,
        'admin studio should reuse the avatar dropdown theme toggle button shell in the header'
    );
    assert.equal(
        siteFilterSource.includes('data-admin-action="toggle-theme"'),
        true,
        'admin studio header theme toggle should route through the delegated action system'
    );
    assert.equal(
        adminStudioSource.includes("case 'toggle-theme':"),
        true,
        'admin studio action routing should handle the transplanted theme toggle'
    );
    assert.equal(
        adminStudioSource.includes("localStorage.setItem('theme', nextTheme);"),
        true,
        'admin studio theme toggle should persist the shared website theme preference'
    );
    assert.equal(
        adminStudioSource.includes('window.applySiteThemeChrome?.(nextTheme);'),
        true,
        'admin studio theme updates should refresh the shared browser chrome theme color'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_HEADER_THEME_TOGGLE_1'),
        true,
        'admin studio styles should include the header theme toggle marker'
    );
    assert.equal(
        stylesSource.includes('.admin-theme-toggle-btn'),
        true,
        'admin studio styles should size and align the transplanted theme toggle for the header toolbar'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_SITE_SWITCHER_POLISH_1'),
        true,
        'admin studio styles should include the polished site switcher layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_SITE_SWITCHER_NO_HOVER_LIFT_1'),
        true,
        'admin studio styles should include the flat hover site switcher marker'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_SITE_SWITCHER_ACTIVE_HOVER_LOCK_1'),
        true,
        'admin studio styles should lock the active site option background when hovered again'
    );
    assert.equal(
        stylesSource.includes('.site-selector-option:not(.active):hover'),
        true,
        'admin studio site switcher should only apply hover chrome to non-active site options'
    );
    assert.equal(
        stylesSource.includes('.site-selector-btn,'),
        true,
        'admin studio site switcher should reset native button chrome before applying custom styles'
    );
    assert.equal(
        stylesSource.includes('.admin-theme-toggle-btn:hover,\n                .admin-theme-toggle-btn:focus-visible {\n                    transform: none;'),
        true,
        'admin studio header theme toggle should not lift on hover or focus'
    );
    assert.equal(
        readRepoFile(path.join('js', 'admin-site-filter.js')).includes('<span class="site-selector-kicker">站点视角</span>'),
        false,
        'admin site selector trigger should not render the redundant kicker copy'
    );
    assert.equal(
        siteFilterSource.includes('site-selector-spinner'),
        true,
        'admin site selector trigger should show a spinner while the site switch is refreshing the active module'
    );
    assert.equal(
        siteFilterSource.includes('aria-busy="${siteSwitchInProgress ? \'true\' : \'false\'}"'),
        true,
        'admin site selector trigger should expose busy state to assistive tech during site switches'
    );
    assert.equal(
        stylesSource.includes('.admin-site-selector.is-site-switching .site-selector-btn'),
        true,
        'admin studio site switcher should visibly mark the trigger while a site switch is in progress'
    );
    assert.equal(
        stylesSource.includes('.site-selector-btn.is-loading .site-selector-spinner'),
        true,
        'admin studio site switcher should reveal the spinner only during loading'
    );
    assert.equal(
        stylesSource.includes('.site-selector-btn:hover,\n                .admin-site-selector.is-open .site-selector-btn {\n                    transform: none;'),
        true,
        'admin studio site switcher should not lift on hover or open state'
    );
    assert.equal(
        stylesSource.includes('box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);'),
        true,
        'admin studio site switcher should keep a flat base shell without a raised default outer shadow'
    );
    assert.equal(
        stylesSource.includes('box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);'),
        true,
        'admin studio site switcher should keep the light-theme default state flat as well'
    );
    assert.equal(
        stylesSource.includes('box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);'),
        true,
        'admin studio site switcher hover and open states should stay flat in dark mode'
    );
    assert.equal(
        stylesSource.includes('box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.96);'),
        true,
        'admin studio site switcher hover and open states should stay flat in light mode'
    );
});

test('admin studio gallery pagination stays visible in light theme', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GALLERY_PAGINATION_LIGHT_FIX_1'),
        true,
        'admin studio page styles should include the gallery pagination light-theme visibility fix marker'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery .pagination-btn'),
        true,
        'admin studio light theme should explicitly restyle gallery pagination buttons'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery .pagination-input'),
        true,
        'admin studio light theme should explicitly restyle the gallery pagination page input'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery .pagination-total'),
        true,
        'admin studio light theme should explicitly restore gallery pagination copy contrast'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GALLERY_HOVER_CLEANUP_1'),
        true,
        'admin studio page styles should include the gallery hover cleanup marker'
    );
    assert.equal(
        stylesSource.includes('.comments-pagination-shell__inner:hover'),
        true,
        'admin studio should explicitly neutralize the shared pagination shell hover state for gallery'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery .admin-card:hover'),
        true,
        'admin studio light theme should explicitly neutralize gallery card hover chrome in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GALLERY_MODULE_SHADOW_CLEANUP_1'),
        true,
        'admin studio page styles should include the gallery module shadow cleanup marker'
    );
    assert.equal(
        stylesSource.includes('.admin-card-context-btn:hover'),
        true,
        'admin studio light theme should explicitly neutralize gallery action button hover shadows'
    );
    assert.equal(
        stylesSource.includes('.admin-card-site-metric.is-current'),
        true,
        'admin studio light theme should explicitly neutralize gallery site metric shadows'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GALLERY_INTERNAL_HOVER_NEUTRAL_1'),
        true,
        'admin studio page styles should include the gallery card internal hover neutralization marker'
    );
    assert.equal(
        stylesSource.includes('.admin-card-media:is(:hover, :focus, :focus-visible, :focus-within, :active)'),
        true,
        'admin studio should neutralize image-area hover outlines inside gallery prompt cards'
    );
    assert.equal(
        stylesSource.includes('.admin-card-title,'),
        true,
        'admin studio should include gallery prompt title in the internal hover neutralization scope'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GLOBAL_NONINTERACTIVE_HOVER_NEUTRAL_1'),
        true,
        'admin studio page styles should include a global non-interactive hover neutralization layer'
    );
    assert.equal(
        stylesSource.includes('[class*="-media"],'),
        true,
        'admin studio global hover neutralization should cover media/image internals'
    );
    assert.equal(
        stylesSource.includes(':not([data-admin-action]):not([data-action]):not([data-comments-action]):not([data-shop-action])'),
        true,
        'admin studio global hover neutralization should preserve delegated interactive controls'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GALLERY_HOVER_ACTION_SOLID_BUTTONS_1'),
        true,
        'admin studio page styles should include a gallery quick-action solid button marker'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GALLERY_HOVER_ACTION_EDGE_SEAM_GUARD_1'),
        true,
        'admin studio page styles should include a gallery quick-action edge seam guard marker'
    );
    assert.equal(
        stylesSource.includes('#module-gallery .admin-card-hover-actions .hover-action-btn:is(:hover, :focus, :focus-visible, :active)'),
        true,
        'admin studio should neutralize gallery quick-action button transform and filter feedback on hover'
    );
    assert.equal(
        stylesSource.includes('#module-gallery .admin-card:hover .admin-card-hover-actions'),
        true,
        'admin studio should neutralize the gallery quick-action group transform while the card is hovered'
    );
    assert.match(
        stylesSource,
        /#module-gallery \.admin-card-hover-actions \.hover-action-btn\s*\{[\s\S]*?--admin-card-hover-action-bg:\s*#273142;[\s\S]*?appearance:\s*none !important;[\s\S]*?background:\s*var\(--admin-card-hover-action-bg\) !important;[\s\S]*?border:\s*1px solid var\(--admin-card-hover-action-bg\) !important;[\s\S]*?box-shadow:\s*none !important;/m,
        'admin studio should render gallery quick-action buttons as solid non-native surfaces with self-colored edges'
    );
    assert.equal(
        stylesSource.includes('#module-gallery .admin-card-hover-actions .hover-action-btn::before'),
        true,
        'admin studio should clear quick-action button pseudo elements that can render hairline artifacts'
    );
});

test('admin studio pagination controls use light-theme chrome across modules', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PAGINATION_LIGHT_SYSTEM_1'),
        true,
        'admin studio styles should include the systemic pagination light-theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-comments .pagination-btn'),
        true,
        'comments management pagination buttons should receive explicit light-theme styling'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-comments .pagination-input'),
        true,
        'comments management pagination page input should receive explicit light-theme styling'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-comments .pagination-total'),
        true,
        'comments management pagination summary should receive explicit light-theme contrast'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .pagination-btn'),
        true,
        'shared pagination buttons should be covered beyond the gallery and comments modules'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .admin-pagination .page-btn'),
        true,
        'user and payments pagers should avoid inheriting the announcement page selector button style'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    .pagination-controls,'),
        true,
        'points batch pagination controls should receive the shared light-theme container treatment'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    .comments-pagination-shell,'),
        true,
        'comments pagination outer shell should be included in the no-hover-frame cleanup'
    );
    assert.equal(
        stylesSource.includes('border: 0 !important;\n    border-color: transparent !important;'),
        true,
        'pagination containers should not draw a rectangular hover or focus frame in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PAGINATION_HOVER_FRAME_GUARD_1'),
        true,
        'admin studio styles should include the high-specificity pagination hover frame guard'
    );
    assert.equal(
        stylesSource.includes('#adminCommentsPagination.comments-pagination-shell'),
        true,
        'comments pagination mount should be guarded by ID so it outranks broad shell hover rules'
    );
    assert.equal(
        stylesSource.includes('#adminCommentsPagination,\n    #adminGalleryPagination,'),
        true,
        'pagination inner shells should inherit the same high-specificity guard from their mount IDs'
    );
    assert.equal(
        stylesSource.includes(') :is(\n    .pagination-shell,\n    .pagination-control,\n    .comments-pagination-shell__inner,'),
        true,
        'pagination inner shell and control containers should not draw a rectangular hover frame'
    );
    assert.equal(
        stylesSource.includes('):is(:hover, :focus, :focus-visible, :focus-within, :active) {\n    background: transparent !important;\n    border: 0 !important;'),
        true,
        'pagination mounts should stay frameless across hover and focus states'
    );
    assert.equal(
        stylesSource.includes('.payments-pagination,'),
        true,
        'payments pagination should participate in the shared light-theme container treatment'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .tab-pagination button'),
        true,
        'tabbed modal pagination buttons should be covered by the same light-theme button treatment'
    );
    assert.equal(
        stylesSource.includes('.verify-monitor-pagination__actions .btn-add-config'),
        true,
        'settings monitor pagination buttons should be covered by the systemic light-theme layer'
    );
    assert.equal(
        stylesSource.includes('color-scheme: light;'),
        true,
        'pagination number inputs should opt into light browser form controls'
    );
});

test('admin studio product editor modal restores light-theme contrast', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PRODUCT_MODAL_SCOPE_1'),
        true,
        'admin studio styles should scope product editor modal base styles to the product modal root'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PRODUCT_MODAL_LIGHT_THEME_1'),
        true,
        'admin studio styles should include the product editor modal light-theme layer'
    );
    assert.equal(
        stylesSource.includes('#productModal .premium-modal-layout'),
        true,
        'product editor modal base shell styles should stay namespaced to the product modal root'
    );
    assert.equal(
        stylesSource.includes('#productModal.active .premium-modal-layout'),
        true,
        'product editor modal active-state shell transitions should not target every modal overlay in admin studio'
    );
    assert.equal(
        stylesSource.includes('#productModal .preview-label'),
        true,
        'product editor preview copy styles should stay scoped to the modal instead of leaking into other preview panels'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .premium-modal-layout'),
        true,
        'product editor modal shell should receive an explicit light surface'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .preview-label'),
        true,
        'product editor preview eyebrow should not inherit low-contrast white text in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .upload-box'),
        true,
        'product editor image upload box should not keep dark dashed-dropzone colors in light mode'
    );
    assert.equal(
        stylesSource.includes('#productModal .upload-text'),
        true,
        'product editor upload copy styles should stay scoped to the modal instead of overriding gallery create dropzones globally'
    );
    assert.equal(
        stylesSource.includes('#productModal .custom-category-selected'),
        true,
        'product editor custom category trigger chrome should stay scoped to the modal instead of leaking into unrelated selectors'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .custom-category-options'),
        true,
        'product editor custom dropdown menu should be remapped from dark glass to light surface'
    );
    assert.equal(
        stylesSource.includes('#productModal .toggle-switch input:checked+.toggle-slider'),
        true,
        'product editor toggle tuning should stay scoped to the product modal instead of resizing every toggle in admin studio'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .toggle-slider'),
        true,
        'product editor toggle switches should keep visible off-state chrome in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .btn-cancel'),
        true,
        'product editor cancel button should keep readable contrast in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PRODUCT_MODAL_EDITOR_LIGHT_THEME_1'),
        true,
        'product editor modal should keep a dedicated light-theme layer for rich-text and tiered-pricing chrome'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .wysiwyg-editor'),
        true,
        'product editor rich-text surface should explicitly remap to a readable light editor background'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PRODUCT_MODAL_RICHTEXT_COLOR_PREVIEW_1'),
        true,
        'product editor modal should include a dedicated light-theme rich-text color preview marker'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .wysiwyg-editor :is(a, b, strong, i, em, u, div, p, span, font, ul, ol, li)'),
        true,
        'product editor rich-text content should explicitly sync WebKit text fill to each node currentColor in light mode'
    );
    assert.doesNotMatch(
        stylesSource,
        /html\[data-theme="light"\] #productModal \.wysiwyg-editor,\s*html:not\(\[data-theme="dark"\]\) #productModal \.wysiwyg-editor \{[^}]*-webkit-text-fill-color:/,
        'product editor light-theme editor root should not flatten descendant rich-text colors with a forced WebKit text fill'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #productModal .shop-tiered-pricing-row'),
        true,
        'product editor tiered pricing rows should not keep dark cards in light theme'
    );
    assert.equal(
        stylesSource.includes('.premium-modal-layout,\n    .admin-ticket-reply-modal'),
        true,
        'product editor modal should participate in shared modal hint and placeholder contrast cleanup'
    );
});

test('admin studio import category folder icons stay visible in light theme', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioHtml = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_IMPORT_TREE_FOLDER_LIGHT_FIX_1'),
        true,
        'admin studio page styles should include the import tree folder light-theme visibility fix marker'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-import .tree-folder-icon'),
        true,
        'import category folder icons should receive an explicit light-theme color'
    );
    assert.equal(
        stylesSource.includes('html:not([data-theme="dark"]) #module-shop #shop-view-import .tree-folder-icon'),
        true,
        'import category folder icons should stay visible for the default non-dark theme state'
    );
    assert.match(
        stylesSource,
        /#shop-view-import \.tree-folder-icon,\s*\nhtml:not\(\[data-theme="dark"\]\) #module-shop #shop-view-import \.tree-folder-icon \{\s*\n\s*color:\s*rgba\(71,\s*85,\s*105,\s*0\.82\) !important;/,
        'import category folder icons should not inherit the dark-theme translucent white icon color'
    );
    assert.equal(
        stylesSource.includes('#shop-view-import .tree-folder-icon--recycle-bin'),
        true,
        'the recycle bin icon should keep its dedicated danger color in the import tree'
    );
    assert.equal(
        adminStudioHtml.includes('importTreeFolder=20260428_ADMIN_STUDIO_IMPORT_TREE_FOLDER_LIGHT_FIX_1'),
        true,
        'admin studio should bump the page stylesheet cache key for the import tree folder light-theme fix'
    );
});

test('admin studio import target product name stays plain text in light theme', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioHtml = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_IMPORT_TARGET_BADGE_PLAIN_TEXT_1'),
        true,
        'admin studio styles should include the import target product plain-text marker'
    );
    assert.match(
        stylesSource,
        /html\[data-theme="light"\] #module-shop #shop-view-import \.import-main-header #selectedProductBadge\.product-badge,\s*\nhtml:not\(\[data-theme="dark"\]\) #module-shop #shop-view-import \.import-main-header #selectedProductBadge\.product-badge \{\s*\n\s*background:\s*transparent !important;/,
        'the selected import product name should not render with the shared light-theme badge background'
    );
    assert.equal(
        adminStudioHtml.includes('importTargetBadge=20260428_ADMIN_STUDIO_IMPORT_TARGET_BADGE_PLAIN_TEXT_1'),
        true,
        'admin studio should cache-bust the import target product plain-text update'
    );
});

test('admin studio rich text yellow upgrades low-contrast legacy palette values', () => {
    const adminConfigSource = readRepoFile('admin-config.js');
    const studioStylesSource = readRepoFile('admin-studio.css');

    assert.match(
        adminConfigSource,
        /const ADMIN_CONFIG_RICH_TEXT_VISIBLE_YELLOW = '#f4b400';/,
        'admin-config.js should define a richer gold token for yellow rich-text copy on light surfaces'
    );
    assert.equal(
        adminConfigSource.includes('ADMIN_CONFIG_RICH_TEXT_LOW_CONTRAST_YELLOW_PATTERN'),
        true,
        'admin-config.js should keep a dedicated matcher for low-contrast legacy yellow rich-text colors'
    );
    assert.equal(
        adminConfigSource.includes("{ value: ADMIN_CONFIG_RICH_TEXT_VISIBLE_YELLOW, label: '黄色' }"),
        true,
        'rich-text toolbar color choices should expose the visible gold token instead of the pale legacy yellow'
    );
    assert.match(
        adminConfigSource,
        /function normalizeStoredContent\(value\) \{[\s\S]*normalizeAdminConfigRichTextPaletteColor\(value\)/,
        'stored rich-text content should normalize legacy pale yellow markup before the editor renders it'
    );
    assert.match(
        adminConfigSource,
        /selectColor\(key, color\) \{[\s\S]*const normalizedColor = normalizeAdminConfigRichTextPaletteColor\(color\);[\s\S]*execCommand\(key, 'foreColor', normalizedColor\);/s,
        'toolbar color selection should normalize pale yellow into the visible gold token before applying it'
    );
    assert.equal(
        studioStylesSource.includes('.color-swatch--yellow {\n    background: #f4b400;'),
        true,
        'admin-studio.css should render the toolbar yellow swatch with the richer gold tone'
    );
});

test('admin studio shop product stock badges keep dedicated capsule states', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const shopScript = readRepoFile(path.join('js', 'admin-shop.js'));

    assert.equal(
        stylesSource.includes('.shop-admin-product-stock--empty'),
        true,
        'shop product cards should include an empty-stock badge tone for frosted stock capsules'
    );
    assert.equal(
        stylesSource.includes('.preview-stock--unknown'),
        true,
        'product preview card should include an unknown-stock badge tone for new products before inventory exists'
    );
    assert.equal(
        shopScript.includes('shop-admin-product-stock shop-admin-product-stock--empty'),
        true,
        'shop product card renderer should map zero stock into the empty-stock badge class'
    );
    assert.equal(
        shopScript.includes('preview-stock--unknown'),
        true,
        'product preview renderer should preserve a dedicated unknown-stock state before a product is saved'
    );
});

test('admin studio access gate, module loaders, and sidebar reuse the shared dot loader shell', () => {
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));

    assert.equal(
        adminStudioHtml.includes('class="admin-access-spinner admin-access-spinner--dots"'),
        true,
        'admin studio access gate should render the same three-dot loader family as order detail loading states'
    );
    assert.equal(
        adminStudioHtml.includes('class="sidebar-brand-logo admin-studio-inline-style-attr-1"'),
        true,
        'admin studio sidebar should render the homepage logo svg instead of the old generic sidebar mark'
    );
    assert.equal(
        stylesSource.includes('20260426_ADMIN_STUDIO_ACCESS_DOTS_HOME_LOGO_1'),
        true,
        'admin studio page styles should include the access-dot and homepage-logo bridge marker'
    );
    assert.equal(
        adminStudioHtml.includes('id="analysisLoading" role="status" aria-live="polite" aria-label="AI 分析加载中..." hidden'),
        true,
        'admin studio gallery loading state should render the shared centered three-dot loader shell but stay hidden until analysis starts'
    );
    assert.equal(
        adminStudioHtml.includes('id="hp-loading" class="admin-studio-inline-style-attr-145 admin-module-loading-host admin-module-loading-host--hero"'),
        true,
        'admin studio homepage loading state should render the shared centered three-dot loader shell'
    );
    assert.equal(
        stylesSource.includes('20260426_ADMIN_STUDIO_LOADING_DOTS_BRIDGE_1'),
        true,
        'admin studio page styles should include the shared module loading-dot bridge marker'
    );
    assert.equal(
        stylesSource.includes('@keyframes admin-module-loading-dots'),
        true,
        'admin studio module loaders should animate with the shared bouncing dot pattern'
    );
    assert.equal(
        stylesSource.includes('@keyframes admin-access-pending-dots'),
        true,
        'admin studio access gate should animate the loader with the shared bouncing dot pattern'
    );
    assert.equal(
        stylesSource.includes('.admin-module-loading-host.loading-text::before'),
        true,
        'admin studio loading bridge should disable legacy skeleton pseudo elements when the shared dot loader is active'
    );
    assert.equal(
        stylesSource.includes('.admin-module-loading-host[hidden]'),
        true,
        'admin studio shared loading bridge should respect hidden states for idle shells'
    );
    assert.equal(
        stylesSource.includes('.sidebar-brand-logo path:nth-child(1)'),
        true,
        'admin studio sidebar logo should inherit the homepage light-theme fill mapping'
    );
});

test('admin studio has a light-theme bridge for legacy dark admin surfaces', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const analyticsPanelLoadersSource = readRepoFile(path.join('js', 'admin-analytics-panel-loaders.js'));
    const paymentsSource = readRepoFile(path.join('js', 'admin-payments.js'));
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const ticketsSource = readRepoFile(path.join('js', 'admin-tickets.js'));
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
        stylesSource.includes('20260426_ADMIN_STUDIO_LIGHT_THEME_DOCK_FEEDBACK_1'),
        true,
        'admin studio styles should include the dock badge and action feedback light-theme polish layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #toastContainer .toast'),
        true,
        'admin studio light theme should explicitly restyle success and error action toasts'
    );
    assert.equal(
        stylesSource.includes('20260513_ADMIN_SITE_SWITCH_TOAST_INFO_RAIL_1'),
        true,
        'admin studio light theme should keep the site-switching info toast rail visible'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #toastContainer .toast.info'),
        true,
        'admin studio light theme should explicitly restore the info toast left rail color'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-command-center__badge.is-alert'),
        true,
        'admin studio light theme should explicitly restyle command center alert badges'
    );
    assert.equal(
        stylesSource.includes('20260426_ADMIN_STUDIO_LIGHT_THEME_DOCK_BALANCE_1'),
        true,
        'admin studio styles should include the dock balance polish layer for light theme'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-command-center__dock-btn.is-alert'),
        true,
        'admin studio light theme should soften dock alert icon color instead of relying on a saturated red bell'
    );
    assert.equal(
        stylesSource.includes('20260426_ADMIN_STUDIO_LIGHT_THEME_DOCK_PANEL_POSITION_1'),
        true,
        'admin studio styles should include the dock panel positioning fix for light theme'
    );
    assert.equal(
        stylesSource.includes('20260426_ADMIN_STUDIO_LIGHT_THEME_DOCK_PANEL_PARITY_4'),
        true,
        'admin studio styles should restate the shared dark dock panel geometry and animation chain at the end of the light-theme cascade'
    );
    assert.equal(
        stylesSource.includes('animation: admin-command-center-panel-open 260ms var(--command-smooth) both !important;'),
        false,
        'admin studio light theme should not mark dock panel keyframe animations important because that suppresses the shared transform animation'
    );
    assert.equal(
        stylesSource.includes('transform: translate(0, var(--admin-command-panel-open-y, -50%)) scale(1) !important;'),
        false,
        'admin studio light theme should not pin the shared open-state transform with !important because it blocks the opening and closing keyframes'
    );
    assert.equal(
        stylesSource.includes('20260426_ADMIN_STUDIO_LIGHT_THEME_DOCK_PANEL_MOTION_2'),
        false,
        'admin studio light theme should not override the shared command center panel motion; it should reuse the same dock animation logic as dark mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-command-center__panel.is-open'),
        true,
        'admin studio light theme should explicitly preserve the shared open-state panel transform in the final light-theme cascade'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_MOBILE_COMMAND_DOCK_HIDDEN_1'),
        true,
        'admin studio styles should include the mobile command dock hidden layer'
    );
    assert.match(
        stylesSource,
        /20260428_ADMIN_STUDIO_MOBILE_COMMAND_DOCK_HIDDEN_1[\s\S]*?@media \(max-width: 768px\) \{[\s\S]*?--shop-admin-mobile-dock-safe-space:\s*0px;[\s\S]*?--users-admin-mobile-dock-safe-space:\s*0px;/,
        'mobile command dock hidden layer should remove module bottom reservations that only existed for the dock'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('mobileCommandDock=20260428_ADMIN_STUDIO_MOBILE_COMMAND_DOCK_HIDDEN_1'),
        true,
        'admin studio should cache-bust the mobile command dock hidden layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(\n    .batch-dropdown-menu,'),
        true,
        'admin studio light theme should limit the generic transform reset to menu surfaces instead of the command center panel itself'
    );
    assert.equal(
        stylesSource.includes('20260426_ADMIN_STUDIO_LIGHT_THEME_DOCK_PANEL_INTERACTION_EXCLUDE_1'),
        true,
        'admin studio light theme should mark the command center panel exclusion from broad flat hover rules'
    );
    assert.equal(
        stylesSource.includes('):not(.admin-command-center__panel):not(.admin-command-center__dock-label):is(:hover, :focus-within, :active, .is-focused, .is-selected)'),
        true,
        'admin studio light theme should not let generic hover transform resets cancel command center panel motion'
    );
    assert.equal(
        stylesSource.includes('.admin-command-center__panel,\n    .admin-command-center__dock-label,\n    .config-row'),
        true,
        'admin studio light theme should exclude the command center panel from the late card hover flattening cascade'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_LIGHT_DOCK_PANEL_HOVER_EXCLUDE_1'),
        true,
        'admin studio styles should include the light dock panel hover exclusion marker'
    );
    assert.match(
        stylesSource,
        /\[class\*="__panel"\],\s*\n\s*\[class\*="-shell"\],\s*\n\s*\[class\*="__shell"\]\s*\n\):not\(\.admin-command-center__panel\):not\(\.admin-command-center__dock-label\):not\(button\)[\s\S]*?\{\s*\n\s*filter:\s*none !important;\s*\n\s*transform:\s*none !important;/,
        'late generic hover transform resets should not match the command center panel in light mode'
    );
    assert.equal(
        adminStudioHtml.includes('dockPanelHoverExclude=20260428_ADMIN_STUDIO_LIGHT_DOCK_PANEL_HOVER_EXCLUDE_1'),
        true,
        'admin studio should cache-bust the light dock panel hover exclusion'
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
        stylesSource.includes('20260427_ADMIN_GALLERY_CREATE_LIGHT_THEME_1'),
        true,
        'admin studio styles should include the gallery create light-theme cleanup layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GALLERY_CREATE_TITLEBAR_CLIP_1'),
        true,
        'admin studio should clip gallery create titlebars to their card radius'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery #view-create :is(.upload-section.glass-panel, .analysis-section.glass-panel)'),
        true,
        'gallery create upload and analysis cards should clip overflowing blue titlebars'
    );
    assert.equal(
        stylesSource.includes('.upload-section.glass-panel > .section-title,\n    .analysis-section.glass-panel > .section-title'),
        true,
        'gallery create card titlebars should be explicitly scoped to their own panels'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery #view-create :is(\n    .gallery-bilingual-panel,\n    .gallery-ops-panel,\n    .gallery-ops-note\n)'),
        true,
        'admin studio light theme should cover gallery create nested bilingual and ops panels'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery #view-create :is(.select-display, .select-options)'),
        true,
        'admin studio light theme should cover gallery create custom select surfaces'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_GALLERY_UPLOAD_LIGHT_COPY_1'),
        true,
        'admin studio styles should include the gallery create upload copy light-theme cleanup layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery #view-create .upload-text'),
        true,
        'gallery create upload primary copy should keep readable contrast in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-gallery #view-create .upload-subtext'),
        true,
        'gallery create upload secondary copy should keep readable contrast in light mode'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('galleryCreateTitlebars=20260427_ADMIN_STUDIO_GALLERY_CREATE_TITLEBAR_CLIP_1'),
        true,
        'admin studio should cache-bust the gallery create titlebar clipping fix'
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
        stylesSource.includes('20260428_ADMIN_STUDIO_PAYMENTS_LIGHT_THEME_DEEP_ADAPT_1'),
        true,
        'admin studio styles should include the deep light-theme adaptation layer for payment reconciliation'
    );
    assert.equal(
        stylesSource.includes('--payments-light-surface: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.93));'),
        true,
        'payments light theme should define a dedicated readable surface token'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-payments :is(\n    .payments-toolbar-shell,'),
        true,
        'payments light theme should cover the toolbar and primary reconciliation surfaces'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-payments :is(.payments-anomaly-action-btn.mark_handled, .payments-anomaly-action-btn.approve_review)'),
        true,
        'payments light theme should restyle action buttons with light semantic tones'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-payments .payments-info-tooltip'),
        true,
        'payments light theme should restyle KPI tooltips away from dark popovers'
    );
    assert.equal(
        adminStudioHtml.includes('paymentsLight=20260428_ADMIN_STUDIO_PAYMENTS_LIGHT_THEME_DEEP_ADAPT_1'),
        true,
        'admin studio should cache-bust the payment reconciliation light-theme update'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_PAYMENTS_LIGHT_READABILITY_CLIP_FIX_1'),
        true,
        'admin studio styles should include the payment reconciliation readability and clipping fix'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-payments .payments-business-trend-inspector__series'),
        true,
        'payments business trend inspector series labels should be explicitly readable in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-payments .payments-business-trend-inspector__row.is-muted'),
        true,
        'payments business trend inspector muted rows should avoid low-opacity light theme text'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-payments .payments-manual::after'),
        true,
        'payments manual card should draw an inner-safe outline to avoid clipped rounded corners'
    );
    assert.equal(
        adminStudioHtml.includes('paymentsReadability=20260428_ADMIN_STUDIO_PAYMENTS_LIGHT_READABILITY_CLIP_FIX_1'),
        true,
        'admin studio should cache-bust the payment reconciliation readability and clipping fix'
    );
    assert.equal(
        adminStudioHtml.includes('<div class="chart-card glass-panel payments-card payments-card-wide payments-card--manual">\n                                <details class="payments-manual"'),
        true,
        'payment manual wrapper should have a scoped class for the clipping fix'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_PAYMENTS_MOBILE_COMPACT_1'),
        true,
        'admin studio styles should include the compact mobile adaptation layer for payment reconciliation'
    );
    assert.equal(
        stylesSource.includes('#module-payments .payments-date-menu .date-range-presets'),
        true,
        'payment reconciliation date popover presets should be tightened for mobile'
    );
    assert.equal(
        stylesSource.includes('#module-payments .payments-kpi-card-visual .kpi-icon'),
        true,
        'payment reconciliation data icons should be explicitly tightened on mobile'
    );
    assert.equal(
        adminStudioHtml.includes('paymentsMobile=20260428_ADMIN_STUDIO_PAYMENTS_MOBILE_COMPACT_1'),
        true,
        'admin studio should cache-bust the payment reconciliation mobile compact update'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_PAYMENTS_MOBILE_CLIP_SCROLL_1'),
        true,
        'admin studio styles should include the payment reconciliation mobile clipping and table scrolling layer'
    );
    assert.match(
        stylesSource,
        /#module-payments\s*\{[\s\S]*--payments-admin-mobile-dock-safe-space: calc\(132px \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*padding-bottom: var\(--payments-admin-mobile-dock-safe-space\) !important;[\s\S]*scroll-padding-bottom: var\(--payments-admin-mobile-dock-safe-space\);/,
        'payment reconciliation should reserve bottom space for the mobile command dock'
    );
    assert.match(
        stylesSource,
        /#module-payments \.payments-business-trend-inspector__rows \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
        'payment reconciliation trend inspector cards should use two compact mobile columns'
    );
    assert.match(
        stylesSource,
        /#module-payments :is\(\.payments-table-wrap, \.payments-business-table-wrap\) \{[\s\S]*overflow-x: auto !important;[\s\S]*-webkit-overflow-scrolling: touch;[\s\S]*touch-action: pan-x pan-y;/,
        'payment reconciliation tables should follow the shop-style horizontal scrolling pattern on mobile'
    );
    assert.equal(
        paymentsSource.includes('class="payments-order-card-primary"'),
        true,
        'payment reconciliation mobile order cards should expose a primary text block for clipped identity content'
    );
    assert.equal(
        paymentsSource.includes('payments-order-card-field payments-order-card-field--match'),
        true,
        'payment reconciliation mobile order cards should expose a compact intent-match field'
    );
    assert.equal(
        adminStudioHtml.includes('paymentsMobileClip=20260428_ADMIN_STUDIO_PAYMENTS_MOBILE_CLIP_SCROLL_1'),
        true,
        'admin studio should cache-bust the payment reconciliation mobile clipping and scroll update'
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
        stylesSource.includes('--admin-studio-skeleton-panel-bg: linear-gradient(135deg, rgba(248, 250, 252, 0.9), rgba(255, 255, 255, 0.8) 50%, rgba(241, 245, 249, 0.84));'),
        true,
        'admin studio light theme should override dark skeleton panel variables with a structured neutral panel'
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
        stylesSource.includes('20260428_ADMIN_STUDIO_STATIC_CHILD_SURFACES_NO_HOVER_1'),
        true,
        'admin studio styles should include the final static child-surface hover lock layer'
    );
    assert.equal(
        adminStudioHtml.includes('staticChildSurfaces=20260428_ADMIN_STUDIO_STATIC_CHILD_SURFACES_NO_HOVER_1'),
        true,
        'admin studio should cache-bust the static child-surface hover lock layer'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-static-child-surface-bg: rgba(255, 255, 255, 0.68);'),
        true,
        'static child surfaces should share a stable light background token'
    );
    assert.equal(
        stylesSource.includes('transition: none !important;\n    will-change: auto !important;'),
        true,
        'static child surfaces should not animate into pressed hover states'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_LIGHT_LAYOUT_SHELL_TRANSPARENT_1'),
        true,
        'admin studio should include a final transparent guard for internal layout shells'
    );
    assert.equal(
        adminStudioHtml.includes('layoutShellTransparent=20260430_ADMIN_STUDIO_LIGHT_LAYOUT_SHELL_TRANSPARENT_1'),
        true,
        'admin studio should cache-bust the internal layout shell transparent guard'
    );
    assert.equal(
        stylesSource.includes('[class$="__top"],\n    [class*="__top "],\n    [class$="__actions"],\n    [class*="__actions "],\n    [class$="__chips"],'),
        true,
        'layout shell transparent guard should cover top/action/chip containers that otherwise leak white rectangles'
    );
    assert.equal(
        stylesSource.includes('[class$="__stats"],\n    [class*="__stats "],\n    [class$="__items"],\n    [class*="__items "]'),
        true,
        'layout shell transparent guard should cover stats and items grid containers'
    );
    assert.equal(
        stylesSource.includes('background: transparent !important;\n    background-color: transparent !important;\n    background-image: none !important;\n    border-color: transparent !important;'),
        true,
        'layout shell transparent guard should remove inherited light surface fills'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_NAV_HOVER_SUBTLE_1'),
        true,
        'admin studio styles should include a final subtle hover guard for navigation tabs'
    );
    assert.equal(
        stylesSource.includes('html:not([data-theme="dark"]) :is(\n    .admin-main-content .admin-tabs .admin-tab,'),
        true,
        'navigation hover cleanup should also cover the non-dark theme path'
    );
    assert.equal(
        stylesSource.includes('):is(:hover, :focus-visible, .active),'),
        true,
        'top-level navigation tabs should not draw rectangular hover or active fills'
    );
    assert.equal(
        stylesSource.includes('background: transparent !important;\n    background-image: none !important;\n    box-shadow: none !important;'),
        true,
        'navigation hover cleanup should remove large filled hover blocks'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_USER_MODAL_LIGHT_SEMANTIC_RAILS_1'),
        true,
        'user detail modal light theme should preserve semantic colored rails on list cards'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal :is(.data-list-item, .users-note-item, .users-audit-item)'),
        true,
        'user detail modal list cards should restate their rail color after light-theme neutral borders'
    );
    assert.equal(
        stylesSource.includes('.users-payment-item--success'),
        true,
        'user detail modal recharge rows should have status-specific rail tokens'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_CARD_RAIL_REAL_BORDER_1'),
        true,
        'user detail modal list rails should use the single-rail cleanup layer'
    );
    assert.equal(
        stylesSource.includes('border-left-width: var(--users-modal-rail-width, 2px) !important;'),
        true,
        'user detail modal list cards should render one thin real border rail'
    );
    assert.equal(
        stylesSource.includes('border-left-color: var(--users-modal-rail, rgba(148, 163, 184, 0.72)) !important;'),
        true,
        'user detail modal list cards should color the actual left border so rounded corners inherit the rail'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal :is(.data-list-item, .users-note-item, .users-audit-item)::before,\nhtml:not([data-theme="dark"]) .user-modal :is(.data-list-item, .users-note-item, .users-audit-item)::before {\n    content: none !important;\n    display: none !important;'),
        true,
        'user detail modal list cards should disable the old pseudo-element rail'
    );
    assert.equal(
        stylesSource.includes('.user-overview-card--warning'),
        true,
        'user detail modal overview cards should keep semantic borders in light mode'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_USER_MODAL_COMMERCE_TRACE_LIGHT_1'),
        true,
        'user detail commerce trace should include a dedicated light-theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal .users-commerce-trace,'),
        true,
        'user detail commerce trace should restyle its card surface in explicit light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal .users-commerce-trace__chip strong,'),
        true,
        'user detail commerce trace chips should keep readable labels in light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal .users-commerce-trace__feedback-status--warning,'),
        true,
        'user detail commerce trace feedback status chips should be adapted for light mode'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('userCommerceTraceLight=20260430_ADMIN_STUDIO_USER_MODAL_COMMERCE_TRACE_LIGHT_1'),
        true,
        'admin studio should cache-bust the commerce trace light-theme CSS layer'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_USER_BATCH_MODAL_LIGHT_1'),
        true,
        'user batch modals should include a dedicated light-theme layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] :is(.users-batch-tag-modal, .users-batch-renew-modal, .users-batch-expiry-modal),'),
        true,
        'user batch modals should restyle their surfaces in explicit light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal .users-tab-refresh-overlay,'),
        true,
        'user detail tab refresh overlays should be adapted for light mode'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .user-modal .users-tab-inline-banner--success,'),
        true,
        'user detail tab inline banners should keep readable semantic colors in light mode'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('userBatchModalLight=20260430_ADMIN_STUDIO_USER_BATCH_MODAL_LIGHT_1'),
        true,
        'admin studio should cache-bust the user batch modal light-theme CSS layer'
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
        stylesSource.includes('border-left-color: rgba(var(--admin-studio-product-alert-rgb), 0.78) !important;'),
        true,
        'product alert cards should color the actual left border rail'
    );
    assert.equal(
        stylesSource.includes('border-left-color: rgba(var(--admin-studio-product-health-rgb), 0.72) !important;'),
        true,
        'product health cards should color the actual left border rail'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_LIGHT_ACTION_VISIBILITY_1'),
        true,
        'admin studio styles should include the analytics action button light visibility layer'
    );
    assert.equal(
        stylesSource.includes('    .analytics-duty-hero__cta,\n    .analytics-duty-list-item__cta,\n    .analytics-product-alert-card__actions .btn-sm.btn-secondary,'),
        true,
        'analytics duty and product action buttons should share readable light-theme button styling'
    );
    assert.equal(
        stylesSource.includes('    .analytics-business-center-shell__primary,\n    .analytics-duty-hero__cta,'),
        true,
        'business center primary action buttons should keep visible button chrome in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_LIGHT_DUTY_QUEUE_READABILITY_1'),
        true,
        'admin studio styles should include the duty queue light readability layer'
    );
    assert.equal(
        stylesSource.includes('    .analytics-duty-hero__sample-pill,\n    .analytics-duty-hero__panel,\n    .analytics-duty-list-item__panel'),
        true,
        'duty queue chips should not keep gray-on-white dark-theme colors in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_USER_VALUE_LIGHT_DEPTH_1'),
        true,
        'admin studio styles should include the user value cockpit light depth layer'
    );
    assert.equal(
        stylesSource.includes(') .analytics-user-value-cockpit .analytics-product-conclusion-digest {'),
        true,
        'user value cockpit conclusion cards should regain visible surfaces in light mode'
    );
    assert.equal(
        stylesSource.includes('    .analytics-user-value-cockpit__stat,\n    .analytics-user-value-cockpit__panel,'),
        true,
        'user value cockpit metric and sample panels should regain card depth in light mode'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_ANALYTICS_LIGHT_PILL_PARITY_1'),
        true,
        'admin studio styles should include the analytics light pill parity layer'
    );
    assert.equal(
        stylesSource.includes('    .analytics-user-commerce-impact__sample,\n    .analytics-user-value-cockpit__sample,\n    .analytics-product-token--user:not(.analytics-product-token--static)'),
        true,
        'analytics user sample pills should share visible light-theme capsule chrome'
    );
    assert.equal(
        stylesSource.includes('border: 1px solid var(--admin-studio-analytics-light-pill-border) !important;'),
        true,
        'analytics light sample pills should keep a real capsule border'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('analyticsLightPills=20260430_ADMIN_STUDIO_ANALYTICS_LIGHT_PILL_PARITY_1'),
        true,
        'admin studio page stylesheet should be cache-busted for the light pill parity layer'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_PRODUCT_DETAIL_CONTROL_LIGHT_1'),
        true,
        'admin studio styles should include the product detail control panel light-theme layer'
    );
    assert.equal(
        stylesSource.includes('html:not([data-theme="dark"]) .admin-main-content :is(#module-analytics, #module-business-overview, #module-growth-center, #module-commerce-center) .analytics-product-detail__surface--controls'),
        true,
        'product detail control panels should be covered in the default non-dark admin theme'
    );
    assert.equal(
        stylesSource.includes('    .analytics-product-detail__selector-trigger,\n    .analytics-product-detail__selector-menu,\n    .analytics-product-detail__selector-option,'),
        true,
        'product detail selector controls should not keep dark surfaces in light mode'
    );
    assert.equal(
        stylesSource.includes('    .analytics-product-detail__actions .btn-sm.btn-secondary\n)'),
        true,
        'product detail quick action buttons should share the light control surface treatment'
    );
    assert.equal(
        adminStudioHtml.includes('productDetailControlLight=20260430_ADMIN_STUDIO_PRODUCT_DETAIL_CONTROL_LIGHT_1'),
        true,
        'admin studio page stylesheet should be cache-busted for the product detail control light layer'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_USER_VALUE_CARD_TITLEBARS_1'),
        true,
        'admin studio styles should include the user value card titlebar light fallback layer'
    );
    assert.equal(
        stylesSource.includes('.analytics-user-value-cockpit .analytics-product-detail-card > .analytics-product-detail-card__head'),
        true,
        'user value detail cards should keep colored titlebars after product detail light control overrides'
    );
    assert.equal(
        adminStudioHtml.includes('userValueCardTitlebars=20260430_ADMIN_STUDIO_USER_VALUE_CARD_TITLEBARS_1'),
        true,
        'admin studio page stylesheet should be cache-busted for the user value card titlebar layer'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_ANALYTICS_TITLEBAR_TRANSPARENT_FALLBACK_1'),
        true,
        'admin studio styles should include a final analytics titlebar fallback after transparent shell overrides'
    );
    assert.equal(
        stylesSource.includes('.analytics-product-alert-card > .analytics-product-alert-card__top'),
        true,
        'product alert top bars should regain titlebar color after layout shell transparent overrides'
    );
    assert.equal(
        stylesSource.includes('.analytics-product-detail__surface > .analytics-product-detail__surface-head'),
        true,
        'product detail surface heads should regain titlebar color after product detail control overrides'
    );
    assert.equal(
        stylesSource.includes('> span:not(.analytics-status-chip):not([class*="chip"])'),
        true,
        'bare titlebar subtitles should be recolored without overriding status chip text'
    );
    assert.equal(
        adminStudioHtml.includes('analyticsTitlebarFallback=20260430_ADMIN_STUDIO_ANALYTICS_TITLEBAR_TRANSPARENT_FALLBACK_1'),
        true,
        'admin studio page stylesheet should be cache-busted for the final analytics titlebar fallback'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_MAIN_ACTION_HOVER_PARITY_1'),
        true,
        'business center main actions should share the same light hover treatment as watch actions'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_BUSINESS_CENTER_ENTRY_HOVER_PARITY_1'),
        true,
        'business center entry chips should include the light hover parity layer'
    );
    assert.equal(
        stylesSource.includes('.analytics-business-center-shell__primary,\n    .analytics-business-center-shell__watch-action,\n    .analytics-business-center-shell__entry-chip'),
        true,
        'business center primary, watch, and entry chip buttons should be covered by the same hover parity selector'
    );
    assert.equal(
        stylesSource.includes('background: var(--admin-studio-subtle-block-bg-hover, rgba(118, 157, 202, 0.1)) !important;'),
        true,
        'business center hover parity should reuse the existing watch-action hover material'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('businessCenterEntryHover=20260430_ADMIN_STUDIO_BUSINESS_CENTER_ENTRY_HOVER_PARITY_1'),
        true,
        'admin studio page stylesheet should be cache-busted for business center entry chip hover parity'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_CLICKABLE_SURFACE_HOVER_PARITY_1'),
        true,
        'admin studio styles should include the generic clickable surface hover parity layer'
    );
    assert.equal(
        stylesSource.includes('button[data-admin-action][class*="card"],\n    button[data-admin-action][class*="chip"],'),
        true,
        'clickable card and chip buttons should receive the shared hover material'
    );
    assert.equal(
        stylesSource.includes('button[data-admin-action][class*="card"]'),
        true,
        'card-like action buttons, including operating focus destination cards, should be covered by the clickable surface hover selector'
    );
    assert.equal(
        stylesSource.includes(':not(:disabled):not([disabled]):not([data-analytics-destination="points"]):is(:hover, :focus-visible)'),
        true,
        'clickable surface hover parity should skip disabled controls and preserve the points-specific hover treatment'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('interactiveSurfaceHover=20260430_ADMIN_STUDIO_CLICKABLE_SURFACE_HOVER_PARITY_1'),
        true,
        'admin studio page stylesheet should be cache-busted for generic clickable surface hover parity'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_POINTS_LEDGER_ACTION_ORANGE_1'),
        true,
        'points ledger action buttons should keep the orange treatment in light mode'
    );
    assert.equal(
        stylesSource.includes('[data-analytics-destination="points"]'),
        true,
        'points destination action buttons should be targetable for the orange ledger style'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_DUTY_STAT_LIGHT_DEPTH_1'),
        true,
        'today duty stat cards should regain visible depth in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_DUTY_METRIC_STATIC_HOVER_3'),
        true,
        'today duty primary metric card should include a static hover override'
    );
    assert.equal(
        stylesSource.indexOf('20260427_ADMIN_STUDIO_ANALYTICS_DUTY_METRIC_STATIC_HOVER_3') >
            stylesSource.indexOf('20260427_ADMIN_STUDIO_ANALYTICS_READONLY_NAV_HOVER_LOCK_3'),
        true,
        'today duty primary metric hover-lock should load after shared analytics hover locks'
    );
    assert.equal(
        stylesSource.includes('#overviewDutyBoard .analytics-duty-hero__metric-card:is(:hover, :focus, :focus-visible, :focus-within, :active)'),
        true,
        'today duty primary metric card should keep its normal treatment when hovered directly'
    );
    assert.equal(
        stylesSource.includes('#overviewDutyBoard .analytics-duty-hero:is(:hover, :focus-within) .analytics-duty-hero__metric-card'),
        true,
        'today duty primary metric card should stay static when its hero row is hovered'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_USER_VALUE_BORDER_SAFE_AREA_1'),
        true,
        'user value cockpit should reserve enough bottom space for visible borders'
    );
    assert.equal(
        stylesSource.includes('overflow: visible !important;\n    grid-auto-rows: minmax(236px, auto) !important;'),
        true,
        'user value stat rail should avoid being a clipping scroll container on desktop light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_USER_VALUE_STAT_CLIP_FIX_1'),
        true,
        'user value stat cards should include a dedicated bottom-border clipping fix'
    );
    assert.equal(
        stylesSource.includes('height: auto !important;\n    min-height: 236px !important;'),
        true,
        'user value stat cards should avoid the old 100% min-height that could push borders outside the rail'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_SUBCARD_HEADER_ALIGN_1'),
        true,
        'analytics section navigator cards should include a dedicated header alignment fix'
    );
    assert.equal(
        stylesSource.includes('.analytics-section-navigator-card > .analytics-section-navigator-card__top'),
        true,
        'analytics section navigator card titlebars should be explicitly aligned inside their cards'
    );
    assert.equal(
        stylesSource.includes('overflow: hidden !important;\n}'),
        true,
        'analytics section navigator cards should clip their internal titlebar to the card radius'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_TITLEBAR_EDGE_ALIGNMENT_2'),
        true,
        'admin studio should include the expanded titlebar edge alignment layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_TITLEBAR_EDGE_ALIGNMENT_3'),
        true,
        'admin studio should include the operating hub card titlebar completion layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_TITLEBAR_EDGE_ALIGNMENT_4'),
        true,
        'admin studio should include the overview navigator card titlebar completion layer'
    );
    assert.equal(
        stylesSource.includes('.analytics-operating-focus > .analytics-operating-focus__header'),
        true,
        'operating focus titlebars should be aligned against their outer card border'
    );
    assert.equal(
        stylesSource.includes('.analytics-ops-cockpit__panel > .analytics-ops-cockpit__panel-top'),
        true,
        'ops cockpit card titlebars should be covered by the same edge alignment'
    );
    assert.equal(
        stylesSource.includes('.analytics-operating-hub__item > .analytics-operating-hub__item-top'),
        true,
        'operating hub navigation cards should stretch their blue titlebar across the full card width'
    );
    assert.equal(
        stylesSource.includes('align-self: stretch !important;\n    box-sizing: border-box !important;'),
        true,
        'flex-column card titlebars should not shrink to their content width'
    );
    assert.equal(
        stylesSource.includes('.analytics-overview-navigator-card > .analytics-overview-navigator-card__top'),
        true,
        'overview navigator cards should stretch their blue titlebar across the full card width'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-titlebar-edge-x: 20px;'),
        true,
        'overview navigator cards should align the titlebar to their 20px horizontal card inset'
    );
    assert.equal(
        stylesSource.includes('.analytics-user-value-cockpit > .analytics-user-value-cockpit__head'),
        true,
        'user value cockpit titlebars should be covered by the expanded edge alignment'
    );
    assert.equal(
        stylesSource.includes('.analytics-product-panel > .analytics-product-panel__head'),
        true,
        'product panel titlebars should be covered by the expanded edge alignment'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-titlebar-edge-x: calc(var(--admin-studio-panel-padding-x) + 2px);'),
        true,
        'glass-panel analytics shells should use their real panel padding for titlebar edge alignment'
    );
    assert.equal(
        stylesSource.includes('margin: calc(-1 * var(--admin-studio-titlebar-edge-y'),
        true,
        'titlebar edge alignment should inherit per-card edge offsets instead of using one fixed inset'
    );
    assert.equal(
        stylesSource.includes('border-radius: 0 !important;\n    background: var(--admin-studio-light-titlebar-bg) !important;'),
        true,
        'titlebar edge alignment should let the parent card clip the blue header to the outer radius'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('titlebars=20260427_ADMIN_STUDIO_TITLEBAR_EDGE_ALIGNMENT_4'),
        true,
        'admin studio should cache-bust the titlebar edge alignment stylesheet update'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_PANEL_NOTE_STATIC_HOVER_1'),
        true,
        'analytics read-only panel notes should include a static hover override'
    );
    assert.equal(
        stylesSource.indexOf('20260427_ADMIN_STUDIO_ANALYTICS_PANEL_NOTE_STATIC_HOVER_1') >
            stylesSource.indexOf('20260427_ADMIN_STUDIO_GLOBAL_NONINTERACTIVE_HOVER_NEUTRAL_1'),
        true,
        'analytics panel note static hover override should load after the global noninteractive hover cleanup'
    );
    assert.equal(
        stylesSource.includes('.analytics-panel-note:is(:hover, :focus, :focus-visible, :active)'),
        true,
        'analytics panel notes should keep their pill treatment when hovered directly'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_READONLY_NAV_HOVER_LOCK_3'),
        true,
        'analytics read-only navigator headers should include a hover-lock override'
    );
    assert.equal(
        stylesSource.indexOf('20260427_ADMIN_STUDIO_ANALYTICS_READONLY_NAV_HOVER_LOCK_3') >
            stylesSource.indexOf('20260427_ADMIN_STUDIO_ANALYTICS_PANEL_NOTE_STATIC_HOVER_1'),
        true,
        'analytics read-only navigator hover-lock should load after the panel note static hover layer'
    );
    assert.equal(
        stylesSource.includes(':is(.analytics-overview-navigator-card, .analytics-section-navigator-card):not(.analytics-section-navigator-card--active):is(:hover, :active)'),
        true,
        'analytics navigator cards should neutralize hover on non-clickable cards themselves'
    );
    assert.equal(
        stylesSource.includes(':is(.analytics-overview-navigator-card__top, .analytics-section-navigator-card__top) .analytics-status-chip--warning:is(:hover, :focus, :focus-visible, :active)'),
        true,
        'analytics read-only navigator status chips should keep warning styling on direct hover'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_LOADING_SKELETON_2'),
        true,
        'admin studio styles should include the light loading skeleton layer'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-light-loading-panel-border: rgba(100, 116, 139, 0.16);'),
        true,
        'light loading skeletons should keep enough visible contrast on white cards'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_LOADING_DOTS_PANEL_OVERRIDE_1'),
        true,
        'admin studio styles should include the panel loading override that restores centered jumping dots'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_LIGHT_LOADING_DOTS_CENTER_2'),
        true,
        'admin studio styles should include the final light-theme loading dots centering layer'
    );
    assert.equal(
        stylesSource.includes('.admin-main-content .admin-module-loading-host.loading-text:not(.admin-module-loading-host--inline):not(.admin-module-loading-host--cell)'),
        true,
        'all managed loading-text hosts should be centered instead of inheriting white skeleton blocks'
    );
    assert.equal(
        stylesSource.includes('.loading-text:not(.admin-module-loading-host)::before'),
        true,
        'plain chart loading-text fallbacks should draw the dot fallback before AdminShell takes over'
    );
    assert.equal(
        adminStudioHtml.includes('loadingDotsCenter=20260427_ADMIN_STUDIO_LIGHT_LOADING_DOTS_CENTER_2'),
        true,
        'admin studio should cache-bust the centered light loading dots stylesheet update'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_SPLIT_LOADING_DOTS_CENTER_1'),
        true,
        'admin studio styles should include the split chart loading dots centering layer'
    );
    assert.equal(
        stylesSource.includes('.analytics-chart-detail-layout:has(> .analytics-detail-pane > .loading-text:only-child) > .analytics-chart-pane'),
        true,
        'split chart loading states should hide the empty canvas pane while centering the loader'
    );
    assert.equal(
        adminStudioHtml.includes('splitLoadingDots=20260428_ADMIN_STUDIO_SPLIT_LOADING_DOTS_CENTER_1'),
        true,
        'admin studio should cache-bust the split chart loading dots centering update'
    );
    assert.equal(
        adminStudioHtml.includes('js/admin-analytics-panel-loaders.js?v=20260427_ANALYTICS_USER_TREND_LOADING_DOTS_1'),
        true,
        'admin studio should cache-bust the user trend loading dots runtime update'
    );
    assert.equal(
        analyticsPanelLoadersSource.includes("commerceImpactContainer.innerHTML = renderAnalyticsProductLoadingState('商品影响用户层加载中...');"),
        true,
        'user growth trend secondary panels should use the shared dot loader while details hydrate'
    );
    assert.equal(
        analyticsPanelLoadersSource.includes('用户趋势已加载，商品影响用户层正在补齐'),
        false,
        'user growth trend secondary panels should not fall back to a static hint card while loading'
    );
    assert.equal(
        stylesSource.includes('20260424_ADMIN_STUDIO_LIGHT_THEME_POINTS_VISIBILITY_1'),
        true,
        'admin studio styles should include the points management light visibility layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_NAV_INDICATOR_SLIDE_1'),
        true,
        'admin studio styles should include the sliding navigation indicator layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .admin-tab-indicator {\n    display: block !important;\n    opacity: 1 !important;'),
        true,
        'light theme tabs should keep the shared sliding indicator visible'
    );
    assert.equal(
        stylesSource.includes('.admin-main-content .admin-tabs .admin-tab.active::after,\n#module-shop .shop-tab.active::after,'),
        true,
        'admin studio tabs should not keep per-tab pseudo underlines that jump between tabs'
    );
    assert.equal(
        stylesSource.includes('#module-shop .shop-tabs,\n#module-tickets .admin-ticket-function-nav'),
        true,
        'shop and ticket navigation bars should join the shared sliding indicator system'
    );
    assert.equal(
        stylesSource.includes('#module-shop .shop-tabs::after,\n#module-tickets .admin-ticket-function-nav::after'),
        true,
        'shop and ticket navigation bars should draw their shared indicator from the nav container'
    );
    assert.equal(
        stylesSource.includes('left: var(--admin-tab-indicator-left, 0px) !important;'),
        true,
        'the shared tab indicator should be positioned from a runtime left offset'
    );
    assert.equal(
        stylesSource.includes('width: var(--admin-tab-indicator-width, 0px) !important;'),
        true,
        'the shared tab indicator should size itself from the active tab width'
    );
    assert.equal(
        stylesSource.includes('left 0.28s cubic-bezier(0.22, 1, 0.36, 1),'),
        true,
        'the shared tab indicator should slide instead of jumping between navigation items'
    );
    assert.equal(
        adminStudioSource.includes('20260427_ADMIN_STUDIO_NAV_INDICATOR_SLIDE_RUNTIME_1'),
        true,
        'admin studio runtime should include the shared tab indicator positioning marker'
    );
    assert.equal(
        adminStudioSource.includes('const left = Math.max(0, Math.round(tabRect.left - navRect.left + nav.scrollLeft));'),
        true,
        'admin studio runtime should calculate the indicator offset from the visible tab geometry'
    );
    assert.equal(
        adminStudioSource.includes('window.updateAdminTabIndicator = updateAdminTabIndicator;'),
        true,
        'admin studio runtime should expose the shared indicator updater for module scripts'
    );
    assert.equal(
        adminStudioSource.includes('.admin-tabs .admin-tab, #module-shop .shop-tabs .shop-tab, #module-tickets .admin-ticket-function-tab, [data-admin-action="switch-module"]'),
        true,
        'admin studio runtime should resync sliding navigation after admin, shop, and ticket tab clicks'
    );
    assert.equal(
        paymentsSource.includes('window.updateAdminTabIndicator?.(activeButton);'),
        true,
        'payments tabs should use the shared sliding indicator updater'
    );
    assert.equal(
        shopSource.includes('window.updateAdminTabIndicator?.(el);'),
        true,
        'shop tabs should use the shared sliding indicator updater'
    );
    assert.equal(
        ticketsSource.includes('window.updateAdminTabIndicator?.(button);'),
        true,
        'ticket workspace tabs should use the shared sliding indicator updater'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_POINTS_LIGHT_TABLE_NAV_1'),
        true,
        'points batch and package table headers should include the light navigation bar parity layer'
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
        'shop tabs should explicitly suppress the old per-tab underline in favor of the sliding nav indicator'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_TOOLBAR_HOVER_FRAME_GUARD_1'),
        true,
        'admin studio styles should include a systemic toolbar hover-frame guard'
    );
    assert.equal(
        stylesSource.includes('.shop-product-toolbar-shell,\n    .shop-product-toolbar-row,\n    .shop-orders-toolbar-shell,'),
        true,
        'shop product and order search toolbar layout containers should be guarded from rectangular hover frames'
    );
    assert.equal(
        stylesSource.includes('.inv-filter-bar,'),
        true,
        'shop inventory filter bars should be guarded from rectangular hover frames'
    );
    assert.equal(
        stylesSource.includes('.comment-toolbar-compact,'),
        true,
        'comments management toolbar should share the same no-frame treatment'
    );
    assert.equal(
        stylesSource.includes('):is(:hover, :focus, :focus-visible, :focus-within, :active) {\n    border-color: transparent !important;\n    box-shadow: none !important;'),
        true,
        'toolbar layout containers should not draw border or shadow frames while hovered or focused'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_SHOP_SEARCH_BUTTON_STABLE_HOVER_1'),
        true,
        'admin studio styles should include a stable hover guard for shop search toolbar buttons'
    );
    assert.equal(
        stylesSource.includes('.shop-product-toolbar-row,\n    .shop-orders-search-bar,\n    .shop-delivery-controls,'),
        true,
        'shop search and query toolbar buttons should be guarded together'
    );
    assert.equal(
        stylesSource.includes('.shop-theme-primary-btn,\n    .shop-delivery-inline-btn\n):is(:hover, :focus-visible, :active) {\n    box-shadow: none !important;\n    transform: none !important;'),
        true,
        'shop search and query buttons should not lift or cast heavy shadows on hover'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_DELIVERY_FULFILLMENT_LAYOUT_POLISH_1'),
        true,
        'admin studio styles should include the API fulfillment layout polish layer'
    );
    assert.equal(
        stylesSource.includes('#module-shop #shop-view-fulfillment .shop-delivery-header > .shop-delivery-controls :is(\n    .shop-custom-select.shop-delivery-filter,'),
        true,
        'API fulfillment status filters should be scoped to a compact width instead of filling the toolbar'
    );
    assert.equal(
        stylesSource.includes('width: 176px !important;\n    min-width: 176px !important;\n    max-width: 176px !important;'),
        true,
        'API fulfillment status filter width should stay compact'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-fulfillment :is(\n    .shop-delivery-header,\n    .shop-delivery-subcard-header\n)'),
        true,
        'API fulfillment headers should override the shared titlebar layer in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_DELIVERY_DARK_REFERENCE_TITLEBAR_1'),
        true,
        'API fulfillment should include a dark-mode-reference titlebar layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-fulfillment .shop-table th'),
        true,
        'API fulfillment table headers should keep the navigation/titlebar color used by the dark-mode table header'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-fulfillment :is(\n    .shop-delivery-filter--search,\n    .shop-custom-select__trigger\n)'),
        true,
        'API fulfillment search and select controls should use an explicit light surface'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-fulfillment .shop-delivery-manual-footnote'),
        true,
        'API fulfillment SOP recommendation footnote should have readable light-mode contrast'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_LIGHT_THEME_IMPORT_TREE_TEXTAREA_1'),
        true,
        'shop import view should include a focused light-theme cleanup for category tree and account textarea'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-import .import-textarea.glass-input'),
        true,
        'shop import account textarea should not inherit the transparent glass input background in light mode'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_IMPORT_TEXTAREA_FLAT_SHADOW_1'),
        true,
        'shop import account textarea should include the flat no-shadow light-theme marker'
    );
    assert.match(
        stylesSource,
        /#shop-view-import \.import-textarea\.glass-input,\s*\nhtml:not\(\[data-theme="dark"\]\) #module-shop #shop-view-import \.import-textarea\.glass-input \{[\s\S]*?box-shadow:\s*none !important;/,
        'shop import account textarea should not render a right-side outer shadow in light mode'
    );
    assert.match(
        stylesSource,
        /#shop-view-import \.import-textarea\.glass-input:is\(:hover, :focus, :focus-visible\),\s*\nhtml:not\(\[data-theme="dark"\]\) #module-shop #shop-view-import \.import-textarea\.glass-input:is\(:hover, :focus, :focus-visible\) \{[\s\S]*?box-shadow:\s*none !important;/,
        'shop import account textarea should stay flat on hover and focus'
    );
    assert.equal(
        adminStudioHtml.includes('importTextareaFlat=20260428_ADMIN_STUDIO_IMPORT_TEXTAREA_FLAT_SHADOW_1'),
        true,
        'admin studio should cache-bust the import textarea flat shadow update'
    );
    assert.equal(
        stylesSource.includes('.shop-delivery-filter--search,\n    .glass-input,\n    .inventory-textarea,\n    .shop-delivery-field input\n) {\n    background: transparent !important;'),
        false,
        'shop transparent search-input rule should not include standalone editable textareas or strategy inputs'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_DELIVERY_STRATEGY_INPUT_FRAME_1'),
        true,
        'API fulfillment strategy number inputs should include an explicit visible frame restoration'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-fulfillment .shop-delivery-strategy-grid .shop-delivery-field input[type="number"]'),
        true,
        'API fulfillment strategy number inputs should not look like plain text in light mode'
    );
    assert.equal(
        adminStudioHtml.includes('deliveryStrategyInputs=20260428_ADMIN_STUDIO_DELIVERY_STRATEGY_INPUT_FRAME_1'),
        true,
        'admin studio should cache-bust the API fulfillment strategy input frame update'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_INVENTORY_TEXTAREA_FRAME_1'),
        true,
        'inventory import textarea should include an explicit visible frame restoration'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-inventory #inventoryInput.inventory-textarea'),
        true,
        'inventory import textarea should keep a visible editable surface in light mode'
    );
    assert.equal(
        adminStudioHtml.includes('inventoryTextarea=20260428_ADMIN_STUDIO_INVENTORY_TEXTAREA_FRAME_1'),
        true,
        'admin studio should cache-bust the inventory textarea frame update'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_INVENTORY_DETAIL_LIGHT_MODAL_1'),
        true,
        'inventory detail modal should include a body-mounted light-theme readability layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .shop-inventory-detail-modal,\nhtml:not([data-theme="dark"]) .shop-inventory-detail-modal'),
        true,
        'inventory detail modal should restore its light surface outside the shop module scope'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .shop-inventory-detail-code,\nhtml:not([data-theme="dark"]) .shop-inventory-detail-code'),
        true,
        'inventory detail account content should get an explicit readable light-mode code surface'
    );
    assert.equal(
        adminStudioHtml.includes('inventoryDetailLight=20260430_ADMIN_STUDIO_INVENTORY_DETAIL_LIGHT_MODAL_1'),
        true,
        'admin studio should cache-bust the inventory detail light modal update'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-shop #shop-view-import .tree-category-header'),
        true,
        'shop import category tree rows should get explicit light-mode surfaces and borders'
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
        stylesSource.includes('border-left-color: var(--points-batch-summary-rail) !important;'),
        true,
        'points batch summary cards should color the actual left border rail'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .codes-modal--batch .points-batch-codes-summary-card::before,\nhtml:not([data-theme="dark"]) .codes-modal--batch .points-batch-codes-summary-card::before {\n    content: none !important;\n    display: none !important;'),
        true,
        'points batch summary cards should not use a pseudo-element rail'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_STATIC_NOTICE_HOVER_LOCK_1'),
        true,
        'admin studio styles should exclude surfaced static notices from the broad non-interactive hover cleanup'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_POINTS_STATIC_HOVER_FLAT_3'),
        true,
        'admin studio styles should include the final points management flat static-hover layer'
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
        stylesSource.includes('20260427_ADMIN_STUDIO_DARK_REFERENCE_TITLEBAR_SCOPE_1'),
        true,
        'admin studio styles should include a dark-mode-reference correction for misclassified titlebars'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content :is(\n    .glass-panel > .section-title,'),
        true,
        'light card titlebar layer should start from the same titlebar scope as the dark card header definition'
    );
    assert.equal(
        stylesSource.includes('    .ops-alert-strategy-panel__header,'),
        true,
        'ops alert strategy headers should be covered by the titlebar correction scope'
    );
    assert.equal(
        stylesSource.includes('    .points-catalog-list-shell__header,'),
        true,
        'points catalog headers should be covered by the titlebar correction scope'
    );
    assert.equal(
        stylesSource.includes('    #module-homepage .hp-analytics-module-card__head,'),
        true,
        'homepage card titlebars should be included in the unified titlebar color layer'
    );
    assert.equal(
        stylesSource.includes('    #module-shop .shop-delivery-header,\n    #module-shop .shop-delivery-subcard-header,'),
        true,
        'shop fulfillment headers should be corrected away from the shared titlebar color unless a dark table header uses it'
    );
    assert.equal(
        stylesSource.includes('background: transparent !important;\n    background-image: none !important;\n    border-color: transparent !important;'),
        true,
        'misclassified titlebar headers should be restored to neutral transparent chrome'
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
        stylesSource.includes('20260427_SETTINGS_AFFILIATE_CONFIG_HOVER_STATIC_1'),
        true,
        'affiliate configuration cards should include a final static-hover override'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-affiliate .config-card:is(:hover, :focus-within, :active)'),
        true,
        'affiliate configuration cards should not gain light-theme hover shadows or lift'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-settings #settings-view-affiliate .config-row:is(:hover, :focus-within, :active)'),
        true,
        'affiliate configuration rows should stay flat when hovered or focused'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('affiliateHover=20260427_SETTINGS_AFFILIATE_CONFIG_HOVER_STATIC_1'),
        true,
        'admin studio should cache-bust the affiliate hover cleanup stylesheet'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_SETTINGS_STATIC_HOVER_AUDIT_1'),
        true,
        'admin studio should include a final settings-wide static hover audit layer'
    );
    assert.equal(
        stylesSource.indexOf('20260427_ADMIN_STUDIO_SETTINGS_STATIC_HOVER_AUDIT_1') >
            stylesSource.indexOf('20260427_SETTINGS_AFFILIATE_CONFIG_HOVER_STATIC_1'),
        true,
        'settings-wide hover audit layer should load after the affiliate-specific hover cleanup'
    );
    assert.equal(
        stylesSource.includes('    .verify-monitor-fact-card,'),
        true,
        'settings-wide hover audit should cover Google One fact cards'
    );
    assert.equal(
        stylesSource.includes('#module-settings :is(.config-row, .config-item-row):is(:hover, :focus-within, :active)'),
        true,
        'settings-wide hover audit should keep config rows transparent while hovered or focused'
    );
    assert.equal(
        stylesSource.includes('#module-settings #settings-view-google-one #verifyMonitorFactsGrid .verify-monitor-fact-card:is(:hover, :focus-within, :active)'),
        true,
        'Google One fact cards should no longer gain a hover inset shadow'
    );
    assert.equal(
        stylesSource.includes('border-left-color: var(--verify-monitor-fact-rail);'),
        true,
        'Google One fact cards should color the actual left border rail'
    );
    assert.equal(
        stylesSource.includes('#module-settings #settings-view-google-one #verifyMonitorFactsGrid .verify-monitor-fact-card::before {\n    content: none;\n    display: none;'),
        true,
        'Google One fact cards should not use a pseudo-element rail'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('settingsHover=20260427_ADMIN_STUDIO_SETTINGS_STATIC_HOVER_AUDIT_1'),
        true,
        'admin studio should cache-bust the settings-wide hover audit stylesheet'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('noticeHover=20260427_ADMIN_STUDIO_STATIC_NOTICE_HOVER_LOCK_1'),
        true,
        'admin studio should cache-bust the static notice hover cleanup stylesheet'
    );
    assert.equal(
        stylesSource.indexOf('20260427_ADMIN_STUDIO_POINTS_STATIC_HOVER_FLAT_3') >
            stylesSource.indexOf('20260427_ADMIN_STUDIO_LIGHT_CARD_BORDER_CONTRAST_1'),
        true,
        'points static hover cleanup should load after the final light card border and shadow layer'
    );
    assert.equal(
        stylesSource.includes('    .points-batch-overview-card,'),
        true,
        'points static hover audit should cover the batch overview cards'
    );
    assert.equal(
        stylesSource.includes('    .points-catalog-summary-card,'),
        true,
        'points static hover audit should cover the catalog summary cards'
    );
    assert.equal(
        stylesSource.includes('#module-points > .admin-tabs .admin-tab:not(.active):hover'),
        true,
        'points static hover audit should keep inactive points tabs from changing on hover'
    );
    assert.equal(
        stylesSource.includes('    .points-catalog-summary-card .kpi-icon'),
        true,
        'points static hover cleanup should remove the reused KPI icon shadow from catalog cards'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-points-table-nav-bg: var(--admin-studio-light-titlebar-bg'),
        true,
        'points table navigation bars should reuse the light titlebar color sampled from dark table headers'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-points :is(\n    #points-view-batches .admin-table,\n    .points-catalog-table\n) th'),
        true,
        'points table navigation bars should cover both batch and catalog table headers'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('pointsHover=20260427_ADMIN_STUDIO_POINTS_STATIC_HOVER_FLAT_3'),
        true,
        'admin studio should cache-bust the points static hover audit stylesheet'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('pointsLightNav=20260427_ADMIN_STUDIO_POINTS_LIGHT_TABLE_NAV_1'),
        true,
        'admin studio should cache-bust the points light table navigation stylesheet'
    );
    const staticNoticeHoverStart = stylesSource.indexOf('20260427_ADMIN_STUDIO_STATIC_NOTICE_HOVER_LOCK_1');
    const staticNoticeHoverEnd = stylesSource.indexOf('background-color: transparent !important;', staticNoticeHoverStart);
    const staticNoticeHoverSelector = stylesSource.slice(staticNoticeHoverStart, staticNoticeHoverEnd);
    assert.equal(
        staticNoticeHoverSelector.includes(':not(:is(\n    .config-inline-note,'),
        true,
        'global non-interactive hover cleanup should not strip config inline note backgrounds'
    );
    for (const surfacedNoticeClass of [
        '.gallery-ops-overview__hint',
        '.admin-workbench-context-note',
        '.admin-ticket-overview-reminder-summary-note',
        '.analytics-proxy-hint',
        '.analytics-secondary-note',
        '.analytics-writeback-note',
        '.admin-discount-scope-hint',
        '.admin-users-scope-hint',
        '.points-batch-edit-form-note',
        '.hp-inline-note',
        '.hp-aggregate-readonly-card__hint',
        '.admin-shop-risk-case-modal__context-note',
        '.admin-shop-risk-case-modal__note'
    ]) {
        assert.equal(
            staticNoticeHoverSelector.includes(surfacedNoticeClass),
            true,
            `global non-interactive hover cleanup should preserve ${surfacedNoticeClass}`
        );
    }
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
        chatStylesSource.includes('20260502_ADMIN_CHAT_KEYBOARD_DOCK_6'),
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
        readRepoFile('admin-studio.html').includes('css/admin-studio-page.css?v=20260427_ADMIN_SITE_SWITCHER_ACTIVE_HOVER_LOCK_1'),
        true,
        'admin studio should cache-bust the updated light theme stylesheet'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('admin-studio.js?v=20260427_ADMIN_GALLERY_AI_TAGS_HIDDEN_1'),
        true,
        'admin studio should cache-bust the updated scroll lock runtime'
    );
    assert.equal(
        readRepoFile('admin-studio.html').includes('css/admin-chat.css?v=20260504_USER_ONLINE_GREEN_1'),
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
    assert.equal(
        preloadSource.includes('prefers-color-scheme: dark'),
        false,
        'theme preload should default to light mode when no explicit preference is saved'
    );
});

test('admin studio discounts light theme keeps coupon code, search focus, and detail modal readable', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_DISCOUNTS_LIGHT_READABILITY_1'),
        true,
        'admin studio light theme should include the discounts list readability marker'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-discounts .admin-discount-code-btn'),
        true,
        'discount list should explicitly restyle coupon codes for light theme readability'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-discounts .search-bar:focus-within::after'),
        true,
        'discount search should add an explicit light-theme focus ring at the search shell level'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_DISCOUNT_DETAIL_LIGHT_POLISH_1'),
        true,
        'admin studio light theme should include the discount detail modal polish marker'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #discountDetailOverlay .admin-discount-detail-chip'),
        true,
        'discount detail modal should explicitly restyle chip copy for light theme readability'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #discountDetailOverlay .admin-discount-detail-close'),
        true,
        'discount detail modal should explicitly restyle the close button for light theme'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .admin-discount-toolbar-export-btn[aria-disabled="true"]'),
        true,
        'discount toolbar should explicitly restyle blocked batch-restore actions for light theme clarity'
    );
    assert.equal(
        adminStudioSource.includes('css/admin-studio-page.css?v=20260427_ADMIN_SITE_SWITCHER_ACTIVE_HOVER_LOCK_1'),
        true,
        'admin studio should cache-bust the updated discounts light-theme stylesheet'
    );
});

test('admin studio homepage content has complete light-theme coverage', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_HOMEPAGE_LIGHT_THEME_COMPLETE_1'),
        true,
        'homepage content should include a final light-theme completion layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-homepage .hp-control-bar,'),
        true,
        'homepage control bars should be reset separately so child cards provide the light surface'
    );
    assert.equal(
        stylesSource.includes('.hp-theme-pack-active-preview,'),
        true,
        'homepage theme pack preview cards should be covered in light mode'
    );
    assert.equal(
        stylesSource.includes('20260427_HOMEPAGE_THEME_PACK_WRAP_FULL_WIDTH_1'),
        true,
        'homepage theme pack cards should use a full-width wrapping grid instead of a narrow column'
    );
    assert.equal(
        stylesSource.includes('20260430_HOMEPAGE_OPS_CARD_LIST_GRID_1'),
        true,
        'homepage ops experiment, recommendation, and alert cards should use adaptive card grids'
    );
    assert.equal(
        stylesSource.includes('grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));'),
        true,
        'homepage experiment cards should fill wide rows without becoming cramped'
    );
    assert.equal(
        stylesSource.includes('grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));'),
        true,
        'homepage recommendation and alert cards should fill wide rows with readable card widths'
    );
    assert.equal(
        stylesSource.includes('.hp-section-view[data-hp-view="ticker"] .hp-toggle-group,'),
        true,
        'homepage ticker nested toggle group should be covered in light mode'
    );
    assert.equal(
        stylesSource.includes('.hp-featured-site-group,'),
        true,
        'homepage featured prompt site groups should be covered in light mode'
    );
    assert.equal(
        stylesSource.includes('html:not([data-theme="dark"]) #module-homepage :is('),
        true,
        'homepage light coverage should also cover the non-dark fallback path'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_HOMEPAGE_LIGHT_THEME_POLISH_2'),
        true,
        'homepage light theme should include the final checkbox and hint polish layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_HOMEPAGE_LIGHT_THEME_POLISH_3'),
        true,
        'homepage light theme should include the publish notice, report button, and flat checkbox polish layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_HOMEPAGE_LIGHT_THEME_POLISH_5'),
        true,
        'homepage light theme should include the primary button dark-style parity layer'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-homepage .btn-sm.btn-primary:not(:disabled)'),
        true,
        'homepage primary buttons should keep the dark-theme primary button chrome in light mode'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-save-btn-bg: var(--admin-studio-ui-blue, #769dca);'),
        true,
        'homepage primary buttons should now inherit the Admin Studio sidebar blue token'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] #module-homepage .btn-sm.btn-primary:hover:not(:disabled)'),
        true,
        'homepage primary button hover should be covered without relying on generic light-theme button chrome'
    );
    assert.equal(
        stylesSource.includes('box-shadow: var(--admin-studio-save-btn-hover-feedback, inset 0 1px 0 rgba(255, 255, 255, 0.24), inset 0 -2px 0 rgba(15, 23, 42, 0.18)) !important;'),
        true,
        'homepage save buttons should now use the shared non-glow hover feedback'
    );
    assert.equal(
        stylesSource.includes('transform: translateY(-1px) !important;'),
        true,
        'homepage save buttons should now use the shared save-button hover lift'
    );
    assert.equal(
        stylesSource.includes('#module-homepage .hp-report-card__head [data-homepage-report-copy]'),
        true,
        'homepage report copy buttons should stay on one line'
    );
    assert.equal(
        stylesSource.includes('#module-homepage .hp-ops-note:is(:hover, :focus-within)'),
        true,
        'homepage publish notices should not gain a hover treatment in light mode'
    );
    assert.equal(
        stylesSource.includes('background: var(--admin-studio-ui-blue, #6b9ece) !important;'),
        true,
        'homepage custom checkboxes should use the admin sidebar blue without a 3D gradient'
    );
    assert.equal(
        stylesSource.includes('#module-homepage :is(.hp-inline-checkbox, .hp-theme-pack-selector__item) input[type="checkbox"]'),
        true,
        'homepage inline and theme-pack checkboxes should use custom non-native chrome'
    );
    assert.equal(
        stylesSource.includes('#module-homepage #hp-verify-risk-notice.config-input.hp-multiline-input'),
        true,
        'verify risk notice textarea should have a dedicated vertical-centering override'
    );
    assert.equal(
        stylesSource.includes('.hp-analytics-module-card__head > span,'),
        true,
        'homepage analytics cards should explicitly restyle right-side hint text in light mode'
    );
    assert.equal(
        stylesSource.includes('.hp-recommendation-card__head > span,'),
        true,
        'homepage recommendation cards should explicitly restyle right-side hint text in light mode'
    );
    assert.equal(
        adminStudioSource.includes('css/admin-studio-page.css?v=20260427_ADMIN_SITE_SWITCHER_ACTIVE_HOVER_LOCK_1'),
        true,
        'admin studio should cache-bust the completed homepage light theme stylesheet'
    );
    assert.equal(
        adminStudioSource.includes('homepageOpsCardGrid=20260430_HOMEPAGE_OPS_CARD_LIST_GRID_1'),
        true,
        'admin studio should cache-bust the adaptive homepage ops card grid stylesheet update'
    );
});

test('admin studio light theme keeps list row press feedback', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_LIGHT_LIST_PRESS_PARITY_1'),
        true,
        'admin studio should include a final light-theme list press parity layer'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-list-press-translate-y: 0.75px;'),
        true,
        'light theme should keep the downward press offset subtle for interactive list rows'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-list-press-scale: 0.994;'),
        true,
        'light theme should keep list row press scale subtle'
    );
    assert.equal(
        stylesSource.includes('#module-users .users-table tbody tr.user-row:not(.selected):not(.users-table-skeleton-row)'),
        true,
        'user list rows should be covered by the light-theme press selector'
    );
    assert.equal(
        stylesSource.includes('#module-tickets .users-table tbody tr.admin-ticket-row:not(.admin-ticket-row--focused):not(.admin-ticket-row--selected):not(.admin-ticket-table-skeleton-row)'),
        true,
        'ticket list rows should keep the same light-theme press selector'
    );
    assert.equal(
        stylesSource.includes('#module-shop .shop-table tbody tr:not(.shop-table-skeleton-row):not(.shop-order-row--focused):not(.shop-delivery-audit-row--active):not(.shop-delivery-task-row--focused):not(.shop-delivery-linked-row--focused)'),
        true,
        'shop table rows should also receive the shared light-theme press selector'
    );
    assert.equal(
        stylesSource.includes('):hover > td {\n    transform: translateY(var(--admin-studio-list-press-translate-y)) scale(var(--admin-studio-list-press-scale)) !important;'),
        true,
        'light-theme row hover should override late flattening rules and press table cells down'
    );
    assert.equal(
        adminStudioSource.includes('css/admin-studio-page.css?v=20260427_ADMIN_SITE_SWITCHER_ACTIVE_HOVER_LOCK_1'),
        true,
        'admin studio should cache-bust the light-theme list press stylesheet update'
    );
});

test('admin studio light theme keeps form controls and settings dropdowns flat', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_LIGHT_FORM_CONTROL_FLAT_1'),
        true,
        'admin studio should include the shared light form-control flattening layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_LIGHT_DROPDOWN_CONTROL_HOVER_FLAT_1'),
        true,
        'admin studio should include the shared light dropdown hover flattening layer'
    );
    assert.equal(
        stylesSource.includes('#module-settings #settings-view-content :is(#perPageDropdown, #defaultSortDropdown) .dropdown-trigger'),
        true,
        'content settings gallery dropdowns should have a dedicated flat light-theme override'
    );
    assert.equal(
        stylesSource.includes('.custom-dropdown.open .dropdown-trigger,\n    .custom-select.open .select-display,'),
        true,
        'custom dropdown open states should not reintroduce floating control shadows'
    );
    assert.equal(
        stylesSource.includes('box-shadow: none !important;\n    -webkit-box-shadow: none !important;\n    filter: none !important;\n    transform: none !important;'),
        true,
        'light form controls should remove shadow, glow, filter, and lift treatment'
    );
    assert.equal(
        adminStudioSource.includes('forms=20260427_ADMIN_STUDIO_LIGHT_FORM_CONTROL_FLAT_1'),
        true,
        'admin studio should cache-bust the flat form-control stylesheet update'
    );
    assert.equal(
        adminStudioSource.includes('dropdowns=20260427_ADMIN_STUDIO_LIGHT_DROPDOWN_CONTROL_HOVER_FLAT_1'),
        true,
        'admin studio should cache-bust the flat dropdown-control stylesheet update'
    );
});

test('admin studio light theme uses the sidebar blue for primary and save buttons', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_SAVE_BUTTON_SHOP_BLUE_1'),
        true,
        'admin studio should include a final shared save-button color layer'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-save-btn-bg: var(--admin-studio-ui-blue, #769dca);'),
        true,
        'save buttons should use the Admin Studio sidebar blue token'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-save-btn-hover-bg: #6f95c0;'),
        true,
        'save buttons should use the sidebar-blue hover tone'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PRIMARY_BUTTON_SIDEBAR_BLUE_1'),
        true,
        'admin studio should include a final sidebar-blue primary button layer'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_PRIMARY_HOVER_NO_BLUE_SHADOW_1'),
        true,
        'admin studio should include a final primary-button hover layer without blue shadow'
    );
    assert.equal(
        stylesSource.includes('--shop-solid-btn-bg: var(--admin-studio-save-btn-bg, var(--admin-studio-ui-blue, #769dca));'),
        true,
        'shop primary buttons should inherit the same sidebar-blue solid button token'
    );
    assert.equal(
        stylesSource.includes('.shop-theme-primary-btn,\n    .btn-sm.btn-primary,\n    .btn-add-config--primary,'),
        true,
        'shop search, small primary, and primary config buttons should share the no-blue-shadow hover feedback'
    );
    assert.equal(
        stylesSource.includes('#module-shop .btn.btn-primary,\n    .shop-theme-primary-btn,'),
        true,
        'the product search button should be covered by the shared primary button color layer'
    );
    assert.equal(
        stylesSource.includes('button[data-admin-action*="save"],\n    button[data-shop-action*="save"],'),
        true,
        'save actions across admin and shop modules should be covered together'
    );
    assert.equal(
        stylesSource.includes('#saveBtn.gallery-save-btn,\n    #discountTriggerRechargeSaveBtn,\n    #pointsPackageSaveBtn,\n    #shopRiskCaseComposerSubmit,\n    #opsAlertBatchMuteSubmit,\n    #productModal .btn-save,'),
        true,
        'save buttons without save-action attributes should be explicitly included'
    );
    assert.equal(
        stylesSource.includes('background: var(--admin-studio-save-btn-bg, var(--admin-studio-ui-blue, #769dca)) !important;'),
        true,
        'save buttons should override late light-theme glass button chrome'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-save-btn-hover-feedback: inset 0 1px 0 rgba(255, 255, 255, 0.24), inset 0 -2px 0 rgba(15, 23, 42, 0.18);'),
        true,
        'save buttons should use inset contrast instead of a blue hover shadow'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-save-btn-shadow-hover'),
        false,
        'save buttons should not define a blue hover shadow token'
    );
    assert.equal(
        stylesSource.includes('transform: translateY(-1px) !important;'),
        true,
        'save buttons should keep a subtle hover lift'
    );
    assert.equal(
        adminStudioSource.includes('saveButtons=20260427_ADMIN_STUDIO_SAVE_BUTTON_SHOP_BLUE_1'),
        true,
        'admin studio should cache-bust the shared save-button stylesheet update'
    );
    assert.equal(
        adminStudioSource.includes('buttonHover=20260427_ADMIN_STUDIO_PRIMARY_HOVER_NO_BLUE_SHADOW_1'),
        true,
        'admin studio should cache-bust the shared primary hover feedback update'
    );
    assert.equal(
        adminStudioSource.includes('primaryBlue=20260427_ADMIN_STUDIO_PRIMARY_BUTTON_SIDEBAR_BLUE_1'),
        true,
        'admin studio should cache-bust the shared sidebar-blue primary button update'
    );
});

test('admin studio analytics ranking lists keep title hover and row dividers in light theme', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_TOP_CONTENT_TITLE_TEXT_HOVER_1'),
        true,
        'admin studio should include the final analytics ranking title hover and divider marker'
    );
    assert.equal(
        stylesSource.includes(':is(#module-analytics, #module-business-overview, #module-growth-center, #module-commerce-center) :is(#topContentList, #topContributorsList) :is(.top-content-item, .contributor-item) + :is(.top-content-item, .contributor-item)::before'),
        true,
        'analytics ranking list dividers should be drawn as stable row separators'
    );
    assert.equal(
        stylesSource.includes(':is(#module-analytics, #module-business-overview, #module-growth-center, #module-commerce-center) #topContentList .top-content-item__title-btn {\n    display: inline-block !important;\n    width: auto !important;'),
        true,
        'top content title buttons should shrink the hover target to the title text width'
    );
    assert.equal(
        stylesSource.includes(':is(#module-analytics, #module-business-overview, #module-growth-center, #module-commerce-center) #topContentList .top-content-item__title-btn:is(:hover, :focus, :focus-visible, :active)'),
        true,
        'top content titles should turn blue from direct title hover or keyboard focus'
    );
    assert.equal(
        stylesSource.includes('#topContentList .top-content-item:is(:hover, :focus-within) .top-content-item__title-btn'),
        false,
        'top content title hover should not be inherited from the whole row'
    );
    assert.equal(
        stylesSource.includes('-webkit-text-fill-color: var(--admin-studio-ui-blue, var(--accent-starry, #769dca)) !important;'),
        true,
        'top content hover should override webkit text fill color in the light theme'
    );
    assert.equal(
        adminStudioSource.includes('topContentTitleHover=20260427_ADMIN_STUDIO_TOP_CONTENT_TITLE_TEXT_HOVER_1'),
        true,
        'admin studio should cache-bust the final top-content hover stylesheet update'
    );
});

test('admin studio analytics text panels expand instead of clipping in light theme', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        adminStudioSource.includes('id="module-business-overview"'),
        true,
        'admin studio analytics workspace should use the current business overview host'
    );
    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_ANALYTICS_CONTENT_CLIP_AUDIT_1'),
        true,
        'admin studio should include the analytics content clipping audit layer'
    );
    assert.equal(
        stylesSource.includes('    #growthActionRecommendations,\n    #growthBreakdownList,'),
        true,
        'growth recommendation and breakdown panels should be covered by the unclipped layout override'
    );
    assert.equal(
        stylesSource.includes('    #growthEventFunnel,\n    #marketingAssetCenterWorkspace'),
        true,
        'growth event and marketing asset panels should be covered by the unclipped layout override'
    );
    assert.equal(
        stylesSource.includes('height: auto !important;\n    min-height: 0 !important;\n    max-height: none !important;\n    overflow: visible !important;'),
        true,
        'text-heavy analytics panels should no longer keep fixed chart heights with hidden overflow'
    );
    assert.equal(
        stylesSource.includes('#marketingAssetCenterWorkspace :is(\n    .marketing-asset-center__summary-card,'),
        true,
        'marketing asset center cards should receive light-theme styling under the current analytics host'
    );
    assert.equal(
        stylesSource.includes('.chart-body.analytics-compact-list > :is(\n    .analytics-compact-stack,\n    .analytics-recommendation-stack\n)'),
        true,
        'compact analytics stacks should stop using internal scroll clipping for these panels'
    );
    assert.equal(
        stylesSource.includes('border-left: 2px solid var(--analytics-distribution-indicator, rgba(var(--admin-studio-module-card-edge-rgb), 0.64)) !important;'),
        true,
        'growth action cards should color the actual left border rail'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_WORKFLOW_CARD_RAIL_VISIBILITY_1'),
        true,
        'marketing workflow cards should include a visible rail color override'
    );
    assert.equal(
        stylesSource.includes('--admin-studio-workflow-rail-alpha: 0.86;'),
        true,
        'marketing workflow cards should raise the default rail contrast above the gray card edge'
    );
    assert.equal(
        stylesSource.includes('.marketing-asset-center__workflow-card--warning'),
        true,
        'marketing workflow cards with pending work should receive a warning rail tone'
    );
    assert.equal(
        adminStudioSource.includes('workflowRails=20260430_ADMIN_STUDIO_WORKFLOW_CARD_RAIL_VISIBILITY_1'),
        true,
        'admin studio should cache-bust the visible marketing workflow rail update'
    );
    assert.equal(
        stylesSource.includes(')::before {\n    content: none !important;\n    display: none !important;\n}\n\nhtml[data-theme="light"] :is(#module-analytics, #module-business-overview, #module-growth-center, #module-commerce-center) :is('),
        true,
        'growth and analytics module cards should disable the old pseudo-element rail'
    );
    assert.equal(
        adminStudioSource.includes('analyticsClip=20260427_ADMIN_STUDIO_ANALYTICS_CONTENT_CLIP_AUDIT_1'),
        true,
        'admin studio should cache-bust the analytics clipping audit stylesheet update'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_BUSINESS_CENTER_SUBCARD_BORDER_SAFE_AREA_8'),
        true,
        'business center should include the subcard border safe-area fix'
    );
    assert.equal(
        stylesSource.includes('.analytics-business-center-shell {\n    --admin-studio-business-center-shell-edge: rgba(70, 98, 132, 0.24);\n    box-sizing: border-box !important;\n    width: auto !important;\n    max-width: none !important;\n    margin-right: 10px !important;'),
        true,
        'business center shell should keep itself away from the right clipping boundary'
    );
    assert.equal(
        stylesSource.includes('.analytics-business-center-shell__body {\n    box-sizing: border-box !important;\n    width: 100% !important;\n    padding: 2px 10px 3px 2px !important;\n    overflow: visible !important;'),
        true,
        'business center body should stop clipping the right edge of child cards'
    );
    assert.equal(
        stylesSource.includes('html:not([data-theme="dark"]) .admin-main-content .analytics-business-center-shell__card::after {\n    content: "" !important;\n    position: absolute !important;\n    inset: 0 !important;\n    z-index: 3 !important;'),
        true,
        'business center child cards should redraw their borders inside the card edge in every admin module host'
    );
    assert.equal(
        stylesSource.includes('html[data-theme="light"] .admin-main-content .analytics-business-center-shell__card > .analytics-business-center-shell__card-top,\nhtml:not([data-theme="dark"]) .admin-main-content .analytics-business-center-shell__card > .analytics-business-center-shell__card-top'),
        true,
        'business center child card tops should not depend on a specific module id to escape global titlebar rules'
    );
    assert.equal(
        stylesSource.includes('.analytics-business-center-shell__hero::after'),
        true,
        'business center hero card should also redraw its internal edge'
    );
    assert.equal(
        stylesSource.includes('margin: 0 0 12px !important;\n    padding: 0 !important;\n    border-radius: 0 !important;'),
        true,
        'business center card tops should follow operating focus plain card rows instead of titlebars'
    );
    assert.equal(
        stylesSource.includes('background: var(--card-bg, rgba(255, 255, 255, 0.82)) !important;\n    background-image: none !important;'),
        true,
        'business center child cards should use the same plain surface as operating focus cards'
    );
    assert.equal(
        stylesSource.includes('border: 0 !important;\n    border-bottom: 0 !important;\n    box-shadow: none !important;'),
        true,
        'business center card tops should not stack their own titlebar lines'
    );
    assert.equal(
        stylesSource.includes('.analytics-business-center-shell__card > .analytics-business-center-shell__card-top::before {\n    content: none !important;\n    display: none !important;'),
        true,
        'business center card titlebars should not stack an extra backing pseudo layer'
    );
    assert.equal(
        stylesSource.includes('inset -1px 0 0 var(--admin-studio-business-center-card-edge)'),
        true,
        'business center child cards should keep a visible internal right edge'
    );
    assert.equal(
        adminStudioSource.includes('businessCenterBorder=20260428_ADMIN_STUDIO_BUSINESS_CENTER_SUBCARD_BORDER_SAFE_AREA_8'),
        true,
        'admin studio should cache-bust the business center border safe-area fix'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_BUSINESS_CENTER_ROUTE_META_FLAT_2'),
        true,
        'business center route meta text should include the flat text override'
    );
    assert.equal(
        stylesSource.includes(') .analytics-business-center-shell__card--warning .analytics-business-center-shell__card-meta {\n    background: transparent !important;\n    background-color: transparent !important;\n    background-image: none !important;\n    border: 0 !important;\n    border-color: transparent !important;\n    box-shadow: none !important;'),
        true,
        'business center route meta text should not inherit warning chip backgrounds'
    );
    assert.equal(
        adminStudioSource.includes('businessCenterRouteMeta=20260428_ADMIN_STUDIO_BUSINESS_CENTER_ROUTE_META_FLAT_2'),
        true,
        'admin studio should cache-bust the business center route meta flat text fix'
    );
});

test('admin studio growth breakdown uses the same compact item structure in light theme', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260427_ADMIN_STUDIO_GROWTH_BREAKDOWN_COMPACT_PARITY_1'),
        true,
        'admin studio should include the growth breakdown compact parity layer'
    );
    assert.equal(
        stylesSource.includes('#growthBreakdownList .analytics-compact-item > .analytics-compact-item__top'),
        true,
        'growth breakdown should undo the light-theme titlebar treatment on compact item top rows'
    );
    assert.equal(
        stylesSource.includes(':is(#module-analytics, #module-business-overview, #module-growth-center, #module-commerce-center) #growthBreakdownList .analytics-compact-item'),
        true,
        'growth breakdown compact parity should cover the current business overview host'
    );
    assert.equal(
        stylesSource.includes('#growthBreakdownList .analytics-compact-item .analytics-compact-item__heading'),
        true,
        'growth breakdown should also neutralize the titlebar treatment on compact item headings'
    );
    assert.equal(
        stylesSource.includes('growthBreakdown=20260427_ADMIN_STUDIO_GROWTH_BREAKDOWN_COMPACT_PARITY_1'),
        false,
        'growth breakdown cache bust should stay in html, not in the stylesheet body'
    );
    assert.equal(
        adminStudioSource.includes('growthBreakdown=20260427_ADMIN_STUDIO_GROWTH_BREAKDOWN_COMPACT_PARITY_1'),
        true,
        'admin studio should cache-bust the growth breakdown compact parity update'
    );
});

test('admin studio shop module reserves mobile dock safe space and stacks narrow controls', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_SHOP_MOBILE_DOCK_SAFE_SPACE_10'),
        true,
        'shop module should include a mobile dock safe-space stylesheet layer'
    );
    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_MOBILE_MODULE_BOTTOM_BREATHING_SPACE_1'),
        true,
        'admin modules should include a shared mobile bottom breathing-space stylesheet layer'
    );
    assert.equal(
        adminStudioSource.includes('<thead>\n                                    <tr>\n                                    <tr>'),
        false,
        'inventory table header should not contain a duplicate row that can destabilize column layout'
    );
    assert.match(
        stylesSource,
        /@media \(max-width: 768px\) \{[\s\S]*#module-shop\s*\{[\s\S]*--shop-admin-mobile-dock-safe-space: calc\(108px \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*padding: 0 max\(12px, env\(safe-area-inset-left, 0px\)\) var\(--shop-admin-mobile-dock-safe-space\) max\(12px, env\(safe-area-inset-right, 0px\)\) !important;[\s\S]*scroll-padding-bottom: var\(--shop-admin-mobile-dock-safe-space\);/,
        'shop module should reserve bottom space for the mobile dock and device safe area'
    );
    assert.match(
        stylesSource,
        /20260428_ADMIN_STUDIO_MOBILE_MODULE_BOTTOM_BREATHING_SPACE_1[\s\S]*@media \(max-width: 768px\) \{[\s\S]*:root\s*\{[\s\S]*--admin-studio-mobile-module-bottom-space: calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*\.admin-main-content > :is\([\s\S]*#module-shop,[\s\S]*#module-payments,[\s\S]*#module-discounts,[\s\S]*#module-tickets[\s\S]*\) \{[\s\S]*padding-bottom: var\(--admin-studio-mobile-module-bottom-space\) !important;[\s\S]*scroll-padding-bottom: var\(--admin-studio-mobile-module-bottom-space\);/,
        'admin modules should share a compact mobile bottom breathing space after the command dock safe-space reset'
    );
    assert.match(
        stylesSource,
        /#module-shop \.shop-view--active > :last-child \{[\s\S]*margin-bottom: 0 !important;/,
        'shop subviews should not stack an extra final margin on top of the shared mobile bottom space'
    );
    assert.match(
        stylesSource,
        /#module-shop \.shop-tabs \{[\s\S]*justify-content: flex-start !important;[\s\S]*overflow-x: auto;[\s\S]*-webkit-overflow-scrolling: touch;/,
        'shop tabs should become a mobile horizontal rail instead of overflowing the viewport'
    );
    assert.match(
        stylesSource,
        /#module-shop \.category-filters \{[\s\S]*flex-wrap: wrap !important;[\s\S]*overflow: visible;/,
        'shop product category filters should wrap instead of clipping off the right edge'
    );
    assert.match(
        stylesSource,
        /#module-shop \.category-filters \.filter-tab \{[\s\S]*flex: 0 1 auto;[\s\S]*max-width: 100%;[\s\S]*overflow-wrap: anywhere;/,
        'shop product category labels should fit narrow screens even when a label is long'
    );
    assert.match(
        stylesSource,
        /#module-shop \.shop-product-toolbar-row,[\s\S]*#module-shop \.shop-orders-search-bar,[\s\S]*#module-shop \.inv-filter-bar,[\s\S]*display: grid !important;[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
        'shop product, order, and inventory toolbars should start from a one-column mobile stack'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-products \.shop-product-toolbar-row \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'shop product toolbar should allow compact two-column action rows on mobile'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-products #productSelectControls \.shop-custom-select\.shop-product-toolbar-select,[\s\S]*#module-shop #shop-view-products #productSelectControls select\.shop-product-toolbar-select:not\(\.shop-native-select--hidden\) \{[\s\S]*flex: 0 0 var\(--shop-product-delivery-mobile-width\) !important;[\s\S]*max-width: var\(--shop-product-delivery-mobile-width\) !important;/,
        'shop product delivery filter should shrink inside the mobile status controls row'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-products #productBatchActionMenu \{[\s\S]*left: auto !important;[\s\S]*right: 0 !important;[\s\S]*border: 0 !important;/,
        'shop product batch menu should open leftward on mobile without the bright edge border'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-products \.shop-product-toolbar-actions,[\s\S]*#module-shop #shop-view-orders \.shop-orders-toolbar-actions,[\s\S]*#module-shop #shop-view-fulfillment \.shop-delivery-filter-actions \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
        'shop product, order, and fulfillment action pairs should share two mobile columns'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-orders \.shop-orders-search-bar \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;[\s\S]*gap: 8px !important;/,
        'order refund and fulfillment filters should share a compact two-column mobile row'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-orders \.shop-orders-search-bar \.lookup-search-box \{[\s\S]*grid-column: 1 \/ -1;/,
        'order search should keep a full-width mobile row around the compact filters'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-orders \.shop-orders-search-bar \.shop-orders-toolbar-actions \{[\s\S]*grid-column: 1 \/ -1;/,
        'order query and export actions should share one full-width mobile row'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-orders \.shop-orders-search-bar \.shop-custom-select\.shop-orders-filter-select \.shop-custom-select__menu \{[\s\S]*width: min\(184px, calc\(100vw - 48px\)\) !important;[\s\S]*inline-size: min\(184px, calc\(100vw - 48px\)\) !important;/,
        'order filter dropdown menus should open as narrow mobile popovers'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-orders \.shop-orders-search-bar \.shop-custom-select\.shop-orders-filter-select\[data-select-id="orderDeliveryStatusFilter"\] \.shop-custom-select__menu \{[\s\S]*right: 0;[\s\S]*width: min\(176px, calc\(100vw - 48px\)\) !important;/,
        'order fulfillment dropdown should align and stay narrower than the filter column'
    );
    assert.match(
        stylesSource,
        /#module-shop \.shop-admin-products-grid,\s*\n\s*#module-shop \.shop-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'shop product cards should use a one-column mobile grid'
    );
    assert.match(
        stylesSource,
        /#module-shop \.inventory-layout,\s*\n\s*#module-shop \.import-layout \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*height: auto !important;/,
        'shop import and inventory layouts should collapse to one mobile column without fixed viewport height'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inventory-stats-row \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;[\s\S]*gap: 8px !important;[\s\S]*margin-bottom: 14px !important;/,
        'inventory stats should stay compact as two mobile columns'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inv-stat-card \{[\s\S]*min-height: 86px;[\s\S]*padding: 12px 14px !important;/,
        'inventory stat cards should reduce their mobile vertical bulk'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inv-filter-bar \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;[\s\S]*grid-auto-flow: row dense;[\s\S]*gap: 8px !important;/,
        'inventory filters should use a compact two-column mobile layout'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inv-filter-bar \.custom-dropdown-menu \{[\s\S]*width: min\(220px, calc\(100vw - 48px\)\) !important;[\s\S]*inline-size: min\(220px, calc\(100vw - 48px\)\) !important;[\s\S]*max-height: min\(300px, calc\(100vh - 260px\)\);/,
        'inventory dropdown menus should use compact mobile popovers instead of viewport-wide panels'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory #statusDropdown \.custom-dropdown-menu \{[\s\S]*left: auto;[\s\S]*right: 0;[\s\S]*width: min\(176px, calc\(100vw - 48px\)\) !important;[\s\S]*inline-size: min\(176px, calc\(100vw - 48px\)\) !important;/,
        'inventory status dropdown should right-align as a narrow compact mobile popover'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory #invDateFilterDropdown \.custom-dropdown-menu \{[\s\S]*left: auto;[\s\S]*right: 0;[\s\S]*width: min\(192px, calc\(100vw - 48px\)\) !important;/,
        'inventory date dropdown should stay narrower than the full mobile filter column'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inv-filter-bar \.custom-dropdown-item \{[\s\S]*min-height: 36px;[\s\S]*padding: 8px 10px;[\s\S]*overflow-wrap: anywhere;/,
        'inventory dropdown options should stay compact and wrap long labels'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory #invDateFilterDropdown \{[\s\S]*order: 3;[\s\S]*grid-column: 1 \/ 2;[\s\S]*grid-row: 2;[\s\S]*width: 100% !important;/,
        'inventory date filter should share a row with the compact selection button on mobile'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inv-search-box \{[\s\S]*order: 5;[\s\S]*grid-column: 1 \/ -1;[\s\S]*width: 100% !important;/,
        'inventory search should keep a full-width row below the compact date and selection controls'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inv-filter-bar > #toggleSelectionBtn,[\s\S]*width: 42px !important;[\s\S]*height: 42px !important;[\s\S]*#module-shop #shop-view-inventory \.inv-filter-bar > #toggleSelectionBtn \{[\s\S]*order: 4;[\s\S]*grid-column: 2 \/ 3;[\s\S]*grid-row: 2;/,
        'inventory manage controls should remain icon-sized and sit beside the mobile date filter'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.inv-filter-bar \.batch-action-wrapper \{[\s\S]*order: 4;[\s\S]*grid-column: 2 \/ 3;[\s\S]*grid-row: 2;[\s\S]*margin-left: 50px !important;/,
        'inventory batch actions button should sit to the right of the mobile selection button'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.shop-table--inventory \{[\s\S]*min-width: 920px;/,
        'inventory tables should keep a deliberate horizontal scroll width on mobile'
    );
    assert.equal(
        stylesSource.includes('#module-shop #shop-view-inventory.shop-inventory-selection-mode .shop-table--inventory {\n        min-width: 984px;'),
        true,
        'inventory selection mode should reserve enough mobile table width for checkbox and buyer/order columns'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.shop-table--inventory \{[\s\S]*--shop-inventory-mobile-row-divider: rgba\(15, 23, 42, 0\.08\);[\s\S]*min-width: 920px;/,
        'inventory mobile table should define a single row divider token'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.shop-table--inventory :is\(th, td\) \{[\s\S]*border-bottom: 0 !important;[\s\S]*overflow: hidden;/,
        'inventory mobile table cells should not draw independent row dividers'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.shop-table--inventory thead tr,[\s\S]*#module-shop #shop-view-inventory \.shop-table--inventory tbody tr \{[\s\S]*border-bottom: 1px solid var\(--shop-inventory-mobile-row-divider\) !important;/,
        'inventory mobile row dividers should be drawn by the full row for aligned buyer/order separators'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory\.shop-inventory-selection-mode :is\([\s\S]*\.inv-checkbox,[\s\S]*\.inv-checkbox-col input\[type="checkbox"\][\s\S]*\) \{[\s\S]*width: 44px !important;[\s\S]*height: 44px !important;[\s\S]*touch-action: manipulation;/,
        'inventory selection checkboxes should expose a larger touch hit target than the visual box'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-inventory \.shop-inventory-content-chip,[\s\S]*#module-shop #shop-view-inventory \.shop-inventory-created-at,[\s\S]*#module-shop #shop-view-inventory \.shop-inventory-buyer-email,[\s\S]*#module-shop #shop-view-inventory \.shop-inventory-buyer-order \{[\s\S]*max-width: 100%;[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/,
        'inventory date and buyer/order text should stay clipped inside their mobile table cells'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-orders \.shop-table--orders \{[\s\S]*min-width: 960px;[\s\S]*table-layout: fixed;/,
        'orders table should reserve enough mobile scroll width for time and product columns'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-orders \.shop-table--orders :is\(td\[data-label="订单时间"\], td\[data-label="商品"\]\) \{[\s\S]*white-space: nowrap !important;[\s\S]*text-overflow: ellipsis;/,
        'orders time and product text should clip instead of overlapping in narrow viewports'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-fulfillment :is\([\s\S]*\.shop-delivery-header,[\s\S]*\.shop-delivery-subcard-header,[\s\S]*\.shop-delivery-strategy-actions,[\s\S]*\.shop-delivery-filter-banner[\s\S]*\) \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'API fulfillment headers and banners should collapse to a safe mobile grid'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-fulfillment \.shop-custom-select\.shop-delivery-filter \.shop-custom-select__menu \{[\s\S]*width: min\(220px, calc\(100vw - 48px\)\) !important;[\s\S]*inline-size: min\(220px, calc\(100vw - 48px\)\) !important;/,
        'API fulfillment dropdown menus should use compact mobile popovers'
    );
    assert.match(
        stylesSource,
        /#module-shop #shop-view-fulfillment \.shop-delivery-empty,[\s\S]*#module-shop #shop-view-fulfillment \.shop-delivery-table-note \{[\s\S]*white-space: normal;[\s\S]*overflow-wrap: anywhere;[\s\S]*writing-mode: horizontal-tb;/,
        'API fulfillment empty states and notes should wrap horizontally on mobile'
    );
    assert.equal(
        stylesSource.includes('#module-shop :is(\n        #inventoryPagination,\n        #ordersPagination,\n        #deliveryTasksPagination,'),
        true,
        'shop pagination rows should be covered by the mobile wrapping safe-space layer'
    );
    assert.equal(
        adminStudioSource.includes('shopMobileDockSafe=20260428_ADMIN_STUDIO_SHOP_MOBILE_DOCK_SAFE_SPACE_10'),
        true,
        'admin studio should cache-bust the shop mobile dock safe-space stylesheet update'
    );
    assert.equal(
        adminStudioSource.includes('mobileModuleBottom=20260428_ADMIN_STUDIO_MOBILE_MODULE_BOTTOM_BREATHING_SPACE_1'),
        true,
        'admin studio should cache-bust the shared mobile module bottom breathing-space stylesheet update'
    );
});

test('admin studio tickets module keeps table details and dialogs usable on mobile', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const ticketsSource = readRepoFile(path.join('js', 'admin-tickets.js'));

    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_TICKETS_MOBILE_ADAPT_2'),
        true,
        'ticket styles should include the mobile adaptation marker'
    );
    assert.equal(
        adminStudioSource.includes('class="glass-panel table-view users-table-panel admin-ticket-table-panel"'),
        true,
        'tickets list should expose a dedicated horizontal-scroll panel class'
    );
    assert.equal(
        adminStudioSource.includes('class="admin-table users-table admin-ticket-table"'),
        true,
        'tickets list should expose a dedicated table class for mobile column sizing'
    );
    assert.match(
        stylesSource,
        /#module-tickets \.admin-ticket-table-panel \{[\s\S]*overflow-x: auto;[\s\S]*-webkit-overflow-scrolling: touch;/,
        'tickets table panel should follow the shop-style horizontal scrolling pattern on mobile'
    );
    assert.match(
        stylesSource,
        /#module-tickets \.admin-ticket-table \{[\s\S]*min-width: 1280px;[\s\S]*margin-right: 18px;[\s\S]*table-layout: fixed;/,
        'tickets table should keep a deliberate mobile scroll width instead of collapsing columns'
    );
    assert.match(
        stylesSource,
        /#module-tickets \.admin-ticket-table :is\(th:nth-child\(5\), td:nth-child\(5\)\) \{[\s\S]*width: 260px;/,
        'tickets issue description column should reserve enough mobile table width'
    );
    assert.match(
        stylesSource,
        /#module-tickets \.admin-ticket-table :is\(th:nth-child\(7\), td:nth-child\(7\)\) \{[\s\S]*width: 240px;/,
        'tickets action column should reserve enough room for action icons and processed text at the right edge'
    );
    assert.match(
        stylesSource,
        /#module-tickets \.admin-ticket-function-nav \{[\s\S]*justify-content: center !important;/,
        'ticket function navigation should remain centered on mobile'
    );
    assert.match(
        stylesSource,
        /#module-tickets \.admin-ticket-overview-reminder-activity-stats \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;[\s\S]*gap: 8px !important;/,
        'ticket reminder activity stats should use compact two-column mobile tiles'
    );
    assert.match(
        stylesSource,
        /#module-tickets \.admin-ticket-overview-reminder-activity-stat \{[\s\S]*min-height: 62px !important;[\s\S]*padding: 8px 10px !important;/,
        'ticket reminder activity stat cards should be visually compact on mobile'
    );
    assert.match(
        stylesSource,
        /\.admin-ticket-reply-modal > \.admin-ticket-reply-modal__panel,[\s\S]*\.admin-ticket-bulk-modal__panel,[\s\S]*\.admin-ticket-summary-job-modal__dialog \{[\s\S]*width: calc\(100vw - 20px\) !important;[\s\S]*padding: 14px !important;/,
        'ticket dialogs should use compact mobile panel sizing'
    );
    assert.match(
        stylesSource,
        /\.admin-ticket-reply-modal__section,[\s\S]*\.admin-ticket-reply-modal__decision-card,[\s\S]*\.admin-ticket-summary-job-modal__section \{[\s\S]*padding: 12px !important;[\s\S]*margin-bottom: 10px !important;/,
        'ticket dialog sections should reduce mobile spacing waste'
    );
    assert.equal(
        ticketsSource.includes('syncTicketsTableScroller'),
        true,
        'tickets renderer should enable the shared horizontal scroll helper'
    );
    assert.equal(
        ticketsSource.includes("metaCell.dataset.label = '工单号/时间';"),
        true,
        'tickets rows should keep semantic mobile cell labels'
    );
    assert.match(
        ticketsSource,
        /<td class="admin-ticket-selection-cell">\s*\$\{includeSelection \? `[\s\S]*admin-skeleton-block--checkbox[\s\S]*` : ''\}\s*<\/td>/,
        'ticket skeleton rows should always reserve the selection cell so body columns match the header'
    );
    assert.equal(
        adminStudioSource.includes('ticketsMobile=20260428_ADMIN_STUDIO_TICKETS_MOBILE_ADAPT_2'),
        true,
        'admin studio should cache-bust the ticket mobile stylesheet update'
    );
    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3'),
        true,
        'ticket styles should include the dense mobile queue alignment marker'
    );
    assert.match(
        stylesSource,
        /20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3[\s\S]*#module-tickets \.filter-dropdowns,[\s\S]*#module-tickets \.admin-ticket-quick-filters \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'ticket status and quick filters should stay two-up on phone widths that can fit them'
    );
    assert.match(
        stylesSource,
        /20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3[\s\S]*#module-tickets \.admin-ticket-table-panel \{[\s\S]*overflow-x: auto !important;[\s\S]*-webkit-overflow-scrolling: touch !important;/,
        'ticket mobile table should keep horizontal scrolling so all business columns remain available'
    );
    assert.match(
        stylesSource,
        /20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3[\s\S]*#module-tickets \.admin-ticket-table,[\s\S]*#module-tickets:not\(\[data-ticket-select-mode="true"\]\) \.admin-ticket-table,[\s\S]*#module-tickets\[data-ticket-select-mode="true"\] \.admin-ticket-table \{[\s\S]*width: 1280px !important;[\s\S]*min-width: 1280px !important;/,
        'ticket mobile table should keep a deliberate scroll width instead of collapsing to two columns'
    );
    assert.match(
        stylesSource,
        /20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3[\s\S]*#module-tickets \.admin-ticket-table :is\([\s\S]*th:nth-child\(2\),[\s\S]*td:nth-child\(7\)[\s\S]*\),[\s\S]*#module-tickets\[data-ticket-select-mode="true"\] \.admin-ticket-table :is\(th:nth-child\(1\), td:nth-child\(1\)\) \{[\s\S]*display: table-cell !important;/,
        'ticket mobile table should keep every business column rendered after the skeleton alignment fix'
    );
    assert.match(
        stylesSource,
        /20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3[\s\S]*#module-tickets \.admin-ticket-table :is\(th:nth-child\(6\), td:nth-child\(6\)\) \{[\s\S]*width: 180px !important;[\s\S]*text-align: left !important;/,
        'ticket category/status cells should keep a dedicated mobile column aligned with their header'
    );
    assert.match(
        stylesSource,
        /20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3[\s\S]*#module-tickets \.admin-ticket-table :is\(th:nth-child\(7\), td:nth-child\(7\)\) \{[\s\S]*width: 240px !important;[\s\S]*text-align: left !important;/,
        'ticket action cells should keep a dedicated mobile column aligned with their header'
    );
    assert.equal(
        adminStudioSource.includes('ticketsMobileDense=20260430_ADMIN_STUDIO_TICKETS_MOBILE_QUEUE_DENSE_ALIGN_3'),
        true,
        'admin studio should cache-bust the dense ticket mobile queue alignment update'
    );
    assert.equal(
        adminStudioSource.includes('js/admin-tickets.js?v=20260428_TICKETS_MOBILE_TABLE_LABELS_1'),
        true,
        'admin studio should cache-bust the ticket row label and scroller update'
    );
});

test('points generated result meta pills stay readable in light theme', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));

    assert.equal(
        stylesSource.includes('20260430_ADMIN_STUDIO_POINTS_GENERATED_RESULT_LIGHT_PILLS_1'),
        true,
        'points generated result styles should include the light-theme meta pill marker'
    );
    assert.match(
        stylesSource,
        /html\[data-theme="light"\] #module-points #generatedCodesResult \.points-generated-result__meta span,[\s\S]*html:not\(\[data-theme="dark"\]\) #module-points #generatedCodesResult \.points-generated-result__meta span \{[\s\S]*background: rgba\(241, 245, 249, 0\.94\) !important;[\s\S]*border-color: rgba\(70, 98, 132, 0\.24\) !important;[\s\S]*color: #1e293b !important;[\s\S]*-webkit-text-fill-color: #1e293b !important;/,
        'generated success meta pills should override dark-theme text and capsule chrome in light mode'
    );
    assert.equal(
        adminStudioSource.includes('pointsGeneratedResultPills=20260430_ADMIN_STUDIO_POINTS_GENERATED_RESULT_LIGHT_PILLS_1'),
        true,
        'admin studio should cache-bust the points generated result light pill update'
    );
});
