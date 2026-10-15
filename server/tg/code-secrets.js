'use strict';

function unavailable() { return Object.assign(new Error('TG 兑换码密钥未完成安全配置'), { statusCode: 503, code: 'tg_secrets_unavailable' }); }
function configuredText(value) { return typeof value === 'string' ? value.trim() : ''; }
function codePepper(env = process.env) {
    const pepper = configuredText(env.TG_REDEMPTION_CODE_PEPPER);
    const bytes = Buffer.byteLength(pepper, 'utf8');
    const forbidden = [env.CRON_SECRET, env.SUPABASE_SERVICE_ROLE_KEY, env.TG_REDEMPTION_CODE_ENCRYPTION_KEY].map(configuredText).filter(Boolean);
    if (bytes < 32 || bytes > 512 || forbidden.includes(pepper)) throw unavailable();
    return pepper;
}
function encryptionKey(env = process.env) {
    const raw = configuredText(env.TG_REDEMPTION_CODE_ENCRYPTION_KEY);
    const forbidden = [env.CRON_SECRET, env.SUPABASE_SERVICE_ROLE_KEY, env.TG_REDEMPTION_CODE_PEPPER].map(configuredText).filter(Boolean);
    if (!raw || forbidden.includes(raw)) throw unavailable();
    let key;
    if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
    else if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) key = Buffer.from(raw, 'base64');
    if (!key || key.length !== 32) throw unavailable();
    return key;
}
module.exports = { codePepper, encryptionKey };
