#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const CDN_ORIGIN = 'https://cdn.fatherkey.com';
const R2_ASSET_PREFIXES = new Set([
    'affiliate-posters',
    'avatars',
    'chat',
    'comments',
    'guestbook',
    'homepage',
    'products',
    'prompts'
]);

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

function parseArgs(argv = []) {
    const args = {
        apply: false,
        limit: Infinity
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
        if (value === '--limit') {
            const limit = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(limit) && limit > 0) {
                args.limit = limit;
            }
            index += 1;
        }
    }

    return args;
}

function normalizeR2PublicUrl(value) {
    const source = String(value || '').trim();
    if (!source) return value;

    try {
        const parsed = new URL(source);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        if (!parsed.hostname.endsWith('.r2.dev') || !R2_ASSET_PREFIXES.has(parts[0])) {
            return value;
        }
        parsed.protocol = 'https:';
        parsed.host = new URL(CDN_ORIGIN).host;
        return parsed.toString();
    } catch (error) {
        return value;
    }
}

function normalizeJsonUrls(value) {
    if (typeof value === 'string') {
        return normalizeR2PublicUrl(value);
    }
    if (Array.isArray(value)) {
        return value.map(normalizeJsonUrls);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, normalizeJsonUrls(item)])
        );
    }
    return value;
}

function valuesDiffer(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
}

async function fetchTableRows(supabase, table, select, orderColumn = 'id') {
    const { data, error } = await supabase
        .from(table)
        .select(select)
        .order(orderColumn, { ascending: true });
    if (error) {
        throw new Error(`${table}: ${error.message}`);
    }
    return Array.isArray(data) ? data : [];
}

async function normalizeTable({ supabase, args, table, select, buildUpdate, label }) {
    const rows = await fetchTableRows(supabase, table, select);
    const changes = rows
        .map((row) => ({ row, update: buildUpdate(row) }))
        .filter(({ update }) => Object.keys(update).length > 0)
        .slice(0, args.limit);

    console.log(`${label}: scanned ${rows.length}, needs update ${changes.length}`);
    if (!changes.length || !args.apply) {
        return { scanned: rows.length, changed: changes.length, updated: 0 };
    }

    let updated = 0;
    for (const { row, update } of changes) {
        const { error } = await supabase
            .from(table)
            .update(update)
            .eq('id', row.id);
        if (error) {
            throw new Error(`${table} ${row.id}: ${error.message}`);
        }
        updated += 1;
    }

    return { scanned: rows.length, changed: changes.length, updated };
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
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    console.log(`${args.apply ? 'Apply' : 'Dry run'} R2 public URL normalization`);

    const tasks = [
        normalizeTable({
            supabase,
            args,
            table: 'shop_products',
            select: 'id, icon_url, image_assets',
            label: 'shop_products',
            buildUpdate(row) {
                const update = {};
                const nextIconUrl = normalizeR2PublicUrl(row.icon_url);
                const nextImageAssets = normalizeJsonUrls(row.image_assets);
                if (nextIconUrl !== row.icon_url) update.icon_url = nextIconUrl;
                if (valuesDiffer(nextImageAssets, row.image_assets)) update.image_assets = nextImageAssets;
                return update;
            }
        }),
        normalizeTable({
            supabase,
            args,
            table: 'profiles',
            select: 'id, avatar_url',
            label: 'profiles',
            buildUpdate(row) {
                const nextAvatarUrl = normalizeR2PublicUrl(row.avatar_url);
                return nextAvatarUrl !== row.avatar_url ? { avatar_url: nextAvatarUrl } : {};
            }
        }),
        normalizeTable({
            supabase,
            args,
            table: 'prompts',
            select: 'id, images, image_assets',
            label: 'prompts',
            buildUpdate(row) {
                const update = {};
                const nextImages = normalizeJsonUrls(row.images);
                const nextImageAssets = normalizeJsonUrls(row.image_assets);
                if (valuesDiffer(nextImages, row.images)) update.images = nextImages;
                if (valuesDiffer(nextImageAssets, row.image_assets)) update.image_assets = nextImageAssets;
                return update;
            }
        }),
        normalizeTable({
            supabase,
            args,
            table: 'prompt_comments',
            select: 'id, image_url',
            label: 'prompt_comments',
            buildUpdate(row) {
                const nextImageUrl = normalizeR2PublicUrl(row.image_url);
                return nextImageUrl !== row.image_url ? { image_url: nextImageUrl } : {};
            }
        }),
        normalizeTable({
            supabase,
            args,
            table: 'guestbook_messages',
            select: 'id, image_url',
            label: 'guestbook_messages',
            buildUpdate(row) {
                const nextImageUrl = normalizeR2PublicUrl(row.image_url);
                return nextImageUrl !== row.image_url ? { image_url: nextImageUrl } : {};
            }
        }),
        normalizeTable({
            supabase,
            args,
            table: 'chat_messages',
            select: 'id, content, message_type',
            label: 'chat_messages',
            buildUpdate(row) {
                if (String(row.message_type || '') !== 'image') return {};
                const nextContent = normalizeR2PublicUrl(row.content);
                return nextContent !== row.content ? { content: nextContent } : {};
            }
        }),
        normalizeTable({
            supabase,
            args,
            table: 'homepage_config',
            select: 'id, content',
            label: 'homepage_config',
            buildUpdate(row) {
                const nextContent = normalizeJsonUrls(row.content);
                return valuesDiffer(nextContent, row.content) ? { content: nextContent } : {};
            }
        })
    ];

    const results = await Promise.all(tasks);
    const totals = results.reduce((acc, item) => ({
        scanned: acc.scanned + item.scanned,
        changed: acc.changed + item.changed,
        updated: acc.updated + item.updated
    }), { scanned: 0, changed: 0, updated: 0 });

    console.log('\nSummary');
    console.log(`- rows scanned: ${totals.scanned}`);
    console.log(`- rows needing update: ${totals.changed}`);
    console.log(`- rows updated: ${totals.updated}`);
    if (!args.apply) {
        console.log('\nDry run only. Re-run with --apply to write changes.');
    }
}

main().catch((error) => {
    console.error(`R2 URL normalization failed: ${error.message}`);
    process.exit(1);
});
