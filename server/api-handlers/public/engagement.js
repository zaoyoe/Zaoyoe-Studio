function createPublicEngagementHandlers({
    admin
} = {}) {
    const {
        notifyUsers
    } = require('../../../api/_lib/admin-notifications');
    const {
        CONFIG_KEY: EXTERNAL_EMBED_POLICY_CONFIG_KEY,
        normalizeExternalEmbedPolicy
    } = require('../../../api/_lib/engagement-external-policy');
    const {
        markUserActive,
        syncInactiveUserTagForUser
    } = require('../../../api/_lib/user-tags');
    const {
        getOptionalSupabaseAdmin,
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin || {};

    const PAGE_ALIASES = Object.freeze({
        index: 'home',
        homepage: 'home',
        '/': 'home',
        gallery: 'prompts',
        prompt: 'prompts',
        gongyi: 'gongyi',
        shop: 'shop',
        verify: 'verify',
        guestbook: 'guestbook'
    });
    const VALID_PAGES = Object.freeze(new Set(['home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook']));
    const VALID_EVENTS = Object.freeze(new Set(['view', 'click', 'dismiss', 'conversion']));
    const VALID_PLACEMENTS = Object.freeze(new Set(['robot_bubble', 'top_banner', 'inline_card', 'modal', 'floating_badge']));
    const VALID_REPLY_SOURCES = Object.freeze(new Set(['prompt_comment', 'guestbook_comment']));
    const ADMIN_OPS_NOTIFICATION_PATTERNS = Object.freeze([
        /库存/,
        /补货/,
        /履约/,
        /支付/,
        /验证/,
        /工单超时/,
        /风险/,
        /异常登录/,
        /客服消息汇总/,
        /购买成功汇总/,
        /充值成功汇总/,
        /库存与补货汇总/,
        /工单超时汇总/,
        /履约失败汇总/,
        /支付通道异常汇总/,
        /验证额度告警汇总/,
        /验证堆积告警汇总/,
        /验证失败率告警汇总/
    ]);
    const OPS_ALERT_FEED_LOOKBACK_HOURS = 72;
    const AUDIENCE_SCOPE_TAGS = Object.freeze({
        recharged: 'paid_user',
        high_value: 'high_value',
        inactive: 'inactive_user',
        payment_failed: 'payment_failed',
        verify_failed: 'verify_failed'
    });
    const ASSET_STYLE_CONFIG_KEY = 'engagement_asset_style_center';
    const SUPPORT_ENTRY_CONFIG_KEY = 'engagement_support_entry_center';
    const PAGE_SCENE_CONFIG_KEY = 'engagement_page_scenes';
    const DEFAULT_EVENT_PRIORITY_CENTER = Object.freeze({
        first_wave: {
            label: '首波优先',
            events: ['login_risk', 'payment_failed', 'wallet_recharge_failed', 'verify_failed', 'support_reply', 'ticket_updated', 'refund_status', 'order_status', 'order_paid', 'order_delivered', 'content_moderated']
        },
        service: {
            label: '常规服务',
            events: ['verification_expiring', 'permission_changed', 'points_adjusted', 'points_insufficient', 'verify_queue', 'message_replied', 'comment_replied', 'guestbook_mention', 'service_status', 'maintenance_notice', 'usage_rules', 'community_rule']
        },
        marketing: {
            label: '延后营销',
            events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_discount_available', 'product_restocked', 'cart_abandoned', 'inactive_user_return']
        },
        guidance: {
            label: '体验引导',
            events: ['verify_success', 'prompt_unlocked', 'search_no_result', 'profile_incomplete', 'daily_checkin_available', 'new_user_welcome', 'points_low_balance', 'content_featured', 'wallet_recharge_success']
        }
    });
    let engagementCorsPolicyCache = null;
    let engagementCorsPolicyCacheExpiresAt = 0;

    function sanitizeText(value, maxLength = 4000) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function normalizeSite(value = 'cn') {
        const normalized = sanitizeText(value, 20).toLowerCase();
        return normalized === 'intl' ? 'intl' : 'cn';
    }

    function normalizePlacement(value = 'robot_bubble') {
        const normalized = sanitizeText(value, 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'robot_bubble';
        return VALID_PLACEMENTS.has(normalized) ? normalized : 'robot_bubble';
    }

    function normalizePageId(value = '') {
        const raw = sanitizeText(value, 80).toLowerCase()
            .replace(/\.html$/i, '')
            .replace(/^\/+|\/+$/g, '');
        const aliased = PAGE_ALIASES[raw] || raw;
        return VALID_PAGES.has(aliased) ? aliased : 'home';
    }

    function normalizeStringArray(value) {
        const source = Array.isArray(value) ? value : (value ? [value] : []);
        return [...new Set(source.map((item) => sanitizeText(item, 80).toLowerCase()).filter(Boolean))];
    }

    function normalizeEmail(value = '') {
        const normalized = sanitizeText(value, 240).toLowerCase();
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
    }

    function normalizeEmailArray(value) {
        const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
        return [...new Set(source.map(normalizeEmail).filter(Boolean))];
    }

    function normalizeTagArray(value) {
        const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
        return [...new Set(source.map((item) => sanitizeText(item, 80).toLowerCase()).filter(Boolean))];
    }

    function normalizeEventPriorityCenter(value = {}) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const fallback = DEFAULT_EVENT_PRIORITY_CENTER;
        return {
            first_wave: {
                label: sanitizeText(source.first_wave?.label || fallback.first_wave.label, 80) || fallback.first_wave.label,
                events: normalizeTagArray(source.first_wave?.events || fallback.first_wave.events)
            },
            service: {
                label: sanitizeText(source.service?.label || fallback.service.label, 80) || fallback.service.label,
                events: normalizeTagArray(source.service?.events || fallback.service.events)
            },
            marketing: {
                label: sanitizeText(source.marketing?.label || fallback.marketing.label, 80) || fallback.marketing.label,
                events: normalizeTagArray(source.marketing?.events || fallback.marketing.events)
            },
            guidance: {
                label: sanitizeText(source.guidance?.label || fallback.guidance.label, 80) || fallback.guidance.label,
                events: normalizeTagArray(source.guidance?.events || fallback.guidance.events)
            }
        };
    }

    function normalizeSceneEventPriorityCenter(value = {}, fallbackCenter = DEFAULT_EVENT_PRIORITY_CENTER) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const fallback = normalizeEventPriorityCenter(fallbackCenter);
        return {
            enabled: source.enabled === true,
            first_wave: {
                label: sanitizeText(source.first_wave?.label || fallback.first_wave.label, 80) || fallback.first_wave.label,
                events: normalizeTagArray(source.first_wave?.events || fallback.first_wave.events)
            },
            service: {
                label: sanitizeText(source.service?.label || fallback.service.label, 80) || fallback.service.label,
                events: normalizeTagArray(source.service?.events || fallback.service.events)
            },
            marketing: {
                label: sanitizeText(source.marketing?.label || fallback.marketing.label, 80) || fallback.marketing.label,
                events: normalizeTagArray(source.marketing?.events || fallback.marketing.events)
            },
            guidance: {
                label: sanitizeText(source.guidance?.label || fallback.guidance.label, 80) || fallback.guidance.label,
                events: normalizeTagArray(source.guidance?.events || fallback.guidance.events)
            }
        };
    }

    function resolvePageEventPriorityCenter(config = {}, pageId = 'home') {
        const normalizedPageId = normalizePageId(pageId);
        const globalCenter = normalizeEventPriorityCenter(config?.event_priority_center || {});
        const scenes = Array.isArray(config?.scenes) ? config.scenes : [];
        const scene = scenes.find((entry) => normalizePageId(entry?.id || entry?.page_id || entry?.pageId || '') === normalizedPageId) || null;
        const overrideCenter = normalizeSceneEventPriorityCenter(scene?.event_priority_center || scene?.eventPriorityCenter || {}, globalCenter);
        return overrideCenter.enabled ? {
            first_wave: { ...globalCenter.first_wave, ...(overrideCenter.first_wave || {}) },
            service: { ...globalCenter.service, ...(overrideCenter.service || {}) },
            marketing: { ...globalCenter.marketing, ...(overrideCenter.marketing || {}) },
            guidance: { ...globalCenter.guidance, ...(overrideCenter.guidance || {}) }
        } : globalCenter;
    }

    function normalizeMetadata(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function matchesAnyPattern(value, patterns = []) {
        return patterns.some((pattern) => pattern.test(value));
    }

    function normalizeNotificationScope(value = '') {
        const normalized = sanitizeText(value, 40).toLowerCase();
        if (!normalized) {
            return 'unspecified';
        }
        return ['admin_personal', 'user_personal', 'unspecified'].includes(normalized)
            ? normalized
            : 'unknown';
    }

    function isCnAdminBubbleContext(context = {}) {
        return context?.viewerIsAdmin === true && normalizeSite(context.site || 'cn') === 'cn';
    }

    function isOpsLikeNotification(row = {}) {
        const normalizedRow = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        const metadata = normalizeMetadata(normalizedRow.metadata);
        const text = [
            normalizedRow.title,
            normalizedRow.content,
            normalizedRow.category,
            metadata.category,
            metadata.event_type,
            metadata.trigger_type,
            normalizedRow.source_module
        ].map((item) => sanitizeText(item, 1200)).filter(Boolean).join('\n');
        return matchesAnyPattern(text, ADMIN_OPS_NOTIFICATION_PATTERNS);
    }

    function parseEventContext(value = '') {
        const raw = sanitizeText(value, 1000);
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            return normalizeMetadata(parsed);
        } catch (_) {
            return {};
        }
    }

    function isLocalPreviewOrigin(origin = '') {
        return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(String(origin || '').trim());
    }

    function getOptionalCorsSupabase() {
        try {
            return typeof getOptionalSupabaseAdmin === 'function' ? getOptionalSupabaseAdmin() : null;
        } catch (_) {
            return null;
        }
    }

    async function fetchEngagementCorsPolicy(supabase) {
        const now = Date.now();
        if (engagementCorsPolicyCache && engagementCorsPolicyCacheExpiresAt > now) {
            return engagementCorsPolicyCache;
        }

        let policy = normalizeExternalEmbedPolicy({});
        if (supabase?.from) {
            try {
                const { data, error } = await supabase
                    .from('system_config')
                    .select('config_value')
                    .eq('config_key', EXTERNAL_EMBED_POLICY_CONFIG_KEY)
                    .maybeSingle();
                if (!error) {
                    policy = normalizeExternalEmbedPolicy(data?.config_value || {});
                } else if (!isMissingRelationOrColumnError(error, 'system_config')) {
                    throw error;
                }
            } catch (error) {
                console.warn('[Engagement] External CORS policy fallback:', error?.message || error);
            }
        }

        engagementCorsPolicyCache = policy;
        engagementCorsPolicyCacheExpiresAt = now + 60 * 1000;
        return policy;
    }

    async function applyEngagementCors(req, res, supabase = null) {
        const origin = sanitizeText(req?.headers?.origin || req?.headers?.Origin, 240);
        if (!origin) return;
        const policy = await fetchEngagementCorsPolicy(supabase);
        if (!policy.enabled) return;
        const allowedOrigins = new Set(policy.allowed_origins || []);
        if (!allowedOrigins.has(origin) && !(policy.allow_local_preview && isLocalPreviewOrigin(origin))) return;
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        res.setHeader('Access-Control-Max-Age', '600');
        res.setHeader('Vary', 'Origin');
    }

    async function handleEngagementOptions(req, res, supabase = null) {
        await applyEngagementCors(req, res, supabase);
        res.statusCode = 204;
        res.end();
        return true;
    }

    function normalizeHexColor(value = '', fallback = '#6b9ece') {
        const normalized = sanitizeText(value, 24).toLowerCase();
        return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
    }

    function normalizeInteger(value, fallback, { min = 0, max = 1000 } = {}) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(Math.max(parsed, min), max);
    }

    function normalizeDismissTtlHours(value, fallback = 24) {
        if (value === 0 || value === '0') return 0;
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        const fallbackParsed = Number(fallback);
        return Number.isFinite(fallbackParsed) && fallbackParsed >= 0 ? fallbackParsed : 24;
    }

    function normalizeRepeatIntervalMinutes(value, fallback = 2) {
        return normalizeInteger(value, fallback, { min: 0, max: 1440 });
    }

    function normalizeAssetStyle(style = {}) {
        const source = normalizeMetadata(style);
        return {
            enabled: source.enabled !== false,
            preset: sanitizeText(source.preset || 'studio_blue', 80) || 'studio_blue',
            accent_color: normalizeHexColor(source.accent_color || source.accentColor, '#6b9ece'),
            title_color: normalizeHexColor(source.title_color || source.titleColor, '#5f95cc'),
            bubble_background: normalizeHexColor(source.bubble_background || source.bubbleBackground, '#ffffff'),
            text_color: normalizeHexColor(source.text_color || source.textColor, '#1f2937'),
            radius_px: normalizeInteger(source.radius_px || source.radiusPx, 22, { min: 12, max: 32 }),
            max_width_px: normalizeInteger(source.max_width_px || source.maxWidthPx, 520, { min: 260, max: 560 }),
            density: sanitizeText(source.density || 'comfortable', 40) || 'comfortable',
            shadow: sanitizeText(source.shadow || 'soft', 40) || 'soft',
            animation: sanitizeText(source.animation || 'gentle', 40) || 'gentle',
            robot_variant: sanitizeText(source.robot_variant || source.robotVariant || 'default', 40) || 'default'
        };
    }

    function normalizeAsset(asset = {}) {
        return {
            id: sanitizeText(asset.id || asset.key, 120),
            name: sanitizeText(asset.name || asset.title || '素材', 120) || '素材',
            type: sanitizeText(asset.type || 'icon', 40) || 'icon',
            icon: sanitizeText(asset.icon || 'fa-robot', 80) || 'fa-robot',
            url: sanitizeText(asset.url || asset.image_url || asset.imageUrl, 1000),
            tone: sanitizeText(asset.tone || 'info', 40) || 'info',
            page_ids: normalizeStringArray(asset.page_ids || asset.pageIds || ['all']),
            enabled: asset.enabled !== false
        };
    }

    function normalizeAssetCenter(value = {}) {
        const source = normalizeMetadata(value);
        return {
            style: normalizeAssetStyle(source.style || {}),
            assets: Array.isArray(source.assets) ? source.assets.map(normalizeAsset).filter((asset) => asset.enabled) : []
        };
    }

    function normalizeSupportActionIds(value, fallback = []) {
        const validActions = new Set([
            'code_status',
            'redeem_code',
            'afdian_lookup',
            'shop_order_status',
            'shop_order_content',
            'discount_help',
            'verify_task_status',
            'verify_failure_help',
            'verify_precheck',
            'ticket_history',
            'create_ticket',
            'tg_support',
            'live_chat'
        ]);
        const normalized = normalizeStringArray(value)
            .map((item) => sanitizeText(item, 80).toLowerCase().replace(/[^a-z0-9_-]/g, ''))
            .filter((item) => validActions.has(item));
        return normalized.length ? normalized : fallback.filter((item) => validActions.has(item));
    }

    function normalizeSupportContext(context = {}) {
        const id = sanitizeText(context.id || context.context_id || context.contextId || 'default', 80)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '') || 'default';
        const fallbackShortcuts = id === 'shop'
            ? ['shop_order_status', 'shop_order_content', 'discount_help', 'create_ticket', 'live_chat']
            : id === 'verify'
                ? ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket', 'live_chat']
                : ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat'];
        return {
            id,
            label: sanitizeText(context.label || context.title || '常用入口', 80) || '常用入口',
            intro: sanitizeText(context.intro || context.description, 500),
            shortcuts: normalizeSupportActionIds(context.shortcuts || context.action_ids || context.actionIds, fallbackShortcuts).slice(0, 8),
            enabled: context.enabled !== false
        };
    }

    function normalizeSupportGuide(guide = {}) {
        return {
            id: sanitizeText(guide.id || guide.key, 120),
            title: sanitizeText(guide.title || guide.name || '工单引导', 120) || '工单引导',
            description: sanitizeText(guide.description || guide.desc, 500),
            page_ids: normalizeStringArray(guide.page_ids || guide.pageIds || ['all']),
            action_id: sanitizeText(guide.action_id || guide.actionId || 'create_ticket', 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'create_ticket',
            ticket_template: sanitizeText(guide.ticket_template || guide.ticketTemplate || guide.template, 800),
            priority: Number(guide.priority || 0) || 0,
            enabled: guide.enabled !== false
        };
    }

    function normalizeSupportEntryCenter(value = {}) {
        const source = normalizeMetadata(value);
        return {
            enabled: source.enabled !== false,
            entry_label: sanitizeText(source.entry_label || source.entryLabel || '常用入口', 80) || '常用入口',
            entry_label_en: sanitizeText(source.entry_label_en || source.entryLabelEn || 'Quick Help', 80) || 'Quick Help',
            root_menus: normalizeStringArray(source.root_menus || source.rootMenus || ['exchange', 'shop', 'verify', 'human']),
            telegram_url: sanitizeText(source.telegram_url || source.telegramUrl || 'https://t.me/zaoyoe', 1000) || 'https://t.me/zaoyoe',
            ticket_enabled: source.ticket_enabled !== false && source.ticketEnabled !== false,
            live_chat_enabled: source.live_chat_enabled !== false && source.liveChatEnabled !== false,
            ticket_sla_hours: normalizeInteger(source.ticket_sla_hours || source.ticketSlaHours, 24, { min: 1, max: 168 }),
            ticket_prompt: sanitizeText(source.ticket_prompt || source.ticketPrompt || '把“关联 ID + 问题描述”发我，我会帮你生成一条客服工单。', 500),
            ticket_placeholder: sanitizeText(source.ticket_placeholder || source.ticketPlaceholder || '输入关联 ID 和问题描述', 160),
            ticket_input_hint: sanitizeText(source.ticket_input_hint || source.ticketInputHint || '示例：order:订单号 卡密未到账、task:任务号 一直失败、code:兑换码 显示已使用', 500),
            contexts: Array.isArray(source.contexts) ? source.contexts.map(normalizeSupportContext).filter((context) => context.enabled) : [],
            guides: Array.isArray(source.guides) ? source.guides.map(normalizeSupportGuide).filter((guide) => guide.enabled) : [],
            updated_at: sanitizeText(source.updated_at, 120)
        };
    }

    function normalizeAudienceScope(value = 'all') {
        const normalized = sanitizeText(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'all';
        return normalized || 'all';
    }

    function normalizeTriggerType(value = 'page_view') {
        return sanitizeText(value || 'page_view', 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'page_view';
    }

    function createHttpError(message, statusCode = 400) {
        const error = new Error(message);
        error.statusCode = statusCode;
        return error;
    }

    function getRequestValue(body = {}, ...keys) {
        for (const key of keys) {
            const value = body?.[key];
            const normalized = sanitizeText(value, 240);
            if (normalized) return normalized;
        }
        return '';
    }

    function collapsePreview(value, maxLength = 120) {
        return sanitizeText(value, maxLength).replace(/\s+/g, ' ');
    }

    function buildInternalUrl(pathname = '/', params = {}) {
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            const normalized = sanitizeText(value, 240);
            if (normalized) query.set(key, normalized);
        });
        const queryText = query.toString();
        return queryText ? `${pathname}?${queryText}` : pathname;
    }

    function buildReplyCopy({ site, targetType, pageId, preview, promptTitle }) {
        const english = site === 'intl';
        if (pageId === 'prompts') {
            return {
                title: english ? 'Your comment has a new reply' : '你的评论收到了新回复',
                content: preview
                    ? (english
                        ? `New reply${promptTitle ? ` on ${promptTitle}` : ''}: ${preview}`
                        : `${promptTitle ? `「${promptTitle}」` : '你的 Prompt 评论'}有新回复：${preview}`)
                    : (english ? 'Open the Prompt page to view the latest reply.' : '打开提示词页面查看最新回复。')
            };
        }

        if (targetType === 'message') {
            return {
                title: english ? 'Your guestbook post has a new comment' : '你的留言收到了新评论',
                content: preview
                    ? (english ? `New comment: ${preview}` : `新评论：${preview}`)
                    : (english ? 'Open the guestbook to view the latest comment.' : '打开留言板查看最新评论。')
            };
        }

        return {
            title: english ? 'Your guestbook comment has a new reply' : '你的评论收到了新回复',
            content: preview
                ? (english ? `New reply: ${preview}` : `新回复：${preview}`)
                : (english ? 'Open the guestbook to view the latest reply.' : '打开留言板查看最新回复。')
        };
    }

    function isMissingRelationOrColumnError(error, relationName = '') {
        const text = [
            error?.code,
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').toLowerCase();
        const relation = sanitizeText(relationName).toLowerCase();
        return error?.code === '42P01'
            || error?.code === '42703'
            || error?.code === 'PGRST204'
            || error?.code === 'PGRST205'
            || text.includes('schema cache')
            || (relation && text.includes(relation));
    }

    async function getOptionalUser(req) {
        if (typeof requireAuthenticatedUser !== 'function') {
            return null;
        }
        try {
            const result = await requireAuthenticatedUser(req);
            return result?.user || null;
        } catch (error) {
            const status = Number(error?.statusCode || error?.status || 0);
            if (status === 401 || status === 403 || error?.code === 'auth_session_missing') {
                return null;
            }
            return null;
        }
    }

    async function resolveViewerAccess(supabase, user = {}) {
        const userId = sanitizeText(user?.id, 160);
        if (!userId || !supabase?.from) {
            return { isAdmin: false };
        }

        try {
            if (typeof supabase.rpc === 'function') {
                const { data, error } = await supabase.rpc('get_user_permissions', { p_user_id: userId });
                if (!error && (data?.is_admin === true || data?.is_super_admin === true)) {
                    return { isAdmin: true };
                }
            }
        } catch (_) {
            // Fall through to role-table lookup.
        }

        try {
            const { data, error } = await supabase
                .from('admin_roles')
                .select('role_name,expires_at')
                .eq('user_id', userId);
            if (error) {
                if (isMissingRelationOrColumnError(error, 'admin_roles')) {
                    return { isAdmin: false };
                }
                throw error;
            }
            const nowMs = Date.now();
            const isAdmin = (Array.isArray(data) ? data : []).some((role) => {
                const roleName = sanitizeText(role?.role_name, 80).toLowerCase();
                if (!['admin', 'super_admin'].includes(roleName)) return false;
                const expiresAt = sanitizeText(role?.expires_at, 120);
                if (!expiresAt) return true;
                const expiresMs = new Date(expiresAt).getTime();
                return Number.isFinite(expiresMs) && expiresMs > nowMs;
            });
            return { isAdmin };
        } catch (error) {
            console.warn('[Engagement] Viewer admin lookup skipped:', error?.message || error);
            return { isAdmin: false };
        }
    }

    function collectUserTags(...sources) {
        const collected = [];
        sources.forEach((source) => {
            if (!source) return;
            if (Array.isArray(source) || typeof source === 'string') {
                collected.push(...normalizeTagArray(source));
                return;
            }
            const metadata = normalizeMetadata(source);
            ['tags', 'user_tags', 'labels', 'segments'].forEach((key) => {
                if (metadata[key]) {
                    collected.push(...normalizeTagArray(metadata[key]));
                }
            });
        });
        return normalizeTagArray(collected);
    }

    async function getUserEngagementProfile(supabase, user = {}) {
        const userId = sanitizeText(user?.id, 160);
        const tableTags = userId ? await fetchUserTags(supabase, userId) : [];
        const fallbackProfile = {
            email: normalizeEmail(user?.email || user?.user_metadata?.email || user?.raw_user_meta_data?.email),
            tags: collectUserTags(user?.user_metadata, user?.app_metadata, user?.raw_user_meta_data, tableTags)
        };

        if (!userId || !supabase) {
            return fallbackProfile;
        }

        const profileSelects = [
            'id,email,metadata,user_tags,tags',
            'id,email,metadata',
            'id,email'
        ];

        for (const fields of profileSelects) {
            const { data, error } = await supabase
                .from('profiles')
                .select(fields)
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                if (isMissingRelationOrColumnError(error, 'profiles')) {
                    continue;
                }
                return fallbackProfile;
            }

            if (!data) {
                return fallbackProfile;
            }

            return {
                email: normalizeEmail(data.email) || fallbackProfile.email,
                tags: collectUserTags(
                    fallbackProfile.tags,
                    tableTags,
                    data.metadata,
                    data.user_tags,
                    data.tags
                )
            };
        }

        return fallbackProfile;
    }

    async function fetchUserTags(supabase, userId = '') {
        const normalizedUserId = sanitizeText(userId, 160);
        if (!normalizedUserId || !supabase) return [];
        const { data, error } = await supabase
            .from('user_tags')
            .select('tag')
            .eq('user_id', normalizedUserId);
        if (error) {
            if (isMissingRelationOrColumnError(error, 'user_tags')) {
                return [];
            }
            return [];
        }
        return normalizeTagArray((Array.isArray(data) ? data : []).map((row) => row?.tag));
    }

    async function loadRowById(supabase, tableName, selectFields, rowId) {
        const id = sanitizeText(rowId, 160);
        if (!id) return null;

        const { data, error } = await supabase
            .from(tableName)
            .select(selectFields)
            .eq('id', id)
            .maybeSingle();

        if (error) {
            if (isMissingRelationOrColumnError(error, tableName)) {
                return null;
            }
            throw error;
        }

        return data || null;
    }

    async function hasExistingSourceNotification(supabase, { userId, sourceModule, sourceEventId, dedupeKey }) {
        const normalizedUserId = sanitizeText(userId, 160);
        const normalizedSourceModule = sanitizeText(sourceModule, 80);
        const normalizedSourceEventId = sanitizeText(sourceEventId, 160);
        const normalizedDedupeKey = sanitizeText(dedupeKey, 180);
        if (!normalizedUserId || (!normalizedSourceEventId && !normalizedDedupeKey)) {
            return false;
        }

        let query = supabase
            .from('system_notifications')
            .select('id')
            .eq('user_id', normalizedUserId)
            .limit(1);

        if (normalizedSourceEventId) {
            query = query
                .eq('source_module', normalizedSourceModule || 'engagement')
                .eq('source_event_id', normalizedSourceEventId);
        } else {
            query = query.eq('dedupe_key', normalizedDedupeKey);
        }

        const { data, error } = await query;
        if (error) {
            if (isMissingRelationOrColumnError(error, 'system_notifications')) {
                return false;
            }
            throw error;
        }

        return Array.isArray(data) && data.length > 0;
    }

    function isRuleActive(row = {}, now = new Date()) {
        if (row.enabled !== true || sanitizeText(row.status, 40).toLowerCase() !== 'published') {
            return false;
        }
        if (!sanitizeText(row.title, 240) && !sanitizeText(row.content, 1200)) {
            return false;
        }
        const startsAt = row.starts_at ? new Date(row.starts_at) : null;
        const endsAt = row.ends_at ? new Date(row.ends_at) : null;
        if (startsAt && Number.isFinite(startsAt.getTime()) && startsAt > now) return false;
        if (endsAt && Number.isFinite(endsAt.getTime()) && endsAt <= now) return false;
        return true;
    }

    function ruleMatchesContext(row = {}, { pageId, site }) {
        const rowSite = sanitizeText(row.site || 'all', 20).toLowerCase() || 'all';
        if (rowSite !== 'all' && rowSite !== site) {
            return false;
        }
        const pageIds = normalizeStringArray(row.page_ids);
        return !pageIds.length || pageIds.includes('all') || pageIds.includes(pageId);
    }

    function normalizeAudienceSegment(row = {}) {
        const definition = normalizeMetadata(row.definition);
        const scope = normalizeAudienceScope(definition.scope || row.key || 'all');
        return {
            key: sanitizeText(row.key, 160),
            scope,
            enabled: row.enabled !== false,
            emails: normalizeEmailArray(definition.email_targets || definition.emails || []),
            tags: normalizeTagArray(definition.tag_targets || definition.tags || [])
        };
    }

    async function fetchAudienceSegments(supabase) {
        const { data, error } = await supabase
            .from('engagement_segments')
            .select('key,definition,enabled')
            .eq('enabled', true)
            .limit(200);

        if (error) {
            if (isMissingRelationOrColumnError(error, 'engagement_segments')) {
                return new Map();
            }
            throw error;
        }

        return (Array.isArray(data) ? data : []).reduce((segmentMap, row) => {
            const segment = normalizeAudienceSegment(row);
            if (segment.enabled && segment.scope) {
                segmentMap.set(segment.scope, segment);
            }
            return segmentMap;
        }, new Map());
    }

    function getAudienceSegmentForScope(scope = 'all', context = {}) {
        const normalizedScope = normalizeAudienceScope(scope);
        const segments = context.audienceSegments;
        if (segments instanceof Map) {
            return segments.get(normalizedScope) || null;
        }
        if (Array.isArray(segments)) {
            return segments.find((segment) => normalizeAudienceScope(segment.scope || segment.key) === normalizedScope) || null;
        }
        return null;
    }

    function ruleMatchesAudience(row = {}, context = {}) {
        const audience = normalizeMetadata(row.audience);
        const scope = normalizeAudienceScope(audience.scope || audience.segment || audience.type || 'all');
        const segment = getAudienceSegmentForScope(scope, context);
        const targetEmails = normalizeEmailArray([
            ...normalizeEmailArray(audience.email_targets || audience.emailTargets || audience.emails || audience.email),
            ...(segment?.emails || [])
        ]);
        const targetTags = normalizeTagArray([
            ...normalizeTagArray(audience.tag_targets || audience.tagTargets || audience.tags || audience.tag),
            ...(segment?.tags || [])
        ]);
        if (targetEmails.length || targetTags.length) {
            const userEmail = normalizeEmail(context.userEmail || context.email);
            const userTags = normalizeTagArray(context.userTags || context.tags || []);
            const matchesEmail = Boolean(userEmail && targetEmails.includes(userEmail));
            const matchesTag = targetTags.some((tag) => userTags.includes(tag));
            return matchesEmail || matchesTag;
        }
        if (!scope || scope === 'all') return true;
        if (scope === 'visitors' || scope === 'visitor' || scope === 'guest') {
            return !sanitizeText(context.userId, 160);
        }
        if (scope === 'authenticated' || scope === 'logged_in' || scope === 'login') {
            return Boolean(sanitizeText(context.userId, 160));
        }
        if (scope === 'not_recharged') {
            const userTags = normalizeTagArray(context.userTags || context.tags || []);
            return Boolean(sanitizeText(context.userId, 160)) && !userTags.includes('paid_user');
        }
        if (AUDIENCE_SCOPE_TAGS[scope]) {
            const userTags = normalizeTagArray(context.userTags || context.tags || []);
            return userTags.includes(AUDIENCE_SCOPE_TAGS[scope]);
        }
        // Rich commercial segments need profile/order signals. Until those are wired,
        // only logged-in users can qualify for them, preventing guest over-targeting.
        return Boolean(sanitizeText(context.userId, 160));
    }

    function ruleMatchesFeedTrigger(row = {}, context = {}) {
        return normalizeTriggerType(row.trigger_type || 'page_view') === normalizeTriggerType(context.triggerType || 'page_view');
    }

    function normalizeDeliveryFrequencyScope(value = '', triggerType = 'page_view') {
        const normalized = sanitizeText(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (['rule', 'event', 'session'].includes(normalized)) {
            return normalized;
        }
        return normalizeTriggerType(triggerType || 'page_view') === 'page_view' ? 'rule' : 'event';
    }

    function normalizeRuleBubble(row = {}, context = {}) {
        const metadata = normalizeMetadata(row.metadata);
        const triggerType = normalizeTriggerType(row.trigger_type || 'page_view');
        const frequencyScope = normalizeDeliveryFrequencyScope(metadata.frequency_scope || metadata.frequencyScope, triggerType);
        const bubble = {
            id: sanitizeText(row.id, 160),
            rule_id: sanitizeText(row.id, 160),
            notification_id: '',
            source: 'rule',
            source_module: sanitizeText(row.metadata?.source_module || 'engagement', 80) || 'engagement',
            source_event_id: sanitizeText(context.triggerMetadata?.source_event_id || row.metadata?.source_event_id, 160),
            trigger_type: triggerType,
            title: sanitizeText(row.title || row.name || '小助手提醒', 160) || '小助手提醒',
            content: sanitizeText(row.content, 1200),
            category: sanitizeText(metadata.category || 'engagement', 80) || 'engagement',
            page_id: context.pageId,
            site: context.site,
            placement: normalizePlacement(row.placement || metadata.placement),
            priority: Number(row.priority || 0) || 0,
            frequency: sanitizeText(row.frequency || 'once_per_day', 80) || 'once_per_day',
            frequency_scope: frequencyScope,
            action_label: sanitizeText(row.action_label, 80),
            action_url: sanitizeText(row.action_url, 1000),
            dismiss_ttl_hours: normalizeDismissTtlHours(row.dismiss_ttl_hours, 24),
            repeat_interval_minutes: normalizeRepeatIntervalMinutes(metadata.repeat_interval_minutes ?? metadata.repeatIntervalMinutes, 2),
            tone: sanitizeText(row.tone || 'info', 40) || 'info',
            icon: sanitizeText(row.icon || 'robot', 40) || 'robot',
            metadata: {
                ...metadata,
                repeat_interval_minutes: normalizeRepeatIntervalMinutes(metadata.repeat_interval_minutes ?? metadata.repeatIntervalMinutes, 2),
                frequency_scope: frequencyScope,
                trigger_type: triggerType,
                feed_trigger_type: normalizeTriggerType(context.triggerType || 'page_view'),
                feed_context: normalizeMetadata(context.triggerMetadata)
            }
        };
        return applyRuleEventContextOverrides(bubble, row, context);
    }

    function getPointsAdjustedSummaryLabel(eventContext = {}) {
        const direction = sanitizeText(eventContext.adjustment_direction || eventContext.adjustmentDirection, 40).toLowerCase();
        const kind = sanitizeText(eventContext.adjustment_kind || eventContext.adjustmentKind, 40).toLowerCase();
        if (kind === 'correction') return '积分记录已修正';
        if (direction === 'increase') return '积分已补发';
        if (direction === 'decrease') return '积分已扣减';
        return '积分有更新';
    }

    function buildPointsAdjustedRuleContent(baseContent = '', eventContext = {}) {
        const normalizedBase = sanitizeText(baseContent, 1200);
        const amountValue = Number(eventContext.amount);
        const absoluteAmount = Number.isFinite(amountValue) ? Math.abs(amountValue) : 0;
        const reason = sanitizeText(eventContext.reason, 160);
        const newTotalValue = Number(eventContext.new_total ?? eventContext.newTotal);
        const summaryLabel = getPointsAdjustedSummaryLabel(eventContext);
        const detailLines = [];

        if (absoluteAmount > 0) {
            detailLines.push(`本次变动：${summaryLabel.replace(/^积分/, '')} ${absoluteAmount} 积分。`);
        } else {
            detailLines.push('本次积分状态有更新。');
        }
        if (reason) {
            detailLines.push(`原因：${reason}`);
        }
        if (Number.isFinite(newTotalValue)) {
            detailLines.push(`当前可用积分：${newTotalValue}`);
        }

        return [normalizedBase, detailLines.join('\n')]
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    function applyRuleEventContextOverrides(bubble = {}, row = {}, context = {}) {
        const triggerType = normalizeTriggerType(bubble.trigger_type || row.trigger_type || context.triggerType || 'page_view');
        if (triggerType !== 'points_adjusted') {
            return bubble;
        }

        const eventContext = normalizeMetadata(context.triggerMetadata?.event_context);
        if (!Object.keys(eventContext).length) {
            return bubble;
        }

        const adjustmentDirection = sanitizeText(eventContext.adjustment_direction || eventContext.adjustmentDirection, 40).toLowerCase();
        const adjustmentKind = sanitizeText(eventContext.adjustment_kind || eventContext.adjustmentKind, 40).toLowerCase();
        const summaryLabel = getPointsAdjustedSummaryLabel(eventContext);
        const tone = adjustmentKind === 'correction'
            ? (adjustmentDirection === 'decrease' ? 'warning' : 'info')
            : (adjustmentDirection === 'increase' ? 'success' : (adjustmentDirection === 'decrease' ? 'warning' : bubble.tone));
        const priorityFloor = adjustmentDirection === 'decrease' ? 35 : (adjustmentKind === 'correction' ? 28 : 24);

        return {
            ...bubble,
            title: ['你的积分有更新', '积分变动通知', '小助手提醒'].includes(bubble.title) ? summaryLabel : bubble.title,
            content: buildPointsAdjustedRuleContent(bubble.content, eventContext),
            tone: tone || bubble.tone,
            priority: Math.max(Number(bubble.priority || 0) || 0, priorityFloor),
            action_label: bubble.action_label || '查看积分',
            action_url: bubble.action_url || 'wallet://balance',
            metadata: {
                ...bubble.metadata,
                adjustment_direction: adjustmentDirection || bubble.metadata?.adjustment_direction || '',
                adjustment_kind: adjustmentKind || bubble.metadata?.adjustment_kind || '',
                action_path_label: bubble.metadata?.action_path_label || '我的钱包 > 积分',
                action_path_url: bubble.metadata?.action_path_url || 'wallet://balance',
                wallet_view: bubble.metadata?.wallet_view || 'balance',
                feed_context: {
                    ...normalizeMetadata(bubble.metadata?.feed_context),
                    event_context: eventContext
                }
            }
        };
    }

    function normalizeNotificationBubble(row = {}, context = {}) {
        const metadata = normalizeMetadata(row.metadata);
        const category = sanitizeText(row.category || metadata.category || 'user_notice', 80) || 'user_notice';
        const scope = normalizeNotificationScope(row.scope || metadata.scope);
        return {
            id: `notification:${sanitizeText(row.id, 160)}`,
            rule_id: '',
            notification_id: sanitizeText(row.id, 160),
            source: 'notification',
            source_module: sanitizeText(row.source_module || metadata.source_module || category, 80) || category,
            source_event_id: sanitizeText(row.source_event_id || metadata.source_event_id, 160),
            title: sanitizeText(row.title || '小助手提醒', 160) || '小助手提醒',
            content: sanitizeText(row.content, 1200),
            category,
            page_id: sanitizeText(metadata.page_id || context.pageId, 80) || context.pageId,
            site: sanitizeText(row.site || metadata.site || 'cn', 20) || 'cn',
            placement: normalizePlacement(metadata.placement || metadata.display_type || metadata.displayType),
            priority: Number(row.priority || metadata.priority || 20) || 20,
            action_label: sanitizeText(row.action_label || metadata.action_label, 80),
            action_url: sanitizeText(row.action_url || metadata.action_url, 1000),
            dismiss_ttl_hours: normalizeDismissTtlHours(metadata.dismiss_ttl_hours, 24),
            tone: sanitizeText(row.type || metadata.tone || 'info', 40) || 'info',
            icon: sanitizeText(metadata.icon || 'robot', 40) || 'robot',
            scope,
            metadata: {
                ...metadata,
                scope
            }
        };
    }

    function notificationMatchesSite(row = {}, context = {}) {
        const normalizedRow = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        const metadata = normalizeMetadata(normalizedRow.metadata);
        const payloadSite = sanitizeText(
            normalizedRow.site
                || metadata.site
                || metadata.site_id
                || metadata.siteId,
            20
        ).toLowerCase();
        if (!payloadSite) {
            return normalizeSite(context.site || 'cn') === 'cn';
        }
        if (payloadSite === 'all') {
            return true;
        }
        return normalizeSite(payloadSite) === normalizeSite(context.site || 'cn');
    }

    function shouldSurfaceNotificationBubble(row = {}, context = {}) {
        const normalizedRow = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        const metadata = normalizeMetadata(normalizedRow.metadata);
        const category = sanitizeText(normalizedRow.category || metadata.category, 80).toLowerCase();
        const scope = normalizeNotificationScope(normalizedRow.scope || metadata.scope);
        const triggerType = normalizeTriggerType(
            metadata.trigger_type
                || metadata.triggerType
                || metadata.event_type
                || metadata.eventType
                || ''
        );
        // Moderation outcomes are still stored as notifications, but they should
        // stay in the inbox/badge instead of interrupting users with a robot bubble.
        if (category === 'content_moderated' || triggerType === 'content_moderated') {
            return false;
        }
        if (!notificationMatchesSite(normalizedRow, context)) {
            return false;
        }
        const adminBubbleContext = isCnAdminBubbleContext(context);
        const opsLike = isOpsLikeNotification(normalizedRow);
        if (scope === 'admin_personal') {
            return adminBubbleContext;
        }
        if (opsLike && !adminBubbleContext) {
            return false;
        }
        if (scope === 'user_personal') {
            return true;
        }
        if (scope !== 'unspecified') {
            return false;
        }
        return Boolean(normalizeNotificationBubble(normalizedRow, context));
    }

    function normalizeOpsAlertTone(severity = '') {
        const normalized = sanitizeText(severity, 40).toLowerCase();
        if (normalized === 'critical') return 'alert';
        if (normalized === 'info' || normalized === 'success') return 'info';
        return 'warning';
    }

    function normalizeOpsAlertPriority(row = {}) {
        const severity = sanitizeText(row.severity, 40).toLowerCase();
        if (severity === 'critical') return 95;
        if (severity === 'info') return 55;
        return 78;
    }

    function opsAlertMatchesSite(row = {}, context = {}) {
        const payload = normalizeMetadata(row.payload);
        const payloadSite = sanitizeText(payload.site || payload.site_id || payload.siteId, 20).toLowerCase();
        if (!payloadSite || payloadSite === 'all') {
            return true;
        }
        return normalizeSite(payloadSite) === normalizeSite(context.site || 'cn');
    }

    function shouldSurfaceOpsAlertBubble(row = {}, context = {}) {
        if (!isCnAdminBubbleContext(context)) {
            return false;
        }
        if (!opsAlertMatchesSite(row, context)) {
            return false;
        }
        const title = sanitizeText(row.title, 160);
        const content = sanitizeText(row.content, 1200)
            || sanitizeText(row.title, 160)
            || '站内代办提醒';
        return Boolean(title || content);
    }

    function normalizeOpsAlertBubble(row = {}, context = {}) {
        const payload = normalizeMetadata(row.payload);
        const alertType = sanitizeText(row.alert_type, 100).toLowerCase();
        const jobId = sanitizeText(row.id, 160);
        const content = sanitizeText(row.content, 1200)
            || sanitizeText(row.title, 160)
            || '站内代办提醒';
        const entryPath = sanitizeText(payload.entry_path, 240);
        return {
            id: `ops_alert:${jobId}`,
            rule_id: '',
            notification_id: '',
            source: 'ops_alert',
            source_module: 'ops_alert_jobs',
            source_event_id: `ops_alert:${jobId}`,
            trigger_type: 'ops_alert',
            title: sanitizeText(row.title, 160) || '站内代办提醒',
            content,
            category: alertType || 'ops_alert',
            page_id: context.pageId,
            site: 'cn',
            placement: 'robot_bubble',
            priority: normalizeOpsAlertPriority(row),
            action_label: '处理告警',
            action_url: `ops-alert://${encodeURIComponent(jobId)}`,
            dismiss_ttl_hours: 8,
            repeat_interval_minutes: 15,
            tone: normalizeOpsAlertTone(row.severity),
            icon: 'robot',
            metadata: {
                alert_type: alertType,
                severity: sanitizeText(row.severity, 40).toLowerCase() || 'warning',
                status: sanitizeText(row.status, 40).toLowerCase() || 'pending',
                entry_path: entryPath,
                payload,
                created_at: sanitizeText(row.created_at, 120),
                updated_at: sanitizeText(row.updated_at, 120),
                source_module: 'ops_alert_jobs',
                source_event_id: `ops_alert:${jobId}`
            }
        };
    }

    function normalizeDeliveryFrequency(value = 'once_per_day') {
        const normalized = sanitizeText(value || 'once_per_day', 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'once_per_day';
        return normalized || 'once_per_day';
    }

    function getRealtimeDeliveryFrequencyBucket(bubble = {}, context = {}) {
        const frequency = normalizeDeliveryFrequency(bubble.frequency || 'once_per_day');
        const frequencyScope = normalizeDeliveryFrequencyScope(
            bubble.frequency_scope || bubble.frequencyScope || bubble.metadata?.frequency_scope || bubble.metadata?.frequencyScope,
            bubble.trigger_type || context.triggerType || 'page_view'
        );
        if (frequency === 'once') {
            return 'once';
        }
        if (frequency === 'once_per_session' || frequency === 'session' || frequencyScope === 'session') {
            return `session:${sanitizeText(context.readerKey, 160) || 'unknown'}`;
        }
        if (frequency === 'always' || frequency === 'every_time') {
            const intervalMinutes = normalizeRepeatIntervalMinutes(bubble.repeat_interval_minutes, 2) || 2;
            const intervalMs = Math.max(60000, intervalMinutes * 60 * 1000);
            return `interval:${intervalMinutes}:${Math.floor(Date.now() / intervalMs)}`;
        }
        return `day:${new Date().toISOString().slice(0, 10)}`;
    }

    function buildRealtimeDeliveryKey(bubble = {}, context = {}) {
        const ruleId = sanitizeText(bubble.rule_id || bubble.id, 160);
        if (!ruleId) return '';
        const triggerType = normalizeTriggerType(bubble.trigger_type || context.triggerType || 'page_view');
        const frequencyScope = normalizeDeliveryFrequencyScope(
            bubble.frequency_scope || bubble.frequencyScope || bubble.metadata?.frequency_scope || bubble.metadata?.frequencyScope,
            triggerType
        );
        const sourceEventId = sanitizeText(
            context.triggerMetadata?.source_event_id
                || bubble.source_event_id
                || '',
            160
        ) || 'default';
        const identityParts = [
            'rule',
            ruleId,
            context.pageId || 'home',
            context.site || 'cn',
            triggerType,
            frequencyScope
        ];
        if (frequencyScope === 'event') {
            identityParts.push(sourceEventId);
        } else if (frequencyScope === 'session') {
            identityParts.push(sanitizeText(context.readerKey, 160) || 'unknown');
        }
        return sanitizeText([
            ...identityParts,
            getRealtimeDeliveryFrequencyBucket(bubble, context)
        ].join(':'), 500);
    }

    function buildRealtimeDeliveryMetadata(bubble = {}, context = {}, deliveryKey = '') {
        const bubbleMetadata = normalizeMetadata(bubble.metadata);
        return {
            realtime_delivery: true,
            delivery_key: deliveryKey,
            trigger_type: normalizeTriggerType(bubble.trigger_type || context.triggerType || 'page_view'),
            frequency_scope: normalizeDeliveryFrequencyScope(
                bubble.frequency_scope || bubble.frequencyScope || bubbleMetadata.frequency_scope || bubbleMetadata.frequencyScope,
                bubble.trigger_type || context.triggerType || 'page_view'
            ),
            feed_context: normalizeMetadata(context.triggerMetadata),
            bubble: {
                ...bubble,
                id: sanitizeText(bubble.rule_id || bubble.id, 160),
                source: 'rule',
                metadata: {
                    ...bubbleMetadata,
                    realtime_delivery: true,
                    delivery_key: deliveryKey
                }
            }
        };
    }

    async function createRealtimeRuleDeliveries(supabase, context = {}, bubbles = []) {
        const userId = sanitizeText(context.userId, 160);
        if (!userId || !supabase?.from || !Array.isArray(bubbles) || !bubbles.length) {
            return { created: 0, skipped: 0 };
        }

        const candidates = bubbles
            .map((bubble) => {
                const deliveryKey = buildRealtimeDeliveryKey(bubble, context);
                const ruleId = sanitizeText(bubble.rule_id || bubble.id, 160);
                if (!deliveryKey || !ruleId) return null;
                return {
                    deliveryKey,
                    payload: {
                        rule_id: ruleId,
                        notification_id: sanitizeText(bubble.notification_id, 160) || null,
                        user_id: userId,
                        reader_key: sanitizeText(context.readerKey, 160),
                        page_id: sanitizeText(bubble.page_id || context.pageId, 80) || context.pageId,
                        site: sanitizeText(bubble.site || context.site, 20) || context.site,
                        status: 'delivered',
                        delivery_key: deliveryKey,
                        source_module: sanitizeText(bubble.source_module || 'engagement', 80) || 'engagement',
                        source_event_id: sanitizeText(
                            context.triggerMetadata?.source_event_id
                                || bubble.source_event_id
                                || deliveryKey,
                            160
                        ),
                        metadata: buildRealtimeDeliveryMetadata(bubble, context, deliveryKey)
                    }
                };
            })
            .filter(Boolean);

        if (!candidates.length) {
            return { created: 0, skipped: 0 };
        }

        const deliveryKeys = [...new Set(candidates.map((candidate) => candidate.deliveryKey))];
        let existingKeys = new Set();
        const deliveriesByKey = new Map();
        try {
            const { data, error } = await supabase
                .from('engagement_deliveries')
                .select('id,delivery_key')
                .eq('user_id', userId)
                .in('delivery_key', deliveryKeys)
                .limit(deliveryKeys.length);
            if (error) throw error;
            (Array.isArray(data) ? data : []).forEach((row) => {
                const key = sanitizeText(row.delivery_key, 500);
                if (!key) return;
                existingKeys.add(key);
                deliveriesByKey.set(key, {
                    id: sanitizeText(row.id, 160),
                    delivery_key: key
                });
            });
        } catch (error) {
            if (isMissingRelationOrColumnError(error, 'engagement_deliveries')) {
                return { created: 0, skipped: candidates.length, deliveriesByKey };
            }
            throw error;
        }

        const payloads = candidates
            .filter((candidate) => !existingKeys.has(candidate.deliveryKey))
            .map((candidate) => candidate.payload);

        if (!payloads.length) {
            return { created: 0, skipped: candidates.length, deliveriesByKey };
        }

        try {
            const { data, error } = await supabase
                .from('engagement_deliveries')
                .insert(payloads)
                .select('id,delivery_key');
            if (error) throw error;
            (Array.isArray(data) ? data : []).forEach((row) => {
                const key = sanitizeText(row.delivery_key, 500);
                if (!key) return;
                deliveriesByKey.set(key, {
                    id: sanitizeText(row.id, 160),
                    delivery_key: key
                });
            });
            return {
                created: Array.isArray(data) ? data.length : payloads.length,
                skipped: candidates.length - payloads.length,
                deliveriesByKey
            };
        } catch (error) {
            if (error?.code === '23505') {
                return { created: 0, skipped: candidates.length, deliveriesByKey };
            }
            if (isMissingRelationOrColumnError(error, 'engagement_deliveries')) {
                return { created: 0, skipped: candidates.length, deliveriesByKey };
            }
            throw error;
        }
    }

    async function fetchRuleBubbles(supabase, context) {
        const { data, error } = await supabase
            .from('engagement_rules')
            .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,updated_at')
            .eq('enabled', true)
            .eq('status', 'published')
            .order('priority', { ascending: false })
            .order('updated_at', { ascending: false })
            .limit(50);

        if (error) {
            if (isMissingRelationOrColumnError(error, 'engagement_rules')) {
                return { items: [], next_scheduled_rule_at: null };
            }
            throw error;
        }

        const now = new Date();
        const candidates = (Array.isArray(data) ? data : [])
            .filter((row) => ruleMatchesFeedTrigger(row, context))
            .filter((row) => ruleMatchesContext(row, context))
            .filter((row) => ruleMatchesAudience(row, context))
            .filter((row) => VALID_PLACEMENTS.has(normalizePlacement(row.placement || 'robot_bubble')));
        const nextScheduledRuleAt = candidates
            .map((row) => (row.starts_at ? new Date(row.starts_at) : null))
            .filter((date) => date && Number.isFinite(date.getTime()) && date > now)
            .sort((first, second) => first.getTime() - second.getTime())[0] || null;
        return {
            items: candidates
                .filter((row) => isRuleActive(row, now))
                .map((row) => normalizeRuleBubble(row, context)),
            next_scheduled_rule_at: nextScheduledRuleAt ? nextScheduledRuleAt.toISOString() : null
        };
    }

    async function fetchNotificationBubbles(supabase, userId, context) {
        if (!userId) return [];
        const requestedSite = normalizeSite(context?.site || 'cn');

        let response = await supabase
            .from('system_notifications')
            .select('id,title,content,type,scope,category,is_read,created_at,action_url,action_label,metadata,priority,expires_at,dedupe_key,source_module,source_event_id,site')
            .eq('user_id', userId)
            .eq('site', requestedSite)
            .eq('is_read', false)
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(20);

        if (response.error && isMissingRelationOrColumnError(response.error, 'system_notifications')) {
            response = await supabase
                .from('system_notifications')
                .select('id,title,content,type,scope,category,is_read,created_at')
                .eq('user_id', userId)
                .eq('is_read', false)
                .order('created_at', { ascending: false })
                .limit(20);
        }

        const { data, error } = response;
        if (error) {
            if (isMissingRelationOrColumnError(error, 'system_notifications')) {
                return [];
            }
            throw error;
        }

        const nowMs = Date.now();
        return (Array.isArray(data) ? data : [])
            .filter((row) => shouldSurfaceNotificationBubble(row, context))
            .filter((row) => {
                const expiresAt = sanitizeText(row.expires_at, 120);
                if (!expiresAt) return true;
                const expiresMs = new Date(expiresAt).getTime();
                return !Number.isFinite(expiresMs) || expiresMs > nowMs;
            })
            .map((row) => normalizeNotificationBubble(row, context));
    }

    async function fetchOpsAlertBubbles(supabase, context) {
        if (!isCnAdminBubbleContext(context)) {
            return [];
        }

        const sinceIso = new Date(Date.now() - OPS_ALERT_FEED_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from('ops_alert_jobs')
            .select('id,alert_type,severity,title,content,payload,status,created_at,updated_at')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            if (isMissingRelationOrColumnError(error, 'ops_alert_jobs')) {
                return [];
            }
            throw error;
        }

        return (Array.isArray(data) ? data : [])
            .filter((row) => shouldSurfaceOpsAlertBubble(row, context))
            .map((row) => normalizeOpsAlertBubble(row, context));
    }

    async function fetchAssetStyleConfig(supabase) {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', ASSET_STYLE_CONFIG_KEY)
            .maybeSingle();
        if (error) {
            if (isMissingRelationOrColumnError(error, 'system_config')) {
                return normalizeAssetCenter({});
            }
            throw error;
        }
        return normalizeAssetCenter(data?.config_value || {});
    }

    async function fetchSupportEntryConfig(supabase) {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', SUPPORT_ENTRY_CONFIG_KEY)
            .maybeSingle();
        if (error) {
            if (isMissingRelationOrColumnError(error, 'system_config')) {
                return normalizeSupportEntryCenter({});
            }
            throw error;
        }
        return normalizeSupportEntryCenter(data?.config_value || {});
    }

    async function fetchPageSceneConfig(supabase) {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', PAGE_SCENE_CONFIG_KEY)
            .maybeSingle();
        if (error) {
            if (isMissingRelationOrColumnError(error, 'system_config')) {
                return {
                    scenes: [],
                    event_priority_center: normalizeEventPriorityCenter({})
                };
            }
            throw error;
        }
        return {
            scenes: Array.isArray(data?.config_value?.scenes) ? data.config_value.scenes : [],
            event_priority_center: normalizeEventPriorityCenter(data?.config_value?.event_priority_center || {})
        };
    }

    async function resolvePromptReplyNotification(supabase, actorUserId, body = {}) {
        const commentId = getRequestValue(body, 'comment_id', 'commentId');
        if (!commentId) {
            throw createHttpError('comment_id is required', 400);
        }

        const child = await loadRowById(
            supabase,
            'prompt_comments',
            'id,user_id,parent_id,prompt_id,content,site',
            commentId
        );

        if (!child) {
            return {
                skipped: 'comment_not_found'
            };
        }

        if (sanitizeText(child.user_id, 160) !== actorUserId) {
            throw createHttpError('Cannot notify for another user reply', 403);
        }

        const parentId = sanitizeText(child.parent_id, 160);
        const requestedParentId = getRequestValue(body, 'parent_id', 'parentId');
        if (!parentId) {
            return {
                skipped: 'not_a_reply'
            };
        }
        if (requestedParentId && requestedParentId !== parentId) {
            throw createHttpError('parent_id does not match the stored comment', 400);
        }

        const parent = await loadRowById(
            supabase,
            'prompt_comments',
            'id,user_id,parent_id,prompt_id,content,site',
            parentId
        );
        const recipientId = sanitizeText(parent?.user_id, 160);
        if (!recipientId) {
            return {
                skipped: 'parent_not_found'
            };
        }
        if (recipientId === actorUserId) {
            return {
                skipped: 'self_reply'
            };
        }

        const site = normalizeSite(child.site || parent?.site || body.site || 'cn');
        const promptId = sanitizeText(child.prompt_id || parent?.prompt_id || body.prompt_id || body.promptId, 160);
        const promptTitle = sanitizeText(body.prompt_title || body.promptTitle, 120);
        const preview = collapsePreview(child.content || body.content_preview || body.content, 120);
        const copy = buildReplyCopy({
            site,
            pageId: 'prompts',
            targetType: 'comment',
            preview,
            promptTitle
        });
        const sourceEventId = `prompt_comment_reply:${commentId}`;

        return {
            recipientId,
            title: copy.title,
            content: copy.content,
            category: 'comment_replied',
            actionLabel: site === 'intl' ? 'View reply' : '查看回复',
            actionUrl: buildInternalUrl('/prompts.html', {
                id: promptId,
                comments: '1',
                commentId
            }),
            priority: 55,
            sourceModule: 'comments',
            sourceEventId,
            dedupeKey: sourceEventId,
            metadata: {
                page_id: 'prompts',
                site,
                event_type: 'comment_replied',
                source: 'prompt_comment',
                comment_id: commentId,
                parent_id: parentId,
                prompt_id: promptId,
                prompt_title: promptTitle
            }
        };
    }

    async function resolveGuestbookReplyNotification(supabase, actorUserId, body = {}) {
        const commentId = getRequestValue(body, 'comment_id', 'commentId');
        if (!commentId) {
            throw createHttpError('comment_id is required', 400);
        }

        const child = await loadRowById(
            supabase,
            'guestbook_comments',
            'id,user_id,parent_id,message_id,content,site',
            commentId
        );

        if (!child) {
            return {
                skipped: 'comment_not_found'
            };
        }

        if (sanitizeText(child.user_id, 160) !== actorUserId) {
            throw createHttpError('Cannot notify for another user reply', 403);
        }

        const parentId = sanitizeText(child.parent_id, 160);
        const requestedParentId = getRequestValue(body, 'parent_id', 'parentId');
        if (requestedParentId && requestedParentId !== parentId) {
            throw createHttpError('parent_id does not match the stored comment', 400);
        }

        const messageId = sanitizeText(child.message_id || body.message_id || body.messageId, 160);
        if (!messageId) {
            return {
                skipped: 'message_not_found'
            };
        }

        let recipientId = '';
        let targetType = 'message';
        if (parentId) {
            targetType = 'comment';
            const parent = await loadRowById(
                supabase,
                'guestbook_comments',
                'id,user_id,parent_id,message_id,content,site',
                parentId
            );
            recipientId = sanitizeText(parent?.user_id, 160);
        } else {
            const message = await loadRowById(
                supabase,
                'guestbook_messages',
                'id,user_id,content,site',
                messageId
            );
            recipientId = sanitizeText(message?.user_id, 160);
        }

        if (!recipientId) {
            return {
                skipped: targetType === 'comment' ? 'parent_not_found' : 'message_not_found'
            };
        }
        if (recipientId === actorUserId) {
            return {
                skipped: 'self_reply'
            };
        }

        const site = normalizeSite(child.site || body.site || 'cn');
        const preview = collapsePreview(child.content || body.content_preview || body.content, 120);
        const eventType = targetType === 'message' ? 'message_replied' : 'guestbook_mention';
        const copy = buildReplyCopy({
            site,
            pageId: 'guestbook',
            targetType,
            preview
        });
        const sourceEventId = targetType === 'message'
            ? `guestbook_message_reply:${commentId}`
            : `guestbook_comment_reply:${commentId}`;

        return {
            recipientId,
            title: copy.title,
            content: copy.content,
            category: eventType,
            actionLabel: site === 'intl' ? 'View reply' : '查看回复',
            actionUrl: buildInternalUrl('/guestbook.html', {
                messageId,
                commentId
            }),
            priority: targetType === 'message' ? 50 : 55,
            sourceModule: 'guestbook',
            sourceEventId,
            dedupeKey: sourceEventId,
            metadata: {
                page_id: 'guestbook',
                site,
                event_type: eventType,
                source: 'guestbook_comment',
                target_type: targetType,
                comment_id: commentId,
                parent_id: parentId,
                message_id: messageId
            }
        };
    }

    async function replyNotifyHandler(req, res) {
        const corsSupabase = getOptionalCorsSupabase();
        if (req.method === 'OPTIONS') {
            return handleEngagementOptions(req, res, corsSupabase);
        }
        await applyEngagementCors(req, res, corsSupabase);
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        if (typeof requireAuthenticatedUser !== 'function') {
            return sendJson(res, 503, {
                success: false,
                message: 'Engagement notification service is unavailable'
            });
        }

        try {
            const auth = await requireAuthenticatedUser(req);
            const actorUserId = sanitizeText(auth?.user?.id, 160);
            if (!actorUserId) {
                throw createHttpError('Unauthorized', 401);
            }

            const supabase = auth?.adminSupabase
                || (typeof getOptionalSupabaseAdmin === 'function' ? getOptionalSupabaseAdmin() : null)
                || auth?.supabase;

            if (!supabase?.from) {
                return sendJson(res, 503, {
                    success: false,
                    message: 'Engagement notification service is unavailable'
                });
            }

            const body = typeof parseJsonBody === 'function' ? await parseJsonBody(req) : (req.body || {});
            const source = sanitizeText(body.source || body.source_type, 80).toLowerCase();
            if (!VALID_REPLY_SOURCES.has(source)) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'Invalid reply notification source'
                });
            }

            const notification = source === 'prompt_comment'
                ? await resolvePromptReplyNotification(supabase, actorUserId, body)
                : await resolveGuestbookReplyNotification(supabase, actorUserId, body);

            if (notification?.skipped) {
                return sendJson(res, 200, {
                    success: true,
                    created: 0,
                    skipped: notification.skipped
                });
            }

            const exists = await hasExistingSourceNotification(supabase, notification);
            if (exists) {
                return sendJson(res, 200, {
                    success: true,
                    created: 0,
                    skipped: 'duplicate'
                });
            }

            const result = await notifyUsers(supabase, {
                userIds: [notification.recipientId],
                title: notification.title,
                content: notification.content,
                type: 'info',
                scope: 'user_personal',
                category: notification.category,
                actionUrl: notification.actionUrl,
                actionLabel: notification.actionLabel,
                metadata: notification.metadata,
                priority: notification.priority,
                dedupeKey: notification.dedupeKey,
                sourceModule: notification.sourceModule,
                sourceEventId: notification.sourceEventId,
                dedupeWindowMinutes: 0
            });

            return sendJson(res, 200, {
                success: true,
                created: result?.created || 0,
                skipped: result?.skipped || 0
            });
        } catch (error) {
            const statusCode = Number(error?.statusCode || error?.status || 500);
            return sendJson(res, statusCode, {
                success: false,
                message: error?.message || 'Failed to create reply notification'
            });
        }
    }

    async function feedHandler(req, res) {
        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;
        if (req.method === 'OPTIONS') {
            return handleEngagementOptions(req, res, supabase);
        }
        await applyEngagementCors(req, res, supabase);
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        if (!supabase) {
            return sendJson(res, 503, {
                success: false,
                message: 'Engagement feed is unavailable'
            });
        }

        const url = new URL(req.url || '/api/public/engagement/feed', 'http://localhost');
        const user = await getOptionalUser(req);
        const userId = sanitizeText(user?.id, 160);
        const pageId = normalizePageId(url.searchParams.get('page_id') || url.searchParams.get('page'));
        const site = normalizeSite(url.searchParams.get('site') || 'cn');
        const viewerAccess = await resolveViewerAccess(supabase, user || {});
        if (userId) {
            await syncInactiveUserTagForUser(supabase, {
                userId,
                pageId,
                site,
                sourceModule: 'engagement.feed'
            });
        }
        const [userProfile, audienceSegments] = await Promise.all([
            getUserEngagementProfile(supabase, user || {}),
            fetchAudienceSegments(supabase)
        ]);
        const context = {
            pageId,
            site,
            readerKey: sanitizeText(url.searchParams.get('reader_key'), 160),
            triggerType: normalizeTriggerType(url.searchParams.get('trigger_type') || url.searchParams.get('event_type') || 'page_view'),
            triggerMetadata: {
                source_module: sanitizeText(url.searchParams.get('source_module'), 80),
                source_event_id: sanitizeText(url.searchParams.get('source_event_id'), 160),
                event_context_raw: sanitizeText(url.searchParams.get('event_context'), 1000),
                event_context: parseEventContext(url.searchParams.get('event_context'))
            },
            userId,
            userEmail: userProfile.email,
            userTags: userProfile.tags,
            viewerIsAdmin: viewerAccess.isAdmin === true,
            audienceSegments
        };

        const [ruleFeed, notifications, opsAlerts, assetCenter, supportEntry, pageSceneConfig] = await Promise.all([
            fetchRuleBubbles(supabase, context),
            context.triggerType === 'page_view' ? fetchNotificationBubbles(supabase, userId, context) : Promise.resolve([]),
            context.triggerType === 'page_view' ? fetchOpsAlertBubbles(supabase, context) : Promise.resolve([]),
            fetchAssetStyleConfig(supabase),
            fetchSupportEntryConfig(supabase),
            fetchPageSceneConfig(supabase)
        ]);
        let rules = Array.isArray(ruleFeed) ? ruleFeed : (Array.isArray(ruleFeed?.items) ? ruleFeed.items : []);
        let realtimeDeliveries = { created: 0, skipped: 0 };
        if (userId && rules.length) {
            try {
                realtimeDeliveries = await createRealtimeRuleDeliveries(supabase, context, rules);
                if (realtimeDeliveries?.deliveriesByKey instanceof Map) {
                    rules = rules.map((rule) => {
                        const deliveryKey = buildRealtimeDeliveryKey(rule, context);
                        const delivery = realtimeDeliveries.deliveriesByKey.get(deliveryKey);
                        if (!delivery?.id) return rule;
                        return {
                            ...rule,
                            delivery_id: delivery.id,
                            delivery_key: deliveryKey,
                            metadata: {
                                ...normalizeMetadata(rule.metadata),
                                delivery_id: delivery.id,
                                delivery_key: deliveryKey
                            }
                        };
                    });
                }
            } catch (error) {
                console.warn('[Engagement] Failed to create realtime deliveries:', error?.message || error);
            }
        }

        const items = [...opsAlerts, ...notifications, ...rules]
            .sort((left, right) => {
                const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
                if (priorityDelta) return priorityDelta;
                return String(right.id || '').localeCompare(String(left.id || ''));
            })
            .slice(0, Math.max(1, Math.min(10, Number(url.searchParams.get('limit') || 5) || 5)));

        if (userId) {
            await markUserActive(supabase, {
                userId,
                pageId: context.pageId,
                site: context.site,
                sourceModule: 'engagement.feed'
            });
        }

        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 200, {
            success: true,
            page_id: context.pageId,
            site: context.site,
            trigger_type: context.triggerType,
            asset_center: assetCenter,
            support_entry: supportEntry,
            event_priority_center: resolvePageEventPriorityCenter(pageSceneConfig, context.pageId),
            next_scheduled_rule_at: ruleFeed?.next_scheduled_rule_at || null,
            user_id: userId || null,
            realtime_deliveries: {
                created: Number(realtimeDeliveries?.created || 0) || 0,
                skipped: Number(realtimeDeliveries?.skipped || 0) || 0
            },
            items
        });
    }

    async function eventHandler(req, res) {
        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;
        if (req.method === 'OPTIONS') {
            return handleEngagementOptions(req, res, supabase);
        }
        await applyEngagementCors(req, res, supabase);
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        if (!supabase) {
            return sendJson(res, 202, {
                success: true,
                recorded: false
            });
        }

        const body = typeof parseJsonBody === 'function' ? await parseJsonBody(req) : (req.body || {});
        const eventType = sanitizeText(body.event_type || body.type, 40).toLowerCase();
        if (!VALID_EVENTS.has(eventType)) {
            return sendJson(res, 400, {
                success: false,
                message: 'Invalid engagement event'
            });
        }

        const user = await getOptionalUser(req);
        const userId = sanitizeText(user?.id, 160) || null;
        const ruleId = sanitizeText(body.rule_id, 160) || null;
        const notificationId = sanitizeText(body.notification_id, 160) || null;
        const deliveryId = sanitizeText(body.delivery_id || body.deliveryId, 160) || null;
        const pageId = normalizePageId(body.page_id || body.page);
        const site = normalizeSite(body.site || 'cn');
        const readerKey = sanitizeText(body.reader_key, 160);
        const metadata = normalizeMetadata(body.metadata);
        const eventMetadata = {
            ...metadata,
            delivery_id: deliveryId || sanitizeText(metadata.delivery_id || metadata.deliveryId, 160)
        };
        if (userId) {
            await markUserActive(supabase, {
                userId,
                pageId,
                site,
                sourceModule: 'engagement.event'
            });
        }

        let recorded = false;
        try {
            const { error } = await supabase
                .from('engagement_events')
                .insert({
                    rule_id: ruleId,
                    notification_id: notificationId,
                    user_id: userId,
                    reader_key: readerKey,
                    page_id: pageId,
                    site,
                    event_type: eventType,
                    source_module: sanitizeText(body.source_module || metadata.source_module || 'engagement', 80) || 'engagement',
                    source_event_id: sanitizeText(body.source_event_id || metadata.source_event_id, 160),
                    metadata: eventMetadata
                });
            if (error) throw error;
            recorded = true;
        } catch (error) {
            if (!isMissingRelationOrColumnError(error, 'engagement_events')) {
                throw error;
            }
        }

        if (notificationId && ['click', 'conversion'].includes(eventType)) {
            await supabase
                .from('system_notifications')
                .update({ is_read: true })
                .eq('id', notificationId)
                .eq('user_id', userId || '');
        }

        if (deliveryId && userId) {
            const nowIso = new Date().toISOString();
            const deliveryPatch = eventType === 'view'
                ? { status: 'viewed', viewed_at: nowIso }
                : eventType === 'click'
                    ? { status: 'clicked', clicked_at: nowIso }
                    : eventType === 'dismiss'
                        ? { status: 'dismissed', dismissed_at: nowIso }
                        : null;
            if (deliveryPatch) {
                const { error } = await supabase
                    .from('engagement_deliveries')
                    .update(deliveryPatch)
                    .eq('id', deliveryId)
                    .eq('user_id', userId);
                if (error && !isMissingRelationOrColumnError(error, 'engagement_deliveries')) {
                    throw error;
                }
            }
        }

        return sendJson(res, 200, {
            success: true,
            recorded
        });
    }

    return {
        feed: feedHandler,
        event: eventHandler,
        'reply-notify': replyNotifyHandler
    };
}

module.exports = {
    createPublicEngagementHandlers
};
