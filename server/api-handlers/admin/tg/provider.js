'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { createGramixClient, isDecimalString } = require('../../../tg/gramix-client');
const { fulfillmentRuntime } = require('../../../tg/upstream-status');
const { requireTgAdmin, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');

function enabled(value) { return /^(true|1)$/i.test(String(value || '').trim()); }

function createProviderHandler({ admin = sharedAdmin, clientFactory = createGramixClient, env = process.env } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        if (String(req.method || '').toUpperCase() !== 'GET') {
            res.setHeader('Allow', 'GET');
            return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            await requireTgAdmin(req, admin);
            const paymentCurrency = env.GRAMIX_PAYMENT_CURRENCY || 'usdt';
            const state = {
                success: true, provider: 'gramix', configured: Boolean(String(env.GRAMIX_API_KEY || '').trim()),
                healthy: false, checked_at: new Date().toISOString(), balances: null,
                payment_currency: ['usdt', 'gram'].includes(paymentCurrency) ? paymentCurrency : null,
                redemption_enabled: enabled(env.TG_REDEMPTION_ENABLED),
                fulfillment_enabled: enabled(env.TG_FULFILLMENT_ENABLED),
                runtime: fulfillmentRuntime(env)
            };
            if (!state.configured) return admin.sendJson(res, 200, { ...state, code: 'tg_provider_unconfigured', message: '尚未配置上游服务' });
            try {
                // This endpoint is deliberately read-only: no deposit address,
                // purchase, order update or API credential is exposed here.
                const response = await clientFactory({ env }).getBalance();
                const data = response?.data;
                if (response?.statusCode !== 200 || !isDecimalString(data?.gram) || !isDecimalString(data?.usdt)) throw new Error('Invalid balance response');
                return admin.sendJson(res, 200, {
                    ...state, healthy: true,
                    balances: { gram: data.gram.trim(), usdt: data.usdt.trim() }
                });
            } catch (_) {
                return admin.sendJson(res, 200, { ...state, code: 'tg_provider_unavailable', message: '上游服务暂不可用，请检查配置或稍后重试' });
            }
        } catch (error) {
            return adminErrorResponse(admin, res, error, 'TG 上游状态查询失败');
        }
    };
}

module.exports = createProviderHandler();
module.exports.createProviderHandler = createProviderHandler;
