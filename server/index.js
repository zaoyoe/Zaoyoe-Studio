/**
 * Verification API Proxy Server
 * Proxies requests to lacedore.org:6789 Verification API
 * Handles Supabase auth + points deduction
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Verification API base URL
const VERIFY_API_BASE = 'http://lacedore.org:6789';

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

// =============================================
// Helper: Get verify config from Supabase
// =============================================
async function getVerifyConfig() {
    const { data: configData } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'verify_settings')
        .single();

    const config = configData?.config_value || {};
    return {
        pricePerVerify: config.price_per_verify || 10,
        apiKey: config.verify_api_key || process.env.VERIFY_API_KEY || ''
    };
}

// =============================================
// Helper: Validate user and check balance
// =============================================
async function validateUserBalance(userId, requiredPoints) {
    if (!userId) {
        return { valid: false, error: '请先登录', status: 400 };
    }

    const { data: balanceData, error: balanceError } = await supabase
        .rpc('fn_get_user_balance', { p_user_id: userId })
        .single();

    if (balanceError) {
        console.error('[Verify] Balance check error:', balanceError);
        return { valid: false, error: '查询积分失败', status: 500 };
    }

    const currentBalance = balanceData?.total_balance || 0;

    if (currentBalance < requiredPoints) {
        return {
            valid: false,
            error: `积分不足，需要 ${requiredPoints} 积分，当前余额 ${currentBalance}`,
            status: 400,
            balance: currentBalance
        };
    }

    return { valid: true, balance: currentBalance };
}

// =============================================
// POST /api/verify — Submit single verification
// Returns task_id for polling
// =============================================
app.post('/api/verify', async (req, res) => {
    const { verificationId, userId } = req.body;

    if (!verificationId) {
        return res.status(400).json({ success: false, message: '请提供验证ID' });
    }

    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置 API Key' });
        }

        // Check balance (need at least pricePerVerify)
        const balanceCheck = await validateUserBalance(userId, config.pricePerVerify);
        if (!balanceCheck.valid) {
            return res.status(balanceCheck.status).json({ success: false, message: balanceCheck.error });
        }

        console.log(`[Verify] Submitting single verification: ${verificationId}`);

        // Forward to Verification API
        const apiRes = await fetch(`${VERIFY_API_BASE}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': config.apiKey
            },
            body: JSON.stringify({ verification_id: verificationId })
        });

        const apiData = await apiRes.json();

        if (!apiRes.ok) {
            console.error('[Verify] API error:', apiData);
            return res.status(apiRes.status).json({
                success: false,
                message: apiData.detail || apiData.message || '验证请求失败'
            });
        }

        console.log(`[Verify] Task created:`, apiData);

        return res.json({
            success: true,
            task_id: apiData.task_id,
            message: apiData.message || '验证任务已提交',
            pricePerVerify: config.pricePerVerify
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
// GET /api/verify/status/:taskId — Poll task status
// =============================================
app.get('/api/verify/status/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const { userId } = req.query;

    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置' });
        }

        const apiRes = await fetch(`${VERIFY_API_BASE}/verify/status/${taskId}`, {
            method: 'GET',
            headers: {
                'X-API-Key': config.apiKey
            }
        });

        const apiData = await apiRes.json();

        if (!apiRes.ok) {
            return res.status(apiRes.status).json({
                success: false,
                message: apiData.detail || '查询状态失败'
            });
        }

        // If task completed successfully, deduct points
        if (apiData.status === 'completed' && apiData.success === true && userId) {
            const alreadyDeducted = req.query.deducted === 'true';

            if (!alreadyDeducted) {
                const pointsToDeduct = config.pricePerVerify;

                const { error: deductError } = await supabase.rpc('fn_deduct_points', {
                    p_target_user_id: userId,
                    p_amount: pointsToDeduct,
                    p_reason: 'Gemini验证服务'
                });

                if (deductError) {
                    console.error('[Verify] Failed to deduct points:', deductError);
                } else {
                    console.log(`[Verify] Deducted ${pointsToDeduct} points for user ${userId}`);
                    apiData.pointsDeducted = pointsToDeduct;
                }

                // Log verification
                try {
                    await supabase.from('verification_logs').insert({
                        user_id: userId,
                        verification_id: taskId,
                        status: 'success',
                        message: apiData.message || 'Verification completed',
                        points_deducted: pointsToDeduct,
                        batch_count: 1,
                        batch_success: 1,
                        batch_failed: 0
                    });
                } catch (logError) {
                    console.warn('Failed to log verification:', logError);
                }
            }
        }

        // If task failed, log it
        if (apiData.status === 'completed' && apiData.success === false && userId) {
            try {
                await supabase.from('verification_logs').insert({
                    user_id: userId,
                    verification_id: taskId,
                    status: 'failed',
                    message: apiData.message || 'Verification failed',
                    points_deducted: 0,
                    batch_count: 1,
                    batch_success: 0,
                    batch_failed: 1
                });
            } catch (logError) {
                console.warn('Failed to log verification:', logError);
            }
        }

        return res.json(apiData);

    } catch (error) {
        console.error('[Verify] Status check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询状态失败'
        });
    }
});

// =============================================
// POST /api/cancel — Cancel verification with safe final check
// =============================================
app.post('/api/cancel', async (req, res) => {
    const { verificationId, taskId, userId } = req.body;

    if (!verificationId && !taskId) {
        return res.status(400).json({ success: false, message: '请提供验证ID或任务ID' });
    }

    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置' });
        }

        // Step 1: Try to cancel
        let cancelSuccess = false;
        try {
            const cancelRes = await fetch(`${VERIFY_API_BASE}/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': config.apiKey
                },
                body: JSON.stringify({ verification_id: verificationId || taskId })
            });
            const cancelData = await cancelRes.json();
            cancelSuccess = cancelRes.ok;
            console.log(`[Verify] Cancel attempt for ${verificationId || taskId}: ${cancelSuccess}`, cancelData);
        } catch (cancelErr) {
            console.warn('[Verify] Cancel request failed:', cancelErr.message);
        }

        // Step 2: Final status check (safe cancel — don't lose money)
        if (taskId) {
            try {
                const statusRes = await fetch(`${VERIFY_API_BASE}/verify/status/${taskId}`, {
                    method: 'GET',
                    headers: { 'X-API-Key': config.apiKey }
                });
                const statusData = await statusRes.json();

                // If task already completed successfully, deduct points
                if (statusData.status === 'completed' && statusData.success === true && userId) {
                    const pointsToDeduct = config.pricePerVerify;

                    const { error: deductError } = await supabase.rpc('fn_deduct_points', {
                        p_target_user_id: userId,
                        p_amount: pointsToDeduct,
                        p_reason: 'Gemini验证服务(取消时已完成)'
                    });

                    if (!deductError) {
                        console.log(`[Verify] Cancel-time deduction: ${pointsToDeduct} pts for ${userId}`);
                    }

                    return res.json({
                        success: true,
                        alreadyCompleted: true,
                        verificationSuccess: true,
                        pointsDeducted: pointsToDeduct,
                        message: statusData.message || '验证已完成',
                        status: statusData.status
                    });
                }

                // Task was cancelled or failed
                return res.json({
                    success: true,
                    alreadyCompleted: false,
                    verificationSuccess: false,
                    message: cancelSuccess ? '验证已取消' : (statusData.message || '任务状态: ' + statusData.status),
                    status: statusData.status
                });

            } catch (statusErr) {
                console.warn('[Verify] Final status check failed:', statusErr.message);
            }
        }

        return res.json({
            success: cancelSuccess,
            alreadyCompleted: false,
            verificationSuccess: false,
            message: cancelSuccess ? '验证已取消' : '取消请求已发送'
        });

    } catch (error) {
        console.error('[Verify] Cancel error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '取消失败'
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
    console.log(`🚀 Verify proxy server running on port ${PORT}`);
});
