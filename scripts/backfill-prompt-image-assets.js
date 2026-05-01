#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const R2_PROMPT_PREFIX = 'prompts';
const VARIANT_CONFIGS = Object.freeze({
    original: { width: 2048, quality: 90, keyPrefix: 'prompts' },
    thumb: { width: 800, quality: 85, keyPrefix: 'prompts/thumb' },
    featured: { width: 1280, quality: 80, keyPrefix: 'prompts/featured' },
    card: { width: 560, quality: 76, keyPrefix: 'prompts/card' },
    home: { width: 420, quality: 74, keyPrefix: 'prompts/home' }
});

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
        promptId: '',
        startAfter: '',
        uploadMode: 'auto',
        cleanupTempUsers: false,
        variants: ['thumb', 'card', 'home', 'featured']
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

        if (value === '--prompt-id') {
            args.promptId = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--start-after') {
            args.startAfter = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--variants') {
            const variants = String(argv[index + 1] || '')
                .split(',')
                .map((item) => item.trim())
                .filter((item) => ['thumb', 'card', 'home', 'featured'].includes(item));
            if (variants.length) {
                args.variants = [...new Set(variants)];
            }
            index += 1;
            continue;
        }

        if (value === '--upload-mode') {
            const mode = String(argv[index + 1] || '').trim();
            if (['auto', 'r2', 'edge'].includes(mode)) {
                args.uploadMode = mode;
            }
            index += 1;
        }
    }

    return args;
}

function normalizePublicUrlBase(value = '') {
    return String(value || 'https://cdn.zaoyoe.com').trim().replace(/\/+$/, '');
}

function sanitizeFilename(value = '', fallback = 'prompt-image.webp') {
    const safe = String(value || '')
        .split(/[\\/]/)
        .pop()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^_+/, '')
        .trim();
    const basename = (safe || fallback).replace(/\.[^.]+$/, '');
    return `${basename || 'prompt-image'}.webp`;
}

function getFilenameFromUrl(url = '', fallback = 'prompt-image.webp') {
    try {
        const parsed = new URL(String(url || '').trim());
        return sanitizeFilename(decodeURIComponent(path.basename(parsed.pathname)), fallback);
    } catch (error) {
        return sanitizeFilename(String(url || '').split('?')[0].split('#')[0], fallback);
    }
}

function isPromptCdnOriginalUrl(url = '', publicUrlBase = 'https://cdn.zaoyoe.com') {
    try {
        const parsed = new URL(String(url || '').trim());
        const publicParsed = new URL(publicUrlBase);
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parsed.hostname === publicParsed.hostname
            && parts.length === 2
            && parts[0] === R2_PROMPT_PREFIX;
    } catch (error) {
        return false;
    }
}

function isLocalImagePath(value = '') {
    const trimmed = String(value || '').trim();
    return trimmed.startsWith('/assets/') || trimmed.startsWith('assets/') || trimmed.startsWith('./assets/');
}

function resolveLocalImagePath(value = '') {
    const normalized = String(value || '').trim().replace(/^\.?\//, '');
    return path.join(ROOT_DIR, normalized);
}

function normalizePromptImageAsset(value) {
    if (typeof value === 'string') {
        const original = value.trim();
        return original ? { original } : null;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
        ? value.variants
        : {};
    const asset = {};

    for (const key of ['original', 'thumb', 'featured', 'card', 'home']) {
        const url = String(value[key] || variants[key] || '').trim();
        if (url) {
            asset[key] = url;
        }
    }

    const fallbackOriginal = String(value.url || value.src || value.image || '').trim();
    if (!asset.original && fallbackOriginal) {
        asset.original = fallbackOriginal;
    }

    return asset.original || asset.thumb || asset.featured || asset.card || asset.home ? asset : null;
}

function normalizePromptImageAssets(row = {}) {
    const explicitAssets = Array.isArray(row.image_assets) ? row.image_assets : [];
    const legacyImages = Array.isArray(row.images) ? row.images : [];
    const seen = new Set();
    const assets = [];

    for (const source of [...explicitAssets, ...legacyImages]) {
        const asset = normalizePromptImageAsset(source);
        if (!asset) continue;

        const key = String(asset.original || asset.card || asset.home || asset.thumb || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        assets.push(asset);
    }

    return assets;
}

function buildPublicUrl(publicUrlBase, key) {
    return `${normalizePublicUrlBase(publicUrlBase)}/${String(key || '').replace(/^\/+/, '')}`;
}

function buildR2Key(variant, filename) {
    return `${VARIANT_CONFIGS[variant].keyPrefix}/${filename}`;
}

async function readImageBuffer(sourceUrl) {
    const source = String(sourceUrl || '').trim();
    if (isLocalImagePath(source)) {
        return fs.promises.readFile(resolveLocalImagePath(source));
    }

    const response = await fetch(source, {
        headers: {
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'User-Agent': 'ZaoyoePromptImageBackfill/1.0'
        }
    });

    if (!response.ok) {
        throw new Error(`download failed: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

async function buildVariantBuffer(sourceBuffer, variant) {
    const config = VARIANT_CONFIGS[variant];
    return sharp(sourceBuffer, { failOn: 'none' })
        .rotate()
        .resize(config.width, null, {
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({
            quality: config.quality,
            effort: 5
        })
        .toBuffer();
}

async function uploadVariant(s3Client, bucket, publicUrlBase, variant, filename, buffer) {
    const key = buildR2Key(variant, filename);
    await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable'
    }));
    return buildPublicUrl(publicUrlBase, key);
}

async function createEdgeUploadSession(adminClient, supabaseUrl, publishableKey) {
    const tokenSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const tempEmail = `codex-prompt-image-backfill-${tokenSuffix}@zaoyoe.local`;
    const tempPassword = `Codex!${tokenSuffix}aA1`;

    const createResult = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
            role: 'codex_prompt_image_backfill'
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
        accessToken: signInResult.data.session.access_token,
        async cleanup() {
            await adminClient.auth.admin.deleteUser(tempUserId);
        }
    };
}

async function uploadAssetBundleViaEdge({ supabaseUrl, publishableKey, accessToken }, filename, buffersByVariant) {
    const variants = ['original', 'thumb', 'featured', 'card', 'home']
        .filter((variant) => buffersByVariant[variant]);
    const response = await fetch(`${String(supabaseUrl || '').replace(/\/+$/, '')}/functions/v1/upload-to-r2`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: publishableKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            images: variants.map((variant) => ({
                base64: buffersByVariant[variant].toString('base64'),
                filename,
                variant,
                isThumb: variant === 'thumb'
            }))
        })
    });

    const text = await response.text();
    let payload = {};
    try {
        payload = text ? JSON.parse(text) : {};
    } catch (error) {
        payload = { raw: text };
    }

    if (!response.ok) {
        throw new Error(payload?.error || payload?.message || `upload-to-r2 failed: HTTP ${response.status}`);
    }

    const asset = Array.isArray(payload.assets) ? payload.assets[0] : null;
    if (!asset?.original) {
        throw new Error('upload-to-r2 did not return an image asset object');
    }

    return asset;
}

async function verifyEdgeVariantSupport(edgeContext) {
    const probeFilename = `codex_variant_probe_${Date.now()}.webp`;
    const probeBuffer = await sharp({
        create: {
            width: 2,
            height: 2,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
    }).webp({ quality: 70 }).toBuffer();
    const asset = await uploadAssetBundleViaEdge(edgeContext, probeFilename, {
        original: probeBuffer,
        card: probeBuffer
    });

    if (!String(asset.card || '').includes('/prompts/card/')) {
        throw new Error('deployed upload-to-r2 function does not expose card/home/thumb variant asset URLs yet');
    }
}

function getAssetWorkPlan(asset, args, publicUrlBase) {
    const original = String(asset.original || '').trim();
    const filename = getFilenameFromUrl(original, 'prompt-image.webp');
    const shouldUploadOriginal = args.force || !isPromptCdnOriginalUrl(original, publicUrlBase);
    const missingVariants = args.variants.filter((variant) => args.force || !String(asset[variant] || '').trim());

    return {
        filename,
        shouldUploadOriginal,
        variants: missingVariants,
        needsWork: Boolean(original && (shouldUploadOriginal || missingVariants.length > 0))
    };
}

function isMissingImageAssetsColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return Boolean(message && message.includes('image_assets'));
}

async function fetchPrompts(supabase, args) {
    let query = supabase
        .from('prompts')
        .select('id,title,images,image_assets')
        .order('id', { ascending: true });

    if (args.promptId) {
        query = query.eq('id', args.promptId);
    } else if (args.startAfter) {
        query = query.gt('id', args.startAfter);
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingImageAssetsColumnError(error)) {
            throw new Error('image_assets column is not visible to Supabase yet. Run the migration and reload PostgREST schema first.');
        }
        throw error;
    }

    return (data || []).slice(0, args.limit);
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
            if (!email.startsWith('codex-prompt-image-backfill-') && role !== 'codex_prompt_image_backfill') {
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

    console.log(`Temporary upload users deleted: ${deleted}`);
}

async function processPrompt({ row, args, supabase, uploadContext, r2Bucket, r2PublicUrl }) {
    const assets = normalizePromptImageAssets(row);
    const nextAssets = [];
    const promptStats = {
        imagesSeen: assets.length,
        imagesChanged: 0,
        variantsUploaded: 0,
        originalUploaded: 0,
        failed: 0
    };

    for (let index = 0; index < assets.length; index += 1) {
        const asset = { ...assets[index] };
        const original = String(asset.original || asset.card || asset.home || asset.thumb || '').trim();
        if (!asset.original && original) {
            asset.original = original;
        }

        const fallbackFilename = `prompt_${row.id}_${index + 1}.webp`;
        const plan = getAssetWorkPlan(asset, args, r2PublicUrl);
        if (!plan.filename || plan.filename === 'prompt-image.webp') {
            plan.filename = fallbackFilename;
        }

        if (!plan.needsWork) {
            nextAssets.push(asset);
            continue;
        }

        if (!args.apply) {
            nextAssets.push(asset);
            promptStats.imagesChanged += 1;
            promptStats.variantsUploaded += plan.variants.length;
            promptStats.originalUploaded += plan.shouldUploadOriginal ? 1 : 0;
            continue;
        }

        try {
            const sourceBuffer = await readImageBuffer(asset.original);

            if (uploadContext.mode === 'edge') {
                const variantsForEdge = [...new Set(['original', ...plan.variants])];
                const buffersByVariant = {};
                for (const variant of variantsForEdge) {
                    buffersByVariant[variant] = await buildVariantBuffer(sourceBuffer, variant);
                }

                const uploadedAsset = await uploadAssetBundleViaEdge(uploadContext.edge, plan.filename, buffersByVariant);
                Object.assign(asset, uploadedAsset);
                promptStats.originalUploaded += 1;
                promptStats.variantsUploaded += plan.variants.length;
                promptStats.imagesChanged += 1;
                nextAssets.push(asset);
                continue;
            }

            if (plan.shouldUploadOriginal) {
                const originalBuffer = await buildVariantBuffer(sourceBuffer, 'original');
                asset.original = await uploadVariant(uploadContext.s3Client, r2Bucket, r2PublicUrl, 'original', plan.filename, originalBuffer);
                promptStats.originalUploaded += 1;
            }

            const variantBuffers = await Promise.all(
                plan.variants.map(async (variant) => [variant, await buildVariantBuffer(sourceBuffer, variant)])
            );

            for (const [variant, buffer] of variantBuffers) {
                asset[variant] = await uploadVariant(uploadContext.s3Client, r2Bucket, r2PublicUrl, variant, plan.filename, buffer);
                promptStats.variantsUploaded += 1;
            }

            promptStats.imagesChanged += 1;
            nextAssets.push(asset);
        } catch (error) {
            promptStats.failed += 1;
            nextAssets.push(asset);
            console.error(`  failed image ${index + 1}: ${error.message}`);
        }
    }

    const nextImages = nextAssets
        .map((asset) => String(asset.original || '').trim())
        .filter(Boolean);

    const changed = promptStats.imagesChanged > 0 && promptStats.failed < promptStats.imagesSeen;
    if (args.apply && changed) {
        const { error } = await supabase
            .from('prompts')
            .update({
                images: nextImages,
                image_assets: nextAssets
            })
            .eq('id', row.id);
        if (error) {
            throw new Error(`database update failed: ${error.message}`);
        }
    }

    return promptStats;
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
    ]);
    const edgeApiKey = publishableKey || serviceRoleKey;
    const r2Endpoint = readFirstEnv(envSources, ['R2_ENDPOINT']);
    const r2AccessKey = readFirstEnv(envSources, ['R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY']);
    const r2SecretKey = readFirstEnv(envSources, ['R2_SECRET_ACCESS_KEY', 'R2_SECRET_KEY']);
    const r2Bucket = readFirstEnv(envSources, ['R2_BUCKET_NAME'], 'zaoyoeimages');
    const r2PublicUrl = normalizePublicUrlBase(readFirstEnv(envSources, ['R2_PUBLIC_URL'], 'https://cdn.zaoyoe.com'));

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

    let uploadContext = { mode: 'dry-run', s3Client: null, edge: null };
    let edgeSession = null;
    if (args.apply) {
        const canUseDirectR2 = Boolean(r2Endpoint && r2AccessKey && r2SecretKey);
        if (args.uploadMode === 'r2' || (args.uploadMode === 'auto' && canUseDirectR2)) {
            if (!canUseDirectR2) {
                throw new Error('R2 upload mode requested but R2_ENDPOINT / R2_ACCESS_KEY / R2_SECRET_KEY is missing');
            }
            uploadContext = {
                mode: 'r2',
                s3Client: new S3Client({
                    region: 'auto',
                    endpoint: r2Endpoint,
                    credentials: {
                        accessKeyId: r2AccessKey,
                        secretAccessKey: r2SecretKey
                    }
                }),
                edge: null
            };
        } else {
            edgeSession = await createEdgeUploadSession(supabase, supabaseUrl, edgeApiKey);
            uploadContext = {
                mode: 'edge',
                s3Client: null,
                edge: {
                    supabaseUrl,
                    publishableKey: edgeApiKey,
                    accessToken: edgeSession.accessToken
                }
            };
            console.log('Using Supabase Edge Function upload mode; verifying variant path support...');
            try {
                await verifyEdgeVariantSupport(uploadContext.edge);
            } catch (error) {
                await edgeSession.cleanup();
                edgeSession = null;
                throw error;
            }
        }
    }

    const prompts = await fetchPrompts(supabase, args);
    const candidates = [];

    for (const row of prompts) {
        const assets = normalizePromptImageAssets(row);
        const planned = assets
            .map((asset) => getAssetWorkPlan(asset, args, r2PublicUrl))
            .filter((plan) => plan.needsWork);

        if (planned.length) {
            candidates.push({ row, planned });
        }
    }

    console.log(`${args.apply ? 'Apply' : 'Dry run'} prompt image asset backfill`);
    console.log(`- prompts scanned: ${prompts.length}`);
    console.log(`- prompts needing work: ${candidates.length}`);
    console.log(`- variants: ${args.variants.join(', ')}`);
    console.log(`- force: ${args.force ? 'yes' : 'no'}`);
    console.log(`- upload mode: ${uploadContext.mode}`);

    if (!candidates.length) {
        return;
    }

    const totals = {
        promptsUpdated: 0,
        imagesChanged: 0,
        variantsUploaded: 0,
        originalUploaded: 0,
        failed: 0
    };

    try {
        for (let index = 0; index < candidates.length; index += 1) {
            const { row, planned } = candidates[index];
            console.log(`[${index + 1}/${candidates.length}] ${row.title || row.id} (${planned.length} image${planned.length === 1 ? '' : 's'})`);

            try {
                const stats = await processPrompt({
                    row,
                    args,
                    supabase,
                    uploadContext,
                    r2Bucket,
                    r2PublicUrl
                });

                if (stats.imagesChanged > 0) {
                    totals.promptsUpdated += 1;
                }
                totals.imagesChanged += stats.imagesChanged;
                totals.variantsUploaded += stats.variantsUploaded;
                totals.originalUploaded += stats.originalUploaded;
                totals.failed += stats.failed;

                console.log(`  ${args.apply ? 'updated' : 'would update'} images=${stats.imagesChanged}, original=${stats.originalUploaded}, variants=${stats.variantsUploaded}, failed=${stats.failed}`);
            } catch (error) {
                totals.failed += 1;
                console.error(`  failed prompt ${row.id}: ${error.message}`);
            }
        }
    } finally {
        if (edgeSession) {
            await edgeSession.cleanup();
        }
    }

    console.log('\nSummary');
    console.log(`- prompts ${args.apply ? 'updated' : 'to update'}: ${totals.promptsUpdated}`);
    console.log(`- images ${args.apply ? 'changed' : 'to change'}: ${totals.imagesChanged}`);
    console.log(`- originals ${args.apply ? 'uploaded' : 'to upload'}: ${totals.originalUploaded}`);
    console.log(`- variants ${args.apply ? 'uploaded' : 'to upload'}: ${totals.variantsUploaded}`);
    console.log(`- failures: ${totals.failed}`);

    if (!args.apply) {
        console.log('\nDry run only. Re-run with --apply to upload variants and update Supabase.');
    }
}

main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`);
    process.exit(1);
});
