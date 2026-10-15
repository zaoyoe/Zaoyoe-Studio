'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function enabled(value) { return ['1', 'true'].includes(String(value || '').trim().toLowerCase()); }
const relevantConfiguration = (name) => /^(?:TG_|GRAMIX_)/.test(name) || ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name);
function applicationDigest(appRoot) {
    const tgRoot = path.join(appRoot, 'server/tg');
    const files = ['package.json', 'package-lock.json', 'scripts/tg-fulfillment-worker.js'];
    function visit(directory) {
        for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
            const filename = path.join(directory, item.name);
            if (item.isDirectory()) visit(filename);
            else if (item.isFile() && item.name.endsWith('.js')) files.push(path.relative(appRoot, filename).split(path.sep).join('/'));
            else if (item.isSymbolicLink()) fail('tg_scheduler_code_mismatch');
        }
    }
    visit(tgRoot);
    const manifest = files.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map((filename) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot, filename))).digest('hex')}  ${filename}\n`).join('');
    return crypto.createHash('sha256').update(manifest).digest('hex');
}

function checkConfiguration(envText, env, parseEnv) {
    if (typeof envText !== 'string') fail('tg_scheduler_configuration_invalid');
    if (Buffer.byteLength(envText, 'utf8') > 1024 * 1024) fail('tg_scheduler_configuration_invalid');
    const fileEnv = parseEnv(envText);
    const declared = new Set();
    // Docker Compose expands unquoted/double-quoted $ values and interprets
    // additional escapes. Never guess that expansion using dotenv, shell
    // evaluation or host variables. Relevant keys must use simple literals;
    // single quotes allow literal $ and # characters without expansion.
    for (const line of envText.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match || !relevantConfiguration(match[1])) continue;
        const [, key, raw] = match;
        if (declared.has(key)) fail('tg_scheduler_configuration_ambiguous');
        declared.add(key);
        let literal;
        if (raw.startsWith("'")) literal = raw.match(/^'([^']*)'(?:\s+#.*)?\s*$/)?.[1];
        else if (raw.startsWith('"')) literal = raw.match(/^"([^"\\$]*)"(?:\s+#.*)?\s*$/)?.[1];
        else {
            const unquoted = raw.replace(/\s+#.*$/, '').trim();
            if (!/["'`\\$#]/.test(unquoted)) literal = unquoted;
        }
        if (literal === undefined || fileEnv[key] !== literal) fail('tg_scheduler_configuration_ambiguous');
    }
    const keys = new Set([...Object.keys(fileEnv), ...Object.keys(env)].filter(relevantConfiguration));
    for (const key of keys) {
        if (Object.hasOwn(fileEnv, key) && !declared.has(key)) fail('tg_scheduler_configuration_ambiguous');
        // Detect both a stale API container and Compose-level overrides.
        // Never print either side when they differ.
        if (String(fileEnv[key] ?? '') !== String(env[key] ?? '')) fail('tg_scheduler_configuration_drift');
    }
    return { fulfillmentEnabled: enabled(env.TG_FULFILLMENT_ENABLED) };
}

function run({ mode, expectedDigest, envText, env = process.env, appRoot = '/app', digest = applicationDigest, parseEnv = (value) => require('dotenv').parse(value), spawn = spawnSync } = {}) {
    if (!['--check', '--once'].includes(mode) || !/^[0-9a-f]{64}$/.test(String(expectedDigest || ''))) fail('tg_scheduler_invalid_arguments');
    if (digest(appRoot) !== expectedDigest) fail('tg_scheduler_code_mismatch');
    const { fulfillmentEnabled } = checkConfiguration(envText, env, parseEnv);
    // Check mode never constructs a Supabase or provider client and never
    // invokes the purchasing CLI, even when production fulfillment is enabled.
    if (mode === '--check') return { success: true, checked: true, fulfillment_enabled: fulfillmentEnabled };
    if (!fulfillmentEnabled) return { success: true, processed: false, disabled: true };
    const result = spawn(process.execPath, ['scripts/tg-fulfillment-worker.js', '--once'], {
        cwd: appRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 65536
    });
    let data;
    try { data = JSON.parse(String(result.stdout || '').trim()); } catch (_) { fail('tg_scheduler_tick_failed'); }
    if (result.status !== 0 || result.error || data?.success !== true) fail('tg_scheduler_tick_failed');
    // The worker already suppresses sensitive causes. Whitelist again at the
    // host boundary so neither child stdout nor stderr can leak into journal.
    return { success: true, processed: data.processed === true, ...(data.disabled === true ? { disabled: true } : {}) };
}

if (require.main === module || process.argv[1] === '--tg-scheduler') {
    try {
        const args = process.argv.slice(2);
        if (args.length !== 2) fail('tg_scheduler_invalid_arguments');
        const result = run({ mode: args[0], expectedDigest: args[1], envText: fs.readFileSync(0, 'utf8') });
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        const allowed = new Set(['tg_scheduler_invalid_arguments', 'tg_scheduler_code_mismatch', 'tg_scheduler_configuration_invalid', 'tg_scheduler_configuration_ambiguous', 'tg_scheduler_configuration_drift', 'tg_scheduler_tick_failed']);
        process.stderr.write(`${JSON.stringify({ success: false, code: allowed.has(error?.code) ? error.code : 'tg_scheduler_preflight_failed' })}\n`);
        process.exitCode = 1;
    }
}

module.exports = { applicationDigest, checkConfiguration, run };
