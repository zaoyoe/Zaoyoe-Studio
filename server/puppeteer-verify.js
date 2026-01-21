/**
 * Puppeteer automation for batch.1key.me
 * Automates the verification process on their website
 */

const puppeteer = require('puppeteer');

const BATCH_1KEY_URL = 'https://batch.1key.me';
const VERIFICATION_TIMEOUT = 60000; // 60 seconds

// Check if running in mock mode (for local development)
const MOCK_MODE = process.env.MOCK_VERIFY === 'true';

/**
 * Verify using Puppeteer automation on batch.1key.me
 * @param {string} apiKey - The 1key API key
 * @param {string} verificationId - The verification ID to process
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function verifyWithPuppeteer(apiKey, verificationId) {
    // Mock mode for local testing
    if (MOCK_MODE) {
        console.log('[Puppeteer] 🧪 Running in MOCK MODE');
        console.log(`[Puppeteer] Mock verifying: ${verificationId}`);
        await new Promise(r => setTimeout(r, 2000)); // Simulate processing time
        return {
            success: true,
            message: '✅ 验证成功 (模拟模式)'
        };
    }

    let browser = null;

    try {
        console.log('[Puppeteer] Launching browser...');

        // Use system Chromium if available (Railway/production)
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

        // Use system Chromium path if specified
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('[Puppeteer] Using system Chromium:', launchOptions.executablePath);
        }

        browser = await puppeteer.launch(launchOptions);

        const page = await browser.newPage();

        // Set viewport
        await page.setViewport({ width: 1280, height: 800 });

        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('[Puppeteer] Navigating to batch.1key.me...');
        await page.goto(BATCH_1KEY_URL, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for page to load
        await page.waitForSelector('#programSelect', { timeout: 10000 });

        // Set API key in localStorage (this is how 1key stores it)
        console.log('[Puppeteer] Setting API key...');
        await page.evaluate((key) => {
            localStorage.setItem('batchApiKey', key);
        }, apiKey);

        // Refresh to apply the key
        await page.reload({ waitUntil: 'networkidle2' });
        await page.waitForSelector('#programSelect', { timeout: 10000 });

        // Ensure Google Student is selected (default)
        console.log('[Puppeteer] Selecting Google Student program...');
        await page.select('#programSelect', 'google-student');

        // Find the textarea and enter verification ID
        console.log('[Puppeteer] Entering verification ID...');
        const textareaSelector = 'textarea';
        await page.waitForSelector(textareaSelector, { timeout: 5000 });
        await page.click(textareaSelector);
        await page.type(textareaSelector, verificationId);

        // Small delay to ensure the ID is processed
        await new Promise(r => setTimeout(r, 500));

        // Click Start Verification button
        console.log('[Puppeteer] Clicking Start Verification...');
        const startButtonSelector = 'button:has-text("Start Verification"), button.start-btn, [onclick*="start"], button[type="submit"]';

        // Try to find the start button
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

        // Wait for results
        console.log('[Puppeteer] Waiting for verification results...');

        // Monitor for status changes
        const result = await waitForVerificationResult(page, verificationId);

        return result;

    } catch (error) {
        console.error('[Puppeteer] Error:', error.message);
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
async function waitForVerificationResult(page, verificationId) {
    const startTime = Date.now();

    while (Date.now() - startTime < VERIFICATION_TIMEOUT) {
        await new Promise(r => setTimeout(r, 2000)); // Check every 2 seconds

        // Look for result indicators on the page
        const pageContent = await page.evaluate(() => {
            const body = document.body.innerText;
            return body;
        });

        // Check for success indicators
        if (pageContent.includes('Pass') || pageContent.includes('成功') || pageContent.includes('Verified')) {
            // Check if our specific ID passed
            const statusItems = await page.$$('.status-item, .result-row, tr');

            for (const item of statusItems) {
                const text = await item.evaluate(el => el.textContent);
                if (text.includes(verificationId.substring(0, 10))) {
                    if (text.includes('Pass') || text.includes('✓') || text.includes('成功')) {
                        return { success: true, message: '验证成功' };
                    } else if (text.includes('Fail') || text.includes('✗') || text.includes('失败')) {
                        // Extract failure reason if available
                        const reason = text.match(/Fail[:\s]*(.+?)(?:\s|$)/i)?.[1] || '验证失败';
                        return { success: false, message: reason };
                    }
                }
            }
        }

        // Check for failure indicators
        if (pageContent.includes('Fail') && pageContent.includes(verificationId.substring(0, 10))) {
            return { success: false, message: '验证失败' };
        }

        // Check for error messages
        if (pageContent.includes('Invalid') || pageContent.includes('Error') || pageContent.includes('expired')) {
            return { success: false, message: '验证ID无效或已过期' };
        }
    }

    return { success: false, message: '验证超时，请稍后重试' };
}

module.exports = { verifyWithPuppeteer };
