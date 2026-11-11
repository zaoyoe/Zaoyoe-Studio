#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createClient } = require('@supabase/supabase-js');

const ENVELOPE_PREFIX = 'zaoyoe-r2-backup:v1:';
const CORE_BACKUP_TABLES = Object.freeze([
    'system_config',
    'shop_products',
    'shop_product_skus',
    'shop_inventory',
    'shop_cdk_secrets',
    'shop_orders',
    'shop_order_items',
    'guest_shop_orders',
    'guest_shop_checkout_batches',
    'guest_shop_checkout_items',
    'guest_shop_inventory_reservations',
    'payment_orders',
    'points_balance',
    'points_ledger',
    'redemption_batches',
    'redemption_codes'
]);

function resolveEncryptionKey(rawKey) {
    const trimmed = String(rawKey || '').trim();
    if (!trimmed) {
        throw new Error('Missing OFFSITE_BACKUP_ENCRYPTION_KEY');
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, 'hex');
    }
    const base64Bytes = Buffer.from(trimmed, 'base64');
    if (base64Bytes.length === 32) {
        return base64Bytes;
    }
    if (trimmed.length >= 32) {
        return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
    }
    throw new Error('OFFSITE_BACKUP_ENCRYPTION_KEY must be at least 32 characters or 32 bytes (hex/base64)');
}

function sealBackupPayload(payloadObject, rawKey, keyId = 'primary') {
    const key = resolveEncryptionKey(rawKey);
    const normalizedKeyId = String(keyId || 'primary').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'primary';
    const jsonBuffer = Buffer.from(JSON.stringify(payloadObject), 'utf8');
    const compressed = zlib.gzipSync(jsonBuffer, { level: 9 });
    const iv = crypto.randomBytes(12);
    const aad = Buffer.from(`${ENVELOPE_PREFIX}${normalizedKeyId}`, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENVELOPE_PREFIX}${normalizedKeyId}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function openBackupPayload(envelopeText, rawKey) {
    const text = String(envelopeText || '').trim();
    if (!text.startsWith(ENVELOPE_PREFIX)) {
        throw new Error('Invalid backup envelope prefix');
    }
    const parts = text.split(':');
    if (parts.length !== 6) {
        throw new Error('Invalid backup envelope format');
    }
    const [, , keyId, ivB64, tagB64, ciphertextB64] = parts;
    const key = resolveEncryptionKey(rawKey);
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`${ENVELOPE_PREFIX}${keyId}`, 'utf8'));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const jsonBuffer = zlib.gunzipSync(compressed);
    return JSON.parse(jsonBuffer.toString('utf8'));
}

function hmacSha256(key, data) {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function buildS3SignedPutRequest({
    endpoint,
    bucket,
    objectKey,
    body,
    accessKeyId,
    secretAccessKey,
    region = 'auto',
    now = new Date()
}) {
    const baseUrl = new URL(String(endpoint || '').trim());
    const cleanBucket = String(bucket || '').trim().replace(/^\/+|\/+$/g, '');
    const cleanKey = String(objectKey || '').trim().replace(/^\/+/, '');
    if (!cleanBucket || !cleanKey || !accessKeyId || !secretAccessKey) {
        throw new Error('Missing R2/S3 endpoint, bucket, objectKey, or credentials');
    }

    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
    const payloadHash = sha256Hex(bodyBuffer);
    const isoBasic = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = isoBasic.slice(0, 8);
    const canonicalUri = `/${[cleanBucket, ...cleanKey.split('/')].map((seg) => encodeURIComponent(seg)).join('/')}`;
    const host = baseUrl.host;

    const canonicalHeaders = [
        `host:${host}`,
        `x-amz-content-sha256:${payloadHash}`,
        `x-amz-date:${isoBasic}`
    ].join('\n') + '\n';
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
        'PUT',
        canonicalUri,
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        isoBasic,
        credentialScope,
        sha256Hex(canonicalRequest)
    ].join('\n');

    const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const targetUrl = new URL(canonicalUri, `${baseUrl.protocol}//${baseUrl.host}`).toString();

    return {
        url: targetUrl,
        method: 'PUT',
        headers: {
            Host: host,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(bodyBuffer.length),
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': isoBasic,
            Authorization: authorization
        },
        body: bodyBuffer,
        sha256: payloadHash
    };
}

async function fetchTableRowsPaged(supabase, table, pageSize = 1000, maxPages = 100) {
    const rows = [];
    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await supabase.from(table).select('*').range(from, to);
        if (error) {
            if (error.code === 'PGRST205' || /schema cache|relation.*does not exist|Could not find the table/i.test(error.message)) {
                return [];
            }
            throw new Error(`Failed to export table ${table}: ${error.message}`);
        }
        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < pageSize) {
            break;
        }
    }
    return rows;
}

async function runOffsiteBackup({ env = process.env, fetchImpl = globalThis.fetch, dryRun = false } = {}) {
    const supabaseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for off-site backup');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const snapshotAt = new Date();
    const tables = {};
    const counts = {};

    for (const table of CORE_BACKUP_TABLES) {
        const rows = await fetchTableRowsPaged(supabase, table);
        tables[table] = rows;
        counts[table] = rows.length;
    }

    const envelope = sealBackupPayload(
        {
            version: 1,
            created_at: snapshotAt.toISOString(),
            counts,
            tables
        },
        env.OFFSITE_BACKUP_ENCRYPTION_KEY,
        env.OFFSITE_BACKUP_KEY_ID || 'primary'
    );

    const objectKey = `snapshots/${snapshotAt.toISOString().slice(0, 10)}/zaoyoe-backup-${snapshotAt.toISOString().replace(/[:.]/g, '-')}.enc`;

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            objectKey,
            counts,
            encryptedBytes: Buffer.byteLength(envelope, 'utf8')
        };
    }

    const signed = buildS3SignedPutRequest({
        endpoint: env.OFFSITE_BACKUP_R2_ENDPOINT,
        bucket: env.OFFSITE_BACKUP_R2_BUCKET,
        objectKey,
        body: envelope,
        accessKeyId: env.OFFSITE_BACKUP_R2_ACCESS_KEY_ID,
        secretAccessKey: env.OFFSITE_BACKUP_R2_SECRET_ACCESS_KEY,
        region: env.OFFSITE_BACKUP_R2_REGION || 'auto',
        now: snapshotAt
    });

    const response = await fetchImpl(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: signed.body
    });

    if (!response.ok) {
        throw new Error(`Off-site R2 upload failed with HTTP ${response.status}`);
    }

    return {
        ok: true,
        dryRun: false,
        objectKey,
        counts,
        sha256: signed.sha256,
        encryptedBytes: signed.body.length
    };
}

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    runOffsiteBackup({ dryRun })
        .then((result) => {
            console.log(JSON.stringify(result));
        })
        .catch((error) => {
            console.error(JSON.stringify({ ok: false, error: error.message }));
            process.exit(1);
        });
}

module.exports = {
    CORE_BACKUP_TABLES,
    ENVELOPE_PREFIX,
    buildS3SignedPutRequest,
    openBackupPayload,
    resolveEncryptionKey,
    runOffsiteBackup,
    sealBackupPayload
};
