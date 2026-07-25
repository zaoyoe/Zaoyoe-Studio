#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');
const { createPaletteImagePipeline } = require('../server/prompt-image-palette');
const { extractVideoPosterFrame } = require('../server/prompt-video-poster');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATHS = [path.join(ROOT_DIR, '.env.local'), path.join(ROOT_DIR, 'server/.env')];
const PAGE_SIZE = 500;
const VARIANT_CONFIGS = Object.freeze({
    original: Object.freeze({ width: 2048, quality: 90, keyPrefix: 'prompts' }),
    card: Object.freeze({ width: 560, quality: 76, keyPrefix: 'prompts/card' }),
    thumb: Object.freeze({ width: 800, quality: 85, keyPrefix: 'prompts/thumb' })
});
const POSTER_VARIANTS = Object.freeze(['card', 'thumb']);

function readEnvFile(filePath) {
    return fs.existsSync(filePath) ? dotenv.parse(fs.readFileSync(filePath, 'utf8')) : {};
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

function requireEnv(sources, label, names) {
    const value = readFirstEnv(sources, names);
    if (!value) throw new Error(`Missing ${label}: ${names.join(' / ')}`);
    return value;
}

function parseArgs(argv = []) {
    const args = {
        apply: false,
        force: false,
        limit: Infinity,
        concurrency: 4,
        promptId: '',
        startAfter: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (value === '--apply') args.apply = true;
        if (value === '--dry-run') args.apply = false;
        if (value === '--force') args.force = true;
        if (value === '--limit') {
            const limit = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(limit) && limit > 0) args.limit = limit;
            index += 1;
        }
        if (value === '--concurrency') {
            const concurrency = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(concurrency) && concurrency > 0) args.concurrency = Math.min(concurrency, 12);
            index += 1;
        }
        if (value === '--prompt-id') {
            args.promptId = String(argv[index + 1] || '').trim();
            index += 1;
        }
        if (value === '--start-after') {
            args.startAfter = String(argv[index + 1] || '').trim();
            index += 1;
        }
    }

    return args;
}

function normalizePublicUrlBase(value = '') {
    return String(value || 'https://cdn.fatherkey.com').trim().replace(/\/+$/, '');
}

function normalizePosterAsset(value) {
    if (typeof value === 'string') {
        const original = value.trim();
        return original ? { original } : null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
        ? value.variants
        : {};
    const asset = { ...value };
    for (const key of ['original', 'card', 'thumb']) {
        const url = String(value[key] || variants[key] || '').trim();
        if (url) asset[key] = url;
    }
    if (!asset.original) {
        asset.original = String(value.url || value.src || value.image || '').trim();
    }
    return asset.original ? asset : null;
}

function getVideoPosterAsset(video = {}) {
    return normalizePosterAsset(
        video?.poster_asset
        || video?.posterAsset
        || video?.poster
        || video?.poster_url
        || video?.posterUrl
        || null
    );
}

function getPromptCoverAsset(row = {}, videoIndex = 0) {
    const imageAssets = Array.isArray(row.image_assets) ? row.image_assets : [];
    const legacyImages = Array.isArray(row.images) ? row.images : [];
    return normalizePosterAsset(imageAssets[videoIndex] || imageAssets[0] || legacyImages[videoIndex] || legacyImages[0]);
}

function getPosterWorkPlan(video = {}, { force = false, fallbackPosterAsset = null } = {}) {
    const persistedAsset = getVideoPosterAsset(video);
    const asset = persistedAsset || normalizePosterAsset(fallbackPosterAsset);
    if (asset?.original) {
        const variants = POSTER_VARIANTS.filter((variant) => force || !String(asset[variant] || '').trim());
        return {
            asset,
            variants,
            sourceType: 'image',
            sourceUrl: asset.original,
            needsWork: !persistedAsset || variants.length > 0
        };
    }

    const videoUrl = typeof video === 'string'
        ? video.trim()
        : String(video?.original || video?.url || video?.src || '').trim();
    return {
        asset: null,
        variants: videoUrl ? ['original', ...POSTER_VARIANTS] : [],
        sourceType: 'video',
        sourceUrl: videoUrl,
        needsWork: Boolean(videoUrl)
    };
}

function buildPosterFilename(promptId, videoIndex, originalUrl) {
    const safePromptId = String(promptId || 'prompt').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'prompt';
    const digest = crypto.createHash('sha256').update(String(originalUrl || '')).digest('hex').slice(0, 12);
    return `prompt-video-poster-${safePromptId}-${Number(videoIndex) + 1}-${digest}.webp`;
}

function buildVariantKey(variant, filename) {
    const config = VARIANT_CONFIGS[variant];
    if (!config) throw new Error(`Unsupported poster variant: ${variant}`);
    return `${config.keyPrefix}/${filename}`;
}

async function readPosterBuffer(sourceUrl) {
    const response = await fetch(String(sourceUrl || '').trim(), {
        headers: {
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'User-Agent': 'FatherKeyPromptVideoPosterBackfill/1.0'
        }
    });
    if (!response.ok) throw new Error(`poster download failed: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('poster download returned an empty file');
    return buffer;
}

async function buildVariantBuffers(sourceBuffer, variants) {
    const imagePipeline = await createPaletteImagePipeline(sourceBuffer);
    const metadata = await imagePipeline.clone().metadata();
    const orientation = Number(metadata.orientation || 1);
    const swapsDimensions = orientation >= 5 && orientation <= 8;
    const dimensions = {
        width: Math.max(0, Number(swapsDimensions ? metadata.height : metadata.width) || 0),
        height: Math.max(0, Number(swapsDimensions ? metadata.width : metadata.height) || 0)
    };
    const entries = await Promise.all(variants.map(async (variant) => {
        const config = VARIANT_CONFIGS[variant];
        const buffer = await imagePipeline.clone()
            .rotate()
            .resize(config.width, null, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: config.quality, effort: 5 })
            .toBuffer();
        return [variant, buffer];
    }));
    return { dimensions, buffers: Object.fromEntries(entries) };
}

async function uploadVariants({ s3Client, bucket, publicUrlBase, filename, buffers }) {
    const entries = Object.entries(buffers);
    await Promise.all(entries.map(([variant, buffer]) => s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: buildVariantKey(variant, filename),
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable'
    }))));
    return Object.fromEntries(entries.map(([variant]) => [
        variant,
        `${normalizePublicUrlBase(publicUrlBase)}/${buildVariantKey(variant, filename)}`
    ]));
}

function mergeVideoPosterAsset(video, posterAsset) {
    const nextVideo = {
        ...video,
        poster: posterAsset.original,
        poster_asset: posterAsset
    };
    if (Object.prototype.hasOwnProperty.call(video || {}, 'posterAsset')) {
        nextVideo.posterAsset = posterAsset;
    }
    return nextVideo;
}

async function fetchPrompts(supabase, args) {
    const rows = [];
    let cursor = args.startAfter;

    while (rows.length < args.limit) {
        const remaining = Number.isFinite(args.limit) ? args.limit - rows.length : PAGE_SIZE;
        const pageLimit = Math.min(PAGE_SIZE, remaining);
        let query = supabase
            .from('prompts')
            .select('id,title,images,image_assets,video_assets')
            .order('id', { ascending: true })
            .limit(pageLimit);

        if (args.promptId) query = query.eq('id', args.promptId);
        else if (cursor) query = query.gt('id', cursor);

        const { data, error } = await query;
        if (error) throw new Error(`failed to load prompts: ${error.message}`);
        const page = data || [];
        rows.push(...page);
        if (args.promptId || page.length < pageLimit) break;
        cursor = String(page[page.length - 1]?.id || '');
        if (!cursor) break;
    }

    return rows;
}

async function processPrompt({ row, args, supabase, r2 }) {
    const videos = Array.isArray(row.video_assets) ? row.video_assets : [];
    const nextVideos = [...videos];
    const stats = { videosSeen: videos.length, videosChanged: 0, variantsUploaded: 0, failed: 0 };

    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const plan = getPosterWorkPlan(video, {
            ...args,
            fallbackPosterAsset: getPromptCoverAsset(row, index)
        });
        if (!plan.needsWork) continue;

        if (!args.apply) {
            stats.videosChanged += 1;
            stats.variantsUploaded += plan.variants.length;
            continue;
        }

        try {
            const sourceBuffer = plan.sourceType === 'video'
                ? await extractVideoPosterFrame(plan.sourceUrl)
                : await readPosterBuffer(plan.sourceUrl);
            const { dimensions, buffers } = await buildVariantBuffers(sourceBuffer, plan.variants);
            const filename = buildPosterFilename(row.id, index, plan.sourceUrl);
            const uploaded = await uploadVariants({ ...r2, filename, buffers });
            const posterAsset = {
                ...(plan.asset || {}),
                ...uploaded,
                ...(dimensions.width && dimensions.height ? dimensions : {})
            };
            nextVideos[index] = mergeVideoPosterAsset(video, posterAsset);
            stats.videosChanged += 1;
            stats.variantsUploaded += plan.variants.length;
        } catch (error) {
            stats.failed += 1;
            console.error(`  failed video ${index + 1}: ${error.message}`);
        }
    }

    if (args.apply && stats.videosChanged > 0) {
        const { error } = await supabase.from('prompts').update({ video_assets: nextVideos }).eq('id', row.id);
        if (error) throw new Error(`database update failed: ${error.message}`);
    }

    return stats;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const envSources = [process.env, ...ENV_PATHS.map(readEnvFile)];
    const supabaseUrl = requireEnv(envSources, 'Supabase URL', ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL']);
    const serviceRoleKey = requireEnv(envSources, 'Supabase service role key', ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY']);
    const endpoint = requireEnv(envSources, 'R2 endpoint', ['AI_IMAGE_R2_ENDPOINT', 'R2_ENDPOINT']);
    const accessKeyId = requireEnv(envSources, 'R2 access key', ['AI_IMAGE_R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY']);
    const secretAccessKey = requireEnv(envSources, 'R2 secret key', ['AI_IMAGE_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY', 'R2_SECRET_KEY']);
    const bucket = readFirstEnv(envSources, ['AI_IMAGE_R2_BUCKET_NAME', 'R2_BUCKET_NAME'], 'zaoyoeimages');
    const publicUrlBase = normalizePublicUrlBase(readFirstEnv(envSources, ['AI_IMAGE_R2_PUBLIC_URL', 'R2_PUBLIC_URL'], 'https://cdn.fatherkey.com'));
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey }
    });

    const prompts = await fetchPrompts(supabase, args);
    const candidates = prompts.filter((row) => (
        Array.isArray(row.video_assets)
        && row.video_assets.some((video, index) => getPosterWorkPlan(video, {
            ...args,
            fallbackPosterAsset: getPromptCoverAsset(row, index)
        }).needsWork)
    ));

    console.log(`${args.apply ? 'Apply' : 'Dry run'} prompt video poster backfill`);
    console.log(`- prompts scanned: ${prompts.length}`);
    console.log(`- prompts needing work: ${candidates.length}`);
    console.log(`- force: ${args.force ? 'yes' : 'no'}`);
    console.log(`- concurrency: ${args.concurrency}`);

    const totals = { promptsUpdated: 0, videosChanged: 0, variantsUploaded: 0, failed: 0 };
    let candidateIndex = 0;
    async function worker() {
        while (candidateIndex < candidates.length) {
            const index = candidateIndex;
            candidateIndex += 1;
            const row = candidates[index];
            console.log(`[${index + 1}/${candidates.length}] ${row.title || row.id}`);
            try {
                const stats = await processPrompt({
                    row,
                    args,
                    supabase,
                    r2: { s3Client, bucket, publicUrlBase }
                });
                if (stats.videosChanged > 0) totals.promptsUpdated += 1;
                totals.videosChanged += stats.videosChanged;
                totals.variantsUploaded += stats.variantsUploaded;
                totals.failed += stats.failed;
                console.log(`  ${args.apply ? 'updated' : 'would update'} videos=${stats.videosChanged}, variants=${stats.variantsUploaded}, failed=${stats.failed}`);
            } catch (error) {
                totals.failed += 1;
                console.error(`  failed prompt ${row.id}: ${error.message}`);
            }
        }
    }
    await Promise.all(Array.from(
        { length: Math.min(candidates.length, Math.max(1, args.concurrency)) },
        () => worker()
    ));

    console.log('\nSummary');
    console.log(`- prompts ${args.apply ? 'updated' : 'to update'}: ${totals.promptsUpdated}`);
    console.log(`- videos ${args.apply ? 'changed' : 'to change'}: ${totals.videosChanged}`);
    console.log(`- variants ${args.apply ? 'uploaded' : 'to upload'}: ${totals.variantsUploaded}`);
    console.log(`- failures: ${totals.failed}`);
    if (!args.apply) console.log('\nDry run only. Re-run with --apply to upload variants and update Supabase.');
    if (totals.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`Backfill failed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    VARIANT_CONFIGS,
    parseArgs,
    normalizePosterAsset,
    getPromptCoverAsset,
    getPosterWorkPlan,
    buildPosterFilename,
    buildVariantKey,
    buildVariantBuffers,
    mergeVideoPosterAsset
};
