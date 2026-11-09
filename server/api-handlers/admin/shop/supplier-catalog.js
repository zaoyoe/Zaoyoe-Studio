'use strict';

const crypto = require('node:crypto');
const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { createConfiguredSupplierAdapterRegistry, PROVIDERS, getSupplierAccountConfiguration } = require('../../../../server/integrations/suppliers/registry');
const { buildCategoryTree, findGroupCategoryKeys, findFirstCategoryInTree, normalizeGroupKey, matchCategoryIconUrl } = require('../../../integrations/suppliers/xiareng/category-groups');
const {
    DEFAULT_GATEWAY,
    resolveFullMediaUrl,
    uploadRemoteMediaToR2,
    syncHtmlMediaToR2
} = require('./_r2-media');
const { uploadProductImageAssets } = require('./_product-image-assets');

const { loadOperations } = require('../../../integrations/suppliers/operations');
const { getSupplierDispatchPolicy, saveSupplierDispatchPolicy } = require('../../../integrations/suppliers/auto-dispatch');

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

function escapeHtmlBasic(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeSupplierRichTextHtml(rawValue) {
    const raw = normalizeText(rawValue, 32000);
    if (!raw) return '';

    // Only reconstructed tags enter the output. Link bodies stay in the text pipeline.
    const allowedTags = [];
    const tokenPrefix = `___SUPPLIER_${crypto.randomUUID().replace(/-/g, '')}_`;
    const placeholder = (idx) => `${tokenPrefix}${idx}___`;
    const protect = (tag) => { const idx = allowedTags.push(tag) - 1; return placeholder(idx); };
    const escape = (value) => escapeHtmlBasic(value);
    const decodeAttribute = (value) => String(value).replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|quot|apos|lt|gt);/gi, (entity, numeric) => {
        if (numeric) {
            const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
        }
        return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
    });
    const attribute = (attrs, name) => {
        const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
        return match ? decodeAttribute(match[2]) : '';
    };
    const mediaUrl = (value) => {
        const source = String(value || '').trim();
        if (!source || /[\u0000-\u001f\u007f\\]/.test(source) || (/^[a-z][\w+.-]*:/i.test(source) && !/^https?:\/\//i.test(source))) return '';
        try {
            const url = new URL(resolveFullMediaUrl(source, DEFAULT_GATEWAY));
            return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
        } catch (_) { return ''; }
    };
    const safeStyle = (value) => String(value).split(';').flatMap((declaration) => {
        const pair = declaration.split(':');
        if (pair.length !== 2) return [];
        const name = pair[0].trim().toLowerCase(), content = pair[1].trim().toLowerCase();
        let allowed = false;
        if (/^(?:width|height|min-width|max-width|min-height|max-height|font-size|border-radius)$/.test(name)) {
            allowed = /^(?:0|auto|\d{1,4}(?:\.\d{1,2})?(?:px|em|rem|%))$/.test(content);
        } else if (/^(?:color|background-color)$/.test(name)) {
            allowed = /^(?:#[0-9a-f]{3,8}|[a-z]{1,24}|rgba?\([\d.,%\s]+\))$/.test(content);
        } else if (name === 'text-align') allowed = /^(?:left|right|center|justify|start|end)$/.test(content);
        else if (name === 'font-weight') allowed = /^(?:normal|bold|[1-9]00)$/.test(content);
        else if (name === 'font-style') allowed = /^(?:normal|italic|oblique)$/.test(content);
        else if (name === 'text-decoration') allowed = /^(?:none|underline|line-through)$/.test(content);
        return allowed ? [`${name}:${content}`] : [];
    }).join(';');

    let processed = raw.replace(/<img\b([^>]*)>/gi, (_, attrs) => {
        const src = mediaUrl(attribute(attrs, 'src'));
        if (!src) return '';
        const alt = attribute(attrs, 'alt') || '商品详情图';
        const style = safeStyle(attribute(attrs, 'style'));
        return protect(`<img src="${escape(src)}" alt="${escape(alt)}"${style ? ` style="${escape(style)}"` : ''} loading="lazy">`);
    });
    processed = processed.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (_, attrs) => {
        const src = mediaUrl(attribute(attrs, 'src'));
        if (!src) return '';
        const poster = mediaUrl(attribute(attrs, 'poster'));
        return protect(`<video src="${escape(src)}"${poster ? ` poster="${escape(poster)}"` : ''} controls style="max-width:100%;border-radius:8px;"></video>`);
    });
    processed = processed.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, linkText) => {
        const hrefValue = attribute(attrs, 'href').trim();
        const href = /^https?:\/\//i.test(hrefValue) ? mediaUrl(hrefValue) : '';
        if (!href) return linkText;
        return protect(`<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">`) + linkText + protect('</a>');
    });
    // Preserve supported legacy formatting through the same CSS allowlist.
    processed = processed.replace(/<font\b([^>]*)>/gi, (_, attrs) => {
        const styles = [];
        const sizeMatch = attrs.match(/(?:^|\s)size\s*=\s*(["']?)(\d+)\1/i);
        if (sizeMatch) {
            const sizeNum = parseInt(sizeMatch[2], 10);
            const sizeMap = { 1: '12px', 2: '13px', 3: '14px', 4: '16px', 5: '18px', 6: '22px', 7: '28px' };
            if (sizeMap[sizeNum]) styles.push(`font-size:${sizeMap[sizeNum]}`);
            if (sizeNum >= 5) styles.push('font-weight:600');
        }
        const colorMatch = attrs.match(/(?:^|\s)color\s*=\s*(["']?)(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\1/i);
        if (colorMatch) styles.push(`color:${colorMatch[2]}`);
        styles.push(attribute(attrs, 'style'));
        const style = safeStyle(styles.join(';'));
        return protect(`<span${style ? ` style="${escape(style)}"` : ''}>`);
    });
    processed = processed.replace(/<\/font>/gi, () => protect('</span>'));
    processed = processed.replace(/<center\b[^>]*>/gi, () => protect('<div style="text-align:center;">'));
    processed = processed.replace(/<\/center>/gi, () => protect('</div>'));
    processed = processed.replace(/<\/?(p|div|span|blockquote|h[1-6]|strong|b|em|i|u|s|del|code|pre|ul|ol|li|br|hr)\b[^>]*>/gi, (tag, name) =>
        protect(tag.startsWith('</') ? `</${name.toLowerCase()}>` : `<${name.toLowerCase()}>`));
    const escaped = escape(processed).replace(new RegExp(`${tokenPrefix}(\\d+)___`, 'g'), (_, index) => allowedTags[Number(index)] || '');

    return escaped;
}

async function prepareSupplierMediaForR2({ imageUrl = '', rawDescription = '', rawPurchaseNotes = '', env = process.env }) {
    let r2ImageUrl = imageUrl ? resolveFullMediaUrl(imageUrl, DEFAULT_GATEWAY) : '';
    let imageAssets = r2ImageUrl ? { original: r2ImageUrl } : null;
    if (r2ImageUrl) {
        imageAssets = await uploadProductImageAssets(r2ImageUrl, { env });
        r2ImageUrl = imageAssets?.original || '';
    }

    const sanitizedHtml = sanitizeSupplierRichTextHtml(rawDescription);
    let r2Description = sanitizedHtml;
    if (r2Description) {
        r2Description = await syncHtmlMediaToR2(r2Description, { env, keyPrefix: 'shop/products/description' });
    }

    const sanitizedNotesHtml = rawPurchaseNotes ? sanitizeSupplierRichTextHtml(rawPurchaseNotes) : '';
    let r2Notes = sanitizedNotesHtml;
    if (r2Notes) {
        r2Notes = await syncHtmlMediaToR2(r2Notes, { env, keyPrefix: 'shop/products/notes' });
    }

    return {
        imageUrl: r2ImageUrl,
        imageAssets,
        description: r2Description,
        purchaseNotes: r2Notes
    };
}

function normalizeCostCeilingCny(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return null;
    const text = String(rawValue).trim();
    if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(text)) {
        const error = new Error('单件自动采购单价上限必须是大于 0 且不超过 100000 的有效金额（CNY）。');
        error.code = 'supplier_invalid_cost_ceiling';
        error.statusCode = 400;
        throw error;
    }
    const num = Number(text);
    if (!Number.isFinite(num) || num <= 0 || num > 100000) {
        const error = new Error('单件自动采购单价上限必须是大于 0 且不超过 100000 的有效金额（CNY）。');
        error.code = 'supplier_invalid_cost_ceiling';
        error.statusCode = 400;
        throw error;
    }
    const rounded6 = Math.round(num * 1e6) / 1e6;
    const rounded2 = Math.round(num * 100) / 100;
    return rounded6 === rounded2
        ? rounded2.toFixed(2)
        : rounded6.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
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
    const isSupplierEntity = text.includes('shop_supplier_accounts')
        || text.includes('shop_supplier_product_mappings')
        || text.includes('shop_supplier_availability')
        || text.includes('import_shop_supplier_draft')
        || text.includes('supplier_variant')
        || text.includes('import_snapshot');

    if (isSupplierEntity) return true;

    if (error.code === 'PGRST202' && text.includes('import_shop_supplier')) {
        return true;
    }

    // Only match schema cache / undefined table if it specifically refers to supplier schema
    if ((text.includes('schema cache') || text.includes('undefined table') || text.includes('42p01'))
        && (text.includes('shop_supplier') || text.includes('supplier'))) {
        return true;
    }

    return false;
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

function getCstDateString(date = new Date()) {
    const cst = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const year = cst.getUTCFullYear();
    const month = String(cst.getUTCMonth() + 1).padStart(2, '0');
    const day = String(cst.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeProductSalesConfig(config) {
    if (!config || typeof config !== 'object') {
        return null;
    }
    const rawMode = Number.parseInt(String(config.mode), 10);
    const mode = (rawMode === 1 || rawMode === 2 || rawMode === 3) ? rawMode : 3;
    const baseSales = Math.max(0, Number.parseInt(String(config.base_sales ?? 0), 10) || 0);
    const dailyMin = Math.max(0, Number.parseInt(String(config.daily_random_min ?? 0), 10) || 0);
    const dailyMax = Math.max(0, Number.parseInt(String(config.daily_random_max ?? 0), 10) || 0);
    const randomSeed = typeof config.random_seed === 'string'
        ? config.random_seed.trim().slice(0, 100)
        : (config.random_seed != null ? String(config.random_seed).trim().slice(0, 100) : '');

    let startDate = null;
    if (typeof config.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(config.start_date.trim())) {
        startDate = config.start_date.trim();
    } else if (mode === 2) {
        startDate = getCstDateString();
    }

    return {
        mode,
        base_sales: baseSales,
        daily_random_min: dailyMin,
        daily_random_max: dailyMax,
        random_seed: randomSeed,
        start_date: startDate
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
            const safeCategories = categories.map((category) => ({
                ...category,
                iconUrl: category.iconUrl || matchCategoryIconUrl(category.name),
                itemCount: counts.get(category.categoryKey)?.size || 0
            }));
            const categoryTree = buildCategoryTree({ categories: safeCategories, items });
            const syncedAtMs = now();
            const snapshot = {
                snapshotId: crypto.randomUUID(),
                categories: safeCategories,
                categoryTree,
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

    async function ensureShopCategoryExists(supabase, categoryName, options = {}) {
        const rawName = String(categoryName || '').trim();
        if (!rawName || rawName.toLowerCase() === 'other' || rawName.toLowerCase() === 'all') {
            return;
        }

        const activeEnv = options.env || env || process.env;
        let r2IconUrl = options.iconUrl || '';
        if (!r2IconUrl) {
            const seedIcon = matchCategoryIconUrl(rawName);
            if (seedIcon) {
                try {
                    r2IconUrl = await uploadRemoteMediaToR2(seedIcon, {
                        env: activeEnv,
                        keyPrefix: 'shop/categories/icons'
                    });
                } catch (_) {
                    r2IconUrl = seedIcon;
                }
            }
        } else if (r2IconUrl.startsWith('http') && !r2IconUrl.includes('r2.cloudflarestorage') && !r2IconUrl.includes('media.zaoyoe.com') && !r2IconUrl.includes('r2.fatherkey.com')) {
            try {
                r2IconUrl = await uploadRemoteMediaToR2(r2IconUrl, {
                    env: activeEnv,
                    keyPrefix: 'shop/categories/icons'
                });
            } catch (_) {}
        }

        try {
            const { data: existing } = await supabase
                .from('shop_categories')
                .select('*')
                .ilike('name', rawName)
                .maybeSingle();

            if (existing?.id) {
                const needsR2Sync = !existing.icon_url || (
                    r2IconUrl &&
                    (r2IconUrl.includes('media.zaoyoe.com') || r2IconUrl.includes('r2.fatherkey.com')) &&
                    !existing.icon_url.includes('media.zaoyoe.com') &&
                    !existing.icon_url.includes('r2.fatherkey.com')
                );
                if (needsR2Sync && r2IconUrl) {
                    try {
                        await supabase
                            .from('shop_categories')
                            .update({ icon_url: r2IconUrl })
                            .eq('id', existing.id);
                    } catch (_) {}
                }
                return;
            }

            const { count } = await supabase
                .from('shop_categories')
                .select('*', { count: 'exact', head: true });

            const insertPayload = {
                name: rawName,
                color: '#6b9ece',
                sort_order: (Number(count || 0) + 1) * 10,
                is_public: true,
                ...(r2IconUrl ? { icon_url: r2IconUrl } : {})
            };

            let upsertSuccess = false;
            try {
                const { error: insErr } = await supabase
                    .from('shop_categories')
                    .upsert(insertPayload, { onConflict: 'name' });
                if (!insErr) {
                    upsertSuccess = true;
                }
            } catch (_) {}

            if (!upsertSuccess && insertPayload.icon_url) {
                delete insertPayload.icon_url;
                try {
                    await supabase
                        .from('shop_categories')
                        .upsert(insertPayload, { onConflict: 'name' });
                } catch (_) {}
            }
        } catch (_) {}
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

    async function syncMappingCostCeilingBestEffort(supabase, {
        mappingId = null,
        productId = null,
        skuId = null,
        accountId = null,
        site = 'cn',
        goodsNo = '',
        costCeilingCny = null,
        adminId = null
    } = {}) {
        if (!costCeilingCny) return;
        const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        let resolvedMappingId = uuidRegex.test(String(mappingId || '')) ? String(mappingId) : '';
        if (!resolvedMappingId && typeof supabase?.from === 'function') {
            try {
                const mappingsTable = supabase.from('shop_supplier_product_mappings');
                if (mappingsTable && typeof mappingsTable.select === 'function') {
                    let query = mappingsTable.select('id');
                    if (productId && typeof query.eq === 'function') query = query.eq('product_id', productId);
                    if (skuId && typeof query.eq === 'function') query = query.eq('sku_id', skuId);
                    if (accountId && typeof query.eq === 'function') query = query.eq('supplier_account_id', accountId);
                    if (site && typeof query.eq === 'function') query = query.eq('site', site);
                    if (goodsNo && typeof query.eq === 'function') query = query.eq('supplier_goods_no', goodsNo);
                    if (typeof query.maybeSingle === 'function') {
                        const { data: row } = await query.maybeSingle();
                        if (row?.id && uuidRegex.test(String(row.id))) resolvedMappingId = String(row.id);
                    }
                }
            } catch (_) {
                // Best-effort lookup only
            }
        }
        if (resolvedMappingId && typeof supabase?.rpc === 'function') {
            try {
                await supabase.rpc('fn_set_shop_supplier_mapping_cost_ceiling_v2', {
                    p_mapping_id: resolvedMappingId,
                    p_cost_ceiling_cny: Number(costCeilingCny),
                    p_admin_id: adminId || null
                });
            } catch (_) {
                // Best-effort policy sync
            }
        }
    }

    function detectSupplierManualDelivery(catalogItem, source = null) {
        if (!catalogItem && !source) return false;

        const rawDeliveryWay = source?.delivery_way ?? catalogItem?.deliveryWay;
        if (Number(rawDeliveryWay) === 1) return true;

        const deliveryLabel = String(catalogItem?.deliveryLabel || source?.deliveryLabel || '');
        if (/类型\s*1\b/.test(deliveryLabel)) return true;

        if (catalogItem?.variantRequirements?.hasWidget) return true;

        const reasons = Array.isArray(catalogItem?.variantRequirements?.reasons)
            ? catalogItem.variantRequirements.reasons.join(' ')
            : '';
        if (reasons.includes('人工发货') || reasons.includes('自定义填写项')) return true;

        const textToScan = [
            catalogItem?.name,
            catalogItem?.description,
            source?.name,
            source?.description
        ].filter(Boolean).join(' ');

        const manualKeywords = [
            '客服上号',
            '联系客服',
            '人工上号',
            '人工发货',
            '联系管理',
            '人工代充',
            '人工充值',
            '手工发货',
            '代接码'
        ];

        return manualKeywords.some((keyword) => textToScan.includes(keyword));
    }

    function extractSupplierPurchaseNotes(catalogItem = {}, source = null) {
        const direct = catalogItem?.purchaseNotes
            || catalogItem?.purchase_notes
            || source?.purchase_notes
            || source?.buy_notice
            || source?.notice
            || source?.help;
        if (typeof direct === 'string' && direct.trim()) {
            return direct.trim();
        }

        const rawDesc = typeof catalogItem?.description === 'string'
            ? catalogItem.description
            : (typeof source?.description === 'string' ? source.description : '');

        if (!rawDesc) {
            return '';
        }

        let extractedSpecificNotes = '';
        const noticeBlockRegex = /<(?:p|div|li)[^>]*>(?:(?!<\/(?:p|div|li)>)[\s\S])*(?:注意事项|特别提醒|特别提示|温馨提示|特别注意|购前必读|购买须知|质保说明|售后说明|介意勿拍)[\s\S]*?<\/(?:p|div|li)>/gi;
        const matchedBlocks = rawDesc.match(noticeBlockRegex);
        if (matchedBlocks && matchedBlocks.length > 0) {
            extractedSpecificNotes = matchedBlocks.map((b) => b.trim()).filter(Boolean).join('\n');
        } else {
            const lines = rawDesc.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, '').split('\n');
            const matchedLines = lines
                .map((l) => l.trim())
                .filter((l) => /(?:注意事项|特别提醒|特别提示|温馨提示|特别注意|购前必读|购买须知|质保说明|售后说明|介意勿拍)/i.test(l));
            if (matchedLines.length > 0) {
                extractedSpecificNotes = matchedLines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n');
            }
        }

        const defaultStandardNotes = [
            '<p><strong>【购买须知】</strong></p>',
            '<p>购买前请确认商品规格、数量和完整说明，价格及库存以本页实时显示为准。</p>',
            '<ul>',
            '<li>付款后，可在订单查询或会员购买记录中查看交付内容。</li>',
            '<li>售后时长和适用条件以商品详情中的说明为准。</li>',
            '<li>需要售后时，请通过对应订单提交工单，以便核对购买信息。</li>',
            '</ul>'
        ].join('\n');

        if (extractedSpecificNotes) {
            return [
                '<p><strong>【特别注意事项】</strong></p>',
                extractedSpecificNotes,
                '<hr />',
                defaultStandardNotes
            ].join('\n');
        }

        return defaultStandardNotes;
    }

    function isMissingColumnError(err, colName) {
        if (!err) return false;
        const msg = String(err.message || '');
        return msg.includes(colName) || err.code === 'PGRST204' || err.code === '42703';
    }

    async function safeUpdateProduct(supabase, productId, patch) {
        if (!patch || Object.keys(patch).length === 0) return { data: null, error: null };
        let res = await supabase.from('shop_products').update(patch).eq('id', productId);
        let currentPatch = patch;
        for (const col of ['min_purchase_quantity', 'sales_config']) {
            if (isMissingColumnError(res.error, col) && Object.prototype.hasOwnProperty.call(currentPatch, col)) {
                const nextPatch = { ...currentPatch };
                delete nextPatch[col];
                currentPatch = nextPatch;
                if (Object.keys(currentPatch).length > 0) {
                    res = await supabase.from('shop_products').update(currentPatch).eq('id', productId);
                }
            }
        }
        return res;
    }

    async function safeUpdateSku(supabase, skuId, patch) {
        if (!patch || Object.keys(patch).length === 0) return { data: null, error: null };
        const res = await supabase.from('shop_product_skus').update(patch).eq('id', skuId);
        if (isMissingColumnError(res.error, 'min_purchase_quantity')) {
            const fallback = { ...patch };
            delete fallback.min_purchase_quantity;
            if (Object.keys(fallback).length > 0) {
                return supabase.from('shop_product_skus').update(fallback).eq('id', skuId);
            }
        }
        return res;
    }

    async function safeInsertProduct(supabase, payload) {
        let res = await supabase.from('shop_products').insert(payload).select('id, name').single();
        let currentPayload = payload;
        for (const col of ['min_purchase_quantity', 'sales_config']) {
            if (isMissingColumnError(res.error, col) && Object.prototype.hasOwnProperty.call(currentPayload, col)) {
                const nextPayload = { ...currentPayload };
                delete nextPayload[col];
                currentPayload = nextPayload;
                res = await supabase.from('shop_products').insert(currentPayload).select('id, name').single();
            }
        }
        return res;
    }

    async function importOne({
        supabase,
        adapter,
        account,
        adminId,
        providerId,
        site,
        goodsNo,
        variant = {},
        costCeilingCny = null,
        markupMultiplier: bodyMultiplier = null,
        productCategory = 'other',
        categoryIconUrl = null,
        guestPaymentChannels = null,
        initialStatus = 'draft',
        salesConfig = null
    }) {
        if (productCategory) {
            await ensureShopCategoryExists(supabase, productCategory, { iconUrl: categoryIconUrl, env });
        }
        const { data: existingMapping, error: lookupError } = await supabase
            .from('shop_supplier_product_mappings')
            .select('id, product_id, sku_id, site')
            .eq('supplier_account_id', account.id)
            .eq('site', site)
            .eq('supplier_goods_no', goodsNo)
            .maybeSingle();
        if (lookupError) throw lookupError;

        if (existingMapping) {
            if (costCeilingCny) {
                await syncMappingCostCeilingBestEffort(supabase, {
                    mappingId: existingMapping.id,
                    productId: existingMapping.product_id,
                    skuId: existingMapping.sku_id,
                    accountId: account.id,
                    site: existingMapping.site || site,
                    goodsNo,
                    costCeilingCny,
                    adminId
                });
            }
            return {
                goodsNo,
                status: 'already_imported',
                productId: existingMapping.product_id,
                skuId: existingMapping.sku_id || null,
                site: existingMapping.site,
                ...(costCeilingCny ? { costCeilingCny } : {})
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

        const rawMultiplier = Number(variant?.markupMultiplier ?? bodyMultiplier);
        const markupMultiplier = Number.isFinite(rawMultiplier) && rawMultiplier >= 1 ? rawMultiplier : 1;
        const costPrice = Number(variant?.costPrice ?? catalogItem.supplierUnitPrice ?? 0);
        const salePrice = variant?.price != null && Number(variant.price) > 0
            ? Number(variant.price)
            : (costPrice > 0 ? Math.round(costPrice * markupMultiplier * 100) / 100 : 0);

        const rawPurchaseNotes = extractSupplierPurchaseNotes(catalogItem, source);
        const media = await prepareSupplierMediaForR2({
            imageUrl: catalogItem.imageUrl,
            rawDescription: catalogItem.description,
            rawPurchaseNotes,
            env
        });

        const isIntl = site === 'intl';
        const priceField = isIntl ? 'price_points_intl' : 'price_points';
        const integerPrice = salePrice > 0 ? Math.ceil(salePrice) : 0;
        const isPublished = initialStatus === 'published';
        const isManualDelivery = detectSupplierManualDelivery(catalogItem, source);
        const stockCount = Number.isInteger(Number(catalogItem.availableQuantity)) && Number(catalogItem.availableQuantity) >= 0
            ? Number(catalogItem.availableQuantity)
            : 0;

        const { data: product, error: productError } = await safeInsertProduct(supabase, {
            name: catalogItem.name.slice(0, 100),
            description: null,
            category: productCategory || 'other',
            tags: [],
            price_points: (!isIntl && integerPrice > 0) ? integerPrice : 0,
            ...(isIntl && integerPrice > 0 ? { price_points_intl: integerPrice } : {}),
            stock_count: stockCount,
            is_active: isPublished,
            ...(isManualDelivery ? { manual_delivery: true } : {}),
            ...(isPublished ? { allow_guest_purchase: true } : {}),
            ...(Array.isArray(guestPaymentChannels) && guestPaymentChannels.length > 0 ? {
                guest_payment_channels: guestPaymentChannels,
                allow_guest_purchase: true
            } : {}),
            ...(salesConfig ? { sales_config: salesConfig } : {}),
            ...(media.imageUrl ? {
                icon_url: media.imageUrl,
                image_assets: media.imageAssets || { original: media.imageUrl }
            } : {}),
            ...(media.description ? {
                usage_instructions: media.description,
                usage_instructions_zh: media.description,
                show_usage_instructions: true,
                ...(isIntl ? {
                    usage_instructions_intl: media.description,
                    usage_instructions_intl_zh: media.description,
                    show_usage_instructions_intl: true
                } : {})
            } : (isManualDelivery ? { show_usage_instructions: true } : {})),
            ...(media.purchaseNotes ? {
                purchase_notes: media.purchaseNotes,
                purchase_notes_zh: media.purchaseNotes,
                show_purchase_notes: true,
                ...(isIntl ? {
                    purchase_notes_intl: media.purchaseNotes,
                    purchase_notes_intl_zh: media.purchaseNotes,
                    show_purchase_notes_intl: true
                } : {})
            } : {})
        });
        if (productError || !product?.id) throw productError || new Error('Draft product creation failed');

        try {
            const { data: sku, error: skuError } = await supabase
                .from('shop_product_skus')
                .select('id')
                .eq('product_id', product.id)
                .eq('is_default', true)
                .maybeSingle();
            if (skuError) throw skuError;

            if ((integerPrice > 0 || stockCount > 0 || isManualDelivery) && sku?.id) {
                try {
                    await supabase
                        .from('shop_product_skus')
                        .update({
                            ...(integerPrice > 0 ? { [priceField]: integerPrice } : {}),
                            ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                            ...(isManualDelivery ? { manual_delivery: true } : {})
                        })
                        .eq('id', sku.id);
                } catch (_) {}
            }

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
                    is_enabled: isPublished,
                    import_snapshot: {
                        name: catalogItem.name,
                        supplierUnitPrice: catalogItem.supplierUnitPrice ?? null,
                        currency: catalogItem.currency || 'CNY',
                        ...(catalogItem.salesCount != null ? { salesCount: catalogItem.salesCount } : {}),
                        ...(media.imageUrl ? { imageUrl: media.imageUrl } : {}),
                        ...(costCeilingCny ? { costCeilingCny } : {}),
                        ...(markupMultiplier > 1 ? { markupMultiplier } : {}),
                        ...(salePrice > 0 ? { price: salePrice } : {}),
                        procurementReady: false
                    }
                });
            if (mappingError) throw mappingError;

            if (costCeilingCny) {
                await syncMappingCostCeilingBestEffort(supabase, {
                    productId: product.id,
                    skuId: sku?.id || null,
                    accountId: account.id,
                    site,
                    goodsNo,
                    costCeilingCny,
                    adminId
                });
            }

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
                    is_active: isPublished,
                    mapping_enabled: isPublished,
                    ...(costCeilingCny ? { cost_ceiling_cny: costCeilingCny } : {})
                }
            });

            return {
                goodsNo,
                status: 'imported_as_draft',
                productId: product.id,
                skuId: sku?.id || null,
                site,
                ...(costCeilingCny ? { costCeilingCny } : {})
            };
        } catch (error) {
            // Supabase REST has no transaction spanning these tables. Remove the
            // just-created, inactive product if its provider mapping could not be
            // persisted, avoiding an untraceable draft in the shop editor.
            await supabase.from('shop_products').delete().eq('id', product.id);
            throw error;
        }
    }

    async function importVariantDraft({
        supabase,
        adapter,
        account,
        adminId,
        site,
        goodsNo,
        variant = {},
        costCeilingCny = null,
        costCeilingMultiplier = null,
        markupMultiplier: bodyMultiplier = null,
        productCategory = null,
        categoryIconUrl = null,
        guestPaymentChannels = null,
        initialStatus = 'draft',
        duplicatePolicy = 'skip',
        salesConfig = null
    }) {
        if (site !== 'cn') {
            const error = new Error('虾仁只读草稿目前仅支持国内站。');
            error.code = 'supplier_site_unsupported';
            throw error;
        }
        if (productCategory) {
            await ensureShopCategoryExists(supabase, productCategory, { iconUrl: categoryIconUrl, env });
        }
        const rawSource = await adapter.getGoodsDetail(goodsNo);
        const item = normalizeCatalogItem(adapter, rawSource);
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
        const isManualDelivery = detectSupplierManualDelivery(item, rawSource);
        let selected;
        try { selected = adapter.normalizeVariant(item, variant); } catch (_) {
            const error = new Error('商品规格未核验，请打开详情选择种类；复杂 SKU、自定义填写项及预选卡暂仅预览。');
            error.code = 'supplier_variant_review_required';
            throw error;
        }

        const hasMultiplier = Number.isFinite(Number(variant?.markupMultiplier ?? bodyMultiplier)) && Number(variant?.markupMultiplier ?? bodyMultiplier) >= 1;
        const markupMultiplier = hasMultiplier ? Number(variant?.markupMultiplier ?? bodyMultiplier) : null;
        const costPrice = Number(variant?.costPrice ?? (selected.race && item.variantRequirements?.racePrices?.[selected.race]) ?? item.supplierUnitPrice ?? 0);
        const salePrice = variant?.price != null && Number(variant.price) > 0
            ? Number(variant.price)
            : (hasMultiplier && costPrice > 0 ? Math.round(costPrice * markupMultiplier * 100) / 100 : 0);

        if (!costCeilingCny && costCeilingMultiplier && costPrice > 0) {
            costCeilingCny = Math.round(costPrice * costCeilingMultiplier * 100) / 100;
        }

        const rawPurchaseNotes = extractSupplierPurchaseNotes(item, rawSource);
        const media = await prepareSupplierMediaForR2({
            imageUrl: item.imageUrl,
            rawDescription: item.description,
            rawPurchaseNotes,
            env
        });

        const snapshot = {
            name: item.name, supplierUnitPrice: item.supplierUnitPrice, currency: item.currency,
            currencyStatus: item.currencyStatus, availableQuantity: item.availableQuantity,
            minimumQuantity: item.minimumQuantity, deliveryLabel: item.deliveryLabel,
            checkedAt: new Date().toISOString(), procurementReady: false,
            ...(media.imageUrl ? { imageUrl: media.imageUrl } : {}),
            ...(media.description ? { description: media.description } : {}),
            ...(media.purchaseNotes ? { purchaseNotes: media.purchaseNotes } : {}),
            ...(costCeilingCny ? { costCeilingCny } : {}),
            ...(hasMultiplier ? { markupMultiplier } : {}),
            ...(salePrice > 0 ? { price: salePrice } : {})
        };
        const { data, error } = await supabase.rpc('import_shop_supplier_draft_v2', {
            p_account_id: account.id, p_site: site, p_goods_no: goodsNo, p_variant: selected,
            p_name: `${item.name}${selected.race ? ` · ${selected.race}` : ''}`.slice(0, 100),
            p_snapshot: snapshot, p_admin_id: adminId
        });
        if (error) throw error;
        if (!['imported_as_draft', 'already_imported'].includes(data?.status)) throw new Error('Invalid draft import result');

        if (data?.status === 'already_imported' && duplicatePolicy === 'skip') {
            return { goodsNo, status: 'skipped', message: '商品已存在，已跳过' };
        }

        if (data?.productId) {
            const stockCount = Number.isInteger(Number(item.availableQuantity)) && Number(item.availableQuantity) >= 0
                ? Number(item.availableQuantity)
                : 0;
            const isIntl = site === 'intl';
            const priceField = isIntl ? 'price_points_intl' : 'price_points';
            const integerPrice = salePrice > 0 ? Math.ceil(salePrice) : 0;
            const itemMinQty = Number.isInteger(Number(item.minimumQuantity)) && Number(item.minimumQuantity) > 1
                ? Number(item.minimumQuantity)
                : 1;
            const itemMaxQty = Number.isInteger(Number(item.maximumQuantity)) && Number(item.maximumQuantity) > 0
                ? Number(item.maximumQuantity)
                : null;
            const hasExplicitUpdate = Boolean(
                productCategory
                || (Array.isArray(guestPaymentChannels) && guestPaymentChannels.length > 0)
                || initialStatus === 'published'
                || salesConfig != null
                || media.imageUrl
                || media.description
                || media.purchaseNotes
                || integerPrice > 0
                || isManualDelivery
                || itemMinQty > 1
                || itemMaxQty !== null
            );

            if (hasExplicitUpdate) {
                const productPatch = {
                    ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                    ...(productCategory ? { category: productCategory } : {}),
                    ...(isManualDelivery ? { manual_delivery: true } : {}),
                    ...(itemMinQty > 1 ? { min_purchase_quantity: itemMinQty } : {}),
                    ...(itemMaxQty !== null ? { guest_max_quantity: itemMaxQty, max_purchase_quantity: itemMaxQty } : {}),
                    ...(Array.isArray(guestPaymentChannels) && guestPaymentChannels.length > 0 ? {
                        guest_payment_channels: guestPaymentChannels,
                        allow_guest_purchase: true
                    } : {}),
                    ...(initialStatus === 'published' ? { is_active: true } : {}),
                    ...(salesConfig ? { sales_config: salesConfig } : {}) ,
                    ...(media.imageUrl ? {
                        icon_url: media.imageUrl,
                        image_assets: media.imageAssets || { original: media.imageUrl }
                    } : {}),
                    ...(media.description ? {
                        usage_instructions: media.description,
                        usage_instructions_zh: media.description,
                        show_usage_instructions: true,
                        ...(isIntl ? {
                            usage_instructions_intl: media.description,
                            usage_instructions_intl_zh: media.description,
                            show_usage_instructions_intl: true
                        } : {})
                    } : (isManualDelivery ? { show_usage_instructions: true } : {})),
                    ...(media.purchaseNotes ? {
                        purchase_notes: media.purchaseNotes,
                        purchase_notes_zh: media.purchaseNotes,
                        show_purchase_notes: true,
                        ...(isIntl ? {
                            purchase_notes_intl: media.purchaseNotes,
                            purchase_notes_intl_zh: media.purchaseNotes,
                            show_purchase_notes_intl: true
                        } : {})
                    } : {}),
                    ...(integerPrice > 0 ? {
                        [priceField]: integerPrice
                    } : {})
                };
                if (Object.keys(productPatch).length > 0) {
                    try {
                        await safeUpdateProduct(supabase, data.productId, productPatch);
                    } catch (_) {}
                }
                if (integerPrice > 0 || stockCount > 0 || isManualDelivery || itemMinQty > 1) {
                    try {
                        const skuPatch = {
                            ...(integerPrice > 0 ? { [priceField]: integerPrice } : {}),
                            ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                            ...(isManualDelivery ? { manual_delivery: true } : {}),
                            ...(itemMinQty > 1 ? { min_purchase_quantity: itemMinQty } : {})
                        };
                        if (data.skuId) {
                            await safeUpdateSku(supabase, data.skuId, skuPatch);
                        } else {
                            const { error: skuErr } = await supabase.from('shop_product_skus').update(skuPatch).eq('product_id', data.productId);
                            if (isMissingColumnError(skuErr, 'min_purchase_quantity')) {
                                delete skuPatch.min_purchase_quantity;
                                await supabase.from('shop_product_skus').update(skuPatch).eq('product_id', data.productId);
                            }
                        }
                    } catch (_) {}
                }
            }
            if (initialStatus === 'published' && data.mappingId) {
                try {
                    await supabase
                        .from('shop_supplier_product_mappings')
                        .update({ is_enabled: true })
                        .eq('id', data.mappingId);
                } catch (_) {}
            }
        }
        if (costCeilingCny) {
            await syncMappingCostCeilingBestEffort(supabase, {
                mappingId: data?.mappingId || null,
                productId: data?.productId || null,
                skuId: data?.skuId || null,
                accountId: account.id,
                site,
                goodsNo,
                costCeilingCny,
                adminId
            });
        }
        return { ...data, goodsNo, ...(costCeilingCny ? { costCeilingCny } : {}) };
    }

    async function importMultiVariantDraft({
        supabase,
        adapter,
        account,
        adminId,
        site,
        goodsNo,
        variants = [],
        costCeilingCny = null,
        costCeilingMultiplier = null,
        markupMultiplier: bodyMultiplier = null,
        productCategory = 'other',
        categoryIconUrl = null,
        guestPaymentChannels = null,
        initialStatus = 'draft',
        duplicatePolicy = 'skip',
        salesConfig = null
    }) {
        if (site !== 'cn') {
            const error = new Error('虾仁只读草稿目前仅支持国内站。');
            error.code = 'supplier_site_unsupported';
            throw error;
        }
        if (productCategory) {
            await ensureShopCategoryExists(supabase, productCategory, { iconUrl: categoryIconUrl, env });
        }

        const rawSource = await adapter.getGoodsDetail(goodsNo);
        const item = normalizeCatalogItem(adapter, rawSource);
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
        const isManualDelivery = detectSupplierManualDelivery(item, rawSource);

        const hasBodyMultiplier = Number.isFinite(Number(bodyMultiplier)) && Number(bodyMultiplier) >= 1;
        const defaultMultiplier = hasBodyMultiplier ? Number(bodyMultiplier) : null;

        let candidateVariants = Array.isArray(variants) ? variants : [];
        if (!candidateVariants.length && Array.isArray(item.variantRequirements?.races) && item.variantRequirements.races.length > 0) {
            candidateVariants = item.variantRequirements.races.map((r) => ({ race: r }));
        }

        if (!candidateVariants.length && (!item.variantRequirements?.requiresRace || !item.variantRequirements?.races?.length)) {
            const importer = typeof adapter.normalizeVariant === 'function' ? importVariantDraft : importOne;
            return importer({
                supabase,
                adapter,
                account,
                adminId,
                providerId: account.provider_id || 'xiareng',
                site,
                goodsNo,
                variant: {},
                costCeilingCny,
                costCeilingMultiplier,
                markupMultiplier: bodyMultiplier,
                productCategory,
                guestPaymentChannels,
                initialStatus,
                duplicatePolicy,
                salesConfig
            });
        }

        const validatedVariants = [];
        const rpcVariants = [];
        for (const v of candidateVariants) {
            let raceName = typeof v === 'string' ? v.trim() : (v?.race ? String(v.race).trim() : '');
            if (!raceName) continue;
            try {
                adapter.normalizeVariant(item, { race: raceName });
            } catch (_) {
                const error = new Error(`商品规格“${raceName}”未核验，请打开详情核对规格。`);
                error.code = 'supplier_variant_review_required';
                throw error;
            }
            const vCost = Number(v?.costPrice ?? item.variantRequirements?.racePrices?.[raceName] ?? item.supplierUnitPrice ?? 0);
            const ceiling = v?.costCeilingCny != null
                ? normalizeCostCeilingCny(v.costCeilingCny)
                : (costCeilingCny || (costCeilingMultiplier && vCost > 0 ? Math.round(vCost * costCeilingMultiplier * 100) / 100 : null));
            const hasVMultiplier = v?.markupMultiplier != null && Number.isFinite(Number(v.markupMultiplier)) && Number(v.markupMultiplier) >= 1;
            const vMultiplier = hasVMultiplier ? Number(v.markupMultiplier) : defaultMultiplier;
            const vPrice = v?.price != null && Number(v.price) > 0
                ? Number(v.price)
                : (vMultiplier && vCost > 0 ? Math.round(vCost * vMultiplier * 100) / 100 : 0);

            rpcVariants.push({
                race: raceName,
                ...(ceiling ? { costCeilingCny: ceiling } : {})
            });

            validatedVariants.push({
                race: raceName,
                price: vPrice,
                costPrice: vCost,
                markupMultiplier: vMultiplier,
                costCeilingCny: ceiling
            });
        }

        if (!validatedVariants.length) {
            const error = new Error('请至少选择一个有效的商品规格。');
            error.code = 'supplier_variant_review_required';
            throw error;
        }

        const validPrices = validatedVariants.map((v) => v.price).filter((p) => p > 0);
        const minSalePrice = validPrices.length ? Math.min(...validPrices) : 0;
        const stockCount = Number.isInteger(Number(item.availableQuantity)) && Number(item.availableQuantity) >= 0
            ? Number(item.availableQuantity)
            : 0;

        const rawPurchaseNotes = extractSupplierPurchaseNotes(item, rawSource);
        const media = await prepareSupplierMediaForR2({
            imageUrl: item.imageUrl,
            rawDescription: item.description,
            rawPurchaseNotes,
            env
        });

        const isIntl = site === 'intl';
        const priceField = isIntl ? 'price_points_intl' : 'price_points';
        const integerMinPrice = minSalePrice > 0 ? Math.ceil(minSalePrice) : 0;
        const isPublished = initialStatus === 'published';

        const snapshot = {
            name: item.name,
            supplierUnitPrice: item.supplierUnitPrice,
            currency: item.currency,
            currencyStatus: item.currencyStatus,
            availableQuantity: item.availableQuantity,
            salesCount: item.salesCount ?? null,
            minimumQuantity: item.minimumQuantity,
            deliveryLabel: item.deliveryLabel,
            checkedAt: new Date().toISOString(),
            procurementReady: false,
            ...(media.imageUrl ? { imageUrl: media.imageUrl } : {}),
            ...(media.description ? { description: media.description } : {}),
            ...(media.purchaseNotes ? { purchaseNotes: media.purchaseNotes } : {}),
            ...(costCeilingCny ? { costCeilingCny } : {}),
            ...(defaultMultiplier ? { markupMultiplier: defaultMultiplier } : {}),
            ...(minSalePrice > 0 ? { price: minSalePrice } : {})
        };

        // Attempt RPC first
        let rpcData = null;
        let rpcError = null;
        try {
            const res = await supabase.rpc('import_shop_supplier_multi_draft_v3', {
                p_account_id: account.id,
                p_site: site,
                p_goods_no: goodsNo,
                p_variants: rpcVariants,
                p_name: item.name.slice(0, 100),
                p_snapshot: snapshot,
                p_admin_id: adminId,
                p_product_category: productCategory || 'other'
            });
            rpcData = res.data;
            rpcError = res.error;
        } catch (err) {
            rpcError = err;
        }

        if (!rpcError && rpcData?.productId) {
            if (rpcData.status === 'already_imported' && duplicatePolicy === 'skip') {
                return { goodsNo, status: 'skipped', message: '商品已存在，已跳过' };
            }

            const itemMinQty = Number.isInteger(Number(item.minimumQuantity)) && Number(item.minimumQuantity) > 1
                ? Number(item.minimumQuantity)
                : 1;
            const itemMaxQty = Number.isInteger(Number(item.maximumQuantity)) && Number(item.maximumQuantity) > 0
                ? Number(item.maximumQuantity)
                : null;

            const productPatch = {
                ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                ...(productCategory ? { category: productCategory } : {}),
                ...(isManualDelivery ? { manual_delivery: true } : {}),
                ...(itemMinQty > 1 ? { min_purchase_quantity: itemMinQty } : {}),
                ...(itemMaxQty !== null ? { guest_max_quantity: itemMaxQty, max_purchase_quantity: itemMaxQty } : {}),
                ...(salesConfig ? { sales_config: salesConfig } : {}),
                ...(Array.isArray(guestPaymentChannels) && guestPaymentChannels.length > 0 ? {
                    guest_payment_channels: guestPaymentChannels,
                    allow_guest_purchase: true
                } : {}),
                ...(initialStatus === 'published' ? { is_active: true } : {}),
                ...(media.imageUrl ? {
                    icon_url: media.imageUrl,
                    image_assets: media.imageAssets || { original: media.imageUrl }
                } : {}),
                ...(media.description ? {
                    usage_instructions: media.description,
                    usage_instructions_zh: media.description,
                    show_usage_instructions: true,
                    ...(isIntl ? {
                        usage_instructions_intl: media.description,
                        usage_instructions_intl_zh: media.description,
                        show_usage_instructions_intl: true
                    } : {})
                } : (isManualDelivery ? { show_usage_instructions: true } : {})),
                ...(media.purchaseNotes ? {
                    purchase_notes: media.purchaseNotes,
                    purchase_notes_zh: media.purchaseNotes,
                    show_purchase_notes: true,
                    ...(isIntl ? {
                        purchase_notes_intl: media.purchaseNotes,
                        purchase_notes_intl_zh: media.purchaseNotes,
                        show_purchase_notes_intl: true
                    } : {})
                } : {}),
                ...(integerMinPrice > 0 ? { [priceField]: integerMinPrice } : {})
            };
            if (Object.keys(productPatch).length > 0) {
                try {
                    await safeUpdateProduct(supabase, rpcData.productId, productPatch);
                } catch (_) {}
            }

            if (initialStatus === 'published') {
                try {
                    await supabase
                        .from('shop_supplier_product_mappings')
                        .update({ is_enabled: true })
                        .eq('product_id', rpcData.productId);
                } catch (_) {}
            }

            try {
                const { data: createdSkus } = await supabase
                    .from('shop_product_skus')
                    .select('id, sku_name')
                    .eq('product_id', rpcData.productId);

                if (Array.isArray(createdSkus)) {
                    for (const createdSku of createdSkus) {
                        const matchedVar = validatedVariants.find((v) => v.race === createdSku.sku_name);
                        const skuPatch = {
                            ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                            ...(matchedVar && matchedVar.price > 0 ? { [priceField]: Math.ceil(matchedVar.price) } : {}),
                            ...(isManualDelivery ? { manual_delivery: true } : {}),
                            ...(itemMinQty > 1 ? { min_purchase_quantity: itemMinQty } : {})
                        };
                        if (Object.keys(skuPatch).length > 0) {
                            await safeUpdateSku(supabase, createdSku.id, skuPatch);
                        }
                    }
                }

                const { data: createdMappings } = await supabase
                    .from('shop_supplier_product_mappings')
                    .select('id, sku_id, import_snapshot')
                    .eq('product_id', rpcData.productId);

                if (Array.isArray(createdMappings) && Array.isArray(createdSkus)) {
                    for (const m of createdMappings) {
                        const skuObj = createdSkus.find((s) => s.id === m.sku_id);
                        const matchedVar = skuObj ? validatedVariants.find((v) => v.race === skuObj.sku_name) : null;
                        if (matchedVar && (matchedVar.markupMultiplier || matchedVar.price)) {
                            const curSnapshot = (m.import_snapshot && typeof m.import_snapshot === 'object') ? m.import_snapshot : {};
                            await supabase
                                .from('shop_supplier_product_mappings')
                                .update({
                                    import_snapshot: {
                                        ...curSnapshot,
                                        ...(matchedVar.markupMultiplier ? { markupMultiplier: matchedVar.markupMultiplier } : {}),
                                        ...(matchedVar.price ? { price: matchedVar.price } : {})
                                    }
                                })
                                .eq('id', m.id);
                        }
                    }
                }
            } catch (_) {}

            return {
                ...rpcData,
                goodsNo,
                status: 'imported_as_draft',
                skuCount: validatedVariants.length
            };
        }

        // Fallback via standard tables if v3 RPC not present
        if (rpcError && (isMissingSupplierSchemaError(rpcError) || String(rpcError.message || '').includes('import_shop_supplier_multi_draft_v3') || rpcError.code === '42883' || rpcError.code === 'PGRST202')) {
            const isPublished = initialStatus === 'published';

            const fallbackMinQty = Number.isInteger(Number(item.minimumQuantity)) && Number(item.minimumQuantity) > 1
                ? Number(item.minimumQuantity)
                : 1;
            const fallbackMaxQty = Number.isInteger(Number(item.maximumQuantity)) && Number(item.maximumQuantity) > 0
                ? Number(item.maximumQuantity)
                : null;

            // Check if already imported
            const { data: existingMappings } = await supabase
                .from('shop_supplier_product_mappings')
                .select('id, product_id, sku_id, site, is_enabled')
                .eq('supplier_account_id', account.id)
                .eq('site', site)
                .eq('supplier_goods_no', goodsNo);

            const hasExistingMapping = Array.isArray(existingMappings) && existingMappings.length > 0;
            if (hasExistingMapping && duplicatePolicy === 'skip') {
                return {
                    goodsNo,
                    status: 'skipped',
                    message: '商品已存在，已跳过',
                    productId: existingMappings[0].product_id
                };
            }

            if (hasExistingMapping && duplicatePolicy === 'overwrite') {
                const existingProductId = existingMappings[0].product_id;
                const updatePayload = {
                    name: item.name.slice(0, 100),
                    category: productCategory || 'other',
                    ...(isManualDelivery ? { manual_delivery: true } : {}),
                    ...(fallbackMinQty > 1 ? { min_purchase_quantity: fallbackMinQty } : {}),
                    ...(fallbackMaxQty !== null ? { guest_max_quantity: fallbackMaxQty, max_purchase_quantity: fallbackMaxQty } : {}),
                    ...(salesConfig ? { sales_config: salesConfig } : {}),
                    ...(integerMinPrice > 0 ? { [priceField]: integerMinPrice } : {}),
                    ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                    ...(isPublished ? { is_active: true } : {}),
                    ...(Array.isArray(guestPaymentChannels) && guestPaymentChannels.length > 0 ? {
                        guest_payment_channels: guestPaymentChannels,
                        allow_guest_purchase: true
                    } : {}),
                    ...(media.imageUrl ? {
                        icon_url: media.imageUrl,
                        image_assets: media.imageAssets || { original: media.imageUrl }
                    } : {}),
                    ...(media.description ? {
                        usage_instructions: media.description,
                        usage_instructions_zh: media.description,
                        show_usage_instructions: true,
                        ...(isIntl ? {
                            usage_instructions_intl: media.description,
                            usage_instructions_intl_zh: media.description,
                            show_usage_instructions_intl: true
                        } : {})
                    } : (isManualDelivery ? { show_usage_instructions: true } : {})),
                    ...(media.purchaseNotes ? {
                        purchase_notes: media.purchaseNotes,
                        purchase_notes_zh: media.purchaseNotes,
                        show_purchase_notes: true,
                        ...(isIntl ? {
                            purchase_notes_intl: media.purchaseNotes,
                            purchase_notes_intl_zh: media.purchaseNotes,
                            show_purchase_notes_intl: true
                        } : {})
                    } : {})
                };

                try {
                    await safeUpdateProduct(supabase, existingProductId, updatePayload);
                } catch (_) {}

                try {
                    const { data: currentSkus } = await supabase
                        .from('shop_product_skus')
                        .select('id, sku_name')
                        .eq('product_id', existingProductId);

                    if (Array.isArray(currentSkus)) {
                        for (const sku of currentSkus) {
                            const matchedVar = validatedVariants.find((v) => v.race === sku.sku_name);
                            const skuPatch = {
                                ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                                ...(matchedVar && matchedVar.price > 0 ? { [priceField]: Math.ceil(matchedVar.price) } : {}),
                                ...(isManualDelivery ? { manual_delivery: true } : {}),
                                ...(fallbackMinQty > 1 ? { min_purchase_quantity: fallbackMinQty } : {})
                            };
                            if (Object.keys(skuPatch).length > 0) {
                                await safeUpdateSku(supabase, sku.id, skuPatch);
                            }
                        }
                    }
                } catch (_) {}

                if (isPublished) {
                    try {
                        await supabase
                            .from('shop_supplier_product_mappings')
                            .update({ is_enabled: true })
                            .eq('product_id', existingProductId);
                    } catch (_) {}
                }

                return {
                    goodsNo,
                    status: 'imported_as_draft',
                    productId: existingProductId,
                    skuCount: validatedVariants.length,
                    site,
                    isOverwrite: true
                };
            }

            const { data: product, error: prodErr } = await safeInsertProduct(supabase, {
                name: item.name.slice(0, 100),
                description: null,
                category: productCategory || 'other',
                tags: [],
                manual_delivery: isManualDelivery,
                ...(fallbackMinQty > 1 ? { min_purchase_quantity: fallbackMinQty } : {}),
                ...(fallbackMaxQty !== null ? { guest_max_quantity: fallbackMaxQty, max_purchase_quantity: fallbackMaxQty } : {}),
                ...(salesConfig ? { sales_config: salesConfig } : {}),
                price_points: (!isIntl && integerMinPrice > 0) ? integerMinPrice : 0,
                ...(isIntl && integerMinPrice > 0 ? { price_points_intl: integerMinPrice } : {}),
                stock_count: stockCount,
                is_active: isPublished,
                allow_guest_purchase: isPublished || (Array.isArray(guestPaymentChannels) && guestPaymentChannels.length > 0),
                ...(Array.isArray(guestPaymentChannels) && guestPaymentChannels.length > 0 ? {
                    guest_payment_channels: guestPaymentChannels
                } : {}),
                ...(media.imageUrl ? {
                    icon_url: media.imageUrl,
                    image_assets: media.imageAssets || { original: media.imageUrl }
                } : {}),
                ...(media.description ? {
                    usage_instructions: media.description,
                    usage_instructions_zh: media.description,
                    show_usage_instructions: true,
                    ...(isIntl ? {
                        usage_instructions_intl: media.description,
                        usage_instructions_intl_zh: media.description,
                        show_usage_instructions_intl: true
                    } : {})
                } : (isManualDelivery ? { show_usage_instructions: true } : {})),
                ...(media.purchaseNotes ? {
                    purchase_notes: media.purchaseNotes,
                    purchase_notes_zh: media.purchaseNotes,
                    show_purchase_notes: true,
                    ...(isIntl ? {
                        purchase_notes_intl: media.purchaseNotes,
                        purchase_notes_intl_zh: media.purchaseNotes,
                        show_purchase_notes_intl: true
                    } : {})
                } : {})
            });
            if (prodErr || !product?.id) throw prodErr || new Error('Draft product creation failed');

            try {
                const { data: defaultSku, error: defSkuErr } = await supabase
                    .from('shop_product_skus')
                    .select('id')
                    .eq('product_id', product.id)
                    .eq('is_default', true)
                    .maybeSingle();
                if (defSkuErr || !defaultSku?.id) throw defSkuErr || new Error('Default SKU not found');

                const skuIds = [];
                for (let i = 0; i < validatedVariants.length; i++) {
                    const variant = validatedVariants[i];
                    let currentSkuId;
                    if (i === 0) {
                        await safeUpdateSku(supabase, defaultSku.id, {
                            sku_name: variant.race,
                            spec_values: { 规格: variant.race },
                            sort_order: 0,
                            manual_delivery: isManualDelivery,
                            ...(fallbackMinQty > 1 ? { min_purchase_quantity: fallbackMinQty } : {}),
                            ...(stockCount > 0 ? { stock_count: stockCount } : {}),
                            ...(variant.price > 0 ? { [priceField]: Math.ceil(variant.price) } : {})
                        });
                        currentSkuId = defaultSku.id;
                    } else {
                        const newSkuPayload = {
                            product_id: product.id,
                            sku_name: variant.race,
                            spec_values: { 规格: variant.race },
                            is_default: false,
                            is_active: true,
                            manual_delivery: isManualDelivery,
                            ...(fallbackMinQty > 1 ? { min_purchase_quantity: fallbackMinQty } : {}),
                            stock_count: stockCount,
                            sort_order: i * 10,
                            price_points: (!isIntl && variant.price > 0) ? Math.ceil(variant.price) : 0,
                            ...(isIntl && variant.price > 0 ? { price_points_intl: Math.ceil(variant.price) } : {})
                        };
                        let { data: newSku, error: newSkuErr } = await supabase
                            .from('shop_product_skus')
                            .insert(newSkuPayload)
                            .select('id')
                            .single();
                        if (isMissingColumnError(newSkuErr, 'min_purchase_quantity')) {
                            delete newSkuPayload.min_purchase_quantity;
                            const retry = await supabase
                                .from('shop_product_skus')
                                .insert(newSkuPayload)
                                .select('id')
                                .single();
                            newSku = retry.data;
                            newSkuErr = retry.error;
                        }
                        if (newSkuErr || !newSku?.id) throw newSkuErr || new Error('New SKU creation failed');
                        currentSkuId = newSku.id;
                    }
                    skuIds.push(currentSkuId);

                    const variantKey = 'v1:' + crypto.createHash('md5').update(JSON.stringify({ race: variant.race })).digest('hex');
                    const perVariantSnapshot = {
                        ...snapshot,
                        ...(variant.costCeilingCny ? { costCeilingCny: variant.costCeilingCny } : {}),
                        ...(variant.markupMultiplier ? { markupMultiplier: variant.markupMultiplier } : {}),
                        ...(variant.price > 0 ? { price: variant.price } : {})
                    };
                    await supabase
                        .from('shop_supplier_product_mappings')
                        .insert({
                            site,
                            supplier_account_id: account.id,
                            product_id: product.id,
                            sku_id: currentSkuId,
                            supplier_goods_no: goodsNo,
                            supplier_variant_key: variantKey,
                            supplier_variant: { race: variant.race },
                            import_snapshot: perVariantSnapshot,
                            contract_version: 2,
                            priority: 100,
                            is_primary: true,
                            is_enabled: isPublished
                        });
                }

                await writeAuditImpl({
                    supabase,
                    adminId,
                    module: 'shop',
                    site,
                    actionType: 'shop.supplier_catalog.import_multi_variant',
                    details: {
                        provider_id: 'xiareng',
                        supplier_account_id: account.id,
                        supplier_goods_no: goodsNo,
                        product_id: product.id,
                        sku_ids: skuIds,
                        sku_count: validatedVariants.length,
                        is_active: isPublished,
                        mapping_enabled: isPublished
                    }
                });

                return {
                    goodsNo,
                    status: 'imported_as_draft',
                    productId: product.id,
                    skuCount: validatedVariants.length,
                    site
                };
            } catch (subErr) {
                await supabase.from('shop_products').delete().eq('id', product.id);
                throw subErr;
            }
        }

        if (rpcError) throw rpcError;
        return rpcData;
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
            if (action === 'dispatch-config') {
                if (method === 'GET') {
                    const policy = await getSupplierDispatchPolicy(supabase);
                    return sendJsonImpl(res, 200, { success: true, policy });
                }
                if (method === 'POST') {
                    try {
                        const saved = await saveSupplierDispatchPolicy(supabase, {
                            mode: body?.mode,
                            thresholdCny: body?.thresholdCny,
                            enabled: body?.enabled
                        });
                        try {
                            await writeAuditImpl({
                                supabase,
                                adminId: user?.id,
                                action: 'shop.supplier.dispatch_config_update',
                                targetType: 'system_config',
                                targetId: 'supplier_auto_dispatch_policy',
                                details: saved
                            });
                        } catch (_) {}
                        return sendJsonImpl(res, 200, { success: true, message: '分流配置已保存', policy: saved });
                    } catch (err) {
                        return sendJsonImpl(res, 400, { success: false, message: err?.message || '保存分流配置失败' });
                    }
                }
                return sendJsonImpl(res, 405, { success: false, message: '方法不支持。' });
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
            if (method === 'POST' && action === 'update-mapping-ceiling') {
                const mappingId = normalizeText(body.mappingId, 64);
                if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(mappingId)) {
                    return sendJsonImpl(res, 400, { success: false, message: '商品映射标识无效。' });
                }
                const costCeilingCny = normalizeCostCeilingCny(body.costCeilingCny);
                if (!costCeilingCny) {
                    return sendJsonImpl(res, 400, {
                        success: false,
                        code: 'supplier_invalid_cost_ceiling',
                        message: '请输入有效的单件自动采购单价上限（CNY）。'
                    });
                }

                let updatedRow = null;
                if (typeof supabase?.rpc === 'function') {
                    const { data: rpcData, error: rpcError } = await supabase.rpc('fn_set_shop_supplier_mapping_cost_ceiling_v2', {
                        p_mapping_id: mappingId,
                        p_cost_ceiling_cny: Number(costCeilingCny),
                        p_admin_id: user?.id || null
                    });
                    if (!rpcError && rpcData) {
                        updatedRow = rpcData;
                    } else if (rpcError && String(rpcError.message || '').includes('supplier_mapping_not_found')) {
                        return sendJsonImpl(res, 404, { success: false, message: '未找到对应的供应商商品映射。' });
                    }
                }

                if (!updatedRow && typeof supabase?.from === 'function') {
                    const { data: existing, error: findErr } = await supabase
                        .from('shop_supplier_product_mappings')
                        .select('id, site, product_id, sku_id, supplier_account_id, supplier_goods_no, import_snapshot')
                        .eq('id', mappingId)
                        .maybeSingle();
                    if (findErr) throw findErr;
                    if (!existing?.id) {
                        return sendJsonImpl(res, 404, { success: false, message: '未找到对应的供应商商品映射。' });
                    }
                    const nextSnapshot = {
                        ...(existing.import_snapshot && typeof existing.import_snapshot === 'object' ? existing.import_snapshot : {}),
                        costCeilingCny,
                        costCeilingUpdatedAt: new Date(now()).toISOString()
                    };
                    const { error: updErr } = await supabase
                        .from('shop_supplier_product_mappings')
                        .update({ import_snapshot: nextSnapshot, updated_at: new Date(now()).toISOString() })
                        .eq('id', mappingId);
                    if (updErr) throw updErr;
                    updatedRow = {
                        mapping_id: existing.id,
                        product_id: existing.product_id,
                        sku_id: existing.sku_id,
                        supplier_account_id: existing.supplier_account_id,
                        cost_ceiling_cny: costCeilingCny
                    };
                }

                await writeAuditImpl({
                    supabase,
                    adminId: user?.id || null,
                    module: 'shop',
                    site: normalizeText(body.site || 'cn', 16).toLowerCase() || 'cn',
                    actionType: 'shop.supplier_catalog.update_cost_ceiling',
                    details: {
                        provider_id: providerId,
                        mapping_id: mappingId,
                        cost_ceiling_cny: costCeilingCny
                    }
                });

                return sendJsonImpl(res, 200, {
                    success: true,
                    mappingId,
                    costCeilingCny,
                    result: updatedRow
                });
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
                    .select('id, site, sku_id, supplier_account_id, supplier_goods_no, supplier_variant_key, supplier_variant, import_snapshot, is_enabled, contract_version, shop_supplier_accounts(provider_id, display_name)')
                    .eq('product_id', productId);
                if (error && ['42703', 'PGRST204'].includes(error.code)) {
                    ({ data, error } = await supabase.from('shop_supplier_product_mappings')
                        .select('id, site, sku_id, supplier_account_id, supplier_goods_no, is_enabled, shop_supplier_accounts(provider_id, display_name)')
                        .eq('product_id', productId));
                }
                if (error) throw error;
                return sendJsonImpl(res, 200, { success: true, mappings: (data || []).map((mapping) => {
                    const snap = mapping.import_snapshot && typeof mapping.import_snapshot === 'object' ? mapping.import_snapshot : {};
                    let imageUrl = typeof snap.imageUrl === 'string' && snap.imageUrl.trim()
                        ? normalizeText(snap.imageUrl, 1000)
                        : '';
                    if (!imageUrl && mapping.supplier_goods_no) {
                        for (const cachedSnap of xiarengCatalogSnapshots.values()) {
                            const found = cachedSnap.items?.find((i) => i.providerGoodsId === mapping.supplier_goods_no);
                            if (found?.imageUrl) {
                                imageUrl = normalizeText(found.imageUrl, 1000);
                                break;
                            }
                        }
                    }
                    return {
                        id: mapping.id, site: mapping.site, skuId: mapping.sku_id || null, accountName: mapping.shop_supplier_accounts?.display_name || '',
                        providerId: mapping.shop_supplier_accounts?.provider_id || '', goodsNo: mapping.supplier_goods_no,
                        variant: typeof mapping.supplier_variant?.race === 'string' ? { race: normalizeText(mapping.supplier_variant.race, 160) } : {},
                        enabled: mapping.is_enabled === true,
                        snapshot: {
                            supplierUnitPrice: /^\d{1,12}(?:\.\d{1,8})?$/.test(String(snap.supplierUnitPrice ?? '')) ? String(snap.supplierUnitPrice) : null,
                            currency: /^[A-Z]{3}$/.test(String(snap.currency || '')) ? snap.currency : null,
                            ...(imageUrl ? { imageUrl } : {}),
                            ...(typeof snap.description === 'string' && snap.description.trim()
                                ? { description: sanitizeSupplierRichTextHtml(snap.description) }
                                : {}),
                            ...(/^\d{1,12}(?:\.\d{1,8})?$/.test(String(snap.costCeilingCny ?? ''))
                                ? { costCeilingCny: String(snap.costCeilingCny) }
                                : {}),
                            procurementReady: false
                        },
                        contractVersion: mapping.contract_version, procurementReady: false
                    };
                }) });
            }
            if (!(method === 'GET' && ['list', 'detail', 'preview', 'reconcile', 'draft-cards', 'category-goods'].includes(action)) && !(method === 'POST' && action === 'import')) {
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
                    const rawGroupKey = url.searchParams.get('groupKey');
                    const groupKey = rawGroupKey ? normalizeGroupKey(rawGroupKey) : '';
                    const refresh = url.searchParams.get('refresh') === '1';
                    const site = normalizeText(url.searchParams.get('site') || 'cn', 16).toLowerCase();
                    if ((requestedSnapshotId && !/^[a-f\d-]{36}$/i.test(requestedSnapshotId))
                        || (requestedSnapshotId && refresh)
                        || (categoryKey && !/^cat-\d{1,5}$/.test(categoryKey))
                        || (rawGroupKey && !groupKey)
                        || (categoryKey && !requestedSnapshotId)
                        || (groupKey && !requestedSnapshotId)
                        || (refresh && (categoryKey || groupKey))
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
                    let targetCategoryKeys = null;
                    let selectedCategoryKey = categoryKey || null;
                    let selectedGroupKey = groupKey || null;
                    const keywords = normalizeText(url.searchParams.get('keywords'), 100).toLowerCase();
                    const unlistedOnly = url.searchParams.get('unlistedOnly') === '1' || url.searchParams.get('onlyUnlisted') === '1';

                    // Load local mapping and publication statuses for this account and site
                    const localGoodsStatusMap = new Map();
                    try {
                        const { data: mappings } = await supabase
                            .from('shop_supplier_product_mappings')
                            .select('supplier_goods_no, is_enabled, product:shop_products(is_active)')
                            .eq('supplier_account_id', account.id)
                            .eq('site', site);
                        for (const m of (mappings || [])) {
                            const goodsNo = String(m?.supplier_goods_no || '').trim();
                            if (!goodsNo) continue;
                            const isPublished = Boolean(m?.is_enabled && m?.product?.is_active);
                            if (!localGoodsStatusMap.has(goodsNo) || isPublished) {
                                localGoodsStatusMap.set(goodsNo, {
                                    imported: true,
                                    published: isPublished,
                                    status: isPublished ? 'published' : 'draft'
                                });
                            }
                        }
                    } catch (_) {}

                    if (categoryKey) {
                        if (!snapshot.categories.some((category) => category.categoryKey === categoryKey)) {
                            return sendJsonImpl(res, 400, { success: false, code: 'supplier_catalog_category_invalid', message: '所选分类不属于当前目录快照。' });
                        }
                        targetCategoryKeys = new Set([categoryKey]);
                    } else if (groupKey) {
                        const keys = findGroupCategoryKeys(snapshot.categoryTree, groupKey);
                        if (keys && keys.length) targetCategoryKeys = new Set(keys);
                        else targetCategoryKeys = new Set();
                    } else if (url.searchParams.get('defaultFirstCategory') === '1' && !keywords) {
                        const firstKey = findFirstCategoryInTree(snapshot.categoryTree, snapshot.categories);
                        if (firstKey) {
                            selectedCategoryKey = firstKey;
                            targetCategoryKeys = new Set([firstKey]);
                        }
                    }

                    let unlistedCount = 0;
                    const enrichedItems = snapshot.items.map((item) => {
                        const localStatus = localGoodsStatusMap.get(item.providerGoodsId);
                        const publicationStatus = localStatus ? localStatus.status : 'unimported';
                        if (publicationStatus !== 'published') {
                            unlistedCount++;
                        }
                        return {
                            ...item,
                            publicationStatus,
                            isImported: Boolean(localStatus?.imported),
                            isPublished: Boolean(localStatus?.published)
                        };
                    });

                    const filteredItems = enrichedItems.filter((item) => {
                        if (targetCategoryKeys && !item.catalogCategoryKeys.some((k) => targetCategoryKeys.has(k))) return false;
                        if (keywords && !`${item.name} ${item.providerGoodsId}`.toLowerCase().includes(keywords)) return false;
                        if (unlistedOnly && item.publicationStatus === 'published') return false;
                        return true;
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
                        categoryTree: snapshot.categoryTree,
                        selectedCategoryKey,
                        selectedGroupKey,
                        unlistedOnly,
                        unlistedCount,
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

            if (method === 'GET' && action === 'category-goods') {
                const requestedSnapshotId = String(url.searchParams.get('snapshotId') || '');
                const categoryKeysParam = String(url.searchParams.get('categoryKeys') || '');
                const site = normalizeText(url.searchParams.get('site') || 'cn', 16).toLowerCase();
                const limitPerCategory = Math.max(0, Number.parseInt(url.searchParams.get('limitPerCategory') || '0', 10) || 0);

                if (!requestedSnapshotId || !/^[a-f\d-]{36}$/i.test(requestedSnapshotId)) {
                    return sendJsonImpl(res, 400, { success: false, message: 'snapshotId is required' });
                }
                const cacheKey = `${account.id}:${site}`;
                const snapshotKey = `${cacheKey}:${requestedSnapshotId}`;
                const snapshot = xiarengCatalogSnapshots.get(snapshotKey);
                if (!snapshot) {
                    return sendJsonImpl(res, 409, { success: false, message: '目录快照已过期，请重新刷新目录。' });
                }

                const targetKeys = new Set(categoryKeysParam.split(',').map((k) => k.trim()).filter(Boolean));
                const itemsByCategory = {};
                for (const catKey of targetKeys) {
                    const cat = snapshot.categories.find(c => c.categoryKey === catKey);
                    const catItems = snapshot.items.filter((item) => item.catalogCategoryKeys.includes(catKey));
                    const catName = cat?.name || cat?.categoryName || catKey;
                    itemsByCategory[catKey] = {
                        categoryName: catName,
                        iconUrl: cat?.iconUrl || matchCategoryIconUrl(catName),
                        items: (limitPerCategory > 0 ? catItems.slice(0, limitPerCategory) : catItems).map(item => ({
                            providerGoodsId: item.providerGoodsId,
                            name: item.name,
                            minimumQuantity: item.minimumQuantity,
                            supplierUnitPrice: item.supplierUnitPrice,
                            deliveryLabel: item.deliveryLabel
                        }))
                    };
                }

                return sendJsonImpl(res, 200, {
                    success: true,
                    snapshotId: requestedSnapshotId,
                    categories: itemsByCategory,
                    totalItems: Object.values(itemsByCategory).reduce((acc, cat) => acc + cat.items.length, 0)
                });
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

            const autoAllVariants = Boolean(body.autoAllVariants);
            const initialStatus = body.initialStatus === 'published' ? 'published' : 'draft';
            const duplicatePolicy = body.duplicatePolicy === 'overwrite' ? 'overwrite' : 'skip';
            const costCeilingMultiplier = Number.isFinite(Number(body.costCeilingMultiplier)) && Number(body.costCeilingMultiplier) > 0
                ? Number(body.costCeilingMultiplier)
                : null;

            const results = [];
            for (const goodsNo of goodsNos) {
                try {
                    const rawCeiling = body.costCeilings?.[goodsNo] ?? body.costCeilingCny ?? null;
                    const costCeilingCny = normalizeCostCeilingCny(rawCeiling);
                    const multiVarList = Array.isArray(body.multiVariants?.[goodsNo])
                        ? body.multiVariants[goodsNo]
                        : (Array.isArray(body.variants?.[goodsNo]) ? body.variants[goodsNo] : null);

                    const rawMultiplier = body.markupMultipliers?.[goodsNo] ?? body.markupMultiplier ?? null;
                    const markupMultiplier = Number.isFinite(Number(rawMultiplier)) && Number(rawMultiplier) >= 1
                        ? Number(rawMultiplier)
                        : null;

                    const targetCategory = body.productCategories?.[goodsNo] || body.productCategory || null;
                    const categoryIconUrl = body.categoryIcons?.[targetCategory]
                        || body.categoryIcons?.[goodsNo]
                        || body.categoryIconUrl
                        || (targetCategory ? matchCategoryIconUrl(targetCategory) : null);
                    const guestPaymentChannels = body.categoryPaymentChannels?.[goodsNo] || body.guestPaymentChannels || null;
                    const rawSalesConfig = body.salesConfigs?.[goodsNo] || body.salesConfig || body.sales_config || null;
                    const salesConfig = normalizeProductSalesConfig(rawSalesConfig);

                    if (((multiVarList && multiVarList.length > 0) || autoAllVariants) && typeof adapter.normalizeVariant === 'function') {
                        results.push(await importMultiVariantDraft({
                            supabase,
                            adapter,
                            account,
                            adminId: user?.id || null,
                            site,
                            goodsNo,
                            variants: multiVarList || [],
                            costCeilingCny,
                            costCeilingMultiplier,
                            markupMultiplier,
                            productCategory: targetCategory || 'other',
                            categoryIconUrl,
                            guestPaymentChannels,
                            initialStatus,
                            duplicatePolicy,
                            salesConfig
                        }));
                    } else {
                        const importer = typeof adapter.normalizeVariant === 'function' ? importVariantDraft : importOne;
                        results.push(await importer({
                            supabase,
                            adapter,
                            account,
                            adminId: user?.id || null,
                            providerId,
                            site,
                            goodsNo,
                            variant: body.variants?.[goodsNo] || {},
                            costCeilingCny,
                            costCeilingMultiplier,
                            markupMultiplier,
                            productCategory: targetCategory,
                            categoryIconUrl,
                            guestPaymentChannels,
                            initialStatus,
                            duplicatePolicy,
                            salesConfig
                        }));
                    }
                } catch (error) {
                    results.push({
                        goodsNo,
                        status: 'failed',
                        code: normalizeText(error?.code, 80) || 'supplier_import_failed',
                        message: isMissingSupplierSchemaError(error) ? '只读铺货迁移尚未应用，未创建草稿。'
                            : ['supplier_variant_review_required', 'supplier_site_unsupported', 'supplier_draft_cards_preview_only', 'supplier_invalid_cost_ceiling'].includes(error?.code) ? error.message
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
            console.error('[SupplierCatalog] Request failed:', safeError.code, error?.message || error);
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
handler.normalizeProductSalesConfig = normalizeProductSalesConfig;
handler.getCstDateString = getCstDateString;

module.exports = handler;
