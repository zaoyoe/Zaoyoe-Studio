const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts.html includes invisible anti-bot honeypot trap button', () => {
    const html = readRepoFile('prompts.html');
    assert.match(
        html,
        /<div\s+class="prompt-security-honeypot"[^>]*>[\s\S]*?<button\s+id="honeypotPromptCopyBtn"/i,
        'prompts.html should define an invisible honeypot trap container with #honeypotPromptCopyBtn'
    );
});

test('prompts-poetry.js defines zero-width watermark and security helpers', () => {
    const js = readRepoFile('prompts-poetry.js');

    assert.match(js, /const PROMPT_INVISIBLE_WATERMARK = '\\u200B\\u200C\\u200D\\u200C\\u200B';/);
    assert.match(js, /function injectPromptSecurityWatermark\(/);
    assert.match(js, /function hasPromptSecurityWatermark\(/);
    assert.match(js, /function detectAutomatedCrawler\(/);
    assert.match(js, /function isPromptCopyRateLimited\(/);
    assert.match(js, /function bindPromptSecurityHoneypot\(/);
});

test('injectPromptSecurityWatermark embeds invisible watermark and avoids duplication', () => {
    const js = readRepoFile('prompts-poetry.js');

    const sandbox = {
        window: {},
        navigator: { webdriver: false },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: { documentElement: { getAttribute: () => null } },
        console: { log: () => {}, warn: () => {}, error: () => {} }
    };
    sandbox.window = sandbox;

    // Extract the security block
    const markerStart = '// PROMPT ANTI-SCRAPER & ZERO-WIDTH WATERMARK PROTECTION';
    const markerEnd = 'function copyPromptText(';
    const startIndex = js.indexOf(markerStart);
    const endIndex = js.indexOf(markerEnd);
    assert.ok(startIndex !== -1 && endIndex !== -1, 'Should find security code segment');

    const securitySnippet = js.slice(startIndex, endIndex);
    vm.runInNewContext(securitySnippet, sandbox);

    const {
        injectPromptSecurityWatermark,
        hasPromptSecurityWatermark,
        PROMPT_INVISIBLE_WATERMARK
    } = sandbox.window.ZaoyoePromptSecurity;

    const originalPrompt = '3D chibi-style miniature concept store of Starbucks --ar 16:9';
    const watermarked = injectPromptSecurityWatermark(originalPrompt);

    // Watermark should be present
    assert.ok(hasPromptSecurityWatermark(watermarked), 'Watermarked text must be identified by hasPromptSecurityWatermark');
    assert.ok(watermarked.includes(PROMPT_INVISIBLE_WATERMARK), 'Must contain the invisible watermark string');

    // Visual text should remain identical when stripping zero-width characters
    const stripped = watermarked.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
    assert.equal(stripped, originalPrompt, 'Stripped prompt must be 100% identical to original prompt');

    // Idempotency: Calling it again should not re-add duplicate watermark
    const doubleWatermarked = injectPromptSecurityWatermark(watermarked);
    assert.equal(doubleWatermarked, watermarked, 'Re-injecting watermark should be idempotent');
});

test('detectAutomatedCrawler identifies automation environments and honeypot flags', () => {
    const js = readRepoFile('prompts-poetry.js');

    const markerStart = '// PROMPT ANTI-SCRAPER & ZERO-WIDTH WATERMARK PROTECTION';
    const markerEnd = 'function copyPromptText(';
    const securitySnippet = js.slice(js.indexOf(markerStart), js.indexOf(markerEnd));

    // Test 1: Clean human browser
    const humanSandbox = {
        window: {},
        navigator: { webdriver: false },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: { documentElement: { getAttribute: () => null } }
    };
    humanSandbox.window = humanSandbox;
    vm.runInNewContext(securitySnippet, humanSandbox);
    assert.equal(
        humanSandbox.window.ZaoyoePromptSecurity.detectAutomatedCrawler(),
        false,
        'Human browser should not be detected as automated crawler'
    );

    // Test 2: Webdriver enabled (Puppeteer / Selenium)
    const botSandbox = {
        window: {},
        navigator: { webdriver: true },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: { documentElement: { getAttribute: () => null } }
    };
    botSandbox.window = botSandbox;
    vm.runInNewContext(securitySnippet, botSandbox);
    assert.equal(
        botSandbox.window.ZaoyoePromptSecurity.detectAutomatedCrawler(),
        true,
        'Headless browser with navigator.webdriver must be detected as automated crawler'
    );

    // Test 3: Honeypot flag in sessionStorage
    const honeypotSandbox = {
        window: {},
        navigator: { webdriver: false },
        sessionStorage: { getItem: (key) => (key === '__zy_bot_flag__' ? '1' : null), setItem: () => {} },
        document: { documentElement: { getAttribute: () => null } }
    };
    honeypotSandbox.window = honeypotSandbox;
    vm.runInNewContext(securitySnippet, honeypotSandbox);
    assert.equal(
        honeypotSandbox.window.ZaoyoePromptSecurity.detectAutomatedCrawler(),
        true,
        'Client with honeypot flag in sessionStorage must be detected as crawler'
    );
});

test('isPromptCopyRateLimited throttles high-frequency copy spam', () => {
    const js = readRepoFile('prompts-poetry.js');

    const markerStart = '// PROMPT ANTI-SCRAPER & ZERO-WIDTH WATERMARK PROTECTION';
    const markerEnd = 'function copyPromptText(';
    const securitySnippet = js.slice(js.indexOf(markerStart), js.indexOf(markerEnd));

    const sandbox = {
        window: {},
        navigator: { webdriver: false },
        sessionStorage: { getItem: () => null },
        document: { documentElement: { getAttribute: () => null } }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(securitySnippet, sandbox);

    const { isPromptCopyRateLimited } = sandbox.window.ZaoyoePromptSecurity;

    // First 6 copies within 10s should succeed
    for (let i = 0; i < 6; i += 1) {
        assert.equal(isPromptCopyRateLimited(), false, `Copy attempt ${i + 1} should not be rate limited`);
    }

    // 7th rapid copy within 10s should be blocked
    assert.equal(isPromptCopyRateLimited(), true, 'Attempt 7 within 10s window must be rate limited');
});
