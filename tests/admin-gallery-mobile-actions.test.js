const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('gallery prompt action buttons wrap safely on mobile cards', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260430_ADMIN_GALLERY_MOBILE_CONTEXT_ACTIONS_WRAP_1'),
        true,
        'gallery mobile context action fix should carry a unique marker'
    );
    assert.match(
        styles,
        /@media \(max-width: 600px\) \{[\s\S]*#module-gallery \.admin-card-context-actions \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*#module-gallery \.admin-card-context-btn \{[\s\S]*box-sizing: border-box;[\s\S]*#module-gallery \.admin-card-context-btn--primary,[\s\S]*#module-gallery \.admin-card-context-btn\.is-active \{[\s\S]*grid-column: 1 \/ -1;/,
        'mobile gallery cards should put the homepage action on its own row instead of squeezing three buttons'
    );
    assert.equal(
        html.includes('galleryMobileActions=20260430_ADMIN_GALLERY_MOBILE_CONTEXT_ACTIONS_WRAP_1'),
        true,
        'admin studio should cache-bust the gallery mobile action button fix'
    );
});
