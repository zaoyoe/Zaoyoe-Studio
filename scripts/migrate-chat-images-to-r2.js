#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const DEFAULT_RUNTIME_CONFIG_URL = 'https://www.fatherkey.com/api/runtime/supabase-config';
const LEGACY_STORAGE_PATTERN = /^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i;

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
        limit: Infinity,
        runtimeConfigUrl: process.env.ZAOYOE_RUNTIME_CONFIG_URL || DEFAULT_RUNTIME_CONFIG_URL
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
            continue;
        }
        if (value === '--runtime-config-url') {
            args.runtimeConfigUrl = String(argv[index + 1] || '').trim() || args.runtimeConfigUrl;
            index += 1;
        }
    }

    return args;
}

async function fetchRuntimeConfig(runtimeConfigUrl) {
    const response = await fetch(runtimeConfigUrl, {
        headers: {
            Accept: 'application/javascript, text/javascript;q=0.9, */*;q=0.1'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to load runtime config: HTTP ${response.status}`);
    }

    const script = await response.text();
    const urlMatch = script.match(/"url":"([^"]+)"/);
    const keyMatch = script.match(/"publishableKey":"([^"]+)"/);
    if (!urlMatch || !keyMatch) {
        throw new Error('Failed to parse runtime config payload');
    }

    return {
        url: urlMatch[1].replace(/\/+$/, ''),
        publishableKey: keyMatch[1]
    };
}

function isLegacySupabaseStorageUrl(value = '') {
    return LEGACY_STORAGE_PATTERN.test(String(value || '').trim());
}

async function createMigrationSession(adminClient, runtimeConfig) {
    const tokenSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const tempEmail = `codex-chat-image-migration-${tokenSuffix}@zaoyoe.local`;
    const tempPassword = `Codex!${tokenSuffix}aA1`;

    const createResult = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
            role: 'codex_chat_image_migration'
        }
    });
    if (createResult.error || !createResult.data?.user?.id) {
        throw new Error(`failed to create temporary upload user: ${createResult.error?.message || 'unknown error'}`);
    }

    const tempUserId = createResult.data.user.id;
    const publicClient = createClient(runtimeConfig.url, runtimeConfig.publishableKey, {
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

async function uploadChatImageViaEdge(runtimeConfig, session, message) {
    const response = await fetch(`${runtimeConfig.url}/functions/v1/upload-avatar`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.accessToken}`,
            apikey: runtimeConfig.publishableKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            userId: session.userId,
            type: 'chat',
            sessionId: message.session_id || message.user_id || 'legacy-chat',
            imageUrl: message.content
        })
    });

    const text = await response.text();
    let payload = {};
    try {
        payload = text ? JSON.parse(text) : {};
    } catch (error) {
        payload = { raw: text };
    }

    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
        throw new Error(payload?.error || payload?.message || `upload-avatar failed: HTTP ${response.status}`);
    }

    return payload.imageUrl;
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    const { data, error } = await adminClient
        .from('chat_messages')
        .select('id, session_id, user_id, content, message_type, created_at')
        .eq('message_type', 'image')
        .order('created_at', { ascending: true });
    if (error) {
        throw error;
    }

    const candidates = (Array.isArray(data) ? data : [])
        .filter((message) => isLegacySupabaseStorageUrl(message.content))
        .slice(0, args.limit);

    console.log(`${args.apply ? 'Apply' : 'Dry run'} chat image migration to R2`);
    console.log(`- image messages scanned: ${Array.isArray(data) ? data.length : 0}`);
    console.log(`- legacy Supabase Storage images: ${candidates.length}`);

    if (!candidates.length) {
        return;
    }

    candidates.forEach((message) => {
        console.log(`  - ${message.id} (${message.session_id || message.user_id || 'unknown-session'})`);
    });

    if (!args.apply) {
        console.log('\nDry run only. Re-run with --apply after upload-avatar is deployed.');
        return;
    }

    const runtimeConfig = await fetchRuntimeConfig(args.runtimeConfigUrl);
    let session = null;
    const totals = {
        updated: 0,
        failed: 0
    };

    try {
        session = await createMigrationSession(adminClient, runtimeConfig);

        for (let index = 0; index < candidates.length; index += 1) {
            const message = candidates[index];
            console.log(`[${index + 1}/${candidates.length}] migrating ${message.id}`);
            try {
                const r2Url = await uploadChatImageViaEdge(runtimeConfig, session, message);
                const { error: updateError } = await adminClient
                    .from('chat_messages')
                    .update({ content: r2Url })
                    .eq('id', message.id);
                if (updateError) {
                    throw updateError;
                }
                totals.updated += 1;
                console.log(`  updated -> ${r2Url}`);
            } catch (error) {
                totals.failed += 1;
                console.error(`  failed: ${error.message}`);
            }
        }
    } finally {
        if (session) {
            await session.cleanup();
        }
    }

    console.log('\nSummary');
    console.log(`- messages updated: ${totals.updated}`);
    console.log(`- failures: ${totals.failed}`);
}

main().catch((error) => {
    console.error(`Chat image migration failed: ${error.message}`);
    process.exit(1);
});
