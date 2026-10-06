#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { loadEnvFile } = require('./guest-shop-readiness');

const ENV_PATH = path.resolve(__dirname, '../server/.env');
const env = loadEnvFile(ENV_PATH);

if (!env.SUPABASE_URL || (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_KEY)) {
    console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY);

const TARGET_ORDERS = [
    {
        id: '6e4b2639-647a-4623-9f63-68c807089c21',
        orderNo: 'GS202609201453532449B02D9000A92',
        type: 'refund_reconcile',
        ref: 'MANUAL_RECONCILE_20261005_01'
    },
    {
        id: 'e5e2d85a-e7c9-47c3-9826-97e202185cb3',
        orderNo: 'GS202609210501514399E44A71DFB31',
        type: 'refund_reconcile',
        ref: 'MANUAL_RECONCILE_20261005_02'
    },
    {
        id: '91a97dbd-319c-48e4-8e69-8265f5143413',
        orderNo: 'GS20260922120128080254E4D17280D',
        type: 'refund_reconcile',
        ref: 'MANUAL_RECONCILE_20261005_03'
    },
    {
        id: '04aa1324-e53b-471e-9f4f-feeb4c359a12',
        orderNo: 'GS202610041139508841829659446E3',
        type: 'expire_unpaid_review'
    }
];

async function main() {
    const isApply = process.argv.includes('--apply');
    console.log(`=== 游客异常订单核销工具 [模式: ${isApply ? 'APPLY (执行写入)' : 'DRY-RUN (只读核验)'}] ===\n`);

    for (const item of TARGET_ORDERS) {
        const { data: order } = await supabase.from('guest_shop_orders')
            .select('id, order_no, total_amount, payment_status, fulfillment_status, refund_status, last_error_code')
            .eq('id', item.id)
            .single();

        const { data: payment } = await supabase.from('guest_shop_payment_orders')
            .select('id, status, provider, last_error_code')
            .eq('guest_order_id', item.id)
            .single();

        console.log(`[订单] ${item.orderNo} (${item.id})`);
        console.log(`  当前状态: 订单付款=${order?.payment_status}, 履约=${order?.fulfillment_status}, 退款=${order?.refund_status}, 支付单=${payment?.status}, 错误=${order?.last_error_code || payment?.last_error_code || '无'}`);

        if (isApply) {
            if (item.type === 'refund_reconcile') {
                const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_guest_shop_record_refund_result', {
                    p_order_id: item.id,
                    p_refund_status: 'succeeded',
                    p_provider_ref: item.ref,
                    p_error_code: null,
                    p_error_message: null
                });
                if (rpcErr) {
                    console.error(`  ❌ 退款核销失败:`, rpcErr);
                } else {
                    console.log(`  ✅ 退款核销成功: 已置为 succeeded/refunded (凭证: ${item.ref})`);
                }
            } else if (item.type === 'expire_unpaid_review') {
                const nowIso = new Date().toISOString();
                await supabase.from('guest_shop_payment_orders').update({
                    status: 'expired',
                    last_error_code: 'guest_order_expired',
                    last_error_message: 'order expired without payment; manual review completed',
                    updated_at: nowIso
                }).eq('guest_order_id', item.id).eq('status', 'review');

                await supabase.from('guest_shop_orders').update({
                    payment_status: 'expired',
                    last_error_code: null,
                    last_error_message: null,
                    updated_at: nowIso
                }).eq('id', item.id).eq('payment_status', 'review');

                console.log(`  ✅ 未付款订单关闭成功: 已置为 expired`);
            }
        } else {
            console.log(`  👉 计划动作: ${item.type === 'refund_reconcile' ? '调用 fn_guest_shop_record_refund_result 置为 succeeded' : '将未付款 review 状态置为 expired'}`);
        }
        console.log('');
    }

    if (!isApply) {
        console.log('提示: 若要真正执行核销，请带上 --apply 参数执行:');
        console.log('node scripts/reconcile-guest-alerts-cli.js --apply\n');
    }
}

main().catch(console.error);
