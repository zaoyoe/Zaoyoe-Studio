-- ============================================================================
-- 游客订单异常告警核销脚本 (Reconcile Guest Shop Alert Orders)
-- 日期: 2026-10-05
-- 目标: 
--   1. 将 3 笔因网关余额不足或拒绝导致退款悬挂 (manual_review) 的订单推进为退款已核验终态 (succeeded/refunded)
--   2. 将 1 笔因创建超时且买家未付款的 NOWPayments 订单推进为超时失效终态 (expired)
-- 执行方式: 由管理员在 Supabase Dashboard -> SQL Editor 中整份执行。
-- ============================================================================

BEGIN;

-- 允许在 SQL Editor 中模拟 service_role 调用系统安全 RPC
SET LOCAL "request.jwt.claim.role" = 'service_role';

-- ----------------------------------------------------------------------------
-- 1. 核销 3 笔退款悬挂订单 (调用系统原生原子存储过程 fn_guest_shop_record_refund_result)
-- ----------------------------------------------------------------------------

-- 订单 1: GS202609201453532449B02D9000A92 (0.02元，原因: ZPay余额不足)
SELECT * FROM public.fn_guest_shop_record_refund_result(
    '6e4b2639-647a-4623-9f63-68c807089c21'::uuid,
    'succeeded',
    'MANUAL_RECONCILE_20261005_01',
    NULL,
    NULL
);

-- 订单 2: GS202609210501514399E44A71DFB31 (0.02元，原因: 网关拒绝)
SELECT * FROM public.fn_guest_shop_record_refund_result(
    'e5e2d85a-e7c9-47c3-9826-97e202185cb3'::uuid,
    'succeeded',
    'MANUAL_RECONCILE_20261005_02',
    NULL,
    NULL
);

-- 订单 3: GS20260922120128080254E4D17280D (9.09元，原因: ZPay余额不足)
SELECT * FROM public.fn_guest_shop_record_refund_result(
    '91a97dbd-319c-48e4-8e69-8265f5143413'::uuid,
    'succeeded',
    'MANUAL_RECONCILE_20261005_03',
    NULL,
    NULL
);

-- ----------------------------------------------------------------------------
-- 2. 核销 1 笔 NOWPayments 未付款弃单 (GS202610041139508841829659446E3，0.11元)
--    库存预占已于 10/04 12:09:50 自动释放，置为 expired 终态以移出人工复核队列
-- ----------------------------------------------------------------------------

UPDATE public.guest_shop_payment_orders
SET status = 'expired',
    last_error_code = 'guest_order_expired',
    last_error_message = 'order expired without payment; manual review completed',
    updated_at = clock_timestamp()
WHERE guest_order_id = '04aa1324-e53b-471e-9f4f-feeb4c359a12'::uuid
  AND status = 'review';

UPDATE public.guest_shop_orders
SET payment_status = 'expired',
    last_error_code = NULL,
    last_error_message = NULL,
    updated_at = clock_timestamp()
WHERE id = '04aa1324-e53b-471e-9f4f-feeb4c359a12'::uuid
  AND payment_status = 'review';

-- ----------------------------------------------------------------------------
-- 3. 回读核验 (必须确认 4 笔订单均已脱离 review / manual_review)
-- ----------------------------------------------------------------------------
SELECT 
    o.order_no,
    o.total_amount,
    o.payment_status AS order_payment_status,
    p.status AS payment_row_status,
    o.fulfillment_status,
    o.refund_status,
    o.last_error_code
FROM public.guest_shop_orders o
LEFT JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
WHERE o.id IN (
    '6e4b2639-647a-4623-9f63-68c807089c21'::uuid,
    'e5e2d85a-e7c9-47c3-9826-97e202185cb3'::uuid,
    '91a97dbd-319c-48e4-8e69-8265f5143413'::uuid,
    '04aa1324-e53b-471e-9f4f-feeb4c359a12'::uuid
);

COMMIT;
