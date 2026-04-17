const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildReadinessSummary,
    formatHumanReport,
    isMissingRpcCapabilityError,
    parseArgs
} = require('../scripts/payment-readiness-gate');

test('parseArgs captures readiness gate flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.production',
        '--fail-on-missing',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/);
    assert.equal(options.failOnMissing, true);
    assert.equal(options.json, true);
});

test('isMissingRpcCapabilityError detects missing function signatures from postgrest and postgres', () => {
    assert.equal(
        isMissingRpcCapabilityError({ code: 'PGRST202', message: 'Could not find the function public.fn_purchase_shop_item_with_discounts' }, 'fn_purchase_shop_item_with_discounts'),
        true
    );
    assert.equal(
        isMissingRpcCapabilityError({ code: '42883', message: 'function public.fn_deduct_points_admin_site_with_breakdown(uuid, integer, text, text, character varying) does not exist' }, 'fn_deduct_points_admin_site_with_breakdown'),
        true
    );
    assert.equal(
        isMissingRpcCapabilityError({ code: 'P0001', message: 'target_user_id is required' }, 'fn_deduct_points_admin_site_with_breakdown'),
        false
    );
});

test('buildReadinessSummary marks missing rpc capabilities as blocking', () => {
    const summary = buildReadinessSummary({
        envFile: '/tmp/server.env',
        projectHost: 'demo.supabase.co',
        capabilityResults: [
            {
                key: 'shop_multi_discount_purchase',
                rpc_name: 'fn_purchase_shop_item_with_discounts',
                label: '商城多券叠加购买 RPC',
                migration: '20260416_enable_multi_discount_shop_stacking.sql',
                available: false,
                outcome: 'missing',
                probe: {
                    code: 'PGRST202',
                    message: 'Could not find the function public.fn_purchase_shop_item_with_discounts'
                }
            },
            {
                key: 'admin_refund_reclaim',
                rpc_name: 'fn_deduct_points_admin_site_with_breakdown',
                label: '后台退款积分扣回 RPC',
                migration: '20260324_add_admin_refund_reclaim_rpc.sql',
                available: true,
                outcome: 'rejected_as_expected',
                probe: {
                    code: 'P0001',
                    message: 'target_user_id is required'
                }
            }
        ]
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.findings.some((finding) => finding.key === 'missing_shop_multi_discount_purchase'), true);
    assert.equal(summary.capabilities.admin_refund_reclaim.available, true);
});

test('formatHumanReport renders a readable PASS report', () => {
    const output = formatHumanReport({
        checked_at: '2026-04-16T00:00:00.000Z',
        project_host: 'demo.supabase.co',
        env_file: '/tmp/server.env',
        capabilities: {
            shop_multi_discount_purchase: {
                key: 'shop_multi_discount_purchase',
                rpc_name: 'fn_purchase_shop_item_with_discounts',
                label: '商城多券叠加购买 RPC',
                migration: '20260416_enable_multi_discount_shop_stacking.sql',
                available: true,
                outcome: 'returned_payload',
                probe: {
                    message: '缺少有效的用户身份'
                }
            }
        },
        findings: [],
        ok: true
    });

    assert.match(output, /Payment RPC Readiness Gate/);
    assert.match(output, /available: yes/);
    assert.match(output, /findings: none/);
    assert.match(output, /result: PASS/);
});
