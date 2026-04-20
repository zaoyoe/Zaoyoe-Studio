const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function runLoader(relativePath, href) {
    const source = readRepoFile(relativePath);
    const writes = [];
    const appendedScripts = [];

    const context = {
        URL,
        window: {
            location: {
                href
            }
        },
        document: {
            readyState: 'loading',
            write(html) {
                writes.push(html);
            },
            createElement(tagName) {
                return {
                    tagName,
                    src: '',
                    async: true
                };
            },
            head: {
                appendChild(node) {
                    appendedScripts.push(node);
                }
            },
            documentElement: {
                appendChild(node) {
                    appendedScripts.push(node);
                }
            },
            body: {
                appendChild(node) {
                    appendedScripts.push(node);
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(source, context);

    return {
        writes,
        appendedScripts
    };
}

test('admin smoke loader only injects the local smoke harness when smoke mode is enabled', () => {
    const disabled = runLoader('js/admin-smoke-loader.js', 'http://127.0.0.1:8000/admin-studio.html');
    assert.deepEqual(disabled.writes, []);
    assert.deepEqual(disabled.appendedScripts, []);

    const enabled = runLoader('js/admin-smoke-loader.js', 'http://127.0.0.1:8000/admin-studio.html?smoke=1');
    assert.equal(enabled.writes.length, 1);
    assert.match(enabled.writes[0], /js\/local-smoke-fixtures\.js\?v=20260412_LOCAL_SMOKE_FIXTURES_PRODUCT_BUNDLES_35/);
    assert.deepEqual(enabled.appendedScripts, []);
});

test('admin real smoke loader only injects the real smoke harness when real smoke mode is enabled', () => {
    const disabled = runLoader('js/admin-real-smoke-loader.js', 'http://127.0.0.1:8000/admin-studio.html');
    assert.deepEqual(disabled.writes, []);
    assert.deepEqual(disabled.appendedScripts, []);

    const enabled = runLoader('js/admin-real-smoke-loader.js', 'http://127.0.0.1:8000/admin-studio.html?realSmoke=1');
    assert.equal(enabled.writes.length, 1);
    assert.match(enabled.writes[0], /js\/admin-real-smoke\.js\?v=20260402_ADMIN_REAL_SMOKE_9/);
    assert.deepEqual(enabled.appendedScripts, []);
});
