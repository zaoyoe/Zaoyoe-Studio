#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const VERCEL_PRODUCTION_ENV_PATH = path.join(ROOT_DIR, '.vercel/.env.production.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const PROMPT_IMAGE_ASSET_KEYS = Object.freeze(['original', 'thumb', 'featured', 'card', 'home']);
const PROMPT_IMAGE_CDN_VARIANT_PATHS = new Set(['thumb', 'featured', 'card', 'home']);

function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    return dotenv.parse(fs.readFileSync(filePath, 'utf8'));
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

function requireEnv(sources, label, names = []) {
    const value = readFirstEnv(sources, names);
    if (!value) {
        throw new Error(`Missing ${label}: ${names.join(' / ')}`);
    }
    return value;
}

function formatShanghaiDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: DEFAULT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function addDays(dateString, days) {
    const [year, month, day] = dateString.split('-').map((part) => Number.parseInt(part, 10));
    const utc = new Date(Date.UTC(year, month - 1, day + days));
    return utc.toISOString().slice(0, 10);
}

function getShanghaiDayWindow(dateString) {
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ''))
        ? dateString
        : formatShanghaiDate();
    const nextDate = addDays(normalizedDate, 1);
    return {
        date: normalizedDate,
        since: new Date(`${normalizedDate}T00:00:00+08:00`).toISOString(),
        until: new Date(`${nextDate}T00:00:00+08:00`).toISOString()
    };
}

function parseArgs(argv = []) {
    const args = {
        apply: false,
        date: formatShanghaiDate(),
        limit: Infinity,
        promptIds: []
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
        if (value === '--date') {
            const date = String(argv[index + 1] || '').trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                args.date = date;
            }
            index += 1;
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
            const id = String(argv[index + 1] || '').trim();
            if (id) {
                args.promptIds.push(id);
            }
            index += 1;
        }
    }

    return args;
}

function getPromptImageCdnVariantInfo(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) {
        return { original: '', variant: '' };
    }

    try {
        const parsed = new URL(trimmed);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isPromptCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)
            || parsed.hostname.endsWith('.r2.dev');

        if (
            isPromptCdnHost
            && parts.length === 3
            && parts[0] === 'prompts'
            && PROMPT_IMAGE_CDN_VARIANT_PATHS.has(parts[1])
        ) {
            parsed.pathname = `/prompts/${parts[2]}`;
            parsed.search = '';
            parsed.hash = '';
            return {
                original: parsed.toString(),
                variant: parts[1]
            };
        }
    } catch (error) {
        return { original: trimmed, variant: '' };
    }

    return { original: trimmed, variant: '' };
}

function getPromptImageCanonicalDedupeKey(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    try {
        const parsed = new URL(trimmed);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isPromptCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)
            || parsed.hostname.endsWith('.r2.dev');
        if (isPromptCdnHost && parts[0] === 'prompts') {
            const filename = parts.length === 3 && PROMPT_IMAGE_CDN_VARIANT_PATHS.has(parts[1])
                ? parts[2]
                : (parts.length === 2 ? parts[1] : '');
            if (filename) {
                return `prompts/${decodeURIComponent(filename)}`;
            }
        }
    } catch (error) {
        return trimmed;
    }

    return getPromptImageCdnVariantInfo(trimmed).original || trimmed;
}

function assignPromptImageAssetUrl(asset, key, url) {
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return;

    const variantInfo = getPromptImageCdnVariantInfo(safeUrl);
    const normalizedKey = PROMPT_IMAGE_ASSET_KEYS.includes(key) ? key : 'original';
    const impliedVariant = variantInfo.variant || '';

    if (normalizedKey === 'original' && impliedVariant) {
        asset[impliedVariant] = asset[impliedVariant] || safeUrl;
    } else {
        asset[normalizedKey] = safeUrl;
    }

    if (!asset.original && variantInfo.original) {
        asset.original = variantInfo.original;
    }
}

function normalizePromptImageAsset(value) {
    if (typeof value === 'string') {
        const asset = {};
        assignPromptImageAssetUrl(asset, 'original', value);
        return asset.original ? asset : null;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
        ? value.variants
        : {};
    const asset = {};

    for (const key of PROMPT_IMAGE_ASSET_KEYS) {
        assignPromptImageAssetUrl(asset, key, value[key] || variants[key]);
    }

    const fallbackOriginal = value.url || value.src || value.image;
    if (!asset.original && fallbackOriginal) {
        assignPromptImageAssetUrl(asset, 'original', fallbackOriginal);
    }

    return asset.original || asset.thumb || asset.featured || asset.card || asset.home ? asset : null;
}

function dedupePromptImageAssets(assets = []) {
    const seen = new Map();
    return (Array.isArray(assets) ? assets : [])
        .map(normalizePromptImageAsset)
        .filter((asset) => {
            if (!asset) return false;
            const key = getPromptImageCanonicalDedupeKey(asset.original || asset.featured || asset.card || asset.home || asset.thumb || '');
            if (!key) return false;
            if (seen.has(key)) {
                const existing = seen.get(key);
                existing.original = asset.original || existing.original;
                for (const assetKey of PROMPT_IMAGE_ASSET_KEYS) {
                    if (!existing[assetKey] && asset[assetKey]) {
                        existing[assetKey] = asset[assetKey];
                    }
                }
                return false;
            }
            seen.set(key, asset);
            return true;
        });
}

function normalizePromptImagePayload(row = {}) {
    const legacyImages = Array.isArray(row.images) ? row.images : [];
    const explicitAssets = Array.isArray(row.image_assets) ? row.image_assets : [];
    const existingAssetsByKey = new Map();

    for (const asset of dedupePromptImageAssets(explicitAssets)) {
        const key = getPromptImageCanonicalDedupeKey(asset.original || asset.featured || asset.card || asset.home || asset.thumb || '');
        if (key) {
            existingAssetsByKey.set(key, asset);
        }
    }

    const orderedAssets = [];
    const usedKeys = new Set();

    for (const imageUrl of legacyImages) {
        const imageAsset = normalizePromptImageAsset(imageUrl);
        if (!imageAsset?.original) continue;

        const key = getPromptImageCanonicalDedupeKey(imageAsset.original);
        if (!key || usedKeys.has(key)) continue;

        const existingAsset = existingAssetsByKey.get(key);
        if (existingAsset) {
            existingAsset.original = imageAsset.original;
            for (const assetKey of PROMPT_IMAGE_ASSET_KEYS) {
                if (!existingAsset[assetKey] && imageAsset[assetKey]) {
                    existingAsset[assetKey] = imageAsset[assetKey];
                }
            }
            orderedAssets.push(existingAsset);
        } else {
            orderedAssets.push(imageAsset);
        }
        usedKeys.add(key);
    }

    for (const asset of existingAssetsByKey.values()) {
        const key = getPromptImageCanonicalDedupeKey(asset.original || asset.featured || asset.card || asset.home || asset.thumb || '');
        if (!key || usedKeys.has(key)) continue;
        orderedAssets.push(asset);
        usedKeys.add(key);
    }

    return {
        images: orderedAssets.map((asset) => asset.original).filter(Boolean),
        image_assets: orderedAssets
    };
}

function sortObjectKeys(value) {
    if (Array.isArray(value)) {
        return value.map(sortObjectKeys);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, sortObjectKeys(value[key])])
        );
    }
    return value;
}

function valuesDiffer(a, b) {
    return JSON.stringify(sortObjectKeys(a)) !== JSON.stringify(sortObjectKeys(b));
}

function summarizeRowChange(row, nextPayload) {
    const beforeImages = Array.isArray(row.images) ? row.images : [];
    const beforeAssets = Array.isArray(row.image_assets) ? row.image_assets : [];
    const title = String(row.title || row.title_zh || row.title_en || '').trim() || '(untitled)';
    return {
        id: row.id,
        title,
        created_at: row.created_at || '',
        updated_at: row.updated_at || '',
        imagesBefore: beforeImages.length,
        imagesAfter: nextPayload.images.length,
        assetsBefore: beforeAssets.length,
        assetsAfter: nextPayload.image_assets.length
    };
}

async function fetchPromptRows(supabase, args, window) {
    const select = 'id, title, title_zh, title_en, created_at, updated_at, images, image_assets';
    let rows = [];

    if (args.promptIds.length) {
        const { data, error } = await supabase
            .from('prompts')
            .select(select)
            .in('id', args.promptIds)
            .order('created_at', { ascending: false });
        if (error) throw new Error(`prompts by id: ${error.message}`);
        rows = Array.isArray(data) ? data : [];
    } else {
        const createdQuery = supabase
            .from('prompts')
            .select(select)
            .gte('created_at', window.since)
            .lt('created_at', window.until)
            .order('created_at', { ascending: false });
        const updatedQuery = supabase
            .from('prompts')
            .select(select)
            .gte('updated_at', window.since)
            .lt('updated_at', window.until)
            .order('updated_at', { ascending: false });

        const [createdResult, updatedResult] = await Promise.all([createdQuery, updatedQuery]);
        if (createdResult.error) throw new Error(`prompts created today: ${createdResult.error.message}`);
        if (updatedResult.error) throw new Error(`prompts updated today: ${updatedResult.error.message}`);

        const byId = new Map();
        for (const row of [...(createdResult.data || []), ...(updatedResult.data || [])]) {
            byId.set(row.id, row);
        }
        rows = [...byId.values()].sort((left, right) => (
            String(right.updated_at || right.created_at || '').localeCompare(String(left.updated_at || left.created_at || ''))
        ));
    }

    return rows.slice(0, args.limit);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dayWindow = getShanghaiDayWindow(args.date);
    const envSources = [
        process.env,
        readEnvFile(LOCAL_ENV_PATH),
        readEnvFile(VERCEL_PRODUCTION_ENV_PATH),
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
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    const rows = await fetchPromptRows(supabase, args, dayWindow);
    const changes = rows
        .map((row) => {
            const nextPayload = normalizePromptImagePayload(row);
            return { row, nextPayload, summary: summarizeRowChange(row, nextPayload) };
        })
        .filter(({ row, nextPayload }) => (
            valuesDiffer(row.images || [], nextPayload.images)
            || valuesDiffer(row.image_assets || [], nextPayload.image_assets)
        ));

    console.log(`${args.apply ? 'Apply' : 'Dry run'} prompt image variant cleanup`);
    if (args.promptIds.length) {
        console.log(`- prompt ids: ${args.promptIds.join(', ')}`);
    } else {
        console.log(`- date: ${dayWindow.date} (${DEFAULT_TIMEZONE})`);
        console.log(`- UTC window: ${dayWindow.since} <= created_at/updated_at < ${dayWindow.until}`);
    }
    console.log(`- rows scanned: ${rows.length}`);
    console.log(`- rows needing update: ${changes.length}`);

    for (const { summary } of changes) {
        console.log(`  - ${summary.id} | ${summary.title}`);
        console.log(`    images ${summary.imagesBefore} -> ${summary.imagesAfter}, image_assets ${summary.assetsBefore} -> ${summary.assetsAfter}`);
        console.log(`    created_at=${summary.created_at || '-'} updated_at=${summary.updated_at || '-'}`);
    }

    if (!changes.length || !args.apply) {
        if (!args.apply) {
            console.log('\nDry run only. Re-run with --apply to write changes.');
        }
        return;
    }

    let updated = 0;
    for (const { row, nextPayload } of changes) {
        const { error } = await supabase
            .from('prompts')
            .update({
                images: nextPayload.images,
                image_assets: nextPayload.image_assets
            })
            .eq('id', row.id);
        if (error) {
            throw new Error(`prompt ${row.id}: ${error.message}`);
        }
        updated += 1;
    }

    console.log(`\nUpdated prompts: ${updated}`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
