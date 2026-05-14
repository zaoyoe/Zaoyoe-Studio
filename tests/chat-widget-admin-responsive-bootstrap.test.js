const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin chat bootstrap adoption does not pin the real layout to narrow mode', () => {
    const source = readRepoFile(path.join('js', 'components', 'ChatWidget.js'));
    const loaderSource = readRepoFile(path.join('js', 'chat-widget-loader.js'));

    assert.match(
        source,
        /claimBootstrapShell\(mode = 'user'\) \{[\s\S]*shell\.classList\.remove\('admin-mode-layout--narrow'\);/,
        'bootstrap shell adoption should clear the temporary narrow class before rendering real admin content'
    );
    assert.match(
        source,
        /claimBootstrapShell\(mode = 'user'\) \{[\s\S]*shell\.classList\.remove\('chat-widget-bootstrap-shell--desktop-edge-safe'\);/,
        'bootstrap shell adoption should let the real runtime own fullscreen desktop centering'
    );
    assert.doesNotMatch(
        source,
        /claimBootstrapShell\(mode = 'user'\) \{[\s\S]*shell\.classList\.toggle\('admin-mode-layout--narrow', normalizedMode === 'admin'\);/,
        'admin bootstrap adoption should not force the narrow class based only on mode'
    );
    assert.match(
        source,
        /completeBootstrapShellAdoption\(\) \{[\s\S]*this\.chatWindow\.classList\.remove\('admin-mode-layout--narrow'\);[\s\S]*this\.syncAdminResponsiveLayout\(\{ force: true \}\);/,
        'completion should remove inherited bootstrap narrow state and remeasure the real layout'
    );
    assert.doesNotMatch(
        source,
        /completeBootstrapShellAdoption\(\) \{[\s\S]*this\.chatWindow\.classList\.toggle\('admin-mode-layout--narrow', Boolean\(this\.isAdmin\)\);/,
        'completion should not default all admin windows to the narrow single-pane layout'
    );
    assert.match(
        loaderSource,
        /\.chat-widget-bootstrap-shell--admin\.chat-window\[data-chat-widget-bootstrap-adopted="1"\] \{[\s\S]*flex-direction: row !important;/,
        'adopted admin bootstrap shell should use the real two-column layout instead of the loading-only column layout'
    );
    assert.match(
        source,
        /\.chat-window\.admin-mode-layout\.chat-widget-bootstrap-shell--admin\[data-chat-widget-bootstrap-adopted="1"\] \{[\s\S]*flex-direction: row !important;/,
        'runtime admin styles should also keep the adopted shell in the two-column layout during handoff'
    );
    assert.match(
        loaderSource,
        /\.chat-window\.admin-mode-layout:not\(\[data-chat-widget-bootstrap-shell="1"\]\) \{[\s\S]*top: var\(--chat-admin-top-gap\) !important;[\s\S]*right: 30px !important;/,
        'windowed admin handoff guard should keep the real workspace at the normal top inset'
    );
    assert.match(
        loaderSource,
        /\.chat-window\.admin-mode-layout\.chat-window--desktop-edge-safe:not\(\[data-chat-widget-bootstrap-shell="1"\]\) \{[\s\S]*top: 50% !important;/,
        'fullscreen admin handoff guard should own the vertical centering branch explicitly'
    );
    assert.match(
        loaderSource,
        /@media \(max-width: 700px\) \{[\s\S]*\.chat-window\.admin-mode-layout:not\(\[data-chat-widget-bootstrap-shell="1"\]\) \{[\s\S]*left: 50% !important;[\s\S]*right: auto !important;[\s\S]*transform: translate3d\(-50%, calc\(-50% \+ 24px\), 0\) scale\(0\.94\) !important;/,
        'narrow admin handoff guard should use centered modal geometry instead of the desktop right edge anchor'
    );
});

test('admin chat first open keeps admin mode through auth cache and queued open replay', () => {
    const source = readRepoFile(path.join('js', 'components', 'ChatWidget.js'));

    const requiredMarkers = [
        'getAdminAccessCacheStorageKey()',
        "return 'zaoyoe_admin_access_cache_v1';",
        'readRecentAdminAccessCache(userId = \'\')',
        'const access = await window.AdminAccess?.getCurrentAdminAccess?.({ forceRefresh: false });',
        'if (access?.error && cachedAdminAccess?.isAdmin) {',
        'const verifiedAccess = await window.AdminAccess?.getCurrentAdminAccess?.({',
        'if (cachedAdminAccess?.isAdmin) {',
        'return this.openChat().catch((error) => {'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `js/components/ChatWidget.js should contain ${marker}`);
    }
});
