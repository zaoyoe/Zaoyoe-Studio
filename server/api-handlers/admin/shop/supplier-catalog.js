'use strict';

const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { createConfiguredSupplierAdapterRegistry } = require('../../../../server/integrations/suppliers/registry');

const DEFAULT_PROVIDER_ID = '16688';
const DEFAULT_ACCOUNT_KEY = 'default';
const MAX_IMPORT_COUNT = 20;

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

    async function resolveAccount(supabase, providerId) {
        const accountKey = providerId === '16688'
            ? normalizeText(env.SUPPLIER_16688_ACCOUNT_KEY || DEFAULT_ACCOUNT_KEY, 64).toLowerCase()
            : DEFAULT_ACCOUNT_KEY;
        const { data, error } = await supabase
            .from('shop_supplier_accounts')
            .select('id, provider_id, account_key, display_name, is_enabled')
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

    return async function supplierCatalogHandler(req, res) {
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
            // Resolve the persisted account before constructing/calling the adapter.
            // A disabled account is the explicit fail-closed switch for paused
            // providers such as 16688; no upstream request should be attempted.
            const account = await resolveAccount(supabase, providerId);
            const registry = registryFactory({ env });
            const adapter = registry.require(providerId, 'catalog');
            const action = normalizeText(method === 'GET'
                ? url.searchParams.get('action') || 'list'
                : body.action, 40).toLowerCase();

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
                return sendJsonImpl(res, 200, { success: true, providerId, item });
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
                    results.push(await importOne({
                        supabase,
                        adapter,
                        account,
                        adminId: user?.id || null,
                        providerId,
                        site,
                        goodsNo
                    }));
                } catch (error) {
                    results.push({
                        goodsNo,
                        status: 'failed',
                        code: normalizeText(error?.code, 80) || 'supplier_import_failed',
                        message: error?.code === 'supplier_invalid_goods'
                            ? '上游商品资料不完整，未创建铺货草稿。'
                            : '导入失败，请检查上游商品并重试。'
                    });
                }
            }

            return sendJsonImpl(res, 200, {
                success: results.every((result) => result.status !== 'failed'),
                providerId,
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
