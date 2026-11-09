const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin studio sidebar nav scrollbar auto-hides with dedicated styles and runtime bindings', () => {
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const adminSidebarCss = readRepoFile('admin-sidebar.css');
    const adminStudioJs = readRepoFile('admin-studio.js');
    const helperSource = readRepoFile('js/admin-scrollbar-auto-hide-helper.js');

    // 1. admin-studio.html markup
    assert.match(
        adminStudioHtml,
        /<nav\s+class="sidebar-nav\s+admin-scrollbar-auto-hide">/,
        'admin-studio.html should apply admin-scrollbar-auto-hide class to sidebar-nav'
    );

    // 2. Cache busting in admin-studio.html
    assert.equal(
        adminStudioHtml.includes('sidebarScrollbarAutoHide=20261107_ADMIN_SIDEBAR_SCROLLBAR_AUTO_HIDE_1'),
        true,
        'admin-studio.html should include cache-busting parameter for sidebar scrollbar auto-hide'
    );

    // 3. CSS variables for dark and light theme
    assert.match(
        adminSidebarCss,
        /--sidebar-scrollbar-thumb:\s*rgba\(15,\s*23,\s*42,\s*0\.18\);/,
        'admin-sidebar.css should define light theme scrollbar thumb'
    );
    assert.match(
        adminSidebarCss,
        /\[data-theme="dark"\]\s+\.admin-sidebar\s*\{[\s\S]*--sidebar-scrollbar-thumb:\s*rgba\(255,\s*255,\s*255,\s*0\.18\);/,
        'admin-sidebar.css should define dark theme scrollbar thumb'
    );

    // 4. sidebar-nav scrollbar rules in admin-sidebar.css
    assert.match(
        adminSidebarCss,
        /\.sidebar-nav\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overflow-x:\s*hidden;[\s\S]*scrollbar-width:\s*thin;[\s\S]*scrollbar-color:\s*transparent transparent !important;/,
        'admin-sidebar.css should configure sidebar-nav with hidden scrollbar by default'
    );
    assert.match(
        adminSidebarCss,
        /\.sidebar-nav::-webkit-scrollbar-thumb\s*\{[\s\S]*background:\s*transparent !important;[\s\S]*border-radius:\s*999px;/,
        'admin-sidebar.css should set transparent webkit scrollbar thumb with rounded corners'
    );
    assert.match(
        adminSidebarCss,
        /\.sidebar-nav\.admin-scrollbar-auto-hide--visible::-webkit-scrollbar-thumb,\s*\.sidebar-nav:focus-within::-webkit-scrollbar-thumb\s*\{[\s\S]*background:\s*var\(--sidebar-scrollbar-thumb/,
        'admin-sidebar.css should make scrollbar thumb visible when active or focused'
    );

    // 5. Runtime bindings in admin-studio.js and helper
    assert.match(
        adminStudioJs,
        /const ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR = \[\s*'\.sidebar-nav'/,
        'admin-studio.js should include .sidebar-nav in ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR'
    );
    assert.match(
        helperSource,
        /const ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR = \[\s*'\.sidebar-nav'/,
        'js/admin-scrollbar-auto-hide-helper.js should include .sidebar-nav in ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR'
    );
});
