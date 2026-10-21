#!/usr/bin/env node
'use strict';

/**
 * Controlled, single-shot probe of the 虾仁 purchase endpoints.
 *
 * This script exists to answer three questions the public merchant document
 * does not answer, before any adapter is allowed to advertise `procurement`:
 *
 *   1. Does re-submitting the same `request_no` return the original order
 *      (idempotent replay) instead of debiting the balance twice?
 *   2. Is the `amount` returned by /shared/commodity/trade CNY, and does it
 *      equal user_price * num?
 *   3. What is the shape of `secret` for an instant-delivery good?
 *
 * It is deliberately NOT part of the runtime, the worker, the registry or any
 * public route. It never prints the merchant secret, the signature or the
 * delivered content, and it refuses to run without an explicit hard cost cap.
 *
 *   node scripts/probe-xiareng-purchase.js --goods <CODE> --qty 1 --max-cny 1.00
 *   node scripts/probe-xiareng-purchase.js ... --execute            # real debit
 *   node scripts/probe-xiareng-purchase.js ... --execute --replay   # idempotency
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildXiarengForm, signXiarengParams } = require('../server/integrations/suppliers/xiareng/client');

const GATEWAY = 'https://xiareng.cc';
const ENDPOINTS = Object.freeze({
    detail: '/shared/commodity/item',
    quote: '/shared/commodity/valuation',
    trade: '/shared/commodity/trade'
});
// Hard rails: this probe is for a few cents of evidence, never for real buying.
const ABSOLUTE_MAX_CNY = 5;
const ABSOLUTE_MAX_QTY = 5;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function fail(message) {
    process.stderr.write(`probe: ${message}\n`);
    process.exit(1);
}

function parseArgs(argv) {
    const args = { qty: 1, race: '', execute: false, replay: false, out: '', contact: 'probe' };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const next = () => {
            const value = argv[i + 1];
            if (value === undefined) fail(`missing value for ${token}`);
            i += 1;
            return value;
        };
        switch (token) {
            case '--goods': args.goods = next(); break;
            case '--qty': args.qty = Number(next()); break;
            case '--max-cny': args.maxCny = Number(next()); break;
            case '--race': args.race = next(); break;
            case '--contact': args.contact = next(); break;
            case '--out': args.out = next(); break;
            case '--execute': args.execute = true; break;
            case '--replay': args.replay = true; break;
            case '--help': case '-h': args.help = true; break;
            default: fail(`unknown argument ${token}`);
        }
    }
    return args;
}

function usage() {
    process.stdout.write([
        'Usage: node scripts/probe-xiareng-purchase.js --goods <CODE> --qty <N> --max-cny <CNY> [--race R] [--execute] [--replay] [--out FILE]',
        '',
        'Without --execute nothing is purchased; the script only reads detail and valuation.',
        '--execute performs ONE real trade and debits the 虾仁 account balance.',
        '--replay re-submits the same request_no to test idempotency (only with --execute).',
        ''
    ].join('\n'));
}

function redactSecret(value) {
    if (typeof value !== 'string' || !value) return { present: false };
    return {
        present: true,
        bytes: Buffer.byteLength(value, 'utf8'),
        sha256_12: crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12),
        // A manual-delivery placeholder is short prose; card stock is not.
        looks_like_placeholder: value.length <= 120 && /等待|发货|处理中|请稍后|pending/i.test(value)
    };
}

async function post(endpoint, business, credentials) {
    const params = { ...business, app_id: credentials.appId };
    const form = `${buildXiarengForm(params)}&sign=${signXiarengParams(params, credentials.appKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(`${GATEWAY}${endpoint}`, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form
        });
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) fail('upstream response too large');
        let payload;
        try { payload = JSON.parse(text); } catch { fail('upstream returned non-JSON'); }
        return { status: response.status, payload };
    } catch (error) {
        if (error?.name === 'AbortError') fail(`${endpoint} timed out`);
        fail(`${endpoint} network error`);
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) return usage();
    if (!args.goods) fail('--goods is required');
    if (!Number.isSafeInteger(args.qty) || args.qty < 1 || args.qty > ABSOLUTE_MAX_QTY) {
        fail(`--qty must be an integer between 1 and ${ABSOLUTE_MAX_QTY}`);
    }
    if (!Number.isFinite(args.maxCny) || args.maxCny <= 0 || args.maxCny > ABSOLUTE_MAX_CNY) {
        fail(`--max-cny must be > 0 and <= ${ABSOLUTE_MAX_CNY}`);
    }
    if (args.replay && !args.execute) fail('--replay requires --execute');

    const appId = String(process.env.SUPPLIER_XIARENG_APP_ID || '').trim();
    const appKey = String(process.env.SUPPLIER_XIARENG_APP_KEY || '');
    if (!appId || !appKey) fail('SUPPLIER_XIARENG_APP_ID / SUPPLIER_XIARENG_APP_KEY are not set');
    const credentials = { appId, appKey };

    const detail = await post(ENDPOINTS.detail, { code: args.goods }, credentials);
    if (Number(detail.payload?.code) !== 200 || !detail.payload.data) {
        fail(`detail rejected: ${detail.payload?.msg || detail.payload?.code}`);
    }
    const goods = detail.payload.data;
    const minimum = Number(goods.minimum) > 0 ? Number(goods.minimum) : 1;
    const maximum = Number(goods.maximum) > 0 ? Number(goods.maximum) : Infinity;
    if (args.qty < minimum || args.qty > maximum) fail(`quantity ${args.qty} is outside upstream ${minimum}..${maximum}`);
    if (Number(goods.stock) < args.qty) fail('insufficient upstream stock');

    const quote = await post(ENDPOINTS.quote, { code: args.goods, num: args.qty, ...(args.race ? { race: args.race } : {}) }, credentials);
    const unit = Number(quote.payload?.data?.price);
    if (!Number.isFinite(unit) || unit <= 0) fail('valuation did not return a usable price');
    const expected = Number((unit * args.qty).toFixed(6));
    if (expected > args.maxCny) fail(`expected cost ${expected} exceeds --max-cny ${args.maxCny}`);

    const plan = {
        mode: args.execute ? (args.replay ? 'execute+replay' : 'execute') : 'dry-run',
        goods: args.goods,
        name: String(goods.name || '').slice(0, 120),
        quantity: args.qty,
        upstreamUnitPrice: unit,
        expectedCost: expected,
        maxCny: args.maxCny,
        upstreamMin: minimum,
        upstreamMax: Number.isFinite(maximum) ? maximum : null,
        upstreamStock: Number(goods.stock),
        race: args.race || null,
        deliveryWay: goods.delivery_way ?? null,
        config: Array.isArray(goods.config) && goods.config.length === 0 ? 'empty' : typeof goods.config
    };
    process.stdout.write(`plan ${JSON.stringify(plan)}\n`);
    if (!args.execute) {
        process.stdout.write('dry-run: no trade was submitted. Re-run with --execute to purchase once.\n');
        return;
    }

    const requestNo = crypto.randomUUID();
    const business = {
        shared_code: args.goods,
        num: args.qty,
        request_no: requestNo,
        contact: args.contact
    };
    if (args.race) business.race = args.race;

    const first = await post(ENDPOINTS.trade, business, credentials);
    const firstData = first.payload?.data || null;
    const firstOk = Number(first.payload?.code) === 200 && firstData && firstData.tradeNo;
    const firstRecord = firstOk ? {
        code: Number(first.payload.code),
        tradeNo: String(firstData.tradeNo),
        amount: firstData.amount == null ? null : String(firstData.amount),
        stock: firstData.stock == null ? null : String(firstData.stock),
        secret: redactSecret(firstData.secret)
    } : { code: first.payload?.code ?? null, msg: String(first.payload?.msg || '').slice(0, 120) };
    process.stdout.write(`trade ${JSON.stringify(firstRecord)}\n`);

    const evidence = {
        probedAt: new Date().toISOString(),
        gateway: GATEWAY,
        plan,
        requestNo,
        first: firstRecord,
        amountIsCny: firstOk && Math.abs(Number(firstRecord.amount) - expected) < 0.000001,
        replay: null
    };

    if (args.replay && firstOk) {
        // Same request_no, same everything. If the supplier deduplicates, this
        // must return the identical tradeNo and must not debit a second time.
        const second = await post(ENDPOINTS.trade, business, credentials);
        const secondData = second.payload?.data || null;
        const secondOk = Number(second.payload?.code) === 200 && secondData && secondData.tradeNo;
        evidence.replay = {
            code: Number(second.payload?.code) ?? null,
            tradeNo: secondOk ? String(secondData.tradeNo) : null,
            amount: secondOk && secondData.amount != null ? String(secondData.amount) : null,
            sameTradeNo: Boolean(secondOk && String(secondData.tradeNo) === firstRecord.tradeNo),
            msg: secondOk ? null : String(second.payload?.msg || '').slice(0, 120)
        };
        process.stdout.write(`replay ${JSON.stringify(evidence.replay)}\n`);
    }

    const out = args.out || path.join(require('node:os').tmpdir(), `xiareng-probe-${Date.now()}.json`);
    fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`evidence ${out}\n`);
    if (firstOk && Number(firstRecord.amount) > args.maxCny) {
        process.stdout.write('ALERT: actual debit exceeded --max-cny; the supplier does not enforce an upstream cost ceiling.\n');
        process.exitCode = 3;
    }
}

main().catch((error) => fail(error?.message || 'unexpected failure'));
