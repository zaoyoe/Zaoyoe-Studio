const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    listActiveAdminUserIds,
    notifyUsers
} = require('../../../../api/_lib/admin-notifications');

const SYSTEM_CONFIG_DOMAIN_KEY_MAP = Object.freeze({
    commerce: [
        'unlock_pricing',
        'recharge_options',
        'channels',
        'payment_channels'
    ],
    affiliate: [
        'affiliate_program',
        'affiliate_poster',
        'rewards',
        'checkin_system'
    ],
    governance: [
        'security',
        'notifications',
        'moderation',
        'gallery',
        'comments'
    ],
    growth: [
        'seo',
        'performance',
        'analytics_preferences',
        'integrations'
    ],
    verify: [
        'verify_settings'
    ]
});

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function uniqueValues(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function listAllAllowedConfigKeys() {
    return uniqueValues(Object.values(SYSTEM_CONFIG_DOMAIN_KEY_MAP).flat());
}

function normalizeRequestedDomains(value) {
    const values = Array.isArray(value) ? value : [value];
    const normalized = uniqueValues(values.map((entry) => sanitizeText(entry, 80).toLowerCase()).filter(Boolean));
    return normalized.length ? normalized : ['all'];
}

function resolveConfigKeysForDomains(domains = []) {
    const normalizedDomains = normalizeRequestedDomains(domains);
    if (normalizedDomains.includes('all')) {
        return listAllAllowedConfigKeys();
    }

    return uniqueValues(
        normalizedDomains.flatMap((domain) => SYSTEM_CONFIG_DOMAIN_KEY_MAP[domain] || [])
    );
}

async function fetchSystemConfigRows(supabase, keys = []) {
    const normalizedKeys = uniqueValues((Array.isArray(keys) ? keys : []).map((key) => sanitizeText(key, 120)));
    if (!normalizedKeys.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('system_config')
        .select('config_key, config_value, updated_at')
        .in('config_key', normalizedKeys)
        .order('config_key', { ascending: true });

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

function buildDomainMeta() {
    return Object.fromEntries(
        Object.entries(SYSTEM_CONFIG_DOMAIN_KEY_MAP).map(([domain, keys]) => [domain, [...keys]])
    );
}

function normalizeAnnouncementPages(value) {
    const pages = uniqueValues(
        (Array.isArray(value) ? value : [value])
            .map((entry) => sanitizeText(entry, 80).toLowerCase())
            .map((entry) => {
                if (entry === 'home' || entry === 'homepage' || entry === '/') {
                    return 'index';
                }
                return entry;
            })
            .filter(Boolean)
    );

    if (!pages.length || pages.includes('all')) {
        return ['all'];
    }

    return pages;
}

function normalizeAnnouncementState(configValue = {}) {
    const config = configValue && typeof configValue === 'object' && !Array.isArray(configValue)
        ? configValue
        : {};

    return {
        enabled: config.announcement_enabled === true,
        content: sanitizeText(config.announcement_content, 12000),
        type: sanitizeText(config.announcement_type, 80).toLowerCase() || 'banner',
        pages: normalizeAnnouncementPages(config.announcement_pages)
    };
}

function hasAnnouncementStateChanged(previousConfig = {}, nextConfig = {}) {
    const previousState = normalizeAnnouncementState(previousConfig);
    const nextState = normalizeAnnouncementState(nextConfig);

    return previousState.enabled !== nextState.enabled
        || previousState.content !== nextState.content
        || previousState.type !== nextState.type
        || JSON.stringify(previousState.pages) !== JSON.stringify(nextState.pages);
}

function getAnnouncementTypeLabel(type = 'banner') {
    if (type === 'modal') {
        return '弹窗公告';
    }
    if (type === 'toast') {
        return '浮层提示';
    }
    return '横幅公告';
}

function getAnnouncementPageLabels(pages = []) {
    const pageLabelMap = {
        all: '全部页面',
        prompts: '图库',
        index: '主页',
        shop: '商城',
        verify: '验证',
        guestbook: '留言'
    };

    return normalizeAnnouncementPages(pages).map((page) => pageLabelMap[page] || page);
}

function extractAnnouncementPreviewText(content = '', maxLength = 72) {
    const plainText = sanitizeText(String(content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n'), 12000)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!plainText) {
        return '';
    }

    return plainText.length > maxLength
        ? `${plainText.slice(0, Math.max(1, maxLength - 1)).trim()}...`
        : plainText;
}

async function notifyActiveAdminsAboutAnnouncementChange(supabase, user, previousConfig = {}, nextConfig = {}) {
    if (!hasAnnouncementStateChanged(previousConfig, nextConfig)) {
        return {
            recipients: 0,
            created: 0,
            skipped: 0
        };
    }

    const actorUserId = sanitizeText(user?.id, 160);
    const actorLabel = sanitizeText(user?.email, 320) || '某位管理员';
    const recipientIds = (await listActiveAdminUserIds(supabase)).filter((userId) => userId && userId !== actorUserId);

    if (!recipientIds.length) {
        return {
            recipients: 0,
            created: 0,
            skipped: 0
        };
    }

    const previousState = normalizeAnnouncementState(previousConfig);
    const nextState = normalizeAnnouncementState(nextConfig);
    const announcementTypeLabel = getAnnouncementTypeLabel(nextState.type);
    const pageLabels = getAnnouncementPageLabels(nextState.pages);
    const previewText = extractAnnouncementPreviewText(nextState.content);

    let title = '站内公告已更新';
    let actionLabel = '更新';
    if (nextState.enabled && !previousState.enabled) {
        title = '站内公告已发布';
        actionLabel = '发布';
    } else if (!nextState.enabled && previousState.enabled) {
        title = '站内公告已下线';
        actionLabel = '下线';
    } else if (!nextState.enabled) {
        title = '站内公告设置已更新';
        actionLabel = '调整';
    }

    const lines = [
        `${actorLabel} 刚刚${actionLabel}了站内公告。`,
        `当前状态：${nextState.enabled ? '已启用' : '已关闭'}`,
        `展示形态：${announcementTypeLabel}`,
        `显示页面：${pageLabels.join(' / ')}`
    ];
    if (previewText) {
        lines.push(`公告摘要：${previewText}`);
    }

    return notifyUsers(supabase, {
        userIds: recipientIds,
        title,
        content: lines.join('\n'),
        type: nextState.enabled ? 'info' : 'warning',
        scope: 'admin_personal',
        category: 'announcement',
        dedupeWindowMinutes: 20
    });
}

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const { supabase } = await requireAdmin(req, { permission: 'settings.manage' });
            const url = new URL(req.url || '', 'http://localhost');
            const domains = normalizeRequestedDomains(url.searchParams.getAll('domain'));
            const keys = resolveConfigKeysForDomains(domains);
            const rows = await fetchSystemConfigRows(supabase, keys);

            return sendJson(res, 200, {
                success: true,
                domains,
                keys,
                meta: buildDomainMeta(),
                configs: rows.reduce((accumulator, row) => {
                    accumulator[row.config_key] = row.config_value;
                    return accumulator;
                }, {})
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { supabase, user } = await requireAdmin(req, { permission: 'settings.manage' });
        const body = await parseJsonBody(req);
        const key = sanitizeText(body.key, 120);
        const allowedKeys = listAllAllowedConfigKeys();
        const previousRows = await fetchSystemConfigRows(supabase, key ? [key] : []);
        const previousValue = previousRows[0]?.config_value;

        if (!key) {
            return sendJson(res, 400, {
                success: false,
                message: 'key is required'
            });
        }

        if (!allowedKeys.includes(key)) {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported system config key'
            });
        }

        const value = body.value;
        const { error } = await supabase
            .from('system_config')
            .upsert({
                config_key: key,
                config_value: value,
                updated_by: user.id,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'config_key'
            });

        if (error) {
            throw error;
        }

        let announcementNotification = null;
        let warning = '';
        if (key === 'notifications') {
            try {
                announcementNotification = await notifyActiveAdminsAboutAnnouncementChange(
                    supabase,
                    user,
                    previousValue,
                    value
                );
            } catch (notificationError) {
                warning = sanitizeText(notificationError?.message || 'Announcement notification failed', 400);
            }
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'settings',
            actionType: 'system_config.update',
            details: {
                config_key: key,
                config_value: value
            }
        });

        return sendJson(res, 200, {
            success: true,
            key,
            value,
            announcementNotification,
            warning
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'System config request failed'
        });
    }
};
