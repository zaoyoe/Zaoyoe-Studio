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

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = String(error?.message || '').trim().toLowerCase();
    const normalizedRelation = String(relationName || '').trim().toLowerCase();
    if (!normalizedMessage) return false;
    const mentionsRelation = normalizedRelation
        ? normalizedMessage.includes(normalizedRelation)
        : normalizedMessage.includes('relation') || normalizedMessage.includes('table');
    return mentionsRelation && (
        normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('not exist')
        || normalizedMessage.includes('could not find')
        || normalizedMessage.includes('undefined table')
    );
}

function normalizeGuidanceText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function containsGuidanceCjkText(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
}

function normalizeGuidanceSite(value = 'cn') {
    const normalized = String(value || 'cn').trim().toLowerCase();
    return normalized === 'intl' || normalized === 'en' ? 'intl' : 'cn';
}

function resolveLocalizedGuidanceText(product = {}, baseField = '', guidanceSite = 'cn') {
    const siteKey = normalizeGuidanceSite(guidanceSite);
    const legacyText = normalizeGuidanceText(product?.[baseField]);
    const zhText = normalizeGuidanceText(product?.[`${baseField}_zh`]);
    const enText = normalizeGuidanceText(product?.[`${baseField}_en`]);

    if (siteKey === 'intl') {
        const candidate = enText || legacyText;
        return containsGuidanceCjkText(candidate) ? '' : candidate;
    }

    return zhText || legacyText || enText;
}

function getProductGuidanceSelectClause({ bilingual = true, purchaseNotes = true } = {}) {
    const fields = [];
    if (purchaseNotes) {
        fields.push(
            'show_purchase_notes',
            'purchase_notes',
            ...(bilingual ? ['purchase_notes_zh', 'purchase_notes_en'] : [])
        );
    }
    fields.push(
        'show_usage_instructions',
        'usage_instructions',
        ...(bilingual ? ['usage_instructions_zh', 'usage_instructions_en'] : [])
    );
    return fields.join(', ');
}

async function loadProductGuidanceRow(client, normalizedProductId) {
    const selectAttempts = [
        getProductGuidanceSelectClause({ bilingual: true, purchaseNotes: true }),
        getProductGuidanceSelectClause({ bilingual: false, purchaseNotes: true }),
        getProductGuidanceSelectClause({ bilingual: false, purchaseNotes: false })
    ];

    let lastError = null;
    for (const selectClause of selectAttempts) {
        const { data, error } = await client
            .from('shop_products')
            .select(selectClause)
            .eq('id', normalizedProductId)
            .maybeSingle();

        if (!error) {
            return { data, error: null };
        }

        lastError = error;
        const isGuidanceColumnMissing = [
            'purchase_notes',
            'show_purchase_notes',
            'purchase_notes_zh',
            'purchase_notes_en',
            'usage_instructions_zh',
            'usage_instructions_en'
        ].some((field) => isMissingColumnError(error) && String(error?.message || '').toLowerCase().includes(field));
        if (!isGuidanceColumnMissing) {
            return { data: null, error };
        }
    }

    return { data: null, error: lastError };
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
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

async function loadShopProductNameMap(client, productIds = []) {
    const normalizedProductIds = [...new Set(
        (productIds || []).map((item) => normalizeText(item, 160)).filter((item) => isUuid(item))
    )];
    if (!normalizedProductIds.length) {
        return new Map();
    }

    const selectAttempts = [
        'id, name, name_en',
        'id, name'
    ];

    let rows = [];
    for (const selectClause of selectAttempts) {
        const { data, error } = await client
            .from('shop_products')
            .select(selectClause)
            .in('id', normalizedProductIds);

        if (!error) {
            rows = data || [];
            break;
        }

        if (!isMissingColumnError(error) || selectClause === selectAttempts[selectAttempts.length - 1]) {
            throw error;
        }
    }

    return new Map((rows || []).map((row) => [
        normalizeText(row?.id, 160),
        {
            id: normalizeText(row?.id, 160),
            name: normalizeText(row?.name, 240),
            name_en: normalizeText(row?.name_en, 240)
        }
    ]).filter(([id]) => id));
}

async function attachShopProductSnapshots(client, orders = []) {
    const normalizedOrders = Array.isArray(orders) ? orders : [];
    const productMap = await loadShopProductNameMap(
        client,
        normalizedOrders.map((order) => order?.product_id)
    );

    return normalizedOrders.map((order) => {
        const productId = normalizeText(order?.product_id, 160);
        const product = productMap.get(productId) || null;
        const productPayload = product
            ? {
                id: product.id,
                name: product.name,
                name_en: product.name_en
            }
            : null;

        return {
            ...order,
            snapshot_product_name_en: product?.name_en || '',
            shop_product: productPayload,
            shop_order_items: Array.isArray(order?.shop_order_items)
                ? order.shop_order_items.map((item) => ({
                    ...item,
                    name_en: product?.name_en || ''
                }))
                : order?.shop_order_items
        };
    });
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
                product_id,
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
        shopOrders: await attachShopProductSnapshots(client, dedupeRowsById(shopOrdersResult.data || [])),
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
                product_id,
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
                    product_id,
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
        shopOrders: await attachShopProductSnapshots(client, dedupeRowsById(shopOrders)),
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

async function loadWalletShopOrderDetail(client, { orderId = '', userId = '', site = 'cn' } = {}) {
    const normalizedOrderId = normalizeText(orderId, 160);
    const normalizedUserId = normalizeText(userId, 160);

    const { data: order, error: orderError } = await client
        .from('shop_orders')
        .select('id, user_id, product_id, inventory_id, snapshot_product_name, created_at, price_paid, total_price, discount_code, discount_amount, discount_snapshot, item_count')
        .eq('id', normalizedOrderId)
        .eq('user_id', normalizedUserId)
        .single();

    if (orderError || !order) {
        const error = new Error(orderError?.message || '订单不存在或无权访问');
        error.statusCode = orderError?.code === 'PGRST116' ? 404 : (orderError?.statusCode || 404);
        throw error;
    }

    const normalizedProductId = String(order?.product_id || '').trim();
    const normalizedItemCount = Math.max(1, Number(order?.item_count || 1) || 1);
    const needsOrderItems = normalizedItemCount > 1 || !String(order?.inventory_id || '').trim();

    const orderItemsPromise = needsOrderItems
        ? (async () => {
            try {
                const { data, error } = await client
                    .from('shop_order_items')
                    .select('id, inventory_id, snapshot_product_name, price_paid')
                    .eq('order_id', normalizedOrderId)
                    .order('id', { ascending: true });

                if (error) throw error;
                return Array.isArray(data) ? data : [];
            } catch (error) {
                if (!isMissingRelationError(error, 'shop_order_items')) {
                    throw error;
                }
                return [];
            }
        })()
        : Promise.resolve([]);

    const guidancePromise = (async () => {
        let purchaseNotes = '';
        let usageInstructions = '';

        if (!isUuid(normalizedProductId)) {
            return { purchaseNotes, usageInstructions };
        }

        const { data: productGuidanceRow, error: productGuidanceError } = await loadProductGuidanceRow(
            client,
            normalizedProductId
        );
        if (productGuidanceError) {
            throw productGuidanceError;
        }

        purchaseNotes = productGuidanceRow?.show_purchase_notes
            ? resolveLocalizedGuidanceText(productGuidanceRow, 'purchase_notes', site)
            : '';
        usageInstructions = productGuidanceRow?.show_usage_instructions
            ? resolveLocalizedGuidanceText(productGuidanceRow, 'usage_instructions', site)
            : '';

        return { purchaseNotes, usageInstructions };
    })();

    const productNamesPromise = loadShopProductNameMap(client, [normalizedProductId]);

    const [orderItems, guidance, productNameMap] = await Promise.all([
        orderItemsPromise,
        guidancePromise,
        productNamesPromise
    ]);
    const orderProduct = productNameMap.get(normalizedProductId) || null;
    const orderProductPayload = orderProduct
        ? {
            id: orderProduct.id,
            name: orderProduct.name,
            name_en: orderProduct.name_en
        }
        : null;

    const inventoryIds = [...new Set(
        [
            ...orderItems.map((item) => String(item?.inventory_id || '').trim()).filter(Boolean),
            String(order?.inventory_id || '').trim()
        ].filter(Boolean)
    )];

    const inventoryContentMap = new Map();
    if (inventoryIds.length) {
        const { data: inventoryRows, error: inventoryError } = await client
            .from('shop_inventory')
            .select('id, content')
            .in('id', inventoryIds);

        if (inventoryError) {
            throw inventoryError;
        }

        for (const row of inventoryRows || []) {
            const inventoryId = String(row?.id || '').trim();
            if (!inventoryId) continue;
            inventoryContentMap.set(inventoryId, String(row?.content || ''));
        }
    }

    const purchaseNotes = guidance?.purchaseNotes || '';
    const usageInstructions = guidance?.usageInstructions || '';

    const items = orderItems.length
        ? orderItems.map((item) => {
            const inventoryId = String(item?.inventory_id || '').trim();
            return {
                id: item?.id || null,
                inventory_id: inventoryId || null,
                name: item?.snapshot_product_name || order?.snapshot_product_name || '未知商品',
                name_en: orderProduct?.name_en || '',
                shop_product: orderProductPayload,
                content: inventoryId ? (inventoryContentMap.get(inventoryId) || '') : '',
                price: Number(item?.price_paid || 0) || 0
            };
        })
        : [{
            id: null,
            inventory_id: String(order?.inventory_id || '').trim() || null,
            name: order?.snapshot_product_name || '未知商品',
            name_en: orderProduct?.name_en || '',
            shop_product: orderProductPayload,
            content: inventoryContentMap.get(String(order?.inventory_id || '').trim()) || '',
            price: Number(order?.price_paid || 0) || 0
        }];

    return {
        order: {
            id: order.id,
            created_at: order.created_at || null,
            product_id: order.product_id || null,
            inventory_id: order.inventory_id || null,
            snapshot_product_name: order.snapshot_product_name || '',
            snapshot_product_name_en: orderProduct?.name_en || '',
            shop_product: orderProductPayload,
            price_paid: Number(order.price_paid || 0) || 0,
            total_price: order.total_price == null ? null : (Number(order.total_price) || 0),
            discount_code: order.discount_code || null,
            discount_amount: Number(order.discount_amount || 0) || 0,
            applied_discounts: Array.isArray(order?.discount_snapshot?.applied_discounts)
                ? order.discount_snapshot.applied_discounts
                : [],
            item_count: Math.max(1, Number(order.item_count || items.length || 1) || 1)
        },
        items,
        guidance: {
            purchase_notes: purchaseNotes || null,
            has_purchase_notes: purchaseNotes.length > 0,
            usage_instructions: usageInstructions || null,
            has_usage_instructions: usageInstructions.length > 0
        }
    };
}

function createWalletHandlers({
    admin,
    site
}) {
    const {
        parseJsonBody,
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
        },

        async orderDetail(req, res) {
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
                const body = typeof parseJsonBody === 'function'
                    ? await parseJsonBody(req)
                    : (req?.body && typeof req.body === 'object' ? req.body : {});
                const orderId = normalizeText(body?.orderId || body?.order_id || '', 160);
                const currentSite = requireSupportedSite(body.site || req?.query?.site || 'cn', { fieldName: 'site' });

                if (!isUuid(orderId)) {
                    return sendJson(res, 400, {
                        success: false,
                        message: '订单号格式不正确'
                    });
                }

                return sendJson(res, 200, {
                    success: true,
                    data: await loadWalletShopOrderDetail(client, {
                        orderId,
                        userId: user.id,
                        site: currentSite
                    })
                });
            } catch (error) {
                return sendJson(res, error?.statusCode || 500, {
                    success: false,
                    message: error?.message || '加载订单详情失败'
                });
            }
        }
    };
}

module.exports = {
    createWalletHandlers
};
