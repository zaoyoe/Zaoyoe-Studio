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
    assert.match(router, /ORDER_SYNC_IDLE_INTERVAL_SECONDS/);
    assert.match(router, /ORDER_SYNC_ACTIVE_INTERVAL_SECONDS/);
    assert.match(router, /ORDER_SYNC_ACTIVE_WINDOW_SECONDS/);
    assert.match(router, /ORDER_DETAIL_ENRICH_LIMIT_PER_SYNC/);
    assert.match(router, /ZAOYOE_ORDER_DETAIL_ENRICH_LIMIT_PER_SYNC", "0"/);
    assert.match(router, /ZAOYOE_ORDER_DETAIL_BACKGROUND_ENRICH_BATCH_SIZE", "0"/);
    assert.match(router, /ORDER_DETAIL_BACKGROUND_ENRICH_COOLDOWN_SECONDS/);
    assert.match(router, /order_sync_mode/);
    assert.match(router, /bridge_poll_mode: str = ""/);
    assert.match(router, /sanitize_text\(bridge_poll_mode, 20\)\.lower\(\) == "active"/);
    assert.match(router, /find_order_table/);
    assert.match(router, /chat_id_col/);
    assert.match(router, /sid_col/);
    assert.match(router, /"chatId"/);
});

test('xianyu-auto-reply-fix bridge isolates incomplete paid orders for background enrichment', () => {
    const router = fs.readFileSync(path.join(integrationDir, 'zaoyoe_bridge.py'), 'utf8');

    assert.match(router, /def should_enrich_candidate_detail\(db_manager: Any, cookie_id: str, candidate: Dict\[str, Any\]\) -> bool/);
    assert.match(router, /def save_history_detail_to_db\(db_manager: Any, cookie_id: str, candidate: Dict\[str, Any\], detail: Dict\[str, Any\]\) -> bool/);
    assert.match(router, /ORDER_DETAIL_BACKGROUND_ENRICH_BATCH_SIZE/);
    assert.match(router, /ORDER_REQUIRE_CHAT_ID_FOR_DELIVERY/);
    assert.match(router, /def get_order_enrichment_reasons\(conn: sqlite3\.Connection, order: Dict\[str, Any\]\) -> List\[str\]/);
    assert.match(router, /missing_chat_identity/);
    assert.match(router, /missing_multi_spec/);
    assert.match(router, /detail_reasons = \[reason for reason in reasons if reason == "missing_multi_spec"\]/);
    assert.match(router, /if not detail_reasons:/);
    assert.match(router, /_pending_enrichment_cooldown_until_by_key/);
    assert.match(router, /enqueue_pending_order_enrichment\(normalized, enrichment_reasons\)/);
    assert.match(router, /async def process_pending_order_enrichment_queue\(\) -> Dict\[str, Any\]/);
    assert.match(router, /fetcher\.fetch_order_detail\(order_id, force_refresh=True\)/);
    assert.match(router, /"pending_enrichment": summarize_pending_enrichment_queue\(\)/);
    assert.match(router, /"filter": _last_paid_order_filter_summary/);
    assert.match(router, /def enrich_order_with_local_chat_identity\(conn: sqlite3\.Connection, order: Dict\[str, Any\]\) -> Dict\[str, Any\]/);
    assert.match(router, /chat_identity_source/);
});

test('xianyu-auto-reply-fix bridge hides orders that already have local delivery evidence', () => {
    const router = fs.readFileSync(path.join(integrationDir, 'zaoyoe_bridge.py'), 'utf8');

    assert.match(router, /def has_local_delivery_evidence\(conn: sqlite3\.Connection, order_id: str\)/);
    assert.match(router, /FROM delivery_finalization_states/);
    assert.match(router, /status IN \('sent', 'finalized'\)/);
    assert.match(router, /FROM delivery_logs/);
    assert.match(router, /status = 'success'/);
    assert.match(router, /has_local_delivery_evidence\(conn, normalized\.get\("orderId", ""\)\)/);
});

test('xianyu-auto-reply-fix bridge sorts paid orders by platform payment time', () => {
    const router = fs.readFileSync(path.join(integrationDir, 'zaoyoe_bridge.py'), 'utf8');

    assert.match(router, /pick_column\(columns, \["platform_paid_at", "paid_at", "pay_time"/);
    assert.doesNotMatch(router, /pick_column\(columns, \["updated_at", "created_at", "create_time", "pay_time"\]\)/);
    assert.match(router, /ORDER BY datetime\(\{created_at_col\}\) DESC/);
});

test('xianyu-auto-reply-fix bridge records chat delivery state to prevent duplicate card sends', () => {
    const router = fs.readFileSync(path.join(integrationDir, 'zaoyoe_bridge.py'), 'utf8');

    assert.match(router, /def reserve_bridge_delivery_send\(data: Dict\[str, Any\]\) -> Dict\[str, Any\]/);
    assert.match(router, /def upsert_bridge_delivery_state\(data: Dict\[str, Any\], status: str, last_error: str = ""\) -> bool/);
    assert.match(router, /status IN \('sent', 'finalized'\)/);
    assert.match(router, /status = 'sending'/);
    assert.match(router, /reason": "delivery_already_recorded"/);
    assert.match(router, /upsert_bridge_delivery_state\(data, "failed"/);
    assert.match(router, /upsert_bridge_delivery_state\(data, "sent"\)/);
    assert.match(router, /async def finalize_bridge_delivery_after_send\(data: Dict\[str, Any\]\) -> Dict\[str, Any\]/);
    assert.match(router, /db_manager\.get_auto_confirm\(normalized_cookie_id\)/);
    assert.match(router, /live_instance\._finalize_delivery_after_send\(/);
    assert.match(router, /"bridge_finalization": finalization/);
});

test('xianyu-auto-reply-fix bridge sends usage instructions before card content in one delivery transaction', () => {
    const router = fs.readFileSync(path.join(integrationDir, 'zaoyoe_bridge.py'), 'utf8');

    assert.match(router, /usage_instructions: str = ""/);
    assert.match(router, /def build_delivery_chat_messages\(data: Dict\[str, Any\]\) -> List\[Dict\[str, Any\]\]/);
    assert.match(router, /"message_role": "usage_instructions"/);
    assert.match(router, /"message_role": "delivery_content"/);
    assert.match(router, /"message_count": len\(message_roles\)/);
    assert.match(router, /"has_usage_instructions": bool\(usage_instructions\)/);
    assert.match(router, /async def dispatch_delivery_chat_messages\(data: Dict\[str, Any\]\) -> Dict\[str, Any\]/);
    assert.match(router, /def load_custom_sender\(batch: bool = False\)/);
    assert.match(router, /batch_sender = getattr\(module, "send_messages", None\)/);
    assert.match(router, /async def dispatch_chat_messages\(messages: List\[Dict\[str, Any\]\]\) -> Dict\[str, Any\]/);
    assert.match(router, /sender = load_custom_sender\(batch=True\)/);
    assert.match(router, /result = await maybe_await\(sender\(messages\)\)/);
    assert.match(router, /result = await dispatch_chat_message\(message\)/);
    assert.match(router, /dispatch_result = await dispatch_chat_messages\(messages\)/);
    assert.match(router, /raise HTTPException\(\s*status_code=502,[\s\S]*Chat message send failed/);
    assert.match(router, /"message_count": len\(messages\)/);
    assert.match(router, /result = await dispatch_delivery_chat_messages\(data\)/);
    assert.match(router, /upsert_bridge_delivery_state\(data, "sent"\)[\s\S]*finalization = await finalize_bridge_delivery_after_send\(data\)/);
});

test('xianyu-auto-reply-fix sender binds bridge chat-send to live WebSocket sender', () => {
    const sender = fs.readFileSync(path.join(integrationDir, 'zaoyoe_sender_example.py'), 'utf8');

    assert.match(sender, /async def send_message/);
    assert.match(sender, /async def send_messages\(payloads: List\[Dict\[str, Any\]\]\) -> Dict\[str, Any\]/);
    assert.match(sender, /async def send_many_via_live_chat/);
    assert.match(sender, /async def send_many_via_temporary_chat/);
    assert.match(sender, /ZAOYOE_BRIDGE_MESSAGE_GAP_SECONDS/);
    assert.match(sender, /MESSAGE_GAP_SECONDS = read_env_float\("ZAOYOE_BRIDGE_MESSAGE_GAP_SECONDS", 0\.2/);
    assert.match(sender, /resolve_live_instance/);
    assert.match(sender, /send_msg\(live_instance\.ws, chat_id, buyer_id, content\)/);
    assert.match(sender, /ZAOYOE_BRIDGE_LIVE_SEND_SETTLE_SECONDS/);
    assert.match(sender, /ZAOYOE_BRIDGE_TEMP_SEND_SETTLE_SECONDS/);
    assert.match(sender, /LIVE_SEND_SETTLE_SECONDS = read_env_float\("ZAOYOE_BRIDGE_LIVE_SEND_SETTLE_SECONDS", 0\.8/);
    assert.match(sender, /TEMP_SEND_SETTLE_SECONDS = read_env_float\("ZAOYOE_BRIDGE_TEMP_SEND_SETTLE_SECONDS", 1\.0/);
    assert.match(sender, /await sleep_after_live_send\(\)/);
    assert.match(sender, /await sleep_between_messages\(index, len\(contents\)\)/);
    assert.match(sender, /wait_for_send_settle\(websocket, timeout=TEMP_SEND_SETTLE_SECONDS\)/);
    assert.doesNotMatch(sender, /asyncio\.sleep\(2\.5\)/);
    assert.doesNotMatch(sender, /wait_for_send_settle\(websocket, timeout=3\.0\)/);
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
