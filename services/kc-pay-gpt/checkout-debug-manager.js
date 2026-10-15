'use strict';

const { redactSensitiveText } = require('./session-security');
const { sanitizeDiagnosticReport: validateDiagnosticReport, trustedCheckoutUrl, createDiagnosticReporter } = require('./checkout-diagnostic');

const EXECUTION_MODE = 'checkout_diagnostic';
const REPORT_PREFIX = 'CHECKOUT_DIAGNOSTIC:';

function diagnosticError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

function throwIfDiagnosticAborted(signal) {
    if (signal?.aborted) throw diagnosticError('DIAGNOSTIC_CANCELLED', '诊断已取消', 409);
}

function waitForDiagnosticAbort(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(diagnosticError('DIAGNOSTIC_CANCELLED', '诊断已取消', 409));
    return new Promise((resolve, reject) => {
        const abort = () => reject(diagnosticError('DIAGNOSTIC_CANCELLED', '诊断已取消', 409));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

// Keep reports available behind secondary authentication; ordinary logs never carry a checkout URL.
function redactDiagnosticLogs(output, secrets = []) {
    let text = String(output || '');
    for (const secret of secrets) {
        if (secret && String(secret).length >= 8) text = text.split(String(secret)).join('[CREDENTIAL_REDACTED]');
    }
    return redactSensitiveText(text)
        .split(/\r?\n/).filter(line => !line.trimStart().startsWith(REPORT_PREFIX)).join('\n')
        .replace(/https?:\/\/[^\s<>"']+/gi, '[URL_REDACTED]')
        .replace(/(["']?(?:client[_-]?secret|secret|password|cvv|cvc|session[_-]?key|claude_session_key|grok_token|sso(?:-rw)?|token)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-ant-|sk-|cs_|pi_|pm_|sess_)[A-Za-z0-9_-]+\b/g, '[ID_REDACTED]')
        .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[OPAQUE_REDACTED]');
}

function sanitizeDiagnosticReport(report, secrets = []) {
    report = validateDiagnosticReport(report);
    if (!report) return null;
    const clean = (value, key = '', depth = 0) => {
        if (depth > 8) return null;
        if (/token|secret|password|session|credential|cvv|cvc|card_number/i.test(key)) return '[REDACTED]';
        if (Array.isArray(value)) return value.slice(0, 100).map(item => clean(item, '', depth + 1));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
            .filter(([name]) => !['__proto__', 'prototype', 'constructor', 'url'].includes(name))
            .slice(0, 100).map(([name, item]) => [name, clean(item, name, depth + 1)]));
        return typeof value === 'string' ? redactDiagnosticLogs(value, secrets).slice(0, 6000) : value;
    };
    const result = clean(report);
    if (report.checkout && typeof report.checkout === 'object') {
        result.checkout = clean(report.checkout);
        const url = report.checkout.url;
        result.checkout.url = trustedCheckoutUrl(url, report.platform);
    }
    return result;
}

function appendDiagnosticReport(output, report) {
    return `${String(output || '').trimEnd()}\n${REPORT_PREFIX}${JSON.stringify(report)}\n`;
}

function pendingDiagnosticReport(input, startedAt = new Date().toISOString()) {
    const reporter = createDiagnosticReporter(input, () => {}, () => Date.parse(startedAt));
    reporter.check('browser', '浏览器启动', 'running', '等待浏览器诊断');
    return validateDiagnosticReport(reporter.report);
}

function diagnosticProgress(report) {
    if (!report) return 0;
    if (report.success === true) return 100;
    const stages = Array.isArray(report.checks) ? report.checks : (Array.isArray(report.stages) ? report.stages : []);
    if (!stages.length) return 1;
    const progress = { browser: 5, proxy: 10, session: 25, checkout: 50, product: 70, form: 90, tax: 95, payment: 98 };
    return stages.filter(stage => ['passed', 'skipped'].includes(stage.status))
        .reduce((value, stage) => Math.max(value, progress[stage.id] || 1), 1);
}

function finishDiagnosticReport(report, input, { code, message, success = false, startedAt, completedAt = new Date().toISOString() } = {}) {
    const start = report?.startedAt || startedAt || completedAt;
    const durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(start).getTime()) || 0;
    const result = {
        version: 1, platform: input?.platform, planType: input?.planType, region: input?.region,
        mode: input?.mode || 'checkout', startedAt: start, stages: [], checks: [], checkout: {},
        ...(report || {}), success, completedAt, finishedAt: completedAt,
        durationMs, elapsedMs: durationMs, paymentSubmitted: false,
        phase: success ? 'complete' : 'failed'
    };
    if (code) result.code = code;
    if (message) result.message = redactDiagnosticLogs(message);
    if (!Array.isArray(result.stages)) result.stages = [];
    if (!Array.isArray(result.checks)) result.checks = [];
    if (!success) result.stages = result.stages.map(stage => stage.status === 'running'
        ? { ...stage, status: 'failed', detail: result.message || stage.detail } : stage);
    if (!success) result.checks = result.checks.map(check => check.status === 'running'
        ? { ...check, status: 'failed', message: result.message || check.message } : check);
    return result;
}

function createCheckoutDebugManager({ requestTtlMs = 60 * 60 * 1000, maxRequests = 500, now = Date.now } = {}) {
    const requests = new Map();
    const jobs = new Map();
    const children = new Map();

    function pruneRequests() {
        for (const [key, entry] of requests) {
            if (entry.settled && now() - entry.createdAt > requestTtlMs) requests.delete(key);
        }
        if (requests.size >= maxRequests) {
            for (const [key, entry] of requests) {
                if (entry.settled && !jobs.has(entry.jobKey)) requests.delete(key);
                if (requests.size < maxRequests) break;
            }
        }
    }

    async function submit(requestKey, fingerprint, create) {
        pruneRequests();
        const previous = requests.get(requestKey);
        if (previous) {
            if (previous.fingerprint !== fingerprint) {
                throw diagnosticError('DIAGNOSTIC_REQUEST_CONFLICT', 'request_id 已用于不同的诊断参数', 409);
            }
            return { ...(await previous.promise), reused: true };
        }
        if (requests.size >= maxRequests) throw diagnosticError('DIAGNOSTIC_BUSY', '诊断请求过多，请稍后再试', 429);
        const entry = { fingerprint, createdAt: now(), settled: false, jobKey: null };
        // Install the promise before any asynchronous validation/task creation can yield.
        entry.promise = Promise.resolve().then(create).then(result => {
            entry.settled = true;
            entry.jobKey = result.jobKey;
            return result;
        }, error => {
            requests.delete(requestKey);
            throw error;
        });
        requests.set(requestKey, entry);
        return entry.promise;
    }

    function register(jobKey, input, startedAt = new Date(now()).toISOString()) {
        const entry = { controller: new AbortController(), input: {
            platform: input.platform, planType: input.planType, region: input.region, mode: input.mode
        }, startedAt };
        jobs.set(jobKey, entry);
        return entry;
    }

    function bindChild(jobKey, child) {
        if (jobs.has(jobKey)) children.set(jobKey, child);
    }

    function unbindChild(jobKey, child) {
        if (children.get(jobKey) === child) children.delete(jobKey);
    }

    function cancel(jobKey) {
        const entry = jobs.get(jobKey);
        if (!entry) return false;
        entry.controller.abort();
        return true;
    }

    function complete(jobKey) {
        children.delete(jobKey);
        jobs.delete(jobKey);
    }

    return { submit, register, bindChild, unbindChild, cancel, complete,
        get: jobKey => jobs.get(jobKey), getChild: jobKey => children.get(jobKey),
        has: jobKey => jobs.has(jobKey) };
}

module.exports = { EXECUTION_MODE, REPORT_PREFIX, diagnosticError, throwIfDiagnosticAborted,
    waitForDiagnosticAbort, redactDiagnosticLogs, sanitizeDiagnosticReport, appendDiagnosticReport, pendingDiagnosticReport, diagnosticProgress,
    finishDiagnosticReport, createCheckoutDebugManager };
