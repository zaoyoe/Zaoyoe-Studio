const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const VALID_ACTIONS = new Set(['claim', 'add_note', 'resolve', 'reopen']);
const NOTE_REQUIRED_ACTIONS = new Set(['add_note', 'resolve']);

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function buildOwnerLabel(user = {}) {
    return sanitizeText(user.email, 255) || sanitizeText(user.id, 160) || 'unknown';
}

function buildCaseResponse(row = {}) {
    return {
        id: sanitizeText(row.id, 160) || null,
        target_id: sanitizeText(row.target_id, 200) || null,
        status: sanitizeText(row.status, 40).toLowerCase() || 'open',
        owner_admin_id: sanitizeText(row.owner_admin_id, 160) || null,
        owner_label: sanitizeText(row.owner_label, 255) || null,
        note: sanitizeText(row.note, 2000) || null,
        resolution: sanitizeText(row.resolution, 2000) || null,
        metadata: normalizeJsonObject(row.metadata),
        last_action: sanitizeText(row.last_action, 80).toLowerCase() || 'opened',
        last_action_by: sanitizeText(row.last_action_by, 160) || null,
        last_action_at: sanitizeText(row.last_action_at, 80) || null,
        created_at: sanitizeText(row.created_at, 80) || null,
        updated_at: sanitizeText(row.updated_at, 80) || null
    };
}

async function fetchExistingCase(supabase, targetId) {
    const { data, error } = await supabase
        .from('shop_risk_cases')
        .select('*')
        .eq('target_id', targetId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data || null;
}

function buildActionMessage(action, caseRow) {
    const targetId = sanitizeText(caseRow?.target_id, 160) || '目标';
    switch (action) {
    case 'claim':
        return `已认领风控案例 ${targetId}`;
    case 'add_note':
        return `已记录风控备注 ${targetId}`;
    case 'resolve':
        return `已关闭风控案例 ${targetId}`;
    case 'reopen':
        return `已重新打开风控案例 ${targetId}`;
    default:
        return '商城风控案例已更新';
    }
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req);

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action, 80).toLowerCase();
        const targetId = sanitizeText(body.target_id || body.targetId, 200);
        const note = sanitizeText(body.note, 4000);
        const resolution = sanitizeText(body.resolution, 4000) || note;
        const metadata = normalizeJsonObject(body.metadata);

        if (!VALID_ACTIONS.has(action)) {
            return sendJson(res, 400, {
                success: false,
                message: '未识别的商城风控处理动作'
            });
        }

        if (!targetId) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少商城风控案例标识'
            });
        }

        if (NOTE_REQUIRED_ACTIONS.has(action) && !note) {
            return sendJson(res, 400, {
                success: false,
                message: action === 'resolve' ? '关闭案例时需要填写处理结论' : '请先填写备注内容'
            });
        }

        const existingCase = await fetchExistingCase(supabase, targetId);
        if (!existingCase && action === 'reopen') {
            return sendJson(res, 404, {
                success: false,
                message: '该商城风控案例尚未建立，无法重新打开'
            });
        }

        const nowIso = new Date().toISOString();
        const nextRecord = {
            target_id: targetId,
            status: sanitizeText(existingCase?.status, 40).toLowerCase() || 'open',
            owner_admin_id: sanitizeText(existingCase?.owner_admin_id, 160) || null,
            owner_label: sanitizeText(existingCase?.owner_label, 255) || null,
            note: sanitizeText(existingCase?.note, 4000) || null,
            resolution: sanitizeText(existingCase?.resolution, 4000) || null,
            metadata: {
                ...normalizeJsonObject(existingCase?.metadata),
                ...metadata
            },
            last_action: sanitizeText(existingCase?.last_action, 80).toLowerCase() || 'opened',
            last_action_by: sanitizeText(existingCase?.last_action_by, 160) || null,
            last_action_at: sanitizeText(existingCase?.last_action_at, 80) || nowIso
        };

        if (action === 'claim') {
            nextRecord.status = 'claimed';
            nextRecord.owner_admin_id = user.id;
            nextRecord.owner_label = buildOwnerLabel(user);
            if (note) {
                nextRecord.note = note;
            }
            nextRecord.last_action = 'claimed';
        } else if (action === 'add_note') {
            nextRecord.note = note;
            nextRecord.last_action = 'noted';
        } else if (action === 'resolve') {
            nextRecord.status = 'resolved';
            nextRecord.owner_admin_id = nextRecord.owner_admin_id || user.id;
            nextRecord.owner_label = nextRecord.owner_label || buildOwnerLabel(user);
            nextRecord.resolution = resolution;
            nextRecord.last_action = 'resolved';
        } else if (action === 'reopen') {
            nextRecord.status = 'open';
            nextRecord.last_action = 'reopened';
        }

        nextRecord.last_action_by = user.id;
        nextRecord.last_action_at = nowIso;

        const { data, error } = await supabase
            .from('shop_risk_cases')
            .upsert(nextRecord, { onConflict: 'target_id' })
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType: `admin.shop_risk_case.${action}`,
            details: {
                target_id: targetId,
                next_status: sanitizeText(data?.status, 40).toLowerCase() || 'open',
                owner_admin_id: sanitizeText(data?.owner_admin_id, 160) || null,
                owner_label: sanitizeText(data?.owner_label, 255) || null,
                note: action === 'add_note' || action === 'claim' ? note || null : null,
                resolution: action === 'resolve' ? resolution || null : null
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: buildActionMessage(action, data),
            case: buildCaseResponse(data)
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Shop risk case action failed'
        });
    }
};
