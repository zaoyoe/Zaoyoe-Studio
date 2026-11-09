const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workbenchHtmlPath = path.resolve(__dirname, '../workbench.html');
const workbenchJsPath = path.resolve(__dirname, '../js/ai-image-workbench.js');
const workbenchCssPath = path.resolve(__dirname, '../css/ai-image-workbench.css');

test('workbench.html exists and loads essential workbench assets', () => {
    assert.equal(fs.existsSync(workbenchHtmlPath), true, 'workbench.html should exist');
    const html = fs.readFileSync(workbenchHtmlPath, 'utf8');

    assert.match(html, /class="ai-image-workbench-standalone"/);
    assert.match(html, /data-theme="dark"/);
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.match(html, /<script src="\.\/js\/theme-preload\.js/);
    assert.match(html, /css\/ai-image-workbench\.css/);
    assert.match(html, /js\/ai-image-workbench\.js/);
    assert.match(html, /js\/ai-chat-model-capabilities\.js/);
    assert.match(html, /vendor\/fontawesome\/6\.4\.0\/css\/all\.min\.css/);
    assert.match(html, /vendor\/supabase\/2\.95\.3\/supabase\.js/);
    assert.match(html, /js\/wallet-modal-loader\.js/);
});

test('ai image workbench script supports standalone window mode and parameter handoff', () => {
    const js = fs.readFileSync(workbenchJsPath, 'utf8');

    assert.match(js, /function isStandaloneMode\(\)/);
    assert.match(js, /function buildStandaloneWorkbenchUrl\(payload = \{\}\)/);
    assert.match(js, /function openStandaloneWorkbenchWindow\(payload = \{\}\)/);
    assert.match(js, /function consumeInitialStandalonePayload\(\)/);
    assert.match(js, /function returnToPromptGallery\(\)/);

    // Clicking dock or opening from non-standalone page delegates to new window
    assert.match(js, /if \(!isStandaloneMode\(\)\) \{\s*openStandaloneWorkbenchWindow\(payload\);\s*return;\s*\}/);

    // Standalone return button has fa-arrow-left icon and tooltip
    assert.match(js, /isStandalone \? 'fa-arrow-left' : 'fa-times'/);
    assert.match(js, /const returnTooltip = '返回灵感库';/);
    assert.match(js, /data-tooltip="\$\{escapeHtml\(closeTitle\)\}"/);
});

test('ai image workbench css provides full-window styles for standalone mode', () => {
    const css = fs.readFileSync(workbenchCssPath, 'utf8');

    assert.match(css, /body\.ai-image-workbench-standalone/);
    assert.match(css, /body\.ai-image-workbench-standalone \.ai-image-dock\s*\{[\s\S]*display: none !important;/);
    assert.match(css, /body\.ai-image-workbench-standalone \.ai-image-overlay\s*\{[\s\S]*position: fixed !important;[\s\S]*width: 100vw !important;[\s\S]*height: 100vh !important;/);
    assert.match(css, /body\.ai-image-workbench-standalone \.ai-image-shell\s*\{[\s\S]*width: 100vw !important;[\s\S]*height: 100vh !important;/);
    assert.match(css, /\.ai-image-shell-close\[data-tooltip\]::before/);
    assert.match(css, /\.ai-image-shell-close:hover i\.fa-arrow-left/);
});

test('ai image workbench supports auto-hiding scrollbars and light-mode theme adaptation', () => {
    const css = fs.readFileSync(workbenchCssPath, 'utf8');
    const js = fs.readFileSync(workbenchJsPath, 'utf8');

    // Theme scrollbar tokens
    assert.match(css, /--aiw-scrollbar-track:\s*transparent;/);
    assert.match(css, /--aiw-scrollbar-thumb:\s*rgba\(15,\s*23,\s*42,\s*0\.20\);/);
    assert.match(css, /--aiw-scrollbar-thumb-hover:\s*rgba\(15,\s*23,\s*42,\s*0\.36\);/);
    assert.match(css, /html\[data-theme="dark"\]\s*\{[\s\S]*--aiw-scrollbar-thumb:\s*rgba\(255,\s*255,\s*255,\s*0\.20\);/);

    // Color scheme declaration for light theme
    assert.match(css, /html\[data-theme="light"\]\.ai-image-workbench-standalone[\s\S]*color-scheme:\s*light;/);

    // Standalone surface adapts to light mode rather than hardcoding #070707
    assert.match(css, /body\.ai-image-workbench-standalone,\s*html\.ai-image-workbench-standalone\s*\{[\s\S]*background:\s*var\(--aiw-surface-strong\)\s*!important;/);
    assert.match(css, /body\.ai-image-workbench-standalone \.ai-image-shell\s*\{[\s\S]*background:\s*var\(--aiw-surface-strong\)\s*!important;/);

    // Scrollbar rules auto-hide (transparent when idle, thin width, custom thumb on hover / active scroll)
    assert.match(css, /\.ai-image-main-prompt[\s\S]*scrollbar-width:\s*thin;[\s\S]*scrollbar-color:\s*transparent transparent;/);
    assert.match(css, /\.ai-image-main-prompt::-webkit-scrollbar[\s\S]*width:\s*6px;[\s\S]*background:\s*transparent\s*!important;/);
    assert.match(css, /\.ai-image-main-prompt::-webkit-scrollbar-thumb[\s\S]*background:\s*transparent;/);
    assert.match(css, /\.ai-image-main-prompt:hover::-webkit-scrollbar-thumb[\s\S]*background:\s*var\(--aiw-scrollbar-thumb\);/);
    assert.match(css, /\.ai-image-main-prompt\[data-aiw-scrolling="true"\]::-webkit-scrollbar-thumb[\s\S]*background:\s*var\(--aiw-scrollbar-thumb\);/);

    // Scroll event listener in workbench JS to handle auto-hide during scroll
    assert.match(js, /function handleRootScroll\(event\)/);
    assert.match(js, /target\.setAttribute\('data-aiw-scrolling',\s*'true'\);/);
    assert.match(js, /root\.addEventListener\('scroll',\s*handleRootScroll,\s*\{\s*passive:\s*true,\s*capture:\s*true\s*\}\);/);
});

test('ai image workbench send button defaults to gray, becomes colorful with prompt, and shows login tooltip when blocked', () => {
    const css = fs.readFileSync(workbenchCssPath, 'utf8');
    const js = fs.readFileSync(workbenchJsPath, 'utf8');

    // CSS default button is gray and transitions to colorful when .has-prompt is present
    assert.match(css, /\.ai-image-main-submit\s*\{[\s\S]*background:\s*rgba\(102,\s*112,\s*133,\s*0\.16\);/);
    assert.match(css, /html\[data-theme="dark"\]\s*\.ai-image-main-submit\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.08\);/);
    assert.match(css, /\.ai-image-main-submit\.has-prompt\s*\{[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--aiw-blue\),\s*var\(--aiw-green\)\);/);

    // CSS blocked state prevents submission while enabling tooltip on hover
    assert.match(css, /\.ai-image-main-submit\.is-blocked[\s\S]*cursor:\s*not-allowed\s*!important;[\s\S]*pointer-events:\s*auto\s*!important;/);
    assert.match(css, /\.ai-image-main-submit\[data-tooltip\]::before/);
    assert.match(css, /\.ai-image-main-submit\[data-tooltip\]:hover::before/);

    // JS auth check: logged in users are never blocked by login
    assert.match(js, /function isWorkbenchAuthOrBillingBlocked\(\)\s*\{[\s\S]*if \(isUserLoggedIn\(\)\) return false;/);
    assert.match(js, /function syncComposerSubmitButtonState\(\)/);
    assert.match(js, /const blockedTooltip = isBlocked \? '请登录后使用' : '';/);
    assert.match(js, /submitBtn\.classList\.toggle\('has-prompt',\s*hasPrompt\);/);
    assert.match(js, /submitBtn\.classList\.toggle\('is-blocked',\s*isBlocked\);/);
    assert.match(js, /submitBtn\.setAttribute\('data-tooltip',\s*blockedTooltip\);/);

    // Native browser title is cleared to prevent duplicate built-in system tooltip overlay
    assert.match(js, /submitBtn\.removeAttribute\('title'\);/);

    // Prompt textarea input listener synchronizes submit button colors and blocked state in real-time
    assert.match(js, /function handleRootInput\(event\)\s*\{[\s\S]*syncComposerSubmitButtonState\(\);/);
});

test('ai image workbench sidebar rail features top toggle button, compose icon, shifted mode switcher, and pill tooltips', () => {
    const css = fs.readFileSync(workbenchCssPath, 'utf8');
    const js = fs.readFileSync(workbenchJsPath, 'utf8');

    // 1. Top sidebar toggle button with panel-left-open / panel-left-close SVG
    assert.match(js, /class="ai-image-rail-brand \$\{sidebarView \? 'is-sidebar-open' : ''\}"/);
    assert.match(js, /data-aiw-action="toggle-sidebar"/);
    assert.match(js, /ai-image-rail-icon-panel/);
    assert.match(js, /data-rail-tooltip="\$\{sidebarView \? '收起侧栏' : '展开侧栏'\}"/);

    // 2. New chat button redrawn with compose pencil in loop SVG
    assert.match(js, /class="ai-image-rail-btn ai-image-rail-btn--new"/);
    assert.match(js, /ai-image-rail-compose-icon/);
    assert.match(js, /data-rail-tooltip="新建对话"/);

    // 3. Mode switcher vertically centered on desktop
    assert.match(css, /\.ai-image-history-rail \.ai-image-rail-mode-switcher\s*\{[\s\S]*margin:\s*auto 0;/);

    // 4. Hover no longer expands collapsed sidebar width (stays 58px)
    assert.match(css, /\.ai-image-history-sidebar\.is-collapsed:hover\s*\{[\s\S]*grid-template-columns:\s*58px 0;[\s\S]*flex-basis:\s*58px;[\s\S]*width:\s*58px;/);
    assert.match(css, /\.ai-image-history-sidebar\.is-collapsed:hover \.ai-image-rail-btn\s*\{[\s\S]*width:\s*42px;[\s\S]*justify-content:\s*center;/);

    // 5. Capsule pill floating tooltips with high contrast
    assert.match(css, /\.ai-image-history-rail \[data-rail-tooltip\]::before\s*\{[\s\S]*border-radius:\s*9999px;[\s\S]*background:\s*#ececec;[\s\S]*color:\s*#171717;/);
    assert.match(css, /html\[data-theme="light"\] \.ai-image-history-rail \[data-rail-tooltip\]::before[\s\S]*background:\s*#1f1f1f;[\s\S]*color:\s*#f5f5f5;/);
    assert.match(css, /\.ai-image-history-rail \[data-rail-tooltip\]:hover::before/);

    // 6. New chat and history buttons default transparent and match text button hover (transparent bg + blue text)
    assert.match(css, /\.ai-image-rail-btn--new\s*\{[\s\S]*border-color:\s*transparent;[\s\S]*color:\s*var\(--aiw-muted\);[\s\S]*background:\s*transparent;/);
    assert.match(css, /\.ai-image-rail-btn--new:hover,[\s\S]*\.ai-image-rail-btn--new:focus-visible\s*\{[\s\S]*border-color:\s*transparent;[\s\S]*color:\s*var\(--aiw-blue\);[\s\S]*background:\s*transparent;/);
    assert.match(css, /\.ai-image-rail-btn:hover,[\s\S]*\.ai-image-rail-btn:focus-visible,[\s\S]*\.ai-image-rail-btn\.is-active\s*\{[\s\S]*border-color:\s*transparent;[\s\S]*color:\s*var\(--aiw-blue\);[\s\S]*background:\s*transparent;/);

    // 7. Text, Image, and Video buttons rendered with matching outline stroke SVGs instead of solid filled icons
    assert.match(js, /function renderWorkbenchRailModeIcon\(id\)/);
    assert.match(js, /ai-image-rail-mode-icon--chat/);
    assert.match(js, /ai-image-rail-mode-icon--image/);
    assert.match(js, /ai-image-rail-mode-icon--video/);
    assert.match(css, /\.ai-image-rail-mode-icon\s*\{[\s\S]*stroke:\s*currentColor;[\s\S]*stroke-width:\s*2;/);

    // 8. Re-entering workbench starts with an empty prompt textarea (no persisted draft restoration)
    assert.match(js, /function restoreState\(\)\s*\{[\s\S]*state\.prompt = '';/);
    assert.match(js, /function openWorkbench\(payload = \{\}\)\s*\{[\s\S]*if \(!wasOpen && !payload\?\.prompt\) \{\s*state\.prompt = '';\s*\}/);
});
