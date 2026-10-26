import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { assertLocalSessionFresh, verifyChatGptAccessToken, isChatGptAuthFailure, checkChatGptSubscriptionStatus, assertChatGptAccountEligible } from '../chatgpt-auth-state.js';
import { installChatGptSession, bootstrapChatGptSession, buildSessionPayload } from '../session-auth.js';
import { hasLoggedInChatUi, hasLoggedInSessionApi } from '../auth-page-detect.js';
import { ensurePricingDialogVisible } from '../pricing-checkout.js';

const jwt = payload => `eyJ0eXAiOiJKV1QifQ.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.offline-signature`;
let browser;
const contexts = [];
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });

async function fixture({
    status = 200,
    me = { id: 'user-offline', email: 'offline@example.test' },
    sessionApi = { user: { id: 'cached-user' }, accessToken: 'cached-value' },
    html = '<button>New chat</button>'
} = {}) {
    const context = await browser.newContext();
    contexts.push(context);
    const meAuthorizations = [];
    // No credentials or requests can reach ChatGPT or a real payment service.
    const responder = route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/backend-api/me') {
            meAuthorizations.push(route.request().headers().authorization);
            return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(me) });
        }
        if (url.pathname === '/api/auth/session') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(sessionApi) });
        return route.fulfill({ contentType: 'text/html', body: html });
    };
    await context.route('**/*', responder);
    const page = await context.newPage();
    await page.route('**/*', responder);
    await page.goto('https://chatgpt.com/');
    return { context, page, meAuthorizations };
}

async function withoutSessionEnv(callback) {
    const keys = ['CHATGPT_SESSION_COOKIE', 'CHATGPT_SESSION_TOKEN'];
    const saved = keys.map(key => process.env[key]);
    keys.forEach(key => delete process.env[key]);
    try { return await callback(); }
    finally {
        keys.forEach((key, index) => {
            if (saved[index] === undefined) delete process.env[key];
            else process.env[key] = saved[index];
        });
    }
}

describe('local Session expiry is a rejection check, never authentication proof', () => {
    it('rejects an expired JWT even when supplied Session expiry is in the future', () => {
        expect(() => assertLocalSessionFresh(jwt({ exp: 100 }), { expires: '2099-01-01' }, 100001)).toThrow(/CHATGPT_SESSION_EXPIRED/);
    });
    it('rejects expired Session metadata even with a future JWT', () => {
        expect(() => assertLocalSessionFresh(jwt({ exp: 9999999999 }), { expires: '2000-01-01' })).toThrow(/CHATGPT_SESSION_EXPIRED/);
    });
    it('uses the actual JWT expiry without inventing seven extra days', () => {
        expect(buildSessionPayload(jwt({ exp: 100 })).expires).toBe(new Date(100000).toISOString());
        expect(buildSessionPayload('opaque').expires).toBeUndefined();
    });
    it('rejects before touching the browser or injecting Cookies', async () => {
        const context = { addCookies: vi.fn(), route: vi.fn(), addInitScript: vi.fn() };
        await expect(installChatGptSession(context, JSON.stringify({ accessToken: jwt({ exp: 1 }), user: { id: 'offline' } })))
            .rejects.toMatchObject({ code: 'CHATGPT_SESSION_EXPIRED' });
        expect(context.addCookies).not.toHaveBeenCalled();
        expect(context.route).not.toHaveBeenCalled();
    });
});

describe('official authentication and visible expiry', () => {
    it('rejects revoked credentials despite locally unexpired metadata and cached logged-in UI', async () => {
        const { page } = await fixture({ status: 401, me: { error: { code: 'token_expired' } } });
        const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
        const raw = JSON.stringify({ user: { id: 'user-offline', email: 'offline@example.test' }, accessToken: jwt({ exp: 9999999999 }), expires: '2099-01-01' });
        await expect(bootstrapChatGptSession(page, raw, { cookieVerified: true, hasSessionToken: true })).rejects.toMatchObject({ code: 'CHATGPT_SESSION_EXPIRED' });
        expect(logs.mock.calls.flat().join('\n')).not.toContain('Session 登录成功');
    });
    it('a locally mocked /api/auth/session cannot establish official authentication', async () => {
        const { context, page } = await fixture({ status: 401, me: { error: 'invalid_token' } });
        const raw = JSON.stringify({ user: { id: 'user-offline', email: 'offline@example.test' }, accessToken: jwt({ exp: 9999999999 }) });
        await withoutSessionEnv(() => installChatGptSession(context, raw));
        await page.goto('https://chatgpt.com/');
        expect(await page.evaluate(async () => (await (await fetch('/api/auth/session')).json()).user.id)).toBe('user-offline');
        expect(await hasLoggedInSessionApi(page)).toBe(false);
        await expect(verifyChatGptAccessToken(page, jwt({ exp: 9999999999 }))).rejects.toMatchObject({ code: 'CHATGPT_SESSION_EXPIRED' });
    });
    it('uses the current Cookie-verified access token when the supplied token is stale', async () => {
        const currentToken = jwt({ exp: 9999999999 });
        const { context, page, meAuthorizations } = await fixture({
            sessionApi: {
                user: { id: 'user-offline', email: 'offline@example.test' },
                accessToken: currentToken,
                expires: '2099-01-01T00:00:00.000Z'
            }
        });
        const raw = JSON.stringify({
            user: { id: 'user-offline', email: 'offline@example.test' },
            accessToken: jwt({ exp: 1 }),
            expires: '2000-01-01T00:00:00.000Z',
            sessionToken: 'offline-session-cookie'
        });

        const result = await withoutSessionEnv(async () => {
            const installed = await installChatGptSession(context, raw);
            expect(installed.cookieVerified).toBe(true);
            expect(installed.sessionData.accessToken).toBe(currentToken);
            await bootstrapChatGptSession(page, raw, installed);
            return installed;
        });

        expect(result.sessionData.expires).toBe('2099-01-01T00:00:00.000Z');
        expect(meAuthorizations).toContain(`Bearer ${currentToken}`);
        expect(meAuthorizations).not.toContain(`Bearer ${jwt({ exp: 1 })}`);
    });
    it('rejects a Cookie session that belongs to a different supplied account', async () => {
        const { context } = await fixture({
            sessionApi: { user: { id: 'cookie-account', email: 'cookie@example.test' }, accessToken: 'cookie-current-token' }
        });
        const raw = JSON.stringify({
            user: { id: 'input-account', email: 'input@example.test' },
            accessToken: jwt({ exp: 9999999999 }),
            sessionToken: 'offline-session-cookie'
        });

        await expect(withoutSessionEnv(() => installChatGptSession(context, raw)))
            .rejects.toMatchObject({ code: 'CHATGPT_ACCOUNT_MISMATCH' });
    });
    it('an expiry popup overrides New chat and stops pricing recovery before clicking', async () => {
        const { page } = await fixture({ html: '<button>New chat</button><button data-testid="profile">Profile</button><div role="dialog"><h2>Your session has expired</h2><p>Please log in again to continue using the app.</p></div>' });
        expect(await hasLoggedInChatUi(page)).toBe(false);
        await expect(ensurePricingDialogVisible(page, 60000)).rejects.toMatchObject({ code: 'CHATGPT_SESSION_EXPIRED' });
        expect(await page.evaluate(() => location.hash)).toBe('');
    });
    it('stops a delayed expiry popup during pricing polling', async () => {
        const { page } = await fixture({ html: '<button>New chat</button>' });
        await page.evaluate(() => setTimeout(() => { document.body.innerHTML += '<h2>Your session has expired</h2>'; }, 350));
        await expect(ensurePricingDialogVisible(page, 60000)).rejects.toMatchObject({ code: 'CHATGPT_SESSION_EXPIRED' });
    });
    it('ignores quoted session-expired text inside a chat message', async () => {
        const { page } = await fixture({ html: '<button>New chat</button><div data-message-author-role="user">Your session has expired</div>' });
        expect(await hasLoggedInChatUi(page)).toBe(true);
    });
    it('requires a real identity in a successful JSON response and separates network/403 failures', async () => {
        const { page } = await fixture({ status: 200, me: { user: { id: 'cached-user' }, accessToken: 'local-data' } });
        await expect(verifyChatGptAccessToken(page, 'offline')).rejects.toMatchObject({ code: 'CHATGPT_AUTH_UNCONFIRMED' });
        expect(isChatGptAuthFailure('Cloudflare challenge', 403)).toBe(false);
        expect(isChatGptAuthFailure(new Error('timeout'))).toBe(false);
        const unavailable = { evaluate: async () => { throw new Error('fetch failed secret-cookie'); } };
        await expect(verifyChatGptAccessToken(unavailable, 'offline')).rejects.toMatchObject({ code: 'CHATGPT_AUTH_UNCONFIRMED', message: expect.not.stringContaining('secret-cookie') });
    });
    it('confirms the actual account before logging success', async () => {
        const { page } = await fixture();
        const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
        const raw = JSON.stringify({ user: { id: 'user-offline', email: 'offline@example.test' }, accessToken: jwt({ exp: 9999999999 }) });
        await expect(bootstrapChatGptSession(page, raw, { cookieVerified: true, hasSessionToken: true })).resolves.toMatchObject({ email: 'offline@example.test' });
        expect(logs.mock.calls.flat().join('\n')).toContain('Session 登录成功（官方鉴权已确认）');
    });
    it('stops when the official account differs from the supplied account', async () => {
        const { page } = await fixture();
        const raw = JSON.stringify({ user: { id: 'user-other', email: 'other@example.test' }, accessToken: jwt({ exp: 9999999999 }) });
        await expect(bootstrapChatGptSession(page, raw, { cookieVerified: true, hasSessionToken: true })).rejects.toMatchObject({ code: 'CHATGPT_ACCOUNT_MISMATCH' });
    });
    it('does not treat words in the actual account email as an authentication error', async () => {
        const { page } = await fixture({ me: { id: 'user-offline', email: 'token_expired@example.test' } });
        await expect(verifyChatGptAccessToken(page, 'offline')).resolves.toMatchObject({ email: 'token_expired@example.test' });
    });
    it('bounds an unresponsive browser evaluation without reporting credentials as expired', async () => {
        vi.useFakeTimers();
        const pending = verifyChatGptAccessToken({ evaluate: () => new Promise(() => {}) }, 'offline');
        const assertion = expect(pending).rejects.toMatchObject({ code: 'CHATGPT_AUTH_UNCONFIRMED' });
        await vi.advanceTimersByTimeAsync(12000);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('subscription eligibility and active subscription protection', () => {
    it('rejects an account that already has an active Plus subscription and prevents delivery', async () => {
        const { context } = await fixture();
        const page = await context.newPage();
        await page.route('**/backend-api/accounts/check/v4*', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                accounts: {
                    default: {
                        account: { account_id: 'user-sub-1', plan_type: 'plus' },
                        entitlement: { subscription_plan: 'chatgptplusplan', has_active_subscription: true }
                    }
                }
            })
        }));
        await page.route('**/backend-api/me', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'user-sub-1', email: 'subscribed@example.test' })
        }));
        await page.goto('https://chatgpt.com/');
        await expect(assertChatGptAccountEligible(page, 'token')).rejects.toMatchObject({
            code: 'ACCOUNT_ALREADY_SUBSCRIBED',
            message: expect.stringContaining('已有有效 PLUS 订阅')
        });

        const raw = JSON.stringify({ user: { id: 'user-sub-1', email: 'subscribed@example.test' }, accessToken: jwt({ exp: 9999999999 }) });
        await expect(bootstrapChatGptSession(page, raw, { cookieVerified: true, hasSessionToken: true }))
            .rejects.toMatchObject({ code: 'ACCOUNT_ALREADY_SUBSCRIBED' });
    });

    it('allows an un-subscribed free account to proceed to checkout', async () => {
        const { context } = await fixture();
        const page = await context.newPage();
        await page.route('**/backend-api/accounts/check/v4*', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                accounts: {
                    default: {
                        account: { account_id: 'user-free-1', plan_type: 'free' },
                        entitlement: { subscription_plan: 'chatgptfreeplan', has_active_subscription: false }
                    }
                }
            })
        }));
        await page.goto('https://chatgpt.com/');
        const result = await assertChatGptAccountEligible(page, 'token');
        expect(result.isActivelySubscribed).toBe(false);
        expect(result.hasActive).toBe(false);
    });

    it('allows an account with an expired past subscription to proceed to recharge', async () => {
        const { context } = await fixture();
        const page = await context.newPage();
        await page.route('**/backend-api/accounts/check/v4*', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                accounts: {
                    default: {
                        account: { account_id: 'user-expired-pro', plan_type: 'free' },
                        entitlement: {
                            subscription_plan: 'chatgptpro',
                            has_active_subscription: false,
                            expires_at: '2026-05-05T20:03:44+00:00'
                        },
                        last_active_subscription: {
                            will_renew: false,
                            expires_at: '2026-05-05T20:03:44+00:00'
                        }
                    }
                }
            })
        }));
        await page.goto('https://chatgpt.com/');
        const result = await assertChatGptAccountEligible(page, 'token');
        expect(result.isActivelySubscribed).toBe(false);
        expect(result.hasActive).toBe(false);
        expect(result.isExpired).toBe(true);
    });
});
