const { redactSensitiveText } = require('./session-security');
const { safeDiagnosticText } = require('./checkout-diagnostics');
const { normalizePaymentState } = require('./task-safety');

// Compatible with existing VARCHAR(255) installations until their normal upgrade.
function normalizeTaskLogText(message, rawOutput) {
    const fullMessage = message == null ? null : redactSensitiveText(message);
    const chars = fullMessage == null ? [] : Array.from(fullMessage);
    const truncated = chars.length > 255;
    return {
        message: fullMessage == null ? null : truncated ? `${chars.slice(0, 254).join('')}…` : fullMessage,
        rawOutput: rawOutput ? redactSensitiveText(rawOutput) : truncated ? fullMessage : null
    };
}

function buildAttemptDiagnostic({ attempt, elapsedMs, analysis = {}, paymentState, exitCode, timedOut } = {}) {
    const message = String(analysis.exhaustedMessage || analysis.message || '');
    const code = message.match(/\[((?:CHECKOUT|PROXY_PREFLIGHT|PROTOCOL_PREREQUISITE|PAYMENT|NETWORK_REGION|CHATGPT|GROK|CLAUDE|ACCOUNT|BILLING|PRICING|CDK|OPENAI_CARD)_[A-Z0-9_]{1,48})\]\s*$/)?.[1];
    return {
        attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
        elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : 0,
        status: ['success', 'failed', 'retry', 'manual'].includes(analysis.status) ? analysis.status : 'unknown',
        paymentState: normalizePaymentState(paymentState || analysis.paymentState || 'not_started'),
        shouldRetry: analysis.shouldRetry === true,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        timedOut: timedOut === true,
        errorCode: code || null,
        failure: Array.from(safeDiagnosticText(message)).slice(0, 700).join('')
    };
}

function summarizeFailedAttempts(attempts, analysis, paymentState) {
    const message = analysis?.message || null;
    // A diagnostic history must never replace a successful or uncertain payment outcome.
    if (analysis?.status !== 'failed' || !['not_started', 'declined'].includes(normalizePaymentState(paymentState)) || attempts.length < 2) return message;
    const describe = record => {
        const detail = record.errorCode ? record.failure.replace(new RegExp(`\\[${record.errorCode}\\]$`), '').trim() : record.failure;
        return Array.from(`${record.errorCode ? `[${record.errorCode}] ` : ''}${detail || '未提供失败详情'}`).slice(0, 104).join('');
    };
    return normalizeTaskLogText(`首次：${describe(attempts[0])}；最后（第${attempts.at(-1).attempt}次）：${describe(attempts.at(-1))}`).message;
}

async function captureDiagnosticScreenshot(page, screenshotPath, { timeout = 4000, warn = console.warn } = {}) {
    try {
        if (!page || page.isClosed()) return null;
        await page.screenshot({ path: screenshotPath, fullPage: false, timeout, animations: 'disabled' });
        return screenshotPath;
    } catch (_) {
        // Diagnostics must not replace the business error or block cleanup.
        try { warn('⚠️ [系统] 异常截图未保存（页面关闭或截图超时），保留原始失败原因。'); } catch (_) { /* preserve original failure */ }
        return null;
    }
}

async function reportTaskFailure({ persist, report, cleanup, onSecondaryError = () => {} }) {
    const run = async (stage, action) => {
        if (!action) return;
        try { await action(); } catch (error) {
            try { onSecondaryError(stage, error); } catch (_) { /* preserve original failure */ }
        }
    };
    try {
        await run('persist', persist);
        await run('report', report);
    } finally {
        await run('cleanup', cleanup);
    }
}

module.exports = { normalizeTaskLogText, buildAttemptDiagnostic, summarizeFailedAttempts, captureDiagnosticScreenshot, reportTaskFailure };
