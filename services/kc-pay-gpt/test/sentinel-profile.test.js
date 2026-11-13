'use strict';

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Module from 'node:module';
import { EventEmitter } from 'node:events';

const {
    getChatGptProtocolProfile,
    buildChatGptBrowserHeaders
} = require('../region-config');
const { prepareChatGptProtocolContext } = require('../session-auth');

function loadSentinelClientWithSpawnMock(mockSpawn) {
    const clientPath = require.resolve('../sentinel/sentinel-client');
    delete require.cache[clientPath];
    const origLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'child_process' && parent && parent.filename === clientPath) {
            return { spawn: mockSpawn };
        }
        return origLoad.call(this, request, parent, isMain);
    };
    try {
        return require(clientPath);
    } finally {
        Module._load = origLoad;
        delete require.cache[clientPath];
    }
}

describe('ChatGPT protocol profile & Sentinel alignment', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('aligns PH vs US protocol profiles and derives sec-ch-ua from custom Linux Chrome UA', () => {
        const ph = getChatGptProtocolProfile('PH');
        expect(ph.region).toBe('PH');
        expect(ph.platform).toBe('Win32');
        expect(ph.platformLabel).toBe('Windows');
        expect(ph.language).toBe('en-PH');
        expect(ph.acceptLanguage).toContain('en-PH');
        expect(ph.timezone).toBe('Asia/Manila');
        expect(ph.userAgent).toContain('Windows NT 10.0');
        expect(ph.secChUaPlatform).toBe('"Windows"');

        const us = getChatGptProtocolProfile('US');
        expect(us.language).toBe('en-US');
        expect(us.timezone).toBe('America/New_York');

        const linuxProfile = getChatGptProtocolProfile('PH', {
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
        });
        expect(linuxProfile.platform).toBe('Linux x86_64');
        expect(linuxProfile.platformLabel).toBe('Linux');
        expect(linuxProfile.secChUaPlatform).toBe('"Linux"');
        expect(linuxProfile.secChUa).toContain('v="140"');

        const headers = buildChatGptBrowserHeaders(ph, { Accept: 'application/json' });
        expect(headers['User-Agent']).toBe(ph.userAgent);
        expect(headers['Accept-Language']).toBe(ph.acceptLanguage);
        expect(headers['sec-ch-ua']).toBe(ph.secChUa);
        expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
        expect(headers.Accept).toBe('application/json');
    });

    it('prepareChatGptProtocolContext preserves existing oai-did or injects UUIDv4 in both deviceId and cookieHeader', () => {
        const fakeJwt = [
            Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
            Buffer.from(JSON.stringify({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
            'sig'
        ].join('.');

        const existingDid = '11111111-2222-4333-8444-555555555555';
        const rawWithDid = JSON.stringify({
            accessToken: fakeJwt,
            user: { id: 'user-1', email: 'test@example.com' },
            cookies: [
                { name: '__Secure-next-auth.session-token', value: 'tok-abc' },
                { name: 'oai-did', value: existingDid }
            ]
        });
        const kept = prepareChatGptProtocolContext(rawWithDid);
        expect(kept.deviceId).toBe(existingDid);
        expect(kept.cookieHeader).toContain(`oai-did=${existingDid}`);
        expect(kept.cookieHeader).toContain('__Secure-next-auth.session-token=tok-abc');

        const rawWithoutDid = JSON.stringify({
            accessToken: fakeJwt,
            user: { id: 'user-1', email: 'test@example.com' },
            cookies: [
                { name: '__Secure-next-auth.session-token', value: 'tok-xyz' }
            ]
        });
        const generated = prepareChatGptProtocolContext(rawWithoutDid);
        expect(generated.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(generated.cookieHeader).toContain(`oai-did=${generated.deviceId}`);
        expect(generated.cookieHeader).toContain('__Secure-next-auth.session-token=tok-xyz');
    });

    it('mintSentinelToken forwards region-aligned profile, deviceId, and cookieHeader to sentinel_bridge', async () => {
        const ph = getChatGptProtocolProfile('PH');
        let capturedStdin = '';

        const mockSpawn = vi.fn(() => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.kill = vi.fn();
            proc.stdin = {
                write(chunk) { capturedStdin += String(chunk); },
                end(chunk) {
                    if (chunk) capturedStdin += String(chunk);
                    process.nextTick(() => {
                        proc.stdout.emit('data', Buffer.from(JSON.stringify({
                            main: 'sentinel-main-token',
                            so: 'sentinel-so-token',
                            powReq: true
                        }) + '\n'));
                        proc.emit('close', 0);
                    });
                }
            };
            return proc;
        });

        const { mintSentinelToken } = loadSentinelClientWithSpawnMock(mockSpawn);
        const res = await mintSentinelToken({
            flow: 'chatgpt_checkout',
            region: 'PH',
            deviceId: 'did-999',
            cookieHeader: 'oai-did=did-999; __Secure-next-auth.session-token=tok-1'
        });

        expect(mockSpawn).toHaveBeenCalledOnce();
        expect(res).toMatchObject({
            sentinelToken: 'sentinel-main-token',
            sentinelSoToken: 'sentinel-so-token',
            powReq: true
        });
        const payload = JSON.parse(capturedStdin);
        expect(payload).toMatchObject({
            flow: 'chatgpt_checkout',
            ua: ph.userAgent,
            language: ph.language,
            acceptLanguage: ph.acceptLanguage,
            timezone: ph.timezone,
            platform: ph.platform,
            platformLabel: ph.platformLabel,
            secChUa: ph.secChUa,
            secChUaPlatform: ph.secChUaPlatform,
            deviceId: 'did-999',
            cookieHeader: 'oai-did=did-999; __Secure-next-auth.session-token=tok-1'
        });
    });

    it('sentinel_bootstrap derives g.origin dynamically from pageUrl rather than hardcoding auth.openai.com', () => {
        const bootstrapPath = path.join(__dirname, '..', 'sentinel', 'sentinel_bootstrap.js');
        const source = fs.readFileSync(bootstrapPath, 'utf8');
        expect(source).not.toContain('g.origin = "https://auth.openai.com"');

        const profile = getChatGptProtocolProfile('PH');
        const sandbox = {
            URL,
            URLSearchParams,
            TextEncoder,
            TextDecoder,
            AbortController,
            Headers,
            Response,
            Request,
            crypto,
            performance,
            navigator: {},
            screen: {},
            history: {},
            console: { log() {}, warn() {}, error() {} },
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            fetch: vi.fn(),
            WebGLRenderingContext: undefined,
            HTMLCanvasElement: undefined,
            __UA__: profile.userAgent,
            __LANGUAGE__: profile.language,
            __LANGUAGES__: profile.languages,
            __TIMEZONE__: profile.timezone,
            __PLATFORM__: profile.platform,
            __PLATFORM_LABEL__: profile.platformLabel,
            __CORES__: 8,
            __SCREEN_W__: 1920,
            __SCREEN_H__: 1080,
            __AVAIL_H__: 1032,
            __MAX_TOUCH__: 0,
            __PAGE_URL__: 'https://chatgpt.com/',
            __SDK_URL__: 'https://cdn.oaistatic.com/assets/sentinel.js',
            __COOKIE_HEADER__: 'oai-did=did-999',
            __SEED_DID_KEY__: 'oai-did',
            __SEED_DID_VAL__: 'did-999'
        };
        sandbox.globalThis = sandbox;
        sandbox.self = sandbox;
        sandbox.window = sandbox;

        vm.runInNewContext(source, sandbox);
        expect(sandbox.location.origin).toBe('https://chatgpt.com');
        expect(sandbox.location.hostname).toBe('chatgpt.com');
        expect(sandbox.navigator.language).toBe(profile.language);
        expect(sandbox.navigator.platform).toBe(profile.platform);
    });

    it('protocol-http aligns Impit browser, strips navigation headers on CORS, and merges Set-Cookie', () => {
        const {
            resolveImpitBrowser,
            prepareImpitHeaders,
            createInMemoryCookieJar
        } = require('../protocol-http');

        const profile = getChatGptProtocolProfile('PH');
        expect(profile.userAgent).toContain('Chrome/151.');
        expect(resolveImpitBrowser(profile.userAgent)).toBe('chrome151');
        expect(resolveImpitBrowser('Chrome/142.0.0.0')).toBe('chrome142');
        expect(resolveImpitBrowser('Chrome/136.0.0.0')).toBe('chrome136');

        const browserHeaders = buildChatGptBrowserHeaders(profile, {
            Accept: 'application/json',
            'x-openai-target-path': '/backend-api/payments/checkout'
        });
        expect(browserHeaders['sec-fetch-site']).toBe('same-origin');
        expect(browserHeaders['sec-fetch-mode']).toBe('cors');
        expect(browserHeaders['sec-fetch-dest']).toBe('empty');
        expect(browserHeaders.priority).toBe('u=1, i');
        expect(browserHeaders['upgrade-insecure-requests']).toBeUndefined();

        const impitHeaders = prepareImpitHeaders(browserHeaders, { stripCookie: true });
        expect(impitHeaders['upgrade-insecure-requests']).toBe('');
        expect(impitHeaders['sec-fetch-user']).toBe('');
        expect(impitHeaders['sec-fetch-mode']).toBe('cors');

        const stripeHeaders = prepareImpitHeaders({ 'Sec-Fetch-Site': 'same-site' });
        expect(stripeHeaders['Sec-Fetch-Site']).toBe('same-site');
        expect(stripeHeaders['sec-fetch-site']).toBeUndefined();

        const jar = createInMemoryCookieJar('oai-did=did-1; __Secure-next-auth.session-token=tok-1');
        jar.setCookie('__cf_bm=bm_abc; Path=/; HttpOnly');
        jar.setCookie('_cfuvid=uv_xyz; Path=/');
        expect(jar.getCookieString()).toContain('__cf_bm=bm_abc');
        expect(jar.getCookieString()).toContain('_cfuvid=uv_xyz');
        jar.setCookie('__cf_bm=; Max-Age=0; Path=/');
        expect(jar.getCookieString()).not.toContain('__cf_bm=');
    });

    it('sentinel_bootstrap filters HttpOnly cookies, aligns userAgentData brands, and disables about-you typing on checkout', () => {
        const bootstrapPath = path.join(__dirname, '..', 'sentinel', 'sentinel_bootstrap.js');
        const source = fs.readFileSync(bootstrapPath, 'utf8');
        const profile = getChatGptProtocolProfile('PH');

        const makeSandbox = (overrides = {}) => {
            const sb = {
                URL,
                URLSearchParams,
                TextEncoder,
                TextDecoder,
                AbortController,
                Headers,
                Response,
                Request,
                crypto,
                performance,
                navigator: {},
                screen: {},
                history: {},
                console: { log() {}, warn() {}, error() {} },
                setTimeout,
                clearTimeout,
                setInterval,
                clearInterval,
                fetch: vi.fn(),
                WebGLRenderingContext: undefined,
                HTMLCanvasElement: undefined,
                __UA__: profile.userAgent,
                __LANGUAGE__: profile.language,
                __LANGUAGES__: profile.languages,
                __TIMEZONE__: profile.timezone,
                __PLATFORM__: profile.platform,
                __PLATFORM_LABEL__: profile.platformLabel,
                __SEC_CH_UA__: profile.secChUa,
                __CORES__: 8,
                __SCREEN_W__: 1920,
                __SCREEN_H__: 1080,
                __AVAIL_H__: 1032,
                __MAX_TOUCH__: 0,
                __PAGE_URL__: 'https://chatgpt.com/',
                __FLOW__: 'chatgpt_checkout',
                __SDK_URL__: 'https://chatgpt.com/sentinel/20260810913b/sdk.js',
                __COOKIE_HEADER__: 'oai-did=did-999; __Secure-next-auth.session-token=secret-http-only; __cf_bm=cf-http-only; oai-nav-state=1',
                __SEED_DID_KEY__: 'oai-did',
                __SEED_DID_VAL__: 'did-999',
                ...overrides
            };
            sb.globalThis = sb;
            sb.self = sb;
            sb.window = sb;
            vm.runInNewContext(source, sb);
            return sb;
        };

        const checkoutSb = makeSandbox();
        expect(checkoutSb.document.cookie).toContain('oai-did=did-999');
        expect(checkoutSb.document.cookie).toContain('oai-nav-state=1');
        expect(checkoutSb.document.cookie).not.toContain('__Secure-next-auth.session-token');
        expect(checkoutSb.document.cookie).not.toContain('__cf_bm');
        expect(checkoutSb.navigator.userAgentData.brands.map((b) => `${b.brand}:${b.version}`)).toContain('Not=A?Brand:99');
        expect(checkoutSb.__oai_so_h).toEqual([]);
        expect(checkoutSb.__oai_so_k).toBe(0);
        expect(checkoutSb.__oai_so_p.length).toBeGreaterThan(0);

        const signupSb = makeSandbox({
            __PAGE_URL__: 'https://auth.openai.com/about-you',
            __FLOW__: 'create_account'
        });
        expect(signupSb.__oai_so_h.length).toBeGreaterThan(0);
    });

    it('sentinel_sdk __proto2 produces solved PoW matching /sentinel/req instance identity', async () => {
        const bootstrapSrc = fs.readFileSync(path.join(__dirname, '..', 'sentinel', 'sentinel_bootstrap.js'), 'utf8');
        const sdkSrc = fs.readFileSync(path.join(__dirname, '..', 'sentinel', 'sentinel_sdk.js'), 'utf8');
        const profile = getChatGptProtocolProfile('PH');

        let capturedReqP = '';
        const sandbox = {
            URL,
            URLSearchParams,
            TextEncoder,
            TextDecoder,
            AbortController,
            Headers,
            Response,
            Request,
            btoa: (s) => Buffer.from(String(s), 'latin1').toString('base64'),
            atob: (s) => Buffer.from(String(s), 'base64').toString('latin1'),
            crypto: globalThis.crypto,
            console: { log() {}, warn() {}, error() {} },
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            queueMicrotask,
            fetch: async (_url, opts) => {
                if (opts?.body) {
                    capturedReqP = JSON.parse(opts.body).p || '';
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        token: 'c_unit_test',
                        proofofwork: { required: true, seed: '0.987654', difficulty: '0fff' },
                        turnstile: { required: false },
                        so: { required: false }
                    })
                };
            },
            __UA__: profile.userAgent,
            __LANGUAGE__: profile.language,
            __LANGUAGES__: profile.languages,
            __TIMEZONE__: profile.timezone,
            __PLATFORM__: profile.platform,
            __PLATFORM_LABEL__: profile.platformLabel,
            __SEC_CH_UA__: profile.secChUa,
            __CORES__: 8,
            __SCREEN_W__: 1920,
            __SCREEN_H__: 1080,
            __AVAIL_H__: 1032,
            __MAX_TOUCH__: 0,
            __PAGE_URL__: 'https://chatgpt.com/',
            __FLOW__: 'chatgpt_checkout',
            __SDK_URL__: 'https://chatgpt.com/sentinel/20260810913b/sdk.js',
            __COOKIE_HEADER__: 'oai-did=did-999',
            __SEED_DID_KEY__: 'oai-did',
            __SEED_DID_VAL__: 'did-999'
        };
        sandbox.globalThis = sandbox;
        sandbox.self = sandbox;
        sandbox.window = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(bootstrapSrc, sandbox);
        vm.runInContext(`${sdkSrc}\n;globalThis.__SDK = SentinelSDK;`, sandbox);

        const out = JSON.parse(await vm.runInContext('__SDK.__proto2("chatgpt_checkout")', sandbox));
        expect(out.p.startsWith('gAAAAAB')).toBe(true);

        const decodeP = (tok) => JSON.parse(Buffer.from(tok.slice(7).split('~')[0], 'base64').toString('utf8'));
        const reqCfg = decodeP(capturedReqP);
        const ansCfg = decodeP(out.p);
        expect(ansCfg[2]).toBe(reqCfg[2]); // jsHeapSizeLimit
        expect(ansCfg[5]).toBe(reqCfg[5]); // sdkUrl
        expect(ansCfg[14]).toBe(reqCfg[14]); // sid
        expect(ansCfg[17]).toBe(reqCfg[17]); // timeOrigin
    });
});
