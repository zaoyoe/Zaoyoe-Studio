import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clickInteractiveCaptchaSubmit, translateHcaptchaPrompt, isDragChallenge, reloadHcaptchaChallenge } from '../human-verification.js';

const backendSource = readFileSync(new URL('../human-verification.js', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function frontendHarness() {
    const elements = new Map();
    const sent = [];
    const capsules = [];
    const element = () => ({
        style: {}, textContent: '', src: '',
        classList: { add() {}, remove() {} },
        querySelector: () => ({ textContent: '' }),
        querySelectorAll: () => [],
        addEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 600 }),
    });
    const context = vm.createContext({
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        } },
        window: {}, Date, Math, Number, String, Boolean,
        setInterval, clearInterval, setTimeout, clearTimeout,
        requestAnimationFrame: fn => fn(),
        taskProgressValue: 50, activeJobKey: 'test-job',
        WebSocket: { OPEN: 1 },
        socket: { readyState: 1, send: data => sent.push(JSON.parse(data)) },
        showCapsule: (...args) => capsules.push(args),
    });
    const start = frontendSource.indexOf('        // ==================== 前端交互式人机验证透传控制器');
    const end = frontendSource.indexOf('        function initWebSocket(', start);
    vm.runInContext(frontendSource.slice(start, end), context);
    return { context, elements, sent, capsules, run: code => vm.runInContext(code, context) };
}

afterEach(() => vi.useRealTimers());

async function dragSwitchSession({ prompts, reloadSucceeds = true, maxWaitMs = 90000, changesDuringScreenshot = false }) {
    let now = 10000;
    let cleared = false;
    let screenshotCount = 0;
    let challengeIndex = 0;
    const pushes = [];
    const reloads = [];
    const clip = { x: 10, y: 20, width: 400, height: 500 };
    const page = {
        getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
        waitForTimeout: async ms => { now += ms; },
    };
    const target = {
        frame: {}, clip,
        // Simulate a cached non-drag prompt from the initial frame lookup.
        promptEn: 'Select all bicycles',
        frameElementHandle: {
            screenshot: async () => {
                screenshotCount += 1;
                if (changesDuringScreenshot && screenshotCount === 1) challengeIndex = 1;
                return Buffer.from('offline-challenge');
            },
            boundingBox: async () => clip,
        },
    };
    const context = vm.createContext({
        page, Buffer, process: { env: {} }, Date: { now: () => now },
        Number, Math, Array, captchaLog() {},
        isVerificationCleared: async () => cleared,
        findVisibleCaptchaClip: async () => ({ ...target }),
        isDragChallenge,
        waitForCaptchaContentReady: async () => ({ ready: true }),
        inspectCaptchaContent: async () => ({ ready: true }),
        refreshCaptchaGeometry: async (_page, info) => info,
        extractHcaptchaChallengePrompt: async () => prompts[Math.min(challengeIndex, prompts.length - 1)],
        translateHcaptchaPrompt,
        formatCaptchaGuideMessage: () => '',
        reloadHcaptchaChallenge: async (_page, _info, options) => {
            reloads.push({ at: now, options });
            if (reloadSucceeds) challengeIndex += 1;
            return reloadSucceeds;
        },
        axios: {
            post: async (url, data) => { pushes.push({ url, data }); },
            get: async () => { cleared = true; return { data: { clicked: false } }; },
        },
    });
    const start = backendSource.indexOf('async function attemptInteractiveUserCaptcha(');
    const end = backendSource.indexOf('function buildCaptchaRequiredError(', start);
    vm.runInContext(backendSource.slice(start, end), context);
    context.sessionOptions = { jobKey: 'offline-job', maxWaitMs };
    const result = await vm.runInContext('attemptInteractiveUserCaptcha(page, "offline", sessionOptions)', context);
    return { result, reloads, screenshotCount, frames: pushes.filter(item => item.url.endsWith('/captcha-prompt')).map(item => item.data) };
}

describe('drag challenge replacement', () => {
    it.each([
        ['Please drag the object to complete the pair', true],
        ['Drag the letter to the place where it fits', true],
        ['Slide the slider to complete the puzzle', true],
        ['请拖拽字母到合适的位置', true],
        ['Select all dragons', false],
        ['Select all playground slides', false],
        ['Tap the things that fit inside the container', false],
        ['Select all animals that do not meet your eye', false],
    ])('classifies the actual prompt: %s', (promptEn, expected) => {
        expect(isDragChallenge({ promptEn })).toBe(expected);
    });

    it('replaces more than two consecutive drag challenges before sending a ready screenshot', async () => {
        const { result, reloads, frames, screenshotCount } = await dragSwitchSession({ prompts: [
            'Drag the letter to the place where it fits',
            'Drag the matching shape',
            'Please drag the object to complete the pair',
            'Slide the slider to complete the puzzle',
            'Select all bicycles',
        ] });
        expect(result).toBe(true);
        expect(reloads).toHaveLength(4);
        expect(screenshotCount).toBe(1);
        expect(reloads.every(reload => reload.options.allowCoordinateFallback === false)).toBe(true);
        expect(reloads.slice(1).every((reload, i) => reload.at - reloads[i].at >= 2000)).toBe(true);
        expect(frames.filter(frame => frame.image)).toHaveLength(1);
        expect(frames.filter(frame => frame.image)[0].promptEn).toBe('Select all bicycles');
        expect(frames.slice(0, -1).every(frame => frame.image === null && frame.contentReady === false && frame.loading)).toBe(true);
        expect(frames.every(frame => frame.expiresAt === 100000)).toBe(true);
    });

    it('keeps an unavailable refresh button in loading state and stops at the original deadline', async () => {
        const { result, reloads, frames, screenshotCount } = await dragSwitchSession({
            prompts: ['Drag the matching shape'], reloadSucceeds: false, maxWaitMs: 5000,
        });
        expect(result).toBe(false);
        expect(reloads.length).toBeGreaterThan(1);
        expect(screenshotCount).toBe(0);
        expect(frames.every(frame => frame.image === null && frame.expiresAt === 15000)).toBe(true);
    });

    it('discards a screenshot if the official prompt switches to a drag challenge during capture', async () => {
        const { result, reloads, frames, screenshotCount } = await dragSwitchSession({
            prompts: ['Select all bicycles', 'Drag the matching shape', 'Select all boats'],
            changesDuringScreenshot: true,
        });
        expect(result).toBe(true);
        expect(reloads).toHaveLength(1);
        expect(screenshotCount).toBe(2);
        expect(frames.filter(frame => frame.image).map(frame => frame.promptEn)).toEqual(['Select all boats']);
    });

    it('does not report a failed official refresh click as successful or fall back to coordinates', async () => {
        const button = {
            first() { return this; }, isVisible: async () => true,
            click: vi.fn().mockRejectedValue(new Error('temporarily unavailable')),
        };
        const frame = { isDetached: () => false, evaluate: async () => false, locator: () => button };
        const page = {
            frames: () => [frame],
            locator: () => ({ contentFrame: () => ({ locator: () => button }) }),
            mouse: { click: vi.fn() },
        };
        expect(await reloadHcaptchaChallenge(page, { frame, clip: { x: 0, y: 0, width: 400, height: 500 } }, { allowCoordinateFallback: false })).toBe(false);
        expect(page.mouse.click).not.toHaveBeenCalled();
    });
});

describe('interactive CAPTCHA recovery', () => {
    it('keeps enough continuous time for the recorded 215-second human interaction', async () => {
        let now = 10000;
        let budget = 0;
        let cleared = false;
        const context = vm.createContext({
            process: { env: { HCAPTCHA_SOLVER_ENABLED: '0' } },
            Date: { now: () => now }, Number, Math, Boolean, String,
            page: {
                url: () => 'https://claude.ai/upgrade/pro',
                evaluate: async () => '',
                getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
            },
            captchaLog() {},
            hasAnyCheckoutCaptchaSignal: async () => true,
            isVerificationCleared: async () => cleared,
            logCaptchaFrameSnapshot: async () => {},
            isCloudflareWallPage: async () => false,
            isBlockingHumanVerificationVisible: async () => true,
            hasHcaptchaImageChallenge: async () => true,
            attemptInteractiveUserCaptcha: async (_page, _phase, options) => {
                budget = options.maxWaitMs;
                now += 215000;
                cleared = true;
                return true;
            },
        });
        const start = backendSource.indexOf('async function clearHumanVerification(');
        const end = backendSource.indexOf('module.exports =', start);
        vm.runInContext(backendSource.slice(start, end), context);
        const result = await vm.runInContext('clearHumanVerification(page, { jobKey: "test-job", maxWaitMs: 180000 })', context);
        expect(budget).toBe(270000);
        expect(result.cleared).toBe(true);
        expect(result.rounds).toBe(1);
    });

    it('updates a loading snapshot promptly and allows more than 15 refreshes in one session', async () => {
        let now = 10000;
        let refreshes = 0;
        let snapshots = 0;
        const pushes = [];
        const waitTimeouts = [];
        const clip = { x: 700, y: 200, width: 400, height: 500 };
        const target = {
            frame: {}, clip,
            frameElementHandle: {
                screenshot: async () => Buffer.from('captcha-only'),
                boundingBox: async () => clip,
            },
        };
        const page = {
            getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
            waitForTimeout: async () => { now += 1; },
        };
        const context = vm.createContext({
            page, Buffer, process: { env: {} },
            Date: { now: () => now },
            Number, Math, Array,
            captchaLog() {},
            isVerificationCleared: async () => refreshes >= 18,
            findVisibleCaptchaClip: async () => target,
            isDragChallenge: () => false,
            waitForCaptchaContentReady: async () => ({ ready: snapshots++ > 0, reason: 'test_loading' }),
            inspectCaptchaContent: async () => ({ ready: true }),
            randomBetween: () => 0,
            refreshCaptchaGeometry: async (_page, info) => info,
            extractHcaptchaChallengePrompt: async () => 'Tap the thing you can take inside the place',
            translateHcaptchaPrompt,
            formatCaptchaGuideMessage: () => '请按题目要求操作',
            reloadHcaptchaChallenge: async () => { refreshes += 1; },
            axios: {
                post: async (url, data) => { pushes.push({ url, data }); },
                get: async url => {
                    waitTimeouts.push(Number(new URL(url).searchParams.get('timeout')));
                    now += 1300;
                    return { data: { clicked: true, action: 'refresh' } };
                },
            },
        });
        const start = backendSource.indexOf('async function attemptInteractiveUserCaptcha(');
        const end = backendSource.indexOf('function buildCaptchaRequiredError(', start);
        vm.runInContext(backendSource.slice(start, end), context);
        const result = await vm.runInContext('attemptInteractiveUserCaptcha(page, "test", { jobKey: "test-job", maxWaitMs: 90000 })', context);
        expect(result).toBe(true);
        expect(refreshes).toBe(18);
        expect(waitTimeouts[0]).toBe(1500);
        const frames = pushes.filter(item => item.url.endsWith('/captcha-prompt')).map(item => item.data);
        expect(frames[0].loading).toBe(true);
        expect(frames[0].contentReady).toBe(false);
        expect(frames[0].image).toBeNull();
        expect(frames[1].loading).toBe(false);
        expect(frames.every(frame => frame.expiresAt === 100000)).toBe(true);
        expect(frames[0].promptZh).toBe('【场景匹配】请点击能带进右上角场所的物品');
    });

    it('uses the live official submit button instead of an old screenshot coordinate', async () => {
        const click = vi.fn().mockResolvedValue();
        const mouseClick = vi.fn();
        await clickInteractiveCaptchaSubmit({ mouse: { click: mouseClick } }, {
            frame: { locator: () => ({ first: () => ({ isVisible: async () => true, click }) }) },
            clip: { x: 10, y: 20, width: 400, height: 500 },
        }, { ratioX: 0.9, ratioY: 0.95 });
        expect(click).toHaveBeenCalledOnce();
        expect(mouseClick).not.toHaveBeenCalled();
    });

    it('remeasures the frame before a coordinate fallback when the official frame moved', async () => {
        const mouseClick = vi.fn();
        await clickInteractiveCaptchaSubmit({ mouse: { click: mouseClick } }, {
            clip: { x: 0, y: 0, width: 400, height: 500 },
            frameElementHandle: { boundingBox: async () => ({ x: 100, y: 200, width: 400, height: 500 }) },
        }, { ratioX: 0.9, ratioY: 0.95 });
        expect(mouseClick).toHaveBeenCalledWith(460, 675);
    });

    it('keeps the server deadline across new screenshots and translates the reported prompt', () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);
        const harness = frontendHarness();
        harness.run('openCaptchaInteractiveModal({ image: "first", frameSeq: 1, expiresAt: 190000, promptEn: "Tap the thing you can take inside the place" })');
        expect(harness.elements.get('captchaCountdownSec').textContent).toBe(180);
        expect(harness.elements.get('captchaPromptHeading').textContent).toContain('场景匹配');
        vi.advanceTimersByTime(60000);
        harness.run('openCaptchaInteractiveModal({ image: "second", frameSeq: 2, expiresAt: 190000 })');
        expect(harness.elements.get('captchaCountdownSec').textContent).toBe(120);
        harness.run('openCaptchaInteractiveModal({ image: "stale", frameSeq: 1 })');
        expect(harness.elements.get('captchaInteractiveImg').src).toBe('second');
    });

    it('allows five refreshes and prevents selecting a loading screenshot', () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);
        const harness = frontendHarness();
        harness.run('openCaptchaInteractiveModal({ image: "spinner", frameSeq: 1, loading: true, contentReady: false, expiresAt: 190000 })');
        harness.run('handleCaptchaImageClick({ clientX: 250, clientY: 300 })');
        expect(harness.run('captchaSelectedPoints.length')).toBe(0);
        for (let i = 0; i < 5; i += 1) {
            harness.run('triggerCaptchaRefresh()');
            vi.advanceTimersByTime(2200);
        }
        expect(harness.sent).toHaveLength(5);
        expect(harness.sent.every(payload => payload.action === 'refresh')).toBe(true);
    });

    it('replaces the previous or partially loaded puzzle with an explicit loading state', () => {
        vi.useFakeTimers();
        const harness = frontendHarness();
        harness.run('openCaptchaInteractiveModal({ image: "complete", frameSeq: 1 })');
        harness.run('openCaptchaInteractiveModal({ image: "partial", frameSeq: 2, loading: true, contentReady: false })');
        expect(harness.elements.get('captchaInteractiveImg').style.display).toBe('none');
        expect(harness.elements.get('captchaInteractiveImg').src).toBe('complete');
        expect(harness.elements.get('captchaLoadingState').style.display).toBe('flex');
        expect(harness.elements.get('captchaLoadingTitle').textContent).toContain('加载新题');
        harness.run('openCaptchaInteractiveModal({ image: "new-complete", frameSeq: 3, contentReady: true })');
        expect(harness.elements.get('captchaInteractiveImg').src).toBe('new-complete');
        expect(harness.elements.get('captchaInteractiveImg').style.display).toBe('block');
        expect(harness.elements.get('captchaLoadingState').style.display).toBe('none');
    });

    it('unlocks a rejected stale submission rather than showing a false receipt', () => {
        vi.useFakeTimers();
        const harness = frontendHarness();
        harness.run('showCaptchaPendingTransition(); isClickLocked = true; handleCaptchaClickReceived({ handled: false })');
        expect(harness.run('window.__captchaPending')).toBe(false);
        expect(harness.run('isClickLocked')).toBe(false);
        expect(harness.elements.get('captchaSubmitOverlay').style.display).toBe('none');
        expect(harness.elements.get('captchaStatusTip').textContent).toContain('本次操作未执行');
    });

    it('shows one success capsule after the dialog closes even if cleared is sent twice', () => {
        vi.useFakeTimers();
        const harness = frontendHarness();
        harness.run('openCaptchaInteractiveModal({ image: "ready", frameSeq: 1 }); handleCaptchaInteractiveStatus({ cleared: true }); handleCaptchaInteractiveStatus({ cleared: true })');
        expect(harness.capsules).toHaveLength(0);
        vi.advanceTimersByTime(300);
        expect(harness.elements.get('captchaInteractiveModal').style.display).toBe('none');
        expect(harness.capsules).toHaveLength(1);
        expect(harness.capsules[0][1]).toBe('success');
        harness.run('handleCaptchaInteractiveStatus({ cleared: true })');
        vi.advanceTimersByTime(300);
        expect(harness.capsules).toHaveLength(1);
    });

    it('cancels a pending payment-in-progress capsule when the task ends first', () => {
        vi.useFakeTimers();
        const harness = frontendHarness();
        harness.run('openCaptchaInteractiveModal({ image: "ready", frameSeq: 1 }); handleCaptchaInteractiveStatus({ cleared: true }); closeCaptchaInteractiveModal(true)');
        vi.advanceTimersByTime(1000);
        expect(harness.capsules).toHaveLength(0);
        expect(harness.elements.get('captchaInteractiveModal').style.display).toBe('none');
    });

    it('rejects expired and stale clicks while accepting refresh on a loading frame', () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);
        const state = { active: true, contentReady: false, expiresAt: 190000, frameSeq: 4, pendingClicks: [] };
        const context = vm.createContext({
            interactiveCaptchaMap: new Map([['test-job', state]]),
            Date, Number, Array, Math, console: { log() {} },
        });
        const start = serverSource.indexOf('function notifyCaptchaClick(');
        const end = serverSource.indexOf('function notifyCaptchaDrag(', start);
        vm.runInContext(serverSource.slice(start, end), context);
        expect(vm.runInContext('notifyCaptchaClick("test-job", { action: "submit", frameSeq: 4 })', context)).toBe(false);
        expect(vm.runInContext('notifyCaptchaClick("test-job", { action: "refresh", frameSeq: 3 })', context)).toBe(false);
        expect(vm.runInContext('notifyCaptchaClick("test-job", { action: "refresh", frameSeq: 4 })', context)).toBe(true);
        vi.setSystemTime(190001);
        expect(vm.runInContext('notifyCaptchaClick("test-job", { action: "refresh", frameSeq: 4 })', context)).toBe(false);
    });
});
