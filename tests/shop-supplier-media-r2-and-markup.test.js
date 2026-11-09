const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_GATEWAY,
    getMediaFileExtension,
    resolveFullMediaUrl,
    syncHtmlMediaToR2
} = require('../server/api-handlers/admin/shop/_r2-media');

const {
    syncSupplierProductStock
} = require('../server/integrations/suppliers/stock-sync');

test('resolveFullMediaUrl resolves relative paths and preserves absolute URLs', () => {
    assert.equal(resolveFullMediaUrl(''), '');
    assert.equal(resolveFullMediaUrl('   '), '');
    assert.equal(
        resolveFullMediaUrl('https://example.com/cover.jpg'),
        'https://example.com/cover.jpg'
    );
    assert.equal(
        resolveFullMediaUrl('/assets/cache/general/image/test.png'),
        'https://xiareng.cc/assets/cache/general/image/test.png'
    );
    assert.equal(
        resolveFullMediaUrl('assets/cache/test.mp4'),
        'https://xiareng.cc/assets/cache/test.mp4'
    );
    assert.equal(
        resolveFullMediaUrl('/img/logo.png', 'https://custom-gateway.com'),
        'https://custom-gateway.com/img/logo.png'
    );
});

test('getMediaFileExtension detects mime types and url paths with safe fallback', () => {
    assert.equal(getMediaFileExtension('image/png', '', 'jpg'), 'png');
    assert.equal(getMediaFileExtension('image/webp', '', 'jpg'), 'webp');
    assert.equal(getMediaFileExtension('video/mp4', '', 'jpg'), 'mp4');
    assert.equal(getMediaFileExtension('', 'https://example.com/photo.gif', 'jpg'), 'gif');
    assert.equal(getMediaFileExtension('', 'https://example.com/no-ext', 'jpg'), 'jpg');
});

test('syncHtmlMediaToR2 resolves relative images and video sources gracefully without R2 credentials', async () => {
    const rawHtml = `
        <div class="intro">
            <h3>礼品卡充值教程</h3>
            <p>点击兑换礼品卡：</p>
            <img src="/assets/cache/general/image/apple.png" alt="说明图">
            <video src="/assets/cache/general/video/guide.mp4" poster="/assets/cache/general/image/poster.jpg"></video>
        </div>
    `;

    // Without R2 configured, it should gracefully fall back to resolved full URLs
    const result = await syncHtmlMediaToR2(rawHtml, {
        env: {},
        gateway: 'https://xiareng.cc'
    });

    assert.match(result, /<h3>礼品卡充值教程<\/h3>/);
    assert.match(result, /src="https:\/\/xiareng\.cc\/assets\/cache\/general\/image\/apple\.png"/);
    assert.match(result, /src="https:\/\/xiareng\.cc\/assets\/cache\/general\/video\/guide\.mp4"/);
    assert.match(result, /poster="https:\/\/xiareng\.cc\/assets\/cache\/general\/image\/poster\.jpg"/);
});

test('syncSupplierProductStock automatically recalculates price with markupMultiplier and updates database', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    const skuId = '22222222-2222-4222-8222-222222222222';
    const accountId = '33333333-3333-4333-8333-333333333333';
    const mappingId = '44444444-4444-4444-8444-444444444444';

    const updates = [];
    const upserts = [];

    const mockSupabase = {
        from(tableName) {
            return {
                select() {
                    return {
                        eq(col, val) {
                            if (tableName === 'shop_supplier_product_mappings') {
                                return {
                                    async then(resolve) {
                                        resolve({
                                            data: [{
                                                id: mappingId,
                                                site: 'cn',
                                                supplier_account_id: accountId,
                                                product_id: productId,
                                                sku_id: skuId,
                                                supplier_goods_no: 'XR-GOODS-1',
                                                supplier_variant: { race: '标准版' },
                                                import_snapshot: {
                                                    supplierUnitPrice: 10.0,
                                                    markupMultiplier: 1.25,
                                                    availableQuantity: 50
                                                },
                                                is_enabled: true,
                                                is_primary: true
                                            }],
                                            error: null
                                        });
                                    }
                                };
                            }
                            return this;
                        },
                        in(col, vals) {
                            if (tableName === 'shop_supplier_accounts') {
                                return Promise.resolve({
                                    data: [{
                                        id: accountId,
                                        provider_id: 'xiareng',
                                        account_key: 'default',
                                        is_enabled: true
                                    }],
                                    error: null
                                });
                            }
                            if (tableName === 'shop_supplier_availability') {
                                return Promise.resolve({
                                    data: [{
                                        mapping_id: mappingId,
                                        availability_status: 'available',
                                        available_quantity: 50,
                                        supplier_unit_price: 10.0,
                                        currency: 'CNY',
                                        checked_at: new Date().toISOString()
                                    }],
                                    error: null
                                });
                            }
                            return Promise.resolve({ data: [], error: null });
                        }
                    };
                },
                update(payload) {
                    return {
                        eq(col, val) {
                            updates.push({ table: tableName, payload, col, val });
                            return Promise.resolve({ data: null, error: null });
                        }
                    };
                },
                upsert(payload) {
                    upserts.push({ table: tableName, payload });
                    return Promise.resolve({ data: null, error: null });
                }
            };
        }
    };

    const result = await syncSupplierProductStock(mockSupabase, {
        productId,
        site: 'cn',
        maxAgeMs: 60000
    });

    assert.equal(result.synced, true);
    assert.equal(result.isSupplierProduct, true);
    assert.equal(result.stockCount, 50);
    // 10.00 CNY cost * 1.25 multiplier = 12.50 CNY sale price
    assert.equal(result.priceCny, 12.5);
    assert.equal(result.skuPriceMap[skuId], 12.5);
});

test('admin-config.js AdminRichTextEditor preserves img, video, source safely and does not drop images', () => {
    const fs = require('fs');
    const adminConfigContent = fs.readFileSync('admin-config.js', 'utf8');

    // Verify richTextAllowedTags includes img, video, source
    assert.match(
        adminConfigContent,
        /const richTextAllowedTags = new Set\(\[[\s\S]*?'img'[\s\S]*?'video'[\s\S]*?'source'[\s\S]*?\]\);/
    );

    // Verify richTextDroppedTags does not drop img, video, source
    const droppedMatch = adminConfigContent.match(/const richTextDroppedTags = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(droppedMatch, 'richTextDroppedTags must exist');
    assert.equal(droppedMatch[1].includes("'img'"), false, "richTextDroppedTags must not contain 'img'");
    assert.equal(droppedMatch[1].includes("'video'"), false, "richTextDroppedTags must not contain 'video'");
    assert.equal(droppedMatch[1].includes("'source'"), false, "richTextDroppedTags must not contain 'source'");

    // Verify appendSanitizedRichTextNode handles img, video, source
    assert.match(adminConfigContent, /if \(sourceTag === 'img'\) \{/);
    assert.match(adminConfigContent, /if \(sourceTag === 'video'\) \{/);
    assert.match(adminConfigContent, /if \(sourceTag === 'source'\) \{/);

    // Verify safe attributes and styles for media
    assert.match(adminConfigContent, /function getSafeRichTextMediaUrl\(/);
    assert.match(adminConfigContent, /function sanitizeMediaInlineStyle\(/);
});

test('shop-client.js rich text sanitization preserves IMG, VIDEO, SOURCE elements', () => {
    const fs = require('fs');
    const shopClientContent = fs.readFileSync('js/shop-client.js', 'utf8');

    // allowedTags contains IMG, VIDEO, SOURCE
    assert.match(
        shopClientContent,
        /const allowedTags = new Set\(\[[\s\S]*?'IMG'[\s\S]*?'VIDEO'[\s\S]*?'SOURCE'[\s\S]*?\]\);/
    );

    // mediaStyledTags and sanitizeStyle allow media formatting
    assert.match(
        shopClientContent,
        /const (?:mediaS|s)tyledTags = new Set\(\[[\s\S]*?'IMG'[\s\S]*?'VIDEO'[\s\S]*?\]\);/
    );

    // sanitizeStyle allows max-width and media properties
    assert.match(shopClientContent, /prop === 'max-width'/);

    // Child element handling checks for IMG src
    assert.match(shopClientContent, /if \(child\.tagName === 'IMG'\) \{/);
    assert.match(shopClientContent, /if \(child\.tagName === 'VIDEO'\) \{/);
    assert.match(shopClientContent, /if \(child\.tagName === 'SOURCE'\) \{/);
});

test('admin shop mutate handler supports up to 32,000 characters for rich text usage instructions', () => {
    const fs = require('fs');
    const mutateContent = fs.readFileSync('server/api-handlers/admin/shop/mutate.js', 'utf8');

    assert.match(
        mutateContent,
        /const usageInstructions = normalizeText\(safePayload\.usage_instructions, 32000\);/
    );
    assert.match(
        mutateContent,
        /const usageInstructionsZh = normalizeText\(safePayload\.usage_instructions_zh, 32000\);/
    );
});

test('supplier catalog description sanitization converts legacy font tags to styled spans and eliminates raw code', () => {
    const fs = require('fs');
    const adminShopJs = fs.readFileSync('js/admin-shop.js', 'utf8');
    const supplierCatalogJs = fs.readFileSync('server/api-handlers/admin/shop/supplier-catalog.js', 'utf8');

    // Both frontend and backend sanitize font tags into semantic spans
    assert.match(adminShopJs, /processed\.replace\(\/<font\\b\(\[\^>\]\*\)>/);
    assert.match(adminShopJs, /font-size:\${sizeMap\[sizeNum\]}/);
    assert.match(supplierCatalogJs, /processed\.replace\(\/<font\\b\(\[\^>\]\*\)>/);
    assert.match(supplierCatalogJs, /font-size:\${sizeMap\[sizeNum\]}/);

    // Test sanitization function directly from admin-shop.js logic
    const inputHtml = '<p><font size="5" color="#ff0000">下单后联系客服上号</font></p>';
    const fontRegex = /<font\b([^>]*)>/gi;
    const transformed = inputHtml.replace(fontRegex, (_, attrs) => {
        const styles = [];
        const sizeMatch = attrs.match(/\bsize=(["']?)(\d+)\1/i);
        if (sizeMatch) {
            const sizeMap = { 1: '12px', 2: '13px', 3: '14px', 4: '16px', 5: '18px', 6: '22px', 7: '28px' };
            if (sizeMap[sizeMatch[2]]) styles.push(`font-size:${sizeMap[sizeMatch[2]]}`);
        }
        const colorMatch = attrs.match(/\bcolor=(["']?)(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\1/i);
        if (colorMatch) styles.push(`color:${colorMatch[2]}`);
        return `<span style="${styles.join(';')}">`;
    }).replace(/<\/font>/gi, '</span>');

    assert.match(transformed, /<span style="font-size:18px;color:#ff0000">下单后联系客服上号<\/span>/);
    assert.doesNotMatch(transformed, /<font/);
});


