const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    installBridge
} = require('../integrations/xianyu-auto-reply-fix/install-bridge');
const {
    parseArgs: parseSmokeArgs,
    runSmoke
} = require('../scripts/xianyu-bot-bridge-smoke');

const repoRoot = path.resolve(__dirname, '..');
const integrationDir = path.join(repoRoot, 'integrations/xianyu-auto-reply-fix');

test('xianyu-auto-reply-fix integration documents the bridge endpoints expected by worker', () => {
    const readme = fs.readFileSync(path.join(integrationDir, 'README.md'), 'utf8');

    assert.match(readme, /GET \/zaoyoe\/orders\/paid/);
    assert.match(readme, /POST \/zaoyoe\/chat\/send/);
    assert.match(readme, /marketplace:xianyu:bridge/);
    assert.match(readme, /xianyu-auto-reply-fix/);
});

test('KVM4 verify server release includes Xianyu adapter modules', () => {
    const deployScript = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-kvm4-verify-server.sh'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'deploy/kvm4/verify-server.Dockerfile'), 'utf8');

    assert.match(deployScript, /PACKAGE_PATHS=\(/);
    assert.match(deployScript, /(^|\n)\s+adapters\s*(\n|$)/);
    assert.match(dockerfile, /COPY\s+adapters\s+\.\/adapters/);
});

test('xianyu-auto-reply-fix bridge router exposes paid-order and chat-send routes', () => {
    const router = fs.readFileSync(path.join(integrationDir, 'zaoyoe_bridge.py'), 'utf8');

    assert.match(router, /@router\.get\("\/orders\/paid"\)/);
    assert.match(router, /@router\.post\("\/chat\/send"\)/);
    assert.match(router, /ZAOYOE_BRIDGE_CHAT_SENDER/);
    assert.match(router, /ZAOYOE_BRIDGE_OUTBOX_FILE/);
    assert.match(router, /ORDER_TABLE_CANDIDATES/);
    assert.match(router, /find_order_table/);
    assert.match(router, /chat_id_col/);
    assert.match(router, /sid_col/);
    assert.match(router, /"chatId"/);
});

test('xianyu-auto-reply-fix sender binds bridge chat-send to live WebSocket sender', () => {
    const sender = fs.readFileSync(path.join(integrationDir, 'zaoyoe_sender_example.py'), 'utf8');

    assert.match(sender, /async def send_message/);
    assert.match(sender, /resolve_live_instance/);
    assert.match(sender, /send_msg\(live_instance\.ws, chat_id, buyer_id, content\)/);
    assert.doesNotMatch(sender, /TODO/);
    assert.doesNotMatch(sender, /NotImplementedError/);
});

test('xianyu-auto-reply-fix installer copies bridge files and mounts router idempotently', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaoyoe-xianyu-bot-'));
    const replyServerPath = path.join(tmpDir, 'reply_server.py');
    fs.writeFileSync(replyServerPath, [
        'from fastapi import FastAPI',
        '',
        'app = FastAPI()',
        '',
        '@app.get("/health")',
        'async def health():',
        '    return {"success": True}',
        ''
    ].join('\n'));

    const first = installBridge({
        targetDir: tmpDir
    });
    const second = installBridge({
        targetDir: tmpDir
    });
    const patched = fs.readFileSync(replyServerPath, 'utf8');

    assert.equal(first.success, true);
    assert.equal(first.reply_server.changed, true);
    assert.equal(second.reply_server.changed, false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'zaoyoe_bridge.py')), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'zaoyoe_sender_example.py')), true);
    assert.equal(fs.existsSync(`${replyServerPath}.zaoyoe.bak`), true);
    assert.match(patched, /from zaoyoe_bridge import router as zaoyoe_bridge_router/);
    assert.equal((patched.match(/zaoyoe_bridge_router/g) || []).length, 2);
});

test('xianyu bot bridge smoke checks health and paid-order endpoints', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({
            url,
            options
        });
        if (url.endsWith('/zaoyoe/health')) {
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        service: 'zaoyoe-xianyu-bridge'
                    });
                }
            };
        }
        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    success: true,
                    orders: [
                        {
                            orderId: 'XY-SMOKE-1'
                        }
                    ]
                });
            }
        };
    };

    const summary = await runSmoke({
        baseUrl: 'http://127.0.0.1:8090',
        token: 'bridge-token',
        fetchImpl
    });

    assert.equal(summary.success, true);
    assert.equal(summary.steps.length, 2);
    assert.equal(summary.steps[1].order_count, 1);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer bridge-token');
});

test('xianyu bot bridge smoke can optionally test chat-send endpoint', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({
            url,
            options
        });
        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    success: true
                });
            }
        };
    };

    const summary = await runSmoke({
        baseUrl: '127.0.0.1:8090',
        sendTestMessage: true,
        fetchImpl
    });

    assert.equal(summary.success, true);
    assert.equal(summary.steps.length, 3);
    assert.equal(calls[2].url, 'http://127.0.0.1:8090/zaoyoe/chat/send');
    assert.equal(calls[2].options.method, 'POST');
    assert.match(calls[2].options.body, /ZAOYOE_BRIDGE_SMOKE_TEST_DO_NOT_SEND_TO_REAL_BUYER/);
});

test('xianyu bot bridge smoke CLI args accept base URL and token', () => {
    assert.deepEqual(parseSmokeArgs([
        '--base-url',
        'http://127.0.0.1:9000',
        '--token',
        'secret',
        '--send-test-message'
    ]), {
        baseUrl: 'http://127.0.0.1:9000',
        token: 'secret',
        sendTestMessage: true
    });
});
