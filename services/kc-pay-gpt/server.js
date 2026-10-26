const express = require('express');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const axios = require('axios');
const store = require('./mysql-store');
const runtimeLog = require('./runtime-log');
const { REGION_CONFIG, isSupportedRegion, getRegionConfig, getPlatformForPlan, getPlanTypeLabel } = require('./region-config');
const taxFreeAddress = require('./tax-free-address');
const { extractClaudeSessionKey, isValidClaudeSessionKey, fetchClaudeAccount } = require('./claude-auth');
const { extractGrokCredential, isValidGrokCredential, grokSessionCookieHeader, parseOfficialGrokSession } = require('./grok-auth');
const { testProxyUrl, normalizeProxyLines } = require('./proxy-pool');
const { extractSessionPreview, extractAccessTokenFromRaw, parseSessionJson, extractEmailFromSession } = require('./session-auth');
const { notifyTelegramEvent, notifyAdminSecurityEvent, sendTelegramLoginCode, sendTelegramTest, isCardPoolExhaustedIssue } = require('./telegram-notify');
const adminAuth = require('./admin-auth');
const { buildAdminLoginUrl, buildAdminPanelUrl } = require('./admin-paths');
const { buildHcaptchaEnvFromConfig } = require('./hcaptcha-runtime');
const { checkHcaptchaSolverHealth, testVlmConnectivity, listSolverLogFiles, readSolverLogTail } = require('./hcaptcha-solver');
const { testCaptchaPlatformConnectivity, normalizeCaptchaPlatformApiUrl, resolveCaptchaPlatformCredentials } = require('./captcha-platform');
const browserPool = require('./browser-pool');
const { buildWorkerRuntimeEnv } = require('./browser-runtime');
const { querySubscriptionBySession, validateSessionTokenForQuery, cancelAutoRenew, resumeAutoRenew } = require('./subscription-check');
const gptApi = require('./gpt-api-client');
const { validateOutsourceConfig, canonicalizeOutsourcePlan } = require('./gpt-outsourcing');
const { createGptOutsourcingService } = require('./gpt-outsourcing-worker');
const { createGptOutsourcingAdmin } = require('./gpt-outsourcing-admin');
const { redactSensitiveText } = require('./session-security');
const { formatTaskErrorMessage, publicTaskUpdate } = require('./public/task-messages');
const { resolveActivationInput, buildActivationCredentialEnv } = require('./activation-routing');
const { reportTaskFailure } = require('./task-diagnostics');
const { validateCdkPlan } = require('./cdk-plan-catalog');
const { parseCardImportText } = require('./card-parser');
const { resolveDiagnosticInput, getDiagnosticCatalog, parseDiagnosticOutput, buildDiagnosticRuntimeEnv } = require('./checkout-diagnostic');
const { EXECUTION_MODE: CHECKOUT_DIAGNOSTIC_MODE, diagnosticError, throwIfDiagnosticAborted,
    waitForDiagnosticAbort, redactDiagnosticLogs, sanitizeDiagnosticReport, appendDiagnosticReport,
    pendingDiagnosticReport, diagnosticProgress, finishDiagnosticReport, createCheckoutDebugManager } = require('./checkout-debug-manager');
const { classifyInterruptedTask, classifyAutoRenewCancellation, normalizePaymentState, mergePaymentState,
    shouldRetainCdk, classifyChatGptAuthFailure, classifyAccountAlreadySubscribed, classifyChatGptNavigationFailure, classifyCheckoutFailure, classifyProxyPreflightFailure,
    classifyClaudeNavigationFailure, classifyClaudeCheckoutReadinessFailure, classifyGrokFailure,
    classifyOpenAiCardMethodFailure, finalizeRetryAnalysis } = require('./task-safety');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BIND_HOST = String(process.env.KC_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
const LOCAL_PREVIEW_ENABLED = process.env.KC_LOCAL_PREVIEW === '1';
const ADMIN_TOKEN_TTL_MS = adminAuth.ADMIN_TOKEN_TTL_MS;
const ADMIN_REFRESH_AFTER_MS = adminAuth.ADMIN_REFRESH_AFTER_MS;
const PROCESS_IDLE_TIMEOUT_MS = Number(process.env.PROCESS_IDLE_TIMEOUT_MS) || (3 * 60 * 1000);
const PROCESS_TOTAL_TIMEOUT_MS = Number(process.env.PROCESS_TOTAL_TIMEOUT_MS) || (15 * 60 * 1000);
const STALE_TASK_RECOVERY_MS = Number(process.env.STALE_TASK_RECOVERY_MS) || Math.max(PROCESS_TOTAL_TIMEOUT_MS, 15 * 60 * 1000);
const MAX_PROCESS_ATTEMPTS = Number(process.env.MAX_PROCESS_ATTEMPTS) || 2;
const WS_HEARTBEAT_PING_TYPE = 'ping';
const WS_HEARTBEAT_PONG_TYPE = 'pong';
const ACCESS_DEACTIVATED_MESSAGES_URL = '';
const ACCESS_DEACTIVATED_SYNC_KEY = '';
const ACCESS_DEACTIVATED_SYNC_COOLDOWN_MS = 30 * 1000;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || adminAuth.resolveAdminTokenSecret();

function resolveLocalPreviewInfo() {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const git = (args) => execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    try {
        const status = git(['status', '--porcelain', '--untracked-files=normal']);
        return {
            service: 'kc-pay-gpt',
            sourceCommit: git(['rev-parse', 'HEAD']),
            sourceBranch: git(['branch', '--show-current']) || 'detached',
            sourceMode: 'working-tree',
            workingTreeDirty: Boolean(status),
            changedFileCount: status ? status.split('\n').length : 0,
            backend: 'enabled',
            payments: 'live-capable'
        };
    } catch (_) {
        return {
            service: 'kc-pay-gpt',
            sourceCommit: 'unknown',
            sourceMode: 'working-tree',
            workingTreeDirty: null,
            changedFileCount: null,
            backend: 'enabled',
            payments: 'live-capable'
        };
    }
}

const LOCAL_PREVIEW_INFO = LOCAL_PREVIEW_ENABLED ? resolveLocalPreviewInfo() : null;

// 追踪活跃的子进程，防止产生僵尸进程
const activeProcesses = new Set();
function cleanupProcesses() {
    if (activeProcesses.size > 0) {
        console.log(`清理 ${activeProcesses.size} 个活跃子进程...`);
        for (const child of activeProcesses) {
            try { child.kill('SIGKILL'); } catch (e) { }
        }
        activeProcesses.clear();
    }
    browserPool.shutdownBrowserPool().catch((error) => {
        console.warn(`[BrowserPool] 关闭失败: ${error.message}`);
    });
}

// WebSocket 客户端映射: jobKey -> Set<WebSocket>
const taskClients = new Map();
const TERMINAL_TASK_STATUSES = new Set(['success', 'failed', 'manual', 'maintenance', 'cancelled']);
const activeForegroundJobs = new Set();
const checkoutDebugManager = createCheckoutDebugManager();
const gptOutsourcing = createGptOutsourcingService({
    store,
    client: gptApi,
    onUpdate: (jobKey, update) => broadcastToTask(jobKey, { type: update.status === 'running' ? 'progress' : 'status', jobKey, ...update }),
    onLog: (jobKey, message, level = 'warn') => logTask(jobKey, message, level),
    onOutcome: (jobKey, status, message) => notifyTaskOutcome({ event: status === 'success' ? 'success' : 'failure', jobKey, message })
});

let systemMetricsCache = {
    ts: 0,
    data: null,
    promise: null
};

function reserveForegroundSlot(slotKey) {
    activeForegroundJobs.add(String(slotKey));
}

function releaseForegroundSlot(slotKey) {
    activeForegroundJobs.delete(String(slotKey));
}

function getTotalActiveJobs() {
    return activeForegroundJobs.size;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSystemMetrics() {
    const now = Date.now();
    if (systemMetricsCache.data && now - systemMetricsCache.ts < 3000) {
        return systemMetricsCache.data;
    }
    if (systemMetricsCache.promise) {
        return systemMetricsCache.promise;
    }

    systemMetricsCache.promise = (async () => {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const cpuCount = Math.max(1, (os.cpus() || []).length);
        const load = Number(os.loadavg()[0] || 0);
        const cpuPercent = Math.min(100, Math.round((load / cpuCount) * 100));

        let disk = {
            percent: 0,
            usedText: '0.0G',
            totalText: '0.0G',
            drive: '/'
        };
        try {
            const dfOut = execFileSync('df', ['-kP', '/'], { encoding: 'utf8' });
            const lines = dfOut.trim().split('\n');
            if (lines.length >= 2) {
                const parts = lines[1].trim().split(/\s+/);
                const total = Number(parts[1] || 0) * 1024;
                const used = Number(parts[2] || 0) * 1024;
                disk = {
                    percent: total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
                    usedText: `${(used / (1024 ** 3)).toFixed(1)}G`,
                    totalText: `${(total / (1024 ** 3)).toFixed(1)}G`,
                    drive: parts[5] || '/'
                };
            }
        } catch (_) { /* ignore */ }

        const data = {
            cpu: {
                percent: cpuPercent,
                text: `负载 ${load.toFixed(2)} / ${cpuCount} 核`
            },
            memory: {
                percent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
                text: `${(usedMem / (1024 ** 3)).toFixed(1)}G/${(totalMem / (1024 ** 3)).toFixed(1)}G`
            },
            disk,
            uptime: { seconds: Math.floor(os.uptime()) }
        };
        systemMetricsCache.data = data;
        systemMetricsCache.ts = Date.now();
        systemMetricsCache.promise = null;
        return data;
    })().catch((error) => {
        systemMetricsCache.promise = null;
        throw error;
    });

    return systemMetricsCache.promise;
}

function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
    const rawIp = forwarded ? forwarded.split(',')[0].trim() : (req.ip || req.socket?.remoteAddress || '');
    return String(rawIp || '')
        .replace(/^::ffff:/, '')
        .replace(/^::1$/, '127.0.0.1')
        .trim();
}

function getRemainingCooldownMinutes(cooldownUntil) {
    if (!cooldownUntil) {
        return 0;
    }
    const cooldownDate = new Date(cooldownUntil);
    if (!(cooldownDate instanceof Date) || Number.isNaN(cooldownDate.getTime()) || cooldownDate <= new Date()) {
        return 0;
    }
    return Math.ceil((cooldownDate - new Date()) / 60000);
}

function isNoActivationEligibilityMessage(message) {
    return String(message || '').includes('无激活权限');
}

function parseFlexibleTimestamp(value) {
    if (value == null || value === '') {
        return null;
    }

    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1e12) {
            return Math.trunc(value);
        }
        if (value > 1e9) {
            return Math.trunc(value * 1000);
        }
        return null;
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }

    if (/^\d{13}$/.test(normalized)) {
        return Number(normalized);
    }
    if (/^\d{10}$/.test(normalized)) {
        return Number(normalized) * 1000;
    }

    const candidate = normalized.includes('T')
        ? normalized
        : normalized.replace(' ', 'T');
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) {
        return parsed;
    }

    return null;
}


function broadcastToTask(jobKey, data) {
    const clients = taskClients.get(jobKey);
    if (clients) {
        const message = JSON.stringify(publicTaskUpdate(data));
        for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}

// In-memory state for interactive human verification (透传给前端让充值用户点击)
const interactiveCaptchaMap = new Map();

function getOrCreateCaptchaState(jobKey) {
    if (!interactiveCaptchaMap.has(jobKey)) {
        interactiveCaptchaMap.set(jobKey, {
            jobKey,
            image: null,
            width: 1280,
            height: 800,
            title: '请协助完成人机验证',
            message: '请点击下方画面中的验证区域',
            promptZh: '',
            promptEn: '',
            updatedAt: Date.now(),
            active: false,
            frameSeq: 0,
            pendingClicks: [],
            waitingRequests: []
        });
    }
    return interactiveCaptchaMap.get(jobKey);
}

function notifyCaptchaClick(jobKey, options = {}) {
    if (!jobKey || !interactiveCaptchaMap.has(jobKey)) return false;
    const state = interactiveCaptchaMap.get(jobKey);
    if (!state || !state.active || (state.expiresAt && Date.now() >= state.expiresAt)) return false;
    if (!state.pendingClicks) state.pendingClicks = [];

    const { ratioX, ratioY, clientX, clientY, frameSeq, points, submitPoint, action } = options;
    if (state.contentReady === false && action !== 'refresh') return false;

    // 版本/帧对齐：若携带了 frameSeq 且与当前活跃画面序号不匹配，说明是上一旧画面的过时点击，直接丢弃
    if (frameSeq && state.frameSeq && Number(frameSeq) !== Number(state.frameSeq)) {
        console.log(`[Captcha] 丢弃已失效旧画面(frameSeq=${frameSeq}, 当前=${state.frameSeq})的迟到点击`);
        return false;
    }

    // 防抖：仅在单点普通点击时检查
    const now = Date.now();
    if (!points && state.lastClick && (now - state.lastClick.ts < 300)) {
        const dx = Math.abs(Number(ratioX) - Number(state.lastClick.ratioX));
        const dy = Math.abs(Number(ratioY) - Number(state.lastClick.ratioY));
        if (dx < 0.04 && dy < 0.04) {
            return true;
        }
    }
    state.lastClick = { ratioX: Number(ratioX || 0), ratioY: Number(ratioY || 0), ts: now };

    const clickData = {
        success: true,
        clicked: true,
        action: action || 'click',
        ratioX: Number(ratioX || 0),
        ratioY: Number(ratioY || 0),
        clientX: clientX ? Number(clientX) : undefined,
        clientY: clientY ? Number(clientY) : undefined,
        points: Array.isArray(points) ? points : undefined,
        submitPoint: submitPoint || undefined,
        frameSeq: state.frameSeq || 0
    };

    if (state.waitingRequests && state.waitingRequests.length > 0) {
        const { res, timer } = state.waitingRequests.shift();
        clearTimeout(timer);
        try {
            if (!res.headersSent) {
                res.json(clickData);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    // 交互锁与防积压：若当前 Playwright 暂时还在模拟上一动作或等待下一轮，
    // 最多只保留最新 1 次点击，绝对不积压多个点击导致在新画面里“连点乱点”
    state.pendingClicks = [clickData];
    return true;
}

function notifyCaptchaDrag(jobKey, dragOptions = {}) {
    if (!jobKey || !interactiveCaptchaMap.has(jobKey)) return false;
    const state = interactiveCaptchaMap.get(jobKey);
    if (!state || !state.active || state.contentReady === false || (state.expiresAt && Date.now() >= state.expiresAt)) return false;
    if (!state.pendingClicks) state.pendingClicks = [];

    // 版本/帧对齐：若携带了 frameSeq 且与当前活跃画面序号不匹配，丢弃失效旧画面的拖拽
    if (dragOptions.frameSeq && state.frameSeq && Number(dragOptions.frameSeq) !== Number(state.frameSeq)) {
        console.log(`[Captcha] 丢弃已失效旧画面(frameSeq=${dragOptions.frameSeq}, 当前=${state.frameSeq})的迟到拖拽`);
        return false;
    }

    const fX = Number(dragOptions.fromRatioX ?? dragOptions.startRatioX ?? 0);
    const fY = Number(dragOptions.fromRatioY ?? dragOptions.startRatioY ?? 0);
    const tX = Number(dragOptions.toRatioX ?? dragOptions.endRatioX ?? 0);
    const tY = Number(dragOptions.toRatioY ?? dragOptions.endRatioY ?? 0);

    const dragData = {
        success: true,
        clicked: true,
        action: 'drag',
        fromRatioX: fX,
        fromRatioY: fY,
        toRatioX: tX,
        toRatioY: tY,
        startRatioX: fX,
        startRatioY: fY,
        endRatioX: tX,
        endRatioY: tY,
        frameSeq: Number(dragOptions.frameSeq || state.frameSeq || 0)
    };

    if (state.waitingRequests && state.waitingRequests.length > 0) {
        const { res, timer } = state.waitingRequests.shift();
        clearTimeout(timer);
        try {
            if (!res.headersSent) {
                res.json(dragData);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    state.pendingClicks = [dragData];
    return true;
}

function unsubscribeTaskClient(jobKey, ws) {
    if (!jobKey || !taskClients.has(jobKey)) {
        return;
    }
    const clients = taskClients.get(jobKey);
    clients.delete(ws);
    if (clients.size === 0) {
        taskClients.delete(jobKey);
    }
}

async function sendTaskSnapshot(ws, jobKey) {
    const task = await store.getTaskStatus(jobKey);
    if (!task || ws.readyState !== WebSocket.OPEN) {
        return;
    }

    let storedMedia = { screenshots: [], videos: [] };
    if (task.failure_screenshots) {
        try {
            const parsed = JSON.parse(task.failure_screenshots);
            storedMedia = splitTaskMediaPaths(Array.isArray(parsed) ? parsed : []);
        } catch (_) { /* ignore */ }
    }
    const media = extractTaskMediaFromOutput(task.raw_output || '');

    ws.send(JSON.stringify(publicTaskUpdate({
        type: 'snapshot',
        jobKey,
        status: task.status,
        message: task.message,
        progress: Number(task.progress || 0),
        paymentState: task.payment_state || 'not_started',
        recoveryRequired: Boolean(task.recovery_required),
        cdkCode: task.cdk_code || null,
        phone: task.phone || null,
        cardLast4: task.card_last4 || null,
        screenshots: [...new Set([...storedMedia.screenshots, ...media.screenshots])],
        videos: [...new Set([...storedMedia.videos, ...media.videos])],
        isTerminal: TERMINAL_TASK_STATUSES.has(task.status)
    })));
}

function logTask(jobKey, message, level = 'log') {
    runtimeLog.push({
        jobKey,
        level,
        source: 'task',
        text: redactSensitiveText(message)
    });
    const logger = console[level] || console.log;
    logger(`[Task ${jobKey}] ${redactSensitiveText(message)}`);
}

function logTaskChunk(jobKey, attempt, source, chunk) {
    const text = String(chunk || '');
    if (!text) {
        return;
    }

    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }
        const safeLine = redactSensitiveText(line);
        runtimeLog.push({
            jobKey,
            level: safeLine.includes('CAPTCHA_LOG:') || safeLine.includes('[Captcha/')
                ? 'captcha'
                : (source === 'stderr' ? 'stderr' : 'stdout'),
            source: safeLine.includes('CAPTCHA_LOG:') || safeLine.includes('[Captcha/')
                ? 'captcha'
                : `spawn/a${attempt}/${source}`,
            text: safeLine.replace(/^CAPTCHA_LOG:\s*/, '')
        });
        console.log(`[Task ${jobKey}][Attempt ${attempt}][${source}] ${safeLine}`);
    }
}

process.on('SIGINT', () => { cleanupProcesses(); process.exit(0); });
process.on('SIGTERM', () => { cleanupProcesses(); process.exit(0); });
process.on('exit', () => cleanupProcesses());

let storeReadyPromise = null;

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '15mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.get('/__preview', (req, res) => {
    if (!LOCAL_PREVIEW_INFO) {
        return res.status(404).type('text/plain').send('Not Found');
    }
    res.set('Cache-Control', 'no-store');
    return res.json(LOCAL_PREVIEW_INFO);
});

let cachedAdminPaths = null;

async function getCachedAdminPaths() {
    if (cachedAdminPaths) {
        return cachedAdminPaths;
    }
    await ensureStoreReady();
    cachedAdminPaths = await store.getAdminPaths();
    return cachedAdminPaths;
}

function invalidateAdminPathsCache() {
    cachedAdminPaths = null;
}

function normalizeRequestPathname(pathname) {
    return String(pathname || '/').replace(/\/+$/, '') || '/';
}

async function attachAdminPaths(payload) {
    const paths = await getCachedAdminPaths();
    return {
        ...payload,
        loginPath: buildAdminLoginUrl(paths),
        panelPath: buildAdminPanelUrl(paths)
    };
}

app.use((req, res, next) => {
    if (req.method === 'GET' && ['/admin.html', '/admin-login.html'].includes(req.path)) {
        return res.status(404).type('text/plain').send('Not Found');
    }
    next();
});

app.use(async (req, res, next) => {
    if (req.method !== 'GET') {
        return next();
    }
    try {
        const paths = await getCachedAdminPaths();
        const current = normalizeRequestPathname(req.path);
        const loginUrl = normalizeRequestPathname(buildAdminLoginUrl(paths));
        const panelUrl = normalizeRequestPathname(buildAdminPanelUrl(paths));
        if (current === loginUrl) {
            return res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
        }
        if (current === panelUrl) {
            return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
        }
    } catch (_) {
        // DB 尚未就绪时交给后续路由处理
    }
    return next();
});

app.use(express.static(path.join(__dirname, 'public')));

function ensureStoreReady() {
    if (!storeReadyPromise) {
        storeReadyPromise = store.ensureReady().catch((error) => {
            storeReadyPromise = null;
            throw error;
        });
    }
    return storeReadyPromise;
}

function decodeJwtPart(part) {
    const normalized = String(part || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function normalizeSessionToken(raw) {
    return extractAccessTokenFromRaw(raw);
}

function normalizeSessionRaw(raw) {
    const content = String(raw || '').trim();
    if (!content.startsWith('{')) {
        return '';
    }
    try {
        const data = JSON.parse(content);
        if (data?.accessToken || data?.access_token || data?.user) {
            return content;
        }
    } catch (_) {
        return '';
    }
    return '';
}

function buildStoredSessionPayload(rawSession, sessionJson, token) {
    if (sessionJson) {
        return normalizeSessionRaw(rawSession) || JSON.stringify(sessionJson);
    }
    if (rawSession.startsWith('{')) {
        return rawSession;
    }
    if (token) {
        return JSON.stringify({
            accessToken: token,
            user: null
        });
    }
    return rawSession;
}

function validateAccessToken(token) {
    const value = String(token || '').trim();
    if (!value) {
        return { valid: false, message: '缺少 AccessToken' };
    }

    const parts = value.split('.');
    if (parts.length !== 3 || parts.some((item) => !item)) {
        return { valid: false, message: '该 Token 不合法：格式错误' };
    }

    let header;
    let payload;
    try {
        header = decodeJwtPart(parts[0]);
        payload = decodeJwtPart(parts[1]);
    } catch (_) {
        return { valid: false, message: '该 Token 不合法：无法解析' };
    }

    if (header.typ !== 'JWT') {
        return { valid: false, message: '该 Token 不合法：类型错误' };
    }

    if (header.alg !== 'RS256') {
        return { valid: false, message: '该 Token 不合法：算法错误' };
    }

    if (payload.iss !== 'https://auth.openai.com') {
        return { valid: false, message: '该 Token 不合法：签发方错误' };
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    if (!audiences.includes('https://api.openai.com/v1')) {
        return { valid: false, message: '该 Token 不合法：aud 不匹配' };
    }

    const authInfo = payload['https://api.openai.com/auth'];
    if (!authInfo || !authInfo.chatgpt_account_id || !authInfo.chatgpt_user_id) {
        return { valid: false, message: '该 Token 不合法：缺少账户信息' };
    }

    const scopes = Array.isArray(payload.scp) ? payload.scp : [];
    if (!scopes.includes('model.request')) {
        return { valid: false, message: '该 Token 不合法：缺少 model.request 权限' };
    }

    const exp = Number(payload.exp || 0);
    const now = Math.floor(Date.now() / 1000);
    if (!exp || !Number.isFinite(exp)) {
        return { valid: false, message: '该 Token 不合法：缺少过期时间' };
    }
    if (exp <= now) {
        return { valid: false, message: '该 Token 已过期' };
    }

    return { valid: true };
}

const verifyPassword = adminAuth.verifyPassword;
const issueAdminToken = adminAuth.issueAdminToken;
const verifyAdminToken = adminAuth.verifyAdminToken;
const requireSecondaryAuth = adminAuth.createRequireSecondaryAuth(store, ensureStoreReady);

async function logAdminSecurityEvent(event, meta = {}) {
    try {
        await ensureStoreReady();
        await store.insertAdminLoginLog({
            event,
            adminEmail: meta.email || '',
            ip: meta.ip || '',
            userAgent: meta.userAgent || '',
            fingerprint: meta.fingerprint || '',
            detail: meta.detail || ''
        });
    } catch (error) {
        console.warn(`[AdminAuth] 登录日志写入失败: ${error.message}`);
    }
}

async function fireAdminSecurityNotification(event, payload = {}) {
    notifyAdminSecurityEvent(store, event, payload).catch((error) => {
        console.warn(`[AdminAuth] Telegram 通知失败: ${error.message}`);
    });
}

function getBearerToken(req) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) {
        return token.trim();
    }
    return (req.query?.token || '').trim() || null;
}

async function authenticateAdmin(req, res, next) {
    const token = getBearerToken(req);
    const payload = verifyAdminToken(token);
    if (!payload) {
        res.setHeader('X-Admin-Auth-Error', 'unauthorized');
        return res.status(401).json({ success: false, message: '未授权，请重新登录', authError: true });
    }

    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        if (Number(payload.pv || 0) !== authConfig.passwordVersion) {
            res.setHeader('X-Admin-Auth-Error', 'password_version_mismatch');
            return res.status(401).json({ success: false, message: '登录状态已失效，请重新登录', authError: true });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }

    req.admin = payload;
    req.adminToken = token;
    return next();
}

const CDK_PREFIX = 'KC-';
const CDK_RANDOM_LENGTH = 15; // KC- + 15 = 18 位
const CDK_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆 0/O/1/I/L

function randomCdkSuffix(length = CDK_RANDOM_LENGTH) {
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += CDK_CHARSET[bytes[i] % CDK_CHARSET.length];
    }
    return out;
}

function createCdks(count) {
    const results = new Set();
    const target = Math.max(1, Math.min(Number(count) || 1, 100));

    while (results.size < target) {
        results.add(`${CDK_PREFIX}${randomCdkSuffix()}`);
    }

    return [...results];
}

function extractScreenshotsFromOutput(output) {
    const paths = new Set();
    const text = String(output || '');
    const patterns = [
        /FAILURE_SCREENSHOT:\s*([^\s\n]+\.png)/g,
        /SUCCESS_SCREENSHOT:\s*([^\s\n]+\.png)/g,
        /LIVE_SCREENSHOT:\s*([^\s\n]+\.png)/g,
        /截图已保存:\s*([^\s\n]+\.png)/g
    ];
    for (const pattern of patterns) {
        let match = pattern.exec(text);
        while (match) {
            paths.add(match[1]);
            match = pattern.exec(text);
        }
    }
    return normalizeMediaPaths([...paths]);
}

function extractVideosFromOutput(output) {
    const paths = new Set();
    const text = String(output || '');
    const pattern = /VIDEO_FILE:\s*([^\s\n]+\.webm)/g;
    let match = pattern.exec(text);
    while (match) {
        paths.add(match[1]);
        match = pattern.exec(text);
    }
    return normalizeMediaPaths([...paths]);
}

function normalizeMediaPaths(paths) {
    return paths.map((filePath) => {
        const normalized = String(filePath).replace(/\\/g, '/');
        const marker = 'debug_screenshots/';
        const idx = normalized.indexOf(marker);
        if (idx >= 0) {
            return normalized.slice(idx + marker.length);
        }
        return path.basename(normalized);
    });
}

function extractTaskMediaFromOutput(output) {
    return {
        screenshots: extractScreenshotsFromOutput(output),
        videos: extractVideosFromOutput(output)
    };
}

function splitTaskMediaPaths(items) {
    const list = Array.isArray(items) ? items : [];
    const screenshots = [];
    const videos = [];
    for (const item of list) {
        const rel = String(item || '').replace(/\\/g, '/');
        if (!rel) continue;
        if (/\.webm$/i.test(rel)) {
            videos.push(rel);
        } else {
            screenshots.push(rel);
        }
    }
    return { screenshots, videos };
}

function extractCheckoutUrlFromOutput(output) {
    const match = String(output || '').match(/CHECKOUT_URL:\s*(https?\S+)/);
    return match ? match[1].trim() : '';
}

function extractAutoRenewResultFromOutput(output) {
    const lines = String(output || '').split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line.startsWith('AUTO_RENEW_RESULT:')) continue;
        const rawJson = line.slice('AUTO_RENEW_RESULT:'.length).trim();
        try {
            const parsed = JSON.parse(rawJson);
            if (parsed && typeof parsed === 'object') {
                return {
                    ok: Boolean(parsed.ok),
                    data: parsed,
                    error: parsed.error || ''
                };
            }
        } catch (_) { /* ignore malformed line */ }
    }
    return null;
}

function analyzeCheckoutDebugOutput(output, timedOut) {
    const normalized = String(output || '');
    const runtimeError = extractRuntimeErrorMessage(normalized);

    if (normalized.includes('CHECKOUT_DEBUG_SUCCESS')) {
        const checkoutUrl = extractCheckoutUrlFromOutput(normalized);
        return {
            status: 'success',
            message: checkoutUrl ? `支付链接已生成: ${checkoutUrl}` : '支付链接调试成功',
            checkoutUrl,
            reachedPayment: Boolean(checkoutUrl),
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    const base = analyzeProcessOutput(output, timedOut);
    if (base.status === 'retry') {
        return {
            ...base,
            status: 'failed',
            message: String(base.message || runtimeError || '支付链接调试失败').replace('，准备重试', '')
        };
    }
    if (base.status === 'success') {
        return {
            status: 'failed',
            message: runtimeError || '调试流程异常结束（未输出 CHECKOUT_DEBUG_SUCCESS）',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }
    return base;
}

function extractCardLast4FromOutput(output) {
    const text = String(output || '');
    const reserved = text.match(/已预留卡片:\s*\.\.\.(\d{4})/);
    if (reserved) {
        return reserved[1];
    }
    const attempt = text.match(/ATTEMPT \d+ \| CARD (\d{4})/);
    if (attempt) {
        return attempt[1];
    }
    return null;
}

function buildRuntimeFailure(message, code, status = 'failed', extra = {}) {
    return {
        success: false,
        message,
        code,
        status,
        ...extra
    };
}

function extractRuntimeErrorMessage(output) {
    const normalized = String(output || '');
    const match = normalized.match(/❌ \[运行时错误\]:\s*(.+)/);
    if (match) {
        return match[1].trim();
    }
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startsWith('Error:')) {
            return lines[i].replace(/^Error:\s*/, '');
        }
    }
    return '';
}

function analyzeProcessOutput(output, timedOut) {
    const normalized = String(output || '');
    const runtimeError = extractRuntimeErrorMessage(normalized);
    const reachedPayment = normalized.includes('[Stripe] Step')
        || normalized.includes('正在使用 Stripe 信用卡')
        || normalized.includes('Checkout 页面已打开')
        || normalized.includes('chatgpt.com/checkout')
        || normalized.includes('配置套餐')
        || normalized.includes('定价页')
        || normalized.includes('#pricing');
    const paymentStateMatch = normalized.match(/PAYMENT_STATE:(not_started|started|succeeded|declined|unknown)/g);
    const paymentState = paymentStateMatch?.length
        ? paymentStateMatch[paymentStateMatch.length - 1].split(':')[1]
        : (normalized.includes('支付结果未知') ? 'unknown' : null);
    const success = normalized.includes('PAYMENT_SUCCESS') || normalized.includes('最终校验：支付成功');

    if (paymentState === 'unknown' || (paymentState === 'started' && !success)) {
        return {
            status: 'manual',
            message: '支付结果未确认，已保留 CDK 与银行卡，需人工复核',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false,
            paymentState,
            recoveryRequired: true
        };
    }

    const failureState = success ? 'succeeded' : paymentState;
    const guardedFailure = classifyChatGptAuthFailure(runtimeError, failureState)
        || classifyAccountAlreadySubscribed(runtimeError, failureState)
        || classifyChatGptNavigationFailure(runtimeError, failureState, normalized)
        || classifyCheckoutFailure(runtimeError, failureState)
        || classifyProxyPreflightFailure(runtimeError, failureState)
        || classifyClaudeNavigationFailure(runtimeError, failureState)
        || classifyClaudeCheckoutReadinessFailure(runtimeError, failureState)
        || classifyGrokFailure(runtimeError, failureState)
        || classifyOpenAiCardMethodFailure(runtimeError, failureState);
    if (guardedFailure) return guardedFailure;

    if (success) {
        return {
            status: 'success',
            message: '激活成功',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false,
            paymentState: 'succeeded'
        };
    }

    if (normalized.includes('金额校验失败')) {
        return {
            status: 'failed',
            message: '支付金额校验失败，请检查账单地区与币种配置',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('Session 未生效')
        || normalized.includes('Google 登录')
        || normalized.includes('Sign in with Google')) {
        return {
            status: 'failed',
            message: runtimeError || 'Session 未在浏览器中生效，请粘贴完整 Session JSON（从 chatgpt.com/api/auth/session 全选复制）',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('Session 无效')
        || normalized.includes('Session 登录失败')
        || normalized.includes('Session 响应异常')
        || normalized.includes('缺少 AccessToken')) {
        return {
            status: 'failed',
            message: runtimeError || 'Session 无效或已过期，请重新获取完整 Session JSON 后重试',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('无法将定价页切换到目标地区')) {
        return {
            status: 'failed',
            message: runtimeError || '定价页地区切换失败，已尝试 API Checkout；若仍失败请检查后台账单地区',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('未找到') && normalized.includes('升级按钮')) {
        return {
            status: 'failed',
            message: runtimeError || '定价页未找到对应套餐升级按钮，请确认账号可升级',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('等待 Checkout 页面超时')) {
        return {
            status: 'failed',
            message: runtimeError || '点击升级后未跳转到 Checkout 页面',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('无法获取支付链接')
        || normalized.includes('API 创建 Checkout 失败')
        || normalized.includes('createCheckoutSession 失败')
        || normalized.includes('无法打开 Checkout 页面')
        || normalized.includes('订单创建失败')) {
        return {
            status: 'failed',
            message: runtimeError || '无法创建官方 Checkout 订单，请检查账号是否已订阅、账单地区与币种是否匹配',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('该账号无激活权限')
        || normalized.includes('not_eligible')
        || normalized.includes('Offer not found')) {
        return {
            status: 'failed',
            message: '该账号不符合订阅条件（可能已订阅或地区不支持），请更换账号或调整后台账单地区',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('Browser does not support socks5 proxy authentication')
        || normalized.includes('socks5 proxy authentication')) {
        return {
            status: 'failed',
            message: '代理配置错误：Playwright 不支持带账号密码的 SOCKS5，系统已自动中继；若仍失败请检查代理 URL 或改用 HTTP 代理',
            reachedPayment: false,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('代理认证失败') || normalized.includes('代理响应异常') || normalized.includes('账号余额')) {
        return {
            status: 'failed',
            message: '系统维护中,请联系管理员修复',
            reachedPayment,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('代理连接失败') || normalized.includes('代理响应异常')) {
        return {
            status: 'maintenance',
            message: '系统维护中,请联系管理员修复',
            reachedPayment,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('监测到致命拦截文字')
        || normalized.includes('监测到致命拦截')
        || normalized.includes('You have been blocked')) {
        return {
            status: 'retry',
            message: '监测到致命拦截文字，准备重试',
            reachedPayment: true,
            shouldRetry: true,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('手机号被拒绝或系统拦截')) {
        return {
            status: 'retry',
            message: '手机号不可用，准备重试',
            reachedPayment,
            shouldRetry: true,
            deletePhone: true,
            deleteCard: false
        };
    }

    if (normalized.includes('短信验证码超时')
        || normalized.includes('该手机号无验证码')
        || normalized.includes('手机号短信验证异常')) {
        return {
            status: 'retry',
            message: '短信异常：手机号不可用，已禁用该号，准备重试',
            reachedPayment,
            shouldRetry: true,
            deletePhone: true,
            deleteCard: false
        };
    }

    if (normalized.includes('银行卡被拒绝')
        || normalized.includes('stripe_card_declined')
        || normalized.includes('支付失败 (stripe_redirect_failed)')
        || normalized.includes('支付失败 (stripe_redirect_canceled)')
        || normalized.includes('支付失败 (stripe_card_declined)')) {
        return {
            status: 'manual',
            message: '银行卡被拒绝或 Stripe 驳回，请查看截图后人工处理',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: true
        };
    }

    if (normalized.includes('支付结果检测失败')
        || normalized.includes('支付结果等待超时')) {
        return {
            status: 'manual',
            message: '支付结果未确认，请查看截图后人工处理',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('需要人工验证：触发 Cloudflare')
        || normalized.includes('captcha_challenge_required')) {
        return {
            status: 'manual',
            message: '触发 Cloudflare 人机验证（需勾选验证框），自动化无法可靠通过。请换住宅代理 IP，或 HEADFUL=1 有头模式人工勾选',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('支付失败 (manual_intervention)')
        || normalized.includes('manual_intervention')
        || normalized.includes('需要人工操作')
        || normalized.includes('人机验证')
        || normalized.includes('Cloudflare/人机验证')
        || normalized.includes('captcha_challenge')) {
        return {
            status: 'manual',
            message: runtimeError || '需要人工操作：支付自动化失败，请查看失败截图',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('支付失败 (payment_failed)')
        || normalized.includes('支付失败 (card_pool_exhausted)')) {
        return {
            status: 'manual',
            message: runtimeError || '支付失败，请查看运行日志与截图',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    // 已进入 Stripe/Checkout 支付流程后，任何失败都不再整单重试
    if (reachedPayment && (
        normalized.includes('支付失败')
        || normalized.includes('❌ [支付失败]')
        || normalized.includes('FAILURE_SCREENSHOT')
        || normalized.includes('billing_address_not_filled')
        || normalized.includes('账单地址未完整')
    )) {
        return {
            status: 'manual',
            message: runtimeError || '支付流程失败，请查看失败截图后人工处理',
            reachedPayment: true,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('代理或网络持续超时')
        || normalized.includes('浏览器连接被代理多次关闭')) {
        return {
            status: 'retry',
            message: '当前代理超时严重，已切换代理重试',
            reachedPayment: false,
            shouldRetry: true,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('OpenAI 鉴权服务异常')
        || normalized.includes('/auth/error?error=undefined')
        || normalized.includes('chatgpt.com/auth/error')
        || normalized.includes('CHECKOUT_UNUSUAL_ACTIVITY')
        || normalized.includes('unusual activity')
        || normalized.includes('上游检测到异常活动')) {
        return {
            status: 'retry',
            message: 'OpenAI 接口风控拦截 (unusual activity)，换代理 IP 重试',
            reachedPayment: false,
            shouldRetry: true,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('user_already_exists')
        || normalized.includes('该邮箱已被注册')) {
        return {
            status: 'retry',
            message: '邮箱已被注册，自动换下一个邮箱重试',
            reachedPayment: false,
            shouldRetry: true,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('该账号无激活权限,请更换账号重试')) {
        return {
            status: 'failed',
            message: '该账号不符合订阅条件（可能已订阅或地区不支持），请更换账号或调整后台账单地区',
            reachedPayment,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (normalized.includes('❌ [运行时错误]') || runtimeError) {
        return {
            status: 'failed',
            message: runtimeError || '自动化执行失败，请查看运行日志',
            reachedPayment,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (!reachedPayment) {
        const deepCheckoutFlow =
            normalized.includes('Stripe')
            || normalized.includes('pay.openai.com')
            || normalized.includes('Checkout')
            || normalized.includes('正在打开 Stripe');
        if (deepCheckoutFlow) {
            return {
                status: 'retry',
                message: '已进入支付流程但未完成，准备重试',
                reachedPayment: false,
                shouldRetry: true,
                deletePhone: false,
                deleteCard: false
            };
        }
        return {
            status: 'failed',
            message: runtimeError || '开通失败，请查看运行日志排查 Session、账单地区或卡池配置',
            reachedPayment,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    if (timedOut || normalized.includes("运行时错误")) {
        return {
            status: reachedPayment ? 'manual' : 'failed',
            message: reachedPayment
                ? '支付流程超时或中断，请查看失败截图后人工处理'
                : '激活失败',
            reachedPayment,
            shouldRetry: false,
            deletePhone: false,
            deleteCard: false
        };
    }

    return {
        status: reachedPayment ? 'manual' : 'failed',
        message: reachedPayment
            ? (runtimeError || '支付流程未完成，请查看失败截图后人工处理')
            : (runtimeError || '开通失败，请查看运行日志'),
        reachedPayment,
        shouldRetry: false,
        deletePhone: false,
        deleteCard: false
    };
}

function getCheckoutProgress(output, status = 'running') {
    const text = String(output || '');
    const markers = [
        ['正在检查代理连通性', 2],
        ['代理连接成功! 代理公网 IP', 5],
        ['[1] 准备自助充值', 8],
        ['Session 登录成功', 12],
        ['正在通过 API 创建 Checkout', 20],
        ['Checkout 页面已打开', 35],
        ['CHECKOUT_DEBUG_SUCCESS', 100],
        ['CHECKOUT_URL:', 95],
        ['已打开 ChatGPT 定价页', 15],
        ['[Stripe] Step 1', 45],
        ['[Stripe] Step 6', 60],
        ['[Stripe] Step 9', 80],
        ['[Stripe] Step 10', 90],
        ['正在使用 Stripe 信用卡卡池支付流程', 40],
        ['最终校验：支付成功!', 100],
        ['PAYMENT_SUCCESS', 100]
    ];

    let progress = 0;
    for (const [marker, value] of markers) {
        if (text.includes(marker)) {
            progress = Math.max(progress, value);
        }
    }

    if (status === 'success') return 100;
    return Math.min(progress, 99);
}

function normalizeTaskProgress(progress, status = 'running', previous = 0) {
    const numericProgress = Number(progress);
    const safeProgress = Number.isFinite(numericProgress) ? Math.max(0, Math.round(numericProgress)) : 0;
    const cappedProgress = status === 'success' ? Math.min(safeProgress, 100) : Math.min(safeProgress, 99);
    return Math.max(Math.max(0, Number(previous) || 0), cappedProgress);
}

function runCheckoutScript(jobKey, scriptPath, env, attempt = 1, onProgress = null, onPaymentState = null, abortSignal = null) {
    return new Promise((resolve) => {
        if (abortSignal?.aborted) {
            resolve({ attempt, code: null, signal: 'SIGTERM', timedOut: false, aborted: true,
                timeoutReason: '', output: '', analysis: null });
            return;
        }
        logTask(jobKey, `启动子进程 attempt=${attempt} script=${scriptPath}`);
        const child = spawn('node', [scriptPath], {
            env,
            windowsHide: true
        });

        let output = '';
        let idleTimer = null;
        let totalTimer = null;
        let finished = false;
        let timedOut = false;
        let timeoutReason = '';
        let aborted = false;
        let killTimer = null;
        const diagnostic = checkoutDebugManager.has(jobKey);

        activeProcesses.add(child);
        checkoutDebugManager.bindChild(jobKey, child);
        const cleanup = () => {
            activeProcesses.delete(child);
            checkoutDebugManager.unbindChild(jobKey, child);
            if (idleTimer) clearTimeout(idleTimer);
            if (totalTimer) clearTimeout(totalTimer);
            if (killTimer) clearTimeout(killTimer);
            abortSignal?.removeEventListener('abort', abort);
        };

        const finish = (result) => {
            if (finished) {
                return;
            }
            finished = true;
            cleanup();
            resolve({ attempt, ...result });
        };

        const stopChild = () => {
            try { child.kill('SIGTERM'); } catch (_) { }
            if (!killTimer && !finished) killTimer = setTimeout(() => {
                if (finished) return;
                try { child.kill('SIGKILL'); } catch (_) { }
                finish({ code: null, signal: 'SIGKILL', timedOut, aborted, timeoutReason, output,
                    analysis: diagnostic ? null : analyzeProcessOutput(output, timedOut) });
            }, 5000);
        };
        const abort = () => {
            if (finished) return;
            aborted = true;
            output += '\n[DIAGNOSTIC_CANCELLED] 诊断已取消，未提交支付。\n';
            stopChild();
        };
        abortSignal?.addEventListener('abort', abort, { once: true });
        if (abortSignal?.aborted) abort();

        const resetIdleTimer = () => {
            if (idleTimer) {
                clearTimeout(idleTimer);
            }
            idleTimer = setTimeout(() => {
                timedOut = true;
                timeoutReason = 'idle';
                output += `\n[TIMEOUT] 超过 ${PROCESS_IDLE_TIMEOUT_MS / 1000} 秒没有打印，任务终止。\n`;
                logTask(jobKey, `attempt=${attempt} 超过 ${PROCESS_IDLE_TIMEOUT_MS / 1000} 秒无输出，终止子进程`, 'warn');
                stopChild();
            }, PROCESS_IDLE_TIMEOUT_MS);
        };

        let paymentStateBuffer = '';
        let lastObservedPaymentState = null;
        const appendChunk = (source, chunk) => {
            const text = chunk.toString();
            output += text;
            // Diagnostic protocol lines contain private checkout links. Only the
            // structured, redacted report reaches diagnostic log persistence.
            if (!diagnostic) logTaskChunk(jobKey, attempt, source, text);
            paymentStateBuffer += text;
            const matches = paymentStateBuffer.match(/PAYMENT_STATE:(not_started|started|succeeded|declined|unknown)(?::[^\n\r]*)?/g) || [];
            if (matches.length && typeof onPaymentState === 'function') {
                const latest = matches[matches.length - 1];
                const state = latest.match(/^PAYMENT_STATE:(not_started|started|succeeded|declined|unknown)/)?.[1];
                const message = latest.includes(':') ? latest.slice(`PAYMENT_STATE:${state}`.length + 1) : '';
                if (state && state !== lastObservedPaymentState) {
                    lastObservedPaymentState = state;
                    Promise.resolve(onPaymentState(state, message)).catch((error) => console.error('[Payment State Update Error]', error));
                }
            }
            paymentStateBuffer = paymentStateBuffer.slice(-512);
            if (onProgress) {
                Promise.resolve(onProgress(getCheckoutProgress(output), output)).catch((error) => console.error('[Progress Update Error]', error));
            }
            resetIdleTimer();
        };

        resetIdleTimer();
        totalTimer = setTimeout(() => {
            if (finished) return;
            timedOut = true;
            timeoutReason = 'total';
            output += `\n[TOTAL_TIMEOUT] 任务总时长超过 ${PROCESS_TOTAL_TIMEOUT_MS / 1000} 秒，任务终止。\n`;
            logTask(jobKey, `attempt=${attempt} 超过 ${PROCESS_TOTAL_TIMEOUT_MS / 1000} 秒总时限，终止子进程`, 'warn');
            stopChild();
        }, PROCESS_TOTAL_TIMEOUT_MS);
        child.stdout.on('data', (chunk) => appendChunk('stdout', chunk));
        child.stderr.on('data', (chunk) => appendChunk('stderr', chunk));
        child.on('error', (error) => {
            const message = diagnostic ? redactDiagnosticLogs(error.message) : error.message;
            output += `\n[SPAWN_ERROR] ${message}\n`;
            logTask(jobKey, `attempt=${attempt} 子进程启动失败: ${message}`, 'error');
            finish({ code: null, signal: null, timedOut, aborted, timeoutReason, output,
                analysis: diagnostic ? null : analyzeProcessOutput(output, timedOut) });
        });
        child.on('close', (code, signal) => {
            cleanup();
            logTask(jobKey, `attempt=${attempt} 子进程退出 code=${code} signal=${signal || 'none'} timedOut=${timedOut}`);
            finish({
                code,
                signal,
                timedOut,
                aborted,
                timeoutReason,
                output,
                analysis: diagnostic ? null : analyzeProcessOutput(output, timedOut)
            });
        });
    });
}

app.get('/admin', (req, res) => {
    res.status(404).type('text/plain').send('Not Found');
});

app.get(['/admin-login', '/admin-login/', '/admin-login.html'], (req, res) => {
    res.status(404).type('text/plain').send('Not Found');
});

app.post('/api/admin/login', async (req, res) => {
    const email = adminAuth.normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const clientMeta = adminAuth.getClientMeta(req);

    if (!email || !password) {
        return res.status(400).json({ success: false, message: '请输入管理员邮箱和密码' });
    }

    const rate = adminAuth.checkLoginRateLimit(clientMeta.ip);
    if (!rate.allowed) {
        return res.status(429).json({
            success: false,
            message: `登录尝试过多，请 ${rate.retryAfterSec} 秒后再试`
        });
    }

    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        const telegramSettings = await store.getTelegramConfig();
        const emailOk = email === adminAuth.normalizeEmail(authConfig.email);
        const passwordOk = verifyPassword(password, authConfig.passwordHash);

        if (!emailOk || !passwordOk) {
            adminAuth.recordLoginFailure(rate.key, rate.entry);
            await logAdminSecurityEvent('login_failed', {
                ...clientMeta,
                email,
                detail: '邮箱或密码错误'
            });
            fireAdminSecurityNotification('admin_login_failed', {
                email,
                ip: clientMeta.ip,
                fingerprint: clientMeta.fingerprint,
                userAgent: clientMeta.userAgent,
                message: '邮箱或密码错误'
            });
            return res.status(401).json({ success: false, message: '邮箱或密码错误' });
        }

        adminAuth.clearLoginAttempts(rate.key);

        const methods = adminAuth.resolveLogin2faMethods(authConfig, telegramSettings);
        if (!adminAuth.is2faRequired(authConfig, telegramSettings)) {
            const { token, payload } = issueAdminToken(authConfig.passwordVersion, authConfig.email);
            await logAdminSecurityEvent('login_success', {
                ...clientMeta,
                email: authConfig.email,
                detail: '密码登录（未启用二次验证）'
            });
            fireAdminSecurityNotification('admin_login_success', {
                email: authConfig.email,
                ip: clientMeta.ip,
                fingerprint: clientMeta.fingerprint,
                userAgent: clientMeta.userAgent,
                method: 'password_only',
                message: '后台登录成功（尚未启用 2FA）'
            });
            return res.json(await attachAdminPaths({
                success: true,
                token,
                expiresAt: payload.exp,
                issuedAt: payload.iat,
                permissions: payload.permissions,
                email: authConfig.email,
                requires2fa: false,
                setupRequired: true
            }));
        }

        const challenge = adminAuth.issueLoginChallenge({
            email: authConfig.email,
            passwordVersion: authConfig.passwordVersion,
            ip: clientMeta.ip,
            fingerprint: clientMeta.fingerprint
        });

        return res.json({
            success: true,
            requires2fa: true,
            challengeToken: challenge.token,
            methods,
            defaultMethod: adminAuth.pickDefaultLogin2faMethod(methods, authConfig.login2faMode === 'either' ? '' : authConfig.login2faMode),
            login2faMode: authConfig.login2faMode,
            email: authConfig.email,
            expiresAt: challenge.payload.exp
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/login/send-tg-code', async (req, res) => {
    const challengeToken = String(req.body?.challengeToken || '').trim();
    const challenge = adminAuth.verifyLoginChallenge(challengeToken);
    if (!challenge) {
        return res.status(401).json({ success: false, message: '登录会话已过期，请重新登录' });
    }

    try {
        await ensureStoreReady();
        const code = adminAuth.generateTelegramLoginCode();
        adminAuth.storeTelegramLoginCode(challenge.cid, code);
        const clientMeta = adminAuth.getClientMeta(req);
        const sendResult = await sendTelegramLoginCode(store, code, {
            email: challenge.email,
            ip: clientMeta.ip || challenge.ip
        });
        if (!sendResult.ok) {
            return res.status(400).json({ success: false, message: sendResult.error || 'Telegram 验证码发送失败' });
        }
        return res.json({ success: true, message: '验证码已发送到管理员 Telegram' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/login/verify-2fa', async (req, res) => {
    const challengeToken = String(req.body?.challengeToken || '').trim();
    const method = String(req.body?.method || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const clientMeta = adminAuth.getClientMeta(req);
    const challenge = adminAuth.verifyLoginChallenge(challengeToken);

    if (!challenge) {
        return res.status(401).json({ success: false, message: '登录会话已过期，请重新登录' });
    }

    if (!code) {
        return res.status(400).json({ success: false, message: '请输入验证码' });
    }

    const rate = adminAuth.checkLoginRateLimit(`${clientMeta.ip}:2fa`);
    if (!rate.allowed) {
        return res.status(429).json({
            success: false,
            message: `验证尝试过多，请 ${rate.retryAfterSec} 秒后再试`
        });
    }

    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        const telegramSettings = await store.getTelegramConfig();
        const methods = adminAuth.resolveLogin2faMethods(authConfig, telegramSettings);
        if (!methods.includes(method)) {
            return res.status(400).json({ success: false, message: '不支持的验证方式' });
        }

        let verified = false;
        if (method === 'totp') {
            verified = adminAuth.verifyTotpCode(authConfig.totpSecret, code);
        } else if (method === 'telegram') {
            const tgResult = adminAuth.verifyTelegramLoginCode(challenge.cid, code);
            verified = tgResult.ok;
            if (!verified) {
                adminAuth.recordLoginFailure(rate.key, rate.entry);
                await logAdminSecurityEvent('2fa_failed', {
                    ...clientMeta,
                    email: challenge.email,
                    detail: `Telegram 验证码错误 (${tgResult.reason || 'invalid'})`
                });
                fireAdminSecurityNotification('admin_2fa_failed', {
                    email: challenge.email,
                    ip: clientMeta.ip,
                    fingerprint: clientMeta.fingerprint,
                    userAgent: clientMeta.userAgent,
                    method: 'telegram',
                    message: 'Telegram 验证码错误'
                });
                const message = tgResult.reason === 'expired'
                    ? '验证码已过期，请重新获取'
                    : 'Telegram 验证码错误';
                return res.status(401).json({ success: false, message });
            }
        }

        if (!verified) {
            adminAuth.recordLoginFailure(rate.key, rate.entry);
            await logAdminSecurityEvent('2fa_failed', {
                ...clientMeta,
                email: challenge.email,
                detail: `${method} 验证码错误`
            });
            fireAdminSecurityNotification('admin_2fa_failed', {
                email: challenge.email,
                ip: clientMeta.ip,
                fingerprint: clientMeta.fingerprint,
                userAgent: clientMeta.userAgent,
                method,
                message: '二次验证失败'
            });
            return res.status(401).json({ success: false, message: '验证码错误' });
        }

        adminAuth.clearLoginAttempts(rate.key);
        const { token, payload } = issueAdminToken(authConfig.passwordVersion, authConfig.email);
        await logAdminSecurityEvent('login_success', {
            ...clientMeta,
            email: authConfig.email,
            detail: `二次验证成功 (${method})`
        });
        fireAdminSecurityNotification('admin_login_success', {
            email: authConfig.email,
            ip: clientMeta.ip,
            fingerprint: clientMeta.fingerprint,
            userAgent: clientMeta.userAgent,
            method,
            message: '后台登录成功'
        });

        return res.json(await attachAdminPaths({
            success: true,
            token,
            expiresAt: payload.exp,
            issuedAt: payload.iat,
            permissions: payload.permissions,
            email: authConfig.email
        }));
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/** 运行日志：必须挂在 app.use('/api/admin', authenticateAdmin) 之前，并为每条路由单独鉴权，否则部分环境下会 404 */
app.get('/api/admin/runtime-logs', authenticateAdmin, (req, res) => {
    try {
        const wantTail = String(req.query.tail || '') === '1' || String(req.query.tail || '') === 'true';
        const after = Math.max(0, parseInt(String(req.query.after || '0'), 10) || 0);
        let limit = parseInt(String(req.query.limit || '500'), 10) || 500;
        limit = Math.min(2000, Math.max(1, limit));

        const entries = wantTail ? runtimeLog.tail(limit) : runtimeLog.after(after, limit);
        const nextAfter = entries.length ? entries[entries.length - 1].id : after;
        res.json({ success: true, entries, nextAfter });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/runtime-logs/clear', authenticateAdmin, (req, res) => {
    try {
        runtimeLog.clear();
        runtimeLog.push({ jobKey: '', level: 'system', source: 'server', text: '🧹 运行日志已手动清空' });
        res.json({ success: true, message: '运行日志已清空' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


/** 代理批量测试：支持临时 URL 或已保存代理 ID；检测后可选写回 proxy_assets。 */
app.post('/api/admin/proxy/test', authenticateAdmin, async (req, res) => {
    try {
        await ensureStoreReady();
        const ids = Array.isArray(req.body?.ids)
            ? req.body.ids.map((id) => Number(id)).filter((id) => id > 0)
            : [];
        const rawProxies = normalizeProxyLines(req.body?.proxies || []);
        const persist = req.body?.persist !== false;

        let targets = [];
        if (ids.length) {
            const saved = await store.listProxyAssets();
            const map = new Map(saved.map((item) => [item.id, item]));
            targets = ids.map((id) => {
                const row = map.get(id);
                return row ? { id, proxy_url: row.proxy_url } : null;
            }).filter(Boolean);
        } else {
            targets = rawProxies.map((proxy_url) => ({ id: null, proxy_url }));
        }

        if (!targets.length) {
            return res.status(400).json({ success: false, message: '未提供代理 URL 或 ID' });
        }
        if (targets.length > 50) {
            return res.status(400).json({ success: false, message: '一次最多测试 50 条代理' });
        }

        const results = await Promise.all(targets.map(async (target) => {
            const result = await testProxyUrl(target.proxy_url);
            if (persist && target.id) {
                await store.updateProxyAssetCheck(target.id, result);
            }
            return {
                id: target.id,
                proxy_url: target.proxy_url,
                ...result
            };
        }));

        return res.json({ success: true, results });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});


// ─── External Card Pool Webhook (X-API-Key auth) ────────────────────────────
app.post('/api/external/cards/push', async (req, res) => {
    try {
        await ensureStoreReady();
        const apiKey = String(req.headers['x-api-key'] || '').trim();
        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'API Key 无效或缺失' });
        }
        const expectedKey = await store.getAppConfigValue('external_card_api_key', '');
        if (!expectedKey || apiKey !== expectedKey) {
            return res.status(401).json({ success: false, error: 'API Key 无效或缺失' });
        }

        const cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
        if (cards.length === 0) {
            return res.status(400).json({ success: false, error: '缺少 cards 数组或为空' });
        }
        if (cards.length > 500) {
            return res.status(400).json({ success: false, error: '单次导入上限 500 条' });
        }

        const result = await store.importCards(cards);
        res.json({ success: true, ...result });
    } catch (error) {
        if (error.message === '单次导入上限 500 条') {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

/** 公开 API：必须挂在 app.use('/api/admin', authenticateAdmin) 之前，否则部分环境下会 404 */
app.get('/api/public/admin-paths', async (req, res) => {
    try {
        await ensureStoreReady();
        const paths = await store.getAdminPaths();
        return res.json({
            success: true,
            loginPath: paths.loginPath,
            panelPath: paths.panelPath,
            loginUrl: buildAdminLoginUrl(paths),
            panelUrl: buildAdminPanelUrl(paths)
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/public/subscription/check', async (req, res) => {
    try {
        const rawSession = String(req.body?.session || req.body?.token || '').trim().replace(/^\uFEFF/, '');
        if (!rawSession) {
            return res.status(400).json({ success: false, message: '请粘贴 Session JSON 或 AccessToken' });
        }

        const token = normalizeSessionToken(rawSession);
        const tokenCheck = validateSessionTokenForQuery(token);
        if (!tokenCheck.valid) {
            return res.status(400).json({ success: false, message: tokenCheck.message });
        }

        await ensureStoreReady();
        const proxy = await store.getActiveProxy().catch(() => '');
        const timezoneOffsetMin = Number(req.body?.timezone_offset_min);
        const result = await querySubscriptionBySession(token, {
            timezoneOffsetMin: Number.isFinite(timezoneOffsetMin)
                ? timezoneOffsetMin
                : -new Date().getTimezoneOffset(),
            email: extractEmailFromSession(rawSession) || tokenCheck.email || '',
            proxy
        });

        if (!result.ok) {
            const httpStatus = (result.statusCode === 401 || !result.statusCode) ? 400 : result.statusCode;
            return res.status(httpStatus).json({
                success: false,
                message: result.error || '查询订阅失败',
                upstreamStatus: result.statusCode
            });
        }

        return res.json({ success: true, data: result.data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== 交互式人机验证透传 API ====================
// 内部 API：Playwright 进程向服务端推送验证画面提示
app.post('/api/internal/captcha-prompt', (req, res) => {
    try {
        const { jobKey, image, width, height, title, message, promptZh, promptEn, loading, contentReady, expiresAt } = req.body || {};
        if (!jobKey) {
            return res.status(400).json({ success: false, message: 'jobKey is required' });
        }
        if (!image && !loading) {
            return res.status(400).json({ success: false, message: 'image is required when not loading' });
        }

        const state = getOrCreateCaptchaState(jobKey);
        state.image = image || null;
        state.loading = Boolean(loading);
        state.contentReady = contentReady !== false && !state.loading;
        state.expiresAt = Number(expiresAt) || state.expiresAt || 0;
        state.width = Number(width) || (state.image ? 400 : 0);
        state.height = Number(height) || (state.image ? 500 : 0);
        state.title = title || (state.loading ? '正在等待安全验证加载...' : '请协助完成人机验证');
        state.message = message || (state.loading ? '正在检测官方人机验证弹窗，请稍候...' : '检测到官方人机验证，请点击画面中对应验证区域');
        state.promptZh = promptZh || '';
        state.promptEn = promptEn || '';
        state.updatedAt = Date.now();
        state.active = true;

        // 核心优化 1：新画面就绪，自增画面序列号（用于时序防旧帧错位）
        state.frameSeq = (state.frameSeq || 0) + 1;

        // 核心优化 2：彻底清空前序画面的积压点击队列，严禁旧画面残留点击污染新画面！
        state.pendingClicks = [];

        broadcastToTask(jobKey, {
            type: 'captcha_interactive_required',
            jobKey,
            image: state.image,
            loading: state.loading,
            contentReady: state.contentReady,
            expiresAt: state.expiresAt,
            frameSeq: state.frameSeq,
            width: state.width,
            height: state.height,
            title: state.title,
            message: state.message,
            promptZh: state.promptZh,
            promptEn: state.promptEn
        });

        return res.json({ success: true, frameSeq: state.frameSeq });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 内部 API：Playwright 进程挂起等待前端用户点击（长轮询）
app.get('/api/internal/captcha-wait-click/:jobKey', (req, res) => {
    const { jobKey } = req.params;
    const timeoutMs = Math.min(Math.max(Number(req.query.timeout || 35000), 500), 60000);
    const state = getOrCreateCaptchaState(jobKey);

    if (state.pendingClicks && state.pendingClicks.length > 0) {
        const clickData = state.pendingClicks.shift();
        return res.json(clickData);
    }

    const timer = setTimeout(() => {
        state.waitingRequests = state.waitingRequests.filter(item => item.res !== res);
        if (!res.headersSent) {
            res.json({ success: true, clicked: false, timeout: true });
        }
    }, timeoutMs);

    state.waitingRequests.push({ res, timer });

    req.on('close', () => {
        clearTimeout(timer);
        state.waitingRequests = state.waitingRequests.filter(item => item.res !== res);
    });
});

// 内部 API：Playwright 进程报告验证清除或结束状态
app.post('/api/internal/captcha-status', (req, res) => {
    try {
        const { jobKey, cleared, failed, reason, message } = req.body || {};
        if (!jobKey) {
            return res.status(400).json({ success: false, message: 'jobKey is required' });
        }

        const state = interactiveCaptchaMap.get(jobKey);
        if (state) {
            for (const item of state.waitingRequests) {
                clearTimeout(item.timer);
                try { item.res.json({ success: true, clicked: false, cancelled: true }); } catch (_) {}
            }
            state.waitingRequests = [];
            state.pendingClicks = [];
            state.active = false;
            if (cleared || failed) {
                interactiveCaptchaMap.delete(jobKey);
            }
        }

        broadcastToTask(jobKey, {
            type: 'captcha_interactive_status',
            jobKey,
            cleared: Boolean(cleared),
            failed: Boolean(failed),
            reason: reason || '',
            message: message || (cleared ? '验证已通过' : (failed ? '验证失败' : '验证已结束'))
        });

        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 公开 API：前端用户点击坐标回传（HTTP 回退通道）
app.post('/api/public/task/:jobKey/captcha-click', async (req, res) => {
    const { jobKey } = req.params;
    try {
        if (await isCheckoutDiagnosticJob(jobKey)) return res.status(403).json({ success: false, message: '诊断任务需管理员二级验证' });
    } catch (_) { return res.status(503).json({ success: false, message: '验证通道暂时不可用' }); }
    const { ratioX, ratioY, clientX, clientY, frameSeq, points, submitPoint, action } = req.body || {};

    const hasPoints = Array.isArray(points) && points.length > 0;
    if (!hasPoints && (!Number.isFinite(Number(ratioX)) || !Number.isFinite(Number(ratioY)))) {
        return res.status(400).json({ success: false, message: 'Invalid coordinates' });
    }

    const handled = notifyCaptchaClick(jobKey, { ratioX, ratioY, clientX, clientY, frameSeq, points, submitPoint, action });

    broadcastToTask(jobKey, {
        type: 'captcha_click_received',
        jobKey,
        ratioX: Number(ratioX || 0),
        ratioY: Number(ratioY || 0),
        pointsCount: hasPoints ? points.length : 0,
        frameSeq: Number(frameSeq || 0),
        handled
    });

    return res.json({ success: true, handled });
});

app.use('/api/admin', authenticateAdmin);

app.get('/subscription', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'subscription.html'));
});

app.get('/api/public/payment-region', async (req, res) => {
    try {
        await ensureStoreReady();
        const regionCode = await store.getPaymentRegion();
        const config = REGION_CONFIG[regionCode] || REGION_CONFIG.PH;
        return res.json({
            success: true,
            region: regionCode,
            currency: config.currency,
            label: config.label
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/public/runtime', async (req, res) => {
    try {
        await ensureStoreReady();
        const maxConcurrentActivations = await store.getMaxConcurrentActivations();
        return res.json({
            success: true,
            runtime: {
                active_foreground_jobs: activeForegroundJobs.size,
                max_foreground_jobs: Math.max(1, Number(maxConcurrentActivations || 1))
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/session', (req, res) => {
    const age = Date.now() - Number(req.admin.iat || 0);
    const shouldRefresh = age >= ADMIN_REFRESH_AFTER_MS;
    let refreshedToken = null;
    let payload = req.admin;

    if (shouldRefresh) {
        const refreshed = issueAdminToken(req.admin.pv, req.admin.email);
        refreshedToken = refreshed.token;
        payload = refreshed.payload;
    }

    return res.json({
        success: true,
        refreshed: shouldRefresh,
        token: refreshedToken,
        expiresAt: payload.exp,
        issuedAt: payload.iat,
        permissions: payload.permissions,
        email: payload.email || ''
    });
});

app.get('/api/admin/security/status', async (req, res) => {
    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        const telegramSettings = await store.getTelegramConfig();
        const paths = await store.getAdminPaths();
        res.json({
            success: true,
            email: authConfig.email,
            totpEnabled: authConfig.totpEnabled,
            login2faMode: authConfig.login2faMode,
            availableMethods: adminAuth.getAvailable2faMethods(authConfig, telegramSettings),
            methods: adminAuth.resolveLogin2faMethods(authConfig, telegramSettings),
            notifyAdminLogin: authConfig.notifyAdminLogin,
            loginPath: paths.loginPath,
            panelPath: paths.panelPath,
            loginUrl: buildAdminLoginUrl(paths),
            panelUrl: buildAdminPanelUrl(paths)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/login-logs', async (req, res) => {
    try {
        await ensureStoreReady();
        const limit = Number(req.query.limit) || 100;
        const offset = Number(req.query.offset) || 0;
        res.json({ success: true, ...(await store.listAdminLoginLogs(limit, offset)) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/secondary/session', (req, res) => {
    const token = String(req.headers['x-admin-secondary-token'] || '').trim();
    const payload = adminAuth.verifySecondaryToken(token);
    if (!payload) {
        return res.json({ success: true, verified: false });
    }
    return res.json({
        success: true,
        verified: true,
        expiresAt: payload.exp
    });
});

app.post('/api/admin/verify-secondary', async (req, res) => {
    const password = String(req.body?.password || '');
    const clientMeta = adminAuth.getClientMeta(req);
    if (!password) {
        return res.status(400).json({ success: false, message: '请输入二级密码' });
    }

    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        if (!verifyPassword(password, authConfig.secondaryPasswordHash)) {
            await logAdminSecurityEvent('secondary_failed', {
                ...clientMeta,
                email: req.admin?.email || authConfig.email,
                detail: '二级密码错误'
            });
            return res.status(401).json({ success: false, message: '二级密码错误' });
        }

        const { token, payload } = adminAuth.issueSecondaryToken(
            authConfig.secondaryPasswordVersion,
            clientMeta.ip
        );
        await logAdminSecurityEvent('secondary_success', {
            ...clientMeta,
            email: req.admin?.email || authConfig.email,
            detail: '敏感模块解锁'
        });
        fireAdminSecurityNotification('admin_secondary_success', {
            email: req.admin?.email || authConfig.email,
            ip: clientMeta.ip,
            fingerprint: clientMeta.fingerprint,
            userAgent: clientMeta.userAgent,
            message: '银行卡池/CDK/Session 模块已解锁'
        });
        return res.json({
            success: true,
            secondaryToken: token,
            expiresAt: payload.exp
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/security/2fa-mode', async (req, res) => {
    const mode = String(req.body?.mode || '').trim().toLowerCase();
    try {
        await ensureStoreReady();
        const saved = await store.saveAdmin2faLoginMode(mode);
        res.json({ success: true, login2faMode: saved, message: '登录验证方式已保存' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/security/paths', async (req, res) => {
    try {
        await ensureStoreReady();
        const saved = await store.saveAdminPaths({
            loginPath: req.body?.loginPath,
            panelPath: req.body?.panelPath
        });
        invalidateAdminPathsCache();
        cachedAdminPaths = saved;
        return res.json({
            success: true,
            loginPath: saved.loginPath,
            panelPath: saved.panelPath,
            loginUrl: buildAdminLoginUrl(saved),
            panelUrl: buildAdminPanelUrl(saved),
            message: '入口路径已更新，请使用新地址访问并收藏'
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/2fa/setup', async (req, res) => {
    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        let secret = String(authConfig.totpSecret || '').trim();
        if (!secret || authConfig.totpEnabled) {
            secret = adminAuth.generateTotpSecret();
            await store.saveAdminTotpConfig({ secret, enabled: false });
        }
        const otpauthUrl = adminAuth.getTotpUri(authConfig.email, secret);
        res.json({
            success: true,
            secret,
            otpauthUrl,
            qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUrl)}`,
            message: '请使用 Google Authenticator 扫码后输入验证码确认启用'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/2fa/confirm', async (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!code) {
        return res.status(400).json({ success: false, message: '请输入 Authenticator 验证码' });
    }
    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        if (!authConfig.totpSecret) {
            return res.status(400).json({ success: false, message: '请先发起 2FA 绑定' });
        }
        if (!adminAuth.verifyTotpCode(authConfig.totpSecret, code)) {
            return res.status(400).json({ success: false, message: '验证码错误，请重试' });
        }
        await store.saveAdminTotpConfig({ secret: authConfig.totpSecret, enabled: true });
        res.json({ success: true, message: 'Google Authenticator 已启用' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/2fa/disable', async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const code = String(req.body?.code || '').trim();
    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        if (!verifyPassword(currentPassword, authConfig.passwordHash)) {
            return res.status(400).json({ success: false, message: '登录密码错误' });
        }
        if (authConfig.totpEnabled && !adminAuth.verifyTotpCode(authConfig.totpSecret, code)) {
            return res.status(400).json({ success: false, message: 'Authenticator 验证码错误' });
        }
        await store.saveAdminTotpConfig({ secret: '', enabled: false });
        res.json({ success: true, message: 'Google Authenticator 已关闭' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/change-secondary-password', async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '').trim();
    if (!currentPassword) {
        return res.status(400).json({ success: false, message: '请输入当前二级密码' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: '新二级密码至少 6 位' });
    }
    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();
        if (!verifyPassword(currentPassword, authConfig.secondaryPasswordHash)) {
            return res.status(400).json({ success: false, message: '当前二级密码错误' });
        }
        await store.updateAdminSecondaryPassword(newPassword);
        res.json({ success: true, message: '二级密码已更新，敏感模块需重新验证' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/task-logs', async (req, res) => {
    try {
        await ensureStoreReady();
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
        const tasks = await store.listAdminTaskLogs(limit);
        res.json({ success: true, tasks });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/data', async (req, res) => {
    try {
        await ensureStoreReady();
        const data = await store.getAdminData();
        const system = await getSystemMetrics();
        data.runtime = {
            active_activation_jobs: getTotalActiveJobs(),
            active_foreground_jobs: activeForegroundJobs.size,
            system,
            browser_pool: browserPool.getStats()
        };
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/browser-pool', async (req, res) => {
    try {
        await ensureStoreReady();
        const modeEnabled = await store.getBrowserPoolEnabled();
        const system = await getSystemMetrics();
        const memText = String(system?.memory?.text || '');
        const memMatch = memText.match(/([\d.]+)G\/([\d.]+)G/);
        const hostMemory = memMatch
            ? { usedGb: Number(memMatch[1]), totalGb: Number(memMatch[2]) }
            : null;
        const pool = await browserPool.getDetailedStats(hostMemory);
        res.json({
            success: true,
            pool,
            mode: {
                enabled: modeEnabled,
                runtime: browserPool.getRuntimeEnabled(),
                workerMode: modeEnabled ? 'pool' : 'standalone'
            },
            system,
            foreground: {
                activeJobs: getTotalActiveJobs(),
                activeForegroundJobs: activeForegroundJobs.size
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/browser-pool/mode', async (req, res) => {
    try {
        await ensureStoreReady();
        const enabled = req.body?.enabled === true
            || req.body?.enabled === 1
            || String(req.body?.enabled || '').trim() === '1';
        await store.setBrowserPoolEnabled(enabled);
        const info = await syncBrowserPoolModeFromStore();
        res.json({
            success: true,
            message: enabled
                ? `已切换为浏览器池模式（${info.size || 0} 个槽位）`
                : '已切换为独立浏览器模式（每任务冷启动 Chromium）',
            mode: {
                enabled,
                runtime: browserPool.getRuntimeEnabled(),
                workerMode: enabled ? 'pool' : 'standalone'
            },
            pool: browserPool.getStats()
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/browser-pool/reload', async (req, res) => {
    try {
        await ensureStoreReady();
        const requestedSize = req.body?.size;
        if (requestedSize != null) {
            browserPool.setRuntimePoolSize(requestedSize);
        }
        const result = await browserPool.reloadBrowserPool(requestedSize);
        res.json({
            success: true,
            message: `浏览器池已重载，当前 ${result.size} 个槽位`,
            pool: browserPool.getStats()
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/sessions', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
        res.json(await store.listSessions({ limit }));
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/sessions/:jobKey', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const session = await store.getSessionByJobKey(req.params.jobKey);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session 记录不存在' });
        }
        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/subscription/cancel-auto-renew', async (req, res) => {
    try {
        const rawSession = String(req.body?.session || req.body?.token || '').trim().replace(/^\uFEFF/, '');
        if (!rawSession) {
            return res.status(400).json({ success: false, message: '请粘贴 Session JSON 或 AccessToken' });
        }

        const token = normalizeSessionToken(rawSession);
        const tokenCheck = validateSessionTokenForQuery(token);
        if (!tokenCheck.valid) {
            return res.status(400).json({ success: false, message: tokenCheck.message });
        }

        await ensureStoreReady();
        const proxy = await store.getActiveProxy().catch(() => '');
        const timezoneOffsetMin = Number(req.body?.timezone_offset_min);
        const result = await cancelAutoRenew(token, {
            timezoneOffsetMin: Number.isFinite(timezoneOffsetMin)
                ? timezoneOffsetMin
                : -new Date().getTimezoneOffset(),
            email: extractEmailFromSession(rawSession) || tokenCheck.email || '',
            proxy
        });

        if (!result.ok) {
            const httpStatus = (result.statusCode === 401 || !result.statusCode) ? 400 : result.statusCode;
            return res.status(httpStatus).json({
                success: false,
                message: result.error || '取消自动续费失败',
                upstreamStatus: result.statusCode
            });
        }

        return res.json({ success: true, data: result.data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/subscription/enable-auto-renew', async (req, res) => {
    try {
        const rawSession = String(req.body?.session || req.body?.token || '').trim().replace(/^\uFEFF/, '');
        if (!rawSession) {
            return res.status(400).json({ success: false, message: '请粘贴 Session JSON 或 AccessToken' });
        }

        const token = normalizeSessionToken(rawSession);
        const tokenCheck = validateSessionTokenForQuery(token);
        if (!tokenCheck.valid) {
            return res.status(400).json({ success: false, message: tokenCheck.message });
        }

        await ensureStoreReady();
        const proxy = await store.getActiveProxy().catch(() => '');
        const timezoneOffsetMin = Number(req.body?.timezone_offset_min);
        const result = await resumeAutoRenew(token, {
            timezoneOffsetMin: Number.isFinite(timezoneOffsetMin)
                ? timezoneOffsetMin
                : -new Date().getTimezoneOffset(),
            email: extractEmailFromSession(rawSession) || tokenCheck.email || '',
            proxy
        });

        if (!result.ok) {
            const httpStatus = (result.statusCode === 401 || !result.statusCode) ? 400 : result.statusCode;
            return res.status(httpStatus).json({
                success: false,
                message: result.error || '开启自动续费失败',
                upstreamStatus: result.statusCode
            });
        }

        return res.json({ success: true, data: result.data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/subscription/batch-renewal-status', async (req, res) => {
    try {
        await ensureStoreReady();
        const jobKeys = Array.isArray(req.body?.job_keys)
            ? req.body.job_keys.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 50)
            : [];
        if (!jobKeys.length) {
            return res.json({ success: true, data: {} });
        }

        const timezoneOffsetMin = Number(req.body?.timezone_offset_min);
        const offset = Number.isFinite(timezoneOffsetMin)
            ? timezoneOffsetMin
            : -new Date().getTimezoneOffset();
        const concurrency = 3;
        const results = {};
        let cursor = 0;

        async function queryJobRenewalStatus(jobKey) {
            const session = await store.getSessionByJobKey(jobKey);
            if (!session?.session_payload) {
                results[jobKey] = { ok: false, error: '无完整 Session' };
                return;
            }

            const rawSession = String(session.session_payload || '').trim();
            const token = normalizeSessionToken(rawSession);
            const tokenCheck = validateSessionTokenForQuery(token);
            if (!tokenCheck.valid) {
                results[jobKey] = { ok: false, error: tokenCheck.message };
                return;
            }

            const proxy = await store.getActiveProxy().catch(() => '');
            const queryResult = await querySubscriptionBySession(token, {
                timezoneOffsetMin: offset,
                email: extractEmailFromSession(rawSession) || tokenCheck.email || '',
                proxy
            });
            if (!queryResult.ok) {
                results[jobKey] = { ok: false, error: queryResult.error || '查询失败' };
                return;
            }

            const data = queryResult.data || {};
            results[jobKey] = {
                ok: true,
                email: data.email || '',
                autoRenew: data.autoRenew || '—',
                autoRenewRaw: data.autoRenewRaw,
                hasActiveSubscription: Boolean(data.hasActiveSubscription),
                subscriptionChannel: data.subscriptionChannel || ''
            };
        }

        async function worker() {
            while (cursor < jobKeys.length) {
                const index = cursor;
                cursor += 1;
                await queryJobRenewalStatus(jobKeys[index]);
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, jobKeys.length) }, () => worker()));
        return res.json({ success: true, data: results });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/screenshots', requireSecondaryAuth, async (req, res) => {
    try {
        const rel = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || rel.includes('..') || !rel.endsWith('.png')) {
            return res.status(400).json({ success: false, message: '无效的截图路径' });
        }
        const root = path.join(__dirname, 'debug_screenshots');
        let fullPath = path.join(root, rel);
        if (!fullPath.startsWith(root) || !fs.existsSync(fullPath)) {
            if (rel.startsWith('激活/')) {
                const altPath = path.join(root, 'activation', rel.slice('激活/'.length));
                if (altPath.startsWith(root) && fs.existsSync(altPath)) {
                    fullPath = altPath;
                }
            }
        }
        if (!fullPath.startsWith(root) || !fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, message: '截图不存在' });
        }
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(fullPath);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/video', requireSecondaryAuth, async (req, res) => {
    try {
        const rel = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || rel.includes('..') || !rel.endsWith('.webm')) {
            return res.status(400).json({ success: false, message: '无效的录像路径' });
        }
        const root = path.join(__dirname, 'debug_screenshots');
        const fullPath = path.join(root, rel);
        if (!fullPath.startsWith(root) || !fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, message: '录像不存在' });
        }
        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(fullPath);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/screenshots/:subdir/:filename', requireSecondaryAuth, async (req, res) => {
    try {
        const subdir = path.basename(String(req.params.subdir || ''));
        const filename = path.basename(String(req.params.filename || ''));
        if (!subdir || !filename || !filename.endsWith('.png')) {
            return res.status(400).json({ success: false, message: '无效的截图路径' });
        }
        const fullPath = path.join(__dirname, 'debug_screenshots', subdir, filename);
        const root = path.join(__dirname, 'debug_screenshots');
        if (!fullPath.startsWith(root) || !fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, message: '截图不存在' });
        }
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(fullPath);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/task-logs/:jobKey', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const jobKey = decodeURIComponent(String(req.params.jobKey || '').trim());
        if (!jobKey) {
            return res.status(400).json({ success: false, message: '缺少任务标识' });
        }
        const diagnostic = checkoutDebugManager.get(jobKey);
        if (diagnostic) {
            checkoutDebugManager.cancel(jobKey);
            if (diagnostic.promise) await diagnostic.promise;
        }
        const { deleted, mediaDeleted } = await store.deleteTaskLogByJobKey(jobKey);
        if (!deleted) {
            return res.status(404).json({ success: false, message: '未找到该任务记录' });
        }
        return res.json({
            success: true,
            message: mediaDeleted > 0
                ? `任务记录已删除，并清理 ${mediaDeleted} 个截图/录像文件`
                : '任务记录已删除'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

function fireTelegramNotification(event, payload) {
    notifyTelegramEvent(store, event, payload).catch((error) => {
        console.error(`[Telegram] ${event} 通知失败:`, error.message);
    });
}

function notifyTaskOutcome({ event, email, cdk, jobKey, message }) {
    fireTelegramNotification(event, { email, cdk, jobKey, message });
}

app.post('/api/admin/telegram', async (req, res) => {
    try {
        await ensureStoreReady();
        const body = req.body || {};
        await store.saveTelegramConfig({
            bot_token: body.bot_token,
            admin_chat_id: body.admin_chat_id,
            group_chat_id: body.group_chat_id,
            notify_admin: Boolean(body.notify_admin),
            notify_group: Boolean(body.notify_group),
            on_success: Boolean(body.on_success),
            on_failure: Boolean(body.on_failure),
            on_card_pool_empty: Boolean(body.on_card_pool_empty)
        });
        res.json({ success: true, message: 'Telegram 通知配置已保存' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/telegram/test', async (req, res) => {
    try {
        await ensureStoreReady();
        const result = await sendTelegramTest(store, req.body || {});
        if (!result.success) {
            return res.status(400).json({ success: false, message: result.message });
        }
        res.json({ success: true, message: result.message });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/hcaptcha', async (req, res) => {
    try {
        await ensureStoreReady();
        const body = req.body || {};
        await store.saveHcaptchaConfig({
            enabled: Boolean(body.enabled),
            vlm_api_key: body.vlm_api_key,
            vlm_base_url: body.vlm_base_url,
            vlm_model: body.vlm_model,
            vlm_timeout: body.vlm_timeout,
            solver_timeout: body.solver_timeout,
            no_vlm: Boolean(body.no_vlm),
            cdp_port: body.cdp_port,
            captcha_platform_api_key: body.captcha_platform_api_key,
            captcha_platform_api_url: body.captcha_platform_api_url,
            captcha_platform_timeout: body.captcha_platform_timeout
        });
        res.json({ success: true, message: 'hCaptcha 求解器配置已保存' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/hcaptcha/test', async (req, res) => {
    try {
        await ensureStoreReady();
        const cfg = await store.getHcaptchaConfig();
        const { env } = buildHcaptchaEnvFromConfig(cfg);
        const prevEnv = {};
        for (const [key, value] of Object.entries(env)) {
            prevEnv[key] = process.env[key];
            process.env[key] = value;
        }
        try {
            const status = await checkHcaptchaSolverHealth(cfg);
            if (!status.ready) {
                return res.status(400).json({ success: false, message: status.message, status });
            }
            res.json({ success: true, message: status.message, status });
        } finally {
            for (const [key, value] of Object.entries(prevEnv)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/hcaptcha/test-vlm', async (req, res) => {
    try {
        await ensureStoreReady();
        const body = req.body || {};
        const cfg = await store.getHcaptchaConfig();
        const merged = {
            ...cfg,
            vlm_api_key: String(body.vlm_api_key || '').trim() || cfg.vlm_api_key,
            vlm_base_url: String(body.vlm_base_url || '').trim() || cfg.vlm_base_url,
            vlm_model: String(body.vlm_model || '').trim() || cfg.vlm_model,
            vlm_timeout: body.vlm_timeout ?? cfg.vlm_timeout
        };
        const result = await testVlmConnectivity(merged);
        if (!result.ok) {
            return res.status(400).json({ success: false, ...result });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/hcaptcha/test-captcha-platform', async (req, res) => {
    try {
        await ensureStoreReady();
        const body = req.body || {};
        const cfg = await store.getHcaptchaConfig();
        const merged = {
            captcha_platform_api_key: String(body.captcha_platform_api_key || '').trim() || cfg.captcha_platform_api_key,
            captcha_platform_api_url: String(body.captcha_platform_api_url || '').trim() || cfg.captcha_platform_api_url,
            captcha_platform_timeout: body.captcha_platform_timeout ?? cfg.captcha_platform_timeout
        };
        const resolved = resolveCaptchaPlatformCredentials(
            merged.captcha_platform_api_key,
            merged.captcha_platform_api_url
        );
        merged.captcha_platform_api_url = resolved.apiUrl;
        if (resolved.apiKey) {
            await store.saveHcaptchaConfig({
                ...cfg,
                captcha_platform_api_key: resolved.apiKey,
                captcha_platform_api_url: resolved.apiUrl,
                captcha_platform_timeout: merged.captcha_platform_timeout
            });
        }
        const result = await testCaptchaPlatformConnectivity({
            apiKey: merged.captcha_platform_api_key,
            apiUrl: merged.captcha_platform_api_url,
            timeoutSec: merged.captcha_platform_timeout
        });
        if (!result.ok) {
            return res.status(400).json({ success: false, ...result });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/hcaptcha/logs', async (req, res) => {
    try {
        await ensureStoreReady();
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
        const listing = listSolverLogFiles(limit);
        const file = String(req.query.file || '').trim();
        if (file) {
            const safeName = path.basename(file);
            const target = listing.files.find((item) => item.name === safeName);
            if (!target) {
                return res.status(404).json({ success: false, message: '日志文件不存在' });
            }
            const lines = readSolverLogTail(target.path, 120);
            return res.json({ success: true, file: safeName, lines, ...listing });
        }
        const captchaRuntime = runtimeLog.tail(200).filter((e) => e.source === 'captcha' || e.level === 'captcha');
        res.json({ success: true, runtime: captchaRuntime.slice(-80), ...listing });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GPT 外包代充渠道：后台加载只读本地数据，供应商查询由管理员明确触发。
const outsourceAdmin = createGptOutsourcingAdmin({ store, client: gptApi, service: gptOutsourcing,
    ensureStoreReady, log: message => logTask('', message, 'warn') });
app.get('/api/admin/gpt-api', outsourceAdmin.getConfig);
app.post('/api/admin/gpt-api', outsourceAdmin.saveConfig);
app.post('/api/admin/gpt-api/test', outsourceAdmin.test);
app.get('/api/admin/gpt-api/status', outsourceAdmin.status);
app.get('/api/admin/gpt-api/orders', outsourceAdmin.orders);
app.post('/api/admin/gpt-api/orders/:jobKey/recheck', requireSecondaryAuth, outsourceAdmin.recheck);
app.post('/api/admin/gpt-api/orders/:jobKey/credentials', requireSecondaryAuth, outsourceAdmin.credentials);

app.post('/api/admin/config', async (req, res) => {
    try {
        await ensureStoreReady();
        const nextConfig = { ...(req.body || {}) };
        if (nextConfig.maintenance_mode) {
            nextConfig.maintenance_mode_drain = getTotalActiveJobs() > 0;
        } else {
            nextConfig.maintenance_mode_drain = false;
        }
        await store.saveConfig(nextConfig);
        res.json({ success: true, message: '所有资产配置已保存' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─── Region Selector API ────────────────────────────────────────────────────

app.get('/api/admin/region', async (req, res) => {
    try {
        await ensureStoreReady();
        const regionCode = await store.getPaymentRegion();
        const config = REGION_CONFIG[regionCode];
        res.json({
            success: true,
            region: regionCode,
            currency: config.currency,
            label: config.label,
            supported: REGION_CONFIG
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/region', async (req, res) => {
    try {
        await ensureStoreReady();
        const regionCode = String(req.body?.region || '').toUpperCase();
        if (!isSupportedRegion(regionCode)) {
            return res.status(400).json({ success: false, error: '不支持的地区代码' });
        }
        const result = await store.setPaymentRegion(regionCode);
        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error });
        }
        const config = REGION_CONFIG[regionCode];
        res.json({
            success: true,
            region: regionCode,
            currency: config.currency,
            label: config.label
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─── Checkout Link Debug API ────────────────────────────────────────────────

function checkoutDiagnosticResponse(task) {
    const report = sanitizeDiagnosticReport(parseDiagnosticOutput(task.raw_output || ''));
    let storedMedia = [];
    try {
        const parsed = typeof task.failure_screenshots === 'string'
            ? JSON.parse(task.failure_screenshots) : task.failure_screenshots;
        if (Array.isArray(parsed)) storedMedia = parsed;
    } catch (_) { /* optional media */ }
    const media = extractTaskMediaFromOutput(task.raw_output || '');
    const stored = splitTaskMediaPaths(storedMedia);
    const jobKey = task.job_key || task.jobKey;
    const captchaState = interactiveCaptchaMap.get(jobKey);
    const captcha = captchaState?.active && (!captchaState.expiresAt || Date.now() < captchaState.expiresAt) ? {
        active: true, image: captchaState.image || null, loading: Boolean(captchaState.loading),
        contentReady: captchaState.contentReady !== false, expiresAt: Number(captchaState.expiresAt || 0),
        frameSeq: Number(captchaState.frameSeq || 0), width: Number(captchaState.width || 0), height: Number(captchaState.height || 0),
        title: redactDiagnosticLogs(captchaState.title || ''), message: redactDiagnosticLogs(captchaState.message || ''),
        promptZh: redactDiagnosticLogs(captchaState.promptZh || ''), promptEn: redactDiagnosticLogs(captchaState.promptEn || '')
    } : null;
    return {
        jobKey,
        status: task.status, message: redactDiagnosticLogs(task.message || ''),
        progress: Number(task.progress || 0), execution_mode: CHECKOUT_DIAGNOSTIC_MODE,
        created_at: task.created_at || null, started_at: task.started_at || null,
        finished_at: task.finished_at || null, report,
        stages: report?.stages || report?.checks || [], checks: report?.checks || [], checkout: report?.checkout || null,
        checkout_url: report?.checkout?.url || null,
        captcha,
        raw_output: redactDiagnosticLogs(task.raw_output || ''),
        screenshots: [...new Set([...stored.screenshots, ...media.screenshots])],
        videos: [...new Set([...stored.videos, ...media.videos])]
    };
}

async function getCheckoutDiagnosticTask(jobKey) {
    const rows = await store.runQuery(
        `SELECT job_key, status, message, progress, raw_output, execution_mode,
                failure_screenshots, created_at, started_at, finished_at
         FROM task_logs WHERE job_key = ? AND execution_mode = ? LIMIT 1`,
        [jobKey, CHECKOUT_DIAGNOSTIC_MODE]
    );
    return rows[0] || null;
}

async function isCheckoutDiagnosticJob(jobKey) {
    if (checkoutDebugManager.has(jobKey)) return true;
    await ensureStoreReady();
    return Boolean(await getCheckoutDiagnosticTask(jobKey));
}

async function recoverInterruptedCheckoutDiagnostic(task) {
    if (task.execution_mode !== CHECKOUT_DIAGNOSTIC_MODE) return false;
    const previous = parseDiagnosticOutput(task.raw_output || '');
    const message = '服务重启导致诊断中断，未提交支付';
    const report = previous ? sanitizeDiagnosticReport(finishDiagnosticReport(previous, previous, {
        code: 'DIAGNOSTIC_INTERRUPTED', message, success: false,
        startedAt: previous.startedAt || task.started_at
    })) : { version: 1, code: 'DIAGNOSTIC_INTERRUPTED', message, success: false, paymentSubmitted: false };
    await store.updateTaskLog(task.job_key, {
        status: 'failed', message, paymentState: 'not_started', recoveryRequired: false,
        executionMode: CHECKOUT_DIAGNOSTIC_MODE,
        rawOutput: appendDiagnosticReport(redactDiagnosticLogs(task.raw_output || ''), report)
    });
    return true;
}

function sendCheckoutDiagnosticError(res, error) {
    return res.status(error.statusCode || 500).json({
        success: false, code: error.code || 'DIAGNOSTIC_ERROR',
        error: redactDiagnosticLogs(error.message || '诊断请求失败')
    });
}

app.get('/api/admin/checkout/plans', async (req, res) => {
    try {
        await ensureStoreReady();
        const catalog = getDiagnosticCatalog();
        const configuredRegion = String(await store.getPaymentRegion()).toUpperCase();
        const defaultRegion = catalog.regions.some(region => region.id === configuredRegion)
            ? configuredRegion : catalog.defaultRegion;
        const rechargeConfig = await store.getGptApiConfig();
        const configuredRechargeMode = rechargeConfig.enabled && Boolean(rechargeConfig.api_key)
            ? 'third_party_api' : 'local_card_pool';
        res.json({ success: true, ...catalog, defaultRegion, configuredRechargeMode });
    } catch (error) { sendCheckoutDiagnosticError(res, error); }
});

app.post('/api/admin/checkout/generate', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const body = req.body || {};
        const input = resolveDiagnosticInput({
            body, defaultRegion: await store.getPaymentRegion(),
            validateChatGpt: raw => {
                const token = normalizeSessionToken(raw);
                const tokenCheck = validateAccessToken(token);
                if (!tokenCheck.valid) throw diagnosticError('DIAGNOSTIC_CREDENTIAL_INVALID', tokenCheck.message);
                return { token, storedSession: buildStoredSessionPayload(raw, parseSessionJson(raw), token) };
            }
        });
        validateCdkPlan(input.planType, input.platform, { activation: true });
        const requestId = body.request_id == null || body.request_id === '' ? crypto.randomUUID() : String(body.request_id).trim();
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
            throw diagnosticError('DIAGNOSTIC_REQUEST_ID_INVALID', 'request_id 格式无效');
        }
        const requestKey = `${req.admin?.email || 'admin'}:${requestId}`;
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
            platform: input.platform, planType: input.planType, region: input.region, mode: input.mode,
            session: input.storedSession, token: input.token, planName: input.planNameOverride || ''
        })).digest('hex');
        const result = await checkoutDebugManager.submit(requestKey, fingerprint, async () => {
            const maintenance = await store.getMaintenanceModeState();
            if (maintenance.enabled) throw diagnosticError('MAINTENANCE', '系统维护中，请稍后再试', 503);
            const maximum = Math.max(1, Number(await store.getMaxConcurrentActivations()) || 1);
            // The check and reservation must occur together before task creation can yield.
            const reservation = `checkout-diagnostic:${crypto.randomUUID()}`;
            if (activeForegroundJobs.size >= maximum) throw diagnosticError('CONCURRENCY_LIMIT', '当前任务过多，请稍后再试', 429);
            reserveForegroundSlot(reservation);
            let task = null;
            let dispatched = false;
            try {
                task = await store.createTaskLog({
                    tokenPreview: input.tokenPreview, sessionPayload: input.storedSession,
                    cdkCode: '[checkout-diagnostic]', phone: null, cardLast4: null,
                    status: 'running', progress: 1, paymentState: 'not_started',
                    executionMode: CHECKOUT_DIAGNOSTIC_MODE
                });
                const entry = checkoutDebugManager.register(task.jobKey, input);
                reserveForegroundSlot(task.jobKey);
                releaseForegroundSlot(reservation);
                await store.updateTaskLog(task.jobKey, {
                    status: 'running', message: `Checkout 诊断：${input.platform} / ${input.planType} / ${input.region}`,
                    progress: 1, executionMode: CHECKOUT_DIAGNOSTIC_MODE,
                    rawOutput: appendDiagnosticReport('', pendingDiagnosticReport(input, entry.startedAt))
                });
                entry.promise = spawnCheckoutDebugWorker({ task, input, entry });
                dispatched = true;
                return { success: true, jobKey: task.jobKey, request_id: requestId,
                    email: input.email || null, message: 'Checkout 诊断任务已启动' };
            } catch (error) {
                if (task) {
                    checkoutDebugManager.complete(task.jobKey);
                    releaseForegroundSlot(task.jobKey);
                    await store.updateTaskLog(task.jobKey, { status: 'failed', progress: 1,
                        message: redactDiagnosticLogs(error.message), executionMode: CHECKOUT_DIAGNOSTIC_MODE }).catch(() => {});
                }
                throw error;
            } finally {
                if (!dispatched) releaseForegroundSlot(reservation);
            }
        });
        return res.json(result);
    } catch (error) { return sendCheckoutDiagnosticError(res, error); }
});

app.get('/api/admin/checkout/status/:jobKey', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const jobKey = String(req.params.jobKey || '').trim();
        if (!jobKey) throw diagnosticError('DIAGNOSTIC_JOB_INVALID', '缺少 jobKey');
        const task = await getCheckoutDiagnosticTask(jobKey);
        if (!task) throw diagnosticError('DIAGNOSTIC_NOT_FOUND', '诊断任务不存在', 404);
        res.json({ success: true, ...checkoutDiagnosticResponse(task) });
    } catch (error) { sendCheckoutDiagnosticError(res, error); }
});

app.get('/api/admin/checkout/history', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const page = Math.min(100000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
        const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 20)));
        const tasks = await store.runQuery(
            `SELECT job_key, status, message, progress, raw_output, execution_mode,
                    failure_screenshots, created_at, started_at, finished_at
             FROM task_logs WHERE execution_mode = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
            [CHECKOUT_DIAGNOSTIC_MODE, limit, (page - 1) * limit]
        );
        const counts = await store.runQuery('SELECT COUNT(*) AS total FROM task_logs WHERE execution_mode = ?', [CHECKOUT_DIAGNOSTIC_MODE]);
        res.json({ success: true, tasks: tasks.map(checkoutDiagnosticResponse), total: Number(counts[0]?.total || 0), page, limit });
    } catch (error) { sendCheckoutDiagnosticError(res, error); }
});

app.post('/api/admin/checkout/cancel/:jobKey', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const jobKey = String(req.params.jobKey || '').trim();
        if (!jobKey) throw diagnosticError('DIAGNOSTIC_JOB_INVALID', '缺少 jobKey');
        const task = await getCheckoutDiagnosticTask(jobKey);
        if (!task) throw diagnosticError('DIAGNOSTIC_NOT_FOUND', '诊断任务不存在', 404);
        const entry = checkoutDebugManager.get(jobKey);
        const cancelled = checkoutDebugManager.cancel(jobKey);
        if (entry?.promise) await entry.promise;
        res.json({ success: true, jobKey, cancelled, message: cancelled ? '诊断已取消' : '诊断任务已结束' });
    } catch (error) { sendCheckoutDiagnosticError(res, error); }
});

app.post('/api/admin/checkout/captcha-click/:jobKey', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const jobKey = String(req.params.jobKey || '').trim();
        if (!await getCheckoutDiagnosticTask(jobKey)) throw diagnosticError('DIAGNOSTIC_NOT_FOUND', '诊断任务不存在', 404);
        const { ratioX, ratioY, clientX, clientY, frameSeq, points, submitPoint, action } = req.body || {};
        if (!(Array.isArray(points) && points.length) && (!Number.isFinite(Number(ratioX)) || !Number.isFinite(Number(ratioY)))) {
            throw diagnosticError('DIAGNOSTIC_CAPTCHA_COORDINATES', '无效的验证坐标');
        }
        const handled = notifyCaptchaClick(jobKey, { ratioX, ratioY, clientX, clientY, frameSeq, points, submitPoint, action });
        res.json({ success: true, handled });
    } catch (error) { sendCheckoutDiagnosticError(res, error); }
});

app.post('/api/admin/checkout/captcha-drag/:jobKey', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const jobKey = String(req.params.jobKey || '').trim();
        if (!await getCheckoutDiagnosticTask(jobKey)) throw diagnosticError('DIAGNOSTIC_NOT_FOUND', '诊断任务不存在', 404);
        const { fromRatioX, fromRatioY, startRatioX, startRatioY, toRatioX, toRatioY, endRatioX, endRatioY, frameSeq } = req.body || {};
        const coordinates = [fromRatioX ?? startRatioX, fromRatioY ?? startRatioY, toRatioX ?? endRatioX, toRatioY ?? endRatioY].map(Number);
        if (!coordinates.every(Number.isFinite)) throw diagnosticError('DIAGNOSTIC_CAPTCHA_COORDINATES', '无效的验证坐标');
        const handled = notifyCaptchaDrag(jobKey, { fromRatioX: coordinates[0], fromRatioY: coordinates[1],
            toRatioX: coordinates[2], toRatioY: coordinates[3], frameSeq });
        res.json({ success: true, handled });
    } catch (error) { sendCheckoutDiagnosticError(res, error); }
});

// ─── Card Pool Management API ───────────────────────────────────────────────

app.get('/api/admin/cards', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const rows = await store.runQuery(
            `SELECT id, card_number, card_expiry, card_cvc, card_holder,
                    payment_holder_name, payment_address_line1, payment_address_city,
                    payment_address_state, payment_address_postal, payment_address_id,
                    is_active, usage_count, last_used_at, status, cooldown_until
             FROM card_assets
             ORDER BY sort_order ASC, id ASC`
        );
        const cards = rows.map((row) => ({
            id: row.id,
            card_number: row.card_number || '',
            card_expiry: row.card_expiry || '',
            card_cvc: row.card_cvc || '',
            last4: String(row.card_number || '').slice(-4),
            card_holder: row.card_holder || '',
            payment_holder_name: row.payment_holder_name || '',
            payment_address_line1: row.payment_address_line1 || '',
            payment_address_city: row.payment_address_city || '',
            payment_address_state: row.payment_address_state || '',
            payment_address_postal: row.payment_address_postal || '',
            payment_address_id: row.payment_address_id || null,
            is_active: Number(row.is_active || 0),
            usage_count: Number(row.usage_count || 0),
            last_used_at: row.last_used_at || null,
            status: row.status || '正常',
            cooldown_until: row.cooldown_until || null
        }));
        res.json({ success: true, cards });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/cards/import', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        let cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
        if (cards.length === 0 && typeof req.body?.text === 'string' && req.body.text.trim()) {
            const parsed = parseCardImportText(req.body.text);
            cards = parsed.cards;
        }
        if (cards.length === 0) {
            return res.status(400).json({ success: false, error: '缺少卡片数据或未解析到有效卡片' });
        }
        if (cards.length > 500) {
            return res.status(400).json({ success: false, error: '单次导入上限 500 条' });
        }

        const allowInvalidLuhn = Boolean(req.body?.allow_invalid_luhn || req.body?.skip_luhn);
        const result = await store.importCards(cards, { allowInvalidLuhn });
        res.json({ success: true, ...result });
    } catch (error) {
        if (error.message === '单次导入上限 500 条') {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/cards/:id', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const cardId = Number(req.params.id);
        if (!cardId || !Number.isFinite(cardId)) {
            return res.status(400).json({ success: false, error: '无效的卡片 ID' });
        }
        const result = await store.runExecute(
            `DELETE FROM card_assets WHERE id = ?`,
            [cardId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: '卡片不存在' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/cards/:id/reset-cooldown', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const cardId = Number(req.params.id);
        if (!cardId || !Number.isFinite(cardId)) {
            return res.status(400).json({ success: false, error: '无效的卡片 ID' });
        }
        const [card] = await store.runQuery(`SELECT id, status FROM card_assets WHERE id = ?`, [cardId]);
        if (!card) {
            return res.status(404).json({ success: false, error: '卡片不存在' });
        }
        if (card.status === '已冻结') {
            return res.status(400).json({ success: false, error: '该银行卡当前处于已冻结状态，无法重置冷却；如需使用请先解冻卡片' });
        }
        const result = await store.runExecute(
            `UPDATE card_assets
             SET cooldown_until = NULL,
                 daily_usage_count = 0,
                 status = '正常',
                 is_active = 1,
                 in_use = 0,
                 locked_at = NULL,
                 locked_by = NULL
             WHERE id = ? AND status <> '已冻结'`,
            [cardId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: '卡片不存在或已被冻结' });
        }
        res.json({ success: true, message: '卡片已重置并恢复正常可用' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/cards/:id/freeze', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const cardId = Number(req.params.id);
        if (!cardId || !Number.isFinite(cardId)) {
            return res.status(400).json({ success: false, error: '无效的卡片 ID' });
        }
        const freeze = req.body?.freeze !== false;
        const result = await store.setCardFrozen(cardId, freeze);
        if (!result.success) {
            return res.status(result.error === '卡片不存在' ? 404 : 400).json(result);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─── Proxy Pool CRUD API ────────────────────────────────────────────────────

app.get('/api/admin/proxies', async (req, res) => {
    try {
        await ensureStoreReady();
        const proxies = await store.listProxyAssets();
        res.json({ success: true, proxies });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/proxies', async (req, res) => {
    try {
        await ensureStoreReady();
        const input = req.body?.proxies ?? req.body?.proxy_url ?? req.body?.proxy ?? '';
        const result = await store.addProxyAssets(input);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/proxies/:id', async (req, res) => {
    try {
        await ensureStoreReady();
        const id = req.params.id;
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active')) {
            const result = await store.setProxyAssetActive(id, Boolean(req.body.is_active));
            if (!result.success) {
                return res.status(404).json(result);
            }
            return res.json(result);
        }
        return res.status(400).json({ success: false, error: '缺少可更新字段' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/proxies/:id/test', async (req, res) => {
    try {
        await ensureStoreReady();
        const row = await store.getProxyAssetById(req.params.id);
        if (!row) {
            return res.status(404).json({ success: false, error: '代理不存在' });
        }
        const result = await testProxyUrl(row.proxy_url);
        await store.updateProxyAssetCheck(row.id, result);
        res.json({ success: true, id: row.id, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/proxies', async (req, res) => {
    try {
        await ensureStoreReady();
        const onlyInactive = req.query?.type === 'inactive';
        const result = await store.clearProxyAssets({ onlyInactive });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/proxies/:id', async (req, res) => {
    try {
        await ensureStoreReady();
        const result = await store.deleteProxyAsset(req.params.id);
        if (!result.success) {
            return res.status(404).json(result);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─── Tax-Free Address CRUD API ──────────────────────────────────────────────

app.get('/api/admin/addresses', async (req, res) => {
    try {
        await ensureStoreReady();
        const region = String(req.query?.region || '').toUpperCase();
        if (!region) {
            return res.status(400).json({ success: false, error: '缺少 region 参数' });
        }
        const addresses = await taxFreeAddress.listAddresses(region);
        res.json({ success: true, addresses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/addresses', async (req, res) => {
    try {
        await ensureStoreReady();
        const result = await taxFreeAddress.createAddress(req.body);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/addresses/generate-random-us', async (req, res) => {
    try {
        await ensureStoreReady();
        const count = Number(req.body?.count) || 10;
        const result = await taxFreeAddress.batchGenerateUsAddresses(count);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/addresses/unbound', async (req, res) => {
    try {
        await ensureStoreReady();
        const region = String(req.query?.region || 'US').toUpperCase();
        const result = await taxFreeAddress.clearUnboundAddresses(region);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put('/api/admin/addresses/:id', async (req, res) => {
    try {
        await ensureStoreReady();
        const id = req.params.id;
        const result = await taxFreeAddress.updateAddress(id, req.body);
        if (!result.success) {
            const status = result.error === '地址模板不存在' ? 404 : 400;
            return res.status(status).json(result);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/addresses/:id', async (req, res) => {
    try {
        await ensureStoreReady();
        const id = req.params.id;
        const result = await taxFreeAddress.deleteAddress(id);
        if (!result.success) {
            return res.status(404).json(result);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/change-password', async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '').trim();

    if (!currentPassword) {
        return res.status(400).json({ success: false, message: '请输入原密码' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: '新密码至少 6 位' });
    }

    try {
        await ensureStoreReady();
        const authConfig = await store.getAdminAuthConfig();

        if (!verifyPassword(currentPassword, authConfig.passwordHash)) {
            return res.status(400).json({ success: false, message: '原密码错误' });
        }

        if (verifyPassword(newPassword, authConfig.passwordHash)) {
            return res.status(400).json({ success: false, message: '新密码不能与原密码相同' });
        }

        await store.updateAdminPassword(newPassword);
        await logAdminSecurityEvent('password_changed', {
            ...adminAuth.getClientMeta(req),
            email: req.admin?.email || authConfig.email,
            detail: '登录密码已修改'
        });
        return res.json({ success: true, message: '密码修改成功，请重新登录' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/cdks', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        res.json(await store.listCdks());
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/cdks/generate', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const count = req.body?.count;
        const planType = req.body?.plan_type || 'plus';
        const platform = req.body?.platform || (typeof getPlatformForPlan === 'function' ? getPlatformForPlan(planType) : 'chatgpt');
        const paymentRegion = req.body?.payment_region || req.body?.region || null;
        const newCdks = createCdks(count);
        const result = await store.insertCdks(newCdks, {
            type: '自助',
            plan_type: planType,
            platform,
            payment_region: paymentRegion
        });
        res.json({
            success: true,
            message: `成功生成 ${result.insertedCount} 个自助 CDK`,
            cdks: newCdks,
            insertedCount: result.insertedCount,
            plan_type: planType,
            platform,
            payment_region: paymentRegion
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/cdks/import', requireSecondaryAuth, async (req, res) => {
    const cdks = Array.isArray(req.body?.cdks) ? req.body.cdks : [];
    if (cdks.length === 0) {
        return res.status(400).json({ success: false, message: '请提供要导入的卡密' });
    }

    try {
        await ensureStoreReady();
        const planType = req.body?.plan_type || 'plus';
        const platform = req.body?.platform || (typeof getPlatformForPlan === 'function' ? getPlatformForPlan(planType) : 'chatgpt');
        const paymentRegion = req.body?.payment_region || req.body?.region || null;
        const summary = await store.insertCdks(cdks, {
            type: '自助',
            plan_type: planType,
            platform,
            payment_region: paymentRegion
        });
        res.json({
            success: true,
            message: `导入完成，新增 ${summary.insertedCount} 个，重复 ${summary.duplicateCount} 个`,
            ...summary
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/cdks/:cdk/ship', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        const updated = await store.markCdkShipped(req.params.cdk);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'CDK 不存在' });
        }
        res.json({ success: true, message: 'CDK 已标记出库' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/cdks/:cdk', requireSecondaryAuth, async (req, res) => {
    try {
        await ensureStoreReady();
        await store.deleteCdk(req.params.cdk);
        res.json({ success: true, message: 'CDK 已删除' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─── Billing Records API ─────────────────────────────────────────────────────

app.get('/api/admin/billing', async (req, res) => {
    try {
        await ensureStoreReady();
        const filters = {};
        if (req.query.start_date) filters.startDate = req.query.start_date;
        if (req.query.end_date) filters.endDate = req.query.end_date;
        if (req.query.card_last4) filters.cardLast4 = req.query.card_last4;
        if (req.query.plan_type) filters.planType = req.query.plan_type;
        if (req.query.status) filters.status = req.query.status;
        const page = Math.max(1, Number(req.query.page) || 1);
        const result = await store.listBillingRecords(filters, page, 20);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/billing/export', async (req, res) => {
    try {
        await ensureStoreReady();
        const filters = {};
        if (req.query.start_date) filters.startDate = req.query.start_date;
        if (req.query.end_date) filters.endDate = req.query.end_date;
        if (req.query.card_last4) filters.cardLast4 = req.query.card_last4;
        if (req.query.plan_type) filters.planType = req.query.plan_type;
        if (req.query.status) filters.status = req.query.status;
        const csv = await store.exportBillingRecordsCSV(filters);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="billing_export.csv"');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/billing/summary/:cardLast4', async (req, res) => {
    try {
        await ensureStoreReady();
        const cardLast4 = String(req.params.cardLast4 || '');
        const summary = await store.getCardBillingSummary(cardLast4);
        res.json({ success: true, ...summary });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/billing/failed', async (req, res) => {
    try {
        await ensureStoreReady();
        const deleted = await store.deleteFailedBillingRecords();
        res.json({ success: true, deleted });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/billing/:id', async (req, res) => {
    try {
        await ensureStoreReady();
        const id = Number(req.params.id);
        if (!id) {
            return res.status(400).json({ success: false, message: '无效的记录 ID' });
        }
        const ok = await store.deleteBillingRecord(id);
        if (!ok) {
            return res.status(404).json({ success: false, message: '账单记录不存在' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


async function syncBrowserPoolModeFromStore() {
    const enabled = await store.getBrowserPoolEnabled();
    browserPool.setRuntimeEnabled(enabled);
    if (!enabled) {
        await browserPool.shutdownBrowserPool().catch(() => {});
        return { enabled: false, initialized: false, size: 0, mode: 'standalone' };
    }
    const info = await browserPool.initBrowserPool();
    return { ...info, mode: 'pool' };
}

async function spawnWorkerWithBrowser({ jobKey, runtimeEnv, runScript, signal = null }) {
    throwIfDiagnosticAborted(signal);
    const poolEnabled = browserPool.getRuntimeEnabled();
    if (!poolEnabled) {
        logTask(jobKey, '浏览器模式: 独立启动（后台已关闭浏览器池）');
        throwIfDiagnosticAborted(signal);
        return runScript(buildWorkerRuntimeEnv(runtimeEnv, null, 'standalone'));
    }
    const operation = browserPool.withBrowserSlot(jobKey, async (poolSlot) => {
        // A cancelled queued request must never launch a child after its slot arrives.
        throwIfDiagnosticAborted(signal);
        if (poolSlot) logTask(jobKey, `浏览器模式: 池 slot=${poolSlot.slotId}`);
        else logTask(jobKey, '浏览器模式: 池未就绪，回退独立启动');
        const mode = poolSlot ? 'pool' : 'standalone';
        return runScript(buildWorkerRuntimeEnv(runtimeEnv, poolSlot, mode));
    }, signal);
    // Await active children so they finish shutting down before their slot is released.
    // The pool receives the signal to remove queued waiters immediately.
    return operation;
}

async function spawnCheckoutDebugWorker({ task, input, entry }) {
    const { jobKey } = task;
    const signal = entry.controller.signal;
    const startedAt = entry.startedAt;
    const secrets = [input.token, input.storedSession];
    let latestReport = null;
    let liveOutput = '';
    let progressWrites = Promise.resolve();
    let pendingProgress = null;
    let progressTimer = null;
    let lastProgressReport = '';
    let lastProgressWriteAt = 0;
    let progressWriteError = null;
    let progressClosed = false;
    const readReport = output => {
        const report = parseDiagnosticOutput(output);
        return report && ['platform', 'planType', 'region', 'mode'].every(key => report[key] === input[key]) ? report : null;
    };
    const persist = async (report, status, rawOutput, media = { screenshots: [], videos: [] }) => {
        const cleanReport = sanitizeDiagnosticReport(report, secrets);
        const output = redactDiagnosticLogs(rawOutput, secrets);
        await store.updateTaskLog(jobKey, {
            status, message: redactDiagnosticLogs(cleanReport?.message || 'Checkout 诊断进行中', secrets),
            rawOutput: appendDiagnosticReport(output, cleanReport), progress: diagnosticProgress(cleanReport),
            executionMode: CHECKOUT_DIAGNOSTIC_MODE, failureScreenshots: [...media.screenshots, ...media.videos],
            paymentState: 'not_started', recoveryRequired: false
        });
    };
    const closeProgress = () => {
        progressClosed = true;
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = null;
    };
    const saveProgress = (force = false) => {
        if (progressClosed || signal.aborted || !pendingProgress) return;
        const reportKey = JSON.stringify(pendingProgress.report);
        const elapsed = Date.now() - lastProgressWriteAt;
        if (!force && reportKey === lastProgressReport && elapsed < 500) {
            if (!progressTimer) progressTimer = setTimeout(() => {
                progressTimer = null;
                saveProgress(true);
            }, 500 - elapsed);
            return;
        }
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = null;
        lastProgressReport = reportKey;
        lastProgressWriteAt = Date.now();
        const { report, output } = pendingProgress;
        progressWrites = progressWrites.then(async () => {
            if (signal.aborted) return;
            await persist(report, 'running', output, extractTaskMediaFromOutput(output));
        }).catch(error => { progressWriteError = error; });
    };
    try {
        throwIfDiagnosticAborted(signal);
        const proxy = await waitForDiagnosticAbort(store.getActiveProxy(input.region), signal);
        const hcaptchaCfg = await waitForDiagnosticAbort(store.getHcaptchaConfig(), signal);
        const { env: hcaptchaEnv } = buildHcaptchaEnvFromConfig(hcaptchaCfg);
        throwIfDiagnosticAborted(signal);
        const runtimeEnv = buildDiagnosticRuntimeEnv(input, { ...process.env, ...hcaptchaEnv, PROXY: proxy }, jobKey);
        logTask(jobKey, `启动 Checkout 诊断 platform=${input.platform} plan=${input.planType} region=${input.region} mode=${input.mode}`);
        const run = await spawnWorkerWithBrowser({
            jobKey, runtimeEnv, signal,
            runScript: workerEnv => runCheckoutScript(jobKey, path.join(__dirname, 'index.js'), workerEnv, 1,
                (_progress, output) => {
                    liveOutput = output;
                    const report = readReport(output);
                    if (report) latestReport = report;
                    // Never persist a partial final line: a credential split across
                    // stdout chunks must be fully available to the redactor first.
                    if (report) {
                        pendingProgress = { report, output: output.slice(0, output.lastIndexOf('\n') + 1) };
                        saveProgress();
                    }
                    return progressWrites;
                }, null, signal)
        });
        liveOutput = run.output || liveOutput;
        closeProgress();
        await progressWrites;
        if (progressWriteError) throw progressWriteError;
        latestReport = readReport(liveOutput) || latestReport;
        const aborted = signal.aborted || run.aborted;
        const success = !aborted && !run.timedOut && run.code === 0 && latestReport?.success === true;
        const code = aborted ? 'DIAGNOSTIC_CANCELLED' : run.timedOut ? 'DIAGNOSTIC_TIMEOUT'
            : success ? latestReport.code : run.code !== 0 && latestReport?.success !== false
                ? 'DIAGNOSTIC_PROCESS_FAILED' : latestReport?.code || 'DIAGNOSTIC_REPORT_MISSING';
        const message = aborted ? '诊断已取消' : run.timedOut ? '诊断超时，未提交支付'
            : run.code !== 0 && latestReport?.success !== false ? '诊断进程异常退出，未提交支付'
                : latestReport?.message || (success ? 'Checkout 诊断完成，未提交支付' : '诊断失败或未返回有效完成报告，未提交支付');
        const report = finishDiagnosticReport(latestReport, input, { code, message, success, startedAt });
        await persist(report, aborted ? 'cancelled' : success ? 'success' : 'failed', liveOutput, extractTaskMediaFromOutput(liveOutput));
        logTask(jobKey, `Checkout 诊断结束 status=${success ? 'success' : 'failed'} code=${code || '-'} paymentSubmitted=false`);
    } catch (error) {
        closeProgress();
        await progressWrites.catch(() => {});
        const aborted = signal.aborted || error.code === 'DIAGNOSTIC_CANCELLED';
        const message = aborted ? '诊断已取消' : redactDiagnosticLogs(error.message, secrets);
        const report = finishDiagnosticReport(latestReport, input, {
            code: aborted ? 'DIAGNOSTIC_CANCELLED' : error.code || 'DIAGNOSTIC_RUNTIME_ERROR',
            message, success: false, startedAt
        });
        logTask(jobKey, `Checkout 诊断异常: ${message}`, 'error');
        try { await persist(report, aborted ? 'cancelled' : 'failed', liveOutput, extractTaskMediaFromOutput(liveOutput)); }
        catch (persistError) { logTask(jobKey, `诊断结果保存失败: ${redactDiagnosticLogs(persistError.message, secrets)}`, 'error'); }
    } finally {
        closeProgress();
        const captcha = interactiveCaptchaMap.get(jobKey);
        if (captcha) {
            for (const waiter of captcha.waitingRequests || []) {
                clearTimeout(waiter.timer);
                try { if (!waiter.res.headersSent) waiter.res.json({ success: false, cancelled: true }); } catch (_) { /* disconnected client */ }
            }
            interactiveCaptchaMap.delete(jobKey);
        }
        checkoutDebugManager.complete(jobKey);
        releaseForegroundSlot(jobKey);
    }
}

// GPT 外包代充渠道：资金状态与供应商协议在独立组件中处理。
async function runGptApiWorker(input) {
    try {
        await gptOutsourcing.run(input);
    } finally {
        releaseForegroundSlot(input.task.jobKey);
        if (getTotalActiveJobs() === 0) {
            const maintenance = await store.getMaintenanceModeState();
            if (maintenance.enabled && maintenance.drain) await store.setMaintenanceModeState(true, false);
        }
    }
}

let outsourceRecoveryRunning = false;
let outsourceRecoveryOffset = 0;
async function recoverGptOutsourcingAttempts() {
    if (outsourceRecoveryRunning) return;
    outsourceRecoveryRunning = true;
    try {
        const rows = await store.getGptApiPendingAttempts();
        if (!rows.length) { outsourceRecoveryOffset = 0; return; }
        const start = outsourceRecoveryOffset % rows.length;
        const batch = rows.slice(start).concat(rows.slice(0, start)).slice(0, 10);
        outsourceRecoveryOffset = (start + batch.length) % rows.length;
        for (const row of batch) {
            const jobKey = row.job_key;
            if (gptOutsourcing.isBusy(jobKey)) continue;
            try {
                const attempt = row.attempt || {};
                if (attempt.version !== 1) {
                    if (row.status === 'running') await store.updateTaskLog(jobKey, { status: 'manual',
                        message: '历史外包订单缺少绑定信息，结果待确认，请人工核对',
                        paymentState: 'unknown', recoveryRequired: true });
                    continue;
                }
                // Recovery reads original orders only. It never calls submitPay
                // or supplies credentials, even after a lost submit response.
                await gptOutsourcing.recheck(jobKey);
            } catch (error) {
                logTask(jobKey, '外包原订单恢复核查未完成，保留资产等待下次核查', 'warn');
            }
        }
    } catch (error) {
        logTask('', '外包订单恢复查询暂不可用，保留原订单和资产', 'warn');
    } finally { outsourceRecoveryRunning = false; }
}

function spawnActivationWorker({ task, token, sessionRaw, cdk, cdkDetails, clientIp }) {
    (async () => {
        const checkoutScript = path.join(__dirname, 'index.js');
        let finalRun = null;
        const allOutputs = [];
        let shouldRollbackCdk = true;
        let observedPaymentState = 'not_started';
        let lastProgress = 0;
        const accountEmail = extractEmailFromSession(sessionRaw) || '';
        const platform = getPlatformForPlan(cdkDetails.plan_type);
        let lastUsedProxy = '';

        try {
            for (let attempt = 1; attempt <= MAX_PROCESS_ATTEMPTS; attempt += 1) {
                logTask(task.jobKey, `开始第 ${attempt}/${MAX_PROCESS_ATTEMPTS} 次尝试`);

                const attemptProgress = normalizeTaskProgress(attempt > 1 ? 1 : 3, 'running', lastProgress);
                broadcastToTask(task.jobKey, {
                    type: 'progress',
                    jobKey: task.jobKey,
                    progress: attemptProgress,
                    status: 'running',
                    message: `正在进行第 ${attempt} 次尝试...`,
                    cdkCode: cdk
                });

                const targetRegion = String(task.paymentRegion || cdkDetails?.payment_region || '').trim().toUpperCase() || await store.getPaymentRegion();
                let proxy = await store.getActiveProxy(targetRegion);
                if (proxy) {
                    const { alignProxyRegion } = require('./playwright-proxy');
                    proxy = alignProxyRegion(proxy, targetRegion);
                }
                lastUsedProxy = proxy || lastUsedProxy;
                const hcaptchaCfg = await store.getHcaptchaConfig();
                const { env: hcaptchaEnv } = buildHcaptchaEnvFromConfig(hcaptchaCfg);
                const runtimeEnv = {
                    ...process.env,
                    ...hcaptchaEnv,
                    JOB_KEY: task.jobKey,
                    ...buildActivationCredentialEnv({ platform, token, sessionRaw }),
                    CDK_CODE: cdk,
                    CDK_PLAN_TYPE: cdkDetails.plan_type || 'plus',
                    PAYMENT_REGION_OVERRIDE: targetRegion,
                    PROXY: proxy
                };

                logTask(task.jobKey, `尝试 ${attempt} 启动自动化 proxy=${proxy ? 'yes' : 'no'} 地区=${targetRegion}`);

                const run = await spawnWorkerWithBrowser({
                    jobKey: task.jobKey,
                    runtimeEnv,
                    runScript: (workerEnv) => runCheckoutScript(task.jobKey, checkoutScript, workerEnv, attempt, async (progress, liveOutput) => {
                        if (progress > 0) {
                            const runningProgress = normalizeTaskProgress(progress, 'running', lastProgress);
                            lastProgress = runningProgress;
                            const updatePayload = {
                                status: 'running',
                                message: '正在开通中',
                                rawOutput: null,
                                cdkCode: cdk,
                                progress: runningProgress
                            };
                            if (liveOutput) {
                                const liveMedia = extractTaskMediaFromOutput(liveOutput);
                                const combined = [...liveMedia.screenshots, ...liveMedia.videos];
                                if (combined.length) {
                                    updatePayload.failureScreenshots = combined;
                                }
                            }
                            await store.updateTaskLog(task.jobKey, updatePayload);
                            broadcastToTask(task.jobKey, {
                                type: 'progress',
                                jobKey: task.jobKey,
                                progress: runningProgress,
                                status: 'running',
                                message: '正在开通中',
                                cdkCode: cdk,
                                screenshots: liveOutput ? extractTaskMediaFromOutput(liveOutput).screenshots : undefined,
                                videos: liveOutput ? extractTaskMediaFromOutput(liveOutput).videos : undefined
                            });
                        }
                    }, async (state, message) => {
                        observedPaymentState = normalizePaymentState(state);
                        await store.updateTaskLog(task.jobKey, {
                            status: state === 'unknown' ? 'manual' : 'running',
                            message: message || (state === 'started' ? '正在提交银行卡支付' : '支付状态已更新'),
                            cdkCode: cdk,
                            paymentState: state,
                            recoveryRequired: ['started', 'unknown'].includes(normalizePaymentState(state))
                        });
                    })
                });

                const cardLast4 = extractCardLast4FromOutput(run.output);
                allOutputs.push(`===== ATTEMPT ${attempt}${cardLast4 ? ` | CARD ${cardLast4}` : ''} =====\n${run.output}`);
                finalRun = { ...run, output: allOutputs.join('\n\n') };
                const attemptPaymentState = normalizePaymentState(
                    run.analysis.paymentState
                    || (run.output.match(/PAYMENT_STATE:(not_started|started|succeeded|declined|unknown)/g)?.slice(-1)[0]?.split(':')[1])
                    || (run.output.includes('支付结果未知') ? 'unknown' : 'not_started')
                );
                observedPaymentState = attemptPaymentState;
                if (attemptPaymentState) {
                    await store.updateTaskLog(task.jobKey, {
                        status: run.analysis.status === 'success' ? 'success' : 'running',
                        paymentState: attemptPaymentState,
                        recoveryRequired: ['started', 'unknown'].includes(normalizePaymentState(attemptPaymentState)),
                        cdkCode: cdk,
                        cardLast4
                    });
                }
                if (attemptPaymentState === 'unknown') {
                    logTask(task.jobKey, '支付结果未知，停止后续自动重试并转人工复核', 'warn');
                }

                const currentStatus = run.analysis.status === 'success' ? 'success' : 'running';
                const currentProgress = normalizeTaskProgress(
                    getCheckoutProgress(run.output, currentStatus),
                    currentStatus,
                    lastProgress
                );
                lastProgress = currentProgress;
                await store.updateTaskLog(task.jobKey, {
                    status: currentStatus,
                    message: currentStatus === 'success' ? '激活成功' : (attemptPaymentState === 'unknown' ? '支付结果未确认，转人工复核' : '正在开通中'),
                    rawOutput: finalRun.output,
                    progress: currentProgress,
                    cdkCode: cdk,
                    cardLast4,
                    paymentState: attemptPaymentState,
                    recoveryRequired: ['started', 'unknown'].includes(normalizePaymentState(attemptPaymentState))
                });

                broadcastToTask(task.jobKey, {
                    type: 'progress',
                    jobKey: task.jobKey,
                    progress: currentProgress,
                    status: currentStatus,
                    message: currentStatus === 'success' ? '激活成功' : '正在开通中',
                    cdkCode: cdk,
                    cardLast4
                });

                if (shouldRetainCdk({ paymentState: attemptPaymentState }) || !run.analysis.shouldRetry || attempt >= MAX_PROCESS_ATTEMPTS) {
                    logTask(task.jobKey, `尝试 ${attempt} 结束，status=${run.analysis.status} shouldRetry=${run.analysis.shouldRetry}`);
                    break;
                }
                logTask(task.jobKey, `尝试 ${attempt} 失败，准备重试`, 'warn');
            }

            const rawOutput = finalRun?.output || '';
            const normalizedAnalysis = finalizeRetryAnalysis(finalRun?.analysis);
            const outputPaymentState = rawOutput.match(/PAYMENT_STATE:(not_started|started|succeeded|declined|unknown)/g)?.slice(-1)[0]?.split(':')[1]
                || (rawOutput.includes('支付结果未知') ? 'unknown' : 'not_started');
            const finalPaymentState = mergePaymentState(
                outputPaymentState,
                normalizedAnalysis?.paymentState || 'not_started'
            );
            const finalStatus = ['started', 'unknown'].includes(finalPaymentState)
                ? 'manual'
                : (normalizedAnalysis?.status || 'failed');
            observedPaymentState = finalPaymentState;
            if (shouldRetainCdk({ paymentState: finalPaymentState })) {
                shouldRollbackCdk = false;
            }

            const finalProgress = normalizeTaskProgress(finalStatus === 'success' ? 100 : lastProgress, finalStatus, lastProgress);
            const taskMedia = extractTaskMediaFromOutput(rawOutput);
            const failureScreenshots = [...taskMedia.screenshots, ...taskMedia.videos];
            await store.updateTaskLog(task.jobKey, {
                status: finalStatus,
                message: normalizedAnalysis?.message || null,
                rawOutput,
                cdkCode: cdk,
                progress: finalProgress,
                failureScreenshots,
                paymentState: finalPaymentState || 'not_started',
                recoveryRequired: ['started', 'unknown'].includes(normalizePaymentState(finalPaymentState))
            });

            broadcastToTask(task.jobKey, {
                type: 'status',
                jobKey: task.jobKey,
                status: finalStatus,
                message: normalizedAnalysis?.message,
                paymentState: finalPaymentState,
                recoveryRequired: ['started', 'unknown'].includes(finalPaymentState),
                cdkCode: cdk,
                progress: finalProgress,
                screenshots: taskMedia.screenshots,
                videos: taskMedia.videos
            });

            logTask(
                task.jobKey,
                `任务结束 status=${finalStatus} progress=${finalProgress} message=${normalizedAnalysis?.message || ''}`
            );

            if (finalStatus === 'success') {
                shouldRollbackCdk = false;
                let needsManualReview = false;
                if (task.executionMode === 'local_card_pool' || !task.executionMode) {
                    let autoRenewResult;
                    try {
                        const workerAutoRenew = extractAutoRenewResultFromOutput(rawOutput);
                        if (workerAutoRenew) {
                            autoRenewResult = workerAutoRenew;
                        } else if (platform === 'chatgpt') {
                            autoRenewResult = await cancelAutoRenew(token, {
                                email: accountEmail,
                                timezoneOffsetMin: -new Date().getTimezoneOffset(),
                                proxy: lastUsedProxy
                            });
                        } else {
                            autoRenewResult = {
                                ok: false,
                                data: { verificationUnknown: true },
                                error: `${platform} 充值已完成，自动续费状态需人工核实`
                            };
                        }
                    } catch (error) {
                        autoRenewResult = {
                            ok: false,
                            error: `取消自动续费请求异常：${redactSensitiveText(error.message)}`,
                            data: { verificationUnknown: true }
                        };
                    }
                    const autoRenewData = autoRenewResult.data || {};
                    const autoRenewClass = classifyAutoRenewCancellation(autoRenewResult);
                    const autoRenewStatus = autoRenewClass === 'already_disabled' ? 'disabled'
                        : (autoRenewClass === 'verification_unknown' ? 'verification_unknown' : 'failed');
                    const autoRenewConfirmed = autoRenewStatus === 'disabled';
                    const autoRenewMessage = autoRenewConfirmed
                        ? '充值完成，自动续费已确认关闭'
                        : (autoRenewData.message || autoRenewResult.error || '充值成功，但自动续费关闭状态未确认，请人工复核');
                    needsManualReview = !autoRenewConfirmed;
                    await store.updateTaskLog(task.jobKey, {
                        status: needsManualReview ? 'manual' : 'success',
                        message: needsManualReview ? '充值已完成，但自动续费关闭状态未确认，请联系客服人工复核' : '激活成功',
                        autoRenewStatus,
                        autoRenewMessage,
                        paymentState: 'succeeded',
                        recoveryRequired: needsManualReview
                    });
                    logTask(task.jobKey, `自动续费处理结果=${autoRenewStatus}`, autoRenewConfirmed ? 'info' : 'warn');
                    if (needsManualReview) {
                        notifyTaskOutcome({
                            event: 'failure',
                            email: accountEmail,
                            cdk,
                            jobKey: task.jobKey,
                            message: '充值已完成，但自动续费关闭状态未确认，请联系客服人工复核'
                        });
                    }
                }
                if (!needsManualReview) {
                    await store.resetCdkFailure(cdk);
                }
                if (clientIp && !needsManualReview) {
                    await store.resetActivationAttemptFailure('ip', clientIp);
                }
                if (!needsManualReview) {
                    notifyTaskOutcome({
                        event: 'success',
                        email: accountEmail,
                        cdk,
                        jobKey: task.jobKey,
                        message: normalizedAnalysis?.message || '激活成功'
                    });
                }
            } else if (isCardPoolExhaustedIssue(rawOutput, normalizedAnalysis)) {
                notifyTaskOutcome({
                    event: 'card_pool_empty',
                    email: accountEmail,
                    cdk,
                    jobKey: task.jobKey,
                    message: normalizedAnalysis?.message || '卡池资产枯竭'
                });
            } else if (finalStatus === 'failed' || finalStatus === 'manual') {
                notifyTaskOutcome({
                    event: 'failure',
                    email: accountEmail,
                    cdk,
                    jobKey: task.jobKey,
                    message: normalizedAnalysis?.message || '激活失败'
                });
            }

            if (finalStatus !== 'success' && shouldRollbackCdk && finalPaymentState !== 'unknown') {
                await store.markCdkUnused(cdk);
                logTask(task.jobKey, `CDK ${cdk} 已回滚为未使用`);
            } else if (shouldRetainCdk({ paymentState: finalPaymentState })) {
                logTask(task.jobKey, `CDK ${cdk} 保留，等待人工核对支付结果`, 'warn');
            }

            if (isNoActivationEligibilityMessage(normalizedAnalysis?.message)) {
                const cdkCooledDown = await store.recordCdkFailure(cdk);
                const ipCooledDown = clientIp
                    ? await store.recordActivationAttemptFailure('ip', clientIp)
                    : false;

                if (cdkCooledDown || ipCooledDown) {
                    const cooldownParts = [];
                    if (cdkCooledDown) {
                        cooldownParts.push('该 CDK 已冷却 10 分钟');
                        logTask(task.jobKey, `CDK ${cdk} 因连续无资格提交进入 10 分钟冷却`, 'warn');
                    }
                    if (ipCooledDown) {
                        cooldownParts.push(`IP ${clientIp} 已冷却 10 分钟`);
                        logTask(task.jobKey, `IP ${clientIp} 因连续无资格提交进入 10 分钟冷却`, 'warn');
                    }
                    const cooldownMessage = `${normalizedAnalysis?.message || '该账号无激活权限,请更换账号重试'}（${cooldownParts.join('，')}）`;
                    await store.updateTaskLog(task.jobKey, {
                        status: finalStatus,
                        message: cooldownMessage,
                        rawOutput,
                        cdkCode: cdk,
                        progress: finalProgress
                    });
                    broadcastToTask(task.jobKey, {
                        type: 'status',
                        jobKey: task.jobKey,
                        status: finalStatus,
                        message: cooldownMessage,
                        cdkCode: cdk,
                        progress: finalProgress
                    });
                }
            }
        } catch (bgError) {
            logTask(task.jobKey, `后台任务异常: ${redactSensitiveText(bgError.message)}`, 'error');
            let retainCdk = !shouldRollbackCdk || shouldRetainCdk({ paymentState: observedPaymentState });
            try {
                const latestTask = await store.getTaskStatus(task.jobKey);
                retainCdk = retainCdk || (latestTask && shouldRetainCdk({ paymentState: latestTask.payment_state }))
                    || Boolean(latestTask?.recovery_required);
            } catch (_) { retainCdk = true; }
            const status = retainCdk ? 'manual' : 'failed';
            const paymentState = retainCdk && observedPaymentState === 'not_started' ? 'unknown' : observedPaymentState;
            const message = retainCdk ? '支付结果未确认，已保留 CDK 与银行卡，需人工复核' : bgError.message;
            const update = { status, message, rawOutput: redactSensitiveText(bgError.message), cdkCode: cdk,
                paymentState, recoveryRequired: retainCdk, progress: normalizeTaskProgress(lastProgress, status, lastProgress) };
            await reportTaskFailure({
                persist: () => store.updateTaskLog(task.jobKey, update),
                report: () => {
                    broadcastToTask(task.jobKey, { ...update, type: 'status', jobKey: task.jobKey });
                    notifyTaskOutcome({ event: 'failure', email: accountEmail, cdk, jobKey: task.jobKey, message });
                },
                cleanup: async () => {
                    if (!retainCdk) {
                        await store.markCdkUnused(cdk);
                        logTask(task.jobKey, `CDK ${cdk} 已回滚为未使用`);
                    } else {
                        logTask(task.jobKey, `CDK ${cdk} 保留，等待人工复核`, 'warn');
                    }
                },
                onSecondaryError: (stage, error) => logTask(task.jobKey,
                    `异常处理 ${stage} 未完成: ${redactSensitiveText(error.message)}`, 'error')
            });
        } finally {
            releaseForegroundSlot(task.jobKey);
            if (getTotalActiveJobs() === 0) {
                const maintenanceModeState = await store.getMaintenanceModeState();
                if (maintenanceModeState.enabled && maintenanceModeState.drain) {
                    await store.setMaintenanceModeState(true, false);
                }
            }
        }
    })();
}

async function handleActivationRequest(req, res) {
    const rawSession = String(req.body?.session || req.body?.token || '').trim();
    const cdk = String(req.body?.cdk || '').trim();
    const clientIp = getClientIp(req);
    console.log(`[Activation] 收到开通请求 path=${req.path} cdk=${cdk}`);
    if (!rawSession) {
        return res.status(400).json({ success: false, message: '缺少登录凭证或 Session' });
    }
    if (!cdk) {
        return res.status(400).json({ success: false, message: '缺少 CDK' });
    }
    let ownsCdkLock = false;
    let workerDispatched = false;
    let activationStage = 'request_received';
    const rejectActivation = (statusCode, code, message) => {
        logTask('', `充值请求未启动 stage=${activationStage} code=${code} cdk=${cdk}`, 'warn');
        return res.status(statusCode).json({ success: false, message });
    };
    try {
        activationStage = 'store_ready';
        await ensureStoreReady();
        activationStage = 'maintenance_check';
        const maintenanceModeState = await store.getMaintenanceModeState();
        if (maintenanceModeState.enabled) {
            return rejectActivation(503, 'MAINTENANCE', '系统维护中，请稍后再试');
        }
        activationStage = 'concurrency_check';
        const maxConcurrentActivations = await store.getMaxConcurrentActivations();
        if (activeForegroundJobs.size >= maxConcurrentActivations) {
            return rejectActivation(429, 'CONCURRENCY_LIMIT', '当前任务过多，请稍后再试');
        }

        activationStage = 'cdk_lookup';
        const cdkDetails = await store.verifyCdkDetails(cdk);
        const runningTask = cdkDetails ? await store.getRunningTaskByCdk(cdk) : null;
        if (runningTask) {
            return res.json({
                success: true,
                jobKey: runningTask.job_key,
                message: '该 CDK 正在开通中，已为您恢复等待进度'
            });
        }
        if (!cdkDetails || cdkDetails.used_at || cdkDetails.type !== '自助') {
            return rejectActivation(403, 'CDK_UNAVAILABLE', 'CDK 无效、已使用或非自助激活码');
        }

        activationStage = 'credential_validation';
        const { platform, planType, token, storedSession, tokenPreview } = resolveActivationInput({
            cdkDetails,
            requestedPlatform: req.body?.platform,
            rawSession,
            validateChatGpt: raw => {
                const token = normalizeSessionToken(raw);
                const tokenCheck = validateAccessToken(token);
                if (!tokenCheck.valid) throw Object.assign(new Error(tokenCheck.message), { statusCode: 400 });
                return { token, storedSession: buildStoredSessionPayload(raw, parseSessionJson(raw), token) };
            }
        });

        activationStage = 'eligibility_check';
        const cdkCooldownMinutes = getRemainingCooldownMinutes(cdkDetails.cooldown_until);
        if (cdkCooldownMinutes > 0) {
            return rejectActivation(403, 'CDK_COOLDOWN', `该卡密连续无资格尝试过多，请冷静 ${cdkCooldownMinutes} 分钟后再试`);
        }

        if (clientIp) {
            activationStage = 'ip_attempt_limit';
            const ipAttemptLimit = await store.getActivationAttemptLimit('ip', clientIp);
            const ipCooldownMinutes = getRemainingCooldownMinutes(ipAttemptLimit?.cooldown_until);
            if (ipCooldownMinutes > 0) {
                return rejectActivation(403, 'IP_COOLDOWN', `当前 IP 连续无资格尝试过多，请冷静 ${ipCooldownMinutes} 分钟后再试`);
            }
        }

        // GPT 外包代充渠道仅影响 GPT；其它平台继续使用本地卡池。
        activationStage = 'payment_mode_check';
        const gptApiConfig = platform === 'chatgpt' ? await store.getGptApiConfig() : { enabled: false };
        const useGptApi = platform === 'chatgpt' && gptApiConfig.enabled;
        const executionMode = useGptApi ? 'third_party_api' : 'local_card_pool';

        // Validate the selected outsourced channel before locking the CDK or
        // creating a task. An enabled but incomplete channel must fail closed;
        // silently switching to local card payment would route funds through a
        // different provider than the administrator selected.
        if (useGptApi) {
            let normalizedOutsource;
            try {
                normalizedOutsource = validateOutsourceConfig(gptApiConfig);
                const canonicalPlan = canonicalizeOutsourcePlan(planType);
                if (!normalizedOutsource.plan_mapping[canonicalPlan]) {
                    const error = new Error('当前 GPT 套餐尚未配置外包商品映射');
                    error.code = 'GPT_OUTSOURCE_MAPPING_MISSING';
                    error.statusCode = 503;
                    throw error;
                }
            } catch (error) {
                const code = /^GPT_OUTSOURCE_/.test(String(error.code || ''))
                    ? error.code : 'GPT_OUTSOURCE_CONFIG_INVALID';
                logTask('', `GPT 外包渠道未就绪 code=${code}`, 'error');
                return rejectActivation(503, code, formatTaskErrorMessage('failed', 'GPT 外包代充渠道尚未配置完成'));
            }
        }

        if (!useGptApi) {
            activationStage = 'card_pool_check';
            const hasCard = await store.hasAvailableCard();
            if (!hasCard) {
                const poolEmail = extractEmailFromSession(rawSession);
                fireTelegramNotification('card_pool_empty', {
                    email: poolEmail,
                    cdk,
                    message: '银行卡池暂无可用卡片，任务未启动'
                });
                return rejectActivation(503, 'CARD_POOL_UNAVAILABLE', formatTaskErrorMessage('failed', '卡池暂无可用卡片'));
            }
        }

        activationStage = 'cdk_lock';
        const lockSuccess = await store.markCdkUsed(cdk);
        if (!lockSuccess) {
            return rejectActivation(403, 'CDK_LOCK_UNAVAILABLE', 'CDK 不可用或正在被他人使用');
        }
        ownsCdkLock = true;

        activationStage = 'task_create';
        const task = await store.createTaskLog({
            tokenPreview,
            sessionPayload: storedSession,
            cdkCode: cdk,
            phone: null,
            cardLast4: null,
            status: 'running',
            progress: 3,
            executionMode
        });
        Object.assign(task, { executionMode, tokenPreview, platform, planType });

        logTask(task.jobKey, `任务已创建，CDK=${cdk} mode=${executionMode}`);
        reserveForegroundSlot(task.jobKey);

        activationStage = 'worker_dispatch';
        if (useGptApi) {
            runGptApiWorker({ task, token, session: JSON.parse(storedSession), cdk, planType }).catch((error) => {
                console.error(`[GPT API Worker] ${task.jobKey}:`, error);
            });
        } else {
            spawnActivationWorker({ task, token, sessionRaw: storedSession, cdk, cdkDetails, clientIp });
        }
        workerDispatched = true;

        return res.json({
            success: true,
            jobKey: task.jobKey,
            message: '任务已启动，正在为您开通中...'
        });
    } catch (error) {
        if (ownsCdkLock && !workerDispatched) {
            try { await store.markCdkUnused(cdk); } catch (_) { }
        }
        const safeError = redactSensitiveText(error.message);
        logTask('', `启动充值失败 stage=${activationStage} code=${redactSensitiveText(error.code || 'UNSPECIFIED')}: ${safeError}`, 'error');
        return res.status(error.statusCode || 500).json({ success: false,
            message: formatTaskErrorMessage('failed', safeError) });
    }
}

app.post('/api/run-process', handleActivationRequest);

app.post('/api/admin/trigger-activation', handleActivationRequest);

app.post('/api/public/task/:jobKey/captcha-drag', async (req, res) => {
    const jobKey = decodeURIComponent(String(req.params.jobKey || '').trim());
    try {
        if (await isCheckoutDiagnosticJob(jobKey)) return res.status(403).json({ success: false, message: '诊断任务需管理员二级验证' });
    } catch (_) { return res.status(503).json({ success: false, message: '验证通道暂时不可用' }); }
    const body = req.body || {};
    const fromRatioX = Number(body.fromRatioX ?? body.startRatioX ?? 0);
    const fromRatioY = Number(body.fromRatioY ?? body.startRatioY ?? 0);
    const toRatioX = Number(body.toRatioX ?? body.endRatioX ?? 0);
    const toRatioY = Number(body.toRatioY ?? body.endRatioY ?? 0);
    const frameSeq = body.frameSeq;
    const handled = notifyCaptchaDrag(jobKey, { fromRatioX, fromRatioY, toRatioX, toRatioY, frameSeq });
    return res.json({ success: true, handled });
});

app.post('/api/public/probe-account', async (req, res) => {
    try {
        const { platform, credential, content } = req.body || {};
        const targetCredential = String(credential || content || '').trim();
        if (!targetCredential) {
            return res.status(400).json({ success: false, message: '缺少凭证' });
        }
        const plat = String(platform || '').toLowerCase().trim();

        // 1. ChatGPT
        if (plat === 'chatgpt') {
            const raw = targetCredential;
            const tokenCheck = validateAccessToken(extractAccessTokenFromRaw(raw));
            if (!tokenCheck.valid) return res.json({ success: true, valid: false, message: tokenCheck.message });
            const emailMatch = raw.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
            let email = emailMatch ? emailMatch[0].trim() : '';
            if (!email && raw.startsWith('{')) {
                try {
                    const data = JSON.parse(raw);
                    email = data.user?.email || data.email || '';
                } catch (_) {}
            }
            return res.json({ success: true, valid: true, email, verification: 'input_only' });
        }

        // 2. Grok
        if (plat === 'grok') {
            const cred = extractGrokCredential(targetCredential);
            const valid = isValidGrokCredential(targetCredential);
            let email = cred.email || '';
            let name = cred.name || '';
            const cookieStr = grokSessionCookieHeader(cred.cookies);

            if (valid && cred.type !== 'x_auth_token' && !email && cookieStr) {
                try {
                    const sessionRes = await axios.get('https://grok.com/api/auth/session', {
                        headers: {
                            'Cookie': cookieStr,
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/136.0.0.0 Safari/537.36',
                            'Accept': 'application/json'
                        },
                        timeout: 3500,
                        maxRedirects: 0
                    });
                    const account = parseOfficialGrokSession(sessionRes.data);
                    if (account) {
                        email = account.email;
                        name = account.name;
                    }
                } catch (_) {}
            }

            return res.json({
                success: true,
                valid,
                verification: 'input_only',
                message: valid ? '' : '未识别到有效的登录 Cookie，请重新复制完整 Cookie',
                email,
                name
            });
        }

        // 3. Claude
        if (plat === 'claude') {
            const key = extractClaudeSessionKey(targetCredential);
            if (!isValidClaudeSessionKey(targetCredential)) {
                return res.status(400).json({ success: false, valid: false, message: '未识别到有效的 Claude sessionKey' });
            }
            let textEmail = targetCredential.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/)?.[0]?.trim() || '';
            let accountName = '';
            const routingHintMatch = targetCredential.match(/routingHint=sk-ant-rh-([^;]+)/);
            if (routingHintMatch && routingHintMatch[1]) {
                try {
                    const parts = routingHintMatch[1].split('.');
                    if (parts.length >= 2) {
                        const payload = decodeJwtPart(parts[1]);
                        if (payload && payload.name) accountName = String(payload.name).trim();
                    }
                } catch (_) {}
            }
            if (!textEmail) {
                try {
                    const claudeAcc = await fetchClaudeAccount(key, { timeout: 3500 });
                    if (claudeAcc && claudeAcc.email) {
                        textEmail = claudeAcc.email;
                    }
                } catch (_) {}
            }
            return res.json({
                success: true,
                valid: true,
                verification: 'input_only',
                email: textEmail,
                name: accountName
            });
        }

        return res.json({ success: true, valid: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/verify-cdk', async (req, res) => {
    const cdk = String(req.body?.cdk || '').trim();
    const clientIp = getClientIp(req);
    if (!cdk) {
        return res.status(400).json({ success: false, message: '请输入 CDK' });
    }

    try {
        await ensureStoreReady();
        const cdkData = await store.verifyCdkDetails(cdk);
        const runningTask = cdkData ? await store.getRunningTaskByCdk(cdk) : null;
        if (cdkData && runningTask) {
            const effectiveRegion = cdkData.payment_region || await store.getPaymentRegion();
            const regionCfg = getRegionConfig(effectiveRegion) || REGION_CONFIG.PH;
            const platform = (typeof getPlatformForPlan === 'function' ? getPlatformForPlan(cdkData.plan_type || 'plus') : 'chatgpt') || 'chatgpt';
            return res.json({
                success: true,
                data: {
                    type: cdkData.type || '自助',
                    platform,
                    plan_type: cdkData.plan_type || 'plus',
                    plan_label: getPlanTypeLabel(cdkData.plan_type || 'plus'),
                    payment_region: effectiveRegion,
                    region_label: regionCfg.label,
                    currency: regionCfg.currency,
                    is_bound_region: Boolean(cdkData.payment_region),
                    status: 'processing',
                    jobKey: runningTask.job_key,
                    message: runningTask.message || '当前 CDK 正在开通中'
                }
            });
        }
        if (cdkData && !cdkData.used_at) {
            if (cdkData.type === '自助') {
                const cdkCooldownMinutes = getRemainingCooldownMinutes(cdkData.cooldown_until);
                if (cdkCooldownMinutes > 0) {
                    return res.status(403).json({
                        success: false,
                        message: `该卡密连续无资格尝试过多，请冷静 ${cdkCooldownMinutes} 分钟后再试`
                    });
                }
                if (clientIp) {
                    const ipAttemptLimit = await store.getActivationAttemptLimit('ip', clientIp);
                    const ipCooldownMinutes = getRemainingCooldownMinutes(ipAttemptLimit?.cooldown_until);
                    if (ipCooldownMinutes > 0) {
                        return res.status(403).json({
                            success: false,
                            message: `当前 IP 连续无资格尝试过多，请冷静 ${ipCooldownMinutes} 分钟后再试`
                        });
                    }
                }
            }
            const effectiveRegion = cdkData.payment_region || await store.getPaymentRegion();
            const regionCfg = getRegionConfig(effectiveRegion) || REGION_CONFIG.PH;
            const platform = (typeof getPlatformForPlan === 'function' ? getPlatformForPlan(cdkData.plan_type || 'plus') : 'chatgpt') || 'chatgpt';
            return res.json({
                success: true,
                data: {
                    type: cdkData.type || '自助',
                    platform,
                    plan_type: cdkData.plan_type || 'plus',
                    plan_label: getPlanTypeLabel(cdkData.plan_type || 'plus'),
                    payment_region: effectiveRegion,
                    region_label: regionCfg.label,
                    currency: regionCfg.currency,
                    is_bound_region: Boolean(cdkData.payment_region)
                }
            });
        }

        return res.status(403).json({ success: false, message: cdkData?.used_at ? '该 CDK 已使用' : '无效 CDK' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/cdk/query', async (req, res) => {
    const cdk = String(req.query.cdk || '').trim();
    if (!cdk) {
        return res.status(400).json({ success: false, message: '请输入查询激活码' });
    }

    try {
        await ensureStoreReady();
        const cdkData = await store.verifyCdkDetails(cdk);
        if (!cdkData) {
            return res.status(404).json({ success: false, message: '未找到该激活码记录' });
        }

        const runningTask = await store.getRunningTaskByCdk(cdk);
        const cdkStatus = runningTask
            ? '开通中'
            : (cdkData.used_at ? '已使用' : '未使用');

        res.json({
            success: true,
            data: {
                status: cdkStatus,
                type: cdkData.type || '自助',
                createdAt: cdkData.created_at,
                jobKey: runningTask?.job_key || null,
                usedAt: cdkData.used_at
                    ? new Date(cdkData.used_at).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
                    : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/cdk/download', async (req, res) => {
    return res.status(410).send('成品号下载功能已移除，仅支持自助开通');
});

async function start() {
    await ensureStoreReady();

    try {
        const poolInfo = await syncBrowserPoolModeFromStore();
        if (poolInfo.enabled && poolInfo.initialized !== false) {
            runtimeLog.push({
                jobKey: '',
                level: 'system',
                source: 'server',
                text: `[BrowserPool] 已预热 ${poolInfo.size} 个浏览器槽位`
            });
        } else if (!poolInfo.enabled) {
            runtimeLog.push({
                jobKey: '',
                level: 'system',
                source: 'server',
                text: '[Browser] 独立启动模式（后台已关闭浏览器池）'
            });
        }
    } catch (error) {
        console.error(`[BrowserPool] 初始化失败: ${error.message}`);
    }

    // 启动恢复先收口遗留任务：支付已开始/结果未知的任务一律人工复核，禁止自动补扣或释放 CDK。
    try {
        const staleTasks = await store.listStaleRunningTasks();
        for (const staleTask of staleTasks) {
            if (await recoverInterruptedCheckoutDiagnostic(staleTask)) continue;
            if (staleTask.execution_mode === 'third_party_api' || staleTask.gpt_api_order_id || staleTask.gpt_api_task_id) continue;
            const decision = classifyInterruptedTask(staleTask);
            await store.updateTaskLog(staleTask.job_key, {
                status: decision.status,
                message: decision.retainCdk
                    ? '服务重启导致任务中断，支付状态未确认，已保留 CDK 并转人工复核'
                    : '服务重启导致任务中断，未提交支付，任务已安全结束',
                paymentState: decision.paymentState,
                recoveryRequired: decision.retainCdk
            });
            if (!decision.retainCdk && staleTask.cdk_code) {
                await store.markCdkUnused(staleTask.cdk_code);
            }
        }
        await store.resetAllAssetLocks();
        console.log(`🔐 [任务恢复] 已处理 ${staleTasks.length} 条遗留任务，并安全清理可回收资产锁`);
    } catch (error) {
        console.error(`❌ [任务恢复] 启动收口失败: ${error.message}`);
    }

    // 每 60 秒兜底回收一次"超过 15 分钟仍未释放"的锁（防进程崩溃）
    setInterval(async () => {
        try {
            const released = await store.releaseStaleAssetLocks();
            if (released.phoneReleased > 0 || released.cardReleased > 0 || released.poolReleased > 0) {
                console.log(`🧹 [资产锁] 兜底回收  phone=${released.phoneReleased}  card=${released.cardReleased}  pool_emails=${released.poolReleased}`);
            }
        } catch (error) {
            console.warn(`⚠️  [资产锁] 周期清理失败: ${error.message}`);
        }
    }, 60 * 1000).unref();

    setTimeout(() => { void recoverGptOutsourcingAttempts(); }, 0).unref();
    setInterval(() => { void recoverGptOutsourcingAttempts(); }, 60 * 1000).unref();

    const server = app.listen(PORT, BIND_HOST, () => {
        const conn = store.connectionInfo;
        if (LOCAL_PREVIEW_INFO) {
            console.log(`[kc-preview] source-commit=${LOCAL_PREVIEW_INFO.sourceCommit}`);
            console.log(`[kc-preview] source-mode=${LOCAL_PREVIEW_INFO.sourceMode} branch=${LOCAL_PREVIEW_INFO.sourceBranch || 'unknown'} dirty=${LOCAL_PREVIEW_INFO.workingTreeDirty} changed-files=${LOCAL_PREVIEW_INFO.changedFileCount}`);
            console.log(`[kc-preview] backend=${LOCAL_PREVIEW_INFO.backend} payments=${LOCAL_PREVIEW_INFO.payments} bind=${BIND_HOST}`);
        }
        runtimeLog.push({
            jobKey: '',
            level: 'system',
            source: 'server',
            text: `✅ 服务就绪  http://localhost:${PORT}  ·  MySQL ${conn.user}@${conn.host}:${conn.port}/${conn.database}  ·  PID=${process.pid}`
        });
        console.log('数据库表检查完成');
        console.log(`http://localhost:${PORT}`);
        console.log(`MySQL => ${conn.user}@${conn.host}:${conn.port}/${conn.database}`);
    });

    // WebSocket Server Setup
    const wss = new WebSocket.Server({ server });
    wss.on('connection', (ws) => {
        let currentJobKey = null;

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === WS_HEARTBEAT_PING_TYPE) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: WS_HEARTBEAT_PONG_TYPE,
                            ts: Number(data.ts) || Date.now()
                        }));
                    }
                    return;
                }
                if (data.type === 'subscribe' && data.jobKey) {
                    if (await isCheckoutDiagnosticJob(data.jobKey)) {
                        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: '诊断任务需管理员二级验证' }));
                        return;
                    }
                    if (currentJobKey && currentJobKey !== data.jobKey) {
                        unsubscribeTaskClient(currentJobKey, ws);
                    }
                    currentJobKey = data.jobKey;
                    if (!taskClients.has(currentJobKey)) {
                        taskClients.set(currentJobKey, new Set());
                    }
                    taskClients.get(currentJobKey).add(ws);
                    console.log(`Client subscribed to task: ${currentJobKey}`);
                    await sendTaskSnapshot(ws, currentJobKey);

                    // 若该任务当前有人机验证等待，立即向订阅者推送验证画面
                    const captchaState = interactiveCaptchaMap.get(currentJobKey);
                    if (captchaState && captchaState.active && (captchaState.image || captchaState.loading) && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'captcha_interactive_required',
                            jobKey: currentJobKey,
                            image: captchaState.image,
                            loading: captchaState.loading,
                            contentReady: captchaState.contentReady,
                            expiresAt: captchaState.expiresAt,
                            frameSeq: captchaState.frameSeq || 0,
                            width: captchaState.width,
                            height: captchaState.height,
                            title: captchaState.title,
                            message: captchaState.message,
                            promptZh: captchaState.promptZh || '',
                            promptEn: captchaState.promptEn || ''
                        }));
                    }
                    return;
                }
                if (data.type === 'captcha_click' && data.jobKey) {
                    if (await isCheckoutDiagnosticJob(data.jobKey)) return;
                    const handled = notifyCaptchaClick(data.jobKey, {
                        ratioX: data.ratioX,
                        ratioY: data.ratioY,
                        clientX: data.clientX,
                        clientY: data.clientY,
                        points: data.points,
                        submitPoint: data.submitPoint,
                        action: data.action,
                        frameSeq: data.frameSeq
                    });
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'captcha_click_received',
                            jobKey: data.jobKey,
                            ratioX: data.ratioX,
                            ratioY: data.ratioY,
                            pointsCount: Array.isArray(data.points) ? data.points.length : 0,
                            frameSeq: data.frameSeq,
                            handled
                        }));
                    }
                    return;
                }
                if (data.type === 'captcha_drag' && data.jobKey) {
                    if (await isCheckoutDiagnosticJob(data.jobKey)) return;
                    const handled = notifyCaptchaDrag(data.jobKey, {
                        fromRatioX: data.fromRatioX ?? data.startRatioX,
                        fromRatioY: data.fromRatioY ?? data.startRatioY,
                        toRatioX: data.toRatioX ?? data.endRatioX,
                        toRatioY: data.toRatioY ?? data.endRatioY,
                        frameSeq: data.frameSeq
                    });
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'captcha_drag_received',
                            jobKey: data.jobKey,
                            frameSeq: data.frameSeq,
                            handled
                        }));
                    }
                    return;
                }
            } catch (e) {
                console.error('WebSocket message error:', e);
            }
        });

        ws.on('close', () => {
            unsubscribeTaskClient(currentJobKey, ws);
        });
    });
}

if (process.env.IS_PRODUCT_FLOW === 'true') {
    console.log('[系统] 检测到成品子流程环境，跳过 Web 服务监听。');
} else {
    start().catch((error) => {
        console.error('服务启动失败:', error.message);

        if (error && /ECONNREFUSED|connect/i.test(String(error.message || error))) {
            const conn = store.connectionInfo;
            console.error(
                `MySQL 连接配置 => ${conn.user}@${conn.host}:${conn.port}/${conn.database}`
            );
            console.error('排查建议:');
            console.error('1. 确认本机或远程 MySQL 已启动，并且监听了对应 host/port。');
            console.error(`2. 如果不是本机默认库，请先设置环境变量后再启动，例如:`);
            console.error(
                `   $env:DB_HOST='127.0.0.1'; $env:DB_PORT='3306'; $env:DB_USER='root'; $env:DB_PASSWORD='你的密码'; $env:DB_NAME='gpt'; node server.js`
            );
            console.error('3. 首次建库时，请先在 MySQL 中创建数据库，再启动服务自动建表。');
        }

        process.exit(1);
    });
}
