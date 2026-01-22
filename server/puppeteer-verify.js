/**
 * Puppeteer automation for batch.1key.me
 * Automates the verification process on their website
 * Supports real-time progress callbacks for SSE
 */

const puppeteer = require('puppeteer');

const BATCH_1KEY_URL = 'https://batch.1key.me';
const VERIFICATION_TIMEOUT = 300000; // 5 minutes

// Check if running in mock mode (for local development)
const MOCK_MODE = process.env.MOCK_VERIFY === 'true';

/**
 * Verify using Puppeteer automation on batch.1key.me
 * @param {string} apiKey - The 1key API key
 * @param {string} verificationId - The verification ID to process
 * @param {function} onProgress - Callback for progress updates (status, message, pageContent, metadata)
 * @returns {Promise<{success: boolean, message: string, remainingQuota?: number}>}
 */
async function verifyWithPuppeteer(apiKey, verificationId, onProgress = () => { }) {
    // Mock mode for local testing
    if (MOCK_MODE) {
        onProgress('mock', '🧪 模拟模式启动');
        console.log('[Puppeteer] 🧪 Running in MOCK MODE');

        await new Promise(r => setTimeout(r, 1000));
        onProgress('mock', '正在模拟验证过程...');

        await new Promise(r => setTimeout(r, 2000));
        onProgress('complete', '✅ 验证成功 (模拟模式)');

        return {
            success: true,
            message: '✅ 验证成功 (模拟模式)'
        };
    }

    let browser = null;

    try {
        onProgress('launching', '🚀 正在启动浏览器...');
        console.log('[Puppeteer] Launching browser...');

        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process'
            ]
        };

        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('[Puppeteer] Using system Chromium:', launchOptions.executablePath);
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        onProgress('navigating', '🌐 正在连接 batch.1key.me...');
        console.log('[Puppeteer] Navigating to batch.1key.me...');
        await page.goto(BATCH_1KEY_URL, { waitUntil: 'networkidle2', timeout: 30000 });

        await page.waitForSelector('#programSelect', { timeout: 10000 });

        onProgress('configuring', '🔑 正在设置 API Key...');
        console.log('[Puppeteer] Setting API key via button click and dialog...');

        // Set up dialog handler BEFORE clicking the button
        page.once('dialog', async dialog => {
            console.log('[Puppeteer] Dialog appeared:', dialog.type(), dialog.message());
            if (dialog.type() === 'prompt') {
                console.log(`[Puppeteer] Entering API key: length=${apiKey?.length}, first5="${apiKey?.substring(0, 5)}", last5="${apiKey?.substring(apiKey.length - 5)}"`);
                await dialog.accept(apiKey);
                console.log('[Puppeteer] API key entered in dialog');
            } else {
                await dialog.dismiss();
            }
        });


        // Find and click the "Set API Key" button
        const setApiKeyButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(btn =>
                btn.textContent.includes('Set API Key') ||
                btn.textContent.includes('API Key') ||
                btn.textContent.includes('设置')
            );
        });

        if (setApiKeyButton) {
            await setApiKeyButton.click();
            console.log('[Puppeteer] Clicked Set API Key button');
            await new Promise(r => setTimeout(r, 1000)); // Wait for dialog to be handled
        } else {
            console.log('[Puppeteer] Set API Key button not found, trying localStorage method');
            await page.evaluate((key) => {
                localStorage.setItem('batchApiKey', key);
            }, apiKey);
            await page.reload({ waitUntil: 'networkidle2' });
        }

        // Verify API key is set (look for quota display like "Quota: 34")
        await new Promise(r => setTimeout(r, 1500));
        const pageContent = await page.evaluate(() => document.body.innerText);

        // Extract remaining quota from page content
        let remainingQuota = null;
        const quotaMatch = pageContent.match(/Quota[:\s]*(\d+)/i);
        if (quotaMatch) {
            remainingQuota = parseInt(quotaMatch[1], 10);
            console.log('[Puppeteer] Detected remaining quota:', remainingQuota);

            // Send quota info to frontend
            onProgress('quota', `🎫 API剩余次数: ${remainingQuota}`, null, { quota: remainingQuota });

            if (remainingQuota === 0) {
                onProgress('quota_warning', '⚠️ API次数已用完，请联系管理员补货', null, { quota: 0 });
                return {
                    success: false,
                    message: 'API验证次数已用完，请联系管理员补货',
                    remainingQuota: 0
                };
            }
        }

        if (pageContent.includes('Quota:') || pageContent.includes('API key enabled')) {
            onProgress('api_ready', '✅ API Key 已设置');
            console.log('[Puppeteer] API key confirmed set');
        } else {
            console.log('[Puppeteer] API key status uncertain, continuing anyway');
        }

        await page.waitForSelector('#programSelect', { timeout: 10000 });


        onProgress('selecting', '📋 正在选择验证程序...');
        console.log('[Puppeteer] Selecting Google Student program...');
        await page.select('#programSelect', 'google-student');

        // Wait for the textarea to be ready after program selection
        await new Promise(r => setTimeout(r, 1000));

        onProgress('entering', '✏️ 正在输入验证 ID...');
        console.log('[Puppeteer] Entering verification ID:', verificationId.substring(0, 30) + '...');

        const textareaSelector = 'textarea';
        await page.waitForSelector(textareaSelector, { timeout: 5000 });

        // Method 1: Clear and type using triple-click to select all, then type
        await page.click(textareaSelector, { clickCount: 3 }); // Select all placeholder if any
        await page.keyboard.press('Backspace'); // Clear selection

        // Method 2: Use evaluate to directly set the value (more reliable)
        await page.evaluate((selector, value) => {
            const textarea = document.querySelector(selector);
            if (textarea) {
                textarea.value = value;
                // Trigger input event so Vue/React can detect the change
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, textareaSelector, verificationId);

        // Verify the input was successful
        const inputtedValue = await page.evaluate((selector) => {
            const textarea = document.querySelector(selector);
            return textarea ? textarea.value : '';
        }, textareaSelector);

        console.log('[Puppeteer] Verified textarea value:', inputtedValue.substring(0, 50) + '...');

        if (!inputtedValue || !inputtedValue.includes('sheerid') && !inputtedValue.includes('6971')) {
            onProgress('debug', `⚠️ 输入验证: 当前值长度 ${inputtedValue.length}`);
            console.log('[Puppeteer] Warning: Input might not be correct');
        } else {
            onProgress('entering', '✅ 验证 ID 已输入');
        }

        await new Promise(r => setTimeout(r, 500));

        onProgress('starting', '▶️ 正在开始验证...');
        console.log('[Puppeteer] Clicking Start Verification...');

        const buttons = await page.$$('button');
        let startButton = null;

        for (const button of buttons) {
            const text = await button.evaluate(el => el.textContent);
            if (text.includes('Start') || text.includes('Verification') || text.includes('开始')) {
                startButton = button;
                break;
            }
        }

        if (!startButton) {
            throw new Error('无法找到开始验证按钮');
        }

        await startButton.click();

        onProgress('waiting', '⏳ 验证进行中，请耐心等待...');
        console.log('[Puppeteer] Waiting for verification results...');

        // Monitor for status changes with progress updates
        const result = await waitForVerificationResult(page, verificationId, onProgress);

        if (result.success) {
            onProgress('complete', `✅ ${result.message}`);
        } else {
            onProgress('failed', `❌ ${result.message}`);
        }

        return result;

    } catch (error) {
        console.error('[Puppeteer] Error:', error.message);
        onProgress('error', `❌ 错误: ${error.message}`);
        return {
            success: false,
            message: error.message || '验证过程出错'
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Wait for verification result by monitoring page changes
 */
async function waitForVerificationResult(page, verificationId, onProgress) {
    const startTime = Date.now();
    let checkCount = 0;
    const shortId = verificationId.substring(0, 10);

    while (Date.now() - startTime < VERIFICATION_TIMEOUT) {
        await new Promise(r => setTimeout(r, 2000)); // Check every 2 seconds
        checkCount++;

        // Get page content for status updates
        const pageContent = await page.evaluate(() => {
            return document.body.innerText;
        });

        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

        // Look for our verification ID in the page
        const hasOurId = pageContent.includes(shortId);

        // Detect 1key processing status from actual UI patterns
        if (pageContent.includes('Waiting...') && pageContent.includes('pending')) {
            onProgress('processing', `⏳ 1key 正在排队处理... (${elapsedSec}s)`);
        } else if (pageContent.includes('Waiting for review')) {
            onProgress('reviewing', `🔍 1key 正在审核验证... (${elapsedSec}s)`);
        } else if (pageContent.includes('Processing')) {
            onProgress('processing', `🔄 1key 处理中... (${elapsedSec}s)`);
        } else {
            onProgress('waiting', `⏳ 等待1key响应... (${elapsedSec}s)`);
        }

        // Check for SUCCESS - "Verification completed successfully!" from screenshot
        if (pageContent.includes('Verification completed successfully') ||
            pageContent.includes('completed successfully')) {
            onProgress('success', '✅ 1key 验证成功！');
            console.log('[Puppeteer] Verification completed successfully!');
            return { success: true, message: '验证成功！' };
        }

        // Check for success count in Results section (e.g., "1 Success")
        if (hasOurId) {
            const successMatch = pageContent.match(/(\d+)\s*\n*Success/i);
            if (successMatch && parseInt(successMatch[1]) > 0) {
                onProgress('success', '✅ 验证成功！');
                console.log('[Puppeteer] Found success count > 0');
                return { success: true, message: '验证成功！' };
            }

            // Check for failure count
            const failedMatch = pageContent.match(/(\d+)\s*\n*Failed/i);
            if (failedMatch && parseInt(failedMatch[1]) > 0) {
                onProgress('failed', '❌ 验证失败');
                console.log('[Puppeteer] Found failed count > 0');
                return { success: false, message: '验证失败' };
            }
        }

        // Check for general error messages on the page
        // Note: Must be careful not to match "API key enabled" which is a success indicator
        if (pageContent.includes('Invalid API key') ||
            pageContent.includes('API key invalid') ||
            pageContent.includes('Invalid API Key') ||
            pageContent.includes('Unauthorized') ||
            pageContent.includes('authentication failed')) {
            onProgress('error', '❌ API Key 无效');
            return { success: false, message: 'API Key 无效，请联系管理员' };
        }

        if (pageContent.includes('Rate limit') || pageContent.includes('Too many')) {
            onProgress('error', '❌ 请求过于频繁');
            return { success: false, message: '请求过于频繁，请稍后重试' };
        }

        if (pageContent.includes('expired') || pageContent.includes('过期')) {
            onProgress('error', '❌ 验证ID已过期');
            return { success: false, message: '验证ID已过期' };
        }

        if (pageContent.includes('Invalid') && pageContent.includes('ID')) {
            onProgress('error', '❌ 无效的验证ID');
            return { success: false, message: '无效的验证ID' };
        }

        // Check for completion indicators
        if (pageContent.includes('Complete') || pageContent.includes('完成')) {
            onProgress('checking', '🔍 检测到验证完成，正在确认结果...');
            await new Promise(r => setTimeout(r, 2000));
        }

        // Send page content summary every 10 checks for debugging (console only, not displayed to user)
        if (checkCount % 10 === 0) {
            const contentPreview = pageContent.substring(0, 300).replace(/\n/g, ' ');
            // Pass page content as third parameter - this sends a 'debug' event, not displayed to user
            console.log(`[Puppeteer] Page content preview: ${contentPreview}...`);
        }
    }

    return { success: false, message: '验证超时，请稍后重试' };
}

module.exports = { verifyWithPuppeteer };
