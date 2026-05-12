(function initAdminEngagement(globalScope) {
    'use strict';

    const PAGE_LABELS = {
        home: '首页',
        prompts: '提示词',
        gongyi: 'API中转',
        shop: '商城',
        verify: '验证',
        guestbook: '留言板',
        all: '全站'
    };

    const EVENT_LABELS = {
        page_view: '进入页面',
        new_user_welcome: '新用户欢迎',
        profile_incomplete: '资料待完善',
        daily_checkin_available: '签到提醒',
        inactive_user_return: '回流唤醒',
        points_low_balance: '积分偏低',
        points_adjusted: '积分变动',
        points_insufficient: '积分不足',
        wallet_recharge_success: '充值成功',
        wallet_recharge_failed: '充值失败',
        comment_replied: '评论被回复',
        message_replied: '留言被回复',
        guestbook_mention: '留言提及',
        coupon_available: '可领优惠券',
        coupon_expiring: '优惠券将过期',
        product_discount: '商品折扣',
        product_discount_available: '商品折扣可用',
        product_restocked: '补货提醒',
        cart_abandoned: '购物车挽回',
        order_paid: '订单已支付',
        permission_changed: '权限变更',
        prompt_unlocked: '内容解锁',
        search_no_result: '搜索无结果',
        content_moderated: '内容处理结果',
        order_status: '订单状态',
        order_delivered: '订单已交付',
        refund_status: '退款状态',
        verify_failed: '验证失败',
        verify_success: '验证成功',
        verify_queue: '验证排队',
        verification_expiring: '验证即将过期',
        service_status: '服务状态',
        usage_rules: '使用规则',
        maintenance_notice: '维护公告',
        community_rule: '社区规则',
        content_featured: '内容精选',
        payment_failed: '支付失败',
        support_reply: '客服回复',
        ticket_updated: '工单进展',
        login_risk: '登录风险'
    };

    const RULE_PAGE_OPTIONS = ['all', 'home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook'];
    const SAFE_ZONE_OPTIONS = [
        ['bottom-right', '右下角'],
        ['bottom-left', '左下角'],
        ['top-right', '右上角'],
        ['top-left', '左上角']
    ];
    const PAGE_SCENE_EVENT_OPTIONS = [
        'new_user_welcome',
        'profile_incomplete',
        'daily_checkin_available',
        'inactive_user_return',
        'points_low_balance',
        'points_adjusted',
        'points_insufficient',
        'wallet_recharge_success',
        'wallet_recharge_failed',
        'comment_replied',
        'message_replied',
        'guestbook_mention',
        'coupon_available',
        'coupon_expiring',
        'product_discount',
        'product_discount_available',
        'product_restocked',
        'cart_abandoned',
        'order_paid',
        'permission_changed',
        'prompt_unlocked',
        'search_no_result',
        'content_moderated',
        'order_status',
        'order_delivered',
        'refund_status',
        'payment_failed',
        'verify_failed',
        'verify_success',
        'verify_queue',
        'verification_expiring',
        'service_status',
        'usage_rules',
        'maintenance_notice',
        'community_rule',
        'content_featured',
        'support_reply',
        'ticket_updated',
        'login_risk'
    ];
    const EVENT_PRIORITY_CLASSES = Object.freeze({
        first_wave: {
            label: '首波优先',
            shortLabel: '优先',
            desc: '登录后首波窗口会优先挑这一类事件，适合风险、支付、售后、客服回应。',
            tone: 'alert',
            events: ['login_risk', 'payment_failed', 'wallet_recharge_failed', 'verify_failed', 'support_reply', 'ticket_updated', 'refund_status', 'order_status', 'order_paid', 'order_delivered', 'content_moderated']
        },
        service: {
            label: '常规服务',
            shortLabel: '服务',
            desc: '首波优先级次于风险类，适合账户状态、规则说明、积分变化和留言回复。',
            tone: 'info',
            events: ['verification_expiring', 'permission_changed', 'points_adjusted', 'points_insufficient', 'verify_queue', 'message_replied', 'comment_replied', 'guestbook_mention', 'service_status', 'maintenance_notice', 'usage_rules', 'community_rule']
        },
        marketing: {
            label: '延后营销',
            shortLabel: '营销',
            desc: '登录后不会抢首条提醒，通常会在用户看完首条或首波窗口结束后再出现。',
            tone: 'warning',
            events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_discount_available', 'product_restocked', 'cart_abandoned', 'inactive_user_return']
        },
        guidance: {
            label: '体验引导',
            shortLabel: '引导',
            desc: '更适合做新手说明、资料补全、签到和功能路径提示，不应压过风险/售后提醒。',
            tone: 'success',
            events: ['verify_success', 'prompt_unlocked', 'search_no_result', 'profile_incomplete', 'daily_checkin_available', 'new_user_welcome', 'points_low_balance', 'content_featured', 'wallet_recharge_success']
        }
    });
    const DEFAULT_PAGE_SCENES = Object.freeze([
        {
            id: 'home',
            label: '首页',
            tone: 'welcome',
            safe_zone: 'bottom-right',
            events: ['new_user_welcome', 'profile_incomplete', 'daily_checkin_available', 'inactive_user_return', 'points_low_balance', 'points_adjusted', 'wallet_recharge_success', 'permission_changed', 'login_risk']
        },
        {
            id: 'prompts',
            label: '提示词',
            tone: 'creative',
            safe_zone: 'bottom-right',
            events: ['points_insufficient', 'comment_replied', 'prompt_unlocked', 'search_no_result', 'content_featured', 'content_moderated']
        },
        {
            id: 'gongyi',
            label: 'API中转',
            tone: 'calm',
            safe_zone: 'bottom-right',
            events: ['service_status', 'usage_rules', 'maintenance_notice', 'community_rule', 'support_reply', 'ticket_updated']
        },
        {
            id: 'shop',
            label: '商城',
            tone: 'commerce',
            safe_zone: 'bottom-right',
            events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_discount_available', 'product_restocked', 'cart_abandoned', 'points_insufficient', 'payment_failed', 'order_paid', 'order_status', 'order_delivered', 'refund_status']
        },
        {
            id: 'verify',
            label: '验证',
            tone: 'assistive',
            safe_zone: 'bottom-right',
            events: ['verify_failed', 'verify_success', 'verify_queue', 'verification_expiring', 'points_insufficient', 'service_status', 'support_reply', 'ticket_updated']
        },
        {
            id: 'guestbook',
            label: '留言板',
            tone: 'community',
            safe_zone: 'bottom-right',
            events: ['comment_replied', 'message_replied', 'guestbook_mention', 'community_rule', 'content_featured', 'content_moderated']
        }
    ]);
    const RULE_TONE_OPTIONS = [
        ['info', '信息'],
        ['success', '成功'],
        ['warning', '提醒'],
        ['alert', '警示'],
        ['welcome', '欢迎'],
        ['creative', '提示词'],
        ['calm', 'API中转'],
        ['commerce', '商城'],
        ['assistive', '验证'],
        ['community', '社区']
    ];
    const RULE_STATUS_OPTIONS = [
        ['draft', '草稿'],
        ['published', '发布'],
        ['paused', '暂停'],
        ['archived', '归档']
    ];
    const RULE_FILTER_STATUS_OPTIONS = [
        ['all', '全部状态'],
        ['running', '运行中'],
        ['scheduled', '定时发布'],
        ['draft', '草稿'],
        ['published', '已发布'],
        ['paused', '已暂停'],
        ['archived', '已归档']
    ];
    const RULE_HEALTH_FILTER_OPTIONS = [
        ['all', '全部健康'],
        ['needs_attention', '需关注'],
        ['high_risk', '高风险'],
        ['missing_link', '缺少链接'],
        ['no_views', '无曝光'],
        ['low_ctr', '点击率低'],
        ['high_dismiss', '关闭率高'],
        ['paused_or_draft', '未运行'],
        ['healthy', '正常/良好']
    ];
    const RULE_SORT_OPTIONS = [
        ['updated_desc', '最近更新'],
        ['priority_desc', '优先级高到低'],
        ['priority_asc', '优先级低到高'],
        ['name_asc', '名称 A-Z']
    ];
    const RULE_DUPLICATE_GROUP_COLORS = [
        '#f59e0b',
        '#3b82f6',
        '#10b981',
        '#8b5cf6',
        '#ef4444',
        '#14b8a6'
    ];
    const AUDIENCE_SCOPE_OPTIONS = [
        ['all', '全部用户'],
        ['visitors', '游客'],
        ['authenticated', '登录用户'],
        ['new_users', '新注册用户'],
        ['recharged', '已充值用户'],
        ['not_recharged', '未充值用户'],
        ['high_value', '高价值用户'],
        ['inactive', '长期未活跃用户']
    ];
    const SEGMENT_SCENARIO_OPTIONS = Object.freeze([
        {
            id: 'site_announcement',
            label: '站点公告',
            audienceScope: 'all',
            eventKey: 'maintenance_notice'
        },
        {
            id: 'visitor_register_prompt',
            label: '游客注册引导',
            audienceScope: 'visitors',
            eventKey: 'new_user_welcome'
        },
        {
            id: 'new_user_welcome',
            label: '新用户欢迎',
            audienceScope: 'new_users',
            eventKey: 'new_user_welcome'
        },
        {
            id: 'points_insufficient_help',
            label: '积分不足提醒',
            audienceScope: 'authenticated',
            eventKey: 'points_insufficient'
        },
        {
            id: 'coupon_available_notice',
            label: '优惠券可领取',
            audienceScope: 'authenticated',
            eventKey: 'coupon_available'
        },
        {
            id: 'payment_failed_recovery',
            label: '支付失败挽回',
            audienceScope: 'payment_failed',
            tagKey: 'payment_failed',
            eventKey: 'payment_failed'
        },
        {
            id: 'wallet_recharge_thanks',
            label: '充值成功关怀',
            audienceScope: 'recharged',
            tagKey: 'paid_user',
            eventKey: 'wallet_recharge_success'
        },
        {
            id: 'wallet_recharge_failed_help',
            label: '充值失败帮助',
            audienceScope: 'authenticated',
            tagKey: 'payment_failed',
            eventKey: 'wallet_recharge_failed'
        },
        {
            id: 'cart_abandon_recovery',
            label: '购物车挽回',
            audienceScope: 'authenticated',
            eventKey: 'cart_abandoned'
        },
        {
            id: 'coupon_expiring_notice',
            label: '优惠券过期提醒',
            audienceScope: 'authenticated',
            eventKey: 'coupon_expiring'
        },
        {
            id: 'daily_checkin_reminder',
            label: '每日签到提醒',
            audienceScope: 'authenticated',
            eventKey: 'daily_checkin_available'
        },
        {
            id: 'profile_completion',
            label: '资料完善引导',
            audienceScope: 'authenticated',
            eventKey: 'profile_incomplete'
        },
        {
            id: 'verify_failed_help',
            label: '验证失败帮助',
            audienceScope: 'verify_failed',
            tagKey: 'verify_failed',
            eventKey: 'verify_failed'
        },
        {
            id: 'inactive_user_return',
            label: '长期未活跃回流',
            audienceScope: 'inactive',
            tagKey: 'inactive_user',
            eventKey: 'page_view'
        },
        {
            id: 'search_no_result_help',
            label: '搜索无结果引导',
            audienceScope: 'authenticated',
            eventKey: 'search_no_result'
        },
        {
            id: 'content_moderation_result',
            label: '内容处理结果',
            audienceScope: 'authenticated',
            eventKey: 'content_moderated'
        },
        {
            id: 'reply_notification',
            label: '留言/评论回复',
            audienceScope: 'authenticated',
            eventKey: 'message_replied'
        },
        {
            id: 'order_status_notice',
            label: '订单状态提醒',
            audienceScope: 'authenticated',
            eventKey: 'order_status'
        },
        {
            id: 'order_delivered_followup',
            label: '交付完成回访',
            audienceScope: 'authenticated',
            eventKey: 'order_delivered'
        },
        {
            id: 'refund_status_update',
            label: '退款状态同步',
            audienceScope: 'authenticated',
            eventKey: 'refund_status'
        },
        {
            id: 'paid_user_benefit',
            label: '已充值用户权益',
            audienceScope: 'recharged',
            tagKey: 'paid_user',
            eventKey: 'permission_changed'
        },
        {
            id: 'high_value_care',
            label: '高价值用户关怀',
            audienceScope: 'high_value',
            tagKey: 'high_value',
            eventKey: 'product_discount'
        },
        {
            id: 'service_status_notice',
            label: '服务状态通知',
            audienceScope: 'all',
            eventKey: 'service_status'
        },
        {
            id: 'ticket_progress_update',
            label: '工单进展提醒',
            audienceScope: 'authenticated',
            eventKey: 'ticket_updated'
        },
        {
            id: 'login_risk_alert',
            label: '登录风险提醒',
            audienceScope: 'authenticated',
            eventKey: 'login_risk'
        }
    ]);
    const SEGMENT_SCENARIO_ALIASES = Object.freeze({
        站点公告: 'site_announcement',
        新功能说明: 'site_announcement',
        服务维护: 'service_status_notice',
        注册引导: 'visitor_register_prompt',
        游客限制说明: 'visitor_register_prompt',
        新手福利: 'visitor_register_prompt',
        新手引导: 'new_user_welcome',
        首次充值说明: 'new_user_welcome',
        使用路径: 'new_user_welcome',
        积分不足: 'points_insufficient_help',
        首充权益: 'points_insufficient_help',
        套餐说明: 'points_insufficient_help',
        充值成功: 'wallet_recharge_thanks',
        充值失败: 'wallet_recharge_failed_help',
        每日签到: 'daily_checkin_reminder',
        资料完善: 'profile_completion',
        可领优惠券: 'coupon_available_notice',
        优惠券过期: 'coupon_expiring_notice',
        购物车挽回: 'cart_abandon_recovery',
        专属折扣: 'high_value_care',
        高级权限: 'high_value_care',
        优先客服: 'high_value_care',
        回流优惠: 'inactive_user_return',
        账户唤醒: 'inactive_user_return',
        搜索无结果: 'search_no_result_help',
        内容审核: 'content_moderation_result',
        钱包入口: 'paid_user_benefit',
        订单状态: 'order_status_notice',
        交付完成: 'order_delivered_followup',
        退款状态: 'refund_status_update',
        消息回复: 'reply_notification',
        工单进展: 'ticket_progress_update',
        登录风险: 'login_risk_alert'
    });
    const TRIGGER_TYPE_OPTIONS = [
        ['page_view', '进入页面'],
        ['time_on_page', '停留触发'],
        ['scroll_depth', '滚动触发'],
        ['click_action', '点击触发'],
        ['new_user_welcome', '新用户欢迎'],
        ['points_low_balance', '积分偏低'],
        ['points_adjusted', '积分变动'],
        ['points_insufficient', '积分不足'],
        ['coupon_available', '可领优惠券'],
        ['coupon_expiring', '优惠券将过期'],
        ['product_discount', '商品折扣'],
        ['product_discount_available', '商品折扣可用'],
        ['product_restocked', '补货提醒'],
        ['cart_abandoned', '购物车挽回'],
        ['comment_replied', '评论被回复'],
        ['message_replied', '留言被回复'],
        ['guestbook_mention', '留言提及'],
        ['wallet_recharge_success', '充值成功'],
        ['wallet_recharge_failed', '充值失败'],
        ['payment_failed', '支付失败'],
        ['order_paid', '订单已支付'],
        ['order_status', '订单状态'],
        ['order_delivered', '订单已交付'],
        ['refund_status', '退款状态'],
        ['permission_changed', '权限变更'],
        ['prompt_unlocked', '内容解锁'],
        ['verify_failed', '验证失败'],
        ['verify_success', '验证成功'],
        ['verify_queue', '验证排队'],
        ['verification_expiring', '验证即将过期'],
        ['profile_incomplete', '资料待完善'],
        ['daily_checkin_available', '签到提醒'],
        ['inactive_user_return', '回流唤醒'],
        ['search_no_result', '搜索无结果'],
        ['content_moderated', '内容处理结果'],
        ['support_reply', '客服回复'],
        ['ticket_updated', '工单进展'],
        ['login_risk', '登录风险'],
        ['service_status', '服务状态'],
        ['usage_rules', '使用规则'],
        ['maintenance_notice', '维护公告'],
        ['community_rule', '社区规则'],
        ['content_featured', '内容精选']
    ];
    const DISPLAY_PLACEMENT_OPTIONS = [
        ['robot_bubble', '机器人气泡'],
        ['top_banner', '顶部横幅'],
        ['inline_card', '提示卡片'],
        ['modal', '小弹窗'],
        ['floating_badge', '浮动角标']
    ];
    const ASSET_TYPE_OPTIONS = [
        ['icon', '图标'],
        ['badge', '角标'],
        ['image', '图片'],
        ['illustration', '插画']
    ];
    const STYLE_DENSITY_OPTIONS = [
        ['compact', '紧凑'],
        ['comfortable', '舒适'],
        ['spacious', '宽松']
    ];
    const STYLE_SHADOW_OPTIONS = [
        ['none', '无阴影'],
        ['soft', '柔和'],
        ['elevated', '高浮层']
    ];
    const STYLE_ANIMATION_OPTIONS = [
        ['none', '无动画'],
        ['gentle', '轻动效'],
        ['lively', '活跃']
    ];
    const COLOR_PRESET_OPTIONS = [
        ['custom', '自定义'],
        ['#6b9ece', 'Studio 蓝'],
        ['#5f95cc', '柔和标题蓝'],
        ['#10b981', '成功绿'],
        ['#f59e0b', '提示橙'],
        ['#8b5cf6', '社群紫'],
        ['#1f2937', '深色正文'],
        ['#ffffff', '白色']
    ];
    const ROBOT_VARIANT_OPTIONS = [
        ['default', '默认机器人'],
        ['rounded', '圆润机器人'],
        ['minimal', '极简机器人']
    ];
    const SUPPORT_CONTEXT_OPTIONS = [
        ['default', '默认入口'],
        ['home', '首页'],
        ['prompts', '提示词'],
        ['gongyi', 'API中转'],
        ['shop', '商城'],
        ['verify', '验证'],
        ['guestbook', '留言板']
    ];
    const EXTERNAL_PAGE_OPTIONS = [
        ['gongyi', 'API中转'],
        ['home', '首页'],
        ['prompts', '提示词'],
        ['shop', '商城'],
        ['verify', '验证'],
        ['guestbook', '留言板']
    ];
    const SITE_OPTIONS = [
        ['cn', 'CN'],
        ['intl', 'Intl']
    ];
    const SUPPORT_ACTION_OPTIONS = [
        ['code_status', '查兑换码状态'],
        ['redeem_code', '立即兑换'],
        ['afdian_lookup', '爱发电找回'],
        ['shop_order_status', '查订单状态'],
        ['shop_order_content', '查看已发放内容'],
        ['discount_help', '优惠码帮助'],
        ['verify_task_status', '查验证进度'],
        ['verify_failure_help', '验证失败原因'],
        ['verify_precheck', '重提前检查'],
        ['create_ticket', '提交问题工单'],
        ['tg_support', 'TG 人工客服'],
        ['live_chat', '在线客服']
    ];
    const USER_TAG_SOURCE_OPTIONS = [
        ['manual', '手动打标'],
        ['profile_metadata', '用户资料 metadata'],
        ['auth_metadata', '登录账户 metadata'],
        ['purchase', '购买/充值'],
        ['wallet', '钱包/积分'],
        ['behavior', '行为事件'],
        ['support', '客服/工单']
    ];
    const AUDIENCE_SEGMENTS = Object.freeze([
        {
            id: 'all',
            title: '全部用户',
            desc: '适合全站运营提示、维护说明和普适功能引导。',
            icon: 'fa-earth-asia',
            pageIds: ['all'],
            examples: ['站点公告', '新功能说明', '服务维护']
        },
        {
            id: 'visitors',
            title: '游客',
            desc: '尚未登录或注册的访问者，适合注册福利、功能价值说明。',
            icon: 'fa-user-clock',
            pageIds: ['home', 'prompts'],
            examples: ['注册引导', '游客限制说明', '新手福利']
        },
        {
            id: 'authenticated',
            title: '登录用户',
            desc: '已登录用户，适合账户、钱包、订单、回复等个性化提示。',
            icon: 'fa-user-check',
            pageIds: ['home', 'shop', 'guestbook'],
            examples: ['消息回复', '钱包入口', '订单状态']
        },
        {
            id: 'new_users',
            title: '新注册用户',
            desc: '适合首次访问、功能路径说明和低打扰新手引导。',
            icon: 'fa-seedling',
            pageIds: ['home'],
            examples: ['新手引导', '首次充值说明', '使用路径']
        },
        {
            id: 'not_recharged',
            title: '未充值用户',
            desc: '适合积分不足、套餐价值和首充权益说明。',
            icon: 'fa-wallet',
            pageIds: ['prompts', 'shop', 'verify'],
            examples: ['积分不足', '首充权益', '套餐说明']
        },
        {
            id: 'high_value',
            title: '高价值用户',
            desc: '适合专属优惠、权限变更和客服优先响应。',
            icon: 'fa-gem',
            pageIds: ['shop', 'home'],
            examples: ['专属折扣', '高级权限', '优先客服']
        },
        {
            id: 'inactive',
            title: '长期未活跃用户',
            desc: '适合回流优惠、功能更新提醒和账户状态召回。',
            icon: 'fa-user-clock',
            pageIds: ['home', 'shop'],
            examples: ['回流优惠', '新功能提醒', '账户唤醒']
        }
    ]);
    const AUTOMATION_BLUEPRINTS = Object.freeze([
        {
            id: 'visitor_register_prompt',
            title: '游客注册引导',
            desc: '游客进入首页或提示词页时，用低打扰气泡提示注册权益。',
            icon: 'fa-user-plus',
            triggerType: 'page_view',
            audienceScope: 'visitors',
            pageIds: ['home', 'prompts'],
            tone: 'welcome',
            titleText: '欢迎来到 zaoyoe',
            content: '注册后可以保存浏览记录、查看专属内容，并接收账户相关提醒。',
            actionLabel: '去注册',
            actionUrl: 'auth://register',
            priority: 8,
            dismissTtlHours: 24,
            mode: '页面触发'
        },
        {
            id: 'new_user_welcome',
            title: '新用户首访欢迎',
            desc: '新注册用户首次进入首页时，给出钱包、商城和提示词入口。',
            icon: 'fa-seedling',
            triggerType: 'page_view',
            audienceScope: 'new_users',
            pageIds: ['home'],
            semanticFamily: 'new_user_welcome',
            intentLabel: '新用户欢迎',
            tone: 'welcome',
            titleText: '欢迎加入 zaoyoe',
            content: '你可以从提示词、商城和钱包开始。系统会在关键位置给你必要说明。',
            actionLabel: '查看提示词',
            actionUrl: '/prompts.html',
            priority: 12,
            dismissTtlHours: 72,
            mode: '页面触发'
        },
        {
            id: 'profile_completion',
            title: '资料完善引导',
            desc: '登录用户资料不完整时，提醒补充昵称、联系方式和售后识别信息。',
            icon: 'fa-address-card',
            triggerType: 'profile_incomplete',
            audienceScope: 'authenticated',
            pageIds: ['home'],
            tone: 'welcome',
            titleText: '完善资料后体验会更顺',
            content: '补全资料后，我能更准确地识别你的订单、权益和客服上下文。',
            actionLabel: '完善资料',
            actionUrl: 'account://profile',
            priority: 16,
            dismissTtlHours: 48,
            mode: '事件触发'
        },
        {
            id: 'daily_checkin_reminder',
            title: '每日签到提醒',
            desc: '当用户当天还有签到权益时，用轻提示引导补充积分余额。',
            icon: 'fa-calendar-check',
            triggerType: 'daily_checkin_available',
            audienceScope: 'authenticated',
            pageIds: ['home'],
            tone: 'success',
            titleText: '今天的签到奖励还没领',
            content: '签到可以补充积分余额，适合在使用提示词、验证或下单前先领取。',
            actionLabel: '去签到',
            actionUrl: 'wallet://checkin',
            priority: 14,
            dismissTtlHours: 22,
            mode: '事件触发'
        },
        {
            id: 'points_low_balance_notice',
            title: '积分偏低预警',
            desc: '积分即将不足但还未阻断操作时，提前提示充值、签到或套餐入口。',
            icon: 'fa-gauge-simple-low',
            triggerType: 'points_low_balance',
            audienceScope: 'authenticated',
            pageIds: ['home', 'prompts', 'shop', 'verify'],
            tone: 'info',
            titleText: '积分余额有点低',
            content: '继续使用前可以先查看钱包，签到或充值都能减少中途被打断的情况。',
            actionLabel: '查看积分',
            actionUrl: 'wallet://balance',
            priority: 18,
            dismissTtlHours: 12,
            mode: '事件触发'
        },
        {
            id: 'points_adjusted_notice',
            title: '积分变动通知',
            desc: '客服后台补发、扣减或修正积分后，立即把变化原因和余额反馈给用户。',
            icon: 'fa-hand-holding-dollar',
            triggerType: 'points_adjusted',
            audienceScope: 'authenticated',
            pageIds: ['home', 'prompts', 'shop', 'verify'],
            tone: 'info',
            titleText: '你的积分有更新',
            content: '客服刚刚调整了你的积分余额。可以查看钱包确认当前可用额度，再继续后续操作。',
            actionLabel: '查看积分',
            actionUrl: 'wallet://balance',
            priority: 22,
            dismissTtlHours: 8,
            mode: '事件触发'
        },
        {
            id: 'points_insufficient_help',
            title: '积分不足提醒',
            desc: '解锁、验证或购买时积分不足，提示充值或查看套餐。',
            icon: 'fa-coins',
            triggerType: 'points_insufficient',
            audienceScope: 'authenticated',
            pageIds: ['prompts', 'shop', 'verify'],
            tone: 'warning',
            titleText: '积分不足',
            content: '当前积分不足以完成本次操作，可以前往钱包查看充值和套餐选项。',
            actionLabel: '我的钱包 > 积分',
            actionUrl: 'wallet://points',
            priority: 30,
            dismissTtlHours: 6,
            mode: '事件触发'
        },
        {
            id: 'wallet_recharge_thanks',
            title: '充值成功关怀',
            desc: '充值成功后主动告知余额、订单和下一步可使用的权益入口。',
            icon: 'fa-wallet',
            triggerType: 'wallet_recharge_success',
            audienceScope: 'recharged',
            pageIds: ['home', 'shop'],
            tone: 'success',
            titleText: '充值已到账',
            content: '积分已经更新，可以继续查看订单、解锁内容或使用验证服务。',
            actionLabel: '查看钱包',
            actionUrl: 'wallet://balance',
            priority: 26,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'wallet_recharge_failed_help',
            title: '充值失败帮助',
            desc: '充值失败后给出重试、订单记录和客服排查入口，降低用户不确定感。',
            icon: 'fa-credit-card',
            triggerType: 'wallet_recharge_failed',
            audienceScope: 'authenticated',
            pageIds: ['home', 'shop'],
            tone: 'warning',
            titleText: '充值没有完成',
            content: '这笔充值可能没有成功到账。你可以查看钱包记录，或把订单信息发给客服排查。',
            actionLabel: '查看订单记录',
            actionUrl: 'wallet://orders',
            priority: 34,
            dismissTtlHours: 6,
            mode: '事件触发'
        },
        {
            id: 'coupon_available_notice',
            title: '可领优惠券提醒',
            desc: '商城出现可领券商品时，引导用户前往钱包卡券或商品页。',
            icon: 'fa-ticket',
            triggerType: 'coupon_available',
            audienceScope: 'authenticated',
            pageIds: ['shop'],
            semanticFamily: 'shop_discount_ready',
            intentLabel: '商城优惠提醒',
            tone: 'commerce',
            titleText: '有优惠券可领取',
            content: '这件商品有可用优惠，可以先领取再下单。',
            actionLabel: '我的钱包 > 卡券',
            actionUrl: 'wallet://cards',
            priority: 28,
            dismissTtlHours: 12,
            mode: '事件触发'
        },
        {
            id: 'coupon_expiring_notice',
            title: '优惠券过期提醒',
            desc: '用户持有的优惠券即将过期时，引导查看卡券并完成下单。',
            icon: 'fa-hourglass-half',
            triggerType: 'coupon_expiring',
            audienceScope: 'authenticated',
            pageIds: ['shop'],
            tone: 'warning',
            titleText: '有优惠券快过期了',
            content: '你的部分优惠券即将失效，可以先查看卡券，再决定是否用于当前商品。',
            actionLabel: '查看卡券',
            actionUrl: 'wallet://cards',
            priority: 31,
            dismissTtlHours: 8,
            mode: '事件触发'
        },
        {
            id: 'cart_abandon_recovery',
            title: '购物车挽回',
            desc: '用户把商品留在购物车后离开或长时间未下单，提示继续完成购买。',
            icon: 'fa-cart-shopping',
            triggerType: 'cart_abandoned',
            audienceScope: 'authenticated',
            pageIds: ['shop'],
            tone: 'commerce',
            titleText: '购物车里还有未完成的商品',
            content: '你刚才挑选的商品还在，可以继续结算，或先看看是否有可用优惠。',
            actionLabel: '回到商城',
            actionUrl: '/shop.html#cart',
            priority: 29,
            dismissTtlHours: 18,
            mode: '事件触发'
        },
        {
            id: 'order_status_notice',
            title: '订单状态更新',
            desc: '订单支付、处理中或状态变化时，引导用户查看钱包订单记录。',
            icon: 'fa-receipt',
            triggerType: 'order_status',
            audienceScope: 'authenticated',
            pageIds: ['shop', 'home'],
            semanticFamily: 'order_lifecycle',
            intentLabel: '订单进度提醒',
            tone: 'info',
            titleText: '订单状态已更新',
            content: '你的订单有新的处理状态，可以在钱包订单记录里查看详情。',
            actionLabel: '查看订单',
            actionUrl: 'wallet://orders',
            priority: 30,
            dismissTtlHours: 12,
            mode: '事件触发'
        },
        {
            id: 'order_delivered_followup',
            title: '订单交付完成提醒',
            desc: '订单交付后提示查看内容、保存凭证或发起售后，形成服务闭环。',
            icon: 'fa-box-open',
            triggerType: 'order_delivered',
            audienceScope: 'authenticated',
            pageIds: ['shop', 'home'],
            semanticFamily: 'order_lifecycle',
            intentLabel: '订单进度提醒',
            tone: 'success',
            titleText: '订单已完成交付',
            content: '你可以查看订单记录保存凭证。如果内容不符合预期，也可以继续联系站内客服。',
            actionLabel: '查看订单',
            actionUrl: 'wallet://orders',
            priority: 27,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'refund_status_update',
            title: '退款进度提醒',
            desc: '退款进度发生变化时，通过机器人把用户带回订单记录和客服上下文。',
            icon: 'fa-rotate-left',
            triggerType: 'refund_status',
            audienceScope: 'authenticated',
            pageIds: ['shop', 'home'],
            semanticFamily: 'order_lifecycle',
            intentLabel: '订单进度提醒',
            tone: 'info',
            titleText: '退款进度有更新',
            content: '你的退款申请有新的处理进展，可以查看订单记录，必要时继续补充说明。',
            actionLabel: '查看记录',
            actionUrl: 'wallet://orders',
            priority: 33,
            dismissTtlHours: 8,
            mode: '事件触发'
        },
        {
            id: 'payment_failed_recovery',
            title: '支付失败挽回',
            desc: '用户近期支付失败达到阈值后，引导重试支付、查看钱包或联系人工客服。',
            icon: 'fa-credit-card',
            triggerType: 'payment_failed',
            audienceScope: 'payment_failed',
            pageIds: ['shop', 'home'],
            tone: 'warning',
            titleText: '支付没有完成',
            content: '刚才的支付可能没有成功。你可以重新下单，或把订单号发给客服帮你排查。',
            actionLabel: '查看商城',
            actionUrl: '/shop.html',
            priority: 36,
            dismissTtlHours: 6,
            mode: '事件触发'
        },
        {
            id: 'inactive_user_return',
            title: '长期未活跃回流',
            desc: '用户超过未活跃阈值后再次访问，用低打扰气泡提示新内容、优惠或账户入口。',
            icon: 'fa-user-clock',
            triggerType: 'page_view',
            audienceScope: 'inactive',
            pageIds: ['home', 'shop'],
            semanticFamily: 'inactive_return',
            intentLabel: '回流唤醒',
            tone: 'welcome',
            titleText: '欢迎回来',
            content: '这里最近更新了一些内容和权益，你可以先看看钱包卡券或商城优惠。',
            actionLabel: '我的钱包 > 卡券',
            actionUrl: 'wallet://cards',
            priority: 24,
            dismissTtlHours: 72,
            mode: '页面触发'
        },
        {
            id: 'high_value_care',
            title: '高价值用户关怀',
            desc: '高价值用户访问商城或首页时，展示专属权益、优先客服和折扣入口。',
            icon: 'fa-gem',
            triggerType: 'product_discount',
            audienceScope: 'high_value',
            pageIds: ['home', 'shop'],
            tone: 'commerce',
            titleText: '这里有你的专属权益',
            content: '你可以优先查看专属折扣和客服支持，适合处理高价值订单或续费需求。',
            actionLabel: '查看卡券',
            actionUrl: 'wallet://cards',
            priority: 38,
            dismissTtlHours: 48,
            mode: '事件触发'
        },
        {
            id: 'reply_notification',
            title: '留言回复提醒',
            desc: '留言板内容被回复后，通过机器人气泡把用户带回对应页面。',
            icon: 'fa-comments',
            triggerType: 'message_replied',
            audienceScope: 'authenticated',
            pageIds: ['guestbook', 'prompts'],
            semanticFamily: 'reply_followup',
            intentLabel: '互动回复提醒',
            tone: 'community',
            titleText: '有人回复了你',
            content: '你的留言或评论有新回复，点击即可回到对应内容。',
            actionLabel: '查看回复',
            actionUrl: '/guestbook.html',
            priority: 32,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'search_no_result_help',
            title: '搜索无结果引导',
            desc: '提示词或内容搜索无结果时，给出改写建议、精选内容或客服入口。',
            icon: 'fa-magnifying-glass-chart',
            triggerType: 'search_no_result',
            audienceScope: 'authenticated',
            pageIds: ['prompts'],
            tone: 'creative',
            titleText: '没搜到合适内容？',
            content: '可以换一个关键词，或者先看精选内容。我也可以帮你判断该怎么描述需求。',
            actionLabel: '查看精选',
            actionUrl: '/prompts.html#featured',
            priority: 20,
            dismissTtlHours: 6,
            mode: '事件触发'
        },
        {
            id: 'content_moderation_result',
            title: '内容处理结果',
            desc: '内容被处理、解锁或精选状态变化时，用机器人解释结果和下一步。',
            icon: 'fa-file-circle-check',
            triggerType: 'content_moderated',
            audienceScope: 'authenticated',
            pageIds: ['prompts', 'guestbook'],
            tone: 'community',
            titleText: '内容处理结果已更新',
            content: '你的内容状态有变化，可以查看详情；如果有疑问，也可以继续联系站内客服。',
            actionLabel: '查看内容',
            actionUrl: '/prompts.html',
            priority: 25,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'verify_failed_help',
            title: '验证失败帮助',
            desc: '验证失败后给出原因说明、重试入口和客服引导。',
            icon: 'fa-shield-halved',
            triggerType: 'verify_failed',
            audienceScope: 'authenticated',
            pageIds: ['verify'],
            tone: 'assistive',
            titleText: '验证未通过',
            content: '请检查上传内容和验证规则。如果多次失败，可以联系站内客服处理。',
            actionLabel: '查看验证说明',
            actionUrl: '/verify.html#help',
            priority: 35,
            dismissTtlHours: 3,
            mode: '事件触发'
        },
        {
            id: 'verify_queue_help',
            title: '验证排队说明',
            desc: '验证队列拥堵或等待较久时，解释当前状态并引导查看帮助。',
            icon: 'fa-list-check',
            triggerType: 'verify_queue',
            audienceScope: 'authenticated',
            pageIds: ['verify'],
            tone: 'assistive',
            titleText: '验证正在排队',
            content: '当前验证请求较多，你可以先确认资料是否完整，避免轮到处理时再次失败。',
            actionLabel: '查看验证说明',
            actionUrl: '/verify.html#help',
            priority: 24,
            dismissTtlHours: 4,
            mode: '事件触发'
        },
        {
            id: 'verify_success_confirmation',
            title: '验证成功确认',
            desc: '验证通过后提示权益可用范围，帮助用户继续完成下一步操作。',
            icon: 'fa-circle-check',
            triggerType: 'verify_success',
            audienceScope: 'authenticated',
            pageIds: ['verify', 'home'],
            tone: 'success',
            titleText: '验证已通过',
            content: '验证状态已经更新，你可以继续使用相关权益或回到商城完成后续操作。',
            actionLabel: '查看权益',
            actionUrl: 'wallet://balance',
            priority: 22,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'ticket_progress_update',
            title: '工单进展提醒',
            desc: '客服或售后工单有进展时，通过机器人说明状态并保留上下文入口。',
            icon: 'fa-headset',
            triggerType: 'ticket_updated',
            audienceScope: 'authenticated',
            pageIds: ['home', 'shop', 'verify'],
            tone: 'info',
            titleText: '客服工单有新进展',
            content: '你的问题有新的处理记录，可以查看工单结果或继续补充信息。',
            actionLabel: '查看工单',
            actionUrl: 'support://tickets',
            priority: 37,
            dismissTtlHours: 12,
            mode: '事件触发'
        },
        {
            id: 'login_risk_alert',
            title: '登录风险提醒',
            desc: '账号出现异常登录、限流或安全状态变化时，引导用户检查资料和安全设置。',
            icon: 'fa-user-shield',
            triggerType: 'login_risk',
            audienceScope: 'authenticated',
            pageIds: ['home'],
            tone: 'alert',
            titleText: '账号安全需要确认',
            content: '检测到账户安全状态变化。建议检查资料和登录信息，必要时联系站内客服。',
            actionLabel: '检查账号',
            actionUrl: 'account://profile',
            priority: 42,
            dismissTtlHours: 3,
            mode: '事件触发'
        },
        {
            id: 'new_user_welcome_event',
            title: '新用户注册完成欢迎',
            desc: '注册完成、首登或引导链路触发时，立即给新用户一条更明确的下一步路径。',
            icon: 'fa-sparkles',
            triggerType: 'new_user_welcome',
            audienceScope: 'new_users',
            pageIds: ['home', 'prompts'],
            semanticFamily: 'new_user_welcome',
            intentLabel: '新用户欢迎',
            tone: 'welcome',
            titleText: '欢迎，先从这里开始',
            content: '账号已经准备好了。你可以先看看提示词和钱包入口，我会在关键操作前给你提醒。',
            actionLabel: '查看提示词',
            actionUrl: '/prompts.html',
            priority: 18,
            dismissTtlHours: 72,
            mode: '事件触发'
        },
        {
            id: 'inactive_return_event',
            title: '回流用户到站欢迎',
            desc: '用户被系统判定为回流时，主动提示近期更新、卡券或可继续的任务。',
            icon: 'fa-person-walking-arrow-loop-left',
            triggerType: 'inactive_user_return',
            audienceScope: 'inactive',
            pageIds: ['home', 'shop'],
            semanticFamily: 'inactive_return',
            intentLabel: '回流唤醒',
            tone: 'welcome',
            titleText: '欢迎回来，有些内容更新了',
            content: '你可以先看钱包卡券、商城优惠或最近更新的内容，继续上次未完成的操作。',
            actionLabel: '查看卡券',
            actionUrl: 'wallet://cards',
            priority: 26,
            dismissTtlHours: 72,
            mode: '事件触发'
        },
        {
            id: 'comment_reply_followup',
            title: '评论回复提醒',
            desc: '提示词评论被回复时，把用户带回对应内容，减少错过互动。',
            icon: 'fa-comment-dots',
            triggerType: 'comment_replied',
            audienceScope: 'authenticated',
            pageIds: ['prompts', 'guestbook'],
            semanticFamily: 'reply_followup',
            intentLabel: '互动回复提醒',
            tone: 'community',
            titleText: '你的评论有新回复',
            content: '有人回复了你的评论，可以回到内容页继续查看上下文。',
            actionLabel: '查看回复',
            actionUrl: '/prompts.html',
            priority: 33,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'guestbook_mention_notice',
            title: '留言提及提醒',
            desc: '留言板出现提及或相关讨论时，提醒用户回到社区上下文。',
            icon: 'fa-at',
            triggerType: 'guestbook_mention',
            audienceScope: 'authenticated',
            pageIds: ['guestbook'],
            tone: 'community',
            titleText: '有人在留言里提到了你',
            content: '留言板有一条和你相关的新内容，可以回去看看是否需要回复。',
            actionLabel: '查看留言',
            actionUrl: '/guestbook.html',
            priority: 34,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'product_discount_available_notice',
            title: '商品折扣可用提醒',
            desc: '商品出现可用折扣但未必需要领券时，提示用户直接查看优惠。',
            icon: 'fa-tags',
            triggerType: 'product_discount_available',
            audienceScope: 'authenticated',
            pageIds: ['shop'],
            semanticFamily: 'shop_discount_ready',
            intentLabel: '商城优惠提醒',
            tone: 'commerce',
            titleText: '当前商品有可用折扣',
            content: '这件商品现在可以享受优惠，适合先确认价格再下单。',
            actionLabel: '查看商品',
            actionUrl: '/shop.html',
            priority: 30,
            dismissTtlHours: 12,
            mode: '事件触发'
        },
        {
            id: 'product_restocked_notice',
            title: '商品补货提醒',
            desc: '关注或热销商品恢复库存后，引导用户及时回到商城。',
            icon: 'fa-boxes-stacked',
            triggerType: 'product_restocked',
            audienceScope: 'authenticated',
            pageIds: ['shop'],
            tone: 'commerce',
            titleText: '你关注的商品补货了',
            content: '之前暂时不可用的商品已经恢复，可以回到商城继续查看。',
            actionLabel: '去商城',
            actionUrl: '/shop.html',
            priority: 31,
            dismissTtlHours: 18,
            mode: '事件触发'
        },
        {
            id: 'order_paid_confirmation',
            title: '订单支付确认',
            desc: '订单支付成功后，提示用户查看订单、等待交付或继续补充信息。',
            icon: 'fa-money-check-dollar',
            triggerType: 'order_paid',
            audienceScope: 'authenticated',
            pageIds: ['shop', 'home'],
            semanticFamily: 'order_lifecycle',
            intentLabel: '订单进度提醒',
            tone: 'success',
            titleText: '订单支付成功',
            content: '支付已经完成，后续交付和状态变化会继续通过机器人提醒你。',
            actionLabel: '查看订单',
            actionUrl: 'wallet://orders',
            priority: 35,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'permission_changed_notice',
            title: '权限变更说明',
            desc: '账号权限、封禁、解封或会员权益变化时，解释变化原因和可操作入口。',
            icon: 'fa-id-badge',
            triggerType: 'permission_changed',
            audienceScope: 'authenticated',
            pageIds: ['home', 'prompts', 'verify'],
            tone: 'info',
            titleText: '账号权限有更新',
            content: '你的账号权限或权益状态发生变化，可以查看资料和钱包确认当前可用范围。',
            actionLabel: '检查账号',
            actionUrl: 'account://profile',
            priority: 40,
            dismissTtlHours: 8,
            mode: '事件触发'
        },
        {
            id: 'prompt_unlocked_guide',
            title: '内容解锁引导',
            desc: '提示词或权益内容解锁后，提示用户继续查看、收藏或使用。',
            icon: 'fa-unlock-keyhole',
            triggerType: 'prompt_unlocked',
            audienceScope: 'authenticated',
            pageIds: ['prompts'],
            tone: 'creative',
            titleText: '内容已解锁',
            content: '你刚解锁的内容现在可以查看和使用，也可以回到提示词页继续探索。',
            actionLabel: '查看内容',
            actionUrl: '/prompts.html',
            priority: 28,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'verification_expiring_notice',
            title: '验证即将过期',
            desc: '验证权益或认证状态临近过期时，提前提醒续验或查看说明。',
            icon: 'fa-hourglass-end',
            triggerType: 'verification_expiring',
            audienceScope: 'authenticated',
            pageIds: ['verify', 'home'],
            tone: 'warning',
            titleText: '验证状态即将过期',
            content: '你的验证状态可能很快失效。建议提前查看说明，避免后续操作被打断。',
            actionLabel: '查看验证',
            actionUrl: '/verify.html#help',
            priority: 34,
            dismissTtlHours: 12,
            mode: '事件触发'
        },
        {
            id: 'usage_rules_notice',
            title: '使用规则提醒',
            desc: '站点规则、使用限制或页面说明更新时，在相关页面给出轻提醒。',
            icon: 'fa-clipboard-list',
            triggerType: 'usage_rules',
            audienceScope: 'all',
            pageIds: ['home', 'gongyi', 'verify'],
            tone: 'calm',
            titleText: '使用规则有说明',
            content: '当前页面有一些使用规则和注意事项，先了解一下可以减少操作中断。',
            actionLabel: '我知道了',
            actionUrl: '',
            priority: 12,
            dismissTtlHours: 24,
            mode: '事件触发'
        },
        {
            id: 'maintenance_notice',
            title: '维护公告提醒',
            desc: '维护、降级、暂停服务或恢复服务时，用全站提醒解释影响范围。',
            icon: 'fa-screwdriver-wrench',
            triggerType: 'maintenance_notice',
            audienceScope: 'all',
            pageIds: ['all'],
            tone: 'warning',
            titleText: '维护公告',
            content: '站点服务可能会有短暂调整。如果你遇到异常，可以稍后再试或联系站内客服。',
            actionLabel: '我知道了',
            actionUrl: '',
            priority: 44,
            dismissTtlHours: 6,
            mode: '事件触发'
        },
        {
            id: 'community_rule_notice',
            title: '社区规则提醒',
            desc: '留言、评论或API中转互动前，提示社区规范和内容边界。',
            icon: 'fa-scale-balanced',
            triggerType: 'community_rule',
            audienceScope: 'all',
            pageIds: ['guestbook', 'gongyi', 'prompts'],
            tone: 'community',
            titleText: '社区互动前看一下规则',
            content: '为了让讨论更顺畅，请尽量保持清晰、友善，并避免提交无关或敏感内容。',
            actionLabel: '我知道了',
            actionUrl: '',
            priority: 14,
            dismissTtlHours: 48,
            mode: '事件触发'
        },
        {
            id: 'content_featured_notice',
            title: '内容精选提醒',
            desc: '内容被精选、推荐或进入榜单时，提醒作者查看表现和后续互动。',
            icon: 'fa-star',
            triggerType: 'content_featured',
            audienceScope: 'authenticated',
            pageIds: ['prompts', 'guestbook'],
            tone: 'success',
            titleText: '你的内容被精选了',
            content: '这条内容获得了更多展示机会，可以回去看看互动情况。',
            actionLabel: '查看内容',
            actionUrl: '/prompts.html#featured',
            priority: 29,
            dismissTtlHours: 48,
            mode: '事件触发'
        },
        {
            id: 'support_reply_notice',
            title: '客服回复提醒',
            desc: '客服有新回复时，把用户带回订单、验证或当前上下文。',
            icon: 'fa-headset',
            triggerType: 'support_reply',
            audienceScope: 'authenticated',
            pageIds: ['home', 'shop', 'verify', 'gongyi'],
            tone: 'info',
            titleText: '客服有新回复',
            content: '你的问题有新的客服回复，可以查看上下文并继续补充信息。',
            actionLabel: '查看记录',
            actionUrl: 'wallet://orders',
            priority: 39,
            dismissTtlHours: 12,
            mode: '事件触发'
        },
        {
            id: 'service_status_notice',
            title: '服务状态通知',
            desc: '站点维护、服务波动或规则更新时，用全站气泡降低用户误解。',
            icon: 'fa-satellite-dish',
            triggerType: 'service_status',
            audienceScope: 'all',
            pageIds: ['all'],
            tone: 'calm',
            titleText: '服务状态有更新',
            content: '部分服务可能会短暂变化。你可以继续使用当前页面，遇到问题时我会提示下一步。',
            actionLabel: '我知道了',
            actionUrl: '',
            priority: 10,
            dismissTtlHours: 12,
            mode: '事件触发'
        }
    ]);
    const PREVIEW_PAGE_OPTIONS = [
        ['auto', '跟随规则'],
        ['home', '首页'],
        ['prompts', '提示词'],
        ['gongyi', 'API中转'],
        ['shop', '商城'],
        ['verify', '验证'],
        ['guestbook', '留言板']
    ];
    const PREVIEW_EVENT_SAMPLE_OPTIONS = Object.freeze({
        points_adjusted: [
            ['credit_bonus', '补发积分'],
            ['debit_manual', '扣减积分'],
            ['correction_fix', '记录修正']
        ],
        ticket_updated: [
            ['resolved_refund', '已解决并退款'],
            ['rejected_followup', '已拒绝待补充'],
            ['resolved_normal', '已解决无需退款']
        ],
        refund_status: [
            ['refunded_success', '退款完成'],
            ['refunded_with_remark', '退款附带说明']
        ],
        support_reply: [
            ['order_followup', '订单跟进回复'],
            ['verify_guidance', '验证说明回复'],
            ['generic_checkin', '常规关怀回复']
        ]
    });
    const WORKSPACE_VIEWS = Object.freeze([
        ['dashboard', '触达看板', 'fa-gauge-high', '运营总览与风险入口'],
        ['rules', '触达规则', 'fa-bullseye', '创建、发布和暂停触达规则'],
        ['templates', '消息模板', 'fa-layer-group', '标准事件气泡模板库'],
        ['scenes', '页面场景', 'fa-window-restore', '按页面管理触达语气和事件'],
        ['segments', '用户分群', 'fa-users-viewfinder', '游客、会员和行为人群'],
        ['automation', '自动化流程', 'fa-route', '按行为自动触发提醒'],
        ['entry', '客服入口', 'fa-headset', '机器人入口与工单引导'],
        ['analytics', '效果分析', 'fa-chart-line', '曝光、点击和转化归因'],
        ['assets', '素材与样式', 'fa-palette', '气泡样式与素材管理'],
        ['audit', '审计记录', 'fa-shield-halved', '发布、暂停和高风险变更'],
        ['settings', '全局设置', 'fa-sliders', '总开关、频控和治理策略']
    ]);
    const WORKSPACE_GROUPS = Object.freeze([
        ['overview', '运营总览', 'fa-compass', '先看全局表现、归因和变更风险', ['dashboard', 'analytics', 'audit']],
        ['orchestration', '触达编排', 'fa-sitemap', '规则、模板和自动化流程集中管理', ['rules', 'templates', 'automation']],
        ['audience', '页面与人群', 'fa-window-maximize', '围绕页面、用户分群和客服入口配置触达', ['scenes', 'segments', 'entry']],
        ['governance', '体验治理', 'fa-sliders', '素材样式和全局边界统一收口', ['assets', 'settings']]
    ]);
    const CAPABILITY_GROUPS = Object.freeze([
        {
            id: 'points',
            title: '积分与套餐',
            desc: '积分不足、积分变动、充值成功、签到和套餐到期',
            icon: 'fa-coins',
            categories: ['points', 'membership'],
            events: ['points_insufficient', 'points_low_balance', 'points_adjusted', 'wallet_recharge_success', 'daily_checkin_available'],
            pageIds: ['home', 'prompts', 'shop', 'verify']
        },
        {
            id: 'lifecycle',
            title: '用户旅程',
            desc: '注册欢迎、资料完善、回流唤醒、搜索无结果引导',
            icon: 'fa-route',
            categories: ['onboarding', 'retention', 'welcome'],
            events: ['new_user_welcome', 'profile_incomplete', 'inactive_user_return', 'search_no_result'],
            pageIds: ['home', 'prompts']
        },
        {
            id: 'community',
            title: '社区互动',
            desc: '留言回复、评论回复、精选展示、内容处理结果',
            icon: 'fa-comments',
            categories: ['community'],
            events: ['message_replied', 'comment_replied', 'content_featured', 'community_rule'],
            pageIds: ['guestbook', 'prompts']
        },
        {
            id: 'commerce',
            title: '商城经营',
            desc: '可领优惠券、商品折扣、库存恢复、购物车和订单履约',
            icon: 'fa-bag-shopping',
            categories: ['commerce'],
            events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_restocked', 'cart_abandoned', 'order_status', 'order_delivered'],
            pageIds: ['shop']
        },
        {
            id: 'payments',
            title: '支付与钱包',
            desc: '充值成功、积分变动、支付失败、退款状态和钱包权益',
            icon: 'fa-wallet',
            categories: ['wallet', 'payments', 'commerce'],
            events: ['wallet_recharge_success', 'wallet_recharge_failed', 'points_adjusted', 'payment_failed', 'refund_status'],
            pageIds: ['home', 'shop']
        },
        {
            id: 'account',
            title: '账号权限',
            desc: '管理员提升、权限限制、积分修正和安全提醒',
            icon: 'fa-user-shield',
            categories: ['account', 'permission', 'security'],
            events: ['permission_changed', 'points_adjusted', 'login_risk', 'profile_incomplete'],
            pageIds: ['home']
        },
        {
            id: 'operations',
            title: '站点运营',
            desc: '首页公告、API中转规则、验证排队、工单进展、服务维护',
            icon: 'fa-satellite-dish',
            categories: ['operations', 'site', 'service', 'general'],
            events: ['service_status', 'usage_rules', 'maintenance_notice', 'verify_queue', 'ticket_updated', 'support_reply'],
            pageIds: ['home', 'gongyi', 'verify']
        }
    ]);
    const TEMPLATE_PRODUCT_CATEGORIES = Object.freeze([
        {
            id: 'onboarding',
            title: '新手转化',
            desc: '欢迎、注册、资料完善、首次使用和新手路径说明。',
            icon: 'fa-seedling',
            categories: ['onboarding', 'welcome', 'retention'],
            events: ['new_user_welcome', 'profile_incomplete', 'daily_checkin_available', 'points_adjusted'],
            pageIds: ['home', 'prompts']
        },
        {
            id: 'retention',
            title: '活跃回流',
            desc: '长期未活跃、搜索无结果、签到和内容推荐。',
            icon: 'fa-heart-pulse',
            categories: ['retention', 'lifecycle'],
            events: ['inactive_user_return', 'search_no_result', 'daily_checkin_available', 'content_featured'],
            pageIds: ['home', 'prompts']
        },
        {
            id: 'commerce',
            title: '商城运营',
            desc: '优惠券、折扣、补货、购物车、订单和积分购买提醒。',
            icon: 'fa-bag-shopping',
            categories: ['commerce'],
            events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_discount_available', 'product_restocked', 'cart_abandoned', 'order_paid', 'order_status', 'order_delivered', 'points_insufficient'],
            pageIds: ['shop']
        },
        {
            id: 'wallet',
            title: '支付钱包',
            desc: '充值成功、积分变动、支付失败、退款进度和钱包权益说明。',
            icon: 'fa-wallet',
            categories: ['wallet', 'payments'],
            events: ['wallet_recharge_success', 'wallet_recharge_failed', 'points_adjusted', 'payment_failed', 'refund_status'],
            pageIds: ['home', 'shop']
        },
        {
            id: 'support',
            title: '客服引导',
            desc: '验证失败、排队、客服回复、服务状态和工单入口。',
            icon: 'fa-headset',
            categories: ['support', 'assistive', 'service'],
            events: ['verify_failed', 'verify_success', 'verify_queue', 'verification_expiring', 'service_status', 'payment_failed', 'support_reply', 'ticket_updated'],
            pageIds: ['verify', 'shop', 'gongyi']
        },
        {
            id: 'community',
            title: '社区互动',
            desc: '留言回复、评论回复、提及、社区规则和内容精选。',
            icon: 'fa-comments',
            categories: ['community'],
            events: ['message_replied', 'comment_replied', 'guestbook_mention', 'community_rule', 'content_featured', 'content_moderated'],
            pageIds: ['guestbook', 'prompts']
        },
        {
            id: 'account',
            title: '账号治理',
            desc: '权限变更、资料完善、安全限制和会员权益变化。',
            icon: 'fa-user-shield',
            categories: ['account', 'permission', 'points', 'membership', 'security'],
            events: ['permission_changed', 'points_low_balance', 'points_adjusted', 'points_insufficient', 'profile_incomplete', 'login_risk'],
            pageIds: ['home', 'prompts', 'verify']
        },
        {
            id: 'operations',
            title: '站点运营',
            desc: '维护公告、API中转规则、内容开放和全站说明。',
            icon: 'fa-satellite-dish',
            categories: ['operations', 'site', 'general'],
            events: ['maintenance_notice', 'usage_rules', 'service_status', 'prompt_unlocked'],
            pageIds: ['all', 'home', 'gongyi']
        }
    ]);
    const TEMPLATE_STARTERS = Object.freeze([
        {
            id: 'starter_new_user_welcome',
            key: 'new_user_welcome',
            name: '新用户欢迎',
            category: 'onboarding',
            page_ids: ['home'],
            trigger_type: 'new_user_welcome',
            tone: 'welcome',
            title: '欢迎加入 zaoyoe',
            content: '你可以从提示词、商城和钱包开始。遇到关键路径时，我会在这里给你说明。',
            action_label: '查看提示词',
            action_url: '/prompts.html',
            description: '适合新注册用户首次进入首页时展示。',
            priority: 12
        },
        {
            id: 'starter_profile_incomplete',
            key: 'profile_incomplete',
            name: '资料完善引导',
            category: 'onboarding',
            page_ids: ['home'],
            trigger_type: 'profile_incomplete',
            tone: 'welcome',
            title: '完善资料后体验会更顺',
            content: '补全昵称、联系信息和常用入口，我就能在后续提醒里给你更准确的路径。',
            action_label: '完善资料',
            action_url: 'account://profile',
            description: '适合登录用户资料不完整、无法定位售后或权益时展示。',
            priority: 16
        },
        {
            id: 'starter_daily_checkin_available',
            key: 'daily_checkin_available',
            name: '每日签到提醒',
            category: 'retention',
            page_ids: ['home'],
            trigger_type: 'daily_checkin_available',
            tone: 'success',
            title: '今天的签到奖励还没领',
            content: '签到可以补充积分余额，适合在生成提示词、验证或下单前先领取。',
            action_label: '去签到',
            action_url: 'wallet://checkin',
            description: '适合提升日活、低打扰地提醒用户领取每日权益。',
            priority: 14
        },
        {
            id: 'starter_inactive_user_return',
            key: 'inactive_user_return',
            name: '长期未活跃回流',
            category: 'retention',
            page_ids: ['home', 'prompts'],
            trigger_type: 'inactive_user_return',
            tone: 'info',
            title: '欢迎回来，有些新内容适合你',
            content: '最近上新了提示词、优惠权益和验证能力，我可以先带你从最常用的入口继续。',
            action_label: '看看新内容',
            action_url: '/prompts.html',
            description: '适合沉默用户回访后展示，降低重新上手成本。',
            priority: 15
        },
        {
            id: 'starter_points_low_balance',
            key: 'points_low_balance',
            name: '积分偏低提醒',
            category: 'account',
            page_ids: ['prompts', 'verify', 'shop'],
            trigger_type: 'points_low_balance',
            tone: 'warning',
            title: '积分余额有点低',
            content: '继续生成、验证或购买前，建议先确认余额，避免关键步骤被打断。',
            action_label: '查看积分',
            action_url: 'wallet://balance',
            description: '适合用户余额不足但还未失败前的预防式提醒。',
            priority: 24
        },
        {
            id: 'starter_points_adjusted',
            key: 'points_adjusted_notice',
            name: '积分变动通知',
            category: 'account',
            page_ids: ['home', 'prompts', 'shop', 'verify'],
            trigger_type: 'points_adjusted',
            tone: 'info',
            title: '你的积分有更新',
            content: '客服刚刚调整了你的积分余额。可以先查看钱包确认最新额度，再继续使用当前服务。',
            action_label: '查看积分',
            action_url: 'wallet://balance',
            description: '适合客服补发、扣减或修正积分后，第一时间向用户解释变化。',
            priority: 23
        },
        {
            id: 'starter_coupon_available',
            key: 'coupon_available',
            name: '商品可领券',
            category: 'commerce',
            page_ids: ['shop'],
            trigger_type: 'coupon_available',
            tone: 'commerce',
            title: '有优惠券可领取',
            content: '这件商品当前有可用优惠，可以先领取再下单。',
            action_label: '我的钱包 > 卡券',
            action_url: 'wallet://cards',
            description: '适合商城商品有优惠券或折扣权益时展示。',
            priority: 28
        },
        {
            id: 'starter_coupon_expiring',
            key: 'coupon_expiring',
            name: '优惠券过期提醒',
            category: 'commerce',
            page_ids: ['shop'],
            trigger_type: 'coupon_expiring',
            tone: 'warning',
            title: '有优惠券快过期了',
            content: '你的优惠权益即将失效，可以先确认适用商品，避免错过折扣。',
            action_label: '查看卡券',
            action_url: 'wallet://cards',
            description: '适合优惠券到期前的低频提醒。',
            priority: 30
        },
        {
            id: 'starter_cart_abandoned',
            key: 'cart_abandoned',
            name: '购物车挽回',
            category: 'commerce',
            page_ids: ['shop'],
            trigger_type: 'cart_abandoned',
            tone: 'commerce',
            title: '购物车里还有未完成的商品',
            content: '如果你还在比较套餐，我可以帮你确认库存、优惠和交付说明。',
            action_label: '回到购物车',
            action_url: '/shop.html#cart',
            description: '适合用户停留、离开或回访商城时提醒未完成购买。',
            priority: 26
        },
        {
            id: 'starter_product_restocked',
            key: 'product_restocked',
            name: '商品补货提醒',
            category: 'commerce',
            page_ids: ['shop'],
            trigger_type: 'product_restocked',
            tone: 'success',
            title: '之前关注的商品已补货',
            content: '库存已经恢复，可以继续下单；如果需要，我也可以帮你确认当前优惠。',
            action_label: '查看商品',
            action_url: '/shop.html',
            description: '适合库存恢复、用户曾浏览或收藏商品时展示。',
            priority: 27
        },
        {
            id: 'starter_order_delivered',
            key: 'order_delivered_followup',
            name: '交付完成回访',
            category: 'commerce',
            page_ids: ['shop'],
            trigger_type: 'order_delivered',
            tone: 'success',
            title: '订单已经完成交付',
            content: '如果商品或权益没有正常到账，可以直接从这里进入客服核对。',
            action_label: '查看订单',
            action_url: 'shop://orders',
            description: '适合订单交付后做确认、评价或售后入口提醒。',
            priority: 22
        },
        {
            id: 'starter_wallet_recharge_success',
            key: 'wallet_recharge_success',
            name: '充值成功关怀',
            category: 'wallet',
            page_ids: ['home', 'shop'],
            trigger_type: 'wallet_recharge_success',
            tone: 'success',
            title: '充值已到账',
            content: '积分已经进入钱包，可以继续购买商品、生成提示词或处理验证任务。',
            action_label: '查看钱包',
            action_url: 'wallet://balance',
            description: '适合支付到账后给用户明确反馈和下一步建议。',
            priority: 24
        },
        {
            id: 'starter_wallet_recharge_failed',
            key: 'wallet_recharge_failed',
            name: '充值失败帮助',
            category: 'wallet',
            page_ids: ['home', 'shop'],
            trigger_type: 'wallet_recharge_failed',
            tone: 'warning',
            title: '充值暂时没有完成',
            content: '可能是支付渠道或回调延迟导致。我可以帮你核对订单，也可以引导你重新尝试。',
            action_label: '查看支付记录',
            action_url: 'wallet://transactions',
            description: '适合支付失败、回调异常或用户回来后需要继续处理时展示。',
            priority: 36
        },
        {
            id: 'starter_refund_status',
            key: 'refund_status_update',
            name: '退款进度同步',
            category: 'wallet',
            page_ids: ['shop'],
            trigger_type: 'refund_status',
            tone: 'info',
            title: '退款进度已更新',
            content: '你的退款处理状态有变化，可以进入订单页查看明细；如有疑问我会继续帮你转人工。',
            action_label: '查看订单',
            action_url: 'shop://orders',
            description: '适合退款申请、审核、成功或失败时通知用户。',
            priority: 34
        },
        {
            id: 'starter_verify_failed',
            key: 'verify_failed_help',
            name: '验证失败帮助',
            category: 'support',
            page_ids: ['verify'],
            trigger_type: 'verify_failed',
            tone: 'assistive',
            title: '验证未通过',
            content: '请检查上传内容和验证规则。如果多次失败，可以联系站内客服处理。',
            action_label: '查看验证说明',
            action_url: '/verify.html#help',
            description: '适合验证失败、排队或用户不知道下一步时展示。',
            priority: 35
        },
        {
            id: 'starter_verify_queue',
            key: 'verify_queue_waiting',
            name: '验证排队说明',
            category: 'support',
            page_ids: ['verify'],
            trigger_type: 'verify_queue',
            tone: 'assistive',
            title: '验证正在排队',
            content: '当前任务较多，我会持续关注处理状态。你可以先检查材料是否完整，减少重复提交。',
            action_label: '查看验证说明',
            action_url: '/verify.html#help',
            description: '适合验证排队、用户等待时降低焦虑。',
            priority: 18
        },
        {
            id: 'starter_verify_success',
            key: 'verify_success_next_step',
            name: '验证成功下一步',
            category: 'support',
            page_ids: ['verify'],
            trigger_type: 'verify_success',
            tone: 'success',
            title: '验证已通过',
            content: '当前任务已完成，你可以继续处理后续内容；如果需要发票、记录或售后，我也可以继续协助。',
            action_label: '查看记录',
            action_url: '/verify.html#history',
            description: '适合验证通过后给用户确认和下一步入口。',
            priority: 20
        },
        {
            id: 'starter_ticket_updated',
            key: 'ticket_progress_update',
            name: '工单进展提醒',
            category: 'support',
            page_ids: ['home', 'verify', 'shop'],
            trigger_type: 'ticket_updated',
            tone: 'info',
            title: '你的工单有新进展',
            content: '客服已经更新处理进度。你可以查看详情，也可以继续补充截图、订单号或任务号。',
            action_label: '查看工单',
            action_url: 'support://tickets',
            description: '适合工单状态变化、需要用户补充材料或已解决时展示。',
            priority: 31
        },
        {
            id: 'starter_reply_notification',
            key: 'reply_notification',
            name: '留言/评论被回复',
            category: 'community',
            page_ids: ['guestbook', 'prompts'],
            trigger_type: 'message_replied',
            tone: 'community',
            title: '有人回复了你',
            content: '你的留言或评论有新回复，点击即可回到对应内容。',
            action_label: '查看回复',
            action_url: '/guestbook.html',
            description: '适合留言板和提示词评论回复场景。',
            priority: 32
        },
        {
            id: 'starter_search_no_result',
            key: 'search_no_result_help',
            name: '搜索无结果引导',
            category: 'retention',
            page_ids: ['prompts'],
            trigger_type: 'search_no_result',
            tone: 'creative',
            title: '没搜到想要的内容？',
            content: '可以换一个关键词，或告诉我你想生成的风格，我会帮你推荐相近提示词。',
            action_label: '查看精选',
            action_url: '/prompts.html#featured',
            description: '适合搜索空结果页，帮助用户继续探索而不是离开。',
            priority: 17
        },
        {
            id: 'starter_content_moderated',
            key: 'content_moderated_result',
            name: '内容处理结果',
            category: 'community',
            page_ids: ['prompts', 'guestbook'],
            trigger_type: 'content_moderated',
            tone: 'warning',
            title: '内容已处理完成',
            content: '你的内容状态有更新。如果需要修改、申诉或补充说明，可以从这里继续处理。',
            action_label: '查看详情',
            action_url: '/guestbook.html',
            description: '适合评论、留言或提示词内容审核处理结果。',
            priority: 30
        },
        {
            id: 'starter_permission_changed',
            key: 'permission_changed_notice',
            name: '权限变更通知',
            category: 'account',
            page_ids: ['home'],
            trigger_type: 'permission_changed',
            tone: 'warning',
            title: '账号权限已更新',
            content: '管理员已经调整了你的账号权限或积分状态，请查看账户中心确认。',
            action_label: '查看账户',
            action_url: 'account://profile',
            description: '适合管理员提升、限制权限或调整积分后的站内提醒。',
            priority: 34
        },
        {
            id: 'starter_login_risk',
            key: 'login_risk_alert',
            name: '登录风险提醒',
            category: 'account',
            page_ids: ['home'],
            trigger_type: 'login_risk',
            tone: 'alert',
            title: '检测到异常登录风险',
            content: '为了保护账户安全，建议你确认最近登录记录，并及时更新密码或联系方式。',
            action_label: '查看账户安全',
            action_url: 'account://security',
            description: '适合异地登录、频繁失败或管理员风控提醒。',
            priority: 38
        },
        {
            id: 'starter_maintenance_notice',
            key: 'maintenance_notice',
            name: '维护通知',
            category: 'operations',
            page_ids: ['all'],
            trigger_type: 'maintenance_notice',
            tone: 'info',
            title: '服务维护提醒',
            content: '部分服务可能会短暂波动，如遇异常请稍后重试或联系在线客服。',
            action_label: '查看公告',
            action_url: '/index.html#announcements',
            description: '适合全站维护、服务波动或API中转规则说明。',
            priority: 18
        }
    ]);
    const ASSET_STYLE_PRESET_PACKS = Object.freeze([
        {
            id: 'studio_blue',
            title: 'Studio 蓝',
            desc: '贴合 Admin Studio 左侧品牌蓝，适合默认机器人气泡。',
            swatches: ['#6b9ece', '#5f95cc', '#ffffff', '#1f2937'],
            style: {
                preset: 'studio_blue',
                accent_color: '#6b9ece',
                title_color: '#5f95cc',
                bubble_background: '#ffffff',
                text_color: '#1f2937',
                radius_px: 22,
                max_width_px: 520,
                density: 'comfortable',
                shadow: 'soft',
                animation: 'gentle',
                robot_variant: 'default'
            }
        },
        {
            id: 'commerce_green',
            title: '商城绿',
            desc: '适合优惠券、折扣、补货和订单履约提醒。',
            swatches: ['#059669', '#047857', '#f7fdf9', '#163326'],
            style: {
                preset: 'commerce_green',
                accent_color: '#059669',
                title_color: '#047857',
                bubble_background: '#f7fdf9',
                text_color: '#163326',
                radius_px: 20,
                max_width_px: 520,
                density: 'comfortable',
                shadow: 'soft',
                animation: 'gentle',
                robot_variant: 'rounded'
            }
        },
        {
            id: 'support_teal',
            title: '客服青',
            desc: '适合验证说明、服务状态、工单和帮助入口。',
            swatches: ['#0f766e', '#115e59', '#f0fdfa', '#164e63'],
            style: {
                preset: 'support_teal',
                accent_color: '#0f766e',
                title_color: '#115e59',
                bubble_background: '#f0fdfa',
                text_color: '#164e63',
                radius_px: 18,
                max_width_px: 540,
                density: 'compact',
                shadow: 'soft',
                animation: 'none',
                robot_variant: 'minimal'
            }
        },
        {
            id: 'warning_amber',
            title: '治理琥珀',
            desc: '适合权限变更、积分不足、支付异常等需关注提醒。',
            swatches: ['#b45309', '#92400e', '#fffbeb', '#3f2d12'],
            style: {
                preset: 'warning_amber',
                accent_color: '#b45309',
                title_color: '#92400e',
                bubble_background: '#fffbeb',
                text_color: '#3f2d12',
                radius_px: 20,
                max_width_px: 540,
                density: 'comfortable',
                shadow: 'elevated',
                animation: 'gentle',
                robot_variant: 'rounded'
            }
        },
        {
            id: 'dark_focus',
            title: '暗色克制',
            desc: '适合深色页面、夜间浏览和低打扰客服提示。',
            swatches: ['#769dca', '#9fbce0', '#111827', '#f8fafc'],
            style: {
                preset: 'dark_focus',
                accent_color: '#769dca',
                title_color: '#9fbce0',
                bubble_background: '#111827',
                text_color: '#f8fafc',
                radius_px: 22,
                max_width_px: 520,
                density: 'compact',
                shadow: 'elevated',
                animation: 'none',
                robot_variant: 'minimal'
            }
        }
    ]);
    const SCENE_PRIORITY_PRESET_PACKS = Object.freeze({
        home: [
            {
                id: 'home_balanced',
                name: '首页平衡型',
                description: '优先账户、风险和资料类提醒，营销触达自然后置，适合大多数首页。',
                applyLabel: '套用平衡型',
                allow_marketing: true,
                events: ['new_user_welcome', 'profile_incomplete', 'daily_checkin_available', 'points_adjusted', 'permission_changed', 'login_risk', 'inactive_user_return'],
                event_priority_center: {
                    enabled: true,
                    first_wave: { events: ['login_risk', 'permission_changed', 'points_adjusted'] },
                    service: { events: ['new_user_welcome', 'profile_incomplete'] },
                    guidance: { events: ['daily_checkin_available'] },
                    marketing: { events: ['inactive_user_return'] }
                }
            },
            {
                id: 'home_quiet',
                name: '首页安静型',
                description: '更克制，只保留登录后真正值得先看的提醒，减少首页第一印象压力。',
                applyLabel: '套用安静型',
                allow_marketing: false,
                events: ['profile_incomplete', 'points_adjusted', 'permission_changed', 'login_risk'],
                event_priority_center: {
                    enabled: true,
                    first_wave: { events: ['login_risk', 'permission_changed'] },
                    service: { events: ['points_adjusted'] },
                    guidance: { events: ['profile_incomplete'] },
                    marketing: { events: [] }
                }
            }
        ],
        shop: [
            {
                id: 'shop_trade_guard',
                name: '商城交易保障',
                description: '先保交易、支付和退款体验，再承接优惠与挽回提醒，适合成熟商城。',
                applyLabel: '套用交易保障',
                allow_marketing: true,
                events: ['payment_failed', 'order_paid', 'order_status', 'order_delivered', 'refund_status', 'coupon_available', 'coupon_expiring', 'cart_abandoned'],
                event_priority_center: {
                    enabled: true,
                    first_wave: { events: ['payment_failed', 'order_status', 'refund_status', 'order_paid'] },
                    service: { events: ['order_delivered'] },
                    guidance: { events: [] },
                    marketing: { events: ['coupon_available', 'coupon_expiring', 'cart_abandoned'] }
                }
            },
            {
                id: 'shop_conversion',
                name: '商城转化增强',
                description: '在不打断交易安全的前提下，让优惠券、折扣和挽回更积极一点。',
                applyLabel: '套用转化增强',
                allow_marketing: true,
                events: ['payment_failed', 'order_status', 'refund_status', 'coupon_available', 'product_discount_available', 'product_restocked', 'cart_abandoned'],
                event_priority_center: {
                    enabled: true,
                    first_wave: { events: ['payment_failed', 'order_status', 'refund_status'] },
                    service: { events: [] },
                    guidance: { events: [] },
                    marketing: { events: ['coupon_available', 'product_discount_available', 'product_restocked', 'cart_abandoned'] }
                }
            }
        ],
        verify: [
            {
                id: 'verify_exception_first',
                name: '验证异常优先',
                description: '把失败、排队和临期提醒顶到最前，适合验证链路更敏感的站点。',
                applyLabel: '套用异常优先',
                allow_marketing: false,
                events: ['verify_failed', 'verify_queue', 'verification_expiring', 'verify_success', 'support_reply', 'ticket_updated'],
                event_priority_center: {
                    enabled: true,
                    first_wave: { events: ['verify_failed', 'verify_queue', 'verification_expiring', 'ticket_updated'] },
                    service: { events: ['support_reply'] },
                    guidance: { events: ['verify_success'] },
                    marketing: { events: [] }
                }
            },
            {
                id: 'verify_supportive',
                name: '验证陪伴型',
                description: '降低压迫感，让成功、客服回复和排队说明更柔和地接住用户。',
                applyLabel: '套用陪伴型',
                allow_marketing: false,
                events: ['verify_failed', 'verify_success', 'verify_queue', 'support_reply', 'ticket_updated', 'service_status'],
                event_priority_center: {
                    enabled: true,
                    first_wave: { events: ['verify_failed', 'ticket_updated'] },
                    service: { events: ['verify_queue', 'support_reply', 'service_status'] },
                    guidance: { events: ['verify_success'] },
                    marketing: { events: [] }
                }
            }
        ]
    });
    const ENGAGEMENT_RUNTIME_VERSION = '20260506_ENGAGEMENT_TAG_MANUAL_SYNC_1';
    const ENGAGEMENT_FEED_BROADCAST_CHANNEL = 'engagement-feed-invalidations';
    const ENGAGEMENT_FEED_BROADCAST_EVENT = 'engagement_feed_changed';
    const SAVE_LOCK_STALE_MS = 15000;
    const RULE_BATCH_LIMIT = 30;
    const RULE_LIST_PAGE_SIZE = 8;
    const ENGAGEMENT_WHEEL_LINE_HEIGHT = 16;

    const state = {
        initialized: false,
        loading: false,
        payload: null,
        activeView: 'dashboard',
        focusedPageId: '',
        focusedCapabilityId: '',
        pendingFocusedPageScroll: false,
        ruleSearchQuery: '',
        ruleStatusFilter: 'all',
        ruleHealthFilter: 'all',
        rulePageFilter: 'all',
        ruleAudienceFilter: 'all',
        ruleDuplicateFilter: false,
        ruleSort: 'updated_desc',
        rulePage: 1,
        ruleBatchResult: null,
        ruleDraft: null,
        templateCategoryFilter: '',
        previewDevice: 'desktop',
        previewTheme: 'light',
        previewPageId: 'auto',
        previewEventSample: 'credit_bonus',
        scenePreviewEvent: '',
        automationPreviewSamples: {},
        templateDraftRef: '',
        editingTemplateRef: '',
        editingSegmentRef: '',
        editingScenePageId: '',
        editingAssetId: '',
        editingSupportContextId: '',
        editingUserTagRef: '',
        editingRuleId: '',
        segmentTagsSyncing: false
    };
    let ruleSearchRenderTimer = 0;
    let engagementFeedBroadcastTimer = 0;
    let pendingEngagementFeedBroadcast = null;
    let engagementFeedBroadcastSequence = 0;
    globalScope.__adminEngagementRuntimeVersion = ENGAGEMENT_RUNTIME_VERSION;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeToken(value, fallback = '') {
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback;
    }

    function normalizeUserTagKey(value, fallback = '') {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_')
            .replace(/^_+|_+$/g, '')
            || fallback;
    }

    function normalizeNumericInput(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
        const parsed = Number(value);
        const fallbackParsed = Number(fallback);
        const next = Number.isFinite(parsed)
            ? parsed
            : (Number.isFinite(fallbackParsed) ? fallbackParsed : 0);
        return Math.max(min, Math.min(max, Math.round(next * 100) / 100));
    }

    function getOverviewContainer() {
        return document.getElementById('engagementOverview');
    }

    function isEngagementModuleVisible() {
        return document.getElementById('module-engagement')?.classList.contains('active') === true;
    }

    function normalizeEngagementWheelDelta(delta = 0, deltaMode = 0) {
        const value = Number(delta);
        if (!Number.isFinite(value)) return 0;
        if (deltaMode === 1) return value * ENGAGEMENT_WHEEL_LINE_HEIGHT;
        if (deltaMode === 2) {
            return value * Math.max(1, Number(globalScope.innerHeight || document.documentElement?.clientHeight || 800));
        }
        return value;
    }

    function getEngagementWheelRootScroller() {
        return document.scrollingElement || document.documentElement || document.body;
    }

    function canScrollEngagementElement(element, deltaY = 0) {
        if (!(element instanceof Element)) return false;
        const scrollTop = Number(element.scrollTop || 0) || 0;
        const scrollHeight = Number(element.scrollHeight || 0) || 0;
        const clientHeight = Number(element.clientHeight || 0) || 0;
        if (scrollHeight <= clientHeight + 1) return false;
        if (deltaY < 0) return scrollTop > 1;
        if (deltaY > 0) return scrollTop + clientHeight < scrollHeight - 1;
        return false;
    }

    function getEngagementScrollableAncestor(target, boundary = null) {
        if (!(target instanceof Element)) return null;
        const boundaryElement = boundary instanceof Element ? boundary : null;
        let current = target;
        while (current && current !== boundaryElement && current !== document.body && current !== document.documentElement) {
            if (current instanceof HTMLElement) {
                const style = globalScope.getComputedStyle?.(current);
                const overflowY = String(style?.overflowY || '').toLowerCase();
                if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight + 1) {
                    return current;
                }
            }
            current = current.parentElement;
        }
        return null;
    }

    function handleEngagementWheel(event) {
        if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
        const moduleEl = document.getElementById('module-engagement');
        if (!(moduleEl instanceof HTMLElement) || !isEngagementModuleVisible()) return;
        if (!(event.target instanceof Element) || !moduleEl.contains(event.target)) return;

        const deltaY = normalizeEngagementWheelDelta(event.deltaY, event.deltaMode);
        const deltaX = normalizeEngagementWheelDelta(event.deltaX, event.deltaMode);
        if (!deltaY || Math.abs(deltaY) <= Math.abs(deltaX)) return;

        const scrollable = getEngagementScrollableAncestor(event.target, moduleEl);
        if (scrollable && canScrollEngagementElement(scrollable, deltaY)) return;

        const rootScroller = getEngagementWheelRootScroller();
        if (!canScrollEngagementElement(rootScroller, deltaY)) return;
        const maxScrollTop = Math.max(0, Number(rootScroller.scrollHeight || 0) - Number(rootScroller.clientHeight || 0));
        const nextScrollTop = Math.max(0, Math.min(maxScrollTop, Number(rootScroller.scrollTop || 0) + deltaY));
        if (Math.abs(nextScrollTop - Number(rootScroller.scrollTop || 0)) < 0.5) return;

        event.preventDefault?.();
        rootScroller.scrollTop = nextScrollTop;
    }

    function getCurrentSite() {
        return String(globalScope.AdminSiteFilter?.getSiteFilter?.() || 'all').trim().toLowerCase() || 'all';
    }

    function normalizeEngagementBroadcastPageIds(value, fallback = ['all']) {
        const source = Array.isArray(value) ? value : (value ? [value] : []);
        const normalized = [...new Set(source
            .map((pageId) => normalizeToken(pageId, ''))
            .filter(Boolean))];
        return normalized.length ? normalized : fallback;
    }

    function collectEngagementBroadcastPageIds(...sources) {
        const pageIds = sources.flatMap((source) => normalizeEngagementBroadcastPageIds(source, []));
        const unique = [...new Set(pageIds.filter(Boolean))];
        if (!unique.length || unique.includes('all')) {
            return ['all'];
        }
        return unique;
    }

    function getEngagementMutationBroadcastPages(request = {}, result = {}) {
        const rules = [
            result?.rule,
            result?.deleted_rule,
            ...(Array.isArray(result?.rules) ? result.rules : [])
        ].filter(Boolean);
        return collectEngagementBroadcastPageIds(
            request.page_ids,
            request.pageIds,
            request.rule?.page_ids,
            request.rule?.pageIds,
            request.asset?.page_ids,
            request.asset?.pageIds,
            request.scene?.page_id,
            request.scene?.pageId,
            rules.flatMap((rule) => rule?.page_ids || rule?.pageIds || [])
        );
    }

    function mergeEngagementFeedBroadcastPayload(previous = null, next = {}) {
        if (!previous) return next;
        const previousPages = normalizeEngagementBroadcastPageIds(previous.page_ids, []);
        const nextPages = normalizeEngagementBroadcastPageIds(next.page_ids, []);
        return {
            ...previous,
            ...next,
            reason: next.reason || previous.reason || 'engagement_config_changed',
            site: previous.site === next.site ? (next.site || previous.site) : 'all',
            page_ids: previousPages.includes('all') || nextPages.includes('all')
                ? ['all']
                : [...new Set([...previousPages, ...nextPages])],
            sequence: next.sequence
        };
    }

    function sendPendingEngagementFeedBroadcast() {
        const payload = pendingEngagementFeedBroadcast;
        pendingEngagementFeedBroadcast = null;
        engagementFeedBroadcastTimer = 0;
        const realtimeClient = globalScope?.supabaseClient || globalScope?.supabase || null;
        if (!payload || !realtimeClient?.channel) {
            return;
        }

        let channel = null;
        let cleanupTimer = 0;
        const cleanup = () => {
            if (cleanupTimer) {
                globalScope.clearTimeout?.(cleanupTimer);
                cleanupTimer = 0;
            }
            if (!channel) return;
            const activeChannel = channel;
            channel = null;
            try {
                if (typeof realtimeClient.removeChannel === 'function') {
                    realtimeClient.removeChannel(activeChannel);
                } else {
                    activeChannel.unsubscribe?.();
                }
            } catch (error) {
                console.warn('[AdminEngagement] Failed to close engagement feed broadcast channel:', error?.message || error);
            }
        };

        try {
            channel = realtimeClient.channel(ENGAGEMENT_FEED_BROADCAST_CHANNEL, {
                config: { broadcast: { self: false } }
            });
            cleanupTimer = globalScope.setTimeout?.(cleanup, 5000) || 0;
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    Promise.resolve(channel.send({
                        type: 'broadcast',
                        event: ENGAGEMENT_FEED_BROADCAST_EVENT,
                        payload: {
                            ...payload,
                            broadcasted_at: new Date().toISOString()
                        }
                    })).catch((error) => {
                        console.warn('[AdminEngagement] Engagement feed broadcast failed:', error?.message || error);
                    }).finally(cleanup);
                    return;
                }
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    cleanup();
                }
            });
        } catch (error) {
            cleanup();
            console.warn('[AdminEngagement] Engagement feed broadcast setup failed:', error?.message || error);
        }
    }

    function broadcastEngagementFeedChange(reason = 'engagement_config_changed', payload = {}) {
        const realtimeClient = globalScope?.supabaseClient || globalScope?.supabase || null;
        if (!realtimeClient?.channel) {
            return false;
        }
        const nextPayload = {
            source: 'admin_engagement',
            reason: String(reason || 'engagement_config_changed').trim() || 'engagement_config_changed',
            site: normalizeToken(payload.site || getCurrentSite(), 'all'),
            page_ids: normalizeEngagementBroadcastPageIds(payload.page_ids || payload.pageIds || payload.pages, ['all']),
            action: String(payload.action || '').trim(),
            sequence: ++engagementFeedBroadcastSequence
        };
        pendingEngagementFeedBroadcast = mergeEngagementFeedBroadcastPayload(pendingEngagementFeedBroadcast, nextPayload);
        if (engagementFeedBroadcastTimer) {
            globalScope.clearTimeout?.(engagementFeedBroadcastTimer);
        }
        engagementFeedBroadcastTimer = globalScope.setTimeout?.(sendPendingEngagementFeedBroadcast, 220) || 0;
        if (!engagementFeedBroadcastTimer) {
            sendPendingEngagementFeedBroadcast();
        }
        return true;
    }

    globalScope.broadcastEngagementFeedChange = broadcastEngagementFeedChange;

    function getPageLabel(pageId) {
        const normalized = normalizeToken(pageId, 'all');
        return PAGE_LABELS[normalized] || pageId || '页面';
    }

    function getEventLabel(eventKey) {
        const normalized = String(eventKey || '').trim();
        return EVENT_LABELS[normalized] || '自定义事件';
    }

    function getEventPriorityClass(eventKey = '', priorityCenter = null) {
        const normalized = normalizeToken(eventKey, '');
        const center = priorityCenter && typeof priorityCenter === 'object' && !Array.isArray(priorityCenter)
            ? priorityCenter
            : getEventPriorityCenter();
        const groups = Object.entries(center);
        for (const [groupId, group] of groups) {
            if (Array.isArray(group.events) && group.events.includes(normalized)) {
                return {
                    id: groupId,
                    ...group
                };
            }
        }
        return {
            id: 'service',
            ...(center.service || getEventPriorityCenter().service)
        };
    }

    function getEventPriorityCenter() {
        const source = state.payload?.event_priority_center && typeof state.payload.event_priority_center === 'object' && !Array.isArray(state.payload.event_priority_center)
            ? state.payload.event_priority_center
            : {};
        return {
            first_wave: {
                ...EVENT_PRIORITY_CLASSES.first_wave,
                ...(source.first_wave || {}),
                events: Array.isArray(source.first_wave?.events) && source.first_wave.events.length ? source.first_wave.events : [...EVENT_PRIORITY_CLASSES.first_wave.events]
            },
            service: {
                ...EVENT_PRIORITY_CLASSES.service,
                ...(source.service || {}),
                events: Array.isArray(source.service?.events) && source.service.events.length ? source.service.events : [...EVENT_PRIORITY_CLASSES.service.events]
            },
            marketing: {
                ...EVENT_PRIORITY_CLASSES.marketing,
                ...(source.marketing || {}),
                events: Array.isArray(source.marketing?.events) && source.marketing.events.length ? source.marketing.events : [...EVENT_PRIORITY_CLASSES.marketing.events]
            },
            guidance: {
                ...EVENT_PRIORITY_CLASSES.guidance,
                ...(source.guidance || {}),
                events: Array.isArray(source.guidance?.events) && source.guidance.events.length ? source.guidance.events : [...EVENT_PRIORITY_CLASSES.guidance.events]
            }
        };
    }

    function normalizeSceneEventPriorityCenter(source = {}, fallbackCenter = getEventPriorityCenter()) {
        const rawSource = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
        const fallback = fallbackCenter && typeof fallbackCenter === 'object' && !Array.isArray(fallbackCenter)
            ? fallbackCenter
            : getEventPriorityCenter();
        return {
            enabled: rawSource.enabled === true,
            first_wave: {
                ...(fallback.first_wave || EVENT_PRIORITY_CLASSES.first_wave),
                ...(rawSource.first_wave || {}),
                events: Array.isArray(rawSource.first_wave?.events) && rawSource.first_wave.events.length
                    ? rawSource.first_wave.events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean)
                    : [...(fallback.first_wave?.events || EVENT_PRIORITY_CLASSES.first_wave.events)]
            },
            service: {
                ...(fallback.service || EVENT_PRIORITY_CLASSES.service),
                ...(rawSource.service || {}),
                events: Array.isArray(rawSource.service?.events) && rawSource.service.events.length
                    ? rawSource.service.events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean)
                    : [...(fallback.service?.events || EVENT_PRIORITY_CLASSES.service.events)]
            },
            marketing: {
                ...(fallback.marketing || EVENT_PRIORITY_CLASSES.marketing),
                ...(rawSource.marketing || {}),
                events: Array.isArray(rawSource.marketing?.events) && rawSource.marketing.events.length
                    ? rawSource.marketing.events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean)
                    : [...(fallback.marketing?.events || EVENT_PRIORITY_CLASSES.marketing.events)]
            },
            guidance: {
                ...(fallback.guidance || EVENT_PRIORITY_CLASSES.guidance),
                ...(rawSource.guidance || {}),
                events: Array.isArray(rawSource.guidance?.events) && rawSource.guidance.events.length
                    ? rawSource.guidance.events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean)
                    : [...(fallback.guidance?.events || EVENT_PRIORITY_CLASSES.guidance.events)]
            }
        };
    }

    function getSceneEventPriorityCenter(scene = {}) {
        const center = normalizeSceneEventPriorityCenter(scene?.event_priority_center || {}, getEventPriorityCenter());
        return center.enabled ? center : getEventPriorityCenter();
    }

    function getScenePriorityPresetPacks(pageId = '') {
        const normalizedPageId = normalizeToken(pageId, 'home');
        return Array.isArray(SCENE_PRIORITY_PRESET_PACKS[normalizedPageId]) ? SCENE_PRIORITY_PRESET_PACKS[normalizedPageId] : [];
    }

    function getSceneAnalyticsSummary(pageId = '') {
        const normalizedPageId = normalizeToken(pageId, 'home');
        const rows = Array.isArray(state.payload?.analytics?.page_breakdown) ? state.payload.analytics.page_breakdown : [];
        const row = rows.find((entry) => normalizeToken(entry?.page_id, '') === normalizedPageId) || {};
        return {
            pageId: normalizedPageId,
            views: Number(row.views || 0) || 0,
            clicks: Number(row.clicks || 0) || 0,
            dismisses: Number(row.dismisses || 0) || 0,
            conversions: Number(row.conversions || 0) || 0,
            ctr: Number(row.ctr || 0) || 0,
            dismissRate: Number(row.dismiss_rate || 0) || 0
        };
    }

    function rankScenePriorityPresets(pageId = '', presets = []) {
        const normalizedPageId = normalizeToken(pageId, 'home');
        const currentScene = getSceneByPageId(normalizedPageId);
        const analytics = getSceneAnalyticsSummary(normalizedPageId);
        const currentMarketingEnabled = currentScene?.allow_marketing !== false;
        return (Array.isArray(presets) ? presets : []).map((preset) => {
            let score = 0;
            let reason = '适合作为当前页面的起步配置。';
            if (normalizedPageId === 'home') {
                if (analytics.dismissRate >= 45 || analytics.views >= 50 && analytics.ctr < 1.2) {
                    score += preset.id === 'home_quiet' ? 4 : 1;
                    reason = preset.id === 'home_quiet'
                        ? '首页关闭率偏高，先用更克制的首波节奏更稳。'
                        : reason;
                } else {
                    score += preset.id === 'home_balanced' ? 4 : 1;
                    reason = preset.id === 'home_balanced'
                        ? '首页表现稳定，平衡型更适合兼顾服务提醒和轻运营。'
                        : reason;
                }
            }
            if (normalizedPageId === 'shop') {
                if (analytics.dismissRate >= 40 || analytics.views >= 30 && analytics.ctr < 1) {
                    score += preset.id === 'shop_trade_guard' ? 4 : 1;
                    reason = preset.id === 'shop_trade_guard'
                        ? '商城当前更需要先稳住交易与售后体验，再谈转化。'
                        : reason;
                } else {
                    score += preset.id === 'shop_conversion' ? 4 : 1;
                    reason = preset.id === 'shop_conversion'
                        ? '商城点击和关闭表现还不错，可以把转化型提醒往前提一点。'
                        : reason;
                }
            }
            if (normalizedPageId === 'verify') {
                if (analytics.dismissRate >= 35 || analytics.views >= 20 && analytics.ctr < 1) {
                    score += preset.id === 'verify_supportive' ? 4 : 1;
                    reason = preset.id === 'verify_supportive'
                        ? '验证页打扰感偏高，先用更柔和的陪伴型节奏更合适。'
                        : reason;
                } else {
                    score += preset.id === 'verify_exception_first' ? 4 : 1;
                    reason = preset.id === 'verify_exception_first'
                        ? '验证链路需要更快处理异常，异常优先更贴合当前场景。'
                        : reason;
                }
            }
            if (preset.allow_marketing === false && currentMarketingEnabled === false) {
                score += 1;
            }
            if (preset.allow_marketing !== false && currentMarketingEnabled !== false) {
                score += 1;
            }
            return {
                ...preset,
                recommendation_score: score,
                recommendation_reason: reason
            };
        }).sort((left, right) => {
            const scoreDelta = Number(right.recommendation_score || 0) - Number(left.recommendation_score || 0);
            if (scoreDelta) return scoreDelta;
            return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
        });
    }

    function getScenePriorityGuidance(pageId = '') {
        const normalizedPageId = normalizeToken(pageId, 'home');
        const scene = getSceneByPageId(normalizedPageId);
        const analytics = getSceneAnalyticsSummary(normalizedPageId);
        const tips = [];

        if (analytics.dismissRate >= 45) {
            tips.push({
                tone: 'warning',
                title: '当前页面关闭率偏高',
                detail: `近 24 小时关闭率 ${formatPercent(analytics.dismissRate)}，不建议把营销提醒继续放进首波。`,
                action: '更适合先用更克制的分诊，优先保留风险、账户和售后事件。',
                buttonLabel: normalizedPageId === 'home' ? '一键切到首页安静型' : (normalizedPageId === 'shop' ? '一键切到商城交易保障' : '一键切到验证陪伴型'),
                actionType: 'preset',
                actionValue: normalizedPageId === 'home' ? 'home_quiet' : (normalizedPageId === 'shop' ? 'shop_trade_guard' : 'verify_supportive')
            });
        }
        if (analytics.views >= 30 && analytics.ctr < 1) {
            tips.push({
                tone: 'warning',
                title: '当前页面点击率偏低',
                detail: `CTR ${formatPercent(analytics.ctr)}，说明用户对当前首波提醒响应有限。`,
                action: '先减少首波事件数量，再优化文案和 CTA 会更稳。',
                buttonLabel: normalizedPageId === 'home' ? '改成首页安静型' : (normalizedPageId === 'shop' ? '改成商城交易保障' : '改成验证陪伴型'),
                actionType: 'preset',
                actionValue: normalizedPageId === 'home' ? 'home_quiet' : (normalizedPageId === 'shop' ? 'shop_trade_guard' : 'verify_supportive')
            });
        }
        if (scene.allow_marketing === false) {
            tips.push({
                tone: 'info',
                title: '当前页面已关闭营销触达',
                detail: '这个页面更适合服务型和异常型提醒。',
                action: '页面分诊里可以把营销类事件继续留空，避免产生配置和运行期语义冲突。'
            });
        }
        if (normalizedPageId === 'verify') {
            tips.push({
                tone: 'info',
                title: '验证页建议异常优先',
                detail: '验证失败、排队、到期和客服跟进，通常比成功或引导类提醒更值得先看到。',
                action: '首波里尽量不要混入营销型事件，避免用户在关键流程里分心。',
                buttonLabel: '套用验证异常优先',
                actionType: 'preset',
                actionValue: 'verify_exception_first'
            });
        }
        if (normalizedPageId === 'shop' && analytics.ctr >= 1.5 && analytics.dismissRate < 35) {
            tips.push({
                tone: 'success',
                title: '商城页承接转化条件不错',
                detail: `当前 CTR ${formatPercent(analytics.ctr)}，关闭率 ${formatPercent(analytics.dismissRate)}。`,
                action: '可以适度把优惠券、折扣和挽回类提醒后移但保留，不必一刀切禁掉。',
                buttonLabel: '套用商城转化增强',
                actionType: 'preset',
                actionValue: 'shop_conversion'
            });
        }

        return tips.slice(0, 3);
    }

    function renderScenePriorityGuidance(pageId = '') {
        const tips = getScenePriorityGuidance(pageId);
        if (!tips.length) return '';
        return `
            <div class="engagement-scene-guidance">
                ${tips.map((tip) => `
                    <article class="engagement-scene-guidance__item" data-tone="${escapeHtml(tip.tone || 'info')}">
                        <strong>${escapeHtml(tip.title || '分诊建议')}</strong>
                        <p>${escapeHtml(tip.detail || '')}</p>
                        <span>${escapeHtml(tip.action || '')}</span>
                        ${tip.buttonLabel ? `
                            <button
                                type="button"
                                class="engagement-scene-guidance__action"
                                data-engagement-action="apply-scene-guidance-action"
                                data-scene-guidance-action-type="${escapeHtml(tip.actionType || '')}"
                                data-scene-guidance-action-value="${escapeHtml(tip.actionValue || '')}"
                                data-page-id="${escapeHtml(pageId)}">${escapeHtml(tip.buttonLabel)}</button>
                        ` : ''}
                    </article>
                `).join('')}
            </div>
        `;
    }

    function getSceneSaveRiskWarnings(scene = {}) {
        const pageId = normalizeToken(scene?.page_id || scene?.id, 'home');
        const analytics = getSceneAnalyticsSummary(pageId);
        const effectivePriorityCenter = scene?.event_priority_center?.enabled === true
            ? normalizeSceneEventPriorityCenter(scene.event_priority_center || {}, getEventPriorityCenter())
            : getEventPriorityCenter();
        const firstWaveEvents = Array.isArray(effectivePriorityCenter?.first_wave?.events)
            ? effectivePriorityCenter.first_wave.events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean)
            : [];
        const marketingEventFamily = new Set((EVENT_PRIORITY_CLASSES.marketing?.events || [])
            .map((eventKey) => normalizeToken(eventKey, ''))
            .filter(Boolean));
        const firstWaveMarketingEvents = firstWaveEvents.filter((eventKey) => marketingEventFamily.has(eventKey));
        const warnings = [];

        if (firstWaveMarketingEvents.length && analytics.dismissRate >= 45) {
            warnings.push(`当前页面近 24 小时关闭率 ${formatPercent(analytics.dismissRate)}，但首波仍包含营销事件：${firstWaveMarketingEvents.map((eventKey) => getEventLabel(eventKey)).join('、')}。`);
        }
        if (firstWaveMarketingEvents.length && analytics.views >= 30 && analytics.ctr < 1) {
            warnings.push(`当前页面 CTR 只有 ${formatPercent(analytics.ctr)}，继续把营销事件放进首波，可能会进一步拉低响应。`);
        }
        if (pageId === 'verify' && firstWaveMarketingEvents.length) {
            warnings.push('验证页首波里混入营销事件，容易打断关键流程。');
        }

        return warnings;
    }

    function getSceneSaveRiskLevel(scene = {}) {
        const pageId = normalizeToken(scene?.page_id || scene?.id, 'home');
        const warnings = getSceneSaveRiskWarnings(scene);
        if (!warnings.length) return 'safe';
        if (pageId === 'verify') return 'high';
        if (warnings.length >= 2) return 'high';
        return 'warning';
    }

    function confirmSceneSaveRisk(scene = {}) {
        const warnings = getSceneSaveRiskWarnings(scene);
        if (!warnings.length) return true;
        const pageLabel = getPageLabel(scene?.page_id || scene?.id || 'home');
        const riskLevel = getSceneSaveRiskLevel(scene);
        const title = riskLevel === 'high'
            ? `${pageLabel}当前配置存在高风险首波触达：`
            : `${pageLabel}当前配置存在首波触达风险：`;
        const footer = riskLevel === 'high'
            ? '这是高风险保存，确认已经复核页面节奏后继续吗？'
            : '仍然保存这个页面场景吗？';
        return confirmRuleBatchAction([
            title,
            ...warnings.map((warning) => `- ${warning}`),
            '',
            footer
        ].join('\n'));
    }

    function renderEventPriorityBadge(eventKey = '') {
        const priorityClass = getEventPriorityClass(eventKey);
        return `<span class="engagement-event-priority-badge" data-tier="${escapeHtml(priorityClass.id)}">${escapeHtml(priorityClass.shortLabel || priorityClass.label)}</span>`;
    }

    function renderEventPriorityBadgeById(groupId = '') {
        const center = getEventPriorityCenter();
        const group = center[groupId] || center.service;
        return `<span class="engagement-event-priority-badge" data-tier="${escapeHtml(groupId || 'service')}">${escapeHtml(group.shortLabel || group.label)}</span>`;
    }

    function renderEventPriorityLegend() {
        const center = getEventPriorityCenter();
        return `
            <div class="engagement-event-priority-legend" aria-label="登录首波分诊说明">
                ${Object.entries(center).map(([groupId, group]) => `
                    <article class="engagement-event-priority-legend__item" data-tier="${escapeHtml(groupId)}">
                        <strong>${escapeHtml(group.label)}</strong>
                        <p>${escapeHtml(group.desc)}</p>
                    </article>
                `).join('')}
            </div>
        `;
    }

    function getSegmentScenarioOption(scenarioId = '') {
        const rawScenario = String(scenarioId || '').trim();
        if (!rawScenario) return null;
        const normalizedScenario = SEGMENT_SCENARIO_ALIASES[rawScenario] || rawScenario;
        return SEGMENT_SCENARIO_OPTIONS.find((option) => option.id === normalizedScenario) || null;
    }

    function normalizeSegmentScenarioValue(scenarioId = '') {
        const rawScenario = String(scenarioId || '').trim();
        if (!rawScenario) return '';
        const option = getSegmentScenarioOption(rawScenario);
        return option ? option.id : rawScenario;
    }

    function getSegmentScenarioLabel(scenarioId = '') {
        const rawScenario = String(scenarioId || '').trim();
        if (!rawScenario) return '自定义场景';
        const option = getSegmentScenarioOption(rawScenario);
        return option ? option.label : rawScenario;
    }

    function getUserTagLabel(tagKey = '') {
        const normalizedTag = normalizeUserTagKey(tagKey, '');
        if (!normalizedTag) return '用户标签';
        const tag = getUserTagCenter().tags.find((item) => normalizeUserTagKey(item?.key || item?.id, '') === normalizedTag);
        return tag?.name || tagKey;
    }

    function getSafeZoneLabel(safeZone = '') {
        return getOptionLabel(SAFE_ZONE_OPTIONS, safeZone || 'bottom-right') || '右下角';
    }

    function getTriggerTypeLabel(triggerType = '') {
        return getOptionLabel(TRIGGER_TYPE_OPTIONS, normalizeToken(triggerType, 'page_view')) || '进入页面';
    }

    function getAutomationBlueprintIntentFamily(blueprint = {}) {
        return normalizeToken(blueprint?.semanticFamily || blueprint?.id, '');
    }

    function getAutomationBlueprintIntentLabel(blueprint = {}) {
        return String(blueprint?.intentLabel || blueprint?.title || '自动化意图').trim() || '自动化意图';
    }

    function getAutomationIntentGroups() {
        const groupMap = new Map();
        AUTOMATION_BLUEPRINTS.forEach((blueprint) => {
            const familyId = getAutomationBlueprintIntentFamily(blueprint);
            if (!familyId) return;
            if (!groupMap.has(familyId)) {
                groupMap.set(familyId, {
                    familyId,
                    label: getAutomationBlueprintIntentLabel(blueprint),
                    blueprints: []
                });
            }
            groupMap.get(familyId).blueprints.push(blueprint);
        });
        return Array.from(groupMap.values())
            .filter((group) => group.blueprints.length > 1)
            .sort((first, second) => second.blueprints.length - first.blueprints.length || first.label.localeCompare(second.label, 'zh-CN'));
    }

    function getAutomationIntentGroupForBlueprint(blueprint = {}) {
        const familyId = getAutomationBlueprintIntentFamily(blueprint);
        if (!familyId) return null;
        return getAutomationIntentGroups().find((group) => group.familyId === familyId) || null;
    }

    function getAutomationBlueprintDisplayGroups() {
        const duplicatedFamilyIds = new Set(getAutomationIntentGroups().map((group) => group.familyId));
        const groups = [];
        const handledFamilies = new Set();
        AUTOMATION_BLUEPRINTS.forEach((blueprint) => {
            const familyId = getAutomationBlueprintIntentFamily(blueprint);
            if (duplicatedFamilyIds.has(familyId)) {
                if (handledFamilies.has(familyId)) return;
                const intentGroup = getAutomationIntentGroupForBlueprint(blueprint);
                if (!intentGroup) return;
                groups.push({
                    type: 'intent_group',
                    familyId,
                    label: intentGroup.label,
                    blueprints: intentGroup.blueprints
                });
                handledFamilies.add(familyId);
                return;
            }
            groups.push({
                type: 'single',
                familyId,
                label: getAutomationBlueprintIntentLabel(blueprint),
                blueprints: [blueprint]
            });
        });
        return groups;
    }

    function getPlacementLabel(placement = '') {
        return getOptionLabel(DISPLAY_PLACEMENT_OPTIONS, normalizeToken(placement, 'robot_bubble')) || '机器人气泡';
    }

    function getSourceModuleLabel(sourceModule = '') {
        const normalized = normalizeToken(sourceModule, 'engagement');
        const labels = {
            engagement: '触达规则',
            comments: '提示词评论',
            guestbook: '留言板',
            discounts: '优惠券',
            shop: '商城',
            points: '积分',
            permission: '账号权限'
        };
        return labels[normalized] || String(sourceModule || '').replace(/_/g, ' ') || '触达来源';
    }

    function getDeviceLabel(device = '') {
        const normalized = normalizeToken(device, 'unknown');
        const labels = {
            desktop: '桌面端',
            mobile: '移动端',
            tablet: '平板端',
            unknown: '未知设备'
        };
        return labels[normalized] || String(device || '').replace(/_/g, ' ') || '未知设备';
    }

    function getThemeLabel(theme = '') {
        const normalized = normalizeToken(theme, 'unknown');
        const labels = {
            light: '浅色主题',
            dark: '暗色主题',
            unknown: '未知主题'
        };
        return labels[normalized] || String(theme || '').replace(/_/g, ' ') || '未知主题';
    }

    function getViewportBucketLabel(bucket = '') {
        const normalized = normalizeToken(bucket, 'unknown');
        const labels = {
            compact_mobile: '小屏手机',
            mobile: '移动端',
            tablet: '平板宽度',
            desktop: '桌面宽度',
            unknown: '未知视口'
        };
        return labels[normalized] || String(bucket || '').replace(/_/g, ' ') || '未知视口';
    }

    function getRuleGovernance(rule = {}) {
        const metadata = rule.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata) ? rule.metadata : {};
        const stored = metadata.governance && typeof metadata.governance === 'object' && !Array.isArray(metadata.governance)
            ? metadata.governance
            : (rule.governance && typeof rule.governance === 'object' && !Array.isArray(rule.governance) ? rule.governance : null);
        if (stored?.risk_level) {
            return {
                risk_level: normalizeToken(stored.risk_level, 'low'),
                requires_review: stored.requires_review === true,
                reasons: Array.isArray(stored.reasons) ? stored.reasons.map((item) => String(item || '').trim()).filter(Boolean) : []
            };
        }

        const pageIds = Array.isArray(rule.page_ids) ? rule.page_ids.map((pageId) => normalizeToken(pageId, '')).filter(Boolean) : ['all'];
        const reasons = [];
        const priority = Number(rule.priority || 0) || 0;
        const placement = normalizeToken(rule.placement, 'robot_bubble');
        const tone = normalizeToken(rule.tone, 'info');
        if (pageIds.includes('all')) reasons.push('全站触达');
        if (priority >= 30) reasons.push('高优先级');
        if (['modal', 'top_banner'].includes(placement)) reasons.push('强展示形式');
        if (['warning', 'alert', 'error'].includes(tone)) reasons.push('警示语气');
        if (String(rule.action_label || '').trim() && !String(rule.action_url || '').trim()) reasons.push('按钮缺少链接');
        const riskLevel = reasons.length >= 3 ? 'high' : (reasons.length >= 1 ? 'medium' : 'low');
        return {
            risk_level: riskLevel,
            requires_review: riskLevel === 'high',
            reasons
        };
    }

    function getRuleRepeatIntervalMinutes(source = {}, fallback = 2) {
        const metadata = source?.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
            ? source.metadata
            : {};
        const parsed = Number.parseInt(
            source?.repeat_interval_minutes
                ?? source?.repeatIntervalMinutes
                ?? metadata.repeat_interval_minutes
                ?? metadata.repeatIntervalMinutes
                ?? fallback,
            10
        );
        const fallbackParsed = Number.parseInt(fallback, 10);
        const normalizedFallback = Number.isFinite(fallbackParsed) ? Math.min(Math.max(fallbackParsed, 0), 1440) : 2;
        if (!Number.isFinite(parsed)) return normalizedFallback;
        return Math.min(Math.max(parsed, 0), 1440);
    }

    function parseRuleDate(value = '') {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const localMatch = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (localMatch) {
            const [, yearText, monthText, dayText, hourText = '0', minuteText = '0', secondText = '0'] = localMatch;
            const year = Number.parseInt(yearText, 10);
            const month = Number.parseInt(monthText, 10);
            const day = Number.parseInt(dayText, 10);
            const hour = Number.parseInt(hourText, 10);
            const minute = Number.parseInt(minuteText, 10);
            const second = Number.parseInt(secondText, 10);
            const date = new Date(year, month - 1, day, hour, minute, second, 0);
            if (
                Number.isFinite(date.getTime())
                && date.getFullYear() === year
                && date.getMonth() === month - 1
                && date.getDate() === day
                && date.getHours() === hour
                && date.getMinutes() === minute
                && date.getSeconds() === second
            ) {
                return date;
            }
            return null;
        }
        const date = new Date(raw);
        return Number.isFinite(date.getTime()) ? date : null;
    }

    function formatRuleDateTimeLocal(value = '') {
        const date = parseRuleDate(value);
        if (!date) return '';
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
    }

    function normalizeRuleDateTimePayload(value = '') {
        const date = parseRuleDate(value);
        return date ? date.toISOString() : '';
    }

    function getRuleDateTimeLocalValue(value = '') {
        return formatRuleDateTimeLocal(value);
    }

    function getRuleNowDateTimeLocalValue() {
        return formatRuleDateTimeLocal(new Date().toISOString());
    }

    function isRuleDateTimeInFuture(value = '') {
        const localValue = getRuleDateTimeLocalValue(value);
        const nowValue = getRuleNowDateTimeLocalValue();
        return Boolean(localValue && nowValue && localValue > nowValue);
    }

    function normalizeRuleStatusForSchedule(status = 'draft', startsAt = '') {
        const normalizedStatus = normalizeToken(status, 'draft');
        if (normalizedStatus === 'draft' && normalizeRuleDateTimePayload(startsAt)) {
            return 'published';
        }
        return normalizedStatus;
    }

    function getRulePublishAtControlValue(form = document.getElementById('engagementRuleForm')) {
        if (!(form instanceof HTMLFormElement)) return '';
        const hiddenInput = form.querySelector('[data-engagement-publish-at-value]');
        const hiddenValue = hiddenInput instanceof HTMLInputElement ? formatRuleDateTimeLocal(hiddenInput.value) : '';
        if (hiddenValue) return hiddenValue;

        const dateInput = form.querySelector('[data-engagement-datetime-date]');
        const timeInput = form.querySelector('[data-engagement-datetime-time]');
        const composedValue = composeRuleDateTimeLocal(
            dateInput instanceof HTMLInputElement ? dateInput.value : '',
            timeInput instanceof HTMLInputElement ? timeInput.value : ''
        );
        if (composedValue) return composedValue;

        const label = form.querySelector('[data-engagement-datetime-label]');
        const labelValue = label?.textContent?.trim() || '';
        if (labelValue && labelValue !== '立即发布') {
            return formatRuleDateTimeLocal(labelValue);
        }
        return '';
    }

    function syncRulePublishAtHiddenValue(form = document.getElementById('engagementRuleForm')) {
        if (!(form instanceof HTMLFormElement)) return '';
        const localValue = getRulePublishAtControlValue(form);
        const hiddenInput = form.querySelector('[data-engagement-publish-at-value]');
        if (hiddenInput instanceof HTMLInputElement && localValue) {
            hiddenInput.value = localValue;
        }
        return localValue;
    }

    function getRuleDateTimeParts(value = '') {
        const localValue = formatRuleDateTimeLocal(value);
        if (!localValue) {
            return { date: '', time: '' };
        }
        const [date = '', time = ''] = localValue.split('T');
        return { date, time };
    }

    function formatRuleDateTimeDisplay(value = '') {
        const localValue = formatRuleDateTimeLocal(value);
        if (!localValue) return '立即发布';
        const [date = '', time = ''] = localValue.split('T');
        return `${date.replaceAll('-', '/')} ${time}`;
    }

    function getRulePublishQuickOptions() {
        return [
            ['immediate', '立即发布'],
            ['plus_10m', '10 分钟后'],
            ['plus_30m', '30 分钟后'],
            ['plus_2h', '2 小时后'],
            ['tomorrow_9', '明天 09:00']
        ];
    }

    function getRulePublishQuickValue(key = '') {
        const now = new Date();
        if (key === 'plus_10m') return formatRuleDateTimeLocal(new Date(now.getTime() + 10 * 60 * 1000).toISOString());
        if (key === 'plus_30m') return formatRuleDateTimeLocal(new Date(now.getTime() + 30 * 60 * 1000).toISOString());
        if (key === 'plus_2h') return formatRuleDateTimeLocal(new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString());
        if (key === 'tomorrow_9') {
            const tomorrowMorning = new Date(now);
            tomorrowMorning.setDate(now.getDate() + 1);
            tomorrowMorning.setHours(9, 0, 0, 0);
            return formatRuleDateTimeLocal(tomorrowMorning.toISOString());
        }
        return '';
    }

    function composeRuleDateTimeLocal(dateText = '', timeText = '') {
        const dateValue = String(dateText || '').trim();
        const timeValue = String(timeText || '').trim();
        if (!dateValue && !timeValue) return '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
        if (timeValue && !/^\d{2}:\d{2}$/.test(timeValue)) return null;
        const normalizedTime = timeValue || '09:00';
        const [year, month, day] = dateValue.split('-').map((item) => Number.parseInt(item, 10));
        const [hour, minute] = normalizedTime.split(':').map((item) => Number.parseInt(item, 10));
        const date = new Date(year, month - 1, day, hour, minute, 0, 0);
        if (!Number.isFinite(date.getTime())) return null;
        if (
            date.getFullYear() !== year
            || date.getMonth() !== month - 1
            || date.getDate() !== day
            || date.getHours() !== hour
            || date.getMinutes() !== minute
        ) {
            return null;
        }
        return formatRuleDateTimeLocal(date.toISOString());
    }

    function renderRulePublishDateTimePicker(value = '') {
        const normalizedValue = formatRuleDateTimeLocal(value);
        const parts = getRuleDateTimeParts(normalizedValue);
        const quickOptions = getRulePublishQuickOptions();
        return `
            <div class="engagement-field engagement-field--publish-at">
                <span>发布时间</span>
                <input name="starts_at" type="hidden" value="${escapeHtml(normalizedValue)}" data-engagement-publish-at-value>
                <div class="engagement-datetime ${normalizedValue ? 'has-value' : ''}" data-engagement-datetime-picker>
                    <button type="button" class="engagement-datetime__trigger" data-engagement-datetime-trigger aria-expanded="false">
                        <span class="engagement-datetime__main">
                            <i class="fas fa-calendar-days" aria-hidden="true"></i>
                            <strong data-engagement-datetime-label>${escapeHtml(formatRuleDateTimeDisplay(normalizedValue))}</strong>
                        </span>
                        <span class="engagement-datetime__chevron" aria-hidden="true"></span>
                    </button>
                    <div class="engagement-datetime__panel" data-engagement-datetime-panel hidden>
                        <div class="engagement-datetime__fields">
                            <label>
                                <span>日期</span>
                                <input type="text" inputmode="numeric" maxlength="10" placeholder="YYYY-MM-DD" value="${escapeHtml(parts.date)}" data-engagement-datetime-date>
                            </label>
                            <label>
                                <span>时间</span>
                                <input type="text" inputmode="numeric" maxlength="5" placeholder="HH:mm" value="${escapeHtml(parts.time)}" data-engagement-datetime-time>
                            </label>
                        </div>
                        <div class="engagement-datetime__quick" aria-label="快速选择发布时间">
                            ${quickOptions.map(([key, label]) => `
                                <button type="button" data-engagement-datetime-quick="${escapeHtml(key)}">${escapeHtml(label)}</button>
                            `).join('')}
                        </div>
                        <div class="engagement-datetime__actions">
                            <button type="button" data-engagement-datetime-clear>清空</button>
                            <button type="button" data-engagement-datetime-apply>应用时间</button>
                        </div>
                    </div>
                </div>
                <small>留空立即发布，设置未来时间则到点自动生效。</small>
            </div>
        `;
    }

    function renderRuleEffectiveStatusNote(effectiveStatusInfo = {}) {
        const tone = normalizeToken(effectiveStatusInfo.tone || 'draft', 'draft');
        const icon = effectiveStatusInfo.icon || 'fa-pen';
        const label = effectiveStatusInfo.label || '草稿';
        const detail = effectiveStatusInfo.detail || '草稿状态不会在前台展示';
        return `
            <span>生效状态</span>
            <div class="engagement-rule-status-note__card" data-tone="${escapeHtml(tone)}">
                <span class="engagement-rule-status-note__icon">
                    <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
                </span>
                <span class="engagement-rule-status-note__copy">
                    <strong>${escapeHtml(label)}</strong>
                    <small>${escapeHtml(detail)}</small>
                </span>
            </div>
        `;
    }

    function isRuleScheduledForFuture(rule = {}) {
        const status = normalizeToken(rule.status, 'draft');
        return status === 'published' && isRuleDateTimeInFuture(rule.starts_at || rule.startsAt);
    }

    function isRuleRunningNow(rule = {}) {
        return rule?.enabled === true
            && normalizeToken(rule?.status, 'draft') === 'published'
            && !isRuleScheduledForFuture(rule);
    }

    function getRuleEffectiveStatusInfo(rule = {}) {
        const status = normalizeToken(rule.status, 'draft');
        const startsAt = parseRuleDate(rule.starts_at || rule.startsAt);
        if (status === 'published' && isRuleDateTimeInFuture(rule.starts_at || rule.startsAt)) {
            return {
                tone: 'scheduled',
                icon: 'fa-clock',
                label: '定时发布',
                detail: `${startsAt.toLocaleString('zh-CN')} 自动生效`
            };
        }
        if (status === 'published') {
            return {
                tone: 'running',
                icon: 'fa-bolt',
                label: '发布即启用',
                detail: '保存后立即进入前台候选'
            };
        }
        if (status === 'paused') {
            return {
                tone: 'paused',
                icon: 'fa-pause',
                label: '暂停中',
                detail: '暂停状态不会在前台展示'
            };
        }
        return {
            tone: 'draft',
            icon: 'fa-pen',
            label: getOptionLabel(RULE_STATUS_OPTIONS, status) || '草稿',
            detail: '草稿状态不会在前台展示'
        };
    }

    function getRiskLabel(riskLevel = '') {
        const normalized = normalizeToken(riskLevel, 'low');
        if (normalized === 'high') return '高风险';
        if (normalized === 'medium') return '需关注';
        return '低风险';
    }

    function needsGovernancePublishAck(rule = {}) {
        const governance = getRuleGovernance(rule);
        return rule?.enabled === true
            && normalizeToken(rule?.status, 'draft') === 'published'
            && governance.requires_review === true;
    }

    function buildGovernancePublishAck(rule = {}, source = 'admin_studio_confirm') {
        return {
            governance_acknowledged: true,
            governance_ack_reason: source,
            metadata: {
                ...(rule.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata) ? rule.metadata : {}),
                governance_review: {
                    acknowledged: true,
                    reason: source,
                    acknowledged_at: new Date().toISOString()
                }
            }
        };
    }

    function confirmHighRiskPublish(rule = {}, contextLabel = '这条规则') {
        if (!needsGovernancePublishAck(rule)) {
            return true;
        }
        const governance = getRuleGovernance(rule);
        const reasons = Array.isArray(governance.reasons) && governance.reasons.length
            ? `\n风险原因：${governance.reasons.join('、')}`
            : '';
        const message = `${contextLabel}属于高风险触达，发布后可能全站或强打扰展示。${reasons}\n\n确认已经复核文案、页面、频率和跳转链接，并继续发布吗？`;
        return confirmRuleBatchAction(message);
    }

    function getWorkspaceView(viewId = '') {
        const normalized = normalizeToken(viewId, 'dashboard');
        return WORKSPACE_VIEWS.find(([id]) => id === normalized) || WORKSPACE_VIEWS[0];
    }

    function getWorkspaceGroup(groupId = '') {
        const normalized = normalizeToken(groupId, 'overview');
        return WORKSPACE_GROUPS.find(([id]) => id === normalized) || WORKSPACE_GROUPS[0];
    }

    function getWorkspaceGroupForView(viewId = '') {
        const normalizedView = getWorkspaceView(viewId)[0];
        return WORKSPACE_GROUPS.find(([, , , , views]) => Array.isArray(views) && views.includes(normalizedView)) || WORKSPACE_GROUPS[0];
    }

    function getWorkspaceGroupViews(groupId = '') {
        const [, , , , views] = getWorkspaceGroup(groupId);
        return Array.isArray(views) ? views.map((viewId) => getWorkspaceView(viewId)) : [];
    }

    function getCapabilityById(capabilityId = '') {
        const normalized = normalizeToken(capabilityId, '');
        return CAPABILITY_GROUPS.find((capability) => capability.id === normalized) || null;
    }

    function getFocusedCapability() {
        return getCapabilityById(state.focusedCapabilityId);
    }

    function getWorkspaceViewMetric(viewId = '', payload = {}) {
        const metrics = payload.metrics || {};
        const governance = payload.governance || {};
        const auditLogs = Array.isArray(payload.audit_logs) ? payload.audit_logs : [];
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const templates = Array.isArray(payload.templates) ? payload.templates : [];
        const scenes = Array.isArray(payload.page_scenes) ? payload.page_scenes : [];
        const assets = Array.isArray(payload.asset_center?.assets) ? payload.asset_center.assets : [];
        const supportContexts = Array.isArray(payload.support_entry?.contexts) ? payload.support_entry.contexts : [];
        const runningRules = rules.filter((rule) => isRuleRunningNow(rule)).length;
        switch (viewId) {
            case 'dashboard':
                return `${formatNumber(metrics.views)} 曝光`;
            case 'rules':
                return `${formatNumber(runningRules)} 运行中`;
            case 'templates':
                return `${formatNumber(templates.length)} 模板`;
            case 'scenes':
                return `${formatNumber(scenes.length)} 页面`;
            case 'segments':
                return `${formatNumber(AUDIENCE_SEGMENTS.length)} 分群`;
            case 'automation':
                return `${formatNumber(AUTOMATION_BLUEPRINTS.length)} 蓝图`;
            case 'entry':
                return `${formatNumber(supportContexts.length)} 入口`;
            case 'analytics':
                return `${formatNumber(metrics.clicks)} 点击`;
            case 'assets':
                return `${formatNumber(assets.length)} 素材`;
            case 'audit':
                return `${formatNumber(auditLogs.length)} 记录`;
            case 'settings':
                return `${formatNumber(governance.high_risk_rules)} 风险`;
            default:
                return '规划中';
        }
    }

    function getWorkspaceGroupMetric(groupId = '', payload = {}) {
        const normalizedGroup = getWorkspaceGroup(groupId)[0];
        const metrics = payload.metrics || {};
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const auditLogs = Array.isArray(payload.audit_logs) ? payload.audit_logs : [];
        const scenes = Array.isArray(payload.page_scenes)
            ? payload.page_scenes
            : (Array.isArray(state.payload?.page_scenes) ? state.payload.page_scenes : []);
        const runningRules = rules.filter((rule) => isRuleRunningNow(rule)).length;
        switch (normalizedGroup) {
            case 'overview':
                return `${formatNumber(metrics.views)} 曝光 · ${formatNumber(metrics.clicks)} 点击`;
            case 'orchestration':
                return `${formatNumber(runningRules)} 运行规则 · ${formatNumber(AUTOMATION_BLUEPRINTS.length)} 蓝图`;
            case 'audience':
                return `${formatNumber(scenes.length)} 页面 · ${formatNumber(AUDIENCE_SEGMENTS.length)} 分群`;
            case 'governance':
                return `${formatNumber(auditLogs.length)} 审计 · ${formatNumber(payload.governance?.high_risk_rules || 0)} 风险`;
            default:
                return '按业务目标管理';
        }
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('zh-CN').format(Number(value || 0) || 0);
    }

    function formatPercent(value) {
        const number = Number(value || 0) || 0;
        const rounded = Math.round(number * 10) / 10;
        return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
    }

    function getAuditActionLabel(actionType = '') {
        const normalized = String(actionType || '').trim();
        const labels = {
            'engagement.rule.create': '创建规则',
            'engagement.rule.update': '更新规则',
            'engagement.rule.publish': '发布规则',
            'engagement.rule.pause': '暂停规则',
            'engagement.rule.pause_all': '暂停全部',
            'engagement.rule.archive': '归档规则'
        };
        return labels[normalized] || normalized.replace(/^engagement\./, '').replace(/\./g, ' ') || '触达变更';
    }

    function buildAdminUrl(route, params = {}) {
        const url = new URL('/api/admin', globalScope.location.origin);
        url.searchParams.set('route', route);
        Object.entries(params).forEach(([key, value]) => {
            const normalized = String(value ?? '').trim();
            if (normalized) {
                url.searchParams.set(key, normalized);
            }
        });
        return `${url.pathname}${url.search}`;
    }

    async function getFallbackAccessToken() {
        try {
            const authClient = globalScope?.supabaseClient?.auth || globalScope?.supabase?.auth;
            const sessionResult = await authClient?.getSession?.();
            return String(sessionResult?.data?.session?.access_token || '').trim();
        } catch (_) {
            return '';
        }
    }

    async function engagementAdminFetch(input, init = {}) {
        const timeoutMs = Number(init?.timeoutMs || 12000) || 12000;
        const hasCustomSignal = Boolean(init?.signal);
        const controller = !hasCustomSignal && typeof AbortController !== 'undefined'
            ? new AbortController()
            : null;
        let timeoutId = 0;
        if (controller && typeof globalScope.setTimeout === 'function') {
            timeoutId = globalScope.setTimeout(() => controller.abort(), timeoutMs);
        }
        const requestInit = {
            credentials: 'include',
            ...(init || {}),
            authMode: 'bearer',
            forceBearerToken: true,
            ...(controller ? { signal: controller.signal } : {})
        };
        delete requestInit.timeoutMs;

        try {
            if (typeof globalScope.AdminApi?.fetch === 'function') {
                return await globalScope.AdminApi.fetch(input, requestInit);
            }

            const {
                authMode,
                forceBearerToken,
                ...fetchInit
            } = requestInit;
            const headers = new Headers(fetchInit.headers || {});
            if (!headers.has('Authorization')) {
                const token = await getFallbackAccessToken();
                if (token) {
                    headers.set('Authorization', `Bearer ${token}`);
                }
            }

            return await fetch(input, {
                ...fetchInit,
                headers
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('客服系统请求超时，请稍后重试');
            }
            throw error;
        } finally {
            if (timeoutId && typeof globalScope.clearTimeout === 'function') {
                globalScope.clearTimeout(timeoutId);
            }
        }
    }

    function buildRequestErrorMessage(response, payload = {}, fallbackMessage = '客服系统接口异常') {
        if (Number(response?.status || 0) === 401) {
            return '登录状态已过期，请重新登录后再操作客服系统';
        }
        if (Number(response?.status || 0) === 403) {
            return '当前账号没有客服系统管理权限，请确认拥有「客服消息」或「设置」权限';
        }
        return payload?.message || `${fallbackMessage} (${response?.status || 'network'})`;
    }

    function setLoading(message = '客服系统加载中...') {
        const container = getOverviewContainer();
        if (!container) return;

        container.classList.add('engagement-overview--loading');
        const dots = typeof globalScope.AdminShell?.buildLoadingDotsMarkup === 'function'
            ? globalScope.AdminShell.buildLoadingDotsMarkup(message, { variant: 'block', tagName: 'div' })
            : `<div class="engagement-loading"><span>${escapeHtml(message)}</span></div>`;
        container.innerHTML = dots;
    }

    function renderError(error) {
        const container = getOverviewContainer();
        if (!container) return;

        container.classList.remove('engagement-overview--loading');
        container.innerHTML = `
            <section class="engagement-state engagement-state--error">
                <div>
                    <strong>客服系统暂时不可用</strong>
                    <p>${escapeHtml(error?.message || '加载触达中心数据失败')}</p>
                </div>
                <button type="button" class="engagement-refresh-btn" data-engagement-action="refresh">
                    <i class="fas fa-rotate"></i>
                    <span>重试</span>
                </button>
            </section>
        `;
    }

    function isOverviewTimeoutError(error) {
        const message = String(error?.message || '').toLowerCase();
        return error?.name === 'AbortError'
            || message.includes('请求超时')
            || message.includes('timeout')
            || message.includes('timed out');
    }

    function createDegradedOverviewPayload(error = {}) {
        const message = String(error?.message || '客服系统总览请求超时').trim() || '客服系统总览请求超时';
        return {
            success: true,
            schema_ready: false,
            degraded: true,
            offline: true,
            page_scenes: DEFAULT_PAGE_SCENES.map((scene) => ({ ...scene })),
            event_priority_center: {
                first_wave: { ...EVENT_PRIORITY_CLASSES.first_wave, events: [...EVENT_PRIORITY_CLASSES.first_wave.events] },
                service: { ...EVENT_PRIORITY_CLASSES.service, events: [...EVENT_PRIORITY_CLASSES.service.events] },
                marketing: { ...EVENT_PRIORITY_CLASSES.marketing, events: [...EVENT_PRIORITY_CLASSES.marketing.events] },
                guidance: { ...EVENT_PRIORITY_CLASSES.guidance, events: [...EVENT_PRIORITY_CLASSES.guidance.events] }
            },
            rules: [],
            templates: [],
            segments: [],
            audit_logs: [],
            metrics: {
                last_24h_events: 0,
                views: 0,
                clicks: 0,
                dismisses: 0,
                conversions: 0,
                active_rules: 0
            },
            analytics: {
                funnel: [],
                attribution: [],
                page_breakdown: [],
                rule_breakdown: [],
                placement_breakdown: [],
                action_breakdown: [],
                trigger_breakdown: [],
                audience_breakdown: [],
                device_breakdown: [],
                source_breakdown: [],
                experience_quality: {
                    measured_views: 0,
                    overflow_views: 0,
                    tight_edge_views: 0
                }
            },
            asset_center: {
                style: {
                    enabled: true,
                    preset: 'studio_blue',
                    accent_color: '#6b9ece',
                    title_color: '#5f95cc',
                    bubble_background: '#ffffff',
                    text_color: '#1f2937',
                    radius_px: 22,
                    max_width_px: 520,
                    density: 'comfortable',
                    shadow: 'soft',
                    animation: 'gentle',
                    robot_variant: 'default'
                },
                assets: []
            },
            support_entry: {
                enabled: true,
                entry_label: '常用入口',
                entry_label_en: 'Quick Help',
                root_menus: ['exchange', 'shop', 'verify', 'human'],
                telegram_url: 'https://t.me/zaoyoe',
                ticket_enabled: true,
                live_chat_enabled: true,
                ticket_sla_hours: 24,
                ticket_prompt: '把“关联 ID + 问题描述”发我，我会帮你生成一条客服工单。',
                ticket_placeholder: '输入关联 ID 和问题描述',
                ticket_input_hint: '示例：order:订单号 卡密未到账、task:任务号 一直失败、code:兑换码 显示已使用',
                contexts: [
                    {
                        id: 'default',
                        label: '常用入口',
                        intro: '优先帮用户处理兑换、发放和任务状态问题。',
                        shortcuts: ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat'],
                        enabled: true
                    }
                ],
                guides: []
            },
            tag_center: {
                sources: USER_TAG_SOURCE_OPTIONS.map(([value]) => value),
                tags: [],
                automation: {}
            },
            external_embed: {
                diagnostics: {
                    status: 'attention',
                    recommended_actions: ['总览数据超时，先使用本地默认配置渲染工作台。']
                }
            },
            governance: {
                high_risk_rules: 0,
                running_rules: 0,
                paused_rules: 0,
                archived_rules: 0
            },
            diagnostics: {
                status: 'attention',
                notification_bridge: {
                    status: 'idle',
                    event_types_count: 0,
                    running_rule_count: 0,
                    multi_rule_event_types_count: 0,
                    events: []
                },
                checklist: [],
                tips: [{
                    tone: 'warning',
                    title: '实时数据暂时不可用',
                    detail: '已先进入降级工作台，规则、模板和样式入口不会因为 overview 超时整页消失。'
                }]
            },
            overview_health: {
                status: 'degraded',
                timeout_ms: 30000,
                degraded_tasks: [{
                    label: 'overview',
                    code: 'CLIENT_OVERVIEW_TIMEOUT',
                    message
                }],
                timed_out_tasks: ['overview']
            }
        };
    }

    async function fetchOverview() {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/overview', {
            site: getCurrentSite()
        }), {
            method: 'GET',
            timeoutMs: 30000
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(buildRequestErrorMessage(response, payload, '客服系统接口异常'));
        }
        return payload;
    }

    async function fetchSegmentsAndTagCenter() {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/segments'), {
            method: 'GET',
            timeoutMs: 15000
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(buildRequestErrorMessage(response, payload, '用户标签同步失败'));
        }
        return payload;
    }

    async function mutateRule(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/rules'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '规则保存失败'));
        }
        broadcastEngagementFeedChange('rule_changed', {
            action: payload.action,
            page_ids: getEngagementMutationBroadcastPages(payload, result)
        });
        return result;
    }

    async function mutateTemplate(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/templates'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '模板保存失败'));
        }
        return result;
    }

    async function mutateSegment(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/segments'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '用户分群保存失败'));
        }
        broadcastEngagementFeedChange('segment_changed', {
            action: payload.action,
            page_ids: ['all']
        });
        return result;
    }

    async function mutateScene(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/scenes'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '页面场景保存失败'));
        }
        broadcastEngagementFeedChange('scene_changed', {
            action: payload.action,
            page_ids: getEngagementMutationBroadcastPages(payload, result)
        });
        return result;
    }

    async function mutateAssets(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/assets'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '素材与样式保存失败'));
        }
        broadcastEngagementFeedChange('asset_center_changed', {
            action: payload.action,
            page_ids: getEngagementMutationBroadcastPages(payload, result)
        });
        return result;
    }

    async function mutateEntry(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/entry'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '客服入口保存失败'));
        }
        broadcastEngagementFeedChange('support_entry_changed', {
            action: payload.action,
            page_ids: ['all']
        });
        return result;
    }

    async function mutateExternalEmbed(payload = {}) {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/external'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
            throw new Error(buildRequestErrorMessage(response, result, '外部承载配置保存失败'));
        }
        return result;
    }

    function showFeedback(message = '', tone = 'info') {
        if (typeof globalScope.showAdminActionFeedback === 'function') {
            globalScope.showAdminActionFeedback(message, tone);
            return;
        }
        if (typeof globalScope.showToast === 'function') {
            globalScope.showToast(message, tone);
        }
    }

    function showActionError(error, fallbackMessage = '客服系统操作失败') {
        showFeedback(error?.message || fallbackMessage, 'error');
    }

    function renderMetrics(metrics = {}) {
        const items = [
            ['views', '气泡曝光', metrics.views],
            ['clicks', '用户点击', metrics.clicks],
            ['dismisses', '用户关闭', metrics.dismisses],
            ['conversions', '转化事件', metrics.conversions]
        ];

        return `
            <section class="engagement-metrics" aria-label="近 24 小时触达指标">
                ${items.map(([key, label, value]) => `
                    <article class="engagement-metric engagement-metric--${escapeHtml(key)}">
                        <span>${escapeHtml(label)}</span>
                        <strong>${formatNumber(value)}</strong>
                    </article>
                `).join('')}
            </section>
        `;
    }

    function renderSchemaNotice(payload = {}) {
        if (payload.offline === true) {
            return `
                <section class="engagement-state engagement-state--warning">
                    <i class="fas fa-triangle-exclamation"></i>
                    <div>
                        <strong>实时数据暂时超时</strong>
                        <p>已先进入降级工作台，规则、模板、页面场景和样式入口仍可查看；点击重新加载可恢复实时统计。</p>
                    </div>
                </section>
            `;
        }

        if (payload.schema_ready !== false) {
            return `
                <section class="engagement-state engagement-state--ready">
                    <i class="fas fa-circle-check"></i>
                    <div>
                        <strong>机器人气泡协议已接入</strong>
                        <p>公共页客服机器人会读取触达规则与用户通知，并回传曝光、点击、关闭和转化事件。</p>
                    </div>
                </section>
            `;
        }

        return `
            <section class="engagement-state engagement-state--warning">
                <i class="fas fa-triangle-exclamation"></i>
                <div>
                    <strong>等待数据库迁移生效</strong>
                    <p>触达中心表结构尚未在当前环境可见，迁移完成后会显示规则、模板和事件统计。</p>
                </div>
            </section>
        `;
    }

    function getEditableRule() {
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        return rules.find((rule) => String(rule?.id || '') === state.editingRuleId) || null;
    }

    function getRuleById(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return null;
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        return rules.find((rule) => String(rule?.id || '').trim() === normalizedId) || null;
    }

    function getTemplateByRef(templateRef = '') {
        const normalizedRef = String(templateRef || '').trim();
        if (!normalizedRef) return null;
        const templates = Array.isArray(state.payload?.templates) ? state.payload.templates : [];
        return templates.find((template) => (
            String(template?.id || '').trim() === normalizedRef
            || String(template?.key || '').trim() === normalizedRef
        )) || null;
    }

    function getTemplateDraft() {
        return getTemplateByRef(state.templateDraftRef);
    }

    function getEditableTemplate() {
        return getTemplateByRef(state.editingTemplateRef);
    }

    function getManagedSegments() {
        return Array.isArray(state.payload?.segments) ? state.payload.segments : [];
    }

    function getAudienceSegments() {
        const segmentMap = new Map();
        AUDIENCE_SEGMENTS.forEach((segment) => {
            segmentMap.set(segment.id, {
                ...segment,
                key: segment.id,
                name: segment.title,
                description: segment.desc,
                enabled: true,
                source: 'builtin'
            });
        });

        getManagedSegments().forEach((segment) => {
            const segmentId = normalizeToken(segment.scope || segment.key || segment.id, '');
            if (!segmentId) return;
            segmentMap.set(segmentId, {
                id: segmentId,
                key: segment.key || segmentId,
                dbId: segment.id || '',
                title: segment.title || segment.name || segmentId,
                name: segment.name || segment.title || segmentId,
                desc: segment.desc || segment.description || '',
                description: segment.description || segment.desc || '',
                icon: segment.icon || 'fa-users',
                pageIds: Array.isArray(segment.pageIds) && segment.pageIds.length ? segment.pageIds : ['all'],
                examples: Array.isArray(segment.examples) ? segment.examples : [],
                emails: Array.isArray(segment.emails) ? segment.emails : (Array.isArray(segment.email_targets) ? segment.email_targets : []),
                tags: Array.isArray(segment.tags) ? segment.tags : (Array.isArray(segment.tag_targets) ? segment.tag_targets : []),
                enabled: segment.enabled !== false,
                source: 'managed'
            });
        });

        return Array.from(segmentMap.values());
    }

    function getAudienceSegmentByScope(scope = '') {
        const normalizedScope = normalizeToken(scope, 'all');
        return getAudienceSegments().find((segment) => normalizeToken(segment.id || segment.key, '') === normalizedScope)
            || getAudienceSegments()[0]
            || AUDIENCE_SEGMENTS[0];
    }

    function getEditableSegment() {
        const normalizedRef = String(state.editingSegmentRef || '').trim();
        if (!normalizedRef) return null;
        return getAudienceSegments().find((segment) => (
            String(segment.dbId || '').trim() === normalizedRef
            || String(segment.key || '').trim() === normalizedRef
            || String(segment.id || '').trim() === normalizedRef
        )) || null;
    }

    function getAudienceScopeOptions() {
        const optionMap = new Map(AUDIENCE_SCOPE_OPTIONS);
        getAudienceSegments().forEach((segment) => {
            const scope = normalizeToken(segment.id || segment.key, '');
            if (scope && !optionMap.has(scope)) {
                optionMap.set(scope, segment.title || segment.name || scope);
            }
        });
        return Array.from(optionMap.entries());
    }

    function getSceneByPageId(pageId = '') {
        const normalizedPageId = normalizeToken(pageId, 'home');
        const scenes = Array.isArray(state.payload?.page_scenes) ? state.payload.page_scenes : [];
        return scenes.find((scene) => normalizeToken(scene.id || scene.page_id, '') === normalizedPageId)
            || {
                id: normalizedPageId,
                label: getPageLabel(normalizedPageId),
                tone: 'info',
                safe_zone: 'bottom-right',
                default_placement: 'robot_bubble',
                allow_marketing: true,
                events: [],
                event_priority_center: {
                    enabled: false
                }
            };
    }

    function getEditableScene() {
        return getSceneByPageId(state.editingScenePageId || state.focusedPageId || 'home');
    }

    function normalizeHexColor(value = '', fallback = '#6b9ece') {
        const normalized = String(value || '').trim().toLowerCase();
        return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
    }

    function getColorPresetValue(color = '') {
        const normalized = normalizeHexColor(color, '');
        return COLOR_PRESET_OPTIONS.some(([value]) => value === normalized) ? normalized : 'custom';
    }

    function getAssetCenter() {
        const center = state.payload?.asset_center && typeof state.payload.asset_center === 'object' && !Array.isArray(state.payload.asset_center)
            ? state.payload.asset_center
            : {};
        return {
            style: {
                enabled: center.style?.enabled !== false,
                preset: center.style?.preset || 'studio_blue',
                accent_color: normalizeHexColor(center.style?.accent_color, '#6b9ece'),
                title_color: normalizeHexColor(center.style?.title_color, '#5f95cc'),
                bubble_background: normalizeHexColor(center.style?.bubble_background, '#ffffff'),
                text_color: normalizeHexColor(center.style?.text_color, '#1f2937'),
                radius_px: Number(center.style?.radius_px || 22) || 22,
                max_width_px: Number(center.style?.max_width_px || 520) || 520,
                density: center.style?.density || 'comfortable',
                shadow: center.style?.shadow || 'soft',
                animation: center.style?.animation || 'gentle',
                robot_variant: center.style?.robot_variant || 'default'
            },
            assets: Array.isArray(center.assets) ? center.assets : []
        };
    }

    function getEditableAsset() {
        const assetId = String(state.editingAssetId || '').trim();
        if (!assetId) return null;
        return getAssetCenter().assets.find((asset) => String(asset?.id || '').trim() === assetId) || null;
    }

    function getAssetStylePresetById(presetId = '') {
        const normalizedId = normalizeToken(presetId, 'studio_blue');
        return ASSET_STYLE_PRESET_PACKS.find((preset) => preset.id === normalizedId) || ASSET_STYLE_PRESET_PACKS[0];
    }

    function getAssetPageScope(asset = {}) {
        const pageIds = Array.isArray(asset.page_ids) && asset.page_ids.length
            ? asset.page_ids.map((pageId) => normalizeToken(pageId, '')).filter(Boolean)
            : ['all'];
        if (!pageIds.length || pageIds.includes('all')) return ['all'];
        return pageIds;
    }

    function getAssetScopeLabel(asset = {}) {
        const pageIds = getAssetPageScope(asset);
        if (pageIds.includes('all')) return '全站可用';
        return pageIds.map(getPageLabel).join(' / ');
    }

    function getAssetUsageByPage() {
        const assets = getAssetCenter().assets;
        return RULE_PAGE_OPTIONS.map((pageId) => {
            const pageAssets = assets.filter((asset) => {
                const scope = getAssetPageScope(asset);
                return scope.includes('all') || scope.includes(pageId);
            });
            const enabled = pageAssets.filter((asset) => asset.enabled !== false);
            const tones = new Set(enabled.map((asset) => normalizeToken(asset.tone, 'info')).filter(Boolean));
            return {
                page_id: pageId,
                page_label: getPageLabel(pageId),
                assets: pageAssets.length,
                enabled: enabled.length,
                tones: tones.size
            };
        });
    }

    function getSupportEntryCenter() {
        const entry = state.payload?.support_entry && typeof state.payload.support_entry === 'object' && !Array.isArray(state.payload.support_entry)
            ? state.payload.support_entry
            : {};
        const contexts = Array.isArray(entry.contexts) && entry.contexts.length
            ? entry.contexts
            : [
                {
                    id: 'default',
                    label: '常用入口',
                    intro: '优先帮用户处理兑换、发放和任务状态问题。',
                    shortcuts: ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat'],
                    enabled: true
                },
                {
                    id: 'shop',
                    label: '商城快捷入口',
                    intro: '商城页优先处理订单发放、优惠码和工单问题。',
                    shortcuts: ['shop_order_status', 'shop_order_content', 'discount_help', 'create_ticket', 'live_chat'],
                    enabled: true
                },
                {
                    id: 'verify',
                    label: '验证快捷入口',
                    intro: '验证页优先处理任务进度、失败原因和重提前检查。',
                    shortcuts: ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket', 'live_chat'],
                    enabled: true
                }
            ];
        const guides = Array.isArray(entry.guides) ? entry.guides : [];
        return {
            enabled: entry.enabled !== false,
            entry_label: entry.entry_label || '常用入口',
            entry_label_en: entry.entry_label_en || 'Quick Help',
            root_menus: Array.isArray(entry.root_menus) && entry.root_menus.length ? entry.root_menus : ['exchange', 'shop', 'verify', 'human'],
            telegram_url: entry.telegram_url || 'https://t.me/zaoyoe',
            ticket_enabled: entry.ticket_enabled !== false,
            live_chat_enabled: entry.live_chat_enabled !== false,
            ticket_sla_hours: Number(entry.ticket_sla_hours || 24) || 24,
            ticket_prompt: entry.ticket_prompt || '把“关联 ID + 问题描述”发我，我会帮你生成一条客服工单。',
            ticket_placeholder: entry.ticket_placeholder || '输入关联 ID 和问题描述',
            ticket_input_hint: entry.ticket_input_hint || '示例：order:订单号 卡密未到账、task:任务号 一直失败、code:兑换码 显示已使用',
            contexts,
            guides
        };
    }

    function getEditableSupportContext() {
        const entry = getSupportEntryCenter();
        const contextId = normalizeToken(state.editingSupportContextId || 'default', 'default');
        return entry.contexts.find((context) => normalizeToken(context?.id || 'default', 'default') === contextId)
            || entry.contexts[0]
            || null;
    }

    function getUserTagCenter() {
        const center = state.payload?.tag_center && typeof state.payload.tag_center === 'object' && !Array.isArray(state.payload.tag_center)
            ? state.payload.tag_center
            : {};
        const defaultAutomation = {
            high_value: {
                enabled: true,
                min_paid_amount: 500,
                min_points: 5000,
                min_order_count: 5
            },
            payment_failed: {
                enabled: true,
                window_days: 7,
                min_count: 1
            },
            verify_failed: {
                enabled: true,
                window_days: 7,
                min_count: 1
            },
            inactive: {
                enabled: false,
                inactive_days: 30
            }
        };
        const sourceAutomation = center.automation && typeof center.automation === 'object' && !Array.isArray(center.automation)
            ? center.automation
            : {};
        const hiddenTagSet = new Set((Array.isArray(center.hidden_user_tags) ? center.hidden_user_tags : [])
            .map((tagKey) => normalizeUserTagKey(tagKey, ''))
            .filter(Boolean));
        const fallbackTags = [
            {
                key: 'paid_user',
                name: '已充值用户',
                description: '有成功充值、购买或积分到账记录。',
                source: 'purchase',
                auto_rule: '支付成功、订单完成或积分充值到账后写入 paid_user',
                enabled: true
            },
            {
                key: 'high_value',
                name: '高价值用户',
                description: '累计消费或积分消耗达到高价值阈值。',
                source: 'purchase',
                auto_rule: '累计消费达到阈值后写入 high_value',
                enabled: true
            },
            {
                key: 'payment_failed',
                name: '支付失败用户',
                description: '近期出现支付失败或订单未完成。',
                source: 'behavior',
                auto_rule: '支付失败事件写入 payment_failed，成功支付后可移除',
                enabled: true
            },
            {
                key: 'verify_failed',
                name: '验证失败用户',
                description: '验证任务失败或多次重试。',
                source: 'behavior',
                auto_rule: '验证失败事件写入 verify_failed',
                enabled: true
            },
            {
                key: 'inactive_user',
                name: '长期未活跃用户',
                description: '超过未活跃阈值后写入，用于回流提醒和唤醒优惠。',
                source: 'behavior',
                auto_rule: '公共页机器人记录最近活跃时间，超过阈值后写入 inactive_user，用户回来后移除',
                enabled: true
            }
        ];
        const tagMap = new Map(fallbackTags
            .filter((item) => !hiddenTagSet.has(normalizeUserTagKey(item.key || item.id, '')))
            .map((item) => [normalizeUserTagKey(item.key || item.id, ''), item]));
        if (Array.isArray(center.tags)) {
            center.tags.forEach((item) => {
                const key = normalizeUserTagKey(item?.key || item?.id, '');
                if (key && !hiddenTagSet.has(key)) {
                    tagMap.set(key, {
                        ...item,
                        id: key,
                        key
                    });
                }
            });
        }
        return {
            sources: Array.isArray(center.sources) && center.sources.length ? center.sources : USER_TAG_SOURCE_OPTIONS.map(([value]) => value),
            tags: Array.from(tagMap.values()),
            hidden_user_tags: Array.from(hiddenTagSet),
            automation: {
                high_value: {
                    enabled: sourceAutomation.high_value?.enabled !== false,
                    min_paid_amount: normalizeNumericInput(sourceAutomation.high_value?.min_paid_amount, defaultAutomation.high_value.min_paid_amount, 0, 1000000),
                    min_points: normalizeNumericInput(sourceAutomation.high_value?.min_points, defaultAutomation.high_value.min_points, 0, 100000000),
                    min_order_count: normalizeNumericInput(sourceAutomation.high_value?.min_order_count, defaultAutomation.high_value.min_order_count, 0, 100000)
                },
                payment_failed: {
                    enabled: sourceAutomation.payment_failed?.enabled !== false,
                    window_days: normalizeNumericInput(sourceAutomation.payment_failed?.window_days, defaultAutomation.payment_failed.window_days, 1, 365),
                    min_count: normalizeNumericInput(sourceAutomation.payment_failed?.min_count, defaultAutomation.payment_failed.min_count, 1, 1000)
                },
                verify_failed: {
                    enabled: sourceAutomation.verify_failed?.enabled !== false,
                    window_days: normalizeNumericInput(sourceAutomation.verify_failed?.window_days, defaultAutomation.verify_failed.window_days, 1, 365),
                    min_count: normalizeNumericInput(sourceAutomation.verify_failed?.min_count, defaultAutomation.verify_failed.min_count, 1, 1000)
                },
                inactive: {
                    enabled: sourceAutomation.inactive?.enabled === true,
                    inactive_days: normalizeNumericInput(sourceAutomation.inactive?.inactive_days, defaultAutomation.inactive.inactive_days, 1, 3650)
                }
            },
            updated_at: center.updated_at || ''
        };
    }

    function getEditableUserTag() {
        const tagRef = normalizeUserTagKey(state.editingUserTagRef, '');
        if (!tagRef) return null;
        return getUserTagCenter().tags.find((tag) => normalizeUserTagKey(tag?.key || tag?.id, '') === tagRef) || null;
    }

    function getRuleDraft() {
        return state.ruleDraft && typeof state.ruleDraft === 'object' && !Array.isArray(state.ruleDraft)
            ? state.ruleDraft
            : null;
    }

    function getTemplateRuleMetadata(ruleSource = {}, templateDraft = null) {
        if (templateDraft) {
            return {
                source_template_id: String(templateDraft.id || '').trim(),
                source_template_key: String(templateDraft.key || '').trim(),
                source_template_name: String(templateDraft.name || templateDraft.title || '').trim(),
                template_category: normalizeToken(templateDraft.category, 'general')
            };
        }
        const metadata = ruleSource?.metadata && typeof ruleSource.metadata === 'object' && !Array.isArray(ruleSource.metadata)
            ? ruleSource.metadata
            : {};
        const templateId = String(metadata.source_template_id || metadata.template_id || metadata.templateId || '').trim();
        const templateKey = normalizeToken(metadata.source_template_key || metadata.template_key || metadata.templateKey || '', '');
        if (!templateId && !templateKey) return null;
        return {
            source_template_id: templateId,
            source_template_key: templateKey,
            source_template_name: String(metadata.source_template_name || metadata.template_name || metadata.templateName || '').trim(),
            template_category: normalizeToken(metadata.template_category || metadata.templateCategory || '', '')
        };
    }

    function getAutomationDraftMetadata(ruleSource = {}) {
        const metadata = ruleSource?.metadata && typeof ruleSource.metadata === 'object' && !Array.isArray(ruleSource.metadata)
            ? ruleSource.metadata
            : {};
        const blueprintId = normalizeToken(
            metadata.automation_blueprint_id || metadata.automationBlueprintId || metadata.blueprint_id || '',
            ''
        );
        if (!blueprintId) return null;
        return {
            source_module: String(metadata.source_module || metadata.sourceModule || 'engagement.automation_blueprint').trim() || 'engagement.automation_blueprint',
            automation_blueprint_id: blueprintId,
            automation_blueprint_title: String(metadata.automation_blueprint_title || metadata.automationBlueprintTitle || metadata.blueprint_title || ruleSource.source_name || '').trim(),
            automation_mode: String(metadata.automation_mode || metadata.automationMode || '').trim()
        };
    }

    function getRuleLinkageMetadata(ruleSource = {}, templateDraft = null) {
        return {
            ...(getTemplateRuleMetadata(ruleSource, templateDraft) || {}),
            ...(getAutomationDraftMetadata(ruleSource) || {})
        };
    }

    function isTemplateInCapability(template = {}, capability = null) {
        if (!capability) return true;
        const category = normalizeToken(template.category, 'general');
        const key = normalizeToken(template.key || template.id || '', '');
        const pageIds = Array.isArray(template.page_ids)
            ? template.page_ids.map((item) => normalizeToken(item, '')).filter(Boolean)
            : [];
        return capability.categories.includes(category)
            || capability.events.some((eventKey) => key.includes(eventKey))
            || (category === 'general' && pageIds.some((pageId) => capability.pageIds.includes(pageId)));
    }

    function getTemplateProductCategoryById(categoryId = '') {
        const normalizedId = normalizeToken(categoryId, '');
        return TEMPLATE_PRODUCT_CATEGORIES.find((category) => category.id === normalizedId) || null;
    }

    function isTemplateInProductCategory(template = {}, productCategory = null) {
        if (!productCategory) return true;
        const category = normalizeToken(template.category, 'general');
        const key = normalizeToken(template.key || template.id || '', '');
        const pageIds = Array.isArray(template.page_ids)
            ? template.page_ids.map((item) => normalizeToken(item, '')).filter(Boolean)
            : [];
        return productCategory.categories.includes(category)
            || productCategory.events.some((eventKey) => key.includes(eventKey))
            || pageIds.some((pageId) => (pageId === 'all' ? productCategory.pageIds.includes('all') : productCategory.pageIds.includes(pageId)));
    }

    function getTemplateProductCategory(template = {}) {
        return TEMPLATE_PRODUCT_CATEGORIES.find((category) => isTemplateInProductCategory(template, category))
            || TEMPLATE_PRODUCT_CATEGORIES[TEMPLATE_PRODUCT_CATEGORIES.length - 1];
    }

    function getTemplatesForFocusedCapability(templates = []) {
        const rows = Array.isArray(templates) ? templates : [];
        const focusedCapability = getFocusedCapability();
        return focusedCapability ? rows.filter((template) => isTemplateInCapability(template, focusedCapability)) : rows;
    }

    function getTemplatesForCurrentTemplateFilters(templates = []) {
        const productCategory = getTemplateProductCategoryById(state.templateCategoryFilter);
        return getTemplatesForFocusedCapability(templates)
            .filter((template) => isTemplateInProductCategory(template, productCategory));
    }

    function getTemplateStarterById(starterId = '') {
        const normalizedId = normalizeToken(starterId, '');
        return TEMPLATE_STARTERS.find((starter) => starter.id === normalizedId || starter.key === normalizedId) || null;
    }

    function isTemplateStarterInstalled(starter = {}, templates = []) {
        const starterKey = normalizeToken(starter.key, '');
        const starterId = normalizeToken(starter.id, '');
        if (!starterKey) return false;
        return (Array.isArray(templates) ? templates : []).some((template) => {
            const metadata = template?.metadata && typeof template.metadata === 'object' && !Array.isArray(template.metadata)
                ? template.metadata
                : {};
            const templateKey = normalizeToken(template?.key || template?.id, '');
            const metadataStarterId = normalizeToken(metadata.starter_id || metadata.starterId, '');
            const metadataStarterKey = normalizeToken(metadata.starter_key || metadata.starterKey, '');
            return templateKey === starterKey
                || (starterId && metadataStarterId === starterId)
                || (starterKey && metadataStarterKey === starterKey);
        });
    }

    function getTemplateLinkedRules(template = {}) {
        const templateId = String(template.id || '').trim();
        const templateKey = normalizeToken(template.key || template.id, '');
        const templateTitle = normalizeToken(template.title || '', '');
        const templateContent = String(template.content || '').trim();
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        return rules.filter((rule) => {
            const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
                ? rule.metadata
                : {};
            const metadataTemplateId = String(metadata.source_template_id || metadata.template_id || metadata.templateId || '').trim();
            const metadataTemplateKey = normalizeToken(metadata.source_template_key || metadata.template_key || metadata.templateKey || '', '');
            if (templateId && metadataTemplateId && metadataTemplateId === templateId) return true;
            if (templateKey && metadataTemplateKey && metadataTemplateKey === templateKey) return true;
            if (!templateTitle || !templateContent) return false;
            return normalizeToken(rule?.title || '', '') === templateTitle
                && String(rule?.content || '').trim() === templateContent;
        });
    }

    function getTemplateUsageMetrics(template = {}) {
        const linkedRules = getTemplateLinkedRules(template);
        const metrics = linkedRules.reduce((counter, rule) => {
            const ruleMetrics = getRuleAnalyticsMetrics(rule.id);
            counter.views += ruleMetrics.views;
            counter.clicks += ruleMetrics.clicks;
            counter.dismisses += ruleMetrics.dismisses;
            counter.conversions += ruleMetrics.conversions;
            return counter;
        }, createRuleMetricsCounter());
        return {
            ...metrics,
            rules: linkedRules.length,
            running_rules: linkedRules.filter((rule) => isRuleRunningNow(rule)).length,
            ctr: getMetricRate(metrics.clicks, metrics.views),
            dismiss_rate: getMetricRate(metrics.dismisses, metrics.views)
        };
    }

    function getTemplateCategoryStats(templates = []) {
        const rows = Array.isArray(templates) ? templates : [];
        return TEMPLATE_PRODUCT_CATEGORIES.map((category) => {
            const categoryTemplates = rows.filter((template) => isTemplateInProductCategory(template, category));
            const metrics = categoryTemplates.reduce((counter, template) => {
                const templateMetrics = getTemplateUsageMetrics(template);
                counter.rules += templateMetrics.rules;
                counter.views += templateMetrics.views;
                counter.clicks += templateMetrics.clicks;
                counter.conversions += templateMetrics.conversions;
                return counter;
            }, {
                rules: 0,
                views: 0,
                clicks: 0,
                conversions: 0
            });
            return {
                ...category,
                templates: categoryTemplates.length,
                metrics
            };
        });
    }

    function getTemplateLibrarySummary(templates = []) {
        const rows = Array.isArray(templates) ? templates : [];
        const categories = new Set(rows.map((template) => normalizeToken(template.category, 'general')).filter(Boolean));
        const withAction = rows.filter((template) => String(template.action_label || '').trim() && String(template.action_url || '').trim()).length;
        const linkedRules = rows.reduce((count, template) => count + getTemplateLinkedRules(template).length, 0);
        return {
            templates: rows.length,
            categories: categories.size,
            with_action: withAction,
            linked_rules: linkedRules
        };
    }

    function getFocusedPageId() {
        return normalizeToken(state.focusedPageId || '', '');
    }

    function isRuleVisibleForPage(rule = {}, pageId = '') {
        const normalizedPageId = normalizeToken(pageId, '');
        if (!normalizedPageId || normalizedPageId === 'all') {
            return true;
        }
        const pageIds = Array.isArray(rule.page_ids)
            ? rule.page_ids.map((item) => normalizeToken(item, '')).filter(Boolean)
            : [];
        return !pageIds.length || pageIds.includes('all') || pageIds.includes(normalizedPageId);
    }

    function getRulesForFocusedPage(rules = []) {
        const rows = Array.isArray(rules) ? rules : [];
        const focusedPageId = getFocusedPageId();
        return focusedPageId ? rows.filter((rule) => isRuleVisibleForPage(rule, focusedPageId)) : rows;
    }

    function getRuleStatusLabel(rule = {}) {
        if (isRuleScheduledForFuture(rule)) return '定时发布';
        if (isRuleRunningNow(rule)) return '运行中';
        const status = normalizeToken(rule.status, 'draft');
        return getOptionLabel(RULE_FILTER_STATUS_OPTIONS, status) || '草稿';
    }

    function getAudienceScope(audience = {}) {
        const source = audience && typeof audience === 'object' && !Array.isArray(audience) ? audience : {};
        return normalizeToken(source.scope || source.segment || source.type || 'all', 'all');
    }

    function getAudienceLabel(audience = {}) {
        return getOptionLabel(getAudienceScopeOptions(), getAudienceScope(audience)) || '全部用户';
    }

    function getRuleAudienceFilterOptions() {
        return getAudienceScopeOptions();
    }

    function isRuleVisibleForStatus(rule = {}, statusFilter = 'all') {
        const normalizedStatus = normalizeToken(statusFilter, 'all');
        if (!normalizedStatus || normalizedStatus === 'all') {
            return true;
        }
        if (normalizedStatus === 'running') {
            return isRuleRunningNow(rule);
        }
        if (normalizedStatus === 'scheduled') {
            return isRuleScheduledForFuture(rule);
        }
        return normalizeToken(rule.status, 'draft') === normalizedStatus;
    }

    function isRuleVisibleForAudience(rule = {}, audienceFilter = 'all') {
        const normalizedAudience = normalizeToken(audienceFilter, 'all');
        if (!normalizedAudience || normalizedAudience === 'all') {
            return true;
        }
        return getAudienceScope(rule.audience) === normalizedAudience;
    }

    function isRuleVisibleForSearch(rule = {}, searchQuery = '') {
        const query = String(searchQuery || '').trim().toLowerCase();
        if (!query) return true;
        const health = getRuleHealth(rule);
        const pageText = Array.isArray(rule.page_ids) ? rule.page_ids.map(getPageLabel).join(' ') : '';
        const haystack = [
            rule.name,
            rule.title,
            rule.content,
            rule.action_label,
            rule.action_url,
            rule.trigger_type,
            getRuleStatusLabel(rule),
            health.label,
            health.detail,
            pageText
        ].join(' ').toLowerCase();
        return haystack.includes(query);
    }

    function isRuleVisibleForHealth(rule = {}, healthFilter = 'all') {
        const normalizedHealth = normalizeToken(healthFilter, 'all');
        if (!normalizedHealth || normalizedHealth === 'all') {
            return true;
        }
        const health = getRuleHealth(rule);
        const code = normalizeToken(health.code, '');
        const tone = normalizeToken(health.tone, '');
        if (normalizedHealth === 'needs_attention') {
            return ['danger', 'warning', 'attention'].includes(tone);
        }
        if (normalizedHealth === 'paused_or_draft') {
            return ['draft', 'paused', 'archived'].includes(code);
        }
        if (normalizedHealth === 'healthy') {
            return ['good', 'ok'].includes(tone);
        }
        return code === normalizedHealth || tone === normalizedHealth;
    }

    function normalizeRuleDuplicateText(value = '') {
        return String(value || '').trim().replace(/\s+/g, ' ');
    }

    function normalizeRuleDuplicateList(value = [], fallback = ['all']) {
        const source = Array.isArray(value) ? value : fallback;
        const normalized = source.map((item) => normalizeToken(item, '')).filter(Boolean);
        return (normalized.length ? [...new Set(normalized)] : fallback).sort();
    }

    function getRuleDuplicateKey(rule = {}) {
        const audienceScope = getAudienceScope(rule.audience);
        const signature = {
            name: normalizeRuleDuplicateText(rule.name),
            site: normalizeToken(rule.site, 'all'),
            status: normalizeToken(rule.status, 'draft'),
            enabled: rule.enabled === true,
            page_ids: normalizeRuleDuplicateList(rule.page_ids),
            audience_scope: audienceScope,
            trigger_type: normalizeToken(rule.trigger_type, 'page_view'),
            placement: normalizeToken(rule.placement, 'robot_bubble'),
            title: normalizeRuleDuplicateText(rule.title),
            content: normalizeRuleDuplicateText(rule.content),
            action_label: normalizeRuleDuplicateText(rule.action_label),
            action_url: normalizeRuleDuplicateText(rule.action_url),
            tone: normalizeToken(rule.tone, 'info'),
            priority: Number(rule.priority || 0) || 0,
            repeat_interval_minutes: getRuleRepeatIntervalMinutes(rule, 2),
            dismiss_ttl_hours: Number(rule.dismiss_ttl_hours || 24) || 24
        };
        return JSON.stringify(signature);
    }

    function getRuleDuplicateGroups(rules = []) {
        const groupMap = new Map();
        (Array.isArray(rules) ? rules : []).forEach((rule) => {
            const ruleId = String(rule?.id || '').trim();
            if (!ruleId) return;
            if (normalizeToken(rule?.status, 'draft') === 'archived') return;
            const key = getRuleDuplicateKey(rule);
            if (!groupMap.has(key)) groupMap.set(key, []);
            groupMap.get(key).push(rule);
        });
        return Array.from(groupMap.values())
            .filter((group) => group.length > 1)
            .sort((first, second) => second.length - first.length);
    }

    function getDuplicateRuleIds(rules = []) {
        return new Set(getRuleDuplicateGroups(rules).flatMap((group) => group.map((rule) => String(rule?.id || '').trim()).filter(Boolean)));
    }

    function getRuleDuplicateGroupColor(index = 0) {
        return RULE_DUPLICATE_GROUP_COLORS[Math.abs(Number(index || 0) || 0) % RULE_DUPLICATE_GROUP_COLORS.length] || RULE_DUPLICATE_GROUP_COLORS[0];
    }

    function getRuleDuplicateGroupMeta(rules = []) {
        const duplicateMeta = new Map();
        getRuleDuplicateGroups(rules).forEach((group, groupIndex) => {
            const color = getRuleDuplicateGroupColor(groupIndex);
            group.forEach((rule, itemIndex) => {
                const ruleId = String(rule?.id || '').trim();
                if (!ruleId) return;
                duplicateMeta.set(ruleId, {
                    groupIndex: groupIndex + 1,
                    itemIndex: itemIndex + 1,
                    groupSize: group.length,
                    color
                });
            });
        });
        return duplicateMeta;
    }

    function groupDuplicateRulesForDisplay(sourceRules = [], visibleRules = []) {
        const visibleRows = Array.isArray(visibleRules) ? visibleRules : [];
        if (state.ruleDuplicateFilter !== true) return visibleRows;
        const visibleById = new Map(visibleRows.map((rule) => [String(rule?.id || '').trim(), rule]));
        const usedIds = new Set();
        const groupedRows = [];
        getRuleDuplicateGroups(sourceRules).forEach((group) => {
            group.forEach((rule) => {
                const ruleId = String(rule?.id || '').trim();
                if (!ruleId || !visibleById.has(ruleId) || usedIds.has(ruleId)) return;
                groupedRows.push(visibleById.get(ruleId));
                usedIds.add(ruleId);
            });
        });
        visibleRows.forEach((rule) => {
            const ruleId = String(rule?.id || '').trim();
            if (ruleId && !usedIds.has(ruleId)) {
                groupedRows.push(rule);
            }
        });
        return groupedRows;
    }

    function reconcileDuplicateRuleFilter(rules = []) {
        const duplicateGroups = getRuleDuplicateGroups(rules);
        if (state.ruleDuplicateFilter === true && duplicateGroups.length <= 0) {
            state.ruleDuplicateFilter = false;
        }
        return duplicateGroups;
    }

    function resetRulePagination() {
        state.rulePage = 1;
    }

    function getRuleListPagination(totalRows = 0) {
        const total = Math.max(0, Number(totalRows || 0) || 0);
        const totalPages = Math.max(1, Math.ceil(total / RULE_LIST_PAGE_SIZE));
        const requestedPage = Math.max(1, Number.parseInt(state.rulePage || '1', 10) || 1);
        const page = Math.min(requestedPage, totalPages);
        if (state.rulePage !== page) {
            state.rulePage = page;
        }
        const startIndex = total > 0 ? (page - 1) * RULE_LIST_PAGE_SIZE : 0;
        const endIndex = total > 0 ? Math.min(total, startIndex + RULE_LIST_PAGE_SIZE) : 0;
        return {
            page,
            totalPages,
            startIndex,
            endIndex,
            hasPrevious: page > 1,
            hasNext: page < totalPages
        };
    }

    function renderRulePaginationControls(pagination = {}) {
        const page = Math.max(1, Number(pagination.page || 1) || 1);
        const totalPages = Math.max(1, Number(pagination.totalPages || 1) || 1);
        if (totalPages <= 1) return '';
        return `
            <div class="engagement-rule-pagination" aria-label="规则分页">
                <button type="button" data-engagement-action="rule-page-prev" ${pagination.hasPrevious ? '' : 'disabled'} aria-label="上一页">
                    <i class="fas fa-chevron-left" aria-hidden="true"></i>
                </button>
                <span>${escapeHtml(formatNumber(page))} / ${escapeHtml(formatNumber(totalPages))} 页</span>
                <button type="button" data-engagement-action="rule-page-next" ${pagination.hasNext ? '' : 'disabled'} aria-label="下一页">
                    <i class="fas fa-chevron-right" aria-hidden="true"></i>
                </button>
            </div>
        `;
    }

    function setRulePage(nextPage = 1) {
        state.rulePage = Math.max(1, Number.parseInt(nextPage || '1', 10) || 1);
        renderOverview(state.payload || {});
        document.querySelector('[data-engagement-rule-toolbar]')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        return true;
    }

    function sortRulesForManagement(rules = []) {
        const rows = Array.isArray(rules) ? rules.slice() : [];
        const sortMode = normalizeToken(state.ruleSort, 'updated_desc');
        return rows.sort((first, second) => {
            if (sortMode === 'priority_desc') {
                return (Number(second?.priority || 0) - Number(first?.priority || 0))
                    || String(second?.updated_at || '').localeCompare(String(first?.updated_at || ''));
            }
            if (sortMode === 'priority_asc') {
                return (Number(first?.priority || 0) - Number(second?.priority || 0))
                    || String(second?.updated_at || '').localeCompare(String(first?.updated_at || ''));
            }
            if (sortMode === 'name_asc') {
                return String(first?.name || '').localeCompare(String(second?.name || ''), 'zh-CN');
            }
            return String(second?.updated_at || '').localeCompare(String(first?.updated_at || ''));
        });
    }

    function getManagedRules(rules = []) {
        const rows = getRulesForFocusedPage(rules);
        const pageFilter = normalizeToken(state.rulePageFilter, 'all');
        const duplicateRuleIds = state.ruleDuplicateFilter ? getDuplicateRuleIds(rows) : null;
        return sortRulesForManagement(rows.filter((rule) => (
            isRuleVisibleForPage(rule, pageFilter)
            && isRuleVisibleForStatus(rule, state.ruleStatusFilter)
            && isRuleVisibleForHealth(rule, state.ruleHealthFilter)
            && isRuleVisibleForAudience(rule, state.ruleAudienceFilter)
            && isRuleVisibleForSearch(rule, state.ruleSearchQuery)
            && (!duplicateRuleIds || duplicateRuleIds.has(String(rule?.id || '').trim()))
        )));
    }

    function getCurrentManagedRules() {
        return getManagedRules(Array.isArray(state.payload?.rules) ? state.payload.rules : []);
    }

    function getRuleBatchSummary(rows = getCurrentManagedRules()) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        const activeRows = sourceRows.filter((rule) => String(rule?.id || '').trim());
        const runningRows = activeRows.filter((rule) => isRuleRunningNow(rule));
        const attentionRows = activeRows.filter((rule) => {
            const health = getRuleHealth(rule);
            return ['danger', 'warning', 'attention'].includes(normalizeToken(health.tone, ''));
        });
        const copyableRows = activeRows.filter((rule) => normalizeToken(rule.status, 'draft') !== 'archived');
        return {
            total: activeRows.length,
            running: runningRows.length,
            attention: attentionRows.length,
            copyable: copyableRows.length,
            runningRows,
            attentionRows,
            copyableRows
        };
    }

    function getOptionLabel(options = [], value = '') {
        const normalizedValue = String(value || '').trim();
        const option = options.find(([optionValue]) => String(optionValue) === normalizedValue);
        return option?.[1] || normalizedValue || '请选择';
    }

    function renderCustomSelect({ name, value, options = [], label = '' } = {}) {
        const normalizedName = String(name || '').trim();
        const normalizedValue = String(value || '').trim();
        const labelId = `engagementSelectLabel_${normalizedName}`;
        const menuId = `engagementSelectMenu_${normalizedName}`;
        const selectedLabel = getOptionLabel(options, normalizedValue);

        return `
            <div class="engagement-select" data-engagement-select="${escapeHtml(normalizedName)}">
                <input type="hidden" name="${escapeHtml(normalizedName)}" value="${escapeHtml(normalizedValue)}" data-engagement-select-input>
                <button type="button"
                    class="engagement-select__trigger"
                    data-engagement-select-trigger
                    aria-haspopup="listbox"
                    aria-expanded="false"
                    aria-labelledby="${escapeHtml(labelId)}"
                    aria-controls="${escapeHtml(menuId)}">
                    <span id="${escapeHtml(labelId)}" class="engagement-select__value">${escapeHtml(selectedLabel || label || '请选择')}</span>
                    <span class="engagement-select__chevron" aria-hidden="true"></span>
                </button>
                <div id="${escapeHtml(menuId)}" class="engagement-select__menu" role="listbox" aria-hidden="true">
                    ${options.map(([optionValue, optionLabel]) => {
                        const isSelected = String(optionValue) === normalizedValue;
                        return `
                            <button type="button"
                                class="engagement-select__option ${isSelected ? 'is-selected' : ''}"
                                data-engagement-select-option
                                data-value="${escapeHtml(optionValue)}"
                                role="option"
                                aria-selected="${isSelected ? 'true' : 'false'}">
                                <span>${escapeHtml(optionLabel)}</span>
                                <i class="fas fa-check engagement-select__check" aria-hidden="true"></i>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderPagePicker(selectedPages = new Set(['all'])) {
        const selected = selectedPages instanceof Set && selectedPages.size ? selectedPages : new Set(['all']);
        const hiddenInputs = Array.from(selected).map((pageId) => `
            <input type="hidden" name="page_ids" value="${escapeHtml(pageId)}" data-engagement-page-value>
        `).join('');

        return `
            <div class="engagement-page-picker" data-engagement-page-picker>
                <div class="engagement-page-picker__values" data-engagement-page-values>${hiddenInputs}</div>
                ${RULE_PAGE_OPTIONS.map((pageId) => {
                    const isSelected = selected.has(pageId);
                    return `
                        <button type="button"
                            class="engagement-page-choice ${isSelected ? 'is-selected' : ''}"
                            data-engagement-page-toggle
                            data-value="${escapeHtml(pageId)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <span>${escapeHtml(getPageLabel(pageId))}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderSupportActionPicker(selectedActions = []) {
        const selected = new Set((Array.isArray(selectedActions) && selectedActions.length ? selectedActions : ['create_ticket', 'live_chat'])
            .map((actionId) => normalizeToken(actionId, ''))
            .filter(Boolean));
        const hiddenInputs = Array.from(selected).map((actionId) => `
            <input type="hidden" name="shortcuts" value="${escapeHtml(actionId)}" data-engagement-support-action-value>
        `).join('');

        return `
            <div class="engagement-support-action-picker" data-engagement-support-action-picker>
                <div class="engagement-support-action-picker__values" data-engagement-support-action-values>${hiddenInputs}</div>
                ${SUPPORT_ACTION_OPTIONS.map(([actionId, actionLabel]) => {
                    const isSelected = selected.has(actionId);
                    return `
                        <button type="button"
                            class="engagement-page-choice ${isSelected ? 'is-selected' : ''}"
                            data-engagement-support-action-toggle
                            data-value="${escapeHtml(actionId)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <span>${escapeHtml(actionLabel)}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderSceneEventPicker(selectedEvents = []) {
        const selected = new Set((Array.isArray(selectedEvents) && selectedEvents.length ? selectedEvents : ['new_user_welcome'])
            .map((eventKey) => normalizeToken(eventKey, ''))
            .filter(Boolean));
        const knownOptions = PAGE_SCENE_EVENT_OPTIONS.map((eventKey) => [eventKey, getEventLabel(eventKey)]);
        selected.forEach((eventKey) => {
            if (!knownOptions.some(([optionValue]) => optionValue === eventKey)) {
                knownOptions.push([eventKey, getEventLabel(eventKey)]);
            }
        });
        const hiddenInputs = Array.from(selected).map((eventKey) => `
            <input type="hidden" name="events" value="${escapeHtml(eventKey)}" data-engagement-scene-event-value>
        `).join('');

        return `
            <div class="engagement-scene-event-picker" data-engagement-scene-event-picker>
                <div class="engagement-scene-event-picker__values" data-engagement-scene-event-values>${hiddenInputs}</div>
                ${knownOptions.map(([eventKey, eventLabel]) => {
                    const isSelected = selected.has(eventKey);
                    const priorityClass = getEventPriorityClass(eventKey);
                    return `
                        <button type="button"
                            class="engagement-page-choice ${isSelected ? 'is-selected' : ''}"
                            data-engagement-scene-event-toggle
                            data-value="${escapeHtml(eventKey)}"
                            title="${escapeHtml(`${eventLabel} · ${priorityClass.label}`)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <span>${escapeHtml(eventLabel)}</span>
                            ${renderEventPriorityBadge(eventKey)}
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderEventPriorityPicker(groupId = '', selectedEvents = [], scopeId = 'global') {
        const selected = new Set((Array.isArray(selectedEvents) ? selectedEvents : [])
            .map((eventKey) => normalizeToken(eventKey, ''))
            .filter(Boolean));
        const hiddenInputs = Array.from(selected).map((eventKey) => `
            <input type="hidden" name="${escapeHtml(groupId)}_events" value="${escapeHtml(eventKey)}" data-engagement-event-priority-value>
        `).join('');
        return `
            <div class="engagement-scene-event-picker" data-engagement-event-priority-picker data-priority-group="${escapeHtml(groupId)}" data-priority-scope="${escapeHtml(scopeId)}">
                <div class="engagement-scene-event-picker__values" data-engagement-event-priority-values>${hiddenInputs}</div>
                ${PAGE_SCENE_EVENT_OPTIONS.map((eventKey) => {
                    const isSelected = selected.has(eventKey);
                    const priorityClass = getEventPriorityClass(eventKey);
                    return `
                        <button type="button"
                            class="engagement-page-choice ${isSelected ? 'is-selected' : ''}"
                            data-engagement-event-priority-toggle
                            data-priority-group="${escapeHtml(groupId)}"
                            data-priority-scope="${escapeHtml(scopeId)}"
                            data-value="${escapeHtml(eventKey)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <span>${escapeHtml(getEventLabel(eventKey))}</span>
                            ${renderEventPriorityBadgeById(groupId)}
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderSegmentTagPicker(selectedTags = []) {
        const selected = new Set((Array.isArray(selectedTags) ? selectedTags : [])
            .map((tagKey) => normalizeUserTagKey(tagKey, ''))
            .filter(Boolean));
        const optionMap = new Map();
        getUserTagCenter().tags.forEach((tag) => {
            const tagKey = normalizeUserTagKey(tag?.key || tag?.id, '');
            if (tagKey && !optionMap.has(tagKey)) {
                optionMap.set(tagKey, tag?.name || tag?.key || tag?.id || '用户标签');
            }
        });
        const knownOptions = Array.from(optionMap.entries());
        selected.forEach((tagKey) => {
            if (!knownOptions.some(([optionValue]) => optionValue === tagKey)) {
                knownOptions.push([tagKey, getUserTagLabel(tagKey)]);
            }
        });
        const hiddenInputs = Array.from(selected).map((tagKey) => `
            <input type="hidden" name="tag_targets" value="${escapeHtml(tagKey)}" data-engagement-segment-tag-value>
        `).join('');

        return `
            <div class="engagement-segment-tag-picker" data-engagement-segment-tag-picker>
                <div class="engagement-segment-tag-picker__values" data-engagement-segment-tag-values>${hiddenInputs}</div>
                ${knownOptions.map(([tagKey, tagLabel]) => {
                    const isSelected = selected.has(tagKey);
                    return `
                        <button type="button"
                            class="engagement-page-choice ${isSelected ? 'is-selected' : ''}"
                            data-engagement-segment-tag-toggle
                            data-value="${escapeHtml(tagKey)}"
                            title="${escapeHtml(tagKey)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <span>${escapeHtml(tagLabel)}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderSegmentScenarioPicker(selectedScenarios = []) {
        const selected = new Set((Array.isArray(selectedScenarios) ? selectedScenarios : [])
            .map((scenarioId) => normalizeSegmentScenarioValue(scenarioId))
            .filter(Boolean));
        const knownOptions = SEGMENT_SCENARIO_OPTIONS.map((option) => [option.id, option.label]);
        selected.forEach((scenarioId) => {
            if (!knownOptions.some(([optionValue]) => optionValue === scenarioId)) {
                knownOptions.push([scenarioId, getSegmentScenarioLabel(scenarioId)]);
            }
        });
        const hiddenInputs = Array.from(selected).map((scenarioId) => `
            <input type="hidden" name="examples" value="${escapeHtml(scenarioId)}" data-engagement-segment-scenario-value>
        `).join('');

        return `
            <div class="engagement-segment-scenario-picker" data-engagement-segment-scenario-picker>
                <div class="engagement-segment-scenario-picker__values" data-engagement-segment-scenario-values>${hiddenInputs}</div>
                ${knownOptions.map(([scenarioId, scenarioLabel]) => {
                    const isSelected = selected.has(scenarioId);
                    return `
                        <button type="button"
                            class="engagement-page-choice ${isSelected ? 'is-selected' : ''}"
                            data-engagement-segment-scenario-toggle
                            data-value="${escapeHtml(scenarioId)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <span>${escapeHtml(scenarioLabel)}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderCustomSwitch({ name, checked = false, label = '' } = {}) {
        const normalizedName = String(name || '').trim();
        return `
            <div class="engagement-switch-field">
                <input type="hidden" name="${escapeHtml(normalizedName)}" value="${checked ? 'true' : 'false'}" data-engagement-switch-input>
                <button type="button"
                    class="engagement-switch ${checked ? 'is-on' : ''}"
                    data-engagement-switch
                    aria-pressed="${checked ? 'true' : 'false'}">
                    <span class="engagement-switch__track" aria-hidden="true">
                        <span class="engagement-switch__thumb"></span>
                    </span>
                    <span class="engagement-switch__label">${escapeHtml(label)}</span>
                </button>
            </div>
        `;
    }

    function getTemplatePreferredTriggerType(source = {}) {
        const metadata = source?.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
            ? source.metadata
            : {};
        return normalizeToken(
            source.trigger_type
                || source.triggerType
                || metadata.starter_trigger_type
                || metadata.preferred_trigger_type
                || metadata.trigger_type
                || metadata.triggerType
                || 'page_view',
            'page_view'
        );
    }

    function getInitialRulePreviewData() {
        const rule = getEditableRule();
        const ruleDraft = rule ? null : getRuleDraft();
        const templateDraft = rule || ruleDraft ? null : getTemplateDraft();
        const source = rule || ruleDraft || templateDraft || {};
        const focusedPageId = getFocusedPageId();
        const pageIds = Array.isArray(source.page_ids)
            ? source.page_ids.map((pageId) => normalizeToken(pageId, '')).filter(Boolean)
            : (focusedPageId ? [focusedPageId] : ['all']);
        return {
            name: source.name || '',
            site: source.site || getCurrentSite(),
            status: source.status || 'draft',
            page_ids: pageIds.length ? pageIds : ['all'],
            audience: source.audience || { scope: 'all' },
            trigger_type: getTemplatePreferredTriggerType(source),
            placement: source.placement || 'robot_bubble',
            title: source.title || source.name || '',
            content: source.content || '',
            tone: source.tone || 'info',
            action_label: source.action_label || '',
            action_url: source.action_url || '',
            starts_at: source.starts_at || source.startsAt || '',
            enabled: Boolean(source.enabled)
        };
    }

    function getInitialTemplatePreviewData() {
        const template = getEditableTemplate() || {};
        const pageIds = Array.isArray(template.page_ids)
            ? template.page_ids.map((pageId) => normalizeToken(pageId, '')).filter(Boolean)
            : ['all'];
        return {
            name: template.name || '',
            site: getCurrentSite(),
            status: 'draft',
            page_ids: pageIds.length ? pageIds : ['all'],
            audience: { scope: 'all' },
            trigger_type: getTemplatePreferredTriggerType(template),
            placement: 'robot_bubble',
            title: template.title || template.name || '',
            content: template.content || '',
            tone: template.tone || 'info',
            action_label: template.action_label || '',
            action_url: template.action_url || '',
            enabled: false
        };
    }

    function getScenePreviewEventOptions(events = []) {
        const normalizedEvents = Array.isArray(events)
            ? events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean)
            : [];
        return normalizedEvents.map((eventKey) => [eventKey, getEventLabel(eventKey)]);
    }

    function normalizeScenePreviewEvent(events = [], value = '') {
        const options = getScenePreviewEventOptions(events);
        const normalizedValue = normalizeToken(value, '');
        if (options.some(([eventKey]) => eventKey === normalizedValue)) {
            return normalizedValue;
        }
        return options[0]?.[0] || 'new_user_welcome';
    }

    function getScenePreviewBlueprint(triggerType = '', pageId = '') {
        const normalizedTriggerType = normalizeToken(triggerType, '');
        const normalizedPageId = normalizeToken(pageId, 'home');
        return AUTOMATION_BLUEPRINTS.find((blueprint) => (
            normalizeToken(blueprint.triggerType, '') === normalizedTriggerType
            && Array.isArray(blueprint.pageIds)
            && blueprint.pageIds.some((candidate) => {
                const normalizedCandidate = normalizeToken(candidate, '');
                return normalizedCandidate === normalizedPageId || normalizedCandidate === 'all';
            })
        )) || AUTOMATION_BLUEPRINTS.find((blueprint) => normalizeToken(blueprint.triggerType, '') === normalizedTriggerType) || null;
    }

    function getScenePreviewFallbackCopy(scene = {}, triggerType = '') {
        const pageLabel = getPageLabel(scene.page_id || scene.id || 'home');
        const eventLabel = getEventLabel(triggerType);
        const allowsMarketing = scene.allow_marketing !== false;
        return {
            title: `${pageLabel} · ${eventLabel}`,
            content: allowsMarketing
                ? `当用户在${pageLabel}触发“${eventLabel}”时，机器人会在这里给出服务或运营提醒。`
                : `当用户在${pageLabel}触发“${eventLabel}”时，机器人会在这里给出服务型提醒，营销转化提示会被收敛。`,
            actionLabel: '',
            actionUrl: ''
        };
    }

    function collectScenePreviewFormData() {
        const form = document.getElementById('engagementSceneForm');
        const scene = form instanceof HTMLFormElement
            ? collectSceneFormPayload(form).scene
            : getEditableScene();
        const pageId = normalizeToken(scene.page_id || scene.id || 'home', 'home');
        const events = Array.isArray(scene.events) ? scene.events : [];
        const triggerType = normalizeScenePreviewEvent(events, state.scenePreviewEvent || '');
        const blueprint = getScenePreviewBlueprint(triggerType, pageId);
        const fallback = getScenePreviewFallbackCopy(scene, triggerType);
        return {
            site: getCurrentSite(),
            status: 'published',
            page_ids: [pageId],
            audience: { scope: 'all' },
            trigger_type: triggerType,
            placement: scene.default_placement || 'robot_bubble',
            title: blueprint?.titleText || fallback.title,
            content: blueprint?.content || fallback.content,
            tone: scene.tone || blueprint?.tone || 'info',
            action_label: blueprint?.actionLabel || fallback.actionLabel,
            action_url: blueprint?.actionUrl || fallback.actionUrl,
            enabled: true,
            scene
        };
    }

    function renderRuleGovernanceNotice(governance = {}) {
        const riskLevel = normalizeToken(governance.risk_level, 'low');
        const reasons = Array.isArray(governance.reasons) ? governance.reasons.filter(Boolean) : [];
        if (riskLevel === 'low' && !reasons.length) {
            return '';
        }
        return `
            <div class="engagement-governance-notice" data-risk="${escapeHtml(riskLevel)}">
                <div>
                    <strong>${escapeHtml(getRiskLabel(riskLevel))}</strong>
                    <p>${escapeHtml(reasons.length ? reasons.join('、') : '当前规则触达范围较克制')}</p>
                </div>
                ${governance.requires_review ? '<span>发布前建议复核</span>' : '<span>已记录治理信息</span>'}
            </div>
        `;
    }

    function resolvePreviewPageId(pageIds = []) {
        const explicitPageId = normalizeToken(state.previewPageId, 'auto');
        if (explicitPageId && explicitPageId !== 'auto' && explicitPageId !== 'all') {
            return explicitPageId;
        }
        const normalizedPages = Array.isArray(pageIds)
            ? pageIds.map((pageId) => normalizeToken(pageId, '')).filter(Boolean)
            : [];
        const focusedPageId = getFocusedPageId();
        return focusedPageId
            || normalizedPages.find((pageId) => pageId && pageId !== 'all')
            || 'home';
    }

    function renderPreviewModeButton(key, value, label, icon) {
        const selectedValue = key === 'device' ? state.previewDevice : state.previewTheme;
        const isSelected = selectedValue === value;
        return `
            <button type="button"
                class="engagement-preview-mode ${isSelected ? 'is-selected' : ''}"
                data-engagement-action="set-preview-option"
                data-preview-key="${escapeHtml(key)}"
                data-preview-value="${escapeHtml(value)}"
                aria-pressed="${isSelected ? 'true' : 'false'}">
                <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
                <span>${escapeHtml(label)}</span>
            </button>
        `;
    }

    function renderRulePreviewPanel() {
        const initial = getInitialRulePreviewData();
        const pageId = resolvePreviewPageId(initial.page_ids);
        const previewCopy = buildRulePreviewCopy(initial);
        const title = previewCopy.title;
        const content = previewCopy.content;
        const actionLabel = initial.action_label || (initial.action_url ? '查看详情' : '');
        const tone = normalizeToken(initial.tone, 'info');
        const audienceLabel = getAudienceLabel(initial.audience);
        const triggerTypeLabel = getTriggerTypeLabel(initial.trigger_type);
        const placementLabel = getPlacementLabel(initial.placement);
        const statusLabel = getRuleStatusLabel(initial);
        const previewSampleLabel = previewCopy.sampleLabel || '';

        return `
            <section class="engagement-section engagement-rule-preview-panel"
                data-engagement-rule-preview-shell
                data-preview-device="${escapeHtml(state.previewDevice)}"
                data-preview-theme="${escapeHtml(state.previewTheme)}">
                <div class="engagement-section__head">
                    <div>
                        <h3>气泡实时预览</h3>
                        <p>模拟公共页右下角客服机器人吐出的气泡，随规则编辑即时更新。</p>
                    </div>
                </div>
                <div class="engagement-preview-controls" aria-label="气泡预览控制">
                    <div class="engagement-preview-control-group" aria-label="设备">
                        ${renderPreviewModeButton('device', 'desktop', '桌面', 'fa-display')}
                        ${renderPreviewModeButton('device', 'mobile', '移动', 'fa-mobile-screen')}
                    </div>
                    <div class="engagement-preview-control-group" aria-label="主题">
                        ${renderPreviewModeButton('theme', 'light', '浅色', 'fa-sun')}
                        ${renderPreviewModeButton('theme', 'dark', '深色', 'fa-moon')}
                    </div>
                    <label class="engagement-preview-page-field">
                        <span>页面环境</span>
                        ${renderCustomSelect({
                            name: 'preview_page_id',
                            value: state.previewPageId || 'auto',
                            options: PREVIEW_PAGE_OPTIONS,
                            label: '页面环境'
                        })}
                    </label>
                    <label class="engagement-preview-page-field" data-engagement-preview-sample-field ${previewSampleLabel ? '' : 'hidden'}>
                        <span>事件样本</span>
                        ${renderRulePreviewSampleSelect(initial.trigger_type)}
                    </label>
                </div>
                <div class="engagement-preview-stage" data-engagement-preview-stage>
                    <div class="engagement-preview-page">
                        <div class="engagement-preview-page__top">
                            <span data-engagement-preview-page-label>${escapeHtml(getPageLabel(pageId))}</span>
                            <span data-engagement-preview-site>${escapeHtml(getOptionLabel([['all', '全站'], ['cn', 'CN'], ['intl', 'INTL']], initial.site || 'all'))}</span>
                        </div>
                        <div class="engagement-preview-page__lines" aria-hidden="true">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        <div class="engagement-preview-robot">
                            <i class="fas fa-robot" aria-hidden="true"></i>
                        </div>
                        <article class="engagement-preview-bubble" data-engagement-preview-bubble data-tone="${escapeHtml(tone)}" data-placement="${escapeHtml(initial.placement || 'robot_bubble')}">
                            <button type="button" class="engagement-preview-bubble__close" aria-label="关闭预览气泡">×</button>
                            <strong data-engagement-preview-title>${escapeHtml(title)}</strong>
                            <p data-engagement-preview-content>${escapeHtml(content)}</p>
                            <a href="${escapeHtml(initial.action_url || '#')}" data-engagement-preview-action ${actionLabel ? '' : 'hidden'}>${escapeHtml(actionLabel)}</a>
                        </article>
                    </div>
                </div>
                <div class="engagement-preview-meta">
                    <span data-engagement-preview-device-label>${state.previewDevice === 'mobile' ? '移动端' : '桌面端'}</span>
                    <span data-engagement-preview-theme-label>${state.previewTheme === 'dark' ? '深色' : '浅色'}</span>
                    <span data-engagement-preview-audience>${escapeHtml(audienceLabel)}</span>
                    <span data-engagement-preview-trigger>${escapeHtml(triggerTypeLabel)}</span>
                    <span data-engagement-preview-placement>${escapeHtml(placementLabel)}</span>
                    <span data-engagement-preview-sample-label ${previewSampleLabel ? '' : 'hidden'}>${escapeHtml(previewSampleLabel)}</span>
                    <span data-engagement-preview-status>${escapeHtml(statusLabel)}</span>
                </div>
            </section>
        `;
    }

    function renderTemplatePreviewPanel() {
        const initial = getInitialTemplatePreviewData();
        const pageId = resolvePreviewPageId(initial.page_ids);
        const previewCopy = buildRulePreviewCopy(initial);
        const title = previewCopy.title;
        const content = previewCopy.content;
        const actionLabel = initial.action_label || (initial.action_url ? '查看详情' : '');
        const triggerTypeLabel = getTriggerTypeLabel(initial.trigger_type);
        const toneLabel = getOptionLabel(RULE_TONE_OPTIONS, initial.tone || 'info');
        const previewSampleLabel = previewCopy.sampleLabel || '';

        return `
            <section class="engagement-section engagement-rule-preview-panel engagement-template-preview-panel"
                data-engagement-template-preview-shell
                data-preview-device="${escapeHtml(state.previewDevice)}"
                data-preview-theme="${escapeHtml(state.previewTheme)}">
                <div class="engagement-section__head">
                    <div>
                        <h3>模板实时预览</h3>
                        <p>预览模板在客服机器人里的实际样子；动态事件会按样本模拟上下文差异。</p>
                    </div>
                </div>
                <div class="engagement-preview-controls" aria-label="模板预览控制">
                    <div class="engagement-preview-control-group" aria-label="设备">
                        ${renderPreviewModeButton('device', 'desktop', '桌面', 'fa-display')}
                        ${renderPreviewModeButton('device', 'mobile', '移动', 'fa-mobile-screen')}
                    </div>
                    <div class="engagement-preview-control-group" aria-label="主题">
                        ${renderPreviewModeButton('theme', 'light', '浅色', 'fa-sun')}
                        ${renderPreviewModeButton('theme', 'dark', '深色', 'fa-moon')}
                    </div>
                    <label class="engagement-preview-page-field">
                        <span>页面环境</span>
                        ${renderCustomSelect({
                            name: 'preview_page_id',
                            value: state.previewPageId || 'auto',
                            options: PREVIEW_PAGE_OPTIONS,
                            label: '页面环境'
                        })}
                    </label>
                    <label class="engagement-preview-page-field" data-engagement-template-preview-sample-field ${previewSampleLabel ? '' : 'hidden'}>
                        <span>事件样本</span>
                        ${renderRulePreviewSampleSelect(initial.trigger_type)}
                    </label>
                </div>
                <div class="engagement-preview-stage" data-engagement-preview-stage>
                    <div class="engagement-preview-page">
                        <div class="engagement-preview-page__top">
                            <span data-engagement-template-preview-page-label>${escapeHtml(getPageLabel(pageId))}</span>
                            <span data-engagement-template-preview-trigger>${escapeHtml(triggerTypeLabel)}</span>
                        </div>
                        <div class="engagement-preview-page__lines" aria-hidden="true">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        <div class="engagement-preview-robot">
                            <i class="fas fa-robot" aria-hidden="true"></i>
                        </div>
                        <article class="engagement-preview-bubble" data-engagement-template-preview-bubble data-tone="${escapeHtml(normalizeToken(initial.tone, 'info'))}" data-placement="robot_bubble">
                            <button type="button" class="engagement-preview-bubble__close" aria-label="关闭预览气泡">×</button>
                            <strong data-engagement-template-preview-title>${escapeHtml(title)}</strong>
                            <p data-engagement-template-preview-content>${escapeHtml(content)}</p>
                            <a href="${escapeHtml(initial.action_url || '#')}" data-engagement-template-preview-action ${actionLabel ? '' : 'hidden'}>${escapeHtml(actionLabel)}</a>
                        </article>
                    </div>
                </div>
                <div class="engagement-preview-meta">
                    <span data-engagement-template-preview-device-label>${state.previewDevice === 'mobile' ? '移动端' : '桌面端'}</span>
                    <span data-engagement-template-preview-theme-label>${state.previewTheme === 'dark' ? '深色' : '浅色'}</span>
                    <span data-engagement-template-preview-tone>${escapeHtml(toneLabel)}</span>
                    <span data-engagement-template-preview-page>${escapeHtml(getPageLabel(pageId))}</span>
                    <span data-engagement-template-preview-sample-label ${previewSampleLabel ? '' : 'hidden'}>${escapeHtml(previewSampleLabel)}</span>
                </div>
            </section>
        `;
    }

    function renderScenePreviewPanel() {
        const initial = collectScenePreviewFormData();
        const pageId = normalizeToken((initial.page_ids || [])[0] || 'home', 'home');
        const previewCopy = buildRulePreviewCopy(initial);
        const priorityClass = getEventPriorityClass(initial.trigger_type);
        const title = previewCopy.title;
        const content = previewCopy.content;
        const actionLabel = initial.action_label || (initial.action_url ? '查看详情' : '');
        const safeZoneLabel = getSafeZoneLabel(initial.scene?.safe_zone || 'bottom-right');
        const placementLabel = getPlacementLabel(initial.placement);
        const triggerTypeLabel = getTriggerTypeLabel(initial.trigger_type);
        const toneLabel = getOptionLabel(RULE_TONE_OPTIONS, initial.tone || 'info');
        const sampleLabel = previewCopy.sampleLabel || '';
        const eventOptions = getScenePreviewEventOptions(initial.scene?.events || []).length
            ? getScenePreviewEventOptions(initial.scene?.events || [])
            : [[initial.trigger_type, getEventLabel(initial.trigger_type)]];

        return `
            <section class="engagement-section engagement-rule-preview-panel engagement-scene-preview-panel"
                data-engagement-scene-preview-shell
                data-preview-device="${escapeHtml(state.previewDevice)}"
                data-preview-theme="${escapeHtml(state.previewTheme)}">
                <div class="engagement-section__head">
                    <div>
                        <h3>页面场景预演</h3>
                        <p>直接看当前页面允许触发的默认提醒长什么样，避免运营只是在列表里勾选事件。</p>
                    </div>
                </div>
                <div class="engagement-preview-controls" aria-label="页面场景预演控制">
                    <div class="engagement-preview-control-group" aria-label="设备">
                        ${renderPreviewModeButton('device', 'desktop', '桌面', 'fa-display')}
                        ${renderPreviewModeButton('device', 'mobile', '移动', 'fa-mobile-screen')}
                    </div>
                    <div class="engagement-preview-control-group" aria-label="主题">
                        ${renderPreviewModeButton('theme', 'light', '浅色', 'fa-sun')}
                        ${renderPreviewModeButton('theme', 'dark', '深色', 'fa-moon')}
                    </div>
                    <label class="engagement-preview-page-field">
                        <span>场景事件</span>
                        ${renderCustomSelect({
                            name: 'scene_preview_event',
                            value: normalizeScenePreviewEvent(initial.scene?.events || [], state.scenePreviewEvent || ''),
                            options: eventOptions,
                            label: '场景事件'
                        })}
                    </label>
                    <label class="engagement-preview-page-field" data-engagement-scene-preview-sample-field ${sampleLabel ? '' : 'hidden'}>
                        <span>事件样本</span>
                        ${renderRulePreviewSampleSelect(initial.trigger_type, 'scene_preview_sample')}
                    </label>
                </div>
                <div class="engagement-preview-stage" data-engagement-preview-stage>
                    <div class="engagement-preview-page">
                        <div class="engagement-preview-page__top">
                            <span data-engagement-scene-preview-page-label>${escapeHtml(getPageLabel(pageId))}</span>
                            <span data-engagement-scene-preview-safe-zone>${escapeHtml(safeZoneLabel)}</span>
                        </div>
                        <div class="engagement-preview-page__lines" aria-hidden="true">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        <div class="engagement-preview-robot">
                            <i class="fas fa-robot" aria-hidden="true"></i>
                        </div>
                        <article class="engagement-preview-bubble" data-engagement-scene-preview-bubble data-tone="${escapeHtml(normalizeToken(initial.tone, 'info'))}" data-placement="${escapeHtml(initial.placement || 'robot_bubble')}">
                            <button type="button" class="engagement-preview-bubble__close" aria-label="关闭预演气泡">×</button>
                            <strong data-engagement-scene-preview-title>${escapeHtml(title)}</strong>
                            <p data-engagement-scene-preview-content>${escapeHtml(content)}</p>
                            <a href="${escapeHtml(initial.action_url || '#')}" data-engagement-scene-preview-action ${actionLabel ? '' : 'hidden'}>${escapeHtml(actionLabel)}</a>
                        </article>
                    </div>
                </div>
                <div class="engagement-preview-meta">
                    <span data-engagement-scene-preview-device-label>${state.previewDevice === 'mobile' ? '移动端' : '桌面端'}</span>
                    <span data-engagement-scene-preview-theme-label>${state.previewTheme === 'dark' ? '深色' : '浅色'}</span>
                    <span data-engagement-scene-preview-trigger>${escapeHtml(triggerTypeLabel)}</span>
                    <span data-engagement-scene-preview-tier>${escapeHtml(priorityClass.label)}</span>
                    <span data-engagement-scene-preview-placement>${escapeHtml(placementLabel)}</span>
                    <span data-engagement-scene-preview-tone>${escapeHtml(toneLabel)}</span>
                    <span data-engagement-scene-preview-marketing>${initial.scene?.allow_marketing === false ? '仅服务触达' : '服务 + 营销触达'}</span>
                    <span data-engagement-scene-preview-sample-label ${sampleLabel ? '' : 'hidden'}>${escapeHtml(sampleLabel)}</span>
                </div>
            </section>
        `;
    }

    function getRulePreviewSampleOptions(triggerType = '') {
        return PREVIEW_EVENT_SAMPLE_OPTIONS[normalizeToken(triggerType, 'page_view')] || [];
    }

    function normalizeRulePreviewSample(triggerType = '', sampleId = '') {
        const options = getRulePreviewSampleOptions(triggerType);
        if (!options.length) return '';
        const normalizedSample = normalizeToken(sampleId, options[0][0]);
        return options.some(([value]) => value === normalizedSample) ? normalizedSample : options[0][0];
    }

    function renderRulePreviewSampleSelect(triggerType = '', name = 'preview_event_sample') {
        const options = getRulePreviewSampleOptions(triggerType);
        if (!options.length) return '';
        return renderCustomSelect({
            name,
            value: normalizeRulePreviewSample(triggerType, state.previewEventSample || options[0][0]),
            options,
            label: '事件样本'
        });
    }

    function getRulePreviewSampleContext(triggerType = '', sampleId = '') {
        const normalizedTrigger = normalizeToken(triggerType, 'page_view');
        const normalizedSample = normalizeRulePreviewSample(normalizedTrigger, sampleId);
        const sampleMaps = {
            points_adjusted: {
                credit_bonus: {
                    label: '样本：补发积分',
                    amount: 80,
                    reason: '客服补发活动积分',
                    new_total: 268,
                    adjustment_kind: 'credit',
                    adjustment_direction: 'increase'
                },
                debit_manual: {
                    label: '样本：扣减积分',
                    amount: -30,
                    reason: '客服扣减重复到账积分',
                    new_total: 158,
                    adjustment_kind: 'debit',
                    adjustment_direction: 'decrease'
                },
                correction_fix: {
                    label: '样本：记录修正',
                    amount: 12,
                    reason: '客服修正历史积分记录',
                    new_total: 200,
                    adjustment_kind: 'correction',
                    adjustment_direction: 'increase'
                }
            },
            ticket_updated: {
                resolved_refund: {
                    label: '样本：已解决并退款',
                    ticket_status: 'RESOLVED',
                    ticket_status_label: '已解决',
                    refunded: true,
                    refund_amount: 88,
                    admin_reply: '已帮你核对订单并退回对应积分，可以重新下单。',
                    order_id: 'SHOP-2026-0188'
                },
                rejected_followup: {
                    label: '样本：已拒绝待补充',
                    ticket_status: 'REJECTED',
                    ticket_status_label: '已拒绝',
                    refunded: false,
                    refund_amount: 0,
                    admin_reply: '当前资料不足，请补充截图和订单号后重新提交。',
                    order_id: 'SHOP-2026-0251'
                },
                resolved_normal: {
                    label: '样本：已解决无需退款',
                    ticket_status: 'RESOLVED',
                    ticket_status_label: '已解决',
                    refunded: false,
                    refund_amount: 0,
                    admin_reply: '问题已经处理完成，当前权益状态已恢复正常。',
                    order_id: ''
                }
            },
            refund_status: {
                refunded_success: {
                    label: '样本：退款完成',
                    order_id: 'SHOP-2026-0312',
                    refund_status: 'refunded',
                    refund_amount: 56,
                    remark: '',
                    result_message: '退款成功，积分已原路退回。'
                },
                refunded_with_remark: {
                    label: '样本：退款附带说明',
                    order_id: 'SHOP-2026-0318',
                    refund_status: 'refunded',
                    refund_amount: 188,
                    remark: '由于重复下单，本次已全额处理退款。',
                    result_message: '退款成功，若仍有疑问可继续联系客服。'
                }
            },
            support_reply: {
                order_followup: {
                    label: '样本：订单跟进回复',
                    reply_preview: '我这边已经帮你核对订单状态，预计今天内完成发货。',
                    session_id: 'chat-order-followup',
                    page_hint: 'shop'
                },
                verify_guidance: {
                    label: '样本：验证说明回复',
                    reply_preview: '验证失败主要是材料不清晰，重新上传正面截图就可以。',
                    session_id: 'chat-verify-guide',
                    page_hint: 'verify'
                },
                generic_checkin: {
                    label: '样本：常规关怀回复',
                    reply_preview: '我先帮你记录这个问题，稍后继续跟进处理进展。',
                    session_id: 'chat-generic-checkin',
                    page_hint: 'home'
                }
            }
        };
        const sampleMap = sampleMaps[normalizedTrigger];
        if (!sampleMap) {
            return null;
        }
        return sampleMap[normalizedSample] || Object.values(sampleMap)[0] || null;
    }

    function getPointsAdjustedPreviewSummaryLabel(sample = {}) {
        const direction = normalizeToken(sample.adjustment_direction || '', '');
        const kind = normalizeToken(sample.adjustment_kind || '', '');
        if (kind === 'correction') return '积分记录已修正';
        if (direction === 'increase') return '积分已补发';
        if (direction === 'decrease') return '积分已扣减';
        return '积分有更新';
    }

    function buildPointsAdjustedPreviewContent(baseContent = '', sample = {}) {
        const lines = [];
        const normalizedBase = String(baseContent || '').trim();
        const summaryLabel = getPointsAdjustedPreviewSummaryLabel(sample);
        const amountValue = Number(sample.amount);
        const absoluteAmount = Number.isFinite(amountValue) ? Math.abs(amountValue) : 0;
        if (normalizedBase) {
            lines.push(normalizedBase);
        }
        if (absoluteAmount > 0) {
            lines.push(`本次变动：${summaryLabel.replace(/^积分/, '')} ${absoluteAmount} 积分。`);
        } else {
            lines.push('本次积分状态有更新。');
        }
        if (sample.reason) {
            lines.push(`原因：${sample.reason}`);
        }
        if (Number.isFinite(Number(sample.new_total))) {
            lines.push(`当前可用积分：${Number(sample.new_total)}`);
        }
        return lines.filter(Boolean).join('\n').trim();
    }

    function buildTicketUpdatedPreviewContent(baseContent = '', sample = {}) {
        const lines = [];
        const normalizedBase = String(baseContent || '').trim();
        if (normalizedBase) {
            lines.push(normalizedBase);
        }
        if (sample.ticket_status_label) {
            lines.push(`当前状态：${sample.ticket_status_label}`);
        }
        if (sample.admin_reply) {
            lines.push(`客服说明：${sample.admin_reply}`);
        }
        if (sample.refunded && Number(sample.refund_amount) > 0) {
            lines.push(`已退回 ${Number(sample.refund_amount)} 积分。`);
        }
        if (sample.order_id) {
            lines.push(`关联订单：${sample.order_id}`);
        }
        return lines.filter(Boolean).join('\n').trim();
    }

    function buildRefundStatusPreviewContent(baseContent = '', sample = {}) {
        const lines = [];
        const normalizedBase = String(baseContent || '').trim();
        if (normalizedBase) {
            lines.push(normalizedBase);
        }
        if (sample.order_id) {
            lines.push(`订单号：${sample.order_id}`);
        }
        if (Number(sample.refund_amount) > 0) {
            lines.push(`退款金额：${Number(sample.refund_amount)} 积分`);
        }
        if (sample.result_message) {
            lines.push(`结果：${sample.result_message}`);
        }
        if (sample.remark) {
            lines.push(`说明：${sample.remark}`);
        }
        return lines.filter(Boolean).join('\n').trim();
    }

    function buildSupportReplyPreviewContent(baseContent = '', sample = {}) {
        const lines = [];
        const normalizedBase = String(baseContent || '').trim();
        if (sample.reply_preview) {
            lines.push(`最新回复：${sample.reply_preview}`);
        } else if (normalizedBase) {
            lines.push(normalizedBase);
        }
        if (normalizedBase && sample.reply_preview) {
            lines.push(normalizedBase);
        }
        if (sample.page_hint === 'shop') {
            lines.push('上下文：订单处理跟进');
        } else if (sample.page_hint === 'verify') {
            lines.push('上下文：验证失败说明');
        } else if (sample.page_hint === 'home') {
            lines.push('上下文：常规客服回访');
        }
        return lines.filter(Boolean).join('\n').trim();
    }

    function buildRulePreviewCopy(previewData = {}) {
        const normalized = previewData && typeof previewData === 'object' ? previewData : {};
        const title = normalized.title || normalized.name || '小助手提醒';
        const content = normalized.content || '这里会实时显示用户将在客服机器人旁看到的气泡内容。';
        const triggerType = normalizeToken(normalized.trigger_type, 'page_view');
        const sample = getRulePreviewSampleContext(triggerType, state.previewEventSample || '');
        if (!sample) {
            return {
                title,
                content,
                sampleLabel: ''
            };
        }

        let nextTitle = title;
        let nextContent = content;
        if (triggerType === 'points_adjusted') {
            nextTitle = ['你的积分有更新', '积分变动通知', '小助手提醒'].includes(title)
                ? getPointsAdjustedPreviewSummaryLabel(sample)
                : title;
            nextContent = buildPointsAdjustedPreviewContent(content, sample);
        } else if (triggerType === 'ticket_updated') {
            nextTitle = ['客服工单有新进展', '小助手提醒'].includes(title)
                ? `工单${sample.ticket_status_label || '状态'}已更新`
                : title;
            nextContent = buildTicketUpdatedPreviewContent(content, sample);
        } else if (triggerType === 'refund_status') {
            nextTitle = ['退款进度有更新', '小助手提醒'].includes(title)
                ? '退款进度已更新'
                : title;
            nextContent = buildRefundStatusPreviewContent(content, sample);
        } else if (triggerType === 'support_reply') {
            nextTitle = ['客服有新回复', '小助手提醒'].includes(title)
                ? '客服有新回复'
                : title;
            nextContent = buildSupportReplyPreviewContent(content, sample);
        }
        return {
            title: nextTitle,
            content: nextContent,
            sampleLabel: sample.label || ''
        };
    }

    function buildRulePreviewCopyForSample(previewData = {}, sampleId = '') {
        const previousSample = state.previewEventSample;
        state.previewEventSample = normalizeRulePreviewSample(previewData.trigger_type, sampleId || previousSample || '');
        const previewCopy = buildRulePreviewCopy(previewData);
        state.previewEventSample = previousSample;
        return previewCopy;
    }

    function buildAutomationBlueprintPreviewData(blueprint = {}) {
        return {
            name: blueprint.title || '',
            site: getCurrentSite(),
            status: 'draft',
            page_ids: Array.isArray(blueprint.pageIds) && blueprint.pageIds.length ? blueprint.pageIds : ['all'],
            audience: { scope: blueprint.audienceScope || 'all' },
            trigger_type: blueprint.triggerType || 'page_view',
            placement: 'robot_bubble',
            title: blueprint.titleText || blueprint.title || '',
            content: blueprint.content || '',
            tone: blueprint.tone || 'info',
            action_label: blueprint.actionLabel || '',
            action_url: blueprint.actionUrl || '',
            enabled: false
        };
    }

    function getAutomationPreviewSampleValue(blueprint = {}) {
        const blueprintId = normalizeToken(blueprint.id, '');
        const triggerType = normalizeToken(blueprint.triggerType, 'page_view');
        const stored = state.automationPreviewSamples && typeof state.automationPreviewSamples === 'object'
            ? state.automationPreviewSamples[blueprintId]
            : '';
        return normalizeRulePreviewSample(triggerType, stored || '');
    }

    function cycleAutomationPreviewSample(automationId = '') {
        const blueprintId = normalizeToken(automationId, '');
        const blueprint = AUTOMATION_BLUEPRINTS.find((item) => item.id === blueprintId);
        if (!blueprint) return false;
        const options = getRulePreviewSampleOptions(blueprint.triggerType);
        if (options.length <= 1) return false;
        const currentValue = getAutomationPreviewSampleValue(blueprint);
        const currentIndex = Math.max(0, options.findIndex(([value]) => value === currentValue));
        const nextValue = options[(currentIndex + 1) % options.length]?.[0] || options[0][0];
        state.automationPreviewSamples = {
            ...(state.automationPreviewSamples || {}),
            [blueprintId]: nextValue
        };
        renderOverview(state.payload || {});
        return true;
    }

    function buildAutomationBlueprintPreview(blueprint = {}) {
        const previewData = buildAutomationBlueprintPreviewData(blueprint);
        const triggerType = normalizeToken(previewData.trigger_type, 'page_view');
        const sampleValue = getAutomationPreviewSampleValue(blueprint);
        const previousSample = state.previewEventSample;
        state.previewEventSample = sampleValue || previousSample;
        const previewCopy = buildRulePreviewCopy(previewData);
        state.previewEventSample = previousSample;
        return {
            ...previewCopy,
            sampleValue,
            hasDynamicSamples: getRulePreviewSampleOptions(triggerType).length > 1
        };
    }

    function buildSceneCardPreview(scene = {}) {
        const pageId = normalizeToken(scene.id || scene.page_id || 'home', 'home');
        const events = Array.isArray(scene.events) ? scene.events : [];
        const triggerType = normalizeScenePreviewEvent(events, events[0] || '');
        const blueprint = getScenePreviewBlueprint(triggerType, pageId);
        const previewData = {
            site: getCurrentSite(),
            status: 'published',
            page_ids: [pageId],
            audience: { scope: 'all' },
            trigger_type: triggerType,
            placement: scene.default_placement || 'robot_bubble',
            title: blueprint?.titleText || `${getPageLabel(pageId)} · ${getEventLabel(triggerType)}`,
            content: blueprint?.content || getScenePreviewFallbackCopy(scene, triggerType).content,
            tone: scene.tone || blueprint?.tone || 'info',
            action_label: blueprint?.actionLabel || '',
            action_url: blueprint?.actionUrl || '',
            enabled: true
        };
        const sampleId = getRulePreviewSampleOptions(triggerType)[0]?.[0] || '';
        const previewCopy = buildRulePreviewCopyForSample(previewData, sampleId);
        return {
            triggerType,
            title: previewCopy.title,
            content: String(previewCopy.content || '').replace(/\s+/g, ' ').trim(),
            sampleLabel: previewCopy.sampleLabel || ''
        };
    }

    function renderRuleComposer() {
        const rule = getEditableRule();
        const ruleDraft = rule ? null : getRuleDraft();
        const templateDraft = rule || ruleDraft ? null : getTemplateDraft();
        const draftSource = rule || ruleDraft || templateDraft || {};
        const focusedPageId = getFocusedPageId();
        const templatePages = Array.isArray(templateDraft?.page_ids)
            ? templateDraft.page_ids.map((pageId) => normalizeToken(pageId, '')).filter((pageId) => RULE_PAGE_OPTIONS.includes(pageId))
            : [];
        const draftPages = Array.isArray(draftSource.page_ids)
            ? draftSource.page_ids.map((pageId) => normalizeToken(pageId, '')).filter((pageId) => RULE_PAGE_OPTIONS.includes(pageId))
            : [];
        const defaultPages = rule || ruleDraft
            ? (draftPages.length ? draftPages : ['all'])
            : (focusedPageId ? [focusedPageId] : (templatePages.length ? templatePages : ['all']));
        const selectedPages = new Set(defaultPages);
        const draftStartsAtSource = draftSource.starts_at || draftSource.startsAt || '';
        const status = normalizeRuleStatusForSchedule(draftSource.status || 'draft', draftStartsAtSource);
        const site = draftSource.site || getCurrentSite();
        const normalizedSite = ['cn', 'intl'].includes(site) ? site : 'all';
        const draftName = rule || ruleDraft
            ? draftSource.name
            : (templateDraft ? `${templateDraft.name || templateDraft.title || '消息模板'}规则` : '');
        const draftTitle = draftSource.title || '';
        const draftContent = draftSource.content || '';
        const draftActionLabel = draftSource.action_label || '';
        const draftActionUrl = draftSource.action_url || '';
        const draftTone = draftSource.tone || 'info';
        const draftPriority = draftSource.priority ?? 0;
        const draftDismissTtlHours = draftSource.dismiss_ttl_hours || 24;
        const draftRepeatIntervalMinutes = getRuleRepeatIntervalMinutes(draftSource, 2);
        const draftStartsAt = formatRuleDateTimeLocal(draftStartsAtSource);
        const effectiveStatusInfo = getRuleEffectiveStatusInfo({
            ...draftSource,
            status,
            starts_at: draftStartsAtSource
        });
        const draftAudienceScope = getAudienceScope(draftSource.audience);
        const draftTriggerType = getTemplatePreferredTriggerType(draftSource);
        const draftPlacement = normalizeToken(draftSource.placement || 'robot_bubble', 'robot_bubble');
        const draftGovernance = getRuleGovernance({
            ...draftSource,
            page_ids: Array.from(selectedPages),
            placement: draftPlacement,
            tone: draftTone,
            priority: draftPriority,
            action_label: draftActionLabel,
            action_url: draftActionUrl,
            trigger_type: draftTriggerType
        });
        const draftGovernanceNotice = renderRuleGovernanceNotice(draftGovernance);
        const triggerPriorityClass = getEventPriorityClass(draftTriggerType);
        const ruleDraftNotice = !rule && ruleDraft
            ? `
                <div class="engagement-rule-copy-note">
                    <i class="fas fa-copy" aria-hidden="true"></i>
                    <span>已复制「${escapeHtml(ruleDraft.source_name || ruleDraft.name || '触达规则')}」为新草稿，保存后会创建一条新规则</span>
                    <button type="button" data-engagement-action="clear-rule-draft">移除草稿</button>
                </div>
            `
            : '';
        const templateDraftNotice = !rule && templateDraft
            ? `
                <div class="engagement-template-apply-note">
                    <i class="fas fa-layer-group" aria-hidden="true"></i>
                    <span>已套用「${escapeHtml(templateDraft.name || templateDraft.key || '消息模板')}」，可继续微调页面、语气和按钮</span>
                    <button type="button" data-engagement-action="clear-template-draft">移除模板</button>
                </div>
            `
            : '';
        const focusedPageNotice = !rule && focusedPageId
            ? `
                <div class="engagement-page-focus-note">
                    <i class="fas fa-location-dot" aria-hidden="true"></i>
                    <span>正在为「${escapeHtml(getPageLabel(focusedPageId))}」创建页面触达规则</span>
                    <button type="button" data-engagement-action="clear-page-filter">清除页面</button>
                </div>
            `
            : '';

        return `
            <section class="engagement-section engagement-rule-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>${rule ? '编辑触达规则' : '新建触达规则'}</h3>
                        <p>配置机器人在指定页面吐出的气泡。发布后公共页会通过客服机器人自动读取。</p>
                    </div>
                    ${rule ? `<button type="button" class="engagement-link-btn" data-engagement-action="reset-rule">新建规则</button>` : ''}
                </div>
                ${ruleDraftNotice}
                ${templateDraftNotice}
                ${focusedPageNotice}
                <div data-engagement-rule-governance-slot ${draftGovernanceNotice ? '' : 'hidden'}>${draftGovernanceNotice}</div>
                <form id="engagementRuleForm" class="engagement-rule-form" data-engagement-managed-form data-engagement-runtime="${escapeHtml(ENGAGEMENT_RUNTIME_VERSION)}" autocomplete="off" novalidate>
                    <input type="hidden" name="id" value="${escapeHtml(rule?.id || '')}">
                    <div class="engagement-form-grid">
                        <label class="engagement-field engagement-field--name">
                            <span>规则名称</span>
                            <input name="name" type="text" maxlength="160" value="${escapeHtml(draftName || '')}" placeholder="例如：商城可领券提醒" required>
                        </label>
                        <label class="engagement-field engagement-field--site">
                            <span>站点</span>
                            ${renderCustomSelect({
                                name: 'site',
                                value: normalizedSite,
                                options: [['all', '全站'], ['cn', 'CN'], ['intl', 'INTL']],
                                label: '站点'
                            })}
                        </label>
                        <label class="engagement-field engagement-field--status">
                            <span>状态</span>
                            ${renderCustomSelect({
                                name: 'status',
                                value: status,
                                options: RULE_STATUS_OPTIONS,
                                label: '状态'
                            })}
                        </label>
                        <label class="engagement-field engagement-field--audience">
                            <span>用户范围</span>
                            ${renderCustomSelect({
                                name: 'audience_scope',
                                value: draftAudienceScope,
                                options: getAudienceScopeOptions(),
                                label: '用户范围'
                            })}
                        </label>
                        <label class="engagement-field engagement-field--trigger">
                            <span>触发类型</span>
                            ${renderCustomSelect({
                                name: 'trigger_type',
                                value: draftTriggerType,
                                options: TRIGGER_TYPE_OPTIONS,
                                label: '触发类型'
                            })}
                            <small class="engagement-field__hint">登录首波分诊：${escapeHtml(triggerPriorityClass.label)}。${escapeHtml(triggerPriorityClass.desc)}</small>
                        </label>
                        <label class="engagement-field engagement-field--placement">
                            <span>展示形式</span>
                            ${renderCustomSelect({
                                name: 'placement',
                                value: draftPlacement,
                                options: DISPLAY_PLACEMENT_OPTIONS,
                                label: '展示形式'
                            })}
                        </label>
                        <label class="engagement-field engagement-field--priority">
                            <span>优先级</span>
                            <input name="priority" type="number" min="-1000" max="1000" value="${escapeHtml(draftPriority)}">
                        </label>
                    </div>
                    <div class="engagement-form-block">
                        <span>页面</span>
                        ${renderPagePicker(selectedPages)}
                    </div>
                    <div class="engagement-form-grid engagement-form-grid--wide">
                        <label class="engagement-field engagement-field--title">
                            <span>气泡标题</span>
                            <input name="title" type="text" maxlength="160" value="${escapeHtml(draftTitle || '')}" placeholder="例如：这件商品有优惠">
                        </label>
                        <label class="engagement-field engagement-field--tone">
                            <span>语气</span>
                            ${renderCustomSelect({
                                name: 'tone',
                                value: draftTone || 'info',
                                options: RULE_TONE_OPTIONS,
                                label: '语气'
                            })}
                        </label>
                        <label class="engagement-field engagement-form-field--full engagement-field--content">
                            <span>气泡内容</span>
                            <textarea name="content" rows="3" maxlength="1200" placeholder="写给用户看的提示文案" required>${escapeHtml(draftContent || '')}</textarea>
                        </label>
                        <label class="engagement-field engagement-field--action-label">
                            <span>按钮文案</span>
                            <input name="action_label" type="text" maxlength="80" value="${escapeHtml(draftActionLabel || '')}" placeholder="例如：立即领取">
                        </label>
                        <label class="engagement-field engagement-field--action-url">
                            <span>按钮链接</span>
                            <input name="action_url" type="text" maxlength="1000" value="${escapeHtml(draftActionUrl || '')}" placeholder="/shop.html">
                        </label>
                        ${renderRulePublishDateTimePicker(draftStartsAt)}
                        <label class="engagement-field engagement-field--repeat">
                            <span>重复提醒间隔（分钟）</span>
                            <input name="repeat_interval_minutes" type="number" min="0" max="1440" value="${escapeHtml(draftRepeatIntervalMinutes)}">
                        </label>
                        <label class="engagement-field engagement-field--ttl">
                            <span>关闭冷却（小时）</span>
                            <input name="dismiss_ttl_hours" type="number" min="1" max="720" value="${escapeHtml(draftDismissTtlHours)}">
                        </label>
                        <div class="engagement-rule-status-note engagement-field--status-note" data-engagement-rule-status-note data-tone="${escapeHtml(effectiveStatusInfo.tone)}">
                            ${renderRuleEffectiveStatusNote(effectiveStatusInfo)}
                        </div>
                        <div class="engagement-form-actions engagement-field--rule-actions">
                            <div class="engagement-form-error" data-engagement-form-error role="alert" data-tone="error" hidden></div>
                            <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-rule" data-engagement-runtime="${escapeHtml(ENGAGEMENT_RUNTIME_VERSION)}">
                                <i class="fas fa-save"></i>
                                <span>${rule ? '保存规则' : '创建规则'}</span>
                            </button>
                        </div>
                    </div>
                </form>
            </section>
        `;
    }

    function renderPageScenes(pageScenes = []) {
        const scenes = Array.isArray(pageScenes) ? pageScenes : [];
        if (!scenes.length) {
            return '';
        }

        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>页面触达版图</h3>
                        <p>每个公共页使用相同机器人入口，但气泡语气、触发事件和行动按钮独立配置。</p>
                    </div>
                </div>
                <div class="engagement-page-grid">
                    ${scenes.map((scene) => {
                        const pageId = normalizeToken(scene.id, 'all');
                        const tone = normalizeToken(scene.tone, 'info');
                        const isFocused = pageId && pageId === state.focusedPageId;
                        const events = Array.isArray(scene.events) ? scene.events : [];
                        const preview = buildSceneCardPreview(scene);
                        const scenePriorityCenter = getSceneEventPriorityCenter(scene);
                        const hasPriorityOverride = scene?.event_priority_center?.enabled === true;
                        return `
                            <article class="engagement-page-card ${isFocused ? 'is-focused' : ''}"
                                role="button"
                                tabindex="0"
                                data-engagement-action="focus-page"
                                data-engagement-page-card
                                data-engagement-page="${escapeHtml(pageId)}"
                                data-page-id="${escapeHtml(pageId)}"
                                aria-label="配置${escapeHtml(scene.label || getPageLabel(pageId))}触达规则">
                                <div class="engagement-page-card__top">
                                    <span class="engagement-page-icon engagement-page-icon--${escapeHtml(tone)}">
                                        <i class="fas fa-comment-dots"></i>
                                    </span>
                                    <div>
                                        <h4>${escapeHtml(scene.label || getPageLabel(pageId))}</h4>
                                        <p>${escapeHtml(getSafeZoneLabel(scene.safe_zone || 'bottom-right'))}</p>
                                    </div>
                                </div>
                                <div class="engagement-chip-row">
                                    ${events.map((eventKey) => `<span>${escapeHtml(getEventLabel(eventKey))}</span>`).join('')}
                                </div>
                                <div class="engagement-page-card__preview" data-tone="${escapeHtml(tone)}">
                                    <strong>${escapeHtml(preview.title)}</strong>
                                    <p>${escapeHtml(preview.content)}</p>
                                    <div class="engagement-page-card__preview-meta">
                                        <span>${escapeHtml(getEventLabel(preview.triggerType))}</span>
                                        <span>${escapeHtml(getEventPriorityClass(preview.triggerType, scenePriorityCenter).label)}</span>
                                        ${hasPriorityOverride ? '<span>页面分诊覆盖</span>' : ''}
                                        ${preview.sampleLabel ? `<span>${escapeHtml(preview.sampleLabel)}</span>` : ''}
                                    </div>
                                </div>
                                <div class="engagement-card-action-row">
                                    <span class="engagement-page-card__action">配置规则 <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
                                    <button type="button" class="engagement-icon-btn" title="编辑页面场景" data-engagement-action="edit-scene" data-page-id="${escapeHtml(pageId)}">
                                        <i class="fas fa-sliders"></i>
                                    </button>
                                </div>
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function renderSceneComposer() {
        const scene = getEditableScene();
        const pageId = normalizeToken(scene.id || scene.page_id || state.editingScenePageId || state.focusedPageId || 'home', 'home');
        const selectedEvents = Array.isArray(scene.events) ? scene.events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean) : [];
        const priorityCenter = normalizeSceneEventPriorityCenter(scene.event_priority_center || {}, getEventPriorityCenter());
        const presetPacks = rankScenePriorityPresets(pageId, getScenePriorityPresetPacks(pageId));
        const analyticsSummary = getSceneAnalyticsSummary(pageId);
        const scenePageOptions = RULE_PAGE_OPTIONS
            .filter((item) => item !== 'all')
            .map((item) => [item, getPageLabel(item)]);
        return `
            <section class="engagement-section engagement-management-composer engagement-scene-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>页面场景配置</h3>
                        <p>把每个公共页的气泡语气、默认形态、可用事件和营销边界独立管理。</p>
                    </div>
                </div>
                <form id="engagementSceneForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    <div class="engagement-form-grid engagement-management-grid">
                        <label class="engagement-field">
                            <span>页面</span>
                            ${renderCustomSelect({
                                name: 'page_id',
                                value: pageId,
                                options: scenePageOptions,
                                label: '页面'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>页面名称</span>
                            <input name="label" type="text" maxlength="80" value="${escapeHtml(scene.label || getPageLabel(pageId))}">
                        </label>
                        <label class="engagement-field">
                            <span>语气</span>
                            ${renderCustomSelect({
                                name: 'tone',
                                value: scene.tone || 'info',
                                options: RULE_TONE_OPTIONS,
                                label: '语气'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>默认展示形式</span>
                            ${renderCustomSelect({
                                name: 'default_placement',
                                value: scene.default_placement || 'robot_bubble',
                                options: DISPLAY_PLACEMENT_OPTIONS,
                                label: '展示形式'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>安全位置</span>
                            ${renderCustomSelect({
                                name: 'safe_zone',
                                value: scene.safe_zone || 'bottom-right',
                                options: SAFE_ZONE_OPTIONS,
                                label: '安全位置'
                            })}
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>营销触达</span>
                            ${renderCustomSwitch({
                                name: 'allow_marketing',
                                checked: scene.allow_marketing !== false,
                                label: '允许活动、优惠和转化提示'
                            })}
                        </div>
                        <div class="engagement-field engagement-form-field--full">
                            <span>可用事件</span>
                            ${renderSceneEventPicker(selectedEvents)}
                            <small class="engagement-field__hint">登录首波只会优先挑“首波优先”事件；服务、引导和营销类会按节奏后置。</small>
                        </div>
                        <div class="engagement-field engagement-form-field--full">
                            <span>页面首波分诊</span>
                            <div class="engagement-priority-override-panel">
                                ${renderScenePriorityGuidance(pageId)}
                                <div class="engagement-form-block engagement-form-block--switch">
                                    <span>页面覆盖</span>
                                    ${renderCustomSwitch({
                                        name: 'scene_priority_override_enabled',
                                        checked: priorityCenter.enabled === true,
                                        label: '当前页面使用独立的首波分诊顺序'
                                    })}
                                </div>
                                <small class="engagement-field__hint">关闭时继承全局首波分诊；开启后只覆盖当前页面登录首波的事件分档。</small>
                                <div class="engagement-priority-override-grid ${priorityCenter.enabled === true ? '' : 'is-disabled'}" data-engagement-scene-priority-override-grid>
                                    ${Object.entries(priorityCenter).filter(([groupId]) => groupId !== 'enabled').map(([groupId, group]) => `
                                        <div class="engagement-priority-group-block" data-tier="${escapeHtml(groupId)}">
                                            <div class="engagement-priority-group-block__head">
                                                <div>
                                                    <strong>${escapeHtml(group.label)}</strong>
                                                    <p>${escapeHtml(group.desc)}</p>
                                                </div>
                                                ${renderEventPriorityBadgeById(groupId)}
                                            </div>
                                            ${renderEventPriorityPicker(groupId, group.events || [], `scene:${pageId}`)}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                    ${renderEventPriorityLegend()}
                    <div class="engagement-form-actions">
                        ${presetPacks.length ? `
                            <div class="engagement-scene-preset-row">
                                ${presetPacks.map((preset, index) => `
                                    <article class="engagement-scene-preset-card">
                                        <div>
                                            <div class="engagement-scene-preset-card__head">
                                                <strong>${escapeHtml(preset.name)}</strong>
                                                ${index === 0 ? '<span class="engagement-scene-preset-card__badge">推荐</span>' : ''}
                                            </div>
                                            <p>${escapeHtml(index === 0 ? preset.recommendation_reason || preset.description : preset.description)}</p>
                                            <div class="engagement-chip-row">
                                                <span>${escapeHtml(preset.allow_marketing === false ? '仅服务触达' : '服务 + 营销')}</span>
                                                ${index === 0 && analyticsSummary.views ? `<span>${escapeHtml(formatNumber(analyticsSummary.views))} 曝光</span>` : ''}
                                                ${index === 0 && analyticsSummary.views ? `<span>CTR ${escapeHtml(formatPercent(analyticsSummary.ctr))}</span>` : ''}
                                                ${Array.isArray(preset.events) ? preset.events.slice(0, 3).map((eventKey) => `<span>${escapeHtml(getEventLabel(eventKey))}</span>`).join('') : ''}
                                            </div>
                                        </div>
                                        <button type="button" class="engagement-scene-preset-card__action" data-engagement-action="apply-scene-priority-preset" data-scene-priority-preset-id="${escapeHtml(preset.id)}" data-page-id="${escapeHtml(pageId)}">${escapeHtml(preset.applyLabel || '套用预设')}</button>
                                    </article>
                                `).join('')}
                            </div>
                        ` : ''}
                        <button type="button" class="engagement-link-btn" data-engagement-action="reset-scene">恢复首页场景</button>
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-scene">
                            <i class="fas fa-save"></i>
                            <span>保存场景</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderEventPriorityCenterComposer() {
        const center = getEventPriorityCenter();
        return `
            <section class="engagement-section engagement-management-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>首波分诊配置</h3>
                        <p>配置登录后的首波事件分档。前台会先收集候选提醒，再优先展示“首波优先”中的高价值事件。</p>
                    </div>
                </div>
                <form id="engagementEventPriorityForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    ${Object.entries(center).map(([groupId, group]) => `
                        <div class="engagement-priority-group-block" data-tier="${escapeHtml(groupId)}">
                            <div class="engagement-priority-group-block__head">
                                <div>
                                    <strong>${escapeHtml(group.label)}</strong>
                                    <p>${escapeHtml(group.desc)}</p>
                                </div>
                                ${renderEventPriorityBadgeById(groupId)}
                            </div>
                            ${renderEventPriorityPicker(groupId, group.events || [], 'global')}
                        </div>
                    `).join('')}
                    <div class="engagement-form-actions">
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-event-priority-center">
                            <i class="fas fa-save"></i>
                            <span>保存分诊配置</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderTemplateComposer() {
        const template = getEditableTemplate();
        const selectedPages = new Set(Array.isArray(template?.page_ids) && template.page_ids.length ? template.page_ids : ['all']);
        return `
            <section class="engagement-section engagement-management-composer engagement-template-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>${template ? '编辑消息模板' : '新建消息模板'}</h3>
                        <p>模板用于沉淀积分、回复、优惠券、权限变更等可复用气泡，后续可一键生成规则。</p>
                    </div>
                    ${template ? `<button type="button" class="engagement-link-btn" data-engagement-action="reset-template">新建模板</button>` : ''}
                </div>
                <form id="engagementTemplateForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    <input type="hidden" name="id" value="${escapeHtml(template?.id || '')}">
                    <div class="engagement-form-grid engagement-management-grid">
                        <label class="engagement-field engagement-field--name">
                            <span>模板名称</span>
                            <input name="name" type="text" maxlength="160" value="${escapeHtml(template?.name || '')}" placeholder="例如：优惠券到账" required>
                        </label>
                        <label class="engagement-field">
                            <span>模板 key</span>
                            <input name="key" type="text" maxlength="120" value="${escapeHtml(template?.key || '')}" placeholder="coupon_available">
                        </label>
                        <label class="engagement-field">
                            <span>分类</span>
                            ${renderCustomSelect({
                                name: 'category',
                                value: template?.category || 'general',
                                options: [['general', '通用运营'], ...TEMPLATE_PRODUCT_CATEGORIES.map((category) => [category.id, category.title])],
                                label: '模板分类'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>语气</span>
                            ${renderCustomSelect({
                                name: 'tone',
                                value: template?.tone || 'info',
                                options: RULE_TONE_OPTIONS,
                                label: '语气'
                            })}
                        </label>
                    </div>
                    <div class="engagement-form-block">
                        <span>适用页面</span>
                        ${renderPagePicker(selectedPages)}
                    </div>
                    <div class="engagement-form-grid engagement-form-grid--wide engagement-management-grid--wide">
                        <label class="engagement-field engagement-field--title">
                            <span>气泡标题</span>
                            <input name="title" type="text" maxlength="160" value="${escapeHtml(template?.title || '')}" placeholder="例如：优惠券已到账" required>
                        </label>
                        <label class="engagement-field engagement-field--content">
                            <span>气泡内容</span>
                            <textarea name="content" rows="3" maxlength="1200" placeholder="写给用户看的提示文案" required>${escapeHtml(template?.content || '')}</textarea>
                        </label>
                        <label class="engagement-field engagement-field--action-label">
                            <span>按钮文案</span>
                            <input name="action_label" type="text" maxlength="80" value="${escapeHtml(template?.action_label || '')}" placeholder="我的钱包 > 卡券">
                        </label>
                        <label class="engagement-field engagement-field--action-url">
                            <span>按钮链接</span>
                            <input name="action_url" type="text" maxlength="1000" value="${escapeHtml(template?.action_url || '')}" placeholder="wallet://cards">
                        </label>
                        <label class="engagement-field engagement-form-field--full">
                            <span>说明</span>
                            <input name="description" type="text" maxlength="800" value="${escapeHtml(template?.description || '')}" placeholder="给管理员看的使用说明">
                        </label>
                    </div>
                    <div class="engagement-form-actions">
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-template">
                            <i class="fas fa-save"></i>
                            <span>${template ? '保存模板' : '创建模板'}</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderTemplateProductShelf(templates = []) {
        const rows = Array.isArray(templates) ? templates : [];
        const summary = getTemplateLibrarySummary(rows);
        const categoryStats = getTemplateCategoryStats(rows);
        const activeCategory = getTemplateProductCategoryById(state.templateCategoryFilter);
        const recommendedStarters = TEMPLATE_STARTERS
            .filter((starter) => !activeCategory || isTemplateInProductCategory(starter, activeCategory))
            .slice(0, activeCategory ? 12 : 18);

        return `
            <section class="engagement-section engagement-template-product-shelf">
                <div class="engagement-section__head">
                    <div>
                        <h3>模板商品货架</h3>
                        <p>把常用客服气泡按运营场景沉淀，站长可以直接写入模板库或一键套用到规则。</p>
                    </div>
                    <div class="engagement-template-summary">
                        <span>${escapeHtml(formatNumber(summary.templates))} 模板</span>
                        <span>${escapeHtml(formatNumber(summary.with_action))} 带跳转</span>
                        <span>${escapeHtml(formatNumber(summary.linked_rules))} 规则使用</span>
                    </div>
                </div>
                <div class="engagement-template-category-grid">
                    ${categoryStats.map((category) => {
                        const isActive = state.templateCategoryFilter === category.id;
                        return `
                            <button type="button"
                                class="engagement-template-category-card ${isActive ? 'is-active' : ''}"
                                data-engagement-action="focus-template-category"
                                data-template-category="${escapeHtml(category.id)}"
                                aria-pressed="${isActive ? 'true' : 'false'}">
                                <i class="fas ${escapeHtml(category.icon)}" aria-hidden="true"></i>
                                <span>
                                    <strong>${escapeHtml(category.title)}</strong>
                                    <small>${escapeHtml(formatNumber(category.templates))} 模板 · ${escapeHtml(formatNumber(category.metrics.views))} 曝光</small>
                                </span>
                            </button>
                        `;
                    }).join('')}
                </div>
                <div class="engagement-template-starter-grid">
                    ${recommendedStarters.map((starter) => {
                        const installed = isTemplateStarterInstalled(starter, rows);
                        const category = getTemplateProductCategory(starter);
                        return `
                            <article class="engagement-template-starter-card ${installed ? 'is-installed' : ''}">
                                <div>
                                    <span class="engagement-template-starter-card__type">
                                        <i class="fas ${escapeHtml(category.icon)}" aria-hidden="true"></i>
                                        ${escapeHtml(category.title)}
                                    </span>
                                    <strong>${escapeHtml(starter.name)}</strong>
                                    <p>${escapeHtml(starter.description || starter.content)}</p>
                                    <div class="engagement-chip-row">
                                        ${(starter.page_ids || ['all']).map((pageId) => `<span>${escapeHtml(getPageLabel(pageId))}</span>`).join('')}
                                        <span>${escapeHtml(getOptionLabel(RULE_TONE_OPTIONS, starter.tone || 'info'))}</span>
                                    </div>
                                </div>
                                <button type="button"
                                    class="engagement-template-starter-card__action"
                                    data-engagement-action="create-template-starter"
                                    data-template-starter-id="${escapeHtml(starter.id)}"
                                    ${installed ? 'disabled' : ''}>
                                    <i class="fas ${installed ? 'fa-check' : 'fa-plus'}" aria-hidden="true"></i>
                                    <span>${installed ? '已在库中' : '写入模板库'}</span>
                                </button>
                            </article>
                        `;
                    }).join('')}
                </div>
                ${activeCategory ? `
                    <div class="engagement-filter-pill engagement-template-category-filter">
                        <i class="fas ${escapeHtml(activeCategory.icon)}" aria-hidden="true"></i>
                        <span>${escapeHtml(activeCategory.title)}</span>
                        <button type="button" data-engagement-action="clear-template-category-filter" aria-label="清除模板分类筛选">×</button>
                    </div>
                ` : ''}
            </section>
        `;
    }

    function renderTemplatePerformanceInsights(templates = []) {
        const rows = getTemplatesForCurrentTemplateFilters(templates)
            .map((template) => ({
                template,
                category: getTemplateProductCategory(template),
                metrics: getTemplateUsageMetrics(template)
            }))
            .sort((first, second) => (
                Number(second.metrics.views || 0) - Number(first.metrics.views || 0)
                || Number(second.metrics.rules || 0) - Number(first.metrics.rules || 0)
            ))
            .slice(0, 6);

        return `
            <section class="engagement-section engagement-template-performance">
                <div class="engagement-section__head">
                    <div>
                        <h3>模板效果追踪</h3>
                        <p>按模板关联规则汇总曝光、点击和转化，帮助判断哪些文案值得复用。</p>
                    </div>
                </div>
                <div class="engagement-template-performance-list">
                    ${rows.length ? rows.map(({ template, category, metrics }) => {
                        const templateRef = String(template.id || template.key || '').trim();
                        return `
                            <article class="engagement-template-performance-row">
                                <i class="fas ${escapeHtml(category.icon)}" aria-hidden="true"></i>
                                <div>
                                    <strong>${escapeHtml(template.name || template.key || '未命名模板')}</strong>
                                    <p>${escapeHtml(category.title)} · ${escapeHtml(formatNumber(metrics.rules))} 条规则 · CTR ${escapeHtml(formatPercent(metrics.ctr))}</p>
                                </div>
                                <span>${escapeHtml(formatNumber(metrics.views))} 曝光</span>
                                <span>${escapeHtml(formatNumber(metrics.clicks))} 点击</span>
                                <button type="button" title="套用模板" data-engagement-action="apply-template" data-template-id="${escapeHtml(templateRef)}">
                                    <i class="fas fa-arrow-right"></i>
                                </button>
                            </article>
                        `;
                    }).join('') : `<div class="engagement-empty">暂无可追踪模板。先写入推荐模板并创建规则，曝光和点击会在这里沉淀。</div>`}
                </div>
            </section>
        `;
    }

    function renderTemplates(templates = []) {
        const focusedCapability = getFocusedCapability();
        const activeCategory = getTemplateProductCategoryById(state.templateCategoryFilter);
        const rows = getTemplatesForCurrentTemplateFilters(templates).slice(0, 12);
        const capabilityFilter = focusedCapability
            ? `
                <div class="engagement-filter-pill">
                    <i class="fas ${escapeHtml(focusedCapability.icon)}" aria-hidden="true"></i>
                    <span>${escapeHtml(focusedCapability.title)}</span>
                    <button type="button" data-engagement-action="clear-capability-filter" aria-label="清除能力筛选">×</button>
                </div>
            `
            : '';
        const categoryFilter = activeCategory
            ? `
                <div class="engagement-filter-pill">
                    <i class="fas ${escapeHtml(activeCategory.icon)}" aria-hidden="true"></i>
                    <span>${escapeHtml(activeCategory.title)}</span>
                    <button type="button" data-engagement-action="clear-template-category-filter" aria-label="清除模板分类筛选">×</button>
                </div>
            `
            : '';
        return `
            <section class="engagement-section engagement-section--split">
                <div class="engagement-section__head">
                    <div>
                        <h3>${focusedCapability ? `${escapeHtml(focusedCapability.title)}模板` : (activeCategory ? `${escapeHtml(activeCategory.title)}模板` : '消息模板')}</h3>
                        <p>${focusedCapability ? `围绕${escapeHtml(focusedCapability.desc)}沉淀可复用气泡。` : (activeCategory ? escapeHtml(activeCategory.desc) : '积分、回复、优惠券、权限变更等标准事件会沉淀为可复用气泡。')}</p>
                    </div>
                    ${capabilityFilter}
                    ${categoryFilter}
                </div>
                <div class="engagement-list">
                    ${rows.length ? rows.map((template) => {
                        const templateRef = String(template.id || template.key || '').trim();
                        const category = getTemplateProductCategory(template);
                        const metrics = getTemplateUsageMetrics(template);
                        return `
                        <article class="engagement-list-item engagement-template-item"
                            role="button"
                            tabindex="0"
                            data-engagement-action="apply-template"
                            data-engagement-template-card
                            data-template-id="${escapeHtml(templateRef)}"
                            aria-label="套用${escapeHtml(template.name || template.key || '消息模板')}到触达规则">
                            <div>
                                <strong>${escapeHtml(template.name || template.key || '未命名模板')}</strong>
                                <p>${escapeHtml(template.title || '')}</p>
                                <div class="engagement-template-item__stats">
                                    <span>${escapeHtml(category.title)}</span>
                                    <span>${escapeHtml(formatNumber(metrics.rules))} 规则</span>
                                    <span>${escapeHtml(formatNumber(metrics.views))} 曝光</span>
                                </div>
                            </div>
                            <div class="engagement-template-item__meta">
                                <span class="engagement-template-item__page">${escapeHtml(getPageLabel((template.page_ids || [])[0] || 'all'))}</span>
                                <span class="engagement-template-card__action">套用模板 <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
                                <span class="engagement-inline-actions">
                                    <button type="button" title="编辑模板" data-engagement-action="edit-template" data-template-id="${escapeHtml(templateRef)}">
                                        <i class="fas fa-pen"></i>
                                    </button>
                                    <button type="button" title="删除模板" data-engagement-action="delete-template" data-template-id="${escapeHtml(templateRef)}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </span>
                            </div>
                        </article>
                    `;
                    }).join('') : `
                        <div class="engagement-empty">${focusedCapability ? `${escapeHtml(focusedCapability.title)}暂无匹配模板，可以先清除筛选查看全部模板。` : '暂无模板，迁移完成后会写入默认商业事件模板。'}</div>
                    `}
                </div>
            </section>
        `;
    }

    function renderRuleBatchResult(result = {}) {
        const batchId = String(result.batch_id || '').trim();
        if (!batchId) return '';
        const tone = normalizeToken(result.tone, 'success');
        const errors = Array.isArray(result.errors) ? result.errors : [];
        return `
            <div class="engagement-rule-batch-result" data-tone="${escapeHtml(tone)}">
                <i class="fas ${tone === 'error' ? 'fa-circle-exclamation' : (tone === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check')}" aria-hidden="true"></i>
                <div>
                    <strong>${escapeHtml(result.label || '批量治理结果')}</strong>
                    <p>批次 ${escapeHtml(batchId)} · 成功 ${escapeHtml(formatNumber(result.success))} · 失败 ${escapeHtml(formatNumber(result.failed))} · 跳过 ${escapeHtml(formatNumber(result.skipped))}</p>
                    ${errors.length ? `<p>${escapeHtml(errors.slice(0, 2).map((item) => `${item.name || item.id || '规则'}：${item.message || '处理失败'}`).join('；'))}</p>` : ''}
                </div>
            </div>
        `;
    }

    function renderRuleDuplicateNotice(duplicateGroups = []) {
        const groups = Array.isArray(duplicateGroups) ? duplicateGroups : [];
        if (!groups.length) return '';
        const duplicateRules = groups.reduce((count, group) => count + group.length, 0);
        const examples = groups
            .slice(0, 2)
            .map((group) => `${group[0]?.name || '未命名规则'} x${group.length}`)
            .join('、');
        const actionLabel = state.ruleDuplicateFilter === true ? '正在查看' : `查看重复 ${formatNumber(duplicateRules)}`;
        return `
            <div class="engagement-rule-duplicate-notice">
                <i class="fas fa-clone" aria-hidden="true"></i>
                <div>
                    <strong>发现 ${escapeHtml(formatNumber(groups.length))} 组完全重复规则</strong>
                    <p>${escapeHtml(examples || '重复规则会让运营判断和批量治理变复杂。')}，建议管理员保留一条，归档多余草稿或暂停重复运行规则。</p>
                </div>
                <button type="button" data-engagement-action="focus-duplicate-rules" ${state.ruleDuplicateFilter === true ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button>
            </div>
        `;
    }

    function renderRuleManagementToolbar(totalCount = 0, visibleCount = 0, rules = [], duplicateGroups = null, pagination = null) {
        const pageFilterOptions = [
            ['all', '全部页面'],
            ...RULE_PAGE_OPTIONS.filter((pageId) => pageId !== 'all').map((pageId) => [pageId, getPageLabel(pageId)])
        ];
        const audienceFilterOptions = getRuleAudienceFilterOptions(rules);
        const duplicateGroupRows = Array.isArray(duplicateGroups) ? duplicateGroups : getRuleDuplicateGroups(rules);
        const batchSummary = getRuleBatchSummary();
        const hasActiveFilter = Boolean(
            String(state.ruleSearchQuery || '').trim()
            || normalizeToken(state.ruleStatusFilter, 'all') !== 'all'
            || normalizeToken(state.ruleHealthFilter, 'all') !== 'all'
            || normalizeToken(state.rulePageFilter, 'all') !== 'all'
            || normalizeToken(state.ruleAudienceFilter, 'all') !== 'all'
            || state.ruleDuplicateFilter === true
            || normalizeToken(state.ruleSort, 'updated_desc') !== 'updated_desc'
        );
        const duplicateFilterPill = state.ruleDuplicateFilter === true
            ? `
                <span class="engagement-rule-toolbar__filter-pill" title="当前只显示完全重复的触达规则">
                    <i class="fas fa-clone" aria-hidden="true"></i>
                    <span>仅重复规则</span>
                </span>
            `
            : '';
        const pageInfo = pagination && typeof pagination === 'object'
            ? pagination
            : getRuleListPagination(visibleCount);
        const countLabel = visibleCount > 0
            ? `显示 ${formatNumber(pageInfo.startIndex + 1)}-${formatNumber(pageInfo.endIndex)} / ${formatNumber(visibleCount)} 条${visibleCount !== totalCount ? `（共 ${formatNumber(totalCount)}）` : ''}`
            : `0 / ${formatNumber(totalCount)} 条`;

        return `
            <div class="engagement-rule-toolbar" data-engagement-rule-toolbar>
                <label class="engagement-rule-search">
                    <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search"
                        value="${escapeHtml(state.ruleSearchQuery || '')}"
                        data-engagement-rule-search
                        placeholder="搜索规则、页面、链接或状态">
                </label>
                <div class="engagement-rule-toolbar__selects">
                    ${renderCustomSelect({
                        name: 'rule_status_filter',
                        value: state.ruleStatusFilter || 'all',
                        options: RULE_FILTER_STATUS_OPTIONS,
                        label: '状态'
                    })}
                    ${renderCustomSelect({
                        name: 'rule_health_filter',
                        value: state.ruleHealthFilter || 'all',
                        options: RULE_HEALTH_FILTER_OPTIONS,
                        label: '健康'
                    })}
                    ${renderCustomSelect({
                        name: 'rule_page_filter',
                        value: state.rulePageFilter || 'all',
                        options: pageFilterOptions,
                        label: '页面'
                    })}
                    ${renderCustomSelect({
                        name: 'rule_audience_filter',
                        value: state.ruleAudienceFilter || 'all',
                        options: audienceFilterOptions,
                        label: '用户分群'
                    })}
                    ${renderCustomSelect({
                        name: 'rule_sort',
                        value: state.ruleSort || 'updated_desc',
                        options: RULE_SORT_OPTIONS,
                        label: '排序'
                    })}
                </div>
                <div class="engagement-rule-toolbar__meta">
                    ${duplicateFilterPill}
                    <span>${escapeHtml(countLabel)}</span>
                    ${renderRulePaginationControls(pageInfo)}
                    ${hasActiveFilter ? `<button type="button" data-engagement-action="clear-rule-filters">清除筛选</button>` : ''}
                </div>
                <div class="engagement-rule-batch-actions" aria-label="当前筛选规则批量操作">
                    <span>当前筛选批量治理</span>
                    <button type="button" data-engagement-action="batch-pause-filtered-rules" ${batchSummary.running ? '' : 'disabled'}>
                        <i class="fas fa-pause" aria-hidden="true"></i>
                        <span>暂停 ${escapeHtml(formatNumber(Math.min(batchSummary.running, RULE_BATCH_LIMIT)))}</span>
                    </button>
                    <button type="button" data-engagement-action="batch-copy-filtered-rules" ${batchSummary.copyable ? '' : 'disabled'}>
                        <i class="fas fa-copy" aria-hidden="true"></i>
                        <span>复制草稿 ${escapeHtml(formatNumber(Math.min(batchSummary.copyable, RULE_BATCH_LIMIT)))}</span>
                    </button>
                    <button type="button" data-engagement-action="batch-archive-attention-rules" ${batchSummary.attention ? '' : 'disabled'}>
                        <i class="fas fa-box-archive" aria-hidden="true"></i>
                        <span>归档需关注 ${escapeHtml(formatNumber(Math.min(batchSummary.attention, RULE_BATCH_LIMIT)))}</span>
                    </button>
                </div>
                ${renderRuleDuplicateNotice(duplicateGroupRows)}
                ${state.ruleBatchResult ? renderRuleBatchResult(state.ruleBatchResult) : ''}
            </div>
        `;
    }

    function renderRules(rules = []) {
        const focusedPageId = getFocusedPageId();
        const totalRules = getRulesForFocusedPage(rules);
        const duplicateGroups = reconcileDuplicateRuleFilter(totalRules);
        const visibleRules = getManagedRules(rules);
        const visibleRows = groupDuplicateRulesForDisplay(totalRules, visibleRules);
        const pagination = getRuleListPagination(visibleRows.length);
        const duplicateMeta = getRuleDuplicateGroupMeta(totalRules);
        const rows = visibleRows.slice(pagination.startIndex, pagination.endIndex);
        const focusedPageHeader = focusedPageId
            ? `
                <div class="engagement-filter-pill">
                    <i class="fas fa-filter" aria-hidden="true"></i>
                    <span>${escapeHtml(getPageLabel(focusedPageId))}</span>
                    <button type="button" data-engagement-action="clear-page-filter" aria-label="清除页面筛选">×</button>
                </div>
            `
            : '';
        return `
            <section class="engagement-section engagement-section--split">
                <div class="engagement-section__head">
                    <div>
                        <h3>${focusedPageId ? `${escapeHtml(getPageLabel(focusedPageId))}规则` : '近期规则'}</h3>
                        <p>规则决定谁在什么页面看到什么气泡，并控制优先级、冷却和行动入口。</p>
                    </div>
                    ${focusedPageHeader}
                </div>
                ${renderRuleManagementToolbar(totalRules.length, visibleRules.length, totalRules, duplicateGroups, pagination)}
                <div class="engagement-list">
                    ${rows.length ? rows.map((rule) => {
                        const status = getRuleStatusLabel(rule);
                        const pages = Array.isArray(rule.page_ids) && rule.page_ids.length
                            ? rule.page_ids.map(getPageLabel).join(' / ')
                            : '全站';
                        const audience = getAudienceLabel(rule.audience);
                        const trigger = getTriggerTypeLabel(rule.trigger_type || 'page_view');
                        const placement = getPlacementLabel(rule.placement || 'robot_bubble');
                        const governance = getRuleGovernance(rule);
                        const health = getRuleHealth(rule);
                        const ruleMetrics = health.metrics || createRuleMetricsCounter();
                        const duplicateGroup = duplicateMeta.get(String(rule?.id || '').trim());
                        const duplicateClass = duplicateGroup ? ' is-duplicate-group' : '';
                        const duplicateAttributes = duplicateGroup
                            ? ` data-duplicate-group="${escapeHtml(duplicateGroup.groupIndex)}" style="--duplicate-group-color:${escapeHtml(duplicateGroup.color)}"`
                            : '';
                        return `
                            <article class="engagement-list-item engagement-rule-item${duplicateClass}" data-rule-health="${escapeHtml(health.tone || 'idle')}"${duplicateAttributes}>
                                <div class="engagement-rule-item__body">
                                    <div class="engagement-rule-item__main">
                                        <strong>${escapeHtml(rule.name || '未命名规则')}</strong>
                                        <p>${escapeHtml(pages)} · ${escapeHtml(audience)} · ${escapeHtml(trigger)} · ${escapeHtml(placement)} · 优先级 ${escapeHtml(rule.priority || 0)}</p>
                                    </div>
                                    <div class="engagement-rule-item__insights" aria-label="${escapeHtml(rule.name || '未命名规则')}近24小时表现">
                                        <span><strong>${escapeHtml(formatNumber(ruleMetrics.views))}</strong> 曝光</span>
                                        <span><strong>${escapeHtml(formatPercent(ruleMetrics.ctr))}</strong> CTR</span>
                                        <span><strong>${escapeHtml(formatPercent(ruleMetrics.dismiss_rate))}</strong> 关闭率</span>
                                    </div>
                                    <div class="engagement-rule-health" data-health="${escapeHtml(health.tone || 'idle')}">
                                        <i class="fas ${escapeHtml(health.icon || 'fa-circle-info')}" aria-hidden="true"></i>
                                        <span>${escapeHtml(health.label || '待观察')}</span>
                                        <em>${escapeHtml(health.detail || '暂无健康提示。')}</em>
                                    </div>
                                </div>
                                <div class="engagement-rule-actions">
                                    <span class="engagement-risk-badge" data-risk="${escapeHtml(governance.risk_level)}">${escapeHtml(getRiskLabel(governance.risk_level))}</span>
                                    <span class="${rule.enabled ? 'is-on' : ''}">${escapeHtml(status)}</span>
                                    <button type="button" title="编辑" data-engagement-action="edit-rule" data-rule-id="${escapeHtml(rule.id || '')}">
                                        <i class="fas fa-pen"></i>
                                    </button>
                                    <button type="button" title="${rule.enabled ? '暂停' : '发布'}" data-engagement-action="toggle-rule" data-rule-id="${escapeHtml(rule.id || '')}" data-rule-enabled="${rule.enabled ? 'false' : 'true'}">
                                        <i class="fas ${rule.enabled ? 'fa-pause' : 'fa-play'}"></i>
                                    </button>
                                    <button type="button" title="复制为草稿" data-engagement-action="copy-rule" data-rule-id="${escapeHtml(rule.id || '')}">
                                        <i class="fas fa-copy"></i>
                                    </button>
                                    <button type="button" title="归档" data-engagement-action="archive-rule" data-rule-id="${escapeHtml(rule.id || '')}">
                                        <i class="fas fa-box-archive"></i>
                                    </button>
                                    <button type="button" title="删除" data-engagement-action="delete-rule" data-rule-id="${escapeHtml(rule.id || '')}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </article>
                        `;
                    }).join('') : `
                        <div class="engagement-empty">${focusedPageId ? `${escapeHtml(getPageLabel(focusedPageId))} 暂无匹配规则，左侧编辑器已预选该页面，可以直接创建。` : '暂无匹配规则。可以调整搜索、状态、页面筛选或新建触达规则。'}</div>
                    `}
                </div>
            </section>
        `;
    }

    function renderCapabilityMap() {
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>商业触达能力</h3>
                        <p>把系统事件、运营规则和用户状态统一汇入机器人气泡，减少打断感，同时保留完整追踪。</p>
                    </div>
                </div>
                <div class="engagement-capability-grid">
                    ${CAPABILITY_GROUPS.map((capability) => {
                        const isFocused = capability.id === state.focusedCapabilityId;
                        return `
                        <article class="engagement-capability-card ${isFocused ? 'is-focused' : ''}"
                            role="button"
                            tabindex="0"
                            data-engagement-action="focus-capability"
                            data-engagement-capability-card
                            data-capability-id="${escapeHtml(capability.id)}"
                            aria-label="查看${escapeHtml(capability.title)}触达模板">
                            <div class="engagement-capability-card__head">
                                <span class="engagement-capability-card__icon">
                                    <i class="fas ${escapeHtml(capability.icon)}" aria-hidden="true"></i>
                                </span>
                                <strong>${escapeHtml(capability.title)}</strong>
                            </div>
                            <p>${escapeHtml(capability.desc)}</p>
                            <div class="engagement-chip-row engagement-capability-card__events">
                                ${capability.events.slice(0, 3).map((eventKey) => `<span>${escapeHtml(getEventLabel(eventKey))}</span>`).join('')}
                            </div>
                            <span class="engagement-capability-card__action">查看模板 <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
                        </article>
                    `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function renderUserTagCenter() {
        const center = getUserTagCenter();
        const tag = getEditableUserTag();
        const tagKey = normalizeUserTagKey(tag?.key || tag?.id || '', '');
        const automation = center.automation || {};
        return `
            <section class="engagement-section engagement-tag-center">
                <div class="engagement-section__head">
                    <div>
                        <h3>用户标签中心</h3>
                        <p>定义用户标签从哪里来、代表什么、什么时候自动写入。分群可以直接引用这些标签来命中用户。</p>
                    </div>
                    ${tagKey ? `<button type="button" class="engagement-link-btn" data-engagement-action="reset-user-tag">新建标签</button>` : ''}
                </div>
                <div class="engagement-tag-center__grid">
                    <form id="engagementUserTagForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                        <input type="hidden" name="id" value="${escapeHtml(tagKey)}">
                        <div class="engagement-form-grid engagement-workspace-view--segments-tags">
                            <label class="engagement-field">
                                <span>标签 key</span>
                                <input name="key" type="text" maxlength="80" value="${escapeHtml(tag?.key || '')}" placeholder="paid_user" required>
                            </label>
                            <label class="engagement-field">
                                <span>标签名称</span>
                                <input name="name" type="text" maxlength="120" value="${escapeHtml(tag?.name || '')}" placeholder="已充值用户" required>
                            </label>
                            <label class="engagement-field">
                                <span>标签来源</span>
                                ${renderCustomSelect({
                                    name: 'source',
                                    value: tag?.source || 'manual',
                                    options: USER_TAG_SOURCE_OPTIONS,
                                    label: '标签来源'
                                })}
                            </label>
                            <div class="engagement-form-block engagement-form-block--switch">
                                <span>启用状态</span>
                                ${renderCustomSwitch({
                                    name: 'enabled',
                                    checked: tag?.enabled !== false,
                                    label: '允许分群和规则使用'
                                })}
                            </div>
                            <label class="engagement-field engagement-form-field--full">
                                <span>标签说明</span>
                                <input name="description" type="text" maxlength="500" value="${escapeHtml(tag?.description || '')}" placeholder="说明这个标签代表什么用户">
                            </label>
                            <label class="engagement-field engagement-form-field--full">
                                <span>自动打标口径</span>
                                <textarea name="auto_rule" rows="3" maxlength="800" placeholder="例如：支付成功后写入 paid_user，退款后移除">${escapeHtml(tag?.auto_rule || '')}</textarea>
                            </label>
                        </div>
                        <div class="engagement-form-actions">
                            <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-user-tag">
                                <i class="fas fa-save"></i>
                                <span>${tagKey ? '保存标签' : '创建标签'}</span>
                            </button>
                        </div>
                    </form>
                    <div class="engagement-tag-list" aria-label="用户标签列表">
                        ${center.tags.length ? center.tags.map((item) => {
                            const key = normalizeUserTagKey(item.key || item.id, '');
                            return `
                                <article class="engagement-tag-card ${tagKey === key ? 'is-focused' : ''}">
                                    <div>
                                        <strong>${escapeHtml(item.name || key || '用户标签')}</strong>
                                        <p>${escapeHtml(item.description || item.auto_rule || '暂无说明')}</p>
                                        <div class="engagement-chip-row">
                                            <span>${escapeHtml(item.key || key)}</span>
                                            <span>${escapeHtml(getOptionLabel(USER_TAG_SOURCE_OPTIONS, item.source || 'manual'))}</span>
                                            <span>${item.enabled === false ? '停用' : '启用'}</span>
                                        </div>
                                    </div>
                                    <div class="engagement-inline-actions">
                                        <button type="button" title="编辑标签" data-engagement-action="edit-user-tag" data-tag-key="${escapeHtml(key)}">
                                            <i class="fas fa-pen"></i>
                                        </button>
                                        <button type="button" title="删除标签" data-engagement-action="delete-user-tag" data-tag-key="${escapeHtml(key)}">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </article>
                            `;
                        }).join('') : `<div class="engagement-empty">暂无用户标签。</div>`}
                    </div>
                </div>
                <form id="engagementTagAutomationForm" class="engagement-tag-automation" autocomplete="off" novalidate>
                    <div class="engagement-tag-automation__head">
                        <div>
                            <h4>自动分群阈值</h4>
                            <p>这些阈值会影响后端自动写入的用户标签，规则分群引用标签后即可自动命中。</p>
                        </div>
                        <div class="engagement-tag-automation__actions">
                            <button type="button" class="engagement-link-btn" data-engagement-action="run-inactive-sweep">
                                <i class="fas fa-rotate"></i>
                                <span>扫描未活跃用户</span>
                            </button>
                            <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-tag-automation">
                                <i class="fas fa-save"></i>
                                <span>保存阈值</span>
                            </button>
                        </div>
                    </div>
                    <div class="engagement-tag-automation__grid">
                        <article class="engagement-tag-rule-card">
                            <div class="engagement-tag-rule-card__title">
                                <strong>高价值用户</strong>
                                ${renderCustomSwitch({
                                    name: 'high_value_enabled',
                                    checked: automation.high_value?.enabled !== false,
                                    label: '自动写入 high_value'
                                })}
                            </div>
                            <div class="engagement-tag-rule-card__fields">
                                <label class="engagement-field">
                                    <span>累计消费金额</span>
                                    <input name="high_value_min_paid_amount" type="number" min="0" step="1" value="${escapeHtml(automation.high_value?.min_paid_amount ?? 500)}">
                                </label>
                                <label class="engagement-field">
                                    <span>累计充值积分</span>
                                    <input name="high_value_min_points" type="number" min="0" step="1" value="${escapeHtml(automation.high_value?.min_points ?? 5000)}">
                                </label>
                                <label class="engagement-field">
                                    <span>订单次数</span>
                                    <input name="high_value_min_order_count" type="number" min="0" step="1" value="${escapeHtml(automation.high_value?.min_order_count ?? 5)}">
                                </label>
                            </div>
                        </article>
                        <article class="engagement-tag-rule-card">
                            <div class="engagement-tag-rule-card__title">
                                <strong>支付失败用户</strong>
                                ${renderCustomSwitch({
                                    name: 'payment_failed_enabled',
                                    checked: automation.payment_failed?.enabled !== false,
                                    label: '自动写入 payment_failed'
                                })}
                            </div>
                            <div class="engagement-tag-rule-card__fields">
                                <label class="engagement-field">
                                    <span>观察天数</span>
                                    <input name="payment_failed_window_days" type="number" min="1" step="1" value="${escapeHtml(automation.payment_failed?.window_days ?? 7)}">
                                </label>
                                <label class="engagement-field">
                                    <span>失败次数</span>
                                    <input name="payment_failed_min_count" type="number" min="1" step="1" value="${escapeHtml(automation.payment_failed?.min_count ?? 1)}">
                                </label>
                            </div>
                        </article>
                        <article class="engagement-tag-rule-card">
                            <div class="engagement-tag-rule-card__title">
                                <strong>验证失败用户</strong>
                                ${renderCustomSwitch({
                                    name: 'verify_failed_enabled',
                                    checked: automation.verify_failed?.enabled !== false,
                                    label: '自动写入 verify_failed'
                                })}
                            </div>
                            <div class="engagement-tag-rule-card__fields">
                                <label class="engagement-field">
                                    <span>观察天数</span>
                                    <input name="verify_failed_window_days" type="number" min="1" step="1" value="${escapeHtml(automation.verify_failed?.window_days ?? 7)}">
                                </label>
                                <label class="engagement-field">
                                    <span>失败次数</span>
                                    <input name="verify_failed_min_count" type="number" min="1" step="1" value="${escapeHtml(automation.verify_failed?.min_count ?? 1)}">
                                </label>
                            </div>
                        </article>
                        <article class="engagement-tag-rule-card">
                            <div class="engagement-tag-rule-card__title">
                                <strong>长期未活跃</strong>
                                ${renderCustomSwitch({
                                    name: 'inactive_enabled',
                                    checked: automation.inactive?.enabled === true,
                                    label: '启用 inactive_user 预留规则'
                                })}
                            </div>
                            <div class="engagement-tag-rule-card__fields">
                                <label class="engagement-field">
                                    <span>未活跃天数</span>
                                    <input name="inactive_days" type="number" min="1" step="1" value="${escapeHtml(automation.inactive?.inactive_days ?? 30)}">
                                </label>
                            </div>
                        </article>
                    </div>
                </form>
            </section>
        `;
    }

    function renderSegmentComposer() {
        const segment = getEditableSegment();
        const selectedPages = new Set(Array.isArray(segment?.pageIds) && segment.pageIds.length ? segment.pageIds : ['all']);
        const selectedScenarios = Array.isArray(segment?.examples) ? segment.examples : [];
        const selectedTags = Array.isArray(segment?.tags) ? segment.tags : [];
        const emailTargetsText = Array.isArray(segment?.emails) ? segment.emails.join('\n') : '';
        const segmentId = segment?.source === 'managed' ? (segment.dbId || '') : '';
        return `
            <section class="engagement-section engagement-management-composer engagement-segment-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>${segmentId ? '编辑用户分群' : '新建用户分群'}</h3>
                        <p>分群决定规则命中的用户范围，可按登录状态、指定邮箱和用户标签命中，再逐步接入消费与行为信号。</p>
                    </div>
                    ${segmentId ? `<button type="button" class="engagement-link-btn" data-engagement-action="reset-segment">新建分群</button>` : ''}
                </div>
                <form id="engagementSegmentForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    <input type="hidden" name="id" value="${escapeHtml(segmentId)}">
                    <input type="hidden" name="key" value="${escapeHtml(segment?.key || segment?.id || '')}">
                    <input type="hidden" name="scope" value="${escapeHtml(segment?.id || segment?.key || '')}">
                    <input type="hidden" name="icon" value="${escapeHtml(segment?.icon || 'fa-users')}">
                    <div class="engagement-form-grid engagement-management-grid">
                        <label class="engagement-field engagement-field--name engagement-form-field--full">
                            <span>分群名称</span>
                            <input name="name" type="text" maxlength="160" value="${escapeHtml(segment?.title || '')}" placeholder="例如：有失败支付记录用户" required>
                        </label>
                    </div>
                    <div class="engagement-form-block">
                        <span>常用页面</span>
                        ${renderPagePicker(selectedPages)}
                    </div>
                    <div class="engagement-form-grid engagement-form-grid--wide engagement-management-grid--wide">
                        <label class="engagement-field engagement-form-field--full">
                            <span>分群说明</span>
                            <input name="description" type="text" maxlength="800" value="${escapeHtml(segment?.desc || '')}" placeholder="给管理员看的分群定义说明">
                        </label>
                        <label class="engagement-field engagement-form-field--full">
                            <span>指定用户邮箱（一行一个，可选）</span>
                            <textarea name="email_targets" rows="3" maxlength="1600" placeholder="user@example.com">${escapeHtml(emailTargetsText)}</textarea>
                        </label>
                        <div class="engagement-form-block engagement-form-field--full">
                            <div class="engagement-form-block__head">
                                <span>选择用户标签 Tags</span>
                                <button type="button" class="engagement-link-btn" data-engagement-action="sync-segment-tags">
                                    <i class="fas fa-rotate" aria-hidden="true"></i>
                                    <span>同步用户管理标签</span>
                                </button>
                            </div>
                            ${renderSegmentTagPicker(selectedTags)}
                        </div>
                        <div class="engagement-form-block engagement-form-field--full">
                            <span>触达场景</span>
                            ${renderSegmentScenarioPicker(selectedScenarios)}
                        </div>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>启用状态</span>
                            ${renderCustomSwitch({
                                name: 'enabled',
                                checked: segment?.enabled !== false,
                                label: '允许规则选择此分群'
                            })}
                        </div>
                    </div>
                    <div class="engagement-form-actions">
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-segment">
                            <i class="fas fa-save"></i>
                            <span>${segmentId ? '保存分群' : '创建分群'}</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderAudienceSegments(segments = getAudienceSegments()) {
        const rows = Array.isArray(segments) && segments.length ? segments : getAudienceSegments();
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>用户分群</h3>
                        <p>按用户状态决定谁能看到气泡。全部、游客、登录用户、指定邮箱和用户标签已接入前台命中。</p>
                    </div>
                </div>
                <div class="engagement-segment-grid">
                    ${rows.map((segment) => {
                        const segmentScope = normalizeToken(segment.id || segment.key, 'all');
                        const dbId = String(segment.dbId || '').trim();
                        const emailCount = Array.isArray(segment.emails) ? segment.emails.length : 0;
                        const tagCount = Array.isArray(segment.tags) ? segment.tags.length : 0;
                        return `
                        <article class="engagement-segment-card"
                            role="button"
                            tabindex="0"
                            data-engagement-action="focus-audience"
                            data-engagement-audience-card
                            data-audience-scope="${escapeHtml(segmentScope)}"
                            aria-label="为${escapeHtml(segment.title)}创建触达规则">
                            <div class="engagement-segment-card__head">
                                <span class="engagement-segment-card__icon">
                                    <i class="fas ${escapeHtml(segment.icon)}" aria-hidden="true"></i>
                                </span>
                                <div>
                                    <strong>${escapeHtml(segment.title)}</strong>
                                    <p>${escapeHtml(segment.desc)}</p>
                                </div>
                            </div>
                            <div class="engagement-chip-row">
                                ${(Array.isArray(segment.examples) ? segment.examples : []).map((example) => `<span>${escapeHtml(getSegmentScenarioLabel(example))}</span>`).join('')}
                                ${emailCount ? `<span>${escapeHtml(emailCount)} 邮箱</span>` : ''}
                                ${tagCount ? `<span>${escapeHtml(tagCount)} 标签</span>` : ''}
                            </div>
                            <div class="engagement-card-action-row">
                                <span class="engagement-segment-card__action">创建规则 <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
                                <span class="engagement-inline-actions">
                                    <button type="button" title="编辑分群" data-engagement-action="edit-segment" data-segment-id="${escapeHtml(dbId || segmentScope)}">
                                        <i class="fas fa-pen"></i>
                                    </button>
                                    ${dbId ? `
                                        <button type="button" title="删除分群" data-engagement-action="delete-segment" data-segment-id="${escapeHtml(dbId)}">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    ` : ''}
                                </span>
                            </div>
                        </article>
                    `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function getAutomationFlowRows() {
        return AUTOMATION_BLUEPRINTS.map((blueprint) => {
            const status = getAutomationBlueprintStatus(blueprint.id);
            const health = status.health || {};
            const running = Number(status.running || 0) || 0;
            const drafts = Number(status.drafts || 0) || 0;
            const total = Number(status.total || 0) || 0;
            const stateLabel = running > 0
                ? `${formatNumber(running)} 运行中`
                : (drafts > 0 ? `${formatNumber(drafts)} 草稿` : (total > 0 ? '已停用' : '未接入'));
            return {
                blueprint,
                status,
                health,
                stateLabel,
                triggerLabel: `${blueprint.mode || '自动化'} · ${getTriggerTypeLabel(blueprint.triggerType)}`,
                audienceLabel: getAudienceLabel({ scope: blueprint.audienceScope }),
                pageLabel: (Array.isArray(blueprint.pageIds) ? blueprint.pageIds : ['all'])
                    .map((pageId) => getPageLabel(pageId))
                    .join(' / ')
            };
        });
    }

    function getAutomationFlowSummary() {
        const rows = getAutomationFlowRows();
        const automationRules = rows.flatMap((row) => row.status.rules || []);
        const running = rows.reduce((total, row) => total + (Number(row.status.running || 0) || 0), 0);
        const drafts = rows.reduce((total, row) => total + (Number(row.status.drafts || 0) || 0), 0);
        const createdBlueprints = rows.filter((row) => Number(row.status.total || 0) > 0).length;
        const eventBlueprints = rows.filter((row) => normalizeToken(row.blueprint.triggerType, 'page_view') !== 'page_view').length;
        const attention = rows.filter((row) => ['danger', 'warning', 'attention'].includes(normalizeToken(row.health.tone, 'idle'))).length;
        return {
            totalBlueprints: rows.length,
            createdBlueprints,
            missingBlueprints: Math.max(0, rows.length - createdBlueprints),
            automationRules,
            running,
            drafts,
            eventBlueprints,
            attention,
            rows
        };
    }

    function renderAutomationCommandCenter() {
        const summary = getAutomationFlowSummary();
        const metrics = [
            ['created', '蓝图接入', `${formatNumber(summary.createdBlueprints)}/${formatNumber(summary.totalBlueprints)}`, '已经生成规则的自动化蓝图'],
            ['running', '运行规则', summary.running, '当前会被机器人读取的自动化规则'],
            ['drafts', '待发布草稿', summary.drafts, '可批量发布或继续编辑'],
            ['attention', '需关注流程', summary.attention, '无曝光、高关闭率或高风险流程']
        ];
        return `
            <section class="engagement-section engagement-automation-command">
                <div class="engagement-section__head">
                    <div>
                        <h3>自动化流程总控</h3>
                        <p>统一查看自动化接入、运行状态、草稿沉淀和异常流程，并支持批量推进。</p>
                    </div>
                </div>
                <div class="engagement-automation-command__metrics">
                    ${metrics.map(([key, label, value, note]) => `
                        <article data-metric="${escapeHtml(key)}">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(String(value))}</strong>
                            <p>${escapeHtml(note)}</p>
                        </article>
                    `).join('')}
                </div>
                <div class="engagement-automation-command__actions" aria-label="自动化批量操作">
                    <button type="button" data-engagement-action="create-missing-automation-rules" ${summary.missingBlueprints > 0 ? '' : 'disabled'}>
                        <i class="fas fa-layer-group" aria-hidden="true"></i>
                        <span>创建缺失蓝图 ${escapeHtml(formatNumber(summary.missingBlueprints))}</span>
                    </button>
                    <button type="button" data-engagement-action="publish-automation-drafts" ${summary.drafts > 0 ? '' : 'disabled'}>
                        <i class="fas fa-play" aria-hidden="true"></i>
                        <span>发布草稿 ${escapeHtml(formatNumber(summary.drafts))}</span>
                    </button>
                    <button type="button" data-engagement-action="pause-running-automation-rules" ${summary.running > 0 ? '' : 'disabled'}>
                        <i class="fas fa-pause" aria-hidden="true"></i>
                        <span>暂停运行 ${escapeHtml(formatNumber(summary.running))}</span>
                    </button>
                    <button type="button" data-engagement-action="focus-rule-health-filter" data-rule-health-filter="no_views" ${summary.attention > 0 ? '' : 'disabled'}>
                        <i class="fas fa-stethoscope" aria-hidden="true"></i>
                        <span>排查异常流程</span>
                    </button>
                </div>
            </section>
        `;
    }

    function renderAutomationIntentNotice() {
        const groups = getAutomationIntentGroups();
        if (!groups.length) return '';
        return `
            <div class="engagement-rule-duplicate-notice engagement-automation-intent-notice" aria-label="自动化蓝图同义提醒">
                <i class="fas fa-layer-group" aria-hidden="true"></i>
                <div>
                    <strong>发现 ${formatNumber(groups.length)} 组“同一意图、不同触发”的自动化</strong>
                    <p>${escapeHtml(groups.map((group) => `${group.label}（${group.blueprints.map((blueprint) => blueprint.title).join(' / ')}）`).join('；'))}</p>
                </div>
            </div>
        `;
    }

    function renderAutomationBlueprintCard(blueprint = {}) {
        const status = getAutomationBlueprintStatus(blueprint.id);
        const health = status.health || {};
        const hasCreatedRule = status.total > 0;
        const intentGroup = getAutomationIntentGroupForBlueprint(blueprint);
        const preview = buildAutomationBlueprintPreview(blueprint);
        const primaryRuleId = String(status.primaryRule?.id || '').trim();
        const primaryRuleEnabled = status.primaryRule?.enabled === true && normalizeToken(status.primaryRule?.status, '') === 'published';
        const statusText = hasCreatedRule
            ? `已创建 ${formatNumber(status.total)} 条`
            : '未创建';
        const activeText = status.running > 0
            ? `${formatNumber(status.running)} 运行中`
            : `${formatNumber(status.drafts)} 草稿`;
        return `
            <article class="engagement-automation-card${hasCreatedRule ? ' is-created' : ''}"
                role="button"
                tabindex="0"
                data-engagement-action="focus-automation"
                data-engagement-automation-card
                data-automation-id="${escapeHtml(blueprint.id)}"
                data-created-count="${escapeHtml(status.total)}"
                data-health="${escapeHtml(health.tone || 'idle')}"
                aria-label="${hasCreatedRule ? '打开' : '创建'}${escapeHtml(blueprint.title)}自动化规则">
                <div class="engagement-automation-card__head">
                    <span class="engagement-automation-card__icon">
                        <i class="fas ${escapeHtml(blueprint.icon)}" aria-hidden="true"></i>
                    </span>
                    <div>
                        <strong>${escapeHtml(blueprint.title)}</strong>
                        <p>${escapeHtml(blueprint.desc)}</p>
                        ${intentGroup ? `
                            <div class="engagement-automation-card__intent" aria-label="${escapeHtml(blueprint.title)}意图说明">
                                <span>同一意图</span>
                                <strong>${escapeHtml(getAutomationBlueprintIntentLabel(blueprint))}</strong>
                                <em>${escapeHtml(blueprint.mode || '自动化')}</em>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="engagement-chip-row">
                    <span>${escapeHtml(blueprint.mode)}</span>
                    <span>${escapeHtml(getTriggerTypeLabel(blueprint.triggerType))}</span>
                    <span>${escapeHtml(getAudienceLabel({ scope: blueprint.audienceScope }))}</span>
                </div>
                <div class="engagement-automation-card__preview" aria-label="${escapeHtml(blueprint.title)}样本文案预览">
                    <strong>${escapeHtml(preview.title || blueprint.titleText || blueprint.title)}</strong>
                    <p>${escapeHtml(preview.content || blueprint.content || '')}</p>
                    <div class="engagement-chip-row">
                        ${preview.sampleLabel ? `<span>${escapeHtml(preview.sampleLabel)}</span>` : '<span>默认样本</span>'}
                        ${preview.hasDynamicSamples ? `
                            <button type="button"
                                data-engagement-action="cycle-automation-preview-sample"
                                data-automation-id="${escapeHtml(blueprint.id)}"
                                title="切换事件样本">
                                <i class="fas fa-repeat" aria-hidden="true"></i>
                                <span>切换样本</span>
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="engagement-automation-card__status" aria-label="${escapeHtml(blueprint.title)}规则状态">
                    <span>${escapeHtml(statusText)}</span>
                    <span>${escapeHtml(activeText)}</span>
                </div>
                <div class="engagement-automation-card__metrics" aria-label="${escapeHtml(blueprint.title)}近24小时数据">
                    <span><strong>${escapeHtml(formatNumber(status.metrics.views))}</strong> 曝光</span>
                    <span><strong>${escapeHtml(formatNumber(status.metrics.clicks))}</strong> 点击</span>
                    <span><strong>${escapeHtml(formatNumber(status.metrics.dismisses))}</strong> 关闭</span>
                </div>
                <div class="engagement-automation-card__health" data-health="${escapeHtml(health.tone || 'idle')}" aria-label="${escapeHtml(blueprint.title)}健康状态">
                    <i class="fas ${escapeHtml(health.icon || 'fa-circle-info')}" aria-hidden="true"></i>
                    <div>
                        <strong>${escapeHtml(health.label || '待配置')}</strong>
                        <p>${escapeHtml(health.detail || '创建规则后开始观察曝光和点击。')}</p>
                    </div>
                </div>
                <div class="engagement-automation-card__actions">
                    <span class="engagement-automation-card__action">预览草稿 <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
                    ${hasCreatedRule ? `
                        <span class="engagement-automation-card__quickops" aria-label="${escapeHtml(blueprint.title)}快捷操作">
                            <button type="button" title="${primaryRuleEnabled ? '暂停规则' : '发布规则'}" data-engagement-action="toggle-automation-rule" data-automation-id="${escapeHtml(blueprint.id)}" data-rule-id="${escapeHtml(primaryRuleId)}" data-rule-enabled="${primaryRuleEnabled ? 'false' : 'true'}">
                                <i class="fas ${primaryRuleEnabled ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i>
                            </button>
                            <button type="button" title="复制为草稿" data-engagement-action="copy-automation-rule" data-automation-id="${escapeHtml(blueprint.id)}" data-rule-id="${escapeHtml(primaryRuleId)}">
                                <i class="fas fa-copy" aria-hidden="true"></i>
                            </button>
                        </span>
                    ` : ''}
                    <button type="button" class="engagement-automation-card__create" data-engagement-action="create-automation-rule" data-automation-id="${escapeHtml(blueprint.id)}">
                        <i class="fas ${hasCreatedRule ? 'fa-pen' : 'fa-plus'}" aria-hidden="true"></i>
                        <span>${hasCreatedRule ? '编辑规则' : '创建规则'}</span>
                    </button>
                </div>
            </article>
        `;
    }

    function renderAutomationFlowMatrix() {
        const rows = getAutomationFlowRows();
        return `
            <section class="engagement-section engagement-automation-flow">
                <div class="engagement-section__head">
                    <div>
                        <h3>流程编排视图</h3>
                        <p>把触发事件、命中用户、目标页面、规则状态和健康信号放在同一张运营表里。</p>
                    </div>
                </div>
                <div class="engagement-automation-flow__grid">
                    ${rows.map(({ blueprint, status, health, stateLabel, triggerLabel, audienceLabel, pageLabel }) => `
                        <article class="engagement-automation-flow__row" data-health="${escapeHtml(health.tone || 'idle')}">
                            <div class="engagement-automation-flow__title">
                                <span><i class="fas ${escapeHtml(blueprint.icon)}" aria-hidden="true"></i></span>
                                <div>
                                    <strong>${escapeHtml(blueprint.title)}</strong>
                                    <p>${escapeHtml(blueprint.desc)}</p>
                                </div>
                            </div>
                            <span>${escapeHtml(triggerLabel)}</span>
                            <span>${escapeHtml(audienceLabel)}</span>
                            <span>${escapeHtml(pageLabel)}</span>
                            <span>${escapeHtml(stateLabel)}</span>
                            <span class="engagement-automation-flow__health">
                                <i class="fas ${escapeHtml(health.icon || 'fa-circle-info')}" aria-hidden="true"></i>
                                ${escapeHtml(health.label || '待配置')}
                            </span>
                            <button type="button" data-engagement-action="${status.total > 0 ? 'focus-automation-rule' : 'create-automation-rule'}" data-automation-id="${escapeHtml(blueprint.id)}">
                                <i class="fas ${status.total > 0 ? 'fa-pen' : 'fa-plus'}" aria-hidden="true"></i>
                                <span>${status.total > 0 ? '打开规则' : '创建'}</span>
                            </button>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderAutomationBlueprints() {
        const displayGroups = getAutomationBlueprintDisplayGroups();
        const intentGroups = displayGroups.filter((group) => group.type === 'intent_group');
        const singleBlueprints = displayGroups
            .filter((group) => group.type === 'single')
            .map((group) => group.blueprints[0])
            .filter(Boolean);
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>自动化流程蓝图</h3>
                        <p>先按“意图”浏览，再进入具体触发蓝图。这里不再折叠节点，避免来回展开影响判断。</p>
                    </div>
                </div>
                ${renderAutomationIntentNotice()}
                <div class="engagement-automation-blueprint-sections">
                    ${intentGroups.length ? `
                        <section class="engagement-automation-blueprint-section">
                            <header class="engagement-automation-blueprint-section__head">
                                <strong>同意图蓝图</strong>
                                <span>${escapeHtml(formatNumber(intentGroups.length))} 组</span>
                            </header>
                            <div class="engagement-automation-grid">
                    ${intentGroups.map((group) => {
                        const leadBlueprint = group.blueprints[0] || {};
                        const triggerSummary = group.blueprints.map((blueprint) => blueprint.mode).filter(Boolean).join(' / ');
                        return `
                            <section class="engagement-automation-intent-group"
                                data-automation-intent-group="${escapeHtml(normalizeToken(group.familyId, ''))}"
                                data-automation-intent-family="${escapeHtml(normalizeToken(group.familyId, ''))}">
                                <div class="engagement-automation-intent-group__summary" aria-label="${escapeHtml(group.label)}蓝图组">
                                    <span class="engagement-automation-intent-group__icon">
                                        <i class="fas ${escapeHtml(leadBlueprint.icon || 'fa-layer-group')}" aria-hidden="true"></i>
                                    </span>
                                    <span class="engagement-automation-intent-group__copy">
                                        <strong>${escapeHtml(group.label)}</strong>
                                        <span>${escapeHtml(formatNumber(group.blueprints.length))} 条蓝图 · ${escapeHtml(triggerSummary || '多触发')}</span>
                                    </span>
                                    <span class="engagement-automation-intent-group__note">统一意图，不重复折叠</span>
                                </div>
                                <div class="engagement-automation-intent-group__cards">
                                    ${group.blueprints.map((blueprint) => renderAutomationBlueprintCard(blueprint)).join('')}
                                </div>
                            </section>
                        `;
                    }).join('')}
                            </div>
                        </section>
                    ` : ''}
                    ${singleBlueprints.length ? `
                        <section class="engagement-automation-blueprint-section">
                            <header class="engagement-automation-blueprint-section__head">
                                <strong>独立蓝图</strong>
                                <span>${escapeHtml(formatNumber(singleBlueprints.length))} 条</span>
                            </header>
                            <div class="engagement-automation-grid">
                                ${singleBlueprints.map((blueprint) => renderAutomationBlueprintCard(blueprint)).join('')}
                            </div>
                        </section>
                    ` : ''}
                </div>
            </section>
        `;
    }

    function renderAnalyticsFunnel(analytics = {}) {
        const funnel = analytics.funnel || {};
        const items = [
            ['views', '曝光', funnel.views, '基准量'],
            ['clicks', '点击', funnel.clicks, `CTR ${formatPercent(funnel.ctr)}`],
            ['dismisses', '关闭', funnel.dismisses, `关闭率 ${formatPercent(funnel.dismiss_rate)}`],
            ['conversions', '转化', funnel.conversions, `转化率 ${formatPercent(funnel.conversion_rate)}`]
        ];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>触达漏斗</h3>
                        <p>基于近 24 小时机器人气泡事件，观察曝光、点击、关闭和转化的关系。</p>
                    </div>
                </div>
                <div class="engagement-funnel-grid">
                    ${items.map(([key, label, value, note]) => `
                        <article class="engagement-funnel-card engagement-funnel-card--${escapeHtml(key)}">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(formatNumber(value))}</strong>
                            <p>${escapeHtml(note)}</p>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderAttributionSummary(analytics = {}) {
        const attribution = analytics.attribution || {};
        const items = [
            ['attributed', '归因转化', attribution.attributed_conversions, `曝光后转化率 ${formatPercent(attribution.view_to_conversion_rate)}`],
            ['click_assisted', '点击辅助转化', attribution.click_assisted_conversions, `点击后转化率 ${formatPercent(attribution.click_to_conversion_rate)}`],
            ['unattributed', '未归因转化', attribution.unattributed_conversions, '未找到同用户同规则的前序曝光'],
            ['total', '总转化事件', attribution.conversions, '近 24 小时 conversion 回传']
        ];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>转化归因</h3>
                        <p>按 reader/user 与规则/通知串联曝光、点击和转化，识别哪些触达真正推动了后续行为。</p>
                    </div>
                </div>
                <div class="engagement-attribution-grid">
                    ${items.map(([key, label, value, note]) => `
                        <article class="engagement-attribution-card engagement-attribution-card--${escapeHtml(key)}">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(formatNumber(value))}</strong>
                            <p>${escapeHtml(note)}</p>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function getAnalyticsInsightRows(analytics = {}) {
        const funnel = analytics.funnel || {};
        const attribution = analytics.attribution || {};
        const pages = Array.isArray(analytics.page_breakdown) ? analytics.page_breakdown : [];
        const rules = Array.isArray(analytics.rule_breakdown) ? analytics.rule_breakdown : [];
        const actions = Array.isArray(analytics.action_breakdown) ? analytics.action_breakdown : [];
        const insights = [];
        const views = Number(funnel.views || 0) || 0;
        const ctr = Number(funnel.ctr || 0) || 0;
        const dismissRate = Number(funnel.dismiss_rate || 0) || 0;
        const conversionRate = Number(funnel.conversion_rate || 0) || 0;

        if (views <= 0) {
            insights.push({
                tone: 'warning',
                icon: 'fa-eye-slash',
                title: '暂无曝光回流',
                detail: '运行中的规则没有产生曝光，优先检查页面、分群、触发条件和前台机器人运行时。',
                action: '查看无曝光规则',
                actionType: 'health',
                actionValue: 'no_views'
            });
        } else if (ctr < 1 && views >= 20) {
            insights.push({
                tone: 'warning',
                icon: 'fa-chart-line',
                title: '整体点击率偏低',
                detail: `近 24 小时 CTR ${formatPercent(ctr)}，建议检查按钮文案、权益表达和跳转路径。`,
                action: '筛选低 CTR',
                actionType: 'health',
                actionValue: 'low_ctr'
            });
        } else {
            insights.push({
                tone: 'good',
                icon: 'fa-circle-check',
                title: '漏斗运行稳定',
                detail: `当前 CTR ${formatPercent(ctr)}，转化率 ${formatPercent(conversionRate)}，继续观察页面和来源差异。`
            });
        }

        if (dismissRate >= 60) {
            insights.push({
                tone: 'warning',
                icon: 'fa-circle-xmark',
                title: '关闭率偏高',
                detail: `关闭率 ${formatPercent(dismissRate)}，说明部分气泡打扰感较强，可降低优先级或改成提示卡片。`,
                action: '筛选高关闭率',
                actionType: 'health',
                actionValue: 'high_dismiss'
            });
        }

        const unattributed = Number(attribution.unattributed_conversions || 0) || 0;
        if (unattributed > 0) {
            insights.push({
                tone: 'attention',
                icon: 'fa-route',
                title: '存在未归因转化',
                detail: `${formatNumber(unattributed)} 次转化没有找到前序曝光，建议业务侧 conversion 事件带上 rule_id、notification_id 或 source_event_id。`
            });
        }

        const bestPage = pages
            .filter((row) => Number(row.views || 0) >= 5)
            .sort((first, second) => (Number(second.ctr || 0) - Number(first.ctr || 0)) || (Number(second.conversions || 0) - Number(first.conversions || 0)))[0];
        if (bestPage) {
            insights.push({
                tone: 'info',
                icon: 'fa-file-lines',
                title: `${getPageLabel(bestPage.page_id)} 页面表现最好`,
                detail: `${formatNumber(bestPage.views)} 曝光，CTR ${formatPercent(bestPage.ctr)}，可复用该页面的语气和 CTA 配置。`,
                action: '查看页面场景',
                actionType: 'page',
                actionValue: bestPage.page_id
            });
        }

        const weakRule = rules
            .filter((row) => Number(row.views || 0) >= 20 && Number(row.ctr || 0) < 1)
            .sort((first, second) => Number(second.views || 0) - Number(first.views || 0))[0];
        if (weakRule) {
            insights.push({
                tone: 'warning',
                icon: 'fa-triangle-exclamation',
                title: '存在低效高曝光规则',
                detail: `「${weakRule.rule_name || '未命名规则'}」已有 ${formatNumber(weakRule.views)} 曝光但 CTR ${formatPercent(weakRule.ctr)}，建议重写文案或暂停。`,
                action: '筛选低 CTR',
                actionType: 'health',
                actionValue: 'low_ctr'
            });
        }

        const bestAction = actions
            .filter((row) => Number(row.clicks || 0) > 0)
            .sort((first, second) => (Number(second.conversions || 0) - Number(first.conversions || 0)) || (Number(second.clicks || 0) - Number(first.clicks || 0)))[0];
        if (bestAction) {
            insights.push({
                tone: 'good',
                icon: 'fa-arrow-pointer',
                title: '高价值 CTA 可复用',
                detail: `「${bestAction.label || '未命名入口'}」带来 ${formatNumber(bestAction.clicks)} 点击、${formatNumber(bestAction.conversions)} 转化。`
            });
        }

        return insights.slice(0, 6);
    }

    function renderAnalyticsCommandCenter(analytics = {}) {
        const funnel = analytics.funnel || {};
        const attribution = analytics.attribution || {};
        const items = [
            ['ctr', '整体 CTR', formatPercent(funnel.ctr), `${formatNumber(funnel.clicks)} 点击 / ${formatNumber(funnel.views)} 曝光`],
            ['dismiss', '关闭率', formatPercent(funnel.dismiss_rate), `${formatNumber(funnel.dismisses)} 次关闭`],
            ['conversion', '转化率', formatPercent(funnel.conversion_rate), `${formatNumber(funnel.conversions)} 次转化`],
            ['assisted', '点击辅助', formatPercent(attribution.click_to_conversion_rate), `${formatNumber(attribution.click_assisted_conversions)} 次点击后转化`]
        ];
        return `
            <section class="engagement-section engagement-analytics-command">
                <div class="engagement-section__head">
                    <div>
                        <h3>效果分析总控</h3>
                        <p>把曝光效率、打扰感、转化归因和 CTA 效率放在同一张运营仪表盘里。</p>
                    </div>
                </div>
                <div class="engagement-analytics-command__grid">
                    ${items.map(([key, label, value, note]) => `
                        <article data-metric="${escapeHtml(key)}">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(String(value))}</strong>
                            <p>${escapeHtml(note)}</p>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderAnalyticsRecommendations(analytics = {}) {
        const insights = getAnalyticsInsightRows(analytics);
        return `
            <section class="engagement-section engagement-analytics-insights">
                <div class="engagement-section__head">
                    <div>
                        <h3>运营诊断建议</h3>
                        <p>根据漏斗、归因和维度表现自动生成可执行建议，避免站长只看数字。</p>
                    </div>
                </div>
                <div class="engagement-analytics-insight-grid">
                    ${insights.length ? insights.map((item) => `
                        <article class="engagement-analytics-insight" data-tone="${escapeHtml(item.tone || 'info')}">
                            <i class="fas ${escapeHtml(item.icon || 'fa-circle-info')}" aria-hidden="true"></i>
                            <div>
                                <strong>${escapeHtml(item.title)}</strong>
                                <p>${escapeHtml(item.detail)}</p>
                            </div>
                            ${item.action ? `
                                <button type="button"
                                    data-engagement-action="${item.actionType === 'page' ? 'focus-page' : 'focus-rule-health-filter'}"
                                    ${item.actionType === 'page' ? `data-page-id="${escapeHtml(item.actionValue || 'home')}"` : `data-rule-health-filter="${escapeHtml(item.actionValue || 'needs_attention')}"`}>
                                    ${escapeHtml(item.action)}
                                </button>
                            ` : ''}
                        </article>
                    `).join('') : `<div class="engagement-empty">暂无可用分析建议。产生曝光、点击或转化后会自动生成。</div>`}
                </div>
            </section>
        `;
    }

    function getDiagnosticStatusLabel(status = '') {
        const normalized = normalizeToken(status, 'idle');
        if (normalized === 'ok') return '正常';
        if (normalized === 'blocked') return '阻断';
        if (normalized === 'attention') return '需关注';
        if (normalized === 'warning') return '注意';
        return '待验证';
    }

    function getDiagnosticStatusIcon(status = '') {
        const normalized = normalizeToken(status, 'idle');
        if (normalized === 'ok') return 'fa-check';
        if (normalized === 'blocked') return 'fa-ban';
        if (normalized === 'attention') return 'fa-triangle-exclamation';
        if (normalized === 'warning') return 'fa-triangle-exclamation';
        return 'fa-circle';
    }

    function getLaunchCheckStatusIcon(status = '') {
        const normalized = normalizeToken(status, 'idle');
        if (normalized === 'ok') return 'fa-check';
        if (normalized === 'warning' || normalized === 'attention') return 'fa-triangle-exclamation';
        if (normalized === 'blocked') return 'fa-ban';
        return 'fa-circle';
    }

    function ruleMatchesLaunchPage(rule = {}, pageId = '') {
        const pageIds = Array.isArray(rule.page_ids)
            ? rule.page_ids.map((item) => normalizeToken(item, '')).filter(Boolean)
            : [];
        return !pageIds.length || pageIds.includes('all') || pageIds.includes(pageId);
    }

    function getLaunchPageRows(payload = {}) {
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const scenes = Array.isArray(payload.page_scenes) ? payload.page_scenes : [];
        const supportContexts = Array.isArray(payload.support_entry?.contexts) ? payload.support_entry.contexts : [];
        const analyticsRows = Array.isArray(payload.analytics?.page_breakdown) ? payload.analytics.page_breakdown : [];
        const runningRules = rules.filter((rule) => isRuleRunningNow(rule));

        return RULE_PAGE_OPTIONS.filter((pageId) => pageId !== 'all').map((pageId) => {
            const scene = scenes.find((item) => normalizeToken(item?.id || item?.page_id, '') === pageId) || null;
            const context = supportContexts.find((item) => normalizeToken(item?.id || 'default', 'default') === pageId)
                || supportContexts.find((item) => normalizeToken(item?.id || 'default', 'default') === 'default')
                || null;
            const pageRules = runningRules.filter((rule) => ruleMatchesLaunchPage(rule, pageId));
            const pageAnalytics = analyticsRows.find((row) => normalizeToken(row?.page_id, '') === pageId) || {};
            const hasScene = Boolean(scene);
            const hasRules = pageRules.length > 0;
            const hasSupport = Boolean(context && context.enabled !== false && Array.isArray(context.shortcuts) && context.shortcuts.length);
            const hasEvents = Number(pageAnalytics.views || 0) > 0 || Number(pageAnalytics.clicks || 0) > 0;
            const status = hasScene && hasRules && hasSupport
                ? (hasEvents ? 'ok' : 'warning')
                : 'attention';

            return {
                page_id: pageId,
                status,
                scene: hasScene,
                rules: pageRules.length,
                support: hasSupport,
                views: Number(pageAnalytics.views || 0) || 0,
                clicks: Number(pageAnalytics.clicks || 0) || 0
            };
        });
    }

    function buildLaunchReadiness(payload = {}) {
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const templates = Array.isArray(payload.templates) ? payload.templates : [];
        const segments = Array.isArray(payload.segments) ? payload.segments : [];
        const scenes = Array.isArray(payload.page_scenes) ? payload.page_scenes : [];
        const assets = Array.isArray(payload.asset_center?.assets) ? payload.asset_center.assets : [];
        const supportEntry = payload.support_entry || {};
        const supportContexts = Array.isArray(supportEntry.contexts) ? supportEntry.contexts : [];
        const metrics = payload.metrics || {};
        const analytics = payload.analytics || {};
        const experienceQuality = analytics.experience_quality || {};
        const governance = payload.governance || {};
        const diagnostics = payload.diagnostics || {};
        const externalEmbed = payload.external_embed || {};
        const externalDiagnostics = externalEmbed.diagnostics || {};
        const runningRules = rules.filter((rule) => isRuleRunningNow(rule));
        const pageRows = getLaunchPageRows(payload);
        const measuredViews = Number(experienceQuality.measured_views || 0) || 0;
        const overflowViews = Number(experienceQuality.overflow_views || 0) || 0;
        const tightEdgeViews = Number(experienceQuality.tight_edge_views || 0) || 0;

        const checks = [
            {
                id: 'schema',
                label: '数据模型',
                status: payload.schema_ready !== false ? 'ok' : 'blocked',
                detail: payload.schema_ready !== false ? '规则、模板、事件和配置均可读取' : '迁移表仍不可读，前台触达无法稳定运行'
            },
            {
                id: 'runtime',
                label: '机器人运行时',
                status: payload.asset_center?.style?.enabled === false ? 'warning' : 'ok',
                detail: payload.asset_center?.style?.enabled === false ? '样式中心已关闭，前台使用默认机器人视觉' : '公共页机器人会读取触达和客服入口配置'
            },
            {
                id: 'rules',
                label: '运行规则',
                status: runningRules.length > 0 ? 'ok' : 'attention',
                detail: runningRules.length > 0 ? `${runningRules.length} 条规则正在发布状态` : '还没有运行中的触达规则'
            },
            {
                id: 'coverage',
                label: '页面覆盖',
                status: pageRows.every((row) => row.scene && row.support) ? 'ok' : 'warning',
                detail: `${pageRows.filter((row) => row.scene && row.support).length}/${pageRows.length} 个公共页具备场景与客服入口`
            },
            {
                id: 'templates',
                label: '运营资产',
                status: templates.length > 0 && assets.length > 0 ? 'ok' : 'warning',
                detail: `${templates.length} 个模板 · ${segments.length} 个分群 · ${assets.length} 个素材`
            },
            {
                id: 'support',
                label: '客服入口',
                status: supportEntry.enabled === false ? 'blocked' : (supportContexts.length ? 'ok' : 'warning'),
                detail: supportEntry.enabled === false ? '客服快捷入口已关闭' : `${supportContexts.length} 个页面入口 · 工单${supportEntry.ticket_enabled === false ? '关闭' : '可用'}`
            },
            {
                id: 'events',
                label: '数据回流',
                status: Number(metrics.views || 0) > 0 ? 'ok' : (runningRules.length > 0 ? 'warning' : 'attention'),
                detail: Number(metrics.views || 0) > 0 ? `${formatNumber(metrics.views)} 曝光 · ${formatNumber(metrics.clicks)} 点击` : '近 24 小时暂无曝光回流'
            },
            {
                id: 'frontend_qa',
                label: '前台体验',
                status: overflowViews > 0 || tightEdgeViews > 0 ? 'warning' : (measuredViews > 0 ? 'ok' : 'attention'),
                detail: measuredViews > 0
                    ? `${formatNumber(measuredViews)} 次测量 · 溢出 ${formatNumber(overflowViews)} · 边缘过近 ${formatNumber(tightEdgeViews)}`
                    : '等待前台气泡回传尺寸、主题和视口数据'
            },
            {
                id: 'external_embed',
                label: 'API中转外部承载',
                status: externalEmbed.enabled === false
                    ? 'blocked'
                    : (externalDiagnostics.status === 'ready' ? 'ok' : 'warning'),
                detail: externalEmbed.enabled === false
                    ? '外部嵌入已关闭'
                    : `${formatNumber(externalDiagnostics.allowed_origin_count || 0)} 个白名单域名 · ${externalDiagnostics.has_gongyi_origin ? 'API中转已覆盖' : 'API中转白名单待补'}`
            },
            {
                id: 'governance',
                label: '治理风险',
                status: Number(governance.high_risk_rules || 0) > 0 ? 'warning' : 'ok',
                detail: Number(governance.high_risk_rules || 0) > 0 ? `${governance.high_risk_rules} 条高风险规则需要复核` : '当前没有高风险运行规则'
            }
        ];

        const score = Math.round((checks.filter((item) => item.status === 'ok').length / checks.length) * 100);
        const status = checks.some((item) => item.status === 'blocked')
            ? 'blocked'
            : (checks.some((item) => item.status === 'warning' || item.status === 'attention') ? 'attention' : 'ok');

        return {
            status,
            score,
            checks,
            pageRows,
            lastEventAt: diagnostics.last_event_at || ''
        };
    }

    function renderLaunchReadinessPanel(payload = {}) {
        const readiness = buildLaunchReadiness(payload);
        const lastEventLabel = readiness.lastEventAt
            ? new Date(readiness.lastEventAt).toLocaleString('zh-CN')
            : '暂无事件';
        return `
            <section class="engagement-section engagement-launch-readiness">
                <div class="engagement-section__head">
                    <div>
                        <h3>上线验收</h3>
                        <p>把公共页机器人、页面规则、客服入口、素材样式、数据回流和治理风险放到同一个收口面板里。</p>
                    </div>
                    <div class="engagement-launch-score" data-status="${escapeHtml(readiness.status)}">
                        <strong>${escapeHtml(readiness.score)}</strong>
                        <span>${escapeHtml(getDiagnosticStatusLabel(readiness.status))}</span>
                    </div>
                </div>
                <div class="engagement-launch-meta">
                    <span>最后事件：${escapeHtml(lastEventLabel)}</span>
                    <span>验收范围：首页 / 提示词 / API中转 / 商城 / 验证 / 留言板</span>
                </div>
                <div class="engagement-launch-grid">
                    ${readiness.checks.map((item) => `
                        <article class="engagement-launch-check" data-status="${escapeHtml(item.status)}">
                            <i class="fas ${escapeHtml(getLaunchCheckStatusIcon(item.status))}" aria-hidden="true"></i>
                            <div>
                                <strong>${escapeHtml(item.label)}</strong>
                                <p>${escapeHtml(item.detail)}</p>
                            </div>
                            <span>${escapeHtml(getDiagnosticStatusLabel(item.status))}</span>
                        </article>
                    `).join('')}
                </div>
                <div class="engagement-launch-page-grid">
                    ${readiness.pageRows.map((row) => `
                        <article class="engagement-launch-page-row" data-status="${escapeHtml(row.status)}">
                            <div>
                                <strong>${escapeHtml(getPageLabel(row.page_id))}</strong>
                                <p>${escapeHtml(row.rules)} 规则 · ${row.support ? '客服入口已接入' : '客服入口待补'} · ${escapeHtml(formatNumber(row.views))} 曝光</p>
                            </div>
                            <span>${escapeHtml(getDiagnosticStatusLabel(row.status))}</span>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderLifecycleDiagnostics(payload = {}) {
        const diagnostics = payload.diagnostics || {};
        const bridgeDiagnostics = diagnostics.notification_bridge && typeof diagnostics.notification_bridge === 'object'
            ? diagnostics.notification_bridge
            : {};
        const checklist = Array.isArray(diagnostics.checklist) ? diagnostics.checklist : [];
        const tips = Array.isArray(diagnostics.tips) ? diagnostics.tips : [];
        const bridgeRows = Array.isArray(bridgeDiagnostics.events) ? bridgeDiagnostics.events : [];
        const lastEventLabel = diagnostics.last_event_at
            ? new Date(diagnostics.last_event_at).toLocaleString('zh-CN')
            : '暂无事件';

        return `
            <section class="engagement-section engagement-diagnostics">
                <div class="engagement-section__head">
                    <div>
                        <h3>体验闭环诊断</h3>
                        <p>按创建规则、发布运行、前台曝光、事件回传、后台分析这条链路逐项检查。</p>
                    </div>
                    <div class="engagement-diagnostics__meta">
                        <span>${escapeHtml(getDiagnosticStatusLabel(diagnostics.status))}</span>
                        <span>最后事件：${escapeHtml(lastEventLabel)}</span>
                    </div>
                </div>
                <div class="engagement-diagnostics-grid">
                    ${checklist.map((item) => `
                        <article class="engagement-diagnostic-card" data-status="${escapeHtml(item.status || 'idle')}">
                            <i class="fas ${escapeHtml(getDiagnosticStatusIcon(item.status))}" aria-hidden="true"></i>
                            <div>
                                <strong>${escapeHtml(item.label || '诊断项')}</strong>
                                <p>${escapeHtml(item.detail || '')}</p>
                            </div>
                            <span>${escapeHtml(getDiagnosticStatusLabel(item.status))}</span>
                        </article>
                    `).join('')}
                </div>
                ${tips.length ? `
                    <div class="engagement-diagnostic-tips">
                        ${tips.map((tip) => `
                            <article data-tone="${escapeHtml(tip.tone || 'info')}">
                                <strong>${escapeHtml(tip.title || '诊断建议')}</strong>
                                <p>${escapeHtml(tip.detail || '')}</p>
                            </article>
                        `).join('')}
                    </div>
                ` : ''}
                ${bridgeRows.length ? `
                    <div class="engagement-diagnostic-tips">
                        <article data-tone="${escapeHtml(bridgeDiagnostics.status === 'warning' ? 'warning' : 'info')}">
                            <strong>通知桥接事件 ${escapeHtml(formatNumber(bridgeDiagnostics.event_types_count || bridgeRows.length))} 类</strong>
                            <p>${escapeHtml(
                                bridgeDiagnostics.multi_rule_event_types_count > 0
                                    ? `${bridgeDiagnostics.running_rule_count || 0} 条运行规则分布在 ${bridgeDiagnostics.event_types_count || bridgeRows.length} 类双通道事件里，其中 ${bridgeDiagnostics.multi_rule_event_types_count} 类还挂了多条规则。`
                                    : `${bridgeDiagnostics.running_rule_count || 0} 条运行规则命中了通知桥接事件，前台会优先保留规则气泡并按 source_event_id 去重。`
                            )}</p>
                        </article>
                        ${bridgeRows.slice(0, 6).map((row) => `
                            <article data-tone="${escapeHtml(Number(row.running_rules || 0) > 1 ? 'warning' : 'info')}">
                                <strong>${escapeHtml(row.label || row.event_type || '未命名事件')}</strong>
                                <p>${escapeHtml(`${formatNumber(row.running_rules || 0)} 条运行规则 · 页面 ${Array.isArray(row.page_ids) && row.page_ids.length ? row.page_ids.map((pageId) => getPageLabel(pageId)).join(' / ') : '未分配'}${Array.isArray(row.rule_names) && row.rule_names.length ? ` · ${row.rule_names.join('、')}` : ''}`)}</p>
                            </article>
                        `).join('')}
                    </div>
                ` : ''}
            </section>
        `;
    }

    function renderPagePerformance(analytics = {}) {
        const rows = Array.isArray(analytics.page_breakdown) ? analytics.page_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>页面表现</h3>
                        <p>查看不同公共页的曝光、点击和关闭表现，用于调整页面策略和优先级。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(getPageLabel(row.page_id))}</strong>
                                <p>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击 · CTR ${escapeHtml(formatPercent(row.ctr))}</p>
                            </div>
                            <span>${escapeHtml(formatPercent(row.dismiss_rate))} 关闭率</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无页面级触达事件。</div>`}
                </div>
            </section>
        `;
    }

    function renderPlacementPerformance(analytics = {}) {
        const rows = Array.isArray(analytics.placement_breakdown) ? analytics.placement_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>展示形式表现</h3>
                        <p>比较机器人气泡、顶部横幅、提示卡片、小弹窗和浮动角标的点击与关闭情况。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(getPlacementLabel(row.placement || row.key))}</strong>
                                <p>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击 · ${escapeHtml(formatNumber(row.conversions))} 转化</p>
                            </div>
                            <span>CTR ${escapeHtml(formatPercent(row.ctr))}</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无展示形式数据。</div>`}
                </div>
            </section>
        `;
    }

    function renderActionPerformance(analytics = {}) {
        const rows = Array.isArray(analytics.action_breakdown) ? analytics.action_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>CTA 路径表现</h3>
                        <p>按按钮、钱包路径或可点击文字统计点击和转化，判断哪个入口最有效。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(row.label || '未命名入口')}</strong>
                                <p>${escapeHtml(row.action_url || '无跳转地址')} · ${escapeHtml(formatNumber(row.clicks))} 点击 · ${escapeHtml(formatNumber(row.conversions))} 转化</p>
                            </div>
                            <span>${escapeHtml(formatPercent(row.conversion_rate))} 转化率</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无 CTA 点击数据。</div>`}
                </div>
            </section>
        `;
    }

    function renderSourcePerformance(analytics = {}) {
        const rows = Array.isArray(analytics.source_breakdown) ? analytics.source_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>来源模块表现</h3>
                        <p>区分规则、评论回复、留言板、商城、积分和权限等来源，追踪不同业务事件的触达质量。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(getSourceModuleLabel(row.source_module || row.key))}</strong>
                                <p>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击 · ${escapeHtml(formatNumber(row.dismisses))} 关闭</p>
                            </div>
                            <span>${escapeHtml(formatPercent(row.conversion_rate))} 转化率</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无来源模块数据。</div>`}
                </div>
            </section>
        `;
    }

    function renderTriggerPerformance(analytics = {}) {
        const rows = Array.isArray(analytics.trigger_breakdown) ? analytics.trigger_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>触发条件表现</h3>
                        <p>比较进入页面、积分不足、优惠券、回复、验证失败等触发条件的触达质量。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(getTriggerTypeLabel(row.trigger_type || row.key))}</strong>
                                <p>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击 · ${escapeHtml(formatNumber(row.dismisses))} 关闭</p>
                            </div>
                            <span>CTR ${escapeHtml(formatPercent(row.ctr))}</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无触发条件数据。</div>`}
                </div>
            </section>
        `;
    }

    function renderAudiencePerformance(analytics = {}) {
        const rows = Array.isArray(analytics.audience_breakdown) ? analytics.audience_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>用户分群表现</h3>
                        <p>查看游客、登录用户、新用户、高价值用户和自定义分群的点击与转化差异。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(getAudienceLabel({ scope: row.audience_scope || row.key }))}</strong>
                                <p>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击 · ${escapeHtml(formatNumber(row.conversions))} 转化</p>
                            </div>
                            <span>${escapeHtml(formatPercent(row.conversion_rate))} 转化率</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无用户分群数据。</div>`}
                </div>
            </section>
        `;
    }

    function renderDevicePerformance(analytics = {}) {
        const rows = Array.isArray(analytics.device_breakdown) ? analytics.device_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>设备表现</h3>
                        <p>按桌面端、移动端和平板端拆解曝光、点击、关闭和转化，用于判断气泡尺寸与位置是否合适。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(getDeviceLabel(row.device || row.key))}</strong>
                                <p>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击 · ${escapeHtml(formatNumber(row.dismisses))} 关闭</p>
                            </div>
                            <span>${escapeHtml(formatPercent(row.dismiss_rate))} 关闭率</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无设备维度数据。</div>`}
                </div>
            </section>
        `;
    }

    function renderFrontendExperienceQA(analytics = {}) {
        const quality = analytics.experience_quality || {};
        const themeRows = Array.isArray(analytics.theme_breakdown) ? analytics.theme_breakdown : [];
        const viewportRows = Array.isArray(analytics.viewport_breakdown) ? analytics.viewport_breakdown : [];
        const measuredViews = Number(quality.measured_views || 0) || 0;
        const cards = [
            {
                key: 'measured',
                label: '测量曝光',
                value: measuredViews,
                detail: measuredViews > 0 ? '前台已回传气泡尺寸和视口信息' : '等待前台曝光回传'
            },
            {
                key: 'overflow',
                label: '溢出风险',
                value: Number(quality.overflow_views || 0) || 0,
                detail: `溢出率 ${formatPercent(quality.overflow_rate)}`
            },
            {
                key: 'edge',
                label: '边缘过近',
                value: Number(quality.tight_edge_views || 0) || 0,
                detail: `边缘风险 ${formatPercent(quality.tight_edge_rate)}`
            },
            {
                key: 'mobile',
                label: '移动端曝光',
                value: Number(quality.mobile_views || 0) || 0,
                detail: `占比 ${formatPercent(quality.mobile_view_rate)}`
            },
            {
                key: 'dark',
                label: '暗色曝光',
                value: Number(quality.dark_views || 0) || 0,
                detail: `占比 ${formatPercent(quality.dark_view_rate)}`
            },
            {
                key: 'size',
                label: '最大尺寸',
                value: `${formatNumber(quality.max_bubble_width || 0)}×${formatNumber(quality.max_bubble_height || 0)}`,
                detail: '用于判断气泡是否需要收紧宽度或密度'
            }
        ];

        const renderBreakdownRows = (rows, type) => rows.length ? rows.map((row) => `
            <article class="engagement-frontend-breakdown-row">
                <div>
                    <strong>${escapeHtml(type === 'theme' ? getThemeLabel(row.theme || row.key) : getViewportBucketLabel(row.viewport_bucket || row.key))}</strong>
                    <p>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击 · ${escapeHtml(formatNumber(row.dismisses))} 关闭</p>
                </div>
                <span>CTR ${escapeHtml(formatPercent(row.ctr))}</span>
            </article>
        `).join('') : `<div class="engagement-empty">等待前台曝光后生成拆分数据。</div>`;

        return `
            <section class="engagement-section engagement-frontend-qa">
                <div class="engagement-section__head">
                    <div>
                        <h3>前台体验验收</h3>
                        <p>用真实曝光回传检查气泡在移动端、暗色主题和不同视口下是否溢出、贴边或过度打扰。</p>
                    </div>
                </div>
                <div class="engagement-frontend-qa__grid">
                    ${cards.map((card) => `
                        <article class="engagement-frontend-qa-card" data-key="${escapeHtml(card.key)}">
                            <strong>${escapeHtml(card.value)}</strong>
                            <span>${escapeHtml(card.label)}</span>
                            <p>${escapeHtml(card.detail)}</p>
                        </article>
                    `).join('')}
                </div>
                <div class="engagement-frontend-qa__breakdowns">
                    <div>
                        <h4>主题表现</h4>
                        ${renderBreakdownRows(themeRows, 'theme')}
                    </div>
                    <div>
                        <h4>视口表现</h4>
                        ${renderBreakdownRows(viewportRows, 'viewport')}
                    </div>
                </div>
            </section>
        `;
    }

    function renderRulePerformance(analytics = {}) {
        const rows = Array.isArray(analytics.rule_breakdown) ? analytics.rule_breakdown : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>规则表现</h3>
                        <p>按规则汇总曝光和点击，帮助识别高价值规则与低效打扰。</p>
                    </div>
                </div>
                <div class="engagement-performance-list">
                    ${rows.length ? rows.map((row) => `
                        <article class="engagement-performance-row">
                            <div>
                                <strong>${escapeHtml(row.rule_name || '未命名规则')}</strong>
                                <p>${escapeHtml(getTriggerTypeLabel(row.trigger_type))} · ${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击</p>
                            </div>
                            <span>CTR ${escapeHtml(formatPercent(row.ctr))}</span>
                        </article>
                    `).join('') : `<div class="engagement-empty">近 24 小时暂无规则级触达事件。</div>`}
                </div>
            </section>
        `;
    }

    function renderAuditLogs(auditLogs = []) {
        const rows = Array.isArray(auditLogs) ? auditLogs.slice(0, 12) : [];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>审计记录</h3>
                        <p>记录规则创建、发布、暂停、归档和全局治理动作，方便回溯运营变更。</p>
                    </div>
                </div>
                <div class="engagement-audit-list">
                    ${rows.length ? rows.map((row) => {
                        const details = row.details && typeof row.details === 'object' ? row.details : {};
                        const ruleName = details.name || details.rule_id || details.count || '';
                        return `
                            <article class="engagement-audit-row">
                                <span class="engagement-audit-row__icon"><i class="fas fa-shield-halved" aria-hidden="true"></i></span>
                                <div>
                                    <strong>${escapeHtml(getAuditActionLabel(row.action_type))}</strong>
                                    <p>${escapeHtml(ruleName ? String(ruleName) : row.action_type || 'engagement')}</p>
                                </div>
                                <time>${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '未知时间')}</time>
                            </article>
                        `;
                    }).join('') : `<div class="engagement-empty">暂无客服系统审计记录。创建、发布或暂停规则后会出现在这里。</div>`}
                </div>
            </section>
        `;
    }

    function getAuditBatchGroups(auditLogs = []) {
        const groups = new Map();
        (Array.isArray(auditLogs) ? auditLogs : []).forEach((row) => {
            const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
            const batchId = String(details.batch_id || '').trim();
            if (!batchId) return;
            if (!groups.has(batchId)) {
                groups.set(batchId, {
                    batch_id: batchId,
                    batch_action: details.batch_action || '',
                    batch_label: details.batch_label || '',
                    rows: [],
                    latest_at: row.created_at || ''
                });
            }
            const group = groups.get(batchId);
            group.rows.push(row);
            if (String(row.created_at || '') > String(group.latest_at || '')) {
                group.latest_at = row.created_at || group.latest_at;
            }
        });
        return Array.from(groups.values())
            .sort((first, second) => String(second.latest_at || '').localeCompare(String(first.latest_at || '')))
            .slice(0, 6);
    }

    function getAuditBatchRollbackLabel(group = {}) {
        const action = normalizeToken(group.batch_action, '');
        if (action.includes('pause')) return '回滚为发布';
        if (action.includes('archive')) return '恢复归档前状态';
        if (action.includes('copy')) return '归档复制草稿';
        return '回滚批次';
    }

    function getLatestPauseAllAudit(auditLogs = []) {
        return (Array.isArray(auditLogs) ? auditLogs : [])
            .filter((row) => row?.action_type === 'engagement.rule.pause_all')
            .sort((first, second) => String(second.created_at || '').localeCompare(String(first.created_at || '')))[0] || null;
    }

    function renderAuditBatchGroups(auditLogs = []) {
        const groups = getAuditBatchGroups(auditLogs);
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>批量治理批次</h3>
                        <p>按 batch_id 聚合批量暂停、复制和归档，便于查看影响范围与回滚。</p>
                    </div>
                </div>
                <div class="engagement-audit-batch-list">
                    ${groups.length ? groups.map((group) => {
                        const rows = Array.isArray(group.rows) ? group.rows : [];
                        return `
                            <article class="engagement-audit-batch">
                                <div class="engagement-audit-batch__head">
                                    <div>
                                        <strong>${escapeHtml(group.batch_label || getAuditActionLabel(rows[0]?.action_type) || '批量治理')}</strong>
                                        <p>${escapeHtml(group.batch_id)} · ${escapeHtml(formatNumber(rows.length))} 条记录 · ${escapeHtml(group.latest_at ? new Date(group.latest_at).toLocaleString('zh-CN') : '未知时间')}</p>
                                    </div>
                                    <button type="button" data-engagement-action="rollback-audit-batch" data-batch-id="${escapeHtml(group.batch_id)}">
                                        <i class="fas fa-rotate-left" aria-hidden="true"></i>
                                        <span>${escapeHtml(getAuditBatchRollbackLabel(group))}</span>
                                    </button>
                                </div>
                                <div class="engagement-audit-batch__rows">
                                    ${rows.slice(0, 6).map((row) => {
                                        const details = row.details && typeof row.details === 'object' ? row.details : {};
                                        return `
                                            <span>${escapeHtml(getAuditActionLabel(row.action_type))} · ${escapeHtml(details.name || details.rule_id || details.batch_source_rule_id || '规则')}</span>
                                        `;
                                    }).join('')}
                                    ${rows.length > 6 ? `<span>另有 ${escapeHtml(formatNumber(rows.length - 6))} 条记录</span>` : ''}
                                </div>
                            </article>
                        `;
                    }).join('') : `<div class="engagement-empty">暂无批量治理批次。使用规则列表的批量操作后会在这里聚合展示。</div>`}
                </div>
            </section>
        `;
    }

    function renderGovernanceSummary(payload = {}) {
        const governance = payload.governance || {};
        const riskRules = Array.isArray(governance.risk_rules) ? governance.risk_rules : [];
        const latestPauseAll = getLatestPauseAllAudit(payload.audit_logs || []);
        const guardrails = [
            ['running_rules', '运行规则', governance.running_rules, '当前会被公共页读取的规则'],
            ['event_rules', '事件规则', governance.event_rules, '积分、优惠券、回复等事件型触达'],
            ['high_risk_rules', '高风险规则', governance.high_risk_rules, '全站、高优先级或警示语气规则'],
            ['review_required_rules', '待复核规则', governance.review_required_rules, '发布前需要二次确认的规则'],
            ['recent_audit_logs', '近 24h 变更', governance.recent_audit_logs, '客服系统相关审计记录']
        ];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>全局治理</h3>
                        <p>把规则状态、风险信号和审计变化放在一起，便于站长统一管控触达系统。</p>
                    </div>
                    <button type="button"
                        class="engagement-link-btn engagement-danger-link"
                        data-engagement-action="pause-all-rules"
                        ${governance.can_pause_all ? '' : 'disabled'}>
                        暂停全部触达
                    </button>
                </div>
                <div class="engagement-governance-actions" aria-label="风险治理快捷入口">
                    <button type="button" data-engagement-action="focus-rule-health-filter" data-rule-health-filter="high_risk">
                        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                        <span>查看高风险</span>
                    </button>
                    <button type="button" data-engagement-action="focus-rule-health-filter" data-rule-health-filter="no_views">
                        <i class="fas fa-eye-slash" aria-hidden="true"></i>
                        <span>查看无曝光</span>
                    </button>
                    <button type="button" data-engagement-action="focus-rule-health-filter" data-rule-health-filter="high_dismiss">
                        <i class="fas fa-circle-xmark" aria-hidden="true"></i>
                        <span>查看高关闭率</span>
                    </button>
                    <button type="button" data-engagement-action="batch-archive-high-risk-rules" ${Number(governance.high_risk_rules || 0) > 0 ? '' : 'disabled'}>
                        <i class="fas fa-box-archive" aria-hidden="true"></i>
                        <span>归档高风险</span>
                    </button>
                    <button type="button" data-engagement-action="restore-latest-pause-all-rules" ${latestPauseAll ? '' : 'disabled'}>
                        <i class="fas fa-rotate-left" aria-hidden="true"></i>
                        <span>恢复最近暂停</span>
                    </button>
                </div>
                <div class="engagement-governance-grid">
                    ${guardrails.map(([key, label, value, note]) => `
                        <article class="engagement-governance-card engagement-governance-card--${escapeHtml(key)}">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(formatNumber(value))}</strong>
                            <p>${escapeHtml(note)}</p>
                        </article>
                    `).join('')}
                </div>
                ${riskRules.length ? `
                    <div class="engagement-risk-list">
                        ${riskRules.map((rule) => {
                            const reasons = Array.isArray(rule.reasons) ? rule.reasons : [];
                            return `
                                <article class="engagement-risk-row" data-risk="${escapeHtml(rule.risk_level || 'high')}">
                                    <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                                    <div>
                                        <strong>${escapeHtml(rule.name || '未命名高风险规则')}</strong>
                                        <p>${escapeHtml(reasons.length ? reasons.join('、') : '需要复核触达范围、语气和展示形式')}</p>
                                    </div>
                                    <span>${escapeHtml(getPlacementLabel(rule.placement || 'robot_bubble'))} · P${escapeHtml(rule.priority || 0)}</span>
                                </article>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </section>
        `;
    }

    function renderGovernanceReviewQueue(payload = {}) {
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const reviewRows = rules.filter((rule) => getRuleGovernance(rule).requires_review === true).slice(0, 8);
        return `
            <section class="engagement-section engagement-review-queue">
                <div class="engagement-section__head">
                    <div>
                        <h3>发布审核队列</h3>
                        <p>全站、高优先级、强展示或警示语气规则会进入复核视图；发布前必须二次确认。</p>
                    </div>
                </div>
                <div class="engagement-review-list">
                    ${reviewRows.length ? reviewRows.map((rule) => {
                        const governance = getRuleGovernance(rule);
                        const isRunning = isRuleRunningNow(rule);
                        return `
                            <article class="engagement-review-row" data-risk="${escapeHtml(governance.risk_level)}">
                                <i class="fas fa-shield-halved" aria-hidden="true"></i>
                                <div>
                                    <strong>${escapeHtml(rule.name || '未命名规则')}</strong>
                                    <p>${escapeHtml((governance.reasons || []).join('、') || '发布前需要复核')} · ${escapeHtml(getTriggerTypeLabel(rule.trigger_type))}</p>
                                </div>
                                <span>${escapeHtml(isRunning ? '运行中待复核' : '发布前需确认')}</span>
                                <button type="button" data-engagement-action="edit-rule" data-rule-id="${escapeHtml(rule.id || '')}">打开</button>
                                <button type="button" data-engagement-action="toggle-rule" data-rule-id="${escapeHtml(rule.id || '')}" data-rule-enabled="${isRunning ? 'false' : 'true'}">${isRunning ? '暂停' : '确认发布'}</button>
                            </article>
                        `;
                    }).join('') : `<div class="engagement-empty">当前没有需要发布复核的高风险规则。</div>`}
                </div>
            </section>
        `;
    }

    function renderPermissionGuardrails() {
        const rows = [
            ['创建/编辑规则', '需要客服管理或设置管理权限，所有保存动作写入审计。'],
            ['发布高风险规则', '全站、高优先级、强展示或警示语气必须二次确认，接口同样强制校验。'],
            ['批量治理', '批量暂停、归档、复制和自动化发布都会写入 batch_id，可在审计记录回放。'],
            ['紧急止损', '支持一键暂停全部触达，并可从最近暂停记录恢复。']
        ];
        return `
            <section class="engagement-section engagement-permission-guardrails">
                <div class="engagement-section__head">
                    <div>
                        <h3>权限与发布边界</h3>
                        <p>把客服系统作为商业化运营产品管理，关键动作必须可追踪、可解释、可回滚。</p>
                    </div>
                </div>
                <div class="engagement-permission-grid">
                    ${rows.map(([title, detail]) => `
                        <article>
                            <i class="fas fa-user-shield" aria-hidden="true"></i>
                            <div>
                                <strong>${escapeHtml(title)}</strong>
                                <p>${escapeHtml(detail)}</p>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function getExternalEmbedConfig(payload = {}) {
        const source = payload.external_embed && typeof payload.external_embed === 'object' ? payload.external_embed : {};
        return {
            enabled: source.enabled !== false,
            allowed_origins: Array.isArray(source.allowed_origins) && source.allowed_origins.length
                ? source.allowed_origins
                : ['https://gongyi.zaoyoe.com', 'https://www.gongyi.zaoyoe.com'],
            allow_local_preview: source.allow_local_preview !== false,
            api_origin: source.api_origin || 'https://www.zaoyoe.com',
            asset_base: source.asset_base || 'https://www.zaoyoe.com/',
            default_page_id: source.default_page_id || 'gongyi',
            default_site: source.default_site || 'cn',
            embed_snippet: source.embed_snippet || '',
            diagnostics: source.diagnostics || {},
            deployment: source.deployment && typeof source.deployment === 'object' ? source.deployment : {}
        };
    }

    function renderExternalEmbedPanel(payload = {}) {
        const external = getExternalEmbedConfig(payload);
        const diagnostics = external.diagnostics || {};
        const diagnosticsStatus = String(diagnostics.status || 'attention').trim();
        const diagnosticsStatusLabel = {
            ready: '可部署',
            attention: '需排查',
            blocked: '已阻断'
        }[diagnosticsStatus] || '需排查';
        const troubleshooting = diagnostics.troubleshooting && typeof diagnostics.troubleshooting === 'object' ? diagnostics.troubleshooting : {};
        const troubleshootingChecks = Array.isArray(troubleshooting.checks) ? troubleshooting.checks : [];
        const riskChecks = troubleshootingChecks.filter((check) => ['blocked', 'warning'].includes(String(check.status || '').trim()));
        const recommendedActions = Array.isArray(diagnostics.recommended_actions) ? diagnostics.recommended_actions : [];
        const deployment = external.deployment || {};
        const deploymentFunnel = deployment.funnel && typeof deployment.funnel === 'object' ? deployment.funnel : deployment;
        const deploymentStatus = String(deployment.status || 'waiting').trim();
        const deploymentStatusLabel = {
            active: '真实回流中',
            seen: '已有外部事件',
            waiting: '等待真实回流'
        }[deploymentStatus] || '等待真实回流';
        const lastExternalEventLabel = deployment.last_event_at
            ? new Date(deployment.last_event_at).toLocaleString('zh-CN')
            : '暂无真实回流';
        const hostRows = Array.isArray(deployment.host_breakdown) ? deployment.host_breakdown.slice(0, 4) : [];
        const pageRows = Array.isArray(deployment.page_breakdown) ? deployment.page_breakdown.slice(0, 4) : [];
        const renderDeploymentRows = (rows, keyField, emptyText) => rows.length ? rows.map((row) => `
            <div class="engagement-external-observability__row">
                <span>${escapeHtml(row[keyField] || row.key || 'unknown')}</span>
                <strong>${escapeHtml(formatNumber(row.views))} 曝光 · ${escapeHtml(formatNumber(row.clicks))} 点击</strong>
            </div>
        `).join('') : `<p>${escapeHtml(emptyText)}</p>`;
        const checks = Array.isArray(diagnostics.checks) ? diagnostics.checks : [];
        const deploymentSteps = Array.isArray(diagnostics.deployment_steps) ? diagnostics.deployment_steps : [];
        const snippet = external.embed_snippet || [
            '<script',
            '  src="https://www.zaoyoe.com/js/engagement-external-embed.js?v=20260505_GONGYI_EXTERNAL_ENGAGEMENT_1"',
            `  data-page-id="${external.default_page_id}"`,
            `  data-site="${external.default_site}"`,
            `  data-api-origin="${external.api_origin}"`,
            `  data-asset-base="${external.asset_base}"`,
            '  async></script>'
        ].join('\n');

        return `
            <section class="engagement-section engagement-external-embed">
                <div class="engagement-section__head">
                    <div>
                        <h3>外部承载与API中转嵌入</h3>
                        <p>管理API中转等外部页面的 CORS 白名单、主站 API 地址、静态资源地址和可复制嵌入代码。</p>
                    </div>
                    <span class="engagement-status-pill" data-status="${escapeHtml(diagnosticsStatus)}">
                        ${escapeHtml(diagnosticsStatusLabel)}
                    </span>
                </div>
                <div class="engagement-external-grid">
                    <form id="engagementExternalEmbedForm" class="engagement-rule-form engagement-management-form engagement-external-form" autocomplete="off" novalidate>
                        <div class="engagement-form-grid engagement-form-grid--external">
                            <label class="engagement-field engagement-field--switch">
                                <span>外部承载开关</span>
                                ${renderCustomSwitch({ name: 'enabled', checked: external.enabled, label: '允许外部站点读取触达' })}
                            </label>
                            <label class="engagement-field engagement-field--switch">
                                <span>本地预览</span>
                                ${renderCustomSwitch({ name: 'allow_local_preview', checked: external.allow_local_preview, label: '允许 localhost 预检' })}
                            </label>
                            <label class="engagement-field">
                                <span>默认页面</span>
                                ${renderCustomSelect({
                                    name: 'default_page_id',
                                    value: external.default_page_id,
                                    options: EXTERNAL_PAGE_OPTIONS
                                })}
                            </label>
                            <label class="engagement-field">
                                <span>默认站点</span>
                                ${renderCustomSelect({
                                    name: 'default_site',
                                    value: external.default_site,
                                    options: SITE_OPTIONS
                                })}
                            </label>
                            <label class="engagement-field">
                                <span>API Origin</span>
                                <input type="url" name="api_origin" value="${escapeHtml(external.api_origin)}" placeholder="https://www.zaoyoe.com">
                            </label>
                            <label class="engagement-field">
                                <span>素材 Base URL</span>
                                <input type="url" name="asset_base" value="${escapeHtml(external.asset_base)}" placeholder="https://www.zaoyoe.com/">
                            </label>
                            <label class="engagement-field engagement-field--full">
                                <span>CORS 白名单域名（一行一个）</span>
                                <textarea name="allowed_origins" rows="4" placeholder="https://gongyi.zaoyoe.com">${escapeHtml(external.allowed_origins.join('\n'))}</textarea>
                            </label>
                        </div>
                        <div class="engagement-form-actions">
                            <button type="button" class="engagement-primary-btn engagement-external-submit-btn" data-engagement-action="submit-external-embed">
                                <i class="fas fa-save"></i>
                                保存外部承载
                            </button>
                        </div>
                    </form>
                    <div class="engagement-external-deploy">
                        <div class="engagement-external-deploy__head">
                            <div>
                                <strong>API中转嵌入代码</strong>
                                <p>把这段脚本放到API中转公共页底部即可接入同一套机器人触达。</p>
                            </div>
                            <button type="button" class="engagement-link-btn" data-engagement-action="copy-external-embed-snippet">
                                <i class="fas fa-copy" aria-hidden="true"></i>
                                复制
                            </button>
                        </div>
                        <textarea id="engagementExternalEmbedSnippet" class="engagement-code-textarea" readonly>${escapeHtml(snippet)}</textarea>
                        <details class="engagement-external-details">
                            <summary>
                                <span>
                                    <strong>排障与回流观测</strong>
                                    <small>${escapeHtml(riskChecks.length ? `${riskChecks.length} 项需处理 · ${deploymentStatusLabel}` : deploymentStatusLabel)}</small>
                                </span>
                                <i class="fas fa-chevron-down engagement-external-details__chevron" aria-hidden="true"></i>
                            </summary>
                            <div class="engagement-external-details__body">
                                <div class="engagement-external-details__quick">
                                    <div class="engagement-external-probe">
                                        <strong>预检地址</strong>
                                        <p>${escapeHtml(diagnostics.preflight_url || `${external.api_origin}/api/engagement/feed`)}</p>
                                    </div>
                                    <div class="engagement-external-command">
                                        <strong>本地模拟验收</strong>
                                        <code>${escapeHtml(diagnostics.smoke_command || 'npm run smoke:engagement-external')}</code>
                                    </div>
                                </div>
                                <div class="engagement-external-troubleshoot" data-status="${escapeHtml(troubleshooting.status || diagnosticsStatus)}">
                                    <div class="engagement-external-troubleshoot__head">
                                        <div>
                                            <strong>异常诊断</strong>
                                            <p>${escapeHtml(troubleshooting.summary || '检查外部脚本、CORS、API Origin 与真实事件回流。')}</p>
                                        </div>
                                        <span>${escapeHtml(riskChecks.length ? `${riskChecks.length} 项需处理` : '暂无异常')}</span>
                                    </div>
                                    <div class="engagement-external-troubleshoot__checks">
                                        ${(riskChecks.length ? riskChecks : troubleshootingChecks.slice(0, 3)).map((check) => `
                                            <article data-status="${escapeHtml(check.status || 'idle')}">
                                                <i class="fas ${escapeHtml(getDiagnosticStatusIcon(check.status))}" aria-hidden="true"></i>
                                                <div>
                                                    <strong>${escapeHtml(check.label || '诊断项')}</strong>
                                                    <p>${escapeHtml(check.detail || '')}</p>
                                                </div>
                                            </article>
                                        `).join('') || `<p>暂无外部异常诊断数据。</p>`}
                                    </div>
                                    ${recommendedActions.length ? `
                                        <ol class="engagement-external-troubleshoot__actions">
                                            ${recommendedActions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}
                                        </ol>
                                    ` : ''}
                                </div>
                                <div class="engagement-external-observability" data-status="${escapeHtml(deploymentStatus)}">
                                    <div class="engagement-external-observability__head">
                                        <div>
                                            <strong>真实部署回流</strong>
                                            <p>统计API中转等外部页面近 24 小时的曝光、点击、关闭和转化事件。</p>
                                        </div>
                                        <span>${escapeHtml(deploymentStatusLabel)}</span>
                                    </div>
                                    <div class="engagement-external-observability__metrics">
                                        <article>
                                            <strong>${escapeHtml(formatNumber(deploymentFunnel.views))}</strong>
                                            <span>外部曝光</span>
                                        </article>
                                        <article>
                                            <strong>${escapeHtml(formatNumber(deploymentFunnel.clicks))}</strong>
                                            <span>外部点击</span>
                                        </article>
                                        <article>
                                            <strong>${escapeHtml(formatNumber(deploymentFunnel.dismisses))}</strong>
                                            <span>外部关闭</span>
                                        </article>
                                        <article>
                                            <strong>${escapeHtml(formatNumber(deploymentFunnel.conversions))}</strong>
                                            <span>外部转化</span>
                                        </article>
                                    </div>
                                    <div class="engagement-external-observability__meta">
                                        <span>CTR ${escapeHtml(formatPercent(deploymentFunnel.ctr))}</span>
                                        <span>事件 ${escapeHtml(formatNumber(deployment.event_count))}</span>
                                        <span>最后事件：${escapeHtml(lastExternalEventLabel)}</span>
                                    </div>
                                    <div class="engagement-external-observability__breakdowns">
                                        <div>
                                            <b>来源域名</b>
                                            ${renderDeploymentRows(hostRows, 'host', '暂无外部域名回流')}
                                        </div>
                                        <div>
                                            <b>页面分布</b>
                                            ${renderDeploymentRows(pageRows, 'page_id', '暂无外部页面回流')}
                                        </div>
                                    </div>
                                </div>
                                <div class="engagement-external-checks">
                                    ${checks.length ? checks.map((check) => `
                                        <article data-status="${escapeHtml(check.status || 'idle')}">
                                            <i class="fas ${escapeHtml(getDiagnosticStatusIcon(check.status))}" aria-hidden="true"></i>
                                            <div>
                                                <strong>${escapeHtml(check.label || '检查项')}</strong>
                                                <p>${escapeHtml(check.detail || '')}</p>
                                            </div>
                                        </article>
                                    `).join('') : `<div class="engagement-empty">保存配置后会显示外部承载诊断。</div>`}
                                </div>
                                ${deploymentSteps.length ? `
                                    <ol class="engagement-external-steps">
                                        ${deploymentSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
                                    </ol>
                                ` : ''}
                            </div>
                        </details>
                    </div>
                </div>
            </section>
        `;
    }

    function renderGlobalGuardrails(payload = {}) {
        const governance = payload.governance || {};
        const items = [
            ['同屏最多一个主动气泡', '公共 runtime 会按优先级选择最高的一条展示。'],
            ['事件型规则隔离', `${formatNumber(governance.event_rules)} 条事件规则不会被普通页面浏览误触发。`],
            ['用户关闭后尊重冷却', '规则保留关闭冷却小时数，机器人会避免反复打扰。'],
            ['高风险变更留痕', '创建、发布、暂停、归档和一键暂停都会写入审计记录。']
        ];
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>发布护栏</h3>
                        <p>这些策略定义客服系统的全局行为边界，保障运营触达不破坏用户体验。</p>
                    </div>
                </div>
                <div class="engagement-guardrail-list">
                    ${items.map(([title, desc]) => `
                        <article class="engagement-guardrail-row">
                            <i class="fas fa-check" aria-hidden="true"></i>
                            <div>
                                <strong>${escapeHtml(title)}</strong>
                                <p>${escapeHtml(desc)}</p>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderWorkspaceGroupNav(payload = {}) {
        const activeGroup = getWorkspaceGroupForView(state.activeView);
        return `
            <nav class="engagement-workspace-group-nav" aria-label="客服系统一级导航">
                ${WORKSPACE_GROUPS.map(([id, label, icon, desc]) => {
                    const isActive = activeGroup[0] === id;
                    return `
                        <button type="button"
                            class="engagement-workspace-group-tab ${isActive ? 'is-active' : ''}"
                            data-engagement-workspace-group="${escapeHtml(id)}"
                            aria-pressed="${isActive ? 'true' : 'false'}"
                            title="${escapeHtml(desc)}">
                            <span class="engagement-workspace-group-tab__label">${escapeHtml(label)}</span>
                        </button>
                    `;
                }).join('')}
            </nav>
        `;
    }

    function renderWorkspaceNav(payload = {}) {
        const activeView = getWorkspaceView(state.activeView);
        const activeGroup = getWorkspaceGroupForView(activeView[0]);
        const groupViews = getWorkspaceGroupViews(activeGroup[0]);
        return `
            <section class="engagement-workspace-nav-shell">
                <nav class="engagement-workspace-nav" aria-label="客服系统二级导航">
                ${groupViews.map(([id, label, icon, desc]) => {
                    const isActive = activeView[0] === id;
                    return `
                        <button type="button"
                            class="engagement-workspace-tab ${isActive ? 'is-active' : ''}"
                            data-engagement-workspace-view="${escapeHtml(id)}"
                            aria-pressed="${isActive ? 'true' : 'false'}"
                            title="${escapeHtml(desc)}">
                            <span class="engagement-workspace-tab__label">${escapeHtml(label)}</span>
                        </button>
                    `;
                }).join('')}
                </nav>
            </section>
        `;
    }

    function renderWorkspacePlaceholder(viewId = '') {
        const [, label, icon, desc] = getWorkspaceView(viewId);
        return `
            <section class="engagement-section engagement-workspace-placeholder">
                <div class="engagement-workspace-placeholder__icon">
                    <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
                </div>
                <div>
                    <h3>${escapeHtml(label)}</h3>
                    <p>${escapeHtml(desc)}。该产品页已进入 Customer Engagement Hub 规划，后续会接入独立数据、权限和操作流。</p>
                </div>
                <div class="engagement-chip-row">
                    <span>独立产品页</span>
                    <span>权限治理</span>
                    <span>效果追踪</span>
                </div>
            </section>
        `;
    }

    function renderColorField(name, label, value, placeholder = '#6b9ece') {
        const color = normalizeHexColor(value, placeholder);
        return `
            <label class="engagement-field engagement-color-field" data-engagement-color-field>
                <span>${escapeHtml(label)}</span>
                <div class="engagement-color-input">
                    <i style="background:${escapeHtml(color)}" aria-hidden="true" data-engagement-color-swatch></i>
                    <input name="${escapeHtml(name)}" type="text" maxlength="7" value="${escapeHtml(color)}" placeholder="${escapeHtml(placeholder)}" data-engagement-color-value>
                    ${renderCustomSelect({
                        name: `${name}_preset`,
                        value: getColorPresetValue(color),
                        options: COLOR_PRESET_OPTIONS,
                        label: '颜色预设'
                    })}
                </div>
            </label>
        `;
    }

    function renderAssetStylePresetGallery() {
        const style = getAssetCenter().style;
        const currentPreset = normalizeToken(style.preset, 'studio_blue');
        return `
            <section class="engagement-section engagement-asset-preset-gallery">
                <div class="engagement-section__head">
                    <div>
                        <h3>样式预设包</h3>
                        <p>保留自定义颜色，同时提供可一键套用的商业场景视觉包。</p>
                    </div>
                </div>
                <div class="engagement-asset-preset-grid">
                    ${ASSET_STYLE_PRESET_PACKS.map((preset) => {
                        const isActive = currentPreset === preset.id;
                        return `
                            <article class="engagement-asset-preset-card ${isActive ? 'is-active' : ''}">
                                <div>
                                    <strong>${escapeHtml(preset.title)}</strong>
                                    <p>${escapeHtml(preset.desc)}</p>
                                    <div class="engagement-asset-preset-card__swatches" aria-hidden="true">
                                        ${preset.swatches.map((color) => `<i style="background:${escapeHtml(color)}"></i>`).join('')}
                                    </div>
                                </div>
                                <button type="button"
                                    data-engagement-action="apply-asset-style-preset"
                                    data-asset-style-preset="${escapeHtml(preset.id)}"
                                    ${isActive ? 'disabled' : ''}>
                                    <i class="fas ${isActive ? 'fa-check' : 'fa-wand-magic-sparkles'}" aria-hidden="true"></i>
                                    <span>${isActive ? '正在使用' : '套用预设'}</span>
                                </button>
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    }

    function renderAssetStyleComposer() {
        const style = getAssetCenter().style;
        return `
            <section class="engagement-section engagement-management-composer engagement-asset-style-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>气泡视觉样式</h3>
                        <p>统一管理前台客服机器人吐出的气泡色彩、宽度、圆角、密度和动效。</p>
                    </div>
                </div>
                <form id="engagementAssetStyleForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    <input type="hidden" name="preset" value="${escapeHtml(style.preset || 'studio_blue')}">
                    <div class="engagement-form-grid engagement-management-grid">
                        ${renderColorField('accent_color', '主色', style.accent_color, '#6b9ece')}
                        ${renderColorField('title_color', '标题色', style.title_color, '#5f95cc')}
                        ${renderColorField('bubble_background', '气泡背景', style.bubble_background, '#ffffff')}
                        ${renderColorField('text_color', '正文色', style.text_color, '#1f2937')}
                        <label class="engagement-field">
                            <span>圆角</span>
                            <input name="radius_px" type="number" min="12" max="32" value="${escapeHtml(style.radius_px || 22)}">
                        </label>
                        <label class="engagement-field">
                            <span>最大宽度</span>
                            <input name="max_width_px" type="number" min="260" max="560" value="${escapeHtml(style.max_width_px || 520)}">
                        </label>
                        <label class="engagement-field">
                            <span>密度</span>
                            ${renderCustomSelect({
                                name: 'density',
                                value: style.density || 'comfortable',
                                options: STYLE_DENSITY_OPTIONS,
                                label: '密度'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>阴影</span>
                            ${renderCustomSelect({
                                name: 'shadow',
                                value: style.shadow || 'soft',
                                options: STYLE_SHADOW_OPTIONS,
                                label: '阴影'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>动效</span>
                            ${renderCustomSelect({
                                name: 'animation',
                                value: style.animation || 'gentle',
                                options: STYLE_ANIMATION_OPTIONS,
                                label: '动效'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>机器人形态</span>
                            ${renderCustomSelect({
                                name: 'robot_variant',
                                value: style.robot_variant || 'default',
                                options: ROBOT_VARIANT_OPTIONS,
                                label: '机器人形态'
                            })}
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>样式中心</span>
                            ${renderCustomSwitch({
                                name: 'enabled',
                                checked: style.enabled !== false,
                                label: '前台使用这套视觉配置'
                            })}
                        </div>
                    </div>
                    <div class="engagement-asset-preview" style="--preview-accent:${escapeHtml(style.accent_color)};--preview-title:${escapeHtml(style.title_color)};--preview-bg:${escapeHtml(style.bubble_background)};--preview-text:${escapeHtml(style.text_color)};--preview-radius:${escapeHtml(style.radius_px || 22)}px;--preview-width:${escapeHtml(style.max_width_px || 520)}px">
                        <div class="engagement-asset-preview__bubble">
                            <strong>优惠券已到账</strong>
                            <p>0.8折优惠券已发放到你的钱包。请前往“我的钱包 > 卡券”查看。</p>
                            <span>我的钱包 > 卡券</span>
                        </div>
                    </div>
                    <div class="engagement-form-actions">
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-asset-style">
                            <i class="fas fa-save"></i>
                            <span>保存样式</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderAssetComposer() {
        const asset = getEditableAsset();
        const selectedPages = new Set(Array.isArray(asset?.page_ids) && asset.page_ids.length ? asset.page_ids : ['all']);
        return `
            <section class="engagement-section engagement-management-composer engagement-asset-composer">
                <div class="engagement-section__head">
                    <div>
                        <h3>${asset ? '编辑素材' : '新建素材'}</h3>
                        <p>沉淀不同页面、不同语气可复用的图标、角标、图片或插画素材。</p>
                    </div>
                    ${asset ? `<button type="button" class="engagement-link-btn" data-engagement-action="reset-asset">新建素材</button>` : ''}
                </div>
                <form id="engagementAssetForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    <input type="hidden" name="id" value="${escapeHtml(asset?.id || '')}">
                    <div class="engagement-form-grid engagement-management-grid">
                        <label class="engagement-field engagement-field--name">
                            <span>素材名称</span>
                            <input name="name" type="text" maxlength="120" value="${escapeHtml(asset?.name || '')}" placeholder="例如：优惠券角标" required>
                        </label>
                        <label class="engagement-field">
                            <span>素材类型</span>
                            ${renderCustomSelect({
                                name: 'type',
                                value: asset?.type || 'icon',
                                options: ASSET_TYPE_OPTIONS,
                                label: '素材类型'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>语气</span>
                            ${renderCustomSelect({
                                name: 'tone',
                                value: asset?.tone || 'info',
                                options: RULE_TONE_OPTIONS,
                                label: '语气'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>FontAwesome 图标</span>
                            <input name="icon" type="text" maxlength="80" value="${escapeHtml(asset?.icon || 'fa-robot')}" placeholder="fa-ticket">
                        </label>
                        <label class="engagement-field engagement-form-field--full">
                            <span>图片 URL</span>
                            <input name="url" type="text" maxlength="1000" value="${escapeHtml(asset?.url || '')}" placeholder="https://...">
                        </label>
                        <label class="engagement-field engagement-form-field--full">
                            <span>说明</span>
                            <input name="description" type="text" maxlength="500" value="${escapeHtml(asset?.description || '')}" placeholder="给管理员看的素材用途">
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>启用状态</span>
                            ${renderCustomSwitch({
                                name: 'enabled',
                                checked: asset?.enabled !== false,
                                label: '允许被规则和模板使用'
                            })}
                        </div>
                    </div>
                    <div class="engagement-form-block">
                        <span>适用页面</span>
                        ${renderPagePicker(selectedPages)}
                    </div>
                    <div class="engagement-form-actions">
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-asset">
                            <i class="fas fa-save"></i>
                            <span>${asset ? '保存素材' : '创建素材'}</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderAssetLibrary() {
        const assets = getAssetCenter().assets;
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>素材库</h3>
                        <p>素材先以轻量配置管理，后续可以平滑升级到独立资源表和上传流程。</p>
                    </div>
                </div>
                <div class="engagement-asset-grid">
                    ${assets.length ? assets.map((asset) => `
                        <article class="engagement-asset-card" data-tone="${escapeHtml(asset.tone || 'info')}">
                            <span class="engagement-asset-card__icon">
                                <i class="fas ${escapeHtml(asset.icon || 'fa-robot')}" aria-hidden="true"></i>
                            </span>
                            <div>
                                <strong>${escapeHtml(asset.name || '未命名素材')}</strong>
                                <p>${escapeHtml(asset.description || getOptionLabel(ASSET_TYPE_OPTIONS, asset.type || 'icon'))}</p>
                                <div class="engagement-chip-row">
                                    <span>${escapeHtml(getOptionLabel(ASSET_TYPE_OPTIONS, asset.type || 'icon'))}</span>
                                    <span>${escapeHtml(getOptionLabel(RULE_TONE_OPTIONS, asset.tone || 'info'))}</span>
                                    <span>${escapeHtml(getAssetScopeLabel(asset))}</span>
                                    <span>${asset.enabled === false ? '停用' : '启用'}</span>
                                </div>
                            </div>
                            <div class="engagement-inline-actions">
                                <button type="button" title="编辑素材" data-engagement-action="edit-asset" data-asset-id="${escapeHtml(asset.id || '')}">
                                    <i class="fas fa-pen"></i>
                                </button>
                                <button type="button" title="删除素材" data-engagement-action="delete-asset" data-asset-id="${escapeHtml(asset.id || '')}">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </article>
                    `).join('') : `<div class="engagement-empty">暂无素材，可以先创建优惠券、回复、权限等常用触达素材。</div>`}
                </div>
            </section>
        `;
    }

    function renderAssetUsageMatrix() {
        const rows = getAssetUsageByPage();
        return `
            <section class="engagement-section engagement-asset-scope-matrix">
                <div class="engagement-section__head">
                    <div>
                        <h3>素材适用范围</h3>
                        <p>检查每个公共页是否有可用素材，避免规则找不到合适的图标或角标。</p>
                    </div>
                </div>
                <div class="engagement-asset-scope-grid">
                    ${rows.map((row) => `
                        <article class="engagement-asset-scope-row" data-status="${row.enabled > 0 ? 'ok' : 'warning'}">
                            <i class="fas ${row.enabled > 0 ? 'fa-check' : 'fa-triangle-exclamation'}" aria-hidden="true"></i>
                            <div>
                                <strong>${escapeHtml(row.page_label)}</strong>
                                <p>${escapeHtml(formatNumber(row.enabled))}/${escapeHtml(formatNumber(row.assets))} 可用素材 · ${escapeHtml(formatNumber(row.tones))} 种语气覆盖</p>
                            </div>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderEntrySettingsComposer() {
        const entry = getSupportEntryCenter();
        return `
            <section class="engagement-section engagement-management-composer engagement-entry-settings">
                <div class="engagement-section__head">
                    <div>
                        <h3>客服入口总控</h3>
                        <p>管理公共页机器人里的“常用入口”、在线客服、TG 人工客服和工单提交能力。</p>
                    </div>
                </div>
                <form id="engagementEntrySettingsForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    <div class="engagement-form-grid engagement-management-grid">
                        <label class="engagement-field">
                            <span>中文入口名</span>
                            <input name="entry_label" type="text" maxlength="80" value="${escapeHtml(entry.entry_label)}" placeholder="常用入口">
                        </label>
                        <label class="engagement-field">
                            <span>英文入口名</span>
                            <input name="entry_label_en" type="text" maxlength="80" value="${escapeHtml(entry.entry_label_en)}" placeholder="Quick Help">
                        </label>
                        <label class="engagement-field">
                            <span>TG 人工客服</span>
                            <input name="telegram_url" type="text" maxlength="1000" value="${escapeHtml(entry.telegram_url)}" placeholder="https://t.me/zaoyoe">
                        </label>
                        <label class="engagement-field">
                            <span>工单响应目标（小时）</span>
                            <input name="ticket_sla_hours" type="number" min="1" max="168" value="${escapeHtml(entry.ticket_sla_hours)}">
                        </label>
                        <label class="engagement-field engagement-form-field--full">
                            <span>工单提示语</span>
                            <input name="ticket_prompt" type="text" maxlength="500" value="${escapeHtml(entry.ticket_prompt)}" placeholder="告诉用户应该提交什么信息">
                        </label>
                        <label class="engagement-field">
                            <span>工单输入占位</span>
                            <input name="ticket_placeholder" type="text" maxlength="160" value="${escapeHtml(entry.ticket_placeholder)}" placeholder="输入关联 ID 和问题描述">
                        </label>
                        <label class="engagement-field">
                            <span>工单输入提示</span>
                            <input name="ticket_input_hint" type="text" maxlength="500" value="${escapeHtml(entry.ticket_input_hint)}" placeholder="示例：order:订单号 卡密未到账">
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>入口总开关</span>
                            ${renderCustomSwitch({
                                name: 'enabled',
                                checked: entry.enabled,
                                label: '公共页展示客服快捷入口'
                            })}
                        </div>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>工单能力</span>
                            ${renderCustomSwitch({
                                name: 'ticket_enabled',
                                checked: entry.ticket_enabled,
                                label: '允许登录用户提交工单'
                            })}
                        </div>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>在线客服</span>
                            ${renderCustomSwitch({
                                name: 'live_chat_enabled',
                                checked: entry.live_chat_enabled,
                                label: '保留在线客服聊天入口'
                            })}
                        </div>
                    </div>
                    <div class="engagement-form-actions">
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-entry-settings">
                            <i class="fas fa-save"></i>
                            <span>保存入口</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderEntryContextComposer() {
        const context = getEditableSupportContext();
        const contextId = normalizeToken(context?.id || 'default', 'default');
        return `
            <section class="engagement-section engagement-management-composer engagement-entry-context">
                <div class="engagement-section__head">
                    <div>
                        <h3>页面入口配置</h3>
                        <p>不同页面可以展示不同快捷入口，先自助排查，再进入工单或在线客服。</p>
                    </div>
                </div>
                <form id="engagementEntryContextForm" class="engagement-rule-form engagement-management-form" autocomplete="off" novalidate>
                    <div class="engagement-form-grid engagement-management-grid">
                        <label class="engagement-field">
                            <span>页面</span>
                            ${renderCustomSelect({
                                name: 'id',
                                value: contextId,
                                options: SUPPORT_CONTEXT_OPTIONS,
                                label: '页面'
                            })}
                        </label>
                        <label class="engagement-field">
                            <span>入口标题</span>
                            <input name="label" type="text" maxlength="80" value="${escapeHtml(context?.label || '')}" placeholder="例如：商城快捷入口">
                        </label>
                        <label class="engagement-field engagement-form-field--full">
                            <span>入口说明</span>
                            <input name="intro" type="text" maxlength="500" value="${escapeHtml(context?.intro || '')}" placeholder="告诉用户这里能解决哪些问题">
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>页面入口</span>
                            ${renderCustomSwitch({
                                name: 'enabled',
                                checked: context?.enabled !== false,
                                label: '启用这个页面的快捷入口'
                            })}
                        </div>
                    </div>
                    <div class="engagement-form-block">
                        <span>快捷动作</span>
                        ${renderSupportActionPicker(context?.shortcuts || [])}
                    </div>
                    <div class="engagement-form-actions">
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-entry-context">
                            <i class="fas fa-save"></i>
                            <span>保存页面入口</span>
                        </button>
                    </div>
                </form>
            </section>
        `;
    }

    function renderEntryContextMap() {
        const entry = getSupportEntryCenter();
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>入口版图</h3>
                        <p>这些配置会下发给公共页客服机器人，用户打开机器人后看到对应页面的快捷入口。</p>
                    </div>
                </div>
                <div class="engagement-entry-grid">
                    ${entry.contexts.map((context) => `
                        <article class="engagement-entry-card ${normalizeToken(state.editingSupportContextId || 'default', 'default') === normalizeToken(context.id || 'default', 'default') ? 'is-focused' : ''}">
                            <div class="engagement-entry-card__icon">
                                <i class="fas fa-headset" aria-hidden="true"></i>
                            </div>
                            <div>
                                <strong>${escapeHtml(context.label || getOptionLabel(SUPPORT_CONTEXT_OPTIONS, context.id || 'default'))}</strong>
                                <p>${escapeHtml(context.intro || '暂无入口说明')}</p>
                                <div class="engagement-chip-row">
                                    <span>${escapeHtml(getOptionLabel(SUPPORT_CONTEXT_OPTIONS, context.id || 'default'))}</span>
                                    <span>${context.enabled === false ? '停用' : '启用'}</span>
                                    <span>${formatNumber(Array.isArray(context.shortcuts) ? context.shortcuts.length : 0)} 个动作</span>
                                </div>
                            </div>
                            <button type="button" class="engagement-page-card__action" data-engagement-action="edit-entry-context" data-context-id="${escapeHtml(context.id || 'default')}">
                                编辑
                            </button>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderEntryGuidePanel() {
        const guides = getSupportEntryCenter().guides;
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>工单引导模板</h3>
                        <p>把复杂问题先引导到自助动作，再保留可提交工单的描述模板，降低客服来回追问信息的成本。</p>
                    </div>
                </div>
                <div class="engagement-entry-guide-list">
                    ${guides.length ? guides.map((guide) => `
                        <article class="engagement-entry-guide">
                            <div>
                                <strong>${escapeHtml(guide.title || '工单引导')}</strong>
                                <p>${escapeHtml(guide.description || guide.ticket_template || '暂无说明')}</p>
                                <div class="engagement-chip-row">
                                    ${(Array.isArray(guide.page_ids) ? guide.page_ids : ['all']).map((pageId) => `<span>${escapeHtml(getPageLabel(pageId))}</span>`).join('')}
                                    <span>${escapeHtml(getOptionLabel(SUPPORT_ACTION_OPTIONS, guide.action_id || 'create_ticket'))}</span>
                                    <span>优先级 ${escapeHtml(guide.priority || 0)}</span>
                                </div>
                            </div>
                            <code>${escapeHtml(guide.ticket_template || '用户会在这里补充问题描述')}</code>
                        </article>
                    `).join('') : `<div class="engagement-empty">暂无工单引导模板。</div>`}
                </div>
            </section>
        `;
    }

    function renderDashboardWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--dashboard">
                <div class="engagement-hero-grid">
                    ${renderSchemaNotice(payload)}
                    ${renderMetrics(payload.metrics || {})}
                </div>
                ${renderLaunchReadinessPanel(payload)}
                ${renderLifecycleDiagnostics(payload)}
                ${renderFrontendExperienceQA(payload.analytics || {})}
                ${renderPageScenes(payload.page_scenes || [])}
                <div class="engagement-two-column">
                    ${renderTemplates(payload.templates || [])}
                    ${renderRules(payload.rules || [])}
                </div>
                ${renderCapabilityMap()}
            </div>
        `;
    }

    function renderRulesWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--rules">
                <div class="engagement-rule-workbench">
                    ${renderRuleComposer()}
                    ${renderRulePreviewPanel()}
                </div>
                ${renderRules(payload.rules || [])}
            </div>
        `;
    }

    function renderTemplatesWorkspace(payload = {}) {
        const templates = payload.templates || [];
        return `
            <div class="engagement-workspace-view engagement-workspace-view--templates">
                ${renderTemplateProductShelf(templates)}
                <div class="engagement-two-column">
                    ${renderTemplateComposer()}
                    ${renderTemplatePreviewPanel()}
                </div>
                <div class="engagement-two-column">
                    ${renderTemplates(templates)}
                    ${renderTemplatePerformanceInsights(templates)}
                </div>
                ${renderCapabilityMap()}
            </div>
        `;
    }

    function renderScenesWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--scenes">
                <div class="engagement-two-column">
                    ${renderSceneComposer()}
                    ${renderScenePreviewPanel()}
                </div>
                ${renderEventPriorityCenterComposer()}
                ${renderPageScenes(payload.page_scenes || [])}
                ${renderCapabilityMap()}
            </div>
        `;
    }

    function renderSegmentsWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--segments">
                ${renderUserTagCenter()}
                ${renderSegmentComposer()}
                ${renderAudienceSegments(getAudienceSegments())}
                ${renderRules(payload.rules || [])}
            </div>
        `;
    }

    function renderAutomationWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--automation">
                ${renderAutomationCommandCenter()}
                ${renderAutomationBlueprints()}
                ${renderAutomationFlowMatrix()}
                <div class="engagement-rule-workbench">
                    ${renderRuleComposer()}
                    ${renderRulePreviewPanel()}
                </div>
                ${renderRules(payload.rules || [])}
            </div>
        `;
    }

    function renderEntryWorkspace() {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--entry">
                <div class="engagement-two-column">
                    ${renderEntrySettingsComposer()}
                    ${renderEntryContextComposer()}
                </div>
                ${renderEntryContextMap()}
                ${renderEntryGuidePanel()}
            </div>
        `;
    }

    function renderAnalyticsWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--analytics">
                <div class="engagement-hero-grid">
                    ${renderSchemaNotice(payload)}
                    ${renderMetrics(payload.metrics || {})}
                </div>
                ${renderAnalyticsCommandCenter(payload.analytics || {})}
                ${renderAnalyticsRecommendations(payload.analytics || {})}
                ${renderLifecycleDiagnostics(payload)}
                ${renderFrontendExperienceQA(payload.analytics || {})}
                ${renderAnalyticsFunnel(payload.analytics || {})}
                ${renderAttributionSummary(payload.analytics || {})}
                <div class="engagement-two-column">
                    ${renderPagePerformance(payload.analytics || {})}
                    ${renderRulePerformance(payload.analytics || {})}
                </div>
                <div class="engagement-two-column">
                    ${renderPlacementPerformance(payload.analytics || {})}
                    ${renderActionPerformance(payload.analytics || {})}
                </div>
                <div class="engagement-two-column">
                    ${renderTriggerPerformance(payload.analytics || {})}
                    ${renderAudiencePerformance(payload.analytics || {})}
                </div>
                ${renderDevicePerformance(payload.analytics || {})}
                ${renderSourcePerformance(payload.analytics || {})}
            </div>
        `;
    }

    function renderAssetsWorkspace() {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--assets">
                ${renderAssetStylePresetGallery()}
                <div class="engagement-two-column">
                    ${renderAssetStyleComposer()}
                    ${renderAssetComposer()}
                </div>
                ${renderAssetLibrary()}
                ${renderAssetUsageMatrix()}
            </div>
        `;
    }

    function renderAuditWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--audit">
                ${renderGovernanceReviewQueue(payload)}
                ${renderAuditBatchGroups(payload.audit_logs || [])}
                ${renderAuditLogs(payload.audit_logs || [])}
                ${renderGovernanceSummary(payload)}
                ${renderPermissionGuardrails()}
            </div>
        `;
    }

    function renderSettingsWorkspace(payload = {}) {
        return `
            <div class="engagement-workspace-view engagement-workspace-view--settings">
                ${renderExternalEmbedPanel(payload)}
                ${renderLaunchReadinessPanel(payload)}
                ${renderLifecycleDiagnostics(payload)}
                ${renderFrontendExperienceQA(payload.analytics || {})}
                ${renderGovernanceReviewQueue(payload)}
                ${renderGovernanceSummary(payload)}
                ${renderPermissionGuardrails()}
                ${renderGlobalGuardrails(payload)}
            </div>
        `;
    }

    function renderWorkspaceView(payload = {}) {
        const activeView = getWorkspaceView(state.activeView)[0];
        switch (activeView) {
            case 'dashboard':
                return renderDashboardWorkspace(payload);
            case 'rules':
                return renderRulesWorkspace(payload);
            case 'templates':
                return renderTemplatesWorkspace(payload);
            case 'scenes':
                return renderScenesWorkspace(payload);
            case 'segments':
                return renderSegmentsWorkspace(payload);
            case 'automation':
                return renderAutomationWorkspace(payload);
            case 'entry':
                return renderEntryWorkspace(payload);
            case 'analytics':
                return renderAnalyticsWorkspace(payload);
            case 'assets':
                return renderAssetsWorkspace(payload);
            case 'audit':
                return renderAuditWorkspace(payload);
            case 'settings':
                return renderSettingsWorkspace(payload);
            default:
                return renderWorkspacePlaceholder(activeView);
        }
    }

    function renderOverviewHealthNotice(payload = {}) {
        const health = payload.overview_health && typeof payload.overview_health === 'object' ? payload.overview_health : {};
        const degradedTasks = Array.isArray(health.degraded_tasks) ? health.degraded_tasks : [];
        const timedOutTasks = Array.isArray(health.timed_out_tasks) ? health.timed_out_tasks : [];
        if (health.status !== 'degraded' || (!degradedTasks.length && !timedOutTasks.length)) return '';
        const taskNames = (timedOutTasks.length ? timedOutTasks : degradedTasks.map((item) => item.label))
            .filter(Boolean)
            .slice(0, 4);
        return `
            <section class="engagement-overview-health" data-status="degraded">
                <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>部分数据延迟</strong>
                    <p>${escapeHtml(taskNames.length ? `${taskNames.join('、')} 暂时降级，已先展示可用数据。` : '部分后台数据暂时降级，已先展示可用数据。')}</p>
                </div>
                <button type="button" class="engagement-link-btn" data-engagement-action="refresh">重新加载</button>
            </section>
        `;
    }

    function renderOverview(payload = {}) {
        const container = getOverviewContainer();
        if (!container) return;

        state.payload = payload;
        state.activeView = getWorkspaceView(state.activeView)[0];
        container.classList.remove('engagement-overview--loading');
        container.innerHTML = `
            ${renderWorkspaceGroupNav(payload)}
            ${renderWorkspaceNav(payload)}
            ${renderOverviewHealthNotice(payload)}
            ${renderWorkspaceView(payload)}
        `;
        bindEngagementDirectHandlers(container);
        updateRulePreviewFromForm();
        updateTemplatePreviewFromForm();
        updateScenePreviewFromForm();

        if (state.focusedPageId && state.pendingFocusedPageScroll === true) {
            state.pendingFocusedPageScroll = false;
            const focused = container.querySelector(`[data-engagement-page="${state.focusedPageId}"]`);
            focused?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function collectRuleFormPayload(form) {
        syncRulePublishAtHiddenValue(form);
        const formData = new FormData(form);
        const pageIds = formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean);
        const audienceScope = normalizeToken(formData.get('audience_scope') || 'all', 'all');
        const triggerType = normalizeToken(formData.get('trigger_type') || 'page_view', 'page_view');
        const placement = normalizeToken(formData.get('placement') || 'robot_bubble', 'robot_bubble');
        const currentRule = getEditableRule();
        const ruleDraft = currentRule ? null : getRuleDraft();
        const templateDraft = currentRule || ruleDraft ? null : getTemplateDraft();
        const ruleSource = currentRule || ruleDraft || {};
        const startsAt = normalizeRuleDateTimePayload(getRulePublishAtControlValue(form) || formData.get('starts_at'));
        const status = normalizeRuleStatusForSchedule(formData.get('status') || 'draft', startsAt);
        const enabled = status === 'published';
        const payload = {
            action: 'save_rule',
            id: String(formData.get('id') || '').trim(),
            name: String(formData.get('name') || '').trim(),
            site: String(formData.get('site') || 'all').trim(),
            status,
            priority: Number.parseInt(formData.get('priority') || '0', 10) || 0,
            page_ids: pageIds.length ? pageIds : ['all'],
            audience: { scope: audienceScope },
            trigger_type: triggerType,
            placement,
            title: String(formData.get('title') || '').trim(),
            content: String(formData.get('content') || '').trim(),
            tone: String(formData.get('tone') || 'info').trim(),
            action_label: String(formData.get('action_label') || '').trim(),
            action_url: String(formData.get('action_url') || '').trim(),
            starts_at: startsAt,
            repeat_interval_minutes: getRuleRepeatIntervalMinutes({
                repeat_interval_minutes: formData.get('repeat_interval_minutes')
            }, 2),
            dismiss_ttl_hours: Number.parseInt(formData.get('dismiss_ttl_hours') || '24', 10) || 24,
            enabled
        };
        if (templateDraft && !payload.id) {
            payload.metadata = {
                source_template_id: String(templateDraft.id || '').trim(),
                source_template_key: String(templateDraft.key || '').trim(),
                source_template_name: String(templateDraft.name || templateDraft.title || '').trim(),
                template_category: normalizeToken(templateDraft.category, 'general')
            };
        }
        const linkageMetadata = getRuleLinkageMetadata(ruleSource, templateDraft);
        if (Object.keys(linkageMetadata).length) {
            payload.metadata = {
                ...(payload.metadata || {}),
                ...linkageMetadata
            };
        }
        return payload;
    }

    function collectRulePreviewFormData() {
        const form = document.getElementById('engagementRuleForm');
        if (!(form instanceof HTMLFormElement)) {
            return getInitialRulePreviewData();
        }
        syncRulePublishAtHiddenValue(form);
        const formData = new FormData(form);
        const pageIds = formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean);
        const audienceScope = normalizeToken(formData.get('audience_scope') || 'all', 'all');
        const triggerType = normalizeToken(formData.get('trigger_type') || 'page_view', 'page_view');
        const placement = normalizeToken(formData.get('placement') || 'robot_bubble', 'robot_bubble');
        const startsAt = normalizeRuleDateTimePayload(getRulePublishAtControlValue(form) || formData.get('starts_at'));
        const status = normalizeRuleStatusForSchedule(formData.get('status') || 'draft', startsAt);
        return {
            name: String(formData.get('name') || '').trim(),
            site: String(formData.get('site') || 'all').trim(),
            status,
            page_ids: pageIds.length ? pageIds : ['all'],
            audience: { scope: audienceScope },
            trigger_type: triggerType,
            placement,
            title: String(formData.get('title') || '').trim(),
            content: String(formData.get('content') || '').trim(),
            tone: String(formData.get('tone') || 'info').trim(),
            action_label: String(formData.get('action_label') || '').trim(),
            action_url: String(formData.get('action_url') || '').trim(),
            starts_at: startsAt,
            repeat_interval_minutes: getRuleRepeatIntervalMinutes({
                repeat_interval_minutes: formData.get('repeat_interval_minutes')
            }, 2),
            enabled: status === 'published'
        };
    }

    function collectTemplatePreviewFormData() {
        const form = document.getElementById('engagementTemplateForm');
        if (!(form instanceof HTMLFormElement)) {
            return getInitialTemplatePreviewData();
        }
        const formData = new FormData(form);
        const pageIds = formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean);
        const editableTemplate = getEditableTemplate();
        const currentMetadata = editableTemplate?.metadata && typeof editableTemplate.metadata === 'object' && !Array.isArray(editableTemplate.metadata)
            ? editableTemplate.metadata
            : {};
        const draftTemplate = {
            name: String(formData.get('name') || '').trim(),
            key: String(formData.get('key') || '').trim(),
            page_ids: pageIds.length ? pageIds : ['all'],
            title: String(formData.get('title') || '').trim(),
            content: String(formData.get('content') || '').trim(),
            tone: String(formData.get('tone') || 'info').trim(),
            action_label: String(formData.get('action_label') || '').trim(),
            action_url: String(formData.get('action_url') || '').trim(),
            metadata: currentMetadata
        };
        return {
            name: draftTemplate.name,
            site: getCurrentSite(),
            status: 'draft',
            page_ids: draftTemplate.page_ids,
            audience: { scope: 'all' },
            trigger_type: getTemplatePreferredTriggerType(draftTemplate),
            placement: 'robot_bubble',
            title: draftTemplate.title || draftTemplate.name,
            content: draftTemplate.content,
            tone: draftTemplate.tone || 'info',
            action_label: draftTemplate.action_label,
            action_url: draftTemplate.action_url,
            enabled: false
        };
    }

    function collectRuleGovernanceFormData(form) {
        if (!(form instanceof HTMLFormElement)) return {};
        const formData = new FormData(form);
        const pageIds = formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean);
        return {
            page_ids: pageIds.length ? pageIds : ['all'],
            placement: normalizeToken(formData.get('placement') || 'robot_bubble', 'robot_bubble'),
            tone: normalizeToken(formData.get('tone') || 'info', 'info'),
            priority: Number.parseInt(formData.get('priority') || '0', 10) || 0,
            action_label: String(formData.get('action_label') || '').trim(),
            action_url: String(formData.get('action_url') || '').trim()
        };
    }

    function updateRuleGovernanceFromForm() {
        const slot = document.querySelector('[data-engagement-rule-governance-slot]');
        const form = document.getElementById('engagementRuleForm');
        if (!(slot instanceof HTMLElement) || !(form instanceof HTMLFormElement)) return false;
        const markup = renderRuleGovernanceNotice(getRuleGovernance(collectRuleGovernanceFormData(form)));
        slot.innerHTML = markup;
        slot.hidden = !markup;
        return true;
    }

    function updatePreviewControlState(shell) {
        if (!(shell instanceof HTMLElement)) return;
        shell.dataset.previewDevice = state.previewDevice;
        shell.dataset.previewTheme = state.previewTheme;
        shell.querySelectorAll('[data-engagement-action="set-preview-option"]').forEach((button) => {
            if (!(button instanceof HTMLElement)) return;
            const key = String(button.dataset.previewKey || '').trim();
            const value = String(button.dataset.previewValue || '').trim();
            const selected = (key === 'device' && value === state.previewDevice)
                || (key === 'theme' && value === state.previewTheme);
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function updateRuleEffectiveStatusNote(previewData = collectRulePreviewFormData()) {
        const form = document.getElementById('engagementRuleForm');
        const publishAtValue = form instanceof HTMLFormElement ? getRulePublishAtControlValue(form) : '';
        const effectiveStatusData = publishAtValue
            ? {
                ...previewData,
                status: normalizeRuleStatusForSchedule(previewData.status || 'draft', publishAtValue),
                starts_at: publishAtValue,
                enabled: true
            }
            : previewData;
        const effectiveStatusInfo = getRuleEffectiveStatusInfo(effectiveStatusData);
        const statusNote = document.querySelector('[data-engagement-rule-status-note]');
        if (statusNote instanceof HTMLElement) {
            statusNote.dataset.tone = effectiveStatusInfo.tone;
            statusNote.innerHTML = renderRuleEffectiveStatusNote(effectiveStatusInfo);
        }
        return effectiveStatusInfo;
    }

    function updateRulePreviewFromForm() {
        updateRuleGovernanceFromForm();
        enforceRuleScheduledStatusSelect();
        const previewData = collectRulePreviewFormData();
        updateRuleEffectiveStatusNote(previewData);
        const shell = document.querySelector('[data-engagement-rule-preview-shell]');
        if (!(shell instanceof HTMLElement)) return false;

        const pageId = resolvePreviewPageId(previewData.page_ids);
        const previewCopy = buildRulePreviewCopy(previewData);
        const title = previewCopy.title;
        const content = previewCopy.content;
        const actionLabel = previewData.action_label || (previewData.action_url ? '查看详情' : '');
        const statusLabel = getRuleStatusLabel(previewData);
        const audienceLabel = getAudienceLabel(previewData.audience);
        const triggerTypeLabel = getTriggerTypeLabel(previewData.trigger_type);
        const placementLabel = getPlacementLabel(previewData.placement);
        const deviceLabel = state.previewDevice === 'mobile' ? '移动端' : '桌面端';
        const themeLabel = state.previewTheme === 'dark' ? '深色' : '浅色';
        const siteLabel = getOptionLabel([['all', '全站'], ['cn', 'CN'], ['intl', 'INTL']], previewData.site || 'all');
        const bubble = shell.querySelector('[data-engagement-preview-bubble]');
        const action = shell.querySelector('[data-engagement-preview-action]');
        const sampleField = shell.querySelector('[data-engagement-preview-sample-field]');
        const sampleLabelEl = shell.querySelector('[data-engagement-preview-sample-label]');

        updatePreviewControlState(shell);
        if (bubble instanceof HTMLElement) {
            bubble.dataset.tone = normalizeToken(previewData.tone, 'info');
            bubble.dataset.placement = normalizeToken(previewData.placement, 'robot_bubble');
        }
        const titleEl = shell.querySelector('[data-engagement-preview-title]');
        if (titleEl) titleEl.textContent = title;
        const contentEl = shell.querySelector('[data-engagement-preview-content]');
        if (contentEl) contentEl.textContent = content;
        const pageLabelEl = shell.querySelector('[data-engagement-preview-page-label]');
        if (pageLabelEl) pageLabelEl.textContent = getPageLabel(pageId);
        const siteEl = shell.querySelector('[data-engagement-preview-site]');
        if (siteEl) siteEl.textContent = siteLabel;
        const statusEl = shell.querySelector('[data-engagement-preview-status]');
        if (statusEl) statusEl.textContent = statusLabel;
        const audienceEl = shell.querySelector('[data-engagement-preview-audience]');
        if (audienceEl) audienceEl.textContent = audienceLabel;
        const triggerEl = shell.querySelector('[data-engagement-preview-trigger]');
        if (triggerEl) triggerEl.textContent = triggerTypeLabel;
        const placementEl = shell.querySelector('[data-engagement-preview-placement]');
        if (placementEl) placementEl.textContent = placementLabel;
        const deviceEl = shell.querySelector('[data-engagement-preview-device-label]');
        if (deviceEl) deviceEl.textContent = deviceLabel;
        const themeEl = shell.querySelector('[data-engagement-preview-theme-label]');
        if (themeEl) themeEl.textContent = themeLabel;
        if (sampleField instanceof HTMLElement) {
            const sampleOptions = getRulePreviewSampleOptions(previewData.trigger_type);
            sampleField.hidden = !sampleOptions.length;
            sampleField.innerHTML = sampleOptions.length
                ? `<span>事件样本</span>${renderRulePreviewSampleSelect(previewData.trigger_type)}`
                : '';
        }
        if (sampleLabelEl instanceof HTMLElement) {
            sampleLabelEl.hidden = !previewCopy.sampleLabel;
            sampleLabelEl.textContent = previewCopy.sampleLabel || '';
        }
        if (action instanceof HTMLAnchorElement) {
            action.textContent = actionLabel;
            action.href = previewData.action_url || '#';
            action.hidden = !actionLabel;
        }
        return true;
    }

    function updateTemplatePreviewFromForm() {
        const previewData = collectTemplatePreviewFormData();
        const shell = document.querySelector('[data-engagement-template-preview-shell]');
        if (!(shell instanceof HTMLElement)) return false;

        const pageId = resolvePreviewPageId(previewData.page_ids);
        const previewCopy = buildRulePreviewCopy(previewData);
        const title = previewCopy.title;
        const content = previewCopy.content;
        const actionLabel = previewData.action_label || (previewData.action_url ? '查看详情' : '');
        const deviceLabel = state.previewDevice === 'mobile' ? '移动端' : '桌面端';
        const themeLabel = state.previewTheme === 'dark' ? '深色' : '浅色';
        const toneLabel = getOptionLabel(RULE_TONE_OPTIONS, previewData.tone || 'info');
        const triggerTypeLabel = getTriggerTypeLabel(previewData.trigger_type);
        const bubble = shell.querySelector('[data-engagement-template-preview-bubble]');
        const action = shell.querySelector('[data-engagement-template-preview-action]');
        const sampleField = shell.querySelector('[data-engagement-template-preview-sample-field]');
        const sampleLabelEl = shell.querySelector('[data-engagement-template-preview-sample-label]');

        updatePreviewControlState(shell);
        if (bubble instanceof HTMLElement) {
            bubble.dataset.tone = normalizeToken(previewData.tone, 'info');
            bubble.dataset.placement = 'robot_bubble';
        }
        const titleEl = shell.querySelector('[data-engagement-template-preview-title]');
        if (titleEl) titleEl.textContent = title;
        const contentEl = shell.querySelector('[data-engagement-template-preview-content]');
        if (contentEl) contentEl.textContent = content;
        const pageLabelEl = shell.querySelector('[data-engagement-template-preview-page-label]');
        if (pageLabelEl) pageLabelEl.textContent = getPageLabel(pageId);
        const triggerEl = shell.querySelector('[data-engagement-template-preview-trigger]');
        if (triggerEl) triggerEl.textContent = triggerTypeLabel;
        const deviceEl = shell.querySelector('[data-engagement-template-preview-device-label]');
        if (deviceEl) deviceEl.textContent = deviceLabel;
        const themeEl = shell.querySelector('[data-engagement-template-preview-theme-label]');
        if (themeEl) themeEl.textContent = themeLabel;
        const toneEl = shell.querySelector('[data-engagement-template-preview-tone]');
        if (toneEl) toneEl.textContent = toneLabel;
        const pageMetaEl = shell.querySelector('[data-engagement-template-preview-page]');
        if (pageMetaEl) pageMetaEl.textContent = getPageLabel(pageId);
        if (sampleField instanceof HTMLElement) {
            const sampleOptions = getRulePreviewSampleOptions(previewData.trigger_type);
            sampleField.hidden = !sampleOptions.length;
            sampleField.innerHTML = sampleOptions.length
                ? `<span>事件样本</span>${renderRulePreviewSampleSelect(previewData.trigger_type)}`
                : '';
        }
        if (sampleLabelEl instanceof HTMLElement) {
            sampleLabelEl.hidden = !previewCopy.sampleLabel;
            sampleLabelEl.textContent = previewCopy.sampleLabel || '';
        }
        if (action instanceof HTMLAnchorElement) {
            action.textContent = actionLabel;
            action.href = previewData.action_url || '#';
            action.hidden = !actionLabel;
        }
        return true;
    }

    function updateScenePreviewFromForm() {
        const previewData = collectScenePreviewFormData();
        state.scenePreviewEvent = normalizeScenePreviewEvent(previewData.scene?.events || [], state.scenePreviewEvent || previewData.trigger_type || '');
        syncScenePriorityOverrideStateFromForm(previewData.scene || {});
        const shell = document.querySelector('[data-engagement-scene-preview-shell]');
        if (!(shell instanceof HTMLElement)) return false;

        const pageId = normalizeToken((previewData.page_ids || [])[0] || 'home', 'home');
        const previewCopy = buildRulePreviewCopy(previewData);
        const title = previewCopy.title;
        const content = previewCopy.content;
        const actionLabel = previewData.action_label || (previewData.action_url ? '查看详情' : '');
        const deviceLabel = state.previewDevice === 'mobile' ? '移动端' : '桌面端';
        const themeLabel = state.previewTheme === 'dark' ? '深色' : '浅色';
        const triggerTypeLabel = getTriggerTypeLabel(previewData.trigger_type);
        const placementLabel = getPlacementLabel(previewData.placement);
        const toneLabel = getOptionLabel(RULE_TONE_OPTIONS, previewData.tone || 'info');
        const bubble = shell.querySelector('[data-engagement-scene-preview-bubble]');
        const action = shell.querySelector('[data-engagement-scene-preview-action]');
        const sampleField = shell.querySelector('[data-engagement-scene-preview-sample-field]');
        const sampleLabelEl = shell.querySelector('[data-engagement-scene-preview-sample-label]');

        updatePreviewControlState(shell);
        if (bubble instanceof HTMLElement) {
            bubble.dataset.tone = normalizeToken(previewData.tone, 'info');
            bubble.dataset.placement = normalizeToken(previewData.placement, 'robot_bubble');
        }
        const titleEl = shell.querySelector('[data-engagement-scene-preview-title]');
        if (titleEl) titleEl.textContent = title;
        const contentEl = shell.querySelector('[data-engagement-scene-preview-content]');
        if (contentEl) contentEl.textContent = content;
        const pageLabelEl = shell.querySelector('[data-engagement-scene-preview-page-label]');
        if (pageLabelEl) pageLabelEl.textContent = getPageLabel(pageId);
        const safeZoneEl = shell.querySelector('[data-engagement-scene-preview-safe-zone]');
        if (safeZoneEl) safeZoneEl.textContent = getSafeZoneLabel(previewData.scene?.safe_zone || 'bottom-right');
        const triggerEl = shell.querySelector('[data-engagement-scene-preview-trigger]');
        if (triggerEl) triggerEl.textContent = triggerTypeLabel;
        const placementEl = shell.querySelector('[data-engagement-scene-preview-placement]');
        if (placementEl) placementEl.textContent = placementLabel;
        const toneEl = shell.querySelector('[data-engagement-scene-preview-tone]');
        if (toneEl) toneEl.textContent = toneLabel;
        const marketingEl = shell.querySelector('[data-engagement-scene-preview-marketing]');
        if (marketingEl) marketingEl.textContent = previewData.scene?.allow_marketing === false ? '仅服务触达' : '服务 + 营销触达';
        const deviceEl = shell.querySelector('[data-engagement-scene-preview-device-label]');
        if (deviceEl) deviceEl.textContent = deviceLabel;
        const themeEl = shell.querySelector('[data-engagement-scene-preview-theme-label]');
        if (themeEl) themeEl.textContent = themeLabel;
        if (sampleField instanceof HTMLElement) {
            const sampleOptions = getRulePreviewSampleOptions(previewData.trigger_type);
            sampleField.hidden = !sampleOptions.length;
            sampleField.innerHTML = sampleOptions.length
                ? `<span>事件样本</span>${renderRulePreviewSampleSelect(previewData.trigger_type, 'scene_preview_sample')}`
                : '';
        }
        if (sampleLabelEl instanceof HTMLElement) {
            sampleLabelEl.hidden = !previewCopy.sampleLabel;
            sampleLabelEl.textContent = previewCopy.sampleLabel || '';
        }
        if (action instanceof HTMLAnchorElement) {
            action.textContent = actionLabel;
            action.href = previewData.action_url || '#';
            action.hidden = !actionLabel;
        }
        return true;
    }

    function syncScenePriorityOverrideStateFromForm(scene = {}) {
        const grid = document.querySelector('[data-engagement-scene-priority-override-grid]');
        if (!(grid instanceof HTMLElement)) return false;
        const enabled = scene?.event_priority_center?.enabled === true;
        grid.classList.toggle('is-disabled', !enabled);
        return true;
    }

    function getRuleFormValidationMessage(payload = {}) {
        const missing = [];
        if (!String(payload.name || '').trim()) {
            missing.push('规则名称');
        }
        if (!String(payload.content || '').trim()) {
            missing.push('气泡内容');
        }
        return missing.length ? `请填写${missing.join('和')}` : '';
    }

    function setRuleFormMessage(form, message = '', tone = 'error') {
        const errorEl = form?.querySelector?.('[data-engagement-form-error]');
        const normalizedMessage = String(message || '').trim();
        if (!errorEl) return;
        errorEl.textContent = normalizedMessage;
        errorEl.dataset.tone = ['info', 'success', 'error'].includes(String(tone || '').trim())
            ? String(tone || '').trim()
            : 'error';
        errorEl.hidden = !normalizedMessage;
    }

    function setRuleFormError(form, message = '') {
        setRuleFormMessage(form, message, 'error');
    }

    function focusFirstInvalidRuleField(form, payload = {}) {
        const targetName = !String(payload.name || '').trim()
            ? 'name'
            : (!String(payload.content || '').trim() ? 'content' : '');
        if (!targetName) return;
        const field = form?.elements?.[targetName];
        if (field instanceof HTMLElement) {
            field.focus?.({ preventScroll: true });
            field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        }
    }

    function setRuleSubmitState(form, isSaving = false) {
        const submitButton = form?.querySelector?.('[data-engagement-action="submit-rule"]');
        if (!submitButton) return;
        submitButton.disabled = Boolean(isSaving);
        const icon = submitButton.querySelector('i');
        const label = submitButton.querySelector('span');
        if (icon) {
            icon.className = isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-save';
        }
        if (label) {
            label.textContent = isSaving ? '保存中...' : (state.editingRuleId ? '保存规则' : '创建规则');
        }
    }

    function getEngagementActionBusyLabel(action = '', fallback = '处理中...') {
        const normalized = normalizeToken(action, '');
        const labels = {
            refresh: '刷新中...',
            'submit-template': '保存中...',
            'delete-template': '删除中...',
            'create-template-starter': '写入中...',
            'submit-user-tag': '保存中...',
            'delete-user-tag': '删除中...',
            'submit-tag-automation': '保存中...',
            'run-inactive-sweep': '扫描中...',
            'sync-segment-tags': '同步中...',
            'submit-segment': '保存中...',
            'delete-segment': '删除中...',
            'create-automation-rule': '创建中...',
            'create-missing-automation-rules': '批量创建中...',
            'publish-automation-drafts': '发布中...',
            'pause-running-automation-rules': '暂停中...',
            'toggle-automation-rule': '处理中...',
            'submit-scene': '保存中...',
            'submit-asset-style': '保存中...',
            'apply-asset-style-preset': '套用中...',
            'submit-asset': '保存中...',
            'delete-asset': '删除中...',
            'submit-entry-settings': '保存中...',
            'submit-entry-context': '保存中...',
            'submit-external-embed': '保存中...',
            'copy-external-embed-snippet': '复制中...',
            'batch-pause-filtered-rules': '批量暂停中...',
            'batch-copy-filtered-rules': '批量复制中...',
            'batch-archive-attention-rules': '批量归档中...',
            'batch-archive-high-risk-rules': '批量归档中...',
            'rollback-audit-batch': '回滚中...',
            'toggle-rule': '处理中...',
            'archive-rule': '归档中...',
            'delete-rule': '删除中...',
            'pause-all-rules': '暂停中...',
            'restore-latest-pause-all-rules': '恢复中...'
        };
        return labels[normalized] || fallback;
    }

    function shouldShowEngagementBusyLabel(actionEl) {
        if (!(actionEl instanceof HTMLElement)) return true;
        return String(actionEl.textContent || '').trim().length > 0;
    }

    function startEngagementActionFeedback(actionEl, label = '处理中...') {
        if (!(actionEl instanceof HTMLElement)) return false;
        if (actionEl.dataset.engagementActionBusy === 'true') return false;
        if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return false;
        const showBusyLabel = shouldShowEngagementBusyLabel(actionEl);

        actionEl.dataset.engagementActionBusy = 'true';
        actionEl.dataset.engagementActionOriginalHtml = actionEl.innerHTML;
        actionEl.classList.add('is-engagement-action-busy');
        actionEl.setAttribute('aria-busy', 'true');

        if (actionEl instanceof HTMLButtonElement) {
            actionEl.dataset.engagementActionWasDisabled = actionEl.disabled ? 'true' : 'false';
            actionEl.disabled = true;
        }

        if (actionEl.matches('button')) {
            if (!showBusyLabel) {
                actionEl.dataset.engagementActionOriginalAriaLabel = actionEl.getAttribute('aria-label') || '';
                actionEl.setAttribute('aria-label', label);
            }
            actionEl.innerHTML = showBusyLabel
                ? `
                    <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                    <span>${escapeHtml(label)}</span>
                `
                : '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i>';
        }
        return true;
    }

    function clearEngagementActionFeedback(actionEl) {
        if (!(actionEl instanceof HTMLElement)) return;
        if (actionEl.dataset.engagementActionBusy !== 'true') return;

        if (Object.prototype.hasOwnProperty.call(actionEl.dataset, 'engagementActionOriginalHtml')) {
            actionEl.innerHTML = actionEl.dataset.engagementActionOriginalHtml || '';
        }
        if (actionEl instanceof HTMLButtonElement) {
            actionEl.disabled = actionEl.dataset.engagementActionWasDisabled === 'true';
        }
        if (Object.prototype.hasOwnProperty.call(actionEl.dataset, 'engagementActionOriginalAriaLabel')) {
            const originalAriaLabel = actionEl.dataset.engagementActionOriginalAriaLabel || '';
            if (originalAriaLabel) {
                actionEl.setAttribute('aria-label', originalAriaLabel);
            } else {
                actionEl.removeAttribute('aria-label');
            }
        }
        actionEl.classList.remove('is-engagement-action-busy');
        actionEl.removeAttribute('aria-busy');
        delete actionEl.dataset.engagementActionBusy;
        delete actionEl.dataset.engagementActionOriginalHtml;
        delete actionEl.dataset.engagementActionWasDisabled;
        delete actionEl.dataset.engagementActionOriginalAriaLabel;
    }

    function runEngagementAsyncAction(actionEl, taskFactory, errorMessage = '客服系统操作失败', busyLabel = '') {
        const label = busyLabel || getEngagementActionBusyLabel(actionEl?.dataset?.engagementAction, '处理中...');
        if (!startEngagementActionFeedback(actionEl, label)) return false;
        void Promise.resolve()
            .then(taskFactory)
            .catch((error) => {
                showActionError(error, errorMessage);
            })
            .finally(() => {
                clearEngagementActionFeedback(actionEl);
            });
        return true;
    }

    function upsertRuleInPayload(rule = {}) {
        if (!rule || typeof rule !== 'object' || !String(rule.id || '').trim()) {
            return;
        }

        const currentPayload = state.payload && typeof state.payload === 'object'
            ? state.payload
            : {};
        const currentRules = Array.isArray(currentPayload.rules) ? currentPayload.rules : [];
        const ruleId = String(rule.id || '').trim();
        const nextRules = currentRules.filter((item) => String(item?.id || '').trim() !== ruleId);
        state.payload = {
            ...currentPayload,
            rules: [rule, ...nextRules].slice(0, 100)
        };
    }

    function mergeSegmentsAndTagCenterIntoPayload(payload = {}) {
        const currentPayload = state.payload && typeof state.payload === 'object'
            ? state.payload
            : {};
        state.payload = {
            ...currentPayload,
            segments: Array.isArray(payload.segments) ? payload.segments : (currentPayload.segments || []),
            tag_center: payload.tag_center || currentPayload.tag_center
        };
    }

    function rerenderSegmentTagPicker() {
        const form = document.getElementById('engagementSegmentForm');
        const picker = form?.querySelector?.('[data-engagement-segment-tag-picker]');
        if (!(picker instanceof HTMLElement)) return false;
        const selectedTags = getSelectedSegmentTags(picker);
        picker.outerHTML = renderSegmentTagPicker(selectedTags);
        return true;
    }

    async function refreshSegmentsAndTagCenter({ renderMode = 'overview', showSuccess = false } = {}) {
        if (state.segmentTagsSyncing) return false;
        state.segmentTagsSyncing = true;
        try {
            const payload = await fetchSegmentsAndTagCenter();
            mergeSegmentsAndTagCenterIntoPayload(payload);
            if (renderMode === 'picker' && rerenderSegmentTagPicker()) {
                if (showSuccess) showFeedback('已刷新用户标签中心', 'success');
                return true;
            }
            if (renderMode !== 'none' && state.activeView === 'segments') {
                renderOverview(state.payload || {});
            }
            if (showSuccess) showFeedback('已刷新用户标签中心', 'success');
            return true;
        } finally {
            state.segmentTagsSyncing = false;
        }
    }

    async function syncUserManagementTagsToTagCenter({ renderMode = 'picker', showSuccess = true } = {}) {
        if (state.segmentTagsSyncing) return false;
        state.segmentTagsSyncing = true;
        try {
            const beforeKeys = new Set(getUserTagCenter().tags.map((tag) => normalizeUserTagKey(tag?.key || tag?.id, '')).filter(Boolean));
            const result = await mutateSegment({ action: 'sync_user_tags' });
            state.payload = {
                ...(state.payload || {}),
                tag_center: result?.tag_center || state.payload?.tag_center
            };
            const afterKeys = getUserTagCenter().tags.map((tag) => normalizeUserTagKey(tag?.key || tag?.id, '')).filter(Boolean);
            const addedCount = afterKeys.filter((key) => !beforeKeys.has(key)).length;
            if (renderMode === 'picker' && rerenderSegmentTagPicker()) {
                if (showSuccess) {
                    showFeedback(addedCount ? `已同步用户管理标签，新增 ${formatNumber(addedCount)} 个` : '已同步用户管理标签', 'success');
                }
                return true;
            }
            if (renderMode !== 'none' && state.activeView === 'segments') {
                renderOverview(state.payload || {});
            }
            if (showSuccess) {
                showFeedback(addedCount ? `已同步用户管理标签，新增 ${formatNumber(addedCount)} 个` : '已同步用户管理标签', 'success');
            }
            return true;
        } finally {
            state.segmentTagsSyncing = false;
        }
    }

    function upsertRulesInPayload(rules = []) {
        const rows = Array.isArray(rules) ? rules.filter((rule) => rule && String(rule.id || '').trim()) : [];
        if (!rows.length) return;
        const currentPayload = state.payload && typeof state.payload === 'object'
            ? state.payload
            : {};
        const currentRules = Array.isArray(currentPayload.rules) ? currentPayload.rules : [];
        const updatedIds = new Set(rows.map((rule) => String(rule.id || '').trim()));
        state.payload = {
            ...currentPayload,
            rules: [
                ...rows,
                ...currentRules.filter((rule) => !updatedIds.has(String(rule?.id || '').trim()))
            ].slice(0, 100)
        };
        state.governanceRefreshHint = Date.now();
    }

    function removeRuleFromPayload(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return;
        const currentPayload = state.payload && typeof state.payload === 'object'
            ? state.payload
            : {};
        const currentRules = Array.isArray(currentPayload.rules) ? currentPayload.rules : [];
        const nextRules = currentRules.filter((rule) => String(rule?.id || '').trim() !== normalizedId);
        state.payload = {
            ...currentPayload,
            rules: nextRules
        };
        state.governanceRefreshHint = Date.now();
    }

    function upsertTemplateInPayload(template = {}) {
        if (!template || typeof template !== 'object' || !String(template.id || '').trim()) return;
        const currentPayload = state.payload && typeof state.payload === 'object' ? state.payload : {};
        const currentTemplates = Array.isArray(currentPayload.templates) ? currentPayload.templates : [];
        const templateId = String(template.id || '').trim();
        state.payload = {
            ...currentPayload,
            templates: [
                template,
                ...currentTemplates.filter((item) => String(item?.id || '').trim() !== templateId)
            ].slice(0, 100)
        };
    }

    function removeTemplateFromPayload(templateId = '') {
        const normalizedId = String(templateId || '').trim();
        if (!normalizedId) return;
        const currentPayload = state.payload && typeof state.payload === 'object' ? state.payload : {};
        state.payload = {
            ...currentPayload,
            templates: (Array.isArray(currentPayload.templates) ? currentPayload.templates : [])
                .filter((item) => String(item?.id || '').trim() !== normalizedId)
        };
    }

    function upsertSegmentInPayload(segment = {}) {
        if (!segment || typeof segment !== 'object' || !String(segment.id || '').trim()) return;
        const currentPayload = state.payload && typeof state.payload === 'object' ? state.payload : {};
        const currentSegments = Array.isArray(currentPayload.segments) ? currentPayload.segments : [];
        const segmentId = String(segment.id || '').trim();
        state.payload = {
            ...currentPayload,
            segments: [
                segment,
                ...currentSegments.filter((item) => String(item?.id || '').trim() !== segmentId)
            ].slice(0, 100)
        };
    }

    function removeSegmentFromPayload(segmentId = '') {
        const normalizedId = String(segmentId || '').trim();
        if (!normalizedId) return;
        const currentPayload = state.payload && typeof state.payload === 'object' ? state.payload : {};
        state.payload = {
            ...currentPayload,
            segments: (Array.isArray(currentPayload.segments) ? currentPayload.segments : [])
                .filter((item) => String(item?.id || '').trim() !== normalizedId)
        };
    }

    function splitManagementLines(value = '') {
        return String(value || '')
            .split(/[\n,;|]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function splitEmailLines(value = '') {
        return splitManagementLines(value)
            .map((item) => item.toLowerCase())
            .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
    }

    function collectTemplateFormPayload(form) {
        const formData = new FormData(form);
        const template = getEditableTemplate();
        const metadata = template?.metadata && typeof template.metadata === 'object' && !Array.isArray(template.metadata)
            ? template.metadata
            : {};
        return {
            id: String(formData.get('id') || '').trim(),
            key: String(formData.get('key') || '').trim(),
            name: String(formData.get('name') || '').trim(),
            description: String(formData.get('description') || '').trim(),
            category: String(formData.get('category') || 'general').trim() || 'general',
            page_ids: formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean),
            title: String(formData.get('title') || '').trim(),
            content: String(formData.get('content') || '').trim(),
            action_label: String(formData.get('action_label') || '').trim(),
            action_url: String(formData.get('action_url') || '').trim(),
            tone: normalizeToken(formData.get('tone') || 'info', 'info'),
            metadata
        };
    }

    function collectSegmentFormPayload(form) {
        const formData = new FormData(form);
        return {
            id: String(formData.get('id') || '').trim(),
            key: String(formData.get('key') || '').trim(),
            name: String(formData.get('name') || '').trim(),
            description: String(formData.get('description') || '').trim(),
            scope: String(formData.get('scope') || '').trim(),
            icon: String(formData.get('icon') || 'fa-users').trim() || 'fa-users',
            page_ids: formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean),
            email_targets: splitEmailLines(formData.get('email_targets')),
            tag_targets: formData.getAll('tag_targets').map((item) => normalizeUserTagKey(item, '')).filter(Boolean),
            examples: formData.getAll('examples').map((item) => normalizeSegmentScenarioValue(item)).filter(Boolean),
            enabled: String(formData.get('enabled') || '').trim() === 'true'
        };
    }

    function collectUserTagFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_tag',
            id: normalizeUserTagKey(formData.get('id') || '', ''),
            key: normalizeUserTagKey(formData.get('key') || '', ''),
            name: String(formData.get('name') || '').trim(),
            source: normalizeToken(formData.get('source') || 'manual', 'manual'),
            description: String(formData.get('description') || '').trim(),
            auto_rule: String(formData.get('auto_rule') || '').trim(),
            enabled: String(formData.get('enabled') || '').trim() === 'true'
        };
    }

    function collectTagAutomationFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_tag_center',
            tag_center: {
                ...getUserTagCenter(),
                automation: {
                    high_value: {
                        enabled: String(formData.get('high_value_enabled') || '').trim() === 'true',
                        min_paid_amount: normalizeNumericInput(formData.get('high_value_min_paid_amount'), 500, 0, 1000000),
                        min_points: normalizeNumericInput(formData.get('high_value_min_points'), 5000, 0, 100000000),
                        min_order_count: normalizeNumericInput(formData.get('high_value_min_order_count'), 5, 0, 100000)
                    },
                    payment_failed: {
                        enabled: String(formData.get('payment_failed_enabled') || '').trim() === 'true',
                        window_days: normalizeNumericInput(formData.get('payment_failed_window_days'), 7, 1, 365),
                        min_count: normalizeNumericInput(formData.get('payment_failed_min_count'), 1, 1, 1000)
                    },
                    verify_failed: {
                        enabled: String(formData.get('verify_failed_enabled') || '').trim() === 'true',
                        window_days: normalizeNumericInput(formData.get('verify_failed_window_days'), 7, 1, 365),
                        min_count: normalizeNumericInput(formData.get('verify_failed_min_count'), 1, 1, 1000)
                    },
                    inactive: {
                        enabled: String(formData.get('inactive_enabled') || '').trim() === 'true',
                        inactive_days: normalizeNumericInput(formData.get('inactive_days'), 30, 1, 3650)
                    }
                }
            }
        };
    }

    function collectSceneFormPayload(form) {
        const formData = new FormData(form);
        const pageId = normalizeToken(formData.get('page_id') || 'home', 'home');
        const scenePriorityEnabled = String(formData.get('scene_priority_override_enabled') || '').trim() === 'true';
        return {
            scene: {
                id: pageId,
                page_id: pageId,
                label: String(formData.get('label') || getPageLabel(pageId)).trim(),
                tone: normalizeToken(formData.get('tone') || 'info', 'info'),
                default_placement: normalizeToken(formData.get('default_placement') || 'robot_bubble', 'robot_bubble'),
                safe_zone: normalizeToken(formData.get('safe_zone') || 'bottom-right', 'bottom-right'),
                allow_marketing: String(formData.get('allow_marketing') || '').trim() === 'true',
                events: formData.getAll('events').map((item) => normalizeToken(item, '')).filter(Boolean),
                event_priority_center: {
                    enabled: scenePriorityEnabled,
                    first_wave: {
                        label: getEventPriorityCenter().first_wave.label,
                        events: formData.getAll('first_wave_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                    },
                    service: {
                        label: getEventPriorityCenter().service.label,
                        events: formData.getAll('service_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                    },
                    marketing: {
                        label: getEventPriorityCenter().marketing.label,
                        events: formData.getAll('marketing_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                    },
                    guidance: {
                        label: getEventPriorityCenter().guidance.label,
                        events: formData.getAll('guidance_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                    }
                }
            }
        };
    }

    function collectEventPriorityCenterFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_event_priority_center',
            event_priority_center: {
                first_wave: {
                    label: getEventPriorityCenter().first_wave.label,
                    events: formData.getAll('first_wave_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                },
                service: {
                    label: getEventPriorityCenter().service.label,
                    events: formData.getAll('service_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                },
                marketing: {
                    label: getEventPriorityCenter().marketing.label,
                    events: formData.getAll('marketing_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                },
                guidance: {
                    label: getEventPriorityCenter().guidance.label,
                    events: formData.getAll('guidance_events').map((item) => normalizeToken(item, '')).filter(Boolean)
                }
            }
        };
    }

    function collectAssetStyleFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_style',
            style: {
                enabled: String(formData.get('enabled') || '').trim() === 'true',
                preset: normalizeToken(formData.get('preset') || 'studio_blue', 'studio_blue'),
                accent_color: normalizeHexColor(formData.get('accent_color'), '#6b9ece'),
                title_color: normalizeHexColor(formData.get('title_color'), '#5f95cc'),
                bubble_background: normalizeHexColor(formData.get('bubble_background'), '#ffffff'),
                text_color: normalizeHexColor(formData.get('text_color'), '#1f2937'),
                radius_px: Number.parseInt(formData.get('radius_px') || '22', 10) || 22,
                max_width_px: Number.parseInt(formData.get('max_width_px') || '520', 10) || 520,
                density: normalizeToken(formData.get('density') || 'comfortable', 'comfortable'),
                shadow: normalizeToken(formData.get('shadow') || 'soft', 'soft'),
                animation: normalizeToken(formData.get('animation') || 'gentle', 'gentle'),
                robot_variant: normalizeToken(formData.get('robot_variant') || 'default', 'default')
            }
        };
    }

    function collectAssetFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_asset',
            asset: {
                id: String(formData.get('id') || '').trim(),
                name: String(formData.get('name') || '').trim(),
                description: String(formData.get('description') || '').trim(),
                type: normalizeToken(formData.get('type') || 'icon', 'icon'),
                icon: String(formData.get('icon') || 'fa-robot').trim() || 'fa-robot',
                url: String(formData.get('url') || '').trim(),
                tone: normalizeToken(formData.get('tone') || 'info', 'info'),
                page_ids: formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean),
                enabled: String(formData.get('enabled') || '').trim() === 'true'
            }
        };
    }

    function collectEntrySettingsFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_settings',
            settings: {
                enabled: String(formData.get('enabled') || '').trim() === 'true',
                entry_label: String(formData.get('entry_label') || '').trim(),
                entry_label_en: String(formData.get('entry_label_en') || '').trim(),
                telegram_url: String(formData.get('telegram_url') || '').trim(),
                ticket_enabled: String(formData.get('ticket_enabled') || '').trim() === 'true',
                live_chat_enabled: String(formData.get('live_chat_enabled') || '').trim() === 'true',
                ticket_sla_hours: Number.parseInt(formData.get('ticket_sla_hours') || '24', 10) || 24,
                ticket_prompt: String(formData.get('ticket_prompt') || '').trim(),
                ticket_placeholder: String(formData.get('ticket_placeholder') || '').trim(),
                ticket_input_hint: String(formData.get('ticket_input_hint') || '').trim()
            }
        };
    }

    function collectEntryContextFormPayload(form) {
        const formData = new FormData(form);
        const contextId = normalizeToken(formData.get('id') || 'default', 'default');
        return {
            action: 'save_context',
            context: {
                id: contextId,
                label: String(formData.get('label') || '').trim() || getOptionLabel(SUPPORT_CONTEXT_OPTIONS, contextId),
                intro: String(formData.get('intro') || '').trim(),
                shortcuts: formData.getAll('shortcuts').map((item) => normalizeToken(item, '')).filter(Boolean),
                enabled: String(formData.get('enabled') || '').trim() === 'true'
            }
        };
    }

    function collectExternalEmbedFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_policy',
            policy: {
                enabled: String(formData.get('enabled') || '').trim() === 'true',
                allow_local_preview: String(formData.get('allow_local_preview') || '').trim() === 'true',
                allowed_origins: splitManagementLines(formData.get('allowed_origins')),
                api_origin: String(formData.get('api_origin') || '').trim(),
                asset_base: String(formData.get('asset_base') || '').trim(),
                default_page_id: normalizeToken(formData.get('default_page_id') || 'gongyi', 'gongyi'),
                default_site: normalizeToken(formData.get('default_site') || 'cn', 'cn')
            }
        };
    }

    async function saveRuleFromForm(form) {
        if (!(form instanceof HTMLFormElement)) {
            return false;
        }
        if (form?.dataset?.engagementSaving === 'true') {
            const startedAt = Number(form.dataset.engagementSavingStartedAt || 0) || 0;
            const isStale = startedAt > 0 && (Date.now() - startedAt) > SAVE_LOCK_STALE_MS;
            if (!isStale) {
                setRuleSubmitState(form, true);
                setRuleFormMessage(form, '触达规则正在保存，请稍候...', 'info');
                return false;
            }
            delete form.dataset.engagementSaving;
            delete form.dataset.engagementSavingStartedAt;
        }
        const payload = collectRuleFormPayload(form);
        const validationMessage = getRuleFormValidationMessage(payload);
        if (validationMessage) {
            setRuleFormError(form, validationMessage);
            focusFirstInvalidRuleField(form, payload);
            return false;
        }
        if (needsGovernancePublishAck(payload)) {
            const confirmed = confirmHighRiskPublish(payload, `「${payload.name || '未命名规则'}」`);
            if (!confirmed) {
                setRuleFormMessage(form, '高风险规则发布已取消，可先保存为草稿或降低触达强度。', 'info');
                return false;
            }
            Object.assign(payload, buildGovernancePublishAck(payload, 'rule_form_high_risk_confirm'));
        }

        setRuleFormMessage(form, '正在提交触达规则...', 'info');
        form.dataset.engagementSaving = 'true';
        form.dataset.engagementSavingStartedAt = String(Date.now());
        setRuleSubmitState(form, true);
        try {
            const result = await mutateRule(payload);
            upsertRuleInPayload(result?.rule);
            state.editingRuleId = '';
            state.ruleDraft = null;
            state.templateDraftRef = '';
            setRuleFormMessage(form, '触达规则已保存', 'success');
            showFeedback('触达规则已保存', 'success');
            renderOverview(state.payload || {});
            return true;
        } catch (error) {
            setRuleFormError(form, error?.message || '触达规则保存失败');
            throw error;
        } finally {
            delete form.dataset.engagementSaving;
            delete form.dataset.engagementSavingStartedAt;
            setRuleSubmitState(form, false);
        }
    }

    async function saveTemplateFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectTemplateFormPayload(form);
        if (!payload.name || !payload.title || !payload.content) {
            showFeedback('模板名称、气泡标题和气泡内容不能为空', 'error');
            return false;
        }
        const result = await mutateTemplate(payload);
        upsertTemplateInPayload(result?.template);
        state.editingTemplateRef = String(result?.template?.id || '').trim();
        state.activeView = 'templates';
        showFeedback('消息模板已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function createTemplateFromStarter(starterId = '') {
        const starter = getTemplateStarterById(starterId);
        if (!starter) {
            showFeedback('没有找到这条推荐模板', 'error');
            return false;
        }
        const templates = Array.isArray(state.payload?.templates) ? state.payload.templates : [];
        const existing = templates.find((template) => isTemplateStarterInstalled(starter, [template]));
        if (existing) {
            state.editingTemplateRef = String(existing.id || existing.key || '').trim();
            state.activeView = 'templates';
            renderOverview(state.payload || {});
            showFeedback('模板库中已存在这条推荐模板', 'info');
            return true;
        }
        const {
            id: starterInternalId,
            priority: starterPriority,
            ...starterTemplatePayload
        } = starter;
        const result = await mutateTemplate({
            ...starterTemplatePayload,
            metadata: {
                productized: true,
                starter_id: starterInternalId,
                starter_key: starter.key,
                starter_category: starter.category,
                starter_priority: starterPriority,
                starter_trigger_type: starter.trigger_type || starter.key || 'page_view',
                created_from: 'template_product_shelf'
            }
        });
        upsertTemplateInPayload(result?.template);
        state.editingTemplateRef = String(result?.template?.id || '').trim();
        state.templateCategoryFilter = starter.category || state.templateCategoryFilter;
        state.activeView = 'templates';
        showFeedback(result?.already_exists ? '模板库中已存在这条推荐模板' : '推荐模板已写入模板库', result?.already_exists ? 'info' : 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function deleteTemplate(templateRef = '') {
        const template = getTemplateByRef(templateRef);
        const templateId = String(template?.id || '').trim();
        if (!templateId) return false;
        const confirmed = typeof globalScope.confirm === 'function'
            ? globalScope.confirm(`确定删除「${template.name || template.key || '消息模板'}」吗？`)
            : true;
        if (!confirmed) return false;
        await mutateTemplate({
            action: 'delete',
            id: templateId
        });
        removeTemplateFromPayload(templateId);
        if (state.editingTemplateRef === templateId) {
            state.editingTemplateRef = '';
        }
        showFeedback('消息模板已删除', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveSegmentFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectSegmentFormPayload(form);
        if (!payload.name) {
            showFeedback('分群名称不能为空', 'error');
            return false;
        }
        const result = await mutateSegment(payload);
        upsertSegmentInPayload(result?.segment);
        state.editingSegmentRef = String(result?.segment?.id || '').trim();
        state.activeView = 'segments';
        showFeedback('用户分群已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveUserTagFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectUserTagFormPayload(form);
        if (!payload.key || !payload.name) {
            showFeedback('标签 key 和标签名称不能为空', 'error');
            return false;
        }
        const result = await mutateSegment(payload);
        state.payload = {
            ...(state.payload || {}),
            tag_center: result?.tag_center || state.payload?.tag_center
        };
        state.editingUserTagRef = payload.key;
        state.activeView = 'segments';
        showFeedback('用户标签已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function deleteUserTag(tagRef = '') {
        const tagKey = normalizeUserTagKey(tagRef, '');
        if (!tagKey) return false;
        const tag = getUserTagCenter().tags.find((item) => normalizeUserTagKey(item.key || item.id, '') === tagKey);
        const confirmed = typeof globalScope.confirm === 'function'
            ? globalScope.confirm(`确定删除「${tag?.name || tagKey}」标签定义吗？`)
            : true;
        if (!confirmed) return false;
        const result = await mutateSegment({
            action: 'delete_tag',
            key: tagKey
        });
        state.payload = {
            ...(state.payload || {}),
            tag_center: result?.tag_center || state.payload?.tag_center
        };
        if (normalizeUserTagKey(state.editingUserTagRef, '') === tagKey) {
            state.editingUserTagRef = '';
        }
        state.activeView = 'segments';
        showFeedback('用户标签已删除', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function persistTagAutomationFromForm(form, { showSuccess = true, render = true } = {}) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectTagAutomationFormPayload(form);
        const result = await mutateSegment(payload);
        state.payload = {
            ...(state.payload || {}),
            tag_center: result?.tag_center || state.payload?.tag_center
        };
        state.activeView = 'segments';
        if (showSuccess) {
            showFeedback('自动分群阈值已保存', 'success');
        }
        if (render) {
            renderOverview(state.payload || {});
        }
        return true;
    }

    async function saveTagAutomationFromForm(form) {
        return persistTagAutomationFromForm(form, {
            showSuccess: true,
            render: true
        });
    }

    async function runInactiveUserSweep(form = document.getElementById('engagementTagAutomationForm')) {
        if (form instanceof HTMLFormElement) {
            const payload = collectTagAutomationFormPayload(form);
            const inactiveEnabled = payload?.tag_center?.automation?.inactive?.enabled === true;
            if (!inactiveEnabled) {
                showFeedback('长期未活跃扫描未启用，请先打开阈值开关', 'info');
                return false;
            }
            await persistTagAutomationFromForm(form, {
                showSuccess: false,
                render: false
            });
        }

        const result = await mutateSegment({
            action: 'run_inactive_sweep',
            limit: 500
        });
        const tagged = Number(result?.sweep?.tagged || 0) || 0;
        const skipped = String(result?.sweep?.skipped || '').trim();
        showFeedback(
            skipped ? '长期未活跃扫描未启用，请先打开阈值开关' : `长期未活跃扫描完成，新增/刷新 ${formatNumber(tagged)} 个用户标签`,
            skipped ? 'info' : 'success'
        );
        if (!skipped && state.activeView === 'segments') {
            renderOverview(state.payload || {});
        }
        return true;
    }

    async function deleteSegment(segmentRef = '') {
        const segment = getAudienceSegments().find((item) => (
            String(item.dbId || '').trim() === String(segmentRef || '').trim()
            || normalizeToken(item.id || item.key, '') === normalizeToken(segmentRef, '')
        ));
        const segmentId = String(segment?.dbId || '').trim();
        if (!segmentId) {
            showFeedback('内置分群不能删除，可以复制后创建新的运营分群', 'info');
            return false;
        }
        const confirmed = typeof globalScope.confirm === 'function'
            ? globalScope.confirm(`确定删除「${segment.title || segment.name || '用户分群'}」吗？`)
            : true;
        if (!confirmed) return false;
        await mutateSegment({
            action: 'delete',
            id: segmentId
        });
        removeSegmentFromPayload(segmentId);
        if (state.editingSegmentRef === segmentId) {
            state.editingSegmentRef = '';
        }
        showFeedback('用户分群已删除', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveSceneFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectSceneFormPayload(form);
        const confirmed = confirmSceneSaveRisk(payload.scene);
        if (!confirmed) {
            showFeedback('页面场景保存已取消', 'info');
            return false;
        }
        state.scenePreviewEvent = normalizeScenePreviewEvent(payload.scene.events || [], state.scenePreviewEvent || '');
        await mutateScene(payload);
        state.editingScenePageId = payload.scene.page_id;
        state.focusedPageId = payload.scene.page_id;
        state.activeView = 'scenes';
        showFeedback('页面场景已保存', 'success');
        await refreshAdminEngagementModule();
        return true;
    }

    function applyScenePriorityPreset(presetId = '', pageId = '') {
        const normalizedPageId = normalizeToken(pageId || state.editingScenePageId || 'home', 'home');
        const preset = getScenePriorityPresetPacks(normalizedPageId).find((item) => normalizeToken(item.id, '') === normalizeToken(presetId, ''));
        if (!preset) return false;
        const payload = state.payload && typeof state.payload === 'object' && !Array.isArray(state.payload) ? state.payload : createDegradedOverviewPayload({});
        const scenes = Array.isArray(payload.page_scenes) ? payload.page_scenes.slice() : [];
        const currentScene = getSceneByPageId(normalizedPageId);
        const nextScene = {
            ...currentScene,
            id: normalizedPageId,
            page_id: normalizedPageId,
            allow_marketing: preset.allow_marketing !== false,
            events: Array.isArray(preset.events) ? preset.events.map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean) : currentScene.events,
            event_priority_center: normalizeSceneEventPriorityCenter({
                enabled: true,
                ...(preset.event_priority_center || {})
            }, getEventPriorityCenter())
        };
        const existingIndex = scenes.findIndex((scene) => normalizeToken(scene?.id || scene?.page_id, '') === normalizedPageId);
        if (existingIndex >= 0) {
            scenes.splice(existingIndex, 1, nextScene);
        } else {
            scenes.push(nextScene);
        }
        state.payload = {
            ...payload,
            page_scenes: scenes
        };
        state.editingScenePageId = normalizedPageId;
        state.scenePreviewEvent = normalizeScenePreviewEvent(nextScene.events || [], state.scenePreviewEvent || '');
        state.activeView = 'scenes';
        renderOverview(state.payload || {});
        updateScenePreviewFromForm();
        showFeedback(`已套用「${preset.name}」，保存后生效`, 'success');
        return true;
    }

    function applySceneGuidanceAction(actionType = '', actionValue = '', pageId = '') {
        const normalizedActionType = normalizeToken(actionType, '');
        if (normalizedActionType === 'preset') {
            return applyScenePriorityPreset(actionValue, pageId);
        }
        return false;
    }

    async function saveEventPriorityCenterFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const result = await mutateScene(collectEventPriorityCenterFormPayload(form));
        state.payload = {
            ...(state.payload || {}),
            event_priority_center: result?.event_priority_center || state.payload?.event_priority_center
        };
        showFeedback('首波分诊配置已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveAssetStyleFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const result = await mutateAssets(collectAssetStyleFormPayload(form));
        state.payload = {
            ...(state.payload || {}),
            asset_center: result?.asset_center || state.payload?.asset_center
        };
        showFeedback('气泡视觉样式已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function applyAssetStylePreset(presetId = '') {
        const preset = getAssetStylePresetById(presetId);
        if (!preset) return false;
        const currentStyle = getAssetCenter().style;
        const result = await mutateAssets({
            action: 'save_style',
            style: {
                ...currentStyle,
                ...preset.style,
                enabled: currentStyle.enabled !== false,
                preset: preset.id
            }
        });
        state.payload = {
            ...(state.payload || {}),
            asset_center: result?.asset_center || state.payload?.asset_center
        };
        state.activeView = 'assets';
        showFeedback(`已套用「${preset.title}」样式预设`, 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveAssetFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectAssetFormPayload(form);
        if (!payload.asset.name) {
            showFeedback('素材名称不能为空', 'error');
            return false;
        }
        const result = await mutateAssets(payload);
        state.payload = {
            ...(state.payload || {}),
            asset_center: result?.asset_center || state.payload?.asset_center
        };
        state.editingAssetId = payload.asset.id || '';
        showFeedback('触达素材已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function deleteAsset(assetId = '') {
        const normalizedId = String(assetId || '').trim();
        if (!normalizedId) return false;
        const asset = getAssetCenter().assets.find((item) => String(item?.id || '') === normalizedId);
        const confirmed = typeof globalScope.confirm === 'function'
            ? globalScope.confirm(`确定删除「${asset?.name || '触达素材'}」吗？`)
            : true;
        if (!confirmed) return false;
        const result = await mutateAssets({
            action: 'delete_asset',
            id: normalizedId
        });
        state.payload = {
            ...(state.payload || {}),
            asset_center: result?.asset_center || state.payload?.asset_center
        };
        if (state.editingAssetId === normalizedId) {
            state.editingAssetId = '';
        }
        showFeedback('触达素材已删除', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveEntrySettingsFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const result = await mutateEntry(collectEntrySettingsFormPayload(form));
        state.payload = {
            ...(state.payload || {}),
            support_entry: result?.support_entry || state.payload?.support_entry
        };
        showFeedback('客服入口配置已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveEntryContextFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectEntryContextFormPayload(form);
        if (!payload.context.shortcuts.length) {
            showFeedback('至少选择一个快捷动作', 'error');
            return false;
        }
        const result = await mutateEntry(payload);
        state.payload = {
            ...(state.payload || {}),
            support_entry: result?.support_entry || state.payload?.support_entry
        };
        state.editingSupportContextId = payload.context.id || 'default';
        showFeedback('页面客服入口已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveExternalEmbedFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectExternalEmbedFormPayload(form);
        if (!payload.policy.allowed_origins.length) {
            showFeedback('至少填写一个外部白名单域名', 'error');
            return false;
        }
        const result = await mutateExternalEmbed(payload);
        state.payload = {
            ...(state.payload || {}),
            external_embed: result?.external_embed || state.payload?.external_embed
        };
        state.activeView = 'settings';
        showFeedback('外部承载配置已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function copyExternalEmbedSnippet() {
        const snippet = String(document.getElementById('engagementExternalEmbedSnippet')?.value || state.payload?.external_embed?.embed_snippet || '').trim();
        if (!snippet) {
            showFeedback('暂无可复制的嵌入代码', 'error');
            return false;
        }
        try {
            await navigator.clipboard?.writeText(snippet);
            showFeedback('API中转嵌入代码已复制', 'success');
            return true;
        } catch (_) {
            const textarea = document.getElementById('engagementExternalEmbedSnippet');
            textarea?.focus?.();
            textarea?.select?.();
            try {
                document.execCommand?.('copy');
                showFeedback('API中转嵌入代码已复制', 'success');
                return true;
            } catch (error) {
                showFeedback('复制失败，请手动选择代码', 'error');
                return false;
            }
        }
    }

    function editEntryContext(contextId = '') {
        state.editingSupportContextId = normalizeToken(contextId || 'default', 'default');
        state.activeView = 'entry';
        renderOverview(state.payload || {});
        document.getElementById('engagementEntryContextForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function editRule(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return false;
        state.editingRuleId = normalizedId;
        state.ruleDraft = null;
        state.templateDraftRef = '';
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        const form = document.getElementById('engagementRuleForm');
        form?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function confirmRuleBatchAction(message = '') {
        if (typeof globalScope.confirm !== 'function') return true;
        return globalScope.confirm(message);
    }

    function createRuleBatchContext(action = '', label = '') {
        const stamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        return {
            batch_id: `rule_batch_${stamp}_${random}`,
            batch_action: normalizeToken(action, 'rule_batch'),
            batch_label: String(label || '批量治理').trim()
        };
    }

    function buildRuleBatchResult({ context = {}, label = '', total = 0, success = [], failed = [], skipped = 0 } = {}) {
        const successCount = Array.isArray(success) ? success.length : Number(success || 0) || 0;
        const failedRows = Array.isArray(failed) ? failed : [];
        const skippedCount = Math.max(0, Number(skipped || 0) || 0);
        const tone = failedRows.length
            ? (successCount > 0 ? 'warning' : 'error')
            : (skippedCount > 0 ? 'warning' : 'success');
        return {
            batch_id: context.batch_id || '',
            batch_action: context.batch_action || '',
            label: label || context.batch_label || '批量治理结果',
            total: Number(total || 0) || 0,
            success: successCount,
            failed: failedRows.length,
            skipped: skippedCount,
            tone,
            errors: failedRows.slice(0, 4)
        };
    }

    function finishRuleBatchAction(result = {}) {
        state.ruleBatchResult = result;
        const message = `${result.label || '批量治理'}：成功 ${formatNumber(result.success)}，失败 ${formatNumber(result.failed)}，跳过 ${formatNumber(result.skipped)}`;
        showFeedback(message, result.tone === 'error' ? 'error' : (result.tone === 'warning' ? 'warning' : 'success'));
    }

    function buildBatchRuleCopyPayload(sourceRule = {}, context = {}) {
        const sourceName = sourceRule.name || '未命名规则';
        const metadata = sourceRule.metadata && typeof sourceRule.metadata === 'object' && !Array.isArray(sourceRule.metadata)
            ? sourceRule.metadata
            : {};
        return {
            action: 'save_rule',
            id: '',
            name: `${sourceName} 副本`,
            description: sourceRule.description || '',
            site: sourceRule.site || getCurrentSite(),
            status: 'draft',
            enabled: false,
            page_ids: Array.isArray(sourceRule.page_ids) && sourceRule.page_ids.length ? sourceRule.page_ids : ['all'],
            audience: sourceRule.audience && typeof sourceRule.audience === 'object' && !Array.isArray(sourceRule.audience) ? sourceRule.audience : {},
            trigger_type: sourceRule.trigger_type || 'page_view',
            placement: sourceRule.placement || 'robot_bubble',
            title: sourceRule.title || sourceName,
            content: sourceRule.content || sourceName,
            action_label: sourceRule.action_label || '',
            action_url: sourceRule.action_url || '',
            tone: sourceRule.tone || 'info',
            icon: sourceRule.icon || 'robot',
            priority: Number(sourceRule.priority || 0) || 0,
            frequency: sourceRule.frequency || 'once_per_day',
            repeat_interval_minutes: getRuleRepeatIntervalMinutes(sourceRule, 2),
            dismiss_ttl_hours: Number(sourceRule.dismiss_ttl_hours || 24) || 24,
            starts_at: sourceRule.starts_at || '',
            ends_at: sourceRule.ends_at || '',
            batch_id: context.batch_id || '',
            batch_action: context.batch_action || '',
            batch_label: context.batch_label || '',
            batch_source_rule_id: sourceRule.id || '',
            metadata: {
                ...metadata,
                batch_id: context.batch_id || '',
                batch_action: context.batch_action || '',
                batch_copy_source_rule_id: sourceRule.id || '',
                batch_copy_source_rule_name: sourceName
            }
        };
    }

    async function batchPauseFilteredRules() {
        const summary = getRuleBatchSummary();
        const rows = summary.runningRows.slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('当前筛选结果里没有运行中的规则', 'info');
            return false;
        }
        const confirmed = confirmRuleBatchAction(`确定暂停当前筛选中的 ${rows.length} 条运行规则吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('pause_filtered', '批量暂停当前筛选规则');
        const results = [];
        const failures = [];
        for (const rule of rows) {
            try {
                const result = await mutateRule({
                    action: 'set_enabled',
                    id: rule.id,
                    enabled: false,
                    batch_previous_status: rule.status || '',
                    batch_previous_enabled: rule.enabled === true,
                    ...context
                });
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: rule.id,
                    name: rule.name,
                    message: error?.message || '暂停失败'
                });
            }
        }
        upsertRulesInPayload(results);
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '批量暂停当前筛选规则',
            total: summary.running,
            success: results,
            failed: failures,
            skipped: Math.max(0, summary.running - rows.length)
        }));
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    async function batchArchiveAttentionRules() {
        const summary = getRuleBatchSummary();
        const candidates = summary.attentionRows
            .filter((rule) => normalizeToken(rule.status, '') !== 'archived');
        const rows = candidates.slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('当前筛选结果里没有需要归档的关注规则', 'info');
            return false;
        }
        const confirmed = confirmRuleBatchAction(`确定归档当前筛选中的 ${rows.length} 条需关注规则吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('archive_attention', '批量归档需关注规则');
        const results = [];
        const failures = [];
        for (const rule of rows) {
            try {
                const result = await mutateRule({
                    action: 'archive_rule',
                    id: rule.id,
                    batch_previous_status: rule.status || '',
                    batch_previous_enabled: rule.enabled === true,
                    ...context
                });
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: rule.id,
                    name: rule.name,
                    message: error?.message || '归档失败'
                });
            }
        }
        upsertRulesInPayload(results);
        if (results.some((rule) => String(rule?.id || '') === state.editingRuleId)) {
            state.editingRuleId = '';
        }
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '批量归档需关注规则',
            total: candidates.length,
            success: results,
            failed: failures,
            skipped: Math.max(0, candidates.length - rows.length)
        }));
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    async function batchCopyFilteredRulesToDraft() {
        const summary = getRuleBatchSummary();
        const rows = summary.copyableRows.slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('当前筛选结果里没有可复制的规则', 'info');
            return false;
        }
        const confirmed = confirmRuleBatchAction(`确定把当前筛选中的 ${rows.length} 条规则复制为草稿吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('copy_filtered_to_draft', '批量复制当前筛选规则为草稿');
        const results = [];
        const failures = [];
        for (const rule of rows) {
            try {
                const result = await mutateRule(buildBatchRuleCopyPayload(rule, context));
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: rule.id,
                    name: rule.name,
                    message: error?.message || '复制失败'
                });
            }
        }
        upsertRulesInPayload(results);
        if (results.length) {
            state.ruleSearchQuery = '';
            state.ruleStatusFilter = 'draft';
            state.ruleHealthFilter = 'all';
            state.rulePageFilter = 'all';
            state.ruleAudienceFilter = 'all';
            state.ruleDuplicateFilter = false;
            resetRulePagination();
        }
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '批量复制规则为草稿',
            total: summary.copyable,
            success: results,
            failed: failures,
            skipped: Math.max(0, summary.copyable - rows.length)
        }));
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    function focusRuleHealthFilter(healthFilter = '') {
        state.activeView = 'rules';
        state.ruleSearchQuery = '';
        state.ruleStatusFilter = 'all';
        state.ruleHealthFilter = normalizeToken(healthFilter, 'all');
        state.rulePageFilter = 'all';
        state.ruleAudienceFilter = 'all';
        state.ruleDuplicateFilter = false;
        resetRulePagination();
        renderOverview(state.payload || {});
        document.querySelector('[data-engagement-rule-toolbar]')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function focusDuplicateRules() {
        state.activeView = 'rules';
        state.ruleSearchQuery = '';
        state.ruleStatusFilter = 'all';
        state.ruleHealthFilter = 'all';
        state.rulePageFilter = 'all';
        state.ruleAudienceFilter = 'all';
        state.ruleDuplicateFilter = true;
        resetRulePagination();
        renderOverview(state.payload || {});
        document.querySelector('[data-engagement-rule-toolbar]')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    async function batchArchiveHighRiskRules() {
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        const rows = rules
            .filter((rule) => getRuleHealth(rule).code === 'high_risk')
            .filter((rule) => normalizeToken(rule.status, '') !== 'archived')
            .slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('当前没有可归档的高风险规则', 'info');
            return false;
        }
        const confirmed = confirmRuleBatchAction(`确定归档 ${rows.length} 条高风险规则吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('archive_high_risk', '批量归档高风险规则');
        const results = [];
        const failures = [];
        for (const rule of rows) {
            try {
                const result = await mutateRule({
                    action: 'archive_rule',
                    id: rule.id,
                    batch_previous_status: rule.status || '',
                    batch_previous_enabled: rule.enabled === true,
                    ...context
                });
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: rule.id,
                    name: rule.name,
                    message: error?.message || '归档失败'
                });
            }
        }
        upsertRulesInPayload(results);
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '批量归档高风险规则',
            total: rows.length,
            success: results,
            failed: failures,
            skipped: 0
        }));
        state.activeView = 'rules';
        state.ruleHealthFilter = 'high_risk';
        resetRulePagination();
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    async function rollbackAuditBatch(batchId = '') {
        const normalizedBatchId = String(batchId || '').trim();
        if (!normalizedBatchId) return false;
        const auditLogs = Array.isArray(state.payload?.audit_logs) ? state.payload.audit_logs : [];
        const rows = auditLogs.filter((row) => {
            const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
            return String(details.batch_id || '').trim() === normalizedBatchId;
        }).slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('没有找到可回滚的批量审计记录', 'info');
            return false;
        }
        const confirmed = confirmRuleBatchAction(`确定回滚批次 ${normalizedBatchId} 的 ${rows.length} 条记录吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('rollback_batch', `回滚批次 ${normalizedBatchId}`);
        const results = [];
        const failures = [];
        for (const row of rows) {
            const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
            const ruleId = String(details.rule_id || '').trim();
            if (!ruleId) continue;
            try {
                let result = null;
                if (row.action_type === 'engagement.rule.pause') {
                    result = await mutateRule({
                        action: 'set_enabled',
                        id: ruleId,
                        enabled: true,
                        rollback_batch_id: normalizedBatchId,
                        ...context
                    });
                } else if (row.action_type === 'engagement.rule.archive') {
                    const rule = getRuleById(ruleId);
                    if (!rule) throw new Error('当前规则列表缺少这条规则');
                    result = await mutateRule({
                        ...rule,
                        action: 'save_rule',
                        id: ruleId,
                        status: details.batch_previous_status || 'paused',
                        enabled: details.batch_previous_enabled === true,
                        rollback_batch_id: normalizedBatchId,
                        ...context
                    });
                } else if (row.action_type === 'engagement.rule.create' && details.batch_source_rule_id) {
                    result = await mutateRule({
                        action: 'archive_rule',
                        id: ruleId,
                        rollback_batch_id: normalizedBatchId,
                        ...context
                    });
                }
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: ruleId,
                    name: details.name || ruleId,
                    message: error?.message || '回滚失败'
                });
            }
        }
        upsertRulesInPayload(results);
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: `回滚批次 ${normalizedBatchId}`,
            total: rows.length,
            success: results,
            failed: failures,
            skipped: Math.max(0, rows.length - results.length - failures.length)
        }));
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    async function toggleRule(ruleId = '', enabled = false, options = {}) {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return false;
        const currentRule = getRuleById(normalizedId);
        const publishCandidate = {
            ...(currentRule || {}),
            enabled: Boolean(enabled),
            status: enabled ? 'published' : 'paused'
        };
        const governanceAck = enabled && needsGovernancePublishAck(publishCandidate)
            ? buildGovernancePublishAck(publishCandidate, 'single_rule_publish_confirm')
            : {};
        if (enabled && needsGovernancePublishAck(publishCandidate)) {
            const confirmed = confirmHighRiskPublish(publishCandidate, `「${publishCandidate.name || '未命名规则'}」`);
            if (!confirmed) {
                showFeedback('高风险规则发布已取消', 'info');
                return false;
            }
        }
        const result = await mutateRule({
            action: 'set_enabled',
            id: normalizedId,
            enabled,
            ...governanceAck
        });
        upsertRuleInPayload(result?.rule);
        if (options?.showFeedback !== false) {
            showFeedback(options?.successMessage || (enabled ? '触达规则已发布' : '触达规则已暂停'), 'success');
        }
        if (options?.render !== false) {
            renderOverview(state.payload || {});
        }
        return true;
    }

    async function archiveRule(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return false;
        const result = await mutateRule({
            action: 'archive_rule',
            id: normalizedId
        });
        upsertRuleInPayload(result?.rule);
        if (state.editingRuleId === normalizedId) {
            state.editingRuleId = '';
        }
        showFeedback('触达规则已归档', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function deleteRule(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return false;
        const rule = getRuleById(normalizedId);
        const ruleName = rule?.name || '这条触达规则';
        const confirmed = typeof globalScope.confirm === 'function'
            ? globalScope.confirm(`确定永久删除「${ruleName}」吗？删除后不可恢复。`)
            : true;
        if (!confirmed) return false;
        const result = await mutateRule({
            action: 'delete_rule',
            id: normalizedId
        });
        const deletedId = String(result?.deleted_id || result?.deleted_rule?.id || normalizedId).trim();
        removeRuleFromPayload(deletedId || normalizedId);
        if (state.editingRuleId === normalizedId || state.editingRuleId === deletedId) {
            state.editingRuleId = '';
            state.ruleDraft = null;
            state.templateDraftRef = '';
        }
        showFeedback('触达规则已删除', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function pauseAllRules() {
        const runningCount = Number(state.payload?.governance?.running_rules || 0) || 0;
        if (runningCount <= 0) {
            showFeedback('当前没有运行中的触达规则', 'info');
            return false;
        }
        const confirmed = typeof globalScope.confirm === 'function'
            ? globalScope.confirm(`确定暂停当前站点 ${runningCount} 条运行中的触达规则吗？`)
            : true;
        if (!confirmed) return false;
        const result = await mutateRule({
            action: 'pause_all',
            site: getCurrentSite()
        });
        const rules = Array.isArray(result?.rules) ? result.rules : [];
        upsertRulesInPayload(rules);
        state.payload = {
            ...(state.payload || {}),
            governance: {
                ...(state.payload?.governance || {}),
                running_rules: Math.max(0, runningCount - rules.length),
                paused_rules: Number(state.payload?.governance?.paused_rules || 0) + rules.length,
                can_pause_all: Math.max(0, runningCount - rules.length) > 0
            }
        };
        showFeedback(rules.length ? `已暂停 ${rules.length} 条触达规则` : '没有符合条件的运行规则', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function restoreLatestPauseAllRules() {
        const latestPause = getLatestPauseAllAudit(state.payload?.audit_logs || []);
        const details = latestPause?.details && typeof latestPause.details === 'object' && !Array.isArray(latestPause.details)
            ? latestPause.details
            : {};
        const ruleIds = Array.isArray(details.rule_ids)
            ? details.rule_ids.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
        if (!ruleIds.length) {
            showFeedback('没有找到最近一键暂停的规则清单', 'info');
            return false;
        }
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        const rows = ruleIds
            .map((id) => rules.find((rule) => String(rule?.id || '').trim() === id))
            .filter(Boolean)
            .filter((rule) => normalizeToken(rule.status, '') !== 'archived')
            .slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('最近暂停的规则当前不可恢复', 'info');
            return false;
        }
        const highRiskRows = rows.filter((rule) => needsGovernancePublishAck({
            ...rule,
            enabled: true,
            status: 'published'
        }));
        if (highRiskRows.length) {
            const confirmedRisk = confirmRuleBatchAction(`恢复会重新发布 ${highRiskRows.length} 条高风险规则。确认已经复核后继续吗？`);
            if (!confirmedRisk) return false;
        }
        const confirmed = confirmRuleBatchAction(`确定恢复最近一键暂停中的 ${rows.length} 条规则吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('restore_pause_all', '恢复最近一键暂停规则');
        const results = [];
        const failures = [];
        for (const rule of rows) {
            try {
                const result = await mutateRule({
                    action: 'set_enabled',
                    id: rule.id,
                    enabled: true,
                    rollback_batch_id: latestPause.id || '',
                    batch_previous_status: rule.status || '',
                    batch_previous_enabled: rule.enabled === true,
                    ...(needsGovernancePublishAck({ ...rule, enabled: true, status: 'published' })
                        ? buildGovernancePublishAck(rule, 'restore_pause_all_confirm')
                        : {}),
                    ...context
                });
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: rule.id,
                    name: rule.name,
                    message: error?.message || '恢复失败'
                });
            }
        }
        upsertRulesInPayload(results);
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '恢复最近一键暂停规则',
            total: rows.length,
            success: results,
            failed: failures,
            skipped: Math.max(0, rows.length - results.length - failures.length)
        }));
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    function copyRuleToDraft(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        const sourceRule = rules.find((rule) => String(rule?.id || '').trim() === normalizedId);
        if (!sourceRule) return false;
        const sourceName = sourceRule.name || '未命名规则';
        state.ruleDraft = {
            ...sourceRule,
            id: '',
            name: `${sourceName} 副本`,
            source_name: sourceName,
            status: 'draft',
            enabled: false,
            updated_at: '',
            created_at: ''
        };
        state.editingRuleId = '';
        state.templateDraftRef = '';
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback('已复制为新规则草稿', 'info');
        return true;
    }

    function clearRuleDraft() {
        if (!state.ruleDraft) return false;
        state.ruleDraft = null;
        renderOverview(state.payload || {});
        return true;
    }

    function focusPageScene(pageId = '') {
        const normalizedPageId = normalizeToken(pageId, '');
        if (!normalizedPageId) return false;
        state.focusedPageId = normalizedPageId;
        state.rulePageFilter = 'all';
        resetRulePagination();
        state.editingRuleId = '';
        state.ruleDraft = null;
        state.activeView = 'rules';
        state.pendingFocusedPageScroll = true;
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback(`已切到${getPageLabel(normalizedPageId)}触达规则`, 'info');
        return true;
    }

    function clearPageFocus() {
        if (!state.focusedPageId) return false;
        state.focusedPageId = '';
        state.pendingFocusedPageScroll = false;
        resetRulePagination();
        renderOverview(state.payload || {});
        return true;
    }

    function applyTemplateToRule(templateRef = '') {
        const template = getTemplateByRef(templateRef);
        if (!template) return false;
        state.templateDraftRef = String(template.id || template.key || '').trim();
        state.ruleDraft = null;
        state.editingRuleId = '';
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback(`已套用「${template.name || template.key || '消息模板'}」模板`, 'info');
        return true;
    }

    function clearTemplateDraft() {
        if (!state.templateDraftRef) return false;
        state.templateDraftRef = '';
        renderOverview(state.payload || {});
        return true;
    }

    function editTemplate(templateRef = '') {
        const template = getTemplateByRef(templateRef);
        if (!template) return false;
        state.editingTemplateRef = String(template.id || template.key || '').trim();
        state.activeView = 'templates';
        renderOverview(state.payload || {});
        document.getElementById('engagementTemplateForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function resetTemplateComposer() {
        state.editingTemplateRef = '';
        state.activeView = 'templates';
        renderOverview(state.payload || {});
        return true;
    }

    function focusTemplateCategory(categoryId = '') {
        const category = getTemplateProductCategoryById(categoryId);
        if (!category) return false;
        state.templateCategoryFilter = category.id;
        state.activeView = 'templates';
        renderOverview(state.payload || {});
        document.querySelector('.engagement-workspace-view--templates')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback(`已切到${category.title}模板货架`, 'info');
        return true;
    }

    function clearTemplateCategoryFilter() {
        if (!state.templateCategoryFilter) return false;
        state.templateCategoryFilter = '';
        renderOverview(state.payload || {});
        return true;
    }

    function editSegment(segmentRef = '') {
        const normalizedRef = String(segmentRef || '').trim();
        if (!normalizedRef) return false;
        state.editingSegmentRef = normalizedRef;
        state.activeView = 'segments';
        renderOverview(state.payload || {});
        document.getElementById('engagementSegmentForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function resetSegmentComposer() {
        state.editingSegmentRef = '';
        state.activeView = 'segments';
        renderOverview(state.payload || {});
        return true;
    }

    function editUserTag(tagRef = '') {
        const normalizedRef = normalizeUserTagKey(tagRef, '');
        if (!normalizedRef) return false;
        state.editingUserTagRef = normalizedRef;
        state.activeView = 'segments';
        renderOverview(state.payload || {});
        document.getElementById('engagementUserTagForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function resetUserTagComposer() {
        state.editingUserTagRef = '';
        state.activeView = 'segments';
        renderOverview(state.payload || {});
        return true;
    }

    function editScene(pageId = '') {
        const normalizedPageId = normalizeToken(pageId || 'home', 'home');
        state.editingScenePageId = normalizedPageId;
        state.scenePreviewEvent = '';
        state.focusedPageId = normalizedPageId;
        state.activeView = 'scenes';
        renderOverview(state.payload || {});
        document.getElementById('engagementSceneForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function resetSceneComposer() {
        state.editingScenePageId = 'home';
        state.scenePreviewEvent = '';
        state.activeView = 'scenes';
        renderOverview(state.payload || {});
        return true;
    }

    function editAsset(assetId = '') {
        const normalizedId = String(assetId || '').trim();
        if (!normalizedId) return false;
        state.editingAssetId = normalizedId;
        state.activeView = 'assets';
        renderOverview(state.payload || {});
        document.getElementById('engagementAssetForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function resetAssetComposer() {
        state.editingAssetId = '';
        state.activeView = 'assets';
        renderOverview(state.payload || {});
        return true;
    }

    function focusCapability(capabilityId = '') {
        const capability = getCapabilityById(capabilityId);
        if (!capability) return false;
        state.focusedCapabilityId = capability.id;
        state.activeView = 'templates';
        renderOverview(state.payload || {});
        document.querySelector('.engagement-workspace-view--templates')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback(`已切到${capability.title}模板集合`, 'info');
        return true;
    }

    function clearCapabilityFocus() {
        if (!state.focusedCapabilityId) return false;
        state.focusedCapabilityId = '';
        renderOverview(state.payload || {});
        return true;
    }

    function focusAudienceSegment(audienceScope = '') {
        const normalizedScope = normalizeToken(audienceScope, 'all');
        const segment = getAudienceSegmentByScope(normalizedScope);
        const pageIds = Array.isArray(segment.pageIds) && segment.pageIds.length
            ? segment.pageIds.filter((pageId) => RULE_PAGE_OPTIONS.includes(pageId))
            : ['all'];
        state.ruleDraft = {
            id: '',
            name: `${segment.title}触达规则`,
            source_name: segment.title,
            site: getCurrentSite(),
            status: 'draft',
            enabled: false,
            page_ids: pageIds.length ? pageIds : ['all'],
            audience: { scope: segment.id },
            placement: 'robot_bubble',
            title: segment.title,
            content: '',
            tone: segment.id === 'visitors' ? 'welcome' : 'info',
            action_label: '',
            action_url: '',
            priority: 0,
            repeat_interval_minutes: 2,
            dismiss_ttl_hours: 24
        };
        state.editingRuleId = '';
        state.templateDraftRef = '';
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback(`已为${segment.title}准备触达规则草稿`, 'info');
        return true;
    }

    function buildAutomationRulePayload(blueprint = {}) {
        const pageIds = Array.isArray(blueprint.pageIds) && blueprint.pageIds.length
            ? blueprint.pageIds.filter((pageId) => RULE_PAGE_OPTIONS.includes(pageId))
            : ['all'];
        const semanticFamily = getAutomationBlueprintIntentFamily(blueprint);
        const intentLabel = getAutomationBlueprintIntentLabel(blueprint);
        return {
            action: 'save_rule',
            id: '',
            name: `${blueprint.title}自动化`,
            source_name: blueprint.title,
            site: getCurrentSite(),
            status: 'draft',
            enabled: false,
            page_ids: pageIds.length ? pageIds : ['all'],
            audience: { scope: blueprint.audienceScope || 'all' },
            trigger_type: blueprint.triggerType || 'page_view',
            placement: blueprint.placement || 'robot_bubble',
            title: blueprint.titleText || blueprint.title,
            content: blueprint.content || '',
            tone: blueprint.tone || 'info',
            action_label: blueprint.actionLabel || '',
            action_url: blueprint.actionUrl || '',
            priority: Number(blueprint.priority || 0) || 0,
            repeat_interval_minutes: 2,
            dismiss_ttl_hours: Number(blueprint.dismissTtlHours || 24) || 24,
            metadata: {
                source_module: 'engagement.automation_blueprint',
                automation_blueprint_id: blueprint.id || '',
                automation_blueprint_title: blueprint.title || '',
                automation_mode: blueprint.mode || '',
                automation_semantic_family: semanticFamily,
                automation_intent_label: intentLabel
            }
        };
    }

    function getAutomationRuleIntentFamily(rule = {}) {
        const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
            ? rule.metadata
            : {};
        const explicitFamily = normalizeToken(
            metadata.automation_semantic_family || metadata.automationSemanticFamily || '',
            ''
        );
        if (explicitFamily) return explicitFamily;
        const blueprintId = getAutomationBlueprintMetadataId(rule);
        if (!blueprintId) return '';
        const blueprint = AUTOMATION_BLUEPRINTS.find((item) => item.id === blueprintId);
        return blueprint ? getAutomationBlueprintIntentFamily(blueprint) : '';
    }

    function getAutomationRuleIntentLabel(rule = {}) {
        const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
            ? rule.metadata
            : {};
        const explicitLabel = String(metadata.automation_intent_label || metadata.automationIntentLabel || '').trim();
        if (explicitLabel) return explicitLabel;
        const blueprintId = getAutomationBlueprintMetadataId(rule);
        if (!blueprintId) return '';
        const blueprint = AUTOMATION_BLUEPRINTS.find((item) => item.id === blueprintId);
        return blueprint ? getAutomationBlueprintIntentLabel(blueprint) : '';
    }

    function getAutomationIntentSiblingRunningRules(automationId = '', excludedRuleId = '') {
        const normalizedAutomationId = normalizeToken(automationId, '');
        const normalizedExcludedRuleId = String(excludedRuleId || '').trim();
        if (!normalizedAutomationId) return [];
        const blueprint = AUTOMATION_BLUEPRINTS.find((item) => item.id === normalizedAutomationId);
        const semanticFamily = blueprint ? getAutomationBlueprintIntentFamily(blueprint) : '';
        if (!semanticFamily) return [];
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        return rules.filter((rule) => {
            const ruleId = String(rule?.id || '').trim();
            if (!ruleId || ruleId === normalizedExcludedRuleId) return false;
            if (!isRuleRunningNow(rule)) return false;
            return getAutomationRuleIntentFamily(rule) === semanticFamily;
        });
    }

    function getAutomationBlueprintMetadataId(rule = {}) {
        const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
            ? rule.metadata
            : {};
        return normalizeToken(
            metadata.automation_blueprint_id || metadata.automationBlueprintId || metadata.blueprint_id || '',
            ''
        );
    }

    function areRulePageSetsEqual(first = [], second = []) {
        const firstPages = normalizeRuleDuplicateList(first);
        const secondPages = normalizeRuleDuplicateList(second);
        return firstPages.length === secondPages.length
            && firstPages.every((pageId, index) => pageId === secondPages[index]);
    }

    function ruleMatchesAutomationBlueprintShape(rule = {}, blueprint = {}) {
        if (!rule || !blueprint?.id) return false;
        const expected = buildAutomationRulePayload(blueprint);
        const expectedName = `${blueprint.title || ''}自动化`;
        return normalizeRuleDuplicateText(rule.name) === normalizeRuleDuplicateText(expectedName)
            && normalizeToken(rule.site, getCurrentSite()) === normalizeToken(expected.site, getCurrentSite())
            && areRulePageSetsEqual(rule.page_ids, expected.page_ids)
            && getAudienceScope(rule.audience) === getAudienceScope(expected.audience)
            && normalizeToken(rule.trigger_type, 'page_view') === normalizeToken(expected.trigger_type, 'page_view')
            && normalizeToken(rule.placement, 'robot_bubble') === normalizeToken(expected.placement, 'robot_bubble')
            && normalizeRuleDuplicateText(rule.title) === normalizeRuleDuplicateText(expected.title)
            && normalizeRuleDuplicateText(rule.content) === normalizeRuleDuplicateText(expected.content)
            && normalizeRuleDuplicateText(rule.action_label) === normalizeRuleDuplicateText(expected.action_label)
            && normalizeRuleDuplicateText(rule.action_url) === normalizeRuleDuplicateText(expected.action_url)
            && normalizeToken(rule.tone, 'info') === normalizeToken(expected.tone, 'info')
            && Number(rule.priority || 0) === Number(expected.priority || 0)
            && getRuleRepeatIntervalMinutes(rule, 2) === getRuleRepeatIntervalMinutes(expected, 2)
            && Number(rule.dismiss_ttl_hours || 24) === Number(expected.dismiss_ttl_hours || 24);
    }

    function getAutomationBlueprintRules(blueprintId = '') {
        const normalizedId = normalizeToken(blueprintId, '');
        if (!normalizedId) return [];
        const blueprint = AUTOMATION_BLUEPRINTS.find((item) => item.id === normalizedId);
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        return rules.filter((rule) => {
            const ruleBlueprintId = getAutomationBlueprintMetadataId(rule);
            return ruleBlueprintId === normalizedId
                || (!ruleBlueprintId && blueprint && ruleMatchesAutomationBlueprintShape(rule, blueprint));
        });
    }

    function createRuleMetricsCounter() {
        return {
            views: 0,
            clicks: 0,
            dismisses: 0,
            conversions: 0
        };
    }

    function getRuleAnalyticsMetrics(ruleId = '') {
        const normalizedId = String(ruleId || '').trim();
        if (!normalizedId) return createRuleMetricsCounter();
        const rows = Array.isArray(state.payload?.analytics?.rule_breakdown)
            ? state.payload.analytics.rule_breakdown
            : [];
        const row = rows.find((item) => String(item?.rule_id || '').trim() === normalizedId) || {};
        return {
            views: Number(row.views || 0) || 0,
            clicks: Number(row.clicks || 0) || 0,
            dismisses: Number(row.dismisses || 0) || 0,
            conversions: Number(row.conversions || 0) || 0
        };
    }

    function getRuleHealth(rule = {}) {
        const metrics = getRuleAnalyticsMetrics(rule?.id);
        const views = Number(metrics.views || 0) || 0;
        const clicks = Number(metrics.clicks || 0) || 0;
        const dismisses = Number(metrics.dismisses || 0) || 0;
        const conversions = Number(metrics.conversions || 0) || 0;
        const ctr = getMetricRate(clicks, views);
        const dismissRate = getMetricRate(dismisses, views);
        const governance = getRuleGovernance(rule);
        const reasons = Array.isArray(governance.reasons) ? governance.reasons.filter(Boolean) : [];
        const normalizedStatus = normalizeToken(rule?.status, 'draft');
        const isRunning = rule?.enabled === true && normalizedStatus === 'published';
        const hasActionLabel = String(rule?.action_label || '').trim();
        const hasActionUrl = String(rule?.action_url || '').trim();
        const nextMetrics = {
            views,
            clicks,
            dismisses,
            conversions,
            ctr,
            dismiss_rate: dismissRate
        };

        if (governance.risk_level === 'high') {
            return {
                code: 'high_risk',
                tone: 'danger',
                label: '高风险待审',
                detail: reasons.length ? reasons.slice(0, 2).join('、') : '触达强度较高，建议发布前复核。',
                icon: 'fa-triangle-exclamation',
                metrics: nextMetrics
            };
        }
        if (hasActionLabel && !hasActionUrl) {
            return {
                code: 'missing_link',
                tone: 'warning',
                label: '缺少跳转链接',
                detail: '按钮有文案但没有路径，用户点击后无法转化。',
                icon: 'fa-link-slash',
                metrics: nextMetrics
            };
        }
        if (!isRunning) {
            const label = normalizedStatus === 'archived' ? '已归档' : (normalizedStatus === 'paused' ? '已暂停' : '待发布');
            const detail = normalizedStatus === 'draft' ? '草稿保存后还未发布。' : '当前不会在前台触达用户。';
            return {
                code: normalizedStatus === 'archived' ? 'archived' : (normalizedStatus === 'paused' ? 'paused' : 'draft'),
                tone: normalizedStatus === 'archived' ? 'idle' : 'draft',
                label,
                detail,
                icon: normalizedStatus === 'archived' ? 'fa-box-archive' : 'fa-pen-to-square',
                metrics: nextMetrics
            };
        }
        if (views <= 0) {
            return {
                code: 'no_views',
                tone: 'warning',
                label: '已发布无曝光',
                detail: '近 24 小时没有曝光，检查页面、分群或触发条件。',
                icon: 'fa-eye-slash',
                metrics: nextMetrics
            };
        }
        if (dismissRate >= 60) {
            return {
                code: 'high_dismiss',
                tone: 'warning',
                label: '关闭率偏高',
                detail: `关闭率 ${formatPercent(dismissRate)}，建议降低打扰或调整文案。`,
                icon: 'fa-circle-xmark',
                metrics: nextMetrics
            };
        }
        if (views >= 20 && ctr < 1) {
            return {
                code: 'low_ctr',
                tone: 'attention',
                label: '点击率偏低',
                detail: `CTR ${formatPercent(ctr)}，建议检查按钮、权益或跳转路径。`,
                icon: 'fa-chart-line',
                metrics: nextMetrics
            };
        }
        if (ctr >= 8 || conversions > 0) {
            return {
                code: 'good',
                tone: 'good',
                label: '表现良好',
                detail: conversions > 0 ? `${formatNumber(conversions)} 次转化已回传。` : `CTR ${formatPercent(ctr)}，继续观察转化。`,
                icon: 'fa-circle-check',
                metrics: nextMetrics
            };
        }
        return {
            code: 'ok',
            tone: 'ok',
            label: '运行正常',
            detail: reasons.length ? reasons.slice(0, 2).join('、') : `近 24 小时 ${formatNumber(views)} 曝光。`,
            icon: 'fa-check',
            metrics: nextMetrics
        };
    }

    function getAutomationBlueprintMetrics(rules = []) {
        return rules.reduce((counter, rule) => {
            const metrics = getRuleAnalyticsMetrics(rule?.id);
            counter.views += metrics.views;
            counter.clicks += metrics.clicks;
            counter.dismisses += metrics.dismisses;
            counter.conversions += metrics.conversions;
            return counter;
        }, createRuleMetricsCounter());
    }

    function getMetricRate(part = 0, total = 0) {
        const safePart = Number(part || 0) || 0;
        const safeTotal = Number(total || 0) || 0;
        if (safeTotal <= 0) return 0;
        return Math.round((safePart / safeTotal) * 1000) / 10;
    }

    function getAutomationBlueprintHealth(status = {}) {
        const rules = Array.isArray(status.rules) ? status.rules : [];
        const metrics = status.metrics || createRuleMetricsCounter();
        const views = Number(metrics.views || 0) || 0;
        const clicks = Number(metrics.clicks || 0) || 0;
        const dismisses = Number(metrics.dismisses || 0) || 0;
        const ctr = getMetricRate(clicks, views);
        const dismissRate = getMetricRate(dismisses, views);
        const highRiskRule = rules.find((rule) => getRuleGovernance(rule).risk_level === 'high');
        const missingActionRule = rules.find((rule) => String(rule?.action_label || '').trim() && !String(rule?.action_url || '').trim());

        if (!rules.length) {
            return {
                tone: 'idle',
                label: '待创建',
                detail: '还没有从这个蓝图生成规则。',
                icon: 'fa-circle-plus'
            };
        }
        if (highRiskRule) {
            const reasons = getRuleGovernance(highRiskRule).reasons;
            return {
                tone: 'danger',
                label: '高风险待审',
                detail: reasons.length ? reasons.slice(0, 2).join('、') : '这条规则触达强度较高，发布前建议复核。',
                icon: 'fa-triangle-exclamation'
            };
        }
        if (missingActionRule) {
            return {
                tone: 'warning',
                label: '缺少跳转链接',
                detail: '规则配置了按钮文案，但还没有填写可点击路径。',
                icon: 'fa-link-slash'
            };
        }
        if (Number(status.running || 0) <= 0) {
            return {
                tone: 'draft',
                label: '待发布',
                detail: Number(status.drafts || 0) > 0 ? '已有草稿，编辑确认后即可发布。' : '当前没有运行中的关联规则。',
                icon: 'fa-pen-to-square'
            };
        }
        if (views <= 0) {
            return {
                tone: 'warning',
                label: '已发布无曝光',
                detail: '近 24 小时没有曝光，检查页面、分群或触发事件。',
                icon: 'fa-eye-slash'
            };
        }
        if (dismissRate >= 60) {
            return {
                tone: 'warning',
                label: '关闭率偏高',
                detail: `关闭率 ${formatPercent(dismissRate)}，建议降低打扰或调整文案。`,
                icon: 'fa-circle-xmark'
            };
        }
        if (views >= 20 && ctr < 1) {
            return {
                tone: 'attention',
                label: '点击率偏低',
                detail: `CTR ${formatPercent(ctr)}，建议检查按钮、权益或跳转路径。`,
                icon: 'fa-chart-line'
            };
        }
        if (ctr >= 8 || Number(metrics.conversions || 0) > 0) {
            return {
                tone: 'good',
                label: '表现良好',
                detail: `CTR ${formatPercent(ctr)}，继续观察转化表现。`,
                icon: 'fa-circle-check'
            };
        }
        return {
            tone: 'ok',
            label: '运行正常',
            detail: `近 24 小时 ${formatNumber(views)} 曝光，CTR ${formatPercent(ctr)}。`,
            icon: 'fa-check'
        };
    }

    function getAutomationBlueprintStatus(blueprintId = '') {
        const rules = getAutomationBlueprintRules(blueprintId);
        const running = rules.filter((rule) => isRuleRunningNow(rule));
        const drafts = rules.filter((rule) => normalizeToken(rule.status, '') === 'draft');
        const paused = rules.filter((rule) => ['paused', 'archived'].includes(normalizeToken(rule.status, '')));
        const primaryRule = running[0] || drafts[0] || rules[0] || null;
        const summary = {
            rules,
            total: rules.length,
            running: running.length,
            drafts: drafts.length,
            paused: paused.length,
            primaryRule,
            metrics: getAutomationBlueprintMetrics(rules)
        };
        summary.health = getAutomationBlueprintHealth(summary);
        return summary;
    }

    function focusExistingAutomationRule(automationId = '') {
        const status = getAutomationBlueprintStatus(automationId);
        const ruleId = String(status.primaryRule?.id || '').trim();
        if (!ruleId) return false;
        state.ruleDraft = null;
        state.templateDraftRef = '';
        state.editingRuleId = ruleId;
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback('已打开这个自动化蓝图生成的规则', 'info');
        return true;
    }

    function focusAutomationBlueprint(automationId = '') {
        const normalizedId = normalizeToken(automationId, '');
        const blueprint = AUTOMATION_BLUEPRINTS.find((item) => item.id === normalizedId);
        if (!blueprint) return false;
        state.ruleDraft = buildAutomationRulePayload(blueprint);
        state.editingRuleId = '';
        state.templateDraftRef = '';
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback(`已生成${blueprint.title}规则草稿`, 'info');
        return true;
    }

    async function createAutomationRuleFromBlueprint(automationId = '') {
        const normalizedId = normalizeToken(automationId, '');
        const blueprint = AUTOMATION_BLUEPRINTS.find((item) => item.id === normalizedId);
        if (!blueprint) return false;
        if (getAutomationBlueprintStatus(normalizedId).total > 0) {
            return focusExistingAutomationRule(normalizedId);
        }
        return focusAutomationBlueprint(normalizedId);
    }

    async function toggleAutomationRuleFromBlueprint(automationId = '', enabled = false) {
        const normalizedId = normalizeToken(automationId, '');
        const status = getAutomationBlueprintStatus(normalizedId);
        const ruleId = String(status.primaryRule?.id || '').trim();
        if (!ruleId) {
            showFeedback('这个自动化蓝图还没有规则，请先创建规则草稿', 'info');
            return false;
        }
        if (enabled) {
            const siblingRunningRules = getAutomationIntentSiblingRunningRules(normalizedId, ruleId);
            if (siblingRunningRules.length) {
                const primaryRule = getRuleById(ruleId) || status.primaryRule || {};
                const intentLabel = getAutomationRuleIntentLabel(primaryRule)
                    || getAutomationBlueprintIntentLabel(AUTOMATION_BLUEPRINTS.find((item) => item.id === normalizedId) || {})
                    || '同一意图';
                const siblingLabels = siblingRunningRules
                    .map((rule) => `- ${rule.name || rule.title || '未命名规则'}`)
                    .join('\n');
                const confirmed = confirmRuleBatchAction([
                    `「${intentLabel}」已有 ${siblingRunningRules.length} 条运行中规则。`,
                    '继续后会自动暂停这些同意图规则，避免同一事件重复通知：',
                    siblingLabels
                ].join('\n'));
                if (!confirmed) {
                    showFeedback('自动化规则发布已取消', 'info');
                    return false;
                }
                for (const siblingRule of siblingRunningRules) {
                    const siblingRuleId = String(siblingRule?.id || '').trim();
                    if (!siblingRuleId) continue;
                    await toggleRule(siblingRuleId, false, {
                        showFeedback: false,
                        render: false
                    });
                }
            }
        }
        return toggleRule(ruleId, enabled, {
            successMessage: enabled ? '自动化规则已发布，同意图重复规则已自动收口' : '自动化规则已暂停'
        });
    }

    function copyAutomationRuleFromBlueprint(automationId = '') {
        const normalizedId = normalizeToken(automationId, '');
        const status = getAutomationBlueprintStatus(normalizedId);
        const ruleId = String(status.primaryRule?.id || '').trim();
        if (!ruleId) {
            showFeedback('这个自动化蓝图还没有可复制的规则', 'info');
            return false;
        }
        return copyRuleToDraft(ruleId);
    }

    async function createMissingAutomationRules() {
        const summary = getAutomationFlowSummary();
        const rows = summary.rows.filter((row) => Number(row.status.total || 0) <= 0);
        if (!rows.length) {
            showFeedback('所有自动化蓝图都已经接入规则', 'info');
            return false;
        }
        const confirmed = confirmRuleBatchAction(`确定为 ${rows.length} 个缺失蓝图创建规则草稿吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('automation_create_missing', '批量创建缺失自动化蓝图');
        const results = [];
        const failures = [];
        for (const row of rows) {
            try {
                const payload = {
                    ...buildAutomationRulePayload(row.blueprint),
                    ...context
                };
                payload.metadata = {
                    ...(payload.metadata || {}),
                    batch_id: context.batch_id,
                    batch_action: context.batch_action
                };
                const result = await mutateRule(payload);
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: row.blueprint.id,
                    name: row.blueprint.title,
                    message: error?.message || '创建失败'
                });
            }
        }
        upsertRulesInPayload(results);
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '批量创建缺失自动化蓝图',
            total: rows.length,
            success: results,
            failed: failures,
            skipped: 0
        }));
        state.activeView = 'automation';
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    async function publishAutomationDraftRules() {
        const summary = getAutomationFlowSummary();
        const rows = summary.automationRules
            .filter((rule) => normalizeToken(rule.status, '') === 'draft' && rule.enabled !== true)
            .slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('当前没有待发布的自动化草稿', 'info');
            return false;
        }
        const highRiskRows = rows.filter((rule) => needsGovernancePublishAck({
            ...rule,
            enabled: true,
            status: 'published'
        }));
        if (highRiskRows.length) {
            const confirmedRisk = confirmRuleBatchAction(`这次会发布 ${highRiskRows.length} 条高风险自动化规则。确认已经复核页面、频率、语气和跳转链接吗？`);
            if (!confirmedRisk) return false;
        }
        const confirmed = confirmRuleBatchAction(`确定发布 ${rows.length} 条自动化草稿规则吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('automation_publish_drafts', '批量发布自动化草稿');
        const results = [];
        const failures = [];
        for (const rule of rows) {
            try {
                const result = await mutateRule({
                    action: 'set_enabled',
                    id: rule.id,
                    enabled: true,
                    batch_previous_status: rule.status || '',
                    batch_previous_enabled: rule.enabled === true,
                    ...(needsGovernancePublishAck({ ...rule, enabled: true, status: 'published' })
                        ? buildGovernancePublishAck(rule, 'automation_batch_publish_confirm')
                        : {}),
                    ...context
                });
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: rule.id,
                    name: rule.name,
                    message: error?.message || '发布失败'
                });
            }
        }
        upsertRulesInPayload(results);
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '批量发布自动化草稿',
            total: summary.drafts,
            success: results,
            failed: failures,
            skipped: Math.max(0, summary.drafts - rows.length)
        }));
        state.activeView = 'automation';
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    async function pauseRunningAutomationRules() {
        const summary = getAutomationFlowSummary();
        const rows = summary.automationRules
            .filter((rule) => isRuleRunningNow(rule))
            .slice(0, RULE_BATCH_LIMIT);
        if (!rows.length) {
            showFeedback('当前没有运行中的自动化规则', 'info');
            return false;
        }
        const confirmed = confirmRuleBatchAction(`确定暂停 ${rows.length} 条运行中的自动化规则吗？`);
        if (!confirmed) return false;
        const context = createRuleBatchContext('automation_pause_running', '批量暂停运行中自动化');
        const results = [];
        const failures = [];
        for (const rule of rows) {
            try {
                const result = await mutateRule({
                    action: 'set_enabled',
                    id: rule.id,
                    enabled: false,
                    batch_previous_status: rule.status || '',
                    batch_previous_enabled: rule.enabled === true,
                    ...context
                });
                if (result?.rule) results.push(result.rule);
            } catch (error) {
                failures.push({
                    id: rule.id,
                    name: rule.name,
                    message: error?.message || '暂停失败'
                });
            }
        }
        upsertRulesInPayload(results);
        finishRuleBatchAction(buildRuleBatchResult({
            context,
            label: '批量暂停运行中自动化',
            total: summary.running,
            success: results,
            failed: failures,
            skipped: Math.max(0, summary.running - rows.length)
        }));
        state.activeView = 'automation';
        renderOverview(state.payload || {});
        return results.length > 0;
    }

    function closeEngagementSelects(exceptSelect = null) {
        document.querySelectorAll('.engagement-select.is-open').forEach((selectEl) => {
            if (exceptSelect && selectEl === exceptSelect) return;
            selectEl.classList.remove('is-open');
            selectEl.querySelector('[data-engagement-select-trigger]')?.setAttribute('aria-expanded', 'false');
            selectEl.querySelector('.engagement-select__menu')?.setAttribute('aria-hidden', 'true');
        });
    }

    function toggleEngagementSelect(selectEl) {
        if (!(selectEl instanceof HTMLElement)) return;
        const isOpen = selectEl.classList.contains('is-open');
        closeEngagementSelects(selectEl);
        selectEl.classList.toggle('is-open', !isOpen);
        selectEl.querySelector('[data-engagement-select-trigger]')?.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        selectEl.querySelector('.engagement-select__menu')?.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    }

    function syncEngagementSelectValue(selectEl, value = '') {
        if (!(selectEl instanceof HTMLElement)) return false;
        const normalizedValue = String(value || '').trim();
        const input = selectEl.querySelector('[data-engagement-select-input]');
        const valueEl = selectEl.querySelector('.engagement-select__value');
        const optionEl = Array.from(selectEl.querySelectorAll('[data-engagement-select-option]'))
            .find((item) => item instanceof HTMLElement && String(item.dataset.value || '').trim() === normalizedValue);
        const label = optionEl?.querySelector('span')?.textContent?.trim() || normalizedValue;
        if (input instanceof HTMLInputElement) {
            input.value = normalizedValue;
        }
        if (valueEl instanceof HTMLElement) {
            valueEl.textContent = label;
        }
        selectEl.querySelectorAll('[data-engagement-select-option]').forEach((item) => {
            const isSelected = item === optionEl;
            item.classList.toggle('is-selected', isSelected);
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
        return true;
    }

    function chooseEngagementSelectOption(optionEl) {
        if (!(optionEl instanceof HTMLElement)) return;
        const selectEl = optionEl.closest('.engagement-select');
        if (!(selectEl instanceof HTMLElement)) return;

        const value = String(optionEl.dataset.value || '').trim();
        const input = selectEl.querySelector('[data-engagement-select-input]');

        syncEngagementSelectValue(selectEl, value);
        closeEngagementSelects();
        if (handleColorPresetSelectChange(input)) return;
        if (handleRuleManagementSelectChange(input)) return;
        if (handleRulePreviewSelectChange(input)) return;
        if (input instanceof HTMLInputElement && input.name === 'page_id' && input.closest('#engagementSceneForm')) {
            state.editingScenePageId = normalizeToken(input.value || 'home', 'home');
            state.scenePreviewEvent = '';
            state.activeView = 'scenes';
            renderOverview(state.payload || {});
            return;
        }
        if (input instanceof HTMLInputElement && input.name === 'id' && input.closest('#engagementEntryContextForm')) {
            state.editingSupportContextId = normalizeToken(input.value || 'default', 'default');
            state.activeView = 'entry';
            renderOverview(state.payload || {});
            return;
        }
        updateRulePreviewFromForm();
        updateTemplatePreviewFromForm();
        updateScenePreviewFromForm();
    }

    function closeEngagementDateTimePickers(exceptPicker = null) {
        document.querySelectorAll('[data-engagement-datetime-picker]').forEach((picker) => {
            if (!(picker instanceof HTMLElement) || picker === exceptPicker) return;
            picker.classList.remove('is-open');
            picker.querySelector('[data-engagement-datetime-trigger]')?.setAttribute('aria-expanded', 'false');
            const panel = picker.querySelector('[data-engagement-datetime-panel]');
            if (panel instanceof HTMLElement) {
                panel.hidden = true;
            }
        });
    }

    function syncEngagementDateTimePicker(picker, value = '') {
        if (!(picker instanceof HTMLElement)) return;
        const normalizedValue = formatRuleDateTimeLocal(value);
        const input = picker.querySelector('[data-engagement-publish-at-value]');
        const label = picker.querySelector('[data-engagement-datetime-label]');
        const dateInput = picker.querySelector('[data-engagement-datetime-date]');
        const timeInput = picker.querySelector('[data-engagement-datetime-time]');
        const parts = getRuleDateTimeParts(normalizedValue);
        const form = picker.closest('form');
        const statusSelect = form?.querySelector?.('[data-engagement-select="status"]');
        const statusInput = statusSelect?.querySelector?.('[data-engagement-select-input]');

        picker.classList.toggle('has-value', Boolean(normalizedValue));
        picker.classList.remove('is-invalid');
        if (
            normalizedValue
            && statusSelect instanceof HTMLElement
            && statusInput instanceof HTMLInputElement
            && normalizeToken(statusInput.value, 'draft') === 'draft'
        ) {
            syncEngagementSelectValue(statusSelect, 'published');
        }
        if (input instanceof HTMLInputElement) {
            input.value = normalizedValue;
        }
        if (label instanceof HTMLElement) {
            label.textContent = formatRuleDateTimeDisplay(normalizedValue);
        }
        if (dateInput instanceof HTMLInputElement) {
            dateInput.value = parts.date;
        }
        if (timeInput instanceof HTMLInputElement) {
            timeInput.value = parts.time;
        }
        updateRulePreviewFromForm();
    }

    function enforceRuleScheduledStatusSelect(form = document.getElementById('engagementRuleForm')) {
        if (!(form instanceof HTMLFormElement)) return false;
        const startsAtValue = syncRulePublishAtHiddenValue(form);
        const statusSelect = form.querySelector('[data-engagement-select="status"]');
        const statusInput = statusSelect?.querySelector?.('[data-engagement-select-input]');
        if (
            normalizeRuleDateTimePayload(startsAtValue)
            && statusSelect instanceof HTMLElement
            && statusInput instanceof HTMLInputElement
            && normalizeToken(statusInput.value, 'draft') === 'draft'
        ) {
            return syncEngagementSelectValue(statusSelect, 'published');
        }
        return false;
    }

    function toggleEngagementDateTimePicker(triggerEl) {
        if (!(triggerEl instanceof HTMLElement)) return;
        const picker = triggerEl.closest('[data-engagement-datetime-picker]');
        if (!(picker instanceof HTMLElement)) return;
        const isOpen = picker.classList.contains('is-open');
        closeEngagementSelects();
        closeEngagementDateTimePickers(isOpen ? null : picker);
        picker.classList.toggle('is-open', !isOpen);
        triggerEl.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        const panel = picker.querySelector('[data-engagement-datetime-panel]');
        if (panel instanceof HTMLElement) {
            panel.hidden = isOpen;
        }
    }

    function applyEngagementDateTimePicker(picker) {
        if (!(picker instanceof HTMLElement)) return;
        const dateInput = picker.querySelector('[data-engagement-datetime-date]');
        const timeInput = picker.querySelector('[data-engagement-datetime-time]');
        const nextValue = composeRuleDateTimeLocal(
            dateInput instanceof HTMLInputElement ? dateInput.value : '',
            timeInput instanceof HTMLInputElement ? timeInput.value : ''
        );
        if (nextValue === null) {
            picker.classList.add('is-invalid');
            return;
        }
        syncEngagementDateTimePicker(picker, nextValue);
        closeEngagementDateTimePickers();
    }

    function handleEngagementDateTimeManualInput(inputEl) {
        if (!(inputEl instanceof HTMLElement)) return false;
        const picker = inputEl.closest('[data-engagement-datetime-picker]');
        if (!(picker instanceof HTMLElement)) return false;
        picker.classList.remove('is-invalid');
        return true;
    }

    function updateColorFieldSwatch(colorField, value = '') {
        if (!(colorField instanceof HTMLElement)) return;
        const color = normalizeHexColor(value, '');
        const swatch = colorField.querySelector('[data-engagement-color-swatch]');
        if (swatch instanceof HTMLElement && color) {
            swatch.style.background = color;
        }
    }

    function handleColorPresetSelectChange(input) {
        if (!(input instanceof HTMLInputElement) || !/_preset$/.test(String(input.name || ''))) {
            return false;
        }
        const colorField = input.closest('[data-engagement-color-field]');
        if (!(colorField instanceof HTMLElement)) return false;
        const colorInput = colorField.querySelector('[data-engagement-color-value]');
        const color = normalizeHexColor(input.value, '');
        if (colorInput instanceof HTMLInputElement && color) {
            colorInput.value = color;
            updateColorFieldSwatch(colorField, color);
        }
        return true;
    }

    function handleRuleManagementSelectChange(input) {
        if (!(input instanceof HTMLInputElement)) return false;
        const value = String(input.value || '').trim();
        if (input.name === 'rule_status_filter') {
            state.ruleStatusFilter = normalizeToken(value, 'all');
        } else if (input.name === 'rule_health_filter') {
            state.ruleHealthFilter = normalizeToken(value, 'all');
        } else if (input.name === 'rule_page_filter') {
            state.rulePageFilter = normalizeToken(value, 'all');
        } else if (input.name === 'rule_audience_filter') {
            state.ruleAudienceFilter = normalizeToken(value, 'all');
        } else if (input.name === 'rule_sort') {
            state.ruleSort = normalizeToken(value, 'updated_desc');
        } else {
            return false;
        }
        resetRulePagination();
        renderOverview(state.payload || {});
        return true;
    }

    function handleRulePreviewSelectChange(input) {
        if (!(input instanceof HTMLInputElement)) return false;
        if (input.name === 'preview_page_id') {
            state.previewPageId = normalizeToken(input.value, 'auto');
        } else if (input.name === 'preview_event_sample') {
            const previewData = collectRulePreviewFormData();
            state.previewEventSample = normalizeRulePreviewSample(previewData.trigger_type, input.value || '');
        } else if (input.name === 'scene_preview_event') {
            const scenePreviewData = collectScenePreviewFormData();
            state.scenePreviewEvent = normalizeScenePreviewEvent(scenePreviewData.scene?.events || [], input.value || '');
        } else if (input.name === 'scene_preview_sample') {
            const scenePreviewData = collectScenePreviewFormData();
            state.previewEventSample = normalizeRulePreviewSample(scenePreviewData.trigger_type, input.value || '');
        } else {
            return false;
        }
        updateRulePreviewFromForm();
        updateTemplatePreviewFromForm();
        updateScenePreviewFromForm();
        return true;
    }

    function scheduleRuleSearchRender(inputEl) {
        if (!(inputEl instanceof HTMLInputElement)) return;
        if (ruleSearchRenderTimer) {
            globalScope.clearTimeout?.(ruleSearchRenderTimer);
        }
        ruleSearchRenderTimer = globalScope.setTimeout?.(() => {
            ruleSearchRenderTimer = 0;
            renderOverview(state.payload || {});
            const nextInput = document.querySelector('[data-engagement-rule-search]');
            if (nextInput instanceof HTMLInputElement) {
                nextInput.focus?.({ preventScroll: true });
                const cursor = nextInput.value.length;
                nextInput.setSelectionRange?.(cursor, cursor);
            }
        }, 160) || 0;
    }

    function clearRuleFilters() {
        state.ruleSearchQuery = '';
        state.ruleStatusFilter = 'all';
        state.ruleHealthFilter = 'all';
        state.rulePageFilter = 'all';
        state.ruleAudienceFilter = 'all';
        state.ruleDuplicateFilter = false;
        state.ruleSort = 'updated_desc';
        resetRulePagination();
        renderOverview(state.payload || {});
    }

    function setPreviewOption(key = '', value = '') {
        const normalizedKey = normalizeToken(key, '');
        const normalizedValue = normalizeToken(value, '');
        if (normalizedKey === 'device') {
            state.previewDevice = normalizedValue === 'mobile' ? 'mobile' : 'desktop';
        } else if (normalizedKey === 'theme') {
            state.previewTheme = normalizedValue === 'dark' ? 'dark' : 'light';
        } else {
            return false;
        }
        updateRulePreviewFromForm();
        updateTemplatePreviewFromForm();
        updateScenePreviewFromForm();
        return true;
    }

    function getSelectedEngagementPages(pickerEl) {
        return Array.from(pickerEl.querySelectorAll('[data-engagement-page-toggle].is-selected'))
            .map((item) => String(item.dataset.value || '').trim())
            .filter(Boolean);
    }

    function syncEngagementPagePicker(pickerEl, selectedPages = []) {
        if (!(pickerEl instanceof HTMLElement)) return;
        const normalizedPages = selectedPages.length ? selectedPages : ['all'];
        const selected = new Set(normalizedPages);

        pickerEl.querySelectorAll('[data-engagement-page-toggle]').forEach((button) => {
            const isSelected = selected.has(String(button.dataset.value || '').trim());
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });

        const valuesEl = pickerEl.querySelector('[data-engagement-page-values]');
        if (valuesEl) {
            valuesEl.innerHTML = Array.from(selected).map((pageId) => (
                `<input type="hidden" name="page_ids" value="${escapeHtml(pageId)}" data-engagement-page-value>`
            )).join('');
        }
    }

    function toggleEngagementPageChoice(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const pickerEl = buttonEl.closest('[data-engagement-page-picker]');
        if (!(pickerEl instanceof HTMLElement)) return;

        const pageId = String(buttonEl.dataset.value || '').trim();
        let selectedPages = getSelectedEngagementPages(pickerEl);
        if (pageId === 'all') {
            selectedPages = ['all'];
        } else {
            selectedPages = selectedPages.filter((item) => item !== 'all');
            if (selectedPages.includes(pageId)) {
                selectedPages = selectedPages.filter((item) => item !== pageId);
            } else {
                selectedPages.push(pageId);
            }
            if (!selectedPages.length) {
                selectedPages = ['all'];
            }
        }

        syncEngagementPagePicker(pickerEl, selectedPages);
        updateRulePreviewFromForm();
    }

    function getSelectedSupportActions(pickerEl) {
        return Array.from(pickerEl.querySelectorAll('[data-engagement-support-action-toggle].is-selected'))
            .map((item) => String(item.dataset.value || '').trim())
            .filter(Boolean);
    }

    function syncSupportActionPicker(pickerEl, selectedActions = []) {
        if (!(pickerEl instanceof HTMLElement)) return;
        const normalizedActions = selectedActions.length ? selectedActions : ['create_ticket'];
        const selected = new Set(normalizedActions);

        pickerEl.querySelectorAll('[data-engagement-support-action-toggle]').forEach((button) => {
            const isSelected = selected.has(String(button.dataset.value || '').trim());
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });

        const valuesEl = pickerEl.querySelector('[data-engagement-support-action-values]');
        if (valuesEl) {
            valuesEl.innerHTML = Array.from(selected).map((actionId) => (
                `<input type="hidden" name="shortcuts" value="${escapeHtml(actionId)}" data-engagement-support-action-value>`
            )).join('');
        }
    }

    function getSelectedSceneEvents(pickerEl) {
        return Array.from(pickerEl.querySelectorAll('[data-engagement-scene-event-toggle].is-selected'))
            .map((item) => String(item.dataset.value || '').trim())
            .filter(Boolean);
    }

    function syncSceneEventPicker(pickerEl, selectedEvents = []) {
        if (!(pickerEl instanceof HTMLElement)) return;
        const normalizedEvents = selectedEvents.length ? selectedEvents : ['new_user_welcome'];
        const selected = new Set(normalizedEvents);

        pickerEl.querySelectorAll('[data-engagement-scene-event-toggle]').forEach((button) => {
            const isSelected = selected.has(String(button.dataset.value || '').trim());
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });

        const valuesEl = pickerEl.querySelector('[data-engagement-scene-event-values]');
        if (valuesEl) {
            valuesEl.innerHTML = Array.from(selected).map((eventKey) => (
                `<input type="hidden" name="events" value="${escapeHtml(eventKey)}" data-engagement-scene-event-value>`
            )).join('');
        }
    }

    function toggleSceneEventChoice(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const pickerEl = buttonEl.closest('[data-engagement-scene-event-picker]');
        if (!(pickerEl instanceof HTMLElement)) return;

        const eventKey = String(buttonEl.dataset.value || '').trim();
        let selectedEvents = getSelectedSceneEvents(pickerEl);
        if (selectedEvents.includes(eventKey)) {
            selectedEvents = selectedEvents.filter((item) => item !== eventKey);
        } else {
            selectedEvents.push(eventKey);
        }
        if (!selectedEvents.length) {
            selectedEvents = ['new_user_welcome'];
        }

        syncSceneEventPicker(pickerEl, selectedEvents);
        state.scenePreviewEvent = normalizeScenePreviewEvent(selectedEvents, state.scenePreviewEvent || eventKey);
        updateScenePreviewFromForm();
    }

    function getSelectedEventPriorityEvents(pickerEl) {
        return Array.from(pickerEl.querySelectorAll('[data-engagement-event-priority-toggle].is-selected'))
            .map((item) => String(item.dataset.value || '').trim())
            .filter(Boolean);
    }

    function syncEventPriorityPicker(pickerEl, groupId = '', selectedEvents = []) {
        if (!(pickerEl instanceof HTMLElement)) return;
        const selected = new Set((Array.isArray(selectedEvents) ? selectedEvents : []).map((eventKey) => normalizeToken(eventKey, '')).filter(Boolean));
        pickerEl.querySelectorAll('[data-engagement-event-priority-toggle]').forEach((button) => {
            const isSelected = selected.has(String(button.dataset.value || '').trim());
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
        const valuesEl = pickerEl.querySelector('[data-engagement-event-priority-values]');
        if (valuesEl) {
            valuesEl.innerHTML = Array.from(selected).map((eventKey) => (
                `<input type="hidden" name="${escapeHtml(groupId)}_events" value="${escapeHtml(eventKey)}" data-engagement-event-priority-value>`
            )).join('');
        }
    }

    function toggleEventPriorityChoice(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const pickerEl = buttonEl.closest('[data-engagement-event-priority-picker]');
        if (!(pickerEl instanceof HTMLElement)) return;
        const groupId = String(buttonEl.dataset.priorityGroup || pickerEl.dataset.priorityGroup || '').trim();
        const scopeId = String(buttonEl.dataset.priorityScope || pickerEl.dataset.priorityScope || 'global').trim() || 'global';
        const eventKey = String(buttonEl.dataset.value || '').trim();
        if (!groupId || !eventKey) return;

        document.querySelectorAll(`[data-engagement-event-priority-picker][data-priority-scope="${scopeId}"] [data-engagement-event-priority-toggle][data-value="${eventKey}"]`).forEach((otherButton) => {
            if (!(otherButton instanceof HTMLElement)) return;
            const otherPicker = otherButton.closest('[data-engagement-event-priority-picker]');
            const otherGroupId = String(otherButton.dataset.priorityGroup || otherPicker?.dataset.priorityGroup || '').trim();
            if (!otherPicker || !otherGroupId) return;
            const otherSelected = getSelectedEventPriorityEvents(otherPicker).filter((item) => item !== eventKey);
            syncEventPriorityPicker(otherPicker, otherGroupId, otherSelected);
        });

        const selectedEvents = getSelectedEventPriorityEvents(pickerEl);
        if (!selectedEvents.includes(eventKey)) {
            selectedEvents.push(eventKey);
        }
        syncEventPriorityPicker(pickerEl, groupId, selectedEvents);
    }

    function getSelectedSegmentTags(pickerEl) {
        return Array.from(pickerEl.querySelectorAll('[data-engagement-segment-tag-toggle].is-selected'))
            .map((item) => normalizeUserTagKey(item.dataset.value || '', ''))
            .filter(Boolean);
    }

    function syncSegmentTagPicker(pickerEl, selectedTags = []) {
        if (!(pickerEl instanceof HTMLElement)) return;
        const selected = new Set(selectedTags
            .map((tagKey) => normalizeUserTagKey(tagKey, ''))
            .filter(Boolean));

        pickerEl.querySelectorAll('[data-engagement-segment-tag-toggle]').forEach((button) => {
            const tagKey = normalizeUserTagKey(button.dataset.value || '', '');
            const isSelected = selected.has(tagKey);
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });

        const valuesEl = pickerEl.querySelector('[data-engagement-segment-tag-values]');
        if (valuesEl) {
            valuesEl.innerHTML = Array.from(selected).map((tagKey) => (
                `<input type="hidden" name="tag_targets" value="${escapeHtml(tagKey)}" data-engagement-segment-tag-value>`
            )).join('');
        }
    }

    function toggleSegmentTagChoice(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const pickerEl = buttonEl.closest('[data-engagement-segment-tag-picker]');
        if (!(pickerEl instanceof HTMLElement)) return;

        const tagKey = normalizeUserTagKey(buttonEl.dataset.value || '', '');
        let selectedTags = getSelectedSegmentTags(pickerEl);
        if (selectedTags.includes(tagKey)) {
            selectedTags = selectedTags.filter((item) => item !== tagKey);
        } else {
            selectedTags.push(tagKey);
        }

        syncSegmentTagPicker(pickerEl, selectedTags);
    }

    function getSelectedSegmentScenarios(pickerEl) {
        return Array.from(pickerEl.querySelectorAll('[data-engagement-segment-scenario-toggle].is-selected'))
            .map((item) => normalizeSegmentScenarioValue(item.dataset.value || ''))
            .filter(Boolean);
    }

    function syncSegmentScenarioPicker(pickerEl, selectedScenarios = []) {
        if (!(pickerEl instanceof HTMLElement)) return;
        const selected = new Set(selectedScenarios
            .map((scenarioId) => normalizeSegmentScenarioValue(scenarioId))
            .filter(Boolean));

        pickerEl.querySelectorAll('[data-engagement-segment-scenario-toggle]').forEach((button) => {
            const scenarioId = normalizeSegmentScenarioValue(button.dataset.value || '');
            const isSelected = selected.has(scenarioId);
            button.classList.toggle('is-selected', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });

        const valuesEl = pickerEl.querySelector('[data-engagement-segment-scenario-values]');
        if (valuesEl) {
            valuesEl.innerHTML = Array.from(selected).map((scenarioId) => (
                `<input type="hidden" name="examples" value="${escapeHtml(scenarioId)}" data-engagement-segment-scenario-value>`
            )).join('');
        }
    }

    function toggleSegmentScenarioChoice(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const pickerEl = buttonEl.closest('[data-engagement-segment-scenario-picker]');
        if (!(pickerEl instanceof HTMLElement)) return;

        const scenarioId = normalizeSegmentScenarioValue(buttonEl.dataset.value || '');
        let selectedScenarios = getSelectedSegmentScenarios(pickerEl);
        if (selectedScenarios.includes(scenarioId)) {
            selectedScenarios = selectedScenarios.filter((item) => item !== scenarioId);
        } else {
            selectedScenarios.push(scenarioId);
        }

        syncSegmentScenarioPicker(pickerEl, selectedScenarios);
    }

    function toggleSupportActionChoice(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const pickerEl = buttonEl.closest('[data-engagement-support-action-picker]');
        if (!(pickerEl instanceof HTMLElement)) return;

        const actionId = String(buttonEl.dataset.value || '').trim();
        let selectedActions = getSelectedSupportActions(pickerEl);
        if (selectedActions.includes(actionId)) {
            selectedActions = selectedActions.filter((item) => item !== actionId);
        } else {
            selectedActions.push(actionId);
        }
        if (!selectedActions.length) {
            selectedActions = ['create_ticket'];
        }

        syncSupportActionPicker(pickerEl, selectedActions);
    }

    function toggleEngagementSwitch(buttonEl) {
        if (!(buttonEl instanceof HTMLElement)) return;
        const fieldEl = buttonEl.closest('.engagement-switch-field');
        const input = fieldEl?.querySelector('[data-engagement-switch-input]');
        const nextChecked = buttonEl.getAttribute('aria-pressed') !== 'true';
        buttonEl.classList.toggle('is-on', nextChecked);
        buttonEl.setAttribute('aria-pressed', nextChecked ? 'true' : 'false');
        if (input) input.value = nextChecked ? 'true' : 'false';
        updateRulePreviewFromForm();
    }

    function submitRuleFromActionElement(actionEl, event = null) {
        if (!(actionEl instanceof HTMLElement)) {
            return false;
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();
        closeEngagementSelects();
        closeEngagementDateTimePickers();
        return handleEngagementRuleFormSubmit(actionEl.closest('form'));
    }

    function handleEngagementRuleFormSubmit(form) {
        if (!(form instanceof HTMLFormElement) || form.getAttribute('id') !== 'engagementRuleForm') {
            return false;
        }

        void saveRuleFromForm(form).catch((error) => {
            showActionError(error, '触达规则保存失败');
        });
        return true;
    }

    function bindEngagementDirectHandlers(root = document) {
        const form = root.querySelector?.('#engagementRuleForm');
        if (form instanceof HTMLFormElement && form.dataset.engagementDirectBound !== '1') {
            form.dataset.engagementDirectBound = '1';
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                event.stopPropagation();
                submitRuleFromActionElement(form.querySelector('[data-engagement-action="submit-rule"]'), event);
            });
        }

        const submitButton = root.querySelector?.('[data-engagement-action="submit-rule"]');
        if (submitButton instanceof HTMLElement && submitButton.dataset.engagementDirectBound !== '1') {
            submitButton.dataset.engagementDirectBound = '1';
            submitButton.onclick = (event) => submitRuleFromActionElement(submitButton, event);
            submitButton.addEventListener('pointerup', (event) => {
                if (typeof event.button === 'number' && event.button !== 0) {
                    return;
                }
                submitRuleFromActionElement(submitButton, event);
            });
            submitButton.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    submitRuleFromActionElement(submitButton, event);
                }
            });
        }
    }

    function handleEngagementSubmitIntentEvent(event) {
        const actionEl = event.target?.closest?.('[data-engagement-action="submit-rule"]');
        if (!(actionEl instanceof HTMLElement)) {
            return;
        }
        const now = Date.now();
        const lastIntentAt = Number(actionEl.dataset.engagementSubmitIntentAt || 0) || 0;
        if (event.type === 'click' && lastIntentAt && (now - lastIntentAt) < 700) {
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        actionEl.dataset.engagementSubmitIntentAt = String(now);
        submitRuleFromActionElement(actionEl, event);
    }

    async function initAdminEngagementModule(options = {}) {
        const container = getOverviewContainer();
        if (!container) {
            return false;
        }

        if (state.loading) {
            return true;
        }

        if (state.initialized && options.force !== true) {
            return true;
        }

        state.loading = true;
        setLoading(options.message || '客服系统加载中...');
        try {
            const payload = await fetchOverview();
            renderOverview(payload);
            state.initialized = true;
            return true;
        } catch (error) {
            if (isOverviewTimeoutError(error)) {
                renderOverview(createDegradedOverviewPayload(error));
                state.initialized = true;
                return true;
            }
            renderError(error);
            return false;
        } finally {
            state.loading = false;
        }
    }

    function refreshAdminEngagementModule() {
        return initAdminEngagementModule({
            force: true,
            message: '正在刷新客服系统...'
        });
    }

    function handleAdminEngagementSiteChange() {
        state.initialized = false;
        return refreshAdminEngagementModule();
    }

    function openAdminEngagementShellContext(context = {}) {
        const pageId = normalizeToken(context.pageId || context.page_id || context.page || '', '');
        if (pageId) {
            state.focusedPageId = pageId;
            state.activeView = 'scenes';
            state.pendingFocusedPageScroll = true;
        }
        return initAdminEngagementModule({
            force: true,
            message: pageId ? `正在定位${getPageLabel(pageId)}触达配置...` : '客服系统加载中...'
        });
    }

    document.addEventListener('wheel', handleEngagementWheel, { passive: false, capture: true });

    document.addEventListener('click', (event) => {
        const workspaceGroup = event.target?.closest?.('[data-engagement-workspace-group]');
        if (workspaceGroup) {
            event.preventDefault();
            closeEngagementSelects();
            const [, , , , views] = getWorkspaceGroup(workspaceGroup.dataset.engagementWorkspaceGroup);
            const nextView = Array.isArray(views) && views.length ? views[0] : 'dashboard';
            state.activeView = getWorkspaceView(nextView)[0];
            renderOverview(state.payload || {});
            return;
        }

        const workspaceView = event.target?.closest?.('[data-engagement-workspace-view]');
        if (workspaceView) {
            event.preventDefault();
            closeEngagementSelects();
            const nextView = getWorkspaceView(workspaceView.dataset.engagementWorkspaceView)[0];
            state.activeView = nextView;
            renderOverview(state.payload || {});
            return;
        }

        const previewAction = event.target?.closest?.('[data-engagement-preview-action]');
        if (previewAction) {
            event.preventDefault();
            return;
        }

        const dateTimeTrigger = event.target?.closest?.('[data-engagement-datetime-trigger]');
        if (dateTimeTrigger) {
            event.preventDefault();
            toggleEngagementDateTimePicker(dateTimeTrigger);
            return;
        }

        const dateTimeQuick = event.target?.closest?.('[data-engagement-datetime-quick]');
        if (dateTimeQuick) {
            event.preventDefault();
            const picker = dateTimeQuick.closest('[data-engagement-datetime-picker]');
            syncEngagementDateTimePicker(picker, getRulePublishQuickValue(dateTimeQuick.dataset.engagementDatetimeQuick || ''));
            closeEngagementDateTimePickers();
            return;
        }

        const dateTimeApply = event.target?.closest?.('[data-engagement-datetime-apply]');
        if (dateTimeApply) {
            event.preventDefault();
            applyEngagementDateTimePicker(dateTimeApply.closest('[data-engagement-datetime-picker]'));
            return;
        }

        const dateTimeClear = event.target?.closest?.('[data-engagement-datetime-clear]');
        if (dateTimeClear) {
            event.preventDefault();
            syncEngagementDateTimePicker(dateTimeClear.closest('[data-engagement-datetime-picker]'), '');
            closeEngagementDateTimePickers();
            return;
        }

        if (!event.target?.closest?.('[data-engagement-datetime-picker]')) {
            closeEngagementDateTimePickers();
        }

        const selectOption = event.target?.closest?.('[data-engagement-select-option]');
        if (selectOption) {
            event.preventDefault();
            chooseEngagementSelectOption(selectOption);
            return;
        }

        const selectTrigger = event.target?.closest?.('[data-engagement-select-trigger]');
        if (selectTrigger) {
            event.preventDefault();
            toggleEngagementSelect(selectTrigger.closest('.engagement-select'));
            return;
        }

        const pageToggle = event.target?.closest?.('[data-engagement-page-toggle]');
        if (pageToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleEngagementPageChoice(pageToggle);
            return;
        }

        const switchToggle = event.target?.closest?.('[data-engagement-switch]');
        if (switchToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleEngagementSwitch(switchToggle);
            return;
        }

        const supportActionToggle = event.target?.closest?.('[data-engagement-support-action-toggle]');
        if (supportActionToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleSupportActionChoice(supportActionToggle);
            return;
        }

        const segmentTagToggle = event.target?.closest?.('[data-engagement-segment-tag-toggle]');
        if (segmentTagToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleSegmentTagChoice(segmentTagToggle);
            return;
        }

        const segmentScenarioToggle = event.target?.closest?.('[data-engagement-segment-scenario-toggle]');
        if (segmentScenarioToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleSegmentScenarioChoice(segmentScenarioToggle);
            return;
        }

        const sceneEventToggle = event.target?.closest?.('[data-engagement-scene-event-toggle]');
        if (sceneEventToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleSceneEventChoice(sceneEventToggle);
            return;
        }

        const eventPriorityToggle = event.target?.closest?.('[data-engagement-event-priority-toggle]');
        if (eventPriorityToggle) {
            event.preventDefault();
            closeEngagementSelects();
            toggleEventPriorityChoice(eventPriorityToggle);
            return;
        }

        if (!event.target?.closest?.('.engagement-select')) {
            closeEngagementSelects();
        }

        const actionEl = event.target?.closest?.('[data-engagement-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.engagementAction;
        if (action === 'refresh') {
            event.preventDefault();
            runEngagementAsyncAction(actionEl, () => refreshAdminEngagementModule(), '客服系统刷新失败');
            return;
        }
        if (action === 'sync-segment-tags') {
            event.preventDefault();
            runEngagementAsyncAction(
                actionEl,
                () => syncUserManagementTagsToTagCenter({ renderMode: 'picker', showSuccess: true }),
                '用户标签同步失败'
            );
            return;
        }
        if (action === 'focus-page') {
            event.preventDefault();
            closeEngagementSelects();
            focusPageScene(actionEl.dataset.pageId || actionEl.dataset.engagementPage);
            return;
        }
        if (action === 'clear-page-filter') {
            event.preventDefault();
            closeEngagementSelects();
            clearPageFocus();
            return;
        }
        if (action === 'apply-template') {
            event.preventDefault();
            closeEngagementSelects();
            applyTemplateToRule(actionEl.dataset.templateId);
            return;
        }
        if (action === 'submit-template') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveTemplateFromForm(document.getElementById('engagementTemplateForm')), '消息模板保存失败');
            return;
        }
        if (action === 'edit-template') {
            event.preventDefault();
            closeEngagementSelects();
            editTemplate(actionEl.dataset.templateId);
            return;
        }
        if (action === 'delete-template') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => deleteTemplate(actionEl.dataset.templateId), '消息模板删除失败');
            return;
        }
        if (action === 'reset-template') {
            event.preventDefault();
            closeEngagementSelects();
            resetTemplateComposer();
            return;
        }
        if (action === 'clear-template-draft') {
            event.preventDefault();
            closeEngagementSelects();
            clearTemplateDraft();
            return;
        }
        if (action === 'focus-template-category') {
            event.preventDefault();
            closeEngagementSelects();
            focusTemplateCategory(actionEl.dataset.templateCategory);
            return;
        }
        if (action === 'clear-template-category-filter') {
            event.preventDefault();
            closeEngagementSelects();
            clearTemplateCategoryFilter();
            return;
        }
        if (action === 'create-template-starter') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => createTemplateFromStarter(actionEl.dataset.templateStarterId), '推荐模板写入失败');
            return;
        }
        if (action === 'clear-rule-draft') {
            event.preventDefault();
            closeEngagementSelects();
            clearRuleDraft();
            return;
        }
        if (action === 'focus-capability') {
            event.preventDefault();
            closeEngagementSelects();
            focusCapability(actionEl.dataset.capabilityId);
            return;
        }
        if (action === 'clear-capability-filter') {
            event.preventDefault();
            closeEngagementSelects();
            clearCapabilityFocus();
            return;
        }
        if (action === 'focus-audience') {
            event.preventDefault();
            closeEngagementSelects();
            focusAudienceSegment(actionEl.dataset.audienceScope);
            return;
        }
        if (action === 'submit-user-tag') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveUserTagFromForm(document.getElementById('engagementUserTagForm')), '用户标签保存失败');
            return;
        }
        if (action === 'edit-user-tag') {
            event.preventDefault();
            closeEngagementSelects();
            editUserTag(actionEl.dataset.tagKey);
            return;
        }
        if (action === 'delete-user-tag') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => deleteUserTag(actionEl.dataset.tagKey), '用户标签删除失败');
            return;
        }
        if (action === 'submit-tag-automation') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveTagAutomationFromForm(document.getElementById('engagementTagAutomationForm')), '自动分群阈值保存失败');
            return;
        }
        if (action === 'run-inactive-sweep') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => runInactiveUserSweep(document.getElementById('engagementTagAutomationForm')), '长期未活跃扫描失败');
            return;
        }
        if (action === 'reset-user-tag') {
            event.preventDefault();
            closeEngagementSelects();
            resetUserTagComposer();
            return;
        }
        if (action === 'submit-segment') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveSegmentFromForm(document.getElementById('engagementSegmentForm')), '用户分群保存失败');
            return;
        }
        if (action === 'edit-segment') {
            event.preventDefault();
            closeEngagementSelects();
            editSegment(actionEl.dataset.segmentId);
            return;
        }
        if (action === 'delete-segment') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => deleteSegment(actionEl.dataset.segmentId), '用户分群删除失败');
            return;
        }
        if (action === 'reset-segment') {
            event.preventDefault();
            closeEngagementSelects();
            resetSegmentComposer();
            return;
        }
        if (action === 'focus-automation') {
            event.preventDefault();
            closeEngagementSelects();
            focusAutomationBlueprint(actionEl.dataset.automationId);
            return;
        }
        if (action === 'cycle-automation-preview-sample') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            cycleAutomationPreviewSample(actionEl.dataset.automationId);
            return;
        }
        if (action === 'focus-automation-rule') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            focusExistingAutomationRule(actionEl.dataset.automationId);
            return;
        }
        if (action === 'create-automation-rule') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => createAutomationRuleFromBlueprint(actionEl.dataset.automationId), '自动化规则创建失败');
            return;
        }
        if (action === 'create-missing-automation-rules') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => createMissingAutomationRules(), '批量创建自动化规则失败');
            return;
        }
        if (action === 'publish-automation-drafts') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => publishAutomationDraftRules(), '批量发布自动化草稿失败');
            return;
        }
        if (action === 'pause-running-automation-rules') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => pauseRunningAutomationRules(), '批量暂停自动化规则失败');
            return;
        }
        if (action === 'toggle-automation-rule') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => toggleAutomationRuleFromBlueprint(actionEl.dataset.automationId, actionEl.dataset.ruleEnabled === 'true'), '自动化规则状态更新失败');
            return;
        }
        if (action === 'copy-automation-rule') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            copyAutomationRuleFromBlueprint(actionEl.dataset.automationId);
            return;
        }
        if (action === 'edit-scene') {
            event.preventDefault();
            closeEngagementSelects();
            editScene(actionEl.dataset.pageId || actionEl.dataset.engagementPage);
            return;
        }
        if (action === 'apply-scene-priority-preset') {
            event.preventDefault();
            closeEngagementSelects();
            applyScenePriorityPreset(actionEl.dataset.scenePriorityPresetId, actionEl.dataset.pageId || actionEl.dataset.engagementPage);
            return;
        }
        if (action === 'apply-scene-guidance-action') {
            event.preventDefault();
            closeEngagementSelects();
            applySceneGuidanceAction(
                actionEl.dataset.sceneGuidanceActionType,
                actionEl.dataset.sceneGuidanceActionValue,
                actionEl.dataset.pageId || actionEl.dataset.engagementPage
            );
            return;
        }
        if (action === 'submit-scene') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveSceneFromForm(document.getElementById('engagementSceneForm')), '页面场景保存失败');
            return;
        }
        if (action === 'submit-event-priority-center') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveEventPriorityCenterFromForm(document.getElementById('engagementEventPriorityForm')), '首波分诊配置保存失败');
            return;
        }
        if (action === 'reset-scene') {
            event.preventDefault();
            closeEngagementSelects();
            resetSceneComposer();
            return;
        }
        if (action === 'submit-asset-style') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveAssetStyleFromForm(document.getElementById('engagementAssetStyleForm')), '气泡视觉样式保存失败');
            return;
        }
        if (action === 'apply-asset-style-preset') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => applyAssetStylePreset(actionEl.dataset.assetStylePreset), '样式预设套用失败');
            return;
        }
        if (action === 'submit-asset') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveAssetFromForm(document.getElementById('engagementAssetForm')), '触达素材保存失败');
            return;
        }
        if (action === 'edit-asset') {
            event.preventDefault();
            closeEngagementSelects();
            editAsset(actionEl.dataset.assetId);
            return;
        }
        if (action === 'delete-asset') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => deleteAsset(actionEl.dataset.assetId), '触达素材删除失败');
            return;
        }
        if (action === 'reset-asset') {
            event.preventDefault();
            closeEngagementSelects();
            resetAssetComposer();
            return;
        }
        if (action === 'submit-entry-settings') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveEntrySettingsFromForm(document.getElementById('engagementEntrySettingsForm')), '客服入口配置保存失败');
            return;
        }
        if (action === 'submit-entry-context') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveEntryContextFromForm(document.getElementById('engagementEntryContextForm')), '页面客服入口保存失败');
            return;
        }
        if (action === 'edit-entry-context') {
            event.preventDefault();
            closeEngagementSelects();
            editEntryContext(actionEl.dataset.contextId);
            return;
        }
        if (action === 'submit-external-embed') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => saveExternalEmbedFromForm(document.getElementById('engagementExternalEmbedForm')), '外部承载配置保存失败');
            return;
        }
        if (action === 'copy-external-embed-snippet') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => copyExternalEmbedSnippet(), 'API中转嵌入代码复制失败');
            return;
        }
        if (action === 'clear-rule-filters') {
            event.preventDefault();
            closeEngagementSelects();
            clearRuleFilters();
            return;
        }
        if (action === 'rule-page-prev') {
            event.preventDefault();
            closeEngagementSelects();
            setRulePage((Number(state.rulePage || 1) || 1) - 1);
            return;
        }
        if (action === 'rule-page-next') {
            event.preventDefault();
            closeEngagementSelects();
            setRulePage((Number(state.rulePage || 1) || 1) + 1);
            return;
        }
        if (action === 'batch-pause-filtered-rules') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => batchPauseFilteredRules(), '批量暂停规则失败');
            return;
        }
        if (action === 'batch-copy-filtered-rules') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => batchCopyFilteredRulesToDraft(), '批量复制规则失败');
            return;
        }
        if (action === 'batch-archive-attention-rules') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => batchArchiveAttentionRules(), '批量归档规则失败');
            return;
        }
        if (action === 'batch-archive-high-risk-rules') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => batchArchiveHighRiskRules(), '批量归档高风险规则失败');
            return;
        }
        if (action === 'focus-rule-health-filter') {
            event.preventDefault();
            closeEngagementSelects();
            focusRuleHealthFilter(actionEl.dataset.ruleHealthFilter);
            return;
        }
        if (action === 'focus-duplicate-rules') {
            event.preventDefault();
            closeEngagementSelects();
            focusDuplicateRules();
            return;
        }
        if (action === 'rollback-audit-batch') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => rollbackAuditBatch(actionEl.dataset.batchId), '批量回滚失败');
            return;
        }
        if (action === 'set-preview-option') {
            event.preventDefault();
            closeEngagementSelects();
            setPreviewOption(actionEl.dataset.previewKey, actionEl.dataset.previewValue);
            return;
        }
        if (action === 'submit-rule') {
            submitRuleFromActionElement(actionEl, event);
            return;
        }
        if (action === 'reset-rule') {
            event.preventDefault();
            state.editingRuleId = '';
            state.ruleDraft = null;
            state.templateDraftRef = '';
            state.activeView = 'rules';
            renderOverview(state.payload || {});
            return;
        }
        if (action === 'edit-rule') {
            event.preventDefault();
            editRule(actionEl.dataset.ruleId);
            return;
        }
        if (action === 'copy-rule') {
            event.preventDefault();
            copyRuleToDraft(actionEl.dataset.ruleId);
            return;
        }
        if (action === 'toggle-rule') {
            event.preventDefault();
            runEngagementAsyncAction(actionEl, () => toggleRule(actionEl.dataset.ruleId, actionEl.dataset.ruleEnabled === 'true'), '触达规则状态更新失败');
            return;
        }
        if (action === 'archive-rule') {
            event.preventDefault();
            runEngagementAsyncAction(actionEl, () => archiveRule(actionEl.dataset.ruleId), '触达规则归档失败');
            return;
        }
        if (action === 'delete-rule') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => deleteRule(actionEl.dataset.ruleId), '触达规则删除失败');
            return;
        }
        if (action === 'pause-all-rules') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => pauseAllRules(), '暂停全部触达失败');
            return;
        }
        if (action === 'restore-latest-pause-all-rules') {
            event.preventDefault();
            closeEngagementSelects();
            runEngagementAsyncAction(actionEl, () => restoreLatestPauseAllRules(), '恢复最近暂停失败');
            return;
        }
    });

    document.addEventListener('input', (event) => {
        const searchInput = event.target?.closest?.('[data-engagement-rule-search]');
        if (searchInput instanceof HTMLInputElement) {
            state.ruleSearchQuery = searchInput.value;
            resetRulePagination();
            scheduleRuleSearchRender(searchInput);
            return;
        }
        const colorInput = event.target?.closest?.('[data-engagement-color-value]');
        if (colorInput instanceof HTMLInputElement) {
            updateColorFieldSwatch(colorInput.closest('[data-engagement-color-field]'), colorInput.value);
            return;
        }
        const dateTimeManualInput = event.target?.closest?.('[data-engagement-datetime-date], [data-engagement-datetime-time]');
        if (dateTimeManualInput instanceof HTMLInputElement && handleEngagementDateTimeManualInput(dateTimeManualInput)) {
            return;
        }
        const previewField = event.target?.closest?.('#engagementRuleForm input, #engagementRuleForm textarea');
        if (previewField instanceof HTMLElement) {
            updateRulePreviewFromForm();
            return;
        }
        const templatePreviewField = event.target?.closest?.('#engagementTemplateForm input, #engagementTemplateForm textarea');
        if (templatePreviewField instanceof HTMLElement) {
            updateTemplatePreviewFromForm();
            return;
        }
        const scenePreviewField = event.target?.closest?.('#engagementSceneForm input, #engagementSceneForm textarea');
        if (scenePreviewField instanceof HTMLElement) {
            updateScenePreviewFromForm();
        }
    });

    document.addEventListener('pointerup', (event) => {
        if (typeof event.button === 'number' && event.button !== 0) {
            return;
        }
        handleEngagementSubmitIntentEvent(event);
    }, true);

    document.addEventListener('click', handleEngagementSubmitIntentEvent, true);

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) {
            return;
        }

        const formId = form.getAttribute('id') || '';
        if (!['engagementRuleForm', 'engagementTemplateForm', 'engagementSegmentForm', 'engagementSceneForm', 'engagementEventPriorityForm', 'engagementAssetStyleForm', 'engagementAssetForm', 'engagementEntrySettingsForm', 'engagementEntryContextForm', 'engagementExternalEmbedForm'].includes(formId)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (formId === 'engagementRuleForm') {
            handleEngagementRuleFormSubmit(form);
        } else if (formId === 'engagementTemplateForm') {
            void saveTemplateFromForm(form).catch((error) => {
                showActionError(error, '消息模板保存失败');
            });
        } else if (formId === 'engagementSegmentForm') {
            void saveSegmentFromForm(form).catch((error) => {
                showActionError(error, '用户分群保存失败');
            });
        } else if (formId === 'engagementSceneForm') {
            void saveSceneFromForm(form).catch((error) => {
                showActionError(error, '页面场景保存失败');
            });
        } else if (formId === 'engagementEventPriorityForm') {
            void saveEventPriorityCenterFromForm(form).catch((error) => {
                showActionError(error, '首波分诊配置保存失败');
            });
        } else if (formId === 'engagementAssetStyleForm') {
            void saveAssetStyleFromForm(form).catch((error) => {
                showActionError(error, '气泡视觉样式保存失败');
            });
        } else if (formId === 'engagementAssetForm') {
            void saveAssetFromForm(form).catch((error) => {
                showActionError(error, '触达素材保存失败');
            });
        } else if (formId === 'engagementEntrySettingsForm') {
            void saveEntrySettingsFromForm(form).catch((error) => {
                showActionError(error, '客服入口配置保存失败');
            });
        } else if (formId === 'engagementEntryContextForm') {
            void saveEntryContextFromForm(form).catch((error) => {
                showActionError(error, '页面客服入口保存失败');
            });
        } else if (formId === 'engagementExternalEmbedForm') {
            void saveExternalEmbedFromForm(form).catch((error) => {
                showActionError(error, '外部承载配置保存失败');
            });
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        const dateTimeManualInput = event.target?.closest?.('[data-engagement-datetime-date], [data-engagement-datetime-time]');
        if (event.key === 'Enter' && dateTimeManualInput instanceof HTMLInputElement) {
            event.preventDefault();
            applyEngagementDateTimePicker(dateTimeManualInput.closest('[data-engagement-datetime-picker]'));
            return;
        }
        if (event.key === 'Escape') {
            closeEngagementSelects();
            closeEngagementDateTimePickers();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            const pageCard = event.target?.closest?.('[data-engagement-page-card]');
            if (pageCard instanceof HTMLElement) {
                event.preventDefault();
                closeEngagementSelects();
                focusPageScene(pageCard.dataset.pageId || pageCard.dataset.engagementPage);
                return;
            }
            const templateCard = event.target?.closest?.('[data-engagement-template-card]');
            if (templateCard instanceof HTMLElement) {
                event.preventDefault();
                closeEngagementSelects();
                applyTemplateToRule(templateCard.dataset.templateId);
                return;
            }
            const capabilityCard = event.target?.closest?.('[data-engagement-capability-card]');
            if (capabilityCard instanceof HTMLElement) {
                event.preventDefault();
                closeEngagementSelects();
                focusCapability(capabilityCard.dataset.capabilityId);
                return;
            }
            const audienceCard = event.target?.closest?.('[data-engagement-audience-card]');
            if (audienceCard instanceof HTMLElement) {
                event.preventDefault();
                closeEngagementSelects();
                focusAudienceSegment(audienceCard.dataset.audienceScope);
                return;
            }
            const automationCard = event.target?.closest?.('[data-engagement-automation-card]');
            if (automationCard instanceof HTMLElement) {
                event.preventDefault();
                closeEngagementSelects();
                focusAutomationBlueprint(automationCard.dataset.automationId);
            }
        }
    });

    globalScope.AdminEngagement = {
        init: initAdminEngagementModule,
        refresh: refreshAdminEngagementModule,
        render: renderOverview,
        submitCurrentRule: () => handleEngagementRuleFormSubmit(document.getElementById('engagementRuleForm')),
        handleContext: openAdminEngagementShellContext,
        handleSiteChange: handleAdminEngagementSiteChange
    };
    globalScope.handleAdminEngagementSiteChange = handleAdminEngagementSiteChange;
    globalScope.openAdminEngagementShellContext = openAdminEngagementShellContext;

    if (globalScope.AdminShell?.registerModule) {
        globalScope.AdminShell.registerModule('engagement', {
            activate: initAdminEngagementModule,
            handleContext: openAdminEngagementShellContext,
            onSiteChange: handleAdminEngagementSiteChange,
            reload: refreshAdminEngagementModule
        });
    }

    globalScope.addEventListener?.('admin-shell-module-activated', (event) => {
        if (event?.detail?.moduleId === 'engagement') {
            void initAdminEngagementModule();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        if (globalScope.adminStudioAccessGranted && isEngagementModuleVisible()) {
            void initAdminEngagementModule();
            return;
        }

        globalScope.addEventListener?.('adminStudioAccessGranted', () => {
            if (isEngagementModuleVisible()) {
                void initAdminEngagementModule();
            }
        }, { once: true });
    });
})(window);
