'use strict';

const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { createConfiguredSupplierAdapterRegistry, PROVIDERS, getSupplierAccountConfiguration } = require('../../../../server/integrations/suppliers/registry');

const { loadOperations } = require('../../../integrations/suppliers/operations');

const DEFAULT_PROVIDER_ID = '16688';
const DEFAULT_ACCOUNT_KEY = 'default';
const MAX_IMPORT_COUNT = 20;
const SUPPLIER_ORDER_NO = /^[\p{L}\p{N}._:-]{6,160}$/u;

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
            if (!(method === 'GET' && ['list', 'detail', 'preview', 'reconcile'].includes(action)) && !(method === 'POST' && action === 'import')) {
                return sendJsonImpl(res, 400, { success: false, message: 'Unsupported supplier catalog action' });
            }
            let orderLookupSite = '';
            let orderNo = '';
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

            if (method === 'GET' && action === 'list') {
                const pageNo = normalizePage(url.searchParams.get('pageNo'), 1, 1_000_000);
                const pageSize = normalizePage(url.searchParams.get('pageSize'), 20, 100);
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
                            : ['supplier_variant_review_required', 'supplier_site_unsupported'].includes(error?.code) ? error.message
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
