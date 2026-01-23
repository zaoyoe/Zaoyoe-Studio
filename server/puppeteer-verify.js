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
 * @param {string|string[]} verificationIds - Single ID or array of verification IDs to process
 * @param {function} onProgress - Callback for progress updates
 * @param {AbortSignal} abortSignal - Signal to abort the operation
 * @returns {Promise<{success: boolean, message: string, remainingQuota?: number, results?: Array}>}
 */
async function verifyWithPuppeteer(apiKey, verificationIds, onProgress = () => { }, abortSignal = null) {
    // Normalize to array
    const ids = Array.isArray(verificationIds) ? verificationIds : [verificationIds];
    const batchSize = ids.length;

    // Check for abort before starting
    if (abortSignal && abortSignal.aborted) {
        return {
            success: false,
            message: '验证已取消',
            stats: { success: 0, failed: 0, total: batchSize }
        };
    }

    // Mock mode for local testing
    if (MOCK_MODE) {
        onProgress('mock', `🧪 模拟模式启动 (${batchSize} 个链接)`);
        console.log('[Puppeteer] 🧪 Running in MOCK MODE with', batchSize, 'IDs');

        await new Promise(r => setTimeout(r, 1000));

        // Check for abort in mock mode
        if (abortSignal && abortSignal.aborted) {
            onProgress('error', '验证已取消');
            return {
                success: false,
                message: '验证已取消',
                stats: { success: 0, failed: 0, total: batchSize }
            };
        }

        onProgress('mock', '正在模拟验证过程...');

        await new Promise(r => setTimeout(r, 2000));

        // Check for abort again
        if (abortSignal && abortSignal.aborted) {
            onProgress('error', '验证已取消');
            return {
                success: false,
                message: '验证已取消',
                stats: { success: 0, failed: 0, total: batchSize }
            };
        }

        // Generate mock results for each ID
        const mockResults = ids.map((id, i) => ({
            id: id.substring(0, 50),
            success: true,
            message: '验证成功 (模拟)'
        }));

        onProgress('complete', `✅ 验证完成 (模拟模式): ${batchSize}/${batchSize} 成功`);

        return {
            success: true,
            message: `✅ 批量验证完成 (模拟模式)`,
            results: mockResults,
            stats: { success: batchSize, failed: 0, total: batchSize }
        };
    }

    let browser = null;

    try {
        onProgress('launching', '🚀 正在启动浏览器...');
        console.log('[Puppeteer] Launching browser...');

        const launchOptions = {
            headless: 'new', // Use new headless mode
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process',
                '--disable-features=IsolateOrigins,site-per-process' // Additional stability
            ]
        };

        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('[Puppeteer] Using system Chromium:', launchOptions.executablePath);
        } else if (process.platform === 'darwin') {
            const fs = require('fs');
            const possiblePaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
                '/Applications/Chromium.app/Contents/MacOS/Chromium'
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    launchOptions.executablePath = p;
                    console.log('[Puppeteer] Found and using local Chrome installation:', p);
                    break;
                }
            }
        }

        browser = await puppeteer.launch(launchOptions);

        // Check for abort
        if (abortSignal && abortSignal.aborted) throw new Error('ABORTED');

        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        onProgress('navigating', '🌐 正在连接 batch.1key.me...');
        console.log('[Puppeteer] Navigating to batch.1key.me...');
        await page.goto(BATCH_1KEY_URL, { waitUntil: 'networkidle2', timeout: 30000 });

        // Check for abort
        if (abortSignal && abortSignal.aborted) throw new Error('ABORTED');

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

        // Check for abort
        if (abortSignal && abortSignal.aborted) throw new Error('ABORTED');

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
                    remainingQuota: 0,
                    stats: { success: 0, failed: batchSize, total: batchSize }
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

        // Join all IDs with newlines for batch submission
        const batchInput = ids.join('\n');

        onProgress('entering', `✏️ 正在输入 ${batchSize} 个验证 ID...`);
        console.log(`[Puppeteer] Entering ${batchSize} verification IDs`);

        const textareaSelector = 'textarea';
        await page.waitForSelector(textareaSelector, { timeout: 5000 });

        // Check for abort
        if (abortSignal && abortSignal.aborted) throw new Error('ABORTED');

        // Use native Puppeteer input simulation - MOST reliable for all frameworks
        // Step 1: Click to focus
        // Step 2: Select all (Ctrl+A / Cmd+A)
        // Step 3: Delete existing content
        // Step 4: Type new content using keyboard.type
        console.log('[Puppeteer] Using native keyboard input for textarea...');

        // Focus and click the textarea
        await page.click(textareaSelector);
        await new Promise(r => setTimeout(r, 200));

        // Select all and delete existing content
        const isMac = process.platform === 'darwin';
        if (isMac) {
            await page.keyboard.down('Meta');
            await page.keyboard.press('a');
            await page.keyboard.up('Meta');
        } else {
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
        }
        await page.keyboard.press('Backspace');
        await new Promise(r => setTimeout(r, 200));

        // Type each line separately with explicit Enter key between them
        console.log('[Puppeteer] Typing', ids.length, 'IDs line by line...');
        for (let i = 0; i < ids.length; i++) {
            // Check for abort during typing
            if (abortSignal && abortSignal.aborted) throw new Error('ABORTED');

            const id = ids[i];
            console.log(`[Puppeteer] Typing ID[${i}]: "${id.substring(0, 80)}..."`);
            await page.keyboard.type(id, { delay: 1 }); // Fast typing with 1ms delay

            // Add newline after each ID except the last one
            if (i < ids.length - 1) {
                await page.keyboard.press('Enter');
            }
        }

        // Wait for framework reactivity
        await new Promise(r => setTimeout(r, 500));

        // Verify the input was successful
        const inputtedValue = await page.evaluate((selector) => {
            const textarea = document.querySelector(selector);
            return textarea ? textarea.value : '';
        }, textareaSelector);

        const inputLines = inputtedValue.split('\n').filter(l => l.trim()).length;
        console.log(`[Puppeteer] Verified textarea: ${inputLines} lines entered`);
        console.log(`[Puppeteer] Textarea actual content (first 500 chars): "${inputtedValue.substring(0, 500)}"`);

        if (inputLines !== batchSize) {
            onProgress('debug', `⚠️ 输入验证: 期望 ${batchSize} 行，实际 ${inputLines} 行`);
            console.log('[Puppeteer] Warning: Input line count mismatch');
        } else {
            onProgress('entering', `✅ ${batchSize} 个验证 ID 已输入`);
        }

        await new Promise(r => setTimeout(r, 500));

        // Check for abort before clicking start
        if (abortSignal && abortSignal.aborted) throw new Error('ABORTED');

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

        onProgress('waiting', `⏳ 批量验证进行中 (${batchSize} 个)，请耐心等待...`);
        console.log(`[Puppeteer] Waiting for batch verification results (${batchSize} IDs)...`);

        // Monitor for status changes with progress updates
        const result = await waitForVerificationResult(page, ids, batchSize, onProgress, abortSignal);

        if (result.success) {
            onProgress('complete', `✅ ${result.message}`);
        } else if (result.cancelled) {
            onProgress('error', `🛑 ${result.message}`);
        } else {
            onProgress('failed', `❌ ${result.message}`);
        }

        return result;

    } catch (error) {
        if (error.message === 'ABORTED') {
            console.log('[Puppeteer] Process aborted by signal');
            return {
                success: false,
                message: '验证已取消',
                cancelled: true,
                stats: { success: 0, failed: 0, total: batchSize }
            };
        }

        console.error('[Puppeteer] Error:', error.message);
        onProgress('error', `❌ 错误: ${error.message}`);
        return {
            success: false,
            message: error.message || '验证过程出错',
            stats: { success: 0, failed: batchSize, total: batchSize }
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Wait for verification result by monitoring page changes
 * @param {Page} page - Puppeteer page
 * @param {string[]} ids - Array of verification IDs
 * @param {number} batchSize - Total number of IDs
 * @param {function} onProgress - Progress callback
 * @param {AbortSignal} abortSignal - Signal to monitor for cancellation
 */
async function waitForVerificationResult(page, ids, batchSize, onProgress, abortSignal) {
    const startTime = Date.now();
    let checkCount = 0;
    let lastSuccessCount = 0;
    let lastFailedCount = 0;

    while (Date.now() - startTime < VERIFICATION_TIMEOUT) {
        // Check for cancellation
        if (abortSignal && abortSignal.aborted) {
            console.log('[Puppeteer] Abort signal received during wait loop. Attempting to click Cancel on page...');
            onProgress('cancelling', '正在尝试取消远程任务...');

            // Try to find and click any "Cancel" or "Stop" buttons on the page
            try {
                const cancelClicked = await page.evaluate(() => {
                    // Try to find buttons with "Cancel" or "Stop" text
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const cancelBtns = buttons.filter(btn => {
                        const text = btn.textContent.toLowerCase();
                        return text.includes('cancel') ||
                            text.includes('stop') ||
                            text.includes('abort') ||
                            text.includes('取消') ||
                            // Also check for red buttons which are often cancel/delete buttons
                            window.getComputedStyle(btn).backgroundColor.includes('rgb(239, 68, 68)') ||
                            window.getComputedStyle(btn).backgroundColor.includes('rgb(220, 38, 38)');
                    });

                    if (cancelBtns.length > 0) {
                        console.log(`Found ${cancelBtns.length} potential cancel buttons`);
                        // Click the most likely one (e.g. visible one)
                        for (const btn of cancelBtns) {
                            if (btn.offsetParent !== null) { // Check visibility
                                btn.click();
                                return true;
                            }
                        }
                    }
                    return false;
                });

                if (cancelClicked) {
                    console.log('[Puppeteer] Cancel button clicked on page');
                    onProgress('cancelling', '已点击页面取消按钮');
                    // Wait a moment for the click to register
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    console.log('[Puppeteer] No explicit cancel button found');
                }
            } catch (e) {
                console.warn('[Puppeteer] Error while trying to click cancel:', e);
            }

            return {
                success: false,
                message: '验证已取消',
                cancelled: true,
                stats: { success: lastSuccessCount, failed: lastFailedCount, total: batchSize }
            };
        }

        await new Promise(r => setTimeout(r, 2000)); // Check every 2 seconds
        checkCount++;

        // Get page content for status updates
        const pageContent = await page.evaluate(() => {
            return document.body.innerText;
        });

        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

        // Parse success and failed counts from page content
        const successMatch = pageContent.match(/(\d+)\s*\n*Success/i);
        const failedMatch = pageContent.match(/(\d+)\s*\n*Failed/i);
        const pendingMatch = pageContent.match(/(\d+)\s*\n*Pending/i);

        const successCount = successMatch ? parseInt(successMatch[1]) : 0;
        const failedCount = failedMatch ? parseInt(failedMatch[1]) : 0;
        const pendingCount = pendingMatch ? parseInt(pendingMatch[1]) : 0;
        const processedCount = successCount + failedCount;

        // Send progress update when counts change
        if (successCount !== lastSuccessCount || failedCount !== lastFailedCount) {
            onProgress('progress', `📊 进度: ${processedCount}/${batchSize} (✅${successCount} ❌${failedCount})`, null, {
                processed: processedCount,
                success: successCount,
                failed: failedCount,
                total: batchSize
            });
            lastSuccessCount = successCount;
            lastFailedCount = failedCount;
        }

        // Detect 1key processing status from actual UI patterns
        if (pageContent.includes('Waiting...') && pageContent.includes('pending')) {
            onProgress('processing', `⏳ 1key 正在排队处理... (${elapsedSec}s)`);
        } else if (pageContent.includes('Waiting for review')) {
            onProgress('reviewing', `🔍 1key 正在审核验证... (${elapsedSec}s)`);
        } else if (pageContent.includes('Processing')) {
            onProgress('processing', `🔄 1key 处理中 ${processedCount}/${batchSize}... (${elapsedSec}s)`);
        } else if (processedCount > 0 && processedCount < batchSize) {
            onProgress('waiting', `⏳ 处理中 ${processedCount}/${batchSize}... (${elapsedSec}s)`);
        }

        // Check if all items are processed (no pending items)
        if (processedCount === batchSize && pendingCount === 0) {
            console.log(`[Puppeteer] Batch complete: ${successCount} success, ${failedCount} failed`);

            const message = `批量验证完成: ${successCount} 个成功, ${failedCount} 个失败`;

            return {
                success: successCount > 0,
                message: message,
                stats: {
                    success: successCount,
                    failed: failedCount,
                    total: batchSize
                }
            };
        }

        // Check for "Verification completed successfully!" message
        if (pageContent.includes('Verification completed successfully') ||
            pageContent.includes('completed successfully')) {
            console.log('[Puppeteer] Verification completed message detected');

            // Wait a bit more to get final counts
            await new Promise(r => setTimeout(r, 2000));

            const finalContent = await page.evaluate(() => document.body.innerText);
            const finalSuccess = finalContent.match(/(\d+)\s*\n*Success/i);
            const finalFailed = finalContent.match(/(\d+)\s*\n*Failed/i);

            const finalSuccessCount = finalSuccess ? parseInt(finalSuccess[1]) : successCount;
            const finalFailedCount = finalFailed ? parseInt(finalFailed[1]) : failedCount;

            return {
                success: finalSuccessCount > 0,
                message: `批量验证完成: ${finalSuccessCount} 个成功, ${finalFailedCount} 个失败`,
                stats: {
                    success: finalSuccessCount,
                    failed: finalFailedCount,
                    total: batchSize
                }
            };
        }

        // Check for general error messages on the page
        if (pageContent.includes('Invalid API key') ||
            pageContent.includes('API key invalid') ||
            pageContent.includes('Invalid API Key') ||
            pageContent.includes('Unauthorized') ||
            pageContent.includes('authentication failed')) {
            onProgress('error', '❌ API Key 无效');
            return { success: false, message: 'API Key 无效，请联系管理员', stats: { success: 0, failed: batchSize, total: batchSize } };
        }

        if (pageContent.includes('Rate limit') || pageContent.includes('Too many')) {
            onProgress('error', '❌ 请求过于频繁');
            return { success: false, message: '请求过于频繁，请稍后重试', stats: { success: successCount, failed: failedCount, total: batchSize } };
        }

        // Send page content summary every 15 checks for debugging (console only)
        if (checkCount % 15 === 0) {
            const contentPreview = pageContent.substring(0, 300).replace(/\n/g, ' ');
            console.log(`[Puppeteer] Page content preview: ${contentPreview}...`);
        }
    }

    // Timeout - return whatever we have
    return {
        success: lastSuccessCount > 0,
        message: `验证超时，已完成 ${lastSuccessCount + lastFailedCount}/${batchSize}`,
        stats: { success: lastSuccessCount, failed: lastFailedCount, total: batchSize }
    };
}

module.exports = { verifyWithPuppeteer };
