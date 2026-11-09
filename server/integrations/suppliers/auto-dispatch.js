'use strict';

const {
    actionContext,
    actionQuote,
    actionConfirm
} = require('../../api-handlers/admin/shop/supplier-manual-purchase');

const DEFAULT_THRESHOLD_CNY = 10.00;
const POLICY_CONFIG_KEY = 'supplier_auto_dispatch_policy';
const SYSTEM_BOT_ADMIN_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Reads the supplier auto-dispatch policy from system_config.
 * Defaults to intelligent threshold mode at ¥10.00 CNY.
 */
async function getSupplierDispatchPolicy(supabase) {
    if (!supabase || typeof supabase.from !== 'function') {
        return {
            enabled: true,
            mode: 'threshold',
            thresholdCny: DEFAULT_THRESHOLD_CNY
        };
    }

    try {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', POLICY_CONFIG_KEY)
            .maybeSingle();

        if (error || !data?.config_value) {
            return {
                enabled: true,
                mode: 'threshold',
                thresholdCny: DEFAULT_THRESHOLD_CNY
            };
        }

        const val = data.config_value;
        const mode = ['threshold', 'manual_all', 'auto_all'].includes(val.mode) ? val.mode : 'threshold';
        const num = Number(val.thresholdCny);
        const thresholdCny = Number.isFinite(num) && num >= 0 ? num : DEFAULT_THRESHOLD_CNY;

        return {
            enabled: val.enabled !== false,
            mode,
            thresholdCny,
            updatedAt: val.updatedAt || null
        };
    } catch (_) {
        return {
            enabled: true,
            mode: 'threshold',
            thresholdCny: DEFAULT_THRESHOLD_CNY
        };
    }
}

/**
 * Saves the supplier auto-dispatch policy to system_config.
 */
async function saveSupplierDispatchPolicy(supabase, { mode = 'threshold', thresholdCny = DEFAULT_THRESHOLD_CNY, enabled = true } = {}) {
    if (!supabase || typeof supabase.from !== 'function') {
        throw new Error('Database client unavailable');
    }

    const safeMode = ['threshold', 'manual_all', 'auto_all'].includes(mode) ? mode : 'threshold';
    const num = Number(thresholdCny);
    if (!Number.isFinite(num) || num < 0) {
        throw new Error('Invalid threshold amount');
    }
    const safeThreshold = Math.round(num * 100) / 100;

    const payload = {
        enabled: enabled !== false,
        mode: safeMode,
        thresholdCny: safeThreshold,
        updatedAt: new Date().toISOString()
    };

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: POLICY_CONFIG_KEY,
            config_value: payload,
            updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });

    if (error) {
        throw error;
    }

    return payload;
}

/**
 * Evaluates whether an order should route to Link B (auto dispatch) or Link A (manual review).
 *
 * Rules:
 * - mode === 'manual_all': always Link A (false)
 * - mode === 'auto_all': always Link B (true)
 * - mode === 'threshold':
 *     orderAmountCny <= thresholdCny -> Link B (true)
 *     orderAmountCny >  thresholdCny -> Link A (false)
 */
function shouldAutoDispatch(policy, orderAmountCny) {
    if (!policy || policy.enabled === false) {
        return false;
    }
    if (policy.mode === 'manual_all') {
        return false;
    }
    if (policy.mode === 'auto_all') {
        return true;
    }
    const amount = Number(orderAmountCny);
    if (!Number.isFinite(amount) || amount < 0) {
        return false;
    }
    const threshold = Number(policy.thresholdCny);
    const safeThreshold = Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_THRESHOLD_CNY;

    return amount <= safeThreshold;
}

/**
 * Resolves an active admin user ID for automated auditing.
 */
async function resolveSystemAdminId(supabase) {
    try {
        const { data } = await supabase
            .from('admin_roles')
            .select('user_id')
            .limit(1)
            .maybeSingle();
        if (data?.user_id) return data.user_id;
    } catch (_) {}
    try {
        if (typeof supabase?.auth?.admin?.listUsers === 'function') {
            const { data } = await supabase.auth.admin.listUsers({ perPage: 1 });
            if (data?.users?.[0]?.id) return data.users[0].id;
        }
    } catch (_) {}
    return SYSTEM_BOT_ADMIN_ID;
}

/**
 * Attempts automated procurement execution (Link B) for an eligible supplier_v2 order.
 */
async function tryAutoDispatchSupplierOrder({ supabase, order, env = process.env }) {
    if (!supabase || !order || order.fulfillment_source !== 'supplier_v2') {
        return { status: 'skipped', reason: 'not_supplier_v2' };
    }
    if (order.payment_status !== 'confirmed') {
        return { status: 'skipped', reason: 'payment_not_confirmed' };
    }
    if (order.fulfillment_status === 'delivered') {
        return { status: 'skipped', reason: 'already_delivered' };
    }

    const policy = await getSupplierDispatchPolicy(supabase);
    const orderAmount = Number(order.total_amount ?? order.unit_amount ?? order.price_paid ?? 0);

    const isAutoEligible = shouldAutoDispatch(policy, orderAmount);
    if (!isAutoEligible) {
        return {
            status: 'skipped',
            reason: 'route_a_manual_review_required',
            mode: policy.mode,
            thresholdCny: policy.thresholdCny,
            orderAmountCny: orderAmount
        };
    }

    // Safety Gate: Special product types (manual delivery, etc.)
    // must never auto-dispatch to Link B without human review.
    if (order.manual_delivery === true) {
        return {
            status: 'skipped',
            reason: 'route_a_manual_review_required',
            detail: '商品为人工发货或直充，自动分流至链路 A 待管理员审核'
        };
    }

    // Find the fulfillment unit linked to this order
    let unitId = null;
    const { data: unit, error: unitError } = await supabase
        .from('shop_supplier_fulfillment_units')
        .select('id, product_id, sku_id, mapping_id, quantity')
        .or(`guest_order_id.eq.${order.id},shop_order_id.eq.${order.id}`)
        .limit(1)
        .maybeSingle();

    if (unitError || !unit?.id) {
        return { status: 'skipped', reason: 'unit_not_found' };
    }
    unitId = unit.id;
    const orderQuantity = Number(order.quantity || unit.quantity || 1);
    if (unit.mapping_id) {
        const { data: mapping } = await supabase
            .from('shop_supplier_product_mappings')
            .select('import_snapshot')
            .eq('id', unit.mapping_id)
            .maybeSingle();
        const minQty = Number(mapping?.import_snapshot?.minimumQuantity);
        if (Number.isSafeInteger(minQty) && minQty > orderQuantity) {
            return {
                status: 'skipped',
                reason: 'route_a_manual_review_required',
                detail: `未达到上游起售数量（需 ${minQty} 件，当前 ${orderQuantity} 件），分流至链路 A 人工审核`
            };
        }
    }
    if (unit.product_id) {
        const { data: product } = await supabase
            .from('shop_products')
            .select('manual_delivery, delivery_type')
            .eq('id', unit.product_id)
            .maybeSingle();
        if (product?.manual_delivery === true || (product?.delivery_type && product.delivery_type !== 'KEY')) {
            return {
                status: 'skipped',
                reason: 'route_a_manual_review_required',
                detail: '商品为人工发货或直充，自动分流至链路 A 待管理员审核'
            };
        }
    }

    // Find the procurement intent linked to this unit
    const { data: intent, error: intentError } = await supabase
        .from('shop_supplier_procurement_intents')
        .select('id, status')
        .eq('unit_id', unitId)
        .limit(1)
        .maybeSingle();

    if (intentError || !intent?.id) {
        return { status: 'skipped', reason: 'intent_not_found' };
    }

    const intentId = intent.id;
    const adminId = await resolveSystemAdminId(supabase);

    try {
        // Step 1: Quote
        const quoteResult = await actionQuote(supabase, { intentId, adminId });
        if (quoteResult.status !== 'quoted' || quoteResult.overCeiling) {
            return {
                status: 'blocked',
                reason: quoteResult.reason || (quoteResult.overCeiling ? 'cost_ceiling_exceeded' : 'quote_failed')
            };
        }

        // Step 2: Confirm & Settle
        const confirmResult = await actionConfirm(supabase, {
            purchaseId: quoteResult.purchaseId,
            quotedAmountCny: quoteResult.quotedAmountCny,
            adminId
        });

        if (confirmResult.status === 'delivered') {
            return {
                status: 'delivered',
                autoDispatched: true,
                supplierOrderNo: confirmResult.supplierOrderNo,
                actualAmountCny: confirmResult.actualAmountCny
            };
        }

        return {
            status: confirmResult.status || 'unknown',
            reason: confirmResult.reason || 'confirm_incomplete',
            supplierOrderNo: confirmResult.supplierOrderNo
        };
    } catch (error) {
        return {
            status: 'failed',
            reason: error.code || error.message || 'auto_dispatch_error'
        };
    }
}

module.exports = {
    DEFAULT_THRESHOLD_CNY,
    POLICY_CONFIG_KEY,
    getSupplierDispatchPolicy,
    saveSupplierDispatchPolicy,
    shouldAutoDispatch,
    tryAutoDispatchSupplierOrder
};
