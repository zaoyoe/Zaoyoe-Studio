const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const smokeScript = require(path.resolve(__dirname, '../scripts/admin-local-smoke.js'));

test('admin local smoke script parses module and timing flags', () => {
    const options = smokeScript.parseArgs([
        '--module', 'shop',
        '--base-url', '127.0.0.1:9000',
        '--timeout-ms', '60000',
        '--virtual-time-budget-ms', '42000',
        '--chrome-path', '/tmp/fake-chrome'
    ]);

    assert.equal(options.module, 'shop');
    assert.equal(options.baseUrl, '127.0.0.1:9000');
    assert.equal(options.timeoutMs, 60000);
    assert.equal(options.virtualTimeBudgetMs, 42000);
    assert.equal(options.chromePath, '/tmp/fake-chrome');
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
