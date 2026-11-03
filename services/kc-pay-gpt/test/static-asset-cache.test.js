import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    isStaticImmutableAsset,
    getLocalCachePath,
    handleStaticAssetCache
} from '../static-asset-cache.js';

describe('static asset cache engine', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-cache-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    describe('isStaticImmutableAsset filter', () => {
        it('matches immutable frontend bundle assets on ChatGPT CDN', () => {
            expect(isStaticImmutableAsset('https://chatgpt.com/cdn/assets/633146.a34c950234.js')).toBe(true);
            expect(isStaticImmutableAsset('https://chatgpt.com/cdn/assets/async/842106.cd3d952f76.js')).toBe(true);
            expect(isStaticImmutableAsset('https://chatgpt.com/cdn/assets/35ac8cfedddb.css')).toBe(true);
            expect(isStaticImmutableAsset('https://chatgpt.com/cdn/assets/inter.woff2')).toBe(true);
            expect(isStaticImmutableAsset('https://chatgpt.com/_next/static/chunks/framework-123.js')).toBe(true);
            expect(isStaticImmutableAsset('https://cdn.oaistatic.com/assets/favicon.svg')).toBe(true);
        });

        it('matches immutable frontend bundle assets on Claude and Grok/X CDN', () => {
            expect(isStaticImmutableAsset('https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/shared-frame-24yhq5YI.css')).toBe(true);
            expect(isStaticImmutableAsset('https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/app-8b39d12.js')).toBe(true);
            expect(isStaticImmutableAsset('https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/font.woff2')).toBe(true);
            expect(isStaticImmutableAsset('https://assets.claude.ai/chunks/main-app-123.js')).toBe(true);
            expect(isStaticImmutableAsset('https://assets.claude.ai/css/style.css')).toBe(true);
            expect(isStaticImmutableAsset('https://claude.ai/_next/static/chunks/main-app-123.js')).toBe(true);
            expect(isStaticImmutableAsset('https://cdn.claude.ai/assets/style.css')).toBe(true);
            expect(isStaticImmutableAsset('https://claude.ai/assets/font.woff2')).toBe(true);
            expect(isStaticImmutableAsset('https://claude.ai/static/style.css')).toBe(true);
            expect(isStaticImmutableAsset('https://grok.com/_next/static/chunks/app-456.js')).toBe(true);
            expect(isStaticImmutableAsset('https://abs.twimg.com/responsive-web/client-web/main.6f4fa6ba.js')).toBe(true);
            expect(isStaticImmutableAsset('https://abs.twimg.com/fonts/chirp-regular-web.woff2')).toBe(true);
        });

        it('matches Stripe official public immutable SDK and fingerprinted assets', () => {
            expect(isStaticImmutableAsset('https://js.stripe.com/v3/')).toBe(true);
            expect(isStaticImmutableAsset('https://js.stripe.com/v3')).toBe(true);
            expect(isStaticImmutableAsset('https://js.stripe.com/v3/fingerprinted/js/elements-inner-card-123.js')).toBe(true);
            expect(isStaticImmutableAsset('https://js.stripe.com/v3/fingerprinted/img/payment-methods/icon-pm-bizum.svg')).toBe(true);
        });

        it('strictly rejects dynamic business APIs, Stripe private APIs/telemetry, and auth endpoints', () => {
            expect(isStaticImmutableAsset('https://chatgpt.com/backend-api/payments/checkout')).toBe(false);
            expect(isStaticImmutableAsset('https://chatgpt.com/api/auth/session')).toBe(false);
            expect(isStaticImmutableAsset('https://chatgpt.com/ces/v1/rgstr')).toBe(false);
            expect(isStaticImmutableAsset('https://claude.ai/api/organizations/org_123/billing')).toBe(false);
            expect(isStaticImmutableAsset('https://claude.ai/api/auth/session')).toBe(false);
            expect(isStaticImmutableAsset('https://x.com/i/api/graphql/123/CreateSubscription')).toBe(false);
            expect(isStaticImmutableAsset('https://grok.com/api/auth/session')).toBe(false);
            expect(isStaticImmutableAsset('https://api.stripe.com/v1/payment_intents/pi_123/confirm')).toBe(false);
            expect(isStaticImmutableAsset('https://api.stripe.com/v1/elements/sessions')).toBe(false);
            expect(isStaticImmutableAsset('https://m.stripe.network/inner.html')).toBe(false);
            expect(isStaticImmutableAsset('https://m.stripe.com/4')).toBe(false);
            expect(isStaticImmutableAsset('https://b.stripecdn.com/elements-inner-card.html')).toBe(false);
            expect(isStaticImmutableAsset('https://hcaptcha.com/1/api.js')).toBe(false);
            expect(isStaticImmutableAsset('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(false);
            expect(isStaticImmutableAsset('https://chatgpt.com/checkout/openai_llc/oaics_123')).toBe(false);
            expect(isStaticImmutableAsset('https://chatgpt.com/auth/login')).toBe(false);
            expect(isStaticImmutableAsset('')).toBe(false);
            expect(isStaticImmutableAsset(null)).toBe(false);
        });
    });

    describe('getLocalCachePath security & mapping', () => {
        it('maps URL safely without directory traversal', () => {
            const local = getLocalCachePath('https://chatgpt.com/cdn/assets/chunk.js', tempDir);
            expect(local).toContain(tempDir);
            expect(local).toContain(path.join('chatgpt.com', 'cdn', 'assets', 'chunk.js'));
        });

        it('neutralizes malicious traversal attempts', () => {
            const local = getLocalCachePath('https://chatgpt.com/../../etc/passwd.js', tempDir);
            expect(local.startsWith(tempDir)).toBe(true);
            expect(local).not.toContain('..');
        });
    });

    describe('handleStaticAssetCache fulfillment', () => {
        it('bypasses non-GET and non-static requests', async () => {
            const postRoute = {
                request: () => ({ method: () => 'POST', url: () => 'https://chatgpt.com/cdn/assets/test.js' }),
                fulfill: vi.fn()
            };
            const handled = await handleStaticAssetCache(postRoute, { cacheDir: tempDir });
            expect(handled).toBe(false);
            expect(postRoute.fulfill).not.toHaveBeenCalled();
        });

        it('fulfills immediately (0ms) when file exists in local cache', async () => {
            const url = 'https://chatgpt.com/cdn/assets/cached_bundle.js';
            const localPath = getLocalCachePath(url, tempDir);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, 'console.log("cached bundle");');

            const route = {
                request: () => ({ method: () => 'GET', url: () => url }),
                fulfill: vi.fn().mockResolvedValue(undefined)
            };

            const handled = await handleStaticAssetCache(route, { cacheDir: tempDir });
            expect(handled).toBe(true);
            expect(route.fulfill).toHaveBeenCalledWith(expect.objectContaining({
                status: 200,
                path: localPath,
                headers: expect.objectContaining({
                    'x-cache': 'HIT-LOCAL-MIRROR'
                })
            }));
        });
    });
});
