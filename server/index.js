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

    // Support batch: triple-pipe separated IDs (||| is safe separator since it's not valid in URLs)
    let verificationIds = [];
    if (verificationId) {
        if (verificationId.includes('|||')) {
            verificationIds = verificationId.split('|||').map(id => id.trim()).filter(id => id);
        } else {
            // Fallback: single ID (for backwards compat)
            verificationIds = [verificationId.trim()].filter(id => id);
        }
    }
    const batchSize = verificationIds.length;

    if (batchSize === 0) {
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
        sendEvent('status', { status: 'init', message: `⚡ 正在初始化验证服务 (${batchSize} 个链接)...` });

        // Get verify config
        const { data: configData } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'verify_settings')
            .single();

        const config = configData?.config_value || {};
        const pricePerVerify = config.price_per_verify || 2;
        const totalPriceNeeded = pricePerVerify * batchSize;
        const batchApiKey = config.batch_api_key || process.env.BATCH_API_KEY || 'cdk_=_vgb6#kJqYeu-mzD5%@6dQ8vVc4OB@-';

        // Debug: Log API key info (masked for security)
        console.log(`[Verify] API Key info: length=${batchApiKey?.length}, first5=${batchApiKey?.substring(0, 5)}, last5=${batchApiKey?.substring(batchApiKey.length - 5)}`);
        console.log(`[Verify] Batch size: ${batchSize}, Price per verify: ${pricePerVerify}, Total needed: ${totalPriceNeeded}`);

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

        if (currentBalance < totalPriceNeeded) {
            sendEvent('error', {
                message: `积分不足，需要 ${totalPriceNeeded} 积分 (${batchSize}个×${pricePerVerify})，当前余额 ${currentBalance}`
            });
            return res.end();
        }

        sendEvent('status', { status: 'balance_ok', message: `💰 余额充足 (${currentBalance} 积分，需要 ${totalPriceNeeded})` });

        // Debug: Log exact IDs being processed
        console.log(`[Verify] Verification IDs received (${batchSize}):`);
        verificationIds.forEach((id, i) => {
            console.log(`  [${i}]: ${id.substring(0, 80)}${id.length > 80 ? '...' : ''}`);
        });

        console.log(`[Verify] Starting batch verification for ${batchSize} IDs`);

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

        // Create AbortController for cancellation
        const controller = new AbortController();
        req.on('close', () => {
            console.log('[Verify] Client connection closed, aborting verification...');
            controller.abort();
        });

        // Run Puppeteer automation with progress callback (pass array of IDs)
        const result = await verifyWithPuppeteer(batchApiKey, verificationIds, onProgress, controller.signal);

        // Log result summary
        console.log(`[Verify] Batch result: ${result.success ? 'Success' : 'Failed'}, Message: ${result.message}`);
        console.log(`[Verify] Stats: Success=${result.stats?.success}, Failed=${result.stats?.failed}, Total=${result.stats?.total}`);

        // Get batch stats - deduct only for successful verifications
        // More robust extraction with explicit type checking
        const stats = {
            success: typeof result.stats?.success === 'number' ? result.stats.success : (result.success ? batchSize : 0),
            failed: typeof result.stats?.failed === 'number' ? result.stats.failed : (result.success ? 0 : batchSize),
            total: batchSize
        };
        console.log(`[Verify] Final stats (constructed):`, JSON.stringify(stats));
        const successCount = stats.success || 0;
        const pointsToDeduct = successCount * pricePerVerify;

        // Deduct points for successful verifications only
        if (pointsToDeduct > 0) {
            const { error: deductError } = await supabase.rpc('fn_deduct_points', {
                p_target_user_id: userId,
                p_amount: pointsToDeduct,
                p_reason: `Gemini验证服务 (${successCount}/${batchSize} 成功)`
            });

            if (deductError) {
                console.error('[Verify] Failed to deduct points:', deductError);
            } else {
                sendEvent('status', { status: 'deducted', message: `💳 已扣除 ${pointsToDeduct} 积分 (${successCount} 个成功验证)` });
            }
        }

        // Log verification attempt (batch summary)
        try {
            await supabase.from('verification_logs').insert({
                user_id: userId,
                verification_id: verificationIds.join(',').substring(0, 500), // Truncate if too long
                status: successCount > 0 ? 'success' : 'failed',
                message: result.message,
                points_deducted: pointsToDeduct,
                batch_count: batchSize,
                batch_success: successCount,
                batch_failed: stats.failed || 0
            });
        } catch (logError) {
            console.warn('Failed to log verification:', logError);
        }

        // Send final result with batch stats
        sendEvent('result', {
            success: successCount > 0,
            message: result.message,
            pointsDeducted: pointsToDeduct,
            stats: stats
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

// =============================================
// Afdian (爱发电) Webhook Endpoint
// =============================================
const crypto = require('crypto');

// Price to points mapping
const AFDIAN_PRICE_TO_POINTS = {
    5: 5,
    20: 20,
    50: 50
};

// POST /api/afdian/webhook
app.post('/api/afdian/webhook', async (req, res) => {
    console.log('[Afdian] Webhook received');

    try {
        const { ec, em, data } = req.body;

        // Log raw request for debugging
        console.log('[Afdian] Raw payload:', JSON.stringify(req.body).substring(0, 500));

        // Verify request is from Afdian (basic check)
        if (ec !== 200) {
            console.warn('[Afdian] Non-200 ec code:', ec, em);
            return res.json({ ec: 200, em: '' }); // Still return 200 to prevent retries
        }

        // Verify signature if token is configured
        const afdianToken = process.env.AFDIAN_TOKEN;
        const afdianUserId = process.env.AFDIAN_USER_ID;

        if (afdianToken && req.body.sign) {
            // Afdian signature: md5(token + params_json)
            const paramsJson = JSON.stringify(req.body.data || {});
            const expectedSign = crypto.createHash('md5')
                .update(afdianToken + paramsJson)
                .digest('hex');

            if (req.body.sign !== expectedSign) {
                console.warn('[Afdian] Signature mismatch');
                // Continue anyway for now, log for debugging
            }
        }

        // Handle order notification
        if (data?.type === 'order' && data?.order) {
            const order = data.order;
            const orderNo = order.out_trade_no;
            const amount = parseFloat(order.total_amount || 0);
            const planId = order.plan_id;
            const afdianUid = order.user_id;
            const remark = order.remark || '';
            const status = order.status; // 2 = success

            console.log(`[Afdian] Order: ${orderNo}, Amount: ${amount}, Status: ${status}`);

            // Only process successful orders
            if (status !== 2) {
                console.log('[Afdian] Order not successful, skipping');
                return res.json({ ec: 200, em: '' });
            }

            // Map amount to points
            const roundedAmount = Math.round(amount);
            const points = AFDIAN_PRICE_TO_POINTS[roundedAmount];

            if (!points) {
                console.warn(`[Afdian] Unknown amount: ${amount}, no points mapping`);
                // Still create order but with 0 points, admin can fix manually
            }

            // Create order and generate code
            const { data: codeResult, error: createError } = await supabase.rpc('fn_create_afdian_order', {
                p_order_no: orderNo,
                p_afdian_user_id: afdianUid,
                p_plan_id: planId,
                p_amount: amount,
                p_points: points || 0,
                p_remark: remark,
                p_payload: req.body
            });

            if (createError) {
                console.error('[Afdian] Failed to create order:', createError);
            } else {
                console.log(`[Afdian] Order created successfully, code: ${codeResult}`);
            }
        }

        // Always respond with success to prevent retries
        return res.json({ ec: 200, em: '' });

    } catch (error) {
        console.error('[Afdian] Webhook error:', error);
        // Still return 200 to prevent infinite retries
        return res.json({ ec: 200, em: 'internal error' });
    }
});

// GET /api/afdian/query - Query redemption code by order number
app.get('/api/afdian/query', async (req, res) => {
    const { order_no } = req.query;

    if (!order_no) {
        return res.status(400).json({ success: false, message: '请输入订单号' });
    }

    try {
        const { data, error } = await supabase.rpc('fn_query_afdian_code', {
            p_order_no: order_no
        });

        if (error) {
            console.error('[Afdian] Query error:', error);
            return res.status(500).json({ success: false, message: '查询失败' });
        }

        if (!data || data.length === 0) {
            return res.json({ success: false, message: '未找到该订单' });
        }

        const orderInfo = data[0];
        return res.json({
            success: true,
            code: orderInfo.code,
            points: orderInfo.points,
            is_redeemed: orderInfo.is_redeemed,
            created_at: orderInfo.created_at
        });

    } catch (error) {
        console.error('[Afdian] Query exception:', error);
        return res.status(500).json({ success: false, message: '服务暂时不可用' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Verify server running on port ${PORT}`);
});
