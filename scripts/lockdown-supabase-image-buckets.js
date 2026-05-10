#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const IMAGE_BUCKETS = [
    'prompt-images',
    'comment-images',
    'chat-assets',
    'chat-images'
];
const DISABLED_MIME_TYPES = ['application/x-supabase-image-bucket-disabled'];

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
    return {
        apply: argv.includes('--apply') && !argv.includes('--dry-run')
    };
}

function summarizeBucket(bucket = {}) {
    return {
        id: bucket.id,
        public: bucket.public,
        fileSizeLimit: bucket.file_size_limit ?? bucket.fileSizeLimit ?? null,
        allowedMimeTypes: bucket.allowed_mime_types ?? bucket.allowedMimeTypes ?? null
    };
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

    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
        throw error;
    }

    const targets = (Array.isArray(buckets) ? buckets : [])
        .filter((bucket) => IMAGE_BUCKETS.includes(bucket.id));

    console.log(`${args.apply ? 'Apply' : 'Dry run'} Supabase image bucket lockdown`);
    if (!targets.length) {
        console.log('- no legacy image buckets found');
        return;
    }

    targets.forEach((bucket) => {
        const summary = summarizeBucket(bucket);
        console.log(`- ${summary.id}: public=${summary.public}, fileSizeLimit=${summary.fileSizeLimit}, allowedMimeTypes=${JSON.stringify(summary.allowedMimeTypes)}`);
    });

    if (!args.apply) {
        console.log('\nDry run only. Re-run with --apply to make these buckets private and reject image uploads.');
        return;
    }

    let updated = 0;
    for (const bucket of targets) {
        const { error: updateError } = await supabase.storage.updateBucket(bucket.id, {
            public: false,
            fileSizeLimit: 1,
            allowedMimeTypes: DISABLED_MIME_TYPES
        });
        if (updateError) {
            throw new Error(`${bucket.id}: ${updateError.message}`);
        }
        updated += 1;
    }

    console.log(`\nLocked down buckets: ${updated}`);
}

main().catch((error) => {
    console.error(`Supabase image bucket lockdown failed: ${error.message}`);
    process.exit(1);
});
