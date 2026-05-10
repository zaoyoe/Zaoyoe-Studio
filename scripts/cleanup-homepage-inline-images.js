#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const DEFAULT_VERIFY_SCREENSHOT = '/assets/verify-preview.png';

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
        fallback: DEFAULT_VERIFY_SCREENSHOT,
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
        if (value === '--fallback') {
            const fallback = String(argv[index + 1] || '').trim();
            if (fallback) {
                args.fallback = fallback;
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
        }
    }

    return args;
}

function isInlineImageData(value) {
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || '').trim());
}

function cleanHomepageContent(value, args, pathParts = []) {
    if (typeof value === 'string') {
        if (!isInlineImageData(value)) {
            return value;
        }
        const fieldName = pathParts[pathParts.length - 1] || '';
        return fieldName === 'screenshot_path' ? args.fallback : '';
    }

    if (Array.isArray(value)) {
        return value.map((item, index) => cleanHomepageContent(item, args, [...pathParts, String(index)]));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, cleanHomepageContent(item, args, [...pathParts, key])])
        );
    }

    return value;
}

function valuesDiffer(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
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

    const { data, error } = await supabase
        .from('homepage_config')
        .select('id, site, section, content')
        .order('site', { ascending: true })
        .order('section', { ascending: true });

    if (error) {
        throw new Error(`homepage_config: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : [];
    const changes = rows
        .map((row) => ({
            row,
            nextContent: cleanHomepageContent(row.content, args)
        }))
        .filter(({ row, nextContent }) => valuesDiffer(row.content, nextContent))
        .slice(0, args.limit);

    console.log(`${args.apply ? 'Apply' : 'Dry run'} homepage inline image cleanup`);
    console.log(`- rows scanned: ${rows.length}`);
    console.log(`- rows needing update: ${changes.length}`);

    for (const { row } of changes) {
        console.log(`  - ${row.site || 'unknown'}:${row.section || row.id}`);
    }

    if (!changes.length || !args.apply) {
        if (!args.apply) {
            console.log('\nDry run only. Re-run with --apply to write changes.');
        }
        return;
    }

    let updated = 0;
    for (const { row, nextContent } of changes) {
        const { error: updateError } = await supabase
            .from('homepage_config')
            .update({ content: nextContent })
            .eq('id', row.id);

        if (updateError) {
            throw new Error(`homepage_config ${row.id}: ${updateError.message}`);
        }
        updated += 1;
    }

    console.log(`- rows updated: ${updated}`);
}

main().catch((error) => {
    console.error(`Homepage inline image cleanup failed: ${error.message}`);
    process.exit(1);
});
