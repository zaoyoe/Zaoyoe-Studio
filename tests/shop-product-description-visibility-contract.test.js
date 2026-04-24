const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop product description visibility toggle is wired through admin, storefront, and migration files', () => {
    const adminHtmlSource = readRepoFile('admin-studio.html');
    const adminShopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const migrationSource = readRepoFile(path.join('supabase', 'add_product_description_visibility.sql'));

    assert.match(
        adminHtmlSource,
        /id="prodShowProductDescription"/,
        'admin product modal should expose a dedicated product description visibility switch'
    );
    assert.match(
        adminShopSource,
        /case 'product-toggle-description-visibility':\s+this\.updatePreview\(\);/s,
        'admin shop runtime should refresh the live preview when the description visibility switch changes'
    );
    assert.match(
        adminShopSource,
        /payload\.show_product_description = showProductDescription;/,
        'admin shop saves should persist the description visibility flag when the toggle changes'
    );
    assert.match(
        adminShopSource,
        /previewDesc\.hidden = !showProductDescription;/,
        'admin live preview should hide the description block when the switch is off'
    );
    assert.match(
        shopClientSource,
        /shouldShowProductCardDescription: function \(product\) \{\s+return product\?\.show_product_description !== false;/s,
        'shop storefront should default to showing descriptions unless the persisted flag is explicitly false'
    );
    assert.match(
        shopClientSource,
        /\$\{showDescriptionOnCard \? `<p class="shop-card-desc">/,
        'shop product cards should only render the description paragraph when the visibility switch is on'
    );
    assert.match(
        migrationSource,
        /ADD COLUMN IF NOT EXISTS show_product_description BOOLEAN DEFAULT true;/,
        'database migration helper should add the description visibility column with a true default'
    );
});
