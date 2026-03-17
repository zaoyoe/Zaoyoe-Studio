/**
 * Google One User API Proxy Server
 * Proxies requests to the upstream Google One job API
 * Handles Supabase auth + points deduction
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Upstream API base URL
const VERIFY_API_BASE = process.env.VERIFY_API_BASE_URL || 'https://iqless.icu';

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware — merge env var origins WITH code defaults (env var alone used to override defaults)
const defaultOrigins = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://zaoyoe.com',
    'https://www.zaoyoe.com',
    'https://zaoyoe.xyz',
    'https://www.zaoyoe.xyz'
];
const envOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()) || [];
const allOrigins = [...new Set([...defaultOrigins, ...envOrigins])];
app.use(cors({
    origin: allOrigins,
    credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
    try {
        const upstream = await fetch(`${String(VERIFY_API_BASE).replace(/\/+$/, '')}/api/health`);
        const payload = await upstream.json();
        return res.status(upstream.status).json(payload);
    } catch (error) {
        return res.json({
            status: 'degraded',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// =============================================
// Helpers
// =============================================
async function getVerifyConfig() {
    const { data: configData } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'verify_settings')
        .single();

    const config = configData?.config_value || {};
    return {
        pricePerVerify: Number(config.price_per_verify) || 10,
        apiKey: String(config.verify_api_key || process.env.VERIFY_API_KEY || '').trim(),
        apiBaseUrl: String(config.verify_api_base_url || process.env.VERIFY_API_BASE_URL || VERIFY_API_BASE).replace(/\/+$/, '')
    };
}

function getCurrentSite(req, explicitSite) {
    return explicitSite || (req.headers.origin?.includes('zaoyoe.xyz') ? 'intl' : 'cn');
}

function getApiErrorDetail(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return (payload.detail && typeof payload.detail === 'object') ? payload.detail : null;
}

function getApiErrorCode(payload) {
    const detail = getApiErrorDetail(payload);
    return detail?.code || payload?.code || payload?.error || '';
}

function getApiErrorMessage(payload, fallback) {
    const detail = getApiErrorDetail(payload);
    return detail?.message || payload?.message || payload?.error || fallback;
}

function buildClientStatusMessage(job) {
    const status = String(job?.status || '').toLowerCase();

    if (status === 'queued') {
        const queuePosition = Number(job?.queue_position);
        const waitSeconds = Number(job?.estimated_wait_seconds);
        const queueLabel = Number.isFinite(queuePosition) && queuePosition >= 0
            ? `排队中（队列位置 ${queuePosition}）`
            : '排队中';
        return Number.isFinite(waitSeconds) && waitSeconds > 0
            ? `${queueLabel}，预计等待 ${waitSeconds} 秒`
            : queueLabel;
    }

    if (status === 'running') {
        return job?.stage_label ? `当前阶段：${job.stage_label}` : '任务执行中';
    }

    if (status === 'success') {
        return job?.url ? '链接获取成功' : '任务成功完成';
    }

    if (status === 'failed') {
        return job?.error || '任务失败';
    }

    return job?.message || job?.status || '处理中';
}

function buildHistoryMessage(payload) {
    return JSON.stringify({
        kind: 'google_one_job',
        ...payload
    });
}

function parseHistoryMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        if (parsed?.kind === 'google_one_job') {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

async function hasLoggedJobResult(userId, jobId, site = 'cn') {
    if (!userId || !jobId) return false;

    try {
        const { data, error } = await supabase
            .from('verification_logs')
            .select('message')
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.warn('[Verify] Failed to inspect history for dedupe:', error.message);
            return false;
        }

        return (data || []).some((row) => parseHistoryMessage(row.message)?.job_id === jobId);
    } catch (error) {
        console.warn('[Verify] History dedupe check failed:', error.message);
        return false;
    }
}

async function logVerificationResult({
    userId,
    site = 'cn',
    email,
    jobId,
    status,
    url = '',
    errorCode = '',
    errorMessage = '',
    stageLabel = '',
    rawStatus = '',
    pointsDeducted = 0
}) {
    if (!userId) return;

    const message = buildHistoryMessage({
        email: email || '',
        job_id: jobId || '',
        url: url || '',
        error_code: errorCode || '',
        error_message: errorMessage || '',
        stage_label: stageLabel || '',
        raw_status: rawStatus || status || '',
        logged_at: new Date().toISOString()
    });

    try {
        await supabase.from('verification_logs').insert({
            user_id: userId,
            verification_id: email || jobId || '--',
            status,
            message,
            points_deducted: pointsDeducted,
            batch_count: 1,
            batch_success: status === 'success' ? 1 : 0,
            batch_failed: status === 'success' ? 0 : 1,
            site
        });
    } catch (error) {
        console.warn('[Verify] Failed to log verification result:', error.message);
    }
}

async function validateUserBalance(userId, requiredPoints, site = 'cn') {
    if (!userId) {
        return { valid: false, error: '请先登录', status: 400 };
    }

    const { data: balanceData, error: balanceError } = await supabase
        .rpc('fn_get_user_balance', { p_user_id: userId, p_site: site })
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
// POST /api/verify — Submit a Google One job
// =============================================
app.post('/api/verify', async (req, res) => {
    const { email, password, totpSecret, totp_secret, priority, userId, site } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    const normalizedTotpSecret = String(totpSecret || totp_secret || '').trim();
    const normalizedPriority = Number(priority) === 1 ? 1 : 0;
    const currentSite = getCurrentSite(req, site);

    if (!normalizedEmail || !normalizedPassword || !normalizedTotpSecret) {
        return res.status(400).json({
            success: false,
            message: '请提供邮箱、密码和 TOTP 密钥',
            code: 'missing_fields'
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({
            success: false,
            message: '邮箱格式无效',
            code: 'invalid_email'
        });
    }

    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({
                success: false,
                message: 'Google One API Key 未配置',
                code: 'api_key_missing'
            });
        }

        const balanceCheck = await validateUserBalance(userId, config.pricePerVerify, currentSite);
        if (!balanceCheck.valid) {
            return res.status(balanceCheck.status).json({ success: false, message: balanceCheck.error });
        }

        console.log(`[Verify] Submitting Google One job: ${normalizedEmail}`);

        const apiRes = await fetch(`${config.apiBaseUrl}/api/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': config.apiKey
            },
            body: JSON.stringify({
                email: normalizedEmail,
                password: normalizedPassword,
                totp_secret: normalizedTotpSecret,
                priority: normalizedPriority
            })
        });

        const apiData = await apiRes.json().catch(() => ({}));

        if (!apiRes.ok) {
            console.error('[Verify] API error:', apiData);
            return res.status(apiRes.status).json({
                success: false,
                message: getApiErrorMessage(apiData, '任务提交失败'),
                code: getApiErrorCode(apiData)
            });
        }

        return res.json({
            success: true,
            task_id: apiData.job_id,
            job_id: apiData.job_id,
            status: apiData.status || 'queued',
            queue_position: apiData.queue_position ?? -1,
            estimated_wait_seconds: apiData.estimated_wait_seconds ?? 0,
            message: '任务已提交',
            pricePerVerify: config.pricePerVerify
        });

    } catch (error) {
        console.error('[Verify] Submit error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '验证服务暂时不可用'
        });
    }
});

// =============================================
// GET /api/verify/status/:taskId — Poll job status
// =============================================
app.get('/api/verify/status/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const { userId, site, email } = req.query;
    const currentSite = getCurrentSite(req, site);

    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置', code: 'api_key_missing' });
        }

        const apiRes = await fetch(`${config.apiBaseUrl}/api/jobs/${taskId}`, {
            method: 'GET',
            headers: {
                'X-API-Key': config.apiKey
            }
        });

        const apiData = await apiRes.json().catch(() => ({}));

        if (!apiRes.ok) {
            return res.status(apiRes.status).json({
                success: false,
                message: getApiErrorMessage(apiData, '查询状态失败'),
                code: getApiErrorCode(apiData)
            });
        }

        let pointsDeducted = 0;
        const terminal = apiData.status === 'success' || apiData.status === 'failed';

        if (terminal && userId) {
            const alreadyLogged = await hasLoggedJobResult(userId, taskId, currentSite);

            if (!alreadyLogged) {
                if (apiData.status === 'success') {
                    const pointsToDeduct = config.pricePerVerify;
                    const { data: deductData, error: deductError } = await supabase.rpc('fn_deduct_points', {
                        p_target_user_id: userId,
                        p_amount: pointsToDeduct,
                        p_reason: 'Google One 链接获取服务'
                    });

                    if (deductError) {
                        console.error('[Verify] Failed to deduct points:', deductError);
                    } else {
                        pointsDeducted = deductData?.deducted ?? pointsToDeduct;
                    }
                }

                await logVerificationResult({
                    userId,
                    site: currentSite,
                    email: String(email || ''),
                    jobId: taskId,
                    status: apiData.status === 'success' ? 'success' : 'failed',
                    url: apiData.url || '',
                    errorCode: apiData.error || '',
                    errorMessage: buildClientStatusMessage(apiData),
                    stageLabel: apiData.stage_label || '',
                    rawStatus: apiData.status || '',
                    pointsDeducted
                });
            }
        }

        return res.json({
            success: apiData.status === 'success',
            job_id: apiData.job_id || taskId,
            status: apiData.status,
            stage: apiData.stage,
            total_stages: apiData.total_stages,
            stage_label: apiData.stage_label,
            url: apiData.url || '',
            error: apiData.error || '',
            created_at: apiData.created_at,
            elapsed_seconds: apiData.elapsed_seconds,
            queue_position: apiData.queue_position,
            estimated_wait_seconds: apiData.estimated_wait_seconds,
            message: buildClientStatusMessage(apiData),
            pointsDeducted
        });

    } catch (error) {
        console.error('[Verify] Status check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询状态失败'
        });
    }
});

// =============================================
// GET /api/quota — Check current API key balance
// =============================================
app.get('/api/quota', async (req, res) => {
    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置 API Key' });
        }

        const apiRes = await fetch(`${config.apiBaseUrl}/api/balance`, {
            method: 'GET',
            headers: { 'X-API-Key': config.apiKey }
        });

        const apiData = await apiRes.json().catch(() => ({}));

        if (!apiRes.ok) {
            return res.status(apiRes.status).json({
                success: false,
                message: getApiErrorMessage(apiData, '查询额度失败'),
                code: getApiErrorCode(apiData)
            });
        }

        return res.json({
            success: true,
            credits: Number(apiData.balance || 0),
            balance: Number(apiData.balance || 0),
            total_used: apiData.total_used || 0,
            cost_per_job: apiData.cost_per_job || 1,
            key_name: apiData.name || ''
        });

    } catch (error) {
        console.error('[Verify] Quota check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询额度失败'
        });
    }
});

// =============================================
// GET /api/queue — Inspect upstream queue status
// =============================================
app.get('/api/queue', async (req, res) => {
    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置 API Key' });
        }

        const apiRes = await fetch(`${config.apiBaseUrl}/api/queue`, {
            method: 'GET',
            headers: { 'X-API-Key': config.apiKey }
        });

        const apiData = await apiRes.json().catch(() => ({}));

        if (!apiRes.ok) {
            return res.status(apiRes.status).json({
                success: false,
                message: getApiErrorMessage(apiData, '查询队列失败'),
                code: getApiErrorCode(apiData)
            });
        }

        return res.json({ success: true, ...apiData });

    } catch (error) {
        console.error('[Verify] Queue check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询队列失败'
        });
    }
});

// =============================================
// POST /api/redeem — Legacy endpoint kept for compatibility
// =============================================
app.post('/api/redeem', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: '新版 Google One API 不再支持卡密兑换，请在上游后台管理 API Key 余额。',
        code: 'redeem_not_supported'
    });
});

// =============================================
// POST /api/cancel — Legacy endpoint kept for compatibility
// =============================================
app.post('/api/cancel', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: '新版 Google One API 不支持取消已提交任务，请等待任务结束。',
        code: 'cancel_not_supported'
    });
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
