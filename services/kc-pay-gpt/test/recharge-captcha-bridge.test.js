import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function slice(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }

describe('restored recharge CAPTCHA bridge', () => {
    it('delivers a ready frame, accepts its selections, rejects a stale frame and reports clearing', async () => {
        const routes = new Map();
        const events = [];
        const context = vm.createContext({
            app: { post: (path, handler) => routes.set(path, handler), get: (path, handler) => routes.set(path, handler) },
            broadcastToTask: (jobKey, data) => events.push({ jobKey, ...data }),
            isCheckoutDiagnosticJob: async () => false,
            console: { log() {} }, Date, Number, Array, Map, setTimeout, clearTimeout,
        });
        vm.runInContext(slice('// In-memory state for interactive human verification', 'function unsubscribeTaskClient('), context);
        vm.runInContext(slice('// ==================== 交互式人机验证透传 API', "app.use('/api/admin', authenticateAdmin);"), context);
        const request = (body = {}) => ({ body, params: { jobKey: 'offline-job' }, query: {}, on() {} });
        const response = () => ({ headersSent: false, value: null, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.value = data; this.headersSent = true; return this; } });
        const prompt = routes.get('/api/internal/captcha-prompt');
        const click = routes.get('/api/public/task/:jobKey/captcha-click');
        const wait = routes.get('/api/internal/captcha-wait-click/:jobKey');
        const status = routes.get('/api/internal/captcha-status');
        expect([prompt, click, wait, status].every(handler => typeof handler === 'function')).toBe(true);
        prompt(request({ jobKey: 'offline-job', loading: true, contentReady: false, expiresAt: Date.now() + 180000 }), response());
        const denied = response();
        await click(request({ action: 'submit', frameSeq: 1, ratioX: 0.9, ratioY: 0.95 }), denied);
        expect(denied.value.handled).toBe(false);
        prompt(request({ jobKey: 'offline-job', image: 'offline-image', contentReady: true, promptZh: '请选择自行车' }), response());
        expect(events.findLast(event => event.type === 'captcha_interactive_required')).toMatchObject({ image: 'offline-image', contentReady: true, frameSeq: 2 });
        const stale = response();
        await click(request({ action: 'submit', frameSeq: 1, ratioX: 0.9, ratioY: 0.95 }), stale);
        expect(stale.value.handled).toBe(false);
        const accepted = response();
        await click(request({ action: 'submit', frameSeq: 2, points: [{ ratioX: 0.2, ratioY: 0.4 }], submitPoint: { ratioX: 0.9, ratioY: 0.95 } }), accepted);
        expect(accepted.value.handled).toBe(true);
        const delivered = response();
        wait(request(), delivered);
        expect(delivered.value).toMatchObject({ clicked: true, frameSeq: 2, points: [{ ratioX: 0.2, ratioY: 0.4 }] });
        status(request({ jobKey: 'offline-job', cleared: true }), response());
        expect(events.at(-1)).toMatchObject({ type: 'captcha_interactive_status', cleared: true });
        const closed = response();
        await click(request({ action: 'refresh', frameSeq: 2, ratioX: 0.3, ratioY: 0.95 }), closed);
        expect(closed.value.handled).toBe(false);
    });
});
