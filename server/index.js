/**
 * Puppeteer Verification Server
 * Automates batch.1key.me for Gemini student verification
 * Supports Server-Sent Events (SSE) for real-time status updates
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

// SSE Verify endpoint - streams real-time status updates
app.get('/api/verify-stream', async (req, res) => {
    const { verificationId, userId } = req.query;

    // Get allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8000', 'https://zaoyoe.com'];
    const origin = req.headers.origin;

    // Set CORS headers for SSE (must be set before SSE headers)
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://zaoyoe.com');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Helper to send SSE event
    const sendEvent = (type, data) => {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (!verificationId) {
        sendEvent('error', { message: '请提供验证ID' });
        return res.end();
    }

    if (!userId) {
        sendEvent('error', { message: '请先登录' });
        return res.end();
    }

    // Heartbeat interval - declared outside try block for proper scoping
    let heartbeatInterval = null;

    try {
        sendEvent('status', { status: 'init', message: '⚡ 正在初始化验证服务...' });

        // Get verify config
        const { data: configData } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'verify')
            .single();

        const config = configData?.config_value || {};
        const pricePerVerify = config.price_per_verify || 2;
        const batchApiKey = config.batch_api_key || process.env.BATCH_API_KEY || 'cdk_=_vgb6#kJqYeu-mzD5%@6dQ8vVc4OB@-';

        // Debug: Log API key info (masked for security)
        console.log(`[Verify] API Key info: length=${batchApiKey?.length}, first5=${batchApiKey?.substring(0, 5)}, last5=${batchApiKey?.substring(batchApiKey.length - 5)}`);
        console.log(`[Verify] API Key from config:`, !!config.batch_api_key, 'from env:', !!process.env.BATCH_API_KEY);

        if (!batchApiKey) {
            sendEvent('error', { message: '验证服务未配置' });
            return res.end();
        }


        // Check balance
        const { data: balanceData, error: balanceError } = await supabase
            .rpc('fn_get_user_balance', { p_user_id: userId })
            .single();

        console.log(`[Verify] Balance check for ${userId}:`, { balanceData, balanceError });

        const currentBalance = balanceData?.total_balance || 0;

        if (currentBalance < pricePerVerify) {
            sendEvent('error', {
                message: `积分不足，需要 ${pricePerVerify} 积分，当前余额 ${currentBalance}`
            });
            return res.end();
        }

        sendEvent('status', { status: 'balance_ok', message: `💰 余额充足 (${currentBalance} 积分)` });

        console.log(`[Verify] Starting verification for ${verificationId}`);

        // Start heartbeat to keep SSE connection alive (Railway has ~100s timeout)
        let heartbeatCount = 0;
        heartbeatInterval = setInterval(() => {
            heartbeatCount++;
            // Send comment as heartbeat (SSE allows : comments that are ignored by client)
            res.write(`: heartbeat ${heartbeatCount}\n\n`);
        }, 20000); // Every 20 seconds

        // Progress callback for real-time updates
        const onProgress = (status, message, pageContent = null, metadata = null) => {
            sendEvent('status', { status, message });
            if (pageContent) {
                // Only send first 500 chars of page content for debugging
                sendEvent('debug', { content: pageContent.substring(0, 500) });
            }
            // Send quota information if present
            if (metadata && metadata.quota !== undefined) {
                sendEvent('quota', { remaining: metadata.quota });
            }
        };

        // Run Puppeteer automation with progress callback
        const result = await verifyWithPuppeteer(batchApiKey, verificationId, onProgress);

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
            } else {
                sendEvent('status', { status: 'deducted', message: `💳 已扣除 ${pricePerVerify} 积分` });
            }
        }

        // Log verification attempt
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

        // Send final result
        sendEvent('result', {
            success: result.success,
            message: result.message,
            pointsDeducted: result.success ? pricePerVerify : 0
        });

    } catch (error) {
        console.error('[Verify] Error:', error);
        sendEvent('error', { message: error.message || '验证服务暂时不可用' });
    } finally {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        res.end();
    }
});

// Original POST endpoint (kept for compatibility)
app.post('/api/verify', async (req, res) => {
    const { verificationId, userId } = req.body;

    if (!verificationId) {
        return res.status(400).json({ success: false, message: '请提供验证ID' });
    }

    if (!userId) {
        return res.status(400).json({ success: false, message: '请先登录' });
    }

    try {
        const { data: configData } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'verify')
            .single();

        const config = configData?.config_value || {};
        const pricePerVerify = config.price_per_verify || 2;
        const batchApiKey = config.batch_api_key || process.env.BATCH_API_KEY || 'cdk_=_vgb6#kJqYeu-mzD5%@6dQ8vVc4OB@-';

        if (!batchApiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置' });
        }

        const { data: balanceData, error: balanceError } = await supabase
            .rpc('fn_get_user_balance', { p_user_id: userId })
            .single();

        console.log(`[Verify] Balance check for ${userId}:`, { balanceData, balanceError });

        const currentBalance = balanceData?.total_balance || 0;

        if (currentBalance < pricePerVerify) {
            return res.status(400).json({
                success: false,
                message: `积分不足，需要 ${pricePerVerify} 积分，当前余额 ${currentBalance}`
            });
        }

        console.log(`[Verify] Starting verification for ${verificationId}`);

        const result = await verifyWithPuppeteer(batchApiKey, verificationId);

        console.log(`[Verify] Result:`, result);

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
