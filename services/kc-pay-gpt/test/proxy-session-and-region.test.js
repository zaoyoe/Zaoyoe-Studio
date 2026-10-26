import http from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { matchProxyRegion, substituteProxySession as poolSubstituteSession, alignProxyRegion as poolAlignRegion } from '../proxy-pool.js';
import { attachTunnelWatchdog, preparePlaywrightProxy, resetActiveProxyTunnels, substituteProxySession as playwrightSubstituteSession, alignProxyRegion as playwrightAlignRegion } from '../playwright-proxy.js';

function fakeSocket() {
    const socket = new PassThrough();
    socket.destroyedByWatchdog = false;
    socket.setKeepAlive = () => {};
    socket.setNoDelay = () => {};
    const destroy = socket.destroy.bind(socket);
    socket.destroy = (...args) => { socket.destroyedByWatchdog = true; return destroy(...args); };
    return socket;
}

describe('tunnel handshake watchdog', () => {
    it('destroys a tunnel whose upstream never answers the first client bytes', async () => {
        const source = fakeSocket(); const target = fakeSocket();
        attachTunnelWatchdog(source, target, 60);
        source.emit('data', Buffer.from('client-hello'));
        await new Promise(resolve => setTimeout(resolve, 120));
        expect(source.destroyedByWatchdog).toBe(true);
        expect(target.destroyedByWatchdog).toBe(true);
    });

    it('never kills an established connection that later sends client-only frames (HTTP/2 PING / WINDOW_UPDATE)', async () => {
        const source = fakeSocket(); const target = fakeSocket();
        attachTunnelWatchdog(source, target, 60);
        source.emit('data', Buffer.from('client-hello'));
        target.emit('data', Buffer.from('server-hello'));
        source.emit('data', Buffer.from('window-update'));
        await new Promise(resolve => setTimeout(resolve, 120));
        expect(source.destroyedByWatchdog).toBe(false);
        expect(target.destroyedByWatchdog).toBe(false);
        resetActiveProxyTunnels();
    });
});

describe('proxy session routing, region matching, and resilient CONNECT relay', () => {
    it('substitutes {session} and rotates -sid-xxxx-t- without corrupting IPRocket res_sc usernames', () => {
        const iprocketRaw = 'http://com91454197-res_sc-US_Oregon:secret123@prem.country.iprocket.io:9595';
        expect(poolSubstituteSession(iprocketRaw)).toBe(iprocketRaw);
        expect(playwrightSubstituteSession(iprocketRaw)).toBe(iprocketRaw);

        const cliproxyRaw = 'http://user-region-US-sid-old123-t-5:pass@us.cliproxy.io:3010';
        expect(poolSubstituteSession(cliproxyRaw)).not.toContain('-sid-old123-t-');
        expect(playwrightSubstituteSession(cliproxyRaw)).not.toContain('-sid-old123-t-');

        const rotgbRaw = 'http://USER184188-zone-custom-region-PH-session-29028475-sessTime-5-sessAuto-1:bc6ee6@hk.rotgb.trustsource.live:10000';
        const rotgbPoolSub = poolSubstituteSession(rotgbRaw);
        const rotgbPlaywrightSub = playwrightSubstituteSession(rotgbRaw);
        expect(rotgbPoolSub).not.toContain('session-29028475');
        expect(rotgbPoolSub).toMatch(/-session-\d{8}-sessTime-5-sessAuto-1/);
        expect(rotgbPlaywrightSub).not.toContain('session-29028475');
        expect(rotgbPlaywrightSub).toMatch(/-session-\d{8}-sessTime-5-sessAuto-1/);

        const templateRaw = 'http://USER184188-zone-custom-region-PH-session-{session}-sessTime-5-sessAuto-1:bc6ee6@hk.rotgb.trustsource.live:10000';
        const templateSub = poolSubstituteSession(templateRaw);
        expect(templateSub).not.toContain('{session}');
        expect(templateSub).toMatch(/-session-\d{8}-sessTime-5-sessAuto-1/);
    });

    it('aligns dynamic proxy region with checkout target region', () => {
        const rotgbRaw = 'http://USER184188-zone-custom-region-US-session-29028475-sessTime-5-sessAuto-1:bc6ee6@hk.rotgb.trustsource.live:10000';
        expect(poolAlignRegion(rotgbRaw, 'PH')).toContain('-region-PH-');
        expect(playwrightAlignRegion(rotgbRaw, 'PH')).toContain('-region-PH-');

        const iprocketRaw = 'http://com91454197-res_sc-US_Oregon:secret123@prem.country.iprocket.io:9595';
        expect(poolAlignRegion(iprocketRaw, 'PH')).toContain('-res_sc-PH');
        expect(playwrightAlignRegion(iprocketRaw, 'PH')).toContain('-res_sc-PH');

        const templateRaw = 'http://user:pass@proxy.example.com:8080?country={country}&region={region}';
        expect(playwrightAlignRegion(templateRaw, 'PH')).toBe('http://user:pass@proxy.example.com:8080?country=ph&region=ph');
    });

    it('matches proxy regions accurately from label and URL patterns', () => {
        const usProxy = {
            url: 'http://com91454197-res_sc-US_Oregon:secret@prem.country.iprocket.io:9595',
            label: ''
        };
        const phProxy = {
            url: 'http://com91454197-res_sc-PH:secret@prem.country.iprocket.io:9595',
            label: ''
        };
        expect(matchProxyRegion(usProxy.url, usProxy.label, 'US')).toBe(true);
        expect(matchProxyRegion(usProxy.url, usProxy.label, 'PH')).toBe(false);
        expect(matchProxyRegion(phProxy.url, phProxy.label, 'PH')).toBe(true);
        expect(matchProxyRegion(phProxy.url, phProxy.label, 'US')).toBe(false);
        expect(matchProxyRegion(usProxy, 'PH')).toBe(false);
        expect(matchProxyRegion(phProxy, 'PH')).toBe(true);
    });

    it('retries upstream 502 CONNECT failures transparently in the local HTTP relay', async () => {
        let connectAttempts = 0;
        const targetServer = http.createServer((_req, res) => {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('ok');
        });
        await new Promise(resolve => targetServer.listen(0, '127.0.0.1', resolve));
        const targetPort = targetServer.address().port;

        const upstreamProxy = http.createServer();
        upstreamProxy.on('connect', (req, clientSocket) => {
            connectAttempts += 1;
            if (connectAttempts === 1) {
                clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
                return;
            }
            const net = require('node:net');
            const [host, port] = req.url.split(':');
            const serverSocket = net.connect(Number(port), host, () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                serverSocket.pipe(clientSocket);
                clientSocket.pipe(serverSocket);
            });
        });
        await new Promise(resolve => upstreamProxy.listen(0, '127.0.0.1', resolve));
        const upstreamPort = upstreamProxy.address().port;

        const { proxyConfig, cleanup } = await preparePlaywrightProxy(`http://user:pass@127.0.0.1:${upstreamPort}`);
        try {
            const relayUrl = new URL(proxyConfig.server);
            const status = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: relayUrl.hostname,
                    port: relayUrl.port,
                    method: 'CONNECT',
                    path: `127.0.0.1:${targetPort}`
                });
                req.on('connect', (res, socket) => {
                    socket.end();
                    resolve(res.statusCode);
                });
                req.on('error', reject);
                req.end();
            });
            expect(status).toBe(200);
            expect(connectAttempts).toBe(2);
            expect(resetActiveProxyTunnels()).toBeGreaterThanOrEqual(0);
        } finally {
            await cleanup();
            await new Promise(resolve => upstreamProxy.close(resolve));
            await new Promise(resolve => targetServer.close(resolve));
        }
    });
});
