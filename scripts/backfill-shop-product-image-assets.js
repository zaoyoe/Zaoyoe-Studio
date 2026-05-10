#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const PRODUCT_CARD_WIDTH = 480;
const PRODUCT_CARD_HEIGHT = 320;
const PRODUCT_CARD_QUALITY = 78;

function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    return dotenv.parse(fs.readFileSync(filePath, 'utf8'));
}

function readFirstEnv(sources, names, fallback = '') {
    for (const source of sources) {
        for (const name of names) {
            const value = String(source?.[name] || '').trim();
            if (value) return value;
        }
    }
    return fallback;
}

function requireEnv(sources, label, names = []) {
    const value = readFirstEnv(sources, names);
    if (!value) {
        throw new Error(`Missing ${label}: ${names.join(' / ')}`);
    }
    return value;
}

function parseArgs(argv = []) {
    const args = {
        apply: false,
        force: false,
        limit: Infinity,
        productId: '',
        cleanupTempUsers: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--apply') {
            args.apply = true;
            continue;
        }
        if (value === '--dry-run') {
            args.apply = false;
            continue;
        }
        if (value === '--force') {
            args.force = true;
            continue;
        }
        if (value === '--cleanup-temp-users') {
            args.cleanupTempUsers = true;
            continue;
        }
        if (value === '--limit') {
            const limit = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(limit) && limit > 0) {
                args.limit = limit;
            }
            index += 1;
            continue;
        }
        if (value === '--product-id') {
            args.productId = String(argv[index + 1] || '').trim();
            index += 1;
        }
    }

    return args;
}

function normalizeShopImageAsset(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeShopImageAsset).find(Boolean) || null;
    }

    if (typeof value === 'string') {
        const original = value.trim();
        return original ? { original } : null;
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
        ? value.variants
        : {};
    const asset = {};

    for (const key of ['original', 'thumb', 'card', 'home', 'detail']) {
        const url = String(value[key] || variants[key] || '').trim();
        if (url) {
            asset[key] = url;
        }
    }

    const fallbackOriginal = String(value.url || value.src || value.image || value.icon_url || '').trim();
    if (!asset.original && fallbackOriginal) {
        asset.original = fallbackOriginal;
    }

    return asset.original || asset.thumb || asset.card || asset.home || asset.detail ? asset : null;
}

function isImageSource(value = '') {
    const source = String(value || '').trim();
    return source.startsWith('http://')
        || source.startsWith('https://')
        || source.startsWith('/assets/')
        || source.startsWith('assets/')
        || source.startsWith('./assets/');
}

function resolveOriginalUrl(product = {}) {
    const asset = normalizeShopImageAsset(product.image_assets);
    return String(asset?.original || product.icon_url || '').trim();
}

function needsBackfill(product = {}, args = {}) {
    const original = resolveOriginalUrl(product);
    if (!isImageSource(original)) return false;

    const asset = normalizeShopImageAsset(product.image_assets);
    return args.force || !asset?.original || !asset?.card;
}

function resolveLocalAssetPath(value = '') {
    const normalized = String(value || '').trim().replace(/^\.?\//, '');
    return path.join(ROOT_DIR, normalized);
}

async function readImageBuffer(sourceUrl) {
    const source = String(sourceUrl || '').trim();
    if (source.startsWith('/assets/') || source.startsWith('assets/') || source.startsWith('./assets/')) {
        return fs.promises.readFile(resolveLocalAssetPath(source));
    }

    const response = await fetch(source, {
        headers: {
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'User-Agent': 'ZaoyoeShopProductImageBackfill/1.0'
        }
    });
    if (!response.ok) {
        throw new Error(`download failed: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

async function buildProductOriginalBuffer(sourceBuffer) {
    return sharp(sourceBuffer, { failOn: 'none' })
        .rotate()
        .resize(1600, 1600, {
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({
            quality: 84,
            effort: 5
        })
        .toBuffer();
}

async function buildProductCardBuffer(sourceBuffer) {
    return sharp(sourceBuffer, { failOn: 'none' })
        .rotate()
        .resize(PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT, {
            fit: 'cover',
            position: 'center',
            withoutEnlargement: false
        })
        .webp({
            quality: PRODUCT_CARD_QUALITY,
            effort: 5
        })
        .toBuffer();
}

function toWebpDataUrl(buffer) {
    return `data:image/webp;base64,${buffer.toString('base64')}`;
}

async function createEdgeUploadSession(adminClient, supabaseUrl, publishableKey) {
    const tokenSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const tempEmail = `codex-shop-image-backfill-${tokenSuffix}@zaoyoe.local`;
    const tempPassword = `Codex!${tokenSuffix}aA1`;

    const createResult = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
            role: 'codex_shop_image_backfill'
        }
    });
    if (createResult.error || !createResult.data?.user?.id) {
        throw new Error(`failed to create temporary upload user: ${createResult.error?.message || 'unknown error'}`);
    }

    const tempUserId = createResult.data.user.id;
    const publicClient = createClient(supabaseUrl, publishableKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
    const signInResult = await publicClient.auth.signInWithPassword({
        email: tempEmail,
        password: tempPassword
    });
    if (signInResult.error || !signInResult.data?.session?.access_token) {
        await adminClient.auth.admin.deleteUser(tempUserId);
        throw new Error(`failed to sign in temporary upload user: ${signInResult.error?.message || 'unknown error'}`);
    }

    return {
        userId: tempUserId,
        accessToken: signInResult.data.session.access_token,
        async cleanup() {
            await adminClient.auth.admin.deleteUser(tempUserId);
        }
    };
}

async function uploadProductImageViaEdge({ supabaseUrl, publishableKey, accessToken, userId }, productId, originalBuffer, cardBuffer) {
    const response = await fetch(`${String(supabaseUrl || '').replace(/\/+$/, '')}/functions/v1/upload-avatar`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: publishableKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            userId,
            type: 'product',
            productId,
            imageData: toWebpDataUrl(originalBuffer),
            cardImageData: toWebpDataUrl(cardBuffer)
        })
    });

    const text = await response.text();
    let payload = {};
    try {
        payload = text ? JSON.parse(text) : {};
    } catch (error) {
        payload = { raw: text };
    }

    if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || `upload-avatar failed: HTTP ${response.status}`);
    }

    const asset = normalizeShopImageAsset(payload.imageAsset) || normalizeShopImageAsset({
        original: payload.imageUrl,
        card: payload.cardImageUrl
    });
    if (!asset?.original) {
        throw new Error('upload-avatar did not return a product image asset');
    }

    return asset;
}

async function fetchProducts(supabase, args) {
    let query = supabase
        .from('shop_products')
        .select('id, name, icon_url, image_assets, is_active')
        .order('display_order', { ascending: false });

    if (args.productId) {
        query = query.eq('id', args.productId);
    }

    const { data, error } = await query;
    if (error) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('image_assets')) {
            throw new Error('image_assets column is not visible to Supabase yet. Run the shop product image asset migration first.');
        }
        throw error;
    }

    return (Array.isArray(data) ? data : []).slice(0, args.limit);
}

async function cleanupTemporaryUploadUsers(supabase) {
    let page = 1;
    const perPage = 100;
    let deleted = 0;

    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) {
            throw new Error(`failed to list auth users: ${error.message}`);
        }

        const users = data?.users || [];
        for (const user of users) {
            const email = String(user?.email || '').trim();
            const role = String(user?.user_metadata?.role || '').trim();
            if (!email.startsWith('codex-shop-image-backfill-') && role !== 'codex_shop_image_backfill') {
                continue;
            }

            const deleteResult = await supabase.auth.admin.deleteUser(user.id);
            if (deleteResult.error) {
                throw new Error(`failed to delete temporary user ${email}: ${deleteResult.error.message}`);
            }
            deleted += 1;
        }

        if (users.length < perPage) {
            break;
        }
        page += 1;
    }

    console.log(`Temporary shop upload users deleted: ${deleted}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const envSources = [
        process.env,
        readEnvFile(LOCAL_ENV_PATH),
        readEnvFile(SERVER_ENV_PATH)
    ];
    const supabaseUrl = requireEnv(envSources, 'Supabase URL', [
        'SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_URL',
        'PUBLIC_SUPABASE_URL'
    ]);
    const serviceRoleKey = requireEnv(envSources, 'Supabase service role key', [
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_SERVICE_KEY'
    ]);
    const publishableKey = readFirstEnv(envSources, [
        'SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_ANON_KEY',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY'
    ], serviceRoleKey);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    if (args.cleanupTempUsers) {
        await cleanupTemporaryUploadUsers(supabase);
        return;
    }

    const products = await fetchProducts(supabase, args);
    const candidates = products.filter((product) => needsBackfill(product, args));

    console.log(`${args.apply ? 'Apply' : 'Dry run'} shop product image asset backfill`);
    console.log(`- products scanned: ${products.length}`);
    console.log(`- products needing work: ${candidates.length}`);
    console.log(`- force: ${args.force ? 'yes' : 'no'}`);

    if (!candidates.length) {
        return;
    }

    if (!args.apply) {
        console.log('\nDry run only. Re-run with --apply after the migration is applied and upload-avatar is deployed.');
        return;
    }

    let edgeSession = null;
    const totals = {
        updated: 0,
        failed: 0
    };

    try {
        edgeSession = await createEdgeUploadSession(supabase, supabaseUrl, publishableKey);
        const edgeContext = {
            supabaseUrl,
            publishableKey,
            accessToken: edgeSession.accessToken
        };

        for (let index = 0; index < candidates.length; index += 1) {
            const product = candidates[index];
            const sourceUrl = resolveOriginalUrl(product);
            console.log(`[${index + 1}/${candidates.length}] ${product.name || product.id}`);

            try {
                const sourceBuffer = await readImageBuffer(sourceUrl);
                const [originalBuffer, cardBuffer] = await Promise.all([
                    buildProductOriginalBuffer(sourceBuffer),
                    buildProductCardBuffer(sourceBuffer)
                ]);
                const imageAsset = await uploadProductImageViaEdge(edgeContext, product.id, originalBuffer, cardBuffer);
                const { error } = await supabase
                    .from('shop_products')
                    .update({
                        icon_url: imageAsset.original,
                        image_assets: imageAsset
                    })
                    .eq('id', product.id);
                if (error) {
                    throw error;
                }
                totals.updated += 1;
                console.log(`  updated original=${imageAsset.original}, card=${imageAsset.card || '-'}`);
            } catch (error) {
                totals.failed += 1;
                console.error(`  failed: ${error.message}`);
            }
        }
    } finally {
        if (edgeSession) {
            await edgeSession.cleanup();
        }
    }

    console.log('\nSummary');
    console.log(`- products updated: ${totals.updated}`);
    console.log(`- failures: ${totals.failed}`);
}

main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`);
    process.exit(1);
});
