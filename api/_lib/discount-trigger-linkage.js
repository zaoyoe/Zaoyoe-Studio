const {
    normalizeSiteValue
} = require('./site');
const {
    buildDiscountLifecycleSummary
} = require('../../server/api-handlers/admin/discounts/_shared');
const {
    resolveSiteScopedSystemConfigValue
} = require('../../server/api-handlers/_site-scoped-system-config');

const DISCOUNT_TRIGGER_CONFIG_KEY = 'discount_trigger_rules';
const SUCCESSFUL_RECHARGE_STATUSES = Object.freeze(['redeemed', 'refunded']);
const ACTIVE_DISCOUNT_LIFECYCLE_KEYS = new Set(['active', 'scheduled']);
const AFFILIATE_REWARD_TYPES = new Set(['any', 'commission', 'registration_reward', 'activation_reward']);

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized) return fallback;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback = 0) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRuleSite(value) {
    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized || normalized === 'all' || normalized === 'global') {
        return 'all';
    }
    return normalizeSiteValue(normalized, { fallback: 'all' });
}

function normalizeRuleKey(value, fallbackPrefix = 'rule', index = 0) {
    return normalizeText(value, 120) || `${fallbackPrefix}_rule_${index + 1}`;
}

function normalizeRechargeRule(rule = {}, index = 0) {
    const source = rule && typeof rule === 'object' && !Array.isArray(rule) ? rule : {};
    const discountId = normalizeText(source.discount_id || source.discountId, 160);
    if (!discountId) {
        return null;
    }

    return {
        rule_key: normalizeRuleKey(source.rule_key || source.ruleKey, 'recharge', index),
        discount_id: discountId,
        enabled: normalizeBoolean(source.enabled, true),
        site: normalizeRuleSite(source.site || source.applicable_site),
        min_paid_points: Math.max(0, normalizeNumber(source.min_paid_points || source.minPaidPoints, 0)),
        min_total_points: Math.max(0, normalizeNumber(source.min_total_points || source.minTotalPoints, 0)),
        min_paid_amount: Math.max(0, normalizeNumber(source.min_paid_amount || source.minPaidAmount, 0)),
        first_recharge_only: normalizeBoolean(source.first_recharge_only || source.firstRechargeOnly, false),
        allow_duplicate_available_asset: normalizeBoolean(
            source.allow_duplicate_available_asset || source.allowDuplicateAvailableAsset,
            false
        ),
        max_grants_per_user: Math.max(0, normalizePositiveInteger(
            source.max_grants_per_user || source.maxGrantsPerUser,
            1
        )),
        source_channel: normalizeText(source.source_channel || source.sourceChannel, 80).toLowerCase() || 'wallet_recharge',
        audience_segment: normalizeText(source.audience_segment || source.audienceSegment, 80).toLowerCase()
            || (normalizeBoolean(source.first_recharge_only || source.firstRechargeOnly, false) ? 'first_recharge' : 'recharge_user'),
        campaign_tag: normalizeText(source.campaign_tag || source.campaignTag, 80).toLowerCase() || 'recharge_boost'
    };
}

function normalizeCheckinRule(rule = {}, index = 0) {
    const source = rule && typeof rule === 'object' && !Array.isArray(rule) ? rule : {};
    const discountId = normalizeText(source.discount_id || source.discountId, 160);
    if (!discountId) {
        return null;
    }

    const minStreakDays = Math.max(0, normalizePositiveInteger(source.min_streak_days || source.minStreakDays, 0));
    return {
        rule_key: normalizeRuleKey(source.rule_key || source.ruleKey, 'checkin', index),
        discount_id: discountId,
        enabled: normalizeBoolean(source.enabled, true),
        site: normalizeRuleSite(source.site || source.applicable_site),
        min_points_reward: Math.max(0, normalizeNumber(source.min_points_reward || source.minPointsReward, 0)),
        min_streak_days: minStreakDays,
        min_bonus_reward: Math.max(0, normalizeNumber(source.min_bonus_reward || source.minBonusReward, 0)),
        allow_duplicate_available_asset: normalizeBoolean(
            source.allow_duplicate_available_asset || source.allowDuplicateAvailableAsset,
            false
        ),
        max_grants_per_user: Math.max(0, normalizePositiveInteger(
            source.max_grants_per_user || source.maxGrantsPerUser,
            1
        )),
        source_channel: normalizeText(source.source_channel || source.sourceChannel, 80).toLowerCase() || 'checkin_reward',
        audience_segment: normalizeText(source.audience_segment || source.audienceSegment, 80).toLowerCase()
            || (minStreakDays >= 7 ? 'high_streak_user' : 'checkin_user'),
        campaign_tag: normalizeText(source.campaign_tag || source.campaignTag, 80).toLowerCase() || 'checkin_boost'
    };
}

function normalizeAffiliateRewardType(value, fallback = 'any') {
    const normalized = normalizeText(value, 60).toLowerCase();
    return AFFILIATE_REWARD_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeAffiliateRule(rule = {}, index = 0) {
    const source = rule && typeof rule === 'object' && !Array.isArray(rule) ? rule : {};
    const discountId = normalizeText(source.discount_id || source.discountId, 160);
    if (!discountId) {
        return null;
    }

    const rewardType = normalizeAffiliateRewardType(source.reward_type || source.rewardType, 'any');
    return {
        rule_key: normalizeRuleKey(source.rule_key || source.ruleKey, 'affiliate', index),
        discount_id: discountId,
        enabled: normalizeBoolean(source.enabled, true),
        site: normalizeRuleSite(source.site || source.applicable_site),
        reward_type: rewardType,
        min_reward_points: Math.max(0, normalizeNumber(source.min_reward_points || source.minRewardPoints, 0)),
        allow_duplicate_available_asset: normalizeBoolean(
            source.allow_duplicate_available_asset || source.allowDuplicateAvailableAsset,
            false
        ),
        max_grants_per_user: Math.max(0, normalizePositiveInteger(
            source.max_grants_per_user || source.maxGrantsPerUser,
            1
        )),
        source_channel: normalizeText(source.source_channel || source.sourceChannel, 80).toLowerCase()
            || (rewardType === 'commission' ? 'affiliate_commission' : 'affiliate_reward'),
        audience_segment: normalizeText(source.audience_segment || source.audienceSegment, 80).toLowerCase()
            || (rewardType === 'commission' ? 'affiliate_commission_inviter' : 'affiliate_inviter'),
        campaign_tag: normalizeText(source.campaign_tag || source.campaignTag, 80).toLowerCase() || 'affiliate_boost'
    };
}

function normalizeTriggerConfig(configValue = {}) {
    const config = configValue && typeof configValue === 'object' && !Array.isArray(configValue)
        ? configValue
        : {};
    const rechargeConfig = config.recharge && typeof config.recharge === 'object' && !Array.isArray(config.recharge)
        ? config.recharge
        : {};
    const checkinConfig = config.checkin && typeof config.checkin === 'object' && !Array.isArray(config.checkin)
        ? config.checkin
        : {};
    const affiliateConfig = config.affiliate && typeof config.affiliate === 'object' && !Array.isArray(config.affiliate)
        ? config.affiliate
        : {};
    const rawRechargeRules = Array.isArray(rechargeConfig.rules)
        ? rechargeConfig.rules
        : (Array.isArray(config.recharge_rules) ? config.recharge_rules : []);
    const rawCheckinRules = Array.isArray(checkinConfig.rules)
        ? checkinConfig.rules
        : (Array.isArray(config.checkin_rules) ? config.checkin_rules : []);
    const rawAffiliateRules = Array.isArray(affiliateConfig.rules)
        ? affiliateConfig.rules
        : (Array.isArray(config.affiliate_rules) ? config.affiliate_rules : []);

    return {
        recharge: {
            enabled: normalizeBoolean(rechargeConfig.enabled, rawRechargeRules.length > 0),
            rules: rawRechargeRules
                .map((rule, index) => normalizeRechargeRule(rule, index))
                .filter(Boolean)
        },
        checkin: {
            enabled: normalizeBoolean(checkinConfig.enabled, rawCheckinRules.length > 0),
            rules: rawCheckinRules
                .map((rule, index) => normalizeCheckinRule(rule, index))
                .filter(Boolean)
        },
        affiliate: {
            enabled: normalizeBoolean(affiliateConfig.enabled, rawAffiliateRules.length > 0),
            rules: rawAffiliateRules
                .map((rule, index) => normalizeAffiliateRule(rule, index))
                .filter(Boolean)
        }
    };
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

function matchesRuleSite(ruleSite = 'all', site = 'cn') {
    return ruleSite === 'all' || ruleSite === normalizeSiteValue(site || 'cn');
}

async function loadTriggerConfig(supabase, site = 'cn') {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .eq('config_key', DISCOUNT_TRIGGER_CONFIG_KEY)
        .maybeSingle();

    if (error) throw error;
    return normalizeTriggerConfig(resolveSiteScopedSystemConfigValue(data?.config_value || {}, site));
}

async function loadPreviousSuccessfulRechargeCount(supabase, { userId = '', site = 'cn', excludePaymentOrderId = '' } = {}) {
    try {
        const { data, error } = await supabase
            .from('payment_orders')
            .select('id, status')
            .eq('user_id', userId)
            .eq('site', normalizeSiteValue(site || 'cn'))
            .in('status', SUCCESSFUL_RECHARGE_STATUSES);

        if (error) throw error;

        return (Array.isArray(data) ? data : [])
            .filter((row) => normalizeText(row?.id, 160) !== normalizeText(excludePaymentOrderId, 160))
            .length;
    } catch (error) {
        if (isMissingRelationError(error, 'payment_orders')) {
            return 0;
        }
        throw error;
    }
}

async function loadDiscountRowsByIds(supabase, discountIds = []) {
    const ids = [...new Set((Array.isArray(discountIds) ? discountIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!ids.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('discount_codes')
        .select('id, code, applicable_site, distribution_mode, expires_at, is_active, starts_at, lifecycle_status, status_reason, max_uses, used_count')
        .in('id', ids);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function loadUserAssetCountsByDiscount(supabase, userId = '', discountIds = []) {
    const ids = [...new Set((Array.isArray(discountIds) ? discountIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    const counts = new Map();
    if (!ids.length) {
        return counts;
    }

    try {
        const { data, error } = await supabase
            .from('discount_user_assets')
            .select('discount_id, asset_status')
            .eq('user_id', userId)
            .in('discount_id', ids);

        if (error) throw error;

        for (const row of data || []) {
            const discountId = normalizeText(row?.discount_id, 160);
            if (!discountId) continue;
            if (!counts.has(discountId)) {
                counts.set(discountId, {
                    total: 0,
                    available: 0
                });
            }
            const entry = counts.get(discountId);
            entry.total += 1;
            if (normalizeText(row?.asset_status, 40).toLowerCase() === 'available') {
                entry.available += 1;
            }
        }

        return counts;
    } catch (error) {
        if (isMissingRelationError(error, 'discount_user_assets')) {
            return counts;
        }
        throw error;
    }
}

async function loadExistingSourceBatchAssignments(
    supabase,
    {
        userId = '',
        sourceType = '',
        sourceBatchId = '',
        discountIds = []
    } = {}
) {
    const ids = [...new Set((Array.isArray(discountIds) ? discountIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    const matchedDiscountIds = new Set();
    const normalizedSourceType = normalizeText(sourceType, 80);
    const normalizedSourceBatchId = normalizeText(sourceBatchId, 120);
    if (!ids.length || !normalizedSourceType || !normalizedSourceBatchId) {
        return matchedDiscountIds;
    }

    try {
        const { data, error } = await supabase
            .from('discount_user_assets')
            .select('discount_id')
            .eq('user_id', userId)
            .eq('source_type', normalizedSourceType)
            .eq('source_batch_id', normalizedSourceBatchId)
            .in('discount_id', ids);

        if (error) throw error;

        for (const row of data || []) {
            const discountId = normalizeText(row?.discount_id, 160);
            if (discountId) {
                matchedDiscountIds.add(discountId);
            }
        }

        return matchedDiscountIds;
    } catch (error) {
        if (isMissingRelationError(error, 'discount_user_assets')) {
            return matchedDiscountIds;
        }
        throw error;
    }
}

async function loadPointsLedgerRowsByReferenceIds(supabase, referenceIds = [], site = '') {
    const ids = [...new Set((Array.isArray(referenceIds) ? referenceIds : []).map((value) => normalizeText(value, 180)).filter(Boolean))];
    if (!ids.length) {
        return [];
    }

    try {
        let query = supabase
            .from('points_ledger')
            .select('id, user_id, amount, reason, reference_id, site, created_at')
            .in('reference_id', ids);

        const normalizedSite = normalizeText(site, 20);
        if (normalizedSite) {
            query = query.eq('site', normalizeSiteValue(normalizedSite));
        }

        const { data, error } = await query;
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingRelationError(error, 'points_ledger')) {
            return [];
        }
        throw error;
    }
}

async function loadPointsLedgerRowByReferenceId(supabase, referenceId = '', site = '') {
    const rows = await loadPointsLedgerRowsByReferenceIds(supabase, [referenceId], site);
    return rows[0] || null;
}

function buildDefaultResult(context = {}) {
    return {
        success: true,
        config_key: DISCOUNT_TRIGGER_CONFIG_KEY,
        event_type: normalizeText(context.eventType || 'recharge', 40).toLowerCase() || 'recharge',
        site: normalizeSiteValue(context.site || 'cn'),
        user_id: normalizeText(context.userId, 160) || null,
        is_first_recharge: false,
        matched_rule_count: 0,
        issued_count: 0,
        assigned_discount_ids: [],
        skipped: [],
        error_message: ''
    };
}

function ruleMatchesRechargeContext(rule = {}, context = {}) {
    if (!rule?.enabled) return false;
    if (!matchesRuleSite(rule.site, context.site)) return false;
    if (normalizeNumber(context.paidPoints, 0) < normalizeNumber(rule.min_paid_points, 0)) return false;
    if (normalizeNumber(context.totalPoints, 0) < normalizeNumber(rule.min_total_points, 0)) return false;
    if (normalizeNumber(context.paidAmount, 0) < normalizeNumber(rule.min_paid_amount, 0)) return false;
    if (rule.first_recharge_only && !context.isFirstRecharge) return false;
    return true;
}

function ruleMatchesCheckinContext(rule = {}, context = {}) {
    if (!rule?.enabled) return false;
    if (!matchesRuleSite(rule.site, context.site)) return false;
    if (normalizeNumber(context.pointsReward, 0) < normalizeNumber(rule.min_points_reward, 0)) return false;
    if (normalizeNumber(context.streakDays, 0) < normalizeNumber(rule.min_streak_days, 0)) return false;
    if (normalizeNumber(context.bonusReward, 0) < normalizeNumber(rule.min_bonus_reward, 0)) return false;
    return true;
}

function normalizeAffiliateRewardTypeFromLedgerRow(row = {}) {
    const reference = normalizeText(row?.reference_id, 180).toUpperCase();
    const reason = normalizeText(row?.reason, 180);
    if (reference.startsWith('AFFILIATE_REWARD_') || reference.startsWith('AFF_REW_') || reason.startsWith('推广返佣')) {
        return 'commission';
    }
    if (reference.startsWith('REG_REWARD_UNLOCK_') || reason.includes('首充激活') || reason.includes('首单激活')) {
        return 'activation_reward';
    }
    if (reference.startsWith('REG_REWARD_') || reason.startsWith('邀请拉新奖励')) {
        return 'registration_reward';
    }
    return 'any';
}

function getDuplicateEventGrantReason(eventType = '') {
    const normalized = normalizeText(eventType, 40).toLowerCase();
    if (normalized === 'checkin') return '当前签到已发放过卡券';
    if (normalized === 'affiliate') return '当前推广奖励已发放过卡券';
    return '当前充值已发放过卡券';
}

function ruleMatchesAffiliateContext(rule = {}, context = {}) {
    if (!rule?.enabled) return false;
    if (!matchesRuleSite(rule.site, context.site)) return false;
    if (normalizeNumber(context.rewardPoints, 0) < normalizeNumber(rule.min_reward_points, 0)) return false;
    const ruleRewardType = normalizeAffiliateRewardType(rule.reward_type, 'any');
    const contextRewardType = normalizeAffiliateRewardType(context.rewardType, 'any');
    if (ruleRewardType !== 'any' && ruleRewardType !== contextRewardType) return false;
    return true;
}

async function issueMatchedRulesForUser({
    supabase,
    targetUserId = '',
    site = 'cn',
    eventType = 'recharge',
    sourceType = '',
    sourceBatchId = '',
    sourceOrderId = null,
    selectedRules = [],
    result = null
} = {}) {
    const normalizedTargetUserId = normalizeText(targetUserId, 160);
    const normalizedSourceType = normalizeText(sourceType, 80);
    const normalizedSourceBatchId = normalizeText(sourceBatchId, 120);
    const normalizedSite = normalizeSiteValue(site || 'cn');
    const normalizedOrderId = normalizeText(sourceOrderId, 160) || null;
    const output = result || buildDefaultResult({
        eventType,
        site: normalizedSite,
        userId: normalizedTargetUserId
    });

    output.user_id = normalizedTargetUserId || output.user_id;
    output.event_type = normalizeText(eventType, 40).toLowerCase() || output.event_type;
    output.site = normalizedSite;
    output.matched_rule_count += selectedRules.length;

    if (!supabase?.from || !normalizedTargetUserId || !normalizedSourceType || !normalizedSourceBatchId || !selectedRules.length) {
        return output;
    }

    const discountRows = await loadDiscountRowsByIds(supabase, selectedRules.map((rule) => rule.discount_id));
    const discountMap = new Map(discountRows.map((row) => [normalizeText(row?.id, 160), row]));
    const now = new Date();
    const nowIso = now.toISOString();
    const existingCounts = await loadUserAssetCountsByDiscount(supabase, normalizedTargetUserId, selectedRules.map((rule) => rule.discount_id));
    const existingSourceBatchAssignments = await loadExistingSourceBatchAssignments(supabase, {
        userId: normalizedTargetUserId,
        sourceType: normalizedSourceType,
        sourceBatchId: normalizedSourceBatchId,
        discountIds: selectedRules.map((rule) => rule.discount_id)
    });
    const insertPayload = [];

    for (const rule of selectedRules) {
        const discount = discountMap.get(rule.discount_id);
        if (!discount) {
            output.skipped.push({
                discount_id: rule.discount_id,
                reason: '优惠券不存在'
            });
            continue;
        }

        if (!matchesRuleSite(normalizeRuleSite(discount?.applicable_site), normalizedSite)) {
            output.skipped.push({
                discount_id: rule.discount_id,
                reason: '当前站点不可发放'
            });
            continue;
        }

        if (normalizeText(discount?.distribution_mode, 40).toLowerCase() !== 'user_assigned') {
            output.skipped.push({
                discount_id: rule.discount_id,
                reason: '仅支持到账型卡券'
            });
            continue;
        }

        if (existingSourceBatchAssignments.has(rule.discount_id)) {
            output.skipped.push({
                discount_id: rule.discount_id,
                reason: getDuplicateEventGrantReason(eventType)
            });
            continue;
        }

        const lifecycle = buildDiscountLifecycleSummary(discount, { now });
        if (!ACTIVE_DISCOUNT_LIFECYCLE_KEYS.has(lifecycle.key)) {
            output.skipped.push({
                discount_id: rule.discount_id,
                reason: `优惠券当前状态不可发放: ${lifecycle.label || lifecycle.key}`
            });
            continue;
        }

        const assetCounts = existingCounts.get(rule.discount_id) || { total: 0, available: 0 };
        if (!rule.allow_duplicate_available_asset && assetCounts.available > 0) {
            output.skipped.push({
                discount_id: rule.discount_id,
                reason: '用户已有可用卡券'
            });
            continue;
        }

        if (rule.max_grants_per_user > 0 && assetCounts.total >= rule.max_grants_per_user) {
            output.skipped.push({
                discount_id: rule.discount_id,
                reason: '已达到单用户发券上限'
            });
            continue;
        }

        insertPayload.push({
            discount_id: discount.id,
            user_id: normalizedTargetUserId,
            asset_status: 'available',
            assigned_at: nowIso,
            claimed_at: nowIso,
            expires_at: normalizeText(discount?.expires_at, 80) || null,
            source_type: normalizedSourceType,
            source_channel: rule.source_channel,
            audience_segment: rule.audience_segment,
            source_batch_id: normalizedSourceBatchId,
            created_by: null,
            restored_at: null,
            consumed_at: null,
            last_order_id: normalizedOrderId
        });
    }

    if (!insertPayload.length) {
        return output;
    }

    const { data, error } = await supabase
        .from('discount_user_assets')
        .insert(insertPayload)
        .select('id, discount_id');

    if (error) throw error;

    const insertedRows = Array.isArray(data) ? data : [];
    output.issued_count += insertedRows.length;
    output.assigned_discount_ids = [
        ...output.assigned_discount_ids,
        ...insertedRows
            .map((row) => normalizeText(row?.discount_id, 160))
            .filter(Boolean)
    ];
    return output;
}

async function maybeIssueRechargeDiscountAssets(context = {}) {
    const {
        supabase,
        userId = '',
        site = 'cn',
        paidPoints = 0,
        bonusPoints = 0,
        paidAmount = 0,
        paymentOrderId = '',
        paymentProvider = '',
        paymentOrderNo = ''
    } = context;

    const result = buildDefaultResult({ eventType: 'recharge', userId, site });
    const normalizedUserId = normalizeText(userId, 160);
    if (!supabase?.from || !normalizedUserId) {
        return result;
    }

    try {
        const config = await loadTriggerConfig(supabase, site);
        const rechargeRules = config.recharge?.enabled ? config.recharge.rules : [];
        if (!rechargeRules.length) {
            return result;
        }

        const previousSuccessfulRechargeCount = await loadPreviousSuccessfulRechargeCount(supabase, {
            userId: normalizedUserId,
            site,
            excludePaymentOrderId: paymentOrderId
        });
        const rechargeContext = {
            site,
            paidPoints: normalizeNumber(paidPoints, 0),
            totalPoints: normalizeNumber(paidPoints, 0) + normalizeNumber(bonusPoints, 0),
            paidAmount: normalizeNumber(paidAmount, 0),
            isFirstRecharge: previousSuccessfulRechargeCount === 0
        };
        result.is_first_recharge = rechargeContext.isFirstRecharge;

        const selectedRules = [];
        const selectedDiscountIds = new Set();
        for (const rule of rechargeRules) {
            if (!ruleMatchesRechargeContext(rule, rechargeContext)) {
                continue;
            }
            if (selectedDiscountIds.has(rule.discount_id)) {
                continue;
            }
            selectedRules.push(rule);
            selectedDiscountIds.add(rule.discount_id);
        }

        return issueMatchedRulesForUser({
            supabase,
            targetUserId: normalizedUserId,
            site,
            eventType: 'recharge',
            sourceType: 'recharge_linkage',
            sourceBatchId: [
                'discount-trigger-recharge',
                normalizeText(paymentProvider, 40).toLowerCase() || 'payment',
                normalizeText(paymentOrderId, 160) || normalizeText(paymentOrderNo, 160) || String(Date.now())
            ].join(':').slice(0, 120),
            selectedRules,
            result
        });
    } catch (error) {
        console.warn('[discount-trigger-linkage] recharge linkage skipped:', error?.message || error);
        return {
            ...result,
            success: false,
            error_message: error?.message || 'discount recharge linkage failed'
        };
    }
}

function normalizeCheckinDate(value) {
    const normalized = normalizeText(value, 20);
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

async function maybeIssueCheckinDiscountAssets(context = {}) {
    const {
        supabase,
        userId = '',
        site = 'cn',
        checkinDate = '',
        pointsReward = 0,
        baseReward = 0,
        bonusReward = 0,
        streakDays = 0
    } = context;

    const result = buildDefaultResult({ eventType: 'checkin', userId, site });
    const normalizedUserId = normalizeText(userId, 160);
    if (!supabase?.from || !normalizedUserId) {
        return result;
    }

    try {
        const config = await loadTriggerConfig(supabase, site);
        const checkinRules = config.checkin?.enabled ? config.checkin.rules : [];
        if (!checkinRules.length) {
            return result;
        }

        const normalizedCheckinDate = normalizeCheckinDate(checkinDate) || new Date().toISOString().slice(0, 10);
        const checkinContext = {
            site,
            pointsReward: normalizeNumber(pointsReward, 0),
            baseReward: normalizeNumber(baseReward, 0),
            bonusReward: normalizeNumber(bonusReward, 0),
            streakDays: Math.max(0, normalizePositiveInteger(streakDays, 0))
        };

        const selectedRules = [];
        const selectedDiscountIds = new Set();
        for (const rule of checkinRules) {
            if (!ruleMatchesCheckinContext(rule, checkinContext)) {
                continue;
            }
            if (selectedDiscountIds.has(rule.discount_id)) {
                continue;
            }
            selectedRules.push(rule);
            selectedDiscountIds.add(rule.discount_id);
        }

        return issueMatchedRulesForUser({
            supabase,
            targetUserId: normalizedUserId,
            site,
            eventType: 'checkin',
            sourceType: 'checkin_linkage',
            sourceBatchId: `discount-trigger-checkin:${normalizeSiteValue(site || 'cn')}:${normalizedCheckinDate}`.slice(0, 120),
            selectedRules,
            result
        });
    } catch (error) {
        console.warn('[discount-trigger-linkage] checkin linkage skipped:', error?.message || error);
        return {
            ...result,
            success: false,
            error_message: error?.message || 'discount checkin linkage failed'
        };
    }
}

function buildAffiliateAggregateResult(context = {}) {
    return {
        ...buildDefaultResult({
            eventType: 'affiliate',
            userId: context.userId || '',
            site: context.site || 'cn'
        }),
        reward_event_count: 0,
        reward_types: []
    };
}

async function maybeIssueAffiliateDiscountAssets(context = {}) {
    const {
        supabase,
        site = 'cn',
        rewardRows = []
    } = context;

    const result = buildAffiliateAggregateResult({ site });
    if (!supabase?.from) {
        return result;
    }

    try {
        const config = await loadTriggerConfig(supabase, site);
        const affiliateRules = config.affiliate?.enabled ? config.affiliate.rules : [];
        if (!affiliateRules.length) {
            return result;
        }

        const normalizedRewardRows = (Array.isArray(rewardRows) ? rewardRows : [])
            .map((row) => {
                const userId = normalizeText(row?.user_id, 160);
                const referenceId = normalizeText(row?.reference_id, 180);
                if (!userId || !referenceId) {
                    return null;
                }

                return {
                    ...row,
                    user_id: userId,
                    reference_id: referenceId,
                    reward_type: normalizeAffiliateRewardType(
                        row?.reward_type || row?.rewardType || normalizeAffiliateRewardTypeFromLedgerRow(row),
                        'any'
                    ),
                    reward_points: Math.max(0, normalizeNumber(row?.amount ?? row?.reward_points ?? row?.rewardPoints, 0)),
                    source_channel: normalizeText(row?.source_channel || row?.sourceChannel, 80).toLowerCase()
                        || (normalizeAffiliateRewardType(row?.reward_type || normalizeAffiliateRewardTypeFromLedgerRow(row), 'any') === 'commission'
                            ? 'affiliate_commission'
                            : 'affiliate_reward'),
                    order_id: normalizeText(row?.order_id || row?.orderId, 160) || null,
                    source_batch_id: normalizeText(row?.source_batch_id || row?.sourceBatchId, 120)
                        || `discount-trigger-affiliate:${referenceId}`.slice(0, 120)
                };
            })
            .filter(Boolean);

        if (!normalizedRewardRows.length) {
            return result;
        }

        for (const rewardRow of normalizedRewardRows) {
            const affiliateContext = {
                site,
                rewardType: rewardRow.reward_type,
                rewardPoints: rewardRow.reward_points
            };

            const selectedRules = [];
            const selectedDiscountIds = new Set();
            for (const rule of affiliateRules) {
                if (!ruleMatchesAffiliateContext(rule, affiliateContext)) {
                    continue;
                }
                if (selectedDiscountIds.has(rule.discount_id)) {
                    continue;
                }
                selectedRules.push({
                    ...rule,
                    source_channel: rule.source_channel || rewardRow.source_channel
                });
                selectedDiscountIds.add(rule.discount_id);
            }

            result.reward_event_count += 1;
            if (!result.reward_types.includes(rewardRow.reward_type)) {
                result.reward_types.push(rewardRow.reward_type);
            }

            await issueMatchedRulesForUser({
                supabase,
                targetUserId: rewardRow.user_id,
                site,
                eventType: 'affiliate',
                sourceType: 'affiliate_linkage',
                sourceBatchId: rewardRow.source_batch_id,
                sourceOrderId: rewardRow.order_id,
                selectedRules,
                result
            });
        }

        return result;
    } catch (error) {
        console.warn('[discount-trigger-linkage] affiliate linkage skipped:', error?.message || error);
        return {
            ...result,
            success: false,
            error_message: error?.message || 'discount affiliate linkage failed'
        };
    }
}

async function maybeIssueAffiliateDiscountAssetsForShopOrder(context = {}) {
    const {
        supabase,
        site = 'cn',
        orderId = ''
    } = context;

    const normalizedOrderId = normalizeText(orderId, 160);
    if (!supabase?.from || !normalizedOrderId) {
        return buildAffiliateAggregateResult({ site });
    }

    const rewardRows = await loadPointsLedgerRowsByReferenceIds(supabase, [
        `AFFILIATE_REWARD_${normalizedOrderId}`,
        `AFF_REW_${normalizedOrderId}`,
        `REG_REWARD_UNLOCK_${normalizedOrderId}`
    ], site);

    return maybeIssueAffiliateDiscountAssets({
        supabase,
        site,
        rewardRows: rewardRows.map((row) => ({
            ...row,
            order_id: normalizedOrderId
        }))
    });
}

async function maybeIssueAffiliateDiscountAssetsForRecharge(context = {}) {
    const {
        supabase,
        site = 'cn',
        rechargeReferenceId = ''
    } = context;

    const normalizedRechargeReferenceId = normalizeText(rechargeReferenceId, 180);
    if (!supabase?.from || !normalizedRechargeReferenceId) {
        return buildAffiliateAggregateResult({ site });
    }

    const rechargeLedgerRow = await loadPointsLedgerRowByReferenceId(supabase, normalizedRechargeReferenceId, site);
    if (!rechargeLedgerRow?.id) {
        return buildAffiliateAggregateResult({ site });
    }

    const rewardRows = await loadPointsLedgerRowsByReferenceIds(supabase, [
        `REG_REWARD_UNLOCK_RECHARGE_${normalizeText(rechargeLedgerRow.id, 180)}`
    ], site);

    return maybeIssueAffiliateDiscountAssets({
        supabase,
        site,
        rewardRows
    });
}

module.exports = {
    DISCOUNT_TRIGGER_CONFIG_KEY,
    maybeIssueAffiliateDiscountAssets,
    maybeIssueAffiliateDiscountAssetsForRecharge,
    maybeIssueAffiliateDiscountAssetsForShopOrder,
    maybeIssueCheckinDiscountAssets,
    maybeIssueRechargeDiscountAssets
};
