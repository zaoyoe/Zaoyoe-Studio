/**
 * Puppeteer Verification Server
 * Automates batch.1key.me for Gemini student verification
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { verifyWithPuppeteer } = require('./puppeteer-verify');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8000', 'https://zaoyoe.com'],
    credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Verify endpoint
app.post('/api/verify', async (req, res) => {
    const { verificationId, userId } = req.body;

    if (!verificationId) {
        return res.status(400).json({ success: false, message: '请提供验证ID' });
    }

    if (!userId) {
        return res.status(400).json({ success: false, message: '请先登录' });
    }

    try {
        // Get verify config from Supabase
        const { data: configData } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'verify')
            .single();

        const config = configData?.config_value || {};
        const pricePerVerify = config.price_per_verify || 2;
        // Fallback API key if not configured in system_config
        const batchApiKey = config.batch_api_key || process.env.BATCH_API_KEY || 'cdk_=_vgb6#kJqYeu-mzD5%@6dQ8vVc4OB@-';

        if (!batchApiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置' });
        }

        // Check user balance via RPC (bypasses RLS)
        const { data: balanceData, error: balanceError } = await supabase
            .rpc('fn_get_user_balance', { p_user_id: userId })
            .single();

        // Log for debugging
        console.log(`[Verify] Balance check for ${userId}:`, { balanceData, balanceError });

        const currentBalance = balanceData?.total_balance || 0;

        if (currentBalance < pricePerVerify) {
            return res.status(400).json({
                success: false,
                message: `积分不足，需要 ${pricePerVerify} 积分，当前余额 ${currentBalance}`
            });
        }

        console.log(`[Verify] Starting verification for ${verificationId}`);

        // Run Puppeteer automation
        const result = await verifyWithPuppeteer(batchApiKey, verificationId);

        console.log(`[Verify] Result:`, result);

        // Deduct points on success
        if (result.success) {
            const { error: deductError } = await supabase.rpc('fn_deduct_points', {
                p_target_user_id: userId,
                p_amount: pricePerVerify,
                p_reason: 'Gemini验证服务'
            });

            if (deductError) {
                console.error('[Verify] Failed to deduct points:', deductError);
            }
        }

        // Log verification attempt (non-blocking)
        try {
            await supabase.from('verification_logs').insert({
                user_id: userId,
                verification_id: verificationId,
                status: result.success ? 'success' : 'failed',
                message: result.message,
                points_deducted: result.success ? pricePerVerify : 0
            });
        } catch (logError) {
            console.warn('Failed to log verification:', logError);
        }

        return res.json({
            success: result.success,
            message: result.message,
            pointsDeducted: result.success ? pricePerVerify : 0
        });

    } catch (error) {
        console.error('[Verify] Error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '验证服务暂时不可用'
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Verify server running on port ${PORT}`);
});
