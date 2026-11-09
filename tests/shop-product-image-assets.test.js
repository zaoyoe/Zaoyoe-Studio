const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { buildProductImageVariants, createProductImageImporter } = require('../server/api-handlers/admin/shop/_product-image-assets');

const root = path.resolve(__dirname, '..');
const env = {
    R2_ENDPOINT: 'https://storage.example.test', R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'test', R2_PUBLIC_URL: 'https://cdn.fatherkey.com'
};
const animatedGif = (() => {
    const frame = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const first = Buffer.from(frame.subarray(19, -1));
    const second = Buffer.from(first);
    first[4] = 3; // 30 ms; the transparent frame and white frame must stay different.
    second[4] = 7; // 70 ms.
    second[second.length - 2] = 0x4c;
    const loop = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 3, 0, 0]);
    return Buffer.concat([frame.subarray(0, 19), loop, first, second, Buffer.from([0x3b])]);
})();
function imageBuffer() {
    return sharp({ create: { width: 960, height: 640, channels: 3, background: '#4b69cd' } }).png().toBuffer();
}
function namedFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing function ${name}`);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end + 2);
}
function storefrontRuntime() {
    class TestImage {
        constructor() { this.dataset = {}; }
        set src(value) { this.value = new URL(value, 'https://www.fatherkey.com').href; }
        get src() { return this.value || ''; }
        removeAttribute(name) { if (name === 'src') this.value = ''; }
    }
    const context = vm.createContext({ URL, HTMLImageElement: TestImage, window: { location: new URL('https://www.fatherkey.com/shop') } });
    const source = fs.readFileSync(path.join(root, 'js/shop-client.js'), 'utf8');
    const names = ['isSupabaseStorageImageUrl', 'getZaoyoeAssetCdnOrigin', 'normalizeZaoyoeAssetCdnUrl',
        'normalizeShopProductCdnUrl', 'getShopProductCdnUrlCandidates', 'getShopResponsiveImageVariantUrl',
        'getShopResponsiveR2CardVariantUrl', 'normalizeShopProductImageAsset', 'getShopProductImageAssetUrl',
        'getShopProductImageAssetExplicitVariantUrl', 'buildShopProductImageCacheVersion', 'appendShopImageUrlVersion'];
    vm.runInContext(names.map(name => namedFunction(source, name)).join('\n'), context);
    const methods = source.slice(source.indexOf('    setShopCardImageSource: function'), source.indexOf('    setDiscountMessage: function'));
    const optimized = source.slice(source.indexOf('    getOptimizedShopImageUrl: function'), source.indexOf('    getVersionedShopImageUrl: function'));
    vm.runInContext(`globalThis.shop = {${optimized}${methods}};`, context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/shop-image-variants.js'), 'utf8'), context);
    return { context, shop: context.shop, TestImage };
}

test('static image renditions are bounded WebP with deterministic bytes', async () => {
    const input = await imageBuffer();
    const first = await buildProductImageVariants(input);
    const second = await buildProductImageVariants(input);
    for (const [name, dimensions] of Object.entries({ original: [960, 640], card: [480, 320], thumb: [160, 160] })) {
        const metadata = await sharp(first[name]).metadata();
        assert.equal(metadata.format, 'webp');
        assert.deepEqual([metadata.width, metadata.height], dimensions);
        assert.deepEqual(first[name], second[name]);
    }
});

test('animated GIF and WebP renditions retain distinct frames, per-frame timing, loops and transparency', async () => {
    const source = await sharp(animatedGif).metadata();
    assert.equal(source.pages, 2);
    assert.deepEqual(source.delay, [30, 70]);
    const webp = (await buildProductImageVariants(animatedGif)).original;
    for (const input of [animatedGif, webp]) {
        const images = await buildProductImageVariants(input);
        for (const bytes of Object.values(images)) {
            const metadata = await sharp(bytes).metadata();
            assert.equal(metadata.format, 'webp');
            assert.equal(metadata.pages, source.pages);
            assert.deepEqual(metadata.delay, source.delay);
            assert.equal(metadata.loop, source.loop);
            assert.equal(metadata.hasAlpha, true);
            const first = await sharp(bytes, { page: 0 }).raw().toBuffer();
            const second = await sharp(bytes, { page: 1 }).raw().toBuffer();
            assert.notDeepEqual(first, second, 'animation must not become a repeated static frame');
        }
    }
});

test('animated supplier imports upload three real WebP renditions with matching content types', async () => {
    const uploads = [];
    const importer = createProductImageImporter({
        downloadImage: async () => ({ buffer: animatedGif, mimeType: 'image/gif', extension: 'gif' }),
        upload: async (bytes, options) => {
            uploads.push({ bytes, options });
            return { publicUrl: `https://cdn.fatherkey.com/${options.keyPrefix}/animated.${options.extension}` };
        }
    });
    const result = await importer('https://supplier.example.com/image.gif', { env });
    assert.deepEqual(Object.keys(result), ['original', 'card', 'thumb']);
    assert.equal(uploads.length, 3);
    for (const { bytes, options } of uploads) {
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.pages, 2);
        assert.deepEqual(metadata.delay, [30, 70]);
        assert.equal(options.mimeType, 'image/webp');
        assert.equal(options.extension, 'webp');
        assert.equal(options.contentAddressed, true);
    }
});

test('animation decode budgets preserve the source instead of flattening or allocating unbounded frames', async () => {
    const frame = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    for (const [frames, dimension] of [[251, 1], [180, 1080]]) {
        const header = Buffer.from(frame.subarray(0, 19));
        header.writeUInt16LE(dimension, 6);
        header.writeUInt16LE(dimension, 8);
        const input = Buffer.concat([header, ...Array(frames).fill(frame.subarray(19, -1)), Buffer.from([0x3b])]);
        assert.equal((await sharp(input).metadata()).pages, frames);
        assert.equal(await buildProductImageVariants(input), null);
        const uploads = [];
        const importer = createProductImageImporter({
            downloadImage: async () => ({ buffer: input, mimeType: 'image/gif', extension: 'gif' }),
            upload: async (bytes, options) => { uploads.push({ bytes, options }); return { publicUrl: 'https://cdn.fatherkey.com/large.gif' }; }
        });
        assert.deepEqual(await importer('https://supplier.example.com/large.gif', { env }), { original: 'https://cdn.fatherkey.com/large.gif' });
        assert.equal(uploads.length, 1);
        assert.deepEqual(uploads[0].bytes, input);
        assert.equal(uploads[0].options.mimeType, 'image/gif');
        assert.equal(uploads[0].options.extension, 'gif');
    }
});

test('supplier imports coalesce concurrent requests and address identical bytes by content', async () => {
    const input = await imageBuffer();
    let downloads = 0;
    const uploads = [];
    const importer = createProductImageImporter({
        downloadImage: async () => { downloads++; return { buffer: input, mimeType: 'image/png', extension: 'png' }; },
        upload: async (bytes, options) => {
            uploads.push(options);
            return { publicUrl: `${env.R2_PUBLIC_URL}/${options.keyPrefix}/${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${options.extension}` };
        }
    });
    const source = 'https://supplier.example.com/shared.png';
    const [first, second] = await Promise.all([importer(source, { env }), importer(source, { env })]);
    assert.equal(downloads, 1);
    assert.equal(uploads.length, 3);
    assert.strictEqual(first, second);
    assert.ok(uploads.every(options => options.contentAddressed === true));
    assert.deepEqual(await importer('https://supplier.example.com/alias.png', { env }), first);
    assert.equal(downloads, 2);
    assert.equal((await importer(source, { env })).thumb, first.thumb);
    assert.equal(downloads, 2);
});

test('failed imports reject unsafe fallback and allow a subsequent retry', async () => {
    const input = await imageBuffer();
    let downloads = 0;
    const importer = createProductImageImporter({
        downloadImage: async () => { if (++downloads === 1) throw new Error('download failed'); return { buffer: input, mimeType: 'image/png', extension: 'png' }; },
        upload: async (_bytes, options) => ({ publicUrl: `${env.R2_PUBLIC_URL}/${options.keyPrefix}/test.webp` })
    });
    const source = 'https://supplier.example.com/retry.png';
    assert.equal(await importer(source, { env }), null);
    assert.ok((await importer(source, { env })).thumb);
    assert.equal(downloads, 2);
    assert.deepEqual(await importer(source, { env: {} }), { original: source });
    assert.equal(downloads, 2);
});

test('oversized streamed sources fail closed before processing or upload', async () => {
    let uploads = 0;
    const importer = createProductImageImporter({
        downloadImage: async () => ({ buffer: Buffer.alloc(12 * 1024 * 1024 + 1), mimeType: 'image/png', extension: 'png' }),
        upload: async () => { uploads++; }
    });
    const source = 'https://supplier.example.com/large.png';
    assert.equal(await importer(source, { env }), null);
    assert.equal(uploads, 0);
});

test('stock timestamps do not split shared image URLs on shop, homepage or admin', () => {
    for (const file of ['js/shop-client.js', 'js/admin-shop.js', 'js/framer_home.js']) {
        const context = vm.createContext({ URL, window: { location: new URL('https://www.fatherkey.com/shop') } });
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        vm.runInContext(namedFunction(source, 'buildShopProductImageCacheVersion') + '\n' + namedFunction(source, 'appendShopImageUrlVersion'), context);
        const url = 'https://cdn.fatherkey.com/shop/products/cover/shared.webp';
        const product = { updated_at: 'stock-time-a', created_at: 'created', image_cache_version: 'stock-time-a' };
        const another = { updated_at: 'stock-time-b', created_at: 'created', image_cache_version: 'stock-time-b' };
        assert.equal(context.appendShopImageUrlVersion(url, context.buildShopProductImageCacheVersion(product)), url, file);
        assert.equal(context.appendShopImageUrlVersion(url, context.buildShopProductImageCacheVersion(another)), url, file);
        assert.equal(context.buildShopProductImageCacheVersion({ ...product, image_updated_at: 'image-revision' }), 'image-revision');
        assert.equal(context.appendShopImageUrlVersion(url, 'image-revision'), `${url}?v=image-revision`);
        for (const immutable of ['/assets/products-thumb/0123456789abcdef0123.webp', 'https://cdn.fatherkey.com/products/original/0123456789abcdef0123.webp',
            'https://cdn.fatherkey.com/shop/products/cover/v1/thumb/0123456789abcdef0123.webp']) {
            assert.equal(context.appendShopImageUrlVersion(immutable, 'different-product-time'), immutable, file);
        }
    }
});

test('list thumbnail errors fall back through card to original and then stop', () => {
    const { shop, TestImage } = storefrontRuntime();
    const image = new TestImage();
    const asset = { original: 'https://cdn.fatherkey.com/products/source.webp', card: '/card.webp', thumb: '/thumb.webp' };
    shop.setShopCardImageSource(image, asset, { variant: 'thumb' });
    assert.equal(image.src, 'https://www.fatherkey.com/thumb.webp');
    assert.equal(image.decoding, 'async');
    shop.handleShopCardImageError(image, asset);
    assert.equal(image.src, 'https://www.fatherkey.com/card.webp');
    shop.handleShopCardImageError(image, asset);
    assert.equal(image.src, asset.original);
    shop.handleShopCardImageError(image, asset);
    assert.equal(image.src, asset.original);
    assert.equal(image.dataset.fallbackStage, 'original');
});

test('missing thumbnails select the card even when original uses a CDN alias', () => {
    const { shop, TestImage } = storefrontRuntime();
    const image = new TestImage();
    shop.setShopCardImageSource(image, { original: 'https://cdn.zaoyoe.com/products/source.webp', card: '/card.webp' }, { variant: 'thumb' });
    assert.equal(image.src, 'https://www.fatherkey.com/card.webp');
});

test('catalog CDN aliases resolve to the same bundled thumbnail', () => {
    const { shop, TestImage } = storefrontRuntime();
    const sources = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].map(hostname => {
        const image = new TestImage();
        shop.setShopCardImageSource(image, {
            original: `https://${hostname}/products/3ccb86f1-ca3a-440f-90d6-5943b0ad17f8.webp`,
            card: `https://${hostname}/products/card/3ccb86f1-ca3a-440f-90d6-5943b0ad17f8.webp`
        }, { variant: 'thumb' });
        return image.src;
    });
    assert.equal(new Set(sources).size, 1);
    assert.ok(sources[0].includes('/assets/products-thumb/'));
});

test('bundled variants exist, have correct dimensions and share a URL across repeated products', async () => {
    const { shop, context, TestImage } = storefrontRuntime();
    const manifest = context.window.__SHOP_IMAGE_VARIANTS__;
    for (const [variant, entries] of Object.entries(manifest.variants)) {
        for (const url of new Set(Object.values(entries))) {
            assert.ok(url.startsWith(`/assets/products-${variant}/`));
            const metadata = await sharp(path.join(root, url)).metadata();
            assert.equal(metadata.format, 'webp');
            assert.ok(metadata.width <= (variant === 'thumb' ? 160 : 480));
            assert.ok((metadata.pageHeight || metadata.height) <= (variant === 'thumb' ? 160 : 320));
        }
    }
    const original = 'https://cdn.fatherkey.com/shop/products/cover/2026/11/5bc135966ce671b68e34.webp';
    const sources = Array.from({ length: 14 }, (_, index) => {
        const image = new TestImage();
        shop.setShopCardImageSource(image, { original }, { variant: 'thumb', version: `product-${index}` });
        return image.src;
    });
    assert.equal(new Set(sources).size, 1);
    assert.ok(sources[0].includes('/assets/products-thumb/'));
    const gif = 'https://cdn.fatherkey.com/shop/products/cover/2026/11/7edcf2441059890fc496.gif';
    for (const [variant, dimensions, maxBytes] of [['thumb', [160, 160], 250000], ['card', [480, 320], 650000]]) {
        const url = shop.getOptimizedShopImageUrl({ original: gif }, { variant });
        const asset = path.join(root, new URL(url, 'https://www.fatherkey.com').pathname);
        const metadata = await sharp(asset).metadata();
        assert.notEqual(url, gif);
        assert.equal(metadata.format, 'webp');
        assert.deepEqual([metadata.width, metadata.pageHeight || metadata.height], dimensions);
        assert.ok(metadata.pages > 100, 'retain the full animation, allowing coalesced identical frames');
        assert.equal(metadata.delay.reduce((sum, delay) => sum + delay, 0), 3300);
        assert.equal(metadata.loop, 0);
        assert.equal(metadata.hasAlpha, true);
        assert.ok(fs.statSync(asset).size < maxBytes, 'animated rendition should stay smaller than its 1.52 MB source');
    }
});
