#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_PAGE = 'admin-studio.html';
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_VIRTUAL_TIME_BUDGET = 60000;
const ADMIN_SMOKE_MODULE_PROFILES = Object.freeze({
    gallery: { label: 'Gallery', timeoutMs: 150000, virtualTimeBudgetMs: 220000 },
    shop: { label: 'Shop', timeoutMs: 120000, virtualTimeBudgetMs: 180000 },
    payments: { label: 'Payments', timeoutMs: 150000, virtualTimeBudgetMs: 220000 },
    analytics: { label: 'Analytics', timeoutMs: 300000, virtualTimeBudgetMs: 420000 },
    'growth-center': { label: 'Growth Center', timeoutMs: 240000, virtualTimeBudgetMs: 340000 },
    points: { label: 'Points', timeoutMs: 150000, virtualTimeBudgetMs: 220000 },
    homepage: { label: 'Homepage', timeoutMs: 90000, virtualTimeBudgetMs: 120000 },
    comments: { label: 'Comments', timeoutMs: 120000, virtualTimeBudgetMs: 180000 },
    settings: { label: 'Settings', timeoutMs: 180000, virtualTimeBudgetMs: 260000 },
    tickets: { label: 'Tickets', timeoutMs: 120000, virtualTimeBudgetMs: 180000 },
    chat: { label: 'Chat', timeoutMs: 120000, virtualTimeBudgetMs: 180000 }
});
const ADMIN_SMOKE_SUITES = Object.freeze({
    core: ['gallery', 'shop', 'analytics'],
    all: ['homepage', 'gallery', 'comments', 'shop', 'payments', 'points', 'growth-center', 'analytics', 'settings', 'tickets', 'chat']
});
const DEFAULT_CHROME_CANDIDATES = Object.freeze([
    process.env.CHROME_BIN || '',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'chromium-browser',
    'chromium'
].filter(Boolean));

function parseArgs(argv = []) {
    const options = {
        baseUrl: DEFAULT_BASE_URL,
        page: DEFAULT_PAGE,
        module: '',
        suite: '',
        modules: [],
        smokeDom: 'minimal',
        smokeViewport: '',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        virtualTimeBudgetMs: DEFAULT_VIRTUAL_TIME_BUDGET,
        chromePath: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim() || DEFAULT_BASE_URL;
            index += 1;
            continue;
        }
        if (value === '--page') {
            options.page = String(argv[index + 1] || '').trim() || DEFAULT_PAGE;
            index += 1;
            continue;
        }
        if (value === '--module') {
            options.module = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--suite') {
            options.suite = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--modules') {
            options.modules = parseSmokeModuleList(argv[index + 1]);
            index += 1;
            continue;
        }
        if (value === '--smoke-dom') {
            options.smokeDom = String(argv[index + 1] || '').trim() || 'minimal';
            index += 1;
            continue;
        }
        if (value === '--smoke-viewport') {
            options.smokeViewport = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--timeout-ms') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.timeoutMs = parsed;
            }
            index += 1;
            continue;
        }
        if (value === '--virtual-time-budget-ms') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.virtualTimeBudgetMs = parsed;
            }
            index += 1;
            continue;
        }
        if (value === '--chrome-path') {
            options.chromePath = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
    }

    return options;
}

function normalizeSmokeModuleName(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'business-center' || normalized === 'analytics-center' || normalized === 'business-overview' || normalized === 'commerce-center') {
        return 'analytics';
    }
    return normalized;
}

function parseSmokeModuleList(value = '') {
    return String(value || '')
        .split(',')
        .map((item) => normalizeSmokeModuleName(item))
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
}

function resolveSmokeSuiteModules(options = {}) {
    if (String(options.module || '').trim()) {
        return [];
    }

    if (Array.isArray(options.modules) && options.modules.length) {
        return options.modules.map((item) => normalizeSmokeModuleName(item)).filter(Boolean);
    }

    const suiteName = String(options.suite || '').trim().toLowerCase();
    if (!suiteName) {
        return [];
    }

    if (ADMIN_SMOKE_SUITES[suiteName]) {
        return [...ADMIN_SMOKE_SUITES[suiteName]];
    }

    return parseSmokeModuleList(suiteName);
}

function getSmokeModuleProfile(moduleName = '') {
    const normalized = normalizeSmokeModuleName(moduleName);
    return ADMIN_SMOKE_MODULE_PROFILES[normalized] || {
        label: normalized || 'Admin Studio',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        virtualTimeBudgetMs: DEFAULT_VIRTUAL_TIME_BUDGET
    };
}

function buildSmokeModuleOptions(options = {}, moduleName = '') {
    const normalizedModule = normalizeSmokeModuleName(moduleName);
    const profile = getSmokeModuleProfile(normalizedModule);
    return {
        ...options,
        module: normalizedModule,
        suite: '',
        modules: [],
        timeoutMs: Math.max(
            DEFAULT_TIMEOUT_MS,
            Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
            Number(profile.timeoutMs || DEFAULT_TIMEOUT_MS)
        ),
        virtualTimeBudgetMs: Math.max(
            DEFAULT_VIRTUAL_TIME_BUDGET,
            Number(options.virtualTimeBudgetMs || DEFAULT_VIRTUAL_TIME_BUDGET),
            Number(profile.virtualTimeBudgetMs || DEFAULT_VIRTUAL_TIME_BUDGET)
        )
    };
}

function normalizeBaseUrl(value = '') {
    const raw = String(value || '').trim() || DEFAULT_BASE_URL;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return normalized.replace(/\/+$/, '');
}

function buildTargetUrl(options = {}) {
    const pagePath = String(options.page || DEFAULT_PAGE).trim() || DEFAULT_PAGE;
    const url = new URL(pagePath, `${normalizeBaseUrl(options.baseUrl)}/`);
    url.searchParams.set('smoke', '1');
    if (String(options.smokeDom || '').trim()) {
        url.searchParams.set('smokeDom', String(options.smokeDom).trim());
    }
    if (String(options.module || '').trim()) {
        url.searchParams.set('module', String(options.module).trim());
    }
    if (String(options.smokeViewport || '').trim()) {
        url.searchParams.set('smokeViewport', String(options.smokeViewport).trim());
    }
    if (String(options.smokeRunId || '').trim()) {
        url.searchParams.set('smokeRunId', String(options.smokeRunId).trim());
    }
    return url.toString();
}

function buildSmokeResultUrl(options = {}, runId = '') {
    const url = new URL('/__local-smoke-result', `${normalizeBaseUrl(options.baseUrl)}/`);
    url.searchParams.set('runId', String(runId || '').trim());
    return url.toString();
}

function decodeHtml(value = '') {
    return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function extractSmokeResult(text = '') {
    const source = String(text || '');
    const statusMatch = source.match(/data-local-smoke-status="(passed|failed)"/i);
    const panelMatch = source.match(/<pre[^>]+id="(?:localSmokeResult|probeResult)"[^>]*>([\s\S]*?)<\/pre>/i);
    const panelText = panelMatch ? decodeHtml(panelMatch[1]).trim() : '';

    let status = statusMatch ? statusMatch[1].toLowerCase() : '';
    if (!status && /Local Smoke:\s*PASSED/i.test(panelText)) {
        status = 'passed';
    } else if (!status && /Local Smoke:\s*FAILED/i.test(panelText)) {
        status = 'failed';
    }

    if (!status && !panelText) {
        return null;
    }

    return {
        status: status || 'unknown',
        text: panelText
    };
}

function tailLines(value = '', maxLines = 20) {
    return String(value || '')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-Math.max(1, maxLines))
        .join('\n');
}

function delay(ms = 0) {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
}

function createSmokeRunId() {
    if (typeof crypto.randomUUID === 'function') {
        return `local-smoke-${crypto.randomUUID()}`;
    }

    return `local-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveChromePath(preferredPath = '') {
    const candidates = [
        String(preferredPath || '').trim(),
        ...DEFAULT_CHROME_CANDIDATES
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate.includes(path.sep)) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
            continue;
        }

        return candidate;
    }

    throw new Error('Unable to locate a Chrome/Chromium executable. Use --chrome-path or set CHROME_BIN.');
}

function buildChromeArgs(options = {}) {
    const args = [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--metrics-recording-only',
        '--disable-default-apps',
        '--mute-audio',
        `--virtual-time-budget=${Math.max(1000, Number(options.virtualTimeBudgetMs || DEFAULT_VIRTUAL_TIME_BUDGET))}`
    ];

    if (String(options.chromeUserDataDir || '').trim()) {
        args.push(`--user-data-dir=${String(options.chromeUserDataDir).trim()}`);
    }

    args.push(buildTargetUrl(options));
    return args;
}

function createChromeUserDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'admin-smoke-chrome-'));
}

function cleanupChromeUserDataDir(dir = '') {
    const resolved = String(dir || '').trim();
    if (!resolved || !path.resolve(resolved).startsWith(path.resolve(os.tmpdir()))) {
        return;
    }

    try {
        fs.rmSync(resolved, { recursive: true, force: true });
    } catch (_) {
        // ignore cleanup failures; the next smoke run gets an isolated profile
    }
}

function requestJson(urlString = '') {
    const url = new URL(String(urlString || ''));
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const request = transport.request(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json'
            }
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () => {
                if (response.statusCode && response.statusCode >= 400) {
                    reject(new Error(`Smoke result endpoint returned HTTP ${response.statusCode}`));
                    return;
                }

                try {
                    resolve(JSON.parse(body || '{}'));
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on('error', reject);
        request.end();
    });
}

async function pollSmokeResult(resultUrl = '', options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const intervalMs = Math.max(100, Number(options.intervalMs || 500));
    const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    let lastResult = null;

    while (Date.now() <= deadline) {
        if (isCancelled()) {
            const cancelledError = new Error('Smoke result polling cancelled');
            cancelledError.cancelled = true;
            throw cancelledError;
        }

        try {
            const payload = await requestJson(resultUrl);
            const result = payload && typeof payload === 'object' ? payload.result : null;
            if (payload?.found && result) {
                lastResult = result;
                const status = String(result.status || '').toLowerCase();
                if (status === 'passed' || status === 'failed') {
                    return result;
                }
            }
            lastError = null;
        } catch (error) {
            lastError = error;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    const timeoutError = lastError || new Error(`Timed out after ${timeoutMs}ms while waiting for a completed local smoke result`);
    if (lastResult) {
        timeoutError.lastResult = lastResult;
    }
    throw timeoutError;
}

async function runSmoke(options = {}) {
    const chromePath = resolveChromePath(options.chromePath);
    const smokeRunId = createSmokeRunId();
    const chromeUserDataDir = String(options.chromeUserDataDir || '').trim() || createChromeUserDataDir();
    const shouldCleanupChromeUserDataDir = !String(options.chromeUserDataDir || '').trim();
    const targetUrl = buildTargetUrl({
        ...options,
        smokeRunId
    });
    const resultUrl = buildSmokeResultUrl(options, smokeRunId);
    const chromeArgs = buildChromeArgs({
        ...options,
        smokeRunId,
        chromeUserDataDir
    });
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));

    return await new Promise((resolve, reject) => {
        const child = spawn(chromePath, chromeArgs, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        let finished = false;
        let forceKillHandle = null;
        let childClosed = false;
        let expectedClose = false;
        let exitCode = null;
        let exitSignal = null;
        const closeWaiters = [];

        function waitForChildClose(timeoutMsForClose = 3000) {
            if (childClosed) {
                return Promise.resolve();
            }

            return new Promise((resolveClose) => {
                const timer = setTimeout(resolveClose, timeoutMsForClose);
                closeWaiters.push(() => {
                    clearTimeout(timer);
                    resolveClose();
                });
            });
        }

        function cleanupRunResources() {
            if (shouldCleanupChromeUserDataDir) {
                cleanupChromeUserDataDir(chromeUserDataDir);
            }
        }

        function finish(callback, payload) {
            if (finished) return;
            finished = true;
            if (forceKillHandle) clearTimeout(forceKillHandle);
            cleanupRunResources();
            callback(payload);
        }

        function requestShutdown() {
            if (child.killed) {
                return;
            }

            try {
                child.kill('SIGTERM');
            } catch (_) {
                // ignore
            }

            forceKillHandle = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch (_) {
                    // ignore
                }
            }, 1000);
        }

        child.stdout.on('data', () => {});

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            finish(reject, error);
        });

        child.on('close', (code, signal) => {
            childClosed = true;
            exitCode = code;
            exitSignal = signal;
            closeWaiters.splice(0).forEach((resolveClose) => resolveClose());
            if (finished) {
                return;
            }
            if (expectedClose) {
                return;
            }

            (async () => {
                try {
                    const payload = await requestJson(resultUrl);
                    const result = payload && typeof payload === 'object' ? payload.result : null;
                    const status = String(result?.status || '').toLowerCase();

                    if (payload?.found && result && (status === 'passed' || status === 'failed')) {
                        finish(resolve, {
                            chromePath,
                            targetUrl,
                            resultUrl,
                            stderr,
                            result: {
                                status,
                                text: String(result.text || '')
                            },
                            exitCode: code,
                            signal
                        });
                        return;
                    }
                } catch (_) {
                    // fall through to the early-exit error below
                }

                finish(reject, new Error([
                    `Chrome exited before a smoke result was captured (code=${String(code)}, signal=${String(signal)})`,
                    `URL: ${targetUrl}`,
                    `Result endpoint: ${resultUrl}`,
                    stderr ? `stderr tail:\n${tailLines(stderr, 20)}` : ''
                ].filter(Boolean).join('\n\n')));
            })();
        });

        pollSmokeResult(resultUrl, {
            timeoutMs,
            isCancelled: () => finished
        })
            .then(async (result) => {
                expectedClose = true;
                requestShutdown();
                await waitForChildClose(3000);
                finish(resolve, {
                    chromePath,
                    targetUrl,
                    resultUrl,
                    stderr,
                    result: {
                        status: String(result.status || '').toLowerCase(),
                        text: String(result.text || '')
                    },
                    exitCode,
                    signal: exitSignal
                });
            })
            .catch(async (error) => {
                if (error?.cancelled && finished) {
                    return;
                }
                expectedClose = true;
                requestShutdown();
                await waitForChildClose(3000);
                finish(reject, new Error([
                    error?.message || String(error),
                    `URL: ${targetUrl}`,
                    `Result endpoint: ${resultUrl}`,
                    error?.lastResult
                        ? `Last reported status: ${String(error.lastResult.status || 'unknown').toUpperCase()}\n${String(error.lastResult.text || '').trim()}`
                        : '',
                    stderr ? `stderr tail:\n${tailLines(stderr, 20)}` : ''
                ].filter(Boolean).join('\n\n')));
            });
    });
}

function countSmokeChecks(text = '') {
    const lines = String(text || '').split(/\r?\n/);
    return {
        pass: lines.filter((line) => /^PASS\s+/i.test(line)).length,
        fail: lines.filter((line) => /^FAIL\s+/i.test(line)).length
    };
}

function buildSmokeSuiteText(summary = {}) {
    const results = Array.isArray(summary.results) ? summary.results : [];
    const lines = [
        `Admin Local Smoke Suite: ${String(summary.suiteName || 'custom').toUpperCase()}`,
        `Status: ${String(summary.status || 'unknown').toUpperCase()}`,
        `Modules: ${results.map((item) => item.module).filter(Boolean).join(', ') || '<none>'}`,
        `Duration: ${Math.round(Number(summary.durationMs || 0))}ms`,
        ''
    ];

    results.forEach((item) => {
        const status = String(item.status || 'unknown').toUpperCase();
        const checks = item.summary?.result?.text ? countSmokeChecks(item.summary.result.text) : { pass: 0, fail: 0 };
        const profile = getSmokeModuleProfile(item.module);
        lines.push(`${status === 'PASSED' ? 'PASS' : 'FAIL'} ${profile.label} (${item.module})`);
        lines.push(`  duration=${Math.round(Number(item.durationMs || 0))}ms / checks=${checks.pass} pass, ${checks.fail} fail${Number(item.attempts || 1) > 1 ? ` / attempts=${item.attempts}` : ''}`);

        if (status !== 'PASSED') {
            const detail = item.error
                ? String(item.error.message || item.error)
                : String(item.summary?.result?.text || '');
            const trimmedDetail = tailLines(detail, 28);
            if (trimmedDetail) {
                lines.push(trimmedDetail.split(/\r?\n/).map((line) => `  ${line}`).join('\n'));
            }
        }
    });

    return lines.join('\n');
}

async function runSmokeSuite(options = {}, reporter = null) {
    const modules = resolveSmokeSuiteModules(options);
    if (!modules.length) {
        return runSmoke(options);
    }

    const suiteName = String(options.suite || '').trim() || (Array.isArray(options.modules) && options.modules.length ? 'custom' : 'custom');
    const suiteStartedAt = Date.now();
    const results = [];

    for (const moduleName of modules) {
        const runOptions = buildSmokeModuleOptions(options, moduleName);
        const startedAt = Date.now();
        if (typeof reporter === 'function') {
            reporter({
                type: 'module-start',
                module: moduleName,
                timeoutMs: runOptions.timeoutMs,
                virtualTimeBudgetMs: runOptions.virtualTimeBudgetMs
            });
        }

        let outcome = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            if (attempt > 1) {
                if (typeof reporter === 'function') {
                    reporter({ type: 'module-retry', module: moduleName, attempt });
                }
                await delay(2000);
            }

            try {
                const summary = await runSmoke(runOptions);
                const status = String(summary?.result?.status || 'unknown').toLowerCase();
                outcome = {
                    module: moduleName,
                    status,
                    summary,
                    attempts: attempt,
                    durationMs: Date.now() - startedAt
                };
                if (status === 'passed') {
                    break;
                }
            } catch (error) {
                outcome = {
                    module: moduleName,
                    status: 'failed',
                    error,
                    attempts: attempt,
                    durationMs: Date.now() - startedAt
                };
            }

            if (attempt < 2) {
                await delay(1500);
            }
        }

        results.push(outcome);
        if (typeof reporter === 'function') {
            reporter({ type: 'module-end', ...outcome });
        }
        await delay(1200);
    }

    const suiteSummary = {
        suite: true,
        suiteName,
        modules,
        results,
        durationMs: Date.now() - suiteStartedAt,
        status: results.every((item) => item.status === 'passed') ? 'passed' : 'failed'
    };
    suiteSummary.result = {
        status: suiteSummary.status,
        text: buildSmokeSuiteText(suiteSummary)
    };
    return suiteSummary;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const suiteModules = resolveSmokeSuiteModules(options);
    const reporter = suiteModules.length
        ? (event) => {
            if (event.type === 'module-start') {
                process.stdout.write(`[admin-smoke] RUN ${event.module} timeout=${event.timeoutMs}ms virtual=${event.virtualTimeBudgetMs}ms\n`);
            } else if (event.type === 'module-retry') {
                process.stdout.write(`[admin-smoke] RETRY ${event.module} attempt=${event.attempt}\n`);
            } else if (event.type === 'module-end') {
                process.stdout.write(`[admin-smoke] ${String(event.status || 'unknown').toUpperCase()} ${event.module} duration=${Math.round(Number(event.durationMs || 0))}ms\n`);
            }
        }
        : null;
    const summary = await runSmokeSuite(options, reporter);
    const status = summary?.result?.status || 'unknown';
    const text = String(summary?.result?.text || '').trim();

    process.stdout.write([
        summary?.suite ? `Local smoke suite status: ${status.toUpperCase()}` : `Local smoke status: ${status.toUpperCase()}`,
        summary?.targetUrl ? `Target: ${summary.targetUrl}` : '',
        text
    ].filter(Boolean).join('\n') + '\n');

    if (status !== 'passed') {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || String(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildSmokeResultUrl,
    buildChromeArgs,
    buildSmokeModuleOptions,
    buildSmokeSuiteText,
    buildTargetUrl,
    countSmokeChecks,
    createSmokeRunId,
    decodeHtml,
    extractSmokeResult,
    getSmokeModuleProfile,
    normalizeBaseUrl,
    normalizeSmokeModuleName,
    parseArgs,
    parseSmokeModuleList,
    pollSmokeResult,
    requestJson,
    resolveSmokeSuiteModules,
    resolveChromePath,
    runSmoke,
    runSmokeSuite,
    tailLines
};
