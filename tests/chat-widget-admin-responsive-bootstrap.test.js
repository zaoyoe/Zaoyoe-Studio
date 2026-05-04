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

    assert.match(
        source,
        /claimBootstrapShell\(mode = 'user'\) \{[\s\S]*shell\.classList\.remove\('admin-mode-layout--narrow'\);/,
        'bootstrap shell adoption should clear the temporary narrow class before rendering real admin content'
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
});
