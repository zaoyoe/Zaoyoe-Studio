const AUTO_USER_TAGS = Object.freeze({
    PAID_USER: 'paid_user',
    PAYMENT_FAILED: 'payment_failed',
    VERIFY_FAILED: 'verify_failed',
    HIGH_VALUE: 'high_value',
    INACTIVE_USER: 'inactive_user'
});
const TAG_CENTER_CONFIG_KEY = 'engagement_user_tag_center';
const DEFAULT_USER_TAG_AUTOMATION = Object.freeze({
    high_value: Object.freeze({
        enabled: true,
        min_paid_amount: 500,
        min_points: 5000,
        min_order_count: 5
    }),
    payment_failed: Object.freeze({
        enabled: true,
        window_days: 7,
        min_count: 1
    }),
    verify_failed: Object.freeze({
        enabled: true,
        window_days: 7,
        min_count: 1
    }),
    inactive: Object.freeze({
        enabled: false,
        inactive_days: 30
    })
});

function sanitizeText(value, maxLength = 120) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function isUuid(value = '') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || '').trim()
    );
}

function normalizeTagValue(value = '') {
    return sanitizeText(value, 120)
        .toLowerCase()
        .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeUniqueStrings(value = [], normalizer = sanitizeText) {
    const source = Array.isArray(value) ? value : [value];
    return [...new Set(source.map((item) => normalizer(item)).filter(Boolean))];
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    const fallbackValue = Number(fallback);
    const next = Number.isFinite(parsed)
        ? parsed
        : (Number.isFinite(fallbackValue) ? fallbackValue : 0);
    return Math.max(min, Math.min(max, Math.round(next * 100) / 100));
}

function normalizeUserTagAutomationConfig(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const automation = source.automation && typeof source.automation === 'object' && !Array.isArray(source.automation)
        ? source.automation
        : source;
    const defaults = DEFAULT_USER_TAG_AUTOMATION;

    return {
        high_value: {
            enabled: normalizeBoolean(automation.high_value?.enabled, defaults.high_value.enabled),
            min_paid_amount: normalizeNumber(automation.high_value?.min_paid_amount ?? automation.high_value?.minPaidAmount, defaults.high_value.min_paid_amount, 0, 1000000),
            min_points: normalizeNumber(automation.high_value?.min_points ?? automation.high_value?.minPoints, defaults.high_value.min_points, 0, 100000000),
            min_order_count: normalizeNumber(automation.high_value?.min_order_count ?? automation.high_value?.minOrderCount, defaults.high_value.min_order_count, 0, 100000)
        },
        payment_failed: {
            enabled: normalizeBoolean(automation.payment_failed?.enabled, defaults.payment_failed.enabled),
            window_days: normalizeNumber(automation.payment_failed?.window_days ?? automation.payment_failed?.windowDays, defaults.payment_failed.window_days, 1, 365),
            min_count: normalizeNumber(automation.payment_failed?.min_count ?? automation.payment_failed?.minCount, defaults.payment_failed.min_count, 1, 1000)
        },
        verify_failed: {
            enabled: normalizeBoolean(automation.verify_failed?.enabled, defaults.verify_failed.enabled),
            window_days: normalizeNumber(automation.verify_failed?.window_days ?? automation.verify_failed?.windowDays, defaults.verify_failed.window_days, 1, 365),
            min_count: normalizeNumber(automation.verify_failed?.min_count ?? automation.verify_failed?.minCount, defaults.verify_failed.min_count, 1, 1000)
        },
        inactive: {
            enabled: normalizeBoolean(automation.inactive?.enabled, defaults.inactive.enabled),
            inactive_days: normalizeNumber(automation.inactive?.inactive_days ?? automation.inactive?.inactiveDays, defaults.inactive.inactive_days, 1, 3650)
        }
    };
}

async function loadUserTagAutomationConfig(supabase, options = {}) {
    if (options.automation || options.tagCenter || options.tag_center) {
        return normalizeUserTagAutomationConfig(options.automation || options.tagCenter || options.tag_center);
    }

    if (!supabase?.from) {
        return normalizeUserTagAutomationConfig();
    }

    try {
        let query = supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', TAG_CENTER_CONFIG_KEY);
        if (typeof query?.maybeSingle === 'function') {
            query = query.maybeSingle();
        } else if (typeof query?.limit === 'function') {
            query = query.limit(1);
        }
        const { data, error } = await query;
        if (error) {
            return normalizeUserTagAutomationConfig();
        }
        const configValue = Array.isArray(data) ? data[0]?.config_value : data?.config_value;
        return normalizeUserTagAutomationConfig(configValue || {});
    } catch (_) {
        return normalizeUserTagAutomationConfig();
    }
}

function isMissingUserTagsError(error) {
    const message = String(error?.message || error?.hint || '').toLowerCase();
    const code = String(error?.code || '').trim();
    return code === '42P01'
        || message.includes('user_tags')
        && (
            message.includes('does not exist')
            || message.includes('not exist')
            || message.includes('could not find')
            || message.includes('undefined table')
            || message.includes('schema cache')
            || message.includes('unexpected table access')
        );
}

function isMissingOptionalRelationError(error, relationName = '') {
    const message = String(error?.message || error?.hint || error?.details || '').toLowerCase();
    const code = String(error?.code || '').trim();
    const relation = sanitizeText(relationName, 120).toLowerCase();
    return code === '42P01'
        || code === '42703'
        || code === 'PGRST204'
        || code === 'PGRST205'
        || message.includes('schema cache')
        || (relation && message.includes(relation));
}

function buildUserTagRows({ userIds = [], tags = [], createdBy = null } = {}) {
    const normalizedUserIds = normalizeUniqueStrings(userIds, (value) => sanitizeText(value, 80));
    const normalizedTags = normalizeUniqueStrings(tags, normalizeTagValue);
    const createdByUserId = isUuid(createdBy) ? String(createdBy).trim() : null;
    const rows = [];

    for (const userId of normalizedUserIds) {
        for (const tag of normalizedTags) {
            const row = {
                user_id: userId,
                tag
            };
            if (createdByUserId) {
                row.created_by = createdByUserId;
            }
            rows.push(row);
        }
    }

    return rows;
}

async function fetchOptionalRows(runQuery) {
    try {
        const query = runQuery();
        if (!query || typeof query.then !== 'function') {
            return [];
        }
        const { data, error } = await query;
        if (error) {
            return [];
        }
        return Array.isArray(data) ? data : [];
    } catch (_) {
        return [];
    }
}

function withOptionalLimit(query, limit = 1000) {
    return typeof query?.limit === 'function' ? query.limit(limit) : query;
}

function getSinceIso(days = 7) {
    const normalizedDays = normalizeNumber(days, 7, 1, 3650);
    return new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000).toISOString();
}

async function getUserCommerceMetrics(supabase, userId) {
    const normalizedUserId = sanitizeText(userId, 80);
    if (!supabase?.from || !normalizedUserId) {
        return {
            paidAmount: 0,
            points: 0,
            orderCount: 0
        };
    }

    const paymentRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('payment_orders')
            .select('id, paid_amount, expected_amount, points_amount, status')
            .eq('user_id', normalizedUserId)
            .in('status', ['paid', 'redeemed']),
        1000
    ));
    const shopRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('shop_orders')
            .select('id, total_price, price_paid')
            .eq('user_id', normalizedUserId),
        1000
    ));

    const paymentPaidAmount = paymentRows.reduce((sum, row) => (
        sum + Math.max(0, Number(row?.paid_amount ?? row?.expected_amount ?? 0) || 0)
    ), 0);
    const paymentPoints = paymentRows.reduce((sum, row) => (
        sum + Math.max(0, Number(row?.points_amount ?? 0) || 0)
    ), 0);
    const shopPaidAmount = shopRows.reduce((sum, row) => (
        sum + Math.max(0, Number(row?.total_price ?? row?.price_paid ?? 0) || 0)
    ), 0);

    return {
        paidAmount: Math.round((paymentPaidAmount + shopPaidAmount) * 100) / 100,
        points: Math.round(paymentPoints * 100) / 100,
        orderCount: paymentRows.length + shopRows.length
    };
}

function getLatestIsoDate(...values) {
    const latest = values
        .flat()
        .map((value) => new Date(value || ''))
        .filter((date) => Number.isFinite(date.getTime()))
        .sort((left, right) => right.getTime() - left.getTime())[0];
    return latest ? latest.toISOString() : '';
}

function getInactiveCutoffIso(config = {}) {
    const inactiveDays = normalizeNumber(config.inactive_days, DEFAULT_USER_TAG_AUTOMATION.inactive.inactive_days, 1, 3650);
    return new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000).toISOString();
}

async function getUserLastActivityAt(supabase, userId) {
    const normalizedUserId = sanitizeText(userId, 80);
    if (!supabase?.from || !normalizedUserId) return '';

    const activityRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('engagement_user_activity')
            .select('last_active_at')
            .eq('user_id', normalizedUserId),
        1
    ));
    const loginRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('user_login_history')
            .select('created_at')
            .eq('user_id', normalizedUserId),
        1000
    ));
    const engagementRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('engagement_events')
            .select('created_at')
            .eq('user_id', normalizedUserId),
        1000
    ));

    return getLatestIsoDate(
        activityRows.map((row) => row?.last_active_at),
        loginRows.map((row) => row?.created_at),
        engagementRows.map((row) => row?.created_at)
    );
}

async function recordUserActivity(supabase, options = {}) {
    const userId = sanitizeText(options.userId || options.user_id, 80);
    if (!supabase?.from || !userId) {
        return {
            ok: false,
            skipped: !supabase?.from ? 'supabase_unavailable' : 'missing_user'
        };
    }

    try {
        const payload = {
            user_id: userId,
            last_active_at: sanitizeText(options.lastActiveAt || options.last_active_at, 120) || new Date().toISOString(),
            last_page_id: sanitizeText(options.pageId || options.page_id || 'home', 80),
            site: sanitizeText(options.site || 'cn', 20),
            source_module: sanitizeText(options.sourceModule || options.source_module || 'engagement.feed', 80)
        };
        const { error } = await supabase
            .from('engagement_user_activity')
            .upsert(payload, { onConflict: 'user_id' });
        if (error) throw error;
        return {
            ok: true,
            user_id: userId,
            last_active_at: payload.last_active_at
        };
    } catch (error) {
        if (isMissingOptionalRelationError(error, 'engagement_user_activity')) {
            return {
                ok: false,
                skipped: 'missing_engagement_user_activity'
            };
        }
        throw error;
    }
}

function userMeetsHighValueThreshold(metrics = {}, config = {}) {
    const paidAmountThreshold = Number(config.min_paid_amount || 0);
    const pointsThreshold = Number(config.min_points || 0);
    const orderCountThreshold = Number(config.min_order_count || 0);
    return (paidAmountThreshold > 0 && Number(metrics.paidAmount || 0) >= paidAmountThreshold)
        || (pointsThreshold > 0 && Number(metrics.points || 0) >= pointsThreshold)
        || (orderCountThreshold > 0 && Number(metrics.orderCount || 0) >= orderCountThreshold);
}

async function maybeMarkHighValueUser(supabase, options = {}) {
    const userId = sanitizeText(options.userId || options.user_id, 80);
    if (!userId) {
        return {
            ok: false,
            skipped: 'missing_user'
        };
    }

    const automation = await loadUserTagAutomationConfig(supabase, options);
    if (automation.high_value.enabled !== true) {
        return {
            ok: false,
            skipped: 'high_value_disabled'
        };
    }

    const metrics = await getUserCommerceMetrics(supabase, userId);
    if (!userMeetsHighValueThreshold(metrics, automation.high_value)) {
        return {
            ok: false,
            skipped: 'high_value_threshold_not_met',
            metrics
        };
    }

    return upsertUserTags(supabase, {
        ...options,
        userId,
        tags: AUTO_USER_TAGS.HIGH_VALUE
    });
}

async function countRecentPaymentFailures(supabase, userId, config = {}) {
    const normalizedUserId = sanitizeText(userId, 80);
    if (!supabase?.from || !normalizedUserId) return 0;
    const sinceIso = getSinceIso(config.window_days);
    const statuses = ['failed', 'cancelled', 'canceled', 'expired', 'rejected'];
    const paymentRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('payment_orders')
            .select('id, status, created_at')
            .eq('user_id', normalizedUserId)
            .in('status', statuses)
            .gte('created_at', sinceIso),
        1000
    ));
    const checkoutRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('payment_checkout_sessions')
            .select('id, status, created_at')
            .eq('user_id', normalizedUserId)
            .in('status', statuses)
            .gte('created_at', sinceIso),
        1000
    ));
    return paymentRows.length + checkoutRows.length;
}

async function countRecentVerifyFailures(supabase, userId, config = {}) {
    const normalizedUserId = sanitizeText(userId, 80);
    if (!supabase?.from || !normalizedUserId) return 0;
    const sinceIso = getSinceIso(config.window_days);
    const rows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('verification_logs')
            .select('id, status, created_at')
            .eq('user_id', normalizedUserId)
            .eq('status', 'failed')
            .gte('created_at', sinceIso),
        1000
    ));
    return rows.length;
}

async function upsertUserTags(supabase, options = {}) {
    const userIds = normalizeUniqueStrings(
        options.userIds || options.user_ids || options.userId || options.user_id,
        (value) => sanitizeText(value, 80)
    );
    const tags = normalizeUniqueStrings(options.tags || options.tag, normalizeTagValue);
    const rows = buildUserTagRows({
        userIds,
        tags,
        createdBy: options.createdBy || options.created_by
    });

    if (!supabase?.from || !rows.length) {
        return {
            ok: false,
            skipped: rows.length ? 'supabase_unavailable' : 'empty_payload',
            inserted: 0,
            tags
        };
    }

    try {
        const table = supabase.from('user_tags');
        if (typeof table?.upsert !== 'function') {
            return {
                ok: false,
                skipped: 'user_tags_upsert_unavailable',
                inserted: 0,
                tags
            };
        }

        const { error } = await table.upsert(rows, { onConflict: 'user_id,tag' });

        if (error) {
            if (isMissingUserTagsError(error)) {
                return {
                    ok: false,
                    skipped: 'missing_user_tags',
                    inserted: 0,
                    tags
                };
            }
            throw error;
        }

        return {
            ok: true,
            inserted: rows.length,
            tags
        };
    } catch (error) {
        if (isMissingUserTagsError(error)) {
            return {
                ok: false,
                skipped: 'missing_user_tags',
                inserted: 0,
                tags
            };
        }
        throw error;
    }
}

async function removeUserTags(supabase, options = {}) {
    const userId = sanitizeText(options.userId || options.user_id, 80);
    const tags = normalizeUniqueStrings(options.tags || options.tag, normalizeTagValue);

    if (!supabase?.from || !userId || !tags.length) {
        return {
            ok: false,
            skipped: !supabase?.from ? 'supabase_unavailable' : 'empty_payload',
            removed: 0,
            tags
        };
    }

    try {
        const table = supabase.from('user_tags');
        if (typeof table?.delete !== 'function') {
            return {
                ok: false,
                skipped: 'user_tags_delete_unavailable',
                removed: 0,
                tags
            };
        }

        const { error } = await table
            .delete()
            .eq('user_id', userId)
            .in('tag', tags);

        if (error) {
            if (isMissingUserTagsError(error)) {
                return {
                    ok: false,
                    skipped: 'missing_user_tags',
                    removed: 0,
                    tags
                };
            }
            throw error;
        }

        return {
            ok: true,
            removed: tags.length,
            tags
        };
    } catch (error) {
        if (isMissingUserTagsError(error)) {
            return {
                ok: false,
                skipped: 'missing_user_tags',
                removed: 0,
                tags
            };
        }
        throw error;
    }
}

async function markUserAsPaid(supabase, options = {}) {
    const result = await upsertUserTags(supabase, {
        ...options,
        tags: AUTO_USER_TAGS.PAID_USER
    });

    const userId = sanitizeText(options.userId || options.user_id, 80);
    if (result.ok && userId) {
        await removeUserTags(supabase, {
            userId,
            tags: AUTO_USER_TAGS.PAYMENT_FAILED
        });
    }

    if (result.ok && userId) {
        await maybeMarkHighValueUser(supabase, options);
    }

    return result;
}

async function markUsersAsPaid(supabase, options = {}) {
    const userIds = normalizeUniqueStrings(options.userIds || options.user_ids, (value) => sanitizeText(value, 80));
    const result = await upsertUserTags(supabase, {
        ...options,
        userIds,
        tags: AUTO_USER_TAGS.PAID_USER
    });

    if (result.ok) {
        await Promise.all(userIds.map((userId) => removeUserTags(supabase, {
            userId,
            tags: AUTO_USER_TAGS.PAYMENT_FAILED
        })));
        await Promise.all(userIds.map((userId) => maybeMarkHighValueUser(supabase, {
            ...options,
            userId
        })));
    }

    return result;
}

async function markUserActive(supabase, options = {}) {
    const userId = sanitizeText(options.userId || options.user_id, 80);
    const activityResult = await recordUserActivity(supabase, {
        ...options,
        userId
    });

    if (userId) {
        await removeUserTags(supabase, {
            userId,
            tags: AUTO_USER_TAGS.INACTIVE_USER
        });
    }

    return activityResult;
}

async function syncInactiveUserTagForUser(supabase, options = {}) {
    const userId = sanitizeText(options.userId || options.user_id, 80);
    if (!userId) {
        return {
            ok: false,
            skipped: 'missing_user'
        };
    }

    const automation = await loadUserTagAutomationConfig(supabase, options);
    if (automation.inactive.enabled !== true) {
        return {
            ok: false,
            skipped: 'inactive_disabled'
        };
    }

    const lastActiveAt = sanitizeText(options.lastActiveAt || options.last_active_at, 120)
        || await getUserLastActivityAt(supabase, userId);
    if (!lastActiveAt) {
        return {
            ok: false,
            skipped: 'inactive_no_activity'
        };
    }

    const cutoffIso = getInactiveCutoffIso(automation.inactive);
    if (new Date(lastActiveAt).getTime() > new Date(cutoffIso).getTime()) {
        await removeUserTags(supabase, {
            userId,
            tags: AUTO_USER_TAGS.INACTIVE_USER
        });
        return {
            ok: false,
            skipped: 'inactive_threshold_not_met',
            last_active_at: lastActiveAt,
            cutoff_at: cutoffIso
        };
    }

    const result = await upsertUserTags(supabase, {
        ...options,
        userId,
        tags: AUTO_USER_TAGS.INACTIVE_USER
    });
    return {
        ...result,
        last_active_at: lastActiveAt,
        cutoff_at: cutoffIso
    };
}

async function sweepInactiveUserTags(supabase, options = {}) {
    const automation = await loadUserTagAutomationConfig(supabase, options);
    if (automation.inactive.enabled !== true) {
        return {
            ok: false,
            skipped: 'inactive_disabled',
            tagged: 0
        };
    }

    const cutoffIso = getInactiveCutoffIso(automation.inactive);
    const limit = normalizeNumber(options.limit, 500, 1, 5000);
    const staleRows = await fetchOptionalRows(() => withOptionalLimit(
        supabase
            .from('engagement_user_activity')
            .select('user_id,last_active_at')
            .lte('last_active_at', cutoffIso),
        limit
    ));
    const userIds = normalizeUniqueStrings(
        staleRows.map((row) => row?.user_id),
        (value) => sanitizeText(value, 80)
    );

    if (!userIds.length) {
        return {
            ok: true,
            tagged: 0,
            cutoff_at: cutoffIso
        };
    }

    const result = await upsertUserTags(supabase, {
        ...options,
        userIds,
        tags: AUTO_USER_TAGS.INACTIVE_USER
    });
    return {
        ...result,
        tagged: result.ok ? userIds.length : 0,
        user_ids: userIds,
        cutoff_at: cutoffIso
    };
}

function shouldTagPaymentFailure(status = '') {
    return ['failed', 'cancelled', 'canceled', 'expired', 'rejected'].includes(
        sanitizeText(status, 40).toLowerCase()
    );
}

async function markPaymentFailed(supabase, options = {}) {
    const userId = sanitizeText(options.userId || options.user_id, 80);
    const automation = await loadUserTagAutomationConfig(supabase, options);
    if (automation.payment_failed.enabled !== true) {
        return {
            ok: false,
            skipped: 'payment_failed_disabled'
        };
    }

    const recentCount = Math.max(
        1,
        Number(options.observedCount || options.observed_count || 0) || 0,
        await countRecentPaymentFailures(supabase, userId, automation.payment_failed)
    );
    if (recentCount < Number(automation.payment_failed.min_count || 1)) {
        return {
            ok: false,
            skipped: 'payment_failed_threshold_not_met',
            recent_count: recentCount
        };
    }

    return upsertUserTags(supabase, {
        ...options,
        tags: AUTO_USER_TAGS.PAYMENT_FAILED
    });
}

async function markVerifyFailed(supabase, options = {}) {
    const userId = sanitizeText(options.userId || options.user_id, 80);
    const automation = await loadUserTagAutomationConfig(supabase, options);
    if (automation.verify_failed.enabled !== true) {
        return {
            ok: false,
            skipped: 'verify_failed_disabled'
        };
    }

    const recentCount = Math.max(
        1,
        Number(options.observedCount || options.observed_count || 0) || 0,
        await countRecentVerifyFailures(supabase, userId, automation.verify_failed)
    );
    if (recentCount < Number(automation.verify_failed.min_count || 1)) {
        return {
            ok: false,
            skipped: 'verify_failed_threshold_not_met',
            recent_count: recentCount
        };
    }

    return upsertUserTags(supabase, {
        ...options,
        tags: AUTO_USER_TAGS.VERIFY_FAILED
    });
}

async function syncPaymentStatusUserTags(supabase, options = {}) {
    const status = sanitizeText(options.status, 40).toLowerCase();
    const userId = sanitizeText(options.userId || options.user_id, 80);
    if (!userId) {
        return {
            ok: false,
            skipped: 'missing_user'
        };
    }

    if (status === 'completed' || status === 'paid' || status === 'redeemed') {
        return markUserAsPaid(supabase, options);
    }

    if (shouldTagPaymentFailure(status)) {
        return markPaymentFailed(supabase, options);
    }

    return {
        ok: false,
        skipped: 'non_terminal_status',
        status
    };
}

module.exports = {
    AUTO_USER_TAGS,
    DEFAULT_USER_TAG_AUTOMATION,
    buildUserTagRows,
    countRecentPaymentFailures,
    countRecentVerifyFailures,
    getInactiveCutoffIso,
    getUserCommerceMetrics,
    getUserLastActivityAt,
    isMissingUserTagsError,
    loadUserTagAutomationConfig,
    markPaymentFailed,
    markUserActive,
    markUserAsPaid,
    markUsersAsPaid,
    markVerifyFailed,
    maybeMarkHighValueUser,
    normalizeTagValue,
    normalizeUserTagAutomationConfig,
    recordUserActivity,
    removeUserTags,
    shouldTagPaymentFailure,
    sweepInactiveUserTags,
    syncInactiveUserTagForUser,
    syncPaymentStatusUserTags,
    userMeetsHighValueThreshold,
    upsertUserTags
};
