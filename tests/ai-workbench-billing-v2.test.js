const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    authorizeAiWorkbenchPoints,
    getDynamicAuthorizationPoints,
    isAiWorkbenchBillingV2Enabled,
    releaseAiWorkbenchPoints,
    settleAiWorkbenchPoints
} = require('../api/_lib/payments/ai-workbench-billing');
const {
    getAiWorkbenchLedgerReason
} = require('../server/api-handlers/_ai-image-runtime');

const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260715_ai_workbench_billing_v2.sql');
const walletHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/wallet.js');
const pointsServicePath = path.resolve(__dirname, '../js/services/PointsService.js');
const walletModalPath = path.resolve(__dirname, '../js/components/WalletModal.js');
const walletStylesPath = path.resolve(__dirname, '../css/wallet.css');
const walletZhPath = path.resolve(__dirname, '../lang/zh.json');
const walletEnPath = path.resolve(__dirname, '../lang/en.json');
const aiImageHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/ai-image.js');

function createRpcStub(responses = {}) {
    const calls = [];
    return {
        calls,
        client: {
            async rpc(name, params) {
                calls.push({ name, params });
                return responses[name] || { data: { success: true }, error: null };
            }
        }
    };
}

test('AI workbench billing V2 is opt-in and keeps a configurable dynamic authorization', () => {
    assert.equal(isAiWorkbenchBillingV2Enabled({}), false);
    assert.equal(isAiWorkbenchBillingV2Enabled({ AI_WORKBENCH_BILLING_V2_ENABLED: 'true' }), true);
    assert.equal(getDynamicAuthorizationPoints({}), 1);
    assert.equal(getDynamicAuthorizationPoints({ AI_WORKBENCH_DYNAMIC_AUTHORIZATION_POINTS: '0.5000014' }), 0.500001);
});

test('AI workbench billing RPC wrappers preserve six-decimal amounts and task scope', async () => {
    const task = {
        id: '00000000-0000-4000-8000-000000000001',
        user_id: '00000000-0000-4000-8000-000000000002',
        site: 'cn'
    };
    const rpcStub = createRpcStub({
        fn_authorize_ai_workbench_points: {
            data: { success: true, authorized: 0.000233 },
            error: null
        },
        fn_settle_ai_workbench_points: {
            data: { success: true, deducted: 0.000233 },
            error: null
        },
        fn_release_ai_workbench_points: {
            data: { success: true, released: 0.000233 },
            error: null
        }
    });

    await authorizeAiWorkbenchPoints({
        supabase: rpcStub.client,
        task,
        amount: 0.0002334
    });
    await settleAiWorkbenchPoints({
        supabase: rpcStub.client,
        task,
        amount: 0.0002334,
        reason: 'AI 文本对话'
    });
    await releaseAiWorkbenchPoints({
        supabase: rpcStub.client,
        task
    });

    assert.deepEqual(
        rpcStub.calls.map((call) => call.name),
        [
            'fn_authorize_ai_workbench_points',
            'fn_settle_ai_workbench_points',
            'fn_release_ai_workbench_points'
        ]
    );
    assert.equal(rpcStub.calls[0].params.p_amount, 0.000233);
    assert.equal(rpcStub.calls[1].params.p_amount, 0.000233);
    assert.equal(rpcStub.calls[0].params.p_task_id, task.id);
    assert.equal(rpcStub.calls[0].params.p_user_id, task.user_id);
});

test('AI workbench authorization exposes insufficient balance as a payment error', async () => {
    const rpcStub = createRpcStub({
        fn_authorize_ai_workbench_points: {
            data: {
                success: false,
                code: 'insufficient_points',
                message: '积分余额不足',
                required: 5,
                balance: 1
            },
            error: null
        }
    });

    await assert.rejects(
        authorizeAiWorkbenchPoints({
            supabase: rpcStub.client,
            task: {
                id: '00000000-0000-4000-8000-000000000001',
                user_id: '00000000-0000-4000-8000-000000000002',
                site: 'cn'
            },
            amount: 5
        }),
        (error) => {
            assert.equal(error.code, 'insufficient_points');
            assert.equal(error.statusCode, 402);
            assert.equal(error.billing.balance, 1);
            return true;
        }
    );
});

test('AI workbench ledger reasons distinguish text, image, video, and reverse tasks', () => {
    assert.equal(getAiWorkbenchLedgerReason({ mode: 'chat' }), 'AI 文本对话');
    assert.equal(getAiWorkbenchLedgerReason({ mode: 'video' }), 'AI 视频生成');
    assert.equal(getAiWorkbenchLedgerReason({ mode: 'reverse' }), 'AI 提示词反推');
    assert.equal(getAiWorkbenchLedgerReason({ mode: 'text' }), 'AI 图片生成');
    assert.equal(getAiWorkbenchLedgerReason({ mode: 'image' }), 'AI 图片生成');
});

test('AI workbench billing migration enforces exact authorization and idempotent settlement', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.ai_workbench_point_reservations/);
    assert.match(migration, /task_id UUID NOT NULL UNIQUE/);
    assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('ai-workbench:' \|\| p_task_id::TEXT, 0\)\)/);
    assert.match(migration, /ROUND\(current_bonus \+ current_paid, 6\) < normalized_amount/);
    assert.match(migration, /'code', 'insufficient_points'/);
    assert.match(migration, /VALUES \(p_user_id, -normalized_amount, p_reason, p_task_id::TEXT, normalized_site, FALSE\)/);
    assert.match(migration, /SET amount = -normalized_amount,[\s\S]*is_visible = normalized_amount > 0/);
    assert.match(migration, /SET amount = 0,[\s\S]*is_visible = FALSE/);
    assert.match(migration, /IF reservation\.status = 'settled'/);
    assert.match(migration, /IF reservation\.status = 'released'/);
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        assert.match(
            migration,
            new RegExp(`REVOKE ALL ON FUNCTION public\\.fn_authorize_ai_workbench_points\\([^;]+FROM ${role};`)
        );
        assert.match(
            migration,
            new RegExp(`REVOKE ALL ON FUNCTION public\\.fn_settle_ai_workbench_points\\([^;]+FROM ${role};`)
        );
        assert.match(
            migration,
            new RegExp(`REVOKE ALL ON FUNCTION public\\.fn_release_ai_workbench_points\\([^;]+FROM ${role};`)
        );
    }
    assert.doesNotMatch(migration, /actual_deducted\s*:=\s*ROUND\(LEAST/);
});

test('wallet and workbench contracts preserve micro-point precision end to end', () => {
    const walletHandler = fs.readFileSync(walletHandlerPath, 'utf8');
    const pointsService = fs.readFileSync(pointsServicePath, 'utf8');
    const walletModal = fs.readFileSync(walletModalPath, 'utf8');
    const aiImageHandler = fs.readFileSync(aiImageHandlerPath, 'utf8');

    for (const source of [walletHandler, pointsService, walletModal]) {
        assert.match(source, /Math\.round\(parsed \* 1000000\) \/ 1000000/);
    }
    assert.match(walletModal, /maximumFractionDigits: isMicroAmount \? 6 : 2/);
    assert.match(walletModal, /const signedAmount = order\.isShopOrder[\s\S]*this\.normalizePointValue\(order\.amount \?\? order\.total_price \?\? 0\)/);
    assert.match(walletModal, /if \(signedAmount >= 0\)/);
    assert.match(aiImageHandler, /status: 'authorizing'/);
    assert.match(aiImageHandler, /authorizeConfiguredAiWorkbenchTask\(supabase, data/);
    assert.match(aiImageHandler, /releaseAiWorkbenchPoints\(\{/);
});

test('wallet balance hover exposes the authoritative six-decimal value', () => {
    const walletModal = fs.readFileSync(walletModalPath, 'utf8');
    const walletStyles = fs.readFileSync(walletStylesPath, 'utf8');
    const walletZh = JSON.parse(fs.readFileSync(walletZhPath, 'utf8'));
    const walletEn = JSON.parse(fs.readFileSync(walletEnPath, 'utf8'));

    assert.match(walletModal, /formatExactPoints\(value\)[\s\S]*minimumFractionDigits: 6,[\s\S]*maximumFractionDigits: 6/);
    assert.match(walletModal, /applyExactPointsTooltip\(element, value, translationKey, fallback\)/);
    assert.match(walletModal, /element\.title = tooltip/);
    assert.match(walletModal, /element\.dataset\.exactPoints = tooltip/);
    assert.match(walletModal, /element\.setAttribute\('aria-label', tooltip\)/);
    assert.ok((walletModal.match(/applyExactPointsTooltip\(/g) || []).length >= 6);
    assert.match(walletStyles, /#wallet-total\[data-exact-points\],[\s\S]*#wallet-paid\[data-exact-points\],[\s\S]*#wallet-bonus\[data-exact-points\][\s\S]*cursor: help/);
    assert.equal(walletZh.wallet.exactBalanceTooltip, '精确余额：{points} 积分');
    assert.equal(walletEn.wallet.exactBalanceTooltip, 'Exact balance: {points} points');
});
