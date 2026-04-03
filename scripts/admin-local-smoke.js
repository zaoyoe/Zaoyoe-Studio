#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_PAGE = 'admin-studio.html';
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_VIRTUAL_TIME_BUDGET = 30000;
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
    return [
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
        `--virtual-time-budget=${Math.max(1000, Number(options.virtualTimeBudgetMs || DEFAULT_VIRTUAL_TIME_BUDGET))}`,
        buildTargetUrl(options)
    ];
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
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    let lastResult = null;

    while (Date.now() <= deadline) {
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
    const targetUrl = buildTargetUrl({
        ...options,
        smokeRunId
    });
    const resultUrl = buildSmokeResultUrl(options, smokeRunId);
    const chromeArgs = buildChromeArgs({
        ...options,
        smokeRunId
    });
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));

    return await new Promise((resolve, reject) => {
        const child = spawn(chromePath, chromeArgs, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        let finished = false;
        let forceKillHandle = null;

        function finish(callback, payload) {
            if (finished) return;
            finished = true;
            if (forceKillHandle) clearTimeout(forceKillHandle);
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
            if (finished) {
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

        pollSmokeResult(resultUrl, { timeoutMs })
            .then((result) => {
                requestShutdown();
                finish(resolve, {
                    chromePath,
                    targetUrl,
                    resultUrl,
                    stderr,
                    result: {
                        status: String(result.status || '').toLowerCase(),
                        text: String(result.text || '')
                    }
                });
            })
            .catch((error) => {
                requestShutdown();
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

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const summary = await runSmoke(options);
    const status = summary?.result?.status || 'unknown';
    const text = String(summary?.result?.text || '').trim();

    process.stdout.write([
        `Local smoke status: ${status.toUpperCase()}`,
        `Target: ${summary.targetUrl}`,
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
    buildTargetUrl,
    createSmokeRunId,
    decodeHtml,
    extractSmokeResult,
    normalizeBaseUrl,
    parseArgs,
    pollSmokeResult,
    requestJson,
    resolveChromePath,
    runSmoke,
    tailLines
};
