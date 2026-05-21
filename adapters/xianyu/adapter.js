#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
    runXianyuAdapter
} = require('./core');
const {
    loadXianyuAdminAdapterConfig
} = require('./admin-runtime');

const repoRoot = path.resolve(__dirname, '../..');

function parseArgs(argv = []) {
    const options = {
        configPath: path.join(repoRoot, 'adapters/xianyu/config.example.json'),
        ordersPath: path.join(repoRoot, 'adapters/xianyu/mock-orders.example.json'),
        envFile: '',
        fromAdmin: false,
        overrides: {},
        dryRunOverride: undefined
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--config') {
            options.configPath = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--orders') {
            options.ordersPath = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--from-admin') {
            options.fromAdmin = true;
            continue;
        }

        if (value === '--base-url') {
            options.overrides.website_base_url = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--channel') {
            options.overrides.channel = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--account') {
            options.overrides.account = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--site') {
            options.overrides.site = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--token-env') {
            options.overrides.ingest_token_env = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--dry-run') {
            options.dryRunOverride = true;
            continue;
        }

        if (value === '--submit') {
            options.dryRunOverride = false;
        }
    }

    return options;
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeOrdersJson(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.orders)) return value.orders;
    if (Array.isArray(value?.data?.orders)) return value.data.orders;
    if (value && typeof value === 'object') return [value];
    return [];
}

function formatCliError(error) {
    const message = String(error?.message || error || 'Xianyu adapter failed').trim();
    if (/Missing required environment variable: SUPABASE_URL/i.test(message)) {
        return [
            '无法读取 Admin Studio 配置：缺少 SUPABASE_URL。',
            '请使用 --env-file 指向包含 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、ADMIN_CONFIG_ENCRYPTION_KEY 的环境文件。'
        ].join('\n');
    }
    if (/Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY/i.test(message)) {
        return [
            '无法读取 Admin Studio 配置：缺少 SUPABASE_SERVICE_ROLE_KEY。',
            '请使用 --env-file 指向服务端环境文件，适配器需要只读后台配置和密钥仓。'
        ].join('\n');
    }
    if (/ADMIN_CONFIG_ENCRYPTION_KEY/i.test(message)) {
        return [
            `无法读取 Admin Studio 密钥：${message}`,
            '请确认 --env-file 里的 ADMIN_CONFIG_ENCRYPTION_KEY 与后台保存 Token 时使用的一致。'
        ].join('\n');
    }
    return message;
}

function applyEnvFile(envFile = '', env = process.env) {
    const normalizedPath = String(envFile || '').trim();
    if (!normalizedPath) return;
    const parsed = dotenv.parse(fs.readFileSync(normalizedPath, 'utf8'));
    Object.entries(parsed).forEach(([key, value]) => {
        if (env[key] === undefined || env[key] === '') {
            env[key] = value;
        }
    });
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const options = parseArgs(argv);
    applyEnvFile(options.envFile, env);
    const shouldSubmit = options.dryRunOverride === false;
    const config = options.fromAdmin
        ? {
            ...(await loadXianyuAdminAdapterConfig({
                accountKey: options.overrides.account,
                websiteBaseUrl: options.overrides.website_base_url,
                site: options.overrides.site,
                dryRun: options.dryRunOverride,
                includeSecret: shouldSubmit,
                env
            })),
            ...options.overrides
        }
        : {
            ...readJsonFile(options.configPath),
            ...options.overrides
        };
    const orders = normalizeOrdersJson(readJsonFile(options.ordersPath));
    const summary = await runXianyuAdapter({
        config,
        orders,
        env,
        dryRun: options.dryRunOverride
    });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${formatCliError(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    applyEnvFile,
    formatCliError,
    main,
    normalizeOrdersJson,
    parseArgs
};
