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
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));
    const migrationSource = readRepoFile(path.join('supabase', 'add_product_description_visibility.sql'));

    assert.match(
        adminHtmlSource,
        /id="prodShowProductDescription"/,
        'admin product modal should expose a dedicated product description visibility switch'
    );
    assert.match(
        adminShopSource,
        /case 'product-toggle-description-visibility':\s+this\.updatePreview\(\);/s,
        'admin shop runtime should keep the description visibility toggle wired'
    );
    assert.match(
        adminShopSource,
        /payload\.show_product_description = showProductDescription;/,
        'admin shop saves should persist the description visibility flag when the toggle changes'
    );
    assert.match(
        adminShopSource,
        /const previewDesc = document\.getElementById\('previewDesc'\);[\s\S]*if \(previewDesc\) \{/,
        'admin runtime should tolerate product forms without the removed preview description node'
    );
    assert.match(
        shopClientSource,
        /shouldShowProductCardDescription: function \(product\) \{\s+return product\?\.show_product_description !== false;/s,
        'shop storefront should default to showing descriptions unless the persisted flag is explicitly false'
    );
    assert.match(
        shopClientSource,
        /const descriptionMarkup = showDescriptionOnCard[\s\S]*shop-card-desc--placeholder" aria-hidden="true"/,
        'shop product cards should preserve a hidden description placeholder when the visibility switch is off'
    );
    assert.match(
        shopCssSource,
        /\.shop-card-desc--placeholder\s*\{\s*visibility: hidden;\s*\}/,
        'shop product cards should keep hidden description placeholders in layout so card heights stay aligned'
    );
    assert.match(
        shopCssSource,
        /@media \(min-width: 769px\) \{\s*\.shop-card\.user-product-card\s*\{\s*min-height: 357px;\s*\}\s*\}/,
        'desktop shop product cards should keep the standard with-description card height as the minimum'
    );
    assert.match(
        migrationSource,
        /ADD COLUMN IF NOT EXISTS show_product_description BOOLEAN DEFAULT true;/,
        'database migration helper should add the description visibility column with a true default'
    );
});
