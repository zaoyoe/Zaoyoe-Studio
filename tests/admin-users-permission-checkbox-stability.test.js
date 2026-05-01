const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('user detail permission checkboxes keep stable hit targets while permission insights update', () => {
    const usersSource = readRepoFile('admin-users.js');
    const styles = readRepoFile('admin-studio.css');

    assert.match(
        usersSource,
        /function buildModalAdminPermissionCheckboxId\(/,
        'permission checklist should build stable checkbox ids'
    );
    assert.match(
        usersSource,
        /<label class="perm-item perm-item--rich" for="\$\{escapeHtml\(checkboxId\)\}">/,
        'permission checklist label should target the checkbox explicitly'
    );
    assert.match(
        usersSource,
        /<input id="\$\{escapeHtml\(checkboxId\)\}" class="perm-item-input" type="checkbox" data-perm="\$\{escapeHtml\(permissionKey\)\}"/,
        'permission checklist checkbox should expose the same stable id'
    );
    assert.match(
        usersSource,
        /<span class="perm-item-check" aria-hidden="true"><\/span>/,
        'permission checklist should render a sibling checkmark instead of painting on the native input'
    );
    assert.match(
        usersSource,
        /id="modalAdminPermissionCoverage" aria-live="polite" data-empty="\$\{permissionList\.length === 0 \? '1' : '0'\}"/,
        'initial permission coverage state should be available before the first insights sync'
    );

    assert.match(
        styles,
        /\.perm-coverage-card\s*\{[\s\S]*min-height:\s*126px;[\s\S]*max-height:\s*126px;[\s\S]*overflow:\s*hidden;/,
        'permission coverage card height should stay fixed so checkbox rows do not shift after each click'
    );
    assert.match(
        styles,
        /\.perm-coverage-pills\s*\{[\s\S]*max-height:\s*56px;[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/,
        'overflowing permission coverage pills should scroll inside the fixed card'
    );
    assert.match(
        styles,
        /\.perm-item\s*\{[\s\S]*min-height:\s*42px;[\s\S]*user-select:\s*none;[\s\S]*touch-action:\s*manipulation;/,
        'permission rows should keep a stable click target'
    );
    assert.match(
        styles,
        /\.perm-item input\[type="checkbox"\]\s*\{[\s\S]*position:\s*absolute;[\s\S]*opacity:\s*0;[\s\S]*box-sizing:\s*border-box;/,
        'native permission checkbox inputs should keep state while the visual box is rendered separately'
    );
    assert.match(
        styles,
        /\.perm-item-check\s*\{[\s\S]*flex:\s*0 0 20px;[\s\S]*box-sizing:\s*border-box;/,
        'permission checkbox visuals should not resize inside flex rows'
    );
    assert.doesNotMatch(
        styles,
        /\.perm-item input\[type="checkbox"\]::after/,
        'permission checkmark should not rely on checkbox pseudo-elements that can miss repainting in modal scrollers'
    );
    assert.match(
        styles,
        /\.perm-item input\[type="checkbox"\]:checked \+ \.perm-item-check/,
        'checked state should drive the sibling visual checkmark'
    );
    assert.match(
        styles,
        /\.perm-item input:checked\s*~\s*\.perm-item-copy/,
        'checked permission copy styling should skip over the sibling checkmark'
    );
    assert.match(
        styles,
        /\.perm-item input\[type="checkbox"\]:active\s*\{[\s\S]*transform:\s*none;/,
        'permission checkboxes should not shift under the pointer while pressed'
    );
    assert.match(
        styles,
        /\.inv-checkbox:active,\s*\.inv-checkbox-col input\[type="checkbox"\]:active\s*\{[\s\S]*transform:\s*none;/,
        'inventory checkboxes copied from the permission style should keep the same stable press behavior'
    );
});
