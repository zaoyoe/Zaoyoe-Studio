const DEFAULT_DYNAMIC_AUTHORIZATION_POINTS = 1;

function normalizePoints(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 1000000) / 1000000);
}

function isAiWorkbenchBillingV2Enabled(env = process.env) {
    return String(env.AI_WORKBENCH_BILLING_V2_ENABLED || '').trim().toLowerCase() === 'true';
}

function getDynamicAuthorizationPoints(env = process.env) {
    return normalizePoints(
        env.AI_WORKBENCH_DYNAMIC_AUTHORIZATION_POINTS,
        DEFAULT_DYNAMIC_AUTHORIZATION_POINTS
    ) || DEFAULT_DYNAMIC_AUTHORIZATION_POINTS;
}

function buildBillingError(payload = {}, fallbackMessage = 'AI 工作台积分计费失败') {
    const error = new Error(String(payload.message || fallbackMessage));
    error.code = String(payload.code || 'ai_workbench_billing_failed');
    error.statusCode = error.code === 'insufficient_points' ? 402 : 503;
    error.billing = payload;
    return error;
}

function isAiWorkbenchBillingError(error = {}) {
    return Boolean(error?.billing)
        || String(error?.code || '').startsWith('ai_billing_')
        || String(error?.code || '').startsWith('ai_workbench_billing_')
        || String(error?.code || '') === 'insufficient_points';
}

async function callBillingRpc(supabase, name, params, fallbackMessage) {
    const { data, error } = await supabase.rpc(name, params);
    if (error) throw error;
    if (!data || data.success !== true) {
        throw buildBillingError(data || {}, fallbackMessage);
    }
    return data;
}

async function authorizeAiWorkbenchPoints({
    supabase,
    task,
    amount,
    reason = 'AI 工作台预授权'
}) {
    return callBillingRpc(supabase, 'fn_authorize_ai_workbench_points', {
        p_task_id: task.id,
        p_user_id: task.user_id,
        p_site: task.site || 'cn',
        p_amount: normalizePoints(amount, 0),
        p_reason: reason
    }, 'AI 工作台积分预授权失败');
}

async function settleAiWorkbenchPoints({
    supabase,
    task,
    amount,
    reason
}) {
    return callBillingRpc(supabase, 'fn_settle_ai_workbench_points', {
        p_task_id: task.id,
        p_user_id: task.user_id,
        p_site: task.site || 'cn',
        p_amount: normalizePoints(amount, 0),
        p_reason: reason
    }, 'AI 工作台积分结算失败');
}

async function releaseAiWorkbenchPoints({
    supabase,
    task,
    reason = 'AI 工作台预授权释放'
}) {
    return callBillingRpc(supabase, 'fn_release_ai_workbench_points', {
        p_task_id: task.id,
        p_user_id: task.user_id,
        p_site: task.site || 'cn',
        p_reason: reason
    }, 'AI 工作台积分预授权释放失败');
}

module.exports = {
    authorizeAiWorkbenchPoints,
    getDynamicAuthorizationPoints,
    isAiWorkbenchBillingV2Enabled,
    isAiWorkbenchBillingError,
    normalizePoints,
    releaseAiWorkbenchPoints,
    settleAiWorkbenchPoints
};
