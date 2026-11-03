'use strict';

const crypto = require('node:crypto');
const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { createConfiguredSupplierAdapterRegistry, PROVIDERS, getSupplierAccountConfiguration } = require('../../../../server/integrations/suppliers/registry');

const { loadOperations } = require('../../../integrations/suppliers/operations');

const DEFAULT_PROVIDER_ID = 'xiareng';
const DEFAULT_ACCOUNT_KEY = 'default';
const MAX_IMPORT_COUNT = 20;
const XIARRENG_CATALOG_CACHE_TTL_MS = 60_000;
const XIARRENG_CATALOG_CACHE_MAX_ENTRIES = 8;
const XIARRENG_CATALOG_SNAPSHOT_STORE_KEY = Symbol.for('zaoyoe.shop-supplier.xiareng-catalog-snapshots-v2');
const SUPPLIER_ORDER_NO = /^[\p{L}\p{N}._:-]{6,160}$/u;

function getXiarengCatalogSnapshotStore() {
    const existing = globalThis[XIARRENG_CATALOG_SNAPSHOT_STORE_KEY];
    if (existing?.snapshots instanceof Map && existing?.pending instanceof Map) return existing;

    const store = { snapshots: new Map(), latestSnapshots: new Map(), pending: new Map() };
    Object.defineProperty(globalThis, XIARRENG_CATALOG_SNAPSHOT_STORE_KEY, {
        configurable: true,
        value: store
    });
    return store;
}

function normalizeText(value, maxLength = 200) {
    return String(value ?? '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeProviderId(value) {
    return normalizeText(value || DEFAULT_PROVIDER_ID, 64).toLowerCase();
}

function normalizeGoodsNo(value) {
    return normalizeText(value, 160);
}

function normalizePage(value, fallback, maximum) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function parseBoundedPositiveInteger(value, fallback, maximum) {
    if (value == null || value === '') return fallback;
    if (!/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function normalizeDraftCardPage(result, page, limit) {
    if (!result || result.page !== page || result.limit !== limit || !Array.isArray(result.cards)
        || result.cards.length > limit || !Number.isSafeInteger(result.total) || result.total < result.cards.length) return null;
    const cards = [];
    for (const card of result.cards) {
        if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
        const id = typeof card.id === 'string' ? card.id : '';
        const normalizeCardText = (value) => typeof value === 'string' && value.length <= 8_000
            && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : null;
        const draft = normalizeCardText(card.draft);
        const draftPremium = normalizeCardText(card.draftPremium);
        if (!id || id !== id.trim() || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id) || draft === null || draftPremium === null) return null;
        cards.push({ id, draft, draftPremium });
    }
    return { page, limit, total: result.total, cards, importable: false, procurementReady: false };
}

function normalizeCatalogItem(adapter, source = {}) {
    if (typeof adapter?.normalizeCatalogItem === 'function') {
        const normalized = adapter.normalizeCatalogItem(source);
        return normalized && typeof normalized === 'object' ? normalized : null;
    }

    // The adapter contract is provider-neutral. This fallback is for adapters
    // that already return the normalized shape without a custom mapper.
    const providerGoodsId = normalizeGoodsNo(source.providerGoodsId || source.goodsNo || source.id);
    const name = normalizeText(source.name || source.title, 255);
    if (!providerGoodsId || !name) return null;
    return {
        providerGoodsId,
        source: normalizeText(source.source, 32).toLowerCase() || null,
        name,
        description: normalizeText(source.description, 4000),
        imageUrl: normalizeText(source.imageUrl, 1000),
        supplierUnitPrice: source.supplierUnitPrice ?? null,
        currency: normalizeText(source.currency || 'CNY', 12).toUpperCase() || 'CNY',
        availableQuantity: Number.isInteger(Number(source.availableQuantity)) && Number(source.availableQuantity) >= 0
            ? Number(source.availableQuantity)
            : null,
        salesCount: Number.isInteger(Number(source.salesCount)) && Number(source.salesCount) >= 0
            ? Number(source.salesCount)
            : null,
        minimumQuantity: Number.isInteger(Number(source.minimumQuantity)) ? Number(source.minimumQuantity) : null,
        deliveryMethod: Number.isInteger(Number(source.deliveryMethod)) ? Number(source.deliveryMethod) : null
    };
}

function normalizeCatalogCategory(source = {}, index = 0) {
    const categoryKey = normalizeText(source.categoryKey, 32);
    if (!/^cat-\d{1,5}$/.test(categoryKey)) return null;
    const rawId = source.upstreamIdCandidate;
    const upstreamIdCandidate = ['string', 'number'].includes(typeof rawId) ? String(rawId) : '';
    const validCandidate = upstreamIdCandidate && upstreamIdCandidate === upstreamIdCandidate.trim()
        && upstreamIdCandidate.length <= 160 && !/[\u0000-\u001f\u007f]/.test(upstreamIdCandidate)
        ? upstreamIdCandidate
        : null;
    const countValue = Number(source.itemCount);
    return {
        categoryKey,
        name: normalizeText(source.name, 160) || `未命名分类 ${index + 1}`,
        upstreamIdCandidate: validCandidate,
        identityStatus: 'unverified',
        itemCount: Number.isSafeInteger(countValue) && countValue >= 0 ? countValue : 0
    };
}

function isUpstreamCatalogItem(item = {}) {
    const source = normalizeText(item.source, 32).toLowerCase();
    return !source || source === 'supply';
}

function isMissingSupplierSchemaError(error = {}) {
    const text = [error.message, error.details, error.hint, error.code]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return text.includes('shop_supplier_accounts')
        || text.includes('shop_supplier_product_mappings')
        || text.includes('shop_supplier_availability')
        || text.includes('import_shop_supplier_draft_v2')
        || text.includes('supplier_variant')
        || text.includes('import_snapshot')
        || text.includes('schema cache')
        || text.includes('undefined table')
        || text.includes('42p01');
}

function getSafeSupplierError(error) {
    const code = normalizeText(error?.code, 80) || 'supplier_error';
    if (code === 'supplier_not_configured' || code === 'supplier_capability_unsupported') {
        return {
            statusCode: 503,
            code: 'supplier_not_configured',
            message: '该供应商接口尚未配置，请联系管理员。'
        };
    }
    if (code === 'supplier_draft_cards_preview_only') {
        return {
            statusCode: 409,
            code,
            message: '预选卡商品仅开放只读分页预览，不能读取库存或报价。'
        };
    }
    return {
        statusCode: 502,
        code,
        message: '上游商品目录暂不可用，请稍后重试。'
    };
}

function createSupplierCatalogHandler(dependencies = {}) {
    const requireAdminImpl = dependencies.requireAdmin || requireAdmin;
    const sendJsonImpl = dependencies.sendJson || sendJson;
    const parseJsonBodyImpl = dependencies.parseJsonBody || parseJsonBody;
    const writeAuditImpl = dependencies.writeAdminAuditLog || writeAdminAuditLog;
    const registryFactory = dependencies.registryFactory || createConfiguredSupplierAdapterRegistry;
    const env = dependencies.env || process.env;
    const now = dependencies.now || Date.now;
    // Local preview reloads Admin API modules per request; keep its short-lived snapshots outside this closure.
    const {
        snapshots: xiarengCatalogSnapshots,
        latestSnapshots: latestXiarengCatalogSnapshots,
        pending: pendingXiarengCatalogSnapshots
    } = getXiarengCatalogSnapshotStore();

    async function loadXiarengCatalogSnapshot({ adapter, account, site, refresh = false }) {
        const cacheKey = `${account.id}:${site}`;
        const latestSnapshotKey = latestXiarengCatalogSnapshots.get(cacheKey);
        const cached = latestSnapshotKey ? xiarengCatalogSnapshots.get(latestSnapshotKey) : null;
        if (!refresh && cached && cached.expiresAtMs > now()) {
            xiarengCatalogSnapshots.delete(latestSnapshotKey);
            xiarengCatalogSnapshots.set(latestSnapshotKey, cached);
            return cached;
        }
        const pending = pendingXiarengCatalogSnapshots.get(cacheKey);
        if (pending) return pending;

        const loading = (async () => {
            const result = await adapter.listAllGoods();
            if (!Array.isArray(result?.categories) || !Array.isArray(result?.items)) {
                throw new Error('Invalid supplier catalog snapshot');
            }
            const categories = result.categories.map(normalizeCatalogCategory);
            if (categories.some((category) => !category)
                || new Set(categories.map((category) => category.categoryKey)).size !== categories.length) {
                throw new Error('Invalid supplier category snapshot');
            }
            const categoryKeys = new Set(categories.map((category) => category.categoryKey));
            const itemsByGoodsId = new Map();
            for (const source of result.items) {
                const normalized = normalizeCatalogItem(adapter, source);
                if (!normalized) continue;
                const categoryKeyList = [...new Set((Array.isArray(normalized.catalogCategoryKeys) ? normalized.catalogCategoryKeys : [])
                    .filter((key) => categoryKeys.has(key)))];
                const existing = itemsByGoodsId.get(normalized.providerGoodsId);
                if (existing) {
                    existing.catalogCategoryKeys = [...new Set([...existing.catalogCategoryKeys, ...categoryKeyList])];
                } else {
                    itemsByGoodsId.set(normalized.providerGoodsId, { ...normalized, catalogCategoryKeys: categoryKeyList });
                }
            }
            const items = [...itemsByGoodsId.values()];
            const counts = new Map(categories.map((category) => [category.categoryKey, new Set()]));
            for (const item of items) {
                for (const key of item.catalogCategoryKeys) counts.get(key)?.add(item.providerGoodsId);
            }
            const safeCategories = categories.map((category) => ({ ...category, itemCount: counts.get(category.categoryKey)?.size || 0 }));
            const syncedAtMs = now();
            const snapshot = {
                snapshotId: crypto.randomUUID(),
                categories: safeCategories,
                items,
                syncedAt: new Date(syncedAtMs).toISOString(),
                expiresAt: new Date(syncedAtMs + XIARRENG_CATALOG_CACHE_TTL_MS).toISOString(),
                expiresAtMs: syncedAtMs + XIARRENG_CATALOG_CACHE_TTL_MS
            };
            for (const [snapshotKey, cachedSnapshot] of xiarengCatalogSnapshots) {
                if (cachedSnapshot.expiresAtMs > now()) continue;
                xiarengCatalogSnapshots.delete(snapshotKey);
                const scopeKey = snapshotKey.slice(0, snapshotKey.lastIndexOf(':'));
                if (latestXiarengCatalogSnapshots.get(scopeKey) === snapshotKey) {
                    latestXiarengCatalogSnapshots.delete(scopeKey);
                }
            }
            const snapshotKey = `${cacheKey}:${snapshot.snapshotId}`;
            xiarengCatalogSnapshots.set(snapshotKey, snapshot);
            latestXiarengCatalogSnapshots.set(cacheKey, snapshotKey);
            while (xiarengCatalogSnapshots.size > XIARRENG_CATALOG_CACHE_MAX_ENTRIES) {
                const oldestKey = xiarengCatalogSnapshots.keys().next().value;
                xiarengCatalogSnapshots.delete(oldestKey);
                const scopeKey = oldestKey.slice(0, oldestKey.lastIndexOf(':'));
                if (latestXiarengCatalogSnapshots.get(scopeKey) === oldestKey) {
                    latestXiarengCatalogSnapshots.delete(scopeKey);
                }
            }
            return snapshot;
        })();
        pendingXiarengCatalogSnapshots.set(cacheKey, loading);
        try {
            return await loading;
        } finally {
            if (pendingXiarengCatalogSnapshots.get(cacheKey) === loading) pendingXiarengCatalogSnapshots.delete(cacheKey);
        }
    }

    async function resolveAccount(supabase, providerId, selectedAccountKey = '') {
        const accountKey = selectedAccountKey || (providerId === '16688'
            ? normalizeText(env.SUPPLIER_16688_ACCOUNT_KEY || DEFAULT_ACCOUNT_KEY, 64).toLowerCase()
            : DEFAULT_ACCOUNT_KEY);
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(accountKey)) {
            const error = new Error('账号标识无效。');
            error.statusCode = 400;
            throw error;
        }
        const { data, error } = await supabase
            .from('shop_supplier_accounts')
            .select('id, provider_id, account_key, display_name, credential_ref, is_enabled')
            .eq('provider_id', providerId)
            .eq('account_key', accountKey)
            .maybeSingle();
        if (error) throw error;
        if (!data?.id) {
            const error = new Error('Supplier account is not provisioned');
            error.code = 'supplier_account_not_configured';
            error.statusCode = 409;
            throw error;
        }
        if (data.is_enabled !== true) {
            const error = new Error('Supplier account is disabled');
            error.code = 'supplier_account_disabled';
            error.statusCode = 409;
            throw error;
        }
        return data;
    }

    async function importOne({ supabase, adapter, account, adminId, providerId, site, goodsNo }) {
        const { data: existingMapping, error: lookupError } = await supabase
            .from('shop_supplier_product_mappings')
            .select('id, product_id, sku_id, site')
            .eq('supplier_account_id', account.id)
            .eq('site', site)
            .eq('supplier_goods_no', goodsNo)
            .maybeSingle();
        if (lookupError) throw lookupError;

        if (existingMapping) {
            return {
                goodsNo,
                status: 'already_imported',
                productId: existingMapping.product_id,
                skuId: existingMapping.sku_id || null,
                site: existingMapping.site
            };
        }

        const source = await adapter.getGoodsDetail(goodsNo);
        const catalogItem = normalizeCatalogItem(adapter, source);
        if (!catalogItem || catalogItem.providerGoodsId !== goodsNo || !isUpstreamCatalogItem(catalogItem)) {
            const error = new Error('Supplier returned incomplete or non-upstream goods details');
            error.code = 'supplier_invalid_goods';
            throw error;
        }
        if (catalogItem.draftStatus === 1) {
            const error = new Error('预选卡商品仅开放只读分页预览，不能导入。');
            error.code = 'supplier_draft_cards_preview_only';
            throw error;
        }

        const { data: product, error: productError } = await supabase
            .from('shop_products')
            .insert({
                name: catalogItem.name.slice(0, 100),
                description: null,
                category: 'resource',
                tags: [],
                price_points: 0,
                stock_count: 0,
                is_active: false
            })
            .select('id, name')
            .single();
        if (productError || !product?.id) throw productError || new Error('Draft product creation failed');

        try {
            const { data: sku, error: skuError } = await supabase
                .from('shop_product_skus')
                .select('id')
                .eq('product_id', product.id)
                .eq('is_default', true)
                .maybeSingle();
            if (skuError) throw skuError;

            const { error: mappingError } = await supabase
                .from('shop_supplier_product_mappings')
                .insert({
                    site,
                    supplier_account_id: account.id,
                    product_id: product.id,
                    sku_id: sku?.id || null,
                    supplier_goods_no: goodsNo,
                    priority: 100,
                    is_primary: true,
                    is_enabled: false
                });
            if (mappingError) throw mappingError;

            await writeAuditImpl({
                supabase,
                adminId,
                module: 'shop',
                site,
                actionType: 'shop.supplier_catalog.import',
                details: {
                    provider_id: providerId,
                    supplier_account_id: account.id,
                    supplier_goods_no: goodsNo,
                    product_id: product.id,
                    sku_id: sku?.id || null,
                    is_active: false,
                    mapping_enabled: false
                }
            });

            return {
                goodsNo,
                status: 'imported_as_draft',
                productId: product.id,
                skuId: sku?.id || null,
                site
            };
        } catch (error) {
            // Supabase REST has no transaction spanning these tables. Remove the
            // just-created, inactive product if its provider mapping could not be
            // persisted, avoiding an untraceable draft in the shop editor.
            await supabase.from('shop_products').delete().eq('id', product.id);
            throw error;
        }
    }

    async function importVariantDraft({ supabase, adapter, account, adminId, site, goodsNo, variant = {} }) {
        if (site !== 'cn') {
            const error = new Error('虾仁只读草稿目前仅支持国内站。');
            error.code = 'supplier_site_unsupported';
            throw error;
        }
        const item = normalizeCatalogItem(adapter, await adapter.getGoodsDetail(goodsNo));
        if (!item || item.providerGoodsId !== goodsNo || !isUpstreamCatalogItem(item)) {
            const error = new Error('Invalid supplier goods');
            error.code = 'supplier_invalid_goods';
            throw error;
        }
        if (item.draftStatus === 1) {
            const error = new Error('预选卡商品仅开放只读分页预览，不能导入。');
            error.code = 'supplier_draft_cards_preview_only';
            throw error;
        }
        let selected;
        try { selected = adapter.normalizeVariant(item, variant); } catch (_) {
            const error = new Error('商品规格未核验，请打开详情选择种类；复杂 SKU、自定义填写项及预选卡暂仅预览。');
            error.code = 'supplier_variant_review_required';
            throw error;
        }
        const snapshot = {
            name: item.name, supplierUnitPrice: item.supplierUnitPrice, currency: item.currency,
            currencyStatus: item.currencyStatus, availableQuantity: item.availableQuantity,
            minimumQuantity: item.minimumQuantity, deliveryLabel: item.deliveryLabel,
            checkedAt: new Date().toISOString(), procurementReady: false
        };
        const { data, error } = await supabase.rpc('import_shop_supplier_draft_v2', {
            p_account_id: account.id, p_site: site, p_goods_no: goodsNo, p_variant: selected,
            p_name: `${item.name}${selected.race ? ` · ${selected.race}` : ''}`.slice(0, 100),
            p_snapshot: snapshot, p_admin_id: adminId
        });
        if (error) throw error;
        if (!['imported_as_draft', 'already_imported'].includes(data?.status)) throw new Error('Invalid draft import result');
        return { ...data, goodsNo };
    }

    return async function supplierCatalogHandler(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        const method = String(req.method || '').toUpperCase();
        if (!['GET', 'POST'].includes(method)) {
            res.setHeader('Allow', 'GET, POST');
            return sendJsonImpl(res, 405, { success: false, message: 'Method not allowed' });
        }

        try {
            const { supabase, user } = await requireAdminImpl(req, { permission: 'shop.manage' });
            const url = new URL(req.url || '', 'http://localhost');
            const body = method === 'POST' ? await parseJsonBodyImpl(req) : {};
            const providerId = normalizeProviderId(method === 'GET'
                ? url.searchParams.get('providerId')
                : body.providerId);
            const action = normalizeText(method === 'GET'
                ? url.searchParams.get('action') || 'list'
                : body.action, 40).toLowerCase();
            if (!PROVIDERS.some((provider) => provider.providerId === providerId)) {
                return sendJsonImpl(res, 400, { success: false, message: '不支持的供应商。' });
            }
            if (method === 'POST' && action === 'runtime-resume') {
                const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
                if (!body || Object.keys(body).some(key => !['action', 'providerId', 'accountKey', 'intentId', 'orderId', 'fundingKind', 'site', 'operationId'].includes(key))
                    || !uuid.test(body.intentId || '') || !uuid.test(body.operationId || '') || !uuid.test(body.orderId || '')
                    || !uuid.test(user?.id || '') || typeof body.accountKey !== 'string' || !body.accountKey
                    || !['points', 'guest_cash'].includes(body.fundingKind) || body.site !== 'cn') {
                    return sendJsonImpl(res, 400, { success: false, message: '请提供完整的原订单和运行任务信息。' });
                }
                // Historical recovery stays independent of current account/catalog enablement.
                const operations = await loadOperations(supabase, { providerId, accountKey: body.accountKey,
                    orderId: body.orderId, fundingKind: body.fundingKind, site: body.site, limit: 1 });
                if (operations.rows.length !== 1 || operations.rows[0].intentId !== body.intentId || operations.hasMore) {
                    return sendJsonImpl(res, 404, { success: false, message: '未找到对应的原采购任务。' });
                }
                let result;
                try { result = await supabase.rpc('fn_shop_supplier_runtime_v2', { p_action: 'resume',
                    p_intent_id: body.intentId, p_token: body.operationId, p_actor_id: user.id }); }
                catch { result = null; }
                if (!result || result.error || !result.data || typeof result.data.applied !== 'boolean'
                    || result.data.operationId !== body.operationId) {
                    return sendJsonImpl(res, 503, { success: false, message: '尚未确认恢复结果，请刷新记录或重试本次操作。' });
                }
                return sendJsonImpl(res, 200, { success: true, applied: result.data.applied, operationId: body.operationId });
            }
            if (method === 'GET' && action === 'procurements') {
                const accountKey = normalizeText(url.searchParams.get('accountKey'), 64).toLowerCase();
                if (!accountKey) return sendJsonImpl(res, 400, { success: false, message: '请选择供应商账号。' });
                const operations = await loadOperations(supabase, {
                    providerId, accountKey, site: url.searchParams.get('site') || 'cn', limit: 50
                });
                return sendJsonImpl(res, 200, { success: true, ...operations });
            }
            if (method === 'GET' && action === 'accounts') {
                const { data, error } = await supabase.from('shop_supplier_accounts')
                    .select('id, provider_id, account_key, display_name, credential_ref, is_enabled')
                    .eq('provider_id', providerId);
                if (error) throw error;
                return sendJsonImpl(res, 200, {
                    success: true, providerId, providers: PROVIDERS,
                    accounts: (Array.isArray(data) ? data : []).map((account) => ({
                        id: account.id, accountKey: account.account_key, displayName: account.display_name,
                        enabled: account.is_enabled === true, ...getSupplierAccountConfiguration(account, env),
                        readOnly: providerId === 'xiareng', procurementReady: false
                    }))
                });
            }
            if (method === 'GET' && action === 'mappings') {
                const productId = normalizeText(url.searchParams.get('productId'), 64);
                if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(productId)) return sendJsonImpl(res, 400, { success: false, message: '商品标识无效。' });
                let { data, error } = await supabase.from('shop_supplier_product_mappings')
                    .select('id, site, supplier_account_id, supplier_goods_no, supplier_variant_key, supplier_variant, import_snapshot, is_enabled, contract_version, shop_supplier_accounts(provider_id, display_name)')
                    .eq('product_id', productId);
                if (error && ['42703', 'PGRST204'].includes(error.code)) {
                    ({ data, error } = await supabase.from('shop_supplier_product_mappings')
                        .select('id, site, supplier_account_id, supplier_goods_no, is_enabled, shop_supplier_accounts(provider_id, display_name)')
                        .eq('product_id', productId));
                }
                if (error) throw error;
                return sendJsonImpl(res, 200, { success: true, mappings: (data || []).map((mapping) => ({
                    id: mapping.id, site: mapping.site, accountName: mapping.shop_supplier_accounts?.display_name || '',
                    providerId: mapping.shop_supplier_accounts?.provider_id || '', goodsNo: mapping.supplier_goods_no,
                    variant: typeof mapping.supplier_variant?.race === 'string' ? { race: normalizeText(mapping.supplier_variant.race, 160) } : {},
                    enabled: mapping.is_enabled === true,
                    snapshot: mapping.import_snapshot && typeof mapping.import_snapshot === 'object' ? {
                        supplierUnitPrice: /^\d{1,12}(?:\.\d{1,8})?$/.test(String(mapping.import_snapshot.supplierUnitPrice ?? '')) ? String(mapping.import_snapshot.supplierUnitPrice) : null,
                        currency: /^[A-Z]{3}$/.test(String(mapping.import_snapshot.currency || '')) ? mapping.import_snapshot.currency : null,
                        procurementReady: false
                    } : {},
                    contractVersion: mapping.contract_version, procurementReady: false
                })) });
            }
            if (!(method === 'GET' && ['list', 'detail', 'preview', 'reconcile', 'draft-cards'].includes(action)) && !(method === 'POST' && action === 'import')) {
                return sendJsonImpl(res, 400, { success: false, message: 'Unsupported supplier catalog action' });
            }
            let orderLookupSite = '';
            let orderNo = '';
            let draftGoodsNo = '';
            let draftPage = 1;
            let draftLimit = 20;
            if (method === 'GET' && action === 'draft-cards') {
                if (providerId !== 'xiareng') return sendJsonImpl(res, 400, { success: false, message: '预选卡只读预览仅支持虾仁。' });
                const rawGoodsNo = String(url.searchParams.get('goodsNo') ?? '');
                draftGoodsNo = normalizeGoodsNo(rawGoodsNo);
                draftPage = parseBoundedPositiveInteger(url.searchParams.get('page'), 1, 10_000);
                draftLimit = parseBoundedPositiveInteger(url.searchParams.get('limit'), 20, 50);
                if (!draftGoodsNo || draftGoodsNo !== rawGoodsNo || draftPage === null || draftLimit === null) {
                    return sendJsonImpl(res, 400, { success: false, code: 'supplier_draft_cards_invalid_request', message: '商品编码或分页参数无效。' });
                }
            }
            if (method === 'GET' && action === 'reconcile') {
                orderLookupSite = normalizeText(url.searchParams.get('site') || 'cn', 16).toLowerCase();
                const rawOrderNo = String(url.searchParams.get('orderNo') ?? '');
                if (!['cn', 'intl'].includes(orderLookupSite)) {
                    return sendJsonImpl(res, 400, { success: false, message: '站点无效。' });
                }
                if (rawOrderNo !== rawOrderNo.trim() || !SUPPLIER_ORDER_NO.test(rawOrderNo)) {
                    return sendJsonImpl(res, 400, { success: false, message: '请输入完整且有效的上游订单号。' });
                }
                orderNo = rawOrderNo;
            }
            // Disabled accounts fail closed before credentials are resolved or any
            // network call is made. Each request carries its selected account.
            const accountKey = normalizeText(method === 'GET' ? url.searchParams.get('accountKey') : body.accountKey, 64).toLowerCase();
            const account = await resolveAccount(supabase, providerId, accountKey);
            const registry = registryFactory({ env, account });
            const adapter = registry.require(providerId, method === 'GET' && action === 'reconcile' ? 'orderLookup' : 'catalog');

            if (method === 'GET' && action === 'reconcile') {
                let upstream;
                try {
                    upstream = await adapter.queryPurchaseByOrderNo(orderNo);
                } catch (_) {
                    return sendJsonImpl(res, 502, {
                        success: false,
                        code: 'supplier_order_lookup_failed',
                        message: '上游订单查询未成功。查无结果、超时或错误不能证明订单未受理，请核对完整订单号后重试。'
                    });
                }
                const queriedAt = normalizeText(upstream?.queriedAt, 40);
                if (upstream?.supplierOrderNo !== orderNo
                    || !['paid', 'unpaid'].includes(upstream?.paymentStatus)
                    || typeof upstream?.deliveryContentPresent !== 'boolean'
                    || !Number.isFinite(Date.parse(queriedAt))
                    || !/^[a-f\d]{64}$/i.test(String(upstream?.evidenceHash || ''))) {
                    return sendJsonImpl(res, 502, {
                        success: false,
                        code: 'supplier_order_lookup_failed',
                        message: '上游订单查询结果无法安全核验。请勿据此处理订单。'
                    });
                }
                return sendJsonImpl(res, 200, {
                    success: true,
                    result: {
                        supplierOrderNo: orderNo,
                        paymentStatus: upstream.paymentStatus,
                        deliveryContentPresent: upstream.deliveryContentPresent,
                        queriedAt,
                        evidenceHash: String(upstream.evidenceHash).toLowerCase()
                    }
                });
            }

            if (method === 'GET' && action === 'draft-cards') {
                if (typeof adapter.getDraftCards !== 'function') {
                    return sendJsonImpl(res, 409, { success: false, code: 'supplier_draft_cards_unavailable', message: '虾仁预选卡只读预览暂不可用。' });
                }
                const result = await adapter.getDraftCards({ goodsNo: draftGoodsNo, page: draftPage, limit: draftLimit });
                const preview = normalizeDraftCardPage(result, draftPage, draftLimit);
                if (!preview) return sendJsonImpl(res, 502, { success: false, code: 'supplier_invalid_response', message: '预选卡分页数据无法安全核验。' });
                return sendJsonImpl(res, 200, {
                    success: true,
                    providerId,
                    accountKey: account.account_key,
                    ...preview,
                    note: '只读预览不代表库存锁定、可采购或可交付；卡片内容不会保存到本地商品或供应商目录。'
                });
            }

            if (method === 'GET' && action === 'list') {
                const pageNo = normalizePage(url.searchParams.get('pageNo'), 1, 1_000_000);
                const pageSize = normalizePage(url.searchParams.get('pageSize'), 20, 100);
                if (providerId === 'xiareng' && typeof adapter.listAllGoods === 'function') {
                    const requestedSnapshotId = String(url.searchParams.get('snapshotId') || '');
                    const categoryKey = String(url.searchParams.get('categoryKey') || '');
                    const refresh = url.searchParams.get('refresh') === '1';
                    const site = normalizeText(url.searchParams.get('site') || 'cn', 16).toLowerCase();
                    if ((requestedSnapshotId && !/^[a-f\d-]{36}$/i.test(requestedSnapshotId))
                        || (requestedSnapshotId && refresh)
                        || (categoryKey && !/^cat-\d{1,5}$/.test(categoryKey))
                        || (categoryKey && !requestedSnapshotId)
                        || (refresh && categoryKey)
                        || !['cn', 'intl'].includes(site)) {
                        return sendJsonImpl(res, 400, { success: false, code: 'supplier_catalog_filter_invalid', message: '目录筛选参数无效。' });
                    }
                    const cacheKey = `${account.id}:${site}`;
                    let snapshot;
                    if (requestedSnapshotId) {
                        const snapshotKey = `${cacheKey}:${requestedSnapshotId}`;
                        snapshot = xiarengCatalogSnapshots.get(snapshotKey);
                        if (!snapshot || snapshot.expiresAtMs <= now()) {
                            if (snapshot) xiarengCatalogSnapshots.delete(snapshotKey);
                            if (latestXiarengCatalogSnapshots.get(cacheKey) === snapshotKey) {
                                latestXiarengCatalogSnapshots.delete(cacheKey);
                            }
                            return sendJsonImpl(res, 409, {
                                success: false,
                                code: 'supplier_catalog_snapshot_expired',
                                message: '虾仁目录快照已过期或已更新，请重新查询目录。'
                            });
                        }
                        xiarengCatalogSnapshots.delete(snapshotKey);
                        xiarengCatalogSnapshots.set(snapshotKey, snapshot);
                    } else {
                        snapshot = await loadXiarengCatalogSnapshot({
                            adapter,
                            account,
                            site,
                            refresh
                        });
                    }
                    if (categoryKey && !snapshot.categories.some((category) => category.categoryKey === categoryKey)) {
                        return sendJsonImpl(res, 400, { success: false, code: 'supplier_catalog_category_invalid', message: '所选分类不属于当前目录快照。' });
                    }
                    const keywords = normalizeText(url.searchParams.get('keywords'), 100).toLowerCase();
                    const filteredItems = snapshot.items.filter((item) => {
                        if (categoryKey && !item.catalogCategoryKeys.includes(categoryKey)) return false;
                        return !keywords || `${item.name} ${item.providerGoodsId}`.toLowerCase().includes(keywords);
                    });
                    return sendJsonImpl(res, 200, {
                        success: true,
                        providerId,
                        accountKey: account.account_key,
                        pageNo,
                        pageSize,
                        total: filteredItems.length,
                        items: filteredItems.slice((pageNo - 1) * pageSize, pageNo * pageSize),
                        categories: snapshot.categories,
                        snapshotItemCount: snapshot.items.length,
                        snapshotId: snapshot.snapshotId,
                        syncedAt: snapshot.syncedAt,
                        expiresAt: snapshot.expiresAt,
                        categoryIdentityStatus: 'unverified',
                        note: '目录分类仅用于当前快照内筛选；上游分类 ID 与层级语义尚未核验，不会保存为本地分类映射。'
                    });
                }
                const result = await adapter.listGoods({
                    pageNo,
                    pageSize,
                    keywords: normalizeText(url.searchParams.get('keywords'), 100),
                    source: normalizeText(url.searchParams.get('source'), 100)
                });
                const items = (Array.isArray(result?.items) ? result.items : [])
                    .map((item) => normalizeCatalogItem(adapter, item))
                    .filter(Boolean);
                return sendJsonImpl(res, 200, {
                    success: true,
                    providerId,
                    accountKey: account.account_key,
                    pageNo,
                    pageSize,
                    total: Math.max(0, Number(result?.total) || 0),
                    items,
                    note: '上游库存和报价仅供同步参考，不代表已锁定库存或已具备在线下单条件。'
                });
            }

            if (method === 'GET' && action === 'detail') {
                const goodsNo = normalizeGoodsNo(url.searchParams.get('goodsNo') || url.searchParams.get('goods_no'));
                if (!goodsNo) return sendJsonImpl(res, 400, { success: false, message: 'goodsNo is required' });
                const source = await adapter.getGoodsDetail(goodsNo);
                const item = normalizeCatalogItem(adapter, source);
                if (!item || item.providerGoodsId !== goodsNo || !isUpstreamCatalogItem(item)) {
                    return sendJsonImpl(res, 502, { success: false, message: '上游商品信息不完整，请稍后重试。' });
                }
                return sendJsonImpl(res, 200, { success: true, providerId, accountKey: account.account_key, item });
            }

            if (method === 'GET' && action === 'preview') {
                const goodsNo = normalizeGoodsNo(url.searchParams.get('goodsNo'));
                if (!goodsNo) return sendJsonImpl(res, 400, { success: false, message: 'goodsNo is required' });
                registry.require(providerId, 'stock');
                registry.require(providerId, 'quote');
                const variant = url.searchParams.get('race') ? { race: url.searchParams.get('race') } : {};
                let stock, quote;
                try {
                    // Read failures are independent. No read operation reserves
                    // stock, charges balance, or changes the local mapping.
                    [stock, quote] = await Promise.all([
                        adapter.getStock({ goodsNo, variant }),
                        adapter.quotePrice({ goodsNo, quantity: 1, variant })
                    ]);
                } catch (error) {
                    if (error instanceof TypeError) return sendJsonImpl(res, 409, { success: false, code: 'supplier_variant_review_required', message: '请先核对并选择支持的商品规格。' });
                    throw error;
                }
                return sendJsonImpl(res, 200, { success: true, providerId, accountKey: account.account_key, stock, quote, procurementReady: false });
            }

            if (method !== 'POST' || action !== 'import') {
                return sendJsonImpl(res, 400, { success: false, message: 'Unsupported supplier catalog action' });
            }

            const site = normalizeText(body.site || 'cn', 16).toLowerCase();
            if (!['cn', 'intl'].includes(site)) {
                return sendJsonImpl(res, 400, { success: false, message: 'site must be cn or intl' });
            }
            const goodsNos = [...new Set((Array.isArray(body.goodsNos) ? body.goodsNos : [body.goodsNo])
                .map(normalizeGoodsNo)
                .filter(Boolean))];
            if (!goodsNos.length) return sendJsonImpl(res, 400, { success: false, message: 'goodsNos is required' });
            if (goodsNos.length > MAX_IMPORT_COUNT) {
                return sendJsonImpl(res, 400, {
                    success: false,
                    message: `单次最多导入 ${MAX_IMPORT_COUNT} 个商品。`
                });
            }

            const results = [];
            for (const goodsNo of goodsNos) {
                try {
                    const importer = typeof adapter.normalizeVariant === 'function' ? importVariantDraft : importOne;
                    results.push(await importer({
                        supabase,
                        adapter,
                        account,
                        adminId: user?.id || null,
                        providerId,
                        site,
                        goodsNo,
                        variant: body.variants?.[goodsNo] || {}
                    }));
                } catch (error) {
                    results.push({
                        goodsNo,
                        status: 'failed',
                        code: normalizeText(error?.code, 80) || 'supplier_import_failed',
                        message: isMissingSupplierSchemaError(error) ? '只读铺货迁移尚未应用，未创建草稿。'
                            : ['supplier_variant_review_required', 'supplier_site_unsupported', 'supplier_draft_cards_preview_only'].includes(error?.code) ? error.message
                            : error?.code === 'supplier_invalid_goods'
                            ? '上游商品资料不完整，未创建铺货草稿。'
                            : '导入失败，请检查上游商品并重试。'
                    });
                }
            }

            return sendJsonImpl(res, 200, {
                success: results.every((result) => result.status !== 'failed'),
                providerId,
                accountKey: account.account_key,
                site,
                results,
                note: '导入内容均为未上架草稿；供应商映射保持禁用，不会开放购买或游客购买。'
            });
        } catch (error) {
            if (isMissingSupplierSchemaError(error)) {
                return sendJsonImpl(res, 503, {
                    success: false,
                    code: 'supplier_schema_not_ready',
                    message: '供应商目录数据表尚未初始化，请先由负责人审阅并应用数据库迁移。'
                });
            }
            if (error?.code === 'supplier_account_not_configured') {
                return sendJsonImpl(res, Number(error.statusCode) || 409, {
                    success: false,
                    code: error.code,
                    message: '供应商账号尚未初始化，请先应用供应商目录迁移。'
                });
            }
            if (error?.code === 'supplier_account_disabled') {
                return sendJsonImpl(res, Number(error.statusCode) || 409, {
                    success: false,
                    code: error.code,
                    message: '该供应商账号当前已停用，未调用上游接口。'
                });
            }
            if (error?.code === 'supplier_not_configured' || error?.code === 'supplier_capability_unsupported') {
                return sendJsonImpl(res, 503, {
                    success: false,
                    code: 'supplier_not_configured',
                    message: '该供应商接口尚未配置，请联系管理员。'
                });
            }
            if (error?.statusCode) {
                return sendJsonImpl(res, Number(error.statusCode), {
                    success: false,
                    code: error.code || 'supplier_catalog_error',
                    message: error.message || '供应商目录请求失败。'
                });
            }
            const safeError = getSafeSupplierError(error);
            return sendJsonImpl(res, safeError.statusCode, {
                success: false,
                code: safeError.code,
                message: safeError.message
            });
        }
    };
}

const handler = createSupplierCatalogHandler();
handler.createSupplierCatalogHandler = createSupplierCatalogHandler;
handler.normalizeCatalogItem = normalizeCatalogItem;
handler.isMissingSupplierSchemaError = isMissingSupplierSchemaError;
handler.isUpstreamCatalogItem = isUpstreamCatalogItem;

module.exports = handler;
