const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    normalizeHomepageSite,
    normalizeHomepageSection,
    normalizeHomepageContent,
    buildHomepageRowRecord,
    mapHomepageRowsBySection,
    buildHomepageRowsFromSectionMap,
    mergeHomepageDraftRows,
    validateHomepageRow,
    buildHomepageReleasePayload,
    parseHomepageReleasePayload
} = require('./_shared');

const HOMEPAGE_MIGRATION_HINT = 'Homepage draft/publish migration is missing. Please run 20260410_homepage_drafts_and_releases.sql first.';

function normalizeHomepageReadSite(site) {
    if (site === 'intl') return 'intl';
    if (site === 'all') return 'all';
    return 'cn';
}

function isMissingHomepageDraftTable(error) {
    return Boolean(error?.message && /homepage_site_(drafts|releases)|relation .* does not exist/i.test(error.message));
}

function buildHomepageSelectQuery(supabase, site) {
    let query = supabase
        .from('homepage_config')
        .select('id, site, section, content, is_visible, display_order, updated_at')
        .order('display_order', { ascending: true });

    if (site !== 'all') {
        query = query.eq('site', site);
    }

    return query;
}

async function loadPublishedHomepageRows(supabase, site) {
    const { data, error } = await buildHomepageSelectQuery(supabase, site);
    if (error) {
        throw error;
    }

    return Array.isArray(data)
        ? data.map((row) => buildHomepageRowRecord(row)).filter((row) => row.section)
        : [];
}

async function loadHomepageDraft(supabase, site) {
    const query = supabase
        .from('homepage_site_drafts')
        .select('site, sections, updated_at, updated_by')
        .eq('site', site);
    const { data, error } = await (typeof query.maybeSingle === 'function'
        ? query.maybeSingle()
        : query.single());

    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        if (isMissingHomepageDraftTable(error)) {
            const migrationError = new Error(HOMEPAGE_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return data || null;
}

async function loadHomepageReleases(supabase, site, limit = 5) {
    let query = supabase
        .from('homepage_site_releases')
        .select('id, site, source, note, payload, published_at, published_by, rollback_from_release_id')
        .eq('site', site)
        .order('published_at', { ascending: false });

    if (typeof query.limit === 'function') {
        query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingHomepageDraftTable(error)) {
            const migrationError = new Error(HOMEPAGE_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadHomepageValidationContext(supabase) {
    const [
        shopCategories,
        shopProducts,
        guestbookMessages,
        promptPoolIds
    ] = await Promise.all([
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('shop_categories')
                    .select('name')
                    .order('sort_order', { ascending: true });

                if (error) {
                    return [];
                }

                return Array.isArray(data)
                    ? data.map((item) => String(item?.name || '').trim()).filter(Boolean)
                    : [];
            } catch (_error) {
                return [];
            }
        })(),
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('shop_products')
                    .select('id, is_active, stock_count, category, name')
                    .order('display_order', { ascending: false });

                if (error) {
                    return [];
                }

                return Array.isArray(data) ? data : [];
            } catch (_error) {
                return [];
            }
        })(),
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('guestbook_messages')
                    .select('id')
                    .order('created_at', { ascending: false })
                    .limit(100);

                if (error) {
                    return [];
                }

                return Array.isArray(data) ? data : [];
            } catch (_error) {
                return [];
            }
        })(),
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('prompts')
                    .select('id')
                    .order('updated_at', { ascending: false })
                    .limit(500);

                if (error) {
                    return [];
                }

                return Array.isArray(data)
                    ? data.map((item) => String(item?.id || '').trim()).filter(Boolean)
                    : [];
            } catch (_error) {
                return [];
            }
        })()
    ]);

    return {
        shopCategories,
        shopProducts,
        guestbookMessages,
        promptPoolIds
    };
}

async function buildHomepageHealth(supabase, rows = []) {
    const validationContext = await loadHomepageValidationContext(supabase);
    const sections = {};
    const errors = [];
    const warnings = [];

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const result = validateHomepageRow(row.section, row, validationContext);
        sections[row.section] = {
            errors: result.errors,
            warnings: result.warnings,
            row: result.row
        };

        result.errors.forEach((message) => {
            errors.push({
                section: row.section,
                message
            });
        });
        result.warnings.forEach((message) => {
            warnings.push({
                section: row.section,
                message
            });
        });
    });

    return {
        status: errors.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'healthy'),
        error_count: errors.length,
        warning_count: warnings.length,
        errors,
        warnings,
        sections
    };
}

function buildHomepageDraftResponse(site, draft, releases, publishedRows, mergedRows, health) {
    return {
        success: true,
        site,
        read_only: false,
        mode: 'site',
        rows: mergedRows,
        published_rows: publishedRows,
        draft: draft
            ? {
                exists: true,
                site,
                updated_at: draft.updated_at || null,
                updated_by: draft.updated_by || null
            }
            : {
                exists: false,
                site,
                updated_at: null,
                updated_by: null
            },
        releases,
        health
    };
}

function buildDraftUpsertPayload(site, sections, userId) {
    return {
        site,
        sections,
        updated_by: userId || null,
        updated_at: new Date().toISOString()
    };
}

function buildPublishedUpsertRows(rows = []) {
    return rows.map((row) => ({
        site: normalizeHomepageSite(row.site),
        section: row.section,
        content: normalizeHomepageContent(row.section, row.content),
        is_visible: row.is_visible !== false,
        display_order: row.display_order
    }));
}

function buildNextSectionDraft(section, previousRow, body = {}, site) {
    const nextRow = {
        ...(previousRow || {}),
        site,
        section,
        content: Object.prototype.hasOwnProperty.call(body, 'content')
            ? normalizeHomepageContent(section, body.content)
            : normalizeHomepageContent(section, previousRow?.content),
        is_visible: Object.prototype.hasOwnProperty.call(body, 'is_visible')
            ? body.is_visible !== false
            : previousRow?.is_visible !== false,
        display_order: Object.prototype.hasOwnProperty.call(body, 'display_order')
            ? Number.parseInt(body.display_order, 10) || 0
            : Number(previousRow?.display_order ?? 0) || 0
    };

    return buildHomepageRowRecord(nextRow);
}

async function upsertHomepageDraft(supabase, site, sections, userId) {
    const payload = buildDraftUpsertPayload(site, sections, userId);
    const { data, error } = await supabase
        .from('homepage_site_drafts')
        .upsert(payload, { onConflict: 'site' })
        .select('site, sections, updated_at, updated_by')
        .single();

    if (error) {
        if (isMissingHomepageDraftTable(error)) {
            const migrationError = new Error(HOMEPAGE_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return data || payload;
}

async function deleteHomepageDraft(supabase, site) {
    const { error } = await supabase
        .from('homepage_site_drafts')
        .delete()
        .eq('site', site);

    if (error && !isMissingHomepageDraftTable(error)) {
        throw error;
    }
}

async function insertHomepageRelease(supabase, site, payload, userId, options = {}) {
    const releasePayload = {
        site,
        payload,
        note: options.note || null,
        source: options.source || 'publish',
        published_by: userId || null,
        published_at: new Date().toISOString(),
        rollback_from_release_id: options.rollback_from_release_id || null
    };

    const { data, error } = await supabase
        .from('homepage_site_releases')
        .insert(releasePayload)
        .select('id, site, source, note, payload, published_at, published_by, rollback_from_release_id')
        .single();

    if (error) {
        if (isMissingHomepageDraftTable(error)) {
            const migrationError = new Error(HOMEPAGE_MIGRATION_HINT);
            migrationError.statusCode = 500;
            throw migrationError;
        }
        throw error;
    }

    return data || releasePayload;
}

async function upsertPublishedHomepageRows(supabase, rows) {
    const { data, error } = await supabase
        .from('homepage_config')
        .upsert(buildPublishedUpsertRows(rows), { onConflict: 'site,section' })
        .select('id, site, section, content, is_visible, display_order, updated_at');

    if (error) {
        throw error;
    }

    return Array.isArray(data)
        ? data.map((row) => buildHomepageRowRecord(row)).filter((row) => row.section)
        : rows;
}

async function handleLegacyUpdate(req, res, supabase, user, body) {
    const site = requireWritableAdminSite(body.site || req.adminSite, {
        fieldName: 'site'
    });
    const id = String(body.id || '').trim();
    const rawSection = String(body.section || '').trim().toLowerCase();
    const managedSection = normalizeHomepageSection(rawSection);
    const section = managedSection || rawSection;
    const updatePayload = {};

    if (!id) {
        return sendJson(res, 400, { success: false, message: 'id is required' });
    }

    if (!section) {
        return sendJson(res, 400, { success: false, message: 'section is required' });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'content')) {
        if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) {
            return sendJson(res, 400, { success: false, message: 'content must be an object' });
        }
        updatePayload.content = managedSection
            ? normalizeHomepageContent(managedSection, body.content)
            : body.content;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'is_visible')) {
        updatePayload.is_visible = body.is_visible !== false;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'display_order')) {
        const parsedOrder = Number.parseInt(body.display_order, 10);
        updatePayload.display_order = Number.isFinite(parsedOrder) ? parsedOrder : 0;
    }

    if (!Object.keys(updatePayload).length) {
        return sendJson(res, 400, { success: false, message: 'No homepage fields to update' });
    }

    const { data, error } = await supabase
        .from('homepage_config')
        .update(updatePayload)
        .eq('id', id)
        .eq('site', site)
        .eq('section', section)
        .select('id, site, section, content, is_visible, display_order, updated_at')
        .single();

    if (error || !data) {
        return sendJson(res, error?.code === 'PGRST116' ? 404 : 400, {
            success: false,
            message: error?.message || '保存首页配置失败'
        });
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user?.id,
        module: 'homepage',
        site,
        actionType: 'homepage.config.update',
        details: {
            row_id: data.id,
            section,
            changed_fields: Object.keys(updatePayload)
        }
    });

    return sendJson(res, 200, {
        success: true,
        site,
        row: managedSection ? buildHomepageRowRecord(data) : data
    });
}

async function handleSaveDraft(req, res, supabase, user, body) {
    const site = requireWritableAdminSite(body.site || req.adminSite, {
        fieldName: 'site'
    });
    const section = normalizeHomepageSection(body.section);

    if (!section) {
        return sendJson(res, 400, { success: false, message: 'section is required' });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'content')
        && (!body.content || typeof body.content !== 'object' || Array.isArray(body.content))) {
        return sendJson(res, 400, { success: false, message: 'content must be an object' });
    }

    const publishedRows = await loadPublishedHomepageRows(supabase, site);
    const publishedRowMap = mapHomepageRowsBySection(publishedRows);
    const draft = await loadHomepageDraft(supabase, site);
    const mergedRows = draft ? mergeHomepageDraftRows(publishedRows, draft.sections) : publishedRows;
    const mergedRowMap = mapHomepageRowsBySection(mergedRows);
    const nextRow = buildNextSectionDraft(
        section,
        mergedRowMap[section] || publishedRowMap[section],
        body,
        site
    );

    const draftSections = {
        ...(draft?.sections && typeof draft.sections === 'object' && !Array.isArray(draft.sections) ? draft.sections : {})
    };
    draftSections[section] = {
        content: nextRow.content,
        is_visible: nextRow.is_visible,
        display_order: nextRow.display_order
    };

    const savedDraft = await upsertHomepageDraft(supabase, site, draftSections, user?.id);
    const mergedDraftRows = mergeHomepageDraftRows(publishedRows, savedDraft.sections);
    const health = await buildHomepageHealth(supabase, mergedDraftRows);
    const releases = await loadHomepageReleases(supabase, site, 5);

    await writeAdminAuditLog({
        supabase,
        adminId: user?.id,
        module: 'homepage',
        site,
        actionType: 'homepage.draft.save',
        details: {
            section,
            changed_fields: ['content', 'is_visible', 'display_order'].filter((field) => Object.prototype.hasOwnProperty.call(body, field))
        }
    });

    return sendJson(res, 200, {
        ...buildHomepageDraftResponse(site, savedDraft, releases, publishedRows, mergedDraftRows, health),
        row: mapHomepageRowsBySection(mergedDraftRows)[section]
    });
}

async function handlePublish(req, res, supabase, user, body) {
    const site = requireWritableAdminSite(body.site || req.adminSite, {
        fieldName: 'site'
    });
    const publishedRows = await loadPublishedHomepageRows(supabase, site);
    const draft = await loadHomepageDraft(supabase, site);

    if (!draft?.sections) {
        return sendJson(res, 400, {
            success: false,
            message: '当前站点没有可发布的首页草稿'
        });
    }

    const mergedRows = mergeHomepageDraftRows(publishedRows, draft.sections);
    const health = await buildHomepageHealth(supabase, mergedRows);
    if (health.error_count > 0) {
        return sendJson(res, 400, {
            success: false,
            message: '当前草稿存在阻塞问题，无法发布',
            rows: mergedRows,
            published_rows: publishedRows,
            draft: {
                exists: true,
                site,
                updated_at: draft.updated_at || null,
                updated_by: draft.updated_by || null
            },
            health
        });
    }

    const savedRows = await upsertPublishedHomepageRows(supabase, mergedRows);
    const release = await insertHomepageRelease(
        supabase,
        site,
        buildHomepageReleasePayload(savedRows),
        user?.id,
        {
            note: body.note || null,
            source: 'publish'
        }
    );
    await deleteHomepageDraft(supabase, site);
    const releases = await loadHomepageReleases(supabase, site, 5);

    await writeAdminAuditLog({
        supabase,
        adminId: user?.id,
        module: 'homepage',
        site,
        actionType: 'homepage.publish',
        details: {
            release_id: release.id || null,
            section_count: savedRows.length
        }
    });

    return sendJson(res, 200, {
        success: true,
        site,
        rows: savedRows,
        published_rows: savedRows,
        draft: {
            exists: false,
            site,
            updated_at: null,
            updated_by: null
        },
        releases,
        release,
        health
    });
}

async function handleRollback(req, res, supabase, user, body) {
    const site = requireWritableAdminSite(body.site || req.adminSite, {
        fieldName: 'site'
    });
    const publishedRows = await loadPublishedHomepageRows(supabase, site);
    const releases = await loadHomepageReleases(supabase, site, 10);
    const requestedReleaseId = String(body.release_id || '').trim();

    let targetRelease = null;
    if (requestedReleaseId) {
        targetRelease = releases.find((item) => String(item?.id || '') === requestedReleaseId) || null;
    } else {
        targetRelease = releases[1] || releases[0] || null;
    }

    if (!targetRelease?.payload) {
        return sendJson(res, 404, {
            success: false,
            message: '未找到可回滚的首页发布版本'
        });
    }

    const rollbackRows = parseHomepageReleasePayload(targetRelease.payload, site, publishedRows);
    const health = await buildHomepageHealth(supabase, rollbackRows);
    if (health.error_count > 0) {
        return sendJson(res, 400, {
            success: false,
            message: '目标回滚版本存在阻塞问题，无法恢复',
            health
        });
    }

    const savedRows = await upsertPublishedHomepageRows(supabase, rollbackRows);
    const release = await insertHomepageRelease(
        supabase,
        site,
        buildHomepageReleasePayload(savedRows),
        user?.id,
        {
            note: body.note || `Rollback to release ${targetRelease.id}`,
            source: 'rollback',
            rollback_from_release_id: targetRelease.id || null
        }
    );
    await deleteHomepageDraft(supabase, site);
    const nextReleases = await loadHomepageReleases(supabase, site, 5);

    await writeAdminAuditLog({
        supabase,
        adminId: user?.id,
        module: 'homepage',
        site,
        actionType: 'homepage.rollback',
        details: {
            target_release_id: targetRelease.id || null,
            release_id: release.id || null
        }
    });

    return sendJson(res, 200, {
        success: true,
        site,
        rows: savedRows,
        published_rows: savedRows,
        draft: {
            exists: false,
            site,
            updated_at: null,
            updated_by: null
        },
        releases: nextReleases,
        release,
        rolled_back_to: {
            id: targetRelease.id || null,
            published_at: targetRelease.published_at || null
        },
        health
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'homepage.manage' });

        if (req.method === 'GET') {
            const site = normalizeHomepageReadSite(normalizeAdminSite(req.adminSite, { defaultValue: 'all' }) || 'all');
            const includeDraft = req.query?.include_draft === '1' || req.query?.includeDraft === '1';
            const publishedRows = await loadPublishedHomepageRows(supabase, site);

            if (site === 'all' || !includeDraft) {
                return sendJson(res, 200, {
                    success: true,
                    site,
                    read_only: site === 'all',
                    mode: site === 'all' ? 'aggregate' : 'site',
                    rows: publishedRows
                });
            }

            const draft = await loadHomepageDraft(supabase, site);
            const mergedRows = draft ? mergeHomepageDraftRows(publishedRows, draft.sections) : publishedRows;
            const releases = await loadHomepageReleases(supabase, site, 5);
            const health = await buildHomepageHealth(supabase, mergedRows);

            return sendJson(res, 200, buildHomepageDraftResponse(site, draft, releases, publishedRows, mergedRows, health));
        }

        const body = await parseJsonBody(req);
        const action = String(body.action || '').trim().toLowerCase();

        if (action === 'save_draft') {
            return await handleSaveDraft(req, res, supabase, user, body);
        }

        if (action === 'publish') {
            return await handlePublish(req, res, supabase, user, body);
        }

        if (action === 'rollback') {
            return await handleRollback(req, res, supabase, user, body);
        }

        return await handleLegacyUpdate(req, res, supabase, user, body);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Homepage config request failed'
        });
    }
};
