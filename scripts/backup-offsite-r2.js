#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const zlib = require('node:zlib');

const execFileAsync = promisify(execFile);

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

const DEFAULT_SERVICE_CONFIG_PATHS = Object.freeze([
    { id: 'verify_env', service: 'verify', filename: 'verify.env', filePath: '/opt/zaoyoe-verify-server/.env' },
    { id: 'verify_compose', service: 'verify', filename: 'verify.docker-compose.yml', filePath: '/opt/zaoyoe-verify-server/docker-compose.yml' },
    { id: 'newapi_env', service: 'newapi', filename: 'newapi.env', filePath: '/opt/sub2api/.env' },
    { id: 'newapi_compose', service: 'newapi', filename: 'newapi.docker-compose.yml', filePath: '/opt/sub2api/docker-compose.yml' },
    { id: 'kc_env', service: 'kc', filename: 'kc.env', filePath: '/opt/kc-pay-gpt/.env' },
    { id: 'kc_compose', service: 'kc', filename: 'kc.docker-compose.yml', filePath: '/opt/kc-pay-gpt/docker-compose.yml' }
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

function parseEnvText(content) {
    const parsed = {};
    for (const rawLine of String(content || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const exportLine = line.startsWith('export ') ? line.slice(7).trim() : line;
        const eqIdx = exportLine.indexOf('=');
        if (eqIdx <= 0) {
            continue;
        }
        const key = exportLine.slice(0, eqIdx).trim();
        let value = exportLine.slice(eqIdx + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
            || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        ) {
            value = value.slice(1, -1);
        }
        if (key) {
            parsed[key] = value;
        }
    }
    return parsed;
}

function readOptionalEnvFile(filePath, fsImpl = fs) {
    if (!filePath || !fsImpl.existsSync(filePath)) {
        return {};
    }
    return parseEnvText(fsImpl.readFileSync(filePath, 'utf8'));
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

function buildS3SignedRequest({
    method = 'PUT',
    endpoint,
    bucket,
    objectKey,
    body = Buffer.alloc(0),
    accessKeyId,
    secretAccessKey,
    region = 'auto',
    now = new Date()
}) {
    const normalizedMethod = String(method || 'PUT').trim().toUpperCase();
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
        normalizedMethod,
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

    const headers = {
        Host: host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': isoBasic,
        Authorization: authorization
    };
    if (normalizedMethod === 'PUT') {
        headers['Content-Type'] = 'application/octet-stream';
        headers['Content-Length'] = String(bodyBuffer.length);
    }

    return {
        url: targetUrl,
        method: normalizedMethod,
        headers,
        body: normalizedMethod === 'GET' ? undefined : bodyBuffer,
        sha256: payloadHash
    };
}

function buildS3SignedPutRequest(options = {}) {
    return buildS3SignedRequest({ ...options, method: 'PUT' });
}

function buildS3SignedGetRequest(options = {}) {
    return buildS3SignedRequest({ ...options, method: 'GET', body: Buffer.alloc(0) });
}

function createZeroDepSupabaseClient(supabaseUrl, serviceRoleKey, fetchImpl = globalThis.fetch) {
    const cleanUrl = String(supabaseUrl || '').replace(/\/+$/, '');
    return {
        from(table) {
            return {
                select(columns = '*') {
                    return {
                        async range(from, to) {
                            const url = `${cleanUrl}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(columns)}`;
                            const response = await fetchImpl(url, {
                                method: 'GET',
                                headers: {
                                    apikey: serviceRoleKey,
                                    Authorization: `Bearer ${serviceRoleKey}`,
                                    Accept: 'application/json',
                                    'Range-Unit': 'items',
                                    Range: `${from}-${to}`
                                }
                            });
                            const text = await response.text();
                            let parsed;
                            try {
                                parsed = text ? JSON.parse(text) : null;
                            } catch (_) {
                                parsed = null;
                            }
                            if (!response.ok) {
                                return {
                                    data: null,
                                    error: {
                                        code: parsed?.code || String(response.status),
                                        message: parsed?.message || `HTTP ${response.status}`
                                    }
                                };
                            }
                            return { data: Array.isArray(parsed) ? parsed : [], error: null };
                        }
                    };
                }
            };
        }
    };
}

function resolveSupabaseClient(supabaseUrl, serviceRoleKey, fetchImpl = globalThis.fetch) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        return createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
    } catch (error) {
        if (error?.code === 'MODULE_NOT_FOUND') {
            return createZeroDepSupabaseClient(supabaseUrl, serviceRoleKey, fetchImpl);
        }
        throw error;
    }
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

async function defaultRunCommand(command, args = [], options = {}) {
    return execFileAsync(command, args, {
        encoding: options.encoding || 'buffer',
        maxBuffer: options.maxBuffer || 128 * 1024 * 1024,
        env: { ...process.env, ...(options.env || {}) }
    });
}

async function resolveContainerName(candidates = [], runCommand = defaultRunCommand) {
    const list = candidates.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (list.length === 0) {
        return '';
    }
    const { stdout } = await runCommand('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    const running = new Set(String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    for (const candidate of list) {
        if (running.has(candidate)) {
            return candidate;
        }
    }
    return '';
}

async function dumpNewApiPostgres({
    env = process.env,
    fsImpl = fs,
    runCommand = defaultRunCommand,
    envFilePath
} = {}) {
    const resolvedEnvPath = envFilePath || String(env.NEWAPI_ENV_FILE || '/opt/sub2api/.env').trim();
    const slotEnv = readOptionalEnvFile(resolvedEnvPath, fsImpl);
    const pgUser = String(env.NEWAPI_POSTGRES_USER || slotEnv.POSTGRES_USER || 'sub2api').trim();
    const pgPassword = String(env.NEWAPI_POSTGRES_PASSWORD || slotEnv.POSTGRES_PASSWORD || '').trim();
    const pgDb = String(env.NEWAPI_DB_NAME || slotEnv.NEWAPI_DB_NAME || slotEnv.POSTGRES_DB || 'newapi').trim();
    const preferred = String(env.NEWAPI_POSTGRES_CONTAINER || '').trim();
    const container = await resolveContainerName(
        [preferred, 'sub2api-postgres', 'newapi-postgres'],
        runCommand
    );
    if (!container) {
        throw new Error('NewAPI PostgreSQL container not running');
    }
    if (!pgPassword) {
        throw new Error('Missing NewAPI POSTGRES_PASSWORD for pg_dump');
    }

    const { stdout } = await runCommand(
        'docker',
        ['exec', '-e', `PGPASSWORD=${pgPassword}`, container, 'pg_dump', '-U', pgUser, '-Fc', pgDb],
        { encoding: 'buffer' }
    );
    const dumpBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
    if (dumpBuffer.length === 0) {
        throw new Error(`NewAPI pg_dump returned empty output for database ${pgDb}`);
    }

    return {
        engine: 'postgres',
        format: 'pg_dump_custom',
        container,
        database: pgDb,
        bytes: dumpBuffer.length,
        sha256: sha256Hex(dumpBuffer),
        data_base64: dumpBuffer.toString('base64')
    };
}

async function dumpKcMysql({
    env = process.env,
    fsImpl = fs,
    runCommand = defaultRunCommand,
    envFilePath
} = {}) {
    const resolvedEnvPath = envFilePath || String(env.KC_ENV_FILE || '/opt/kc-pay-gpt/.env').trim();
    const slotEnv = readOptionalEnvFile(resolvedEnvPath, fsImpl);
    const dbUser = String(env.KC_DB_USER || slotEnv.DB_USER || 'root').trim();
    const dbPassword = String(
        env.KC_DB_PASSWORD
        || slotEnv.DB_PASSWORD
        || slotEnv.MYSQL_ROOT_PASSWORD
        || ''
    ).trim();
    const dbName = String(env.KC_DB_NAME || slotEnv.DB_NAME || slotEnv.MYSQL_DATABASE || 'plus_papay').trim();
    const preferred = String(env.KC_MYSQL_CONTAINER || '').trim();
    const container = await resolveContainerName(
        [preferred, 'kc-pay-gpt-mysql', 'kc-gpt-pay2-mysql'],
        runCommand
    );
    if (!container) {
        throw new Error('KC-PAY-GPT MySQL container not running');
    }
    if (!dbPassword) {
        throw new Error('Missing KC-PAY-GPT MySQL password for mysqldump');
    }

    const { stdout } = await runCommand(
        'docker',
        [
            'exec',
            '-e',
            `MYSQL_PWD=${dbPassword}`,
            container,
            'mysqldump',
            '--single-transaction',
            '--routines',
            '--triggers',
            '--quick',
            '-u',
            dbUser,
            dbName
        ],
        { encoding: 'buffer' }
    );
    const sqlBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
    if (sqlBuffer.length === 0) {
        throw new Error(`KC-PAY-GPT mysqldump returned empty output for database ${dbName}`);
    }
    const gzipped = zlib.gzipSync(sqlBuffer, { level: 9 });

    return {
        engine: 'mysql',
        format: 'mysqldump_sql_gzip',
        container,
        database: dbName,
        sql_bytes: sqlBuffer.length,
        compressed_bytes: gzipped.length,
        sha256: sha256Hex(sqlBuffer),
        data_base64: gzipped.toString('base64')
    };
}

function collectServiceConfigs({
    configSpecs = DEFAULT_SERVICE_CONFIG_PATHS,
    fsImpl = fs,
    requireAll = false
} = {}) {
    const collected = [];
    for (const spec of configSpecs) {
        const filePath = String(spec?.filePath || '').trim();
        if (!filePath || !fsImpl.existsSync(filePath)) {
            if (requireAll) {
                throw new Error(`Required service config missing: ${filePath}`);
            }
            continue;
        }
        const contentBuffer = fsImpl.readFileSync(filePath);
        collected.push({
            id: String(spec.id || '').trim(),
            service: String(spec.service || '').trim(),
            filename: String(spec.filename || path.basename(filePath)).trim(),
            source_path: filePath,
            bytes: contentBuffer.length,
            sha256: sha256Hex(contentBuffer),
            data_base64: contentBuffer.toString('base64')
        });
    }
    return collected;
}

async function collectFullStackArtifacts({
    env = process.env,
    fsImpl = fs,
    runCommand = defaultRunCommand,
    serviceConfigSpecs = DEFAULT_SERVICE_CONFIG_PATHS,
    newapiEnvPath,
    kcEnvPath,
    requireServiceConfigs = false
} = {}) {
    const newapiPostgres = await dumpNewApiPostgres({
        env,
        fsImpl,
        runCommand,
        envFilePath: newapiEnvPath
    });
    const kcMysql = await dumpKcMysql({
        env,
        fsImpl,
        runCommand,
        envFilePath: kcEnvPath
    });
    const serviceConfigs = collectServiceConfigs({
        configSpecs: serviceConfigSpecs,
        fsImpl,
        requireAll: requireServiceConfigs
    });

    return {
        newapi_postgres: newapiPostgres,
        kc_mysql: kcMysql,
        service_configs: serviceConfigs
    };
}

function safeSandboxFileName(rawName, fallback) {
    const base = path.basename(String(rawName || fallback || 'artifact')).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!base || base === '.' || base === '..') {
        throw new Error(`Unsafe sandbox filename: ${rawName}`);
    }
    return base;
}

function extractBackupArchiveToSandbox(envelopeText, rawKey, outputDir, { fsImpl = fs } = {}) {
    if (!outputDir) {
        throw new Error('outputDir is required for sandbox restore extraction');
    }

    const payload = openBackupPayload(envelopeText, rawKey);
    const resolvedOutputDir = path.resolve(outputDir);
    fsImpl.mkdirSync(resolvedOutputDir, { recursive: true, mode: 0o700 });

    const tablesDir = path.join(resolvedOutputDir, 'supabase-tables');
    fsImpl.mkdirSync(tablesDir, { recursive: true, mode: 0o700 });

    const tables = payload?.tables && typeof payload.tables === 'object' ? payload.tables : {};
    const tableSummary = {};
    for (const [tableName, rows] of Object.entries(tables)) {
        const safeName = safeSandboxFileName(`${tableName}.json`, 'table.json');
        const list = Array.isArray(rows) ? rows : [];
        tableSummary[tableName] = list.length;
        fsImpl.writeFileSync(path.join(tablesDir, safeName), JSON.stringify(list, null, 2), { mode: 0o600 });
    }

    const restoredArtifacts = {
        newapi_postgres: null,
        kc_mysql: null,
        service_configs: []
    };

    const artifacts = payload?.artifacts && typeof payload.artifacts === 'object' ? payload.artifacts : {};

    if (artifacts.newapi_postgres?.data_base64) {
        const pgBuffer = Buffer.from(artifacts.newapi_postgres.data_base64, 'base64');
        const actualSha = sha256Hex(pgBuffer);
        if (actualSha !== artifacts.newapi_postgres.sha256) {
            throw new Error('SHA-256 verification failed for newapi_postgres dump');
        }
        const newapiDir = path.join(resolvedOutputDir, 'newapi');
        fsImpl.mkdirSync(newapiDir, { recursive: true, mode: 0o700 });
        const outPath = path.join(newapiDir, 'newapi.dump');
        fsImpl.writeFileSync(outPath, pgBuffer, { mode: 0o600 });
        restoredArtifacts.newapi_postgres = {
            database: artifacts.newapi_postgres.database,
            bytes: pgBuffer.length,
            sha256: actualSha,
            path: outPath
        };
    }

    if (artifacts.kc_mysql?.data_base64) {
        const compressed = Buffer.from(artifacts.kc_mysql.data_base64, 'base64');
        const sqlBuffer = zlib.gunzipSync(compressed);
        const actualSha = sha256Hex(sqlBuffer);
        if (actualSha !== artifacts.kc_mysql.sha256) {
            throw new Error('SHA-256 verification failed for kc_mysql dump');
        }
        const kcDir = path.join(resolvedOutputDir, 'kc');
        fsImpl.mkdirSync(kcDir, { recursive: true, mode: 0o700 });
        const outPath = path.join(kcDir, 'kc-mysql.sql');
        fsImpl.writeFileSync(outPath, sqlBuffer, { mode: 0o600 });
        restoredArtifacts.kc_mysql = {
            database: artifacts.kc_mysql.database,
            sql_bytes: sqlBuffer.length,
            sha256: actualSha,
            path: outPath
        };
    }

    if (Array.isArray(artifacts.service_configs)) {
        const configsDir = path.join(resolvedOutputDir, 'configs');
        fsImpl.mkdirSync(configsDir, { recursive: true, mode: 0o700 });
        for (const entry of artifacts.service_configs) {
            const rawBuffer = Buffer.from(String(entry?.data_base64 || ''), 'base64');
            const actualSha = sha256Hex(rawBuffer);
            if (actualSha !== entry?.sha256) {
                throw new Error(`SHA-256 verification failed for service config: ${entry?.id || entry?.filename}`);
            }
            const safeFile = safeSandboxFileName(entry?.filename, entry?.id || 'config');
            const outPath = path.join(configsDir, safeFile);
            fsImpl.writeFileSync(outPath, rawBuffer, { mode: 0o600 });
            restoredArtifacts.service_configs.push({
                id: entry?.id || '',
                service: entry?.service || '',
                bytes: rawBuffer.length,
                sha256: actualSha,
                path: outPath
            });
        }
    }

    return {
        ok: true,
        version: payload?.version || 1,
        created_at: payload?.created_at || null,
        tableCounts: tableSummary,
        artifacts: restoredArtifacts
    };
}

function shouldIncludeFullStack(env = process.env, explicitOption) {
    if (explicitOption !== undefined) {
        return Boolean(explicitOption);
    }
    const raw = String(env.OFFSITE_BACKUP_INCLUDE_STACK || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

async function runOffsiteBackup({
    env = process.env,
    fetchImpl = globalThis.fetch,
    dryRun = false,
    includeStack,
    supabaseClient = null,
    fsImpl = fs,
    runCommand = defaultRunCommand,
    serviceConfigSpecs = DEFAULT_SERVICE_CONFIG_PATHS,
    newapiEnvPath,
    kcEnvPath,
    requireServiceConfigs = false
} = {}) {
    const supabaseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseClient && (!supabaseUrl || !serviceRoleKey)) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for off-site backup');
    }

    const supabase = supabaseClient || resolveSupabaseClient(supabaseUrl, serviceRoleKey, fetchImpl);
    const snapshotAt = new Date();
    const tables = {};
    const counts = {};

    const skipSet = new Set(
        String(env.OFFSITE_BACKUP_SKIP_TABLES || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
    );
    const pageSize = Math.max(100, Math.min(5000, Number(env.OFFSITE_BACKUP_PAGE_SIZE) || 1000));

    for (const table of CORE_BACKUP_TABLES) {
        if (skipSet.has(table)) {
            counts[table] = 0;
            continue;
        }
        const rows = await fetchTableRowsPaged(supabase, table, pageSize);
        tables[table] = rows;
        counts[table] = rows.length;
    }

    const withStack = shouldIncludeFullStack(env, includeStack);
    let artifacts = null;
    if (withStack) {
        artifacts = await collectFullStackArtifacts({
            env,
            fsImpl,
            runCommand,
            serviceConfigSpecs,
            newapiEnvPath,
            kcEnvPath,
            requireServiceConfigs
        });
    }

    const payload = {
        version: withStack ? 2 : 1,
        created_at: snapshotAt.toISOString(),
        counts,
        tables,
        ...(artifacts ? { artifacts } : {})
    };

    const envelope = sealBackupPayload(
        payload,
        env.OFFSITE_BACKUP_ENCRYPTION_KEY,
        env.OFFSITE_BACKUP_KEY_ID || 'primary'
    );

    const objectKey = `snapshots/${snapshotAt.toISOString().slice(0, 10)}/zaoyoe-backup-${snapshotAt.toISOString().replace(/[:.]/g, '-')}.enc`;
    const artifactSummary = artifacts
        ? {
            newapi_postgres_bytes: artifacts.newapi_postgres?.bytes || 0,
            kc_mysql_sql_bytes: artifacts.kc_mysql?.sql_bytes || 0,
            service_config_count: Array.isArray(artifacts.service_configs) ? artifacts.service_configs.length : 0
        }
        : null;

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            includeStack: withStack,
            objectKey,
            counts,
            artifactSummary,
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
        includeStack: withStack,
        objectKey,
        counts,
        artifactSummary,
        sha256: signed.sha256,
        encryptedBytes: signed.body.length
    };
}

function parseCliArgs(argv = []) {
    const flags = {
        dryRun: argv.includes('--dry-run'),
        includeStack: argv.includes('--include-stack') || argv.includes('--full') ? true : undefined,
        supabaseOnly: argv.includes('--supabase-only'),
        restoreEnvelope: '',
        restoreR2Key: '',
        sandboxDir: ''
    };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--verify-envelope' && argv[i + 1]) {
            flags.restoreEnvelope = argv[i + 1];
            i += 1;
        } else if (argv[i] === '--verify-r2-key' && argv[i + 1]) {
            flags.restoreR2Key = argv[i + 1];
            i += 1;
        } else if (argv[i] === '--sandbox-dir' && argv[i + 1]) {
            flags.sandboxDir = argv[i + 1];
            i += 1;
        }
    }
    if (flags.supabaseOnly) {
        flags.includeStack = false;
    }
    return flags;
}

async function runRestoreVerificationCli(flags, env = process.env) {
    let envelopeText = '';
    if (flags.restoreEnvelope) {
        envelopeText = fs.readFileSync(flags.restoreEnvelope, 'utf8');
    } else if (flags.restoreR2Key) {
        const signed = buildS3SignedGetRequest({
            endpoint: env.OFFSITE_BACKUP_R2_ENDPOINT,
            bucket: env.OFFSITE_BACKUP_R2_BUCKET,
            objectKey: flags.restoreR2Key,
            accessKeyId: env.OFFSITE_BACKUP_R2_ACCESS_KEY_ID,
            secretAccessKey: env.OFFSITE_BACKUP_R2_SECRET_ACCESS_KEY,
            region: env.OFFSITE_BACKUP_R2_REGION || 'auto'
        });
        const response = await fetch(signed.url, { method: 'GET', headers: signed.headers });
        if (!response.ok) {
            throw new Error(`Off-site R2 fetch failed with HTTP ${response.status}`);
        }
        envelopeText = await response.text();
    }

    const outDir = flags.sandboxDir || fs.mkdtempSync('/tmp/zaoyoe-backup-drill-');
    const summary = extractBackupArchiveToSandbox(envelopeText, env.OFFSITE_BACKUP_ENCRYPTION_KEY, outDir);
    return { ...summary, sandboxDir: outDir };
}

if (require.main === module) {
    const flags = parseCliArgs(process.argv.slice(2));
    const action = (flags.restoreEnvelope || flags.restoreR2Key)
        ? runRestoreVerificationCli(flags)
        : runOffsiteBackup({
            dryRun: flags.dryRun,
            includeStack: flags.includeStack
        });

    action
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
    DEFAULT_SERVICE_CONFIG_PATHS,
    ENVELOPE_PREFIX,
    buildS3SignedGetRequest,
    buildS3SignedPutRequest,
    collectFullStackArtifacts,
    collectServiceConfigs,
    dumpKcMysql,
    dumpNewApiPostgres,
    extractBackupArchiveToSandbox,
    openBackupPayload,
    parseEnvText,
    resolveEncryptionKey,
    runOffsiteBackup,
    sealBackupPayload
};
