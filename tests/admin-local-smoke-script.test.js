const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const smokeScript = require(path.resolve(__dirname, '../scripts/admin-local-smoke.js'));

test('admin local smoke script parses module and timing flags', () => {
    const options = smokeScript.parseArgs([
        '--module', 'shop',
        '--suite', 'core',
        '--base-url', '127.0.0.1:9000',
        '--timeout-ms', '60000',
        '--virtual-time-budget-ms', '42000',
        '--chrome-path', '/tmp/fake-chrome'
    ]);

    assert.equal(options.module, 'shop');
    assert.equal(options.suite, 'core');
    assert.equal(options.baseUrl, '127.0.0.1:9000');
    assert.equal(options.timeoutMs, 60000);
    assert.equal(options.virtualTimeBudgetMs, 42000);
    assert.equal(options.chromePath, '/tmp/fake-chrome');
});

test('admin local smoke script resolves core suite modules', () => {
    const options = smokeScript.parseArgs(['--suite', 'core']);

    assert.deepEqual(smokeScript.resolveSmokeSuiteModules(options), ['gallery', 'shop', 'analytics']);
});

test('admin local smoke script resolves all suite modules including payments', () => {
    const options = smokeScript.parseArgs(['--suite', 'all']);

    assert.deepEqual(
        smokeScript.resolveSmokeSuiteModules(options),
        ['homepage', 'gallery', 'comments', 'shop', 'payments', 'points', 'growth-center', 'analytics', 'settings', 'tickets', 'chat']
    );
});

test('admin local smoke script accepts custom module suite lists', () => {
    const options = smokeScript.parseArgs(['--modules', 'business-overview,shop,analytics']);

    assert.deepEqual(smokeScript.resolveSmokeSuiteModules(options), ['analytics', 'shop']);
});

test('admin local smoke script applies module timing profiles', () => {
    const options = smokeScript.buildSmokeModuleOptions({
        timeoutMs: 45000,
        virtualTimeBudgetMs: 60000
    }, 'analytics');

    assert.equal(options.module, 'analytics');
    assert.equal(options.timeoutMs, 300000);
    assert.equal(options.virtualTimeBudgetMs, 420000);
});

test('admin local smoke script applies payments timing profile', () => {
    const options = smokeScript.buildSmokeModuleOptions({
        timeoutMs: 45000,
        virtualTimeBudgetMs: 60000
    }, 'payments');

    assert.equal(options.module, 'payments');
    assert.equal(options.timeoutMs, 150000);
    assert.equal(options.virtualTimeBudgetMs, 220000);
});

test('admin local smoke script builds admin studio smoke url with module query', () => {
    const targetUrl = smokeScript.buildTargetUrl({
        baseUrl: '127.0.0.1:8000',
        page: 'admin-studio.html',
        module: 'shop',
        smokeDom: 'minimal',
        smokeViewport: 'mobile',
        smokeRunId: 'run-123'
    });

    assert.equal(
        targetUrl,
        'http://127.0.0.1:8000/admin-studio.html?smoke=1&smokeDom=minimal&module=shop&smokeViewport=mobile&smokeRunId=run-123'
    );
});

test('admin local smoke script builds smoke result polling url from base url and run id', () => {
    const resultUrl = smokeScript.buildSmokeResultUrl({
        baseUrl: '127.0.0.1:8000'
    }, 'run-456');

    assert.equal(resultUrl, 'http://127.0.0.1:8000/__local-smoke-result?runId=run-456');
});

test('admin local smoke script isolates Chrome with a per-run user data dir', () => {
    const args = smokeScript.buildChromeArgs({
        baseUrl: '127.0.0.1:8000',
        chromeUserDataDir: '/tmp/admin-smoke-profile',
        smokeRunId: 'run-789'
    });

    assert.ok(args.includes('--user-data-dir=/tmp/admin-smoke-profile'));
    assert.match(args.at(-1), /smokeRunId=run-789/);
});

test('admin local smoke polling can be cancelled after early Chrome exit', async () => {
    await assert.rejects(
        smokeScript.pollSmokeResult('http://127.0.0.1:1/__local-smoke-result', {
            timeoutMs: 1000,
            intervalMs: 100,
            isCancelled: () => true
        }),
        (error) => error?.cancelled === true
    );
});

test('admin local smoke script extracts smoke status and decoded text from dom output', () => {
    const result = smokeScript.extractSmokeResult(`
        <html data-local-smoke-status="passed">
            <body>
                <pre id="localSmokeResult" data-local-smoke-status="passed">Local Smoke: PASSED
PASS 库存导入会通过 shop mutate handler 写入批次
PASS 批量释放储备库存会通过 shop mutate handler 回收为在售库存 &amp; 统计回算</pre>
            </body>
        </html>
    `);

    assert.equal(result.status, 'passed');
    assert.match(result.text, /Local Smoke: PASSED/);
    assert.match(result.text, /库存导入会通过 shop mutate handler 写入批次/);
    assert.match(result.text, /& 统计回算/);
});

test('admin local smoke script summarizes suite output with check counts', () => {
    const text = smokeScript.buildSmokeSuiteText({
        suiteName: 'core',
        status: 'passed',
        durationMs: 1234,
        results: [
            {
                module: 'gallery',
                status: 'passed',
                durationMs: 500,
                summary: {
                    result: {
                        text: 'Local Smoke: PASSED\nPASS A\nPASS B'
                    }
                }
            }
        ]
    });

    assert.match(text, /Admin Local Smoke Suite: CORE/);
    assert.match(text, /PASS Gallery \(gallery\)/);
    assert.match(text, /checks=2 pass, 0 fail/);
});
