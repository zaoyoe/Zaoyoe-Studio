const path = require('path');
const {
    describeAfdianAllowlist,
    FALLBACK_FAIL_CLOSED_ALLOWLIST,
    isFailClosedAfdianAllowlist
} = require('./_lib/afdian-network-guards');
const {
    loadEnvFile,
    runAudit
} = require('./payment-postdeploy-audit');
const {
    DEFAULT_VERIFY_SERVER_URL,
    runInspection
} = require('./inspect-proxy-chain');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_BASE_URL = 'https://www.zaoyoe.com';
const DEFAULT_SAMPLE_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 15000;
const PENDING_CLOSEOUT_KEYS = new Set([
    'afdian_webhook_allowlist_placeholder'
]);
const PENDING_PROXY_CODES = new Set([
    'current_request_not_in_webhook_allowlist'
]);

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        baseUrl: DEFAULT_BASE_URL,
        verifyServerUrl: DEFAULT_VERIFY_SERVER_URL,
        adminEmail: '',
        accessToken: '',
        sampleCount: DEFAULT_SAMPLE_COUNT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        skipProxyInspection: false,
        json: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--verify-server-url') {
            options.verifyServerUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--admin-email') {
            options.adminEmail = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--access-token') {
            options.accessToken = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--samples') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.sampleCount = Math.min(parsed, 20);
            }
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

        if (value === '--skip-proxy-inspection') {
            options.skipProxyInspection = true;
            continue;
        }

        if (value === '--json') {
            options.json = true;
        }
    }

    return options;
}

function buildNextSteps({
    status = 'ACTION_REQUIRED',
    closeoutBlockingFindings = [],
    proxyBlockingFindings = [],
    proxyInspection = {},
    placeholderConfigured = false
} = {}) {
    const steps = [];

    closeoutBlockingFindings.forEach((finding) => {
        if (finding?.key === 'remote_mock_payment_still_enabled') {
            steps.push('关闭生产态远程 mock 支付开关，然后重新部署并复跑收尾检查。');
            return;
        }

        if (finding?.key === 'proxy_trust_chain_missing') {
            steps.push('在 Railway 补齐 TRUSTED_PROXY_IPS 和 AFDIAN_WEBHOOK_TRUSTED_PROXIES，再重新部署。');
            return;
        }

        if (finding?.key === 'afdian_webhook_allowlist_missing') {
            steps.push(`先把 AFDIAN_WEBHOOK_ALLOWED_IPS 设成 ${FALLBACK_FAIL_CLOSED_ALLOWLIST}，保持 webhook fail-closed。`);
            return;
        }

        if (finding?.key === 'smoke_payment_artifacts_present' || finding?.key === 'smoke_users_still_present') {
            steps.push('先清理 smoke 测试订单和测试账号，再把收尾检查跑到只剩爱发电占位白名单。');
        }
    });

    proxyBlockingFindings.forEach((code) => {
        if (code === 'proxy_trust_chain_missing' || code === 'proxy_trust_chain_mismatch' || code === 'afdian_webhook_proxy_trust_mismatch') {
            const trustedProxyIps = proxyInspection?.recommendedEnv?.TRUSTED_PROXY_IPS || '(unavailable)';
            steps.push(`按脚本推荐值更新 Railway 代理链配置并 redeploy：TRUSTED_PROXY_IPS=${trustedProxyIps}`);
            return;
        }

        if (code === 'afdian_webhook_allowlist_missing') {
            steps.push(`先把 AFDIAN_WEBHOOK_ALLOWED_IPS 设成 ${FALLBACK_FAIL_CLOSED_ALLOWLIST}，不要让 webhook 在未认证前裸奔。`);
        }
    });

    if (!steps.length && status === 'LOCAL_AUDIT_ONLY') {
        steps.push('当前只完成了本地/配置侧检查；补跑线上 proxy inspection 后再确认是否可以安全待命。');
    }

    if (!steps.length && placeholderConfigured) {
        steps.push('保持 AFDIAN_WEBHOOK_ALLOWED_IPS 的 fail-closed 占位值，不要在开发者认证开通前放开 webhook 白名单。');
        steps.push('爱发电开通后先触发一笔真实订单，并在 Railway 日志里查找 “[Afdian] Webhook blocked due to IP allowlist mismatch” 对应的 resolved_client_ip。');
        steps.push('把 AFDIAN_WEBHOOK_ALLOWED_IPS 替换成首个真实 webhook 的 /32 或最小 CIDR，redeploy 后再次运行本脚本确认。');
    }

    if (!steps.length && status === 'READY_FOR_REAL_AFDIAN_WEBHOOK') {
        steps.push('当前已经不再依赖占位 allowlist；继续用真实 webhook 做首轮验收并保持日志观测即可。');
    }

    return [...new Set(steps)];
}

function buildReadinessSummary({
    closeoutAudit = {},
    proxyInspection = null,
    proxyInspectionSkipped = false,
    proxyInspectionError = ''
} = {}) {
    const closeoutFindings = Array.isArray(closeoutAudit.findings) ? closeoutAudit.findings : [];
    const closeoutBlockingFindings = closeoutFindings.filter((finding) => !PENDING_CLOSEOUT_KEYS.has(String(finding?.key || '').trim()));

    const proxyCodes = Array.isArray(proxyInspection?.summary?.findings)
        ? proxyInspection.summary.findings.map((code) => String(code || '').trim()).filter(Boolean)
        : [];
    const proxyBlockingFindings = proxyCodes.filter((code) => !PENDING_PROXY_CODES.has(code));

    const currentNetwork = closeoutAudit.network || {};
    const placeholderConfigured = Boolean(
        currentNetwork.webhook_allowlist_placeholder
        || isFailClosedAfdianAllowlist(currentNetwork.afdian_webhook_allowed_ips || '')
    );
    const proxyChecked = !proxyInspectionSkipped && !proxyInspectionError && Boolean(proxyInspection);
    const recommendedEnv = {
        TRUSTED_PROXY_IPS: proxyInspection?.summary?.recommendedTrustedProxyIps || currentNetwork.trusted_proxy_ips || '',
        AFDIAN_WEBHOOK_TRUSTED_PROXIES: proxyInspection?.summary?.recommendedWebhookTrustedProxies || currentNetwork.afdian_webhook_trusted_proxies || '',
        AFDIAN_WEBHOOK_ALLOWED_IPS: placeholderConfigured
            ? FALLBACK_FAIL_CLOSED_ALLOWLIST
            : (proxyInspection?.summary?.recommendedWebhookAllowlist || currentNetwork.afdian_webhook_allowed_ips || '')
    };

    let status = 'ACTION_REQUIRED';
    if (!closeoutBlockingFindings.length && !proxyBlockingFindings.length) {
        if (!proxyChecked && proxyInspectionSkipped) {
            status = 'LOCAL_AUDIT_ONLY';
        } else if (!proxyChecked && proxyInspectionError) {
            status = 'ACTION_REQUIRED';
        } else if (placeholderConfigured) {
            status = 'SAFE_PENDING_AFDIAN_APPROVAL';
        } else {
            status = 'READY_FOR_REAL_AFDIAN_WEBHOOK';
        }
    }

    return {
        auditedAt: new Date().toISOString(),
        status,
        placeholderConfigured,
        closeoutAudit: {
            findings: closeoutFindings,
            blockingFindings: closeoutBlockingFindings,
            runtime: closeoutAudit.runtime || {},
            network: currentNetwork,
            artifacts: closeoutAudit.artifacts || {}
        },
        proxyInspection: {
            checked: proxyChecked,
            skipped: proxyInspectionSkipped,
            error: proxyInspectionError || '',
            findings: proxyCodes,
            blockingFindings: proxyBlockingFindings,
            socketIps: proxyInspection?.summary?.socketIps || [],
            resolvedClientIps: proxyInspection?.summary?.resolvedClientIps || [],
            recommendedEnv
        },
        nextSteps: buildNextSteps({
            status,
            closeoutBlockingFindings,
            proxyBlockingFindings,
            proxyInspection: {
                ...proxyInspection?.summary,
                recommendedEnv
            },
            placeholderConfigured
        })
    };
}

function formatHumanReport(summary = {}) {
    const lines = ['Afdian Readiness Gate', ''];
    lines.push(`status: ${summary.status || 'ACTION_REQUIRED'}`);
    lines.push(`audited_at: ${summary.auditedAt || '(unknown)'}`);
    lines.push('');

    const closeoutAudit = summary.closeoutAudit || {};
    const network = closeoutAudit.network || {};
    lines.push('closeout_audit');
    lines.push(`  runtime_mock_allowed: ${closeoutAudit.runtime?.mock_payment?.allowed === true ? 'yes' : 'no'}`);
    lines.push(`  trusted_proxy_ips: ${network.trusted_proxy_ips || '(missing)'}`);
    lines.push(`  webhook_trusted_proxies: ${network.afdian_webhook_trusted_proxies || '(missing)'}`);
    lines.push(`  webhook_allowed_ips: ${describeAfdianAllowlist(network.afdian_webhook_allowed_ips || '')}`);
    lines.push(`  smoke_auth_users: ${closeoutAudit.artifacts?.auth_users || 0}`);
    lines.push('');

    const proxyInspection = summary.proxyInspection || {};
    lines.push('proxy_inspection');
    if (proxyInspection.skipped) {
        lines.push('  checked: no (skipped)');
    } else if (proxyInspection.error) {
        lines.push(`  checked: no (${proxyInspection.error})`);
    } else {
        lines.push(`  checked: ${proxyInspection.checked ? 'yes' : 'no'}`);
        lines.push(`  socket_ips: ${(proxyInspection.socketIps || []).join(', ') || '(none)'}`);
        lines.push(`  resolved_client_ips: ${(proxyInspection.resolvedClientIps || []).join(', ') || '(none)'}`);
    }
    lines.push(`  proxy_findings: ${(proxyInspection.findings || []).join(', ') || '(none)'}`);
    lines.push('');

    lines.push('recommended_env');
    lines.push(`  TRUSTED_PROXY_IPS=${proxyInspection.recommendedEnv?.TRUSTED_PROXY_IPS || '(unavailable)'}`);
    lines.push(`  AFDIAN_WEBHOOK_TRUSTED_PROXIES=${proxyInspection.recommendedEnv?.AFDIAN_WEBHOOK_TRUSTED_PROXIES || '(unavailable)'}`);
    lines.push(`  AFDIAN_WEBHOOK_ALLOWED_IPS=${proxyInspection.recommendedEnv?.AFDIAN_WEBHOOK_ALLOWED_IPS || FALLBACK_FAIL_CLOSED_ALLOWLIST}`);
    lines.push('');

    if ((summary.nextSteps || []).length) {
        lines.push('next_steps');
        summary.nextSteps.forEach((step, index) => {
            lines.push(`  ${index + 1}. ${step}`);
        });
    } else {
        lines.push('next_steps');
        lines.push('  (none)');
    }

    return lines.join('\n');
}

async function runReadiness(options = {}, dependencies = {}) {
    const envValues = dependencies.envValues || loadEnvFile(options.envFile);
    const closeoutAudit = await (dependencies.runAudit || runAudit)({
        envValues,
        baseUrl: options.baseUrl
    });

    let proxyInspection = null;
    let proxyInspectionError = '';
    if (!options.skipProxyInspection) {
        try {
            proxyInspection = await (dependencies.runInspection || runInspection)({
                envFile: options.envFile,
                baseUrl: options.baseUrl,
                verifyServerUrl: options.verifyServerUrl,
                adminEmail: options.adminEmail,
                accessToken: options.accessToken,
                sampleCount: options.sampleCount,
                timeoutMs: options.timeoutMs
            }, {
                envValues,
                fetchImpl: dependencies.fetchImpl,
                createClient: dependencies.createClient
            });
        } catch (error) {
            proxyInspectionError = error.message || 'proxy inspection failed';
        }
    }

    return buildReadinessSummary({
        closeoutAudit,
        proxyInspection,
        proxyInspectionSkipped: Boolean(options.skipProxyInspection),
        proxyInspectionError
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const summary = await runReadiness(options);
    if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    console.log(formatHumanReport(summary));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    buildNextSteps,
    buildReadinessSummary,
    formatHumanReport,
    parseArgs,
    runReadiness
};
