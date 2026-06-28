const test = require('node:test');
const assert = require('node:assert/strict');

const {
    deductPointsForService,
    isMissingDeductWithBreakdownRpc
} = require('../api/_lib/payments/rpc');

function createRpcSupabase(sequence = []) {
    const calls = [];
    return {
        calls,
        rpc(name, args = {}) {
            calls.push({ name, args });
            const next = sequence.shift() || { data: null, error: null };
            return Promise.resolve(next);
        }
    };
}

test('payment service deduction falls back only when decimal breakdown rpc is unavailable', async () => {
    const supabase = createRpcSupabase([
        {
            data: null,
            error: {
                code: '42883',
                message: 'function public.fn_deduct_points_admin_site_with_breakdown(uuid, numeric, text, text, character varying) does not exist'
            }
        },
        {
            data: { deducted: 0.16 },
            error: null
        }
    ]);

    const { data, error } = await deductPointsForService({
        supabase,
        userId: 'user-1',
        amount: 0.16,
        reason: 'AI 图片生成',
        referenceId: 'task-1',
        site: 'cn'
    });

    assert.equal(error, null);
    assert.equal(data.deducted, 0.16);
    assert.deepEqual(supabase.calls.map((call) => call.name), [
        'fn_deduct_points_admin_site_with_breakdown',
        'fn_deduct_points_admin_site'
    ]);
});

test('payment service deduction does not hide real breakdown rpc errors behind legacy fallback', async () => {
    const rpcError = {
        code: 'P0001',
        message: 'target_user_id is required'
    };
    const supabase = createRpcSupabase([
        {
            data: null,
            error: rpcError
        }
    ]);

    const { data, error } = await deductPointsForService({
        supabase,
        userId: '',
        amount: 0.16,
        reason: 'AI 图片生成',
        referenceId: 'task-1',
        site: 'cn'
    });

    assert.equal(data, null);
    assert.equal(error, rpcError);
    assert.deepEqual(supabase.calls.map((call) => call.name), [
        'fn_deduct_points_admin_site_with_breakdown'
    ]);
});

test('payment breakdown rpc capability detection keeps business errors visible', () => {
    assert.equal(isMissingDeductWithBreakdownRpc({ code: 'PGRST202', message: 'Could not find the function' }), true);
    assert.equal(isMissingDeductWithBreakdownRpc({ code: '22P02', message: 'invalid input syntax for type integer: "0.01"' }), true);
    assert.equal(isMissingDeductWithBreakdownRpc({ code: 'P0001', message: 'Amount must be positive' }), false);
});
