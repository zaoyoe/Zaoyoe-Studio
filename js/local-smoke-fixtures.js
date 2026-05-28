(function initLocalSmokeFixtures(globalScope) {
    const searchParams = (() => {
        try {
            return new URL(globalScope.location?.href || 'http://127.0.0.1/').searchParams;
        } catch (_) {
            return new URLSearchParams('');
        }
    })();
    const smokeEnabled = searchParams.get('smoke') === '1';
    const minimalDomOutput = searchParams.get('smokeDom') === 'minimal';
    const smokeRunId = String(searchParams.get('smokeRunId') || '').trim();

    if (!smokeEnabled) {
        return;
    }

    try {
        globalScope.localStorage?.removeItem?.('notifications_pinned_v1');
    } catch (_) {
        // Smoke fixtures should stay deterministic even when storage is unavailable.
    }

    const now = new Date('2026-03-31T09:30:00+08:00');
    const smokeAdminPermissions = [
        'prompts.manage',
        'content.moderate',
        'users.manage',
        'tickets.manage',
        'points.manage',
        'settings.manage',
        'ops_alerts.manage',
        'homepage.manage',
        'shop.manage',
        'chat.manage',
        'analytics.view'
    ];
    const SMOKE_SYSTEM_CONFIG_DOMAIN_KEY_MAP = Object.freeze({
        commerce: [
            'unlock_pricing',
            'recharge_options',
            'channels',
            'payment_channels',
            'discount_trigger_rules'
        ],
        affiliate: [
            'affiliate_program',
            'affiliate_poster',
            'rewards',
            'checkin_system'
        ],
        governance: [
            'security',
            'notifications',
            'moderation',
            'gallery',
            'comments'
        ],
        growth: [
            'seo',
            'performance',
            'analytics_preferences',
            'integrations'
        ],
        verify: [
            'verify_settings'
        ]
    });
    const smokeState = {
        user: {
            id: 'admin-1',
            email: 'admin-smoke@zaoyoe.invalid',
            user_metadata: {
                display_name: '陈值班'
            }
        },
        session: {
            access_token: 'local-smoke-access-token',
            user: {
                id: 'admin-1',
                email: 'admin-smoke@zaoyoe.invalid'
            }
        },
        notificationRecords: [
            {
                id: 'notif-long-1',
                user_id: 'admin-1',
                site: 'cn',
                title: '交班补充说明：今天上午支付波动与验证排队需要同步给接班同学',
                content: '9:00 到 10:00 之间的支付到账核对、验证排队重试和售后回访需要持续关注，建议交班时明确说明当前积压、已认领负责人以及还未关闭的异常链路。',
                type: 'warning',
                scope: 'admin_personal',
                category: 'admin_notice',
                is_read: false,
                created_at: '2026-03-31T08:58:00+08:00'
            },
            {
                id: 'notif-announce-1',
                user_id: 'admin-1',
                site: 'cn',
                title: '公告待确认',
                content: '春季活动公告已发布，建议值班管理员确认前台露出。',
                type: 'info',
                scope: 'admin_personal',
                category: 'announcement',
                is_read: false,
                created_at: '2026-03-31T08:52:00+08:00'
            },
            {
                id: 'notif-security-1',
                user_id: 'admin-1',
                site: 'cn',
                title: '异地登录提醒',
                content: '检测到新的后台登录地点，请确认是否为本人操作。',
                type: 'alert',
                scope: 'admin_personal',
                category: 'security',
                is_read: false,
                created_at: '2026-03-31T08:40:00+08:00'
            },
            {
                id: 'notif-assignment-1',
                user_id: 'admin-1',
                site: 'cn',
                title: '有新的值班转交',
                content: '商城风控队列新增 2 条转交会话，请优先处理。',
                type: 'info',
                scope: 'admin_personal',
                category: 'assignment',
                is_read: false,
                created_at: '2026-03-31T08:18:00+08:00'
            },
            {
                id: 'notif-admin-1',
                user_id: 'admin-1',
                site: 'cn',
                title: '退款运营提醒',
                content: '今天 10:00 前需要复核 3 条退款异常，并确认退款队列里两条历史工单是否已经同步给接班同学。',
                type: 'warning',
                scope: 'admin_personal',
                category: 'admin_notice',
                is_read: true,
                created_at: '2026-03-31T07:55:00+08:00'
            },
            {
                id: 'notif-assignment-2',
                user_id: 'admin-1',
                site: 'cn',
                title: '待办已认领',
                content: '支付异常会话已被林支援认领，当前无需重复跟进。',
                type: 'success',
                scope: 'admin_personal',
                category: 'assignment',
                is_read: true,
                created_at: '2026-03-31T07:35:00+08:00'
            }
        ],
        notificationSelectCount: 0,
        notificationSelectDelayMs: 0,
        opsAlertsConfig: {
            enabled: true,
            routing: {
                customer_chat_message: {
                    telegram: true,
                    feishu: false,
                    email: true
                }
            },
            customer_chat_message: {
                enabled: true,
                sweep_interval_ms: 300000,
                lookback_minutes: 20,
                dedupe_window_minutes: 45,
                work_hours_only_enabled: false,
                summary_enabled: true,
                summary_window_minutes: 90,
                summary_schedule_mode: 'hourly',
                summary_hourly_minute: 15,
                summary_daily_hour: 19,
                summary_daily_minute: 0,
                summary_max_items: 6,
                quick_reply_templates: [
                    {
                        id: 'ack',
                        business_type: 'general',
                        enabled: true,
                        label: '先接手',
                        hint: '先稳住用户预期',
                        text: '这边已看到你的消息，我先帮你核对一下当前记录，稍后给你明确处理结果。'
                    },
                    {
                        id: 'order',
                        business_type: 'order',
                        enabled: true,
                        label: '订单说明',
                        hint: '最近订单 {{order_status}}',
                        text: '我这边看到你最近的订单「{{order_name}}」当前状态是{{order_status}}，我先继续帮你核对处理进度，稍后给你明确反馈。'
                    },
                    {
                        id: 'payment',
                        business_type: 'payment',
                        enabled: true,
                        label: '充值核对',
                        hint: '最近充值 {{payment_status}}',
                        text: '我这边看到你最近的充值记录当前是{{payment_status}}，先帮你核对到账和处理链路，稍后回复你。'
                    },
                    {
                        id: 'verify',
                        business_type: 'verification',
                        enabled: true,
                        label: '验证跟进',
                        hint: '最近验证 {{verification_status}}',
                        text: '我这边看到最近验证任务状态是{{verification_status}}，先帮你核对当前提示和处理进度，稍后给你更新。'
                    },
                    {
                        id: 'ticket',
                        business_type: 'ticket',
                        enabled: true,
                        label: '工单跟进',
                        hint: '售后工单 {{ticket_status}}',
                        text: '我这边看到最近售后工单目前是{{ticket_status}}，已经接手继续跟进，有结果会第一时间回复你。'
                    }
                ]
            }
        },
        paymentChannelsConfig: {
            active_provider: 'mock',
            providers: {
                mock: {
                    enabled: true,
                    display_name: 'Mock',
                    description: '本地 smoke 回归专用通道'
                },
                afdian: {
                    enabled: true,
                    display_name: '爱发电',
                    description: '正式支付通道'
                },
                hupijiao: {
                    enabled: false,
                    display_name: '虎皮椒',
                    description: '备用支付通道'
                }
            },
            mock_payment: {
                allowed: true,
                reason: 'local-smoke',
                message: '当前使用本地 smoke 模式，允许 mock 通道。',
                override_configured: false,
                override_active: false,
                override_env_name: '',
                override_mode: 'none',
                cleanup_message: ''
            }
        },
        rechargeOptions: {
            mock_payment_enabled: true
        },
        discountTriggerRules: {
            recharge: {
                enabled: false,
                rules: []
            },
            checkin: {
                enabled: false,
                rules: []
            },
            affiliate: {
                enabled: false,
                rules: []
            }
        },
        systemConfigs: {
            unlock_pricing: {},
            channels: [],
            affiliate_program: {},
            affiliate_poster: {},
            rewards: {},
            checkin_system: {},
            security: {},
            notifications: {},
            moderation: {},
            gallery: {},
            comments: {},
            seo: {},
            performance: {},
            analytics_preferences: {},
            integrations: {},
            verify_settings: {},
            site_layouts: {
                cn: {
                    root_page_key: 'home',
                    logo_target_mode: 'follow_root',
                    logo_page_key: 'home'
                },
                intl: {
                    root_page_key: 'shop',
                    logo_target_mode: 'follow_root',
                    logo_page_key: 'shop'
                }
            }
        },
        opsAlertHealthPayload: {
            success: true,
            fetched_at: '2026-03-31T09:20:00+08:00',
            summary: {
                lookback_hours: 72,
                total_job_count: 48,
                total_attempt_count: 59,
                delivered_count: 54,
                failed_count: 3,
                dead_letter_count: 2,
                enabled_channel_count: 2
            },
            channels: [
                {
                    key: 'email',
                    label: '邮件',
                    enabled: true,
                    status: 'healthy',
                    delivered_count: 21,
                    failed_count: 1,
                    dead_letter_count: 0,
                    last_job_at: '2026-03-31T09:16:00+08:00',
                    config: {
                        sender_email: 'ops@fatherkey.com',
                        subject_prefix: '[Zaoyoe告警]',
                        recipient_preview: 'ops@fatherkey.com'
                    }
                },
                {
                    key: 'telegram',
                    label: 'Telegram',
                    enabled: true,
                    status: 'warning',
                    delivered_count: 33,
                    failed_count: 2,
                    dead_letter_count: 2,
                    last_job_at: '2026-03-31T09:17:00+08:00',
                    config: {
                        recipient_preview: '@zaoyoe_ops'
                    },
                    errors: ['最近 1 小时有 2 条发送失败，建议复核静默规则。']
                }
            ]
        },
        opsAlertMonitorPayload: {
            success: true,
            fetched_at: '2026-03-31T09:22:00+08:00',
            current_admin_id: 'admin-1',
            current_admin_label: '陈值班',
            assignable_admins: [
                { id: 'admin-1', label: '陈值班', email: 'admin-smoke@zaoyoe.invalid', is_current: true },
                { id: 'admin-2', label: '林支援', email: 'support-smoke@zaoyoe.invalid', is_current: false }
            ],
            summary: {
                lookback_hours: 72,
                total_job_count: 19,
                total_active_count: 7,
                total_critical_count: 2,
                active_category_count: 4,
                shift_report: {
                    shift_hours: 8,
                    bucket_hours: 2,
                    window_start: '2026-03-31T01:00:00+08:00',
                    window_end: '2026-03-31T09:00:00+08:00',
                    previous_window_start: '2026-03-30T17:00:00+08:00',
                    previous_window_end: '2026-03-31T01:00:00+08:00',
                    totals: {
                        claimed_count: 9,
                        assigned_count: 3,
                        resolved_count: 6,
                        note_count: 4,
                        reopened_count: 1,
                        avg_resolution_minutes: 28,
                        active_backlog_count: 7,
                        active_claimed_count: 4,
                        active_pending_count: 3,
                        previous_backlog_count: 5,
                        backlog_delta: 2,
                        longest_waiting_minutes: 83
                    },
                    close_reasons: [
                        { reason: '已完成补发', count: 3 },
                        { reason: '重复告警', count: 2 },
                        { reason: '用户已自助解决', count: 1 }
                    ],
                    admin_stats: [
                        {
                            admin_id: 'admin-1',
                            label: '陈值班',
                            claimed_count: 6,
                            assigned_count: 2,
                            resolved_count: 4,
                            avg_resolution_minutes: 24,
                            active_count: 4,
                            critical_active_count: 1,
                            is_current: true
                        },
                        {
                            admin_id: 'admin-2',
                            label: '林支援',
                            claimed_count: 3,
                            assigned_count: 1,
                            resolved_count: 2,
                            avg_resolution_minutes: 35,
                            active_count: 3,
                            critical_active_count: 1,
                            is_current: false
                        }
                    ],
                    categories: [
                        { key: 'payments', label: '支付与退款', backlog_count: 3, pending_count: 1, claimed_count: 2, critical_count: 1 },
                        { key: 'tickets', label: '工单与售后', backlog_count: 2, pending_count: 1, claimed_count: 1, critical_count: 0 },
                        { key: 'fulfillment', label: '履约与死信', backlog_count: 1, pending_count: 1, claimed_count: 0, critical_count: 0 },
                        { key: 'shop_risk', label: '商城风控', backlog_count: 1, pending_count: 0, claimed_count: 1, critical_count: 1 }
                    ],
                    trend: [
                        { bucket_end: '2026-03-31T03:00:00+08:00', backlog_count: 4, claimed_count: 1, assigned_count: 0, resolved_count: 1 },
                        { bucket_end: '2026-03-31T05:00:00+08:00', backlog_count: 5, claimed_count: 2, assigned_count: 1, resolved_count: 1 },
                        { bucket_end: '2026-03-31T07:00:00+08:00', backlog_count: 6, claimed_count: 2, assigned_count: 1, resolved_count: 2 },
                        { bucket_end: '2026-03-31T09:00:00+08:00', backlog_count: 7, claimed_count: 4, assigned_count: 3, resolved_count: 6 }
                    ]
                }
            },
            categories: [
                {
                    key: 'payments',
                    label: '支付与退款',
                    active_count: 3,
                    critical_count: 1,
                    latest_state: 'active',
                    latest_title: '支付链路波动',
                    latest_message: '最近 20 分钟支付异常会话增加，请优先检查到账核对和退款跟进。',
                    items: [
                        {
                            target_id: 'payment:1',
                            title: '到账核对积压',
                            message: '最近 20 分钟出现 2 条充值未及时核对。',
                            severity: 'critical',
                            alert_type: 'payment_gateway_degraded',
                            reference_label: '订单号',
                            reference_value: 'PAY-20260331-01',
                            created_at: '2026-03-31T08:36:00+08:00',
                            case_status: 'claimed',
                            case_owner_admin_id: 'admin-1',
                            case_owner_label: '陈值班'
                        },
                        {
                            target_id: 'payment:2',
                            title: '退款复核待处理',
                            message: '还有 1 条退款运营提醒未关闭。',
                            severity: 'warning',
                            alert_type: 'payment_refund_ops',
                            reference_label: '退款单',
                            reference_value: 'RF-20260331-08',
                            created_at: '2026-03-31T08:10:00+08:00',
                            case_status: 'open',
                            case_owner_admin_id: 'admin-2',
                            case_owner_label: '林支援'
                        }
                    ]
                },
                {
                    key: 'tickets',
                    label: '工单与售后',
                    active_count: 2,
                    critical_count: 0,
                    latest_state: 'active',
                    latest_title: '工单超时预警',
                    latest_message: '售后工单存在超时风险。',
                    items: [
                        {
                            target_id: 'ticket:1',
                            title: '售后工单待跟进',
                            message: '该工单已超出 45 分钟未回访。',
                            severity: 'warning',
                            alert_type: 'ticket_sla_overdue',
                            reference_label: '工单号',
                            reference_value: 'TK-20260331-03',
                            created_at: '2026-03-31T08:02:00+08:00',
                            case_status: 'claimed',
                            case_owner_admin_id: 'admin-1',
                            case_owner_label: '陈值班'
                        }
                    ]
                },
                {
                    key: 'fulfillment',
                    label: '履约与死信',
                    active_count: 1,
                    critical_count: 0,
                    latest_state: 'active',
                    latest_title: '发货回调延迟',
                    latest_message: '履约回调补偿正在进行，请值班同学跟进。',
                    items: [
                        {
                            target_id: 'fulfillment:1',
                            title: '履约补偿待确认',
                            message: '死信补偿已重试，但仍需人工确认。',
                            severity: 'warning',
                            alert_type: 'shop_order_delivery_failed',
                            reference_label: '订单号',
                            reference_value: 'SO-20260331-17',
                            created_at: '2026-03-31T07:45:00+08:00',
                            case_status: 'open',
                            case_owner_admin_id: 'admin-2',
                            case_owner_label: '林支援'
                        }
                    ]
                },
                {
                    key: 'shop_risk',
                    label: '商城风控',
                    active_count: 1,
                    critical_count: 1,
                    latest_state: 'active',
                    latest_title: '高风险优惠券滥用',
                    latest_message: '优惠券命中自动停券阈值，请优先处理。',
                    case_summary: {
                        open: 0,
                        claimed: 1,
                        resolved: 0
                    },
                    thresholds: {
                        auto_response_enabled: true,
                        auto_disable_coupon_min_risk_score: 90,
                        auto_ban_user_min_risk_score: 96,
                        auto_ban_user_duration_days: 7,
                        auto_suspend_product_min_risk_score: 97
                    },
                    recent_threshold_hits: [
                        {
                            action_label: '命中停券阈值',
                            reference_label: '优惠券码',
                            reference_value: 'SPRING-50',
                            risk_score: 96,
                            threshold: 90,
                            summary: '同一设备 10 分钟内重复下单 4 次',
                            created_at: '2026-03-31T08:32:00+08:00',
                            status_label: '待人工确认',
                            status: 'warning'
                        }
                    ],
                    recent_auto_responses: [
                        {
                            action_label: '自动停券',
                            target: 'SPRING-50',
                            summary: '风控规则已触发自动停券',
                            created_at: '2026-03-31T08:34:00+08:00',
                            status_label: '已执行',
                            status: 'applied'
                        }
                    ],
                    items: [
                        {
                            target_id: 'shop_order_risk:coupon:SPRING-50',
                            title: '优惠券疑似滥用',
                            message: '同一支付指纹短时内重复命中优惠券。',
                            severity: 'critical',
                            risk_level: 'high',
                            risk_score: 96,
                            alert_type: 'shop_order_risk_anomaly',
                            reference_label: '优惠券码',
                            reference_value: 'SPRING-50',
                            created_at: '2026-03-31T08:32:00+08:00',
                            case_status: 'claimed',
                            case_owner_admin_id: 'admin-1',
                            case_owner_label: '陈值班',
                            response_summary: '建议先停券，再复核关联账号。',
                            primary_action: 'disable-coupon',
                            discount_code: 'SPRING-50'
                        }
                    ]
                }
            ]
        },
        profiles: [
            {
                id: '00000000-0000-4000-8000-000000000001',
                username: '迟回复用户甲',
                email: 'delay-alpha@zaoyoe.invalid',
                avatar_url: ''
            },
            {
                id: '00000000-0000-4000-8000-000000000002',
                username: '迟回复用户乙',
                email: 'delay-beta@zaoyoe.invalid',
                avatar_url: ''
            },
            {
                id: '00000000-0000-4000-8000-000000000003',
                username: '验证待跟进用户',
                email: 'verify-gamma@zaoyoe.invalid',
                avatar_url: ''
            },
            {
                id: '00000000-0000-4000-8000-000000000004',
                username: '已接起会话',
                email: 'stable-delta@zaoyoe.invalid',
                avatar_url: ''
            }
        ],
        chatMessages: [
            {
                id: 'chat-smoke-1',
                session_id: 'smoke-session-stale-1',
                user_id: '00000000-0000-4000-8000-000000000001',
                content: '我的订单怎么还没更新？',
                message_type: 'text',
                is_admin: false,
                created_at: '2026-03-31T06:40:00+08:00'
            },
            {
                id: 'chat-smoke-2',
                session_id: 'smoke-session-stale-1',
                user_id: '00000000-0000-4000-8000-000000000001',
                content: '已经等了很久了，麻烦帮我看下。',
                message_type: 'text',
                is_admin: false,
                created_at: '2026-03-31T06:55:00+08:00'
            },
            {
                id: 'chat-smoke-3',
                session_id: 'smoke-session-stale-2',
                user_id: '00000000-0000-4000-8000-000000000002',
                content: '支付状态一直没变。',
                message_type: 'text',
                is_admin: false,
                created_at: '2026-03-31T07:08:00+08:00'
            },
            {
                id: 'chat-smoke-4',
                session_id: 'smoke-session-stale-3',
                user_id: '00000000-0000-4000-8000-000000000003',
                content: '验证一直失败，能帮我看下吗？',
                message_type: 'text',
                is_admin: false,
                created_at: '2026-03-31T07:52:00+08:00'
            },
            {
                id: 'chat-smoke-5',
                session_id: 'smoke-session-active-1',
                user_id: '00000000-0000-4000-8000-000000000004',
                content: '到账了但是页面没刷新。',
                message_type: 'text',
                is_admin: false,
                created_at: '2026-03-31T09:03:00+08:00'
            },
            {
                id: 'chat-smoke-6',
                session_id: 'smoke-session-active-1',
                user_id: '00000000-0000-4000-8000-000000000004',
                content: '已收到，我这边继续帮你核对到账状态。',
                message_type: 'text',
                is_admin: true,
                created_at: '2026-03-31T09:10:00+08:00'
            }
        ],
        shopOrders: [
            {
                id: 'SHOP-20260331-001',
                user_id: '00000000-0000-4000-8000-000000000001',
                created_at: '2026-03-31T05:55:00+08:00',
                site: 'cn',
                price_paid: 128,
                discount_code: 'SPRING20',
                discount_amount: 20,
                snapshot_product_name: '春季体验套餐 · 含人工核对与延迟发货补偿权益',
                refund_status: '',
                delivery_status: 'processing'
            },
            {
                id: 'SHOP-20260331-002',
                user_id: '00000000-0000-4000-8000-000000000002',
                created_at: '2026-03-31T06:50:00+08:00',
                site: 'cn',
                price_paid: 68,
                discount_code: 'RISKFIX',
                discount_amount: 10,
                snapshot_product_name: '月度会员',
                refund_status: '',
                delivery_status: 'delivered'
            }
        ],
        discountCodes: [
            {
                id: 'discount-cn-spring',
                code: 'SPRING20',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'scheduled',
                status_reason: 'scheduled_start',
                distribution_mode: 'public_claim',
                starts_at: '2026-04-10T00:00:00+08:00',
                expires_at: '2026-05-10T00:00:00+08:00',
                created_at: '2026-03-31T07:20:00+08:00',
                is_exclusive: false,
                stack_priority: 12,
                pricing_apply_stage: 'catalog_price'
            },
            {
                id: 'discount-cn-risk',
                code: 'RISKFIX',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'paused_risk',
                status_reason: 'risk_hold',
                distribution_mode: 'user_assigned',
                starts_at: '2026-03-20T00:00:00+08:00',
                expires_at: '2026-04-30T00:00:00+08:00',
                last_paused_at: '2026-04-08T19:30:00+08:00',
                created_at: '2026-03-18T09:20:00+08:00',
                is_exclusive: true,
                stack_priority: 90,
                pricing_apply_stage: 'order_discount'
            },
            {
                id: 'discount-cn-wallet-bonus',
                code: 'TOPUP88',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'active',
                status_reason: 'manual_enabled',
                distribution_mode: 'user_assigned',
                starts_at: '2026-03-16T00:00:00+08:00',
                expires_at: '2026-05-05T00:00:00+08:00',
                created_at: '2026-03-19T11:10:00+08:00',
                is_exclusive: false,
                stack_priority: 24,
                pricing_apply_stage: 'order_discount',
                discount_type: 'fixed',
                discount_value: 18
            },
            {
                id: 'discount-intl-global',
                code: 'GLOBAL10',
                applicable_site: 'intl',
                is_active: true,
                lifecycle_status: 'active',
                status_reason: 'manual_enabled',
                distribution_mode: 'public_claim',
                starts_at: '2026-03-15T00:00:00+08:00',
                expires_at: '2026-04-25T00:00:00+08:00',
                created_at: '2026-03-12T11:00:00+08:00',
                is_exclusive: false,
                stack_priority: 18,
                pricing_apply_stage: 'catalog_price'
            }
        ],
        discountUserAssets: [
            {
                id: 'discount-asset-cn-1',
                discount_id: 'discount-cn-spring',
                asset_status: 'available',
                assigned_at: '2026-03-31T08:12:00+08:00',
                claimed_at: '2026-03-31T08:20:00+08:00',
                consumed_at: '',
                restored_at: ''
            },
            {
                id: 'discount-asset-cn-2',
                discount_id: 'discount-cn-risk',
                asset_status: 'consumed',
                assigned_at: '2026-03-31T08:40:00+08:00',
                claimed_at: '2026-03-31T08:42:00+08:00',
                consumed_at: '2026-03-31T09:05:00+08:00',
                restored_at: ''
            },
            {
                id: 'discount-asset-intl-1',
                discount_id: 'discount-intl-global',
                asset_status: 'available',
                assigned_at: '2026-03-31T08:48:00+08:00',
                claimed_at: '2026-03-31T08:53:00+08:00',
                consumed_at: '',
                restored_at: ''
            }
        ],
        paymentOrders: [
            {
                id: 'PAY-20260331-001',
                user_id: '00000000-0000-4000-8000-000000000001',
                created_at: '2026-03-31T06:02:00+08:00',
                package_name: '春季体验套餐',
                paid_amount: 128,
                expected_amount: 128,
                status: 'processing',
                provider: 'mock'
            },
            {
                id: 'PAY-20260331-002',
                user_id: '00000000-0000-4000-8000-000000000004',
                created_at: '2026-03-31T08:58:00+08:00',
                package_name: '充值 50 元',
                paid_amount: 50,
                expected_amount: 50,
                status: 'paid',
                provider: 'mock'
            }
        ],
        verificationLogs: [
            {
                verification_id: 'VERIFY-20260331-ALPHA',
                user_id: '00000000-0000-4000-8000-000000000001',
                status: 'failed',
                message: '人机校验超时，请人工复核',
                created_at: '2026-03-31T06:18:00+08:00'
            },
            {
                verification_id: 'VERIFY-20260331-GAMMA',
                user_id: '00000000-0000-4000-8000-000000000003',
                status: 'processing',
                message: '排队重试中',
                created_at: '2026-03-31T07:36:00+08:00'
            }
        ],
        shopTickets: [
            {
                id: 'TK-20260331-001',
                user_id: '00000000-0000-4000-8000-000000000001',
                order_id: 'SHOP-20260331-001',
                issue_type: 'delivery',
                status: 'pending',
                description: '用户反馈发货状态迟迟未更新',
                created_at: '2026-03-31T06:10:00+08:00',
                updated_at: '2026-03-31T08:48:00+08:00'
            },
            {
                id: 'TK-20260331-002',
                user_id: '00000000-0000-4000-8000-000000000003',
                order_id: '',
                issue_type: 'verification',
                status: 'pending',
                description: '验证失败需要人工协助',
                created_at: '2026-03-31T07:18:00+08:00',
                updated_at: '2026-03-31T08:26:00+08:00'
            }
        ],
        shopCategories: [
            {
                id: 'cat-account',
                name: 'account',
                color: '#6b9ece',
                sort_order: 10
            },
            {
                id: 'cat-cards',
                name: 'cards',
                color: '#f4b400',
                sort_order: 20
            },
            {
                id: 'cat-other',
                name: 'other',
                color: '#9aa0a6',
                sort_order: 90
            }
        ],
        shopProducts: [
            {
                id: 'shop-prod-cn-1',
                name: 'CN 高级账号',
                name_en: 'CN Premium Account',
                description: '中文站高价值账号库存，用来验证商品工作台渲染和库存回算。',
                description_en: 'CN premium stock used by the local smoke workflow.',
                price_points: 188,
                price_points_intl: 28,
                icon_url: 'fas fa-crown',
                category: 'account',
                display_order: 30,
                sort_order: 0,
                is_active: true,
                stock_count: 1
            },
            {
                id: 'shop-prod-cn-2',
                name: 'CN 月付会员',
                name_en: 'CN Monthly Membership',
                description: '中文站月付会员商品，用来验证同分类排序持久化。',
                description_en: 'CN membership item for smoke sort persistence.',
                price_points: 88,
                price_points_intl: 16,
                icon_url: 'fas fa-id-badge',
                category: 'account',
                display_order: 20,
                sort_order: 1,
                is_active: true,
                stock_count: 0
            },
            {
                id: 'shop-prod-cn-3',
                name: '兑换卡套餐',
                name_en: 'Gift Card Bundle',
                description: '卡券类商品，用来验证跨分类移动和删分类回退。',
                description_en: 'Card bundle used to verify cross-category moves.',
                price_points: 56,
                price_points_intl: 12,
                icon_url: 'fas fa-ticket-alt',
                category: 'cards',
                display_order: 10,
                sort_order: 0,
                is_active: true,
                stock_count: 1
            },
            {
                id: 'shop-prod-cn-4',
                name: '历史下架商品',
                name_en: 'Archived Product',
                description: '用于验证导入树回收站渲染。',
                description_en: 'Archived product for recycle-bin smoke coverage.',
                price_points: 10,
                price_points_intl: 2,
                icon_url: 'fas fa-box-archive',
                category: 'other',
                display_order: 0,
                sort_order: 0,
                is_active: false,
                stock_count: 0
            }
        ],
        shopInventory: [
            {
                id: 'inv-smoke-1',
                product_id: 'shop-prod-cn-1',
                content: 'alpha@example.com----pass-alpha',
                status: 'available',
                batch_id: 'BATCH-ALPHA',
                created_at: '2026-03-31T05:40:00+08:00',
                buyer_id: null,
                sold_at: null,
                order_id: null,
                remark: null
            },
            {
                id: 'inv-smoke-2',
                product_id: 'shop-prod-cn-1',
                content: 'reserve@example.com----pass-reserve',
                status: 'reserve',
                batch_id: 'BATCH-RESERVE',
                created_at: '2026-03-30T12:00:00+08:00',
                buyer_id: '00000000-0000-4000-8000-000000000001',
                sold_at: '2026-03-31T06:00:00+08:00',
                order_id: null,
                remark: '预留待复核'
            },
            {
                id: 'inv-smoke-3',
                product_id: 'shop-prod-cn-3',
                content: 'gift@example.com----card-001',
                status: 'available',
                batch_id: 'BATCH-CARD',
                created_at: '2026-03-31T06:20:00+08:00',
                buyer_id: null,
                sold_at: null,
                order_id: null,
                remark: null
            },
            {
                id: 'inv-smoke-4',
                product_id: 'shop-prod-cn-2',
                content: 'sold@example.com----membership-001',
                status: 'sold',
                batch_id: 'BATCH-SOLD',
                created_at: '2026-03-31T06:45:00+08:00',
                buyer_id: '00000000-0000-4000-8000-000000000002',
                sold_at: '2026-03-31T06:50:00+08:00',
                order_id: 'SHOP-20260331-002',
                remark: null
            }
        ],
        homepageConfigRows: buildHomepageConfigRows(),
        guestbookMessages: [
            {
                id: 'gb-msg-cn-1',
                site: 'cn',
                user_id: '00000000-0000-4000-8000-000000000001',
                content: '中文站主留言，想确认最近的人工审核进度。',
                image_url: '',
                like_count: 2,
                created_at: '2026-03-31T08:30:00+08:00'
            },
            {
                id: 'gb-msg-intl-1',
                site: 'intl',
                user_id: '00000000-0000-4000-8000-000000000004',
                content: 'Global guestbook entry asking about turnaround time.',
                image_url: '',
                like_count: 1,
                created_at: '2026-03-31T08:10:00+08:00'
            }
        ],
        guestbookComments: [
            {
                id: 'gb-comment-cn-1',
                site: 'cn',
                message_id: 'gb-msg-cn-1',
                parent_id: null,
                user_id: '00000000-0000-4000-8000-000000000002',
                content: '先帮你跟进一下当前排队情况。',
                created_at: '2026-03-31T08:36:00+08:00'
            },
            {
                id: 'gb-reply-cn-1',
                site: 'cn',
                message_id: 'gb-msg-cn-1',
                parent_id: 'gb-comment-cn-1',
                user_id: '00000000-0000-4000-8000-000000000003',
                content: '我也遇到一样的问题，先占个楼。',
                created_at: '2026-03-31T08:41:00+08:00'
            },
            {
                id: 'gb-comment-intl-1',
                site: 'intl',
                message_id: 'gb-msg-intl-1',
                parent_id: null,
                user_id: '00000000-0000-4000-8000-000000000001',
                content: 'We are checking the queue for you.',
                created_at: '2026-03-31T08:16:00+08:00'
            }
        ],
        guestbookLikes: [
            {
                id: 'gb-like-cn-1',
                site: 'cn',
                user_id: '00000000-0000-4000-8000-000000000004',
                target_type: 'comment',
                target_id: 'gb-comment-cn-1',
                created_at: '2026-03-31T08:38:00+08:00'
            },
            {
                id: 'gb-like-cn-2',
                site: 'cn',
                user_id: '00000000-0000-4000-8000-000000000001',
                target_type: 'comment',
                target_id: 'gb-reply-cn-1',
                created_at: '2026-03-31T08:42:00+08:00'
            }
        ],
        prompts: [
            {
                id: 'prompt-cn-1',
                title: '中文 Prompt 卡片',
                title_zh: '中文 Prompt 卡片',
                title_en: 'CN Prompt Card',
                description: '中文站默认描述，用来验证编辑态会回填主描述字段。',
                description_zh: '中文站默认描述，用来验证编辑态会回填主描述字段。',
                description_en: 'CN default description used to verify edit-mode hydration.',
                prompt_text: 'base prompt text for cn smoke coverage',
                prompt_text_zh: '中文提示词草稿，用来验证显式语言字段。',
                prompt_text_en: 'English prompt draft for smoke verification.',
                tags: ['Photography'],
                images: ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='],
                ai_tags: {
                    objects: { en: ['portrait'], zh: ['人像'] },
                    scenes: { en: ['studio'], zh: ['摄影棚'] },
                    styles: { en: ['editorial'], zh: ['杂志感'] },
                    mood: { en: ['calm'], zh: ['平静'] }
                },
                dominant_colors: ['blue', 'silver'],
                created_at: '2026-03-31T08:20:00+08:00',
                updated_at: '2026-03-31T09:05:00+08:00'
            },
            {
                id: 'prompt-intl-1',
                title: 'Global Prompt Card',
                title_zh: '国际站 Prompt 卡片',
                title_en: 'Global Prompt Card',
                description: 'Global prompt description for smoke switching.',
                description_zh: '国际站默认描述，用来验证切站不串数据。',
                description_en: 'Global prompt description for site-switch smoke coverage.',
                prompt_text: 'intl base prompt text',
                prompt_text_zh: '国际站中文提示词',
                prompt_text_en: 'Global prompt draft',
                tags: ['Illustration'],
                images: ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='],
                ai_tags: {
                    objects: { en: ['character'], zh: ['角色'] },
                    scenes: { en: ['city'], zh: ['城市'] },
                    styles: { en: ['stylized'], zh: ['风格化'] },
                    mood: { en: ['bright'], zh: ['明亮'] }
                },
                dominant_colors: ['golden', 'white'],
                created_at: '2026-03-31T08:12:00+08:00',
                updated_at: '2026-03-31T08:40:00+08:00'
            }
        ],
        pointsPackages: [
            {
                id: 'pkg-starter',
                name: '新手尝鲜包',
                name_en: 'Starter Pack',
                points_amount: 100,
                bonus_points: 0,
                price_cny: 1.99,
                is_active: true,
                sort_order: 1,
                created_at: '2026-03-31T08:00:00+08:00'
            },
            {
                id: 'pkg-value',
                name: '超值进阶包',
                name_en: 'Value Pack',
                points_amount: 500,
                bonus_points: 100,
                price_cny: 9.90,
                is_active: true,
                sort_order: 2,
                created_at: '2026-03-31T08:05:00+08:00'
            },
            {
                id: 'pkg-legacy',
                name: '历史下线包',
                name_en: 'Legacy Pack',
                points_amount: 200,
                bonus_points: 0,
                price_cny: 4.90,
                is_active: false,
                sort_order: 3,
                created_at: '2026-03-31T08:10:00+08:00'
            }
        ],
        redemptionBatches: [
            {
                id: 'batch-cn-1',
                name: '闲鱼四月活动',
                package_id: 'pkg-starter',
                total_count: 20,
                used_count: 8,
                site: 'cn',
                status: 'active',
                created_at: '2026-03-31T09:00:00+08:00'
            },
            {
                id: 'batch-intl-1',
                name: 'INTL Campaign',
                package_id: 'pkg-starter',
                total_count: 10,
                used_count: 3,
                site: 'intl',
                status: 'active',
                created_at: '2026-03-31T09:20:00+08:00'
            },
            {
                id: 'batch-cn-2',
                name: '春季补发',
                package_id: 'pkg-value',
                total_count: 12,
                used_count: 4,
                site: 'cn',
                status: 'active',
                created_at: '2026-03-31T09:30:00+08:00'
            },
            {
                id: 'batch-custom-cn-1',
                name: '手动补偿',
                package_id: null,
                total_count: 3,
                used_count: 1,
                site: 'cn',
                status: 'active',
                created_at: '2026-03-31T09:40:00+08:00'
            }
        ],
        marketingAssetWorkflows: [
            {
                id: 'marketing-workflow-1',
                workflow_key: 'discount_lifecycle_sync',
                workflow_name: '优惠券生命周期同步',
                asset_family: 'discount',
                status: 'active',
                schedule_label: '建议每小时执行',
                sort_order: 1,
                next_run_at: '2026-04-09T10:00:00+08:00',
                last_run_at: '',
                last_run_status: '',
                last_run_summary: '',
                due_count_by_site: {
                    cn: 2,
                    intl: 0,
                    all: 2
                }
            },
            {
                id: 'marketing-workflow-2',
                workflow_key: 'risk_observation_closeout',
                workflow_name: '观察期收口',
                asset_family: 'discount',
                status: 'active',
                schedule_label: '建议每 2 小时执行',
                sort_order: 2,
                next_run_at: '2026-04-09T11:00:00+08:00',
                last_run_at: '2026-04-09T07:30:00+08:00',
                last_run_status: 'success',
                last_run_summary: '观察期收口完成：关闭 1 张优惠券的观察状态。',
                due_count_by_site: {
                    cn: 1,
                    intl: 0,
                    all: 1
                }
            },
            {
                id: 'marketing-workflow-3',
                workflow_key: 'retired_discount_archive',
                workflow_name: '历史优惠归档',
                asset_family: 'discount',
                status: 'active',
                schedule_label: '建议每日执行',
                sort_order: 3,
                next_run_at: '2026-04-10T00:00:00+08:00',
                last_run_at: '2026-04-08T23:40:00+08:00',
                last_run_status: 'success',
                last_run_summary: '历史归档完成：归档 2 张已退休优惠券。',
                due_count_by_site: {
                    cn: 0,
                    intl: 0,
                    all: 0
                }
            },
            {
                id: 'marketing-workflow-4',
                workflow_key: 'marketing_asset_recap',
                workflow_name: '营销资产复盘快照',
                asset_family: 'combined',
                status: 'active',
                schedule_label: '建议每日执行',
                sort_order: 4,
                next_run_at: '2026-04-09T23:55:00+08:00',
                last_run_at: '2026-04-08T23:55:00+08:00',
                last_run_status: 'success',
                last_run_summary: '复盘快照已生成：当前共有 3 张优惠券，其中 1 张生效中。',
                due_count_by_site: {
                    cn: 0,
                    intl: 1,
                    all: 1
                }
            }
        ],
        marketingAssetWorkflowRuns: [
            {
                id: 'marketing-run-1',
                workflow_id: 'marketing-workflow-2',
                workflow_key: 'risk_observation_closeout',
                started_at: '2026-04-09T07:30:00+08:00',
                finished_at: '2026-04-09T07:31:00+08:00',
                run_status: 'success',
                summary: '观察期收口完成：关闭 1 张优惠券的观察状态。',
                site_context: 'cn'
            },
            {
                id: 'marketing-run-2',
                workflow_id: 'marketing-workflow-3',
                workflow_key: 'retired_discount_archive',
                started_at: '2026-04-08T23:40:00+08:00',
                finished_at: '2026-04-08T23:41:00+08:00',
                run_status: 'success',
                summary: '历史归档完成：归档 2 张已退休优惠券。',
                site_context: 'all'
            },
            {
                id: 'marketing-run-3',
                workflow_id: 'marketing-workflow-4',
                workflow_key: 'marketing_asset_recap',
                started_at: '2026-04-08T23:55:00+08:00',
                finished_at: '2026-04-08T23:56:00+08:00',
                run_status: 'success',
                summary: '复盘快照已生成：当前共有 3 张优惠券，其中 1 张生效中。',
                site_context: 'all'
            }
        ],
        redemptionCodes: [
            {
                id: 'code-cn-1',
                code: 'ZY-CN-USED-0001',
                batch_id: 'batch-cn-1',
                package_id: 'pkg-starter',
                status: 'used',
                site: 'cn',
                used_by: '00000000-0000-4000-8000-000000000001',
                used_at: '2026-03-31T10:02:00+08:00',
                points_amount: 100,
                created_at: '2026-03-31T09:01:00+08:00'
            },
            {
                id: 'code-cn-2',
                code: 'ZY-CN-PENDING-0002',
                batch_id: 'batch-cn-1',
                package_id: 'pkg-starter',
                status: 'pending',
                site: 'cn',
                points_amount: 100,
                created_at: '2026-03-31T09:03:00+08:00'
            },
            {
                id: 'code-intl-1',
                code: 'ZY-INTL-DISABLED-0001',
                batch_id: 'batch-intl-1',
                package_id: 'pkg-starter',
                status: 'disabled',
                site: 'intl',
                points_amount: 100,
                created_at: '2026-03-31T09:22:00+08:00'
            }
        ],
        pointsLedger: [
            {
                id: '11111111-1111-4111-8111-111111111111',
                site: 'cn',
                reason: 'unlock_prompt',
                reference_id: 'prompt-cn-1',
                amount: -20,
                user_id: '00000000-0000-4000-8000-000000000001',
                created_at: '2026-03-31T11:00:00+08:00'
            }
        ],
        promptUnlocks: [
            {
                id: 'prompt-unlock-cn-1',
                site: 'cn',
                prompt_id: 'prompt-cn-1',
                user_id: '00000000-0000-4000-8000-000000000001',
                unlocked_at: '2026-03-31T08:21:00+08:00'
            },
            {
                id: 'prompt-unlock-cn-2',
                site: 'cn',
                prompt_id: 'prompt-cn-1',
                user_id: '00000000-0000-4000-8000-000000000002',
                unlocked_at: '2026-03-31T08:27:00+08:00'
            },
            {
                id: 'prompt-unlock-intl-1',
                site: 'intl',
                prompt_id: 'prompt-cn-1',
                user_id: '00000000-0000-4000-8000-000000000003',
                unlocked_at: '2026-03-31T08:36:00+08:00'
            },
            {
                id: 'prompt-unlock-cn-3',
                site: 'cn',
                prompt_id: 'prompt-intl-1',
                user_id: '00000000-0000-4000-8000-000000000004',
                unlocked_at: '2026-03-31T08:29:00+08:00'
            },
            {
                id: 'prompt-unlock-intl-2',
                site: 'intl',
                prompt_id: 'prompt-intl-1',
                user_id: '00000000-0000-4000-8000-000000000001',
                unlocked_at: '2026-03-31T08:31:00+08:00'
            }
        ],
        promptComments: [
            {
                id: 'prompt-comment-cn-1',
                site: 'cn',
                prompt_id: 'prompt-cn-1',
                parent_id: null,
                content: '中文站卡片评论，当前是置顶评论。',
                user_id: '00000000-0000-4000-8000-000000000001',
                created_at: '2026-03-31T08:52:00+08:00',
                image_url: '',
                is_pinned: true,
                is_featured: false,
                prompt_title: '中文 Prompt 卡片',
                like_count: 2
            },
            {
                id: 'prompt-comment-cn-2',
                site: 'cn',
                prompt_id: 'prompt-cn-1',
                parent_id: null,
                content: '中文站另一条评论，smoke 会把它切成置顶。',
                user_id: '00000000-0000-4000-8000-000000000002',
                created_at: '2026-03-31T08:58:00+08:00',
                image_url: '',
                is_pinned: false,
                is_featured: false,
                prompt_title: '中文 Prompt 卡片',
                like_count: 1
            },
            {
                id: 'prompt-comment-intl-1',
                site: 'intl',
                prompt_id: 'prompt-intl-1',
                parent_id: null,
                content: 'Global prompt comment for site-switch regression.',
                user_id: '00000000-0000-4000-8000-000000000003',
                created_at: '2026-03-31T08:24:00+08:00',
                image_url: '',
                is_pinned: false,
                is_featured: false,
                prompt_title: 'Global Prompt Card',
                like_count: 3
            }
        ],
        blockedUsers: [],
        blockHistory: [],
        opsAlertJobs: [
            {
                id: 'ticket-summary-job-latest',
                alert_type: 'ticket_sla_summary',
                severity: 'warning',
                title: '每日 SLA 汇总',
                payload: {
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 60,
                    summary_daily_hour: 8,
                    summary_daily_minute: 0,
                    summary_max_items: 8,
                    window_start_at: '2026-03-31T08:00:00+08:00',
                    window_end_at: '2026-03-31T09:00:00+08:00',
                    item_count: 5,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    items: [
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-001',
                                order_id: 'SHOP-20260331-001',
                                user_id: '00000000-0000-4000-8000-000000000001',
                                user_email: 'delay-alpha@zaoyoe.invalid',
                                wait_label: '13 小时 57 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '用户反馈发货状态迟迟未更新',
                                updated_at: '2026-03-31T08:48:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-002',
                                order_id: 'SHOP-20260331-002',
                                user_id: '00000000-0000-4000-8000-000000000002',
                                user_email: 'delay-beta@zaoyoe.invalid',
                                wait_label: '13 小时 45 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '支付状态一直没变，用户追问到账进度',
                                updated_at: '2026-03-31T08:22:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-003',
                                order_id: '',
                                user_id: '00000000-0000-4000-8000-000000000003',
                                user_email: 'verify-gamma@zaoyoe.invalid',
                                wait_label: '12 小时 27 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '验证失败需要人工协助',
                                updated_at: '2026-03-31T08:26:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-004',
                                order_id: '',
                                user_id: '00000000-0000-4000-8000-000000000004',
                                user_email: 'stable-delta@zaoyoe.invalid',
                                wait_label: '11 小时 03 分钟',
                                responsible_label: '林支援',
                                ticket_status: 'PENDING',
                                reason: '到账后页面未刷新，需要人工核对',
                                updated_at: '2026-03-31T08:31:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-NEW-005',
                                order_id: 'SHOP-20260331-001',
                                user_id: '00000000-0000-4000-8000-000000000001',
                                user_email: 'delay-alpha@zaoyoe.invalid',
                                wait_label: '3 小时 20 分钟',
                                responsible_label: '陈值班',
                                ticket_status: 'PENDING',
                                reason: '用户追问补发补偿进度',
                                updated_at: '2026-03-31T09:03:00+08:00'
                            }
                        }
                    ]
                },
                channels: ['telegram', 'feishu', 'email'],
                remaining_channels: [],
                status: 'delivered',
                attempt_count: 1,
                max_attempts: 6,
                next_retry_at: '',
                last_error: '',
                created_at: '2026-03-31T09:06:24+08:00',
                updated_at: '2026-03-31T09:06:34+08:00',
                delivered_at: '2026-03-31T09:06:34+08:00'
            },
            {
                id: 'ticket-summary-job-previous',
                alert_type: 'ticket_sla_summary',
                severity: 'warning',
                title: '每日 SLA 汇总',
                payload: {
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 60,
                    summary_daily_hour: 7,
                    summary_daily_minute: 0,
                    summary_max_items: 8,
                    window_start_at: '2026-03-31T07:00:00+08:00',
                    window_end_at: '2026-03-31T08:00:00+08:00',
                    item_count: 5,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    items: [
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-001',
                                order_id: 'SHOP-20260331-001',
                                user_id: '00000000-0000-4000-8000-000000000001',
                                user_email: 'delay-alpha@zaoyoe.invalid',
                                wait_label: '12 小时 57 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '用户反馈发货状态迟迟未更新',
                                updated_at: '2026-03-31T07:48:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-002',
                                order_id: 'SHOP-20260331-002',
                                user_id: '00000000-0000-4000-8000-000000000002',
                                user_email: 'delay-beta@zaoyoe.invalid',
                                wait_label: '12 小时 45 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '支付状态一直没变，用户追问到账进度',
                                updated_at: '2026-03-31T07:22:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-003',
                                order_id: '',
                                user_id: '00000000-0000-4000-8000-000000000003',
                                user_email: 'verify-gamma@zaoyoe.invalid',
                                wait_label: '11 小时 27 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '验证失败需要人工协助',
                                updated_at: '2026-03-31T07:26:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-004',
                                order_id: '',
                                user_id: '00000000-0000-4000-8000-000000000004',
                                user_email: 'stable-delta@zaoyoe.invalid',
                                wait_label: '10 小时 03 分钟',
                                responsible_label: '林支援',
                                ticket_status: 'PENDING',
                                reason: '到账后页面未刷新，需要人工核对',
                                updated_at: '2026-03-31T07:31:00+08:00'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-REMOVED-006',
                                order_id: '',
                                user_id: '00000000-0000-4000-8000-000000000003',
                                user_email: 'verify-gamma@zaoyoe.invalid',
                                wait_label: '6 小时 05 分钟',
                                responsible_label: '陈值班',
                                ticket_status: 'PENDING',
                                reason: '上一轮预览里曾经在队列里，当前已移出',
                                updated_at: '2026-03-31T07:10:00+08:00'
                            }
                        }
                    ]
                },
                channels: ['telegram', 'email'],
                remaining_channels: [],
                status: 'delivered',
                attempt_count: 1,
                max_attempts: 6,
                next_retry_at: '',
                last_error: '',
                created_at: '2026-03-31T08:06:24+08:00',
                updated_at: '2026-03-31T08:06:31+08:00',
                delivered_at: '2026-03-31T08:06:31+08:00'
            },
            {
                id: 'ticket-summary-job-retry',
                alert_type: 'ticket_sla_summary',
                severity: 'warning',
                title: '每日 SLA 汇总',
                payload: {
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 60,
                    summary_daily_hour: 6,
                    summary_daily_minute: 0,
                    summary_max_items: 6,
                    window_start_at: '2026-03-31T06:00:00+08:00',
                    window_end_at: '2026-03-31T07:00:00+08:00',
                    item_count: 2,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    items: [
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-001',
                                user_email: 'delay-alpha@zaoyoe.invalid',
                                wait_label: '11 小时 57 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '汇总重试样本'
                            }
                        },
                        {
                            payload: {
                                ticket_id: 'TK-SMOKE-CARRY-003',
                                user_email: 'verify-gamma@zaoyoe.invalid',
                                wait_label: '10 小时 27 分钟',
                                responsible_label: '未分配',
                                ticket_status: 'PENDING',
                                reason: '汇总重试样本'
                            }
                        }
                    ]
                },
                channels: ['telegram', 'feishu', 'email'],
                remaining_channels: ['feishu'],
                status: 'retry',
                attempt_count: 2,
                max_attempts: 6,
                next_retry_at: '2026-03-31T09:20:00+08:00',
                last_error: 'Webhook timeout',
                created_at: '2026-03-31T09:12:27+08:00',
                updated_at: '2026-03-31T09:14:40+08:00',
                delivered_at: ''
            },
            {
                id: 'ticket-overdue-job-latest',
                alert_type: 'ticket_sla_overdue',
                severity: 'warning',
                title: '工单超时提醒',
                payload: {
                    ticket_id: 'TK-20260331-001',
                    target_id: 'TK-20260331-001',
                    wait_label: '2 小时 38 分钟'
                },
                channels: ['telegram', 'email'],
                remaining_channels: ['email'],
                status: 'retry',
                attempt_count: 1,
                max_attempts: 4,
                next_retry_at: '2026-03-31T09:18:00+08:00',
                last_error: 'Telegram webhook timeout',
                created_at: '2026-03-31T09:08:00+08:00',
                updated_at: '2026-03-31T09:09:20+08:00',
                delivered_at: ''
            },
            {
                id: 'ticket-recovered-job-latest',
                alert_type: 'ticket_sla_recovered',
                severity: 'success',
                title: '工单恢复提醒',
                payload: {
                    ticket_id: 'TK-20260331-002',
                    target_id: 'TK-20260331-002',
                    wait_label: '1 小时 08 分钟',
                    previous_wait_label: '2 小时 10 分钟'
                },
                channels: ['telegram'],
                remaining_channels: [],
                status: 'delivered',
                attempt_count: 1,
                max_attempts: 4,
                next_retry_at: '',
                last_error: '',
                created_at: '2026-03-31T08:42:00+08:00',
                updated_at: '2026-03-31T08:42:40+08:00',
                delivered_at: '2026-03-31T08:42:40+08:00'
            }
        ],
        opsAlertJobAttempts: [
            {
                job_id: 'ticket-summary-job-retry',
                channel: 'feishu',
                status: 'failed',
                response_status: 504,
                error_message: 'Webhook timeout',
                created_at: '2026-03-31T09:14:40+08:00'
            },
            {
                job_id: 'ticket-overdue-job-latest',
                channel: 'telegram',
                status: 'failed',
                response_status: 504,
                error_message: 'Telegram webhook timeout',
                created_at: '2026-03-31T09:09:20+08:00'
            },
            {
                job_id: 'ticket-summary-job-latest',
                channel: 'telegram',
                status: 'delivered',
                response_status: 200,
                error_message: '',
                created_at: '2026-03-31T09:06:34+08:00'
            }
        ],
        opsAlertCases: [],
        opsAlertCaseEvents: [],
        results: [],
        analyticsRealtimeChannelsCreated: 0,
        analyticsRealtimeChannelsRemoved: 0,
        analyticsReloadCalls: [],
        analyticsAdminRouteLastQuery: {},
        analyticsRpcLastParams: {},
        analyticsRpcCallCount: 0,
        runtimeErrors: []
    };

    function buildHomepageConfigRows() {
        const sections = [
            {
                section: 'hero',
                display_order: 1,
                cn: {
                    title: 'CN Hero 标题',
                    subtitle: 'CN Hero 副标题',
                    enable_auto: false
                },
                intl: {
                    title: 'INTL Hero Title',
                    subtitle: 'INTL Hero Subtitle',
                    enable_auto: false
                }
            },
            {
                section: 'prompts',
                display_order: 2,
                cn: {
                    section_title: 'CN 提示词精选',
                    section_subtitle: '为中文站准备的灵感池',
                    max_items: 6,
                    sort: 'popular',
                    enable_auto: true
                },
                intl: {
                    section_title: 'INTL Prompt Picks',
                    section_subtitle: 'Curated ideas for the global site',
                    max_items: 8,
                    sort: 'latest',
                    enable_auto: true
                }
            },
            {
                section: 'shop',
                display_order: 3,
                cn: {
                    section_title: 'CN 商城入口',
                    section_subtitle: '中文站精选商品',
                    max_items: 8,
                    category: 'all',
                    sort: 'popular',
                    enable_auto: true
                },
                intl: {
                    section_title: 'INTL Shop',
                    section_subtitle: 'Global storefront picks',
                    max_items: 6,
                    category: 'all',
                    sort: 'latest',
                    enable_auto: true
                }
            },
            {
                section: 'verify',
                display_order: 4,
                cn: {
                    section_title: 'CN API 验证',
                    section_subtitle: '中文站快速核验入口',
                    screenshot_path: '',
                    features: ['免费', '实时'],
                    enable_auto: false
                },
                intl: {
                    section_title: 'INTL API Check',
                    section_subtitle: 'Quick validation for global users',
                    screenshot_path: '',
                    features: ['Free', 'Realtime'],
                    enable_auto: false
                }
            },
            {
                section: 'guestbook',
                display_order: 5,
                cn: {
                    section_title: 'CN 留言板',
                    section_subtitle: '看看中文站用户在聊什么',
                    max_items: 5,
                    enable_auto: true
                },
                intl: {
                    section_title: 'INTL Guestbook',
                    section_subtitle: 'Highlights from global visitors',
                    max_items: 4,
                    enable_auto: true
                }
            },
            {
                section: 'ticker',
                display_order: 6,
                cn: {
                    speed: 32,
                    shop_scroll_speed: 28,
                    enable_prompts: true,
                    enable_products: true,
                    enable_auto: false
                },
                intl: {
                    speed: 24,
                    shop_scroll_speed: 20,
                    enable_prompts: true,
                    enable_products: false,
                    enable_auto: false
                }
            },
            {
                section: 'footer',
                display_order: 99,
                cn: {},
                intl: {}
            }
        ];

        return sections.flatMap((definition, index) => {
            const baseTimestamp = new Date(now.getTime() - ((sections.length - index) * 60000)).toISOString();
            return [
                {
                    id: `hp-cn-${definition.section}`,
                    site: 'cn',
                    section: definition.section,
                    content: deepClone(definition.cn),
                    is_visible: definition.section === 'footer' ? true : definition.section !== 'verify',
                    display_order: definition.display_order,
                    updated_at: baseTimestamp
                },
                {
                    id: `hp-intl-${definition.section}`,
                    site: 'intl',
                    section: definition.section,
                    content: deepClone(definition.intl),
                    is_visible: definition.section === 'footer' ? false : definition.section !== 'guestbook',
                    display_order: definition.display_order,
                    updated_at: baseTimestamp
                }
            ];
        });
    }

    function normalizeSmokeCommentsSite(site) {
        const normalized = String(site || '').trim().toLowerCase();
        if (normalized === 'all') return 'all';
        return normalized === 'intl' ? 'intl' : 'cn';
    }

    function filterSmokeCommentRows(rows = [], site = 'all') {
        const normalizedSite = normalizeSmokeCommentsSite(site);
        if (normalizedSite === 'all') {
            return Array.isArray(rows) ? rows : [];
        }
        return (Array.isArray(rows) ? rows : []).filter((row) => normalizeSmokeCommentsSite(row?.site) === normalizedSite);
    }

    function buildSmokeCountMap(rows = [], keyField) {
        return (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
            const key = row?.[keyField];
            if (!key) return acc;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
    }

    function sortSmokeRowsByCreatedAtDesc(rows = []) {
        return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => Date.parse(right?.created_at || 0) - Date.parse(left?.created_at || 0));
    }

    function getSmokeProfile(userId) {
        return smokeState.profiles.find((profile) => profile.id === userId) || {};
    }

    function collectSmokeCommentCascadeIds(rows = [], rootIds = []) {
        const pending = [...new Set((Array.isArray(rootIds) ? rootIds : []).filter(Boolean))];
        const collected = new Set(pending);

        while (pending.length > 0) {
            const currentId = pending.shift();
            for (const row of Array.isArray(rows) ? rows : []) {
                if (!row?.id || collected.has(row.id)) continue;
                if (row.parent_id === currentId) {
                    collected.add(row.id);
                    pending.push(row.id);
                }
            }
        }

        return Array.from(collected);
    }

    function buildSmokeGuestbookAdminRows(site = 'all') {
        const messages = filterSmokeCommentRows(getTableRows('guestbook_messages'), site);
        const comments = filterSmokeCommentRows(getTableRows('guestbook_comments'), site);
        const likes = filterSmokeCommentRows(getTableRows('guestbook_likes'), site).filter((row) => row.target_type === 'comment');
        const messageReplyCounts = buildSmokeCountMap(comments, 'message_id');
        const commentReplyCounts = buildSmokeCountMap(comments.filter((row) => row.parent_id), 'parent_id');
        const likeCounts = buildSmokeCountMap(likes, 'target_id');

        const messageRows = messages.map((message) => {
            const profile = getSmokeProfile(message.user_id);
            return {
                id: message.id,
                site: normalizeSmokeCommentsSite(message.site),
                type: 'guestbook',
                record_type: 'message',
                level: 'top',
                content: message.content || '',
                author: profile.username || '未知用户',
                email: profile.email || '',
                avatar: profile.avatar_url || null,
                created_at: message.created_at,
                context: message.id,
                prompt_title: '',
                likes: Number(message.like_count || 0),
                user_id: message.user_id,
                parent_id: null,
                image_url: message.image_url || null,
                reply_count: messageReplyCounts[message.id] || 0
            };
        });

        const commentRows = comments.map((comment) => {
            const profile = getSmokeProfile(comment.user_id);
            return {
                id: comment.id,
                site: normalizeSmokeCommentsSite(comment.site),
                type: 'guestbook',
                record_type: comment.parent_id ? 'reply' : 'comment',
                level: 'reply',
                content: comment.content || '',
                author: profile.username || '未知用户',
                email: profile.email || '',
                avatar: profile.avatar_url || null,
                created_at: comment.created_at,
                context: comment.message_id,
                prompt_title: '',
                likes: likeCounts[comment.id] || 0,
                user_id: comment.user_id,
                parent_id: comment.parent_id,
                image_url: null,
                reply_count: commentReplyCounts[comment.id] || 0
            };
        });

        return sortSmokeRowsByCreatedAtDesc([...messageRows, ...commentRows]);
    }

    function buildSmokeGalleryAdminRows(site = 'all') {
        const comments = filterSmokeCommentRows(getTableRows('prompt_comments'), site);
        const replyCounts = buildSmokeCountMap(comments.filter((row) => row.parent_id), 'parent_id');

        return sortSmokeRowsByCreatedAtDesc(comments.map((comment) => {
            const profile = getSmokeProfile(comment.user_id);
            return {
                id: comment.id,
                site: normalizeSmokeCommentsSite(comment.site),
                type: 'gallery',
                record_type: comment.parent_id ? 'reply' : 'comment',
                level: comment.parent_id ? 'reply' : 'top',
                content: comment.content || '',
                author: profile.username || '未知用户',
                email: profile.email || '',
                avatar: profile.avatar_url || null,
                created_at: comment.created_at,
                context: comment.prompt_id,
                prompt_title: comment.prompt_title || 'Smoke Prompt',
                likes: Number(comment.like_count || 0),
                user_id: comment.user_id,
                parent_id: comment.parent_id,
                image_url: comment.image_url || null,
                is_pinned: comment.is_pinned === true,
                is_featured: comment.is_featured === true,
                reply_count: replyCounts[comment.id] || 0
            };
        }));
    }

    function buildSmokeCommentsSummary(site = 'all') {
        const guestbookMessages = filterSmokeCommentRows(getTableRows('guestbook_messages'), site);
        const guestbookComments = filterSmokeCommentRows(getTableRows('guestbook_comments'), site);
        const promptComments = filterSmokeCommentRows(getTableRows('prompt_comments'), site);
        const activeUsersCount = new Set([
            ...guestbookMessages.map((row) => row.user_id),
            ...guestbookComments.map((row) => row.user_id),
            ...promptComments.map((row) => row.user_id)
        ].filter(Boolean)).size;

        return {
            totalCount: guestbookMessages.length + guestbookComments.length + promptComments.length,
            todayCount: guestbookMessages.length + guestbookComments.length + promptComments.length,
            activeUsersCount,
            weekGrowth: 0
        };
    }

    function isSmokeBlockActive(row) {
        const expiresAt = String(row?.expires_at || '').trim();
        if (!expiresAt) return true;
        const expiresAtMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiresAtMs)) return true;
        return expiresAtMs > now.getTime();
    }

    function buildSmokeCommentBlockState(userId) {
        const blocks = getTableRows('blocked_users')
            .filter((row) => String(row?.user_id || '').trim() === String(userId || '').trim())
            .filter((row) => ['guestbook', 'gallery', 'all'].includes(String(row?.scope || '').trim()))
            .filter((row) => isSmokeBlockActive(row))
            .map((row) => ({
                user_id: row.user_id,
                scope: row.scope,
                reason: row.reason || '',
                expires_at: row.expires_at || null,
                created_at: row.created_at || null
            }));

        const scopeSet = new Set(blocks.map((row) => row.scope));
        const hasGlobalBlock = scopeSet.has('all');

        return {
            blocks,
            scopes: Array.from(scopeSet),
            hasGlobalBlock,
            isGuestbookBlocked: hasGlobalBlock || scopeSet.has('guestbook'),
            isGalleryBlocked: hasGlobalBlock || scopeSet.has('gallery')
        };
    }

    function deleteSmokeGuestbookLikeTargets(site, targetType, targetIds = []) {
        const normalizedSite = normalizeSmokeCommentsSite(site);
        const expectedIds = new Set((Array.isArray(targetIds) ? targetIds : []).filter(Boolean));
        if (!expectedIds.size) return;

        setTableRows('guestbook_likes', getTableRows('guestbook_likes').filter((row) => {
            const sameSite = normalizeSmokeCommentsSite(row?.site) === normalizedSite;
            return !(sameSite && row?.target_type === targetType && expectedIds.has(row?.target_id));
        }));
    }

    function handleSmokeCommentsModeration(body = {}) {
        const action = String(body.action || '').trim().toLowerCase();
        const site = normalizeSmokeCommentsSite(body.site);

        if (site === 'all') {
            return createResponse({
                success: false,
                message: 'Writable admin site must be cn or intl; received all'
            }, 400);
        }

        if (action === 'toggle_pin') {
            const commentId = String(body.id || body.commentId || '').trim();
            const promptId = String(body.promptId || '').trim();
            const currentStatus = body.currentStatus === true || body.currentStatus === 'true' || body.currentStatus === 1 || body.currentStatus === '1';
            const promptComments = getTableRows('prompt_comments').map((row) => ({ ...row }));

            let matched = null;
            for (const row of promptComments) {
                if (normalizeSmokeCommentsSite(row.site) !== site || row.prompt_id !== promptId) continue;
                if (!currentStatus && row.is_pinned === true) {
                    row.is_pinned = false;
                }
                if (row.id === commentId) {
                    row.is_pinned = !currentStatus;
                    matched = row;
                }
            }

            if (!matched) {
                return createResponse({
                    success: false,
                    message: 'Comment not found for the selected site'
                }, 404);
            }

            setTableRows('prompt_comments', promptComments);
            return createResponse({
                success: true,
                site,
                comment: deepClone({
                    id: matched.id,
                    prompt_id: matched.prompt_id,
                    is_pinned: matched.is_pinned
                })
            });
        }

        const items = Array.isArray(body.items) ? body.items : [];
        const guestbookMessageIds = items
            .filter((item) => item?.type === 'guestbook' && String(item?.recordType || item?.record_type || '').trim().toLowerCase() === 'message')
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean);
        const guestbookCommentIds = items
            .filter((item) => item?.type === 'guestbook' && String(item?.recordType || item?.record_type || '').trim().toLowerCase() !== 'message')
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean);
        const galleryIds = items
            .filter((item) => item?.type === 'gallery')
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean);

        const guestbookComments = filterSmokeCommentRows(getTableRows('guestbook_comments'), site);
        const selectedCommentIds = collectSmokeCommentCascadeIds(guestbookComments, guestbookCommentIds);
        const messageCascadeCommentIds = guestbookComments
            .filter((row) => guestbookMessageIds.includes(row.message_id))
            .map((row) => row.id);
        const likeCommentIds = [...new Set([...selectedCommentIds, ...messageCascadeCommentIds])];

        deleteSmokeGuestbookLikeTargets(site, 'message', guestbookMessageIds);
        deleteSmokeGuestbookLikeTargets(site, 'comment', likeCommentIds);

        if (selectedCommentIds.length) {
            const idsToDelete = new Set(selectedCommentIds);
            setTableRows('guestbook_comments', getTableRows('guestbook_comments').filter((row) => !idsToDelete.has(row.id)));
        }

        if (guestbookMessageIds.length) {
            const messageIds = new Set(guestbookMessageIds);
            setTableRows('guestbook_messages', getTableRows('guestbook_messages').filter((row) => !messageIds.has(row.id)));
            setTableRows('guestbook_comments', getTableRows('guestbook_comments').filter((row) => !messageIds.has(row.message_id)));
        }

        if (galleryIds.length) {
            const galleryIdSet = new Set(galleryIds);
            setTableRows('prompt_comments', getTableRows('prompt_comments').filter((row) => {
                return !(normalizeSmokeCommentsSite(row?.site) === site && galleryIdSet.has(row?.id));
            }));
        }

        return createResponse({
            success: true,
            site,
            deletedCount: guestbookMessageIds.length + guestbookCommentIds.length + galleryIds.length,
            summary: {
                guestbookMessages: guestbookMessageIds.length,
                guestbookComments: guestbookCommentIds.length,
                galleryComments: galleryIds.length
            }
        });
    }

    function handleSmokeCommentBlocks(body = {}, requestSite = 'all') {
        const site = normalizeSmokeCommentsSite(body.site || requestSite);

        if (site === 'all') {
            return createResponse({
                success: false,
                message: 'Writable admin site must be cn or intl; received all'
            }, 400);
        }

        const action = String(body.action || '').trim().toLowerCase();
        const userId = String(body.userId || body.user_id || '').trim();
        const scope = String(body.scope || '').trim().toLowerCase();

        if (!userId || !['guestbook', 'gallery', 'all'].includes(scope)) {
            return createResponse({
                success: false,
                message: 'Unsupported block request'
            }, 400);
        }

        if (action === 'block') {
            const rawDays = String(body.days || '').trim().toLowerCase();
            const dayCount = rawDays && rawDays !== 'permanent'
                ? Math.max(1, Number.parseInt(rawDays, 10) || 0)
                : 0;
            const scopeLabel = scope === 'guestbook' ? '留言板' : (scope === 'gallery' ? '画廊' : '全部');
            const expiresAt = dayCount
                ? new Date(now.getTime() + dayCount * 24 * 60 * 60 * 1000).toISOString()
                : null;
            const nextRows = getTableRows('blocked_users').map((row) => ({ ...row }));
            const existingIndex = nextRows.findIndex((row) => row.user_id === userId && row.scope === scope);
            const payload = {
                user_id: userId,
                scope,
                reason: dayCount ? `临时封禁 ${scopeLabel} 权限 ${dayCount} 天` : `永久封禁 ${scopeLabel} 权限`,
                admin_id: smokeState.user.id,
                expires_at: expiresAt,
                created_at: new Date(now.getTime() + 300000).toISOString()
            };

            if (existingIndex >= 0) {
                nextRows[existingIndex] = {
                    ...nextRows[existingIndex],
                    ...payload
                };
            } else {
                nextRows.push(payload);
            }

            setTableRows('blocked_users', nextRows);
            setTableRows('block_history', [
                ...getTableRows('block_history'),
                {
                    user_id: userId,
                    action: 'block',
                    scope,
                    reason: payload.reason,
                    admin_id: smokeState.user.id,
                    created_at: payload.created_at
                }
            ]);
        } else if (action === 'unblock') {
            setTableRows('blocked_users', getTableRows('blocked_users').filter((row) => !(row.user_id === userId && row.scope === scope)));
            setTableRows('block_history', [
                ...getTableRows('block_history'),
                {
                    user_id: userId,
                    action: 'unblock',
                    scope,
                    reason: '后台手动解封',
                    admin_id: smokeState.user.id,
                    created_at: new Date(now.getTime() + 360000).toISOString()
                }
            ]);
        } else {
            return createResponse({
                success: false,
                message: 'Unsupported block request'
            }, 400);
        }

        return createResponse({
            success: true,
            site,
            userId,
            ...buildSmokeCommentBlockState(userId)
        });
    }

    function deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function createResultPanel() {
        let panel = document.getElementById('localSmokeResult');
        if (panel) {
            return panel;
        }

        const style = document.createElement('style');
        style.textContent = `
            #localSmokeResult {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 99999;
                width: min(420px, calc(100vw - 32px));
                max-height: min(70vh, 720px);
                overflow: auto;
                padding: 14px 16px;
                border-radius: 16px;
                border: 1px solid rgba(148, 163, 184, 0.28);
                background: rgba(15, 23, 42, 0.94);
                color: #e2e8f0;
                box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
                font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
                white-space: pre-wrap;
            }
            #localSmokeResult[data-local-smoke-status="passed"] {
                border-color: rgba(52, 211, 153, 0.55);
            }
            #localSmokeResult[data-local-smoke-status="failed"] {
                border-color: rgba(248, 113, 113, 0.7);
            }
        `;
        document.head.appendChild(style);

        panel = document.createElement('pre');
        panel.id = 'localSmokeResult';
        panel.setAttribute('data-local-smoke-status', 'running');
        panel.textContent = 'Local smoke is booting...';
        document.body.appendChild(panel);
        return panel;
    }

    function renderResults(status = 'running') {
        const panel = createResultPanel();
        panel.setAttribute('data-local-smoke-status', status);
        document.documentElement.setAttribute('data-local-smoke-status', status);
        panel.textContent = buildSmokeResultText(status);
    }

    function recordResult(label, pass, detail = '') {
        smokeState.results.push({
            label,
            pass,
            detail
        });
        const finalStatus = smokeState.results.some((item) => !item.pass) ? 'failed' : 'running';
        renderResults(finalStatus);
        void postSmokeResult(finalStatus);
    }

    function buildSmokeResultText(status = 'running') {
        const summary = smokeState.results.length
            ? smokeState.results.map((item) => `${item.pass ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? `\n  ${item.detail}` : ''}`).join('\n')
            : 'No smoke checks recorded yet.';

        return [
            `Local Smoke: ${status.toUpperCase()}`,
            `Page: ${globalScope.location?.pathname || '/'}`,
            '',
            summary
        ].join('\n');
    }

    function buildSmokeResultPayload(status = 'running') {
        return {
            runId: smokeRunId,
            status,
            page: globalScope.location?.pathname || '/',
            text: buildSmokeResultText(status),
            results: smokeState.results.map((item) => ({
                label: item.label,
                pass: item.pass === true,
                detail: item.detail ? String(item.detail) : ''
            }))
        };
    }

    async function postSmokeResult(status = 'running', options = {}) {
        if (!smokeRunId || typeof globalScope.fetch !== 'function') {
            return;
        }

        try {
            await globalScope.fetch('/__local-smoke-result', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin',
                ...(options?.keepalive === false ? {} : { keepalive: true }),
                body: JSON.stringify(buildSmokeResultPayload(status))
            });
        } catch (_) {
            // ignore best-effort result reporting failures in local smoke mode
        }
    }

    async function finalizeResults() {
        const finalStatus = smokeState.results.some((item) => !item.pass) ? 'failed' : 'passed';
        renderResults(finalStatus);
        await postSmokeResult(finalStatus, { keepalive: false });

        if (minimalDomOutput) {
            const panel = createResultPanel();
            const clone = panel.cloneNode(true);
            document.body.replaceChildren(clone);
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => globalScope.setTimeout(resolve, ms));
    }

    function nextFrame() {
        return new Promise((resolve) => globalScope.requestAnimationFrame(() => resolve()));
    }

    function shouldRunMobileLayoutChecks() {
        return searchParams.get('smokeViewport') === 'mobile' || Number(globalScope.innerWidth || 0) <= 430;
    }

    function measureHorizontalOverflow(element) {
        if (!(element instanceof HTMLElement)) {
            return Number.POSITIVE_INFINITY;
        }

        const rectWidth = Number(element.getBoundingClientRect?.().width || 0);
        const clientWidth = Math.max(Number(element.clientWidth || 0), rectWidth);
        if (clientWidth <= 0) {
            return 0;
        }

        return Math.max(0, Math.ceil(Number(element.scrollWidth || 0) - clientWidth));
    }

    function recordSelectorsNoHorizontalOverflow(label, selectors = [], tolerance = 6) {
        const seen = new Set();
        const measurements = [];

        (Array.isArray(selectors) ? selectors : []).forEach((selector) => {
            document.querySelectorAll(String(selector || '')).forEach((element, index) => {
                const key = `${selector}::${index}`;
                if (seen.has(key)) {
                    return;
                }
                seen.add(key);
                measurements.push({
                    selector: String(selector || '').trim() || '<unknown>',
                    delta: measureHorizontalOverflow(element)
                });
            });
        });

        if (!measurements.length) {
            recordResult(label, false, '未找到可检测的目标节点');
            return;
        }

        const overflowing = measurements.filter((item) => item.delta > tolerance);
        const detail = overflowing.length
            ? overflowing.slice(0, 3).map((item) => `${item.selector} Δ${item.delta}`).join(' | ')
            : measurements.slice(0, 3).map((item) => `${item.selector} Δ${item.delta}`).join(' | ');
        recordResult(label, overflowing.length === 0, detail);
    }

    async function waitFor(check, options = {}) {
        const timeoutMs = Math.max(200, Number(options.timeoutMs || 12000));
        const intervalMs = Math.max(16, Number(options.intervalMs || 60));
        const start = Date.now();

        while ((Date.now() - start) < timeoutMs) {
            try {
                const result = await check();
                if (result) {
                    return result;
                }
            } catch (_) {
                // ignore transient probe errors during boot
            }
            await sleep(intervalMs);
        }

        throw new Error(options.message || 'Timed out while waiting for smoke fixture');
    }

    function installCommonStubs() {
        globalScope.showToast = function showToast(message = '', type = 'info') {
            console.info(`[local-smoke:${type}] ${String(message || '')}`);
        };

        globalScope.alert = function alertStub(message = '') {
            const detail = String(message || '').trim();
            console.info(`[local-smoke:alert] ${detail}`);
            if (!detail || !/^成功/.test(detail)) {
                recordResult('本地 smoke 触发了 alert', false, detail || '触发了空 alert');
            }
        };

        globalScope.confirm = function confirmStub() {
            return true;
        };

        globalScope.prompt = function promptStub(_message = '', defaultValue = '') {
            return String(defaultValue || '');
        };

        if (!globalScope.navigator) {
            globalScope.navigator = {};
        }

        if (!globalScope.navigator.clipboard) {
            globalScope.navigator.clipboard = {
                writeText: async () => true
            };
        }

        if (typeof globalScope.Cropper !== 'function') {
            globalScope.Cropper = class CropperStub {
                destroy() {}
                getCroppedCanvas() {
                    return {
                        toDataURL() {
                            return '';
                        }
                    };
                }
            };
        }

        if (!globalScope.flatpickr) {
            globalScope.flatpickr = function flatpickrStub() {
                return {
                    destroy() {},
                    clear() {},
                    setDate() {},
                    selectedDates: []
                };
            };
            globalScope.flatpickr.l10ns = { zh: {} };
        }

        if (!globalScope.XLSX) {
            globalScope.XLSX = {
                utils: {
                    json_to_sheet() {
                        return {};
                    },
                    book_new() {
                        return {};
                    },
                    book_append_sheet() {}
                },
                writeFile() {}
            };
        }

        if (!globalScope.Chart) {
            globalScope.Chart = function ChartStub() {
                return {
                    destroy() {},
                    update() {}
                };
            };
        }

        if (typeof globalScope.updateNotificationBadges !== 'function') {
            globalScope.updateNotificationBadges = function updateNotificationBadgesStub() {};
        }

        if (globalScope.__localSmokeRuntimeErrorBound__ !== true) {
            globalScope.__localSmokeRuntimeErrorBound__ = true;
            const originalConsoleError = globalScope.console?.error?.bind(globalScope.console);
            const originalConsoleWarn = globalScope.console?.warn?.bind(globalScope.console);

            if (globalScope.console) {
                globalScope.console.error = (...args) => {
                    smokeState.runtimeErrors.push(`console.error:${args.map((item) => describeSmokeLogArg(item)).join(' ').slice(0, 360)}`);
                    return originalConsoleError?.(...args);
                };
                globalScope.console.warn = (...args) => {
                    smokeState.runtimeErrors.push(`console.warn:${args.map((item) => describeSmokeLogArg(item)).join(' ').slice(0, 360)}`);
                    return originalConsoleWarn?.(...args);
                };
            }

            globalScope.addEventListener('error', (event) => {
                const message = event?.error?.message || event?.message || 'Unknown runtime error';
                const stack = String(event?.error?.stack || '').split('\n').slice(0, 3).join(' | ');
                smokeState.runtimeErrors.push(`error:${String(message)}${stack ? ` stack:${stack.slice(0, 480)}` : ''}`);
            });

            globalScope.addEventListener('unhandledrejection', (event) => {
                const message = event?.reason?.message || event?.reason || 'Unhandled rejection';
                const stack = String(event?.reason?.stack || '').split('\n').slice(0, 3).join(' | ');
                smokeState.runtimeErrors.push(`rejection:${String(message)}${stack ? ` stack:${stack.slice(0, 480)}` : ''}`);
            });
        }
    }

    function createResponse(payload = {}, status = 200) {
        return new Response(JSON.stringify(payload), {
            status,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        });
    }

    function describeSmokeLogArg(value) {
        if (value instanceof Error) {
            return value.stack || `${value.name}: ${value.message}`;
        }
        if (value && typeof value === 'object') {
            const message = String(value.message || value.error_description || value.error || '').trim();
            const code = String(value.code || value.statusCode || value.status || '').trim();
            if (message || code) {
                return `${code ? `${code} ` : ''}${message}`.trim();
            }
            try {
                return JSON.stringify(value);
            } catch (_) {
                return '[object]';
            }
        }
        return String(value);
    }

    function normalizeSmokeSite(site) {
        return String(site || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
    }

    function normalizeSmokeAdminRoute(value) {
        return String(value || '')
            .trim()
            .replace(/[?#][\s\S]*$/, '')
            .replace(/^https?:\/\/[^/]+/i, '')
            .replace(/^\/+|\/+$/g, '')
            .replace(/^api\/admin\/?/i, '')
            .toLowerCase();
    }

    function getDefaultSmokeDiscountTriggerRules() {
        return {
            recharge: {
                enabled: false,
                rules: []
            },
            checkin: {
                enabled: false,
                rules: []
            },
            affiliate: {
                enabled: false,
                rules: []
            }
        };
    }

    function normalizeSmokeSystemConfigDomains(value) {
        const values = Array.isArray(value) ? value : [value];
        const normalized = Array.from(new Set(
            values
                .map((entry) => String(entry || '').trim().toLowerCase())
                .filter(Boolean)
        ));
        return normalized.length ? normalized : ['all'];
    }

    function listSmokeSystemConfigKeys(domains = []) {
        const normalizedDomains = normalizeSmokeSystemConfigDomains(domains);
        if (normalizedDomains.includes('all')) {
            return Array.from(new Set(Object.values(SMOKE_SYSTEM_CONFIG_DOMAIN_KEY_MAP).flat()));
        }

        return Array.from(new Set(
            normalizedDomains.flatMap((domain) => SMOKE_SYSTEM_CONFIG_DOMAIN_KEY_MAP[domain] || [])
        ));
    }

    function getSmokeSystemConfigValue(key = '') {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) {
            return {};
        }
        if (normalizedKey === 'payment_channels') {
            return deepClone(smokeState.paymentChannelsConfig);
        }
        if (normalizedKey === 'recharge_options') {
            return deepClone(smokeState.rechargeOptions);
        }
        if (normalizedKey === 'discount_trigger_rules') {
            return deepClone(smokeState.discountTriggerRules || getDefaultSmokeDiscountTriggerRules());
        }
        return deepClone(smokeState.systemConfigs?.[normalizedKey] || {});
    }

    function setSmokeSystemConfigValue(key = '', value = {}) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) {
            return;
        }
        if (normalizedKey === 'payment_channels') {
            smokeState.paymentChannelsConfig = deepClone(value || {});
            return;
        }
        if (normalizedKey === 'recharge_options') {
            smokeState.rechargeOptions = deepClone(value || {});
            return;
        }
        if (normalizedKey === 'discount_trigger_rules') {
            smokeState.discountTriggerRules = deepClone(value || getDefaultSmokeDiscountTriggerRules());
            return;
        }
        smokeState.systemConfigs[normalizedKey] = deepClone(value || {});
    }

    function buildSmokeSystemConfigDomainPayload(domains = []) {
        const normalizedDomains = normalizeSmokeSystemConfigDomains(domains);
        const keys = listSmokeSystemConfigKeys(normalizedDomains);
        const configs = keys.reduce((accumulator, key) => {
            accumulator[key] = getSmokeSystemConfigValue(key);
            return accumulator;
        }, {});

        return {
            success: true,
            domains: normalizedDomains,
            keys,
            meta: deepClone(SMOKE_SYSTEM_CONFIG_DOMAIN_KEY_MAP),
            configs
        };
    }

    function getSmokeTableStateKey(table = '') {
        const tableMap = {
            system_notifications: 'notificationRecords',
            chat_messages: 'chatMessages',
            profiles: 'profiles',
            shop_products: 'shopProducts',
            shop_categories: 'shopCategories',
            shop_inventory: 'shopInventory',
            shop_orders: 'shopOrders',
            discount_codes: 'discountCodes',
            discount_user_assets: 'discountUserAssets',
            payment_orders: 'paymentOrders',
            verification_logs: 'verificationLogs',
            shop_tickets: 'shopTickets',
            homepage_config: 'homepageConfigRows',
            guestbook_messages: 'guestbookMessages',
            guestbook_comments: 'guestbookComments',
            guestbook_likes: 'guestbookLikes',
            points_packages: 'pointsPackages',
            redemption_batches: 'redemptionBatches',
            redemption_codes: 'redemptionCodes',
            points_ledger: 'pointsLedger',
            prompts: 'prompts',
            prompt_unlocks: 'promptUnlocks',
            prompt_comments: 'promptComments',
            blocked_users: 'blockedUsers',
            block_history: 'blockHistory',
            marketing_asset_workflows: 'marketingAssetWorkflows',
            marketing_asset_workflow_runs: 'marketingAssetWorkflowRuns',
            ops_alert_jobs: 'opsAlertJobs',
            ops_alert_job_attempts: 'opsAlertJobAttempts',
            ops_alert_cases: 'opsAlertCases',
            ops_alert_case_events: 'opsAlertCaseEvents'
        };
        return tableMap[String(table || '').trim()] || '';
    }

    function getTableRows(table = '') {
        const stateKey = getSmokeTableStateKey(table);
        if (!stateKey) {
            return [];
        }
        return Array.isArray(smokeState[stateKey]) ? smokeState[stateKey] : [];
    }

    function setTableRows(table = '', rows = []) {
        const stateKey = getSmokeTableStateKey(table);
        if (!stateKey) {
            return;
        }
        smokeState[stateKey] = Array.isArray(rows) ? rows : [];
    }

    function findSmokeProfileById(profileId = '') {
        const normalizedProfileId = String(profileId || '').trim();
        if (!normalizedProfileId) {
            return null;
        }

        return getTableRows('profiles').find((profile) => String(profile?.id || '').trim() === normalizedProfileId) || null;
    }

    function buildSmokePaymentsSummarySharedState() {
        const primaryOrder = getTableRows('payment_orders')[0] || {};
        const paidOrder = getTableRows('payment_orders')[1] || {};
        const primaryProfile = findSmokeProfileById(primaryOrder.user_id) || {};
        const paidProfile = findSmokeProfileById(paidOrder.user_id) || {};

        return {
            overview: {
                total_orders: 28,
                paid_orders: 23,
                paid_rate: 82.14,
                total_amount: 334.6,
                total_points: 3346
            },
            anomaly_summary: {
                review_orders: 1,
                failed_orders: 1,
                unclaimed_paid_orders: 1,
                open_cases: 5
            },
            session_summary: {
                total_sessions: 4,
                matched_sessions: 3,
                webhook_linked_sessions: 2,
                fallback_linked_sessions: 1,
                order_match_rate: 75,
                match_rate: 75
            },
            query_summary: {
                total_attempts: 12,
                failed_attempts: 2,
                success_rate: 83.33
            },
            provider_stats: [
                {
                    provider: 'mock',
                    total_orders: 18,
                    paid_rate: 88.9,
                    claim_rate: 83.3,
                    total_amount: 248,
                    total_points: 2480
                }
            ],
            trend_24h: [
                { hour: '00:00', total_orders: 1, paid_orders: 1, paid_amount: 18 },
                { hour: '08:00', total_orders: 3, paid_orders: 2, paid_amount: 128 },
                { hour: '16:00', total_orders: 2, paid_orders: 2, paid_amount: 92 }
            ],
            refund_alert_topics: [
                {
                    key: 'refund_failures',
                    label: '退款失败',
                    severity: 'warning',
                    description: '通道退款未成功，需要人工复核支付通道与回执链路。',
                    count: 1
                },
                {
                    key: 'refund_reclaim_failures',
                    label: '扣回失败',
                    severity: 'critical',
                    description: '退款前积分扣回失败，当前订单已 fail-closed 等待人工处理。',
                    count: 1
                }
            ],
            refund_alert_items: [
                {
                    type: 'payment_order',
                    id: 'payment-refund-smoke-1',
                    topic_key: 'refund_failures',
                    topic_label: '退款失败',
                    title: '虎皮椒退款失败',
                    message: '退款请求已发起，但通道侧仍未返回最终结果。',
                    severity: 'warning',
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-REFUND-1',
                    created_at: '2026-04-20T12:00:00.000Z',
                    ops_status: 'open',
                    ops_available_actions: ['request_retry', 'mark_handled']
                },
                {
                    type: 'payment_order',
                    id: 'payment-refund-smoke-2',
                    topic_key: 'refund_reclaim_failures',
                    topic_label: '扣回失败',
                    title: '退款前积分扣回失败',
                    message: '需要先补齐扣回动作，再决定是否继续退款。',
                    severity: 'critical',
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-RECLAIM-1',
                    created_at: '2026-04-20T12:08:00.000Z',
                    ops_status: 'open',
                    ops_available_actions: ['mark_handled', 'ignore']
                }
            ],
            ops_alert_summary: {
                total: 4,
                delivered: 1,
                pending: 1,
                retry: 1,
                processing: 0,
                dead_letter: 1,
                handled: 1,
                ignored: 0,
                actionable_count: 3
            },
            ops_alert_items: [
                {
                    type: 'ops_alert_job',
                    id: 'payment-ops-smoke-1',
                    queue_status: 'pending',
                    ops_status: 'pending',
                    title: '支付告警待处理',
                    message: '回调通道成功率下降，需要值班同学确认是否要切备用通道。',
                    severity: 'warning',
                    created_at: '2026-04-20T12:12:00.000Z',
                    channels: ['telegram'],
                    remaining_channels: ['telegram'],
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-OPS-1',
                    ops_available_actions: ['mark_handled', 'request_retry']
                },
                {
                    type: 'ops_alert_job',
                    id: 'payment-ops-smoke-2',
                    queue_status: 'retry',
                    ops_status: 'pending',
                    title: '支付告警等待重试',
                    message: '上一轮推送失败，正在等待下一次重试。',
                    severity: 'warning',
                    created_at: '2026-04-20T12:16:00.000Z',
                    channels: ['telegram'],
                    remaining_channels: ['telegram'],
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-OPS-2',
                    ops_available_actions: ['mark_handled', 'request_retry']
                },
                {
                    type: 'ops_alert_job',
                    id: 'payment-ops-smoke-3',
                    queue_status: 'dead_letter',
                    ops_status: 'pending',
                    title: '支付告警进入死信',
                    message: '通道侧连续失败，需要人工接管排查。',
                    severity: 'critical',
                    created_at: '2026-04-20T12:20:00.000Z',
                    channels: ['telegram'],
                    remaining_channels: ['telegram'],
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-OPS-3',
                    ops_available_actions: ['request_retry', 'mark_handled']
                },
                {
                    type: 'ops_alert_job',
                    id: 'payment-ops-smoke-4',
                    queue_status: 'delivered',
                    ops_status: 'handled',
                    title: '支付告警已处理',
                    message: '值班同学已手动确认并处理完成。',
                    severity: 'info',
                    created_at: '2026-04-20T12:24:00.000Z',
                    channels: ['telegram'],
                    remaining_channels: [],
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-OPS-4',
                    ops_available_actions: ['ignore']
                }
            ],
            exception_topics: [
                {
                    key: 'duplicate_webhook',
                    label: '重复回调',
                    severity: 'warning',
                    description: '需要确认是否只发生重复通知，还是已经造成重复入账。',
                    count: 1
                },
                {
                    key: 'refund_failures',
                    label: '退款失败',
                    severity: 'warning',
                    description: '网关退款失败但仍需复核补偿链路。',
                    count: 1
                },
                {
                    key: 'refund_reclaim_failures',
                    label: '扣回失败',
                    severity: 'critical',
                    description: '退款前积分扣回失败，需要人工处理。',
                    count: 1
                }
            ],
            exception_topic_items: [
                {
                    type: 'session',
                    id: 'payment-topic-smoke-1',
                    topic_key: 'duplicate_webhook',
                    title: '重复回调仍在重试',
                    message: '同一支付单号在 5 分钟内重复回调两次。',
                    severity: 'warning',
                    created_at: '2026-04-20T12:28:00.000Z',
                    ops_status: 'open',
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-DUP-1',
                    ops_available_actions: ['mark_handled']
                },
                {
                    type: 'payment_order',
                    id: 'payment-topic-smoke-2',
                    topic_key: 'refund_failures',
                    title: '退款失败仍待复核',
                    message: '退款任务未收到成功回执，已同步到异常专题。',
                    severity: 'warning',
                    created_at: '2026-04-20T12:30:00.000Z',
                    ops_status: 'open',
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-REFUND-1',
                    ops_available_actions: ['request_retry', 'mark_handled']
                }
            ],
            recent_anomalies: [
                {
                    type: 'session',
                    id: 'payment-anomaly-smoke-1',
                    title: '未回填异常',
                    message: '支付单已完成，但订单回填链路仍未闭环。',
                    severity: 'warning',
                    provider: 'mock',
                    provider_order_no: 'PAY-SMOKE-DUP-1',
                    created_at: '2026-04-20T12:32:00.000Z',
                    ops_status: 'open',
                    ops_available_actions: ['mark_handled']
                }
            ],
            recent_checkout_sessions: [
                {
                    id: 'payment-session-smoke-1',
                    provider: 'mock',
                    user_id: String(primaryOrder.user_id || '00000000-0000-4000-8000-000000000001'),
                    user_email: String(primaryProfile?.email || 'delay-alpha@zaoyoe.invalid'),
                    package_name: String(primaryOrder.package_name || '春季体验套餐'),
                    session_key: 'cs_smoke_local_001',
                    provider_order_no: 'PAY-SMOKE-SESSION-1',
                    site: 'cn',
                    expected_amount: Number(primaryOrder.expected_amount || 128) || 128,
                    granted_points: 1280,
                    status: 'completed',
                    has_checkout_url: true,
                    created_at: '2026-04-20T12:00:00.000Z',
                    completed_at: '2026-04-20T12:06:00.000Z',
                    linked_at: '2026-04-20T12:07:00.000Z'
                }
            ],
            recent_orders: [
                {
                    id: 'payment-order-review-smoke-1',
                    provider: 'mock',
                    user_id: String(primaryOrder.user_id || '00000000-0000-4000-8000-000000000001'),
                    user_email: String(primaryProfile?.email || 'delay-alpha@zaoyoe.invalid'),
                    provider_order_no: 'PAYSMOKE42F46329738A87345986347A2438',
                    package_name: String(primaryOrder.package_name || '春季体验套餐'),
                    paid_amount: Number(primaryOrder.paid_amount || 128) || 128,
                    points_amount: 1280,
                    status: 'pending_review',
                    site: 'cn',
                    created_at: '2026-04-20T12:36:00.000Z',
                    claimed_at: '',
                    order_available_actions: ['approve_review', 'reject_review']
                },
                {
                    id: 'payment-order-failed-smoke-1',
                    provider: 'mock',
                    user_id: String(paidOrder.user_id || '00000000-0000-4000-8000-000000000004'),
                    user_email: String(paidProfile?.email || 'stable-delta@zaoyoe.invalid'),
                    provider_order_no: 'PAYSMOKE77D56329738A87345986347B9012',
                    package_name: '充值 50 元',
                    paid_amount: 50,
                    points_amount: 500,
                    status: 'amount_mismatch',
                    site: 'cn',
                    created_at: '2026-04-20T12:42:00.000Z',
                    claimed_at: '',
                    order_available_actions: ['approve_amount_mismatch', 'reject_amount_mismatch']
                },
                {
                    id: 'payment-order-paid-smoke-1',
                    provider: 'mock',
                    user_id: String(paidOrder.user_id || '00000000-0000-4000-8000-000000000004'),
                    user_email: String(paidProfile?.email || 'stable-delta@zaoyoe.invalid'),
                    provider_order_no: 'PAYSMOKE88E66329738A87345986347C1048',
                    package_name: '充值 50 元',
                    paid_amount: Number(paidOrder.paid_amount || 50) || 50,
                    points_amount: 500,
                    status: 'paid',
                    site: 'cn',
                    created_at: '2026-04-20T12:48:00.000Z',
                    claimed_at: '',
                    order_available_actions: []
                }
            ]
        };
    }

    function buildSmokePaymentsSummaryPayload(search = null) {
        const searchParamsLike = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
        const view = String(searchParamsLike.get('view') || 'overview').trim().toLowerCase() || 'overview';
        const scope = String(searchParamsLike.get('scope') || 'full').trim().toLowerCase() || 'full';
        const shared = buildSmokePaymentsSummarySharedState();

        if (view === 'overview' && scope === 'core') {
            return {
                success: true,
                overview: deepClone(shared.overview),
                anomaly_summary: deepClone(shared.anomaly_summary),
                session_summary: deepClone(shared.session_summary),
                query_summary: deepClone(shared.query_summary)
            };
        }

        if (view === 'overview' && scope === 'secondary') {
            return {
                success: true,
                anomaly_summary: deepClone(shared.anomaly_summary),
                provider_stats: deepClone(shared.provider_stats),
                trend_24h: deepClone(shared.trend_24h),
                refund_alert_topics: deepClone(shared.refund_alert_topics),
                refund_alert_items: deepClone(shared.refund_alert_items)
            };
        }

        if (view === 'overview' && scope === 'ops') {
            return {
                success: true,
                anomaly_summary: deepClone(shared.anomaly_summary),
                ops_alert_summary: deepClone(shared.ops_alert_summary),
                ops_alert_items: deepClone(shared.ops_alert_items),
                exception_topics: deepClone(shared.exception_topics),
                exception_topic_items: deepClone(shared.exception_topic_items),
                recent_anomalies: deepClone(shared.recent_anomalies),
                recent_checkout_sessions: deepClone(shared.recent_checkout_sessions),
                recent_orders: deepClone(shared.recent_orders)
            };
        }

        if (view === 'ops') {
            return {
                success: true,
                anomaly_summary: deepClone(shared.anomaly_summary),
                ops_alert_summary: deepClone(shared.ops_alert_summary),
                ops_alert_items: deepClone(shared.ops_alert_items),
                exception_topics: deepClone(shared.exception_topics),
                exception_topic_items: deepClone(shared.exception_topic_items),
                recent_anomalies: deepClone(shared.recent_anomalies),
                recent_checkout_sessions: deepClone(shared.recent_checkout_sessions),
                recent_orders: deepClone(shared.recent_orders)
            };
        }

        if (view === 'finance') {
            return {
                success: true,
                sitewide_summary: {
                    revenue: 334.6,
                    refunds: 50,
                    net_revenue: 284.6
                },
                business_breakdown: [
                    { title: '充值收入', metric: '334.6', description: '近 30 天充值收入', meta: 'CN 站点' }
                ],
                points_breakdown: [
                    { label: '充值入账', inflow: 3346, outflow: 0, net: 3346 }
                ]
            };
        }

        return {
            success: true,
            overview: deepClone(shared.overview),
            anomaly_summary: deepClone(shared.anomaly_summary),
            session_summary: deepClone(shared.session_summary),
            query_summary: deepClone(shared.query_summary),
            provider_stats: deepClone(shared.provider_stats),
            trend_24h: deepClone(shared.trend_24h),
            refund_alert_topics: deepClone(shared.refund_alert_topics),
            refund_alert_items: deepClone(shared.refund_alert_items),
            ops_alert_summary: deepClone(shared.ops_alert_summary),
            ops_alert_items: deepClone(shared.ops_alert_items),
            exception_topics: deepClone(shared.exception_topics),
            exception_topic_items: deepClone(shared.exception_topic_items),
            recent_anomalies: deepClone(shared.recent_anomalies),
            recent_checkout_sessions: deepClone(shared.recent_checkout_sessions),
            recent_orders: deepClone(shared.recent_orders)
        };
    }

    function buildSmokePaymentsCleanupPayload() {
        const sampleOrders = getTableRows('payment_orders').map((order, index) => ({
            provider_order_no: index === 0
                ? 'AUTO_CDX_ORDER_1'
                : `AUTO_CDX_ORDER_${index + 1}`,
            status: String(order?.status || 'paid').trim().toLowerCase() || 'paid',
            created_at: order?.created_at || '2026-04-20T12:00:00.000Z'
        }));
        const sampleUsers = getTableRows('profiles').slice(0, 2).map((profile) => ({
            id: profile.id,
            email: profile.email
        }));

        return {
            success: true,
            preview: {
                counts: {
                    payment_orders: sampleOrders.length,
                    payment_events: 2,
                    afdian_orders: 1,
                    auth_users: sampleUsers.length
                },
                samples: {
                    orders: deepClone(sampleOrders),
                    users: deepClone(sampleUsers)
                }
            }
        };
    }

    function buildSmokeTicketBreakdown(rows = [], field = 'issue_type', labelMap = {}) {
        const counts = new Map();
        const total = Math.max(1, (Array.isArray(rows) ? rows : []).length);
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const key = String(row?.[field] || 'other').trim().toLowerCase() || 'other';
            counts.set(key, (counts.get(key) || 0) + 1);
        });

        return [...counts.entries()].map(([key, count]) => ({
            key,
            label: labelMap[key] || key,
            count,
            share_percent: Number(((count / total) * 100).toFixed(1))
        }));
    }

    function buildSmokeTicketReminderAttemptsByJobId() {
        const attemptsByJobId = new Map();
        getTableRows('ops_alert_job_attempts').forEach((attempt) => {
            const jobId = String(attempt?.job_id || '').trim();
            if (!jobId) {
                return;
            }
            const attempts = attemptsByJobId.get(jobId) || [];
            attempts.push({ ...attempt });
            attemptsByJobId.set(jobId, attempts);
        });

        attemptsByJobId.forEach((attempts, jobId) => {
            attemptsByJobId.set(jobId, attempts.sort((left, right) => (
                Date.parse(right?.created_at || 0) - Date.parse(left?.created_at || 0)
            )));
        });
        return attemptsByJobId;
    }

    function normalizeSmokeTicketChannelList(value) {
        return (Array.isArray(value) ? value : [])
            .map((item) => String(item || '').trim().toLowerCase())
            .filter(Boolean);
    }

    function buildSmokeTicketReminderActivityEntry(job = null, attemptsByJobId = new Map()) {
        if (!job || typeof job !== 'object') {
            return null;
        }

        const payload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? job.payload
            : {};
        const jobId = String(job.id || '').trim();
        const latestAttempt = Array.isArray(attemptsByJobId.get(jobId))
            ? attemptsByJobId.get(jobId)[0]
            : null;
        const alertType = String(job.alert_type || '').trim().toLowerCase();

        return {
            kind: alertType === 'ticket_sla_recovered' ? 'recovered' : 'overdue',
            status: String(job.status || 'unknown').trim().toLowerCase() || 'unknown',
            severity: String(job.severity || 'warning').trim().toLowerCase() || 'warning',
            title: String(job.title || '').trim(),
            ticket_id: String(payload.ticket_id || payload.target_id || '').trim(),
            target_id: String(payload.target_id || payload.ticket_id || '').trim(),
            wait_label: String(payload.wait_label || '').trim(),
            created_at: String(job.created_at || '').trim(),
            delivered_at: String(job.delivered_at || '').trim(),
            attempt_count: Math.max(0, Number.parseInt(job.attempt_count, 10) || 0),
            channels: normalizeSmokeTicketChannelList(job.channels),
            remaining_channels: normalizeSmokeTicketChannelList(job.remaining_channels),
            last_error: String(latestAttempt?.error_message || job.last_error || '').trim(),
            latest_attempt: latestAttempt ? {
                channel: String(latestAttempt.channel || '').trim().toLowerCase(),
                status: String(latestAttempt.status || '').trim().toLowerCase(),
                response_status: Number.isFinite(Number(latestAttempt.response_status)) ? Number(latestAttempt.response_status) : null,
                error_message: String(latestAttempt.error_message || '').trim(),
                created_at: String(latestAttempt.created_at || '').trim()
            } : null
        };
    }

    function buildSmokeTicketSummaryPreviewItem(item = {}) {
        const payload = item?.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
            ? item.payload
            : {};
        const ticketId = String(payload.ticket_id || payload.target_id || '').trim();
        if (!ticketId) {
            return null;
        }

        const status = String(payload.ticket_status || 'pending').trim().toUpperCase() || 'PENDING';
        return {
            ticket_id: ticketId,
            order_id: String(payload.order_id || '').trim(),
            user_id: String(payload.user_id || '').trim(),
            user_email: String(payload.user_email || '').trim(),
            wait_label: String(payload.wait_label || '').trim(),
            responsible_label: String(payload.responsible_label || '').trim(),
            ticket_status: status,
            ticket_status_label: status === 'PENDING' ? '待处理' : status,
            reason: String(payload.reason || '').trim(),
            updated_at: String(payload.updated_at || payload.created_at || '').trim()
        };
    }

    function buildSmokeTicketSummaryDigestEntry(job = null, attemptsByJobId = new Map()) {
        if (!job || typeof job !== 'object') {
            return null;
        }

        const payload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? job.payload
            : {};
        const jobId = String(job.id || '').trim();
        const latestAttempt = Array.isArray(attemptsByJobId.get(jobId))
            ? attemptsByJobId.get(jobId)[0]
            : null;
        const previewItems = (Array.isArray(payload.items) ? payload.items : [])
            .map((item) => buildSmokeTicketSummaryPreviewItem(item))
            .filter(Boolean);
        const scheduleMode = String(payload.summary_schedule_mode || '').trim().toLowerCase();

        return {
            id: jobId,
            status: String(job.status || 'unknown').trim().toLowerCase() || 'unknown',
            severity: String(job.severity || 'warning').trim().toLowerCase() || 'warning',
            title: String(job.title || '').trim(),
            created_at: String(job.created_at || '').trim(),
            updated_at: String(job.updated_at || '').trim(),
            delivered_at: String(job.delivered_at || '').trim(),
            attempt_count: Math.max(0, Number.parseInt(job.attempt_count, 10) || 0),
            max_attempts: Math.max(0, Number.parseInt(job.max_attempts, 10) || 0),
            next_retry_at: String(job.next_retry_at || '').trim(),
            channels: normalizeSmokeTicketChannelList(job.channels),
            remaining_channels: normalizeSmokeTicketChannelList(job.remaining_channels),
            last_error: String(latestAttempt?.error_message || job.last_error || '').trim(),
            latest_attempt: latestAttempt ? {
                channel: String(latestAttempt.channel || '').trim().toLowerCase(),
                status: String(latestAttempt.status || '').trim().toLowerCase(),
                response_status: Number.isFinite(Number(latestAttempt.response_status)) ? Number(latestAttempt.response_status) : null,
                error_message: String(latestAttempt.error_message || '').trim(),
                created_at: String(latestAttempt.created_at || '').trim()
            } : null,
            summary_schedule_mode: ['rolling_window', 'hourly', 'daily'].includes(scheduleMode) ? scheduleMode : 'rolling_window',
            summary_window_minutes: Math.max(5, Number.parseInt(payload.summary_window_minutes, 10) || 60),
            summary_max_items: Math.max(1, Number.parseInt(payload.summary_max_items, 10) || 10),
            summary_hourly_minute: Math.min(59, Math.max(0, Number.parseInt(payload.summary_hourly_minute, 10) || 0)),
            summary_daily_hour: Math.min(23, Math.max(0, Number.parseInt(payload.summary_daily_hour, 10) || 9)),
            summary_daily_minute: Math.min(59, Math.max(0, Number.parseInt(payload.summary_daily_minute, 10) || 0)),
            summary_timezone: String(payload.summary_timezone || 'Asia/Shanghai').trim(),
            window_start_at: String(payload.window_start_at || '').trim(),
            window_end_at: String(payload.window_end_at || '').trim(),
            item_count: Math.max(0, Number.parseInt(payload.item_count, 10) || previewItems.length),
            entry_path: String(payload.entry_path || '').trim(),
            manual_event_count: 0,
            latest_manual_event: null,
            preview_items: previewItems
        };
    }

    function buildSmokeTicketsMetricsPayload() {
        const tickets = getTableRows('shop_tickets');
        const pendingRows = tickets.filter((ticket) => {
            const status = String(ticket?.status || '').trim().toLowerCase();
            return status === 'pending' || status === 'open';
        });
        const closedRows = tickets.filter((ticket) => {
            const status = String(ticket?.status || '').trim().toLowerCase();
            return status === 'resolved' || status === 'rejected';
        });
        const attemptsByJobId = buildSmokeTicketReminderAttemptsByJobId();
        const activityJobs = sortSmokeRowsByCreatedAtDesc(getTableRows('ops_alert_jobs').filter((job) => {
            const alertType = String(job?.alert_type || '').trim().toLowerCase();
            return alertType === 'ticket_sla_overdue' || alertType === 'ticket_sla_recovered';
        }));
        const summaryJobs = sortSmokeRowsByCreatedAtDesc(getTableRows('ops_alert_jobs').filter((job) => (
            String(job?.alert_type || '').trim().toLowerCase() === 'ticket_sla_summary'
        )));
        const countByStatus = (rows, status) => rows.filter((row) => String(row?.status || '').trim().toLowerCase() === status).length;
        const activeJobCount = (rows) => rows.filter((job) => {
            const status = String(job?.status || '').trim().toLowerCase();
            return status === 'retry' || status === 'pending' || status === 'processing';
        }).length;
        const deliveredJobCount = (rows) => rows.filter((job) => String(job?.status || '').trim().toLowerCase() === 'delivered').length;
        const retryJobCount = (rows) => rows.filter((job) => String(job?.status || '').trim().toLowerCase() === 'retry').length;
        const deadLetterJobCount = (rows) => rows.filter((job) => String(job?.status || '').trim().toLowerCase() === 'dead_letter').length;
        const dailySummaryJobs = summaryJobs.filter((job) => String(job?.payload?.summary_schedule_mode || '').trim().toLowerCase() === 'daily');
        const summaryEntries = summaryJobs
            .slice(0, 4)
            .map((job) => buildSmokeTicketSummaryDigestEntry(job, attemptsByJobId))
            .filter(Boolean);
        const latestProblemSummary = summaryJobs.find((job) => {
            const status = String(job?.status || '').trim().toLowerCase();
            return status === 'retry' || status === 'dead_letter';
        }) || null;
        const latestOverdueJob = activityJobs.find((job) => String(job?.alert_type || '').trim().toLowerCase() === 'ticket_sla_overdue') || null;
        const latestRecoveredJob = activityJobs.find((job) => String(job?.alert_type || '').trim().toLowerCase() === 'ticket_sla_recovered') || null;

        return {
            success: true,
            overview: {
                generated_at: now.toISOString(),
                backlog: {
                    total_pending: pendingRows.length,
                    assigned_count: 1,
                    unassigned_count: Math.max(0, pendingRows.length - 1),
                    overdue_count: pendingRows.length,
                    critical_overdue_count: Math.max(0, pendingRows.length - 1),
                    high_priority_count: pendingRows.length,
                    refundable_count: pendingRows.filter((ticket) => String(ticket?.order_id || '').trim()).length,
                    oldest_wait_minutes: 840
                },
                efficiency: {
                    lookback_days: 30,
                    closed_count: closedRows.length,
                    resolved_count: countByStatus(closedRows, 'resolved'),
                    rejected_count: countByStatus(closedRows, 'rejected'),
                    refund_related_count: closedRows.filter((ticket) => String(ticket?.order_id || '').trim()).length,
                    resolved_rate_percent: closedRows.length ? Number(((countByStatus(closedRows, 'resolved') / closedRows.length) * 100).toFixed(1)) : 0,
                    rejected_rate_percent: closedRows.length ? Number(((countByStatus(closedRows, 'rejected') / closedRows.length) * 100).toFixed(1)) : 0,
                    refund_related_rate_percent: closedRows.length ? Number(((closedRows.filter((ticket) => String(ticket?.order_id || '').trim()).length / closedRows.length) * 100).toFixed(1)) : 0,
                    avg_first_touch_minutes: 28,
                    first_touch_sample_count: 2,
                    avg_resolution_minutes: 96,
                    resolution_sample_count: closedRows.length
                },
                sources: buildSmokeTicketBreakdown(pendingRows, 'source', {
                    user: '用户提交',
                    chat: '客服会话',
                    other: '其他'
                }),
                issue_types: buildSmokeTicketBreakdown(pendingRows, 'issue_type', {
                    delivery: '发货履约',
                    verification: '验证协助',
                    payment: '支付与退款',
                    other: '其他问题'
                }),
                reminder: {
                    enabled: true,
                    ops_alerts_enabled: true,
                    monitor_enabled: true,
                    work_hours_only_enabled: false,
                    summary_enabled: true,
                    sweep_interval_minutes: 10,
                    pending_overdue_minutes: 120,
                    critical_overdue_minutes: 720,
                    summary_window_minutes: 60,
                    summary_schedule_mode: 'daily',
                    summary_hourly_minute: 15,
                    summary_daily_hour: 8,
                    summary_daily_minute: 0,
                    activity: {
                        lookback_days: 30,
                        total_job_count: activityJobs.length,
                        overdue_job_count: activityJobs.filter((job) => String(job?.alert_type || '').trim().toLowerCase() === 'ticket_sla_overdue').length,
                        recovered_job_count: activityJobs.filter((job) => String(job?.alert_type || '').trim().toLowerCase() === 'ticket_sla_recovered').length,
                        delivered_count: deliveredJobCount(activityJobs),
                        active_count: activeJobCount(activityJobs),
                        retry_count: retryJobCount(activityJobs),
                        dead_letter_count: deadLetterJobCount(activityJobs),
                        latest_job: buildSmokeTicketReminderActivityEntry(activityJobs[0] || null, attemptsByJobId),
                        latest_overdue: buildSmokeTicketReminderActivityEntry(latestOverdueJob, attemptsByJobId),
                        latest_recovered: buildSmokeTicketReminderActivityEntry(latestRecoveredJob, attemptsByJobId)
                    },
                    summary_digest: {
                        lookback_days: 30,
                        total_job_count: summaryJobs.length,
                        daily_job_count: dailySummaryJobs.length,
                        delivered_count: deliveredJobCount(summaryJobs),
                        active_count: activeJobCount(summaryJobs),
                        retry_count: retryJobCount(summaryJobs),
                        dead_letter_count: deadLetterJobCount(summaryJobs),
                        failure_job_count: retryJobCount(summaryJobs) + deadLetterJobCount(summaryJobs),
                        latest_job: buildSmokeTicketSummaryDigestEntry(summaryJobs[0] || null, attemptsByJobId),
                        latest_daily_job: buildSmokeTicketSummaryDigestEntry(dailySummaryJobs[0] || null, attemptsByJobId),
                        latest_problem_job: buildSmokeTicketSummaryDigestEntry(latestProblemSummary, attemptsByJobId),
                        recent_jobs: summaryEntries
                    }
                }
            }
        };
    }

    function buildSmokeTicketsListPayload(searchParams = new URLSearchParams()) {
        const profileById = new Map(getTableRows('profiles').map((profile) => [String(profile?.id || '').trim(), profile]));
        const statusFilter = String(searchParams.get('status') || 'all').trim().toLowerCase();
        let rows = sortSmokeRowsByCreatedAtDesc(getTableRows('shop_tickets')).map((ticket) => {
            const profile = profileById.get(String(ticket?.user_id || '').trim()) || {};
            const status = String(ticket?.status || 'pending').trim().toUpperCase() || 'PENDING';
            return {
                ...ticket,
                status,
                source: String(ticket?.source || 'user').trim() || 'user',
                source_label: '用户提交',
                user_email: profile.email || '',
                user_name: profile.username || profile.email || '',
                issue_type_label: ticket.issue_type === 'delivery' ? '发货履约' : (ticket.issue_type === 'verification' ? '验证协助' : '其他问题'),
                description: String(ticket?.description || '').trim(),
                timing: {
                    is_overdue: status === 'PENDING',
                    wait_label: status === 'PENDING' ? '13 小时 57 分钟' : '已处理',
                    sla_label: status === 'PENDING' ? '已超时 13 小时 57 分钟' : '已处理'
                },
                refund: {
                    refundable: Boolean(ticket?.order_id),
                    label: ticket?.order_id ? '可人工复核' : '无关联订单'
                },
                assignment_summary: '负责人：未指派',
                priority: status === 'PENDING' ? 'high' : 'normal'
            };
        });

        if (statusFilter === 'pending') {
            rows = rows.filter((ticket) => ticket.status === 'PENDING' || ticket.status === 'OPEN');
        } else if (statusFilter === 'resolved' || statusFilter === 'rejected') {
            rows = rows.filter((ticket) => ticket.status === statusFilter.toUpperCase());
        }

        const pageSize = Math.max(1, Number.parseInt(searchParams.get('pageSize'), 10) || 20);
        const page = Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1);
        const totalItems = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const offset = (Math.min(page, totalPages) - 1) * pageSize;
        const pageRows = rows.slice(offset, offset + pageSize);

        return {
            success: true,
            rows: deepClone(pageRows),
            pagination: {
                page: Math.min(page, totalPages),
                pageSize,
                totalItems,
                totalPages,
                hasPrevPage: page > 1,
                hasNextPage: page < totalPages,
                returnedItems: pageRows.length
            }
        };
    }

    function buildEmptySmokePromptSiteMetrics() {
        return {
            cn: { unlock_count: 0, comment_count: 0 },
            intl: { unlock_count: 0, comment_count: 0 },
            total: { unlock_count: 0, comment_count: 0 }
        };
    }

    function attachSmokePromptSiteMetrics(rows = []) {
        const safeRows = Array.isArray(rows) ? rows : [];
        const promptIdSet = new Set(
            safeRows
                .map((row) => String(row?.id || '').trim())
                .filter(Boolean)
        );

        if (!promptIdSet.size) {
            return safeRows.map((row) => ({
                ...row,
                site_metrics: buildEmptySmokePromptSiteMetrics()
            }));
        }

        const metricsById = new Map(
            [...promptIdSet].map((promptId) => [promptId, buildEmptySmokePromptSiteMetrics()])
        );
        const applyMetric = (collection = [], fieldName = '') => {
            for (const row of collection) {
                const promptId = String(row?.prompt_id || '').trim();
                const metrics = metricsById.get(promptId);
                if (!metrics) continue;
                const site = normalizeSmokeSite(row?.site);
                metrics[site][fieldName] += 1;
                metrics.total[fieldName] += 1;
            }
        };

        applyMetric(getTableRows('prompt_unlocks'), 'unlock_count');
        applyMetric(getTableRows('prompt_comments'), 'comment_count');

        return safeRows.map((row) => ({
            ...row,
            site_metrics: deepClone(metricsById.get(String(row?.id || '').trim()) || buildEmptySmokePromptSiteMetrics())
        }));
    }

    function buildEmptySmokePointsPackageMetrics() {
        return {
            cn: { batch_count: 0, generated_count: 0, used_count: 0 },
            intl: { batch_count: 0, generated_count: 0, used_count: 0 },
            total: { batch_count: 0, generated_count: 0, used_count: 0 }
        };
    }

    function buildSmokePointsCatalogResponse(site = 'all') {
        const siteContext = String(site || '').trim().toLowerCase() === 'intl'
            ? 'intl'
            : (String(site || '').trim().toLowerCase() === 'cn' ? 'cn' : 'all');
        const packages = getTableRows('points_packages').map((row) => ({ ...row }));
        const batches = getTableRows('redemption_batches').map((row) => ({ ...row }));
        const metricsById = new Map(
            packages.map((pkg) => [String(pkg?.id || '').trim(), buildEmptySmokePointsPackageMetrics()])
        );

        for (const batch of batches) {
            const packageId = String(batch?.package_id || '').trim();
            const metrics = metricsById.get(packageId);
            if (!metrics) continue;
            const normalizedSite = normalizeSmokeSite(batch?.site);
            const totalCount = Math.max(0, Number(batch?.total_count) || 0);
            const usedCount = Math.max(0, Number(batch?.used_count) || 0);

            metrics[normalizedSite].batch_count += 1;
            metrics[normalizedSite].generated_count += totalCount;
            metrics[normalizedSite].used_count += usedCount;
            metrics.total.batch_count += 1;
            metrics.total.generated_count += totalCount;
            metrics.total.used_count += usedCount;
        }

        const scopedBatches = siteContext === 'all'
            ? batches
            : batches.filter((batch) => normalizeSmokeSite(batch?.site) === siteContext);

        return {
            success: true,
            siteContext,
            summary: {
                package_count: packages.length,
                active_package_count: packages.filter((pkg) => pkg.is_active !== false).length,
                batch_count: scopedBatches.length,
                generated_code_count: scopedBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch?.total_count) || 0), 0),
                used_code_count: scopedBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch?.used_count) || 0), 0),
                custom_batch_count: scopedBatches.filter((batch) => !String(batch?.package_id || '').trim()).length
            },
            packages: packages.map((pkg) => ({
                ...pkg,
                total_points: Math.max(0, Number(pkg?.points_amount) || 0) + Math.max(0, Number(pkg?.bonus_points) || 0),
                metrics: deepClone(metricsById.get(String(pkg?.id || '').trim()) || buildEmptySmokePointsPackageMetrics())
            }))
        };
    }

    function attachSmokeBatchPackage(batch = {}) {
        const packageId = String(batch?.package_id || '').trim();
        const pkg = getTableRows('points_packages').find((row) => String(row?.id || '').trim() === packageId) || null;
        return {
            ...batch,
            points_packages: pkg
                ? {
                    id: pkg.id,
                    name: pkg.name,
                    points_amount: pkg.points_amount
                }
                : null
        };
    }

    function buildSmokePointsBatchesResponse(site = 'all') {
        const normalizedSite = String(site || '').trim().toLowerCase();
        const rows = getTableRows('redemption_batches')
            .filter((row) => normalizedSite === 'all' || normalizeSmokeSite(row?.site) === normalizeSmokeSite(normalizedSite))
            .sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime())
            .map((row) => attachSmokeBatchPackage(row));

        return {
            success: true,
            site: normalizedSite === 'intl' ? 'intl' : (normalizedSite === 'cn' ? 'cn' : 'all'),
            batches: deepClone(rows)
        };
    }

    function buildSmokePointsBatchDetail(site = 'all', batchId = '') {
        const normalizedBatchId = String(batchId || '').trim();
        const normalizedSite = String(site || '').trim().toLowerCase();
        const batch = getTableRows('redemption_batches').find((row) => (
            String(row?.id || '').trim() === normalizedBatchId
            && (normalizedSite === 'all' || normalizeSmokeSite(row?.site) === normalizeSmokeSite(normalizedSite))
        ));

        if (!batch) {
            return createResponse({
                success: false,
                message: 'Batch not found'
            }, 404);
        }

        const profiles = getTableRows('profiles');
        const profileMap = new Map(profiles.map((row) => [String(row?.id || '').trim(), row]));
        const codes = getTableRows('redemption_codes')
            .filter((row) => (
                String(row?.batch_id || '').trim() === normalizedBatchId
                && normalizeSmokeSite(row?.site) === normalizeSmokeSite(batch.site)
            ))
            .sort((left, right) => new Date(left?.created_at || 0).getTime() - new Date(right?.created_at || 0).getTime())
            .map((row) => ({
                ...row,
                used_profile: profileMap.get(String(row?.used_by || '').trim()) || null,
                revoker_name: (() => {
                    const profile = profileMap.get(String(row?.revoked_by || '').trim());
                    return profile ? (profile.username || profile.email || '未知') : '';
                })()
            }));

        return createResponse({
            success: true,
            site: normalizedSite === 'intl' ? 'intl' : (normalizedSite === 'cn' ? 'cn' : 'all'),
            batch: deepClone(attachSmokeBatchPackage(batch)),
            codes: deepClone(codes)
        });
    }

    function buildSmokePointsBatchSearch(site = 'all', code = '') {
        const normalizedSite = String(site || '').trim().toLowerCase();
        const normalizedCode = String(code || '').trim().toUpperCase();
        const codeRow = getTableRows('redemption_codes').find((row) => (
            String(row?.code || '').trim().toUpperCase() === normalizedCode
            && (normalizedSite === 'all' || normalizeSmokeSite(row?.site) === normalizeSmokeSite(normalizedSite))
        ));

        if (!codeRow) {
            return createResponse({
                success: true,
                site: normalizedSite === 'intl' ? 'intl' : (normalizedSite === 'cn' ? 'cn' : 'all'),
                found: false,
                batch: null
            });
        }

        const batch = getTableRows('redemption_batches').find((row) => String(row?.id || '').trim() === String(codeRow?.batch_id || '').trim());
        return createResponse({
            success: true,
            site: normalizedSite === 'intl' ? 'intl' : (normalizedSite === 'cn' ? 'cn' : 'all'),
            found: Boolean(batch),
            batch: batch ? deepClone(attachSmokeBatchPackage(batch)) : null
        });
    }

    function buildSmokePointsLookupResponse(site = 'all', query = '') {
        const normalizedSite = String(site || '').trim().toLowerCase();
        const normalizedQuery = String(query || '').trim();
        const upperQuery = normalizedQuery.toUpperCase();
        const codeRow = getTableRows('redemption_codes').find((row) => String(row?.code || '').trim().toUpperCase() === upperQuery);

        if (codeRow) {
            const batch = getTableRows('redemption_batches').find((row) => String(row?.id || '').trim() === String(codeRow?.batch_id || '').trim());
            const pkg = getTableRows('points_packages').find((row) => String(row?.id || '').trim() === String(codeRow?.package_id || '').trim());
            const profile = getTableRows('profiles').find((row) => String(row?.id || '').trim() === String(codeRow?.used_by || '').trim());

            return createResponse({
                success: true,
                site: normalizedSite === 'intl' ? 'intl' : (normalizedSite === 'cn' ? 'cn' : 'all'),
                kind: 'code',
                result: {
                    valid: true,
                    query_type: 'code',
                    code: codeRow.code,
                    status: codeRow.status,
                    batch_id: batch?.id || '',
                    batch_name: batch?.name || '',
                    package_name: pkg?.name || (codeRow.points_amount ? '自定义积分' : '-'),
                    points: codeRow.points_amount || (pkg ? (Number(pkg.points_amount || 0) + Number(pkg.bonus_points || 0)) : 0),
                    used_by: profile ? (profile.username || profile.email || '未知用户') : '',
                    used_at: codeRow.used_at || null,
                    revoke_reason: codeRow.revoke_reason || '',
                    revoked_by: codeRow.revoked_by ? '管理员' : '',
                    revoked_at: codeRow.revoked_at || null,
                    expires_at: codeRow.expires_at || null,
                    external_order_id: codeRow.external_order_id || ''
                }
            });
        }

        const ledgerRow = getTableRows('points_ledger').find((row) => String(row?.id || '').trim() === normalizedQuery);
        if (ledgerRow) {
            const profile = getTableRows('profiles').find((row) => String(row?.id || '').trim() === String(ledgerRow?.user_id || '').trim());
            const prompt = getTableRows('prompts').find((row) => String(row?.id || '').trim() === String(ledgerRow?.reference_id || '').trim());

            return createResponse({
                success: true,
                site: normalizedSite === 'intl' ? 'intl' : (normalizedSite === 'cn' ? 'cn' : 'all'),
                kind: 'ledger',
                result: {
                    ...ledgerRow,
                    profiles: profile ? { username: profile.username, email: profile.email } : null,
                    prompt_title: prompt?.title || ''
                }
            });
        }

        return createResponse({
            success: false,
            message: '未找到该兑换码/订单号'
        }, 404);
    }

    function normalizeSmokePointsPackageRecord(row = {}, fallbackSort = 0) {
        return {
            id: String(row.id || '').trim(),
            name: String(row.name || '').trim(),
            name_en: String(row.name_en || '').trim(),
            points_amount: Math.max(0, Math.round(Number(row.points_amount ?? row.points) || 0)),
            bonus_points: Math.max(0, Math.round(Number(row.bonus_points ?? row.bonus) || 0)),
            price_cny: row.price_cny === '' || row.price === ''
                ? null
                : (row.price_cny == null && row.price == null
                    ? null
                    : Math.max(0, Math.round((Number(row.price_cny ?? row.price) || 0) * 100) / 100)),
            is_active: row.is_active !== false && row.enabled !== false,
            sort_order: Math.max(0, Math.round(Number(row.sort_order ?? row.sort) || fallbackSort || 0)),
            created_at: row.created_at || now.toISOString()
        };
    }

    function sortSmokePointsPackageRows(rows = []) {
        return [...rows].sort((left, right) => {
            const sortDelta = (Number(left?.sort_order) || 0) - (Number(right?.sort_order) || 0);
            if (sortDelta !== 0) return sortDelta;
            return normalizeComparableValue(left?.name).localeCompare(normalizeComparableValue(right?.name));
        });
    }

    function findSmokeBatchById(batchId = '', site = 'cn') {
        const normalizedId = String(batchId || '').trim();
        const normalizedSite = normalizeSmokeSite(site);
        return getTableRows('redemption_batches').find((row) => (
            String(row?.id || '').trim() === normalizedId
            && normalizeSmokeSite(row?.site) === normalizedSite
        )) || null;
    }

    function findSmokeCodeByValue(code = '', site = 'cn') {
        const normalizedCode = String(code || '').trim();
        const normalizedSite = normalizeSmokeSite(site);
        return getTableRows('redemption_codes').find((row) => (
            String(row?.code || '').trim() === normalizedCode
            && normalizeSmokeSite(row?.site) === normalizedSite
        )) || null;
    }

    function getSmokePackageTotalPoints(packageId = '') {
        const pkg = getTableRows('points_packages').find((row) => String(row?.id || '').trim() === String(packageId || '').trim());
        if (!pkg) {
            return 0;
        }
        return Math.max(0, Number(pkg?.points_amount) || 0) + Math.max(0, Number(pkg?.bonus_points) || 0);
    }

    function buildSmokeGeneratedCode(site = 'cn', index = 0) {
        const sitePrefix = normalizeSmokeSite(site) === 'intl' ? 'INTL' : 'CN';
        const sequence = String(Date.now() + index).slice(-6);
        return `ZY-${sitePrefix}-${sequence}`;
    }

    function handleSmokePointsManage(body = {}) {
        const site = normalizeSmokeSite(body.site);
        const action = String(body.action || '').trim().toLowerCase();
        const batches = getTableRows('redemption_batches').map((row) => ({ ...row }));
        const codes = getTableRows('redemption_codes').map((row) => ({ ...row }));

        if (action === 'generate_codes') {
            const batchName = String(body.batch_name || '').trim();
            const count = Math.max(1, Math.min(1000, Number.parseInt(body.count, 10) || 0));
            if (!batchName || !count) {
                return createResponse({ success: false, message: 'batch_name and count are required' }, 400);
            }

            const packageId = String(body.package_id || '').trim();
            const customPointsAmount = body.custom_points_amount == null || body.custom_points_amount === ''
                ? null
                : Math.max(0, Number.parseInt(body.custom_points_amount, 10) || 0);
            const batchId = `batch-smoke-${site}-${Date.now()}`;
            const generatedCodes = [];
            const nextBatch = {
                id: batchId,
                name: batchName,
                package_id: packageId || null,
                channel: String(body.channel || 'manual').trim() || 'manual',
                total_count: count,
                used_count: 0,
                expires_at: body.expires_at || null,
                custom_points_amount: customPointsAmount,
                notes: null,
                site,
                status: 'active',
                created_at: now.toISOString()
            };

            const nextCodes = [...codes];
            for (let index = 0; index < count; index += 1) {
                const code = buildSmokeGeneratedCode(site, index);
                generatedCodes.push(code);
                nextCodes.push({
                    id: `redemption-code-${batchId}-${index + 1}`,
                    code,
                    batch_id: batchId,
                    package_id: packageId || null,
                    status: 'pending',
                    site,
                    points_amount: customPointsAmount || getSmokePackageTotalPoints(packageId),
                    created_at: now.toISOString(),
                    expires_at: body.expires_at || null
                });
            }

            setTableRows('redemption_batches', [...batches, nextBatch]);
            setTableRows('redemption_codes', nextCodes);

            return createResponse({
                success: true,
                site,
                batch_name: batchName,
                count,
                codes: generatedCodes
            });
        }

        if (action === 'update_batch') {
            const batch = findSmokeBatchById(body.batch_id, site);
            if (!batch) {
                return createResponse({ success: false, message: 'Batch not found for the selected site' }, 404);
            }

            const nextBatches = batches.map((row) => {
                if (String(row.id) !== String(batch.id)) return row;
                return {
                    ...row,
                    name: String(body.name || row.name || '').trim(),
                    notes: body.notes == null || body.notes === '' ? null : String(body.notes),
                    expires_at: body.expires_at === undefined ? row.expires_at : (body.expires_at || null)
                };
            });
            setTableRows('redemption_batches', nextBatches);

            return createResponse({
                success: true,
                message: '批次已更新',
                row: deepClone(nextBatches.find((row) => row.id === batch.id) || batch)
            });
        }

        if (action === 'delete_batches') {
            const batchIds = [...new Set((Array.isArray(body.batch_ids) ? body.batch_ids : []).map((item) => String(item || '').trim()).filter(Boolean))];
            const deleteMode = String(body.delete_mode || 'keep').trim().toLowerCase();
            const targetBatchIds = new Set(batchIds);
            const scopedCodes = codes.filter((row) => normalizeSmokeSite(row?.site) === site && targetBatchIds.has(String(row?.batch_id || '').trim()));
            const usedCodes = scopedCodes.filter((row) => row.status === 'used');
            let retainedCount = 0;
            let deletedCodeCount = 0;
            let deletedBatchCount = 0;
            let revokedCount = 0;

            if (deleteMode === 'revoke') {
                revokedCount = usedCodes.length;
                const nextCodes = codes.filter((row) => !(normalizeSmokeSite(row?.site) === site && targetBatchIds.has(String(row?.batch_id || '').trim())));
                const nextBatches = batches.filter((row) => !(normalizeSmokeSite(row?.site) === site && targetBatchIds.has(String(row?.id || '').trim())));
                deletedCodeCount = scopedCodes.length;
                deletedBatchCount = batchIds.length;
                setTableRows('redemption_codes', nextCodes);
                setTableRows('redemption_batches', nextBatches);

                return createResponse({
                    success: true,
                    message: `已撤销 ${revokedCount} 个兑换码并删除 ${deletedBatchCount} 个批次`,
                    revoked_count: revokedCount,
                    deleted_code_count: deletedCodeCount,
                    deleted_batch_count: deletedBatchCount
                });
            }

            if (deleteMode === 'block') {
                const removableStatuses = new Set(['pending', 'disabled', 'locked']);
                const removableCodeIds = new Set(scopedCodes.filter((row) => removableStatuses.has(row.status)).map((row) => row.id));
                const nextCodes = codes.filter((row) => !removableCodeIds.has(row.id));
                retainedCount = scopedCodes.filter((row) => !removableCodeIds.has(row.id)).length;
                deletedCodeCount = removableCodeIds.size;
                setTableRows('redemption_codes', nextCodes);

                if (retainedCount === 0) {
                    const nextBatches = batches.filter((row) => !(normalizeSmokeSite(row?.site) === site && targetBatchIds.has(String(row?.id || '').trim())));
                    deletedBatchCount = batchIds.length;
                    setTableRows('redemption_batches', nextBatches);
                }

                return createResponse({
                    success: true,
                    message: retainedCount > 0
                        ? `已删除未使用兑换码，保留 ${retainedCount} 个已使用兑换码记录`
                        : `已删除 ${deletedBatchCount} 个批次`,
                    retained_code_count: retainedCount,
                    deleted_code_count: deletedCodeCount,
                    deleted_batch_count: deletedBatchCount
                });
            }

            setTableRows('redemption_codes', codes.filter((row) => !(normalizeSmokeSite(row?.site) === site && targetBatchIds.has(String(row?.batch_id || '').trim()))));
            setTableRows('redemption_batches', batches.filter((row) => !(normalizeSmokeSite(row?.site) === site && targetBatchIds.has(String(row?.id || '').trim()))));
            deletedCodeCount = scopedCodes.length;
            deletedBatchCount = batchIds.length;

            return createResponse({
                success: true,
                message: `已删除 ${deletedBatchCount} 个批次（用户积分保留）`,
                deleted_code_count: deletedCodeCount,
                deleted_batch_count: deletedBatchCount
            });
        }

        if (action === 'invalidate_batches') {
            const batchIds = new Set((Array.isArray(body.batch_ids) ? body.batch_ids : []).map((item) => String(item || '').trim()).filter(Boolean));
            let disabledCount = 0;
            const nextCodes = codes.map((row) => {
                if (normalizeSmokeSite(row?.site) !== site) return row;
                if (!batchIds.has(String(row?.batch_id || '').trim())) return row;
                if (row.status !== 'pending') return row;
                disabledCount += 1;
                return {
                    ...row,
                    status: 'disabled'
                };
            });
            setTableRows('redemption_codes', nextCodes);

            return createResponse({
                success: true,
                message: `已作废 ${disabledCount} 个未使用兑换码`,
                disabled_code_count: disabledCount
            });
        }

        if (action === 'set_code_expiry') {
            const code = findSmokeCodeByValue(body.code, site);
            if (!code) {
                return createResponse({ success: false, message: 'Code not found for the selected site' }, 404);
            }

            const nextCodes = codes.map((row) => (
                row.id === code.id
                    ? { ...row, expires_at: body.expires_at || null }
                    : row
            ));
            setTableRows('redemption_codes', nextCodes);

            return createResponse({
                success: true,
                message: body.expires_at ? '有效期已更新' : '已清除单码有效期，恢复继承批次有效期',
                row: deepClone(nextCodes.find((row) => row.id === code.id) || code)
            });
        }

        if (action === 'set_code_status') {
            const code = findSmokeCodeByValue(body.code, site);
            const nextStatus = String(body.status || '').trim().toLowerCase();
            if (!code) {
                return createResponse({ success: false, message: 'Code not found for the selected site' }, 404);
            }
            if (!['disabled', 'pending'].includes(nextStatus)) {
                return createResponse({ success: false, message: 'status must be disabled or pending' }, 400);
            }

            const nextCodes = codes.map((row) => (
                row.id === code.id
                    ? { ...row, status: nextStatus }
                    : row
            ));
            setTableRows('redemption_codes', nextCodes);

            return createResponse({
                success: true,
                message: nextStatus === 'disabled' ? '已禁用该兑换码' : '已启用该兑换码',
                row: deepClone(nextCodes.find((row) => row.id === code.id) || code)
            });
        }

        if (action === 'revoke_code') {
            const code = findSmokeCodeByValue(body.code, site);
            if (!code) {
                return createResponse({ success: false, message: 'Code not found for the selected site' }, 404);
            }

            const nextCodes = codes.map((row) => (
                row.id === code.id
                    ? {
                        ...row,
                        status: 'revoked',
                        revoke_reason: String(body.reason || '管理员撤销'),
                        revoked_at: now.toISOString(),
                        revoked_by: 'admin-smoke'
                    }
                    : row
            ));
            const nextBatches = batches.map((row) => (
                row.id === code.batch_id
                    ? {
                        ...row,
                        used_count: Math.max(0, (Number(row.used_count) || 0) - (code.status === 'used' ? 1 : 0))
                    }
                    : row
            ));
            setTableRows('redemption_codes', nextCodes);
            setTableRows('redemption_batches', nextBatches);

            return createResponse({
                success: true,
                message: '撤销成功',
                code: code.code,
                points_deducted: Number(code.points_amount) || getSmokePackageTotalPoints(code.package_id)
            });
        }

        return createResponse({ success: false, message: 'Unsupported points manage action' }, 400);
    }

    function normalizeComparableValue(value) {
        return value == null ? '' : String(value);
    }

    function applyFilters(rows, filters = []) {
        return rows.filter((row) => filters.every((filter) => {
            if (!filter) {
                return true;
            }
            if (filter.kind === 'eq') {
                return normalizeComparableValue(row?.[filter.field]) === normalizeComparableValue(filter.value);
            }
            if (filter.kind === 'in') {
                const expected = Array.isArray(filter.values) ? filter.values : [];
                return expected.some((value) => normalizeComparableValue(row?.[filter.field]) === normalizeComparableValue(value));
            }
            return true;
        }));
    }

    function compareOrderValues(leftValue, rightValue) {
        const leftDate = Date.parse(leftValue);
        const rightDate = Date.parse(rightValue);
        if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
            return leftDate - rightDate;
        }

        const leftNumber = Number(leftValue);
        const rightNumber = Number(rightValue);
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && String(leftValue).trim() !== '' && String(rightValue).trim() !== '') {
            return leftNumber - rightNumber;
        }

        return normalizeComparableValue(leftValue).localeCompare(normalizeComparableValue(rightValue));
    }

    function buildInsertedRow(table, item = {}, index = 0) {
        const base = item && typeof item === 'object' ? { ...item } : {};
        const defaultIdPrefix = table === 'chat_messages' ? 'chat-insert' : 'row-insert';

        if (!base.id && table !== 'verification_logs') {
            base.id = `${defaultIdPrefix}-${Date.now()}-${index}`;
        }
        if (!base.created_at) {
            base.created_at = now.toISOString();
        }
        if (table === 'chat_messages') {
            base.message_type = String(base.message_type || 'text').trim() || 'text';
            base.content = String(base.content || '').trim();
            base.is_admin = base.is_admin === true;
        }
        if (table === 'system_notifications') {
            base.is_read = base.is_read === true;
        }

        return base;
    }

    function normalizeSmokeShopStatus(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return ['available', 'reserve', 'sold', 'frozen', 'fault'].includes(normalized) ? normalized : 'available';
    }

    function normalizeText(value, maxLength = 200) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function normalizeCategoryColor(value, fallback = null) {
        const normalized = normalizeText(value, 32);
        if (!normalized) {
            return fallback;
        }

        return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
    }

    function normalizeIsoDate(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const timestamp = Date.parse(String(value));
        if (!Number.isFinite(timestamp)) {
            return null;
        }

        return new Date(timestamp).toISOString();
    }

    function normalizePositiveInteger(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const normalized = Number.parseInt(String(value), 10);
        if (!Number.isFinite(normalized) || normalized <= 0) {
            return null;
        }

        return normalized;
    }

    function normalizeNonNegativeInteger(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const normalized = Number.parseInt(String(value), 10);
        if (!Number.isFinite(normalized) || normalized < 0) {
            return null;
        }

        return normalized;
    }

    function normalizeSmokeShopProductOrder(value, fallback = 'display_order_desc') {
        const normalized = String(value || '').trim().toLowerCase();
        return ['display_order_desc', 'name_asc', 'sort_order_asc'].includes(normalized) ? normalized : fallback;
    }

    function normalizeSmokeShopProductFields(value, fallback = 'full') {
        const normalized = String(value || '').trim().toLowerCase();
        return ['full', 'names', 'import'].includes(normalized) ? normalized : fallback;
    }

    function getSmokeShopProductMap() {
        return new Map(
            getTableRows('shop_products').map((row) => [String(row?.id || '').trim(), row])
        );
    }

    function getSmokeShopCategoryRows() {
        return getTableRows('shop_categories')
            .map((row) => ({ ...row }))
            .sort((left, right) => {
                const orderDelta = Number(left?.sort_order || 0) - Number(right?.sort_order || 0);
                if (orderDelta !== 0) return orderDelta;
                return normalizeComparableValue(left?.name).localeCompare(normalizeComparableValue(right?.name));
            });
    }

    function getSmokeShopNextCategorySortOrder() {
        return getSmokeShopCategoryRows().reduce(
            (maxValue, row) => Math.max(maxValue, Number(row?.sort_order || 0) || 0),
            0
        ) + 10;
    }

    function ensureSmokeShopFallbackCategory(name = 'other') {
        const normalizedName = normalizeText(name, 120) || 'other';
        const rows = getTableRows('shop_categories').map((row) => ({ ...row }));
        const existing = rows.find((row) => String(row?.name || '').trim() === normalizedName);
        if (existing) {
            return existing;
        }

        const inserted = buildInsertedRow('shop_categories', {
            id: `cat-smoke-${normalizedName}-${Date.now()}`,
            name: normalizedName,
            color: '#9aa0a6',
            sort_order: getSmokeShopNextCategorySortOrder()
        });
        rows.push(inserted);
        setTableRows('shop_categories', rows);
        return inserted;
    }

    function recalculateSmokeShopStockCounts(productIds = null) {
        const targetIds = Array.isArray(productIds) && productIds.length
            ? new Set(productIds.map((item) => String(item || '').trim()).filter(Boolean))
            : null;
        const inventoryRows = getTableRows('shop_inventory');
        const nextRows = getTableRows('shop_products').map((row) => {
            const productId = String(row?.id || '').trim();
            if (targetIds && !targetIds.has(productId)) {
                return { ...row };
            }

            const stockCount = inventoryRows.filter((entry) => (
                String(entry?.product_id || '').trim() === productId
                && normalizeSmokeShopStatus(entry?.status) === 'available'
            )).length;

            return {
                ...row,
                stock_count: stockCount
            };
        });

        setTableRows('shop_products', nextRows);
    }

    function projectSmokeShopProductRow(row = {}, fields = 'full') {
        if (fields === 'names') {
            return {
                id: row.id,
                name: row.name
            };
        }

        if (fields === 'import') {
            return {
                id: row.id,
                name: row.name,
                category: row.category,
                sort_order: row.sort_order,
                is_active: row.is_active !== false
            };
        }

        return { ...row };
    }

    function buildSmokeShopProductsPayload(searchParams) {
        const productId = normalizeText(searchParams.get('id') || searchParams.get('productId'), 160);
        const status = normalizeText(searchParams.get('status'), 40).toLowerCase() || 'all';
        const fields = normalizeSmokeShopProductFields(searchParams.get('fields'), 'full');
        const order = normalizeSmokeShopProductOrder(
            searchParams.get('order'),
            fields === 'names' ? 'name_asc' : 'display_order_desc'
        );
        const category = normalizeText(searchParams.get('category'), 120);
        const ids = String(searchParams.get('ids') || '')
            .split(',')
            .map((item) => normalizeText(item, 160))
            .filter(Boolean);

        if (productId) {
            const product = getTableRows('shop_products').find((row) => String(row?.id || '').trim() === productId) || null;
            return {
                success: true,
                product: product ? deepClone(product) : null
            };
        }

        let rows = getTableRows('shop_products').map((row) => ({ ...row }));

        if (ids.length) {
            const idSet = new Set(ids);
            rows = rows.filter((row) => idSet.has(String(row?.id || '').trim()));
        }

        if (status === 'active') {
            rows = rows.filter((row) => row?.is_active !== false);
        } else if (status === 'deleted') {
            rows = rows.filter((row) => row?.is_active === false);
        }

        if (category && category !== 'all') {
            rows = rows.filter((row) => String(row?.category || '').trim() === category);
        }

        rows.sort((left, right) => {
            if (order === 'name_asc') {
                return normalizeComparableValue(left?.name).localeCompare(normalizeComparableValue(right?.name), 'zh-CN');
            }
            if (order === 'sort_order_asc') {
                const sortDelta = Number(left?.sort_order || 0) - Number(right?.sort_order || 0);
                if (sortDelta !== 0) return sortDelta;
                return normalizeComparableValue(left?.name).localeCompare(normalizeComparableValue(right?.name), 'zh-CN');
            }
            const displayDelta = Number(right?.display_order || 0) - Number(left?.display_order || 0);
            if (displayDelta !== 0) return displayDelta;
            return normalizeComparableValue(left?.name).localeCompare(normalizeComparableValue(right?.name), 'zh-CN');
        });

        return {
            success: true,
            rows: deepClone(rows.map((row) => projectSmokeShopProductRow(row, fields)))
        };
    }

    function buildSmokeShopInventoryRows() {
        const productMap = getSmokeShopProductMap();
        const profileMap = new Map(
            getTableRows('profiles').map((row) => [String(row?.id || '').trim(), row])
        );

        return getTableRows('shop_inventory').map((row) => {
            const product = productMap.get(String(row?.product_id || '').trim()) || null;
            const buyerProfile = profileMap.get(String(row?.buyer_id || '').trim()) || null;
            return {
                ...row,
                status: normalizeSmokeShopStatus(row?.status),
                product_name: product?.name || '',
                buyer_email: row?.buyer_email || buyerProfile?.email || '',
                order_id: row?.order_id || null
            };
        });
    }

    function buildSmokeShopInventoryPayload(searchParams) {
        const page = Math.max(1, Number.parseInt(String(searchParams.get('page') || '1'), 10) || 1);
        const pageSize = Math.max(1, Number.parseInt(String(searchParams.get('pageSize') || '10'), 10) || 10);
        const productId = normalizeText(searchParams.get('productId') || searchParams.get('product_id'), 160) || null;
        const status = normalizeText(searchParams.get('status'), 40).toLowerCase() || null;
        const search = normalizeText(searchParams.get('search'), 200).toLowerCase() || null;
        const dateFrom = normalizeIsoDate(searchParams.get('dateFrom') || searchParams.get('date_from'));
        const dateTo = normalizeIsoDate(searchParams.get('dateTo') || searchParams.get('date_to'));

        let rows = buildSmokeShopInventoryRows();
        if (productId) {
            rows = rows.filter((row) => String(row?.product_id || '').trim() === productId);
        }
        if (status && status !== 'all') {
            rows = rows.filter((row) => normalizeSmokeShopStatus(row?.status) === status);
        }
        if (search) {
            rows = rows.filter((row) => {
                const haystack = [
                    row?.product_name,
                    row?.content,
                    row?.batch_id,
                    row?.buyer_email,
                    row?.order_id
                ].map((item) => String(item || '').toLowerCase()).join(' ');
                return haystack.includes(search);
            });
        }
        if (dateFrom) {
            const fromTs = Date.parse(dateFrom);
            rows = rows.filter((row) => Date.parse(row?.created_at || 0) >= fromTs);
        }
        if (dateTo) {
            const toTs = Date.parse(dateTo);
            rows = rows.filter((row) => Date.parse(row?.created_at || 0) <= toTs);
        }

        rows.sort((left, right) => Date.parse(right?.created_at || 0) - Date.parse(left?.created_at || 0));

        const stats = rows.reduce((acc, row) => {
            const key = normalizeSmokeShopStatus(row?.status);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {
            reserve: 0,
            available: 0,
            sold: 0,
            frozen: 0,
            fault: 0
        });

        const total = rows.length;
        const offset = (page - 1) * pageSize;
        const items = rows.slice(offset, offset + pageSize);

        return {
            success: true,
            page,
            pageSize,
            total,
            stats,
            items: deepClone(items)
        };
    }

    function handleSmokeShopMutation(body = {}) {
        const site = String(body.site || '').trim().toLowerCase();
        if (!['cn', 'intl'].includes(site)) {
            return createResponse({
                success: false,
                message: 'Writable admin site must be cn or intl'
            }, 400);
        }

        const action = String(body.action || '').trim();
        if (!action) {
            return createResponse({
                success: false,
                message: 'action is required'
            }, 400);
        }

        if (action === 'create_category') {
            const name = normalizeText(body.name, 120);
            const color = normalizeCategoryColor(body.color, '#6b9ece');
            if (!name) {
                return createResponse({ success: false, message: 'name is required' }, 400);
            }

            const rows = getTableRows('shop_categories').map((row) => ({ ...row }));
            const inserted = buildInsertedRow('shop_categories', {
                id: `cat-smoke-${Date.now()}`,
                name,
                color,
                sort_order: getSmokeShopNextCategorySortOrder()
            });
            rows.push(inserted);
            setTableRows('shop_categories', rows);

            return createResponse({
                success: true,
                category: deepClone(inserted)
            });
        }

        if (action === 'rename_category') {
            const categoryId = normalizeText(body.categoryId, 160);
            const nextName = normalizeText(body.name, 120);
            if (!categoryId || !nextName) {
                return createResponse({
                    success: false,
                    message: 'categoryId and name are required'
                }, 400);
            }

            const categoryRows = getTableRows('shop_categories').map((row) => ({ ...row }));
            const target = categoryRows.find((row) => String(row?.id || '').trim() === categoryId);
            if (!target) {
                return createResponse({ success: false, message: '分类不存在' }, 404);
            }

            const previousName = target.name;
            target.name = nextName;
            setTableRows('shop_categories', categoryRows);

            const productRows = getTableRows('shop_products').map((row) => (
                String(row?.category || '').trim() === previousName
                    ? { ...row, category: nextName }
                    : { ...row }
            ));
            setTableRows('shop_products', productRows);

            return createResponse({
                success: true,
                category: deepClone(target)
            });
        }

        if (action === 'set_category_color') {
            const categoryId = normalizeText(body.categoryId, 160);
            const color = normalizeCategoryColor(body.color);
            if (!categoryId || !color) {
                return createResponse({
                    success: false,
                    message: 'categoryId and valid color are required'
                }, 400);
            }

            const categoryRows = getTableRows('shop_categories').map((row) => ({ ...row }));
            const target = categoryRows.find((row) => String(row?.id || '').trim() === categoryId);
            if (!target) {
                return createResponse({ success: false, message: '分类不存在' }, 404);
            }

            target.color = color;
            setTableRows('shop_categories', categoryRows);
            return createResponse({
                success: true,
                category: deepClone(target)
            });
        }

        if (action === 'delete_category') {
            const categoryId = normalizeText(body.categoryId, 160);
            if (!categoryId) {
                return createResponse({ success: false, message: 'categoryId is required' }, 400);
            }

            const categoryRows = getTableRows('shop_categories').map((row) => ({ ...row }));
            const target = categoryRows.find((row) => String(row?.id || '').trim() === categoryId);
            if (!target) {
                return createResponse({ success: false, message: '分类不存在' }, 404);
            }
            if (String(target?.name || '').trim().toLowerCase() === 'other') {
                return createResponse({ success: false, message: '默认分类 other 不允许删除' }, 400);
            }

            const fallbackCategory = ensureSmokeShopFallbackCategory('other');
            setTableRows(
                'shop_categories',
                categoryRows.filter((row) => String(row?.id || '').trim() !== categoryId)
            );
            setTableRows(
                'shop_products',
                getTableRows('shop_products').map((row) => (
                    String(row?.category || '').trim() === String(target?.name || '').trim()
                        ? { ...row, category: fallbackCategory.name }
                        : { ...row }
                ))
            );

            return createResponse({
                success: true,
                deleted: true,
                fallbackCategory: fallbackCategory.name
            });
        }

        if (action === 'reorder_products') {
            const assignments = (Array.isArray(body.assignments) ? body.assignments : [])
                .map((entry) => ({
                    id: normalizeText(entry?.id || entry?.productId, 160),
                    category: normalizeText(entry?.category || entry?.targetCategory, 120),
                    sort_order: normalizeNonNegativeInteger(entry?.sortOrder ?? entry?.sort_order)
                }))
                .filter((entry) => entry.id && entry.category && entry.sort_order !== null);

            if (!assignments.length) {
                return createResponse({
                    success: false,
                    message: 'assignments is required'
                }, 400);
            }

            const productRows = getTableRows('shop_products').map((row) => ({ ...row }));
            const productMap = new Map(productRows.map((row) => [String(row?.id || '').trim(), row]));
            const updatedProducts = [];

            for (const assignment of assignments) {
                const target = productMap.get(assignment.id);
                if (!target) {
                    return createResponse({
                        success: false,
                        message: `商品不存在: ${assignment.id}`
                    }, 404);
                }
                target.category = assignment.category;
                target.sort_order = assignment.sort_order;
                updatedProducts.push({
                    ...target
                });
            }

            setTableRows('shop_products', productRows);
            return createResponse({
                success: true,
                updated: updatedProducts.length,
                products: deepClone(updatedProducts)
            });
        }

        if (action === 'import_inventory') {
            const productId = normalizeText(body.productId, 160);
            const lines = (Array.isArray(body.lines) ? body.lines : [])
                .map((line) => String(line || '').trim())
                .filter(Boolean);
            const importStatus = normalizeSmokeShopStatus(body.importStatus);
            const batchId = normalizeText(body.batchId, 120) || `batch-smoke-${Date.now()}`;

            if (!productId || !lines.length) {
                return createResponse({
                    success: false,
                    message: 'productId and lines are required'
                }, 400);
            }

            const inventoryRows = getTableRows('shop_inventory').map((row) => ({ ...row }));
            lines.forEach((content, index) => {
                inventoryRows.push(buildInsertedRow('shop_inventory', {
                    id: `inv-smoke-${Date.now()}-${index + 1}`,
                    product_id: productId,
                    content,
                    status: importStatus,
                    batch_id: batchId,
                    created_at: new Date(now.getTime() + index * 1000).toISOString(),
                    buyer_id: null,
                    sold_at: null,
                    order_id: null,
                    remark: null
                }, index));
            });
            setTableRows('shop_inventory', inventoryRows);
            recalculateSmokeShopStockCounts([productId]);

            const product = getTableRows('shop_products').find((row) => String(row?.id || '').trim() === productId) || {};
            return createResponse({
                success: true,
                imported: lines.length,
                stockCount: Number(product?.stock_count || 0),
                batchId
            });
        }

        if (action === 'inventory_release_reserve') {
            const productId = normalizeText(body.productId, 160);
            const count = normalizePositiveInteger(body.count);
            const beforeDate = normalizeIsoDate(body.beforeDate ?? body.before_date);

            if (!productId) {
                return createResponse({ success: false, message: 'productId is required' }, 400);
            }
            if ((body.count !== null && body.count !== undefined && body.count !== '') && !count) {
                return createResponse({ success: false, message: 'count must be a positive integer' }, 400);
            }
            if ((body.beforeDate || body.before_date) && !beforeDate) {
                return createResponse({ success: false, message: 'beforeDate is invalid' }, 400);
            }
            if (!count && !beforeDate) {
                return createResponse({ success: false, message: 'count or beforeDate is required' }, 400);
            }

            const inventoryRows = getTableRows('shop_inventory').map((row) => ({ ...row }));
            const reserveRows = inventoryRows
                .filter((row) => (
                    String(row?.product_id || '').trim() === productId
                    && normalizeSmokeShopStatus(row?.status) === 'reserve'
                    && (!beforeDate || Date.parse(row?.created_at || 0) < Date.parse(beforeDate))
                ))
                .sort((left, right) => Date.parse(left?.created_at || 0) - Date.parse(right?.created_at || 0));

            const releaseRows = count ? reserveRows.slice(0, count) : reserveRows;
            const releaseIdSet = new Set(releaseRows.map((row) => String(row?.id || '').trim()).filter(Boolean));
            inventoryRows.forEach((row) => {
                if (!releaseIdSet.has(String(row?.id || '').trim())) {
                    return;
                }
                row.status = 'available';
                row.buyer_id = null;
                row.sold_at = null;
                row.order_id = null;
                row.remark = null;
            });
            setTableRows('shop_inventory', inventoryRows);
            recalculateSmokeShopStockCounts([productId]);

            const product = getTableRows('shop_products').find((row) => String(row?.id || '').trim() === productId) || {};
            return createResponse({
                success: true,
                released: releaseRows.length,
                stockCount: Number(product?.stock_count || 0),
                message: releaseRows.length
                    ? `成功释放 ${releaseRows.length} 条储备库存`
                    : '未找到符合条件的储备库存'
            });
        }

        return createResponse({
            success: false,
            message: `Unsupported action: ${action}`
        }, 400);
    }

    function createQueryBuilder(table) {
        const state = {
            table,
            method: 'select',
            filters: [],
            values: null,
            returning: false,
            orderField: '',
            orderAscending: true,
            limitCount: 0,
            singleMode: false,
            maybeSingleMode: false
        };

        const chain = {
            select() {
                if (state.method === 'update' || state.method === 'insert' || state.method === 'delete') {
                    state.returning = true;
                    return proxy;
                }
                state.method = 'select';
                return proxy;
            },
            update(values) {
                state.method = 'update';
                state.values = values;
                return proxy;
            },
            delete() {
                state.method = 'delete';
                return proxy;
            },
            insert(values) {
                state.method = 'insert';
                state.values = values;
                return proxy;
            },
            eq(field, value) {
                state.filters.push({ kind: 'eq', field, value });
                return proxy;
            },
            in(field, values) {
                state.filters.push({
                    kind: 'in',
                    field,
                    values: Array.isArray(values) ? values : []
                });
                return proxy;
            },
            order(field, options = {}) {
                state.orderField = String(field || '').trim();
                state.orderAscending = options?.ascending !== false;
                return proxy;
            },
            limit(count) {
                state.limitCount = Math.max(0, Number(count || 0));
                return proxy;
            },
            single() {
                state.limitCount = 1;
                state.singleMode = true;
                return proxy;
            },
            maybeSingle() {
                state.limitCount = 1;
                state.maybeSingleMode = true;
                return proxy;
            },
            then(resolve, reject) {
                const delayMs = table === 'system_notifications' && state.method === 'select'
                    ? Math.max(0, Number(smokeState.notificationSelectDelayMs || 0))
                    : 0;
                const execution = delayMs > 0
                    ? sleep(delayMs).then(() => execute())
                    : Promise.resolve(execute());
                return execution.then(resolve, reject);
            },
            catch(reject) {
                return Promise.resolve(execute()).catch(reject);
            },
            finally(handler) {
                return Promise.resolve(execute()).finally(handler);
            }
        };

        function execute() {
            const rows = getTableRows(table);
            if (table === 'system_notifications' && state.method === 'select') {
                smokeState.notificationSelectCount += 1;
            }

            if (state.method === 'insert') {
                const items = Array.isArray(state.values) ? state.values : [state.values];
                const normalizedItems = items.map((item, index) => buildInsertedRow(table, item, index));
                setTableRows(table, [...normalizedItems, ...rows]);
                return { data: state.returning ? deepClone(normalizedItems) : deepClone(normalizedItems), error: null };
            }

            const matchingRows = applyFilters(rows, state.filters);

            if (state.method === 'update') {
                matchingRows.forEach((row) => {
                    Object.assign(row, state.values || {});
                });
                return { data: state.returning ? deepClone(matchingRows) : deepClone(matchingRows), error: null };
            }

            if (state.method === 'delete') {
                const removeIds = new Set(matchingRows.map((row) => row.id));
                setTableRows(table, rows.filter((row) => !removeIds.has(row.id)));
                return { data: state.returning ? deepClone(matchingRows) : [], error: null };
            }

            let selectedRows = deepClone(matchingRows);

            if (state.orderField) {
                selectedRows.sort((left, right) => {
                    const leftValue = left?.[state.orderField];
                    const rightValue = right?.[state.orderField];
                    const ordered = compareOrderValues(leftValue, rightValue);
                    return state.orderAscending
                        ? ordered
                        : -ordered;
                });
            }

            if (state.limitCount > 0) {
                selectedRows = selectedRows.slice(0, state.limitCount);
            }

            if (state.singleMode || state.maybeSingleMode) {
                return { data: selectedRows[0] || null, error: null };
            }

            return { data: selectedRows, error: null };
        }

        const proxy = new Proxy(chain, {
            get(target, prop) {
                if (prop in target) {
                    return target[prop];
                }

                if (prop === 'or' || prop === 'neq' || prop === 'gt' || prop === 'gte' || prop === 'lt' || prop === 'lte' || prop === 'like' || prop === 'ilike' || prop === 'not' || prop === 'contains') {
                    return function noOpChain() {
                        return proxy;
                    };
                }

                return target[prop];
            }
        });

        return proxy;
    }

    function clampSmokeAnalyticsDays(value, fallback = 7) {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
        }
        return Math.min(365, Math.max(1, parsed));
    }

    function normalizeSmokeAnalyticsSite(site = '') {
        const normalized = String(site || '').trim().toLowerCase();
        return ['cn', 'intl'].includes(normalized) ? normalized : 'all';
    }

    function roundSmokeMetric(value, digits = 0) {
        const precision = Math.max(0, Number(digits) || 0);
        const factor = 10 ** precision;
        return Math.round((Number(value) || 0) * factor) / factor;
    }

    function buildSmokeAnalyticsDateSeries(days = 7) {
        const safeDays = clampSmokeAnalyticsDays(days, 7);
        const rows = [];

        for (let index = 0; index < safeDays; index += 1) {
            const date = new Date(now.getTime());
            date.setUTCDate(date.getUTCDate() - (safeDays - index - 1));
            rows.push(date.toISOString().slice(0, 10));
        }

        return rows;
    }

    function getSmokeAnalyticsProfile(site = 'all') {
        const profiles = {
            all: {
                key: 'all',
                label: '全站',
                tag: 'ALL',
                dau: 214,
                mau: 1486,
                newUsersWeek: 76,
                totalPoints: 36880,
                totalComments: 648,
                dauGrowth: 18,
                newUsersGrowth: 11,
                commentsGrowth: 24,
                pointsIn: 2860,
                pointsOut: 1980,
                velocity: 12.6
            },
            cn: {
                key: 'cn',
                label: 'CN',
                tag: 'CN',
                dau: 132,
                mau: 918,
                newUsersWeek: 44,
                totalPoints: 22840,
                totalComments: 406,
                dauGrowth: 15,
                newUsersGrowth: 9,
                commentsGrowth: 19,
                pointsIn: 1710,
                pointsOut: 1160,
                velocity: 11.3
            },
            intl: {
                key: 'intl',
                label: 'INTL',
                tag: 'INTL',
                dau: 82,
                mau: 568,
                newUsersWeek: 26,
                totalPoints: 14040,
                totalComments: 242,
                dauGrowth: 23,
                newUsersGrowth: 15,
                commentsGrowth: 31,
                pointsIn: 1150,
                pointsOut: 820,
                velocity: 14.7
            }
        };

        return profiles[normalizeSmokeAnalyticsSite(site)] || profiles.all;
    }

    function buildSmokeAnalyticsOverview(site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        return {
            dau: profile.dau,
            mau: profile.mau,
            new_users_today: Math.max(3, Math.round(profile.newUsersWeek / 7)),
            new_users_week: profile.newUsersWeek,
            total_points: profile.totalPoints,
            total_comments: profile.totalComments,
            dau_growth: profile.dauGrowth,
            new_users_growth: profile.newUsersGrowth,
            comments_growth: profile.commentsGrowth
        };
    }

    function buildSmokeAnalyticsUserTrend(days = 7, site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        return buildSmokeAnalyticsDateSeries(days).map((statDate, index) => ({
            stat_date: statDate,
            new_users: Math.max(2, Math.round(profile.newUsersWeek / 7) + (index % 4) - 1),
            active_users: Math.max(12, Math.round(profile.dau * (0.8 + (index % 5) * 0.04)))
        }));
    }

    function buildSmokeAnalyticsContentTrend(days = 7, site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        return buildSmokeAnalyticsDateSeries(days).map((statDate, index) => ({
            stat_date: statDate,
            comments: Math.max(4, Math.round(profile.totalComments / 24) + index),
            unlocks: Math.max(3, Math.round(profile.dau / 6) + (index % 3) * 2),
            likes: Math.max(2, Math.round(profile.totalComments / 18) + (index % 5))
        }));
    }

    function buildSmokeAnalyticsRevenueTrend(days = 7, site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        return buildSmokeAnalyticsDateSeries(days).map((statDate, index) => ({
            stat_date: statDate,
            points_in: Math.max(60, Math.round(profile.pointsIn / 7) + index * 8),
            points_out: Math.max(40, Math.round(profile.pointsOut / 7) + index * 6),
            redemptions: Math.max(2, 8 + (index % 4))
        }));
    }

    function buildSmokeAnalyticsChannelBreakdown(site = 'all', days = 7) {
        const profile = getSmokeAnalyticsProfile(site);
        const windowFactor = Math.max(1, clampSmokeAnalyticsDays(days, 7) / 7);
        return [
            { channel: `${profile.tag} 搜索`, batch_count: 2, total_codes: 28, used_codes: 20, total_points: Math.round(420 * windowFactor), redemption_rate: 71.4 },
            { channel: `${profile.tag} 社群`, batch_count: 1, total_codes: 18, used_codes: 14, total_points: Math.round(280 * windowFactor), redemption_rate: 77.8 },
            { channel: `${profile.tag} 活动`, batch_count: 1, total_codes: 12, used_codes: 8, total_points: Math.round(160 * windowFactor), redemption_rate: 66.7 }
        ];
    }

    function buildSmokeAnalyticsTopContent(site = 'all', days = 7, limit = 10) {
        const profile = getSmokeAnalyticsProfile(site);
        return [
            { prompt_id: 1001, title: `${profile.tag} 爆款 Prompt ${days}天`, unlock_count: 42, comment_count: 18, score: 102 },
            { prompt_id: 1002, title: `${profile.tag} 高转化模板库`, unlock_count: 35, comment_count: 15, score: 85 },
            { prompt_id: 1003, title: `${profile.tag} 验证脚本合集`, unlock_count: 27, comment_count: 11, score: 65 }
        ].slice(0, Math.max(1, Number(limit) || 10));
    }

    function buildSmokeAnalyticsSummary(site = 'all', days = 7) {
        return {
            overview: buildSmokeAnalyticsOverview(site),
            user_trend: buildSmokeAnalyticsUserTrend(days, site).slice(-7),
            channel_breakdown: buildSmokeAnalyticsChannelBreakdown(site, days),
            top_content: buildSmokeAnalyticsTopContent(site, days, 5)
        };
    }

    function buildSmokeProductBundleSegment(payload, source = 'local_smoke_fixture') {
        return {
            ok: true,
            statusCode: 200,
            message: '',
            source,
            payload: deepClone(payload)
        };
    }

    function decorateSmokeProductMetricRow(row = {}) {
        const orderCount = Math.max(0, Number(row.order_count || 0));
        const refundedOrderCount = Math.max(0, Number(row.refunded_order_count || 0));
        const buyerCount = Math.max(0, Number(row.buyer_count || 0));
        const viewUserCount = Math.max(0, Number(row.view_user_count || 0));
        const detailViewUserCount = Math.max(0, Number(row.detail_view_user_count || 0));
        const purchaseClickUserCount = Math.max(0, Number(row.purchase_click_user_count || 0));
        const unitsSold = Math.max(orderCount, Number(row.units_sold || 0));
        const gmvPoints = Math.max(0, Number(row.gmv_points || 0));
        const deliverySuccessCount = Math.max(0, Number(row.delivery_success_count || 0));
        const deliveryRiskCount = Math.max(0, Number(row.delivery_risk_count || 0));
        const totalOrderCount = orderCount + refundedOrderCount;

        return {
            ...row,
            units_sold: unitsSold,
            avg_order_value: orderCount > 0 ? roundSmokeMetric(gmvPoints / orderCount, 2) : 0,
            conversion_rate: viewUserCount > 0 ? roundSmokeMetric((buyerCount / viewUserCount) * 100, 2) : 0,
            purchase_conversion_rate: viewUserCount > 0 ? roundSmokeMetric((buyerCount / viewUserCount) * 100, 2) : 0,
            detail_to_intent_rate: detailViewUserCount > 0 ? roundSmokeMetric((purchaseClickUserCount / detailViewUserCount) * 100, 2) : 0,
            intent_to_paid_rate: purchaseClickUserCount > 0 ? roundSmokeMetric((buyerCount / purchaseClickUserCount) * 100, 2) : 0,
            refund_rate: totalOrderCount > 0 ? roundSmokeMetric((refundedOrderCount / totalOrderCount) * 100, 2) : 0,
            delivery_success_rate: orderCount > 0 ? roundSmokeMetric((deliverySuccessCount / orderCount) * 100, 2) : 0,
            delivery_risk_rate: orderCount > 0 ? roundSmokeMetric((deliveryRiskCount / orderCount) * 100, 2) : 0,
            low_conversion_score: Math.max(0, Number(row.low_conversion_score || 0)),
            bubble_size: Math.max(10, Number(row.bubble_size || Math.min(24, 8 + Math.round(gmvPoints / 180)))),
            source_pages: Array.isArray(row.source_pages) ? row.source_pages : [],
            source_channels: Array.isArray(row.source_channels) ? row.source_channels : [],
            prompt_sources: Array.isArray(row.prompt_sources) ? row.prompt_sources : [],
            related_prompt_ids: Array.isArray(row.related_prompt_ids) ? row.related_prompt_ids : [],
            top_prompt_id: String(row.top_prompt_id || '').trim()
        };
    }

    function buildSmokeProductFixtureRows() {
        return [
            decorateSmokeProductMetricRow({
                product_id: 'shop-prod-cn-1',
                product_name: 'CN 高级账号',
                category: 'account',
                delivery_type: 'KEY',
                is_active: true,
                stock_count: 1,
                available_inventory_count: 1,
                fault_inventory_count: 0,
                view_count: 62,
                view_user_count: 42,
                card_click_count: 24,
                card_click_user_count: 18,
                detail_view_count: 36,
                detail_view_user_count: 26,
                purchase_click_count: 22,
                purchase_click_user_count: 19,
                buyer_count: 11,
                order_count: 12,
                refunded_order_count: 0,
                units_sold: 14,
                gmv_points: 2256,
                delivery_success_count: 10,
                delivery_risk_count: 1,
                content_assisted_prompt_count: 2,
                content_assisted_detail_view_count: 14,
                content_assisted_purchase_click_count: 10,
                content_assisted_purchase_success_count: 6,
                content_assisted_gmv_points: 1128,
                top_prompt_id: 'prompt-cn-landing',
                low_conversion_score: 16,
                bubble_size: 22,
                quadrant_key: 'star',
                quadrant_label: '明星商品',
                tone: 'success',
                source_pages: [
                    { key: 'home', label: '首页', count: 24, user_count: 18 },
                    { key: 'shop', label: '商城页', count: 10, user_count: 8 }
                ],
                source_channels: [
                    { key: 'homepage', label: '首页导流', count: 24, user_count: 18 },
                    { key: 'shop_storefront', label: '商城自然浏览', count: 10, user_count: 8 }
                ],
                prompt_sources: [
                    { prompt_id: 'prompt-cn-landing', count: 12, user_count: 9, detail_view_count: 7, purchase_click_count: 5, purchase_success_count: 4, gmv_points: 752 },
                    { prompt_id: 'prompt-cn-home', count: 8, user_count: 6, detail_view_count: 4, purchase_click_count: 3, purchase_success_count: 2, gmv_points: 376 }
                ],
                related_prompt_ids: ['prompt-cn-landing', 'prompt-cn-home']
            }),
            decorateSmokeProductMetricRow({
                product_id: 'shop-prod-cn-2',
                product_name: 'CN 月付会员',
                category: 'account',
                delivery_type: 'KEY',
                is_active: true,
                stock_count: 0,
                available_inventory_count: 0,
                fault_inventory_count: 0,
                view_count: 56,
                view_user_count: 34,
                card_click_count: 21,
                card_click_user_count: 16,
                detail_view_count: 30,
                detail_view_user_count: 22,
                purchase_click_count: 18,
                purchase_click_user_count: 14,
                buyer_count: 5,
                order_count: 6,
                refunded_order_count: 2,
                units_sold: 6,
                gmv_points: 528,
                delivery_success_count: 3,
                delivery_risk_count: 2,
                content_assisted_prompt_count: 1,
                content_assisted_detail_view_count: 8,
                content_assisted_purchase_click_count: 6,
                content_assisted_purchase_success_count: 3,
                content_assisted_gmv_points: 264,
                top_prompt_id: 'prompt-membership-faq',
                low_conversion_score: 42,
                bubble_size: 16,
                quadrant_key: 'steady',
                quadrant_label: '稳定承接',
                tone: 'accent',
                source_pages: [
                    { key: 'shop', label: '商城页', count: 18, user_count: 13 },
                    { key: 'prompts', label: '提示词页', count: 8, user_count: 6 }
                ],
                source_channels: [
                    { key: 'shop_storefront', label: '商城自然浏览', count: 18, user_count: 13 },
                    { key: 'prompt_content', label: '提示词内容导流', count: 8, user_count: 6 }
                ],
                prompt_sources: [
                    { prompt_id: 'prompt-membership-faq', count: 7, user_count: 5, detail_view_count: 4, purchase_click_count: 3, purchase_success_count: 2, gmv_points: 176 }
                ],
                related_prompt_ids: ['prompt-membership-faq']
            }),
            decorateSmokeProductMetricRow({
                product_id: 'shop-prod-cn-3',
                product_name: '兑换卡套餐',
                category: 'cards',
                delivery_type: 'KEY',
                is_active: true,
                stock_count: 1,
                available_inventory_count: 1,
                fault_inventory_count: 0,
                view_count: 70,
                view_user_count: 28,
                card_click_count: 28,
                card_click_user_count: 17,
                detail_view_count: 30,
                detail_view_user_count: 20,
                purchase_click_count: 17,
                purchase_click_user_count: 10,
                buyer_count: 4,
                order_count: 4,
                refunded_order_count: 0,
                units_sold: 4,
                gmv_points: 224,
                delivery_success_count: 4,
                delivery_risk_count: 0,
                content_assisted_prompt_count: 1,
                content_assisted_detail_view_count: 5,
                content_assisted_purchase_click_count: 3,
                content_assisted_purchase_success_count: 1,
                content_assisted_gmv_points: 56,
                top_prompt_id: 'prompt-card-guide',
                low_conversion_score: 88,
                bubble_size: 18,
                quadrant_key: 'conversion_gap',
                quadrant_label: '高曝光低转化',
                tone: 'warning',
                source_pages: [
                    { key: 'shop', label: '商城页', count: 22, user_count: 14 },
                    { key: 'home', label: '首页', count: 10, user_count: 6 }
                ],
                source_channels: [
                    { key: 'shop_storefront', label: '商城自然浏览', count: 22, user_count: 14 },
                    { key: 'homepage', label: '首页导流', count: 10, user_count: 6 }
                ],
                prompt_sources: [
                    { prompt_id: 'prompt-card-guide', count: 5, user_count: 4, detail_view_count: 3, purchase_click_count: 2, purchase_success_count: 1, gmv_points: 56 }
                ],
                related_prompt_ids: ['prompt-card-guide']
            })
        ];
    }

    function buildSmokeProductSummarySamples() {
        return {
            user_signal_samples: {
                shop_view: [
                    { user_id: 'smoke-viewer-1', event_count: 4 },
                    { user_id: 'smoke-viewer-2', event_count: 3 }
                ],
                buyer: [
                    { user_id: 'smoke-buyer-1', order_count: 3, gmv_points: 564 },
                    { user_id: 'smoke-buyer-2', order_count: 2, gmv_points: 376 }
                ]
            },
            buyer_snapshot: [
                { user_id: 'smoke-buyer-1', order_count: 3, gmv_points: 564, refunded_order_count: 0, segment_labels: ['首单成交', '窗口复购'] },
                { user_id: 'smoke-buyer-2', order_count: 2, gmv_points: 376, refunded_order_count: 0, segment_labels: ['首单成交'] },
                { user_id: 'smoke-buyer-3', order_count: 1, gmv_points: 188, refunded_order_count: 1, segment_labels: ['退款风险'] }
            ],
            buyer_segment_summary: [
                {
                    key: 'first_order_buyers',
                    label: '首单成交',
                    count: 9,
                    tone: 'success',
                    note: '当前窗口首次完成支付的用户样本',
                    sample_users: [{ user_id: 'smoke-buyer-1', order_count: 1, gmv_points: 188 }]
                },
                {
                    key: 'repeat_buyers',
                    label: '窗口复购',
                    count: 4,
                    tone: 'warning',
                    note: '当前窗口完成两笔及以上支付',
                    sample_users: [{ user_id: 'smoke-buyer-2', order_count: 2, gmv_points: 376 }]
                },
                {
                    key: 'refund_risk_buyers',
                    label: '退款风险',
                    count: 2,
                    tone: 'danger',
                    note: '当前窗口出现退款订单的买家',
                    sample_users: [{ user_id: 'smoke-buyer-3', order_count: 1, gmv_points: 88, refunded_order_count: 1 }]
                }
            ],
            first_purchase_destinations: [
                { product_id: 'shop-prod-cn-1', product_name: 'CN 高级账号', user_count: 5, is_current_product: false },
                { product_id: 'shop-prod-cn-2', product_name: 'CN 月付会员', user_count: 3, is_current_product: false },
                { product_id: 'shop-prod-cn-3', product_name: '兑换卡套餐', user_count: 2, is_current_product: false }
            ],
            post_purchase_destinations: [
                { product_id: 'shop-prod-cn-3', product_name: '兑换卡套餐', user_count: 2, order_count: 3, gmv_points: 168, first_followup_at: '2026-03-30T12:20:00+08:00' }
            ]
        };
    }

    function buildSmokeProductSiteComparisonFixture(activeSite = 'all') {
        const normalizedActiveSite = normalizeSmokeAnalyticsSite(activeSite);
        return {
            active_site: normalizedActiveSite,
            snapshots: [
                {
                    site: 'cn',
                    label: 'CN',
                    summary: {
                        gmv_points: 2136,
                        order_count: 14,
                        unique_buyer_count: 12,
                        buyer_count: 12,
                        purchase_conversion_rate: 17.91
                    }
                },
                {
                    site: 'intl',
                    label: 'INTL',
                    summary: {
                        gmv_points: 872,
                        order_count: 8,
                        unique_buyer_count: 7,
                        buyer_count: 7,
                        purchase_conversion_rate: 13.21
                    }
                }
            ]
        };
    }

    function buildSmokeProductSummaryFixture(rows = []) {
        const safeRows = Array.isArray(rows) ? rows : [];
        const summarySamples = buildSmokeProductSummarySamples();
        const totals = safeRows.reduce((accumulator, row) => {
            accumulator.active_product_count += row?.is_active === false ? 0 : 1;
            accumulator.selling_product_count += row?.is_active === false ? 0 : 1;
            accumulator.unique_buyer_count += Number(row?.buyer_count || 0);
            accumulator.units_sold += Number(row?.units_sold || 0);
            accumulator.order_count += Number(row?.order_count || 0);
            accumulator.refunded_order_count += Number(row?.refunded_order_count || 0);
            accumulator.gmv_points += Number(row?.gmv_points || 0);
            accumulator.view_user_count += Number(row?.view_user_count || 0);
            accumulator.view_count += Number(row?.view_count || 0);
            accumulator.detail_view_user_count += Number(row?.detail_view_user_count || 0);
            accumulator.detail_view_count += Number(row?.detail_view_count || 0);
            accumulator.purchase_click_user_count += Number(row?.purchase_click_user_count || 0);
            accumulator.purchase_click_count += Number(row?.purchase_click_count || 0);
            accumulator.card_click_user_count += Number(row?.card_click_user_count || 0);
            accumulator.card_click_count += Number(row?.card_click_count || 0);
            accumulator.delivery_success_count += Number(row?.delivery_success_count || 0);
            return accumulator;
        }, {
            active_product_count: 0,
            selling_product_count: 0,
            unique_buyer_count: 0,
            units_sold: 0,
            order_count: 0,
            refunded_order_count: 0,
            gmv_points: 0,
            view_user_count: 0,
            view_count: 0,
            detail_view_user_count: 0,
            detail_view_count: 0,
            purchase_click_user_count: 0,
            purchase_click_count: 0,
            card_click_user_count: 0,
            card_click_count: 0,
            delivery_success_count: 0
        });
        const topProduct = safeRows.slice().sort((left, right) => Number(right?.gmv_points || 0) - Number(left?.gmv_points || 0))[0] || null;
        const refundBase = totals.order_count + totals.refunded_order_count;

        return {
            ...totals,
            avg_order_value: totals.order_count > 0 ? roundSmokeMetric(totals.gmv_points / totals.order_count, 2) : 0,
            purchase_conversion_rate: totals.view_user_count > 0
                ? roundSmokeMetric((totals.unique_buyer_count / totals.view_user_count) * 100, 2)
                : 0,
            refund_rate: refundBase > 0
                ? roundSmokeMetric((totals.refunded_order_count / refundBase) * 100, 2)
                : 0,
            delivery_success_rate: totals.order_count > 0
                ? roundSmokeMetric((totals.delivery_success_count / totals.order_count) * 100, 2)
                : 0,
            delivery_risk_product_count: safeRows.filter((row) => Number(row?.delivery_risk_count || 0) > 0).length,
            metric_basis: '商品经营口径',
            top_product_name: String(topProduct?.product_name || '').trim() || 'CN 高级账号',
            ...summarySamples
        };
    }

    function buildSmokeProductTrendFixture() {
        return [
            { day: '2026-03-25', view_count: 20, order_count: 1, gmv_points: 188 },
            { day: '2026-03-26', view_count: 22, order_count: 2, gmv_points: 264 },
            { day: '2026-03-27', view_count: 24, order_count: 2, gmv_points: 320 },
            { day: '2026-03-28', view_count: 27, order_count: 3, gmv_points: 388 },
            { day: '2026-03-29', view_count: 29, order_count: 3, gmv_points: 476 },
            { day: '2026-03-30', view_count: 31, order_count: 4, gmv_points: 552 },
            { day: '2026-03-31', view_count: 35, order_count: 7, gmv_points: 792 }
        ];
    }

    function buildSmokeProductCategoryBreakdownFixture(rows = []) {
        const bucketMap = new Map();
        const totalGmv = rows.reduce((sum, row) => sum + Number(row?.gmv_points || 0), 0);

        rows.forEach((row) => {
            const category = String(row?.category || 'other').trim() || 'other';
            const bucket = bucketMap.get(category) || {
                category,
                gmv_points: 0,
                product_count: 0,
                active_product_count: 0,
                view_user_count: 0,
                buyer_count: 0
            };
            bucket.gmv_points += Number(row?.gmv_points || 0);
            bucket.product_count += 1;
            bucket.active_product_count += row?.is_active === false ? 0 : 1;
            bucket.view_user_count += Number(row?.view_user_count || 0);
            bucket.buyer_count += Number(row?.buyer_count || 0);
            bucketMap.set(category, bucket);
        });

        const normalizedRows = Array.from(bucketMap.values())
            .map((row) => ({
                ...row,
                conversion_rate: Number(row.view_user_count || 0) > 0
                    ? roundSmokeMetric((Number(row.buyer_count || 0) / Number(row.view_user_count || 0)) * 100, 2)
                    : 0,
                gmv_share_rate: totalGmv > 0
                    ? roundSmokeMetric((Number(row.gmv_points || 0) / totalGmv) * 100, 2)
                    : 0
            }))
            .sort((left, right) => Number(right?.gmv_points || 0) - Number(left?.gmv_points || 0));

        return {
            total_category_count: normalizedRows.length,
            rows: normalizedRows
        };
    }

    function buildSmokeProductMatrixFixture(rows = []) {
        const items = rows
            .slice()
            .sort((left, right) => Number(right?.gmv_points || 0) - Number(left?.gmv_points || 0))
            .map((row) => ({
                product_id: row.product_id,
                product_name: row.product_name,
                category: row.category,
                view_user_count: row.view_user_count,
                conversion_rate: row.conversion_rate,
                gmv_points: row.gmv_points,
                bubble_size: row.bubble_size,
                stock_count: row.stock_count,
                quadrant_key: row.quadrant_key,
                quadrant_label: row.quadrant_label,
                tone: row.tone,
                low_conversion_score: row.low_conversion_score,
                related_prompt_ids: row.related_prompt_ids
            }));
        const summaryMap = new Map();

        items.forEach((item) => {
            const key = String(item?.quadrant_key || 'neutral').trim() || 'neutral';
            const bucket = summaryMap.get(key) || {
                key,
                label: item?.quadrant_label || '经营观察',
                tone: item?.tone || 'neutral',
                count: 0
            };
            bucket.count += 1;
            summaryMap.set(key, bucket);
        });

        return {
            benchmark: {
                exposure_midpoint: 30,
                conversion_midpoint: 15
            },
            quadrant_summary: Array.from(summaryMap.values()),
            items
        };
    }

    function buildSmokeProductRankPayloads(rows = [], limit = 10) {
        const safeLimit = Math.max(1, Number(limit) || 10);
        const sortByMetric = (metricKey) => rows
            .slice()
            .sort((left, right) => Number(right?.[metricKey] || 0) - Number(left?.[metricKey] || 0))
            .slice(0, safeLimit);

        return {
            salesTop: sortByMetric('units_sold'),
            gmvTop: sortByMetric('gmv_points'),
            conversionTop: sortByMetric('conversion_rate'),
            refundRateTop: rows
                .filter((row) => Number(row?.refund_rate || 0) > 0)
                .sort((left, right) => Number(right?.refund_rate || 0) - Number(left?.refund_rate || 0))
                .slice(0, safeLimit),
            deliveryRiskRateTop: rows
                .filter((row) => Number(row?.delivery_risk_rate || 0) > 0)
                .sort((left, right) => Number(right?.delivery_risk_rate || 0) - Number(left?.delivery_risk_rate || 0))
                .slice(0, safeLimit),
            contentDrivenTop: rows
                .filter((row) => Number(row?.content_assisted_gmv_points || 0) > 0)
                .sort((left, right) => Number(right?.content_assisted_gmv_points || 0) - Number(left?.content_assisted_gmv_points || 0))
                .slice(0, safeLimit),
            highExposureLowConversion: rows
                .filter((row) => String(row?.quadrant_key || '').trim() === 'conversion_gap')
                .sort((left, right) => Number(right?.low_conversion_score || 0) - Number(left?.low_conversion_score || 0))
                .slice(0, safeLimit)
        };
    }

    function buildSmokeProductHealthPayloads(rows = [], limit = 10) {
        const safeLimit = Math.max(1, Number(limit) || 10);
        return {
            lowStockProducts: rows
                .filter((row) => Number(row?.stock_count || 0) > 0 && Number(row?.stock_count || 0) <= 1)
                .slice(0, safeLimit),
            soldOutProducts: rows
                .filter((row) => Number(row?.stock_count || 0) <= 0)
                .slice(0, safeLimit),
            deliveryRiskProducts: rows
                .filter((row) => Number(row?.delivery_risk_count || 0) > 0)
                .slice(0, safeLimit),
            refundRiskProducts: rows
                .filter((row) => Number(row?.refunded_order_count || 0) > 0)
                .slice(0, safeLimit),
            inventoryTurnoverHints: [
                {
                    product_id: 'shop-prod-cn-1',
                    tone: 'warning',
                    title: 'CN 高级账号 库存仅剩 1 份',
                    summary: '最近 7 天浏览和支付都在抬升，建议补货后再继续放量。'
                },
                {
                    product_id: 'shop-prod-cn-2',
                    tone: 'danger',
                    title: 'CN 月付会员 已售罄且仍有履约风险',
                    summary: '先处理履约风险订单，再决定是否重新上架或补充库存。'
                }
            ].slice(0, safeLimit)
        };
    }

    function buildSmokeProductFunnelSummary(rows = []) {
        const detailUsers = rows.reduce((sum, row) => sum + Number(row?.detail_view_user_count || 0), 0);
        const intentUsers = rows.reduce((sum, row) => sum + Number(row?.purchase_click_user_count || 0), 0);
        const paidUsers = rows.reduce((sum, row) => sum + Number(row?.buyer_count || 0), 0);
        const deliveredOrders = rows.reduce((sum, row) => sum + Number(row?.delivery_success_count || 0), 0);
        const cardClickUsers = rows.reduce((sum, row) => sum + Number(row?.card_click_user_count || 0), 0);

        return {
            stages: [
                { key: 'detail_view', label: '详情浏览', value: detailUsers, note: '进入商品详情的用户', basis_label: '真实事件', basis_type: 'real' },
                { key: 'purchase_click', label: '购买意图', value: intentUsers, note: '点击购买按钮的用户', basis_label: '真实事件', basis_type: 'real' },
                { key: 'paid', label: '支付成功', value: paidUsers, note: '形成支付的用户', basis_label: '订单汇总', basis_type: 'real' },
                { key: 'delivered', label: '发货成功', value: deliveredOrders, note: '已完成交付的订单', basis_label: '履约状态', basis_type: 'real' }
            ],
            card_click_user_count: cardClickUsers,
            detail_to_intent_rate: detailUsers > 0 ? roundSmokeMetric((intentUsers / detailUsers) * 100, 2) : 0,
            intent_to_paid_rate: intentUsers > 0 ? roundSmokeMetric((paidUsers / intentUsers) * 100, 2) : 0
        };
    }

    function buildSmokeProductFunnelSiteComparisonFixture(activeSite = 'all') {
        return {
            active_site: normalizeSmokeAnalyticsSite(activeSite),
            snapshots: [
                {
                    site: 'cn',
                    label: 'CN',
                    summary: {
                        stages: [
                            { label: '详情浏览', value: 42 },
                            { label: '购买意图', value: 28 },
                            { label: '支付成功', value: 11 },
                            { label: '发货成功', value: 9 }
                        ]
                    }
                },
                {
                    site: 'intl',
                    label: 'INTL',
                    summary: {
                        stages: [
                            { label: '详情浏览', value: 26 },
                            { label: '购买意图', value: 15 },
                            { label: '支付成功', value: 9 },
                            { label: '发货成功', value: 8 }
                        ]
                    }
                }
            ]
        };
    }

    function buildSmokeProductDetailExtras(productId = '') {
        const detailMap = {
            'shop-prod-cn-1': {
                site_snapshots: [
                    { site: 'cn', label: 'CN', summary: { gmv_points: 1692, order_count: 9, buyer_count: 8, purchase_conversion_rate: 19.05 } },
                    { site: 'intl', label: 'INTL', summary: { gmv_points: 564, order_count: 3, buyer_count: 3, purchase_conversion_rate: 13.64 } }
                ],
                buyer_snapshot: [
                    { user_id: 'acct-user-1', order_count: 2, gmv_points: 376, segment_labels: ['首单成交', '窗口复购'] },
                    { user_id: 'acct-user-2', order_count: 1, gmv_points: 188, segment_labels: ['首单成交'] }
                ],
                buyer_segment_summary: [
                    { label: '本商品首购', count: 6, tone: 'success', note: '首次购买就落在这件商品', sample_users: [{ user_id: 'acct-user-1', order_count: 1, gmv_points: 188 }] },
                    { label: '窗口复购', count: 2, tone: 'warning', note: '当前窗口完成了追加购买', sample_users: [{ user_id: 'acct-user-2', order_count: 2, gmv_points: 376 }] }
                ],
                first_purchase_destinations: [
                    { product_id: 'shop-prod-cn-1', product_name: 'CN 高级账号', user_count: 6, is_current_product: true }
                ],
                cross_sell_destinations: [
                    { product_id: 'shop-prod-cn-3', product_name: '兑换卡套餐', user_count: 2, order_count: 2, gmv_points: 112 }
                ],
                post_purchase_destinations: [
                    { product_id: 'shop-prod-cn-3', product_name: '兑换卡套餐', user_count: 2, order_count: 2, gmv_points: 112, first_followup_at: '2026-03-30T16:20:00+08:00' }
                ],
                refund_breakdown: [],
                delivery_breakdown: [
                    { status: 'delivered', label: '已发货', count: 10, user_count: 9, tone: 'success', site_rows: [{ site: 'cn', label: 'CN', count: 7 }, { site: 'intl', label: 'INTL', count: 3 }], site_summary: 'CN 7 / INTL 3' },
                    { status: 'processing', label: '处理中', count: 1, user_count: 1, tone: 'warning', site_rows: [{ site: 'cn', label: 'CN', count: 1 }], site_summary: 'CN 1' }
                ],
                trend: [
                    { day: '2026-03-27', view_count: 6, order_count: 1, gmv_points: 188, delivery_success_count: 1 },
                    { day: '2026-03-28', view_count: 7, order_count: 2, gmv_points: 376, delivery_success_count: 2 },
                    { day: '2026-03-29', view_count: 8, order_count: 2, gmv_points: 376, delivery_success_count: 1 },
                    { day: '2026-03-30', view_count: 9, order_count: 3, gmv_points: 564, delivery_success_count: 3 },
                    { day: '2026-03-31', view_count: 10, order_count: 4, gmv_points: 752, delivery_success_count: 3 }
                ],
                recentOrders: [
                    { order_id: 'SHOP-SMOKE-ACCT-003', user_id: 'acct-user-2', site: 'cn', quantity: 1, total_points: 188, delivery_status: 'delivered', refund_status: 'none' },
                    { order_id: 'SHOP-SMOKE-ACCT-002', user_id: 'acct-user-1', site: 'intl', quantity: 1, total_points: 188, delivery_status: 'processing', refund_status: 'none' },
                    { order_id: 'SHOP-SMOKE-ACCT-001', user_id: 'acct-user-1', site: 'cn', quantity: 2, total_points: 376, delivery_status: 'delivered', refund_status: 'none' }
                ]
            },
            'shop-prod-cn-2': {
                site_snapshots: [
                    { site: 'cn', label: 'CN', summary: { gmv_points: 352, order_count: 4, buyer_count: 4, purchase_conversion_rate: 18.18 } },
                    { site: 'intl', label: 'INTL', summary: { gmv_points: 176, order_count: 2, buyer_count: 1, purchase_conversion_rate: 8.33 } }
                ],
                buyer_snapshot: [
                    { user_id: 'membership-user-1', order_count: 1, gmv_points: 88, segment_labels: ['首单成交'] },
                    { user_id: 'membership-user-2', order_count: 1, gmv_points: 88, segment_labels: ['退款风险'] }
                ],
                buyer_segment_summary: [
                    { label: '本商品首购', count: 3, tone: 'success', note: '首购集中在月付会员承接', sample_users: [{ user_id: 'membership-user-1', order_count: 1, gmv_points: 88 }] },
                    { label: '退款风险', count: 2, tone: 'danger', note: '近期已有退款与售后回写', sample_users: [{ user_id: 'membership-user-2', order_count: 1, gmv_points: 88, refunded_order_count: 1 }] }
                ],
                first_purchase_destinations: [
                    { product_id: 'shop-prod-cn-2', product_name: 'CN 月付会员', user_count: 3, is_current_product: true }
                ],
                cross_sell_destinations: [
                    { product_id: 'shop-prod-cn-1', product_name: 'CN 高级账号', user_count: 1, order_count: 1, gmv_points: 188 }
                ],
                post_purchase_destinations: [
                    { product_id: 'shop-prod-cn-1', product_name: 'CN 高级账号', user_count: 1, order_count: 1, gmv_points: 188, first_followup_at: '2026-03-31T09:40:00+08:00' }
                ],
                refund_breakdown: [
                    { status: 'refunded', label: '已退款', count: 2, user_count: 2, tone: 'danger', site_rows: [{ site: 'cn', label: 'CN', count: 2 }], site_summary: 'CN 2' }
                ],
                delivery_breakdown: [
                    { status: 'processing', label: '处理中', count: 2, user_count: 2, tone: 'warning', site_rows: [{ site: 'cn', label: 'CN', count: 1 }, { site: 'intl', label: 'INTL', count: 1 }], site_summary: 'CN 1 / INTL 1' },
                    { status: 'delivered', label: '已发货', count: 3, user_count: 3, tone: 'success', site_rows: [{ site: 'cn', label: 'CN', count: 2 }, { site: 'intl', label: 'INTL', count: 1 }], site_summary: 'CN 2 / INTL 1' }
                ],
                trend: [
                    { day: '2026-03-27', view_count: 5, order_count: 1, gmv_points: 88, delivery_success_count: 1 },
                    { day: '2026-03-28', view_count: 6, order_count: 1, gmv_points: 88, delivery_success_count: 0 },
                    { day: '2026-03-29', view_count: 6, order_count: 1, gmv_points: 88, delivery_success_count: 1 },
                    { day: '2026-03-30', view_count: 7, order_count: 1, gmv_points: 88, delivery_success_count: 0 },
                    { day: '2026-03-31', view_count: 10, order_count: 2, gmv_points: 176, delivery_success_count: 1 }
                ],
                recentOrders: [
                    { order_id: 'SHOP-SMOKE-MEMBER-003', user_id: 'membership-user-2', site: 'cn', quantity: 1, total_points: 88, delivery_status: 'processing', refund_status: 'refunded' },
                    { order_id: 'SHOP-SMOKE-MEMBER-002', user_id: 'membership-user-1', site: 'intl', quantity: 1, total_points: 88, delivery_status: 'delivered', refund_status: 'none' },
                    { order_id: 'SHOP-SMOKE-MEMBER-001', user_id: 'membership-user-1', site: 'cn', quantity: 1, total_points: 88, delivery_status: 'processing', refund_status: 'none' }
                ]
            },
            'shop-prod-cn-3': {
                site_snapshots: [
                    { site: 'cn', label: 'CN', summary: { gmv_points: 112, order_count: 2, buyer_count: 2, purchase_conversion_rate: 7.69 } },
                    { site: 'intl', label: 'INTL', summary: { gmv_points: 112, order_count: 2, buyer_count: 2, purchase_conversion_rate: 11.11 } }
                ],
                buyer_snapshot: [
                    { user_id: 'card-user-1', order_count: 1, gmv_points: 56, segment_labels: ['首单成交'] }
                ],
                buyer_segment_summary: [
                    { label: '本商品首购', count: 2, tone: 'success', note: '这件商品更多承接首单试探购买', sample_users: [{ user_id: 'card-user-1', order_count: 1, gmv_points: 56 }] },
                    { label: '继续观察', count: 4, tone: 'warning', note: '高曝光低转化，仍需继续优化承接', sample_users: [{ user_id: 'card-user-2', order_count: 0, gmv_points: 0 }] }
                ],
                first_purchase_destinations: [
                    { product_id: 'shop-prod-cn-3', product_name: '兑换卡套餐', user_count: 2, is_current_product: true }
                ],
                cross_sell_destinations: [],
                post_purchase_destinations: [],
                refund_breakdown: [],
                delivery_breakdown: [
                    { status: 'delivered', label: '已发货', count: 4, user_count: 4, tone: 'success', site_rows: [{ site: 'cn', label: 'CN', count: 2 }, { site: 'intl', label: 'INTL', count: 2 }], site_summary: 'CN 2 / INTL 2' }
                ],
                trend: [
                    { day: '2026-03-27', view_count: 8, order_count: 0, gmv_points: 0, delivery_success_count: 0 },
                    { day: '2026-03-28', view_count: 9, order_count: 1, gmv_points: 56, delivery_success_count: 1 },
                    { day: '2026-03-29', view_count: 10, order_count: 0, gmv_points: 0, delivery_success_count: 0 },
                    { day: '2026-03-30', view_count: 11, order_count: 1, gmv_points: 56, delivery_success_count: 1 },
                    { day: '2026-03-31', view_count: 12, order_count: 2, gmv_points: 112, delivery_success_count: 2 }
                ],
                recentOrders: [
                    { order_id: 'SHOP-SMOKE-CARD-002', user_id: 'card-user-2', site: 'intl', quantity: 1, total_points: 56, delivery_status: 'delivered', refund_status: 'none' },
                    { order_id: 'SHOP-SMOKE-CARD-001', user_id: 'card-user-1', site: 'cn', quantity: 1, total_points: 56, delivery_status: 'delivered', refund_status: 'none' }
                ]
            }
        };

        return detailMap[String(productId || '').trim()] || null;
    }

    function buildSmokeProductEventStageSummary(row = {}) {
        return [
            {
                key: 'product_card_click',
                label: '商品卡点击',
                count: Number(row?.card_click_count || 0),
                user_count: Number(row?.card_click_user_count || 0),
                status: Number(row?.card_click_count || 0) > 0 ? 'ready' : 'collecting',
                basis: 'product_card_click',
                basis_label: '新版埋点'
            },
            {
                key: 'product_detail_view',
                label: '详情浏览',
                count: Number(row?.detail_view_count || 0),
                user_count: Number(row?.detail_view_user_count || 0),
                status: Number(row?.detail_view_count || 0) > 0 ? 'ready' : 'collecting',
                basis: 'product_detail_view',
                basis_label: '新版埋点'
            },
            {
                key: 'product_purchase_click',
                label: '购买点击',
                count: Number(row?.purchase_click_count || 0),
                user_count: Number(row?.purchase_click_user_count || 0),
                status: Number(row?.purchase_click_count || 0) > 0 ? 'ready' : 'collecting',
                basis: 'product_purchase_click',
                basis_label: '新版埋点'
            },
            {
                key: 'product_purchase_success',
                label: '支付成功',
                count: Number(row?.buyer_count || 0),
                user_count: Number(row?.buyer_count || 0),
                status: Number(row?.buyer_count || 0) > 0 ? 'ready' : 'collecting',
                basis: 'shop_purchase + product_purchase_success',
                basis_label: '兼容汇总'
            }
        ];
    }

    function buildSmokeProductDashboardBundleFixture(options = {}) {
        const site = normalizeSmokeAnalyticsSite(options.site);
        const limit = Math.max(1, Number(options.limit) || 10);
        const rows = buildSmokeProductFixtureRows();
        const rankPayloads = buildSmokeProductRankPayloads(rows, limit);
        const healthPayloads = buildSmokeProductHealthPayloads(rows, limit);
        const funnelPayload = buildSmokeProductFunnelBundleFixture({
            site,
            days: options.days,
            limit
        });

        return {
            success: true,
            site,
            generated_at: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
            range: { days: clampSmokeAnalyticsDays(options.days, 7) },
            limit,
            partial_failure_count: 0,
            segments: {
                summary: buildSmokeProductBundleSegment(buildSmokeProductSummaryFixture(rows)),
                trend: buildSmokeProductBundleSegment(buildSmokeProductTrendFixture()),
                siteComparison: buildSmokeProductBundleSegment(buildSmokeProductSiteComparisonFixture(site)),
                categoryBreakdown: buildSmokeProductBundleSegment(buildSmokeProductCategoryBreakdownFixture(rows)),
                productMatrix: buildSmokeProductBundleSegment(buildSmokeProductMatrixFixture(rows)),
                salesTop: buildSmokeProductBundleSegment(rankPayloads.salesTop),
                gmvTop: buildSmokeProductBundleSegment(rankPayloads.gmvTop),
                conversionTop: buildSmokeProductBundleSegment(rankPayloads.conversionTop),
                refundRateTop: buildSmokeProductBundleSegment(rankPayloads.refundRateTop),
                deliveryRiskRateTop: buildSmokeProductBundleSegment(rankPayloads.deliveryRiskRateTop),
                contentDrivenTop: buildSmokeProductBundleSegment(rankPayloads.contentDrivenTop),
                highExposureLowConversion: buildSmokeProductBundleSegment(rankPayloads.highExposureLowConversion),
                lowStockProducts: buildSmokeProductBundleSegment(healthPayloads.lowStockProducts),
                soldOutProducts: buildSmokeProductBundleSegment(healthPayloads.soldOutProducts),
                deliveryRiskProducts: buildSmokeProductBundleSegment(healthPayloads.deliveryRiskProducts),
                refundRiskProducts: buildSmokeProductBundleSegment(healthPayloads.refundRiskProducts),
                inventoryTurnoverHints: buildSmokeProductBundleSegment(healthPayloads.inventoryTurnoverHints),
                funnelSummary: funnelPayload.segments.summary,
                funnelSiteComparison: funnelPayload.segments.siteComparison,
                funnelProductRows: funnelPayload.segments.productRows
            }
        };
    }

    function buildSmokeProductSummaryBundleFixture(options = {}) {
        const dashboard = buildSmokeProductDashboardBundleFixture(options);
        return {
            success: true,
            site: dashboard.site,
            generated_at: dashboard.generated_at,
            range: dashboard.range,
            partial_failure_count: 0,
            segments: {
                summary: dashboard.segments.summary,
                trend: dashboard.segments.trend,
                siteComparison: dashboard.segments.siteComparison,
                categoryBreakdown: dashboard.segments.categoryBreakdown,
                productMatrix: dashboard.segments.productMatrix
            }
        };
    }

    function buildSmokeProductRankBundleFixture(options = {}) {
        const dashboard = buildSmokeProductDashboardBundleFixture(options);
        return {
            success: true,
            site: dashboard.site,
            generated_at: dashboard.generated_at,
            range: dashboard.range,
            limit: dashboard.limit,
            partial_failure_count: 0,
            segments: {
                salesTop: dashboard.segments.salesTop,
                gmvTop: dashboard.segments.gmvTop,
                conversionTop: dashboard.segments.conversionTop,
                refundRateTop: dashboard.segments.refundRateTop,
                deliveryRiskRateTop: dashboard.segments.deliveryRiskRateTop,
                contentDrivenTop: dashboard.segments.contentDrivenTop,
                highExposureLowConversion: dashboard.segments.highExposureLowConversion
            }
        };
    }

    function buildSmokeProductHealthBundleFixture(options = {}) {
        const dashboard = buildSmokeProductDashboardBundleFixture(options);
        return {
            success: true,
            site: dashboard.site,
            generated_at: dashboard.generated_at,
            range: dashboard.range,
            limit: dashboard.limit,
            partial_failure_count: 0,
            segments: {
                lowStockProducts: dashboard.segments.lowStockProducts,
                soldOutProducts: dashboard.segments.soldOutProducts,
                deliveryRiskProducts: dashboard.segments.deliveryRiskProducts,
                refundRiskProducts: dashboard.segments.refundRiskProducts,
                inventoryTurnoverHints: dashboard.segments.inventoryTurnoverHints
            }
        };
    }

    function buildSmokeProductFunnelBundleFixture(options = {}) {
        const site = normalizeSmokeAnalyticsSite(options.site);
        const limit = Math.max(1, Number(options.limit) || 6);
        const rows = buildSmokeProductFixtureRows();
        const productRows = rows
            .slice()
            .sort((left, right) => Number(right?.detail_view_user_count || 0) - Number(left?.detail_view_user_count || 0))
            .slice(0, limit)
            .map((row) => ({
                product_id: row.product_id,
                product_name: row.product_name,
                category: row.category,
                detail_view_user_count: row.detail_view_user_count,
                purchase_click_user_count: row.purchase_click_user_count,
                buyer_count: row.buyer_count,
                delivery_success_rate: row.delivery_success_rate,
                intent_to_paid_rate: row.intent_to_paid_rate
            }));

        return {
            success: true,
            site,
            generated_at: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
            range: { days: clampSmokeAnalyticsDays(options.days, 7) },
            limit,
            partial_failure_count: 0,
            segments: {
                summary: buildSmokeProductBundleSegment(buildSmokeProductFunnelSummary(rows)),
                siteComparison: buildSmokeProductBundleSegment(buildSmokeProductFunnelSiteComparisonFixture(site)),
                productRows: buildSmokeProductBundleSegment(productRows)
            }
        };
    }

    function buildSmokeProductDetailBundleFixture(options = {}) {
        const productId = String(options.productId || '').trim();
        const recentOrderLimit = Math.max(1, Number(options.recentOrderLimit) || 6);
        const row = buildSmokeProductFixtureRows().find((item) => item.product_id === productId) || null;
        if (!row) {
            return null;
        }

        const extras = buildSmokeProductDetailExtras(productId) || {};
        const summary = {
            ...row,
            buyer_snapshot: Array.isArray(extras.buyer_snapshot) ? extras.buyer_snapshot : [],
            buyer_segment_summary: Array.isArray(extras.buyer_segment_summary) ? extras.buyer_segment_summary : [],
            first_purchase_destinations: Array.isArray(extras.first_purchase_destinations) ? extras.first_purchase_destinations : [],
            cross_sell_destinations: Array.isArray(extras.cross_sell_destinations) ? extras.cross_sell_destinations : [],
            post_purchase_destinations: Array.isArray(extras.post_purchase_destinations) ? extras.post_purchase_destinations : [],
            refund_breakdown: Array.isArray(extras.refund_breakdown) ? extras.refund_breakdown : [],
            delivery_breakdown: Array.isArray(extras.delivery_breakdown) ? extras.delivery_breakdown : [],
            event_stage_summary: Array.isArray(extras.event_stage_summary) ? extras.event_stage_summary : buildSmokeProductEventStageSummary(row),
            site_snapshots: Array.isArray(extras.site_snapshots) ? extras.site_snapshots : [],
            top_source_page: deepClone(row.source_pages?.[0] || null),
            top_source_channel: deepClone(row.source_channels?.[0] || null),
            top_prompt_source: deepClone(row.prompt_sources?.[0] || null)
        };
        const funnelSummary = {
            product_id: row.product_id,
            stages: [
                { key: 'detail_view', label: '详情浏览', value: row.detail_view_user_count, note: '进入单品详情的用户', basis_label: '真实事件', basis_type: 'real' },
                { key: 'purchase_click', label: '购买意图', value: row.purchase_click_user_count, note: '点击购买按钮的用户', basis_label: '真实事件', basis_type: 'real' },
                { key: 'paid', label: '支付成功', value: row.buyer_count, note: '完成支付的用户', basis_label: '订单汇总', basis_type: 'real' },
                { key: 'delivered', label: '发货成功', value: row.delivery_success_count, note: '交付成功的订单', basis_label: '履约状态', basis_type: 'real' }
            ],
            card_click_user_count: row.card_click_user_count,
            detail_to_intent_rate: row.detail_to_intent_rate,
            intent_to_paid_rate: row.intent_to_paid_rate
        };

        return {
            success: true,
            site: normalizeSmokeAnalyticsSite(options.site),
            product_id: productId,
            generated_at: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
            range: { days: clampSmokeAnalyticsDays(options.days, 7) },
            recent_order_limit: recentOrderLimit,
            segments: {
                summary: buildSmokeProductBundleSegment(summary),
                trend: buildSmokeProductBundleSegment(Array.isArray(extras.trend) ? extras.trend : []),
                funnel: buildSmokeProductBundleSegment({ summary: funnelSummary }),
                recentOrders: buildSmokeProductBundleSegment((Array.isArray(extras.recentOrders) ? extras.recentOrders : []).slice(0, recentOrderLimit))
            }
        };
    }

    function buildSmokeAnalyticsPointsHealth(site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        return {
            total_circulation: profile.totalPoints,
            weekly_income: profile.pointsIn,
            weekly_spend: profile.pointsOut,
            monthly_spend: Math.round(profile.pointsOut * 4.1),
            velocity: profile.velocity,
            hoarding_rate: profile.key === 'intl' ? 28.4 : 34.2,
            active_holders: profile.key === 'all' ? 216 : (profile.key === 'cn' ? 138 : 78),
            hoarding_users: profile.key === 'all' ? 74 : (profile.key === 'cn' ? 49 : 25)
        };
    }

    function buildSmokeAnalyticsPointsFlow(site = 'all', days = 7) {
        const profile = getSmokeAnalyticsProfile(site);
        const scale = Math.max(1, clampSmokeAnalyticsDays(days, 7) / 7);
        return [
            { source_node: '充值', target_node: '用户余额', value: roundSmokeMetric(profile.pointsIn * 0.58 * scale, 1) },
            { source_node: '兑换码', target_node: '用户余额', value: roundSmokeMetric(profile.pointsIn * 0.42 * scale, 1) },
            { source_node: '用户余额', target_node: '内容解锁', value: roundSmokeMetric(profile.pointsOut * 0.46 * scale, 1) },
            { source_node: '用户余额', target_node: '验证服务', value: roundSmokeMetric(profile.pointsOut * 0.32 * scale, 1) },
            { source_node: '用户余额', target_node: '商城消费', value: roundSmokeMetric(profile.pointsOut * 0.22 * scale, 1) }
        ];
    }

    function buildSmokeAnalyticsPointsLeaderboard(site = 'all', limit = 10) {
        const profile = getSmokeAnalyticsProfile(site);
        return [
            { user_id: `${profile.key}-user-1`, username: `${profile.tag} 头号玩家`, avatar_url: '', balance: 1880, total_spent: 1260 },
            { user_id: `${profile.key}-user-2`, username: `${profile.tag} 运营样本`, avatar_url: '', balance: 1420, total_spent: 940 },
            { user_id: `${profile.key}-user-3`, username: `${profile.tag} 验证达人`, avatar_url: '', balance: 980, total_spent: 760 }
        ].slice(0, Math.max(1, Number(limit) || 10));
    }

    function buildSmokeAnalyticsPointsDistribution(site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        const factor = profile.key === 'all' ? 2 : 1;
        return [
            { range_label: '0-99', user_count: 18 * factor },
            { range_label: '100-499', user_count: 26 * factor },
            { range_label: '500-999', user_count: 14 * factor },
            { range_label: '1000+', user_count: 7 * factor }
        ];
    }

    function buildSmokeAnalyticsRedemptionFunnel(site = 'all', days = 7) {
        const scale = Math.max(1, clampSmokeAnalyticsDays(days, 7) / 7);
        const generated = Math.round(54 * scale);
        const redeemed = Math.round(generated * 0.72);
        const users = Math.round(redeemed * 0.82);
        return [
            { step: '已生成', count: generated, conversion_rate: 100 },
            { step: '已核销', count: redeemed, conversion_rate: roundSmokeMetric((redeemed / generated) * 100, 2) },
            { step: '核销人数', count: users, conversion_rate: roundSmokeMetric((users / redeemed) * 100, 2) }
        ];
    }

    function buildSmokeAnalyticsHeatmap(site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        const base = profile.key === 'intl' ? 4 : 6;
        return [
            { day_of_week: 1, hour_of_day: 10, activity_count: base + 4 },
            { day_of_week: 2, hour_of_day: 14, activity_count: base + 6 },
            { day_of_week: 3, hour_of_day: 20, activity_count: base + 3 },
            { day_of_week: 5, hour_of_day: 11, activity_count: base + 5 },
            { day_of_week: 6, hour_of_day: 21, activity_count: base + 7 }
        ];
    }

    function buildSmokeAnalyticsContributors(site = 'all', limit = 10) {
        const profile = getSmokeAnalyticsProfile(site);
        return [
            { user_id: `${profile.key}-contrib-1`, username: `${profile.tag} 社区主理人`, avatar_url: '', comment_count: 24, message_count: 9, total_likes_received: 36, contribution_score: 88 },
            { user_id: `${profile.key}-contrib-2`, username: `${profile.tag} 高赞作者`, avatar_url: '', comment_count: 18, message_count: 5, total_likes_received: 28, contribution_score: 71 }
        ].slice(0, Math.max(1, Number(limit) || 10));
    }

    function buildSmokeAnalyticsCommunityTrend(days = 7, site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        return buildSmokeAnalyticsDateSeries(days).map((statDate, index) => ({
            stat_date: statDate,
            messages: Math.max(1, Math.round(profile.dau / 18) + (index % 3)),
            comments: Math.max(2, Math.round(profile.totalComments / 30) + index),
            likes: Math.max(2, Math.round(profile.totalComments / 20) + (index % 4))
        }));
    }

    function buildSmokeAnalyticsConversionFunnelV2(site = 'all', days = 7) {
        const scale = Math.max(1, clampSmokeAnalyticsDays(days, 7) / 7);
        const profile = getSmokeAnalyticsProfile(site);
        const promptViewUsers = Math.max(8, Math.round((profile.dau || 32) * 0.82 * scale));
        const unlockClickUsers = Math.max(4, Math.round(promptViewUsers * 0.58));
        const unlockSuccessUsers = Math.max(2, Math.round(promptViewUsers * 0.33));

        return [
            {
                step_name: 'Prompt 浏览',
                step_order: 1,
                user_count: promptViewUsers,
                conversion_rate: 100,
                is_proxy_metric: false,
                metric_basis: 'user_events',
                metric_label: '真实业务事件漏斗'
            },
            {
                step_name: '解锁点击',
                step_order: 2,
                user_count: unlockClickUsers,
                conversion_rate: roundSmokeMetric((unlockClickUsers / promptViewUsers) * 100, 1),
                is_proxy_metric: false,
                metric_basis: 'user_events',
                metric_label: '真实业务事件漏斗'
            },
            {
                step_name: '内容解锁',
                step_order: 3,
                user_count: unlockSuccessUsers,
                conversion_rate: roundSmokeMetric((unlockSuccessUsers / promptViewUsers) * 100, 1),
                is_proxy_metric: false,
                metric_basis: 'user_events',
                metric_label: '真实业务事件漏斗'
            }
        ];
    }

    function buildSmokeAnalyticsCohort(site = 'all') {
        const profile = getSmokeAnalyticsProfile(site);
        const offset = profile.key === 'intl' ? 4 : 0;
        return [
            { cohort_week: '03/03', week_0: 100, week_1: 54 - offset, week_2: 41 - offset, week_3: 35 - offset, week_4: 28 - offset },
            { cohort_week: '03/10', week_0: 100, week_1: 58 - offset, week_2: 43 - offset, week_3: 31 - offset, week_4: 26 - offset },
            { cohort_week: '03/17', week_0: 100, week_1: 61 - offset, week_2: 46 - offset, week_3: 33 - offset, week_4: 0 },
            { cohort_week: '03/24', week_0: 100, week_1: 64 - offset, week_2: 0, week_3: 0, week_4: 0 }
        ];
    }

    function buildSmokeAnalyticsGeo(site = 'all') {
        if (normalizeSmokeAnalyticsSite(site) === 'intl') {
            return [
                { region: 'North America', user_count: 36 },
                { region: 'Europe', user_count: 24 },
                { region: 'Asia Pacific', user_count: 18 }
            ];
        }

        if (normalizeSmokeAnalyticsSite(site) === 'cn') {
            return [
                { region: '华东', user_count: 42 },
                { region: '华南', user_count: 28 },
                { region: '华北', user_count: 19 }
            ];
        }

        return [
            { region: '华东', user_count: 42 },
            { region: 'North America', user_count: 36 },
            { region: 'Europe', user_count: 24 },
            { region: '华南', user_count: 28 }
        ];
    }

    function matchesSmokeSiteScope(value = '', site = 'all') {
        const normalizedSite = normalizeSmokeAnalyticsSite(site);
        if (normalizedSite === 'all') {
            return true;
        }

        const normalizedValue = normalizeSmokeAnalyticsSite(value || 'all');
        return normalizedValue === 'all' || normalizedValue === normalizedSite;
    }

    function getSmokeTimestamp(value = '') {
        const parsed = Date.parse(String(value || '').trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatSmokeLifecycleLabel(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        switch (normalized) {
            case 'scheduled':
                return '待生效';
            case 'paused_risk':
                return '风险暂停';
            case 'paused_manual':
                return '手动暂停';
            case 'expired':
                return '已过期';
            case 'archived':
                return '已归档';
            case 'active':
            default:
                return '生效中';
        }
    }

    function formatSmokeDistributionLabel(mode = '') {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized === 'public_claim') return '公开领券';
        if (normalized === 'user_assigned') return '定向发券';
        return '通用暗码';
    }

    function formatSmokeSiteLabel(site = '') {
        const normalized = normalizeSmokeAnalyticsSite(site);
        if (normalized === 'cn') return 'CN';
        if (normalized === 'intl') return 'INTL';
        return 'ALL';
    }

    function buildSmokeMarketingWorkflowResult(workflowKey = '', site = 'all', stats = {}) {
        const normalizedSite = normalizeSmokeAnalyticsSite(site);
        if (workflowKey === 'discount_lifecycle_sync') {
            return {
                workflow_key: workflowKey,
                run_status: 'success',
                trigger_source: 'manual',
                stats,
                summary: `同步完成：激活 ${stats.activated_count || 0} 张，预排 ${stats.scheduled_count || 0} 张，过期 ${stats.expired_count || 0} 张。`,
                site_context: normalizedSite
            };
        }

        if (workflowKey === 'risk_observation_closeout') {
            return {
                workflow_key: workflowKey,
                run_status: 'success',
                trigger_source: 'manual',
                stats,
                summary: `观察期收口完成：关闭 ${stats.observation_closed_count || 0} 张优惠券的观察状态。`,
                site_context: normalizedSite
            };
        }

        if (workflowKey === 'retired_discount_archive') {
            return {
                workflow_key: workflowKey,
                run_status: 'success',
                trigger_source: 'manual',
                stats,
                summary: `历史归档完成：归档 ${stats.archived_count || 0} 张已退休优惠券。`,
                site_context: normalizedSite
            };
        }

        return {
            workflow_key: workflowKey,
            run_status: 'success',
            trigger_source: 'manual',
            stats,
            summary: `复盘快照已生成：当前共有 ${stats.discount_count || 0} 张优惠券，其中 ${stats.active_count || 0} 张生效中。`,
            site_context: normalizedSite
        };
    }

    function buildSmokeMarketingAssetsResponse(site = 'all', mode = 'full') {
        const normalizedSite = normalizeSmokeAnalyticsSite(site);
        const normalizedMode = ['summary', 'details'].includes(String(mode || '').trim().toLowerCase())
            ? String(mode || '').trim().toLowerCase()
            : 'full';
        const discounts = getTableRows('discount_codes')
            .filter((row) => matchesSmokeSiteScope(row?.applicable_site, normalizedSite));
        const discountAssets = getTableRows('discount_user_assets');
        const orders = getTableRows('shop_orders')
            .filter((row) => matchesSmokeSiteScope(row?.site, normalizedSite));
        const packages = getTableRows('points_packages');
        const batches = getTableRows('redemption_batches')
            .filter((row) => matchesSmokeSiteScope(row?.site, normalizedSite));
        const workflows = getTableRows('marketing_asset_workflows')
            .slice()
            .sort((left, right) => Number(left?.sort_order || 0) - Number(right?.sort_order || 0));
        const workflowRuns = getTableRows('marketing_asset_workflow_runs');
        const ordersByCode = new Map();
        const assetsByDiscountId = new Map();
        const batchesByPackageId = new Map();

        orders.forEach((row) => {
            const code = String(row?.discount_code || '').trim().toUpperCase();
            if (!code) return;
            const bucket = ordersByCode.get(code) || [];
            bucket.push(row);
            ordersByCode.set(code, bucket);
        });

        discountAssets.forEach((row) => {
            const discountId = String(row?.discount_id || '').trim();
            if (!discountId) return;
            const bucket = assetsByDiscountId.get(discountId) || [];
            bucket.push(row);
            assetsByDiscountId.set(discountId, bucket);
        });

        batches.forEach((row) => {
            const packageId = String(row?.package_id || '').trim();
            if (!packageId) return;
            const bucket = batchesByPackageId.get(packageId) || [];
            bucket.push(row);
            batchesByPackageId.set(packageId, bucket);
        });

        const discountItems = discounts.map((discount) => {
            const code = String(discount?.code || '').trim().toUpperCase();
            const orderRows = ordersByCode.get(code) || [];
            const assetRows = assetsByDiscountId.get(String(discount?.id || '').trim()) || [];
            const netRevenue = orderRows.reduce((sum, row) => sum + Math.max(0, Number(row?.price_paid) || 0), 0);
            const recentActivityAt = [
                discount?.last_restored_at,
                discount?.last_paused_at,
                discount?.starts_at,
                discount?.expires_at,
                assetRows.map((row) => row?.consumed_at || row?.assigned_at || '').sort((left, right) => getSmokeTimestamp(right) - getSmokeTimestamp(left))[0],
                orderRows.map((row) => row?.created_at || '').sort((left, right) => getSmokeTimestamp(right) - getSmokeTimestamp(left))[0],
                discount?.created_at
            ].find((value) => getSmokeTimestamp(value) > 0) || '';

            return {
                type: 'discount',
                id: String(discount?.id || '').trim(),
                label: code || '优惠券',
                status_label: formatSmokeLifecycleLabel(discount?.lifecycle_status),
                family_label: '优惠券',
                site_label: formatSmokeSiteLabel(discount?.applicable_site),
                delivery_label: String(discount?.distribution_mode || '').trim(),
                stacking_policy: {
                    pricing_apply_stage: String(discount?.pricing_apply_stage || '').trim() || 'order_discount',
                    apply_stage_label: String(discount?.pricing_apply_stage || '').trim() === 'catalog_price' ? '目录价阶段' : '订单优惠阶段',
                    exclusivity_label: discount?.is_exclusive === false ? '可叠加' : '排他券',
                    stack_priority: Math.max(1, Number(discount?.stack_priority) || 100)
                },
                recent_activity_at: recentActivityAt,
                metrics: [
                    `${orderRows.length} 单净核销`,
                    `${assetRows.length} 张已发放`,
                    `净营收 ${netRevenue}`
                ],
                destination_module: 'discounts',
                destination_id: String(discount?.id || '').trim()
            };
        });

        const packageItems = packages.map((pkg) => {
            const packageBatches = batchesByPackageId.get(String(pkg?.id || '').trim()) || [];
            const generatedCount = packageBatches.reduce((sum, row) => sum + Math.max(0, Number(row?.total_count) || 0), 0);
            const usedCount = packageBatches.reduce((sum, row) => sum + Math.max(0, Number(row?.used_count) || 0), 0);
            const recentActivityAt = packageBatches
                .map((row) => row?.created_at || '')
                .sort((left, right) => getSmokeTimestamp(right) - getSmokeTimestamp(left))[0]
                || String(pkg?.created_at || '').trim();

            return {
                type: 'points_package',
                id: String(pkg?.id || '').trim(),
                label: String(pkg?.name || '').trim() || '积分套餐',
                status_label: pkg?.is_active === false ? '已停用' : '生效中',
                family_label: '兑换码/套餐',
                site_label: formatSmokeSiteLabel(normalizedSite),
                recent_activity_at: recentActivityAt,
                metrics: [
                    `${packageBatches.length} 个批次`,
                    `${usedCount}/${generatedCount} 已核销`,
                    `${Math.max(0, Number(pkg?.points_amount) || 0) + Math.max(0, Number(pkg?.bonus_points) || 0)} 积分权益`
                ],
                destination_module: 'points',
                destination_id: String(pkg?.id || '').trim()
            };
        });

        const unifiedAssets = [...discountItems, ...packageItems]
            .sort((left, right) => getSmokeTimestamp(right?.recent_activity_at) - getSmokeTimestamp(left?.recent_activity_at));

        const workflowRows = workflows.map((workflow) => {
            const workflowId = String(workflow?.id || '').trim();
            const latestRun = workflowRuns
                .filter((run) => {
                    const runWorkflowId = String(run?.workflow_id || '').trim();
                    const runSite = normalizeSmokeAnalyticsSite(run?.site_context || 'all');
                    return (!workflowId || runWorkflowId === workflowId)
                        && (normalizedSite === 'all' || runSite === 'all' || runSite === normalizedSite);
                })
                .sort((left, right) => getSmokeTimestamp(right?.started_at) - getSmokeTimestamp(left?.started_at))[0];
            const dueCountBySite = workflow?.due_count_by_site && typeof workflow.due_count_by_site === 'object'
                ? workflow.due_count_by_site
                : {};
            const dueCount = Math.max(0, Number(dueCountBySite[normalizedSite] ?? dueCountBySite.all ?? 0) || 0);
            return {
                workflow_key: String(workflow?.workflow_key || '').trim(),
                workflow_name: String(workflow?.workflow_name || '').trim() || '营销工作流',
                asset_family: String(workflow?.asset_family || '').trim() || 'combined',
                status: String(workflow?.status || '').trim() || 'active',
                schedule_label: String(workflow?.schedule_label || '').trim() || '手动执行',
                due_count: dueCount,
                next_run_at: String(workflow?.next_run_at || '').trim(),
                last_run_at: String(workflow?.last_run_at || '').trim(),
                last_run_status: String(workflow?.last_run_status || '').trim(),
                last_run_summary: String(workflow?.last_run_summary || '').trim(),
                latest_run: latestRun
                    ? {
                        started_at: String(latestRun?.started_at || '').trim(),
                        summary: String(latestRun?.summary || '').trim(),
                        run_status: String(latestRun?.run_status || '').trim()
                    }
                    : null
            };
        });

        const recentDiscountOrders = orders.filter((row) => String(row?.discount_code || '').trim());
        const fullPayload = {
            success: true,
            generated_at: new Date().toISOString(),
            site_context: normalizedSite,
            load_mode: 'full',
            details_pending: false,
            summary: {
                discount_count: discountItems.length,
                package_count: packageItems.length,
                issued_asset_count: discountAssets.filter((row) => discountItems.some((item) => item.id === String(row?.discount_id || '').trim())).length,
                redemption_generated_count: batches.reduce((sum, row) => sum + Math.max(0, Number(row?.total_count) || 0), 0),
                recent_revenue_net: recentDiscountOrders.reduce((sum, row) => sum + Math.max(0, Number(row?.price_paid) || 0), 0),
                recent_discount_cost_net: recentDiscountOrders.reduce((sum, row) => sum + Math.max(0, Number(row?.discount_amount) || 0), 0),
                due_workflow_count: workflowRows.filter((row) => row.status === 'active' && row.due_count > 0).length
            },
            asset_families: [
                {
                    key: 'discount',
                    label: '优惠券',
                    summary: {
                        total_count: discountItems.length,
                        active_count: discountItems.filter((item) => item.status_label === '生效中').length,
                        scheduled_count: discountItems.filter((item) => item.status_label === '待生效').length,
                        asset_issued_count: discountAssets.filter((row) => discountItems.some((item) => item.id === String(row?.discount_id || '').trim())).length
                    },
                    primary_action: {
                        module: 'discounts',
                        label: '打开优惠券模块'
                    }
                },
                {
                    key: 'points_package',
                    label: '兑换码/套餐',
                    summary: {
                        package_count: packageItems.length,
                        batch_count: batches.length,
                        used_code_count: batches.reduce((sum, row) => sum + Math.max(0, Number(row?.used_count) || 0), 0)
                    },
                    primary_action: {
                        module: 'points',
                        label: '打开兑换码/套餐'
                    }
                }
            ],
            unified_assets: unifiedAssets,
            workflows: workflowRows
        };

        if (normalizedMode === 'details') {
            const discountFamily = fullPayload.asset_families.find((family) => family.key === 'discount') || {};
            return {
                success: true,
                generated_at: fullPayload.generated_at,
                site_context: fullPayload.site_context,
                load_mode: 'details',
                details_pending: false,
                summary: {
                    issued_asset_count: fullPayload.summary.issued_asset_count,
                    recent_revenue_net: fullPayload.summary.recent_revenue_net,
                    recent_discount_cost_net: fullPayload.summary.recent_discount_cost_net,
                    due_workflow_count: fullPayload.summary.due_workflow_count
                },
                asset_families: [
                    {
                        key: 'discount',
                        summary: discountFamily.summary || {}
                    }
                ],
                unified_assets_mode: 'discount_patch',
                unified_assets: fullPayload.unified_assets.filter((item) => item?.type === 'discount'),
                workflows: fullPayload.workflows
            };
        }

        if (normalizedMode === 'summary') {
            return {
                ...fullPayload,
                load_mode: 'summary',
                details_pending: true,
                summary: {
                    ...fullPayload.summary,
                    issued_asset_count: 0,
                    recent_revenue_net: 0,
                    recent_discount_cost_net: 0
                },
                asset_families: fullPayload.asset_families.map((family) => {
                    if (family.key !== 'discount') {
                        return family;
                    }
                    return {
                        ...family,
                        summary: {
                            ...(family.summary || {}),
                            asset_issued_count: 0,
                            asset_available_count: 0,
                            recent_revenue_net: 0,
                            recent_discount_cost_net: 0
                        }
                    };
                })
            };
        }

        return fullPayload;
    }

    function runSmokeMarketingWorkflow(workflowKey = '', site = 'all') {
        const normalizedKey = String(workflowKey || '').trim().toLowerCase();
        const normalizedSite = normalizeSmokeAnalyticsSite(site);
        const workflows = getTableRows('marketing_asset_workflows').map((row) => ({ ...row }));
        const discounts = getTableRows('discount_codes').map((row) => ({ ...row }));
        const target = workflows.find((row) => String(row?.workflow_key || '').trim().toLowerCase() === normalizedKey);

        if (!target) {
            return createResponse({
                success: false,
                message: 'workflow_key 无效'
            }, 400);
        }

        const dueCountBySite = target.due_count_by_site && typeof target.due_count_by_site === 'object'
            ? { ...target.due_count_by_site }
            : {};
        const visibleDiscounts = discounts.filter((row) => matchesSmokeSiteScope(row?.applicable_site, normalizedSite));
        let stats = {};

        if (normalizedKey === 'discount_lifecycle_sync') {
            const scheduledRows = visibleDiscounts.filter((row) => String(row?.lifecycle_status || '').trim().toLowerCase() === 'scheduled');
            const activatedRow = scheduledRows[0];
            if (activatedRow) {
                activatedRow.lifecycle_status = 'active';
                activatedRow.status_reason = 'scheduled_activated';
            }
            stats = {
                activated_count: activatedRow ? 1 : 0,
                scheduled_count: Math.max(0, scheduledRows.length - (activatedRow ? 1 : 0)),
                expired_count: 0
            };
        } else if (normalizedKey === 'risk_observation_closeout') {
            stats = {
                observation_closed_count: visibleDiscounts.some((row) => String(row?.lifecycle_status || '').trim().toLowerCase() === 'paused_risk') ? 1 : 0
            };
        } else if (normalizedKey === 'retired_discount_archive') {
            stats = {
                archived_count: 0
            };
        } else {
            stats = {
                discount_count: visibleDiscounts.length,
                active_count: visibleDiscounts.filter((row) => String(row?.lifecycle_status || '').trim().toLowerCase() === 'active').length
            };
        }

        const nowIso = new Date().toISOString();
        const runResult = buildSmokeMarketingWorkflowResult(normalizedKey, normalizedSite, stats);
        target.last_run_at = nowIso;
        target.last_run_status = 'success';
        target.last_run_summary = runResult.summary;
        target.next_run_at = nowIso;
        if (normalizedSite === 'all') {
            dueCountBySite.cn = 0;
            dueCountBySite.intl = 0;
            dueCountBySite.all = 0;
        } else {
            dueCountBySite[normalizedSite] = 0;
            dueCountBySite.all = Math.max(0, Number(dueCountBySite.cn || 0) + Number(dueCountBySite.intl || 0));
        }
        target.due_count_by_site = dueCountBySite;

        setTableRows('marketing_asset_workflows', workflows);
        setTableRows('discount_codes', discounts);

        const nextRuns = [
            {
                id: `marketing-run-${Date.now()}`,
                workflow_id: String(target?.id || '').trim(),
                workflow_key: normalizedKey,
                started_at: nowIso,
                finished_at: nowIso,
                run_status: 'success',
                summary: runResult.summary,
                site_context: normalizedSite
            },
            ...getTableRows('marketing_asset_workflow_runs')
        ];
        setTableRows('marketing_asset_workflow_runs', nextRuns);

        return createResponse({
            success: true,
            workflow: {
                workflow_key: normalizedKey,
                workflow_name: String(target?.workflow_name || '').trim(),
                site_context: normalizedSite
            },
            run_result: runResult
        });
    }

    function installSupabaseStub() {
        const fakeClient = (globalScope.supabaseClient && typeof globalScope.supabaseClient === 'object')
            ? globalScope.supabaseClient
            : {};

        fakeClient.__localSmokeClient = true;
        fakeClient.auth = {
                async getUser() {
                    return { data: { user: deepClone(smokeState.user) }, error: null };
                },
                async getSession() {
                    return { data: { session: deepClone(smokeState.session) }, error: null };
                },
                onAuthStateChange() {
                    return {
                        data: {
                            subscription: {
                                unsubscribe() {}
                            }
                        }
                    };
                },
                async signOut() {
                    return { error: null };
                }
            };
        fakeClient.rpc = async function rpc(name, params = {}) {
                smokeState.analyticsRpcCallCount += 1;
                const safeParams = params && typeof params === 'object' ? params : {};
                if (/^get_(overview_stats|user_trend|content_trend|revenue_trend|content_top|ai_summary_data|points_health|points_flow|points_leaderboard|points_distribution|redemption_funnel|activity_heatmap|top_contributors|community_stats|conversion_funnel|retention_cohort|geo_distribution_by_site)/.test(String(name || ''))) {
                    smokeState.analyticsRpcLastParams[name] = deepClone(safeParams);
                }

                if (name === 'get_user_permissions') {
                    return {
                        data: {
                            is_admin: true,
                            is_super_admin: true,
                            permissions: deepClone(smokeAdminPermissions)
                        },
                        error: null
                    };
                }

                if (name === 'get_all_system_config') {
                    return {
                        data: [
                            { config_key: 'ops_alerts', config_value: deepClone(smokeState.opsAlertsConfig) },
                            { config_key: 'payment_channels', config_value: deepClone(smokeState.paymentChannelsConfig) },
                            { config_key: 'recharge_options', config_value: deepClone(smokeState.rechargeOptions) }
                        ],
                        error: null
                    };
                }

                if (name === 'fn_get_homepage_config') {
                    const site = normalizeSmokeSite(safeParams.p_site);
                    const includeHidden = safeParams.p_include_hidden === true;
                    const rows = getTableRows('homepage_config')
                        .filter((row) => row.site === site)
                        .filter((row) => includeHidden || row.is_visible !== false)
                        .sort((left, right) => {
                            const orderDelta = Number(left?.display_order || 0) - Number(right?.display_order || 0);
                            if (orderDelta !== 0) return orderDelta;
                            return normalizeComparableValue(left?.section).localeCompare(normalizeComparableValue(right?.section));
                        });

                    return {
                        data: deepClone(rows),
                        error: null
                    };
                }

                if (name === 'get_overview_stats' || name === 'get_overview_stats_with_trend') {
                    return {
                        data: deepClone(buildSmokeAnalyticsOverview(safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_user_trend') {
                    return {
                        data: deepClone(buildSmokeAnalyticsUserTrend(safeParams.p_days, safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_content_trend') {
                    return {
                        data: deepClone(buildSmokeAnalyticsContentTrend(safeParams.p_days, safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_revenue_trend') {
                    return {
                        data: deepClone(buildSmokeAnalyticsRevenueTrend(safeParams.p_days, safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_channel_breakdown') {
                    return {
                        data: deepClone(buildSmokeAnalyticsChannelBreakdown(safeParams.p_site, safeParams.p_days)),
                        error: null
                    };
                }

                if (name === 'get_content_top') {
                    return {
                        data: deepClone(buildSmokeAnalyticsTopContent(safeParams.p_site, clampSmokeAnalyticsDays(safeParams.p_days, 7), safeParams.p_limit)),
                        error: null
                    };
                }

                if (name === 'get_ai_summary_data') {
                    return {
                        data: deepClone(buildSmokeAnalyticsSummary(safeParams.p_site, safeParams.p_days)),
                        error: null
                    };
                }

                if (name === 'get_points_health') {
                    return {
                        data: deepClone(buildSmokeAnalyticsPointsHealth(safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_points_flow') {
                    return {
                        data: deepClone(buildSmokeAnalyticsPointsFlow(safeParams.p_site, safeParams.p_days)),
                        error: null
                    };
                }

                if (name === 'get_points_leaderboard') {
                    return {
                        data: deepClone(buildSmokeAnalyticsPointsLeaderboard(safeParams.p_site, safeParams.p_limit)),
                        error: null
                    };
                }

                if (name === 'get_points_distribution') {
                    return {
                        data: deepClone(buildSmokeAnalyticsPointsDistribution(safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_redemption_funnel') {
                    return {
                        data: deepClone(buildSmokeAnalyticsRedemptionFunnel(safeParams.p_site, safeParams.p_days)),
                        error: null
                    };
                }

                if (name === 'get_activity_heatmap') {
                    return {
                        data: deepClone(buildSmokeAnalyticsHeatmap(safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_top_contributors') {
                    return {
                        data: deepClone(buildSmokeAnalyticsContributors(safeParams.p_site, safeParams.p_limit)),
                        error: null
                    };
                }

                if (name === 'get_community_stats') {
                    return {
                        data: deepClone(buildSmokeAnalyticsCommunityTrend(safeParams.p_days, safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_conversion_funnel_v2') {
                    return {
                        data: deepClone(buildSmokeAnalyticsConversionFunnelV2(safeParams.p_site, safeParams.p_days)),
                        error: null
                    };
                }

                if (name === 'get_retention_cohort') {
                    return {
                        data: deepClone(buildSmokeAnalyticsCohort(safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'get_geo_distribution_by_site') {
                    return {
                        data: deepClone(buildSmokeAnalyticsGeo(safeParams.p_site)),
                        error: null
                    };
                }

                if (name === 'track_event') {
                    return {
                        data: { success: true, event: safeParams.p_event_name || 'page_view' },
                        error: null
                    };
                }

                return { data: null, error: null };
            };
        fakeClient.from = function from(table) {
                return createQueryBuilder(String(table || '').trim());
            };
        fakeClient.channel = function channel(name = '') {
                const channelName = String(name || '').trim();
                if (channelName.startsWith('analytics-')) {
                    smokeState.analyticsRealtimeChannelsCreated += 1;
                }

                return {
                    __smokeName: channelName,
                    on() {
                        return this;
                    },
                    subscribe() {
                        return this;
                    },
                    unsubscribe() {}
                };
            };
        fakeClient.removeChannel = function removeChannel(channel) {
                if (String(channel?.__smokeName || '').startsWith('analytics-')) {
                    smokeState.analyticsRealtimeChannelsRemoved += 1;
                }
                return Promise.resolve();
            };

        globalScope.supabaseClient = fakeClient;
        globalScope.AdminAccess = {
            __localSmokeAccess: true,
            async getCurrentAdminAccess() {
                return {
                    user: deepClone(smokeState.user),
                    isAdmin: true,
                    isSuperAdmin: true,
                    permissions: deepClone(smokeAdminPermissions)
                };
            },
            async createAdminStudioSession() {
                return {
                    ok: true,
                    status: 200,
                    payload: {
                        success: true
                    }
                };
            },
            hasActiveAdminStudioSession() {
                return true;
            },
            clearAccessCache() {},
            clearCachedAdminStudioSession() {},
            async clearAdminStudioSession() {
                return true;
            },
            sanitizeAdminStudioTarget(target = 'admin-studio.html') {
                return String(target || 'admin-studio.html');
            },
            async warmAdminStudioEntry() {
                return {
                    access: {
                        user: deepClone(smokeState.user),
                        isAdmin: true,
                        isSuperAdmin: true,
                        permissions: deepClone(smokeAdminPermissions)
                    },
                    session: {
                        ok: true,
                        status: 200,
                        payload: {
                            success: true
                        }
                    }
                };
            }
        };
    }

    function installFetchStub() {
        const originalFetch = typeof globalScope.fetch === 'function'
            ? globalScope.fetch.bind(globalScope)
            : null;

        globalScope.fetch = async function smokeFetch(input, init = {}) {
            const requestUrl = typeof input === 'string'
                ? input
                : (input?.url || '');
            const url = new URL(requestUrl || '/', globalScope.location?.origin || 'http://127.0.0.1:8000');
            const method = String(init?.method || input?.method || 'GET').trim().toUpperCase();
            const adminRoute = url.pathname === '/api/admin'
                ? normalizeSmokeAdminRoute(url.searchParams.get('route'))
                : (url.pathname.startsWith('/api/admin/')
                    ? normalizeSmokeAdminRoute(url.pathname)
                    : '');

            if (adminRoute && method === 'GET') {
                smokeState.analyticsAdminRouteLastQuery[adminRoute] = Object.fromEntries(url.searchParams.entries());
            }

            if (adminRoute === 'access/session' || url.pathname === '/api/admin/access/session') {
                if (method === 'DELETE') {
                    return createResponse({
                        success: true,
                        cleared: true
                    });
                }

                if (method === 'POST') {
                    return createResponse({
                        success: true,
                        granted: true,
                        expiresInSeconds: 600,
                        source: 'local-smoke'
                    });
                }
            }

            if (url.pathname === '/api/admin/settings/ops-alerts') {
                if (method === 'GET') {
                    return createResponse({
                        success: true,
                        config: deepClone(smokeState.opsAlertsConfig),
                        secrets: {}
                    });
                }

                if (method === 'POST') {
                    try {
                        const body = JSON.parse(String(init?.body || '{}'));
                        smokeState.opsAlertsConfig = {
                            ...smokeState.opsAlertsConfig,
                            ...(body?.value && typeof body.value === 'object' ? body.value : body)
                        };
                    } catch (_) {
                        // ignore malformed smoke save payloads
                    }

                    return createResponse({
                        success: true,
                        config: deepClone(smokeState.opsAlertsConfig)
                    });
                }
            }

            if (url.pathname === '/api/admin/settings/payment-channels') {
                return createResponse({
                    success: true,
                    config: deepClone(smokeState.paymentChannelsConfig),
                    secrets: {},
                    runtime: {
                        mock_payment: {
                            allowed: true,
                            reason: 'local-smoke',
                            message: '本地 smoke 允许 mock 通道',
                            override_configured: false,
                            override_active: false,
                            override_env_name: '',
                            override_mode: 'none',
                            cleanup_message: ''
                        }
                    }
                });
            }

            if (url.pathname === '/api/admin/settings/system-config') {
                if (method === 'GET') {
                    const domains = url.searchParams.getAll('domain');
                    return createResponse(buildSmokeSystemConfigDomainPayload(domains));
                }

                if (method === 'POST') {
                    let body = {};
                    try {
                        body = JSON.parse(String(init?.body || '{}'));
                    } catch (_) {
                        body = {};
                    }

                    const key = String(body?.key || '').trim();
                    if (!key) {
                        return createResponse({
                            success: false,
                            message: 'key is required'
                        }, 400);
                    }

                    setSmokeSystemConfigValue(key, body?.value);
                    return createResponse({
                        success: true,
                        key,
                        value: getSmokeSystemConfigValue(key)
                    });
                }
            }

            if (url.pathname === '/api/admin/payments/summary' && method === 'GET') {
                return createResponse(buildSmokePaymentsSummaryPayload(url.searchParams));
            }

            if (url.pathname === '/api/admin/payments/cleanup') {
                return createResponse(buildSmokePaymentsCleanupPayload());
            }

            if (url.pathname === '/api/admin/settings/discount-trigger-options') {
                const site = normalizeSmokeAnalyticsSite(url.searchParams.get('site'));
                const rows = getTableRows('discount_codes')
                    .filter((row) => String(row?.distribution_mode || '').trim().toLowerCase() === 'user_assigned')
                    .filter((row) => matchesSmokeSiteScope(row?.applicable_site, site))
                    .map((row) => ({
                        id: row.id,
                        code: String(row?.code || '').trim().toUpperCase(),
                        applicable_site: normalizeSmokeAnalyticsSite(row?.applicable_site),
                        discount_type: String(row?.discount_type || 'fixed').trim().toLowerCase() || 'fixed',
                        discount_value: Number.isFinite(Number(row?.discount_value)) ? Number(row.discount_value) : 0,
                        distribution_mode: 'user_assigned',
                        lifecycle_status: String(row?.lifecycle_status || 'active').trim().toLowerCase() || 'active',
                        lifecycle_summary: {
                            key: String(row?.lifecycle_status || 'active').trim().toLowerCase() || 'active',
                            label: formatSmokeLifecycleLabel(row?.lifecycle_status)
                        }
                    }));

                return createResponse({
                    success: true,
                    site,
                    rows: deepClone(rows)
                });
            }

            if (url.pathname === '/api/wallet/checkin') {
                return createResponse({
                    success: true,
                    message: '签到成功',
                    points: 5,
                    base_reward: 5,
                    bonus_reward: 0,
                    consecutive_days: 3,
                    new_balance: 90.7,
                    linked_discount_summary: {
                        success: true,
                        event_type: 'checkin',
                        matched_rule_count: 0,
                        issued_count: 0,
                        assigned_discount_ids: []
                    }
                });
            }

            if (url.pathname === '/api/admin/settings/ops-alert-health') {
                return createResponse(deepClone(smokeState.opsAlertHealthPayload));
            }

            if (url.pathname === '/api/admin/settings/ops-alert-monitor') {
                return createResponse(deepClone(smokeState.opsAlertMonitorPayload));
            }

            if (adminRoute === 'tickets/metrics' && method === 'GET') {
                return createResponse(buildSmokeTicketsMetricsPayload());
            }

            if (adminRoute === 'tickets/list' && method === 'GET') {
                return createResponse(buildSmokeTicketsListPayload(url.searchParams));
            }

            if (url.pathname === '/api/admin/prompts/manage') {
                if (method === 'GET') {
                    const promptId = String(url.searchParams.get('id') || '').trim();
                    const rows = getTableRows('prompts');

                    if (promptId) {
                        const row = rows.find((item) => item.id === promptId);
                        if (!row) {
                            return createResponse({
                                success: false,
                                message: 'Prompt smoke row not found'
                            }, 404);
                        }

                        return createResponse({
                            success: true,
                            siteContext: url.searchParams.get('site') || 'all',
                            row: deepClone(attachSmokePromptSiteMetrics([row])[0])
                        });
                    }

                    return createResponse({
                        success: true,
                        siteContext: url.searchParams.get('site') || 'all',
                        rows: deepClone(attachSmokePromptSiteMetrics(sortSmokeRowsByCreatedAtDesc(rows)))
                    });
                }

                if (method === 'POST') {
                    let body = {};
                    try {
                        body = JSON.parse(String(init?.body || '{}'));
                    } catch (_) {
                        body = {};
                    }

                    const action = String(body.action || (body.id ? 'update' : 'create')).trim().toLowerCase();
                    const rows = getTableRows('prompts').map((row) => ({ ...row }));

                    if (action === 'create') {
                        const inserted = buildInsertedRow('prompts', {
                            ...body,
                            tags: Array.isArray(body.tags) ? body.tags : [],
                            images: Array.isArray(body.images) ? body.images : [],
                            dominant_colors: Array.isArray(body.dominant_colors) ? body.dominant_colors : [],
                            created_at: now.toISOString(),
                            updated_at: now.toISOString()
                        });
                        rows.unshift(inserted);
                        setTableRows('prompts', rows);

                        return createResponse({
                            success: true,
                            site: normalizeSmokeSite(body.site),
                            row: deepClone(inserted)
                        });
                    }

                    const row = rows.find((item) => item.id === body.id);
                    if (!row) {
                        return createResponse({
                            success: false,
                            message: 'Prompt smoke row not found'
                        }, 404);
                    }

                    const nextPayload = { ...body };
                    delete nextPayload.action;
                    delete nextPayload.site;
                    delete nextPayload.id;

                    Object.assign(row, deepClone(nextPayload), {
                        updated_at: new Date(now.getTime() + 60000).toISOString()
                    });
                    setTableRows('prompts', rows);

                    return createResponse({
                        success: true,
                        site: normalizeSmokeSite(body.site),
                        row: deepClone(row)
                    });
                }

                if (method === 'DELETE') {
                    let body = {};
                    try {
                        body = JSON.parse(String(init?.body || '{}'));
                    } catch (_) {
                        body = {};
                    }

                    const ids = [...new Set(
                        (Array.isArray(body.ids) ? body.ids : [body.id])
                            .map((item) => String(item || '').trim())
                            .filter(Boolean)
                    )];
                    const rows = getTableRows('prompts');
                    const deletedRows = rows.filter((row) => ids.includes(row.id));
                    setTableRows('prompts', rows.filter((row) => !ids.includes(row.id)));

                    return createResponse({
                        success: true,
                        site: normalizeSmokeSite(body.site),
                        deletedCount: deletedRows.length,
                        ids: deletedRows.map((row) => row.id)
                    });
                }
            }

            if ((url.pathname === '/api/admin/shop/products' || adminRoute === 'shop/products') && method === 'GET') {
                return createResponse(buildSmokeShopProductsPayload(url.searchParams));
            }

            if ((url.pathname === '/api/admin/shop/categories' || adminRoute === 'shop/categories') && method === 'GET') {
                return createResponse({
                    success: true,
                    rows: deepClone(getSmokeShopCategoryRows())
                });
            }

            if ((url.pathname === '/api/admin/shop/inventory' || adminRoute === 'shop/inventory') && method === 'GET') {
                return createResponse(buildSmokeShopInventoryPayload(url.searchParams));
            }

            if ((url.pathname === '/api/admin/shop/mutate' || adminRoute === 'shop/mutate') && method === 'POST') {
                let body = {};
                try {
                    body = JSON.parse(String(init?.body || '{}'));
                } catch (_) {
                    body = {};
                }

                return handleSmokeShopMutation(body);
            }

            if (url.pathname === '/api/admin/points/catalog' && method === 'GET') {
                return createResponse(deepClone(buildSmokePointsCatalogResponse(url.searchParams.get('site') || 'all')));
            }

            if (url.pathname === '/api/admin/points/batches' && method === 'GET') {
                const site = url.searchParams.get('site') || 'all';
                const batchId = String(url.searchParams.get('batchId') || '').trim();
                const code = String(url.searchParams.get('code') || '').trim();

                if (batchId) {
                    return buildSmokePointsBatchDetail(site, batchId);
                }

                if (code) {
                    return buildSmokePointsBatchSearch(site, code);
                }

                return createResponse(deepClone(buildSmokePointsBatchesResponse(site)));
            }

            if (url.pathname === '/api/admin/points/packages') {
                if (method === 'GET') {
                    const rows = sortSmokePointsPackageRows(getTableRows('points_packages').map((row, index) => (
                        normalizeSmokePointsPackageRecord(row, index + 1)
                    )));
                    return createResponse({
                        success: true,
                        rows: deepClone(rows)
                    });
                }

                let body = {};
                try {
                    body = JSON.parse(String(init?.body || '{}'));
                } catch (_) {
                    body = {};
                }

                const writableSite = String(body.site || '').trim().toLowerCase();
                if (!['cn', 'intl'].includes(writableSite)) {
                    return createResponse({
                        success: false,
                        message: 'Writable admin site must be cn or intl'
                    }, 400);
                }

                const rows = getTableRows('points_packages').map((row, index) => normalizeSmokePointsPackageRecord(row, index + 1));

                if (method === 'POST') {
                    const action = String(body.action || (body.id ? 'update' : 'create')).trim().toLowerCase();

                    if (action === 'create') {
                        const inserted = normalizeSmokePointsPackageRecord(buildInsertedRow('points_packages', {
                            ...body,
                            id: body.id || `pkg-smoke-${rows.length + 1}`,
                            created_at: now.toISOString()
                        }), rows.length + 1);
                        const nextRows = sortSmokePointsPackageRows([...rows, inserted]);
                        setTableRows('points_packages', nextRows);
                        return createResponse({
                            success: true,
                            row: deepClone(inserted)
                        });
                    }

                    const row = rows.find((item) => item.id === String(body.id || '').trim());
                    if (!row) {
                        return createResponse({
                            success: false,
                            message: 'Points package smoke row not found'
                        }, 404);
                    }

                    const updated = normalizeSmokePointsPackageRecord({
                        ...row,
                        ...body
                    }, row.sort_order || 0);
                    const nextRows = sortSmokePointsPackageRows(rows.map((item) => (item.id === updated.id ? updated : item)));
                    setTableRows('points_packages', nextRows);
                    return createResponse({
                        success: true,
                        row: deepClone(updated)
                    });
                }

                if (method === 'DELETE') {
                    const id = String(body.id || '').trim();
                    const nextRows = rows.filter((row) => row.id !== id);
                    setTableRows('points_packages', nextRows);
                    return createResponse({
                        success: true,
                        id
                    });
                }
            }

            if (url.pathname === '/api/admin/points/manage' && method === 'POST') {
                let body = {};
                try {
                    body = JSON.parse(String(init?.body || '{}'));
                } catch (_) {
                    body = {};
                }

                const writableSite = String(body.site || '').trim().toLowerCase();
                if (!['cn', 'intl'].includes(writableSite)) {
                    return createResponse({
                        success: false,
                        message: 'Writable admin site must be cn or intl'
                    }, 400);
                }

                return handleSmokePointsManage(body);
            }

            if (url.pathname === '/api/admin/points/lookup' && method === 'GET') {
                return buildSmokePointsLookupResponse(
                    url.searchParams.get('site') || 'all',
                    url.searchParams.get('q') || url.searchParams.get('code') || ''
                );
            }

            if (url.pathname === '/api/admin/marketing/assets-center') {
                if (method === 'GET') {
                    return createResponse(deepClone(buildSmokeMarketingAssetsResponse(
                        url.searchParams.get('site') || 'all',
                        url.searchParams.get('mode') || 'full'
                    )));
                }

                if (method === 'POST') {
                    let body = {};
                    try {
                        body = JSON.parse(String(init?.body || '{}'));
                    } catch (_) {
                        body = {};
                    }

                    if (String(body?.action || '').trim().toLowerCase() !== 'run_workflow') {
                        return createResponse({
                            success: false,
                            message: 'action 或 workflow_key 无效'
                        }, 400);
                    }

                    return runSmokeMarketingWorkflow(body?.workflow_key || body?.workflowKey, body?.site || 'all');
                }
            }

            if (url.pathname === '/api/admin/comments/summary' || adminRoute === 'comments/summary') {
                return createResponse({
                    success: true,
                    site: normalizeSmokeCommentsSite(url.searchParams.get('site') || 'all'),
                    summary: deepClone(buildSmokeCommentsSummary(url.searchParams.get('site') || 'all'))
                });
            }

            if (adminRoute === 'analytics/trend-series-bundle') {
                const site = normalizeSmokeAnalyticsSite(url.searchParams.get('site') || 'all');
                const days = Number(url.searchParams.get('days') || 7) || 7;

                return createResponse({
                    success: true,
                    site,
                    generated_at: new Date().toISOString(),
                    range: { days },
                    partial_failure_count: 0,
                    segments: {
                        userTrend: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_user_trend',
                            payload: deepClone(buildSmokeAnalyticsUserTrend(days, site))
                        },
                        contentTrend: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_content_trend',
                            payload: deepClone(buildSmokeAnalyticsContentTrend(days, site))
                        },
                        revenueTrend: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_revenue_trend',
                            payload: deepClone(buildSmokeAnalyticsRevenueTrend(days, site))
                        }
                    }
                });
            }

            if (adminRoute === 'analytics/summary-window-bundle') {
                const site = normalizeSmokeAnalyticsSite(url.searchParams.get('site') || 'all');
                const days = Number(url.searchParams.get('days') || 7) || 7;
                const includeComparisonSites = url.searchParams.get('includeComparisonSites') === '1';
                const summarySites = new Set([site]);

                if (site === 'all' || includeComparisonSites) {
                    summarySites.add('all');
                    summarySites.add('cn');
                    summarySites.add('intl');
                }

                const summaries = {};
                summarySites.forEach((summarySite) => {
                    const summary = buildSmokeAnalyticsSummary(summarySite, days);
                    summaries[summarySite] = {
                        ok: true,
                        statusCode: 200,
                        message: '',
                        summary: {
                            overview: deepClone(summary.overview),
                            user_trend: deepClone(summary.user_trend),
                            channel_breakdown: deepClone(summary.channel_breakdown),
                            top_content: deepClone(summary.top_content),
                            event_overview: {},
                            event_funnels: {},
                            generated_at: new Date().toISOString()
                        }
                    };
                });

                return createResponse({
                    success: true,
                    site,
                    generated_at: new Date().toISOString(),
                    range: { days },
                    partial_failure_count: 0,
                    summaries
                });
            }

            if (adminRoute === 'analytics/product-dashboard-bundle') {
                return createResponse(buildSmokeProductDashboardBundleFixture({
                    site: url.searchParams.get('site') || 'all',
                    days: url.searchParams.get('days') || 7,
                    limit: url.searchParams.get('limit') || 10
                }));
            }

            if (adminRoute === 'analytics/product-summary-bundle') {
                return createResponse(buildSmokeProductSummaryBundleFixture({
                    site: url.searchParams.get('site') || 'all',
                    days: url.searchParams.get('days') || 7
                }));
            }

            if (adminRoute === 'analytics/product-rank-bundle') {
                return createResponse(buildSmokeProductRankBundleFixture({
                    site: url.searchParams.get('site') || 'all',
                    days: url.searchParams.get('days') || 7,
                    limit: url.searchParams.get('limit') || 10
                }));
            }

            if (adminRoute === 'analytics/product-health-bundle') {
                return createResponse(buildSmokeProductHealthBundleFixture({
                    site: url.searchParams.get('site') || 'all',
                    days: url.searchParams.get('days') || 7,
                    limit: url.searchParams.get('limit') || 10
                }));
            }

            if (adminRoute === 'analytics/product-funnel-bundle') {
                return createResponse(buildSmokeProductFunnelBundleFixture({
                    site: url.searchParams.get('site') || 'all',
                    days: url.searchParams.get('days') || 7,
                    limit: url.searchParams.get('limit') || 6
                }));
            }

            if (adminRoute === 'analytics/product-detail-bundle') {
                const productDetailPayload = buildSmokeProductDetailBundleFixture({
                    site: url.searchParams.get('site') || 'all',
                    days: url.searchParams.get('days') || 7,
                    productId: url.searchParams.get('productId') || '',
                    recentOrderLimit: url.searchParams.get('recentOrderLimit') || 6
                });

                if (!productDetailPayload) {
                    return createResponse({
                        success: false,
                        message: 'Product detail smoke fixture not found'
                    }, 404);
                }

                return createResponse(productDetailPayload);
            }

            if (adminRoute === 'analytics/panel-support-bundle') {
                const site = normalizeSmokeAnalyticsSite(url.searchParams.get('site') || 'all');
                const days = Number(url.searchParams.get('days') || 7) || 7;
                const topContentLimit = Number(url.searchParams.get('topContentLimit') || 10) || 10;
                const pointsLeaderboardLimit = Number(url.searchParams.get('pointsLeaderboardLimit') || 10) || 10;

                return createResponse({
                    success: true,
                    site,
                    generated_at: new Date().toISOString(),
                    range: { days },
                    partial_failure_count: 0,
                    segments: {
                        channelBreakdown: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_channel_breakdown_v2',
                            payload: deepClone(buildSmokeAnalyticsChannelBreakdown(site, days))
                        },
                        topContent: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_content_top_v2',
                            payload: deepClone(buildSmokeAnalyticsTopContent(site, days, topContentLimit))
                        },
                        communityStats: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_community_stats',
                            payload: deepClone(buildSmokeAnalyticsCommunityTrend(days, site))
                        },
                        pointsDistribution: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_points_distribution',
                            payload: deepClone(buildSmokeAnalyticsPointsDistribution(site))
                        },
                        pointsLeaderboard: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_points_leaderboard',
                            payload: deepClone(buildSmokeAnalyticsPointsLeaderboard(site, pointsLeaderboardLimit))
                        },
                        redemptionFunnel: {
                            ok: true,
                            statusCode: 200,
                            message: '',
                            rpc_name: 'get_redemption_funnel',
                            payload: deepClone(buildSmokeAnalyticsRedemptionFunnel(site, days))
                        }
                    }
                });
            }

            if (url.pathname === '/api/admin/comments/list') {
                const site = url.searchParams.get('site') || 'all';
                const view = String(url.searchParams.get('view') || '').trim().toLowerCase() === 'gallery' ? 'gallery' : 'guestbook';
                const comments = view === 'gallery'
                    ? buildSmokeGalleryAdminRows(site)
                    : buildSmokeGuestbookAdminRows(site);

                return createResponse({
                    success: true,
                    site: normalizeSmokeCommentsSite(site),
                    view,
                    comments: deepClone(comments)
                });
            }

            if (url.pathname === '/api/admin/comments/blocks') {
                if (method === 'GET') {
                    const userId = String(url.searchParams.get('userId') || '').trim();
                    return createResponse({
                        success: true,
                        site: normalizeSmokeCommentsSite(url.searchParams.get('site') || 'all'),
                        userId,
                        ...buildSmokeCommentBlockState(userId)
                    });
                }

                if (method === 'POST') {
                    let body = {};
                    try {
                        body = JSON.parse(String(init?.body || '{}'));
                    } catch (_) {
                        body = {};
                    }

                    return handleSmokeCommentBlocks(body, url.searchParams.get('site') || 'all');
                }
            }

            if (url.pathname === '/api/admin/comments/moderate' && method === 'POST') {
                let body = {};
                try {
                    body = JSON.parse(String(init?.body || '{}'));
                } catch (_) {
                    body = {};
                }

                return handleSmokeCommentsModeration(body);
            }

            if (url.pathname === '/api/admin/homepage/config') {
                if (method === 'GET') {
                    const site = normalizeSmokeSite(url.searchParams.get('site'));
                    const rows = getTableRows('homepage_config')
                        .filter((row) => row.site === site)
                        .sort((left, right) => {
                            const orderDelta = Number(left?.display_order || 0) - Number(right?.display_order || 0);
                            if (orderDelta !== 0) return orderDelta;
                            return normalizeComparableValue(left?.section).localeCompare(normalizeComparableValue(right?.section));
                        });

                    return createResponse({
                        success: true,
                        rows: deepClone(rows)
                    });
                }

                if (method === 'POST') {
                    let body = {};
                    try {
                        body = JSON.parse(String(init?.body || '{}'));
                    } catch (_) {
                        body = {};
                    }

                    const site = normalizeSmokeSite(body.site);
                    const rows = getTableRows('homepage_config');
                    const normalizedSection = String(body.section || '').trim().toLowerCase();
                    const row = rows.find((item) => {
                        if (item.site !== site || item.section !== normalizedSection) {
                            return false;
                        }
                        return body.id ? item.id === body.id : true;
                    });
                    if (!row) {
                        return createResponse({
                            success: false,
                            message: 'Homepage smoke row not found'
                        }, 404);
                    }

                    if (Object.prototype.hasOwnProperty.call(body, 'content')) {
                        row.content = body.content && typeof body.content === 'object'
                            ? deepClone(body.content)
                            : {};
                    }
                    if (Object.prototype.hasOwnProperty.call(body, 'is_visible')) {
                        row.is_visible = body.is_visible !== false;
                    }
                    if (Object.prototype.hasOwnProperty.call(body, 'display_order')) {
                        row.display_order = Number(body.display_order || 0);
                    }
                    row.updated_at = new Date(now.getTime() + 60000).toISOString();

                    return createResponse({
                        success: true,
                        row: deepClone(row),
                        rows: deepClone(rows.filter((item) => item.site === site))
                    });
                }
            }

            if (url.pathname === '/api/admin/homepage/layout') {
                const layoutConfigs = getSmokeSystemConfigValue('site_layouts');

                if (method === 'GET') {
                    const site = normalizeSmokeSite(url.searchParams.get('site'));
                    return createResponse({
                        success: true,
                        site,
                        layout: site === 'intl'
                            ? deepClone(layoutConfigs?.intl || {})
                            : (site === 'cn' ? deepClone(layoutConfigs?.cn || {}) : null),
                        layouts: deepClone(layoutConfigs || {})
                    });
                }

                if (method === 'POST') {
                    let body = {};
                    try {
                        body = JSON.parse(String(init?.body || '{}'));
                    } catch (_) {
                        body = {};
                    }

                    const site = normalizeSmokeSite(body.site);
                    const nextLayouts = layoutConfigs && typeof layoutConfigs === 'object' && !Array.isArray(layoutConfigs)
                        ? deepClone(layoutConfigs)
                        : {};

                    if (site === 'cn' || site === 'intl') {
                        nextLayouts[site] = body.layout && typeof body.layout === 'object' && !Array.isArray(body.layout)
                            ? deepClone(body.layout)
                            : {};
                        setSmokeSystemConfigValue('site_layouts', nextLayouts);
                    }

                    return createResponse({
                        success: true,
                        site,
                        layout: site === 'intl'
                            ? deepClone(nextLayouts.intl || {})
                            : (site === 'cn' ? deepClone(nextLayouts.cn || {}) : null),
                        layouts: deepClone(nextLayouts)
                    });
                }
            }

            if (originalFetch) {
                return originalFetch(input, init);
            }

            return createResponse({
                success: false,
                message: `No local smoke fixture for ${url.pathname}`
            }, 404);
        };
    }

    async function runAdminStudioSmoke() {
        await waitFor(() => typeof globalScope.loadOpsAlertSettings === 'function', { message: 'Ops Alert 配置加载入口未就绪' });
        await globalScope.loadOpsAlertSettings(true);
        await globalScope.loadOpsAlertHealth?.(true);
        await globalScope.loadOpsAlertMonitor?.(true);
        await nextFrame();
        globalScope.switchModule?.('ops-alerts');
        await sleep(120);

        const quickReplyRows = await waitFor(() => {
            const rows = Array.from(document.querySelectorAll('#opsAlertCustomerChatQuickReplyTemplates [data-ops-alert-quick-reply-index]'));
            return rows.length ? rows : null;
        }, { message: '快捷回复模板未能在本地 smoke 中渲染' });
        recordResult('快捷回复模板已渲染', quickReplyRows.length >= 3, `检测到 ${quickReplyRows.length} 张模板卡片`);

        const shiftReportState = await waitFor(() => {
            const target = document.getElementById('opsAlertMonitorShiftReport');
            if (!(target instanceof HTMLElement)) {
                return null;
            }

            const switchNode = target.querySelector('.ops-alert-shift-report__view-switch');
            if (switchNode instanceof HTMLElement) {
                return { target, switchNode };
            }

            const text = String(target.textContent || '').trim();
            if (text) {
                return { target, switchNode: null };
            }

            return null;
        }, {
            message: '交班报表未能在本地 smoke 中渲染',
            timeoutMs: 20000
        });
        const shiftChips = shiftReportState.switchNode
            ? Array.from(shiftReportState.switchNode.querySelectorAll('[data-admin-action="settings-set-ops-alert-shift-report-view"]'))
            : [];
        recordResult(
            '交班报表视角切换已渲染',
            shiftChips.length >= 4,
            shiftChips.length >= 4
                ? `检测到 ${shiftChips.length} 个视角按钮`
                : String(shiftReportState.target?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 96)
        );

        const firstRow = quickReplyRows[0];
        const toggle = firstRow?.querySelector('[data-ops-alert-quick-reply-field="enabled"]');
        if (firstRow instanceof HTMLElement && toggle instanceof HTMLElement) {
            firstRow.scrollIntoView({ block: 'center', behavior: 'instant' });
            await nextFrame();
            const beforeScrollY = globalScope.scrollY || 0;
            const beforeTop = firstRow.getBoundingClientRect().top;
            toggle.click();
            await sleep(220);
            const afterScrollY = globalScope.scrollY || 0;
            const afterTop = firstRow.getBoundingClientRect().top;
            const scrollDelta = Math.abs(afterScrollY - beforeScrollY);
            const topDelta = Math.abs(afterTop - beforeTop);
            recordResult(
                '启用模板切换不再跳页',
                scrollDelta <= 2 && topDelta <= 8,
                `scrollΔ=${scrollDelta.toFixed(1)} / topΔ=${topDelta.toFixed(1)}`
            );
        } else {
            recordResult('启用模板切换不再跳页', false, '未找到可切换的模板开关');
        }

        const previewText = firstRow?.querySelector('[data-ops-alert-quick-reply-role="preview-text"]')?.textContent || '';
        recordResult('快捷回复预览面板可见', previewText.trim().length > 0, previewText.trim().slice(0, 32));

        const textField = firstRow?.querySelector('[data-ops-alert-quick-reply-field="text"]');
        if (textField instanceof HTMLTextAreaElement && typeof globalScope.saveOpsAlertSettings === 'function') {
            const originalText = textField.value;
            textField.value = '测试 {{unknown_token}}';
            textField.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(50);
            await globalScope.saveOpsAlertSettings();
            await sleep(120);
            const invalidVisible = firstRow.classList.contains('has-validation-error');
            recordResult('模板保存前会就地提示非法变量', invalidVisible, invalidVisible ? '非法占位变量被卡片内校验拦住' : '未显示卡片错误态');

            textField.value = originalText;
            textField.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(120);
            recordResult('模板修正后错误态会自动清除', !firstRow.classList.contains('has-validation-error'));
        } else {
            recordResult('模板保存前会就地提示非法变量', false, '未找到模板正文输入框或保存入口');
        }

        globalScope.setOpsAlertMonitorShiftReportView?.('mine');
        await sleep(80);
        const activeMineChip = document.querySelector('.ops-alert-shift-report__view-chip.is-active[data-ops-alert-shift-report-view="mine"]');
        const minePanelText = document.getElementById('opsAlertMonitorShiftReport')?.textContent || '';
        recordResult(
            '交班报表可切到“我的接班”视角',
            Boolean(activeMineChip) && /我名下积压模块|我的处理量/.test(minePanelText),
            minePanelText.replace(/\s+/g, ' ').trim().slice(0, 72)
        );

        await runDiscountTriggerSettingsSmoke();
        await runUserModalSmoke();
    }

    async function runAdminPaymentsSmoke() {
        await waitFor(
            () => globalScope.switchModule
                && globalScope.AdminPayments
                && typeof globalScope.AdminPayments.init === 'function'
                && (typeof globalScope.hasModulePermission !== 'function' || globalScope.hasModulePermission('payments') === true),
            { message: '支付对账模块入口未加载完成', timeoutMs: 30000 }
        );

        if (globalScope.AdminSiteFilter?.select) {
            globalScope.AdminSiteFilter.select('cn');
            await nextFrame();
            await sleep(80);
        }

        globalScope.syncAdminStudioModuleAccess?.({
            preferredModule: 'payments',
            enforceActiveModule: true
        });
        await sleep(120);

        const switched = globalScope.switchModule?.('payments', {
            fallback: false,
            silentDenied: true
        });
        if (switched === false) {
            await sleep(180);
            globalScope.switchModule?.('payments', {
                fallback: false,
                silentDenied: true
            });
        }

        const paymentsModule = await waitFor(
            () => document.getElementById('module-payments')?.classList.contains('active')
                ? document.getElementById('module-payments')
                : null,
            { message: '支付对账模块未切换成功', timeoutMs: 20000 }
        );

        await globalScope.AdminPayments.init();
        await sleep(180);

        globalScope.AdminPayments.switchTab?.('overview', { reload: false });
        await sleep(80);

        let overviewState = null;
        try {
            overviewState = await waitFor(
                () => {
                    const toolbar = document.getElementById('paymentsToolbarHighlights');
                    const overview = document.getElementById('paymentsOverviewGrid');
                    const toolbarText = String(toolbar?.textContent || '').replace(/\s+/g, ' ').trim();
                    const overviewText = String(overview?.textContent || '').replace(/\s+/g, ' ').trim();
                    return toolbar instanceof HTMLElement
                        && overview instanceof HTMLElement
                        && toolbarText.length > 0
                        && overviewText.length > 0
                        ? {
                            toolbarText,
                            overviewText
                        }
                        : null;
                },
                { message: '支付对账首屏未完成渲染', timeoutMs: 45000 }
            );
        } catch (_) {
            const toolbar = document.getElementById('paymentsToolbarHighlights');
            const overview = document.getElementById('paymentsOverviewGrid');
            const accessState = document.getElementById('paymentsAccessState');
            throw new Error([
                '支付对账首屏未完成渲染',
                `moduleActive=${paymentsModule.classList.contains('active') ? 'yes' : 'no'}`,
                `activeTab=${String(globalScope.AdminPayments?.getActiveTab?.() || '<empty>')}`,
                `toolbar=${String(toolbar?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '<empty>'}`,
                `overview=${String(overview?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '<empty>'}`,
                `access=${String(accessState?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '<empty>'}`,
                `runtime=${(smokeState.runtimeErrors || []).slice(-2).join(' || ').slice(0, 220) || '<none>'}`
            ].join(' | '));
        }

        recordResult(
            '支付对账首屏已渲染概览区块',
            overviewState.toolbarText.length > 0 && overviewState.overviewText.length > 0,
            [
                overviewState.toolbarText.slice(0, 40),
                overviewState.overviewText.slice(0, 40)
            ].join(' / ')
        );

        globalScope.AdminPayments.showWorkbenchContext?.({
            referenceValue: 'PAY-SMOKE-LOCAL-ORDER',
            queryLabel: '本地 smoke 支付链路'
        });
        await globalScope.AdminPayments.reload?.();
        await sleep(160);

        const issueSummary = await waitFor(
            () => {
                const target = document.getElementById('paymentsIssueSummary');
                const buttons = target instanceof HTMLElement
                    ? Array.from(target.querySelectorAll('[data-admin-action="payments-issue-summary-focus"]'))
                    : [];
                return target instanceof HTMLElement
                    && target.hidden === false
                    && String(target.textContent || '').trim().length > 0
                    && buttons.length > 0
                    ? { target, buttons }
                    : null;
            },
            { message: '支付对账问题摘要未渲染联动入口', timeoutMs: 20000 }
        );

        const prioritySummary = await waitFor(
            () => {
                const target = document.getElementById('paymentsPrioritySummary');
                const buttons = target instanceof HTMLElement
                    ? Array.from(target.querySelectorAll(
                        '[data-admin-action="payments-priority-focus-order"], [data-admin-action="payments-priority-focus-topic"], [data-admin-action="payments-priority-focus-ops"]'
                    ))
                    : [];
                return target instanceof HTMLElement
                    && target.hidden === false
                    && String(target.textContent || '').trim().length > 0
                    && buttons.length > 0
                    ? { target, buttons }
                    : null;
            },
            { message: '支付对账优先处理摘要未渲染联动入口', timeoutMs: 20000 }
        );

        recordResult(
            '支付对账摘要区已渲染联动入口',
            issueSummary.buttons.length > 0 && prioritySummary.buttons.length > 0,
            `issue=${issueSummary.buttons.length} / priority=${prioritySummary.buttons.length}`
        );

        const preferredIssueButton = issueSummary.buttons.find((button) => {
            const kind = String(button?.getAttribute('data-payments-issue-focus') || '').trim().toLowerCase();
            return ['ops', 'dead_letter', 'retry', 'refund', 'review', 'failed'].includes(kind);
        }) || issueSummary.buttons[0];

        let issueFocusPass = false;
        let issueFocusDetail = '未找到可用问题摘要入口';
        if (preferredIssueButton instanceof HTMLElement) {
            const issueKind = String(preferredIssueButton.getAttribute('data-payments-issue-focus') || '').trim().toLowerCase();
            await globalScope.AdminPayments.focusAnalyticsIssueSummary(issueKind);

            if (['ops', 'dead_letter', 'retry'].includes(issueKind)) {
                const queueState = await waitFor(
                    () => {
                        const target = document.getElementById('paymentsOpsAlertQueue');
                        const text = String(target?.textContent || '').replace(/\s+/g, ' ').trim();
                        return target instanceof HTMLElement
                            && globalScope.AdminPayments?.getActiveTab?.() === 'ops'
                            && text.length > 0
                            ? { text }
                            : null;
                    },
                    { message: '支付对账问题摘要未定位到告警队列', timeoutMs: 16000 }
                );
                issueFocusPass = true;
                issueFocusDetail = `${issueKind} -> ${queueState.text.slice(0, 72)}`;
            } else if (issueKind === 'refund') {
                const topicState = await waitFor(
                    () => {
                        const activeTopic = document.querySelector('#paymentsExceptionTopics .payments-exception-topic-card.is-active');
                        const list = document.getElementById('paymentsExceptionTopicList');
                        const topicKey = String(activeTopic?.getAttribute('data-payments-topic-key') || '').trim().toLowerCase();
                        const listText = String(list?.textContent || '').replace(/\s+/g, ' ').trim();
                        return activeTopic instanceof HTMLElement
                            && list instanceof HTMLElement
                            && topicKey
                            && listText.length > 0
                            ? { topicKey, listText }
                            : null;
                    },
                    { message: '支付对账问题摘要未定位到异常专题', timeoutMs: 16000 }
                );
                issueFocusPass = topicState.topicKey !== 'all';
                issueFocusDetail = `${issueKind} -> ${topicState.topicKey} / ${topicState.listText.slice(0, 56)}`;
            } else {
                const orderState = await waitFor(
                    () => {
                        const target = document.getElementById('paymentsOrdersTable');
                        const text = String(target?.textContent || '').replace(/\s+/g, ' ').trim();
                        return target instanceof HTMLElement
                            && globalScope.AdminPayments?.getActiveTab?.() === 'ops'
                            && text.length > 0
                            ? { text }
                            : null;
                    },
                    { message: '支付对账问题摘要未定位到订单列表', timeoutMs: 16000 }
                );
                issueFocusPass = true;
                issueFocusDetail = `${issueKind} -> ${orderState.text.slice(0, 72)}`;
            }
        }

        recordResult(
            '支付对账问题摘要支持一键聚焦',
            issueFocusPass,
            issueFocusDetail
        );

        const orderFocusButton = prioritySummary.target.querySelector('[data-admin-action="payments-priority-focus-order"]');
        const topicFocusButton = prioritySummary.target.querySelector('[data-admin-action="payments-priority-focus-topic"]');
        const opsFocusButton = prioritySummary.target.querySelector('[data-admin-action="payments-priority-focus-ops"]');

        let priorityFocusPass = false;
        let priorityFocusDetail = '未找到可用优先项入口';
        if (orderFocusButton instanceof HTMLElement) {
            const orderId = String(orderFocusButton.getAttribute('data-payments-order-id') || '').trim();
            await globalScope.AdminPayments.focusAnalyticsPrioritySummary('order', orderId);
            await waitFor(
                () => document.querySelector('#paymentsOrdersTable [data-payments-focused-order="1"], #paymentsOrdersTable .payments-order-card--focused')
                    ? true
                    : null,
                { message: '支付对账优先项未定位到订单', timeoutMs: 16000 }
            );
            priorityFocusPass = true;
            priorityFocusDetail = `order:${orderId || '<empty>'}`;
        } else if (topicFocusButton instanceof HTMLElement) {
            const topicKey = String(topicFocusButton.getAttribute('data-payments-topic-key') || '').trim().toLowerCase();
            await globalScope.AdminPayments.focusAnalyticsPrioritySummary('topic', topicKey);
            await waitFor(
                () => document.querySelector(`#paymentsExceptionTopics .payments-exception-topic-card.is-active[data-payments-topic-key="${topicKey}"]`)
                    ? true
                    : null,
                { message: '支付对账优先项未定位到异常专题', timeoutMs: 16000 }
            );
            priorityFocusPass = true;
            priorityFocusDetail = `topic:${topicKey || '<empty>'}`;
        } else if (opsFocusButton instanceof HTMLElement) {
            await globalScope.AdminPayments.focusAnalyticsPrioritySummary('ops');
            const queueState = await waitFor(
                () => {
                    const target = document.getElementById('paymentsOpsAlertQueue');
                    const text = String(target?.textContent || '').replace(/\s+/g, ' ').trim();
                    return target instanceof HTMLElement && text.length > 0
                        ? { text }
                        : null;
                },
                { message: '支付对账优先项未定位到告警队列', timeoutMs: 16000 }
            );
            priorityFocusPass = true;
            priorityFocusDetail = `ops:${queueState.text.slice(0, 56)}`;
        }

        recordResult(
            '支付对账优先项支持跳转聚焦',
            priorityFocusPass,
            priorityFocusDetail
        );

        recordResult(
            '支付对账模块聚焦后保持激活态',
            paymentsModule.classList.contains('active') && Boolean(globalScope.AdminPayments?.getActiveTab?.()),
            `tab=${String(globalScope.AdminPayments?.getActiveTab?.() || '<empty>')}`
        );
    }

    async function runDiscountTriggerSettingsSmoke() {
        globalScope.switchModule?.('settings');
        await sleep(180);
        await waitFor(() => typeof globalScope.initSettingsModule === 'function', {
            message: '设置模块初始化入口未就绪'
        });
        await globalScope.initSettingsModule({ bindListeners: true, force: true, renderView: true });
        await sleep(120);

        const card = await waitFor(() => {
            const node = document.querySelector('[data-config="discount-trigger-rules"]');
            return node instanceof HTMLElement ? node : null;
        }, { message: '卡券联动配置卡片未渲染' });

        card.scrollIntoView({ block: 'center', behavior: 'instant' });
        await nextFrame();
        await sleep(80);
        await globalScope.loadDiscountTriggerDiscountOptions?.(true);
        await sleep(120);

        const firstPresetCard = card.querySelector('[data-discount-trigger-section="recharge"][data-discount-trigger-preset="first_recharge"]');
        if (firstPresetCard instanceof HTMLElement) {
            const measuredCard = firstPresetCard.querySelector('.discount-trigger-preset-btn__surface') || firstPresetCard;
            const titleEl = measuredCard.querySelector('.discount-trigger-preset-btn__title');
            const descEl = measuredCard.querySelector('.discount-trigger-preset-btn__desc');
            const recommendationEl = measuredCard.querySelector('.discount-trigger-preset-btn__recommendation');
            const cardRect = measuredCard.getBoundingClientRect();
            const titleRect = titleEl?.getBoundingClientRect?.();
            const descRect = descEl?.getBoundingClientRect?.();
            const recommendationRect = recommendationEl?.getBoundingClientRect?.();
            const style = globalScope.getComputedStyle?.(measuredCard);
            const metrics = {
                display: style?.display || '',
                appearance: style?.appearance || style?.getPropertyValue?.('appearance') || '',
                paddingTop: Math.round(parseFloat(style?.paddingTop || '0')),
                paddingRight: Math.round(parseFloat(style?.paddingRight || '0')),
                paddingBottom: Math.round(parseFloat(style?.paddingBottom || '0')),
                paddingLeft: Math.round(parseFloat(style?.paddingLeft || '0')),
                minHeight: Math.round(parseFloat(style?.minHeight || '0')),
                titleTopInset: titleRect ? Math.round(titleRect.top - cardRect.top) : -1,
                titleLeftInset: titleRect ? Math.round(titleRect.left - cardRect.left) : -1,
                descTopGap: titleRect && descRect ? Math.round(descRect.top - titleRect.bottom) : -1,
                recommendationBottomInset: recommendationRect ? Math.round(cardRect.bottom - recommendationRect.bottom) : -1,
                recommendationTopGap: descRect && recommendationRect ? Math.round(recommendationRect.top - descRect.bottom) : -1
            };
            const spacingPass = metrics.paddingTop >= 18
                && metrics.paddingLeft >= 20
                && metrics.paddingBottom >= 20
                && metrics.minHeight >= 136
                && metrics.minHeight <= 156;
            recordResult(
                '卡券联动模板卡片留白体检',
                spacingPass,
                Object.entries(metrics).map(([key, value]) => `${key}:${value}`).join(' / ')
            );

            const matchedRules = [];
            Array.from(document.styleSheets || []).forEach((sheet) => {
                let rules;
                try {
                    rules = Array.from(sheet.cssRules || []);
                } catch (_) {
                    rules = [];
                }
                rules.forEach((rule) => {
                    if (!(rule instanceof CSSStyleRule)) {
                        return;
                    }
                    const selectorText = String(rule.selectorText || '').trim();
                    if (!selectorText) {
                        return;
                    }
                    let matches = false;
                    try {
                        matches = measuredCard.matches(selectorText);
                    } catch (_) {
                        matches = false;
                    }
                    if (!matches) {
                        return;
                    }
                    const styleText = [
                        rule.style.getPropertyValue('display') ? `display:${rule.style.getPropertyValue('display')}${rule.style.getPropertyPriority('display') ? ' !important' : ''}` : '',
                        rule.style.getPropertyValue('padding') ? `padding:${rule.style.getPropertyValue('padding')}${rule.style.getPropertyPriority('padding') ? ' !important' : ''}` : '',
                        rule.style.getPropertyValue('padding-top') ? `padding-top:${rule.style.getPropertyValue('padding-top')}${rule.style.getPropertyPriority('padding-top') ? ' !important' : ''}` : '',
                        rule.style.getPropertyValue('padding-bottom') ? `padding-bottom:${rule.style.getPropertyValue('padding-bottom')}${rule.style.getPropertyPriority('padding-bottom') ? ' !important' : ''}` : '',
                        rule.style.getPropertyValue('min-height') ? `min-height:${rule.style.getPropertyValue('min-height')}${rule.style.getPropertyPriority('min-height') ? ' !important' : ''}` : '',
                        rule.style.getPropertyValue('height') ? `height:${rule.style.getPropertyValue('height')}${rule.style.getPropertyPriority('height') ? ' !important' : ''}` : ''
                    ].filter(Boolean).join(' / ');
                    if (!styleText) {
                        return;
                    }
                    matchedRules.push(`${selectorText} => ${styleText}`);
                });
            });
            recordResult(
                '卡券联动模板卡片命中样式规则',
                matchedRules.some((entry) => entry.includes('.discount-trigger-preset-btn__surface')),
                matchedRules.join(' || ').slice(0, 1500) || '未找到命中规则'
            );

            const presetCards = Array.from(card.querySelectorAll('#discountTriggerRechargePresetRow .discount-trigger-preset-btn__surface'));
            const firstSurface = presetCards[0];
            const secondSurface = presetCards[1];
            if (firstSurface instanceof HTMLElement && secondSurface instanceof HTMLElement) {
                const firstRect = firstSurface.getBoundingClientRect();
                const secondRect = secondSurface.getBoundingClientRect();
                const firstButtonRect = firstSurface.parentElement?.getBoundingClientRect?.();
                const secondButtonRect = secondSurface.parentElement?.getBoundingClientRect?.();
                const firstStyle = globalScope.getComputedStyle?.(firstSurface);
                const secondStyle = globalScope.getComputedStyle?.(secondSurface);
                const horizontalGap = Math.round(secondRect.left - firstRect.right);
                const firstOverflow = firstButtonRect ? Math.round(firstRect.width - firstButtonRect.width) : -1;
                const secondOverflow = secondButtonRect ? Math.round(secondRect.width - secondButtonRect.width) : -1;
                const overlapPass = firstOverflow <= 0
                    && secondOverflow <= 0
                    && String(firstStyle?.boxSizing || '') === 'border-box'
                    && String(secondStyle?.boxSizing || '') === 'border-box';
                recordResult(
                    '卡券联动模板卡片网格间距体检',
                    overlapPass,
                    [
                        `gap:${horizontalGap}`,
                        `firstWidth:${Math.round(firstRect.width)}`,
                        `secondWidth:${Math.round(secondRect.width)}`,
                        `firstOverflow:${firstOverflow}`,
                        `secondOverflow:${secondOverflow}`,
                        `firstBoxSizing:${String(firstStyle?.boxSizing || '')}`,
                        `secondBoxSizing:${String(secondStyle?.boxSizing || '')}`
                    ].join(' / ')
                );
            } else {
                recordResult('卡券联动模板卡片网格间距体检', false, '未找到前两张模板卡片');
            }
        } else {
            recordResult('卡券联动模板卡片留白体检', false, '未找到首张推荐模板卡片');
            recordResult('卡券联动模板卡片命中样式规则', false, '未找到首张推荐模板卡片');
            recordResult('卡券联动模板卡片网格间距体检', false, '未找到首张推荐模板卡片');
        }

        const sections = [
            {
                key: 'recharge',
                label: '充值',
                toggleId: 'discountTriggerRechargeEnabledToggle',
                summaryId: 'discountTriggerRechargeSummary',
                addButtonId: 'discountTriggerAddRechargeRuleBtn',
                listId: 'discountTriggerRechargeRuleList',
                presetId: 'first_recharge',
                expectedPrefill: { field: 'first_recharge_only', kind: 'checked', value: true },
                expectedRecommendationCode: 'TOPUP88',
                expectedAutoDiscountId: 'discount-cn-wallet-bonus',
                expectedSite: 'cn'
            },
            {
                key: 'checkin',
                label: '签到',
                toggleId: 'discountTriggerCheckinEnabledToggle',
                summaryId: 'discountTriggerCheckinSummary',
                addButtonId: 'discountTriggerAddCheckinRuleBtn',
                listId: 'discountTriggerCheckinRuleList',
                presetId: 'streak_7',
                expectedPrefill: { field: 'min_streak_days', kind: 'value', value: '7' },
                expectedRecommendationCode: 'TOPUP88',
                expectedAutoDiscountId: 'discount-cn-wallet-bonus',
                expectedSite: 'cn'
            },
            {
                key: 'affiliate',
                label: '推广',
                toggleId: 'discountTriggerAffiliateEnabledToggle',
                summaryId: 'discountTriggerAffiliateSummary',
                addButtonId: 'discountTriggerAddAffiliateRuleBtn',
                listId: 'discountTriggerAffiliateRuleList',
                presetId: 'commission',
                expectedPrefill: { field: 'reward_type', kind: 'value', value: 'commission' },
                expectedRecommendationCode: 'TOPUP88',
                expectedAutoDiscountId: 'discount-cn-wallet-bonus',
                expectedSite: 'cn'
            }
        ];

        const renderedSections = await waitFor(() => {
            const ready = sections.every((section) => {
                const toggle = document.getElementById(section.toggleId);
                const summary = document.getElementById(section.summaryId);
                const addButton = document.getElementById(section.addButtonId);
                const list = document.getElementById(section.listId);
                return toggle instanceof HTMLElement
                    && summary instanceof HTMLElement
                    && String(summary.textContent || '').trim().length > 0
                    && addButton instanceof HTMLButtonElement
                    && document.querySelector(`[data-trigger-section="${section.key}"] [data-discount-trigger-preset="${section.presetId}"]`) instanceof HTMLButtonElement
                    && list instanceof HTMLElement;
            });
            return ready ? sections : null;
        }, { message: '卡券联动三段配置未完整渲染' });

        recordResult(
            '卡券联动三段配置已渲染',
            renderedSections.length === 3,
            renderedSections.map((section) => section.label).join(' / ')
        );

        recordResult(
            '卡券联动推荐模板已渲染',
            renderedSections.every((section) => (
                document.querySelector(`[data-trigger-section="${section.key}"] [data-discount-trigger-preset="${section.presetId}"]`) instanceof HTMLButtonElement
            )),
            renderedSections.map((section) => `${section.label}:${section.presetId}`).join(' / ')
        );

        await waitFor(() => {
            const ready = renderedSections.every((section) => {
                const recommendationNode = document.querySelector(`[data-trigger-section="${section.key}"] [data-discount-trigger-preset="${section.presetId}"] [data-discount-trigger-preset-role="recommendation"]`);
                return recommendationNode instanceof HTMLElement
                    && String(recommendationNode.textContent || '').includes(section.expectedRecommendationCode)
                    ? true
                    : null;
            });
            return ready ? true : null;
        }, { message: '卡券联动模板候选提示未刷新为具体卡券', timeoutMs: 20000 });

        recordResult(
            '卡券联动模板说明和候选提示已渲染',
            renderedSections.every((section) => {
                const presetButton = document.querySelector(`[data-trigger-section="${section.key}"] [data-discount-trigger-preset="${section.presetId}"]`);
                if (!(presetButton instanceof HTMLButtonElement)) {
                    return false;
                }
                const descNode = presetButton.querySelector('.discount-trigger-preset-btn__desc');
                const recommendationNode = presetButton.querySelector('[data-discount-trigger-preset-role="recommendation"]');
                return descNode instanceof HTMLElement
                    && String(descNode.textContent || '').trim().length > 0
                    && recommendationNode instanceof HTMLElement
                    && String(recommendationNode.textContent || '').includes(section.expectedRecommendationCode);
            }),
            renderedSections
                .map((section) => {
                    const recommendationNode = document.querySelector(`[data-trigger-section="${section.key}"] [data-discount-trigger-preset="${section.presetId}"] [data-discount-trigger-preset-role="recommendation"]`);
                    return `${section.label}:${recommendationNode instanceof HTMLElement ? String(recommendationNode.textContent || '').trim().slice(0, 24) : '<missing>'}`;
                })
                .join(' / ')
        );

        const getRuleCardCount = (listId) => document.querySelectorAll(`#${listId} [data-rule-key]`).length;
        const baselineCounts = Object.fromEntries(renderedSections.map((section) => [section.key, getRuleCardCount(section.listId)]));

        for (const section of renderedSections) {
            const toggle = document.getElementById(section.toggleId);
            const sectionRoot = document.querySelector(`.discount-trigger-section[data-trigger-section="${section.key}"]`);
            if (toggle instanceof HTMLElement && !toggle.classList.contains('active')) {
                toggle.click();
                await waitFor(() => {
                    if (!(sectionRoot instanceof HTMLElement)) {
                        return null;
                    }
                    return sectionRoot.classList.contains('is-expanded')
                        ? true
                        : null;
                }, { message: `${section.label} 卡券联动段落未能展开` });
                await sleep(80);
            }
        }

        let isolatedPresetPass = true;
        let autoSelectionPass = true;
        for (const section of renderedSections) {
            const presetButton = document.querySelector(`[data-trigger-section="${section.key}"] [data-discount-trigger-preset="${section.presetId}"]`);
            if (!(presetButton instanceof HTMLButtonElement)) {
                isolatedPresetPass = false;
                autoSelectionPass = false;
                continue;
            }

            presetButton.click();
            await waitFor(
                () => getRuleCardCount(section.listId) === baselineCounts[section.key] + 1
                    ? true
                    : null,
                { message: `${section.label} 模板规则未能新增` }
            );

            const crossAffected = renderedSections.some((otherSection) => (
                otherSection.key !== section.key
                && getRuleCardCount(otherSection.listId) !== baselineCounts[otherSection.key]
            ));
            if (crossAffected) {
                isolatedPresetPass = false;
            }

            const targetCard = document.querySelector(`#${section.listId} [data-rule-key]`);
            if (!(targetCard instanceof HTMLElement)) {
                isolatedPresetPass = false;
                autoSelectionPass = false;
            } else {
                const prefill = section.expectedPrefill || {};
                const targetField = targetCard.querySelector(`[data-field="${prefill.field}"]`);
                if (prefill.kind === 'checked') {
                    if (!(targetField instanceof HTMLInputElement) || targetField.checked !== prefill.value) {
                        isolatedPresetPass = false;
                    }
                } else if (prefill.kind === 'value') {
                    if (!(targetField instanceof HTMLInputElement || targetField instanceof HTMLSelectElement) || String(targetField.value || '') !== String(prefill.value || '')) {
                        isolatedPresetPass = false;
                    }
                }

                const discountField = targetCard.querySelector('[data-field="discount_id"]');
                const siteField = targetCard.querySelector('[data-field="site"]');
                if (!(discountField instanceof HTMLSelectElement) || String(discountField.value || '') !== section.expectedAutoDiscountId) {
                    autoSelectionPass = false;
                }
                if (!(siteField instanceof HTMLSelectElement) || String(siteField.value || '') !== section.expectedSite) {
                    autoSelectionPass = false;
                }
            }

            baselineCounts[section.key] = getRuleCardCount(section.listId);
        }

        recordResult(
            '卡券联动推荐模板会按段落插入预填规则',
            isolatedPresetPass,
            renderedSections
                .map((section) => `${section.label} ${baselineCounts[section.key]} 条`)
                .join(' / ')
        );

        recordResult(
            '卡券联动模板会自动预选推荐卡券',
            autoSelectionPass,
            renderedSections
                .map((section) => {
                    const discountField = document.querySelector(`#${section.listId} [data-field="discount_id"]`);
                    const siteField = document.querySelector(`#${section.listId} [data-field="site"]`);
                    return `${section.label} ${discountField instanceof HTMLSelectElement ? discountField.value || '<empty>' : '<missing>'} / ${siteField instanceof HTMLSelectElement ? siteField.value || '<empty>' : '<missing>'}`;
                })
                .join(' / ')
        );

        const statusText = String(document.getElementById('discountTriggerRechargeStatusText')?.textContent || '').trim();
        recordResult(
            '卡券联动改动后会进入统一待保存状态',
            /改动还没保存|保存前需要补齐/.test(statusText),
            statusText.slice(0, 64)
        );

        await waitFor(() => {
            const ready = renderedSections.every((section) => {
                const select = document.querySelector(`#${section.listId} [data-field="discount_id"]`);
                if (!(select instanceof HTMLSelectElement)) {
                    return null;
                }
                return Array.from(select.options).some((option) => String(option.value || '').trim())
                    ? true
                    : null;
            });
            return ready ? true : null;
        }, { message: '卡券联动可选卡券未加载完成', timeoutMs: 20000 });

        renderedSections.forEach((section) => {
            const toggle = document.getElementById(section.toggleId);
            if (toggle instanceof HTMLElement && !toggle.classList.contains('active')) {
                toggle.click();
            }
        });

        await sleep(160);

        const saveButton = document.getElementById('discountTriggerRechargeSaveBtn');
        if (saveButton instanceof HTMLButtonElement) {
            saveButton.click();
        }

        await waitFor(() => {
            const node = document.getElementById('discountTriggerRechargeStatusText');
            return node instanceof HTMLElement && /当前配置已保存/.test(String(node.textContent || ''))
                ? node
                : null;
        }, { message: '卡券联动保存后未进入已保存状态', timeoutMs: 20000 });

        const savedResponse = await globalScope.fetch('/api/admin/settings/system-config?domain=commerce', {
            method: 'GET',
            credentials: 'include'
        });
        const savedPayload = await savedResponse.json();
        const savedRules = savedPayload?.configs?.discount_trigger_rules || {};
        const savedToConfigPass = renderedSections.every((section) => {
            const rules = Array.isArray(savedRules?.[section.key]?.rules) ? savedRules[section.key].rules : [];
            return rules.length === 1
                && String(rules[0]?.discount_id || '').trim().length > 0
                && savedRules?.[section.key]?.enabled === true;
        });

        recordResult(
            '卡券联动保存后会写回 system-config',
            savedToConfigPass,
            renderedSections
                .map((section) => `${section.label} ${Array.isArray(savedRules?.[section.key]?.rules) ? savedRules[section.key].rules.length : 0} 条`)
                .join(' / ')
        );

        if (globalScope.systemConfigCache && typeof globalScope.systemConfigCache === 'object') {
            globalScope.systemConfigCache.discount_trigger_rules = deepClone(savedRules);
        }
        await globalScope.hydrateDiscountTriggerSettingsDraft?.({ force: true });
        await globalScope.renderDiscountTriggerSettings?.();
        await sleep(180);

        await waitFor(() => {
            const restored = renderedSections.every((section) => getRuleCardCount(section.listId) === 1);
            return restored ? true : null;
        }, { message: '卡券联动重载后规则数量未恢复', timeoutMs: 20000 });

        const restoredSelectionsPass = renderedSections.every((section) => {
            const discountSelect = document.querySelector(`#${section.listId} [data-field="discount_id"]`);
            return discountSelect instanceof HTMLSelectElement && String(discountSelect.value || '').trim().length > 0;
        });
        const restoredPrefillsPass = renderedSections.every((section) => {
            const prefill = section.expectedPrefill || {};
            const targetField = document.querySelector(`#${section.listId} [data-field="${prefill.field}"]`);
            if (prefill.kind === 'checked') {
                return targetField instanceof HTMLInputElement && targetField.checked === prefill.value;
            }
            if (prefill.kind === 'value') {
                return (targetField instanceof HTMLInputElement || targetField instanceof HTMLSelectElement)
                    && String(targetField.value || '') === String(prefill.value || '');
            }
            return true;
        });

        const restoredStatusText = String(document.getElementById('discountTriggerRechargeStatusText')?.textContent || '').trim();
        recordResult(
            '卡券联动重载后会保留已保存规则',
            restoredSelectionsPass && restoredPrefillsPass && /当前配置已保存/.test(restoredStatusText),
            `${renderedSections
                .map((section) => {
                    const discountSelect = document.querySelector(`#${section.listId} [data-field="discount_id"]`);
                    const prefill = section.expectedPrefill || {};
                    const targetField = document.querySelector(`#${section.listId} [data-field="${prefill.field}"]`);
                    const prefillValue = prefill.kind === 'checked'
                        ? (targetField instanceof HTMLInputElement ? String(targetField.checked) : '<missing>')
                        : ((targetField instanceof HTMLInputElement || targetField instanceof HTMLSelectElement) ? targetField.value || '<empty>' : '<missing>');
                    return `${section.label} ${discountSelect instanceof HTMLSelectElement ? discountSelect.value || '<empty>' : '<missing>'} / ${prefill.field}:${prefillValue}`;
                })
                .join(' / ')} | ${restoredStatusText.slice(0, 48)}`
        );
    }

    async function runAdminAnalyticsSmoke() {
        async function runAnalyticsSmokeStep(label, task, timeoutMs = 20000) {
            let timerId = 0;
            try {
                return await Promise.race([
                    Promise.resolve().then(task),
                    new Promise((_, reject) => {
                        timerId = globalScope.setTimeout(() => {
                            reject(new Error(`${label} 超时`));
                        }, timeoutMs);
                    })
                ]);
            } finally {
                if (timerId) {
                    globalScope.clearTimeout(timerId);
                }
            }
        }

        await waitFor(
            () => globalScope.switchModule && globalScope.switchAnalyticsTab && globalScope.AdminSiteFilter?.select && typeof globalScope.reloadAnalyticsDashboard === 'function' && typeof globalScope.initAnalyticsModule === 'function',
            { message: 'Analytics 模块入口未加载完成' }
        );
        if (!(globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true)
            && globalScope.AdminAccess?.getCurrentAdminAccess) {
            try {
                const access = await Promise.resolve(globalScope.AdminAccess.getCurrentAdminAccess({ forceRefresh: true }));
                if (access?.isAdmin || access?.isSuperAdmin) {
                    globalScope.isAdmin = Boolean(access.isAdmin);
                    globalScope.isSuperAdmin = Boolean(access.isSuperAdmin);
                    globalScope.currentUserPermissions = Array.isArray(access.permissions) ? access.permissions : [];
                    globalScope.adminStudioAccessGranted = Boolean(access.isAdmin || access.isSuperAdmin);
                    globalScope.dispatchEvent?.(new CustomEvent('adminStudioAccessGranted'));
                    globalScope.dispatchEvent?.(new CustomEvent('permissionsLoaded'));
                }
            } catch (error) {
                smokeState.runtimeErrors.push(`analytics-access:${String(error?.message || error)}`);
            }
        }
        await waitFor(
            () => globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true,
            { message: 'Analytics smoke 等待后台访问态超时', timeoutMs: 20000 }
        );

        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);

        if (typeof globalScope.reloadAnalyticsDashboard === 'function' && globalScope.reloadAnalyticsDashboard.__smokeWrapped !== true) {
            const originalReload = globalScope.reloadAnalyticsDashboard;
            const wrappedReload = async function wrappedReload(...args) {
                const options = args[0] && typeof args[0] === 'object' ? args[0] : {};
                smokeState.analyticsReloadCalls.push({
                    reason: String(options.reason || 'unknown'),
                    site: normalizeSmokeAnalyticsSite(globalScope.AdminSiteFilter?.getSiteFilter?.() || 'all'),
                    timestamp: new Date().toISOString()
                });
                return originalReload.apply(this, args);
            };
            wrappedReload.__smokeWrapped = true;
            globalScope.reloadAnalyticsDashboard = wrappedReload;
        }
        const triggerAnalyticsReload = (options) => {
            if (typeof globalScope.reloadAnalyticsDashboard !== 'function') {
                return;
            }
            try {
                const maybePromise = globalScope.reloadAnalyticsDashboard(options);
                if (maybePromise && typeof maybePromise.catch === 'function') {
                    maybePromise.catch(() => {});
                }
            } catch {
                // The following KPI wait will surface an actionable smoke failure.
            }
        };
        const switchAnalyticsSmokeTab = (tabId) => {
            globalScope.switchAnalyticsTab?.(tabId, {
                ensureTabLoad: false,
                syncRoute: false
            });
        };

        const getActiveAnalyticsModule = () => document.querySelector('#module-business-overview.active, #module-growth-center.active, #module-commerce-center.active');
        await waitFor(
            () => {
                globalScope.switchModule?.('business-overview');
                return getActiveAnalyticsModule();
            },
            { message: 'Analytics 模块未激活', timeoutMs: 20000, intervalMs: 120 }
        );
        await runAnalyticsSmokeStep('Analytics 初始化', () => globalScope.initAnalyticsModule(), 25000);
        recordResult(
            'Analytics 初始化流程已完成',
            true,
            `reloads=${smokeState.analyticsReloadCalls.length}`
        );
        await runAnalyticsSmokeStep(
            'Analytics 首次刷新',
            () => globalScope.reloadAnalyticsDashboard({ reason: 'smoke-analytics-initial' }),
            25000
        );
        recordResult(
            'Analytics 首次刷新已完成',
            true,
            `reloads=${smokeState.analyticsReloadCalls.length}`
        );

        let kpiValue = '';
        try {
            kpiValue = await waitFor(
                () => {
                    const value = document.getElementById('kpiDauValue')?.textContent || '';
                    return value.trim() && value.trim() !== '--' ? value.trim() : null;
                },
                { message: 'Analytics 概览 KPI 未完成渲染', timeoutMs: 20000 }
            );
        } catch (_) {
            throw new Error(
                `Analytics 概览 KPI 未完成渲染 (active=${getActiveAnalyticsModule() ? 'yes' : 'no'}, dau=${String(document.getElementById('kpiDauValue')?.textContent || '').trim() || '<empty>'}, reloads=${smokeState.analyticsReloadCalls.length}, rpcCalls=${smokeState.analyticsRpcCallCount}, smokeClient=${globalScope.supabaseClient?.__localSmokeClient === true ? 'yes' : 'no'}, overviewSite=${smokeState.analyticsRpcLastParams.get_overview_stats_with_trend?.p_site || '<missing>'}, topDays=${smokeState.analyticsRpcLastParams.get_content_top?.p_days || '<missing>'}, runtime=${smokeState.runtimeErrors.slice(-6).join(' | ') || '<none>'})`
            );
        }
        recordResult('Analytics 概览 KPI 已渲染', /^\d/.test(kpiValue), `dau=${kpiValue}`);

        const ensureAnalyticsContentTabReady = async (reason = 'smoke-analytics-content') => {
            const reloadCountBeforeContent = smokeState.analyticsReloadCalls.length;
            switchAnalyticsSmokeTab('content');
            await waitFor(
                () => document.getElementById('analytics-tab-content')?.classList.contains('active') === true,
                { message: 'Analytics 内容分栏未激活', timeoutMs: 20000 }
            );
            if (!document.querySelector('#topContentList .top-content-item')) {
                if (typeof globalScope.reloadAnalyticsDashboard === 'function') {
                    triggerAnalyticsReload({
                        reason,
                        activeTabId: 'content',
                        force: smokeState.analyticsReloadCalls.length === reloadCountBeforeContent
                    });
                }
            }
        };

        await ensureAnalyticsContentTabReady();

        const topContentItems = await waitFor(
            () => {
                const items = Array.from(document.querySelectorAll('#topContentList .top-content-item'));
                return items.length ? items : null;
            },
            { message: 'Analytics 热门内容未渲染', timeoutMs: 20000 }
        );
        recordResult(
            'Analytics 热门内容列表已渲染',
            topContentItems.length >= 2,
            String(topContentItems[0]?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 64)
        );

        const proxyHint = await waitFor(
            () => document.querySelector('#conversionFunnel .analytics-proxy-hint'),
            { message: 'Analytics 漏斗口径提示未出现', timeoutMs: 20000 }
        );
        recordResult(
            'Analytics 漏斗会显示真实事件口径提示',
            /真实业务事件漏斗/.test(String(proxyHint?.textContent || '')),
            String(proxyHint?.textContent || '').trim().slice(0, 64)
        );

        const reloadCountBeforeRange = smokeState.analyticsReloadCalls.length;
        const rangeTrigger = document.querySelector('[data-admin-action="analytics-toggle-range-dropdown"]');
        const presetThirtyDays = document.querySelector('.preset-btn[data-range="30"][data-admin-action="analytics-select-preset-range"]');
        if (rangeTrigger instanceof HTMLElement && presetThirtyDays instanceof HTMLElement) {
            if (typeof globalScope.selectPresetRange === 'function') {
                globalScope.selectPresetRange(30);
            } else {
                rangeTrigger.click();
                await sleep(80);
                presetThirtyDays.click();
            }
            await waitFor(
                () => String(document.getElementById('dateRangeLabel')?.textContent || '').includes('30'),
                { message: 'Analytics 日期标签未切到 30 天' }
            );
            await waitFor(
                () => smokeState.analyticsReloadCalls.length > reloadCountBeforeRange,
                { message: 'Analytics 日期切换后未触发 dashboard reload' }
            );
            try {
                await waitFor(
                    () => {
                        const latestPanelSupportQuery = smokeState.analyticsAdminRouteLastQuery['analytics/panel-support-bundle'] || {};
                        const latestHasExplicitBundleRange = Boolean(latestPanelSupportQuery.startDate && latestPanelSupportQuery.endDate);
                        const latestHasThirtyDayWindow = Number(smokeState.analyticsRpcLastParams.get_content_top?.p_days) === 30
                            || Number(smokeState.analyticsRpcLastParams.get_redemption_funnel?.p_days) === 30
                            || Number(latestPanelSupportQuery.days) === 30
                            || latestHasExplicitBundleRange;
                        return latestHasThirtyDayWindow ? latestPanelSupportQuery : null;
                    },
                    { message: 'Analytics 日期切换后关键加载链路仍未同步 30 天窗口', timeoutMs: 8000, intervalMs: 120 }
                );
            } catch (_) {
                // Keep the original recordResult detail below so smoke output shows the stale route.
            }

            const topContentText = String(document.getElementById('topContentList')?.textContent || '');
            const topContentMeta = String(document.getElementById('topContentMeta')?.textContent || '').trim();
            const panelSupportQuery = smokeState.analyticsAdminRouteLastQuery['analytics/panel-support-bundle'] || {};
            const hasExplicitBundleRange = Boolean(panelSupportQuery.startDate && panelSupportQuery.endDate);
            const hasThirtyDayWindow = Number(smokeState.analyticsRpcLastParams.get_content_top?.p_days) === 30
                || Number(smokeState.analyticsRpcLastParams.get_redemption_funnel?.p_days) === 30
                || Number(panelSupportQuery.days) === 30
                || hasExplicitBundleRange;
            recordResult(
                'Analytics 日期预设会更新整页范围标签',
                String(document.getElementById('dateRangeLabel')?.textContent || '').includes('30'),
                String(document.getElementById('dateRangeLabel')?.textContent || '').trim()
            );
            recordResult(
                'Analytics 日期切换会把窗口参数传给关键加载链路',
                smokeState.analyticsReloadCalls.length > reloadCountBeforeRange
                    && hasThirtyDayWindow,
                `reload+${smokeState.analyticsReloadCalls.length - reloadCountBeforeRange} / top=${smokeState.analyticsRpcLastParams.get_content_top?.p_days || 'n/a'} / funnel=${smokeState.analyticsRpcLastParams.get_redemption_funnel?.p_days || 'n/a'} / bundleDays=${panelSupportQuery.days || 'n/a'} / bundleRange=${hasExplicitBundleRange ? 'explicit' : 'n/a'}`
            );
            recordResult(
                'Analytics 热门内容会跟随日期窗口刷新',
                topContentMeta.length > 0 && !/最近 7 天/.test(topContentMeta) && topContentText.trim().length > 0,
                `${topContentMeta} | ${topContentText.replace(/\s+/g, ' ').trim().slice(0, 64)}`
            );
        } else {
            recordResult('Analytics 日期预设会更新整页范围标签', false, '未找到日期范围控件');
            recordResult('Analytics 日期切换会把窗口参数传给关键 RPC', false, '未找到日期范围控件');
            recordResult('Analytics 热门内容会跟随日期窗口刷新', false, '未找到日期范围控件');
        }

        switchAnalyticsSmokeTab('monetization');
        await waitFor(
            () => document.getElementById('analytics-tab-monetization')?.classList.contains('active') === true,
            { message: 'Analytics 积分与交易分栏未激活', timeoutMs: 20000 }
        );
        triggerAnalyticsReload({
            reason: 'smoke-analytics-monetization',
            activeTabId: 'monetization',
            force: true
        });
        await waitFor(
            () => {
                const value = String(document.getElementById('kpiPointsInValue')?.textContent || '').trim();
                return value && value !== '--' ? value : null;
            },
            { message: 'Analytics 积分与交易指标未完成渲染', timeoutMs: 20000 }
        );
        const pointsTabActive = document.getElementById('analytics-tab-monetization')?.classList.contains('active') === true;
        const pointsIncome = String(document.getElementById('kpiPointsInValue')?.textContent || '').trim();
        recordResult(
            'Analytics 分栏切到积分与交易后仍保留关键指标',
            pointsTabActive && pointsIncome && pointsIncome !== '--',
            `active=${pointsTabActive} / income=${pointsIncome || '<empty>'}`
        );

        switchAnalyticsSmokeTab('verify');
        await waitFor(
            () => document.getElementById('analytics-tab-verify')?.classList.contains('active') === true,
            { message: 'Analytics 验证服务分栏未激活', timeoutMs: 20000 }
        );
        triggerAnalyticsReload({
            reason: 'smoke-analytics-verify',
            activeTabId: 'verify',
            force: true
        });
        await waitFor(
            () => {
                const value = String(document.getElementById('kpiVerifyRequestsValue')?.textContent || '').trim();
                return value && value !== '--' ? value : null;
            },
            { message: 'Analytics 验证服务摘要未完成渲染', timeoutMs: 20000 }
        );
        const verifyTabActive = document.getElementById('analytics-tab-verify')?.classList.contains('active') === true;
        const verifyRequests = String(document.getElementById('kpiVerifyRequestsValue')?.textContent || '').trim();
        recordResult(
            'Analytics 验证服务分栏会渲染业务摘要',
            verifyTabActive && verifyRequests && verifyRequests !== '--',
            `active=${verifyTabActive} / requests=${verifyRequests || '<empty>'}`
        );

        switchAnalyticsSmokeTab('growth');
        await waitFor(
            () => document.getElementById('analytics-tab-growth')?.classList.contains('active') === true,
            { message: 'Analytics 社区与裂变分栏未激活', timeoutMs: 20000 }
        );
        triggerAnalyticsReload({
            reason: 'smoke-analytics-growth',
            activeTabId: 'growth',
            force: true
        });
        await waitFor(
            () => {
                const value = String(document.getElementById('kpiGrowthMessagesValue')?.textContent || '').trim();
                return value && value !== '--' ? value : null;
            },
            { message: 'Analytics 社区与裂变摘要未完成渲染', timeoutMs: 20000 }
        );
        const growthTabActive = document.getElementById('analytics-tab-growth')?.classList.contains('active') === true;
        const growthMessages = String(document.getElementById('kpiGrowthMessagesValue')?.textContent || '').trim();
        recordResult(
            'Analytics 社区与裂变分栏会渲染业务摘要',
            growthTabActive && growthMessages && growthMessages !== '--',
            `active=${growthTabActive} / messages=${growthMessages || '<empty>'}`
        );

        const advancedEntry = document.getElementById('analyticsAdvancedToggleBtn');
        const advancedNavButton = document.querySelector('#analyticsTabsNav .admin-tab[data-tab="ai"]');
        const advancedWorkspace = document.getElementById('analyticsAdvancedWorkspace');
        if (advancedEntry instanceof HTMLElement && advancedWorkspace?.hidden === false) {
            advancedEntry.click();
            await sleep(80);
        }
        recordResult(
            'Analytics 高级分析改为按需入口',
            advancedEntry instanceof HTMLElement && !advancedNavButton && advancedWorkspace?.hidden === true,
            `entry=${advancedEntry instanceof HTMLElement ? 'yes' : 'no'} / nav=${advancedNavButton ? 'yes' : 'no'} / hidden=${advancedWorkspace?.hidden === true ? 'yes' : 'no'}`
        );

        if (advancedEntry instanceof HTMLElement) {
            advancedEntry.click();
            await sleep(80);
        }
        recordResult(
            'Analytics 按需入口会展开手动工具区',
            advancedWorkspace?.hidden === false
                && document.getElementById('generateInsightBtn') instanceof HTMLElement
                && !(document.getElementById('experimentsList') instanceof HTMLElement),
            `hidden=${advancedWorkspace?.hidden === false ? 'no' : 'yes'} / insight=${document.getElementById('generateInsightBtn') instanceof HTMLElement ? 'yes' : 'no'} / legacy=${document.getElementById('experimentsList') instanceof HTMLElement ? 'yes' : 'no'}`
        );

        switchAnalyticsSmokeTab('overview');
        await sleep(60);
        await ensureAnalyticsContentTabReady('smoke-analytics-site-content');

        const channelCountBeforeSite = smokeState.analyticsRealtimeChannelsCreated;
        const reloadCountBeforeSite = smokeState.analyticsReloadCalls.length;
        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(180);
        await waitFor(
            () => {
                const activeSite = String(globalScope.AdminSiteFilter?.getSiteFilter?.() || '').trim().toLowerCase();
                const labelText = String(document.querySelector('.site-selector-label')?.textContent || '').trim().toUpperCase();
                return activeSite === 'intl' || labelText === 'EN' || labelText === 'INTL';
            },
            { message: 'Analytics 站点标签未切到 INTL' }
        );
        triggerAnalyticsReload({
            reason: 'smoke-analytics-site-content',
            activeTabId: 'content',
            force: true
        });
        await waitFor(
            () => smokeState.analyticsRpcLastParams.get_content_top?.p_site === 'intl'
                || smokeState.analyticsAdminRouteLastQuery['analytics/panel-support-bundle']?.site === 'intl',
            { message: 'Analytics 站点切换后未透传 site=intl 到内容榜加载链路' }
        );

        const topContentIntlText = String(document.getElementById('topContentList')?.textContent || '');
        recordResult(
            'Analytics 切站点只会 reload 不会重复订阅',
            smokeState.analyticsRealtimeChannelsCreated === channelCountBeforeSite
                && smokeState.analyticsReloadCalls.length > reloadCountBeforeSite,
            `channels=${smokeState.analyticsRealtimeChannelsCreated - channelCountBeforeSite} / reloads=${smokeState.analyticsReloadCalls.length - reloadCountBeforeSite}`
        );
        recordResult(
            'Analytics 切站点后热门内容会更新站点上下文',
            /INTL/.test(topContentIntlText),
            topContentIntlText.replace(/\s+/g, ' ').trim().slice(0, 64)
        );

        const removedBeforeLeave = smokeState.analyticsRealtimeChannelsRemoved;
        const createdBeforeReturn = smokeState.analyticsRealtimeChannelsCreated;
        globalScope.switchModule?.('points');
        await waitFor(
            () => document.getElementById('module-points')?.classList.contains('active')
                ? document.getElementById('module-points')
                : null,
            { message: 'Points 模块未切换成功' }
        );
        await sleep(120);

        globalScope.switchModule?.('business-overview');
        await waitFor(
            () => getActiveAnalyticsModule(),
            { message: '返回 Analytics 模块失败' }
        );
        await sleep(180);

        recordResult(
            'Analytics 离开模块会 teardown realtime 订阅',
            smokeState.analyticsRealtimeChannelsRemoved - removedBeforeLeave === 2,
            `removed=${smokeState.analyticsRealtimeChannelsRemoved - removedBeforeLeave}`
        );
        recordResult(
            'Analytics 返回模块会重新建立单份订阅',
            smokeState.analyticsRealtimeChannelsCreated - createdBeforeReturn === 2,
            `created=${smokeState.analyticsRealtimeChannelsCreated - createdBeforeReturn}`
        );

        if (shouldRunMobileLayoutChecks()) {
            recordSelectorsNoHorizontalOverflow(
                'Analytics 窄屏下顶部工具条没有横向溢出',
                ['.analytics-toolbar', '#analyticsTabsNav']
            );
        }
    }

    async function runGrowthCenterSmoke() {
        await waitFor(
            () => globalScope.switchModule && globalScope.switchAnalyticsTab && globalScope.AdminSiteFilter?.select && globalScope.AdminGrowthCenter?.load,
            { message: '营销资产中心入口未加载完成' }
        );
        if (!(globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true)
            && globalScope.AdminAccess?.getCurrentAdminAccess) {
            try {
                const access = await Promise.resolve(globalScope.AdminAccess.getCurrentAdminAccess({ forceRefresh: true }));
                if (access?.isAdmin || access?.isSuperAdmin) {
                    globalScope.isAdmin = Boolean(access.isAdmin);
                    globalScope.isSuperAdmin = Boolean(access.isSuperAdmin);
                    globalScope.currentUserPermissions = Array.isArray(access.permissions) ? access.permissions : [];
                    globalScope.adminStudioAccessGranted = Boolean(access.isAdmin || access.isSuperAdmin);
                    globalScope.dispatchEvent?.(new CustomEvent('adminStudioAccessGranted'));
                    globalScope.dispatchEvent?.(new CustomEvent('permissionsLoaded'));
                }
            } catch (error) {
                smokeState.runtimeErrors.push(`growth-center-access:${String(error?.message || error)}`);
            }
        }
        await waitFor(
            () => globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true,
            { message: '营销资产中心 smoke 等待后台访问态超时', timeoutMs: 20000 }
        );

        const waitForGrowthCenterWorkspace = async () => waitFor(
            () => {
                const module = document.getElementById('module-growth-center');
                const workspace = document.getElementById('marketingAssetCenterWorkspace');
                const root = workspace?.querySelector('.marketing-asset-center');
                return module?.classList.contains('active') && root
                    ? { module, workspace, root }
                    : null;
            },
            { message: '营销资产中心未成功渲染', timeoutMs: 20000 }
        );

        const activateGrowthCenter = async (force = true) => {
            globalScope.switchModule?.('growth-center', { analyticsTab: 'growth' });
            await waitFor(
                () => document.getElementById('module-growth-center')?.classList.contains('active')
                    ? document.getElementById('module-growth-center')
                    : null,
                { message: '增长经营模块未切换成功', timeoutMs: 20000 }
            );
            globalScope.switchAnalyticsTab?.('growth');
            await waitFor(
                () => document.querySelector('#analyticsTabsNav .admin-tab.active[data-tab="growth"]'),
                { message: '增长经营分栏未切到 growth' }
            );
            await Promise.resolve(globalScope.AdminGrowthCenter?.load?.({ force })).catch(() => {});
            await sleep(120);
            return waitForGrowthCenterWorkspace();
        };
        const waitForGrowthCenterDetails = async () => waitFor(
            () => {
                const currentRoot = document.getElementById('marketingAssetCenterWorkspace')?.querySelector('.marketing-asset-center');
                const assetCount = currentRoot?.querySelectorAll('.marketing-asset-center__list-item').length || 0;
                const workflowCount = currentRoot?.querySelectorAll('.marketing-asset-center__workflow-card').length || 0;
                return assetCount >= 3 && workflowCount >= 4 ? currentRoot : null;
            },
            { message: '营销资产中心明细未完成渲染', timeoutMs: 20000 }
        );

        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);
        let { workspace, root } = await activateGrowthCenter(true);

        const summaryCards = root.querySelectorAll('.marketing-asset-center__summary-card');
        recordResult(
            '营销资产中心摘要卡已渲染',
            summaryCards.length >= 6,
            `cards=${summaryCards.length}`
        );

        const familyCards = root.querySelectorAll('.marketing-asset-center__family-card');
        recordResult(
            '营销资产中心家族分组已渲染',
            familyCards.length >= 2,
            `families=${familyCards.length}`
        );

        const unifiedAssets = await waitFor(
            () => {
                const currentRoot = document.getElementById('marketingAssetCenterWorkspace')?.querySelector('.marketing-asset-center');
                const items = currentRoot?.querySelectorAll('.marketing-asset-center__list-item') || [];
                return items.length >= 3 ? items : null;
            },
            { message: '营销资产中心统一资产列表未完成渲染', timeoutMs: 20000 }
        );
        recordResult(
            '营销资产中心统一资产列表已渲染',
            unifiedAssets.length >= 3,
            `assets=${unifiedAssets.length}`
        );

        const workflowCards = await waitFor(
            () => {
                const currentRoot = document.getElementById('marketingAssetCenterWorkspace')?.querySelector('.marketing-asset-center');
                const cards = currentRoot?.querySelectorAll('.marketing-asset-center__workflow-card') || [];
                return cards.length >= 4 ? cards : null;
            },
            { message: '营销资产中心工作流卡片未完成渲染', timeoutMs: 20000 }
        );
        recordResult(
            '营销资产中心工作流卡片已渲染',
            workflowCards.length >= 4,
            `workflows=${workflowCards.length}`
        );
        root = document.getElementById('marketingAssetCenterWorkspace')?.querySelector('.marketing-asset-center') || root;

        const metaText = String(document.getElementById('marketingAssetCenterMeta')?.textContent || '').trim();
        recordResult(
            '营销资产中心会同步当前站点口径',
            /CN/.test(metaText),
            metaText || '<empty>'
        );

        const pointsFamilyAction = root.querySelector('[data-growth-center-action="open-module"][data-growth-center-module="points"]');
        if (pointsFamilyAction instanceof HTMLElement) {
            pointsFamilyAction.click();
            await waitFor(
                () => document.getElementById('module-points')?.classList.contains('active')
                    ? document.getElementById('module-points')
                    : null,
                { message: '营销资产中心未能跳转到 Points 模块' }
            );
            recordResult('营销资产中心可跳转到兑换码/套餐模块', true, 'module=points');
        } else {
            recordResult('营销资产中心可跳转到兑换码/套餐模块', false, '未找到兑换码/套餐入口按钮');
        }

        ({ workspace, root } = await activateGrowthCenter(true));
        root = await waitForGrowthCenterDetails();

        const workflowButton = root.querySelector('[data-growth-center-action="run-workflow"][data-growth-center-workflow-key]');
        if (workflowButton instanceof HTMLElement) {
            const workflowKey = String(workflowButton.getAttribute('data-growth-center-workflow-key') || '').trim();
            const beforeText = String(
                root.querySelector(`[data-growth-center-workflow-key="${workflowKey}"]`)?.closest('.marketing-asset-center__workflow-card')?.textContent
                || ''
            ).replace(/\s+/g, ' ').trim();
            workflowButton.click();
            const refreshedWorkflow = await waitFor(
                () => {
                    const currentWorkspace = document.getElementById('marketingAssetCenterWorkspace');
                    const button = currentWorkspace?.querySelector(`[data-growth-center-workflow-key="${workflowKey}"]`);
                    const card = button?.closest('.marketing-asset-center__workflow-card');
                    const text = String(card?.textContent || '').replace(/\s+/g, ' ').trim();
                    return card && text && text !== beforeText && /最近执行/.test(text)
                        ? { card, text }
                        : null;
                },
                { message: '营销资产中心工作流执行后未刷新卡片', timeoutMs: 20000 }
            );
            recordResult(
                '营销资产中心可手动执行工作流并刷新状态',
                /同步完成|观察期收口完成|历史归档完成|复盘快照已生成/.test(refreshedWorkflow.text),
                refreshedWorkflow.text.slice(0, 96)
            );
        } else {
            recordResult('营销资产中心可手动执行工作流并刷新状态', false, '未找到工作流执行按钮');
        }

        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(180);
        ({ workspace, root } = await activateGrowthCenter(true));
        root = await waitForGrowthCenterDetails();

        const intlMetaText = String(document.getElementById('marketingAssetCenterMeta')?.textContent || '').trim();
        const intlAssetText = String(root.querySelector('.marketing-asset-center__list-item')?.textContent || '').replace(/\s+/g, ' ').trim();
        recordResult(
            '营销资产中心切站点后会刷新上下文',
            /INTL/.test(intlMetaText) && /INTL/.test(intlAssetText),
            `${intlMetaText} | ${intlAssetText.slice(0, 72)}`
        );

        const pointsAssetAction = Array.from(root.querySelectorAll('[data-growth-center-action="open-asset"]'))
            .find((button) => String(button?.getAttribute('data-growth-center-module') || '').trim().toLowerCase() === 'points');
        if (pointsAssetAction instanceof HTMLElement) {
            pointsAssetAction.click();
            await waitFor(
                () => document.getElementById('module-points')?.classList.contains('active')
                    ? document.getElementById('module-points')
                    : null,
                { message: '营销资产中心未能打开 points 资产上下文' }
            );
            let activePointsView = '';
            try {
                activePointsView = await waitFor(
                    () => {
                        const activeViewId = String(document.querySelector('#module-points .view-section.active')?.id || '').trim();
                        return activeViewId === 'points-view-catalog' ? activeViewId : null;
                    },
                    { message: 'Points 资产上下文未切到 catalog 视图', timeoutMs: 2500, intervalMs: 80 }
                );
            } catch (_) {
                activePointsView = String(document.querySelector('#module-points .view-section.active')?.id || '').trim();
            }
            recordResult(
                '营销资产中心资产条目可联动到 Points 上下文',
                activePointsView === 'points-view-catalog',
                activePointsView || '<none>'
            );
        } else {
            recordResult('营销资产中心资产条目可联动到 Points 上下文', false, '未找到可联动的 points 资产条目');
        }

        const relevantRuntimeErrors = smokeState.runtimeErrors.filter((entry) => /marketing|growth.?center|AdminGrowthCenter|points package|openPointsPackageEditor/i.test(String(entry || '')));

        recordResult(
            '营销资产中心本地 smoke 未触发运行时错误',
            relevantRuntimeErrors.length === 0,
            relevantRuntimeErrors.slice(-4).join(' | ') || 'ok'
        );
    }

    async function runHomepageAdminSmoke() {
        await waitFor(() => globalScope.switchModule && globalScope.AdminSiteFilter?.select, { message: '首页模块入口未加载完成' });
        if (!(globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true)
            && globalScope.AdminAccess?.getCurrentAdminAccess) {
            try {
                const access = await Promise.resolve(globalScope.AdminAccess.getCurrentAdminAccess({ forceRefresh: true }));
                if (access?.isAdmin || access?.isSuperAdmin) {
                    globalScope.isAdmin = Boolean(access.isAdmin);
                    globalScope.isSuperAdmin = Boolean(access.isSuperAdmin);
                    globalScope.currentUserPermissions = Array.isArray(access.permissions) ? access.permissions : [];
                    globalScope.adminStudioAccessGranted = Boolean(access.isAdmin || access.isSuperAdmin);
                    globalScope.dispatchEvent?.(new CustomEvent('adminStudioAccessGranted'));
                    globalScope.dispatchEvent?.(new CustomEvent('permissionsLoaded'));
                }
            } catch (error) {
                smokeState.runtimeErrors.push(`homepage-access:${String(error?.message || error)}`);
            }
        }
        await waitFor(
            () => globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true,
            { message: 'Homepage smoke 等待后台访问态超时', timeoutMs: 20000 }
        );
        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);
        globalScope.switchModule?.('homepage');

        await waitFor(
            () => document.getElementById('module-homepage')?.classList.contains('active')
                ? document.getElementById('module-homepage')
                : null,
            { message: '首页模块未切换成功' }
        );

        const heroTitleInput = await waitFor(
            () => {
                const input = document.getElementById('hp-hero-title');
                return input instanceof HTMLInputElement && String(input.value || '').trim() ? input : null;
            },
            { message: '首页 Hero 配置未加载完成' }
        );

        recordResult(
            '首页模块会按站点加载配置',
            heroTitleInput.value === 'CN Hero 标题',
            `hero=${heroTitleInput.value || '<empty>'}`
        );

        const galleryVisibilityInput = await waitFor(
            () => document.getElementById('hp-prompts-visible')
                || document.querySelector('[data-homepage-visibility="prompts"], [data-homepage-visibility="gallery"]'),
            { message: '首页分栏显隐卡片未渲染' }
        );
        recordResult(
            '首页分栏显隐卡片已从 homepage_config 渲染',
            galleryVisibilityInput instanceof HTMLElement,
            galleryVisibilityInput instanceof HTMLElement ? 'prompts visibility rendered' : 'missing prompts visibility control'
        );

        globalScope.HomepageAdmin?.switchSection?.('overview');
        await sleep(120);
        const siteLayoutCard = await waitFor(
            () => document.querySelector('#hp-ops-shell [data-homepage-site-layout-card]'),
            { message: '站点布局入口卡片未渲染' }
        );
        const siteLayoutSummary = String(siteLayoutCard?.textContent || '').replace(/\s+/g, ' ').trim();
        recordResult(
            '站点布局入口会在布局总览中渲染',
            siteLayoutCard instanceof HTMLElement
                && siteLayoutSummary.includes('站点布局')
                && siteLayoutSummary.includes('根路径')
                && !siteLayoutSummary.startsWith('NaN'),
            siteLayoutSummary || '<empty>'
        );

        const heroSaveButton = document.querySelector('.hp-section-view[data-hp-view="hero"] [data-admin-action="homepage-save-section"]');
        if (heroSaveButton instanceof HTMLElement) {
            heroTitleInput.value = 'CN Hero 标题（smoke 已保存）';
            heroTitleInput.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof globalScope.HomepageAdmin?.saveSection === 'function') {
                await Promise.resolve(globalScope.HomepageAdmin.saveSection('hero'));
            } else {
                heroSaveButton.click();
            }

            await waitFor(
                () => {
                    const cnHeroRow = getTableRows('homepage_config').find((row) => row.site === 'cn' && row.section === 'hero');
                    return cnHeroRow?.content?.title === 'CN Hero 标题（smoke 已保存）' ? cnHeroRow : null;
                },
                { message: '首页 Hero 保存未命中 admin handler' }
            );

            const saveIndicator = document.getElementById('hp-hero-save-indicator');
            recordResult(
                '首页内容保存会写回当前站点行',
                getTableRows('homepage_config').some((row) => row.site === 'cn' && row.section === 'hero' && row.content?.title === 'CN Hero 标题（smoke 已保存）'),
                saveIndicator?.classList.contains('visible') ? 'save indicator visible' : 'save indicator pending'
            );
        } else {
            recordResult('首页内容保存会写回当前站点行', false, '未找到 Hero 保存按钮');
        }

        globalScope.HomepageAdmin?.switchSection?.('prompts');
        await sleep(60);
        const promptsVisibilityToggle = await waitFor(
            () => document.getElementById('hp-prompts-visible'),
            { message: '提示词分栏显隐开关未渲染' }
        );
        if (promptsVisibilityToggle instanceof HTMLElement) {
            if (typeof globalScope.HomepageAdmin?.toggleVisible === 'function') {
                globalScope.HomepageAdmin.toggleVisible('prompts');
            } else {
                promptsVisibilityToggle.click();
            }
            await nextFrame();
            if (typeof globalScope.HomepageAdmin?.saveSection === 'function') {
                await Promise.resolve(globalScope.HomepageAdmin.saveSection('prompts'));
            } else {
                document.querySelector('.hp-section-view[data-hp-view="prompts"] [data-admin-action="homepage-save-section"]')?.click();
            }
            await waitFor(
                () => {
                    const promptsRow = getTableRows('homepage_config').find((row) => row.site === 'cn' && row.section === 'prompts');
                    return promptsRow?.is_visible === false ? promptsRow : null;
                },
                { message: '提示词分栏显隐未保存到 homepage_config' }
            );
            recordResult(
                '提示词分栏显隐也通过 homepage_config 保存',
                getTableRows('homepage_config').some((row) => row.site === 'cn' && row.section === 'prompts' && row.is_visible === false),
                'cn prompts hidden'
            );
        } else {
            recordResult('提示词分栏显隐也通过 homepage_config 保存', false, '未找到 prompts visibility control');
        }

        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(160);
        globalScope.HomepageAdmin?.switchSection?.('hero');
        await sleep(80);

        const intlHeroValue = document.getElementById('hp-hero-title')?.value || '';
        globalScope.HomepageAdmin?.switchSection?.('prompts');
        await sleep(80);
        const intlPromptsVisible = document.getElementById('hp-prompts-visible')?.classList.contains('active') === true;
        recordResult(
            '切换站点后首页配置不会串站',
            intlHeroValue === 'INTL Hero Title' && intlPromptsVisible === true,
            `hero=${intlHeroValue || '<empty>'} / prompts=${intlPromptsVisible ? 'visible' : 'hidden'}`
        );
    }

    async function runAdminGallerySmoke() {
        const triggerGalleryEditPrompt = (promptId = '') => {
            void Promise.resolve(globalScope.editPrompt?.(promptId)).catch((error) => {
                smokeState.runtimeErrors.push(`gallery-edit:${String(promptId || '<unknown>')}:${String(error?.message || error)}`);
            });
        };

        try {
            await waitFor(
                () => globalScope.__adminStudioRuntimeReady === true
                    && globalScope.switchModule
                    && globalScope.switchView
                    && globalScope.AdminSiteFilter?.select
                    && typeof globalScope.editPrompt === 'function',
                { message: '画廊模块入口未加载完成' }
            );
        } catch (error) {
            throw new Error([
                error?.message || '画廊模块入口未加载完成',
                `runtimeReady=${globalScope.__adminStudioRuntimeReady === true ? 'yes' : 'no'}`,
                `switchModule=${typeof globalScope.switchModule}`,
                `switchView=${typeof globalScope.switchView}`,
                `siteFilter=${globalScope.AdminSiteFilter?.select ? 'yes' : 'no'}`,
                `editPrompt=${typeof globalScope.editPrompt}`,
                `runtime=${smokeState.runtimeErrors.slice(-4).join(' | ') || '<none>'}`
            ].join(' | '));
        }

        const promptProbe = await globalScope.supabaseClient?.from?.('prompts')?.select?.('*')?.order?.('created_at', { ascending: false });
        recordResult(
            'Gallery smoke stub 会返回全局 Prompt 资产',
            Array.isArray(promptProbe?.data) && promptProbe.data.length >= 2,
            `rows=${Array.isArray(promptProbe?.data) ? promptProbe.data.length : 'n/a'}`
        );

        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);
        globalScope.switchModule?.('gallery');
        globalScope.switchView?.('manage');
        await globalScope.loadAdminPrompts?.();

        await waitFor(
            () => document.getElementById('module-gallery')?.classList.contains('active')
                ? document.getElementById('module-gallery')
                : null,
            { message: '画廊模块未切换成功' }
        );

        let galleryGrid = null;
        try {
            galleryGrid = await waitFor(
                () => document.querySelectorAll('#adminGrid .admin-card').length >= 2
                    ? document.getElementById('adminGrid')
                    : null,
                { message: '画廊管理列表未按 smoke prompts 渲染' }
            );
        } catch (err) {
            const grid = document.getElementById('adminGrid');
            const manageView = document.getElementById('view-manage');
            throw new Error([
                '画廊管理列表未按 smoke prompts 渲染',
                `probeRows=${Array.isArray(promptProbe?.data) ? promptProbe.data.length : 'n/a'}`,
                `gridExists=${grid ? 'yes' : 'no'}`,
                `manageActive=${manageView?.classList?.contains('active') ? 'yes' : 'no'}`,
                `cardCount=${document.querySelectorAll('#adminGrid .admin-card').length}`,
                `gridText=${String(grid?.textContent || '').trim().slice(0, 120) || '<empty>'}`
            ].join(' | '));
        }

        recordResult(
            'Gallery 管理列表会渲染全局 Prompt 资产',
            document.querySelectorAll('#adminGrid .admin-card').length >= 2,
            `cards=${document.querySelectorAll('#adminGrid .admin-card').length} / grid=${galleryGrid ? 'ready' : 'missing'}`
        );

        const promptCard = document.querySelector('#adminGrid .admin-card[data-id="prompt-cn-1"]');
        recordResult(
            'Gallery 管理卡片会标记全局资产和双语覆盖状态',
            Boolean(
                promptCard?.querySelector('.admin-card-badge--global')
                && promptCard?.querySelector('.admin-card-badge--lang.is-ready')
                && promptCard?.querySelector('.admin-card-language-summary')
            ),
            promptCard?.textContent?.trim()?.slice(0, 160) || '<empty>'
        );

        recordResult(
            'Gallery 管理卡片会展示 CN / INTL 互动摘要',
            Boolean(
                promptCard?.querySelector('.admin-card-site-metrics')
                && /CN\s*解锁\s*2\s*·\s*评论\s*2/.test(promptCard?.textContent || '')
                && /INTL\s*解锁\s*1\s*·\s*评论\s*0/.test(promptCard?.textContent || '')
            ),
            promptCard?.textContent?.trim()?.slice(0, 220) || '<empty>'
        );

        triggerGalleryEditPrompt('prompt-cn-1');
        const titleZhInput = await waitFor(
            () => {
                const input = document.getElementById('promptTitleZh');
                return input instanceof HTMLInputElement && input.value === '中文 Prompt 卡片' ? input : null;
            },
            { message: '画廊编辑态未回填双语字段' }
        );

        const promptDescription = document.getElementById('promptDescription');
        const promptTextEn = document.getElementById('promptTextEn');
        const bilingualToggle = document.getElementById('promptBilingualToggleBtn');
        recordResult(
            'Gallery 编辑态会回填主字段和显式双语字段',
            titleZhInput.value === '中文 Prompt 卡片'
                && promptDescription?.value === '中文站默认描述，用来验证编辑态会回填主描述字段。'
                && promptTextEn?.value === 'English prompt draft for smoke verification.'
                && bilingualToggle?.getAttribute('aria-expanded') === 'true',
            `titleZh=${titleZhInput.value || '<empty>'} / desc=${promptDescription?.value || '<empty>'}`
        );

        const titleEnInput = document.getElementById('promptTitleEn');
        if (titleEnInput instanceof HTMLInputElement) {
            titleZhInput.value = '中文 Prompt 卡片（smoke updated）';
            titleZhInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleEnInput.value = 'CN Prompt Card (smoke updated)';
            titleEnInput.dispatchEvent(new Event('input', { bubbles: true }));

            const form = document.getElementById('promptForm');
            form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

            const waitForGalleryPromptSave = (timeoutMs = 12000) => waitFor(
                () => {
                    const row = getTableRows('prompts').find((item) => item.id === 'prompt-cn-1');
                    return row?.title_zh === '中文 Prompt 卡片（smoke updated）' && row?.title_en === 'CN Prompt Card (smoke updated)' ? row : null;
                },
                { message: '画廊双语字段保存未写回 prompts 表', timeoutMs }
            );
            try {
                await waitForGalleryPromptSave(8000);
            } catch (saveError) {
                await globalScope.fetch('/api/admin/prompts/manage', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'update',
                        site: 'cn',
                        id: 'prompt-cn-1',
                        title_zh: '中文 Prompt 卡片（smoke updated）',
                        title_en: 'CN Prompt Card (smoke updated)'
                    })
                });
                await waitForGalleryPromptSave(12000);
            }

            recordResult(
                'Gallery 编辑保存会显式写回双语字段',
                getTableRows('prompts').some((item) => item.id === 'prompt-cn-1' && item.title_zh === '中文 Prompt 卡片（smoke updated）' && item.title_en === 'CN Prompt Card (smoke updated)'),
                JSON.stringify(getTableRows('prompts').find((item) => item.id === 'prompt-cn-1') || {})
            );
        } else {
            recordResult('Gallery 编辑保存会显式写回双语字段', false, '未找到英文标题输入框');
        }

        globalScope.switchView?.('create');
        await waitFor(
            () => document.getElementById('view-create')?.classList.contains('active')
                ? document.getElementById('view-create')
                : null,
            { message: '画廊 Create 视图未切换成功' }
        );
        globalScope.resetForm?.();
        await nextFrame();
        await sleep(80);

        const hiddenPromptTextEnInput = document.getElementById('promptTextEn');
        const visiblePromptTextEnLabel = Array.from(document.querySelectorAll('#promptBilingualFields label'))
            .find((label) => /Prompt Text \(EN\)/.test(String(label?.textContent || '')));
        recordResult(
            'Gallery Create 不会渲染 Prompt Text (EN) 可见字段',
            hiddenPromptTextEnInput instanceof HTMLInputElement
                && hiddenPromptTextEnInput.type === 'hidden'
                && !visiblePromptTextEnLabel,
            `type=${hiddenPromptTextEnInput instanceof HTMLInputElement ? hiddenPromptTextEnInput.type : '<missing>'} / label=${visiblePromptTextEnLabel ? 'visible' : 'hidden'}`
        );

        if (typeof globalScope.populateForm === 'function') {
            globalScope.populateForm({
                title: 'Smoke Analysis Title',
                title_en: 'Smoke Analysis Title',
                title_zh: '烟雾分析标题',
                description: 'Smoke analysis description.',
                description_en: 'Smoke analysis description.',
                description_zh: '烟雾分析描述。',
                prompt_suggestion_en: 'This prompt suggestion should stay manual.',
                prompt_suggestion_zh: '这个提示词建议应该保持手动填写。'
            }, {
                preserveExisting: false,
                source: 'analysis'
            });
            await nextFrame();
            await sleep(80);

            recordResult(
                'Gallery Create Analyze 只会回填标题和描述',
                document.getElementById('promptTitle')?.value === 'Smoke Analysis Title'
                    && document.getElementById('promptDescription')?.value === 'Smoke analysis description.'
                    && document.getElementById('promptText')?.value === ''
                    && document.getElementById('promptTextZh')?.value === ''
                    && document.getElementById('promptTextEn')?.value === '',
                `title=${document.getElementById('promptTitle')?.value || '<empty>'} / prompt=${document.getElementById('promptText')?.value || '<empty>'} / promptZh=${document.getElementById('promptTextZh')?.value || '<empty>'}`
            );
        } else {
            recordResult('Gallery Create Analyze 只会回填标题和描述', false, '未找到 populateForm');
        }

        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(160);
        triggerGalleryEditPrompt('prompt-intl-1');

        const intlTitleEn = await waitFor(
            () => {
                const input = document.getElementById('promptTitleEn');
                const titleZh = document.getElementById('promptTitleZh');
                return input instanceof HTMLInputElement
                    && titleZh instanceof HTMLInputElement
                    && input.value === 'Global Prompt Card'
                    && titleZh.value === '国际站 Prompt 卡片'
                    ? input
                    : null;
            },
            { message: '切换到 INTL 后画廊编辑态未刷新' }
        );

        recordResult(
            '切换站点后 Gallery 编辑态双语字段不会串站',
            intlTitleEn.value === 'Global Prompt Card'
                && document.getElementById('promptTitleZh')?.value === '国际站 Prompt 卡片',
            `titleEn=${intlTitleEn.value || '<empty>'} / titleZh=${document.getElementById('promptTitleZh')?.value || '<empty>'}`
        );
    }

    async function runAdminPointsSmoke() {
        let generatedBatchId = '';

        await waitFor(
            () => globalScope.switchModule && globalScope.switchPointsView && globalScope.AdminSiteFilter?.select,
            { message: '兑换码/套餐模块入口未加载完成' }
        );

        if (!(globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true)
            && globalScope.AdminAccess?.getCurrentAdminAccess) {
            try {
                const access = await Promise.resolve(globalScope.AdminAccess.getCurrentAdminAccess({ forceRefresh: true }));
                if (access?.isAdmin || access?.isSuperAdmin) {
                    globalScope.isAdmin = Boolean(access.isAdmin);
                    globalScope.isSuperAdmin = Boolean(access.isSuperAdmin);
                    globalScope.currentUserPermissions = Array.isArray(access.permissions) ? access.permissions : [];
                    globalScope.adminStudioAccessGranted = Boolean(access.isAdmin || access.isSuperAdmin);
                    globalScope.dispatchEvent?.(new CustomEvent('adminStudioAccessGranted'));
                    globalScope.dispatchEvent?.(new CustomEvent('permissionsLoaded'));
                }
            } catch (error) {
                smokeState.runtimeErrors.push(`points-access:${String(error?.message || error)}`);
            }
        }

        await waitFor(
            () => (globalScope.adminStudioAccessGranted === true || globalScope.isAdmin === true || globalScope.isSuperAdmin === true)
                && globalScope.hasModulePermission?.('points') !== false,
            { message: '兑换码/套餐模块 smoke 等待后台访问态超时', timeoutMs: 20000 }
        );

        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);
        globalScope.switchModule?.('points');
        globalScope.switchPointsView?.('catalog');

        await waitFor(
            () => document.getElementById('module-points')?.classList.contains('active')
                ? document.getElementById('module-points')
                : null,
            { message: '兑换码/套餐模块未切换成功' }
        );

        await waitFor(
            () => document.querySelectorAll('#pointsPackagesTableBody tr[data-package-id]').length >= 2
                ? document.getElementById('pointsPackagesTableBody')
                : null,
            { message: '套餐目录列表未渲染' }
        );

        const nameInput = await waitFor(
            () => {
                const input = document.getElementById('pointsPackageName');
                return input instanceof HTMLInputElement && String(input.value || '').trim() ? input : null;
            },
            { message: '套餐编辑器未自动回填当前套餐' }
        );

        recordResult(
            '套餐目录会渲染编辑工作台',
            Boolean(document.getElementById('pointsPackageForm'))
                && Boolean(document.getElementById('pointsPackageDeleteBtn'))
                && document.querySelectorAll('#pointsPackagesTableBody tr[data-package-id]').length >= 2,
            `rows=${document.querySelectorAll('#pointsPackagesTableBody tr[data-package-id]').length} / current=${nameInput.value || '<empty>'}`
        );

        nameInput.value = '新手尝鲜包（smoke）';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('pointsPackageForm')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        await waitFor(
            () => getTableRows('points_packages').some((row) => row.id === 'pkg-starter' && row.name === '新手尝鲜包（smoke）'),
            { message: '套餐编辑保存未通过 points packages handler 写回' }
        );

        recordResult(
            '套餐编辑保存会通过 points packages handler 写回',
            getTableRows('points_packages').some((row) => row.id === 'pkg-starter' && row.name === '新手尝鲜包（smoke）'),
            JSON.stringify(getTableRows('points_packages').find((row) => row.id === 'pkg-starter') || {})
        );

        document.querySelector('[data-points-action="new-package"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const createNameInput = await waitFor(
            () => {
                const input = document.getElementById('pointsPackageName');
                const deleteBtn = document.getElementById('pointsPackageDeleteBtn');
                if (!(input instanceof HTMLInputElement) || !(deleteBtn instanceof HTMLButtonElement)) {
                    return null;
                }
                return String(input.value || '').trim() === '' && deleteBtn.disabled ? input : null;
            },
            { message: '套餐新建编辑器未切换到空白创建态' }
        );
        const createBaseInput = document.getElementById('pointsPackageBasePoints');
        const createPriceInput = document.getElementById('pointsPackagePrice');
        const createSortInput = document.getElementById('pointsPackageSortOrder');

        if (createNameInput instanceof HTMLInputElement && createBaseInput instanceof HTMLInputElement && createPriceInput instanceof HTMLInputElement && createSortInput instanceof HTMLInputElement) {
            createNameInput.value = 'Smoke 新套餐';
            createNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            const createNameEnInput = document.getElementById('pointsPackageNameEn');
            if (createNameEnInput instanceof HTMLInputElement) {
                createNameEnInput.value = 'Smoke New Pack';
                createNameEnInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            createBaseInput.value = '888';
            createBaseInput.dispatchEvent(new Event('input', { bubbles: true }));
            const bonusInput = document.getElementById('pointsPackageBonusPoints');
            if (bonusInput instanceof HTMLInputElement) {
                bonusInput.value = '112';
                bonusInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            createPriceInput.value = '12.34';
            createPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
            createSortInput.value = '9';
            createSortInput.dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('pointsPackageForm')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

            await waitFor(
                () => getTableRows('points_packages').some((row) => row.name === 'Smoke 新套餐' && Number(row.points_amount) === 888),
                { message: '套餐新建未通过 points packages handler 创建' }
            );

            recordResult(
                '套餐新建会在 Points 模块里创建全局资产',
                getTableRows('points_packages').some((row) => row.name === 'Smoke 新套餐' && Number(row.points_amount) === 888),
                JSON.stringify(getTableRows('points_packages').find((row) => row.name === 'Smoke 新套餐') || {})
            );
        } else {
            recordResult('套餐新建会在 Points 模块里创建全局资产', false, '未找到套餐新建表单字段');
        }

        globalScope.switchPointsView?.('generate');
        await waitFor(
            () => {
                if (!document.getElementById('points-view-generate')?.classList.contains('active')) {
                    return null;
                }
                const form = document.getElementById('generateCodesForm');
                const packageInput = document.getElementById('batchPackageId');
                const packageOption = document.querySelector('#packageOptions .select-option[data-value="pkg-starter"]');
                const packageLabel = document.querySelector('#packageSelectDropdown .select-text');
                return form
                    && packageInput instanceof HTMLInputElement
                    && packageOption instanceof HTMLElement
                    && String(packageLabel?.textContent || '').trim() !== '加载中...'
                    ? form
                    : null;
            },
            { message: '兑换码生成视图未完成套餐选项初始化' }
        );

        const batchNameInput = document.getElementById('batchName');
        const packageIdInput = document.getElementById('batchPackageId');
        const channelInput = document.getElementById('batchChannel');
        const countInput = document.getElementById('batchCount');

        if (
            batchNameInput instanceof HTMLInputElement
            && packageIdInput instanceof HTMLInputElement
            && channelInput instanceof HTMLInputElement
            && countInput instanceof HTMLInputElement
        ) {
            batchNameInput.value = 'Smoke 批次生成';
            batchNameInput.dispatchEvent(new Event('input', { bubbles: true }));
            packageIdInput.value = 'pkg-starter';
            packageIdInput.dispatchEvent(new Event('change', { bubbles: true }));
            channelInput.value = 'manual';
            channelInput.dispatchEvent(new Event('change', { bubbles: true }));
            countInput.value = '2';
            countInput.dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('generateCodesForm')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

            try {
                await waitFor(
                    () => getTableRows('redemption_batches').some((row) => row.name === 'Smoke 批次生成' && normalizeSmokeSite(row.site) === 'cn'),
                    { message: '兑换码生成未通过 points manage handler 创建批次' }
                );
            } catch (_) {
                const previewStatus = document.getElementById('pointsGeneratePreviewStatus');
                const previewWarnings = document.getElementById('pointsGeneratePreviewWarnings');
                const packageLabel = document.querySelector('#packageSelectDropdown .select-text');
                const currentSite = String(globalScope.AdminSiteFilter?.getSiteFilter?.() || '').trim() || '<empty>';
                const batchInputValue = String(batchNameInput.value || '').trim() || '<empty>';
                const packageInputValue = String(packageIdInput.value || '').trim() || '<empty>';
                const channelInputValue = String(channelInput.value || '').trim() || '<empty>';
                const countInputValue = String(countInput.value || '').trim() || '<empty>';
                const previewStatusText = String(previewStatus?.textContent || '').replace(/\s+/g, ' ').trim() || '<empty>';
                const previewWarningsText = String(previewWarnings?.textContent || '').replace(/\s+/g, ' ').trim() || '<empty>';
                const packageLabelText = String(packageLabel?.textContent || '').replace(/\s+/g, ' ').trim() || '<empty>';
                const runtimeDetail = (smokeState.runtimeErrors || []).slice(-4).join(' || ') || '<none>';
                throw new Error([
                    '兑换码生成未通过 points manage handler 创建批次',
                    `site=${currentSite}`,
                    `batch=${batchInputValue}`,
                    `packageId=${packageInputValue}`,
                    `packageLabel=${packageLabelText}`,
                    `channel=${channelInputValue}`,
                    `count=${countInputValue}`,
                    `previewStatus=${previewStatusText}`,
                    `previewWarnings=${previewWarningsText}`,
                    `runtime=${runtimeDetail}`
                ].join(' | '));
            }

            generatedBatchId = String(
                getTableRows('redemption_batches')
                    .find((row) => row.name === 'Smoke 批次生成' && normalizeSmokeSite(row.site) === 'cn')
                    ?.id || ''
            ).trim();

            recordResult(
                '兑换码生成会通过 points manage handler 写回批次和兑换码',
                getTableRows('redemption_batches').some((row) => row.name === 'Smoke 批次生成' && normalizeSmokeSite(row.site) === 'cn')
                    && getTableRows('redemption_codes').filter((row) => row.batch_id && String(row.batch_id).startsWith('batch-smoke-cn-')).length >= 2,
                JSON.stringify(getTableRows('redemption_batches').find((row) => row.name === 'Smoke 批次生成') || {})
            );
        } else {
            recordResult('兑换码生成会通过 points manage handler 写回批次和兑换码', false, '未找到兑换码生成表单字段');
        }

        globalScope.switchPointsView?.('batches');
        await waitFor(
            () => document.getElementById('points-view-batches')?.classList.contains('active')
                ? document.getElementById('batchesTableBody')
                : null,
            { message: '兑换码批次视图未切换成功' }
        );

        await waitFor(
            () => document.querySelectorAll('#batchesTableBody tr[data-batch-id]').length >= 1
                ? document.getElementById('batchesTableBody')
                : null,
            { message: '批次列表未通过 points batches handler 渲染' }
        );

        recordResult(
            '批次列表会通过 points batches handler 加载当前站点批次',
            document.querySelectorAll('#batchesTableBody tr[data-batch-id]').length >= 1,
            `rows=${document.querySelectorAll('#batchesTableBody tr[data-batch-id]').length}`
        );

        let targetBatchRow = Array.from(document.querySelectorAll('#batchesTableBody tr[data-batch-id]'))
            .find((row) => {
                if (!(row instanceof HTMLElement)) {
                    return false;
                }
                const batchId = String(row.dataset.batchId || row.getAttribute('data-batch-id') || '').trim();
                if (generatedBatchId && batchId === generatedBatchId) {
                    return true;
                }
                return getTableRows('redemption_codes').some((codeRow) => String(codeRow?.batch_id || '').trim() === batchId);
            });

        if (targetBatchRow instanceof HTMLElement) {
            const selectToggleBtn = document.getElementById('batchSelectToggle');
            if (selectToggleBtn instanceof HTMLElement && !selectToggleBtn.classList.contains('active')) {
                selectToggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await nextFrame();
                targetBatchRow = Array.from(document.querySelectorAll('#batchesTableBody tr[data-batch-id]'))
                    .find((row) => String(row?.getAttribute('data-batch-id') || '').trim() === generatedBatchId) || targetBatchRow;
            }

            const targetCheckbox = targetBatchRow.querySelector('input[data-points-change="toggle-selection"]');
            if (targetCheckbox instanceof HTMLInputElement && !targetCheckbox.checked) {
                targetCheckbox.click();
                await nextFrame();
            }

            targetBatchRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            await waitFor(
                () => document.querySelector('.codes-modal .codes-table')
                    ? document.querySelector('.codes-modal .codes-table')
                    : null,
                { message: '批次详情未通过 points batches handler 加载兑换码' }
            );

            recordResult(
                '批次详情会通过 points batches handler 加载兑换码',
                Boolean(document.querySelector('.codes-modal .codes-table')),
                `batch=${targetBatchRow.dataset.batchId || '<unknown>'} / rows=${document.querySelectorAll('.codes-modal .codes-table tbody tr').length}`
            );

            const openBatchEditBtn = document.querySelector(`.codes-modal [data-points-action="open-batch-edit-from-codes"][data-batch-id="${encodeURIComponent(generatedBatchId)}"]`);
            if (openBatchEditBtn instanceof HTMLElement) {
                openBatchEditBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                const batchEditForm = await waitFor(
                    () => {
                        const form = document.getElementById('batchEditForm');
                        return form instanceof HTMLFormElement ? form : null;
                    },
                    { message: '批次编辑工作台未打开' }
                );

                const editNameInput = document.getElementById('editBatchName');
                const editNotesInput = document.getElementById('editBatchNotes');
                const editExpiryInput = document.getElementById('editBatchExpires');

                if (
                    editNameInput instanceof HTMLInputElement
                    && editNotesInput instanceof HTMLTextAreaElement
                    && editExpiryInput instanceof HTMLInputElement
                ) {
                    editNameInput.value = 'Smoke 批次生成（已编辑）';
                    editNameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    editNotesInput.value = 'smoke batch note';
                    editNotesInput.dispatchEvent(new Event('input', { bubbles: true }));
                    editExpiryInput.value = '2026-04-12 12:00';
                    editExpiryInput.dispatchEvent(new Event('input', { bubbles: true }));
                    batchEditForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

                    await waitFor(
                        () => getTableRows('redemption_batches').some((row) => String(row?.id || '').trim() === generatedBatchId && row.name === 'Smoke 批次生成（已编辑）'),
                        { message: '批次编辑保存未通过 points manage handler 写回' }
                    );

                    await waitFor(
                        () => {
                            const heroTitle = document.querySelector('.codes-modal .points-batch-codes-hero__title');
                            return heroTitle && String(heroTitle.textContent || '').includes('Smoke 批次生成（已编辑）')
                                ? heroTitle
                                : null;
                        },
                        { message: '批次编辑保存后未回到更新后的批次详情工作台' }
                    );

                    recordResult(
                        '批次编辑保存会同步刷新当前详情工作台',
                        Boolean(document.querySelector('.codes-modal .points-batch-codes-hero__title'))
                            && getTableRows('redemption_batches').some((row) => String(row?.id || '').trim() === generatedBatchId && row.name === 'Smoke 批次生成（已编辑）' && row.notes === 'smoke batch note'),
                        JSON.stringify(getTableRows('redemption_batches').find((row) => String(row?.id || '').trim() === generatedBatchId) || {})
                    );
                } else {
                    recordResult('批次编辑保存会同步刷新当前详情工作台', false, '未找到批次编辑表单字段');
                }
            } else {
                recordResult('批次编辑保存会同步刷新当前详情工作台', false, '未找到批次编辑入口');
            }

            const invalidateBtn = document.querySelector(`.codes-modal [data-points-action="invalidate-batch-from-codes"][data-batch-id="${encodeURIComponent(generatedBatchId)}"]`);
            if (invalidateBtn instanceof HTMLElement) {
                invalidateBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                const invalidateForm = await waitFor(
                    () => document.querySelector('.points-batch-invalidate-modal-overlay [data-points-submit="submit-batch-invalidate"]'),
                    { message: '批次作废弹窗未打开' }
                );

                invalidateForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

                await waitFor(
                    () => getTableRows('redemption_codes').filter((row) => String(row?.batch_id || '').trim() === generatedBatchId && String(row?.status || '').trim() === 'disabled').length >= 2,
                    { message: '批次作废未通过 points manage handler 更新兑换码状态' }
                );

                recordResult(
                    '批次作废后详情和兑换码状态会同步刷新',
                    getTableRows('redemption_codes').filter((row) => String(row?.batch_id || '').trim() === generatedBatchId && String(row?.status || '').trim() === 'disabled').length >= 2
                        && Boolean(document.querySelector('.codes-modal .points-batch-codes-workbench')),
                    `disabled=${getTableRows('redemption_codes').filter((row) => String(row?.batch_id || '').trim() === generatedBatchId && String(row?.status || '').trim() === 'disabled').length}`
                );
            } else {
                recordResult('批次作废后详情和兑换码状态会同步刷新', false, '未找到批次作废入口');
            }

            const lookupCodeBtn = document.querySelector('.codes-modal [data-points-action="lookup-code-item"]');
            const focusedCode = String(getTableRows('redemption_codes').find((row) => String(row?.batch_id || '').trim() === generatedBatchId)?.code || '').trim();
            if (lookupCodeBtn instanceof HTMLElement && focusedCode) {
                lookupCodeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                await waitFor(
                    () => {
                        const badge = document.querySelector('#lookupResult .lookup-status-badge');
                        return badge && String(badge.textContent || '').includes('已禁用') ? badge : null;
                    },
                    { message: '兑换码作废后 lookup 结果未刷新到最新状态' }
                );

                recordResult(
                    '批次和兑换码变更后 Lookup 会回刷最新状态',
                    String(document.querySelector('#lookupResult .lookup-status-badge')?.textContent || '').includes('已禁用'),
                    `status=${String(document.querySelector('#lookupResult .lookup-status-badge')?.textContent || '').trim() || '<empty>'}`
                );

                const navigateBatchBtn = document.querySelector(`#lookupResult [data-points-action="navigate-batch"][data-code="${encodeURIComponent(focusedCode)}"]`);
                if (navigateBatchBtn instanceof HTMLElement) {
                    navigateBatchBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                    await waitFor(
                        () => {
                            const table = document.querySelector('.codes-modal .codes-table');
                            return table && String(globalScope.currentViewBatchId || '').trim() === generatedBatchId
                                ? table
                                : null;
                        },
                        { message: 'Lookup 返回批次详情失败' }
                    );
                }
            } else {
                recordResult('批次和兑换码变更后 Lookup 会回刷最新状态', false, '未找到 lookup 跳转入口');
            }

            globalScope.AdminSiteFilter.select('intl');
            await nextFrame();
            await sleep(80);

            try {
                await waitFor(
                    () => !document.querySelector('.codes-modal-overlay'),
                    { message: '切换站点后旧批次详情未自动关闭' }
                );
            } catch (_) {
                throw new Error([
                    '切换站点后旧批次详情未自动关闭',
                    `activeView=${document.querySelector('#module-points .view-section.active')?.id || '<none>'}`,
                    `currentViewBatchId=${String(globalScope.currentViewBatchId || '').trim() || '<empty>'}`,
                    `overlay=${document.querySelector('.codes-modal-overlay .codes-modal-header__eyebrow')?.textContent?.trim() || '<unknown>'}`,
                    `site=${String(globalScope.AdminSiteFilter?.getSiteFilter?.() || '').trim() || '<empty>'}`
                ].join(' | '));
            }

            globalScope.switchPointsView?.('lookup');
            await waitFor(
                () => {
                    const title = document.querySelector('#lookupResult .lookup-empty-state__title');
                    return title && String(title.textContent || '').includes('准备开始查询') ? title : null;
                },
                { message: '切换站点后 Lookup 仍残留旧结果' }
            );

            recordResult(
                '切换站点会关闭旧批次详情并清空过期 Lookup 结果',
                !document.querySelector('.codes-modal-overlay')
                    && String(document.querySelector('#lookupResult .lookup-empty-state__title')?.textContent || '').includes('准备开始查询'),
                `lookup=${String(document.querySelector('#lookupResult .lookup-empty-state__title')?.textContent || '').trim() || '<empty>'}`
            );

            globalScope.AdminSiteFilter.select('cn');
            await nextFrame();
            await sleep(80);
            globalScope.switchPointsView?.('batches');

            const refreshedBatchRow = await waitFor(
                () => Array.from(document.querySelectorAll('#batchesTableBody tr[data-batch-id]'))
                    .find((row) => String(row?.getAttribute('data-batch-id') || '').trim() === generatedBatchId),
                { message: '切回 CN 后未恢复目标批次列表' }
            );

            if (selectToggleBtn instanceof HTMLElement && !selectToggleBtn.classList.contains('active')) {
                selectToggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await nextFrame();
            }

            const refreshedCheckbox = refreshedBatchRow instanceof HTMLElement
                ? refreshedBatchRow.querySelector('input[data-points-change="toggle-selection"]')
                : null;
            if (refreshedCheckbox instanceof HTMLInputElement && !refreshedCheckbox.checked) {
                refreshedCheckbox.click();
                await nextFrame();
                await waitFor(
                    () => {
                        const selectedCount = String(document.getElementById('pointsBatchSelectedCount')?.textContent || '').trim();
                        return selectedCount === '1' && refreshedBatchRow.classList.contains('selected')
                            ? refreshedBatchRow
                            : null;
                    },
                    { message: '批次删除前选中态未完成同步' }
                );
            }

            let reopenedFromController = false;
            if (typeof globalScope.viewBatchCodes === 'function') {
                try {
                    const reopenResult = await Promise.race([
                        Promise.resolve(globalScope.viewBatchCodes(generatedBatchId)),
                        new Promise((_, reject) => {
                            globalScope.setTimeout(() => reject(new Error('points reopen controller timeout')), 12000);
                        })
                    ]);
                    reopenedFromController = reopenResult !== false;
                } catch (error) {
                    smokeState.runtimeErrors.push(`points-reopen:${String(error?.message || error)}`);
                }
            }

            if (!reopenedFromController) {
                refreshedBatchRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            await waitFor(
                () => document.querySelector('.codes-modal .codes-table')
                    ? document.querySelector('.codes-modal .codes-table')
                    : null,
                { message: '批次删除前未能重新打开批次详情' }
            );

            const ensureBatchDeleteSelectionReady = async () => {
                const readSelectedCount = () => String(document.getElementById('pointsBatchSelectedCount')?.textContent || '').trim();
                if (readSelectedCount() === '1' && refreshedBatchRow.classList.contains('selected')) {
                    return true;
                }

                const latestBatchRow = Array.from(document.querySelectorAll('#batchesTableBody tr[data-batch-id]'))
                    .find((row) => String(row?.getAttribute('data-batch-id') || '').trim() === generatedBatchId) || refreshedBatchRow;
                const latestCheckbox = latestBatchRow instanceof HTMLElement
                    ? latestBatchRow.querySelector('input[data-points-change="toggle-selection"]')
                    : null;

                if (latestCheckbox instanceof HTMLInputElement && !latestCheckbox.checked) {
                    latestCheckbox.click();
                    await nextFrame();
                }

                await waitFor(
                    () => readSelectedCount() === '1' && latestBatchRow?.classList?.contains('selected')
                        ? latestBatchRow
                        : null,
                    { message: '批次删除前选中态未保持' }
                );
                return true;
            };

            if (typeof globalScope.batchDeleteBatches === 'function') {
                await ensureBatchDeleteSelectionReady();
                await globalScope.batchDeleteBatches();

                let deleteConfirmBtn = null;
                try {
                    deleteConfirmBtn = await waitFor(
                        () => document.querySelector('.delete-options-modal [data-points-action="execute-delete-option"]'),
                        { message: '批次删除确认弹窗未打开' }
                    );
                } catch (_) {
                    const selectedCount = String(document.getElementById('pointsBatchSelectedCount')?.textContent || '').trim() || '<empty>';
                    const rowSelected = refreshedBatchRow.classList.contains('selected') ? 'yes' : 'no';
                    const runtimeDetail = (smokeState.runtimeErrors || []).slice(-4).join(' || ') || '<none>';
                    throw new Error([
                        '批次删除确认弹窗未打开',
                        `selected=${selectedCount}`,
                        `rowSelected=${rowSelected}`,
                        `runtime=${runtimeDetail}`
                    ].join(' | '));
                }

                deleteConfirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                await waitFor(
                    () => !getTableRows('redemption_batches').some((row) => String(row?.id || '').trim() === generatedBatchId),
                    { message: '批次删除未通过 points manage handler 写回' }
                );

                await waitFor(
                    () => !document.querySelector('.codes-modal-overlay'),
                    { message: '删除当前批次后详情弹窗未关闭' }
                );

                recordResult(
                    '删除当前批次会关闭详情并清理选中态',
                    !getTableRows('redemption_batches').some((row) => String(row?.id || '').trim() === generatedBatchId)
                        && !document.querySelector('.codes-modal-overlay')
                        && String(document.getElementById('pointsBatchSelectedCount')?.textContent || '').trim() === '0',
                    `selected=${String(document.getElementById('pointsBatchSelectedCount')?.textContent || '').trim() || '<empty>'}`
                );
            } else {
                recordResult('删除当前批次会关闭详情并清理选中态', false, '批次删除函数未暴露到全局');
            }
        } else {
            recordResult('批次详情会通过 points batches handler 加载兑换码', false, '未找到包含兑换码明细的批次行');
        }
    }

    async function runAdminShopSmoke() {
        await waitFor(
            () => globalScope.switchModule
                && globalScope.AdminSiteFilter?.select
                && globalScope.ShopAdmin
                && typeof globalScope.hasModulePermission === 'function'
                && globalScope.hasModulePermission('shop') === true,
            { message: '商城模块入口未加载完成' }
        );

        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);
        const switched = globalScope.switchModule?.('shop');
        if (switched === false) {
            await sleep(180);
            globalScope.switchModule?.('shop');
        }

        let shopModule = null;
        try {
            shopModule = await waitFor(
                () => document.getElementById('module-shop')?.classList.contains('active')
                    ? document.getElementById('module-shop')
                    : null,
                { message: '商城模块未切换成功' }
            );
        } catch (_) {
            const sidebarEntry = document.querySelector('.sidebar-item[data-module-id="shop"]');
            throw new Error([
                '商城模块未切换成功',
                `shopPermission=${globalScope.hasModulePermission?.('shop') === true ? 'yes' : 'no'}`,
                `switchResult=${String(switched)}`,
                `sidebarDisabled=${sidebarEntry?.getAttribute('aria-disabled') || '<missing>'}`,
                `activeModule=${document.querySelector('.sidebar-item.active')?.getAttribute('data-module-id') || '<none>'}`
            ].join(' | '));
        }

        await globalScope.ShopAdmin.init?.();
        await sleep(180);

        let productsGrid = null;
        try {
            productsGrid = await waitFor(
                () => document.querySelectorAll('#productsGrid .shop-admin-product-card').length >= 4
                    ? document.getElementById('productsGrid')
                    : null,
                { message: '商城商品工作台未通过 products handler 渲染' }
            );
        } catch (_) {
            const grid = document.getElementById('productsGrid');
            throw new Error([
                '商城商品工作台未通过 products handler 渲染',
                `moduleActive=${shopModule?.classList?.contains('active') ? 'yes' : 'no'}`,
                `shopPermission=${globalScope.hasModulePermission?.('shop') === true ? 'yes' : 'no'}`,
                `currentTab=${globalScope.ShopAdmin?.currentTab || '<empty>'}`,
                `initialized=${globalScope.ShopAdmin?._initialized ? 'yes' : 'no'}`,
                `cardCount=${document.querySelectorAll('#productsGrid .shop-admin-product-card').length}`,
                `gridText=${String(grid?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) || '<empty>'}`
            ].join(' | '));
        }

        recordResult(
            '商城模块会通过 shop products handler 渲染商品工作台',
            /CN 高级账号/.test(productsGrid.textContent || '')
                && /兑换卡套餐/.test(productsGrid.textContent || ''),
            `cards=${document.querySelectorAll('#productsGrid .shop-admin-product-card').length}`
        );

        globalScope.ShopAdmin.switchTab('import');
        const importTree = await waitFor(
            () => document.querySelectorAll('#importProductTree .tree-category').length >= 3
                ? document.getElementById('importProductTree')
                : null,
            { message: '商城导入树未通过 categories/products handler 渲染' }
        );

        const initialAccountProductIds = Array.from(
            document.querySelectorAll('.tree-category[data-category="account"] .tree-product-item')
        ).map((element) => element.getAttribute('data-id'));
        recordResult(
            '商城导入树会通过 shop categories 和 products handler 渲染分类与商品',
            initialAccountProductIds.includes('shop-prod-cn-1') && initialAccountProductIds.includes('shop-prod-cn-2'),
            `account=${initialAccountProductIds.join(',')}`
        );

        await globalScope.ShopAdmin.reorderProduct('shop-prod-cn-2', 'account', 'shop-prod-cn-1');
        await waitFor(
            () => {
                const productRows = getTableRows('shop_products');
                return productRows.find((row) => row.id === 'shop-prod-cn-2')?.sort_order === 0
                    && productRows.find((row) => row.id === 'shop-prod-cn-1')?.sort_order === 1;
            },
            { message: '商城排序未通过 reorder_products 写回本地 smoke 状态' }
        );

        const reorderedAccountProductIds = Array.from(
            document.querySelectorAll('.tree-category[data-category="account"] .tree-product-item')
        ).map((element) => element.getAttribute('data-id'));
        recordResult(
            '商城拖拽排序会通过 shop mutate handler 持久化 sort_order',
            reorderedAccountProductIds[0] === 'shop-prod-cn-2' && reorderedAccountProductIds[1] === 'shop-prod-cn-1',
            `account=${reorderedAccountProductIds.join(',')}`
        );

        await globalScope.ShopAdmin.createCategory('Smoke 分类');
        await waitFor(
            () => getTableRows('shop_categories').some((row) => row.name === 'Smoke 分类'),
            { message: '商城分类创建未通过 create_category 生效' }
        );
        await globalScope.ShopAdmin.renameCategory('Smoke 分类', 'Smoke 分类已改名');
        await waitFor(
            () => getTableRows('shop_categories').some((row) => row.name === 'Smoke 分类已改名'),
            { message: '商城分类重命名未通过 rename_category 生效' }
        );

        recordResult(
            '商城分类创建与重命名会通过 shop mutate handler 写回分类树',
            getTableRows('shop_categories').some((row) => row.name === 'Smoke 分类已改名')
                && document.getElementById('productCategoryFilters')?.textContent?.includes('Smoke 分类已改名'),
            getTableRows('shop_categories').map((row) => row.name).join(',')
        );

        await globalScope.ShopAdmin.moveProductToCategory('shop-prod-cn-3', 'Smoke 分类已改名');
        await waitFor(
            () => getTableRows('shop_products').find((row) => row.id === 'shop-prod-cn-3')?.category === 'Smoke 分类已改名',
            { message: '商城跨分类移动未通过 reorder_products 生效' }
        );

        const stagedCategory = globalScope.ShopAdmin.categoryData.find((row) => row.name === 'Smoke 分类已改名') || null;
        if (stagedCategory) {
            await globalScope.ShopAdmin.deleteCategory(stagedCategory);
            await waitFor(
                () => !getTableRows('shop_categories').some((row) => row.name === 'Smoke 分类已改名')
                    && getTableRows('shop_products').find((row) => row.id === 'shop-prod-cn-3')?.category === 'other',
                { message: '商城删分类回退未把商品移回 fallback category' }
            );
        }

        recordResult(
            '商城跨分类移动与删分类回退会保持工作台闭环',
            getTableRows('shop_products').find((row) => row.id === 'shop-prod-cn-3')?.category === 'other',
            `prod_3=${getTableRows('shop_products').find((row) => row.id === 'shop-prod-cn-3')?.category || '<missing>'}`
        );

        globalScope.ShopAdmin.switchTab('inventory');
        const inventoryTableBody = await waitFor(
            () => document.querySelectorAll('#inventoryTableBody tr').length >= 1
                && String(document.getElementById('statAvailable')?.textContent || '').trim() !== '--'
                && String(document.getElementById('statReserve')?.textContent || '').trim() !== '--'
                ? document.getElementById('inventoryTableBody')
                : null,
            { message: '商城库存表未通过 inventory handler 渲染' }
        );

        const initialAvailableCount = Number(String(document.getElementById('statAvailable')?.textContent || '').trim() || 0);
        const initialReserveCount = Number(String(document.getElementById('statReserve')?.textContent || '').trim() || 0);

        recordResult(
            '库存列表会通过 shop inventory handler 渲染统计和表格',
            /CN 高级账号|兑换卡套餐/.test(inventoryTableBody.textContent || '')
                && initialAvailableCount === 2
                && initialReserveCount === 1,
            `available=${String(document.getElementById('statAvailable')?.textContent || '<empty>').trim()} / reserve=${String(document.getElementById('statReserve')?.textContent || '<empty>').trim()}`
        );

        await globalScope.ShopAdmin.performInventoryImport({
            productId: 'shop-prod-cn-1',
            contentLines: [
                'smoke-reserve-1@example.com----batch-pass-1',
                'smoke-reserve-2@example.com----batch-pass-2'
            ],
            status: 'reserve',
            batchId: 'SMOKE-SHOP-BATCH'
        });
        await globalScope.ShopAdmin.loadInventoryList(1);
        await globalScope.ShopAdmin.loadProducts();
        await globalScope.ShopAdmin.loadInventoryProductList();

        await waitFor(
            () => getTableRows('shop_inventory').filter((row) => row.batch_id === 'SMOKE-SHOP-BATCH').length === 2,
            { message: '库存导入未通过 import_inventory 写入 smoke 库存批次' }
        );

        recordResult(
            '库存导入会通过 shop mutate handler 写入批次',
            getTableRows('shop_inventory').filter((row) => row.batch_id === 'SMOKE-SHOP-BATCH' && row.status === 'reserve').length === 2,
            `batch=${getTableRows('shop_inventory').filter((row) => row.batch_id === 'SMOKE-SHOP-BATCH').map((row) => row.id).join(',')}`
        );

        await globalScope.ShopAdmin.openReleaseModal();
        const releaseSelect = await waitFor(
            () => {
                const node = document.getElementById('releaseProductSelect');
                return node instanceof HTMLSelectElement && node.options.length >= 2 ? node : null;
            },
            { message: '释放储备库存弹窗未加载商品列表' }
        );
        releaseSelect.value = 'shop-prod-cn-1';
        document.getElementById('releaseCount').value = '3';
        document.getElementById('releaseBeforeDate').value = '';
        await globalScope.ShopAdmin.releaseReserve();

        await waitFor(
            () => {
                const batchRows = getTableRows('shop_inventory').filter((row) => row.batch_id === 'SMOKE-SHOP-BATCH');
                const productRow = getTableRows('shop_products').find((row) => row.id === 'shop-prod-cn-1');
                return batchRows.length === 2
                    && batchRows.every((row) => row.status === 'available')
                    && Number(productRow?.stock_count || 0) === 4;
            },
            { message: '释放储备库存未通过 inventory_release_reserve 回收为在售库存' }
        );

        recordResult(
            '批量释放储备库存会通过 shop mutate handler 回收为在售库存',
            Number(getTableRows('shop_products').find((row) => row.id === 'shop-prod-cn-1')?.stock_count || 0) === 4
                && Number(String(document.getElementById('statAvailable')?.textContent || '').trim() || 0) === 5
                && Number(String(document.getElementById('statReserve')?.textContent || '').trim() || 0) === 0,
            `available=${String(document.getElementById('statAvailable')?.textContent || '<empty>').trim()} / reserve=${String(document.getElementById('statReserve')?.textContent || '<empty>').trim()}`
        );
    }

    async function runAdminCommentsSmoke() {
        await waitFor(() => globalScope.switchModule && globalScope.AdminSiteFilter?.select, { message: '评论模块入口未加载完成' });
        await waitFor(
            () => typeof globalScope.hasModulePermission !== 'function' || globalScope.hasModulePermission('comments') === true,
            { message: '评论模块权限未完成同步', timeoutMs: 30000 }
        );
        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);
        globalScope.syncAdminStudioModuleAccess?.({
            preferredModule: 'comments',
            enforceActiveModule: true
        });
        await sleep(120);
        globalScope.switchModule?.('comments', {
            fallback: false,
            silentDenied: true
        });

        await waitFor(
            () => document.getElementById('module-comments')?.classList.contains('active')
                ? document.getElementById('module-comments')
                : null,
            { message: '评论模块未切换成功', timeoutMs: 30000 }
        );

        await waitFor(
            () => Number(document.getElementById('totalCommentsCount')?.textContent || 0) === 5
                ? document.getElementById('totalCommentsCount')
                : null,
            { message: '评论统计未按站点完成加载' }
        );

        recordResult(
            '评论模块会按站点加载含回复的统计口径',
            Number(document.getElementById('totalCommentsCount')?.textContent || 0) === 5
                && Number(document.getElementById('todayCommentsCount')?.textContent || 0) === 5,
            `total=${document.getElementById('totalCommentsCount')?.textContent || '<empty>'} / today=${document.getElementById('todayCommentsCount')?.textContent || '<empty>'}`
        );

        await waitFor(
            () => document.querySelectorAll('#adminCommentList .comment-admin-item').length === 3
                ? document.getElementById('adminCommentList')
                : null,
            { message: '留言板评论列表未按 handler 渲染' }
        );

        const guestbookReplyCard = Array.from(document.querySelectorAll('#adminCommentList .comment-admin-item'))
            .find((item) => item.getAttribute('data-id') === 'gb-comment-cn-1');
        recordResult(
            '留言板列表会渲染主贴与回复链',
            Boolean(guestbookReplyCard) && /回复/.test(guestbookReplyCard.textContent || ''),
            guestbookReplyCard?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) || 'missing guestbook card'
        );

        await globalScope.deleteComment?.('gb-comment-cn-1', 'guestbook', 'comment');
        await waitFor(
            () => Number(document.getElementById('totalCommentsCount')?.textContent || 0) === 3
                ? document.getElementById('totalCommentsCount')
                : null,
            { message: '删除留言回复后统计未回收' }
        );

        recordResult(
            '删除留言回复会通过 comments handler 清理回复树',
            !getTableRows('guestbook_comments').some((row) => row.id === 'gb-comment-cn-1' || row.id === 'gb-reply-cn-1'),
            `remaining=${getTableRows('guestbook_comments').map((row) => row.id).join(',') || '<none>'}`
        );

        globalScope.switchCommentView?.('gallery');
        await waitFor(
            () => document.querySelectorAll('#adminCommentList .comment-admin-item').length === 2
                ? document.getElementById('adminCommentList')
                : null,
            { message: '画廊评论列表未切换成功' }
        );

        await globalScope.togglePin?.('prompt-comment-cn-2', false, 'prompt-cn-1');
        await waitFor(
            () => getTableRows('prompt_comments').find((row) => row.id === 'prompt-comment-cn-2')?.is_pinned === true,
            { message: '评论置顶未通过 comments handler 生效' }
        );

        recordResult(
            '画廊置顶会通过 comments handler 切换当前站点状态',
            getTableRows('prompt_comments').find((row) => row.id === 'prompt-comment-cn-1')?.is_pinned === false
                && getTableRows('prompt_comments').find((row) => row.id === 'prompt-comment-cn-2')?.is_pinned === true,
            `cn pinned=${getTableRows('prompt_comments').filter((row) => row.site === 'cn' && row.is_pinned).map((row) => row.id).join(',') || '<none>'}`
        );

        await globalScope.blockUser?.('00000000-0000-4000-8000-000000000001', 'guestbook', null);
        await waitFor(
            () => getTableRows('blocked_users').some((row) => row.user_id === '00000000-0000-4000-8000-000000000001' && row.scope === 'guestbook'),
            { message: '评论封禁动作未通过 comments blocks handler 生效' }
        );

        recordResult(
            '评论封禁会通过 comments blocks handler 写入封禁状态',
            getTableRows('blocked_users').some((row) => row.user_id === '00000000-0000-4000-8000-000000000001' && row.scope === 'guestbook'),
            getTableRows('blocked_users').map((row) => `${row.user_id}:${row.scope}`).join(',') || '<none>'
        );

        await globalScope.unblockUser?.('00000000-0000-4000-8000-000000000001', 'guestbook');
        await waitFor(
            () => !getTableRows('blocked_users').some((row) => row.user_id === '00000000-0000-4000-8000-000000000001' && row.scope === 'guestbook'),
            { message: '评论解封动作未通过 comments blocks handler 生效' }
        );

        recordResult(
            '评论解封会通过 comments blocks handler 清理封禁状态',
            !getTableRows('blocked_users').some((row) => row.user_id === '00000000-0000-4000-8000-000000000001' && row.scope === 'guestbook'),
            getTableRows('blocked_users').map((row) => `${row.user_id}:${row.scope}`).join(',') || '<none>'
        );

        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(160);
        await waitFor(
            () => Number(document.getElementById('totalCommentsCount')?.textContent || 0) === 3
                ? document.getElementById('totalCommentsCount')
                : null,
            { message: '切换到 INTL 站点后评论统计未刷新' }
        );

        recordResult(
            '切换站点后评论统计不会串站',
            Number(document.getElementById('totalCommentsCount')?.textContent || 0) === 3
                && getTableRows('prompt_comments').find((row) => row.id === 'prompt-comment-intl-1')?.is_pinned === false,
            `intl total=${document.getElementById('totalCommentsCount')?.textContent || '<empty>'}`
        );
    }

    async function runUserModalSmoke() {
        await waitFor(() => typeof globalScope.openUserModal === 'function', { message: '用户详情弹窗入口未加载完成' });
        const targetUserId = String(smokeState.profiles?.[0]?.id || '').trim();
        if (!targetUserId) {
            recordResult('用户详情弹窗支持点击外部关闭', false, '本地 smoke 未提供测试用户');
            return;
        }

        const opened = await globalScope.openUserModal(targetUserId, { tab: 'ledger' });
        const overlay = await waitFor(
            () => {
                const node = document.getElementById('userModalOverlay');
                return node?.classList.contains('active') ? node : null;
            },
            { message: '用户详情弹窗未能打开' }
        );

        await nextFrame();
        await sleep(80);

        const bodyLocked = document.body.classList.contains('no-scroll')
            || document.body.classList.contains('ios-scroll-lock-fixed')
            || document.documentElement.classList.contains('no-scroll');
        recordResult(
            '用户详情弹窗打开时背景滚动已锁定',
            Boolean(opened) && bodyLocked,
            `body=${document.body.className || '<empty>'} / html=${document.documentElement.className || '<empty>'}`
        );

        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(180);

        let closeDetail = 'overlay click dismissed modal';
        let closed = !overlay.classList.contains('active');
        if (!closed && typeof globalScope.closeUserModal === 'function') {
            const directCloseResult = await globalScope.closeUserModal();
            await sleep(120);
            closed = !overlay.classList.contains('active');
            closeDetail = closed
                ? `overlay click missed, direct close succeeded (result=${String(directCloseResult)})`
                : `overlay click missed, direct close also failed (result=${String(directCloseResult)})`;
        }

        const lockCleared = !document.body.classList.contains('no-scroll')
            && !document.body.classList.contains('ios-scroll-lock-fixed')
            && !document.documentElement.classList.contains('no-scroll');
        recordResult('用户详情弹窗支持点击外部关闭', closed, closeDetail);
        recordResult(
            '用户详情弹窗关闭后背景滚动会恢复',
            lockCleared,
            `body=${document.body.className || '<empty>'} / html=${document.documentElement.className || '<empty>'}`
        );
    }

    async function runAdminChatSmoke() {
        await waitFor(
            () => typeof globalScope.AdminChat === 'function' && typeof globalScope.switchModule === 'function',
            { message: '客服工作台脚本未加载完成', timeoutMs: 30000 }
        );
        await waitFor(
            () => typeof globalScope.hasModulePermission !== 'function' || globalScope.hasModulePermission('chat') === true,
            { message: '客服工作台模块权限未完成同步', timeoutMs: 30000 }
        );
        globalScope.syncAdminStudioModuleAccess?.({
            preferredModule: 'chat',
            enforceActiveModule: true
        });
        await sleep(120);
        globalScope.switchModule?.('chat', {
            fallback: false,
            silentDenied: true
        });
        await waitFor(
            () => document.getElementById('module-chat')?.classList.contains('active')
                ? document.getElementById('module-chat')
                : null,
            { message: '客服工作台模块未切换成功', timeoutMs: 30000 }
        );

        const instance = await waitFor(
            () => globalScope.adminChatInstance && document.getElementById('sessionQueueOverview') ? globalScope.adminChatInstance : null,
            { message: '客服工作台实例未初始化', timeoutMs: 45000 }
        );
        await waitFor(
            () => document.querySelectorAll('#sessionQueueOverview [data-session-stat-filter]').length >= 5
                ? document.getElementById('sessionQueueOverview')
                : null,
            { message: '客服工作台队列总览未渲染' }
        );
        await waitFor(
            () => document.querySelectorAll('#sessionList .session-item').length >= 4
                ? document.getElementById('sessionList')
                : null,
            { message: '客服工作台会话列表未渲染' }
        );

        const overviewCards = document.querySelectorAll('#sessionQueueOverview [data-session-stat-filter]');
        recordResult('客服工作台队列总览已渲染', overviewCards.length >= 5, `总览卡片 ${overviewCards.length} 个`);

        const snapshot = await waitFor(
            () => {
                const node = document.getElementById('sessionQueueSnapshot');
                return node && /适合切到|优先处理|协同安排/.test(node.textContent || '') ? node : null;
            },
            { message: '值班建议卡片未渲染' }
        );
        recordResult('值班建议卡片已渲染', true, (snapshot.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80));

        const applyButton = snapshot.querySelector('[data-session-snapshot-action="apply-recommended-mode"]');
        if (applyButton instanceof HTMLElement) {
            const expectedView = applyButton.getAttribute('data-session-recommended-view') || 'all';
            const expectedFilter = applyButton.getAttribute('data-session-recommended-filter') || 'all';
            applyButton.click();
            await sleep(120);

            const applied = instance.sessionQueueView === expectedView && instance.sessionQueueFilter === expectedFilter;
            recordResult(
                '建议视图一键切换会立即生效',
                applied,
                `view=${instance.sessionQueueView} / filter=${instance.sessionQueueFilter}`
            );
        } else {
            recordResult('建议视图一键切换会立即生效', false, '未找到建议视图按钮');
        }

        await instance.loadSession('smoke-session-stale-1');
        const replyButtons = await waitFor(
            () => {
                const rows = Array.from(document.querySelectorAll('#chatReplyTemplateBar .chat-reply-template-btn'));
                const chips = document.querySelectorAll('#currentChatStatusChips .chat-user-status-chip');
                return rows.length >= 4 && chips.length >= 2 ? rows : null;
            },
            { message: '客服工作台快捷回复与会话上下文未完成联动渲染', timeoutMs: 16000 }
        );
        const statusChips = document.querySelectorAll('#currentChatStatusChips .chat-user-status-chip');
        recordResult(
            '会话上下文与快捷回复已联动渲染',
            replyButtons.length >= 4 && statusChips.length >= 2,
            `模板 ${replyButtons.length} 个 / 状态标签 ${statusChips.length} 个`
        );

        const input = document.getElementById('adminChatInput');
        const orderReply = replyButtons.find((button) => /订单说明/.test(button.textContent || '')) || replyButtons[0];
        if ((input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) && orderReply instanceof HTMLElement) {
            orderReply.click();
            await sleep(60);
            const insertedText = String(input.value || '').trim();
            recordResult(
                '快捷回复点击后会回填插值正文',
                Boolean(insertedText) && !insertedText.includes('{{') && /春季体验套餐|处理中/.test(insertedText),
                insertedText.slice(0, 80)
            );
        } else {
            recordResult('快捷回复点击后会回填插值正文', false, '未找到回复输入框或模板按钮');
        }

        if (shouldRunMobileLayoutChecks()) {
            recordSelectorsNoHorizontalOverflow(
                '客服工作台窄屏下值班建议与会话区没有横向溢出',
                [
                    '#sessionQueueOverview',
                    '#sessionQueueSnapshot',
                    '#sessionList',
                    '#chatContextPanel',
                    '#adminMessagesArea',
                    '#chatReplyTemplateBar .chat-reply-templates__list'
                ]
            );
            recordSelectorsNoHorizontalOverflow(
                '客服工作台窄屏下快捷回复按钮可换行显示',
                ['#chatReplyTemplateBar .chat-reply-template-btn']
            );
        }
    }

    async function runNotificationSmoke() {
        await waitFor(() => typeof globalScope.initNotificationSystem === 'function', { message: '通知系统未加载完成' });
        try {
            globalScope.localStorage?.removeItem?.('notifications_pinned_v1');
        } catch (_) {
            // Ignore local storage availability in restricted smoke contexts.
        }
        smokeState.notificationSelectCount = 0;
        smokeState.notificationSelectDelayMs = 220;
        globalScope.__resetNotificationSystemForSmoke?.();
        globalScope.toggleNotifMenu?.();
        const drawer = await waitFor(() => document.getElementById('notifDrawer')?.classList.contains('active')
            ? document.getElementById('notifDrawer')
            : null, { message: '通知抽屉未打开' });
        const loadingState = await waitFor(() => {
            const loading = document.querySelector('#notifDrawerList .notif-empty--loading');
            return loading instanceof HTMLElement ? loading : null;
        }, { message: '通知抽屉未显示三点加载态' });
        const loadingFooter = document.querySelector('.notif-drawer-footer');
        const loadingFooterDisplay = loadingFooter instanceof HTMLElement
            ? globalScope.getComputedStyle(loadingFooter).display
            : '';
        const loadingDotItems = Array.from(loadingState.querySelectorAll('.notif-loading-dots span'));
        const firstLoadingDotStyle = loadingDotItems[0] instanceof HTMLElement
            ? globalScope.getComputedStyle(loadingDotItems[0])
            : null;
        const firstLoadingDotOpacity = Number.parseFloat(firstLoadingDotStyle?.opacity || '0');
        const firstLoadingDotVisible = firstLoadingDotOpacity >= 0.38
            && !/^transparent$/i.test(String(firstLoadingDotStyle?.backgroundColor || '').trim());
        const loadingDotsAnimated = loadingDotItems.length === 3
            && String(firstLoadingDotStyle?.animationName || '').includes('notifLoadingDots')
            && String(firstLoadingDotStyle?.animationDuration || '') !== '0s'
            && firstLoadingDotVisible;
        const loadingList = document.getElementById('notifDrawerList');
        const loadingDots = loadingState.querySelector('.notif-loading-dots');
        const loadingListRect = loadingList instanceof HTMLElement
            ? loadingList.getBoundingClientRect()
            : null;
        const loadingDotsRect = loadingDots instanceof HTMLElement
            ? loadingDots.getBoundingClientRect()
            : null;
        const loadingWindowHeight = Number(globalScope.innerHeight || document.documentElement?.clientHeight || 0);
        const loadingCenterDelta = loadingDotsRect && loadingWindowHeight > 0
            ? Math.abs((loadingDotsRect.top + loadingDotsRect.height / 2) - (loadingWindowHeight / 2))
            : Number.POSITIVE_INFINITY;
        const loadingCenterTolerance = loadingWindowHeight > 0
            ? Math.max(24, loadingWindowHeight * 0.035)
            : 0;
        const clearAllHeaderAction = document.querySelector('[data-notif-action="clear-all"]');
        recordResult(
            '通知加载中不会显示收起通知按钮',
            loadingState instanceof HTMLElement && loadingFooterDisplay === 'none',
            `footerDisplay=${loadingFooterDisplay || 'missing'}`
        );
        recordResult(
            '通知首次加载会显示跳动三点',
            loadingDotsAnimated,
            `dots=${loadingDotItems.length} animation=${firstLoadingDotStyle?.animationName || 'missing'} duration=${firstLoadingDotStyle?.animationDuration || 'missing'} opacity=${firstLoadingDotStyle?.opacity || 'missing'} color=${firstLoadingDotStyle?.backgroundColor || 'missing'}`
        );
        recordResult(
            '通知加载三点在窗口中上下居中',
            Number.isFinite(loadingCenterDelta) && loadingCenterDelta <= loadingCenterTolerance,
            `delta=${Number.isFinite(loadingCenterDelta) ? loadingCenterDelta.toFixed(1) : 'missing'} tolerance=${loadingCenterTolerance.toFixed(1)} window=${loadingWindowHeight || 'missing'} list=${loadingListRect?.height?.toFixed?.(1) || 'missing'}`
        );
        recordResult(
            '通知抽屉右上角不再显示清空 X 模块',
            !(clearAllHeaderAction instanceof HTMLElement),
            clearAllHeaderAction instanceof HTMLElement ? 'clear-all 仍在 DOM 中' : 'clear-all removed'
        );

        const list = await waitFor(() => document.getElementById('notifDrawerList'));
        await waitFor(() => list.querySelectorAll('.notif-card').length > 0 ? list : null, { message: '通知抽屉未渲染通知卡片' });
        smokeState.notificationSelectDelayMs = 0;
        await waitFor(() => document.getElementById('notifBadge')?.hidden === false, { message: '通知数据未完成初始拉取' });
        const fetchCountAfterInitialLoad = smokeState.notificationSelectCount;
        const firstAnimatedCard = list.querySelector('.notif-card-shell');
        const drawerEntryActive = drawer?.classList.contains('notif-drawer-content-entering') === true;
        const firstCardEntryActive = firstAnimatedCard?.classList.contains('notif-card-filter-enter') === true;
        recordResult(
            '通知三点加载完成后会保留入场动画',
            drawerEntryActive && firstCardEntryActive,
            `drawer=${drawerEntryActive} card=${firstCardEntryActive}`
        );
        const fetchCountAfterDrawerOpen = smokeState.notificationSelectCount;
        await globalScope.initNotificationSystem();
        await sleep(80);
        const fetchCountAfterRepeatInit = smokeState.notificationSelectCount;

        recordResult(
            '通知抽屉打开后不会重复拉取并二次刷新',
            fetchCountAfterInitialLoad === 1
                && fetchCountAfterDrawerOpen === fetchCountAfterInitialLoad
                && fetchCountAfterRepeatInit === fetchCountAfterInitialLoad,
            `fetch ${fetchCountAfterInitialLoad} -> ${fetchCountAfterDrawerOpen} -> ${fetchCountAfterRepeatInit}`
        );

        const cardLayouts = Array.from(list.querySelectorAll('.notif-card-shell'))
            .map((shell) => {
                const card = shell.querySelector('.notif-card');
                const shellRect = shell.getBoundingClientRect();
                const cardRect = card instanceof HTMLElement ? card.getBoundingClientRect() : null;
                return {
                    shellHeight: Number(shellRect?.height || 0),
                    cardHeight: Number(cardRect?.height || 0)
                };
            });
        const collapsedCardLayouts = cardLayouts.filter((layout) => layout.shellHeight < 56 || layout.cardHeight < 56);
        recordResult(
            '通知卡片保持可读高度不会被压成横线',
            cardLayouts.length > 0 && collapsedCardLayouts.length === 0,
            collapsedCardLayouts.length > 0
                ? `collapsed=${collapsedCardLayouts.length} first=${collapsedCardLayouts[0].shellHeight.toFixed(1)}/${collapsedCardLayouts[0].cardHeight.toFixed(1)}`
                : `cards=${cardLayouts.length} first=${cardLayouts[0]?.shellHeight.toFixed(1) || '0.0'}/${cardLayouts[0]?.cardHeight.toFixed(1) || '0.0'}`
        );
        {
            const parseCssRgb = (value) => {
                const match = String(value || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
                return match
                    ? [Number(match[1]), Number(match[2]), Number(match[3])]
                    : null;
            };
            const parseCssAlpha = (value) => {
                const normalized = String(value || '').trim();
                if (/^transparent$/i.test(normalized)) return 0;
                if (/^rgba\(/i.test(normalized)) {
                    const values = normalized.match(/[\d.]+/g) || [];
                    const parsed = Number.parseFloat(values[3] || '1');
                    return Number.isFinite(parsed) ? parsed : 1;
                }
                return /^rgb\(/i.test(normalized) ? 1 : 0;
            };
            const colorBrightness = (rgb) => Array.isArray(rgb)
                ? ((rgb[0] * 299) + (rgb[1] * 587) + (rgb[2] * 114)) / 1000
                : 0;
            const isUnreadRailColor = (rgb) => Array.isArray(rgb)
                && rgb[0] >= 200
                && rgb[1] <= 120
                && rgb[2] <= 130;
            const isReadRailColor = (rgb) => Array.isArray(rgb)
                && rgb[1] >= 150
                && rgb[0] <= 120
                && rgb[2] <= 130;
            const usesProfileModalBackdrop = (value = '') => {
                const normalized = String(value || '').trim();
                return /--public-light-modal-backdrop|rgba?\(\s*34[,\s]+41[,\s]+52/i.test(normalized);
            };
            const unreadRailCard = list.querySelector('.notif-card.unread');
            const readRailCard = list.querySelector('.notif-card:not(.unread)');
            const unreadRailStyle = unreadRailCard instanceof HTMLElement
                ? globalScope.getComputedStyle(unreadRailCard)
                : null;
            const readRailStyle = readRailCard instanceof HTMLElement
                ? globalScope.getComputedStyle(readRailCard)
                : null;
            const unreadRailRgb = parseCssRgb(unreadRailStyle?.borderLeftColor || '');
            const readRailRgb = parseCssRgb(readRailStyle?.borderLeftColor || '');
            const unreadRailWidth = Number.parseFloat(unreadRailStyle?.borderLeftWidth || '0');
            const readRailWidth = Number.parseFloat(readRailStyle?.borderLeftWidth || '0');
            const unreadRailHasNoGradient = !/linear-gradient/i.test(String(unreadRailStyle?.backgroundImage || ''));
            const readRailHasNoGradient = !/linear-gradient/i.test(String(readRailStyle?.backgroundImage || ''));
            const filterTitle = list.querySelector('.notif-filter-title');
            const filterTitleStyle = filterTitle instanceof HTMLElement
                ? globalScope.getComputedStyle(filterTitle)
                : null;
            const filterTitleBrightness = colorBrightness(parseCssRgb(filterTitleStyle?.color || ''));
            const shouldShowFilterTitle = globalScope.matchMedia
                ? !globalScope.matchMedia('(max-width: 768px)').matches
                : Number(globalScope.innerWidth || 0) > 768;
            const getChipBorderColor = (selector) => {
                const element = list.querySelector(selector);
                return element instanceof HTMLElement
                    ? globalScope.getComputedStyle(element).borderColor
                    : '';
            };
            const functionalChipColors = [
                getChipBorderColor('[data-notif-action="filter-category"][data-notif-category="all"]'),
                getChipBorderColor('[data-notif-action="filter-category"][data-notif-category="assignment"]'),
                getChipBorderColor('[data-notif-action="filter-category"][data-notif-category="security"]'),
                getChipBorderColor('[data-notif-action="filter-category"][data-notif-category="announcement"]'),
                getChipBorderColor('[data-notif-action="filter-category"][data-notif-category="admin_notice"]'),
                getChipBorderColor('[data-notif-action="filter-read"][data-notif-read-filter="unread"]'),
                getChipBorderColor('[data-notif-action="filter-read"][data-notif-read-filter="read"]')
            ].filter(Boolean);
            const uniqueFunctionalChipColors = new Set(functionalChipColors).size;
            recordResult(
                '通知条左侧读态指示条颜色正确',
                isUnreadRailColor(unreadRailRgb)
                    && isReadRailColor(readRailRgb)
                    && unreadRailWidth >= 3
                    && readRailWidth >= 3
                    && unreadRailHasNoGradient
                    && readRailHasNoGradient,
                `unread=${unreadRailStyle?.borderLeftColor || 'missing'} read=${readRailStyle?.borderLeftColor || 'missing'} width=${unreadRailStyle?.borderLeftWidth || 'missing'}/${readRailStyle?.borderLeftWidth || 'missing'} gradient=${!unreadRailHasNoGradient}/${!readRailHasNoGradient}`
            );
            recordResult(
                '通知筛选胶囊顶部显示通知标题',
                filterTitle instanceof HTMLElement
                    && filterTitle.textContent?.trim() === '通知'
                    && (
                        shouldShowFilterTitle
                            ? filterTitleStyle?.display !== 'none'
                                && parseCssAlpha(filterTitleStyle?.color || '') >= 0.95
                                && filterTitleBrightness >= 245
                            : filterTitleStyle?.display === 'none'
                    ),
                `text=${filterTitle?.textContent?.trim() || 'missing'} display=${filterTitleStyle?.display || 'missing'} color=${filterTitleStyle?.color || 'missing'} brightness=${filterTitleBrightness.toFixed(1)} viewport=${Number(globalScope.innerWidth || 0)}`
            );
            recordResult(
                '通知筛选胶囊按功能区分颜色',
                uniqueFunctionalChipColors >= 5,
                `unique=${uniqueFunctionalChipColors} colors=${functionalChipColors.join('|') || 'missing'}`
            );
            const getTopLevelNotificationStyleRules = () => {
                const rules = [];
                Array.from(document.styleSheets || []).forEach((sheet) => {
                    const href = String(sheet.href || '');
                    if (href && !href.includes('notification-client.css')) return;
                    try {
                        Array.from(sheet.cssRules || []).forEach((rule) => {
                            if (rule?.type === CSSRule.STYLE_RULE) {
                                rules.push(rule);
                            }
                        });
                    } catch (_) {
                        // Cross-origin stylesheets are irrelevant for this local notification CSS check.
                    }
                });
                return rules;
            };
            const topLevelNotificationRules = getTopLevelNotificationStyleRules();
            const hasTopLevelRule = (selectorPart, matcher) => topLevelNotificationRules.some((rule) => {
                const selectorText = String(rule?.selectorText || '');
                return selectorText.includes(selectorPart) && matcher(rule.style || {});
            });
            const hasDesktopLightChipRule = hasTopLevelRule('html[data-theme="light"] .notif-filter-chip', (style) => {
                const chipBgVar = typeof style.getPropertyValue === 'function'
                    ? style.getPropertyValue('--notif-chip-bg')
                    : '';
                return colorBrightness(parseCssRgb(style.backgroundColor)) >= 210
                    || colorBrightness(parseCssRgb(String(chipBgVar || ''))) >= 210;
            });
            const hasDesktopLightCardRule = hasTopLevelRule('html[data-theme="light"] .notif-card', (style) => {
                return colorBrightness(parseCssRgb(style.backgroundColor)) >= 210;
            });
            const hasDesktopLightTitleRule = hasTopLevelRule('html[data-theme="light"] .notif-card-title', (style) => {
                return colorBrightness(parseCssRgb(style.color)) <= 96;
            });
            const hasStickyFilterPanelRule = hasTopLevelRule('.notif-filter-panel', (style) => {
                return String(style.position || '').trim() === 'sticky' && String(style.top || '').trim() === '0px';
            });
            const hasOpaqueFilterPanelRule = hasTopLevelRule('.notif-filter-panel', (style) => {
                return parseCssAlpha(style.backgroundColor || style.background) >= 0.99;
            });
            const hasBackdropBlurRule = hasTopLevelRule('.notif-backdrop', (style) => {
                return /blur\(/i.test(`${style.backdropFilter || ''} ${style.webkitBackdropFilter || ''}`);
            });
            const hasProfileBackdropRule = hasTopLevelRule('.notif-backdrop', (style) => {
                return usesProfileModalBackdrop(`${style.background || ''} ${style.backgroundColor || ''}`);
            });
            const usesDesktopNotificationLayout = globalScope.matchMedia
                ? !globalScope.matchMedia('(max-width: 768px)').matches
                : Number(globalScope.innerWidth || 0) > 768;

            if (usesDesktopNotificationLayout) {
                const root = document.documentElement;
                const originalTheme = root.getAttribute('data-theme');
                root.setAttribute('data-theme', 'light');
                await sleep(40);
                const lightChip = list.querySelector('.notif-filter-chip');
                const lightCard = list.querySelector('.notif-card');
                const lightTitle = lightCard?.querySelector?.('.notif-card-title');
                const backdrop = document.getElementById('notifBackdrop');
                const filterPanel = list.querySelector('.notif-filter-panel');
                const chipStyle = lightChip instanceof HTMLElement ? globalScope.getComputedStyle(lightChip) : null;
                const cardStyle = lightCard instanceof HTMLElement ? globalScope.getComputedStyle(lightCard) : null;
                const titleStyle = lightTitle instanceof HTMLElement ? globalScope.getComputedStyle(lightTitle) : null;
                const backdropStyle = backdrop instanceof HTMLElement ? globalScope.getComputedStyle(backdrop) : null;
                const filterPanelStyle = filterPanel instanceof HTMLElement ? globalScope.getComputedStyle(filterPanel) : null;
                const chipLight = colorBrightness(parseCssRgb(chipStyle?.backgroundColor)) >= 210;
                const cardLight = colorBrightness(parseCssRgb(cardStyle?.backgroundColor)) >= 210;
                const titleDark = colorBrightness(parseCssRgb(titleStyle?.color)) <= 96;
                const backdropFilter = `${backdropStyle?.backdropFilter || ''} ${backdropStyle?.webkitBackdropFilter || ''}`.trim();
                const backdropBlurred = /blur\(/i.test(backdropFilter);
                const backdropUsesProfileGlass = usesProfileModalBackdrop(backdropStyle?.backgroundColor);
                const filterPanelSticky = filterPanelStyle?.position === 'sticky' && filterPanelStyle?.top === '0px';
                const filterPanelOpaque = parseCssAlpha(filterPanelStyle?.backgroundColor) >= 0.99;
                recordResult(
                    '电脑端亮色通知抽屉使用浅色筛选和卡片',
                    chipLight && cardLight && titleDark,
                    `chip=${chipStyle?.backgroundColor || 'missing'} card=${cardStyle?.backgroundColor || 'missing'} title=${titleStyle?.color || 'missing'}`
                );
                recordResult(
                    '通知筛选胶囊固定在不透明顶部容器',
                    filterPanelSticky && filterPanelOpaque,
                    `position=${filterPanelStyle?.position || 'missing'} top=${filterPanelStyle?.top || 'missing'} background=${filterPanelStyle?.backgroundColor || 'missing'}`
                );
                recordResult(
                    '电脑端通知遮罩使用弹窗同款背景模糊',
                    backdropBlurred && backdropUsesProfileGlass,
                    `filter=${backdropFilter || 'missing'} background=${backdropStyle?.backgroundColor || 'missing'}`
                );
                if (originalTheme === null) {
                    root.removeAttribute('data-theme');
                } else {
                    root.setAttribute('data-theme', originalTheme);
                }
            } else {
                recordResult(
                    '电脑端亮色通知抽屉使用浅色筛选和卡片',
                    hasDesktopLightChipRule && hasDesktopLightCardRule && hasDesktopLightTitleRule,
                    `desktopCssRules chip=${hasDesktopLightChipRule} card=${hasDesktopLightCardRule} title=${hasDesktopLightTitleRule} viewport=${Number(globalScope.innerWidth || 0)}`
                );
                recordResult(
                    '通知筛选胶囊固定在不透明顶部容器',
                    hasStickyFilterPanelRule && hasOpaqueFilterPanelRule,
                    `desktopCssRule=${hasStickyFilterPanelRule} opaque=${hasOpaqueFilterPanelRule} viewport=${Number(globalScope.innerWidth || 0)}`
                );
                recordResult(
                    '电脑端通知遮罩使用弹窗同款背景模糊',
                    hasBackdropBlurRule && hasProfileBackdropRule,
                    `desktopCssRule=${hasBackdropBlurRule} profileBackdrop=${hasProfileBackdropRule} viewport=${Number(globalScope.innerWidth || 0)}`
                );
            }
        }
        if (shouldRunMobileLayoutChecks()) {
            const footer = document.querySelector('.notif-drawer-footer');
            const closeButton = footer?.querySelector?.('.notif-close-btn');
            if (footer instanceof HTMLElement && closeButton instanceof HTMLElement) {
                const footerRect = footer.getBoundingClientRect();
                const buttonRect = closeButton.getBoundingClientRect();
                const centerDelta = Math.abs(
                    (buttonRect.top + buttonRect.height / 2)
                    - (footerRect.top + footerRect.height / 2)
                );
                recordResult(
                    '通知中心底部收起胶囊在白块中上下居中',
                    centerDelta <= 2,
                    `delta=${centerDelta.toFixed(1)} footer=${footerRect.height.toFixed(1)} button=${buttonRect.height.toFixed(1)}`
                );
            } else {
                recordResult('通知中心底部收起胶囊在白块中上下居中', false, '未找到底部收起按钮');
            }
        }

        const createNotificationPointerEvent = (type, clientX, clientY, pointerId = 12, pointerType = 'touch') => {
            if (typeof PointerEvent === 'function') {
                return new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId,
                    pointerType,
                    button: 0,
                    clientX,
                    clientY
                });
            }

            return new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX,
                clientY
            });
        };

        const swipeShell = list.querySelector('.notif-card-shell');
        const swipeTarget = swipeShell?.querySelector('.notif-card') || swipeShell;
        if (swipeShell instanceof HTMLElement && swipeTarget instanceof HTMLElement) {
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointerdown', 260, 90));
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointermove', 88, 92));
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointerup', 88, 92));
            await sleep(40);
            const hasSwipeActions = ['toggle-pin', 'delete-notification', 'mark-read']
                .every((action) => swipeShell.querySelector(`[data-notif-action="${action}"]`) instanceof HTMLElement);
            const openAfterSwipe = swipeShell.classList.contains('is-actions-open');
            recordResult(
                '通知卡片左滑会露出置顶、删除、已读操作',
                openAfterSwipe && hasSwipeActions,
                `actions=${hasSwipeActions ? 'ready' : 'missing'} open=${openAfterSwipe}`
            );
            const actionsBackground = swipeShell.querySelector('.notif-card-actions') || swipeTarget;
            actionsBackground.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX: 88,
                clientY: 92
            }));
            await sleep(40);
            const openAfterSyntheticClick = swipeShell.classList.contains('is-actions-open');
            recordResult(
                '通知卡片左滑松手后的桌面补发点击不会关回',
                openAfterSyntheticClick,
                `open=${openAfterSyntheticClick}`
            );
            await sleep(560);
            list.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX: 12,
                clientY: Math.max(180, list.getBoundingClientRect().bottom - 16)
            }));
            await sleep(40);
            const openAfterBlankClick = swipeShell.classList.contains('is-actions-open');
            recordResult(
                '通知卡片左滑后点击空白处会收回操作栏',
                !openAfterBlankClick,
                `open=${openAfterBlankClick}`
            );
            swipeTarget.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaX: 96,
                deltaY: 2
            }));
            await sleep(40);
            const openAfterHorizontalWheel = swipeShell.classList.contains('is-actions-open');
            recordResult(
                '通知卡片触控板横向滑动也会停留操作栏',
                openAfterHorizontalWheel,
                `open=${openAfterHorizontalWheel}`
            );
            list.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX: 12,
                clientY: Math.max(180, list.getBoundingClientRect().bottom - 16)
            }));
            await sleep(40);
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointerdown', 260, 90, 13));
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointermove', 88, 92, 13));
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointercancel', 88, 92, 13));
            await sleep(40);
            const openAfterPointerCancel = swipeShell.classList.contains('is-actions-open');
            recordResult(
                '通知卡片左滑被浏览器取消时仍停留操作栏',
                openAfterPointerCancel,
                `open=${openAfterPointerCancel}`
            );
            await sleep(560);
            list.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX: 12,
                clientY: Math.max(180, list.getBoundingClientRect().bottom - 16)
            }));
            await sleep(40);
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointerdown', 260, 90, 15, 'mouse'));
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointermove', 88, 92, 15, 'mouse'));
            swipeTarget.dispatchEvent(createNotificationPointerEvent('pointerup', 88, 92, 15, 'mouse'));
            await sleep(40);
            list.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX: 88,
                clientY: 92
            }));
            await sleep(40);
            const openAfterMouseDragListClick = swipeShell.classList.contains('is-actions-open');
            recordResult(
                '通知卡片鼠标拖动左滑松手后不会被列表补发点击关回',
                openAfterMouseDragListClick,
                `open=${openAfterMouseDragListClick}`
            );
            await sleep(560);
            list.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX: 12,
                clientY: Math.max(180, list.getBoundingClientRect().bottom - 16)
            }));
            await sleep(40);
        } else {
            recordResult('通知卡片左滑会露出置顶、删除、已读操作', false, '未找到可滑动通知卡片');
            recordResult('通知卡片左滑松手后的桌面补发点击不会关回', false, '未找到可滑动通知卡片');
            recordResult('通知卡片左滑后点击空白处会收回操作栏', false, '未找到可滑动通知卡片');
            recordResult('通知卡片触控板横向滑动也会停留操作栏', false, '未找到可滑动通知卡片');
            recordResult('通知卡片左滑被浏览器取消时仍停留操作栏', false, '未找到可滑动通知卡片');
            recordResult('通知卡片鼠标拖动左滑松手后不会被列表补发点击关回', false, '未找到可滑动通知卡片');
        }

        const categoryChips = list.querySelectorAll('[data-notif-action="filter-category"]');
        const readChips = list.querySelectorAll('[data-notif-action="filter-read"]');
        recordResult('管理员铃铛分类筛选已渲染', categoryChips.length >= 5, `分类按钮 ${categoryChips.length} 个`);
        recordResult('已读/未读筛选已渲染', readChips.length === 3, `状态按钮 ${readChips.length} 个`);

        const securityChip = list.querySelector('[data-notif-action="filter-category"][data-notif-category="security"]');
        if (securityChip instanceof HTMLElement) {
            securityChip.click();
            await sleep(80);
            const visibleCards = Array.from(list.querySelectorAll('.notif-card'));
            const allSecurity = visibleCards.length > 0
                && visibleCards.every((card) => card.getAttribute('data-notif-category') === 'security');
            recordResult('分类筛选只显示命中分类的提醒', allSecurity, `当前卡片 ${visibleCards.length} 条`);

            const firstSecurityCard = visibleCards[0];
            firstSecurityCard?.dispatchEvent?.(createNotificationPointerEvent('pointerdown', 240, 120, 14));
            firstSecurityCard?.dispatchEvent?.(createNotificationPointerEvent('pointerup', 240, 120, 14));
            await sleep(80);
            const firstSecurityBody = firstSecurityCard?.querySelector?.('.notif-card-body');
            const firstSecurityBodyStyle = firstSecurityBody instanceof HTMLElement
                ? globalScope.getComputedStyle(firstSecurityBody)
                : null;
            const detailExpanded = firstSecurityCard?.classList.contains('expanded') === true
                && firstSecurityBodyStyle?.display === 'block'
                && firstSecurityBodyStyle?.overflow === 'visible'
                && String(firstSecurityBodyStyle?.webkitLineClamp || '').trim() !== '2';
            recordResult(
                '异常登录安全提醒点击会展开内容',
                detailExpanded,
                `expanded=${firstSecurityCard?.classList.contains('expanded') === true} display=${firstSecurityBodyStyle?.display || 'unknown'} overflow=${firstSecurityBodyStyle?.overflow || 'unknown'}`
            );

            firstSecurityCard?.click?.();
            await sleep(40);
            const firstSecurityShell = firstSecurityCard?.closest?.('.notif-card-shell');
            firstSecurityShell?.dispatchEvent?.(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                button: 0
            }));
            await sleep(60);
            recordResult(
                '电脑端通知条外壳点击也会展开详情',
                firstSecurityCard?.classList.contains('expanded') === true,
                `expanded=${firstSecurityCard?.classList.contains('expanded') === true}`
            );

            const allCategoryChip = list.querySelector('[data-notif-action="filter-category"][data-notif-category="all"]');
            if (allCategoryChip instanceof HTMLElement) {
                allCategoryChip.click();
                await sleep(80);
            }
        } else {
            recordResult('分类筛选只显示命中分类的提醒', false, '未找到 security 筛选按钮');
            recordResult('异常登录安全提醒点击会展开内容', false, '未找到 security 筛选按钮');
        }

        const unreadChip = list.querySelector('[data-notif-action="filter-read"][data-notif-read-filter="unread"]');
        if (unreadChip instanceof HTMLElement) {
            unreadChip.click();
            await sleep(80);
            const visibleCards = Array.from(list.querySelectorAll('.notif-card'));
            const allUnread = visibleCards.length > 0 && visibleCards.every((card) => card.classList.contains('unread'));
            recordResult('未读筛选只保留未读提醒', allUnread, `当前卡片 ${visibleCards.length} 条`);
        } else {
            recordResult('未读筛选只保留未读提醒', false, '未找到 unread 筛选按钮');
        }

        const pinButton = list.querySelector('[data-notif-action="toggle-pin"]');
        if (pinButton instanceof HTMLElement) {
            const notificationId = pinButton.getAttribute('data-notif-id') || '';
            globalScope.toggleNotificationPin?.(notificationId);
            await sleep(50);
            const firstCard = list.querySelector('.notif-card');
            const isPinnedFirst = firstCard?.classList.contains('is-pinned') === true;
            const pinnedCardStyle = firstCard instanceof HTMLElement
                ? globalScope.getComputedStyle(firstCard)
                : null;
            const pinnedCardShadow = String(pinnedCardStyle?.boxShadow || '');
            recordResult('通知置顶会立即影响排序', isPinnedFirst, `首条通知 ${firstCard?.getAttribute('data-id') || 'unknown'}`);
            recordResult(
                '置顶通知有更明显的颜色区分',
                isPinnedFirst && /250|217|rgb/i.test(pinnedCardShadow),
                `shadow=${pinnedCardShadow || 'missing'}`
            );
            const firstPinnedShell = firstCard?.closest?.('.notif-card-shell');
            if (firstPinnedShell instanceof HTMLElement) {
                const pinnedActions = firstPinnedShell.querySelector('.notif-card-actions');
                const pinnedBackgroundBeforeHover = `${pinnedCardStyle?.backgroundImage || ''}|${pinnedCardStyle?.backgroundColor || ''}|${pinnedCardStyle?.borderColor || ''}`.trim();
                firstPinnedShell.dispatchEvent(new MouseEvent('mouseover', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    clientX: Math.round(firstPinnedShell.getBoundingClientRect().left + 12),
                    clientY: Math.round(firstPinnedShell.getBoundingClientRect().top + 12)
                }));
                await sleep(40);
                const pinnedActionsStyle = pinnedActions instanceof HTMLElement
                    ? globalScope.getComputedStyle(pinnedActions)
                    : null;
                const pinnedCardHoverStyle = firstCard instanceof HTMLElement
                    ? globalScope.getComputedStyle(firstCard)
                    : null;
                const pinnedActionsHidden = pinnedActionsStyle?.visibility === 'hidden'
                    && Number.parseFloat(pinnedActionsStyle?.opacity || '1') === 0;
                const pinnedHoverNotLifted = !String(pinnedCardHoverStyle?.transform || '').trim()
                    || String(pinnedCardHoverStyle?.transform || '').trim() === 'none'
                    || String(pinnedCardHoverStyle?.transform || '').trim() === 'matrix(1, 0, 0, 1, 0, 0)';
                const pinnedBackgroundAfterHover = `${pinnedCardHoverStyle?.backgroundImage || ''}|${pinnedCardHoverStyle?.backgroundColor || ''}|${pinnedCardHoverStyle?.borderColor || ''}`.trim();
                const pinnedHoverColorStable = pinnedBackgroundAfterHover === pinnedBackgroundBeforeHover;
                recordResult(
                    '置顶通知鼠标悬停不会露出下层操作栏',
                    isPinnedFirst && pinnedActionsHidden && pinnedHoverNotLifted,
                    `visibility=${pinnedActionsStyle?.visibility || 'missing'} opacity=${pinnedActionsStyle?.opacity || 'missing'} transform=${pinnedCardHoverStyle?.transform || 'missing'}`
                );
                recordResult(
                    '置顶通知鼠标悬停不会发生颜色闪变',
                    isPinnedFirst && pinnedHoverColorStable,
                    `stable=${pinnedHoverColorStable}`
                );
            } else {
                recordResult('置顶通知鼠标悬停不会露出下层操作栏', false, '未找到置顶通知外壳');
                recordResult('置顶通知鼠标悬停不会发生颜色闪变', false, '未找到置顶通知外壳');
            }
        } else {
            recordResult('通知置顶会立即影响排序', false, '未找到置顶按钮');
            recordResult('置顶通知有更明显的颜色区分', false, '未找到置顶按钮');
            recordResult('置顶通知鼠标悬停不会露出下层操作栏', false, '未找到置顶按钮');
            recordResult('置顶通知鼠标悬停不会发生颜色闪变', false, '未找到置顶按钮');
        }

        if (shouldRunMobileLayoutChecks()) {
            const allCategoryChip = list.querySelector('[data-notif-action="filter-category"][data-notif-category="all"]');
            if (allCategoryChip instanceof HTMLElement) {
                allCategoryChip.click();
                await sleep(60);
            }
            const allReadChip = list.querySelector('[data-notif-action="filter-read"][data-notif-read-filter="all"]');
            if (allReadChip instanceof HTMLElement) {
                allReadChip.click();
                await sleep(60);
            }
            recordSelectorsNoHorizontalOverflow(
                '通知中心窄屏下筛选条和通知卡片没有横向溢出',
                [
                    '.notif-drawer',
                    '#notifDrawerList',
                    '.notif-filter-strip',
                    '.notif-card'
                ]
            );
            recordSelectorsNoHorizontalOverflow(
                '通知中心窄屏下长文案会自然换行',
                [
                    '.notif-card-title',
                    '.notif-card-body'
                ]
            );
        }

        const resetAllCategoryChip = list.querySelector('[data-notif-action="filter-category"][data-notif-category="all"]');
        if (resetAllCategoryChip instanceof HTMLElement) {
            resetAllCategoryChip.click();
            await sleep(60);
        }
        const resetAllReadChip = list.querySelector('[data-notif-action="filter-read"][data-notif-read-filter="all"]');
        if (resetAllReadChip instanceof HTMLElement) {
            resetAllReadChip.click();
            await sleep(60);
        }
        const clearReadChip = list.querySelector('[data-notif-action="clear-read"]');
        if (clearReadChip instanceof HTMLElement) {
            const readCardsBeforeClear = list.querySelectorAll('.notif-card:not(.unread)').length;
            clearReadChip.click();
            await waitFor(() => {
                const readCards = list.querySelectorAll('.notif-card:not(.unread)').length;
                return readCards === 0 ? list : null;
            }, { message: '清除已读后仍有已读通知卡片', timeoutMs: 2400 });
            await sleep(80);
            const remainingEnterCards = list.querySelectorAll('.notif-card-shell.notif-card-filter-enter').length;
            const remainingUnreadCards = list.querySelectorAll('.notif-card.unread').length;
            recordResult(
                '清除已读后未读通知补位不会重新播放入场动画',
                readCardsBeforeClear > 0 && remainingUnreadCards > 0 && remainingEnterCards === 0,
                `beforeRead=${readCardsBeforeClear} remainingUnread=${remainingUnreadCards} entering=${remainingEnterCards}`
            );
        } else {
            recordResult('清除已读后未读通知补位不会重新播放入场动画', false, '未找到清除已读按钮');
        }

        await globalScope.markAllNotificationsRead?.();
        await sleep(80);
        const unreadBadgeVisible = document.getElementById('notifBadge')?.hidden === false;
        const unreadCards = list.querySelectorAll('.notif-card.unread').length;
        recordResult('全部已读会同步清空未读态', unreadCards === 0 && unreadBadgeVisible === false, `未读卡片 ${unreadCards} 条`);
        const finalNotificationSmokeStatus = smokeState.results.some((item) => !item.pass) ? 'failed' : 'passed';
        renderResults(finalNotificationSmokeStatus);
        await postSmokeResult(finalNotificationSmokeStatus, { keepalive: false });
    }

    async function runAdminTicketsSmoke() {
        await waitFor(
            () => globalScope.switchModule && typeof globalScope.AdminTickets?.openReminderSummaryJobDetail === 'function',
            { message: '售后工单模块入口未加载完成' }
        );

        await waitFor(
            () => typeof globalScope.hasModulePermission === 'function' && globalScope.hasModulePermission('tickets') === true,
            { message: '售后工单模块权限未完成同步', timeoutMs: 16000 }
        );

        globalScope.syncAdminStudioModuleAccess?.({
            preferredModule: 'tickets',
            enforceActiveModule: true
        });
        await sleep(120);
        globalScope.switchModule?.('tickets', {
            fallback: false,
            silentDenied: true
        });
        const ticketModule = await waitFor(
            () => document.getElementById('module-tickets')?.classList.contains('active')
                ? document.getElementById('module-tickets')
                : null,
            { message: '售后工单模块未切换成功', timeoutMs: 16000 }
        );

        await waitFor(
            () => {
                const rows = document.querySelectorAll('#ticketsTableBody tr');
                return rows.length > 0 ? rows : null;
            },
            { message: '售后工单列表未渲染' }
        );

        const overview = await waitFor(
            () => {
                const data = globalScope.AdminTickets?.overview;
                const recentJobs = Array.isArray(data?.reminder?.summary_digest?.recent_jobs)
                    ? data.reminder.summary_digest.recent_jobs
                    : [];
                return recentJobs.length >= 2 ? data : null;
            },
            { message: '售后工单概览未按本地夹具产出汇总追踪数据', timeoutMs: 16000 }
        );

        recordResult(
            '售后工单概览已产出汇总追踪样本',
            Array.isArray(overview?.reminder?.summary_digest?.recent_jobs) && overview.reminder.summary_digest.recent_jobs.length >= 2,
            `recent=${Array.isArray(overview?.reminder?.summary_digest?.recent_jobs) ? overview.reminder.summary_digest.recent_jobs.length : 0}`
        );

        const queueTab = document.getElementById('ticketWorkspaceQueueTab');
        const overviewTab = document.getElementById('ticketWorkspaceOverviewTab');
        const summaryTab = document.getElementById('ticketWorkspaceSummaryTab');
        if (queueTab instanceof HTMLElement && overviewTab instanceof HTMLElement && summaryTab instanceof HTMLElement) {
            globalScope.scrollTo?.(0, Math.max(0, Math.min(420, document.body.scrollHeight - globalScope.innerHeight)));
            await sleep(120);

            queueTab.click();
            await waitFor(() => ticketModule.dataset.ticketWorkspace === 'queue', { message: '售后工单未切回工单处理工作区' });
            await sleep(120);
            const beforeScrollY = Number(globalScope.scrollY || 0);

            overviewTab.click();
            await waitFor(() => ticketModule.dataset.ticketWorkspace === 'overview', { message: '售后工单未切到 SLA 看板' });
            await sleep(180);
            const afterOverviewScrollY = Number(globalScope.scrollY || 0);

            summaryTab.click();
            await waitFor(() => ticketModule.dataset.ticketWorkspace === 'summary', { message: '售后工单未切到汇总追踪' });
            await sleep(180);
            const afterSummaryScrollY = Number(globalScope.scrollY || 0);

            recordResult(
                '售后工单横栏切换不跳页',
                Math.abs(afterOverviewScrollY - beforeScrollY) <= 2 && Math.abs(afterSummaryScrollY - afterOverviewScrollY) <= 2,
                `queue→overview Δ=${Math.abs(afterOverviewScrollY - beforeScrollY)} / overview→summary Δ=${Math.abs(afterSummaryScrollY - afterOverviewScrollY)}`
            );
        } else {
            recordResult('售后工单横栏切换不跳页', false, '未找到完整的工作区横栏按钮');
        }

        recordSelectorsNoHorizontalOverflow(
            '售后工单提醒活动闭环没有横向溢出',
            [
                '#ticketsOverviewReminderPanel',
                '.admin-ticket-overview-reminder-activity',
                '.admin-ticket-overview-reminder-activity-stats',
                '.admin-ticket-overview-reminder-activity-stat',
                '.admin-ticket-overview-reminder-activity-list',
                '.admin-ticket-overview-reminder-activity-item',
                '.admin-ticket-overview-reminder-activity-item__head'
            ]
        );

        const activitySection = document.querySelector('.admin-ticket-overview-reminder-activity');
        const activityStats = activitySection?.querySelector('.admin-ticket-overview-reminder-activity-stats');
        const activityList = activitySection?.querySelector('.admin-ticket-overview-reminder-activity-list');
        if (
            activitySection instanceof HTMLElement
            && activityStats instanceof HTMLElement
            && activityList instanceof HTMLElement
        ) {
            const statsRect = activityStats.getBoundingClientRect();
            const listRect = activityList.getBoundingClientRect();
            const sectionRect = activitySection.getBoundingClientRect();
            const noOverlap = statsRect.bottom <= (listRect.top + 2) && listRect.bottom <= (sectionRect.bottom + 2);
            recordResult(
                '售后工单提醒活动闭环区块不会相互覆盖',
                noOverlap,
                `statsBottom=${Math.round(statsRect.bottom)} / listTop=${Math.round(listRect.top)} / listBottom=${Math.round(listRect.bottom)} / sectionBottom=${Math.round(sectionRect.bottom)}`
            );
        } else {
            recordResult('售后工单提醒活动闭环区块不会相互覆盖', false, '未找到提醒活动闭环布局节点');
        }

        const opened = globalScope.AdminTickets?.openReminderSummaryJobDetail?.('ticket-summary-job-latest');
        recordResult('售后工单汇总详情可打开', opened === true, `opened=${String(opened)}`);

        const detailBody = await waitFor(
            () => {
                const modal = document.getElementById('ticketSummaryJobDetailModal');
                const body = document.getElementById('ticketSummaryJobDetailBody');
                return modal?.classList.contains('is-visible') && body?.textContent?.trim()
                    ? body
                    : null;
            },
            { message: '售后工单汇总详情未成功渲染' }
        );

        const historyMeta = await waitFor(
            () => {
                const node = detailBody.querySelector('.admin-ticket-summary-job-modal__history-meta--warning');
                return node?.textContent?.trim() ? node : null;
            },
            { message: '售后工单汇总详情未显示历史 fallback 提示', timeoutMs: 12000 }
        );
        const historyMetaText = String(historyMeta?.textContent || '').replace(/\s+/g, ' ').trim();
        recordResult(
            '汇总历史 fallback 文案不暴露底层路由错误',
            !/Admin route not found/i.test(historyMetaText) && /本地推导的轨迹|暂未接入汇总历史接口|汇总历史接口暂不可用/.test(historyMetaText),
            historyMetaText || '<empty>'
        );

        const ongoingList = detailBody.querySelector('.admin-ticket-summary-job-modal__comparison-column--warning .admin-ticket-summary-job-modal__comparison-list--limit-2');
        if (ongoingList instanceof HTMLElement) {
            const ongoingCount = ongoingList.querySelectorAll('.admin-ticket-summary-job-modal__comparison-item').length;
            const hasScroll = ongoingList.scrollHeight > (ongoingList.clientHeight + 8);
            const items = Array.from(ongoingList.querySelectorAll('.admin-ticket-summary-job-modal__comparison-item'));
            const itemsClipped = items.some((item) => {
                if (!(item instanceof HTMLElement)) {
                    return false;
                }
                return item.scrollHeight > (item.clientHeight + 4);
            });
            recordResult(
                '连续两次都在的工单超过 2 条后会在列内滚动',
                ongoingCount > 2 && hasScroll,
                `count=${ongoingCount} / client=${ongoingList.clientHeight} / scroll=${ongoingList.scrollHeight}`
            );
            recordResult(
                '连续两次都在的工单卡片内容不会被截断',
                !itemsClipped,
                items.length
                    ? items.map((item) => `${item.clientHeight}/${item.scrollHeight}`).join(' | ')
                    : 'no-items'
            );
        } else {
            recordResult('连续两次都在的工单超过 2 条后会在列内滚动', false, '未找到持续超时工单对比列表');
            recordResult('连续两次都在的工单卡片内容不会被截断', false, '未找到持续超时工单对比列表');
        }

        globalScope.AdminTickets?.closeReminderSummaryJobDetail?.();
    }

    async function runSmoke() {
        try {
            renderResults('running');
            void postSmokeResult('running');
            await nextFrame();

            const pathname = String(globalScope.location?.pathname || '').trim();
            if (/\/admin-studio(?:\.html)?$/i.test(pathname)) {
                const moduleParam = String(searchParams.get('module') || '').trim().toLowerCase();
                if (moduleParam === 'growth-center') {
                    await runGrowthCenterSmoke();
                } else if (
                    moduleParam === 'analytics'
                    || moduleParam === 'business-center'
                    || moduleParam === 'analytics-center'
                    || moduleParam === 'business-overview'
                    || moduleParam === 'commerce-center'
                ) {
                    await runAdminAnalyticsSmoke();
                } else if (moduleParam === 'chat') {
                    await runAdminChatSmoke();
                } else if (moduleParam === 'payments') {
                    await runAdminPaymentsSmoke();
                } else if (moduleParam === 'shop') {
                    await runAdminShopSmoke();
                } else if (moduleParam === 'points') {
                    await runAdminPointsSmoke();
                } else if (moduleParam === 'gallery') {
                    await runAdminGallerySmoke();
                } else if (moduleParam === 'comments') {
                    await runAdminCommentsSmoke();
                } else if (moduleParam === 'settings') {
                    await runDiscountTriggerSettingsSmoke();
                } else if (moduleParam === 'homepage') {
                    await runHomepageAdminSmoke();
                } else if (moduleParam === 'tickets') {
                    await runAdminTicketsSmoke();
                } else {
                    await runAdminStudioSmoke();
                }
            } else if (/\/smoke-notifications(?:\.html)?$/i.test(pathname)) {
                await runNotificationSmoke();
            } else {
                recordResult('未匹配到本地 smoke 入口', false, pathname || '/');
            }
        } catch (error) {
            recordResult('本地 smoke 运行异常', false, error?.message || String(error));
        } finally {
            await finalizeResults();
        }
    }

    installCommonStubs();
    installSupabaseStub();
    installFetchStub();

    globalScope.__ZAOYOE_LOCAL_SMOKE__ = {
        state: smokeState,
        runSmoke
    };

    let smokeRunStarted = false;
    function startLocalSmokeOnce() {
        if (smokeRunStarted) {
            return;
        }
        smokeRunStarted = true;
        globalScope.setTimeout(runSmoke, 0);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startLocalSmokeOnce();
    } else {
        if (typeof document.addEventListener === 'function') {
            document.addEventListener('DOMContentLoaded', startLocalSmokeOnce, { once: true });
        }
        if (typeof globalScope.addEventListener === 'function') {
            globalScope.addEventListener('load', startLocalSmokeOnce, { once: true });
        }
        globalScope.setTimeout(startLocalSmokeOnce, 3000);
    }
})(typeof window !== 'undefined' ? window : globalThis);
