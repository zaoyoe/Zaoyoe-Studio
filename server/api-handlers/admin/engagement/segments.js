const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    listKnownUserTagDefinitions,
    sweepInactiveUserTags
} = require('../../../../api/_lib/user-tags');
const {
    loadSiteScopedConfig,
    normalizeEngagementConfigSite,
    resolveEngagementConfigRequestSite,
    saveSiteScopedConfig
} = require('../../_engagement-site-config');

const TAG_CENTER_CONFIG_KEY = 'engagement_user_tag_center';
const VALID_TAG_SOURCES = Object.freeze(new Set(['manual', 'profile_metadata', 'auth_metadata', 'purchase', 'wallet', 'behavior', 'support']));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function isUuid(value = '') {
    return UUID_PATTERN.test(sanitizeText(value, 160));
}

function isMissingRelationOrColumnError(error, relationName = '') {
    const text = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();
    const relation = sanitizeText(relationName, 120).toLowerCase();
    return error?.code === '42P01'
        || error?.code === '42703'
        || error?.code === 'PGRST204'
        || error?.code === 'PGRST205'
        || text.includes('schema cache')
        || (relation && text.includes(relation));
}

function slugify(value = '', fallback = 'segment') {
    const slug = sanitizeText(value, 120)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || `${fallback}-${Date.now().toString(36)}`;
}

function normalizeBoolean(value, fallback = true) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function normalizeDefinition(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value, maxLength = 80) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
    return [...new Set(source.map((item) => sanitizeText(item, maxLength)).filter(Boolean))];
}

function normalizeToken(value = '', fallback = '') {
    return sanitizeText(value, 120).toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback;
}

function normalizeTagKey(value = '', fallback = '') {
    return sanitizeText(value, 120)
        .toLowerCase()
        .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || fallback;
}

function normalizeNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    const fallbackParsed = Number(fallback);
    const next = Number.isFinite(parsed)
        ? parsed
        : (Number.isFinite(fallbackParsed) ? fallbackParsed : 0);
    return Math.max(min, Math.min(max, Math.round(next * 100) / 100));
}

function normalizeEmailArray(value, maxLength = 240) {
    return normalizeStringArray(value, maxLength)
        .map((item) => item.toLowerCase())
        .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function normalizeTagDefinition(tag = {}) {
    const name = sanitizeText(tag.name || tag.title || '未命名标签', 120) || '未命名标签';
    const key = normalizeTagKey(tag.key || tag.id || name, slugify(name, 'tag'));
    const source = normalizeToken(tag.source || 'manual', 'manual');
    return {
        id: key,
        key,
        name,
        description: sanitizeText(tag.description || tag.desc, 500),
        source: VALID_TAG_SOURCES.has(source) ? source : 'manual',
        auto_rule: sanitizeText(tag.auto_rule || tag.autoRule, 800),
        enabled: normalizeBoolean(tag.enabled, true)
    };
}

function mergeTagCenterWithUserTags(tagCenter = {}, userTagDefinitions = []) {
    const normalizedCenter = normalizeTagCenter(tagCenter);
    const hiddenTags = new Set(normalizedCenter.hidden_user_tags || []);
    const tagMap = new Map(normalizedCenter.tags.map((tag) => [tag.key, tag]));
    (Array.isArray(userTagDefinitions) ? userTagDefinitions : []).forEach((tag) => {
        const normalizedTag = normalizeTagDefinition(tag);
        if (!normalizedTag.key || hiddenTags.has(normalizedTag.key) || tagMap.has(normalizedTag.key)) return;
        tagMap.set(normalizedTag.key, {
            ...normalizedTag,
            description: normalizedTag.description || '来自用户管理 Tags',
            source: normalizedTag.source || 'manual'
        });
    });
    return {
        ...normalizedCenter,
        tags: Array.from(tagMap.values()).slice(0, 120)
    };
}

function getDefaultTagCenter() {
    return {
        sources: [
            'manual',
            'profile_metadata',
            'auth_metadata',
            'purchase',
            'wallet',
            'behavior',
            'support'
        ],
        tags: [
            normalizeTagDefinition({
                key: 'paid_user',
                name: '已充值用户',
                description: '用户有过成功充值、购买或积分到账记录。',
                source: 'purchase',
                auto_rule: '支付成功、订单完成或积分充值到账后写入 paid_user'
            }),
            normalizeTagDefinition({
                key: 'high_value',
                name: '高价值用户',
                description: '累计消费或积分消耗达到站长设置的高价值阈值。',
                source: 'purchase',
                auto_rule: '累计消费达到阈值后写入 high_value'
            }),
            normalizeTagDefinition({
                key: 'payment_failed',
                name: '支付失败用户',
                description: '近期出现支付失败或订单未完成，需要引导重试或联系客服。',
                source: 'behavior',
                auto_rule: '支付失败事件写入 payment_failed，成功支付后可移除'
            }),
            normalizeTagDefinition({
                key: 'verify_failed',
                name: '验证失败用户',
                description: '验证任务失败或多次重试，需要展示验证帮助。',
                source: 'behavior',
                auto_rule: '验证失败事件写入 verify_failed'
            }),
            normalizeTagDefinition({
                key: 'inactive_user',
                name: '长期未活跃用户',
                description: '超过站长设置的未活跃天数后写入，用于回流提醒和唤醒优惠。',
                source: 'behavior',
                auto_rule: '公共页机器人记录最近活跃时间，超过阈值后写入 inactive_user，用户回来后移除'
            })
        ],
        automation: {
            high_value: {
                enabled: true,
                min_paid_amount: 500,
                min_points: 5000,
                min_order_count: 5
            },
            payment_failed: {
                enabled: true,
                window_days: 7,
                min_count: 1
            },
            verify_failed: {
                enabled: true,
                window_days: 7,
                min_count: 1
            },
            inactive: {
                enabled: false,
                inactive_days: 30
            }
        },
        updated_at: ''
    };
}

function normalizeTagAutomation(value = {}) {
    const defaults = getDefaultTagCenter().automation;
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        high_value: {
            enabled: normalizeBoolean(source.high_value?.enabled, defaults.high_value.enabled),
            min_paid_amount: normalizeNumber(source.high_value?.min_paid_amount ?? source.high_value?.minPaidAmount, defaults.high_value.min_paid_amount, 0, 1000000),
            min_points: normalizeNumber(source.high_value?.min_points ?? source.high_value?.minPoints, defaults.high_value.min_points, 0, 100000000),
            min_order_count: normalizeNumber(source.high_value?.min_order_count ?? source.high_value?.minOrderCount, defaults.high_value.min_order_count, 0, 100000)
        },
        payment_failed: {
            enabled: normalizeBoolean(source.payment_failed?.enabled, defaults.payment_failed.enabled),
            window_days: normalizeNumber(source.payment_failed?.window_days ?? source.payment_failed?.windowDays, defaults.payment_failed.window_days, 1, 365),
            min_count: normalizeNumber(source.payment_failed?.min_count ?? source.payment_failed?.minCount, defaults.payment_failed.min_count, 1, 1000)
        },
        verify_failed: {
            enabled: normalizeBoolean(source.verify_failed?.enabled, defaults.verify_failed.enabled),
            window_days: normalizeNumber(source.verify_failed?.window_days ?? source.verify_failed?.windowDays, defaults.verify_failed.window_days, 1, 365),
            min_count: normalizeNumber(source.verify_failed?.min_count ?? source.verify_failed?.minCount, defaults.verify_failed.min_count, 1, 1000)
        },
        inactive: {
            enabled: normalizeBoolean(source.inactive?.enabled, defaults.inactive.enabled),
            inactive_days: normalizeNumber(source.inactive?.inactive_days ?? source.inactive?.inactiveDays, defaults.inactive.inactive_days, 1, 3650)
        }
    };
}

function normalizeTagCenter(value = {}) {
    const defaults = getDefaultTagCenter();
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const hiddenUserTags = normalizeStringArray(source.hidden_user_tags || source.hiddenUserTags || [], 120)
        .map((item) => normalizeTagKey(item, ''))
        .filter(Boolean);
    const hiddenTagSet = new Set(hiddenUserTags);
    const tagMap = new Map(defaults.tags
        .filter((tag) => !hiddenTagSet.has(tag.key))
        .map((tag) => [tag.key, tag]));
    if (Array.isArray(source.tags)) {
        source.tags.map(normalizeTagDefinition).forEach((tag) => {
            if (hiddenTagSet.has(tag.key)) return;
            tagMap.set(tag.key, tag);
        });
    }
    const tags = Array.from(tagMap.values());
    const sources = normalizeStringArray(source.sources || defaults.sources, 80)
        .map((item) => normalizeToken(item, ''))
        .filter((item) => VALID_TAG_SOURCES.has(item));
    return {
        sources: sources.length ? sources : defaults.sources,
        tags: Array.from(new Map(tags.map((tag) => [tag.key, tag])).values()).slice(0, 80),
        hidden_user_tags: Array.from(hiddenTagSet).slice(0, 240),
        automation: normalizeTagAutomation(source.automation || {}),
        updated_at: sanitizeText(source.updated_at, 120)
    };
}

function normalizeSegment(row = {}) {
    const definition = normalizeDefinition(row.definition);
    return {
        id: sanitizeText(row.id, 160),
        key: sanitizeText(row.key, 160),
        site: normalizeEngagementConfigSite(row.site || 'all', { allowAll: true, fallback: 'all' }),
        name: sanitizeText(row.name || '未命名分群', 160) || '未命名分群',
        title: sanitizeText(row.name || '未命名分群', 160) || '未命名分群',
        description: sanitizeText(row.description, 800),
        desc: sanitizeText(row.description, 800),
        definition,
        enabled: row.enabled !== false,
        scope: sanitizeText(definition.scope || row.key || 'all', 80) || 'all',
        icon: sanitizeText(definition.icon || 'fa-users', 80) || 'fa-users',
        pageIds: normalizeStringArray(definition.page_ids || definition.pageIds || ['all']),
        examples: normalizeStringArray(definition.examples || [], 120),
        emails: normalizeEmailArray(definition.email_targets || definition.emails || []),
        tags: normalizeStringArray(definition.tag_targets || definition.tags || [], 80),
        updated_at: sanitizeText(row.updated_at, 120),
        created_at: sanitizeText(row.created_at, 120)
    };
}

function buildSegmentPayload(body = {}, site = 'cn') {
    const name = sanitizeText(body.name || body.title, 160);
    if (!name) {
        const error = new Error('分群名称不能为空');
        error.statusCode = 400;
        throw error;
    }
    const key = slugify(body.key || body.scope || name, 'segment');
    const definition = normalizeDefinition(body.definition);
    return {
        key,
        site: normalizeEngagementConfigSite(body.site || site, { fallback: 'cn' }),
        name,
        description: sanitizeText(body.description || body.desc, 800),
        definition: {
            ...definition,
            scope: sanitizeText(body.scope || definition.scope || key, 80) || key,
            icon: sanitizeText(body.icon || definition.icon || 'fa-users', 80) || 'fa-users',
            page_ids: normalizeStringArray(body.page_ids || body.pageIds || definition.page_ids || definition.pageIds || ['all']),
            examples: normalizeStringArray(body.examples || definition.examples || [], 120),
            emails: normalizeEmailArray(body.email_targets || body.emails || definition.email_targets || definition.emails || []),
            tags: normalizeStringArray(body.tag_targets || body.tags || definition.tag_targets || definition.tags || [], 80)
        },
        enabled: normalizeBoolean(body.enabled, true)
    };
}

function segmentMatchesSite(row = {}, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    if (normalizedSite === 'all') return true;
    const rowSite = normalizeEngagementConfigSite(row.site || 'all', { allowAll: true, fallback: 'all' });
    return rowSite === 'all' || rowSite === normalizedSite;
}

function compareSegmentSitePriority(left = {}, right = {}, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    if (normalizedSite === 'all') return 0;
    const siteRank = (row) => (
        normalizeEngagementConfigSite(row.site || 'all', { allowAll: true, fallback: 'all' }) === normalizedSite ? 1 : 0
    );
    return siteRank(left) - siteRank(right);
}

function applySegmentsSiteFilter(query, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    if (normalizedSite === 'all' || typeof query?.in !== 'function') {
        return query;
    }
    return query.in('site', ['all', normalizedSite]);
}

async function listSegments(supabase, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    let query = supabase
        .from('engagement_segments')
        .select('id,key,site,name,description,definition,enabled,created_at,updated_at');
    query = applySegmentsSiteFilter(query, normalizedSite);
    let { data, error } = await query
        .order('updated_at', { ascending: false })
        .limit(100);
    if (error && isMissingRelationOrColumnError(error, 'engagement_segments')) {
        const fallbackResponse = await supabase
            .from('engagement_segments')
            .select('id,key,name,description,definition,enabled,created_at,updated_at')
            .order('updated_at', { ascending: false })
            .limit(100);
        data = fallbackResponse.data;
        error = fallbackResponse.error;
    }
    if (error) throw error;
    return (Array.isArray(data) ? data : [])
        .filter((row) => segmentMatchesSite(row, normalizedSite))
        .sort((left, right) => compareSegmentSitePriority(left, right, normalizedSite))
        .map(normalizeSegment);
}

async function loadTagCenter(supabase, options = {}) {
    const includeUserTags = options.includeUserTags === true;
    const site = normalizeEngagementConfigSite(options.site || 'cn', { fallback: 'cn' });
    const tagCenter = await loadSiteScopedConfig(
        supabase,
        TAG_CENTER_CONFIG_KEY,
        site,
        normalizeTagCenter,
        {}
    );
    if (!includeUserTags) {
        return tagCenter;
    }
    const userTags = await listKnownUserTagDefinitions(supabase, { limit: 5000 });
    return mergeTagCenterWithUserTags(tagCenter, userTags);
}

async function saveTagCenter({ supabase, user, body, site = 'cn' }) {
    const normalizedSite = normalizeEngagementConfigSite(body.site || site, { fallback: 'cn' });
    const current = await loadTagCenter(supabase, {
        includeUserTags: false,
        site: normalizedSite
    });
    const action = normalizeToken(body.action, 'save_tag');
    let nextCenter = current;

    if (action === 'delete_tag') {
        const tagKey = normalizeTagKey(body.key || body.id || body.tag_key || body.tagKey, '');
        if (!tagKey) {
            const error = new Error('tag key is required');
            error.statusCode = 400;
            throw error;
        }
        nextCenter = {
            ...current,
            hidden_user_tags: [...new Set([...(current.hidden_user_tags || []), tagKey].filter(Boolean))],
            tags: current.tags.filter((tag) => tag.key !== tagKey)
        };
    } else if (action === 'sync_user_tags') {
        const userTags = await listKnownUserTagDefinitions(supabase, { limit: 5000 });
        const tagMap = new Map(current.tags.map((item) => [item.key, item]));
        const syncedTagKeys = new Set();
        userTags.map(normalizeTagDefinition).forEach((tag) => {
            if (!tag.key) return;
            syncedTagKeys.add(tag.key);
            tagMap.set(tag.key, tag);
        });
        nextCenter = {
            ...current,
            hidden_user_tags: (current.hidden_user_tags || []).filter((key) => !syncedTagKeys.has(key)),
            tags: Array.from(tagMap.values())
        };
    } else if (action === 'save_tag_center') {
        nextCenter = normalizeTagCenter(body.tag_center || body.tagCenter || body);
    } else {
        const tag = normalizeTagDefinition(body.tag || body);
        const previousKey = normalizeTagKey(body.id || body.tag_id || body.tagId, '');
        const tagMap = new Map(current.tags.map((item) => [item.key, item]));
        if (previousKey && previousKey !== tag.key) {
            tagMap.delete(previousKey);
        }
        tagMap.set(tag.key, tag);
        nextCenter = {
            ...current,
            hidden_user_tags: (current.hidden_user_tags || []).filter((key) => key !== tag.key),
            tags: Array.from(tagMap.values())
        };
    }

    const payload = {
        ...normalizeTagCenter(nextCenter),
        updated_at: new Date().toISOString()
    };

    await saveSiteScopedConfig({
        supabase,
        key: TAG_CENTER_CONFIG_KEY,
        site: normalizedSite,
        value: payload,
        description: '客服系统用户标签中心配置',
        userId: user.id
    });

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        actionType: `engagement.segment_tags.${action}`,
        details: {
            config_key: TAG_CENTER_CONFIG_KEY,
            site: normalizedSite,
            tag_count: payload.tags.length,
            tag_key: sanitizeText(body.key || body.id || body.tag_key || body.tagKey || body.tag?.key, 120)
        }
    });

    return payload;
}

async function persistSegmentPayload(supabase, id, payload, includeSite = true) {
    const { site, ...legacyPayload } = payload;
    const nextPayload = includeSite ? payload : legacyPayload;
    const query = id
        ? supabase.from('engagement_segments').update(nextPayload).eq('id', id)
        : supabase.from('engagement_segments').insert(nextPayload);
    return query
        .select(includeSite
            ? 'id,key,site,name,description,definition,enabled,created_at,updated_at'
            : 'id,key,name,description,definition,enabled,created_at,updated_at')
        .single();
}

async function saveSegment({ supabase, user, body, site = 'cn' }) {
    const rawId = sanitizeText(body.id || body.segment_id || body.segmentId, 160);
    const id = isUuid(rawId) ? rawId : '';
    const normalizedSite = normalizeEngagementConfigSite(body.site || site, { fallback: 'cn' });
    const payload = buildSegmentPayload(body, normalizedSite);
    let { data, error } = await persistSegmentPayload(supabase, id, payload, true);
    if (error && isMissingRelationOrColumnError(error, 'engagement_segments')) {
        const fallbackResponse = await persistSegmentPayload(supabase, id, payload, false);
        data = fallbackResponse.data;
        error = fallbackResponse.error;
    }
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        actionType: id ? 'engagement.segment.update' : 'engagement.segment.create',
        details: {
            segment_id: data?.id || id,
            site: normalizedSite,
            key: payload.key,
            name: payload.name,
            enabled: payload.enabled
        }
    });

    return normalizeSegment(data);
}

async function deleteSegment({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.segment_id || body.segmentId, 160);
    if (!id) {
        const error = new Error('segment id is required');
        error.statusCode = 400;
        throw error;
    }
    if (!isUuid(id)) {
        const error = new Error('segment id must be a valid uuid');
        error.statusCode = 400;
        throw error;
    }
    const { data, error } = await supabase
        .from('engagement_segments')
        .delete()
        .eq('id', id)
        .select('id,key,name')
        .maybeSingle();
    if (error) throw error;
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        actionType: 'engagement.segment.delete',
        details: {
            segment_id: id,
            key: data?.key,
            name: data?.name
        }
    });
    return { id };
}

module.exports = async function engagementSegmentsHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });
        const url = new URL(req.url || '', 'http://localhost');

        if (req.method === 'GET') {
            const site = resolveEngagementConfigRequestSite(req, url, {
                allowAll: true,
                fallback: 'cn'
            });
            const [segments, tagCenter] = await Promise.all([
                listSegments(supabase, site),
                loadTagCenter(supabase, { site })
            ]);
            return sendJson(res, 200, {
                success: true,
                site,
                segments,
                tag_center: tagCenter
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
        const site = normalizeEngagementConfigSite(body.site || url.searchParams.get('site') || req.adminSite, {
            fallback: 'cn'
        });
        const action = sanitizeText(body.action || 'save', 40).toLowerCase();
        if (action === 'delete') {
            const result = await deleteSegment({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                site,
                deleted: result.id
            });
        }
        if (action === 'save_tag' || action === 'delete_tag' || action === 'save_tag_center' || action === 'sync_user_tags') {
            const tagCenter = await saveTagCenter({ supabase, user, body, site });
            return sendJson(res, 200, {
                success: true,
                site,
                tag_center: tagCenter
            });
        }
        if (action === 'run_inactive_sweep') {
            const result = await sweepInactiveUserTags(supabase, {
                limit: body.limit || 500,
                createdBy: user.id,
                site
            });
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'engagement',
                actionType: 'engagement.segment_tags.run_inactive_sweep',
                details: {
                    site,
                    tagged: result.tagged || 0,
                    cutoff_at: result.cutoff_at || '',
                    skipped: result.skipped || ''
                }
            });
            return sendJson(res, 200, {
                success: true,
                site,
                sweep: result
            });
        }

        const segment = await saveSegment({ supabase, user, body, site });
        return sendJson(res, 200, {
            success: true,
            site,
            segment
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to manage engagement segments'
        });
    }
};
