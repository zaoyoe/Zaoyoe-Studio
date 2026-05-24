const DISCOUNT_SELECT_FIELDS = [
    'id',
    'code',
    'is_active',
    'applicable_site',
    'discount_type',
    'discount_value',
    'max_uses',
    'used_count',
    'max_uses_per_user',
    'starts_at',
    'expires_at',
    'lifecycle_status',
    'status_reason',
    'scope_type',
    'scope_category',
    'scope_product_id',
    'scope_product_sku_id',
    'allow_zero_total',
    'version_no',
    'distribution_mode',
    'claim_starts_at',
    'claim_expires_at',
    'claim_limit_per_user',
    'campaign_tag',
    'audience_segment',
    'is_exclusive',
    'stack_priority',
    'pricing_apply_stage',
    'recovery_strategy',
    'observation_window_hours',
    'observation_ends_at',
    'last_paused_at',
    'last_restored_at',
    'created_at'
].join(', ');

const VALID_LIFECYCLE_STATUSES = new Set([
    'scheduled',
    'active',
    'paused_manual',
    'paused_risk',
    'expired',
    'archived'
]);

const VALID_RECOVERY_STRATEGIES = new Set([
    'manual_only',
    'auto_restore',
    'observation_then_restore'
]);

const VALID_DISTRIBUTION_MODES = new Set([
    'general_code',
    'public_claim',
    'user_assigned'
]);

const VALID_PRICING_APPLY_STAGES = new Set([
    'catalog_price',
    'order_discount',
    'balance_offset'
]);

const VALID_DISCOUNT_ASSET_STATUSES = new Set([
    'available',
    'used',
    'expired',
    'revoked'
]);

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
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

function normalizePositiveInteger(value, fallback = null, { allowZero = false, min = 0, max = 100000 } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    if (allowZero) {
        if (parsed < 0) return fallback;
    } else if (parsed <= 0) {
        return fallback;
    }

    return Math.max(min, Math.min(max, parsed));
}

function normalizeLifecycleStatus(value, fallback = 'active') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_LIFECYCLE_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeRecoveryStrategy(value, fallback = 'manual_only') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_RECOVERY_STRATEGIES.has(normalized) ? normalized : fallback;
}

function normalizeDistributionMode(value, fallback = 'general_code') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_DISTRIBUTION_MODES.has(normalized) ? normalized : fallback;
}

function normalizePricingApplyStage(value, fallback = 'order_discount') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_PRICING_APPLY_STAGES.has(normalized) ? normalized : fallback;
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }

    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized) {
        return fallback;
    }
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function normalizeDiscountAssetStatus(value, fallback = 'available') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_DISCOUNT_ASSET_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeStatusReason(value, fallback = null) {
    return normalizeText(value, 120).toLowerCase() || fallback;
}

function getSafeTimestamp(value) {
    const parsed = Date.parse(normalizeText(value, 80));
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildObservationEndsAt(windowHours = 24, now = new Date()) {
    const safeWindowHours = Math.max(1, Number.parseInt(windowHours, 10) || 24);
    return new Date(now.getTime() + safeWindowHours * 60 * 60 * 1000).toISOString();
}

function buildDiscountWriteState(source = {}, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const existingRow = options.existingRow && typeof options.existingRow === 'object' ? options.existingRow : null;
    const nextActive = source.is_active !== false;
    const startsAt = normalizeOptionalIsoDate(source.starts_at);
    const statusIntent = normalizeStatusReason(options.statusIntent, null);
    const nextObservationEndsAt = normalizeOptionalIsoDate(source.observation_ends_at);

    if (nextActive === false) {
        const shouldPreserveRiskPause = statusIntent === 'risk_pause'
            || normalizeLifecycleStatus(existingRow?.lifecycle_status, '') === 'paused_risk'
            || normalizeStatusReason(existingRow?.status_reason, '').startsWith('risk_');

        return {
            lifecycle_status: shouldPreserveRiskPause ? 'paused_risk' : 'paused_manual',
            status_reason: shouldPreserveRiskPause ? 'risk_auto_pause' : 'manual_pause',
            observation_ends_at: null
        };
    }

    if (startsAt && getSafeTimestamp(startsAt) > now.getTime()) {
        return {
            lifecycle_status: 'scheduled',
            status_reason: 'scheduled_start',
            observation_ends_at: null
        };
    }

    const existingObservationEndsAt = normalizeOptionalIsoDate(existingRow?.observation_ends_at);
    const effectiveObservationEndsAt = nextObservationEndsAt || existingObservationEndsAt;
    if (
        statusIntent === 'risk_observation'
        || (
            existingObservationEndsAt
            && getSafeTimestamp(existingObservationEndsAt) > now.getTime()
            && normalizeStatusReason(existingRow?.status_reason, '') === 'risk_observation'
        )
    ) {
        return {
            lifecycle_status: 'active',
            status_reason: 'risk_observation',
            observation_ends_at: effectiveObservationEndsAt
        };
    }

    return {
        lifecycle_status: 'active',
        status_reason: statusIntent || 'manual_active',
        observation_ends_at: null
    };
}

function buildDiscountLifecycleSummary(row = {}, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const startsAt = normalizeOptionalIsoDate(row?.starts_at);
    const expiresAt = normalizeOptionalIsoDate(row?.expires_at);
    const observationEndsAt = normalizeOptionalIsoDate(row?.observation_ends_at);
    const lifecycleStatus = normalizeLifecycleStatus(row?.lifecycle_status, row?.is_active === false ? 'paused_manual' : 'active');
    const statusReason = normalizeStatusReason(row?.status_reason, '');
    const maxUses = Number.parseInt(row?.max_uses, 10);
    const usedCount = Math.max(0, Number.parseInt(row?.used_count, 10) || 0);
    const isExhausted = maxUses > 0 && usedCount >= maxUses;
    const nowMs = now.getTime();

    if (lifecycleStatus === 'archived') {
        return {
            key: 'archived',
            label: '已归档',
            reason_key: statusReason || 'archived',
            detail_text: '仅保留历史记录，不再参与运营。',
            is_practically_used: true,
            is_observation_active: false
        };
    }

    if (expiresAt && getSafeTimestamp(expiresAt) > 0 && getSafeTimestamp(expiresAt) <= nowMs) {
        return {
            key: 'expired',
            label: '已过期',
            reason_key: statusReason || 'expired',
            detail_text: `截止时间: ${expiresAt}`,
            is_practically_used: true,
            is_observation_active: false
        };
    }

    if (startsAt && getSafeTimestamp(startsAt) > nowMs && row?.is_active !== false) {
        return {
            key: 'scheduled',
            label: '待生效',
            reason_key: statusReason || 'scheduled_start',
            detail_text: `开始时间: ${startsAt}`,
            is_practically_used: false,
            is_observation_active: false
        };
    }

    if (isExhausted) {
        return {
            key: 'exhausted',
            label: '已用尽',
            reason_key: statusReason || 'quota_exhausted',
            detail_text: `总额度已用完 (${usedCount}/${maxUses})`,
            is_practically_used: true,
            is_observation_active: false
        };
    }

    if (row?.is_active === false || lifecycleStatus === 'paused_manual' || lifecycleStatus === 'paused_risk') {
        const isRiskPause = lifecycleStatus === 'paused_risk' || statusReason.startsWith('risk_');
        return {
            key: isRiskPause ? 'paused_risk' : 'paused_manual',
            label: isRiskPause ? '风控停用' : '手动停用',
            reason_key: statusReason || (isRiskPause ? 'risk_auto_pause' : 'manual_pause'),
            detail_text: isRiskPause ? '需完成风险复核后再恢复。' : '当前不会在前台继续生效。',
            is_practically_used: true,
            is_observation_active: false
        };
    }

    if (observationEndsAt && getSafeTimestamp(observationEndsAt) > nowMs && statusReason === 'risk_observation') {
        return {
            key: 'active',
            label: '观察中',
            reason_key: 'risk_observation',
            detail_text: `观察期至: ${observationEndsAt}`,
            is_practically_used: false,
            is_observation_active: true
        };
    }

    return {
        key: 'active',
        label: '生效中',
        reason_key: statusReason || 'manual_active',
        detail_text: expiresAt ? `截止时间: ${expiresAt}` : '当前未设置过期时间。',
        is_practically_used: false,
        is_observation_active: false
    };
}

function buildDiscountMutationVersion(existingRow = null, nextPayload = {}) {
    const currentVersion = Math.max(1, Number.parseInt(existingRow?.version_no, 10) || 1);
    if (!existingRow) {
        return 1;
    }

    const fieldsThatAffectRules = [
        'code',
        'discount_type',
        'discount_value',
        'max_uses',
        'max_uses_per_user',
        'starts_at',
        'expires_at',
        'applicable_site',
        'scope_type',
        'scope_category',
        'scope_product_id',
        'scope_product_sku_id',
        'allow_zero_total',
        'is_exclusive',
        'stack_priority',
        'pricing_apply_stage',
        'recovery_strategy',
        'observation_window_hours'
    ];

    const changed = fieldsThatAffectRules.some((field) => {
        const previousValue = existingRow?.[field] ?? null;
        const nextValue = nextPayload?.[field] ?? null;
        return JSON.stringify(previousValue) !== JSON.stringify(nextValue);
    });

    return changed ? currentVersion + 1 : currentVersion;
}

module.exports = {
    DISCOUNT_SELECT_FIELDS,
    VALID_LIFECYCLE_STATUSES,
    VALID_RECOVERY_STRATEGIES,
    VALID_DISTRIBUTION_MODES,
    VALID_PRICING_APPLY_STAGES,
    VALID_DISCOUNT_ASSET_STATUSES,
    normalizeText,
    normalizeOptionalIsoDate,
    normalizePositiveInteger,
    normalizeLifecycleStatus,
    normalizeRecoveryStrategy,
    normalizeDistributionMode,
    normalizePricingApplyStage,
    normalizeBoolean,
    normalizeDiscountAssetStatus,
    normalizeStatusReason,
    buildObservationEndsAt,
    buildDiscountWriteState,
    buildDiscountLifecycleSummary,
    buildDiscountMutationVersion
};
