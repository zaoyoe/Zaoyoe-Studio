const { redactSensitiveText } = require('./session-security');

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

module.exports = { normalizeTaskLogText, captureDiagnosticScreenshot, reportTaskFailure };
