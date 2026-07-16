#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
    PROMPT_IMAGE_PALETTE_VERSION,
    downloadImageBuffer,
    getPromptImageUrlsFromRecord,
    hasCurrentPromptImagePalettes,
    resolvePromptImagePalettes
} = require('../server/prompt-image-palette');

const ROOT_DIR = path.resolve(__dirname, '..');
const PAGE_SIZE = 100;

function readEnvFile(filePath) {
    return fs.existsSync(filePath) ? dotenv.parse(fs.readFileSync(filePath, 'utf8')) : {};
}

function readFirstEnv(sources, names) {
    for (const source of sources) {
        for (const name of names) {
            const value = String(source?.[name] || '').trim();
            if (value) return value;
        }
    }
    return '';
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
        limit: Number.POSITIVE_INFINITY,
        concurrency: 4,
        quiet: false,
        promptId: '',
        startAfter: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (value === '--apply') args.apply = true;
        if (value === '--dry-run') args.apply = false;
        if (value === '--force') args.force = true;
        if (value === '--quiet') args.quiet = true;
        if (value === '--limit') {
            const limit = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(limit) && limit > 0) args.limit = limit;
            index += 1;
        }
        if (value === '--concurrency') {
            const concurrency = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(concurrency) && concurrency > 0) {
                args.concurrency = Math.min(concurrency, 8);
            }
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

function resolveLocalImagePath(imageUrl) {
    const normalized = String(imageUrl || '').trim().split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\/+/, '');
    if (!normalized) return '';
    const filePath = path.resolve(ROOT_DIR, normalized);
    return filePath === ROOT_DIR || filePath.startsWith(`${ROOT_DIR}${path.sep}`) ? filePath : '';
}

async function loadBackfillImageBuffer(imageUrl, options = {}) {
    if (/^https?:\/\//i.test(String(imageUrl || '').trim())) {
        return downloadImageBuffer(imageUrl, options);
    }

    const filePath = resolveLocalImagePath(imageUrl);
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Local image does not exist');
    const stat = fs.statSync(filePath);
    const maxBytes = Number(options.maxBytes) || 20 * 1024 * 1024;
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Local image exceeds palette size limit');
    return fs.promises.readFile(filePath);
}

async function loadPromptPage(supabase, { promptId, cursor } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
        try {
            let query = supabase
                .from('prompts')
                .select('id, images, image_assets, image_palettes')
                .order('id', { ascending: true });
            if (promptId) query = query.eq('id', promptId);
            if (!promptId && cursor) query = query.gt('id', cursor);
            const result = await query.limit(promptId ? 1 : PAGE_SIZE);
            if (!result.error) return result;
            lastError = result.error;
        } catch (error) {
            lastError = error;
        }
        if (attempt < 6) {
            await waitForRetry(Math.min(4000, 500 * (2 ** (attempt - 1))));
        }
    }
    return { data: null, error: lastError || new Error('Prompt page load failed') };
}

function waitForRetry(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function updatePromptPalettesWithRetry(supabase, promptId, palettes, maxAttempts = 6) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const { error } = await supabase
                .from('prompts')
                .update({ image_palettes: palettes })
                .eq('id', promptId);
            if (!error) return;
            lastError = error;
        } catch (error) {
            lastError = error;
        }
        if (attempt < maxAttempts) {
            await waitForRetry(Math.min(4000, 500 * (2 ** (attempt - 1))));
        }
    }
    throw new Error(`Database update failed after ${maxAttempts} attempts: ${lastError?.message || lastError}`);
}

async function processPromptRow(supabase, row, {
    apply,
    force,
    paletteCache
} = {}) {
    const imageUrls = getPromptImageUrlsFromRecord(row);
    if (!imageUrls.length) {
        return { status: 'skipped', imageCount: 0, paletteCount: 0, failures: [] };
    }
    if (!force && hasCurrentPromptImagePalettes(imageUrls, row.image_palettes)) {
        return { status: 'current', imageCount: imageUrls.length, paletteCount: imageUrls.length, failures: [] };
    }

    const result = await resolvePromptImagePalettes(imageUrls, {
        existingPalettes: force ? [] : row.image_palettes,
        concurrency: 1,
        paletteCache,
        loadImageBuffer: loadBackfillImageBuffer,
        timeoutMs: process.env.PROMPT_PALETTE_IMAGE_TIMEOUT_MS,
        maxBytes: process.env.PROMPT_PALETTE_MAX_IMAGE_BYTES
    });
    if (apply && result.palettes.length) {
        await updatePromptPalettesWithRetry(supabase, row.id, result.palettes);
    }

    return {
        status: apply ? 'updated' : 'previewed',
        imageCount: imageUrls.length,
        paletteCount: result.palettes.length,
        failures: result.failures
    };
}

async function runWorkerPool(rows, concurrency, worker) {
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(rows.length, concurrency) }, async () => {
        while (nextIndex < rows.length) {
            const index = nextIndex;
            nextIndex += 1;
            await worker(rows[index]);
        }
    }));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const envSources = [
        process.env,
        readEnvFile(path.join(ROOT_DIR, '.env.local')),
        readEnvFile(path.join(ROOT_DIR, 'server/.env'))
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
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const paletteCache = new Map();
    const totals = {
        scanned: 0,
        processed: 0,
        current: 0,
        skipped: 0,
        updated: 0,
        previewed: 0,
        failedImages: 0,
        failedPrompts: 0
    };
    let cursor = args.startAfter;
    let resumeAfter = args.startAfter;

    console.log(`Prompt palette backfill v${PROMPT_IMAGE_PALETTE_VERSION} (${args.apply ? 'apply' : 'dry-run'}, concurrency=${args.concurrency})`);

    while (totals.processed < args.limit) {
        const { data, error } = await loadPromptPage(supabase, { promptId: args.promptId, cursor });
        if (error) throw error;
        const rows = Array.isArray(data) ? data : [];
        if (!rows.length) break;
        totals.scanned += rows.length;
        cursor = String(rows.at(-1)?.id || cursor);

        const candidates = [];
        for (const row of rows) {
            const imageUrls = getPromptImageUrlsFromRecord(row);
            if (!imageUrls.length) {
                totals.skipped += 1;
                continue;
            }
            if (!args.force && hasCurrentPromptImagePalettes(imageUrls, row.image_palettes)) {
                totals.current += 1;
                continue;
            }
            if (totals.processed + candidates.length >= args.limit) break;
            candidates.push(row);
        }

        await runWorkerPool(candidates, args.concurrency, async (row) => {
            try {
                const result = await processPromptRow(supabase, row, {
                    apply: args.apply,
                    force: args.force,
                    paletteCache
                });
                totals.processed += 1;
                totals[result.status] += 1;
                totals.failedImages += result.failures.length;
                if (!args.quiet) {
                    console.log(`[${totals.processed}] ${row.id}: ${result.status}, palettes=${result.paletteCount}/${result.imageCount}${result.failures.length ? `, failures=${result.failures.length}` : ''}`);
                }
            } catch (error) {
                totals.processed += 1;
                totals.failedPrompts += 1;
                console.error(`[${totals.processed}] ${row.id}: failed - ${error.message || error}`);
            }
        });
        if (candidates.length) {
            resumeAfter = String(candidates.at(-1)?.id || resumeAfter);
        } else {
            resumeAfter = cursor;
        }

        if (args.promptId || rows.length < PAGE_SIZE) break;
    }

    console.log(JSON.stringify({
        mode: args.apply ? 'apply' : 'dry-run',
        paletteVersion: PROMPT_IMAGE_PALETTE_VERSION,
        resumeAfter,
        cachedImageHashes: paletteCache.size,
        ...totals
    }, null, 2));
    if (totals.failedPrompts > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
});
