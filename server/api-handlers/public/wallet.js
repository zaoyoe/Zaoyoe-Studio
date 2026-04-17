function normalizeText(value, maxLength = 240) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizePointValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
}

function normalizePositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function dedupeRowsById(rows = []) {
    const seen = new Set();
    const deduped = [];
    (rows || []).forEach((row) => {
        const key = normalizeText(row?.id || row?.verification_id || row?.reference_id || row?.created_at, 160);
        if (!key || seen.has(key)) return;
        seen.add(key);
        deduped.push(row);
    });
    return deduped;
}

function parseVerifyLogPayload(message = '') {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        if (parsed?.kind === 'google_one_job') {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

function looksLikeEmail(value = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(value || '').trim());
}

function extractEmailCandidates(...values) {
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
    const emails = new Set();

    values.flat().forEach((value) => {
        const text = String(value || '').trim();
        if (!text) return;

        const matches = text.match(emailRegex) || [];
        matches.forEach((email) => emails.add(String(email || '').trim().toLowerCase()));
    });

    return Array.from(emails);
}

function extractFirstUrl(text = '') {
    const match = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0] : '';
}

function isMissingColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('column') && message.includes('does not exist');
}

async function loadPromptTitles(client, promptIds = []) {
    const normalizedPromptIds = [...new Set(
        (promptIds || []).map((item) => normalizeText(item, 160)).filter(Boolean)
    )];
    if (!normalizedPromptIds.length) {
        return {};
    }

    const { data, error } = await client
        .from('prompts')
        .select('id, title')
        .in('id', normalizedPromptIds);

    if (error) throw error;

    return (data || []).reduce((result, prompt) => {
        result[prompt.id] = normalizeText(prompt.title, 240);
        return result;
    }, {});
}

async function loadWalletBalanceRows(client, userId) {
    const variants = [
        {
            select: 'paid_balance, bonus_balance, total_balance, site',
            hasSite: true
        },
        {
            select: 'paid_balance, bonus_balance, total_balance',
            hasSite: false
        }
    ];

    for (const variant of variants) {
        const { data, error } = await client
            .from('points_balance')
            .select(variant.select)
            .eq('user_id', userId);

        if (error) {
            if (isMissingColumnError(error) && variant !== variants[variants.length - 1]) {
                continue;
            }
            throw error;
        }

        return (data || []).map((row) => ({
            ...row,
            site: variant.hasSite ? normalizeText(row.site, 40) || 'cn' : 'cn',
            paid_balance: normalizePointValue(row.paid_balance, 0),
            bonus_balance: normalizePointValue(row.bonus_balance, 0),
            total_balance: normalizePointValue(row.total_balance, 0)
        }));
    }

    return [];
}

async function loadWalletHistoryRows(client, { userId, site, limit }) {
    const variants = [
        {
            select: 'id, amount, reason, reference_id, created_at, site, is_visible',
            hasSite: true,
            hasVisible: true
        },
        {
            select: 'id, amount, reason, reference_id, created_at, site',
            hasSite: true,
            hasVisible: false
        },
        {
            select: 'id, amount, reason, reference_id, created_at, is_visible',
            hasSite: false,
            hasVisible: true
        },
        {
            select: 'id, amount, reason, reference_id, created_at',
            hasSite: false,
            hasVisible: false
        }
    ];

    for (const variant of variants) {
        let query = client
            .from('points_ledger')
            .select(variant.select)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (variant.hasSite) {
            query = query.eq('site', site);
        }
        if (variant.hasVisible) {
            query = query.eq('is_visible', true);
        }

        const { data, error } = await query;
        if (error) {
            if (isMissingColumnError(error) && variant !== variants[variants.length - 1]) {
                continue;
            }
            throw error;
        }

        if (site && !variant.hasSite && site !== 'cn') {
            return [];
        }

        return (data || []).map((item) => ({
            ...item,
            amount: normalizePointValue(item.amount)
        }));
    }

    return [];
}

async function queryWalletBrowseData(client, { userId, site, limit }) {
    const [shopOrdersResult, ledgerResult] = await Promise.all([
        client
            .from('shop_orders')
            .select(`
                id,
                total_price,
                item_count,
                status,
                created_at,
                snapshot_product_name,
                shop_order_items (
                    id,
                    snapshot_product_name
                )
            `)
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(limit),
        client
            .from('points_ledger')
            .select('id, amount, reason, reference_id, created_at')
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(limit)
    ]);

    if (shopOrdersResult.error) throw shopOrdersResult.error;
    if (ledgerResult.error) throw ledgerResult.error;

    const ledgerEntries = (ledgerResult.data || []).map((entry) => ({
        ...entry,
        amount: normalizePointValue(entry.amount)
    }));
    const promptTitles = await loadPromptTitles(
        client,
        ledgerEntries
            .filter((entry) => normalizeText(entry.reason) === 'unlock_prompt')
            .map((entry) => entry.reference_id)
    );

    return {
        shopOrders: dedupeRowsById(shopOrdersResult.data || []),
        ledgerEntries: dedupeRowsById(ledgerEntries),
        promptTitles
    };
}

async function queryWalletSearchData(client, { userId, site, query, searchLimit }) {
    const trimmedQuery = normalizeText(query, 120);
    if (!trimmedQuery) {
        return queryWalletBrowseData(client, {
            userId,
            site,
            limit: searchLimit
        });
    }

    const likeValue = `%${trimmedQuery}%`;
    const isUuidQuery = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmedQuery);
    const numericQuery = Number(trimmedQuery);
    const isPositiveAmountQuery = /^\d+$/.test(trimmedQuery) && Number.isFinite(numericQuery) && numericQuery > 0;
    const shouldSearchVerifyLogs = trimmedQuery.length >= 3;

    const shopRequests = [
        client
            .from('shop_orders')
            .select(`
                id,
                total_price,
                item_count,
                status,
                created_at,
                snapshot_product_name,
                shop_order_items (
                    id,
                    snapshot_product_name
                )
            `)
            .eq('user_id', userId)
            .eq('site', site)
            .ilike('snapshot_product_name', likeValue)
            .order('created_at', { ascending: false })
            .limit(searchLimit)
    ];

    const ledgerRequests = [
        client
            .from('points_ledger')
            .select('id, amount, reason, reference_id, created_at')
            .eq('user_id', userId)
            .eq('site', site)
            .ilike('reference_id', likeValue)
            .order('created_at', { ascending: false })
            .limit(searchLimit),
        client
            .from('points_ledger')
            .select('id, amount, reason, reference_id, created_at')
            .eq('user_id', userId)
            .eq('site', site)
            .ilike('reason', likeValue)
            .order('created_at', { ascending: false })
            .limit(searchLimit)
    ];

    if (isPositiveAmountQuery) {
        ledgerRequests.push(
            client
                .from('points_ledger')
                .select('id, amount, reason, reference_id, created_at')
                .eq('user_id', userId)
                .eq('site', site)
                .eq('amount', numericQuery)
                .order('created_at', { ascending: false })
                .limit(searchLimit)
        );
    }

    if (isUuidQuery) {
        shopRequests.push(
            client
                .from('shop_orders')
                .select(`
                    id,
                    total_price,
                    item_count,
                    status,
                    created_at,
                    snapshot_product_name,
                    shop_order_items (
                        id,
                        snapshot_product_name
                    )
                `)
                .eq('user_id', userId)
                .eq('site', site)
                .eq('id', trimmedQuery)
                .limit(20)
        );

        ledgerRequests.push(
            client
                .from('points_ledger')
                .select('id, amount, reason, reference_id, created_at')
                .eq('user_id', userId)
                .eq('site', site)
                .eq('id', trimmedQuery)
                .limit(20)
        );
    }

    const [{ data: promptMatches, error: promptError }, verifyLogResults] = await Promise.all([
        client
            .from('prompts')
            .select('id, title')
            .ilike('title', likeValue)
            .limit(30),
        shouldSearchVerifyLogs
            ? Promise.all([
                client
                    .from('verification_logs')
                    .select('verification_id, status, message, points_deducted, created_at')
                    .eq('user_id', userId)
                    .eq('site', site)
                    .ilike('verification_id', likeValue)
                    .order('created_at', { ascending: false })
                    .limit(searchLimit),
                client
                    .from('verification_logs')
                    .select('verification_id, status, message, points_deducted, created_at')
                    .eq('user_id', userId)
                    .eq('site', site)
                    .ilike('message', likeValue)
                    .order('created_at', { ascending: false })
                    .limit(searchLimit)
            ])
            : Promise.resolve([])
    ]);

    if (promptError) throw promptError;

    const promptTitles = {};
    const promptIds = (promptMatches || []).map((prompt) => {
        promptTitles[prompt.id] = normalizeText(prompt.title, 240);
        return prompt.id;
    });

    if (promptIds.length > 0) {
        ledgerRequests.push(
            client
                .from('points_ledger')
                .select('id, amount, reason, reference_id, created_at')
                .eq('user_id', userId)
                .eq('site', site)
                .eq('reason', 'unlock_prompt')
                .in('reference_id', promptIds)
                .order('created_at', { ascending: false })
                .limit(searchLimit)
        );
    }

    const verifyReferenceIds = [];
    (verifyLogResults || []).forEach((result) => {
        if (result.error) throw result.error;
        (result.data || []).forEach((row) => {
            const payload = parseVerifyLogPayload(row.message) || {};
            const refs = [
                normalizeText(row.verification_id, 160),
                normalizeText(payload.job_id, 160),
                normalizeText(payload.email, 160).toLowerCase()
            ].filter(Boolean);
            verifyReferenceIds.push(...refs);
        });
    });

    if (verifyReferenceIds.length > 0) {
        ledgerRequests.push(
            client
                .from('points_ledger')
                .select('id, amount, reason, reference_id, created_at')
                .eq('user_id', userId)
                .eq('site', site)
                .in('reference_id', [...new Set(verifyReferenceIds)].slice(0, searchLimit))
                .order('created_at', { ascending: false })
                .limit(searchLimit)
        );
    }

    const [shopResults, ledgerResults] = await Promise.all([
        Promise.all(shopRequests),
        Promise.all(ledgerRequests)
    ]);

    const shopOrders = [];
    shopResults.forEach((result) => {
        if (result.error) throw result.error;
        if (result.data?.length) {
            shopOrders.push(...result.data);
        }
    });

    const ledgerEntries = [];
    ledgerResults.forEach((result) => {
        if (result.error) throw result.error;
        if (result.data?.length) {
            ledgerEntries.push(...result.data);
        }
    });

    const normalizedLedgerEntries = dedupeRowsById(ledgerEntries).map((entry) => ({
        ...entry,
        amount: normalizePointValue(entry.amount)
    }));
    const extraPromptTitles = await loadPromptTitles(
        client,
        normalizedLedgerEntries
            .filter((entry) => normalizeText(entry.reason) === 'unlock_prompt')
            .map((entry) => entry.reference_id)
            .filter((promptId) => !promptTitles[promptId])
    );

    return {
        shopOrders: dedupeRowsById(shopOrders),
        ledgerEntries: normalizedLedgerEntries,
        promptTitles: {
            ...promptTitles,
            ...extraPromptTitles
        }
    };
}

async function findWalletVerifyLog(client, {
    userId,
    site,
    referenceId = '',
    createdAt = '',
    pointsPaid = 0,
    reason = ''
}) {
    if (!userId) {
        return null;
    }

    const normalizedReferenceId = normalizeText(referenceId, 160);
    const emailCandidates = extractEmailCandidates(normalizedReferenceId, reason);
    let matchedRecord = null;

    if (normalizedReferenceId) {
        const exactResult = await client
            .from('verification_logs')
            .select('verification_id, status, message, points_deducted, created_at')
            .eq('user_id', userId)
            .eq('site', site)
            .eq('verification_id', normalizedReferenceId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (exactResult.error) {
            throw exactResult.error;
        }
        if (exactResult.data?.length) {
            matchedRecord = exactResult.data[0];
        }
    }

    if (!matchedRecord) {
        let exactEmailRows = [];

        if (emailCandidates.length) {
            const emailResult = await client
                .from('verification_logs')
                .select('verification_id, status, message, points_deducted, created_at')
                .eq('user_id', userId)
                .eq('site', site)
                .in('verification_id', emailCandidates)
                .order('created_at', { ascending: false })
                .limit(20);

            if (emailResult.error) {
                throw emailResult.error;
            }
            exactEmailRows = emailResult.data || [];
        }

        let fallbackResult = null;
        const ledgerTime = createdAt ? new Date(createdAt).getTime() : 0;

        if (ledgerTime) {
            const from = new Date(ledgerTime - (24 * 60 * 60 * 1000)).toISOString();
            const to = new Date(ledgerTime + (24 * 60 * 60 * 1000)).toISOString();
            fallbackResult = await client
                .from('verification_logs')
                .select('verification_id, status, message, points_deducted, created_at')
                .eq('user_id', userId)
                .eq('site', site)
                .gte('created_at', from)
                .lte('created_at', to)
                .order('created_at', { ascending: false })
                .limit(120);
        }

        if (!fallbackResult || fallbackResult.error || !(fallbackResult.data || []).length) {
            fallbackResult = await client
                .from('verification_logs')
                .select('verification_id, status, message, points_deducted, created_at')
                .eq('user_id', userId)
                .eq('site', site)
                .order('created_at', { ascending: false })
                .limit(120);
        }

        if (fallbackResult.error) {
            throw fallbackResult.error;
        }

        const targetAmount = Math.abs(Number(pointsPaid) || 0);
        const candidateRows = [...exactEmailRows, ...(fallbackResult.data || [])]
            .filter((row, index, rows) => rows.findIndex((item) => (
                item.verification_id === row.verification_id
                && item.created_at === row.created_at
                && item.status === row.status
            )) === index);

        const scoredMatches = candidateRows.map((row) => {
            const payload = parseVerifyLogPayload(row.message);
            const fallbackEmail = looksLikeEmail(row.verification_id) ? String(row.verification_id || '').trim().toLowerCase() : '';
            const fallbackJobId = !fallbackEmail ? String(row.verification_id || '').trim() : '';
            const rowEmail = String(payload?.email || fallbackEmail || '').trim().toLowerCase();
            const rowJobId = String(payload?.job_id || fallbackJobId || '').trim();
            const rowUrl = String(payload?.url || extractFirstUrl(row.message) || '').trim();

            if (normalizedReferenceId && rowJobId && rowJobId === normalizedReferenceId) {
                return { row, score: 1_000_000, diffMs: 0 };
            }

            const rowAmount = Math.abs(Number(row.points_deducted) || 0);
            const rowTime = row.created_at ? new Date(row.created_at).getTime() : 0;
            const diffMs = ledgerTime && rowTime ? Math.abs(rowTime - ledgerTime) : Number.MAX_SAFE_INTEGER;
            const diffMinutes = Number.isFinite(diffMs) ? diffMs / 60000 : Number.MAX_SAFE_INTEGER;

            let score = 0;

            if (emailCandidates.length && rowEmail && emailCandidates.includes(rowEmail)) score += 340;
            if (rowUrl) score += 120;
            if (String(row.status || '').toLowerCase() === 'success') score += 80;
            if (targetAmount > 0 && rowAmount === targetAmount) score += 220;
            if (targetAmount > 0 && rowAmount > 0 && Math.abs(rowAmount - targetAmount) <= 1) score += 40;

            if (Number.isFinite(diffMinutes)) {
                if (diffMinutes <= 1) score += 320;
                else if (diffMinutes <= 3) score += 240;
                else if (diffMinutes <= 10) score += 180;
                else if (diffMinutes <= 30) score += 120;
                else if (diffMinutes <= 120) score += 60;
                else if (diffMinutes <= 1440) score += 20;
            }

            if (score <= 0) {
                return null;
            }

            return {
                row,
                score,
                diffMs
            };
        }).filter(Boolean);

        scoredMatches.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.diffMs - b.diffMs;
        });

        matchedRecord = scoredMatches[0]?.row || null;
    }

    if (!matchedRecord) {
        return null;
    }

    const parsedPayload = parseVerifyLogPayload(matchedRecord.message) || {};
    const fallbackEmail = looksLikeEmail(matchedRecord.verification_id) ? String(matchedRecord.verification_id || '').trim().toLowerCase() : '';
    const fallbackJobId = !fallbackEmail ? String(matchedRecord.verification_id || '').trim() : '';

    return {
        ...matchedRecord,
        points_deducted: normalizePointValue(matchedRecord.points_deducted),
        payload: {
            ...parsedPayload,
            email: parsedPayload.email || fallbackEmail || '',
            job_id: parsedPayload.job_id || fallbackJobId || '',
            url: parsedPayload.url || extractFirstUrl(matchedRecord.message) || ''
        }
    };
}

function createWalletHandlers({
    admin,
    site
}) {
    const {
        requireAuthenticatedUser,
        sendJson
    } = admin;
    const {
        requireSupportedSite
    } = site;

    return {
        async overview(req, res) {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            try {
                const {
                    user,
                    requestSupabase,
                    adminSupabase,
                    supabase
                } = await requireAuthenticatedUser(req);
                const client = adminSupabase || requestSupabase || supabase;
                const currentSite = requireSupportedSite(req?.query?.site || 'cn', { fieldName: 'site' });
                const historyLimit = normalizePositiveInt(req?.query?.history_limit, 20, { min: 1, max: 100 });

                const [balanceRows, recentHistory] = await Promise.all([
                    loadWalletBalanceRows(client, user.id),
                    loadWalletHistoryRows(client, {
                        userId: user.id,
                        site: currentSite,
                        limit: historyLimit
                    })
                ]);

                const siteBalances = (balanceRows || []).reduce((result, row) => {
                    result[row.site] = {
                        paid_balance: normalizePointValue(row.paid_balance, 0),
                        bonus_balance: normalizePointValue(row.bonus_balance, 0),
                        total_balance: normalizePointValue(row.total_balance, 0)
                    };
                    return result;
                }, {});
                const balance = siteBalances[currentSite] || {};
                const otherSiteBalances = Object.entries(siteBalances)
                    .filter(([site]) => site !== currentSite)
                    .map(([site, siteBalance]) => ({
                        site,
                        ...siteBalance
                    }))
                    .filter((row) => normalizePointValue(row.total_balance, 0) > 0);

                return sendJson(res, 200, {
                    success: true,
                    site: currentSite,
                    balance: {
                        paid_balance: normalizePointValue(balance.paid_balance, 0),
                        bonus_balance: normalizePointValue(balance.bonus_balance, 0),
                        total_balance: normalizePointValue(balance.total_balance, 0)
                    },
                    balance_scope: 'site',
                    current_site_has_account: Object.prototype.hasOwnProperty.call(siteBalances, currentSite),
                    site_balances: siteBalances,
                    other_site_balances: otherSiteBalances,
                    recent_history: recentHistory,
                    history_limit: historyLimit
                });
            } catch (error) {
                return sendJson(res, error?.statusCode || 500, {
                    success: false,
                    message: error?.message || '加载钱包概览失败'
                });
            }
        },

        async transactions(req, res) {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            try {
                const {
                    user,
                    requestSupabase,
                    adminSupabase,
                    supabase
                } = await requireAuthenticatedUser(req);
                const client = adminSupabase || requestSupabase || supabase;
                const currentSite = requireSupportedSite(req?.query?.site || 'cn', { fieldName: 'site' });
                const query = normalizeText(req?.query?.q || '', 120);
                const limit = normalizePositiveInt(req?.query?.limit, 100, { min: 1, max: 200 });
                const searchLimit = normalizePositiveInt(req?.query?.search_limit, 80, { min: 1, max: 120 });

                const result = query
                    ? await queryWalletSearchData(client, {
                        userId: user.id,
                        site: currentSite,
                        query,
                        searchLimit
                    })
                    : await queryWalletBrowseData(client, {
                        userId: user.id,
                        site: currentSite,
                        limit
                    });

                return sendJson(res, 200, {
                    success: true,
                    site: currentSite,
                    query,
                    shop_orders: result.shopOrders || [],
                    ledger_entries: result.ledgerEntries || [],
                    prompt_titles: result.promptTitles || {}
                });
            } catch (error) {
                return sendJson(res, error?.statusCode || 500, {
                    success: false,
                    message: error?.message || '加载钱包交易失败'
                });
            }
        },

        async promptTitles(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            try {
                const {
                    requestSupabase,
                    adminSupabase,
                    supabase
                } = await requireAuthenticatedUser(req);
                const client = adminSupabase || requestSupabase || supabase;
                const body = req?.body && typeof req.body === 'object' ? req.body : {};
                const currentSite = requireSupportedSite(body.site || req?.query?.site || 'cn', { fieldName: 'site' });
                const promptIds = Array.isArray(body.ids)
                    ? body.ids.map((item) => normalizeText(item, 160)).filter(Boolean).slice(0, 100)
                    : [];

                return sendJson(res, 200, {
                    success: true,
                    site: currentSite,
                    prompt_titles: await loadPromptTitles(client, promptIds)
                });
            } catch (error) {
                return sendJson(res, error?.statusCode || 500, {
                    success: false,
                    message: error?.message || '加载提示词标题失败'
                });
            }
        },

        async verifyLog(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            try {
                const {
                    user,
                    requestSupabase,
                    adminSupabase,
                    supabase
                } = await requireAuthenticatedUser(req);
                const client = adminSupabase || requestSupabase || supabase;
                const body = req?.body && typeof req.body === 'object' ? req.body : {};
                const currentSite = requireSupportedSite(body.site || req?.query?.site || 'cn', { fieldName: 'site' });

                return sendJson(res, 200, {
                    success: true,
                    site: currentSite,
                    verify_log: await findWalletVerifyLog(client, {
                        userId: user.id,
                        site: currentSite,
                        referenceId: body.reference_id || body.referenceId || '',
                        createdAt: body.created_at || body.createdAt || '',
                        pointsPaid: body.points_paid ?? body.pointsPaid ?? 0,
                        reason: body.reason || ''
                    })
                });
            } catch (error) {
                return sendJson(res, error?.statusCode || 500, {
                    success: false,
                    message: error?.message || '加载核销记录失败'
                });
            }
        }
    };
}

module.exports = {
    createWalletHandlers
};
