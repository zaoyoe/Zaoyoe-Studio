const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop save validation reuses existing-product fallback payload before validate_product', () => {
    const source = readRepoFile(path.join('js', 'admin-shop.js'));

    assert.match(
        source,
        /const validationPayload = id\s*\?\s*this\.buildExistingProductUpsertPayload\(id, payload\)\s*:\s*payload;/
    );
    assert.match(
        source,
        /const validation = await this\.validateProductPayloadViaAdminApi\(\{\s*productId: id,\s*payload: validationPayload,/
    );
});
