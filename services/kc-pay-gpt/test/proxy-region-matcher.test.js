import { describe, expect, it } from 'vitest';
const { matchProxyRegion } = require('../proxy-pool');
const store = require('../mysql-store');

describe('proxy region matching unit tests', () => {
    it('matches Cliproxy URLs with region-PH for PH', () => {
        const phUrl = 'http://yhwy1272259-region-PH-sid-zQD61d2U-t-5:rv52jjse@us2.cliproxy.io:3010';
        expect(matchProxyRegion(phUrl, '', 'PH')).toBe(true);
        expect(matchProxyRegion(phUrl, '', 'CL')).toBe(false);
        expect(matchProxyRegion(phUrl, '', 'US')).toBe(false);
    });

    it('matches Cliproxy URLs with region-CL for CL', () => {
        const clUrl = 'http://yhwy1272259-region-CL-sid-4CqUvpG3-t-5:rv52jjse@sg2.cliproxy.io:3010';
        expect(matchProxyRegion(clUrl, '', 'CL')).toBe(true);
        expect(matchProxyRegion(clUrl, '', 'PH')).toBe(false);
        expect(matchProxyRegion(clUrl, '', 'US')).toBe(false);
    });

    it('matches proxies by label aliases', () => {
        expect(matchProxyRegion('http://any-proxy:8080', '菲律宾专线 01', 'PH')).toBe(true);
        expect(matchProxyRegion('http://any-proxy:8080', '智利住宅代理 02', 'CL')).toBe(true);
        expect(matchProxyRegion('http://any-proxy:8080', 'United States Node', 'US')).toBe(true);
        expect(matchProxyRegion('http://any-proxy:8080', '智利住宅代理 02', 'PH')).toBe(false);
    });

    it('selects region-specific proxy from database pool when region is specified', async () => {
        const phProxy = await store.getActiveProxy('PH');
        if (phProxy) {
            expect(phProxy).toContain('region-PH');
        }

        const clProxy = await store.getActiveProxy('CL');
        if (clProxy) {
            expect(clProxy).toContain('region-CL');
        }
    });
});
