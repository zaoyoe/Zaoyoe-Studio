const { executePaymentWithRetry } = require('./payment-retry');
const { openPricingCheckout } = require('./pricing-checkout');
const { openApiCheckout, isBillingCountryMismatchError, shouldFallbackToPricingCheckout } = require('./chatgpt');
const store = require('./mysql-store');
const { getRegionConfig, getRegionBrowserProfile } = require('./region-config');
const { installChatGptSession, bootstrapChatGptSession, extractEmailFromSession, verifyChatGptSessionProtocol } = require('./session-auth');
const { connectTaskBrowser, applyCdpEnv, closeTaskBrowser } = require('./browser-runtime');
const { preparePlaywrightProxy } = require('./playwright-proxy');
const { checkProxyConnectivity, checkEgressRegion, checkProxyAndRegionFast, checkProxyAndRegionProtocol } = require('./proxy-preflight');
const { captureDiagnosticScreenshot } = require('./task-diagnostics');
const { injectClaudeSession, bootstrapClaudeSession } = require('./claude-auth');
const { openClaudeCheckout } = require('./pricing-checkout-claude');
const { cancelClaudeAutoRenew } = require('./claude-cancel-auto-renew');
const { injectGrokSession, bootstrapGrokSession } = require('./grok-auth');
const { openGrokCheckout } = require('./pricing-checkout-grok');
const { cancelGrokAutoRenew } = require('./grok-cancel-auto-renew');
const { cancelChatGptAutoRenew } = require('./chatgpt-cancel-auto-renew');
const { isBundle } = require('./public/grok-plan-catalog');
const { observeGrokCommerce } = require('./grok-commerce');
const { validateCdkPlan } = require('./cdk-plan-catalog');
const fs = require('fs');
const path = require('path');

/**
 * Stripe Card Pool Payment Activation Flow
 *
 * 核心流程：
 * 1. 代理连通性检查
 * 2. 从 CDK 记录获取 plan_type
 * 3. 创建 Stripe Checkout Session（根据 plan_type）
 * 4. 打开 Stripe Checkout 页面
 * 5. 使用 payment-retry.js（executePaymentWithRetry）完成信用卡支付
 *    - 自动从卡池分配卡片
 *    - 支持表单重试 + 换卡重试（最多 3 张卡）
 *    - 自动选取免税地址
 *    - 记录账单信息
 * 6. 检测支付结果：成功则继续，失败则标记 payment_failed
 *
 * 进度输出约定（供 server.js / product_activator.js 解析）：
 * - "正在检查代理连通性"  → 代理检查开始
 * - "代理连接成功! 代理公网 IP" → 代理检查通过
 * - "[1] 创建订单" → 订单创建开始
 * - "套餐类型:" → plan_type/region 已解析
 * - "定价页" / "Checkout 页面已打开" → UI 升级流程
 * - "[Stripe] Step" → 填写信用卡与账单地址
 * - "正在使用 Stripe 信用卡卡池支付流程" → 支付流程开始
 * - "最终校验：支付成功!" / "PAYMENT_SUCCESS" → 成功
 * - "支付失败 (payment_failed)" → 全部卡片均失败
 * - "支付失败 (stripe_card_declined)" → 卡被拒
 */

// 捕获良性异步异常（如 playwright-extra 在页面/上下文关闭时触发的 cdpSession.send 报错），避免 Node.js v25 进程崩溃导致卡片锁未释放
process.on?.('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason || '');
    if (msg.includes('Target page, context or browser has been closed') || msg.includes('cdpSession.send') || msg.includes('Execution context was destroyed')) {
        console.warn(`[系统/CDP] 捕获到良性页面生命周期关闭异常 (已忽略): ${msg}`);
        return;
    }
    console.error('⚠️ [系统] 未处理的异步 Promise Rejection:', reason);
});

// 全部敏感配置请通过环境变量传入
const CONFIG = {
    platform: process.env.PLATFORM || "",
    claudeSessionKey: process.env.CLAUDE_SESSION_KEY || "",
    grokToken: process.env.GROK_TOKEN || "",
    chatgptToken: process.env.CHATGPT_TOKEN || "",
    chatgptSessionJson: process.env.CHATGPT_SESSION_JSON || "",
    cdkCode: process.env.CDK_CODE || "",
    email: process.env.ACTIVATION_EMAIL || "",
    planType: process.env.CDK_PLAN_TYPE || "",
    planNameOverride: process.env.PLAN_NAME_OVERRIDE || "",
    paymentRegionOverride: process.env.PAYMENT_REGION_OVERRIDE || "",
    proxy: process.env.PROXY || ""
};

// 录像开关（默认开启；设 RECORD_VIDEO=0 可关闭）与输出目录
const RECORD_VIDEO = String(process.env.RECORD_VIDEO || '1') !== '0';
const VIDEO_DIR = path.join(__dirname, 'debug_screenshots', 'videos');
const VIDEO_TAG = (process.env.JOB_KEY || process.env.CDK_CODE || `${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `${Date.now()}`;

function buildDebugScreenshotPath(prefix) {
    const subdir = process.env.CHECKOUT_DEBUG_ONLY === '1' ? 'checkout_debug' : 'activation';
    const screenshotDir = path.join(__dirname, 'debug_screenshots', subdir);
    fs.mkdirSync(screenshotDir, { recursive: true });
    return path.join(screenshotDir, `${prefix}_${Date.now()}.png`);
}

// 关闭 context 后把录像重命名为带任务标识的稳定文件名，并输出路径供 server 解析
async function finalizeVideo(context, page, options = {}) {
    const deleteOnSuccess = Boolean(options.deleteOnSuccess);
    if (!RECORD_VIDEO || !context) return null;
    try {
        const pages = (typeof context.pages === 'function' ? context.pages() : []) || [];
        const targetPage = (page && typeof page.video === 'function' && page.video()) ? page : pages.find((p) => p && p.video && p.video());
        const video = targetPage && targetPage.video ? targetPage.video() : null;

        await context.close().catch(() => { });

        if (!video) return null;
        const rawPath = await video.path().catch(() => null);
        if (!rawPath) return null;

        const finalPath = path.join(VIDEO_DIR, `payment_${VIDEO_TAG}_${Date.now()}.webm`);
        try {
            fs.renameSync(rawPath, finalPath);
        } catch (_) {
            try { fs.copyFileSync(rawPath, finalPath); fs.unlinkSync(rawPath); } catch (_) { return rawPath; }
        }

        if (deleteOnSuccess) {
            try {
                fs.unlinkSync(finalPath);
                console.log('🎬 [系统] 支付成功，录像已自动删除以节省磁盘');
                return null;
            } catch (e) {
                console.warn(`⚠️ [系统] 删除成功录像失败: ${e.message}`);
            }
        }

        console.log(`🎬 [系统] 自动化录像已保存: ${finalPath}`);
        console.log(`VIDEO_FILE: ${finalPath}`);
        return finalPath;
    } catch (e) {
        console.warn(`⚠️ [系统] 录像保存失败: ${e.message}`);
        return null;
    }
}

function getAvailableDebugPage(context, preferredPage) {
    if (preferredPage && !preferredPage.isClosed()) {
        return preferredPage;
    }
    if (!context || typeof context.pages !== 'function') {
        return null;
    }
    const alivePages = context.pages().filter((item) => item && !item.isClosed());
    return alivePages.length ? alivePages[alivePages.length - 1] : null;
}

async function captureDebugScreenshot(context, preferredPage, prefix, label = '异常截图') {
    const targetPage = getAvailableDebugPage(context, preferredPage);
    if (!targetPage) {
        console.warn(`⚠️ [系统] ${label}未保存：当前没有可用页面。`);
        return null;
    }

    const screenshotPath = buildDebugScreenshotPath(prefix);
    const saved = await captureDiagnosticScreenshot(targetPage, screenshotPath);
    if (saved) console.log(`📸 [系统] ${label}已保存: ${saved}`);
    return saved;
}

async function isCheckoutErrorPage(page) {
    try {
        const bodyText = String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '');
        return bodyText.includes('Something went wrong')
            || bodyText.includes('could not be found')
            || bodyText.includes('contact the merchant');
    } catch (_) {
        return false;
    }
}

async function isConnectionClosedPage(page) {
    try {
        const bodyText = String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '');
        return bodyText.includes('ERR_CONNECTION_CLOSED')
            || bodyText.includes('无法访问此网站')
            || bodyText.includes('意外终止了连接')
            || bodyText.includes('This site can\u2019t be reached')
            || bodyText.includes('This site cannot be reached');
    } catch (_) {
        return false;
    }
}

async function recoverConnectionClosed(page, fallbackUrl = '') {
    if (!(await isConnectionClosedPage(page))) {
        return false;
    }

    console.warn('[Warn] 检测到浏览器连接关闭错误页，正在尝试自动重载...');
    for (let attempt = 1; attempt <= 3; attempt++) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async () => {
            const nextUrl = fallbackUrl || page.url();
            if (nextUrl) {
                return page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
            }
        });
        await page.waitForTimeout(3000);
        if (!(await isConnectionClosedPage(page))) {
            console.log(`[Info] 连接关闭错误页已恢复 (第 ${attempt} 次重载成功)。`);
            return true;
        }
    }

    return false;
}

/**
 * Main Automation logic
 */
async function run() {
    // 切到有头模式调试：HEADFUL=1 node server.js 或 HEADFUL=1 node index.js
    const DEBUG_HEADFUL = process.env.HEADFUL === '1';
    const CHROMIUM_CHANNEL = (process.env.CHROMIUM_CHANNEL || '').trim();

    let proxyCleanup = async () => { };
    let browserSession = null;
    let browser = null;
    let context = null;
    let page = null;
    let commerceObserver = null;
    let paymentSucceeded = false;
    let prewarmedPayment = null;
    const debugOnly = process.env.CHECKOUT_DEBUG_ONLY === '1';
    const diagnosticMode = String(process.env.CHECKOUT_DIAGNOSTIC_MODE || 'checkout').toLowerCase();
    let diagnostic = null;
    let diagnosticCancelled = false;
    const assertDiagnosticActive = () => {
        if (diagnosticCancelled) throw Object.assign(new Error('诊断已取消，未提交支付'), { code: 'DIAGNOSTIC_CANCELLED' });
    };
    const stopDiagnostic = () => {
        diagnosticCancelled = true;
        // Closing the diagnostic context interrupts pending Playwright operations
        // so the normal catch/finally can preserve media and release resources.
        Promise.resolve(context?.close()).catch(() => {});
        if (!context) Promise.resolve(closeTaskBrowser(browserSession, browser)).catch(() => {});
    };
    if (debugOnly) {
        process.once?.('SIGTERM', stopDiagnostic);
        process.once?.('SIGINT', stopDiagnostic);
    }

    try {
    if (debugOnly) {
        const { getDiagnosticCatalog, createDiagnosticReporter } = require('./checkout-diagnostic');
        const selected = getDiagnosticCatalog().platforms.find(item => item.id === CONFIG.platform);
        if (CONFIG.cdkCode || !selected?.plans.some(plan => plan.id === CONFIG.planType)
            || !selected.modes.some(mode => mode.id === diagnosticMode)
            || !selected.regions.includes(CONFIG.paymentRegionOverride)) {
            throw Object.assign(new Error('诊断参数无效，已停止；未操作卡密或银行卡'), { code: 'DIAGNOSTIC_INPUT_INVALID' });
        }
        diagnostic = createDiagnosticReporter({ platform: CONFIG.platform, planType: CONFIG.planType,
            region: CONFIG.paymentRegionOverride, mode: diagnosticMode });
        diagnostic.check('browser', '浏览器启动', 'running');
    }

    const preparedProxy = await preparePlaywrightProxy(CONFIG.proxy);
    proxyCleanup = preparedProxy.cleanup;
    const proxyConfig = preparedProxy.proxyConfig;
    assertDiagnosticActive();

    if (proxyConfig) {
        console.log(`🌐 [系统] 代理已配置${preparedProxy.relayed ? '（SOCKS→本地 HTTP 中继）' : ''}`);
    }

    let cdkPaymentRegion = '';
    let planType = CONFIG.planType;
    let cdkPlatform = '';
    const cdkCode = CONFIG.cdkCode;
    const email = CONFIG.email;

    if (cdkCode) {
        const cdkDetails = await store.verifyCdkDetails(cdkCode);
        if (!cdkDetails) throw new Error('无法核验卡密商品，已停止充值');
        cdkPaymentRegion = String(cdkDetails.payment_region || '').trim().toUpperCase();
        if (!cdkPaymentRegion) throw new Error('卡密未配置支付地区，无法确认目标网络和支付币种，已停止充值 [PAYMENT_REGION_UNCONFIRMED]');
        const validated = validateCdkPlan(cdkDetails.plan_type, cdkDetails.platform, { activation: true });
        if (planType && validateCdkPlan(planType).planName !== validated.planName) {
            throw new Error('任务套餐与卡密商品不一致，已停止充值');
        }
        planType = validated.planType;
        cdkPlatform = validated.platform;
    }
    const paymentRegionOverride = String(CONFIG.paymentRegionOverride || '').trim().toUpperCase();
    if (cdkPaymentRegion && paymentRegionOverride && cdkPaymentRegion !== paymentRegionOverride) {
        throw new Error(`任务地区 ${paymentRegionOverride} 与卡密支付地区 ${cdkPaymentRegion} 不一致，已停止充值 [CDK_PAYMENT_REGION_MISMATCH]`);
    }
    let paymentRegion = cdkPaymentRegion || paymentRegionOverride;
    if (!paymentRegion) {
        paymentRegion = await store.getPaymentRegion();
    }
    const regionCfg = getRegionConfig(paymentRegion);
    if (!regionCfg) throw new Error(`不支持的支付地区配置: ${paymentRegion}`);
    const browserProfile = getRegionBrowserProfile(paymentRegion);

    if (!planType) {
        planType = 'plus';
    }
    const validatedPlan = validateCdkPlan(planType, CONFIG.platform || cdkPlatform || undefined, { activation: true });
    planType = validatedPlan.planType;
    const platform = validatedPlan.platform;
    const billingCountry = paymentRegion;
    const billingCurrency = regionCfg ? regionCfg.currency : 'USD';

    let realUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
    const ensureBrowserReady = async (reason = '') => {
        if (context && page && (typeof page.isClosed !== 'function' || !page.isClosed())) {
            return { browserSession, browser, context, page, realUserAgent };
        }
        if (reason) {
            console.log(`🚀 [按需唤醒] ${reason}`);
        }
        browserSession = await connectTaskBrowser({
            proxyConfig,
            headful: DEBUG_HEADFUL,
            chromiumChannel: CHROMIUM_CHANNEL
        });
        applyCdpEnv(browserSession);
        browser = browserSession.browser;
        assertDiagnosticActive();
        diagnostic?.check('browser', '浏览器启动', 'passed');

        realUserAgent = browserSession.realUserAgent || realUserAgent;
        const viewport = { width: 1920, height: 1080 };
        const matched = realUserAgent.match(/Chrome\/(\d+)/);
        const chromeMajor = matched ? Number(matched[1]) : 147;

        const contextOptions = {
            userAgent: realUserAgent,
            viewport,
            locale: browserProfile.locale,
            timezoneId: browserProfile.timezoneId,
            screen: { width: 1920, height: 1080 },
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            extraHTTPHeaders: {
                'sec-ch-ua': `"Not)A;Brand";v="8", "Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}"`,
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            }
        };
        if (proxyConfig) {
            contextOptions.proxy = proxyConfig;
        }
        if (RECORD_VIDEO) {
            contextOptions.recordVideo = {
                dir: VIDEO_DIR,
                size: { width: 1280, height: 720 }
            };
        }

        context = await browser.newContext(contextOptions);
        assertDiagnosticActive();
        // ============= 指纹伪装 =============
        await context.addInitScript((injectedChromeMajor) => {
            const NavProto = Object.getPrototypeOf(navigator);
            const ScrProto = Object.getPrototypeOf(screen);
            const safeDefine = (obj, key, getter) => {
                try {
                    Object.defineProperty(obj, key, { get: getter, configurable: true });
                } catch (_) { /* ignore */ }
            };

            // 隐藏 webdriver
            try { delete Object.getPrototypeOf(navigator).webdriver; } catch (_) { }
            safeDefine(NavProto, 'webdriver', () => undefined);
            try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch (_) { }

            // navigator.userAgentData
            try {
                const uaData = {
                    brands: [
                        { brand: 'Not)A;Brand', version: '8' },
                        { brand: 'Chromium', version: String(injectedChromeMajor) },
                        { brand: 'Google Chrome', version: String(injectedChromeMajor) }
                    ],
                    mobile: false,
                    platform: 'Windows',
                    getHighEntropyValues: () => Promise.resolve({
                        architecture: 'x86',
                        bitness: '64',
                        mobile: false,
                        model: '',
                        platform: 'Windows',
                        platformVersion: '15.0.0',
                        wow64: false
                    }),
                    toJSON: () => ({ brands: uaData.brands, mobile: uaData.mobile, platform: uaData.platform })
                };
                safeDefine(NavProto, 'userAgentData', () => uaData);
            } catch (_) { }

            // plugins / mimeTypes
            try {
                const pdfMime = Object.create(MimeType.prototype);
                Object.defineProperties(pdfMime, {
                    type: { get: () => 'application/pdf' },
                    suffixes: { get: () => 'pdf' },
                    description: { get: () => 'Portable Document Format' }
                });
                const pdfPlugin = Object.create(Plugin.prototype);
                Object.defineProperties(pdfPlugin, {
                    name: { get: () => 'Chrome PDF Plugin' },
                    filename: { get: () => 'internal-pdf-viewer' },
                    description: { get: () => 'Portable Document Format' },
                    length: { get: () => 1 },
                    0: { get: () => pdfMime }
                });
                pdfPlugin.item = () => pdfMime;
                pdfPlugin.namedItem = () => pdfMime;

                const fakePlugins = Object.create(PluginArray.prototype);
                Object.defineProperties(fakePlugins, {
                    length: { get: () => 1 },
                    0: { get: () => pdfPlugin }
                });
                fakePlugins.item = () => pdfPlugin;
                fakePlugins.namedItem = (n) => n === pdfPlugin.name ? pdfPlugin : null;
                fakePlugins.refresh = () => { };

                const fakeMimeTypes = Object.create(MimeTypeArray.prototype);
                Object.defineProperties(fakeMimeTypes, {
                    length: { get: () => 1 },
                    0: { get: () => pdfMime }
                });
                fakeMimeTypes.item = () => pdfMime;
                fakeMimeTypes.namedItem = (n) => n === pdfMime.type ? pdfMime : null;

                safeDefine(NavProto, 'plugins', () => fakePlugins);
                safeDefine(NavProto, 'mimeTypes', () => fakeMimeTypes);
            } catch (_) { }

            // 语言、平台、硬件
            safeDefine(NavProto, 'languages', () => ['en-US', 'en']);
            safeDefine(NavProto, 'language', () => 'en-US');
            safeDefine(NavProto, 'platform', () => 'Win32');
            safeDefine(NavProto, 'hardwareConcurrency', () => 8);
            safeDefine(NavProto, 'deviceMemory', () => 8);
            safeDefine(NavProto, 'maxTouchPoints', () => 0);
            safeDefine(NavProto, 'vendor', () => 'Google Inc.');

            // navigator.connection
            try {
                const conn = { effectiveType: '4g', rtt: 100, downlink: 10, saveData: false };
                safeDefine(NavProto, 'connection', () => conn);
            } catch (_) { }

            // window.chrome
            try {
                const fakeChrome = {
                    app: {
                        isInstalled: false,
                        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                        getDetails: () => null,
                        getIsInstalled: () => false
                    },
                    runtime: {
                        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
                        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
                        connect: () => { },
                        sendMessage: () => { }
                    },
                    csi: () => ({ onloadT: Date.now(), pageT: Date.now() - 1000, startE: Date.now() - 2000, tran: 15 }),
                    loadTimes: () => ({
                        requestTime: Date.now() / 1000 - 2,
                        startLoadTime: Date.now() / 1000 - 1.5,
                        commitLoadTime: Date.now() / 1000 - 1,
                        finishDocumentLoadTime: Date.now() / 1000 - 0.5,
                        finishLoadTime: Date.now() / 1000,
                        firstPaintTime: Date.now() / 1000 - 0.3,
                        firstPaintAfterLoadTime: 0,
                        navigationType: 'Other',
                        wasFetchedViaSpdy: true,
                        wasNpnNegotiated: true,
                        npnNegotiatedProtocol: 'h2',
                        wasAlternateProtocolAvailable: false,
                        connectionInfo: 'h2'
                    })
                };
                Object.defineProperty(window, 'chrome', { value: fakeChrome, writable: true, configurable: true });
            } catch (_) { }

            // permissions.query
            try {
                const origQuery = navigator.permissions.query.bind(navigator.permissions);
                navigator.permissions.query = (params) => {
                    if (params && params.name === 'notifications') {
                        return Promise.resolve({ state: typeof Notification !== 'undefined' ? Notification.permission : 'default', onchange: null });
                    }
                    return origQuery(params).catch(() => ({ state: 'prompt', onchange: null }));
                };
            } catch (_) { }

            // screen
            safeDefine(ScrProto, 'availHeight', () => 1032);
            safeDefine(ScrProto, 'availWidth', () => 1920);
            safeDefine(ScrProto, 'colorDepth', () => 24);
            safeDefine(ScrProto, 'pixelDepth', () => 24);
            safeDefine(ScrProto, 'width', () => 1920);
            safeDefine(ScrProto, 'height', () => 1080);

            // Canvas 微噪声
            try {
                const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
                HTMLCanvasElement.prototype.toDataURL = function (...args) {
                    const ctx = this.getContext('2d');
                    if (ctx) {
                        try {
                            const w = this.width, h = this.height;
                            if (w > 0 && h > 0) {
                                const data = ctx.getImageData(0, 0, 1, 1);
                                data.data[3] = Math.max(1, data.data[3] - 1);
                                ctx.putImageData(data, 0, 0);
                            }
                        } catch (_) { }
                    }
                    return origToDataURL.apply(this, args);
                };
            } catch (_) { }

            // WebGL
            try {
                const fakeWebGL = (gl) => {
                    const origGetParameter = gl.getParameter.bind(gl);
                    gl.getParameter = function (param) {
                        if (param === 0x9245) return 'Google Inc. (Intel)';
                        if (param === 0x9246) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                        return origGetParameter(param);
                    };
                };
                const origGetCtx = HTMLCanvasElement.prototype.getContext;
                HTMLCanvasElement.prototype.getContext = function (type, ...args) {
                    const ctx = origGetCtx.call(this, type, ...args);
                    if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
                        try { fakeWebGL(ctx); } catch (_) { }
                    }
                    return ctx;
                };
            } catch (_) { }

            // ChromeDriver 痕迹
            try {
                for (const key of Object.keys(window)) {
                    if (/^(cdc_|\$cdc_|_phantom|callPhantom|webdriver-|driver-)/.test(key)) {
                        try { delete window[key]; } catch (_) { }
                    }
                }
            } catch (_) { }

            // Notification.permission
            try {
                if (typeof Notification !== 'undefined') {
                    Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
                }
            } catch (_) { }
        }, chromeMajor);

        page = await context.newPage();
        if (typeof page.on === 'function') {
            page.on('close', () => {
                console.warn(`⚠️ [系统] 当前页面已关闭，关闭前最后 URL: ${page.url()}`);
            });
        }
        return { browserSession, browser, context, page, realUserAgent };
    };

        const ownerKey = process.env.JOB_KEY || `${cdkCode || 'job'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const checkoutMode = String(process.env.CHECKOUT_MODE || 'auto').toLowerCase();
        const fastProtocolEnabled = true;
        const canStartZeroBrowser = platform === 'chatgpt'
            && !debugOnly
            && checkoutMode !== 'ui'
            && typeof verifyChatGptSessionProtocol === 'function'
            && typeof checkProxyAndRegionProtocol === 'function';

        let regionVerified = false;
        let loginInfo = null;
        let checkoutResult = null;
        let checkoutOpened = false;
        let chatgptBrowserSessionInstalled = false;
        const proxyUrl = proxyConfig?.server || CONFIG.proxy;
        const planNameOverride = String(CONFIG.planNameOverride || '').trim() || undefined;

        const runBrowserProxyPreflight = async () => {
            if (regionVerified) return;
            if (proxyConfig) {
                diagnostic?.check('proxy', '代理连通性', 'running');
                console.log('正在检查代理连通性...');
                let fastPreflight = null;
                try {
                    if (typeof checkProxyAndRegionFast === 'function') {
                        fastPreflight = await checkProxyAndRegionFast(context, paymentRegion);
                    }
                } catch (err) {
                    if (err?.code === 'PAYMENT_REGION_NETWORK_MISMATCH') throw err;
                }

                if (fastPreflight?.ip && fastPreflight?.actualRegion) {
                    const ip = fastPreflight.ip;
                    const ipMasked = ip.includes(':') ? '[IPv6 已隐藏]'
                        : ip.replace(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/, '***.***.$3.$4');
                    console.log(`✅ [系统] 代理连接成功! 代理公网 IP: ${ipMasked}`);
                    diagnostic?.check('proxy', '代理连通性', 'passed', '已通过当前浏览器通道核验');
                    diagnostic?.check('network-region', '支付出口地区', 'passed', `已确认出口地区为 ${paymentRegion}`);
                    regionVerified = true;
                } else {
                    const { ip } = await checkProxyConnectivity(context);
                    const ipMasked = ip.includes(':') ? '[IPv6 已隐藏]'
                        : ip.replace(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/, '***.***.$3.$4');
                    console.log(`✅ [系统] 代理连接成功! 代理公网 IP: ${ipMasked}`);
                    diagnostic?.check('proxy', '代理连通性', 'passed', '已通过当前浏览器通道核验');
                }
            } else {
                diagnostic?.check('proxy', '代理连通性', 'skipped', '使用本机网络，未配置代理');
            }

            if (!regionVerified) {
                diagnostic?.check('network-region', '支付出口地区', 'running');
                await checkEgressRegion(context, paymentRegion);
                diagnostic?.check('network-region', '支付出口地区', 'passed', `已确认出口地区为 ${paymentRegion}`);
                regionVerified = true;
            }
        };

        const ensureChatGptBrowserPage = async (reason = '') => {
            await ensureBrowserReady(reason || '按需懒加载唤醒 Chromium 浏览器收银台');
            if (!chatgptBrowserSessionInstalled && context) {
                const sessionRaw = CONFIG.chatgptSessionJson || CONFIG.chatgptToken;
                await installChatGptSession(context, sessionRaw, {
                    skipOnlineProbe: true,
                    cookieVerified: true
                });
                chatgptBrowserSessionInstalled = true;
            }
            return page;
        };

        if (canStartZeroBrowser) {
            console.log('[1] 准备自助充值流程...');
            console.log(`[1] 平台: ${platform.toUpperCase()}, 套餐类型: ${planType}, 地区: ${paymentRegion}, 币种: ${billingCurrency}`);
            console.log('⚡ [零浏览器协议] 启动 0 浏览器纯协议极速流水线（跳过 Chromium 启动，仅在风控盾/3DS/拒卡时按需懒加载浏览器）...');

            const sessionRaw = CONFIG.chatgptSessionJson || CONFIG.chatgptToken;
            try {
                const preCard = await store.reserveCard(ownerKey);
                if (preCard) {
                    const { pickBillingAddressForCheckout } = require('./tax-free-address');
                    const lastUsedIdRaw = await store.getAppConfigValue('last_used_address_id', null);
                    const preAddress = await pickBillingAddressForCheckout(paymentRegion, lastUsedIdRaw ? Number(lastUsedIdRaw) : null);
                    const preEmail = email || (typeof extractEmailFromSession === 'function' ? extractEmailFromSession(sessionRaw) : '') || '';
                    if (preAddress && preEmail && !preAddress.email) {
                        preAddress.email = preEmail;
                    }
                    const { prewarmStripeConfirmationToken } = require('./stripe-protocol-payment');
                    const prewarmPromise = prewarmStripeConfirmationToken({
                        card: preCard,
                        billing: preAddress,
                        proxy: proxyUrl,
                        planType
                    });
                    prewarmedPayment = {
                        card: preCard,
                        address: preAddress,
                        tokenPromise: prewarmPromise,
                        ownerKey,
                        consumed: false
                    };
                }
            } catch (preErr) {
                console.warn(`⚠️ [协议预热] 卡片与令牌前置预热跳过: ${preErr.message}`);
            }

            let prewarmedSentinelPromise = null;
            try {
                const { mintSentinelToken } = require('./sentinel/sentinel-client');
                prewarmedSentinelPromise = mintSentinelToken({
                    flow: 'chatgpt_checkout',
                    proxy: proxyUrl,
                    pageUrl: 'https://chatgpt.com/',
                    timeoutMs: 15000
                }).catch(() => null);
            } catch (_) {}

            console.log('正在检查代理连通性...');
            const [proxyProtoRes, sessionProtoRes] = await Promise.all([
                checkProxyAndRegionProtocol(proxyUrl, paymentRegion),
                verifyChatGptSessionProtocol(sessionRaw, { proxy: proxyUrl })
            ]);

            if (proxyProtoRes?.ip && proxyProtoRes?.actualRegion) {
                const ip = proxyProtoRes.ip;
                const ipMasked = ip.includes(':') ? '[IPv6 已隐藏]'
                    : ip.replace(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/, '***.***.$3.$4');
                console.log(`✅ [系统] 代理连接成功! 代理公网 IP: ${ipMasked}`);
                regionVerified = true;
            }

            if (regionVerified && sessionProtoRes?.ok) {
                loginInfo = sessionProtoRes;
                if (loginInfo.email && !email) {
                    console.log(`[Info] 账号邮箱: ${loginInfo.email}`);
                }
                if (prewarmedPayment?.address && loginInfo.email && !prewarmedPayment.address.email) {
                    prewarmedPayment.address.email = loginInfo.email;
                }

                try {
                    console.log('⚡ [极速通道] 正在尝试通过 0 浏览器纯协议闪电创建 Stripe 收银台...');
                    checkoutResult = await openApiCheckout(null, {
                        accessToken: loginInfo.accessToken || loginInfo.session?.accessToken || CONFIG.chatgptToken,
                        planType,
                        country: billingCountry,
                        currency: billingCurrency,
                        planNameOverride,
                        verifyPage: false,
                        proxy: proxyUrl,
                        sentinelPromise: prewarmedSentinelPromise,
                        cookieHeader: loginInfo.cookieHeader,
                        deviceId: loginInfo.deviceId
                    });
                    checkoutOpened = true;
                    console.log('⚡ [极速通道] ✅ 0 浏览器纯协议创建收银台会话成功，全程免浏览器开销！');
                } catch (apiError) {
                    console.warn(`[Warn] 0 浏览器纯协议创建 Checkout 未果: ${apiError.message}`);
                    if (!shouldFallbackToPricingCheckout(apiError, { checkoutMode, debugOnly: debugOnly && diagnosticMode === 'link' })) {
                        if (isBillingCountryMismatchError(apiError.message)) {
                            console.warn('[Warn] 检测到账单地区不匹配，已停止 UI 回退，避免在错误地区继续尝试支付');
                        }
                        throw apiError;
                    }
                    console.log('🧭 [按需唤醒] 纯协议创建 Checkout 遇阻，平滑唤醒浏览器接管...');
                }
            } else {
                const reason = !regionVerified
                    ? '纯协议代理探针未响应，切换浏览器通道复核'
                    : `纯协议 Session 鉴权触发风控盾或未确认 (${sessionProtoRes?.error || 'unknown'})，唤醒浏览器过盾`;
                console.log(`⚠️ [零浏览器协议] ${reason}`);
            }
        }

        // 若未启用 0 浏览器模式，或 0 浏览器前置环节需回退浏览器，则唤醒浏览器并执行标准预检与登录
        if (!checkoutOpened) {
            await ensureBrowserReady(canStartZeroBrowser ? '纯协议前置阶段需浏览器接管，正在启动 Chromium...' : '');
            await runBrowserProxyPreflight();

            if (!canStartZeroBrowser) {
                if (debugOnly) {
                    console.log(`[诊断] ${diagnosticMode === 'link' ? '仅生成链接' : '完整结账检查'}：不预留银行卡，不填写卡片或账单地址，不提交支付`);
                } else {
                    console.log('[1] 准备自助充值流程...');
                }
                console.log(`[1] 平台: ${platform.toUpperCase()}, 套餐类型: ${planType}, 地区: ${paymentRegion}, 币种: ${billingCurrency}`);

                if (platform === 'chatgpt' && !debugOnly && fastProtocolEnabled) {
                    try {
                        const preCard = await store.reserveCard(ownerKey);
                        if (preCard) {
                            const { pickBillingAddressForCheckout } = require('./tax-free-address');
                            const lastUsedIdRaw = await store.getAppConfigValue('last_used_address_id', null);
                            const preAddress = await pickBillingAddressForCheckout(paymentRegion, lastUsedIdRaw ? Number(lastUsedIdRaw) : null);
                            const preEmail = email || (typeof extractEmailFromSession === 'function' ? extractEmailFromSession(CONFIG.chatgptSessionJson || CONFIG.chatgptToken) : '') || '';
                            if (preAddress && preEmail && !preAddress.email) {
                                preAddress.email = preEmail;
                            }
                            const { prewarmStripeConfirmationToken } = require('./stripe-protocol-payment');
                            const prewarmPromise = prewarmStripeConfirmationToken({
                                card: preCard,
                                billing: preAddress,
                                proxy: proxyUrl
                            });
                            prewarmedPayment = {
                                card: preCard,
                                address: preAddress,
                                tokenPromise: prewarmPromise,
                                ownerKey,
                                consumed: false
                            };
                        }
                    } catch (preErr) {
                        console.warn(`⚠️ [协议预热] 卡片与令牌前置预热跳过: ${preErr.message}`);
                    }
                } else if (platform === 'chatgpt' && !debugOnly) {
                    console.log('⚡ [极速协议] 协议直充模式已关闭，跳过卡片与令牌前置异步预热');
                }
            }

            diagnostic?.check('session', '官方登录状态', 'running', '等待官方登录组件核验');

            if (platform === 'claude') {
                console.log('🤖 [平台] 启动 Claude 自助升级流程...');
                const claudeCred = CONFIG.claudeSessionKey || CONFIG.chatgptSessionJson || CONFIG.chatgptToken;
                await injectClaudeSession(context, claudeCred);
                loginInfo = await bootstrapClaudeSession(page, claudeCred, { planType });
                if (diagnostic) {
                    const account = require('./claude-auth').getClaudeAccountSnapshot(page);
                    diagnostic.check('session', '官方登录状态', account?.accountId ? 'passed' : 'unconfirmed',
                        account?.accountId ? '官方账号接口已确认登录' : '页面已打开，账号接口暂未确认；继续检查结账组件');
                }
                if (loginInfo && loginInfo.email) {
                    console.log(`[Info] 账号邮箱: ${loginInfo.email}`);
                }
                console.log('🧭 [步骤] 正在打开 Claude 订阅收银台...');
                diagnostic?.check('checkout', '打开官方结账', 'running');
                checkoutResult = await openClaudeCheckout(page, { planType });
            } else if (platform === 'grok') {
                console.log('⚡ [平台] 启动 Grok (X) 自助升级流程...');
                const grokCred = CONFIG.grokToken || CONFIG.chatgptSessionJson || CONFIG.chatgptToken;
                await injectGrokSession(context, grokCred);
                if (isBundle(planType)) commerceObserver = observeGrokCommerce(page, planType);
                loginInfo = await bootstrapGrokSession(page, grokCred, { planType });
                diagnostic?.check('session', '官方登录状态', 'passed', '正式登录检查已完成，继续核验结账页面');
                if (loginInfo && loginInfo.email) {
                    console.log(`[Info] 账号邮箱: ${loginInfo.email}`);
                }
                console.log('🧭 [步骤] 正在打开 Grok 订阅收银台...');
                diagnostic?.check('checkout', '打开官方结账', 'running');
                checkoutResult = await openGrokCheckout(page, { planType, platformMode: loginInfo?.platformMode, commerceObserver,
                    onCheckoutPage: checkoutPage => { page = checkoutPage; } });
            } else {
                // --- Phase 0.5: Install ChatGPT Session ---
                const sessionRaw = CONFIG.chatgptSessionJson || CONFIG.chatgptToken;
                const installResult = await installChatGptSession(context, sessionRaw);
                chatgptBrowserSessionInstalled = true;
                const sessionData = installResult?.sessionData || installResult;
                const cookieVerified = Boolean(installResult?.cookieVerified);
                const hasSessionToken = Boolean(installResult?.hasSessionToken);

                // ⚡ [并发优化] 提前在后台异步签发 Checkout API 专用的 Sentinel PoW 令牌，立减 4~5 秒
                let prewarmedSentinelPromise = null;
                try {
                    const { mintSentinelToken } = require('./sentinel/sentinel-client');
                    prewarmedSentinelPromise = mintSentinelToken({
                        flow: 'chatgpt_checkout',
                        proxy: proxyUrl,
                        pageUrl: 'https://chatgpt.com/',
                        timeoutMs: 15000
                    }).catch(() => null);
                } catch (_) {}

                loginInfo = await bootstrapChatGptSession(page, sessionRaw, {
                    sessionData,
                    cookieVerified,
                    hasSessionToken,
                    skipChatUiWait: true
                });
                diagnostic?.check('session', '官方登录状态', 'passed', '正式登录检查已完成，继续打开官方结账页');
                if (loginInfo.email && !email) {
                    console.log(`[Info] 账号邮箱: ${loginInfo.email}`);
                }

                if (checkoutMode === 'ui') {
                    console.log('[Checkout] 跳过 API 创建，直接使用官方 UI 定价页');
                }
                diagnostic?.check('checkout', diagnosticMode === 'link' ? '生成官方链接' : '打开官方结账', 'running');

                if (checkoutMode !== 'ui') {
                    try {
                        console.log('⚡ [极速通道] 正在尝试通过 API 闪电直达 Stripe 收银台...');
                        checkoutResult = await openApiCheckout(page, {
                            accessToken: loginInfo.session?.accessToken || CONFIG.chatgptToken,
                            planType,
                            country: billingCountry,
                            currency: billingCurrency,
                            planNameOverride,
                            verifyPage: Boolean(debugOnly && diagnosticMode === 'checkout'),
                            proxy: proxyUrl,
                            sentinelPromise: prewarmedSentinelPromise
                        });
                        checkoutOpened = true;
                        console.log('⚡ [极速通道] ✅ API 直达收银台成功，已跳过 UI 定价页！');
                    } catch (apiError) {
                        console.warn(`[Warn] API Checkout 尝试未果: ${apiError.message}`);
                        if (!shouldFallbackToPricingCheckout(apiError, { checkoutMode, debugOnly: debugOnly && diagnosticMode === 'link' })) {
                            if (isBillingCountryMismatchError(apiError.message)) {
                                console.warn('[Warn] 检测到账单地区不匹配，已停止 UI 回退，避免在错误地区继续尝试支付');
                            }
                            throw apiError;
                        }
                        console.log('🧭 [智能回退] 正在平滑转入 UI 定价页流程...');
                    }
                }

                if (!checkoutOpened) {
                    if (debugOnly && diagnosticMode === 'link') {
                        throw new Error('API Checkout 失败，调试模式不启用 UI 定价页');
                    }
                    console.log('🧭 [步骤] 正在打开定价页并选择升级套餐...');
                    const checkoutUrl = await openPricingCheckout(page, {
                        region: billingCountry,
                        planType,
                        onCheckoutPage: (checkoutPage) => { page = checkoutPage; }
                    });
                    checkoutResult = { checkoutUrl };
                }
            }
        }

        if (debugOnly) {
            assertDiagnosticActive();
            const { trustedCheckoutUrl } = require('./checkout-diagnostic');
            const checkoutUrl = trustedCheckoutUrl(checkoutResult?.checkoutUrl || checkoutResult?.url || page.url(), platform);
            if (!checkoutUrl) throw Object.assign(new Error('官方未返回可信结账地址'), { code: 'DIAGNOSTIC_URL_UNTRUSTED' });
            diagnostic.checkout({ url: checkoutUrl });
            diagnostic.check('checkout', diagnosticMode === 'link' ? '生成官方链接' : '打开官方结账', 'passed');
            if (diagnosticMode === 'checkout') {
                diagnostic.check('form', '结账表单', 'running');
                const { inspectDiagnosticCheckout } = require('./checkout-diagnostic-inspection');
                const inspection = await inspectDiagnosticCheckout(page, { platform, planType, region: billingCountry,
                    checkoutResult, commerceObserver });
                assertDiagnosticActive();
                for (const check of inspection.checks || []) diagnostic.check(check.id, check.label, check.status, check.message);
                diagnostic.checkout({ ...inspection, url: checkoutUrl });
                if (!inspection.confirmed) throw Object.assign(new Error('结账页面已打开，但无法完整确认所选套餐、币种或表单'), { code: 'DIAGNOSTIC_CHECKOUT_UNCONFIRMED' });
                if (platform === 'claude' && diagnostic.report.checks.find(check => check.id === 'session')?.status !== 'passed') {
                    const { getClaudeAccountSnapshot, readClaudeAccountInBrowser } = require('./claude-auth');
                    const account = getClaudeAccountSnapshot(page) || (await readClaudeAccountInBrowser(page, 1500)).account;
                    assertDiagnosticActive();
                    if (!account?.accountId) throw Object.assign(new Error('结账页面已就绪，但官方账号接口尚未确认登录状态'), { code: 'DIAGNOSTIC_SESSION_UNCONFIRMED' });
                    diagnostic.check('session', '官方登录状态', 'passed', '官方账号接口已确认登录');
                }
            } else {
                diagnostic.check('form', '结账表单', 'skipped', '仅生成链接模式未打开或检查表单');
                diagnostic.check('product', '套餐与金额', 'unconfirmed', 'API 已生成链接；未核验实际订单金额、币种和套餐');
                diagnostic.checkout({ kind: 'link', confirmed: false });
            }
            diagnostic.check('payment', '实际支付', 'skipped', '诊断在支付入口前结束；未预留银行卡、填写账单或提交支付');
            const diagnosticShot = await captureDebugScreenshot(context, page, 'checkout', '诊断截图');
            assertDiagnosticActive();
            if (diagnosticShot) console.log(`SUCCESS_SCREENSHOT: ${diagnosticShot}`);
            diagnostic.finish(true, diagnosticMode === 'link' ? '官方链接已生成，实际结账尚未核验' : '结账检查通过；税费和实际支付尚未核验');
            console.log('CHECKOUT_DEBUG_SUCCESS');
            return;
        }

        console.log(`✅ [步骤] ${platform.toUpperCase()} Checkout 会话已就绪，开始信用卡支付流程...`);

        const currentPageUrl = (page && typeof page.url === 'function') ? page.url() : '';
        const stripeSessionMatch = String(currentPageUrl || checkoutResult?.checkoutUrl || '').match(/(oaics_[a-f0-9]+|cs_live_[a-zA-Z0-9]+|cs_test_[a-zA-Z0-9]+)/i);
        const stripeSessionId = stripeSessionMatch ? stripeSessionMatch[1] : (checkoutResult?.sessionId || null);

        // --- Phase 4: Execute Payment with Card Pool Retry ---
        console.log("[步骤] 正在使用 Stripe 信用卡卡池支付流程（单次尝试）...");
        let fallbackSentinelPromise = null;
        if (platform === 'chatgpt' && fastProtocolEnabled) {
            try {
                const { mintSentinelToken } = require('./sentinel/sentinel-client');
                fallbackSentinelPromise = mintSentinelToken({
                    flow: 'chatgpt_checkout',
                    proxy: proxyUrl,
                    pageUrl: 'https://chatgpt.com/',
                    deviceId: loginInfo?.deviceId || undefined,
                    timeoutMs: 15000
                }).catch(() => null);
            } catch (_) {}
        }

        const paymentResult = await executePaymentWithRetry(page, {
            platform,
            planType,
            paymentRegion,
            paymentCurrency: billingCurrency,
            cdkCode,
            email: email || loginInfo?.email,
            stripeSessionId,
            checkoutUrl: checkoutResult?.checkoutUrl,
            accessToken: loginInfo?.accessToken || loginInfo?.session?.accessToken || CONFIG.chatgptToken,
            cookieHeader: loginInfo?.cookieHeader || '',
            deviceId: loginInfo?.deviceId || '',
            proxy: proxyUrl,
            grokAccount: platform === 'grok' ? loginInfo : null,
            grokCheckout: platform === 'grok' ? checkoutResult : null,
            ownerKey,
            prewarmedPayment,
            ensureBrowserPage: platform === 'chatgpt' ? ensureChatGptBrowserPage : undefined,
            refreshCheckoutSession: async () => {
                if (platform === 'chatgpt' && (loginInfo?.accessToken || loginInfo?.session?.accessToken || CONFIG.chatgptToken)) {
                    const consumedSentinel = fallbackSentinelPromise;
                    fallbackSentinelPromise = null;
                    return await openApiCheckout(loginInfo?.cookieHeader ? null : page, {
                        accessToken: loginInfo?.accessToken || loginInfo?.session?.accessToken || CONFIG.chatgptToken,
                        planType,
                        country: billingCountry,
                        currency: billingCurrency,
                        planNameOverride,
                        verifyPage: false,
                        proxy: proxyUrl,
                        sentinelPromise: consumedSentinel,
                        cookieHeader: loginInfo?.cookieHeader || '',
                        deviceId: loginInfo?.deviceId || ''
                    });
                }
                return null;
            },
            onPaymentState: async (state, message) => {
                console.log(`PAYMENT_STATE:${state}${message ? `:${message}` : ''}`);
            }
        });

        if (paymentResult.success) {
            paymentSucceeded = true;
            console.log(`    [+] 最终校验：支付成功! (stripe_card_payment)`);
            console.log("PAYMENT_SUCCESS");
            for (const screenshotPath of paymentResult.screenshots || []) {
                console.log(`SUCCESS_SCREENSHOT: ${screenshotPath}`);
            }
            if (platform === 'chatgpt') {
                console.log('🔄 [ChatGPT] 支付已完成，正在自动关闭次月自动续订...');
                try {
                    const autoRenewRes = await cancelChatGptAutoRenew(page, {
                        accessToken: loginInfo?.accessToken || loginInfo?.session?.accessToken || CONFIG.chatgptToken,
                        accountId: loginInfo?.accountId || '',
                        planType,
                        cookieHeader: loginInfo?.cookieHeader || '',
                        deviceId: loginInfo?.deviceId || '',
                        proxy: proxyUrl
                    });
                    if (autoRenewRes?.ok) {
                        console.log(`✅ [ChatGPT] ${autoRenewRes.message || '已成功关闭次月自动续订'}`);
                    } else {
                        console.warn(`⚠️ [ChatGPT] 自动续费关闭状态未确认: ${autoRenewRes?.error || '需人工复核'}`);
                    }
                    console.log(`AUTO_RENEW_RESULT:${JSON.stringify(autoRenewRes)}`);
                } catch (cancelErr) {
                    console.warn(`⚠️ [ChatGPT] 自动续费关闭执行异常: ${cancelErr.message}`);
                    console.log(`AUTO_RENEW_RESULT:${JSON.stringify({ ok: false, verificationUnknown: true, error: cancelErr.message })}`);
                }
            } else if (platform === 'grok') {
                console.log('🔄 [Grok] 支付已完成，正在自动关闭次月自动续订...');
                try {
                    const autoRenewRes = await cancelGrokAutoRenew(page, {
                        subscriptionId: paymentResult.subscriptionId || commerceObserver?.result()?.subscriptionId || ''
                    });
                    if (autoRenewRes?.ok) {
                        console.log(`✅ [Grok] ${autoRenewRes.message || '已成功关闭次月自动续订'}`);
                    } else {
                        console.warn(`⚠️ [Grok] 自动续费关闭状态未确认: ${autoRenewRes?.error || '需人工复核'}`);
                    }
                    console.log(`AUTO_RENEW_RESULT:${JSON.stringify(autoRenewRes)}`);
                } catch (cancelErr) {
                    console.warn(`⚠️ [Grok] 自动续费关闭执行异常: ${cancelErr.message}`);
                    console.log(`AUTO_RENEW_RESULT:${JSON.stringify({ ok: false, verificationUnknown: true, error: cancelErr.message })}`);
                }
            } else if (platform === 'claude') {
                console.log('🔄 [Claude] 支付已完成，正在自动关闭次月自动续订...');
                try {
                    const autoRenewRes = await cancelClaudeAutoRenew(page, {
                        orgId: loginInfo?.orgId || '',
                        claudeAccount: loginInfo
                    });
                    if (autoRenewRes?.ok) {
                        console.log(`✅ [Claude] ${autoRenewRes.message || '已成功关闭次月自动续订'}`);
                    } else {
                        console.warn(`⚠️ [Claude] 自动续费关闭状态未确认: ${autoRenewRes?.error || '需人工复核'}`);
                    }
                    console.log(`AUTO_RENEW_RESULT:${JSON.stringify(autoRenewRes)}`);
                } catch (cancelErr) {
                    console.warn(`⚠️ [Claude] 自动续费关闭执行异常: ${cancelErr.message}`);
                    console.log(`AUTO_RENEW_RESULT:${JSON.stringify({ ok: false, verificationUnknown: true, error: cancelErr.message })}`);
                }
            }
        } else {
            const errorMsg = paymentResult.error || '支付失败（未知原因）';
            for (const screenshotPath of paymentResult.screenshots || []) {
                console.log(`FAILURE_SCREENSHOT: ${screenshotPath}`);
            }
            console.error(`❌ [支付失败] ${errorMsg} (manual_intervention)`);
            throw new Error(`支付失败 (manual_intervention): ${errorMsg}`);
        }

    } catch (e) {
        if (diagnosticCancelled) e = Object.assign(new Error('诊断已取消，未提交支付'), { code: 'DIAGNOSTIC_CANCELLED' });
        if (diagnostic) {
            for (const check of e.diagnosticChecks || []) diagnostic.check(check.id, check.label, check.status, check.message);
            const pending = diagnostic.report.checks.filter(check => check.status === 'running');
            for (const check of pending) diagnostic.check(check.id, check.label, 'failed', e.message);
            diagnostic.check('payment', '实际支付', 'skipped', '未进入支付流程');
            diagnostic.finish(false, e.message, e.code || 'DIAGNOSTIC_FAILED');
        }
        console.error("❌ [运行时错误]:", e.message);
        try {
            const errorShot = await captureDebugScreenshot(context, page, 'error');
            if (errorShot) {
                console.log(`FAILURE_SCREENSHOT: ${errorShot}`);
            }
        } catch (err) {
            console.error(`⚠️ [系统] 异常截图保存失败: ${err.message}`);
        }
        // 用 exitCode 而非 process.exit()，确保下方 finally 能完整执行（录像需 context 关闭后才落盘）
        process.exitCode = 1;
    } finally {
        if (prewarmedPayment?.card?.id && !prewarmedPayment.consumed) {
            try {
                await store.releaseCard(prewarmedPayment.card.id);
                console.log(`[协议预热] 任务未进入支付流程，已安全释放预留卡片 #${prewarmedPayment.card.id}`);
            } catch (_) { }
        }
        commerceObserver?.dispose();
        if (browser || browserSession || context) {
            console.log("👋 [系统] 流程结束，正在关闭浏览器...");
        } else {
            console.log("👋 [系统] 0 浏览器纯协议流程结束，正在清理网络资源...");
        }
        // 先关闭 context 以 flush 录像并取回路径，再关浏览器
        await finalizeVideo(context, page, { deleteOnSuccess: paymentSucceeded }).catch(() => { });
        await closeTaskBrowser(browserSession, browser);
        await Promise.race([
            proxyCleanup(),
            new Promise((r) => setTimeout(r, 1500))
        ]).catch(() => { });
        if (debugOnly) {
            process.removeListener?.('SIGTERM', stopDiagnostic);
            process.removeListener?.('SIGINT', stopDiagnostic);
        }
    }
}

run().finally(() => {
    // 录像已在 run() 的 finally 中落盘；此处兜底强制退出，避免连接池或代理保持事件循环导致子进程不退出
    setTimeout(() => process.exit(process.exitCode || 0), 500);
});
