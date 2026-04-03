const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const VALID_DISCOUNT_TYPES = new Set(['percent', 'fixed']);
const VALID_SCOPE_TYPES = new Set(['all', 'category', 'product']);

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePositiveInteger(value, { allowZero = false } = {}) {
    const normalized = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(normalized)) {
        return null;
    }
    if (allowZero) {
        return normalized >= 0 ? normalized : null;
    }
    return normalized > 0 ? normalized : null;
}

function normalizeOptionalSite(value) {
    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized) {
        return null;
    }

    const site = normalizeAdminSite(normalized, { defaultValue: '' });
    if (!site || site === 'all') {
        return null;
    }

    return site;
}

function normalizeOptionalIsoDate(value) {
    const normalized = normalizeText(value, 80);
    if (!normalized) {
        return null;
    }

    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) {
        return null;
    }

    return new Date(timestamp).toISOString();
}

function normalizeCreatePayload(body = {}) {
    const sourcePayload = body && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : body;

    const code = normalizeText(sourcePayload.code, 80).toUpperCase();
    const discountType = normalizeText(sourcePayload.discount_type || sourcePayload.discountType, 20).toLowerCase();
    const discountValue = normalizePositiveInteger(sourcePayload.discount_value ?? sourcePayload.discountValue);
    const maxUses = normalizePositiveInteger(sourcePayload.max_uses ?? sourcePayload.maxUses ?? 0, { allowZero: true });
    const maxUsesPerUser = normalizePositiveInteger(sourcePayload.max_uses_per_user ?? sourcePayload.maxUsesPerUser ?? 0, { allowZero: true });
    const expiresAt = normalizeOptionalIsoDate(sourcePayload.expires_at ?? sourcePayload.expiresAt);
    const applicableSite = normalizeOptionalSite(sourcePayload.applicable_site ?? sourcePayload.applicableSite);
    const scopeType = normalizeText(sourcePayload.scope_type || sourcePayload.scopeType, 20).toLowerCase() || 'all';
    const scopeCategory = normalizeText(sourcePayload.scope_category ?? sourcePayload.scopeCategory, 120) || null;
    const scopeProductId = normalizeText(sourcePayload.scope_product_id ?? sourcePayload.scopeProductId, 160) || null;
    const allowZeroTotal = sourcePayload.allow_zero_total === true || sourcePayload.allowZeroTotal === true;
    const isActive = sourcePayload.is_active !== false && sourcePayload.isActive !== false;

    if (!code) {
        throw new Error('code is required');
    }

    if (!VALID_DISCOUNT_TYPES.has(discountType)) {
        throw new Error('discount_type is invalid');
    }

    if (!discountValue) {
        throw new Error('discount_value must be a positive integer');
    }

    if (discountType === 'percent' && discountValue > 100) {
        throw new Error('percent discount_value must be 100 or below');
    }

    if (maxUses === null) {
        throw new Error('max_uses must be a non-negative integer');
    }

    if (maxUsesPerUser === null) {
        throw new Error('max_uses_per_user must be a non-negative integer');
    }

    if ((sourcePayload.expires_at || sourcePayload.expiresAt) && !expiresAt) {
        throw new Error('expires_at is invalid');
    }

    if ((sourcePayload.applicable_site || sourcePayload.applicableSite) && !applicableSite) {
        throw new Error('applicable_site is invalid');
    }

    if (!VALID_SCOPE_TYPES.has(scopeType)) {
        throw new Error('scope_type is invalid');
    }

    if (scopeType === 'category' && !scopeCategory) {
        throw new Error('scope_category is required when scope_type=category');
    }

    if (scopeType === 'product' && !scopeProductId) {
        throw new Error('scope_product_id is required when scope_type=product');
    }

    return {
        code,
        discount_type: discountType,
        discount_value: discountValue,
        max_uses: maxUses,
        max_uses_per_user: maxUsesPerUser,
        expires_at: expiresAt,
        applicable_site: applicableSite,
        scope_type: scopeType,
        scope_category: scopeType === 'category' ? scopeCategory : null,
        scope_product_id: scopeType === 'product' ? scopeProductId : null,
        allow_zero_total: allowZeroTotal,
        is_active: isActive
    };
}

async function loadDiscountById(supabase, id) {
    const { data, error } = await supabase
        .from('discount_codes')
        .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, max_uses_per_user, expires_at, scope_type, scope_category, scope_product_id, allow_zero_total')
        .eq('id', id)
        .single();

    if (error || !data) {
        const notFoundError = new Error(error?.message || '优惠码不存在');
        notFoundError.statusCode = error?.status === 406 ? 404 : 404;
        throw notFoundError;
    }

    return data;
}

function assertWritableSiteAccessForDiscount(discount, writableSite) {
    const applicableSite = normalizeOptionalSite(discount?.applicable_site);
    if (applicableSite && applicableSite !== writableSite) {
        const error = new Error(`优惠码属于 ${applicableSite.toUpperCase()} 站点，请切换站点后重试`);
        error.statusCode = 409;
        throw error;
    }
}

module.exports = async function adminDiscountsMutateHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'discounts.manage' });
        const body = await parseJsonBody(req);
        const action = normalizeText(body.action, 40).toLowerCase();

        if (!action) {
            return sendJson(res, 400, {
                success: false,
                message: 'action is required'
            });
        }

        const writableSite = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });

        if (action === 'create') {
            const payload = normalizeCreatePayload(body);
            const { data, error } = await supabase
                .from('discount_codes')
                .insert(payload)
                .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, max_uses_per_user, expires_at, scope_type, scope_category, scope_product_id, allow_zero_total')
                .single();

            if (error || !data) {
                return sendJson(res, 400, {
                    success: false,
                    message: error?.code === '23505'
                        ? '该优惠码已存在，请换一个名称'
                        : (error?.message || '创建优惠码失败')
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'discounts',
                site: writableSite,
                actionType: 'discount.code.create',
                details: {
                    discount_id: data.id,
                    code: data.code,
                    applicable_site: data.applicable_site || null,
                    discount_type: data.discount_type,
                    discount_value: data.discount_value,
                    max_uses: data.max_uses,
                    max_uses_per_user: data.max_uses_per_user,
                    scope_type: data.scope_type,
                    scope_category: data.scope_category || null,
                    scope_product_id: data.scope_product_id || null,
                    allow_zero_total: !!data.allow_zero_total,
                    is_active: !!data.is_active,
                    expires_at: data.expires_at || null
                }
            });

            return sendJson(res, 200, {
                success: true,
                row: data
            });
        }

        if (action === 'toggle_status') {
            const id = normalizeText(body.id, 160);
            const nextActive = typeof body.isActive === 'boolean'
                ? body.isActive
                : (typeof body.newState === 'boolean' ? body.newState : null);

            if (!id) {
                return sendJson(res, 400, { success: false, message: 'id is required' });
            }
            if (nextActive === null) {
                return sendJson(res, 400, { success: false, message: 'isActive is required' });
            }

            const existingRow = await loadDiscountById(supabase, id);
            assertWritableSiteAccessForDiscount(existingRow, writableSite);

            const { data, error } = await supabase
                .from('discount_codes')
                .update({ is_active: nextActive })
                .eq('id', id)
                .select('id, code, is_active, applicable_site')
                .single();

            if (error || !data) {
                return sendJson(res, 400, {
                    success: false,
                    message: error?.message || '更新优惠码状态失败'
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'discounts',
                site: writableSite,
                actionType: 'discount.code.toggle',
                details: {
                    discount_id: data.id,
                    code: data.code,
                    applicable_site: data.applicable_site || null,
                    previous_active: !!existingRow.is_active,
                    next_active: !!data.is_active
                }
            });

            return sendJson(res, 200, {
                success: true,
                row: data
            });
        }

        if (action === 'delete') {
            const id = normalizeText(body.id, 160);

            if (!id) {
                return sendJson(res, 400, { success: false, message: 'id is required' });
            }

            const existingRow = await loadDiscountById(supabase, id);
            assertWritableSiteAccessForDiscount(existingRow, writableSite);

            const { error } = await supabase
                .from('discount_codes')
                .delete()
                .eq('id', id);

            if (error) {
                return sendJson(res, 400, {
                    success: false,
                    message: error.message || '删除优惠码失败'
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'discounts',
                site: writableSite,
                actionType: 'discount.code.delete',
                details: {
                    discount_id: existingRow.id,
                    code: existingRow.code,
                    applicable_site: existingRow.applicable_site || null
                }
            });

            return sendJson(res, 200, {
                success: true,
                deleted: true
            });
        }

        return sendJson(res, 400, {
            success: false,
            message: `Unsupported action: ${action}`
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to mutate discounts'
        });
    }
};
