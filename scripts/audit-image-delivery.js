#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const TARGET_BUCKETS = [
    'prompt-images',
    'comment-images',
    'chat-assets',
    'chat-images'
];
const DISABLED_MIME_TYPE = 'application/x-supabase-image-bucket-disabled';
const IMAGE_URL_TABLES = [
    {
        table: 'shop_products',
        select: 'id,name,icon_url,image_assets',
        fields: ['icon_url', 'image_assets'],
        label(row) {
            return row.name || row.id;
        }
    },
    {
        table: 'profiles',
        select: 'id,avatar_url',
        fields: ['avatar_url']
    },
    {
        table: 'prompts',
        select: 'id,title,images,image_assets',
        fields: ['images', 'image_assets'],
        label(row) {
            return row.title || row.id;
        }
    },
    {
        table: 'prompt_comments',
        select: 'id,image_url',
        fields: ['image_url']
    },
    {
        table: 'guestbook_messages',
        select: 'id,user_id,image_url',
        fields: ['image_url']
    },
    {
        table: 'chat_messages',
        select: 'id,session_id,user_id,content,message_type',
        fields: ['content'],
        filter(row) {
            return String(row.message_type || '') === 'image';
        },
        label(row) {
            return row.session_id || row.user_id || row.id;
        }
    },
    {
        table: 'homepage_config',
        select: 'id,site,section,content',
        fields: ['content'],
        label(row) {
            return `${row.site || 'unknown'}:${row.section || row.id}`;
        }
    }
];

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
        failOnRisk: false,
        json: false,
        maxExamples: 8,
        pageSize: 1000
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--fail-on-risk') {
            args.failOnRisk = true;
            continue;
        }
        if (value === '--json') {
            args.json = true;
            continue;
        }
        if (value === '--max-examples') {
            const maxExamples = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(maxExamples) && maxExamples >= 0) {
                args.maxExamples = maxExamples;
            }
            index += 1;
            continue;
        }
        if (value === '--page-size') {
            const pageSize = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(pageSize) && pageSize > 0) {
                args.pageSize = Math.min(pageSize, 1000);
            }
            index += 1;
        }
    }

    return args;
}

function cleanUrlCandidate(value) {
    return String(value || '')
        .trim()
        .replace(/[),.;]+$/g, '');
}

function collectUrls(value, fieldPath = []) {
    if (typeof value === 'string') {
        const source = value.trim();
        if (!source) return [];

        const matches = source.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
        const dataImageMatches = source.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g) || [];
        return [
            ...matches.map((url) => ({ url: cleanUrlCandidate(url), fieldPath: fieldPath.join('.') })),
            ...dataImageMatches.map((url) => ({ url, fieldPath: fieldPath.join('.') }))
        ]
            .filter((item) => item.url);
    }

    if (Array.isArray(value)) {
        return value.flatMap((item, index) => collectUrls(item, [...fieldPath, String(index)]));
    }

    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, item]) => collectUrls(item, [...fieldPath, key]));
    }

    return [];
}

function classifyRisk(url) {
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(String(url || '').trim())) {
        return 'inline_data_image';
    }

    try {
        const parsed = new URL(url);
        const pathname = String(parsed.pathname || '');
        if (parsed.hostname.endsWith('.supabase.co') && pathname.includes('/storage/v1/')) {
            return 'legacy_supabase_storage';
        }
        if (parsed.hostname.endsWith('.r2.dev')) {
            return 'raw_r2_dev';
        }
    } catch (error) {
        return '';
    }
    return '';
}

function isMissingRelationOrColumn(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('does not exist')
        || message.includes('schema cache')
        || message.includes('could not find')
        || message.includes('column');
}

async function fetchRows(supabase, spec, pageSize = 1000) {
    const rows = [];
    const safePageSize = Math.min(Math.max(1, Number(pageSize) || 1000), 1000);
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from(spec.table)
            .select(spec.select)
            .range(from, from + safePageSize - 1);

        if (error) {
            if (isMissingRelationOrColumn(error)) {
                return {
                    rows: [],
                    skipped: true,
                    error: error.message
                };
            }

            throw new Error(`${spec.table}: ${error.message}`);
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < safePageSize) {
            break;
        }
        from += safePageSize;
    }

    return {
        rows,
        skipped: false,
        error: null
    };
}

function scanRows(spec, rows) {
    const issues = [];
    const filteredRows = typeof spec.filter === 'function'
        ? rows.filter((row) => spec.filter(row))
        : rows;

    for (const row of filteredRows) {
        for (const field of spec.fields) {
            const urls = collectUrls(row[field], [field]);
            for (const item of urls) {
                const risk = classifyRisk(item.url);
                if (!risk) continue;

                issues.push({
                    risk,
                    table: spec.table,
                    rowId: row.id || '',
                    rowLabel: typeof spec.label === 'function' ? spec.label(row) : (row.id || ''),
                    field: item.fieldPath || field,
                    url: item.url
                });
            }
        }
    }

    return {
        scanned: rows.length,
        considered: filteredRows.length,
        issues
    };
}

function normalizeAllowedMimeTypes(bucket = {}) {
    const value = bucket.allowed_mime_types ?? bucket.allowedMimeTypes ?? [];
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') return [value.trim()].filter(Boolean);
    return [];
}

function bucketNeedsLockdown(bucket = {}) {
    const allowedMimeTypes = normalizeAllowedMimeTypes(bucket);
    const fileSizeLimit = Number(bucket.file_size_limit ?? bucket.fileSizeLimit ?? 0) || 0;
    return bucket.public !== false
        || fileSizeLimit !== 1
        || allowedMimeTypes.length !== 1
        || allowedMimeTypes[0] !== DISABLED_MIME_TYPE;
}

async function scanBuckets(supabase) {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
        return {
            skipped: true,
            error: error.message,
            buckets: []
        };
    }

    const buckets = (Array.isArray(data) ? data : [])
        .filter((bucket) => TARGET_BUCKETS.includes(bucket.id))
        .map((bucket) => ({
            id: bucket.id,
            public: bucket.public,
            fileSizeLimit: bucket.file_size_limit ?? bucket.fileSizeLimit ?? null,
            allowedMimeTypes: normalizeAllowedMimeTypes(bucket),
            needsLockdown: bucketNeedsLockdown(bucket)
        }));

    return {
        skipped: false,
        error: null,
        buckets
    };
}

function buildSummary(tableResults, bucketResult) {
    const issues = tableResults.flatMap((item) => item.issues || []);
    const bucketRisks = bucketResult.buckets.filter((bucket) => bucket.needsLockdown);
    const byRisk = issues.reduce((acc, issue) => {
        acc[issue.risk] = (acc[issue.risk] || 0) + 1;
        return acc;
    }, {});

    return {
        tableResults,
        bucketResult,
        issueCount: issues.length,
        bucketRiskCount: bucketRisks.length,
        byRisk,
        issues,
        bucketRisks,
        hasRisk: issues.length > 0 || bucketRisks.length > 0
    };
}

function printHumanSummary(summary, maxExamples) {
    console.log('Image delivery audit');
    for (const result of summary.tableResults) {
        const skipped = result.skipped ? ` skipped (${result.error})` : '';
        console.log(`- ${result.table}: scanned=${result.scanned}, considered=${result.considered}, risks=${result.issues.length}${skipped}`);
    }

    if (summary.bucketResult.skipped) {
        console.log(`- storage buckets: skipped (${summary.bucketResult.error})`);
    } else if (!summary.bucketResult.buckets.length) {
        console.log('- storage buckets: no legacy image buckets found');
    } else {
        console.log('- storage buckets:');
        for (const bucket of summary.bucketResult.buckets) {
            console.log(`  - ${bucket.id}: public=${bucket.public}, fileSizeLimit=${bucket.fileSizeLimit}, allowedMimeTypes=${JSON.stringify(bucket.allowedMimeTypes)}, needsLockdown=${bucket.needsLockdown}`);
        }
    }

    console.log('\nSummary');
    console.log(`- legacy Supabase Storage URLs: ${summary.byRisk.legacy_supabase_storage || 0}`);
    console.log(`- raw r2.dev URLs: ${summary.byRisk.raw_r2_dev || 0}`);
    console.log(`- inline data image payloads: ${summary.byRisk.inline_data_image || 0}`);
    console.log(`- buckets needing lockdown: ${summary.bucketRiskCount}`);

    const examples = summary.issues.slice(0, maxExamples);
    if (examples.length) {
        console.log('\nExamples');
        for (const issue of examples) {
            console.log(`- [${issue.risk}] ${issue.table}.${issue.field} ${issue.rowLabel || issue.rowId}: ${issue.url}`);
        }
    }
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

    const tableResults = [];
    for (const spec of IMAGE_URL_TABLES) {
        const result = await fetchRows(supabase, spec, args.pageSize);
        if (result.skipped) {
            tableResults.push({
                table: spec.table,
                scanned: 0,
                considered: 0,
                issues: [],
                skipped: true,
                error: result.error
            });
            continue;
        }

        tableResults.push({
            table: spec.table,
            ...scanRows(spec, result.rows),
            skipped: false,
            error: null
        });
    }

    const bucketResult = await scanBuckets(supabase);
    const summary = buildSummary(tableResults, bucketResult);
    if (args.json) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        printHumanSummary(summary, args.maxExamples);
    }

    if (args.failOnRisk && summary.hasRisk) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error(`Image delivery audit failed: ${error.message}`);
    process.exit(1);
});
