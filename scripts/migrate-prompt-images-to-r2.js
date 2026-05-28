#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENV_PATH = path.join(ROOT_DIR, 'server/.env');
const DEFAULT_RUNTIME_CONFIG_URL = 'http://127.0.0.1:8000/api/runtime/supabase-config';
const PROMPT_IMAGE_PREFIX = 'supabase.co/storage/v1/object/public/prompt-images/';
const R2_CDN_PREFIX = 'https://cdn.fatherkey.com/prompts/';

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

function parseArgs(argv = []) {
    const args = {
        dryRun: false,
        limit: Infinity
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--dry-run') {
            args.dryRun = true;
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
        url: urlMatch[1],
        publishableKey: keyMatch[1]
    };
}

function collectLegacyPromptImages(prompts = []) {
    const matches = [];

    for (const prompt of prompts) {
        const images = Array.isArray(prompt.images) ? prompt.images : [];
        const legacyImages = images
            .map((url, index) => ({ url: String(url || '').trim(), index }))
            .filter(({ url }) => url.includes(PROMPT_IMAGE_PREFIX));

        if (!legacyImages.length) continue;

        matches.push({
            id: prompt.id,
            title: prompt.title || String(prompt.id),
            images,
            legacyImages
        });
    }

    return matches;
}

function normalizeUploadFilename(imageUrl) {
    const parsed = new URL(imageUrl);
    const originalName = path.basename(parsed.pathname);
    const basename = originalName.replace(/\.[^.]+$/, '');
    return `${basename}.webp`;
}

async function downloadImageBuffer(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

async function buildOriginalWebp(imageBuffer) {
    return sharp(imageBuffer, { failOn: 'none' })
        .rotate()
        .webp({ quality: 90 })
        .toBuffer();
}

async function buildThumbnailWebp(imageBuffer) {
    return sharp(imageBuffer, { failOn: 'none' })
        .rotate()
        .resize({
            width: 800,
            withoutEnlargement: true
        })
        .webp({ quality: 85 })
        .toBuffer();
}

async function createMigrationSession(adminClient, runtimeConfig) {
    const tokenSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const tempEmail = `codex-prompt-migration-${tokenSuffix}@zaoyoe.local`;
    const tempPassword = `Codex!${tokenSuffix}aA1`;

    const createResult = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
            role: 'codex_prompt_image_migration'
        }
    });

    if (createResult.error || !createResult.data?.user?.id) {
        throw new Error(`Failed to create migration user: ${createResult.error?.message || 'unknown error'}`);
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
        throw new Error(`Failed to sign in migration user: ${signInResult.error?.message || 'unknown error'}`);
    }

    return {
        accessToken: signInResult.data.session.access_token,
        async cleanup() {
            await adminClient.auth.admin.deleteUser(tempUserId);
        }
    };
}

async function uploadPromptImagePair(runtimeConfig, accessToken, filename, originalBuffer, thumbBuffer) {
    const response = await fetch(`${runtimeConfig.url}/functions/v1/upload-to-r2`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: runtimeConfig.publishableKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            images: [
                {
                    base64: originalBuffer.toString('base64'),
                    filename,
                    isThumb: false
                },
                {
                    base64: thumbBuffer.toString('base64'),
                    filename,
                    isThumb: true
                }
            ]
        })
    });

    const payloadText = await response.text();
    let payload = {};
    try {
        payload = payloadText ? JSON.parse(payloadText) : {};
    } catch (error) {
        payload = { raw: payloadText };
    }

    if (!response.ok) {
        throw new Error(payload?.error || payload?.message || `upload-to-r2 failed: HTTP ${response.status}`);
    }

    const uploadedUrl = Array.isArray(payload.urls) ? payload.urls[0] : '';
    if (!uploadedUrl || !uploadedUrl.startsWith(R2_CDN_PREFIX)) {
        throw new Error('upload-to-r2 returned an unexpected URL payload');
    }

    return uploadedUrl;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const serverEnv = readEnvFile(SERVER_ENV_PATH);

    const supabaseUrl = readFirstEnv([process.env, serverEnv], [
        'SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_URL',
        'PUBLIC_SUPABASE_URL'
    ]);
    const serviceRoleKey = readFirstEnv([process.env, serverEnv], [
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_SERVICE_KEY'
    ]);

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const runtimeConfig = await fetchRuntimeConfig(
        process.env.LOCAL_SUPABASE_RUNTIME_CONFIG_URL || DEFAULT_RUNTIME_CONFIG_URL
    );

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    const { data: prompts, error: promptError } = await adminClient
        .from('prompts')
        .select('id, title, images')
        .order('id', { ascending: true });

    if (promptError) {
        throw new Error(`Failed to fetch prompts: ${promptError.message}`);
    }

    const legacyPromptRows = collectLegacyPromptImages(prompts || []).slice(0, args.limit);

    console.log(`Found ${legacyPromptRows.length} prompts with legacy Supabase prompt-images URLs.`);
    if (!legacyPromptRows.length) {
        return;
    }

    legacyPromptRows.forEach((prompt) => {
        console.log(`- [${prompt.id}] ${prompt.title} (${prompt.legacyImages.length} legacy image${prompt.legacyImages.length === 1 ? '' : 's'})`);
    });

    if (args.dryRun) {
        console.log('\nDry run only. No uploads or database updates were performed.');
        return;
    }

    const session = await createMigrationSession(adminClient, runtimeConfig);
    const stats = {
        promptsUpdated: 0,
        imagesMigrated: 0,
        failed: 0
    };

    try {
        for (const prompt of legacyPromptRows) {
            const nextImages = [...prompt.images];
            let promptChanged = false;

            for (const legacyImage of prompt.legacyImages) {
                const sourceUrl = legacyImage.url;
                const filename = normalizeUploadFilename(sourceUrl);

                try {
                    const sourceBuffer = await downloadImageBuffer(sourceUrl);
                    const [originalWebp, thumbWebp] = await Promise.all([
                        buildOriginalWebp(sourceBuffer),
                        buildThumbnailWebp(sourceBuffer)
                    ]);
                    const uploadedUrl = await uploadPromptImagePair(
                        runtimeConfig,
                        session.accessToken,
                        filename,
                        originalWebp,
                        thumbWebp
                    );

                    nextImages[legacyImage.index] = uploadedUrl;
                    promptChanged = true;
                    stats.imagesMigrated += 1;
                    console.log(`  migrated ${prompt.title} -> ${uploadedUrl}`);
                } catch (error) {
                    stats.failed += 1;
                    console.error(`  failed ${prompt.title} [image ${legacyImage.index + 1}]: ${error.message}`);
                }
            }

            if (!promptChanged) continue;

            const { error: updateError } = await adminClient
                .from('prompts')
                .update({ images: nextImages })
                .eq('id', prompt.id);

            if (updateError) {
                stats.failed += 1;
                console.error(`  failed to update prompt row [${prompt.id}]: ${updateError.message}`);
                continue;
            }

            stats.promptsUpdated += 1;
        }
    } finally {
        await session.cleanup();
    }

    console.log('\nMigration summary:');
    console.log(`- prompts updated: ${stats.promptsUpdated}`);
    console.log(`- images migrated: ${stats.imagesMigrated}`);
    console.log(`- failures: ${stats.failed}`);
}

main().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
});
