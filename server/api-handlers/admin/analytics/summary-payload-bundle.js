const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const summaryRowsBundleHandler = require('./summary-rows-bundle');
const {
    buildOverviewBusinessMixSummaryFromRows,
    buildVerifyServiceSummaryFromRows,
    buildGrowthSummaryFromRows
} = require('./_summary-row-builders');

const {
    TABLE_DEFINITIONS,
    buildRangeWindow,
    loadTableSegment
} = summaryRowsBundleHandler.__testUtils;

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function buildSummarySegment(requiredKeys = [], tables = {}, buildSummary = () => null) {
    const dependencyKeys = Array.isArray(requiredKeys) ? requiredKeys : [];
    const failedDependencies = dependencyKeys.filter((key) => !tables?.[key]?.ok);
    if (failedDependencies.length > 0) {
        const firstFailed = tables?.[failedDependencies[0]] || {};
        return {
            ok: false,
            statusCode: Number(firstFailed?.statusCode) || 500,
            message: String(firstFailed?.message || 'Analytics summary dependencies unavailable'),
            dependency_keys: dependencyKeys,
            failed_dependency_keys: failedDependencies,
            summary: null
        };
    }

    try {
        return {
            ok: true,
            statusCode: 200,
            message: '',
            dependency_keys: dependencyKeys,
            failed_dependency_keys: [],
            summary: buildSummary()
        };
    } catch (error) {
        return {
            ok: false,
            statusCode: Number(error?.statusCode) || 500,
            message: error?.message || 'Failed to build analytics summary payload',
            dependency_keys: dependencyKeys,
            failed_dependency_keys: [],
            summary: null
        };
    }
}

function collectVerificationSubmitterUserIds(rows = []) {
    return [...new Set((Array.isArray(rows) ? rows : [])
        .map((row) => String(row?.user_id || '').trim())
        .filter(Boolean))]
        .slice(0, 500);
}

function parseVerificationMessage(message) {
    if (message && typeof message === 'object' && !Array.isArray(message)) {
        return message;
    }

    const raw = String(message || '').trim();
    if (!raw || !raw.startsWith('{')) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch (_error) {
        return {};
    }
}

function getVerificationReferenceId(row = {}) {
    const payload = parseVerificationMessage(row?.message);
    return String(row?.verification_id || payload.job_id || payload.task_id || '').trim();
}

function buildLedgerSubmitterMap(rows = []) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const referenceId = String(row?.reference_id || '').trim();
        const userId = String(row?.user_id || '').trim();
        if (!referenceId || !userId || map.has(referenceId)) {
            return;
        }
        map.set(referenceId, userId);
    });
    return map;
}

function enrichVerificationRowsWithLedgerSubmitters(rows = [], ledgerRows = []) {
    const ledgerSubmitters = buildLedgerSubmitterMap(ledgerRows);
    if (!Array.isArray(rows) || rows.length === 0 || ledgerSubmitters.size === 0) {
        return Array.isArray(rows) ? rows : [];
    }

    return rows.map((row) => {
        if (String(row?.user_id || '').trim()) {
            return row;
        }
        const referenceId = getVerificationReferenceId(row);
        const userId = referenceId ? ledgerSubmitters.get(referenceId) : '';
        return userId ? { ...row, user_id: userId } : row;
    });
}

function isUuid(value = '') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function buildSubmitterProfileFromAuthUser(user = {}) {
    const metadata = user?.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
        ? user.user_metadata
        : {};
    return {
        id: String(user?.id || '').trim(),
        email: String(user?.email || '').trim(),
        username: String(metadata.username || metadata.name || '').trim(),
        display_name: String(metadata.display_name || metadata.full_name || metadata.name || '').trim()
    };
}

async function loadVerificationSubmitterProfiles(supabase, rows = []) {
    const userIds = collectVerificationSubmitterUserIds(rows);
    if (!userIds.length) return new Map();

    const profilesById = new Map();

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, email, username, display_name')
            .in('id', userIds);

        if (!error) {
            (Array.isArray(data) ? data : []).forEach((profile) => {
                const id = String(profile?.id || '').trim();
                if (id) {
                    profilesById.set(id, profile);
                }
            });
        }
    } catch (_error) {
        // Auth fallback below still gives us the website account email when profile rows lag behind.
    }

    const missingEmailIds = userIds
        .filter((id) => isUuid(id))
        .filter((id) => !String(profilesById.get(id)?.email || '').trim());
    if (!missingEmailIds.length || !supabase?.auth?.admin?.getUserById) {
        return profilesById;
    }

    const authProfiles = await Promise.all(missingEmailIds.map(async (id) => {
        try {
            const { data, error } = await supabase.auth.admin.getUserById(id);
            if (error || !data?.user) return null;
            return buildSubmitterProfileFromAuthUser(data.user);
        } catch (_error) {
            return null;
        }
    }));

    authProfiles.forEach((profile) => {
        const id = String(profile?.id || '').trim();
        const email = String(profile?.email || '').trim();
        if (!id || !email) return;
        profilesById.set(id, {
            ...(profilesById.get(id) || {}),
            ...profile
        });
    });

    return profilesById;
}

function enrichVerificationRowsWithSubmitters(rows = [], profilesById = new Map()) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    return rows.map((row) => {
        const userId = String(row?.user_id || '').trim();
        const profile = profilesById instanceof Map ? profilesById.get(userId) : null;
        if (!profile) return row;

        return {
            ...row,
            submitter: profile,
            submitter_email: profile.email || '',
            submitter_username: profile.username || '',
            submitter_display_name: profile.display_name || ''
        };
    });
}

module.exports = async function analyticsSummaryPayloadBundleHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'analytics.view' });
        const params = getQueryParams(req);
        const site = normalizeAdminSite(params.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';
        const rangeWindow = buildRangeWindow(params);
        const segmentOptions = {
            site,
            startIso: rangeWindow.startIso,
            endIso: rangeWindow.endIso
        };

        const [
            promptUnlocks,
            verificationLogs,
            guestbookMessages,
            guestbookComments,
            guestbookLikes,
            promptComments,
            pointsLedger
        ] = await Promise.all([
            loadTableSegment(supabase, TABLE_DEFINITIONS.promptUnlocks, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.verificationLogs, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.guestbookMessages, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.guestbookComments, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.guestbookLikes, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.promptComments, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.pointsLedger, segmentOptions)
        ]);

        const tables = {
            promptUnlocks,
            verificationLogs,
            guestbookMessages,
            guestbookComments,
            guestbookLikes,
            promptComments,
            pointsLedger
        };
        const verificationRowsWithLedgerSubmitters = verificationLogs.ok
            ? enrichVerificationRowsWithLedgerSubmitters(
                verificationLogs.rows || [],
                pointsLedger.rows || []
            )
            : [];
        const verificationSubmittersById = verificationLogs.ok
            ? await loadVerificationSubmitterProfiles(supabase, verificationRowsWithLedgerSubmitters)
            : new Map();
        const enrichedVerificationRows = enrichVerificationRowsWithSubmitters(
            verificationRowsWithLedgerSubmitters,
            verificationSubmittersById
        );

        const summaries = {
            overviewBusinessMix: buildSummarySegment(
                ['promptUnlocks', 'verificationLogs', 'guestbookMessages', 'guestbookComments', 'guestbookLikes', 'promptComments', 'pointsLedger'],
                tables,
                () => buildOverviewBusinessMixSummaryFromRows({
                    unlockRows: promptUnlocks.rows,
                    verifyRows: enrichedVerificationRows,
                    guestbookMessages: guestbookMessages.rows,
                    guestbookComments: guestbookComments.rows,
                    guestbookLikes: guestbookLikes.rows,
                    promptComments: promptComments.rows,
                    rewardRows: pointsLedger.rows
                })
            ),
            verifyServiceSummary: buildSummarySegment(
                ['verificationLogs'],
                tables,
                () => buildVerifyServiceSummaryFromRows(enrichedVerificationRows)
            ),
            growthSummary: buildSummarySegment(
                ['guestbookMessages', 'guestbookComments', 'guestbookLikes', 'promptComments', 'pointsLedger'],
                tables,
                () => buildGrowthSummaryFromRows({
                    guestbookMessages: guestbookMessages.rows,
                    guestbookComments: guestbookComments.rows,
                    guestbookLikes: guestbookLikes.rows,
                    promptComments: promptComments.rows,
                    ledgerRows: pointsLedger.rows
                })
            )
        };

        return sendJson(res, 200, {
            success: true,
            site,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            table_partial_failure_count: Object.values(tables).filter((segment) => !segment.ok).length,
            summary_partial_failure_count: Object.values(summaries).filter((segment) => !segment.ok).length,
            summaries
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load analytics summary payload bundle'
        });
    }
};
