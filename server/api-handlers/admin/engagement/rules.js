const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const VALID_RULE_SITES = Object.freeze(new Set(['all', 'cn', 'intl']));
const VALID_RULE_STATUSES = Object.freeze(new Set(['draft', 'published', 'paused', 'archived']));
const VALID_RULE_PAGES = Object.freeze(new Set(['all', 'home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook']));
const VALID_RULE_TONES = Object.freeze(new Set(['info', 'success', 'warning', 'alert', 'error', 'welcome', 'creative', 'calm', 'commerce', 'assistive', 'community']));
const VALID_RULE_PLACEMENTS = Object.freeze(new Set(['robot_bubble', 'top_banner', 'inline_card', 'modal', 'floating_badge']));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RULE_MANAGEMENT_LIST_LIMIT = 500;

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function isUuid(value = '') {
    return UUID_PATTERN.test(sanitizeText(value, 160));
}

function normalizeBoolean(value, fallback = false) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function normalizeInteger(value, fallback = 0, { min = -1000, max = 1000 } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeSite(value = 'all') {
    const normalized = sanitizeText(value, 20).toLowerCase() || 'all';
    return VALID_RULE_SITES.has(normalized) ? normalized : 'all';
}

function normalizeStatus(value = 'draft') {
    const normalized = sanitizeText(value, 40).toLowerCase() || 'draft';
    return VALID_RULE_STATUSES.has(normalized) ? normalized : 'draft';
}

function normalizeTone(value = 'info') {
    const normalized = sanitizeText(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'info';
    return VALID_RULE_TONES.has(normalized) ? normalized : 'info';
}

function normalizePlacement(value = 'robot_bubble') {
    const normalized = sanitizeText(value, 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'robot_bubble';
    return VALID_RULE_PLACEMENTS.has(normalized) ? normalized : 'robot_bubble';
}

function normalizePageIds(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[\s,;|]+/);
    const normalized = [...new Set(source
        .map((item) => sanitizeText(item, 80).toLowerCase())
        .filter((item) => VALID_RULE_PAGES.has(item)))];
    if (!normalized.length || normalized.includes('all')) {
        return ['all'];
    }
    return normalized;
}

function normalizeMetadata(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRepeatIntervalMinutes(value, fallback = 2) {
    return normalizeInteger(value, fallback, { min: 0, max: 1440 });
}

function buildRuleGovernance(rule = {}) {
    const pageIds = normalizePageIds(rule.page_ids || rule.pageIds);
    const placement = normalizePlacement(rule.placement);
    const tone = normalizeTone(rule.tone);
    const priority = normalizeInteger(rule.priority, 0);
    const actionLabel = sanitizeText(rule.action_label || rule.actionLabel, 80);
    const actionUrl = sanitizeText(rule.action_url || rule.actionUrl, 1000);
    const reasons = [];

    if (pageIds.includes('all')) reasons.push('全站触达');
    if (priority >= 30) reasons.push('高优先级');
    if (['modal', 'top_banner'].includes(placement)) reasons.push('强展示形式');
    if (['warning', 'alert', 'error'].includes(tone)) reasons.push('警示语气');
    if (actionLabel && !actionUrl) reasons.push('按钮缺少链接');

    const riskLevel = reasons.length >= 3 ? 'high' : (reasons.length >= 1 ? 'medium' : 'low');
    return {
        risk_level: riskLevel,
        requires_review: riskLevel === 'high',
        reasons
    };
}

function getBatchAuditDetails(body = {}) {
    const batchId = sanitizeText(body.batch_id || body.batchId, 160);
    const batchAction = sanitizeText(body.batch_action || body.batchAction, 120);
    const batchLabel = sanitizeText(body.batch_label || body.batchLabel, 180);
    const batchSourceRuleId = sanitizeText(body.batch_source_rule_id || body.batchSourceRuleId, 160);
    const batchPreviousStatus = sanitizeText(body.batch_previous_status || body.batchPreviousStatus, 80);
    const batchPreviousEnabled = body.batch_previous_enabled === true || body.batchPreviousEnabled === true;
    const rollbackBatchId = sanitizeText(body.rollback_batch_id || body.rollbackBatchId, 160);
    const details = {};
    if (batchId) details.batch_id = batchId;
    if (batchAction) details.batch_action = batchAction;
    if (batchLabel) details.batch_label = batchLabel;
    if (batchSourceRuleId) details.batch_source_rule_id = batchSourceRuleId;
    if (batchPreviousStatus) details.batch_previous_status = batchPreviousStatus;
    if (body.batch_previous_enabled !== undefined || body.batchPreviousEnabled !== undefined) details.batch_previous_enabled = batchPreviousEnabled;
    if (rollbackBatchId) details.rollback_batch_id = rollbackBatchId;
    return details;
}

function isGovernanceAcknowledged(body = {}) {
    return body.governance_acknowledged === true
        || body.governanceAcknowledged === true
        || body.risk_acknowledged === true
        || body.riskAcknowledged === true;
}

function getGovernanceAckReason(body = {}) {
    return sanitizeText(
        body.governance_ack_reason
            || body.governanceAckReason
            || body.risk_ack_reason
            || body.riskAckReason
            || 'admin_studio_confirm',
        240
    ) || 'admin_studio_confirm';
}

function assertPublishGovernanceAcknowledged(rule = {}, body = {}) {
    const governance = normalizeMetadata(rule.governance || rule.metadata?.governance);
    if (rule.enabled === true && rule.status === 'published' && governance.requires_review === true && !isGovernanceAcknowledged(body)) {
        const error = new Error('高风险触达规则需要二次确认后才能发布');
        error.statusCode = 428;
        error.code = 'ENGAGEMENT_GOVERNANCE_ACK_REQUIRED';
        throw error;
    }
}

function attachGovernanceReviewMetadata(payload = {}, body = {}, userId = '') {
    if (!isGovernanceAcknowledged(body)) return payload;
    const metadata = normalizeMetadata(payload.metadata);
    return {
        ...payload,
        metadata: {
            ...metadata,
            governance_review: {
                acknowledged: true,
                acknowledged_by: userId || '',
                acknowledged_at: new Date().toISOString(),
                reason: getGovernanceAckReason(body)
            }
        }
    };
}

function isMissingEngagementSchemaError(error) {
    const text = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();
    return error?.code === '42P01'
        || error?.code === '42703'
        || error?.code === 'PGRST205'
        || text.includes('engagement_rules')
        || text.includes('schema cache');
}

function normalizeRule(row = {}) {
    const metadata = normalizeMetadata(row.metadata);
    const repeatIntervalMinutes = normalizeRepeatIntervalMinutes(
        metadata.repeat_interval_minutes ?? metadata.repeatIntervalMinutes,
        2
    );
    const normalized = {
        id: sanitizeText(row.id, 160),
        name: sanitizeText(row.name || '未命名触达规则', 160) || '未命名触达规则',
        description: sanitizeText(row.description, 800),
        site: normalizeSite(row.site),
        page_ids: normalizePageIds(row.page_ids),
        placement: normalizePlacement(row.placement),
        trigger_type: sanitizeText(row.trigger_type || 'page_view', 80) || 'page_view',
        audience: normalizeMetadata(row.audience),
        title: sanitizeText(row.title, 160),
        content: sanitizeText(row.content, 1200),
        action_label: sanitizeText(row.action_label, 80),
        action_url: sanitizeText(row.action_url, 1000),
        tone: normalizeTone(row.tone),
        icon: sanitizeText(row.icon || 'robot', 40) || 'robot',
        priority: normalizeInteger(row.priority, 0),
        frequency: sanitizeText(row.frequency || 'once_per_day', 80) || 'once_per_day',
        dismiss_ttl_hours: normalizeInteger(row.dismiss_ttl_hours, 24, { min: 1, max: 720 }),
        repeat_interval_minutes: repeatIntervalMinutes,
        enabled: row.enabled === true,
        status: normalizeStatus(row.status),
        starts_at: sanitizeText(row.starts_at, 120),
        ends_at: sanitizeText(row.ends_at, 120),
        metadata,
        updated_at: sanitizeText(row.updated_at, 120),
        created_at: sanitizeText(row.created_at, 120)
    };
    normalized.governance = normalizeMetadata(metadata.governance);
    if (!normalized.governance.risk_level) {
        normalized.governance = buildRuleGovernance(normalized);
    }
    return normalized;
}

function buildRulePayload(body = {}, userId = '') {
    const name = sanitizeText(body.name, 160);
    const content = sanitizeText(body.content, 1200);
    const title = sanitizeText(body.title || name || '小助手提醒', 160);
    if (!name || !content) {
        const error = new Error('规则名称和气泡内容不能为空');
        error.statusCode = 400;
        throw error;
    }

    const status = normalizeStatus(body.status);
    const enabled = status === 'published';
    const metadata = normalizeMetadata(body.metadata);
    const repeatIntervalMinutes = normalizeRepeatIntervalMinutes(
        body.repeat_interval_minutes ?? body.repeatIntervalMinutes ?? metadata.repeat_interval_minutes ?? metadata.repeatIntervalMinutes,
        2
    );
    const payload = {
        name,
        description: sanitizeText(body.description, 800),
        site: normalizeSite(body.site),
        page_ids: normalizePageIds(body.page_ids || body.pageIds),
        placement: normalizePlacement(body.placement || body.display_type || body.displayType),
        trigger_type: sanitizeText(body.trigger_type || body.triggerType || 'page_view', 80) || 'page_view',
        audience: normalizeMetadata(body.audience),
        title,
        content,
        action_label: sanitizeText(body.action_label || body.actionLabel, 80),
        action_url: sanitizeText(body.action_url || body.actionUrl, 1000),
        tone: normalizeTone(body.tone),
        icon: sanitizeText(body.icon || 'robot', 40) || 'robot',
        priority: normalizeInteger(body.priority, 0),
        frequency: sanitizeText(body.frequency || 'once_per_day', 80) || 'once_per_day',
        dismiss_ttl_hours: normalizeInteger(body.dismiss_ttl_hours || body.dismissTtlHours, 24, { min: 1, max: 720 }),
        enabled,
        status,
        starts_at: sanitizeText(body.starts_at || body.startsAt, 120) || null,
        ends_at: sanitizeText(body.ends_at || body.endsAt, 120) || null,
        metadata: {
            ...metadata,
            repeat_interval_minutes: repeatIntervalMinutes
        },
        updated_by: userId || null
    };
    payload.metadata = {
        ...payload.metadata,
        governance: buildRuleGovernance(payload)
    };
    const withReview = attachGovernanceReviewMetadata(payload, body, userId);
    assertPublishGovernanceAcknowledged(withReview, body);
    return withReview;
}

async function listRules(supabase, { site = 'all' } = {}) {
    let query = supabase
        .from('engagement_rules')
        .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .order('updated_at', { ascending: false })
        .limit(RULE_MANAGEMENT_LIST_LIMIT);

    const normalizedSite = normalizeSite(site);
    if (normalizedSite !== 'all') {
        query = query.in('site', ['all', normalizedSite]);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalizeRule);
}

async function saveRule({ supabase, user, body }) {
    const rawId = sanitizeText(body.id || body.rule_id || body.ruleId, 160);
    const id = isUuid(rawId) ? rawId : '';
    const payload = buildRulePayload(body, user.id);

    let response;
    if (id) {
        response = await supabase
            .from('engagement_rules')
            .update(payload)
            .eq('id', id)
            .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
            .single();
    } else {
        response = await supabase
            .from('engagement_rules')
            .insert({
                ...payload,
                created_by: user.id || null
            })
            .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
            .single();
    }

    if (response.error) throw response.error;
    const savedRule = normalizeRule(response.data);
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: payload.site,
        actionType: id ? 'engagement.rule.update' : 'engagement.rule.create',
        details: {
            ...getBatchAuditDetails(body),
            rule_id: response.data?.id || id,
            name: payload.name,
            status: payload.status,
            enabled: payload.enabled,
            page_ids: payload.page_ids,
            audience: payload.audience,
            trigger_type: payload.trigger_type,
            placement: payload.placement,
            governance: savedRule.governance
        }
    });

    return savedRule;
}

async function loadRuleById(supabase, id = '') {
    const normalizedId = sanitizeText(id, 160);
    if (!normalizedId || !isUuid(normalizedId)) return null;
    const { data, error } = await supabase
        .from('engagement_rules')
        .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .eq('id', normalizedId)
        .single();
    if (error) throw error;
    return normalizeRule(data);
}

async function setRuleEnabled({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.rule_id || body.ruleId, 160);
    if (!id) {
        const error = new Error('rule id is required');
        error.statusCode = 400;
        throw error;
    }
    if (!isUuid(id)) {
        const error = new Error('rule id must be a valid uuid');
        error.statusCode = 400;
        throw error;
    }

    const enabled = normalizeBoolean(body.enabled, false);
    let metadataPatch = null;
    if (enabled) {
        const currentRule = await loadRuleById(supabase, id);
        const nextRule = {
            ...(currentRule || {}),
            enabled: true,
            status: 'published'
        };
        nextRule.governance = buildRuleGovernance(nextRule);
        assertPublishGovernanceAcknowledged(nextRule, body);
        if (isGovernanceAcknowledged(body)) {
            metadataPatch = attachGovernanceReviewMetadata({
                metadata: {
                    ...(currentRule?.metadata || {}),
                    governance: nextRule.governance
                }
            }, body, user.id).metadata;
        }
    }
    const patch = {
        enabled,
        status: enabled ? 'published' : 'paused',
        updated_by: user.id || null
    };
    if (metadataPatch) {
        patch.metadata = metadataPatch;
    }
    const { data, error } = await supabase
        .from('engagement_rules')
        .update(patch)
        .eq('id', id)
        .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .single();
    if (error) throw error;
    const normalizedRule = normalizeRule(data);

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: data?.site,
        actionType: enabled ? 'engagement.rule.publish' : 'engagement.rule.pause',
        details: {
            ...getBatchAuditDetails(body),
            rule_id: id,
            enabled,
            name: normalizedRule.name,
            placement: normalizedRule.placement,
            trigger_type: normalizedRule.trigger_type,
            governance: normalizedRule.governance
        }
    });

    return normalizedRule;
}

async function archiveRule({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.rule_id || body.ruleId, 160);
    if (!id) {
        const error = new Error('rule id is required');
        error.statusCode = 400;
        throw error;
    }
    if (!isUuid(id)) {
        const error = new Error('rule id must be a valid uuid');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('engagement_rules')
        .update({
            enabled: false,
            status: 'archived',
            updated_by: user.id || null
        })
        .eq('id', id)
        .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .single();
    if (error) throw error;
    const normalizedRule = normalizeRule(data);

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: data?.site,
        actionType: 'engagement.rule.archive',
        details: {
            ...getBatchAuditDetails(body),
            rule_id: id,
            name: normalizedRule.name,
            governance: normalizedRule.governance
        }
    });

    return normalizedRule;
}

async function deleteRule({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.rule_id || body.ruleId, 160);
    if (!id) {
        const error = new Error('rule id is required');
        error.statusCode = 400;
        throw error;
    }
    if (!isUuid(id)) {
        const error = new Error('rule id must be a valid uuid');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('engagement_rules')
        .delete()
        .eq('id', id)
        .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .single();
    if (error) throw error;
    const normalizedRule = normalizeRule(data);

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: data?.site,
        actionType: 'engagement.rule.delete',
        details: {
            rule_id: id,
            name: normalizedRule.name,
            status: normalizedRule.status,
            enabled: normalizedRule.enabled,
            page_ids: normalizedRule.page_ids,
            audience: normalizedRule.audience,
            trigger_type: normalizedRule.trigger_type,
            placement: normalizedRule.placement,
            governance: normalizedRule.governance
        }
    });

    return normalizedRule;
}

async function pauseAllRules({ supabase, user, body }) {
    const site = normalizeSite(body.site || 'all');
    let query = supabase
        .from('engagement_rules')
        .update({
            enabled: false,
            status: 'paused',
            updated_by: user.id || null
        })
        .eq('enabled', true)
        .eq('status', 'published');

    if (site !== 'all') {
        query = query.in('site', ['all', site]);
    }

    const { data, error } = await query
        .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at');
    if (error) throw error;

    const rows = Array.isArray(data) ? data.map(normalizeRule) : [];
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site,
        actionType: 'engagement.rule.pause_all',
        details: {
            site,
            count: rows.length,
            rule_ids: rows.map((rule) => rule.id).filter(Boolean)
        }
    });

    return rows;
}

module.exports = async function engagementRulesHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const rules = await listRules(supabase, {
                site: url.searchParams.get('site') || 'all'
            });
            return sendJson(res, 200, {
                success: true,
                rules
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action || 'save_rule', 80).toLowerCase();
        let rule;
        if (action === 'set_enabled' || action === 'toggle_rule') {
            rule = await setRuleEnabled({ supabase, user, body });
        } else if (action === 'archive_rule') {
            rule = await archiveRule({ supabase, user, body });
        } else if (action === 'delete_rule') {
            const deletedRule = await deleteRule({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                deleted_id: deletedRule.id,
                deleted_rule: deletedRule
            });
        } else if (action === 'pause_all') {
            const rules = await pauseAllRules({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                rules
            });
        } else {
            rule = await saveRule({ supabase, user, body });
        }

        return sendJson(res, 200, {
            success: true,
            rule
        });
    } catch (error) {
        const schemaMissing = isMissingEngagementSchemaError(error);
        return sendJson(res, schemaMissing ? 409 : (error.statusCode || 500), {
            success: false,
            message: schemaMissing
                ? '客服系统数据表尚未完成迁移，请先执行 engagement migration'
                : (error.message || 'Failed to update engagement rules')
        });
    }
};
