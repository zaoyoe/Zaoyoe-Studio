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

        const summaries = {
            overviewBusinessMix: buildSummarySegment(
                ['promptUnlocks', 'verificationLogs', 'guestbookMessages', 'guestbookComments', 'guestbookLikes', 'promptComments', 'pointsLedger'],
                tables,
                () => buildOverviewBusinessMixSummaryFromRows({
                    unlockRows: promptUnlocks.rows,
                    verifyRows: verificationLogs.rows,
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
                () => buildVerifyServiceSummaryFromRows(verificationLogs.rows || [])
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
