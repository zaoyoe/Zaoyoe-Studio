const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function matchesSite(site, expectedSite) {
    return expectedSite === 'all' || normalizeSite(site) === expectedSite;
}

async function loadCodeLookupContext(supabase, query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
        return null;
    }

    const field = normalizedQuery.toUpperCase().startsWith('ZY-') ? 'code' : 'external_order_id';
    const value = normalizeCode(normalizedQuery);

    const { data, error } = await supabase
        .from('redemption_codes')
        .select('id, code, site, batch_id, package_id, status, created_at, used_at, used_by, external_order_id, revoke_reason, revoked_at, revoked_by')
        .eq(field, value)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function loadLedgerRow(supabase, id, site = 'all') {
    const { data, error } = await supabase
        .from('points_ledger')
        .select('id, site, reason, reference_id, amount, user_id, created_at')
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    if (data && !matchesSite(data.site, site)) {
        return null;
    }
    if (!data?.user_id) {
        return data || null;
    }

    const { data: profileRow, error: profileError } = await supabase
        .from('profiles')
        .select('username, email')
        .eq('id', data.user_id)
        .maybeSingle();

    if (profileError) throw profileError;

    return {
        ...data,
        profiles: profileRow || null
    };
}

async function maybeAttachPromptTitle(supabase, ledgerRow) {
    if (!ledgerRow || ledgerRow.reason !== 'unlock_prompt' || !ledgerRow.reference_id) {
        return ledgerRow;
    }

    const { data, error } = await supabase
        .from('prompts')
        .select('title')
        .eq('id', ledgerRow.reference_id)
        .maybeSingle();

    if (error) throw error;

    return {
        ...ledgerRow,
        prompt_title: data?.title || ''
    };
}

module.exports = async (req, res) => {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'points.manage' });
        const searchParams = getSearchParams(req);
        const site = normalizeSite(searchParams.get('site') || req.adminSite);
        const query = normalizeText(searchParams.get('q') || searchParams.get('code') || '');

        if (!query) {
            return sendJson(res, 400, {
                success: false,
                message: 'q is required'
            });
        }

        const { data: codeData, error: codeError } = await supabase.rpc('fn_check_code_status', {
            p_code: query.toUpperCase()
        });

        if (codeError) {
            throw codeError;
        }

        const codeContext = await loadCodeLookupContext(supabase, query);
        const codeFound = Boolean(
            normalizeText(codeData?.code)
            || normalizeText(codeData?.external_order_id)
            || normalizeText(codeData?.batch_id)
            || normalizeText(codeData?.status)
        );

        if (codeFound && (!codeContext || matchesSite(codeContext.site, site))) {
            return sendJson(res, 200, {
                success: true,
                site,
                kind: 'code',
                result: {
                    ...(codeData && typeof codeData === 'object' ? codeData : {}),
                    created_at: codeContext?.created_at || null,
                    site: codeContext?.site || site,
                    used_by_id: codeContext?.used_by || '',
                    revoked_by_id: codeContext?.revoked_by || ''
                }
            });
        }

        if (isUuid(query)) {
            const ledgerRow = await loadLedgerRow(supabase, query, site);
            if (ledgerRow) {
                const payload = await maybeAttachPromptTitle(supabase, ledgerRow);
                return sendJson(res, 200, {
                    success: true,
                    site,
                    kind: 'ledger',
                    result: payload
                });
            }
        }

        return sendJson(res, 404, {
            success: false,
            message: codeData?.message || '未找到该兑换码/订单号'
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Points lookup request failed'
        });
    }
};
