const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const ANNOUNCEMENT_TYPES = new Set(['banner', 'modal', 'toast']);
const ANNOUNCEMENT_SIZES = new Set(['small', 'medium', 'large']);
const ANNOUNCEMENT_STATUSES = new Set(['draft', 'pending_review', 'approved', 'rejected', 'archived']);
const ANNOUNCEMENT_PAGES = new Set(['all', 'prompts', 'index', 'shop', 'verify', 'guestbook']);

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeAnnouncementSite(value, fallback = 'all') {
    return normalizeAdminSite(value, { defaultValue: fallback }) || fallback;
}

function uniqueValues(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function normalizeAnnouncementPage(value) {
    const normalized = sanitizeText(value, 80).toLowerCase();
    if (normalized === 'home' || normalized === 'homepage' || normalized === '/') {
        return 'index';
    }
    return normalized;
}

function normalizeAnnouncementPages(value) {
    const pages = uniqueValues(
        (Array.isArray(value) ? value : [value])
            .map(normalizeAnnouncementPage)
            .filter((page) => ANNOUNCEMENT_PAGES.has(page))
    );

    if (!pages.length || pages.includes('all')) {
        return ['all'];
    }

    return pages;
}

function normalizeAnnouncementOverrides(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const output = {};

    Object.entries(source).forEach(([rawPage, rawConfig]) => {
        const page = normalizeAnnouncementPage(rawPage);
        if (!ANNOUNCEMENT_PAGES.has(page) || page === 'all') {
            return;
        }

        const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
            ? rawConfig
            : { content: rawConfig };
        const content = String(config.content ?? config.announcement_content ?? '').slice(0, 12000);
        if (!content.trim() && config.enabled !== false) {
            return;
        }

        output[page] = {
            enabled: config.enabled !== false,
            content,
            updated_at: sanitizeText(config.updated_at || config.announcement_updated_at, 120)
        };
    });

    return output;
}

function normalizeDateTime(value) {
    const text = sanitizeText(value, 120);
    if (!text) {
        return null;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date.toISOString();
}

function normalizeAnnouncementInput(input = {}, existing = {}) {
    const type = sanitizeText(input.type ?? input.announcement_type ?? existing.type, 80).toLowerCase();
    const size = sanitizeText(input.size ?? input.announcement_size ?? existing.size, 80).toLowerCase();
    const status = sanitizeText(input.status ?? existing.status, 80).toLowerCase();
    const priorityValue = Number(input.priority ?? existing.priority ?? 0);

    return {
        title: sanitizeText(input.title ?? existing.title ?? '未命名公告', 160) || '未命名公告',
        content: String(input.content ?? input.announcement_content ?? existing.content ?? '').slice(0, 12000),
        type: ANNOUNCEMENT_TYPES.has(type) ? type : 'banner',
        color: sanitizeText(input.color ?? input.announcement_color ?? existing.color ?? 'purple', 80).toLowerCase() || 'purple',
        size: ANNOUNCEMENT_SIZES.has(size) ? size : 'medium',
        decoration: sanitizeText(input.decoration ?? input.announcement_decoration ?? existing.decoration ?? 'none', 80).toLowerCase() || 'none',
        theme: (() => {
            const raw = sanitizeText(input.theme ?? input.announcement_theme ?? existing.theme ?? 'auto', 40).toLowerCase();
            return ['auto', 'light', 'dark'].includes(raw) ? raw : 'auto';
        })(),
        pages: normalizeAnnouncementPages(input.pages ?? input.announcement_pages ?? existing.pages ?? ['all']),
        page_overrides: normalizeAnnouncementOverrides(input.page_overrides ?? input.announcement_page_overrides ?? existing.page_overrides),
        enabled: input.enabled ?? input.announcement_enabled ?? existing.enabled ?? false,
        priority: Number.isFinite(priorityValue)
            ? Math.max(-1000, Math.min(1000, Math.round(priorityValue)))
            : 0,
        status: ANNOUNCEMENT_STATUSES.has(status) ? status : 'draft',
        starts_at: normalizeDateTime(input.starts_at ?? existing.starts_at),
        ends_at: normalizeDateTime(input.ends_at ?? existing.ends_at)
    };
}

function normalizeAnnouncementRow(row = {}) {
    return {
        id: row.id,
        site: normalizeAnnouncementSite(row.site, 'cn'),
        title: row.title || '未命名公告',
        content: row.content || '',
        type: row.type || 'banner',
        color: row.color || 'purple',
        size: row.size || 'medium',
        decoration: row.decoration || 'none',
        theme: (() => {
            const raw = String(row.theme || 'auto').trim().toLowerCase();
            return ['auto', 'light', 'dark'].includes(raw) ? raw : 'auto';
        })(),
        pages: normalizeAnnouncementPages(row.pages || ['all']),
        page_overrides: normalizeAnnouncementOverrides(row.page_overrides || {}),
        enabled: row.enabled === true,
        priority: Number(row.priority || 0),
        status: ANNOUNCEMENT_STATUSES.has(row.status) ? row.status : 'draft',
        starts_at: row.starts_at || null,
        ends_at: row.ends_at || null,
        submitted_by: row.submitted_by || null,
        submitted_at: row.submitted_at || null,
        approved_by: row.approved_by || null,
        approved_at: row.approved_at || null,
        rejected_by: row.rejected_by || null,
        rejected_at: row.rejected_at || null,
        rejection_reason: row.rejection_reason || '',
        archived_by: row.archived_by || null,
        archived_at: row.archived_at || null,
        created_by: row.created_by || null,
        updated_by: row.updated_by || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
    };
}

function getActorLabel(user = {}) {
    return sanitizeText(user.email || user.user_metadata?.name || user.id || '管理员', 240);
}

function isMissingAnnouncementTableError(error) {
    const text = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ');
    return error?.code === '42P01'
        || error?.code === 'PGRST205'
        || /could not find the table .*announcement_(rules|history|reads)/i.test(text)
        || /relation .*announcement_(rules|history|reads).* does not exist/i.test(text)
        || (/schema cache/i.test(text) && /announcement_(rules|history|reads)/i.test(text));
}

function isMissingAnnouncementSiteColumnError(error) {
    const text = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ');
    return error?.code === '42703'
        || /column .*site.* does not exist/i.test(text)
        || /could not find .*site.*announcement_rules/i.test(text)
        || (/schema cache/i.test(text) && /announcement_rules/i.test(text) && /site/i.test(text));
}

function filterAnnouncementRowsBySite(rows = [], site = 'all') {
    const normalizedSite = normalizeAnnouncementSite(site, 'all');
    if (normalizedSite === 'all') {
        return rows;
    }

    return rows.filter((row) => normalizeAnnouncementSite(row.site, 'cn') === normalizedSite);
}

async function fetchAnnouncementRows(supabase, options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 80)));
    const site = normalizeAnnouncementSite(options.site, 'all');
    const buildQuery = (withSiteFilter = true) => {
        let query = supabase
            .from('announcement_rules')
            .select('*')
            .order('priority', { ascending: false })
            .order('updated_at', { ascending: false })
            .limit(limit);

        if (options.status) {
            query = query.eq('status', options.status);
        }
        if (withSiteFilter && site !== 'all') {
            query = query.eq('site', site);
        }

        return query;
    };
    let { data, error } = await buildQuery(true);
    let usedLegacyFallback = false;
    if (error && site !== 'all' && isMissingAnnouncementSiteColumnError(error)) {
        ({ data, error } = await buildQuery(false));
        usedLegacyFallback = true;
    }
    if (error) {
        throw error;
    }
    const rows = Array.isArray(data) ? data.map(normalizeAnnouncementRow) : [];
    return usedLegacyFallback ? filterAnnouncementRowsBySite(rows, site) : rows;
}

async function fetchAnnouncementByID(supabase, id, site = 'all') {
    const announcementId = sanitizeText(id, 80);
    if (!announcementId) {
        return null;
    }
    const normalizedSite = normalizeAnnouncementSite(site, 'all');

    const buildQuery = (withSiteFilter = true) => {
        let query = supabase
            .from('announcement_rules')
            .select('*')
            .eq('id', announcementId);
        if (withSiteFilter && normalizedSite !== 'all') {
            query = query.eq('site', normalizedSite);
        }
        return query.maybeSingle();
    };

    let { data, error } = await buildQuery(true);
    let usedLegacyFallback = false;
    if (error && normalizedSite !== 'all' && isMissingAnnouncementSiteColumnError(error)) {
        ({ data, error } = await buildQuery(false));
        usedLegacyFallback = true;
    }

    if (error) {
        throw error;
    }

    const row = data ? normalizeAnnouncementRow(data) : null;
    if (!row || !usedLegacyFallback) {
        return row;
    }
    return filterAnnouncementRowsBySite([row], normalizedSite)[0] || null;
}

async function fetchAnnouncementHistory(supabase, announcementIds = []) {
    const ids = uniqueValues((Array.isArray(announcementIds) ? announcementIds : []).map((id) => sanitizeText(id, 80)));
    if (!ids.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('announcement_history')
        .select('*')
        .in('announcement_id', ids)
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function fetchAnnouncementReadRows(supabase, announcementIds = []) {
    const ids = uniqueValues((Array.isArray(announcementIds) ? announcementIds : []).map((id) => sanitizeText(id, 80)));
    if (!ids.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('announcement_reads')
        .select('announcement_id,page,event_type,reader_key,created_at')
        .in('announcement_id', ids)
        .limit(20000);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

function buildAnnouncementStats(readRows = []) {
    const stats = {};

    (Array.isArray(readRows) ? readRows : []).forEach((row) => {
        const id = sanitizeText(row.announcement_id, 80);
        if (!id) return;

        if (!stats[id]) {
            stats[id] = {
                views: 0,
                reads: 0,
                dismisses: 0,
                by_page: {},
                latest_event_at: null
            };
        }

        const eventType = sanitizeText(row.event_type, 40);
        const page = normalizeAnnouncementPage(row.page) || 'unknown';
        if (!stats[id].by_page[page]) {
            stats[id].by_page[page] = { views: 0, reads: 0, dismisses: 0 };
        }

        if (eventType === 'view') {
            stats[id].views += 1;
            stats[id].by_page[page].views += 1;
        } else if (eventType === 'dismiss') {
            stats[id].dismisses += 1;
            stats[id].by_page[page].dismisses += 1;
        } else {
            stats[id].reads += 1;
            stats[id].by_page[page].reads += 1;
        }

        if (!stats[id].latest_event_at || String(row.created_at || '') > stats[id].latest_event_at) {
            stats[id].latest_event_at = row.created_at || null;
        }
    });

    Object.values(stats).forEach((item) => {
        item.read_rate = item.views > 0 ? item.reads / item.views : 0;
    });

    return stats;
}

async function insertAnnouncementHistory(supabase, {
    announcement,
    action,
    fromStatus = '',
    toStatus = '',
    user,
    note = ''
}) {
    if (!announcement?.id) {
        return null;
    }

    const payload = {
        announcement_id: announcement.id,
        action: sanitizeText(action, 80),
        from_status: sanitizeText(fromStatus, 80) || null,
        to_status: sanitizeText(toStatus, 80) || null,
        actor_id: user?.id || null,
        actor_label: getActorLabel(user),
        note: sanitizeText(note, 1000),
        snapshot: announcement
    };

    const { error } = await supabase.from('announcement_history').insert(payload);
    if (error) {
        throw error;
    }

    return payload;
}

async function createAnnouncement(supabase, user, input = {}) {
    const site = normalizeAnnouncementSite(input.site, 'cn');
    const payload = {
        ...normalizeAnnouncementInput(input),
        site,
        created_by: user.id,
        updated_by: user.id
    };

    const { data, error } = await supabase
        .from('announcement_rules')
        .insert(payload)
        .select('*')
        .maybeSingle();

    if (error) {
        throw error;
    }

    const announcement = normalizeAnnouncementRow(data || payload);
    await insertAnnouncementHistory(supabase, {
        announcement,
        action: 'create',
        toStatus: announcement.status,
        user,
        note: input.note
    });

    return announcement;
}

async function updateAnnouncement(supabase, user, id, input = {}) {
    const site = normalizeAnnouncementSite(input.site, 'cn');
    const existing = await fetchAnnouncementByID(supabase, id, site);
    if (!existing) {
        const error = new Error('Announcement not found');
        error.statusCode = 404;
        throw error;
    }

    const payload = {
        ...normalizeAnnouncementInput(input, existing),
        updated_by: user.id
    };

    const { data, error } = await supabase
        .from('announcement_rules')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();

    if (error) {
        throw error;
    }

    const announcement = normalizeAnnouncementRow(data || { ...existing, ...payload });
    await insertAnnouncementHistory(supabase, {
        announcement,
        action: 'update',
        fromStatus: existing.status,
        toStatus: announcement.status,
        user,
        note: input.note
    });

    return announcement;
}

async function transitionAnnouncement(supabase, user, id, action, fields = {}) {
    const site = normalizeAnnouncementSite(fields.site, 'cn');
    const existing = await fetchAnnouncementByID(supabase, id, site);
    if (!existing) {
        const error = new Error('Announcement not found');
        error.statusCode = 404;
        throw error;
    }

    const now = new Date().toISOString();
    const payload = {
        updated_by: user.id
    };
    let nextStatus = existing.status;

    if (action === 'submit_review') {
        nextStatus = 'pending_review';
        payload.submitted_by = user.id;
        payload.submitted_at = now;
        payload.rejected_by = null;
        payload.rejected_at = null;
        payload.rejection_reason = null;
    } else if (action === 'approve') {
        nextStatus = 'approved';
        payload.approved_by = user.id;
        payload.approved_at = now;
        payload.rejected_by = null;
        payload.rejected_at = null;
        payload.rejection_reason = null;
        payload.enabled = fields.enabled !== false;
    } else if (action === 'reject') {
        nextStatus = 'rejected';
        payload.rejected_by = user.id;
        payload.rejected_at = now;
        payload.rejection_reason = sanitizeText(fields.reason || fields.note, 1000);
        payload.enabled = false;
    } else if (action === 'archive') {
        nextStatus = 'archived';
        payload.archived_by = user.id;
        payload.archived_at = now;
        payload.enabled = false;
    } else if (action === 'restore_draft') {
        nextStatus = 'draft';
        payload.enabled = false;
    }

    payload.status = nextStatus;

    const { data, error } = await supabase
        .from('announcement_rules')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();

    if (error) {
        throw error;
    }

    const announcement = normalizeAnnouncementRow(data || { ...existing, ...payload });
    await insertAnnouncementHistory(supabase, {
        announcement,
        action,
        fromStatus: existing.status,
        toStatus: announcement.status,
        user,
        note: fields.reason || fields.note
    });

    return announcement;
}

async function listResponse(supabase, options = {}) {
    const items = await fetchAnnouncementRows(supabase, options);
    const ids = items.map((item) => item.id).filter(Boolean);
    const [history, readRows] = await Promise.all([
        fetchAnnouncementHistory(supabase, ids),
        fetchAnnouncementReadRows(supabase, ids)
    ]);

    return {
        site: normalizeAnnouncementSite(options.site, 'all'),
        items,
        history,
        stats: buildAnnouncementStats(readRows)
    };
}

async function handleGet(req, res, supabase) {
    const url = new URL(req.url || '', 'http://localhost');
    const status = sanitizeText(url.searchParams.get('status'), 80).toLowerCase();
    const limit = Number(url.searchParams.get('limit') || 80);
    const site = normalizeAnnouncementSite(url.searchParams.get('site') || req.adminSite, 'all');
    const payload = await listResponse(supabase, {
        status: ANNOUNCEMENT_STATUSES.has(status) ? status : '',
        limit,
        site
    });

    return sendJson(res, 200, {
        success: true,
        ...payload
    });
}

module.exports = async function announcementSettingsHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method === 'GET') {
            return handleGet(req, res, supabase);
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action || 'save', 80).toLowerCase();
        const id = sanitizeText(body.id || body.announcement_id, 80);
        const site = requireWritableAdminSite(body.site || req.adminSite, { fieldName: 'site' });
        const actionBody = {
            ...body,
            site
        };
        let announcement;

        if (action === 'create' || (action === 'save' && !id)) {
            announcement = await createAnnouncement(supabase, user, {
                ...(body.announcement || body),
                site
            });
        } else if (action === 'update' || action === 'save') {
            announcement = await updateAnnouncement(supabase, user, id, {
                ...(body.announcement || body),
                site
            });
        } else if (['submit_review', 'approve', 'reject', 'archive', 'restore_draft'].includes(action)) {
            announcement = await transitionAnnouncement(supabase, user, id, action, actionBody);
        } else {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported announcement action'
            });
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'settings',
            actionType: `announcement.${action}`,
            details: {
                announcement_id: announcement.id,
                site,
                title: announcement.title,
                status: announcement.status
            }
        });

        const payload = await listResponse(supabase, { site });
        return sendJson(res, 200, {
            success: true,
            announcement,
            ...payload
        });
    } catch (error) {
        if (isMissingAnnouncementTableError(error)) {
            return sendJson(res, 503, {
                success: false,
                message: '公告审核、历史和阅读统计表还没有创建，请先执行公告迁移 SQL。'
            });
        }

        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Announcement settings request failed'
        });
    }
};
