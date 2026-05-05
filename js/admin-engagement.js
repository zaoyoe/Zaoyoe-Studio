(function initAdminEngagement(globalScope) {
    'use strict';

    const PAGE_LABELS = {
        home: '首页',
        prompts: '提示词',
        gongyi: '公益站',
        shop: '商城',
        verify: '验证',
        guestbook: '留言板',
        all: '全站'
    };

    const EVENT_LABELS = {
        new_user_welcome: '新用户欢迎',
        points_low_balance: '积分偏低',
        points_insufficient: '积分不足',
        comment_replied: '评论被回复',
        message_replied: '留言被回复',
        coupon_available: '可领优惠券',
        product_discount: '商品折扣',
        product_restocked: '补货提醒',
        permission_changed: '权限变更',
        prompt_unlocked: '内容解锁',
        order_status: '订单状态',
        verify_failed: '验证失败',
        verify_queue: '验证排队',
        service_status: '服务状态',
        usage_rules: '使用规则',
        maintenance_notice: '维护公告',
        community_rule: '社区规则',
        content_featured: '内容精选'
    };

    const RULE_PAGE_OPTIONS = ['all', 'home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook'];
    const RULE_TONE_OPTIONS = [
        ['info', '信息'],
        ['success', '成功'],
        ['warning', '提醒'],
        ['alert', '警示'],
        ['welcome', '欢迎'],
        ['creative', '提示词'],
        ['calm', '公益站'],
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
    const TRIGGER_TYPE_OPTIONS = [
        ['page_view', '进入页面'],
        ['time_on_page', '停留触发'],
        ['scroll_depth', '滚动触发'],
        ['click_action', '点击触发'],
        ['points_insufficient', '积分不足'],
        ['coupon_available', '可领优惠券'],
        ['product_discount', '商品折扣'],
        ['comment_replied', '评论被回复'],
        ['message_replied', '留言被回复'],
        ['verify_failed', '验证失败'],
        ['service_status', '服务状态']
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
        ['gongyi', '公益站'],
        ['shop', '商城'],
        ['verify', '验证'],
        ['guestbook', '留言板']
    ];
    const EXTERNAL_PAGE_OPTIONS = [
        ['gongyi', '公益站'],
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
            title: '新用户欢迎',
            desc: '新注册用户首次回到首页时，给出钱包、商城和提示词入口。',
            icon: 'fa-seedling',
            triggerType: 'page_view',
            audienceScope: 'new_users',
            pageIds: ['home'],
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
            id: 'coupon_available_notice',
            title: '优惠券可领取',
            desc: '商城出现可领券商品时，引导用户前往钱包卡券或商品页。',
            icon: 'fa-ticket',
            triggerType: 'coupon_available',
            audienceScope: 'authenticated',
            pageIds: ['shop'],
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
            id: 'reply_notification',
            title: '留言/评论被回复',
            desc: '用户的留言或评论被回复后，通过机器人气泡带回对应页面。',
            icon: 'fa-comments',
            triggerType: 'message_replied',
            audienceScope: 'authenticated',
            pageIds: ['guestbook', 'prompts'],
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
        }
    ]);
    const PREVIEW_PAGE_OPTIONS = [
        ['auto', '跟随规则'],
        ['home', '首页'],
        ['prompts', '提示词'],
        ['gongyi', '公益站'],
        ['shop', '商城'],
        ['verify', '验证'],
        ['guestbook', '留言板']
    ];
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
    const CAPABILITY_GROUPS = Object.freeze([
        {
            id: 'points',
            title: '积分与套餐',
            desc: '积分不足、积分调整、兑换成功、套餐到期',
            icon: 'fa-coins',
            categories: ['points', 'membership'],
            events: ['points_insufficient', 'points_low_balance'],
            pageIds: ['home', 'prompts', 'shop', 'verify']
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
            desc: '可领优惠券、商品折扣、库存恢复、订单履约',
            icon: 'fa-bag-shopping',
            categories: ['commerce'],
            events: ['coupon_available', 'product_discount', 'product_restocked', 'order_status'],
            pageIds: ['shop']
        },
        {
            id: 'account',
            title: '账号权限',
            desc: '管理员提升、权限限制、封禁解封、安全提醒',
            icon: 'fa-user-shield',
            categories: ['account', 'permission'],
            events: ['permission_changed'],
            pageIds: ['home']
        },
        {
            id: 'operations',
            title: '站点运营',
            desc: '首页公告、公益站规则、验证排队、服务维护',
            icon: 'fa-satellite-dish',
            categories: ['operations', 'site', 'service', 'general'],
            events: ['service_status', 'usage_rules', 'maintenance_notice', 'verify_queue'],
            pageIds: ['home', 'gongyi', 'verify']
        }
    ]);
    const TEMPLATE_PRODUCT_CATEGORIES = Object.freeze([
        {
            id: 'onboarding',
            title: '新手转化',
            desc: '欢迎、注册、首次使用和新手路径说明。',
            icon: 'fa-seedling',
            categories: ['onboarding', 'welcome'],
            events: ['new_user_welcome'],
            pageIds: ['home', 'prompts']
        },
        {
            id: 'commerce',
            title: '商城运营',
            desc: '优惠券、折扣、补货、订单和积分购买提醒。',
            icon: 'fa-bag-shopping',
            categories: ['commerce'],
            events: ['coupon_available', 'product_discount', 'product_restocked', 'order_status', 'points_insufficient'],
            pageIds: ['shop']
        },
        {
            id: 'support',
            title: '客服引导',
            desc: '验证失败、支付异常、服务状态和工单入口。',
            icon: 'fa-headset',
            categories: ['support', 'assistive', 'service'],
            events: ['verify_failed', 'verify_queue', 'service_status', 'payment_failed'],
            pageIds: ['verify', 'shop', 'gongyi']
        },
        {
            id: 'community',
            title: '社区互动',
            desc: '留言回复、评论回复、社区规则和内容精选。',
            icon: 'fa-comments',
            categories: ['community'],
            events: ['message_replied', 'comment_replied', 'community_rule', 'content_featured'],
            pageIds: ['guestbook', 'prompts']
        },
        {
            id: 'account',
            title: '账号治理',
            desc: '权限变更、积分调整、安全限制和会员权益变化。',
            icon: 'fa-user-shield',
            categories: ['account', 'permission', 'points', 'membership'],
            events: ['permission_changed', 'points_low_balance', 'points_insufficient'],
            pageIds: ['home', 'prompts', 'verify']
        },
        {
            id: 'operations',
            title: '站点运营',
            desc: '维护公告、公益站规则、内容开放和全站说明。',
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
            tone: 'welcome',
            title: '欢迎加入 zaoyoe',
            content: '你可以从提示词、商城和钱包开始。遇到关键路径时，我会在这里给你说明。',
            action_label: '查看提示词',
            action_url: '/prompts.html',
            description: '适合新注册用户首次进入首页时展示。',
            priority: 12
        },
        {
            id: 'starter_coupon_available',
            key: 'coupon_available',
            name: '商品可领券',
            category: 'commerce',
            page_ids: ['shop'],
            tone: 'commerce',
            title: '有优惠券可领取',
            content: '这件商品当前有可用优惠，可以先领取再下单。',
            action_label: '我的钱包 > 卡券',
            action_url: 'wallet://cards',
            description: '适合商城商品有优惠券或折扣权益时展示。',
            priority: 28
        },
        {
            id: 'starter_verify_failed',
            key: 'verify_failed_help',
            name: '验证失败帮助',
            category: 'support',
            page_ids: ['verify'],
            tone: 'assistive',
            title: '验证未通过',
            content: '请检查上传内容和验证规则。如果多次失败，可以联系站内客服处理。',
            action_label: '查看验证说明',
            action_url: '/verify.html#help',
            description: '适合验证失败、排队或用户不知道下一步时展示。',
            priority: 35
        },
        {
            id: 'starter_reply_notification',
            key: 'reply_notification',
            name: '留言/评论被回复',
            category: 'community',
            page_ids: ['guestbook', 'prompts'],
            tone: 'community',
            title: '有人回复了你',
            content: '你的留言或评论有新回复，点击即可回到对应内容。',
            action_label: '查看回复',
            action_url: '/guestbook.html',
            description: '适合留言板和提示词评论回复场景。',
            priority: 32
        },
        {
            id: 'starter_permission_changed',
            key: 'permission_changed_notice',
            name: '权限变更通知',
            category: 'account',
            page_ids: ['home'],
            tone: 'warning',
            title: '账号权限已更新',
            content: '管理员已经调整了你的账号权限或积分状态，请查看账户中心确认。',
            action_label: '查看账户',
            action_url: 'account://profile',
            description: '适合管理员提升、限制权限或调整积分后的站内提醒。',
            priority: 34
        },
        {
            id: 'starter_maintenance_notice',
            key: 'maintenance_notice',
            name: '维护通知',
            category: 'operations',
            page_ids: ['all'],
            tone: 'info',
            title: '服务维护提醒',
            content: '部分服务可能会短暂波动，如遇异常请稍后重试或联系在线客服。',
            action_label: '查看公告',
            action_url: '/index.html#announcements',
            description: '适合全站维护、服务波动或公益站规则说明。',
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
                max_width_px: 420,
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
                max_width_px: 420,
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
                max_width_px: 440,
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
                max_width_px: 440,
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
                max_width_px: 420,
                density: 'compact',
                shadow: 'elevated',
                animation: 'none',
                robot_variant: 'minimal'
            }
        }
    ]);
    const ENGAGEMENT_RUNTIME_VERSION = '20260505_ENGAGEMENT_RULE_BATCH_AUDIT_1';
    const SAVE_LOCK_STALE_MS = 15000;
    const RULE_BATCH_LIMIT = 30;

    const state = {
        initialized: false,
        loading: false,
        payload: null,
        activeView: 'dashboard',
        focusedPageId: '',
        focusedCapabilityId: '',
        ruleSearchQuery: '',
        ruleStatusFilter: 'all',
        ruleHealthFilter: 'all',
        rulePageFilter: 'all',
        ruleSort: 'updated_desc',
        ruleBatchResult: null,
        ruleDraft: null,
        templateCategoryFilter: '',
        previewDevice: 'desktop',
        previewTheme: 'light',
        previewPageId: 'auto',
        templateDraftRef: '',
        editingTemplateRef: '',
        editingSegmentRef: '',
        editingScenePageId: '',
        editingAssetId: '',
        editingSupportContextId: '',
        editingUserTagRef: '',
        editingRuleId: ''
    };
    let ruleSearchRenderTimer = 0;
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

    function getCurrentSite() {
        return String(globalScope.AdminSiteFilter?.getSiteFilter?.() || 'all').trim().toLowerCase() || 'all';
    }

    function getPageLabel(pageId) {
        const normalized = normalizeToken(pageId, 'all');
        return PAGE_LABELS[normalized] || pageId || '页面';
    }

    function getEventLabel(eventKey) {
        const normalized = String(eventKey || '').trim();
        return EVENT_LABELS[normalized] || normalized.replace(/_/g, ' ') || '事件';
    }

    function getTriggerTypeLabel(triggerType = '') {
        return getOptionLabel(TRIGGER_TYPE_OPTIONS, normalizeToken(triggerType, 'page_view')) || '进入页面';
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
        const runningRules = rules.filter((rule) => rule?.enabled && rule?.status === 'published').length;
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

    async function fetchOverview() {
        const response = await engagementAdminFetch(buildAdminUrl('engagement/overview', {
            site: getCurrentSite()
        }), {
            method: 'GET'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(buildRequestErrorMessage(response, payload, '客服系统接口异常'));
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
                events: []
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
                max_width_px: Number(center.style?.max_width_px || 420) || 420,
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
        const tagMap = new Map(fallbackTags.map((item) => [normalizeToken(item.key || item.id, ''), item]));
        if (Array.isArray(center.tags)) {
            center.tags.forEach((item) => {
                const key = normalizeToken(item?.key || item?.id, '');
                if (key) {
                    tagMap.set(key, item);
                }
            });
        }
        return {
            sources: Array.isArray(center.sources) && center.sources.length ? center.sources : USER_TAG_SOURCE_OPTIONS.map(([value]) => value),
            tags: Array.from(tagMap.values()),
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
        const tagRef = normalizeToken(state.editingUserTagRef, '');
        if (!tagRef) return null;
        return getUserTagCenter().tags.find((tag) => normalizeToken(tag?.key || tag?.id, '') === tagRef) || null;
    }

    function getRuleDraft() {
        return state.ruleDraft && typeof state.ruleDraft === 'object' && !Array.isArray(state.ruleDraft)
            ? state.ruleDraft
            : null;
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
        if (!starterKey) return false;
        return (Array.isArray(templates) ? templates : []).some((template) => normalizeToken(template?.key || template?.id, '') === starterKey);
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
            running_rules: linkedRules.filter((rule) => rule.enabled === true && normalizeToken(rule.status, 'draft') === 'published').length,
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
        if (rule.enabled && rule.status === 'published') {
            return '运行中';
        }
        const status = normalizeToken(rule.status, 'draft');
        return getOptionLabel(RULE_FILTER_STATUS_OPTIONS, status) || '草稿';
    }

    function getAudienceScope(audience = {}) {
        const source = audience && typeof audience === 'object' && !Array.isArray(audience) ? audience : {};
        return normalizeToken(source.scope || source.segment || source.type || 'all', 'all');
    }

    function getAudienceLabel(audience = {}) {
        return getOptionLabel(AUDIENCE_SCOPE_OPTIONS, getAudienceScope(audience)) || '全部用户';
    }

    function isRuleVisibleForStatus(rule = {}, statusFilter = 'all') {
        const normalizedStatus = normalizeToken(statusFilter, 'all');
        if (!normalizedStatus || normalizedStatus === 'all') {
            return true;
        }
        if (normalizedStatus === 'running') {
            return rule.enabled === true && rule.status === 'published';
        }
        return normalizeToken(rule.status, 'draft') === normalizedStatus;
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
        return sortRulesForManagement(rows.filter((rule) => (
            isRuleVisibleForPage(rule, pageFilter)
            && isRuleVisibleForStatus(rule, state.ruleStatusFilter)
            && isRuleVisibleForHealth(rule, state.ruleHealthFilter)
            && isRuleVisibleForSearch(rule, state.ruleSearchQuery)
        )));
    }

    function getCurrentManagedRules() {
        return getManagedRules(Array.isArray(state.payload?.rules) ? state.payload.rules : []);
    }

    function getRuleBatchSummary(rows = getCurrentManagedRules()) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        const activeRows = sourceRows.filter((rule) => String(rule?.id || '').trim());
        const runningRows = activeRows.filter((rule) => rule.enabled === true && normalizeToken(rule.status, '') === 'published');
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
            trigger_type: source.trigger_type || 'page_view',
            placement: source.placement || 'robot_bubble',
            title: source.title || source.name || '',
            content: source.content || '',
            tone: source.tone || 'info',
            action_label: source.action_label || '',
            action_url: source.action_url || '',
            enabled: Boolean(source.enabled)
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
                <i class="fas ${riskLevel === 'high' ? 'fa-triangle-exclamation' : 'fa-shield-halved'}" aria-hidden="true"></i>
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
        const title = initial.title || initial.name || '小助手提醒';
        const content = initial.content || '这里会实时显示用户将在客服机器人旁看到的气泡内容。';
        const actionLabel = initial.action_label || (initial.action_url ? '查看详情' : '');
        const tone = normalizeToken(initial.tone, 'info');
        const audienceLabel = getAudienceLabel(initial.audience);
        const triggerTypeLabel = getTriggerTypeLabel(initial.trigger_type);
        const placementLabel = getPlacementLabel(initial.placement);
        const statusLabel = initial.enabled && initial.status === 'published'
            ? '运行中'
            : getOptionLabel(RULE_STATUS_OPTIONS, initial.status || 'draft');

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
                    <span data-engagement-preview-status>${escapeHtml(statusLabel)}</span>
                </div>
            </section>
        `;
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
        const status = draftSource.status || 'draft';
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
        const draftAudienceScope = getAudienceScope(draftSource.audience);
        const draftTriggerType = normalizeToken(draftSource.trigger_type || 'page_view', 'page_view');
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
                ${renderRuleGovernanceNotice(draftGovernance)}
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
                        <label class="engagement-field engagement-field--ttl">
                            <span>关闭冷却（小时）</span>
                            <input name="dismiss_ttl_hours" type="number" min="1" max="720" value="${escapeHtml(draftDismissTtlHours)}">
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch engagement-field--switch">
                            <span>启用状态</span>
                            ${renderCustomSwitch({
                                name: 'enabled',
                                checked: Boolean(rule ? rule.enabled : (draftSource.enabled || status === 'published')),
                                label: '发布后立即启用'
                            })}
                        </div>
                    </div>
                    <div class="engagement-form-actions">
                        <div class="engagement-form-error" data-engagement-form-error role="alert" data-tone="error" hidden></div>
                        <button type="button" class="engagement-refresh-btn" data-engagement-action="submit-rule" data-engagement-runtime="${escapeHtml(ENGAGEMENT_RUNTIME_VERSION)}">
                            <i class="fas fa-save"></i>
                            <span>${rule ? '保存规则' : '创建规则'}</span>
                        </button>
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
                                        <p>${escapeHtml(scene.safe_zone || 'bottom-right')}</p>
                                    </div>
                                </div>
                                <div class="engagement-chip-row">
                                    ${events.map((eventKey) => `<span>${escapeHtml(getEventLabel(eventKey))}</span>`).join('')}
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
        const eventsText = Array.isArray(scene.events) ? scene.events.join('\n') : '';
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
                            <input name="safe_zone" type="text" maxlength="80" value="${escapeHtml(scene.safe_zone || 'bottom-right')}" placeholder="bottom-right">
                        </label>
                        <div class="engagement-form-block engagement-form-block--switch">
                            <span>营销触达</span>
                            ${renderCustomSwitch({
                                name: 'allow_marketing',
                                checked: scene.allow_marketing !== false,
                                label: '允许活动、优惠和转化提示'
                            })}
                        </div>
                        <label class="engagement-field engagement-form-field--full">
                            <span>可用事件（一行一个事件 key）</span>
                            <textarea name="events" rows="3" maxlength="1200" placeholder="coupon_available">${escapeHtml(eventsText)}</textarea>
                        </label>
                    </div>
                    <div class="engagement-form-actions">
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
            .slice(0, 6);

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

    function renderRuleManagementToolbar(totalCount = 0, visibleCount = 0) {
        const pageFilterOptions = [
            ['all', '全部页面'],
            ...RULE_PAGE_OPTIONS.filter((pageId) => pageId !== 'all').map((pageId) => [pageId, getPageLabel(pageId)])
        ];
        const batchSummary = getRuleBatchSummary();
        const hasActiveFilter = Boolean(
            String(state.ruleSearchQuery || '').trim()
            || normalizeToken(state.ruleStatusFilter, 'all') !== 'all'
            || normalizeToken(state.ruleHealthFilter, 'all') !== 'all'
            || normalizeToken(state.rulePageFilter, 'all') !== 'all'
            || normalizeToken(state.ruleSort, 'updated_desc') !== 'updated_desc'
        );

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
                        name: 'rule_sort',
                        value: state.ruleSort || 'updated_desc',
                        options: RULE_SORT_OPTIONS,
                        label: '排序'
                    })}
                </div>
                <div class="engagement-rule-toolbar__meta">
                    <span>${escapeHtml(formatNumber(visibleCount))} / ${escapeHtml(formatNumber(totalCount))} 条</span>
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
                ${state.ruleBatchResult ? renderRuleBatchResult(state.ruleBatchResult) : ''}
            </div>
        `;
    }

    function renderRules(rules = []) {
        const focusedPageId = getFocusedPageId();
        const totalRules = getRulesForFocusedPage(rules);
        const visibleRules = getManagedRules(rules);
        const rows = visibleRules.slice(0, 8);
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
                ${renderRuleManagementToolbar(totalRules.length, visibleRules.length)}
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
                        return `
                            <article class="engagement-list-item engagement-rule-item" data-rule-health="${escapeHtml(health.tone || 'idle')}">
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
        const tagKey = normalizeToken(tag?.key || tag?.id || '', '');
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
                            const key = normalizeToken(item.key || item.id, '');
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
        const examplesText = Array.isArray(segment?.examples) ? segment.examples.join('\n') : '';
        const emailTargetsText = Array.isArray(segment?.emails) ? segment.emails.join('\n') : '';
        const tagTargetsText = Array.isArray(segment?.tags) ? segment.tags.join('\n') : '';
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
                    <div class="engagement-form-grid engagement-management-grid">
                        <label class="engagement-field engagement-field--name">
                            <span>分群名称</span>
                            <input name="name" type="text" maxlength="160" value="${escapeHtml(segment?.title || '')}" placeholder="例如：有失败支付记录用户" required>
                        </label>
                        <label class="engagement-field">
                            <span>分群 key</span>
                            <input name="key" type="text" maxlength="120" value="${escapeHtml(segment?.key || segment?.id || '')}" placeholder="payment_failed_users">
                        </label>
                        <label class="engagement-field">
                            <span>匹配 scope</span>
                            <input name="scope" type="text" maxlength="80" value="${escapeHtml(segment?.id || segment?.key || '')}" placeholder="payment_failed_users">
                        </label>
                        <label class="engagement-field">
                            <span>图标</span>
                            <input name="icon" type="text" maxlength="80" value="${escapeHtml(segment?.icon || 'fa-users')}" placeholder="fa-users">
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
                        <label class="engagement-field engagement-form-field--full">
                            <span>用户标签（一行一个，可选）</span>
                            <textarea name="tag_targets" rows="3" maxlength="1200" placeholder="vip&#10;paid_user">${escapeHtml(tagTargetsText)}</textarea>
                        </label>
                        <label class="engagement-field engagement-form-field--full">
                            <span>典型触达场景（一行一个）</span>
                            <textarea name="examples" rows="3" maxlength="1200" placeholder="积分不足">${escapeHtml(examplesText)}</textarea>
                        </label>
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
                                ${(Array.isArray(segment.examples) ? segment.examples : []).map((example) => `<span>${escapeHtml(example)}</span>`).join('')}
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
        return `
            <section class="engagement-section">
                <div class="engagement-section__head">
                    <div>
                        <h3>自动化流程蓝图</h3>
                        <p>把常见运营事件预设成规则草稿。页面触发可直接发布，事件触发会等待对应业务事件送入机器人通知管道。</p>
                    </div>
                </div>
                <div class="engagement-automation-grid">
                    ${AUTOMATION_BLUEPRINTS.map((blueprint) => {
                        const status = getAutomationBlueprintStatus(blueprint.id);
                        const health = status.health || {};
                        const hasCreatedRule = status.total > 0;
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
                                </div>
                            </div>
                            <div class="engagement-chip-row">
                                <span>${escapeHtml(blueprint.mode)}</span>
                                <span>${escapeHtml(getTriggerTypeLabel(blueprint.triggerType))}</span>
                                <span>${escapeHtml(getAudienceLabel({ scope: blueprint.audienceScope }))}</span>
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
                    }).join('')}
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
        const runningRules = rules.filter((rule) => rule?.enabled === true && rule?.status === 'published');

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
        const runningRules = rules.filter((rule) => rule?.enabled === true && rule?.status === 'published');
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
                label: '公益站外部承载',
                status: externalEmbed.enabled === false
                    ? 'blocked'
                    : (externalDiagnostics.status === 'ready' ? 'ok' : 'warning'),
                detail: externalEmbed.enabled === false
                    ? '外部嵌入已关闭'
                    : `${formatNumber(externalDiagnostics.allowed_origin_count || 0)} 个白名单域名 · ${externalDiagnostics.has_gongyi_origin ? '公益站已覆盖' : '公益站白名单待补'}`
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
                    <span>验收范围：首页 / 提示词 / 公益站 / 商城 / 验证 / 留言板</span>
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
        const checklist = Array.isArray(diagnostics.checklist) ? diagnostics.checklist : [];
        const tips = Array.isArray(diagnostics.tips) ? diagnostics.tips : [];
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
                        const isRunning = rule.enabled === true && normalizeToken(rule.status, '') === 'published';
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
                        <h3>外部承载与公益站嵌入</h3>
                        <p>管理公益站等外部页面的 CORS 白名单、主站 API 地址、静态资源地址和可复制嵌入代码。</p>
                    </div>
                    <span class="engagement-status-pill" data-status="${escapeHtml(diagnostics.status || 'attention')}">
                        ${escapeHtml(diagnostics.status === 'ready' ? '可部署' : '待检查')}
                    </span>
                </div>
                <div class="engagement-external-grid">
                    <form id="engagementExternalEmbedForm" class="engagement-management-form">
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
                            <button type="button" class="engagement-primary-btn" data-engagement-action="submit-external-embed">
                                <i class="fas fa-save"></i>
                                保存外部承载
                            </button>
                        </div>
                    </form>
                    <div class="engagement-external-deploy">
                        <div class="engagement-external-deploy__head">
                            <div>
                                <strong>公益站嵌入代码</strong>
                                <p>把这段脚本放到公益站公共页底部即可接入同一套机器人触达。</p>
                            </div>
                            <button type="button" class="engagement-link-btn" data-engagement-action="copy-external-embed-snippet">
                                <i class="fas fa-copy" aria-hidden="true"></i>
                                复制
                            </button>
                        </div>
                        <textarea id="engagementExternalEmbedSnippet" class="engagement-code-textarea" readonly>${escapeHtml(snippet)}</textarea>
                        <div class="engagement-external-probe">
                            <strong>预检地址</strong>
                            <p>${escapeHtml(diagnostics.preflight_url || `${external.api_origin}/api/engagement/feed`)}</p>
                        </div>
                        <div class="engagement-external-command">
                            <strong>本地模拟验收</strong>
                            <code>${escapeHtml(diagnostics.smoke_command || 'npm run smoke:engagement-external')}</code>
                        </div>
                        <div class="engagement-external-observability" data-status="${escapeHtml(deploymentStatus)}">
                            <div class="engagement-external-observability__head">
                                <div>
                                    <strong>真实部署回流</strong>
                                    <p>统计公益站等外部页面近 24 小时的曝光、点击、关闭和转化事件。</p>
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

    function renderWorkspaceNav(payload = {}) {
        const activeView = getWorkspaceView(state.activeView);
        return `
            <nav class="engagement-workspace-nav" aria-label="用户触达中心导航">
                ${WORKSPACE_VIEWS.map(([id, label, icon, desc]) => {
                    const isActive = activeView[0] === id;
                    return `
                        <button type="button"
                            class="engagement-workspace-tab ${isActive ? 'is-active' : ''}"
                            data-engagement-workspace-view="${escapeHtml(id)}"
                            aria-pressed="${isActive ? 'true' : 'false'}"
                            title="${escapeHtml(desc)}">
                            <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
                            <span class="engagement-workspace-tab__label">${escapeHtml(label)}</span>
                            <span class="engagement-workspace-tab__metric">${escapeHtml(getWorkspaceViewMetric(id, payload))}</span>
                        </button>
                    `;
                }).join('')}
            </nav>
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
                            <input name="max_width_px" type="number" min="260" max="560" value="${escapeHtml(style.max_width_px || 420)}">
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
                    <div class="engagement-asset-preview" style="--preview-accent:${escapeHtml(style.accent_color)};--preview-title:${escapeHtml(style.title_color)};--preview-bg:${escapeHtml(style.bubble_background)};--preview-text:${escapeHtml(style.text_color)};--preview-radius:${escapeHtml(style.radius_px || 22)}px;--preview-width:${escapeHtml(style.max_width_px || 420)}px">
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
                ${renderTemplateComposer()}
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
                ${renderSceneComposer()}
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

    function renderOverview(payload = {}) {
        const container = getOverviewContainer();
        if (!container) return;

        state.payload = payload;
        state.activeView = getWorkspaceView(state.activeView)[0];
        container.classList.remove('engagement-overview--loading');
        container.innerHTML = `
            ${renderWorkspaceNav(payload)}
            ${renderWorkspaceView(payload)}
        `;
        bindEngagementDirectHandlers(container);
        updateRulePreviewFromForm();

        if (state.focusedPageId) {
            const focused = container.querySelector(`[data-engagement-page="${state.focusedPageId}"]`);
            focused?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function collectRuleFormPayload(form) {
        const formData = new FormData(form);
        const pageIds = formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean);
        const enabled = String(formData.get('enabled') || '').trim() === 'true';
        const audienceScope = normalizeToken(formData.get('audience_scope') || 'all', 'all');
        const triggerType = normalizeToken(formData.get('trigger_type') || 'page_view', 'page_view');
        const placement = normalizeToken(formData.get('placement') || 'robot_bubble', 'robot_bubble');
        const templateDraft = getTemplateDraft();
        let status = String(formData.get('status') || 'draft').trim();
        if (enabled && status !== 'published') {
            status = 'published';
        } else if (!enabled && status === 'published') {
            status = 'paused';
        }
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
        return payload;
    }

    function collectRulePreviewFormData() {
        const form = document.getElementById('engagementRuleForm');
        if (!(form instanceof HTMLFormElement)) {
            return getInitialRulePreviewData();
        }
        const formData = new FormData(form);
        const pageIds = formData.getAll('page_ids').map((item) => String(item || '').trim()).filter(Boolean);
        const audienceScope = normalizeToken(formData.get('audience_scope') || 'all', 'all');
        const triggerType = normalizeToken(formData.get('trigger_type') || 'page_view', 'page_view');
        const placement = normalizeToken(formData.get('placement') || 'robot_bubble', 'robot_bubble');
        return {
            name: String(formData.get('name') || '').trim(),
            site: String(formData.get('site') || 'all').trim(),
            status: String(formData.get('status') || 'draft').trim(),
            page_ids: pageIds.length ? pageIds : ['all'],
            audience: { scope: audienceScope },
            trigger_type: triggerType,
            placement,
            title: String(formData.get('title') || '').trim(),
            content: String(formData.get('content') || '').trim(),
            tone: String(formData.get('tone') || 'info').trim(),
            action_label: String(formData.get('action_label') || '').trim(),
            action_url: String(formData.get('action_url') || '').trim(),
            enabled: String(formData.get('enabled') || '').trim() === 'true'
        };
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

    function updateRulePreviewFromForm() {
        const shell = document.querySelector('[data-engagement-rule-preview-shell]');
        if (!(shell instanceof HTMLElement)) return false;

        const previewData = collectRulePreviewFormData();
        const pageId = resolvePreviewPageId(previewData.page_ids);
        const title = previewData.title || previewData.name || '小助手提醒';
        const content = previewData.content || '这里会实时显示用户将在客服机器人旁看到的气泡内容。';
        const actionLabel = previewData.action_label || (previewData.action_url ? '查看详情' : '');
        const statusLabel = previewData.enabled && previewData.status === 'published'
            ? '运行中'
            : getOptionLabel(RULE_STATUS_OPTIONS, previewData.status || 'draft');
        const audienceLabel = getAudienceLabel(previewData.audience);
        const triggerTypeLabel = getTriggerTypeLabel(previewData.trigger_type);
        const placementLabel = getPlacementLabel(previewData.placement);
        const deviceLabel = state.previewDevice === 'mobile' ? '移动端' : '桌面端';
        const themeLabel = state.previewTheme === 'dark' ? '深色' : '浅色';
        const siteLabel = getOptionLabel([['all', '全站'], ['cn', 'CN'], ['intl', 'INTL']], previewData.site || 'all');
        const bubble = shell.querySelector('[data-engagement-preview-bubble]');
        const action = shell.querySelector('[data-engagement-preview-action]');

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
        if (action instanceof HTMLAnchorElement) {
            action.textContent = actionLabel;
            action.href = previewData.action_url || '#';
            action.hidden = !actionLabel;
        }
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
            tone: normalizeToken(formData.get('tone') || 'info', 'info')
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
            tag_targets: splitManagementLines(formData.get('tag_targets')),
            examples: splitManagementLines(formData.get('examples')),
            enabled: String(formData.get('enabled') || '').trim() === 'true'
        };
    }

    function collectUserTagFormPayload(form) {
        const formData = new FormData(form);
        return {
            action: 'save_tag',
            id: normalizeToken(formData.get('id') || '', ''),
            key: normalizeToken(formData.get('key') || '', ''),
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
        return {
            scene: {
                id: pageId,
                page_id: pageId,
                label: String(formData.get('label') || getPageLabel(pageId)).trim(),
                tone: normalizeToken(formData.get('tone') || 'info', 'info'),
                default_placement: normalizeToken(formData.get('default_placement') || 'robot_bubble', 'robot_bubble'),
                safe_zone: String(formData.get('safe_zone') || 'bottom-right').trim() || 'bottom-right',
                allow_marketing: String(formData.get('allow_marketing') || '').trim() === 'true',
                events: splitManagementLines(formData.get('events')).map((item) => normalizeToken(item, '')).filter(Boolean)
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
                max_width_px: Number.parseInt(formData.get('max_width_px') || '420', 10) || 420,
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
        const existing = templates.find((template) => normalizeToken(template?.key || template?.id, '') === normalizeToken(starter.key, ''));
        if (existing) {
            state.editingTemplateRef = String(existing.id || existing.key || '').trim();
            state.activeView = 'templates';
            renderOverview(state.payload || {});
            showFeedback('模板库中已存在这条推荐模板', 'info');
            return true;
        }
        const result = await mutateTemplate({
            ...starter,
            metadata: {
                productized: true,
                starter_id: starter.id,
                starter_category: starter.category,
                created_from: 'template_product_shelf'
            }
        });
        upsertTemplateInPayload(result?.template);
        state.editingTemplateRef = String(result?.template?.id || '').trim();
        state.templateCategoryFilter = starter.category || state.templateCategoryFilter;
        state.activeView = 'templates';
        showFeedback('推荐模板已写入模板库', 'success');
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
        const tagKey = normalizeToken(tagRef, '');
        if (!tagKey) return false;
        const tag = getUserTagCenter().tags.find((item) => normalizeToken(item.key || item.id, '') === tagKey);
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
        if (normalizeToken(state.editingUserTagRef, '') === tagKey) {
            state.editingUserTagRef = '';
        }
        state.activeView = 'segments';
        showFeedback('用户标签已删除', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function saveTagAutomationFromForm(form) {
        if (!(form instanceof HTMLFormElement)) return false;
        const payload = collectTagAutomationFormPayload(form);
        const result = await mutateSegment(payload);
        state.payload = {
            ...(state.payload || {}),
            tag_center: result?.tag_center || state.payload?.tag_center
        };
        state.activeView = 'segments';
        showFeedback('自动分群阈值已保存', 'success');
        renderOverview(state.payload || {});
        return true;
    }

    async function runInactiveUserSweep() {
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
        await mutateScene(payload);
        state.editingScenePageId = payload.scene.page_id;
        state.focusedPageId = payload.scene.page_id;
        state.activeView = 'scenes';
        showFeedback('页面场景已保存', 'success');
        await refreshAdminEngagementModule();
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
            showFeedback('公益站嵌入代码已复制', 'success');
            return true;
        } catch (_) {
            const textarea = document.getElementById('engagementExternalEmbedSnippet');
            textarea?.focus?.();
            textarea?.select?.();
            try {
                document.execCommand?.('copy');
                showFeedback('公益站嵌入代码已复制', 'success');
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

    async function toggleRule(ruleId = '', enabled = false) {
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
        showFeedback(enabled ? '触达规则已发布' : '触达规则已暂停', 'success');
        renderOverview(state.payload || {});
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
        state.editingRuleId = '';
        state.ruleDraft = null;
        state.activeView = 'rules';
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        showFeedback(`已切到${getPageLabel(normalizedPageId)}触达规则`, 'info');
        return true;
    }

    function clearPageFocus() {
        if (!state.focusedPageId) return false;
        state.focusedPageId = '';
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
        const normalizedRef = normalizeToken(tagRef, '');
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
        state.focusedPageId = normalizedPageId;
        state.activeView = 'scenes';
        renderOverview(state.payload || {});
        document.getElementById('engagementSceneForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    function resetSceneComposer() {
        state.editingScenePageId = 'home';
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
            dismiss_ttl_hours: Number(blueprint.dismissTtlHours || 24) || 24,
            metadata: {
                source_module: 'engagement.automation_blueprint',
                automation_blueprint_id: blueprint.id || '',
                automation_blueprint_title: blueprint.title || '',
                automation_mode: blueprint.mode || ''
            }
        };
    }

    function getAutomationBlueprintRules(blueprintId = '') {
        const normalizedId = normalizeToken(blueprintId, '');
        if (!normalizedId) return [];
        const rules = Array.isArray(state.payload?.rules) ? state.payload.rules : [];
        return rules.filter((rule) => {
            const metadata = rule?.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)
                ? rule.metadata
                : {};
            const ruleBlueprintId = normalizeToken(
                metadata.automation_blueprint_id || metadata.automationBlueprintId || metadata.blueprint_id || '',
                ''
            );
            return ruleBlueprintId === normalizedId;
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
        const running = rules.filter((rule) => rule.enabled === true && normalizeToken(rule.status, '') === 'published');
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
        const payload = buildAutomationRulePayload(blueprint);
        const result = await mutateRule(payload);
        const savedRule = result?.rule || {};
        upsertRuleInPayload(savedRule);
        state.ruleDraft = null;
        state.templateDraftRef = '';
        state.editingRuleId = String(savedRule.id || '').trim();
        state.activeView = 'rules';
        showFeedback(`已创建「${blueprint.title}」规则草稿，可继续编辑后发布`, 'success');
        renderOverview(state.payload || {});
        document.getElementById('engagementRuleForm')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
    }

    async function toggleAutomationRuleFromBlueprint(automationId = '', enabled = false) {
        const normalizedId = normalizeToken(automationId, '');
        const status = getAutomationBlueprintStatus(normalizedId);
        const ruleId = String(status.primaryRule?.id || '').trim();
        if (!ruleId) {
            showFeedback('这个自动化蓝图还没有规则，请先创建规则草稿', 'info');
            return false;
        }
        return toggleRule(ruleId, enabled);
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
            .filter((rule) => rule.enabled === true && normalizeToken(rule.status, '') === 'published')
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

    function chooseEngagementSelectOption(optionEl) {
        if (!(optionEl instanceof HTMLElement)) return;
        const selectEl = optionEl.closest('.engagement-select');
        if (!(selectEl instanceof HTMLElement)) return;

        const value = String(optionEl.dataset.value || '').trim();
        const label = optionEl.querySelector('span')?.textContent?.trim() || value;
        const input = selectEl.querySelector('[data-engagement-select-input]');
        const valueEl = selectEl.querySelector('.engagement-select__value');

        if (input) input.value = value;
        if (valueEl) valueEl.textContent = label;
        selectEl.querySelectorAll('[data-engagement-select-option]').forEach((item) => {
            const isSelected = item === optionEl;
            item.classList.toggle('is-selected', isSelected);
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
        closeEngagementSelects();
        if (handleColorPresetSelectChange(input)) return;
        if (handleRuleManagementSelectChange(input)) return;
        if (handleRulePreviewSelectChange(input)) return;
        if (input instanceof HTMLInputElement && input.name === 'page_id' && input.closest('#engagementSceneForm')) {
            state.editingScenePageId = normalizeToken(input.value || 'home', 'home');
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
        } else if (input.name === 'rule_sort') {
            state.ruleSort = normalizeToken(value, 'updated_desc');
        } else {
            return false;
        }
        renderOverview(state.payload || {});
        return true;
    }

    function handleRulePreviewSelectChange(input) {
        if (!(input instanceof HTMLInputElement)) return false;
        if (input.name !== 'preview_page_id') return false;
        state.previewPageId = normalizeToken(input.value, 'auto');
        updateRulePreviewFromForm();
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
        state.ruleSort = 'updated_desc';
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
        }
        return initAdminEngagementModule({
            force: true,
            message: pageId ? `正在定位${getPageLabel(pageId)}触达配置...` : '客服系统加载中...'
        });
    }

    document.addEventListener('click', (event) => {
        const workspaceView = event.target?.closest?.('[data-engagement-workspace-view]');
        if (workspaceView) {
            event.preventDefault();
            closeEngagementSelects();
            state.activeView = getWorkspaceView(workspaceView.dataset.engagementWorkspaceView)[0];
            renderOverview(state.payload || {});
            return;
        }

        const previewAction = event.target?.closest?.('[data-engagement-preview-action]');
        if (previewAction) {
            event.preventDefault();
            return;
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

        if (!event.target?.closest?.('.engagement-select')) {
            closeEngagementSelects();
        }

        const actionEl = event.target?.closest?.('[data-engagement-action]');
        if (!actionEl) return;

        const action = actionEl.dataset.engagementAction;
        if (action === 'refresh') {
            event.preventDefault();
            void refreshAdminEngagementModule();
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
            void saveTemplateFromForm(document.getElementById('engagementTemplateForm')).catch((error) => {
                showActionError(error, '消息模板保存失败');
            });
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
            void deleteTemplate(actionEl.dataset.templateId).catch((error) => {
                showActionError(error, '消息模板删除失败');
            });
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
            void createTemplateFromStarter(actionEl.dataset.templateStarterId).catch((error) => {
                showActionError(error, '推荐模板写入失败');
            });
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
            void saveUserTagFromForm(document.getElementById('engagementUserTagForm')).catch((error) => {
                showActionError(error, '用户标签保存失败');
            });
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
            void deleteUserTag(actionEl.dataset.tagKey).catch((error) => {
                showActionError(error, '用户标签删除失败');
            });
            return;
        }
        if (action === 'submit-tag-automation') {
            event.preventDefault();
            closeEngagementSelects();
            void saveTagAutomationFromForm(document.getElementById('engagementTagAutomationForm')).catch((error) => {
                showActionError(error, '自动分群阈值保存失败');
            });
            return;
        }
        if (action === 'run-inactive-sweep') {
            event.preventDefault();
            closeEngagementSelects();
            void runInactiveUserSweep().catch((error) => {
                showActionError(error, '长期未活跃扫描失败');
            });
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
            void saveSegmentFromForm(document.getElementById('engagementSegmentForm')).catch((error) => {
                showActionError(error, '用户分群保存失败');
            });
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
            void deleteSegment(actionEl.dataset.segmentId).catch((error) => {
                showActionError(error, '用户分群删除失败');
            });
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
            void createAutomationRuleFromBlueprint(actionEl.dataset.automationId).catch((error) => {
                showActionError(error, '自动化规则创建失败');
            });
            return;
        }
        if (action === 'create-missing-automation-rules') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            void createMissingAutomationRules().catch((error) => {
                showActionError(error, '批量创建自动化规则失败');
            });
            return;
        }
        if (action === 'publish-automation-drafts') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            void publishAutomationDraftRules().catch((error) => {
                showActionError(error, '批量发布自动化草稿失败');
            });
            return;
        }
        if (action === 'pause-running-automation-rules') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            void pauseRunningAutomationRules().catch((error) => {
                showActionError(error, '批量暂停自动化规则失败');
            });
            return;
        }
        if (action === 'toggle-automation-rule') {
            event.preventDefault();
            event.stopPropagation();
            closeEngagementSelects();
            void toggleAutomationRuleFromBlueprint(actionEl.dataset.automationId, actionEl.dataset.ruleEnabled === 'true').catch((error) => {
                showActionError(error, '自动化规则状态更新失败');
            });
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
        if (action === 'submit-scene') {
            event.preventDefault();
            closeEngagementSelects();
            void saveSceneFromForm(document.getElementById('engagementSceneForm')).catch((error) => {
                showActionError(error, '页面场景保存失败');
            });
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
            void saveAssetStyleFromForm(document.getElementById('engagementAssetStyleForm')).catch((error) => {
                showActionError(error, '气泡视觉样式保存失败');
            });
            return;
        }
        if (action === 'apply-asset-style-preset') {
            event.preventDefault();
            closeEngagementSelects();
            void applyAssetStylePreset(actionEl.dataset.assetStylePreset).catch((error) => {
                showActionError(error, '样式预设套用失败');
            });
            return;
        }
        if (action === 'submit-asset') {
            event.preventDefault();
            closeEngagementSelects();
            void saveAssetFromForm(document.getElementById('engagementAssetForm')).catch((error) => {
                showActionError(error, '触达素材保存失败');
            });
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
            void deleteAsset(actionEl.dataset.assetId).catch((error) => {
                showActionError(error, '触达素材删除失败');
            });
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
            void saveEntrySettingsFromForm(document.getElementById('engagementEntrySettingsForm')).catch((error) => {
                showActionError(error, '客服入口配置保存失败');
            });
            return;
        }
        if (action === 'submit-entry-context') {
            event.preventDefault();
            closeEngagementSelects();
            void saveEntryContextFromForm(document.getElementById('engagementEntryContextForm')).catch((error) => {
                showActionError(error, '页面客服入口保存失败');
            });
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
            void saveExternalEmbedFromForm(document.getElementById('engagementExternalEmbedForm')).catch((error) => {
                showActionError(error, '外部承载配置保存失败');
            });
            return;
        }
        if (action === 'copy-external-embed-snippet') {
            event.preventDefault();
            closeEngagementSelects();
            void copyExternalEmbedSnippet();
            return;
        }
        if (action === 'clear-rule-filters') {
            event.preventDefault();
            closeEngagementSelects();
            clearRuleFilters();
            return;
        }
        if (action === 'batch-pause-filtered-rules') {
            event.preventDefault();
            closeEngagementSelects();
            void batchPauseFilteredRules().catch((error) => {
                showActionError(error, '批量暂停规则失败');
            });
            return;
        }
        if (action === 'batch-copy-filtered-rules') {
            event.preventDefault();
            closeEngagementSelects();
            void batchCopyFilteredRulesToDraft().catch((error) => {
                showActionError(error, '批量复制规则失败');
            });
            return;
        }
        if (action === 'batch-archive-attention-rules') {
            event.preventDefault();
            closeEngagementSelects();
            void batchArchiveAttentionRules().catch((error) => {
                showActionError(error, '批量归档规则失败');
            });
            return;
        }
        if (action === 'batch-archive-high-risk-rules') {
            event.preventDefault();
            closeEngagementSelects();
            void batchArchiveHighRiskRules().catch((error) => {
                showActionError(error, '批量归档高风险规则失败');
            });
            return;
        }
        if (action === 'focus-rule-health-filter') {
            event.preventDefault();
            closeEngagementSelects();
            focusRuleHealthFilter(actionEl.dataset.ruleHealthFilter);
            return;
        }
        if (action === 'rollback-audit-batch') {
            event.preventDefault();
            closeEngagementSelects();
            void rollbackAuditBatch(actionEl.dataset.batchId).catch((error) => {
                showActionError(error, '批量回滚失败');
            });
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
            void toggleRule(actionEl.dataset.ruleId, actionEl.dataset.ruleEnabled === 'true').catch((error) => {
                showActionError(error, '触达规则状态更新失败');
            });
            return;
        }
        if (action === 'archive-rule') {
            event.preventDefault();
            void archiveRule(actionEl.dataset.ruleId).catch((error) => {
                showActionError(error, '触达规则归档失败');
            });
            return;
        }
        if (action === 'pause-all-rules') {
            event.preventDefault();
            closeEngagementSelects();
            void pauseAllRules().catch((error) => {
                showActionError(error, '暂停全部触达失败');
            });
            return;
        }
        if (action === 'restore-latest-pause-all-rules') {
            event.preventDefault();
            closeEngagementSelects();
            void restoreLatestPauseAllRules().catch((error) => {
                showActionError(error, '恢复最近暂停失败');
            });
            return;
        }
    });

    document.addEventListener('input', (event) => {
        const searchInput = event.target?.closest?.('[data-engagement-rule-search]');
        if (searchInput instanceof HTMLInputElement) {
            state.ruleSearchQuery = searchInput.value;
            scheduleRuleSearchRender(searchInput);
            return;
        }
        const colorInput = event.target?.closest?.('[data-engagement-color-value]');
        if (colorInput instanceof HTMLInputElement) {
            updateColorFieldSwatch(colorInput.closest('[data-engagement-color-field]'), colorInput.value);
            return;
        }
        const previewField = event.target?.closest?.('#engagementRuleForm input, #engagementRuleForm textarea');
        if (previewField instanceof HTMLElement) {
            updateRulePreviewFromForm();
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
        if (!['engagementRuleForm', 'engagementTemplateForm', 'engagementSegmentForm', 'engagementSceneForm', 'engagementAssetStyleForm', 'engagementAssetForm', 'engagementEntrySettingsForm', 'engagementEntryContextForm', 'engagementExternalEmbedForm'].includes(formId)) {
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
        if (event.key === 'Escape') {
            closeEngagementSelects();
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
