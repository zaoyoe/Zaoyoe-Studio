const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    DISCOUNT_SELECT_FIELDS,
    normalizeText,
    normalizeOptionalIsoDate,
    normalizePositiveInteger,
    normalizeRecoveryStrategy,
    normalizeDistributionMode,
    normalizePricingApplyStage,
    normalizeBoolean,
    buildObservationEndsAt,
    buildDiscountWriteState,
    buildDiscountMutationVersion
} = require('./_shared');

const VALID_DISCOUNT_TYPES = new Set(['percent', 'fixed']);
const VALID_SCOPE_TYPES = new Set(['all', 'category', 'product']);

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

function normalizeToggleAuditContext(body = {}) {
    const reviewNote = normalizeText(body.review_note || body.reviewNote || body.reason, 2000) || null;
    const operationSource = normalizeText(body.operation_source || body.operationSource, 120).toLowerCase() || null;
    const riskReviewed = body.risk_reviewed === true || body.riskReviewed === true;
    const resolveCaseRequested = body.resolve_case_requested === true || body.resolveCaseRequested === true;

    return {
        review_note: reviewNote,
        operation_source: operationSource,
        risk_reviewed: riskReviewed,
        resolve_case_requested: resolveCaseRequested
    };
}

function normalizeCreatePayload(body = {}, options = {}) {
    const sourcePayload = body && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : body;
    const existingRow = options.existingRow && typeof options.existingRow === 'object' ? options.existingRow : null;
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    const code = normalizeText(sourcePayload.code, 80).toUpperCase();
    const discountType = normalizeText(sourcePayload.discount_type || sourcePayload.discountType, 20).toLowerCase();
    const discountValue = normalizePositiveInteger(sourcePayload.discount_value ?? sourcePayload.discountValue, null);
    const maxUses = normalizePositiveInteger(sourcePayload.max_uses ?? sourcePayload.maxUses ?? 0, null, { allowZero: true });
    const maxUsesPerUser = normalizePositiveInteger(sourcePayload.max_uses_per_user ?? sourcePayload.maxUsesPerUser ?? 0, null, { allowZero: true });
    const startsAt = normalizeOptionalIsoDate(sourcePayload.starts_at ?? sourcePayload.startsAt);
    const expiresAt = normalizeOptionalIsoDate(sourcePayload.expires_at ?? sourcePayload.expiresAt);
    const applicableSite = normalizeOptionalSite(sourcePayload.applicable_site ?? sourcePayload.applicableSite);
    const scopeType = normalizeText(sourcePayload.scope_type || sourcePayload.scopeType, 20).toLowerCase() || 'all';
    const scopeCategory = normalizeText(sourcePayload.scope_category ?? sourcePayload.scopeCategory, 120) || null;
    const scopeProductId = normalizeText(sourcePayload.scope_product_id ?? sourcePayload.scopeProductId, 160) || null;
    const scopeProductSkuId = normalizeText(sourcePayload.scope_product_sku_id ?? sourcePayload.scopeProductSkuId, 160) || null;
    const allowZeroTotal = sourcePayload.allow_zero_total === true || sourcePayload.allowZeroTotal === true;
    const distributionMode = normalizeDistributionMode(
        sourcePayload.distribution_mode ?? sourcePayload.distributionMode,
        normalizeDistributionMode(existingRow?.distribution_mode, 'general_code')
    );
    const claimStartsAt = normalizeOptionalIsoDate(sourcePayload.claim_starts_at ?? sourcePayload.claimStartsAt);
    const claimExpiresAt = normalizeOptionalIsoDate(sourcePayload.claim_expires_at ?? sourcePayload.claimExpiresAt);
    const claimLimitPerUser = normalizePositiveInteger(
        sourcePayload.claim_limit_per_user ?? sourcePayload.claimLimitPerUser ?? existingRow?.claim_limit_per_user ?? 0,
        0,
        { allowZero: true, min: 0, max: 10000 }
    );
    const campaignTag = normalizeText(sourcePayload.campaign_tag ?? sourcePayload.campaignTag, 120) || null;
    const audienceSegment = normalizeText(sourcePayload.audience_segment ?? sourcePayload.audienceSegment, 120) || null;
    const isExclusive = Object.prototype.hasOwnProperty.call(sourcePayload, 'is_exclusive')
        || Object.prototype.hasOwnProperty.call(sourcePayload, 'isExclusive')
        ? normalizeBoolean(sourcePayload.is_exclusive ?? sourcePayload.isExclusive, true)
        : normalizeBoolean(existingRow?.is_exclusive, true);
    const stackPriority = normalizePositiveInteger(
        sourcePayload.stack_priority ?? sourcePayload.stackPriority ?? existingRow?.stack_priority ?? 100,
        100,
        { allowZero: false, min: 1, max: 9999 }
    );
    const pricingApplyStage = normalizePricingApplyStage(
        sourcePayload.pricing_apply_stage ?? sourcePayload.pricingApplyStage,
        normalizePricingApplyStage(existingRow?.pricing_apply_stage, 'order_discount')
    );
    const recoveryStrategy = normalizeRecoveryStrategy(
        sourcePayload.recovery_strategy ?? sourcePayload.recoveryStrategy,
        normalizeRecoveryStrategy(existingRow?.recovery_strategy, 'manual_only')
    );
    const observationWindowHours = normalizePositiveInteger(
        sourcePayload.observation_window_hours ?? sourcePayload.observationWindowHours ?? existingRow?.observation_window_hours ?? 24,
        24,
        { allowZero: false, min: 1, max: 168 }
    );
    const isActive = Object.prototype.hasOwnProperty.call(sourcePayload, 'is_active')
        || Object.prototype.hasOwnProperty.call(sourcePayload, 'isActive')
        ? (sourcePayload.is_active !== false && sourcePayload.isActive !== false)
        : (options.defaultIsActive !== false);

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

    if ((sourcePayload.starts_at || sourcePayload.startsAt) && !startsAt) {
        throw new Error('starts_at is invalid');
    }

    if ((sourcePayload.expires_at || sourcePayload.expiresAt) && !expiresAt) {
        throw new Error('expires_at is invalid');
    }

    if (startsAt && expiresAt && Date.parse(startsAt) >= Date.parse(expiresAt)) {
        throw new Error('starts_at must be earlier than expires_at');
    }

    if ((sourcePayload.claim_starts_at || sourcePayload.claimStartsAt) && !claimStartsAt) {
        throw new Error('claim_starts_at is invalid');
    }

    if ((sourcePayload.claim_expires_at || sourcePayload.claimExpiresAt) && !claimExpiresAt) {
        throw new Error('claim_expires_at is invalid');
    }

    if (claimStartsAt && claimExpiresAt && Date.parse(claimStartsAt) >= Date.parse(claimExpiresAt)) {
        throw new Error('claim_starts_at must be earlier than claim_expires_at');
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

    const payload = {
        code,
        discount_type: discountType,
        discount_value: discountValue,
        max_uses: maxUses,
        max_uses_per_user: maxUsesPerUser,
        starts_at: startsAt,
        expires_at: expiresAt,
        applicable_site: applicableSite,
        scope_type: scopeType,
        scope_category: scopeType === 'category' ? scopeCategory : null,
        scope_product_id: scopeType === 'product' ? scopeProductId : null,
        scope_product_sku_id: scopeType === 'product' ? scopeProductSkuId : null,
        allow_zero_total: allowZeroTotal,
        distribution_mode: distributionMode,
        claim_starts_at: distributionMode === 'public_claim' ? claimStartsAt : null,
        claim_expires_at: distributionMode === 'public_claim' ? claimExpiresAt : null,
        claim_limit_per_user: distributionMode === 'public_claim' ? claimLimitPerUser : 0,
        campaign_tag: campaignTag,
        audience_segment: audienceSegment,
        is_exclusive: isExclusive,
        stack_priority: stackPriority,
        pricing_apply_stage: pricingApplyStage,
        is_active: isActive,
        recovery_strategy: recoveryStrategy,
        observation_window_hours: observationWindowHours
    };

    const nextState = buildDiscountWriteState(payload, {
        existingRow,
        now,
        statusIntent: options.statusIntent || null
    });

    return {
        ...payload,
        ...nextState,
        version_no: buildDiscountMutationVersion(existingRow, payload)
    };
}

async function loadDiscountById(supabase, id) {
    const { data, error } = await supabase
        .from('discount_codes')
        .select(DISCOUNT_SELECT_FIELDS)
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
            const payload = normalizeCreatePayload(body, {
                defaultIsActive: true
            });
            const { data, error } = await supabase
                .from('discount_codes')
                .insert(payload)
                .select(DISCOUNT_SELECT_FIELDS)
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
                    starts_at: data.starts_at || null,
                    scope_type: data.scope_type,
                    scope_category: data.scope_category || null,
                    scope_product_id: data.scope_product_id || null,
                    scope_product_sku_id: data.scope_product_sku_id || null,
                    allow_zero_total: !!data.allow_zero_total,
                    distribution_mode: data.distribution_mode || 'general_code',
                    claim_starts_at: data.claim_starts_at || null,
                    claim_expires_at: data.claim_expires_at || null,
                    claim_limit_per_user: data.claim_limit_per_user || 0,
                    campaign_tag: data.campaign_tag || null,
                    audience_segment: data.audience_segment || null,
                    is_active: !!data.is_active,
                    expires_at: data.expires_at || null,
                    lifecycle_status: data.lifecycle_status || null,
                    status_reason: data.status_reason || null,
                    version_no: data.version_no || 1,
                    recovery_strategy: data.recovery_strategy || 'manual_only',
                    observation_window_hours: data.observation_window_hours || 24,
                    observation_ends_at: data.observation_ends_at || null
                }
            });

            return sendJson(res, 200, {
                success: true,
                row: data
            });
        }

        if (action === 'update') {
            const id = normalizeText(body.id || body?.payload?.id, 160);
            if (!id) {
                return sendJson(res, 400, { success: false, message: 'id is required' });
            }

            const existingRow = await loadDiscountById(supabase, id);
            assertWritableSiteAccessForDiscount(existingRow, writableSite);

            const payload = normalizeCreatePayload(body, {
                existingRow,
                defaultIsActive: existingRow.is_active !== false
            });

            if (
                Math.max(0, Number.parseInt(existingRow.used_count, 10) || 0) > 0
                && payload.code !== existingRow.code
            ) {
                return sendJson(res, 409, {
                    success: false,
                    message: '已有使用记录的优惠码不能直接改码，请复制新券后继续配置'
                });
            }

            const { data, error } = await supabase
                .from('discount_codes')
                .update(payload)
                .eq('id', id)
                .select(DISCOUNT_SELECT_FIELDS)
                .single();

            if (error || !data) {
                return sendJson(res, 400, {
                    success: false,
                    message: error?.code === '23505'
                        ? '该优惠码已存在，请换一个名称'
                        : (error?.message || '更新优惠码失败')
                });
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'discounts',
                site: writableSite,
                actionType: 'discount.code.update',
                details: {
                    discount_id: data.id,
                    previous_code: existingRow.code,
                    code: data.code,
                    previous_active: !!existingRow.is_active,
                    is_active: !!data.is_active,
                    previous_applicable_site: existingRow.applicable_site || null,
                    applicable_site: data.applicable_site || null,
                    previous_discount_type: existingRow.discount_type,
                    discount_type: data.discount_type,
                    previous_discount_value: existingRow.discount_value,
                    discount_value: data.discount_value,
                    previous_max_uses: existingRow.max_uses,
                    max_uses: data.max_uses,
                    previous_max_uses_per_user: existingRow.max_uses_per_user,
                    max_uses_per_user: data.max_uses_per_user,
                    previous_starts_at: existingRow.starts_at || null,
                    starts_at: data.starts_at || null,
                    previous_scope_type: existingRow.scope_type,
                    scope_type: data.scope_type,
                    previous_scope_category: existingRow.scope_category || null,
                    scope_category: data.scope_category || null,
                    previous_scope_product_id: existingRow.scope_product_id || null,
                    scope_product_id: data.scope_product_id || null,
                    previous_scope_product_sku_id: existingRow.scope_product_sku_id || null,
                    scope_product_sku_id: data.scope_product_sku_id || null,
                    previous_allow_zero_total: !!existingRow.allow_zero_total,
                    allow_zero_total: !!data.allow_zero_total,
                    previous_distribution_mode: existingRow.distribution_mode || 'general_code',
                    distribution_mode: data.distribution_mode || 'general_code',
                    previous_claim_starts_at: existingRow.claim_starts_at || null,
                    claim_starts_at: data.claim_starts_at || null,
                    previous_claim_expires_at: existingRow.claim_expires_at || null,
                    claim_expires_at: data.claim_expires_at || null,
                    previous_claim_limit_per_user: existingRow.claim_limit_per_user || 0,
                    claim_limit_per_user: data.claim_limit_per_user || 0,
                    previous_campaign_tag: existingRow.campaign_tag || null,
                    campaign_tag: data.campaign_tag || null,
                    previous_audience_segment: existingRow.audience_segment || null,
                    audience_segment: data.audience_segment || null,
                    previous_expires_at: existingRow.expires_at || null,
                    expires_at: data.expires_at || null,
                    previous_lifecycle_status: existingRow.lifecycle_status || null,
                    lifecycle_status: data.lifecycle_status || null,
                    previous_status_reason: existingRow.status_reason || null,
                    status_reason: data.status_reason || null,
                    previous_version_no: existingRow.version_no || 1,
                    version_no: data.version_no || 1,
                    previous_recovery_strategy: existingRow.recovery_strategy || 'manual_only',
                    recovery_strategy: data.recovery_strategy || 'manual_only',
                    previous_observation_window_hours: existingRow.observation_window_hours || 24,
                    observation_window_hours: data.observation_window_hours || 24,
                    previous_observation_ends_at: existingRow.observation_ends_at || null,
                    observation_ends_at: data.observation_ends_at || null
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
            const toggleAuditContext = normalizeToggleAuditContext(body);

            if (!id) {
                return sendJson(res, 400, { success: false, message: 'id is required' });
            }
            if (nextActive === null) {
                return sendJson(res, 400, { success: false, message: 'isActive is required' });
            }

            const existingRow = await loadDiscountById(supabase, id);
            assertWritableSiteAccessForDiscount(existingRow, writableSite);
            const now = new Date();
            const nowIso = now.toISOString();
            const safeObservationWindowHours = Math.max(1, Number.parseInt(existingRow.observation_window_hours, 10) || 24);
            const enteringObservation = nextActive === true && existingRow.recovery_strategy === 'observation_then_restore';
            const statePayload = buildDiscountWriteState({
                ...existingRow,
                is_active: nextActive,
                observation_ends_at: enteringObservation
                    ? buildObservationEndsAt(safeObservationWindowHours, now)
                    : null
            }, {
                existingRow,
                now,
                statusIntent: nextActive
                    ? (enteringObservation ? 'risk_observation' : 'manual_restore')
                    : (existingRow.lifecycle_status === 'paused_risk' || String(existingRow.status_reason || '').startsWith('risk_')
                        ? 'risk_pause'
                        : 'manual_pause')
            });

            const updatePayload = {
                is_active: nextActive,
                ...statePayload,
                last_paused_at: nextActive ? existingRow.last_paused_at || null : nowIso,
                last_restored_at: nextActive ? nowIso : existingRow.last_restored_at || null
            };

            const { data, error } = await supabase
                .from('discount_codes')
                .update(updatePayload)
                .eq('id', id)
                .select(DISCOUNT_SELECT_FIELDS)
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
                    next_active: !!data.is_active,
                    previous_lifecycle_status: existingRow.lifecycle_status || null,
                    lifecycle_status: data.lifecycle_status || null,
                    previous_status_reason: existingRow.status_reason || null,
                    status_reason: data.status_reason || null,
                    recovery_strategy: data.recovery_strategy || 'manual_only',
                    observation_window_hours: data.observation_window_hours || 24,
                    observation_ends_at: data.observation_ends_at || null,
                    review_note: toggleAuditContext.review_note,
                    risk_reviewed: toggleAuditContext.risk_reviewed,
                    resolve_case_requested: toggleAuditContext.resolve_case_requested,
                    operation_source: toggleAuditContext.operation_source
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
