const {
    getSupabaseAdmin,
    getSupabasePublicClient,
    sendJson
} = require('../_lib/admin');
const {
    buildPublicPaymentConfig,
    loadStoredPaymentConfigs
} = require('../_lib/payments/providers');
const {
    getMockPaymentRuntimeState
} = require('../_lib/payments/orders');

function getConfigSupabaseClient() {
    const hasServiceRole = Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_SERVICE_KEY
    );
    return hasServiceRole ? getSupabaseAdmin() : getSupabasePublicClient();
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const supabase = getConfigSupabaseClient();
        const { paymentChannels, rechargeOptions } = await loadStoredPaymentConfigs(supabase);
        const runtime = {
            mock_payment: getMockPaymentRuntimeState({
                requestHost: req.headers.host || req.headers.Host || '',
                env: process.env
            })
        };
        const publicConfig = buildPublicPaymentConfig(paymentChannels, rechargeOptions, runtime);

        return sendJson(res, 200, {
            success: true,
            config: publicConfig.paymentChannels,
            recharge_options: publicConfig.rechargeOptions,
            runtime
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '加载支付配置失败'
        });
    }
};
