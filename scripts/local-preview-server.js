#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');

const { buildSupabaseRuntimeScript } = require('../api/_lib/public-runtime-config');

const DEFAULT_SMOKE_RESULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LOCAL_PREVIEW_BODY_LIMIT = '25mb';
const LOCAL_PREVIEW_NO_STORE_EXTENSIONS = new Set([
    '.html',
    '.js',
    '.mjs',
    '.css',
    '.json'
]);

function setLocalPreviewNoStoreHeaders(res) {
    if (!res || typeof res.setHeader !== 'function') {
        return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

function shouldDisableLocalPreviewCache(filePath = '') {
    const extension = path.extname(String(filePath || '')).trim().toLowerCase();
    return LOCAL_PREVIEW_NO_STORE_EXTENSIONS.has(extension);
}

function getDefaultEnvFiles(repoRoot) {
    return [
        path.join(repoRoot, 'server/.env.staging'),
        path.join(repoRoot, 'server/.env'),
        path.join(repoRoot, '.env'),
        path.join(repoRoot, '.env.local')
    ];
}

function loadPreviewEnv(envFiles, baseEnv = process.env) {
    const merged = {};

    envFiles.forEach((filePath) => {
        if (!fs.existsSync(filePath)) {
            return;
        }

        const parsed = dotenv.parse(fs.readFileSync(filePath, 'utf8'));
        Object.assign(merged, parsed);
    });

    return {
        ...merged,
        ...baseEnv
    };
}

function resolveLocalPreviewRuntimeScript(envFiles, baseEnv = process.env) {
    try {
        return buildSupabaseRuntimeScript(loadPreviewEnv(envFiles, baseEnv));
    } catch (error) {
        const message = JSON.stringify(error.message || 'Failed to resolve local preview runtime config');
        return [
            '(function (global) {',
            `  console.error('Local preview runtime config error:', ${message});`,
            '  global.__ZAOYOE_SUPABASE_CONFIG__ = null;',
            '}(typeof window !== "undefined" ? window : globalThis));'
        ].join('\n');
    }
}

function buildLocalPreviewAdminHandlerUrl(rawUrl = '/api/admin') {
    const incomingUrl = new URL(String(rawUrl || '/api/admin'), 'http://127.0.0.1:8000');
    const queryRoute = String(incomingUrl.searchParams.get('route') || '').trim();
    const routePath = incomingUrl.pathname
        .replace(/^\/api\/admin\/?/, '')
        .replace(/^\/+|\/+$/g, '');
    const handlerUrl = new URL('/api/admin', incomingUrl.origin);

    if (queryRoute) {
        handlerUrl.searchParams.set('route', queryRoute);
    } else if (routePath) {
        handlerUrl.searchParams.set('route', routePath);
    }

    incomingUrl.searchParams.forEach((value, key) => {
        if (key === 'route' && (queryRoute || routePath)) {
            return;
        }
        handlerUrl.searchParams.append(key, value);
    });

    return `${handlerUrl.pathname}${handlerUrl.search}`;
}

function buildLocalPreviewPublicHandlerUrl(rawUrl = '/api/public') {
    const incomingUrl = new URL(String(rawUrl || '/api/public'), 'http://127.0.0.1:8000');
    const queryScope = String(incomingUrl.searchParams.get('scope') || '').trim();
    const queryRoute = String(incomingUrl.searchParams.get('route') || '').trim();
    const pathSegments = incomingUrl.pathname
        .replace(/^\/api\/public\/?/, '')
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);
    const handlerUrl = new URL('/api/public', incomingUrl.origin);

    const scope = queryScope || pathSegments[0] || '';
    const route = queryRoute || pathSegments.slice(1).join('/');

    if (scope) {
        handlerUrl.searchParams.set('scope', scope);
    }
    if (route) {
        handlerUrl.searchParams.set('route', route);
    }

    incomingUrl.searchParams.forEach((value, key) => {
        if ((key === 'scope' && scope) || (key === 'route' && route)) {
            return;
        }
        handlerUrl.searchParams.append(key, value);
    });

    return `${handlerUrl.pathname}${handlerUrl.search}`;
}

function normalizeRequireCachePath(targetPath = '') {
    const normalizedTargetPath = String(targetPath || '').trim();
    if (!normalizedTargetPath) {
        return '';
    }

    try {
        if (typeof fs.realpathSync.native === 'function') {
            return fs.realpathSync.native(normalizedTargetPath);
        }
        return fs.realpathSync(normalizedTargetPath);
    } catch (_) {
        return path.resolve(normalizedTargetPath);
    }
}

function clearRequireCacheByPrefixes(prefixes = []) {
    const normalizedPrefixes = (Array.isArray(prefixes) ? prefixes : [])
        .map((prefix) => normalizeRequireCachePath(prefix))
        .filter(Boolean)
        .map((prefix) => prefix.endsWith(path.sep) ? prefix : `${prefix}${path.sep}`);

    if (!normalizedPrefixes.length) {
        return;
    }

    Object.keys(require.cache).forEach((moduleId) => {
        const resolvedId = normalizeRequireCachePath(moduleId);
        if (normalizedPrefixes.some((prefix) => resolvedId === prefix.slice(0, -1) || resolvedId.startsWith(prefix))) {
            delete require.cache[moduleId];
        }
    });
}

function loadFreshAdminApiHandler(repoRoot = path.resolve(__dirname, '..')) {
    const normalizedRepoRoot = path.resolve(repoRoot);
    clearRequireCacheByPrefixes([
        path.join(normalizedRepoRoot, 'api'),
        path.join(normalizedRepoRoot, 'server', 'api-handlers', 'admin')
    ]);
    return require(path.join(normalizedRepoRoot, 'api', 'admin'));
}

function loadFreshPublicApiHandler(repoRoot = path.resolve(__dirname, '..')) {
    const normalizedRepoRoot = path.resolve(repoRoot);
    clearRequireCacheByPrefixes([
        path.join(normalizedRepoRoot, 'api'),
        path.join(normalizedRepoRoot, 'server', 'api-handlers', 'public')
    ]);
    return require(path.join(normalizedRepoRoot, 'api', 'public'));
}

function applyPreviewEnvToProcess(envValues = {}) {
    Object.entries(envValues).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }

        if (!process.env[key]) {
            process.env[key] = String(value);
        }
    });
}

function resolveLocalPreviewListenHost(value = process.env.LOCAL_PREVIEW_HOST || process.env.HOST) {
    const normalized = String(value || '').trim();
    return normalized || undefined;
}

function createSmokeResultStore(options = {}) {
    const ttlMs = Math.max(1000, Number(options.ttlMs || DEFAULT_SMOKE_RESULT_TTL_MS));
    const records = new Map();

    function cleanup(now = Date.now()) {
        for (const [runId, record] of records.entries()) {
            const ageMs = now - Number(record?.updatedAt || record?.createdAt || 0);
            if (!Number.isFinite(ageMs) || ageMs < ttlMs) {
                continue;
            }
            records.delete(runId);
        }
    }

    return {
        get(runId = '') {
            cleanup();
            const normalizedRunId = String(runId || '').trim();
            if (!normalizedRunId) {
                return null;
            }
            return records.get(normalizedRunId) || null;
        },
        set(runId = '', payload = {}) {
            cleanup();
            const normalizedRunId = String(runId || '').trim();
            if (!normalizedRunId) {
                return null;
            }

            const now = Date.now();
            const nextRecord = {
                runId: normalizedRunId,
                status: String(payload.status || '').trim() || 'unknown',
                page: String(payload.page || '').trim() || '/',
                text: String(payload.text || ''),
                results: Array.isArray(payload.results) ? payload.results : [],
                createdAt: Number(records.get(normalizedRunId)?.createdAt || now),
                updatedAt: now
            };

            records.set(normalizedRunId, nextRecord);
            return nextRecord;
        }
    };
}

function createLocalPreviewApp(options = {}) {
    const app = express();
    const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..'));
    const port = Math.max(1, Number(options.port || process.env.PORT || 8000));
    const envFiles = options.envFiles || getDefaultEnvFiles(repoRoot);
    const baseEnv = options.baseEnv || process.env;
    const previewEnv = loadPreviewEnv(envFiles, baseEnv);
    const smokeResultStore = options.smokeResultStore || createSmokeResultStore();

    applyPreviewEnvToProcess(previewEnv);

    app.set('etag', false);

    app.use(express.json({ limit: DEFAULT_LOCAL_PREVIEW_BODY_LIMIT }));
    app.use(express.urlencoded({
        extended: false,
        limit: DEFAULT_LOCAL_PREVIEW_BODY_LIMIT
    }));

    app.get('/healthz', (req, res) => {
        res.json({
            status: 'ok',
            service: 'local-preview-server',
            port
        });
    });

    app.get('/api/runtime/supabase-config', (req, res) => {
        const script = resolveLocalPreviewRuntimeScript(envFiles, baseEnv);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        setLocalPreviewNoStoreHeaders(res);
        res.status(200).send(script);
    });

    app.get('/__local-smoke-result', (req, res) => {
        const runId = String(req.query.runId || '').trim();
        if (!runId) {
            res.status(400).json({
                ok: false,
                error: 'runId is required'
            });
            return;
        }

        const record = smokeResultStore.get(runId);
        setLocalPreviewNoStoreHeaders(res);
        res.status(200).json({
            ok: true,
            found: Boolean(record),
            result: record
        });
    });

    app.post('/__local-smoke-result', (req, res) => {
        const runId = String(req.body?.runId || req.query.runId || '').trim();
        if (!runId) {
            res.status(400).json({
                ok: false,
                error: 'runId is required'
            });
            return;
        }

        const record = smokeResultStore.set(runId, req.body || {});
        setLocalPreviewNoStoreHeaders(res);
        res.status(200).json({
            ok: true,
            result: record
        });
    });

    app.all('/api/admin', async (req, res) => {
        req.url = buildLocalPreviewAdminHandlerUrl(req.originalUrl || req.url);
        const adminApiHandler = loadFreshAdminApiHandler(repoRoot);
        return adminApiHandler(req, res);
    });

    app.all('/api/admin/*', async (req, res) => {
        req.url = buildLocalPreviewAdminHandlerUrl(req.originalUrl || req.url);
        const adminApiHandler = loadFreshAdminApiHandler(repoRoot);
        return adminApiHandler(req, res);
    });

    app.all('/api/public', async (req, res) => {
        req.url = buildLocalPreviewPublicHandlerUrl(req.originalUrl || req.url);
        const publicApiHandler = loadFreshPublicApiHandler(repoRoot);
        return publicApiHandler(req, res);
    });

    app.all('/api/public/*', async (req, res) => {
        req.url = buildLocalPreviewPublicHandlerUrl(req.originalUrl || req.url);
        const publicApiHandler = loadFreshPublicApiHandler(repoRoot);
        return publicApiHandler(req, res);
    });

    app.use(express.static(repoRoot, {
        extensions: ['html'],
        etag: false,
        lastModified: false,
        cacheControl: false,
        setHeaders: (res, filePath) => {
            if (shouldDisableLocalPreviewCache(filePath)) {
                setLocalPreviewNoStoreHeaders(res);
            }
        }
    }));

    app.get('/', (req, res) => {
        setLocalPreviewNoStoreHeaders(res);
        res.sendFile(path.join(repoRoot, 'index.html'));
    });

    return {
        app,
        port
    };
}

if (require.main === module) {
    const { app, port } = createLocalPreviewApp();
    const listenHost = resolveLocalPreviewListenHost();
    const onListening = () => {
        if (listenHost) {
            console.log(`[local-preview] http://${listenHost}:${port}`);
            return;
        }

        console.log(`[local-preview] http://localhost:${port}`);
        console.log(`[local-preview] http://127.0.0.1:${port}`);
    };

    if (listenHost) {
        app.listen(port, listenHost, onListening);
    } else {
        app.listen(port, onListening);
    }
}

module.exports = {
    applyPreviewEnvToProcess,
    buildLocalPreviewAdminHandlerUrl,
    buildLocalPreviewPublicHandlerUrl,
    clearRequireCacheByPrefixes,
    createSmokeResultStore,
    createLocalPreviewApp,
    DEFAULT_LOCAL_PREVIEW_BODY_LIMIT,
    getDefaultEnvFiles,
    loadFreshAdminApiHandler,
    loadFreshPublicApiHandler,
    loadPreviewEnv,
    resolveLocalPreviewListenHost,
    resolveLocalPreviewRuntimeScript,
    setLocalPreviewNoStoreHeaders,
    shouldDisableLocalPreviewCache
};
