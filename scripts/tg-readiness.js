#!/usr/bin/env node
'use strict';

// Offline only: never instantiate a database client, run RPCs or call Gramix.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { codePepper, encryptionKey } = require('../server/tg/code-secrets');
const { createGramixClient } = require('../server/tg/gramix-client');
const { enabled } = require('../server/tg/worker');
const { getSupabasePublishableKey } = require('../api/_lib/public-runtime-config');
const { _private: { isProductionLikeRuntime } } = require('../api/_lib/request-security');

const REPO_ROOT = path.resolve(__dirname, '..');
const REQUIRED_FILES = Object.freeze([
    'tg.html', 'tg-admin.html', 'server/api-handlers/public/tg.js',
    'server/api-handlers/admin/tg/codes.js', 'server/api-handlers/admin/tg/orders.js',
    'server/api-handlers/admin/tg/provider.js', 'server/api-handlers/admin/tg/products.js',
    'server/api-handlers/admin/tg/purchases.js', 'server/api-handlers/public/tg-purchase.js',
    'server/tg/payment-gateway.js', 'server/tg/nowpayments-gateway.js', 'server/tg/raw-body.js',
    'server/tg/recipient-profile.js', 'server/api-handlers/public/tg-recipient.js', 'scripts/tg-fulfillment-worker.js',
    'scripts/install-kvm4-tg-worker.sh',
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker',
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker.cjs',
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker.service',
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker.timer',
    'server/.env.tg.example',
    'supabase/migrations/20261015_add_tg_premium_redemption_domain.sql',
    'supabase/migrations/20261015_tg_redemption_worker.sql',
    'supabase/migrations/20261015_verify_tg_premium_redemption_domain.sql',
    'supabase/migrations/20261015_verify_tg_redemption_worker.sql',
    'supabase/migrations/20261015_tg_payment_currency_guard.sql',
    'supabase/migrations/20261015_tg_stars_redemption.sql',
    'supabase/migrations/20261015_tg_purchase_domain.sql',
    'supabase/migrations/20261015_verify_tg_stars_purchase_domain.sql',
    'supabase/migrations/20261015_tg_purchase_usdt_payments.sql'
]);
// Verify serves only the API; static pages are hosted by Vercel, while systemd
// files live on the KVM4 host. Do not mistake a compact image for lost code.
const RUNTIME_FILES = Object.freeze(REQUIRED_FILES.filter((file) => !file.endsWith('.html') && !file.startsWith('deploy/')));
const OPERATOR_CHECKS = Object.freeze([
    ['database', '需由数据库管理员确认全部 TG 迁移及结构/权限核验文件已按顺序执行，并验证真实并发、service-role RPC 权限及 take_rate_limit_token。本离线检查不会连接数据库，也不验证 SQL 执行结果。'],
    ['domains', '核对两个 TG 域名的 DNS、TLS、Vercel 绑定、路由、CORS 与管理端登录。'],
    ['release', '按 AGENTS.md 验证最新 main 的 Vercel、KVM4 Verify 和 NewAPI 发布链路。'],
    ['scheduler', 'verify 部署对应提交后才安装 TG timer；联调获准前保持停止；核对 release、健康与密钥重载。'],
    ['provider', '确认 Gramix API 权限、余额和受控测试交付；上游受理不等于履约成功。'],
    ['payments', '确认 TG 后台人民币售价及所选支付商户；USDT 还需确认 CNY/USD 汇率、BEP20 网络和独立回调。完成金额不符、少付、错链、重复回调、丢响应与付款后履约的受控联调；配置及测试不会自动开放购买。'],
    ['operations', '确认积压/失败告警、人工复核与应急停用步骤；提交结果未知不得重买或解冻。']
]);
const value = (env, name) => String(env[name] ?? '').trim();
const placeholder = (input) => /^(?:your[_ -]|replace[_ -]|change[_ -]?me|placeholder|example|mock(?:$|[_ -])|test(?:$|[_ -]))/i.test(input);

function parseArgs(argv = []) {
    const options = { envFile: '', json: false, runtime: false, failOnInvalid: false, failOnNotReady: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') options.json = true;
        else if (arg === '--runtime') options.runtime = true;
        else if (arg === '--fail-on-invalid') options.failOnInvalid = true;
        else if (arg === '--fail-on-not-ready') options.failOnNotReady = true;
        else if (arg === '--env-file' && !options.envFile && argv[index + 1] && !argv[index + 1].startsWith('--')) options.envFile = path.resolve(argv[++index]);
        else throw new Error('tg_readiness_invalid_arguments');
    }
    return options;
}

function loadEnvFile(envFile, baseEnv = process.env) {
    if (!envFile) return { ...baseEnv };
    try {
        const stat = fs.lstatSync(envFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error();
        // Match Node --env-file: actual process/container variables win.
        return { ...dotenv.parse(fs.readFileSync(envFile)), ...baseEnv };
    } catch (_) { throw new Error('tg_readiness_env_file_unavailable'); }
}

function runReadiness({ env = process.env, repoRoot = REPO_ROOT, envFile = '', nodeVersion = process.versions.node, runtime = false } = {}) {
    const checks = [];
    const purchaseActive = enabled(env.TG_PURCHASE_ENABLED);
    const active = enabled(env.TG_REDEMPTION_ENABLED) || enabled(env.TG_FULFILLMENT_ENABLED) || purchaseActive;
    const add = (key, status, message) => checks.push({ key, status, message });
    const validate = (key, check, message) => {
        try { if (!check()) throw new Error(); add(key, 'ok', message); }
        catch (_) { add(key, 'invalid', `${message}：校验未通过（不输出配置值）。`); }
    };
    const required = (name, check, message) => {
        if (!value(env, name)) add(name, active ? 'invalid' : 'pending', `${name} 尚未配置。`);
        else validate(name, () => !placeholder(value(env, name)) && check(), message);
    };
    validate('node', () => Number(String(nodeVersion).split('.')[0]) >= 20, 'Node.js 版本需为 20 或以上');
    for (const name of ['TG_REDEMPTION_ENABLED', 'TG_FULFILLMENT_ENABLED', 'TG_PURCHASE_ENABLED']) {
        validate(name, () => /^(?:true|false|1|0)?$/i.test(value(env, name)), `${name} 使用明确布尔值，未设置时关闭`);
    }
    if (!active) add('switches', 'ok', 'TG 新购买、兑换和履约均关闭；本检查不会打开开关。');
    else add('switches', 'pending', '至少一个 TG 业务开关已开启；本检查不能证明已具备真实交易条件，也不会修改开关。');
    add('production-marker', isProductionLikeRuntime(env) ? 'ok' : 'pending', '生产环境需设置 APP_ENV/DEPLOYMENT_TIER=production；仅 NODE_ENV 不触发全部持久化安全策略。');

    required('SUPABASE_URL', () => {
        const url = new URL(value(env, 'SUPABASE_URL'));
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
    }, '数据库地址需为不含凭证的 HTTPS origin');
    required('SUPABASE_SERVICE_ROLE_KEY', () => {
        const key = value(env, 'SUPABASE_SERVICE_ROLE_KEY');
        if (/^sb_secret_/.test(key)) return key.length >= 32;
        const parts = key.split('.');
        if (parts.length !== 3) return false;
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'service_role';
    }, '数据库凭证需为服务端 secret key 或 service_role JWT');
    let publicKey = '';
    try { publicKey = getSupabasePublishableKey(env); } catch (_) { /* Report missing without raw error text. */ }
    if (!publicKey) add('supabase-public-key', active ? 'invalid' : 'pending', '尚未配置管理页登录所需的 Supabase publishable/anon key。');
    else validate('supabase-public-key', () => {
        if (placeholder(publicKey) || publicKey === value(env, 'SUPABASE_SERVICE_ROLE_KEY')) return false;
        if (/^sb_publishable_/.test(publicKey)) return publicKey.length >= 32;
        const parts = publicKey.split('.');
        return parts.length === 3 && JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon';
    }, '管理页公开凭证不能使用 service-role secret');
    const adminSecret = value(env, 'ADMIN_STUDIO_ACCESS_SECRET') || value(env, 'ADMIN_CONFIG_ENCRYPTION_KEY');
    if (!adminSecret) add('admin-session-secret', active ? 'invalid' : 'pending', '需要保留既有 ADMIN_STUDIO_ACCESS_SECRET 或 ADMIN_CONFIG_ENCRYPTION_KEY 以签发管理会话。');
    else validate('admin-session-secret', () => adminSecret.length >= 32 && !placeholder(adminSecret) && adminSecret !== 'local-dev-admin-studio-access-secret', '管理会话使用既有生产秘密');
    required('TG_REDEMPTION_CODE_PEPPER', () => Boolean(codePepper(env)), '兑换码 pepper 长度及独立性');
    required('TG_REDEMPTION_CODE_ENCRYPTION_KEY', () => encryptionKey(env).length === 32, '兑换码 AES-GCM 密钥长度及独立性');
    required('GRAMIX_API_KEY', () => {
        createGramixClient({ env }); // Constructor validates only; no request methods.
        return true;
    }, 'Gramix 密钥和客户端配置');
    if (value(env, 'GRAMIX_API_BASE_URL')) validate('GRAMIX_API_BASE_URL', () => {
        const url = new URL(value(env, 'GRAMIX_API_BASE_URL'));
        return url.href.replace(/\/$/, '') === 'https://api.gramix.io/api/v1';
    }, '生产 Gramix 地址使用已核对的官方 API，变更地址需重新审查');
    validate('GRAMIX_PAYMENT_CURRENCY', () => ['gram', 'usdt'].includes(value(env, 'GRAMIX_PAYMENT_CURRENCY') || 'usdt'), '上游扣款币种为 usdt（默认）或 gram');
    const channels = (value(env, 'TG_PURCHASE_CHANNELS') || 'alipay,wxpay').split(',').map((item) => item.trim());
    const zpaySelected = channels.some((channel) => ['alipay', 'wxpay'].includes(channel));
    const usdtSelected = channels.includes('usdt_bep20');
    const paymentRequired = (name, selected, check, message) => {
        if (!value(env, name)) add(name, selected ? purchaseActive ? 'invalid' : 'pending' : 'ok', selected ? `${name} 尚未配置。` : `${name} 对应支付渠道未选择，无需配置。`);
        else validate(name, () => !placeholder(value(env, name)) && check(), message);
    };
    paymentRequired('TG_PURCHASE_ZPAY_PID', zpaySelected, () => /^\d{1,32}$/.test(value(env, 'TG_PURCHASE_ZPAY_PID')), 'TG 支付商户编号格式');
    paymentRequired('TG_PURCHASE_ZPAY_KEY', zpaySelected, () => {
        const key = value(env, 'TG_PURCHASE_ZPAY_KEY');
        return key.length >= 16 && key.length <= 200 && !/[\r\n]/.test(String(env.TG_PURCHASE_ZPAY_KEY || ''))
            && !['CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'TG_REDEMPTION_CODE_PEPPER', 'TG_REDEMPTION_CODE_ENCRYPTION_KEY', 'GRAMIX_API_KEY'].some((name) => key === value(env, name));
    }, 'TG 支付密钥需有效且不复用数据库、兑换或履约秘密');
    for (const name of ['TG_PURCHASE_NOWPAYMENTS_API_KEY', 'TG_PURCHASE_NOWPAYMENTS_IPN_SECRET']) paymentRequired(name, usdtSelected, () => {
        const raw = String(env[name] ?? '');
        const forbidden = [
            'GRAMIX_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'CRON_SECRET', 'TG_WORKER_SECRET',
            'TG_REDEMPTION_CODE_PEPPER', 'TG_REDEMPTION_CODE_ENCRYPTION_KEY', 'TG_PURCHASE_ZPAY_KEY',
            'ADMIN_CONFIG_ENCRYPTION_KEY', 'ADMIN_STUDIO_ACCESS_SECRET',
            name === 'TG_PURCHASE_NOWPAYMENTS_API_KEY' ? 'TG_PURCHASE_NOWPAYMENTS_IPN_SECRET' : 'TG_PURCHASE_NOWPAYMENTS_API_KEY'
        ].map((key) => value(env, key)).filter(Boolean);
        return raw === raw.trim() && raw.length >= 16 && raw.length <= 300 && !/[\r\n]/.test(raw) && !forbidden.includes(raw);
    }, 'TG USDT 密钥需有效、彼此独立且不复用其他应用秘密');
    paymentRequired('TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE', usdtSelected, () => {
        const rate = String(env.TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE ?? '');
        return /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(rate) && Number(rate) > 0 && Number(rate) < 10;
    }, 'TG USDT 报价须明确配置有效 CNY/USD 十进制汇率，无默认值');
    validate('TG_PURCHASE_ZPAY_API_BASE_URL', () => {
        const url = new URL(value(env, 'TG_PURCHASE_ZPAY_API_BASE_URL') || 'https://zpayz.cn');
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
    }, 'TG 支付网关需使用不含凭证的 HTTPS origin');
    validate('TG_PURCHASE_CHANNELS', () => {
        return channels.length > 0 && channels.every((item) => ['alipay', 'wxpay', 'usdt_bep20'].includes(item)) && new Set(channels).size === channels.length;
    }, 'TG 支付渠道支持支付宝、微信及 USDT（BEP20），按选择检查各自配置');
    if (value(env, 'TG_PUBLIC_ORIGIN') || purchaseActive) validate('TG_PUBLIC_ORIGIN', () => {
        const url = new URL(value(env, 'TG_PUBLIC_ORIGIN') || 'https://tg.fatherkey.com');
        return url.origin === 'https://tg.fatherkey.com' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    }, 'TG 付款回调与返回地址绑定独立服务域名');
    for (const [name, min, max] of [
        ['GRAMIX_API_TIMEOUT_MS', 250, 120000], ['TG_FULFILLMENT_POLL_SECONDS', 5, 3600], ['TG_FULFILLMENT_LEASE_SECONDS', 30, 600]
    ]) validate(name, () => !value(env, name) || (Number.isInteger(Number(value(env, name))) && Number(value(env, name)) >= min && Number(value(env, name)) <= max), `${name} 在支持的整数范围内`);
    const timeout = Number(value(env, 'GRAMIX_API_TIMEOUT_MS') || 15000);
    const lease = Number(value(env, 'TG_FULFILLMENT_LEASE_SECONDS') || 120) * 1000;
    validate('lease-budget', () => lease >= timeout + 30000, '订单 lease 比上游请求超时至少多 30 秒，给数据库持久化留出时间');
    validate('persistent-rate-limit', () => !['1', 'true'].includes(value(env, 'DISABLE_PERSISTENT_RATE_LIMITS').toLowerCase())
        && !['memory', 'in-memory', 'local'].includes((value(env, 'RATE_LIMIT_BACKEND') || value(env, 'RATE_LIMIT_STORE')).toLowerCase()), '公共接口不禁用持久化限流');
    if (value(env, 'TG_PUBLIC_ORIGINS')) add('extra-origins', 'pending', '额外公共来源还需同步服务器路由和 CORS；环境变量不能独立开放跨域。');
    if (envFile) validate('env-file-permissions', () => {
        const stat = fs.lstatSync(envFile);
        return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0;
    }, '环境文件需为私有普通文件，权限为 0600 或更严');
    else add('env-file-permissions', 'pending', '尚未检查服务器私有环境文件的权限；不要将真实密钥加入仓库。');
    for (const file of runtime ? RUNTIME_FILES : REQUIRED_FILES) validate(`file:${file}`, () => fs.statSync(path.join(repoRoot, file)).isFile(), '上线所需代码/迁移/调度文件存在');
    if (runtime) add('scheduler-policy', 'pending', '运行镜像只检查 API/worker 文件；静态页面由 Vercel 提供，systemd 文件需在 KVM4 host 另行核对。');
    else validate('scheduler-policy', () => {
        const service = fs.readFileSync(path.join(repoRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker.service'), 'utf8');
        const timer = fs.readFileSync(path.join(repoRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker.timer'), 'utf8');
        const runner = fs.readFileSync(path.join(repoRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker'), 'utf8');
        const cjs = fs.readFileSync(path.join(repoRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker.cjs'), 'utf8');
        return /^Type=oneshot$/m.test(service)
            && /^TimeoutStartSec=(?:1[5-9][0-9]|[2-9][0-9]{2,})$/m.test(service)
            && /^NoNewPrivileges=true$/m.test(service)
            && /^ProtectSystem=strict$/m.test(service)
            && /^ReadWritePaths=\/run\/lock$/m.test(service)
            && !/^EnvironmentFile=/m.test(service)
            && /^Persistent=false$/m.test(timer)
            && /docker exec -i --workdir \/app/.test(runner)
            && /--tg-scheduler/.test(runner)
            && /configuration_drift/.test(cjs)
            && !/(?:SUPABASE_SERVICE_ROLE_KEY|GRAMIX_API_KEY)\s*=/.test(runner)
            && !/(?:SUPABASE_SERVICE_ROLE_KEY|GRAMIX_API_KEY)\s*=/.test(cjs);
    }, 'TG 调度器固定版本、容器环境与 fail-closed 策略');
    for (const [key, message] of OPERATOR_CHECKS) add(`operator:${key}`, 'pending', message);
    const invalidCount = checks.filter((entry) => entry.status === 'invalid').length;
    const pendingCount = checks.filter((entry) => entry.status === 'pending').length;
    return {
        mode: 'offline', profile: runtime ? 'runtime' : 'repository', ok: invalidCount === 0, ready: false,
        redemption_enabled: enabled(env.TG_REDEMPTION_ENABLED), fulfillment_enabled: enabled(env.TG_FULFILLMENT_ENABLED), purchase_enabled: purchaseActive,
        invalid_count: invalidCount, pending_count: pendingCount, checks
    };
}

function getExitCode(options, report) {
    if ((options.failOnInvalid || options.failOnNotReady) && !report.ok) return 2;
    if (options.failOnNotReady && !report.ready) return 3;
    return 0;
}
function formatReport(report) {
    return ['TG 上线准备检查（完全离线，不执行 SQL 或购买）',
        ...report.checks.map((item) => `[${item.status.toUpperCase()}] ${item.key}: ${item.message}`),
        `配置有效: ${report.ok}；正式开放就绪: false；待核对: ${report.pending_count}`].join('\n');
}
function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const env = loadEnvFile(options.envFile);
    const report = runReadiness({ env, envFile: options.envFile, runtime: options.runtime });
    process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
    return getExitCode(options, report);
}
if (require.main === module) {
    try { process.exitCode = main(); }
    catch (_) { process.stderr.write('TG 上线检查未完成：参数或环境文件无效。\n'); process.exitCode = 2; }
}
module.exports = { REQUIRED_FILES, RUNTIME_FILES, OPERATOR_CHECKS, parseArgs, loadEnvFile, runReadiness, getExitCode, formatReport, main };
