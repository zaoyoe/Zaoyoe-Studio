'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { requireTgAdmin, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');
const { windowParams, aggregate } = require('../../../tg/data-center');

function createDataCenterHandler({ admin = sharedAdmin, now = Date.now } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        try {
            const { supabase } = await requireTgAdmin(req, admin);
            const window = windowParams(new URL(req.url || '/', 'http://localhost').searchParams, now());
            return admin.sendJson(res, 200, await aggregate(supabase, window));
        } catch (error) { return adminErrorResponse(admin, res, error, '数据中心暂不可用，请稍后重试'); }
    };
}
module.exports = createDataCenterHandler();
module.exports.createDataCenterHandler = createDataCenterHandler;
