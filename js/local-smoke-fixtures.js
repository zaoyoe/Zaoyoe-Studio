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
                title: '待办已认领',
                content: '支付异常会话已被林支援认领，当前无需重复跟进。',
                type: 'success',
                scope: 'admin_personal',
                category: 'assignment',
                is_read: true,
                created_at: '2026-03-31T07:35:00+08:00'
            }
        ],
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
                        id: 'ticket',
                        business_type: 'ticket',
                        enabled: false,
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
                        sender_email: 'ops@zaoyoe.com',
                        subject_prefix: '[Zaoyoe告警]',
                        recipient_preview: 'ops@zaoyoe.com'
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
                price_paid: 128,
                snapshot_product_name: '春季体验套餐 · 含人工核对与延迟发货补偿权益',
                refund_status: '',
                delivery_status: 'processing'
            },
            {
                id: 'SHOP-20260331-002',
                user_id: '00000000-0000-4000-8000-000000000002',
                created_at: '2026-03-31T06:50:00+08:00',
                price_paid: 68,
                snapshot_product_name: '月度会员',
                refund_status: '',
                delivery_status: 'delivered'
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
        abExperiments: [
            {
                id: 'exp-smoke-analytics-1',
                name: 'Analytics Funnel Copy',
                description: '本地 smoke 用于校验 analytics AI 分栏与实验卡片渲染。',
                status: 'running',
                target_metric: 'unlock_success',
                variants: [
                    { name: 'control', weight: 50 },
                    { name: 'variant-b', weight: 50 }
                ],
                created_at: '2026-03-31T08:30:00+08:00'
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

    async function postSmokeResult(status = 'running') {
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
                keepalive: true,
                body: JSON.stringify(buildSmokeResultPayload(status))
            });
        } catch (_) {
            // ignore best-effort result reporting failures in local smoke mode
        }
    }

    function finalizeResults() {
        const finalStatus = smokeState.results.some((item) => !item.pass) ? 'failed' : 'passed';
        renderResults(finalStatus);
        void postSmokeResult(finalStatus);

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
                smokeState.runtimeErrors.push(`error:${String(message)}`);
            });

            globalScope.addEventListener('unhandledrejection', (event) => {
                const message = event?.reason?.message || event?.reason || 'Unhandled rejection';
                smokeState.runtimeErrors.push(`rejection:${String(message)}`);
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

    function getSmokeTableStateKey(table = '') {
        const tableMap = {
            system_notifications: 'notificationRecords',
            chat_messages: 'chatMessages',
            profiles: 'profiles',
            shop_products: 'shopProducts',
            shop_categories: 'shopCategories',
            shop_inventory: 'shopInventory',
            shop_orders: 'shopOrders',
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
            ab_experiments: 'abExperiments',
            blocked_users: 'blockedUsers',
            block_history: 'blockHistory',
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
                return Promise.resolve(execute()).then(resolve, reject);
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

    function buildSmokeAnalyticsConversionFunnel(site = 'all', days = 7) {
        const scale = Math.max(1, clampSmokeAnalyticsDays(days, 7) / 7);
        const visitors = Math.round(120 * scale);
        const viewers = Math.round(visitors * 0.68);
        const unlockers = Math.round(visitors * 0.34);
        return [
            { step_name: '访问用户', step_order: 1, user_count: visitors, conversion_rate: 100, is_proxy_metric: true },
            { step_name: '内容浏览', step_order: 2, user_count: viewers, conversion_rate: roundSmokeMetric((viewers / visitors) * 100, 1), is_proxy_metric: true },
            { step_name: '内容解锁', step_order: 3, user_count: unlockers, conversion_rate: roundSmokeMetric((unlockers / visitors) * 100, 1), is_proxy_metric: true }
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

    function buildSmokeExperimentResults() {
        return [
            { variant_name: 'control', user_count: 120, conversion_count: 31, conversion_rate: 25.8 },
            { variant_name: 'variant-b', user_count: 118, conversion_count: 39, conversion_rate: 33.1 }
        ];
    }

    function buildSmokeExperimentResultsV2() {
        return [
            { dimension_type: 'overall', dimension_value: 'all', variant_name: 'control', assigned_user_count: 120, exposure_user_count: 96, conversion_count: 31, conversion_rate: 32.3 },
            { dimension_type: 'overall', dimension_value: 'all', variant_name: 'variant-b', assigned_user_count: 118, exposure_user_count: 102, conversion_count: 39, conversion_rate: 38.2 },
            { dimension_type: 'site', dimension_value: 'cn', variant_name: 'control', assigned_user_count: 58, exposure_user_count: 58, conversion_count: 18, conversion_rate: 31.0 },
            { dimension_type: 'site', dimension_value: 'cn', variant_name: 'variant-b', assigned_user_count: 61, exposure_user_count: 61, conversion_count: 25, conversion_rate: 41.0 },
            { dimension_type: 'site', dimension_value: 'intl', variant_name: 'control', assigned_user_count: 38, exposure_user_count: 38, conversion_count: 13, conversion_rate: 34.2 },
            { dimension_type: 'site', dimension_value: 'intl', variant_name: 'variant-b', assigned_user_count: 41, exposure_user_count: 41, conversion_count: 14, conversion_rate: 34.1 },
            { dimension_type: 'placement', dimension_value: 'prompt_unlock_button', variant_name: 'control', assigned_user_count: 54, exposure_user_count: 54, conversion_count: 17, conversion_rate: 31.5 },
            { dimension_type: 'placement', dimension_value: 'prompt_unlock_button', variant_name: 'variant-b', assigned_user_count: 57, exposure_user_count: 57, conversion_count: 23, conversion_rate: 40.4 },
            { dimension_type: 'placement', dimension_value: 'wallet_custom_recharge_button', variant_name: 'control', assigned_user_count: 42, exposure_user_count: 42, conversion_count: 14, conversion_rate: 33.3 },
            { dimension_type: 'placement', dimension_value: 'wallet_custom_recharge_button', variant_name: 'variant-b', assigned_user_count: 45, exposure_user_count: 45, conversion_count: 16, conversion_rate: 35.6 }
        ];
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

                if (name === 'get_conversion_funnel') {
                    return {
                        data: deepClone(buildSmokeAnalyticsConversionFunnel(safeParams.p_site, safeParams.p_days)),
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

                if (name === 'get_experiment_variant') {
                    return {
                        data: { variant_name: 'control', assigned: true },
                        error: null
                    };
                }

                if (name === 'get_experiment_results') {
                    return {
                        data: deepClone(buildSmokeExperimentResults()),
                        error: null
                    };
                }

                if (name === 'get_experiment_results_v2') {
                    return {
                        data: deepClone(buildSmokeExperimentResultsV2()),
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
                : '';

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

            if (url.pathname === '/api/admin/settings/ops-alert-health') {
                return createResponse(deepClone(smokeState.opsAlertHealthPayload));
            }

            if (url.pathname === '/api/admin/settings/ops-alert-monitor') {
                return createResponse(deepClone(smokeState.opsAlertMonitorPayload));
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

            if (url.pathname === '/api/admin/comments/summary') {
                return createResponse({
                    success: true,
                    site: normalizeSmokeCommentsSite(url.searchParams.get('site') || 'all'),
                    summary: deepClone(buildSmokeCommentsSummary(url.searchParams.get('site') || 'all'))
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
                    const row = rows.find((item) => item.id === body.id && item.site === site && item.section === body.section);
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
                        row: deepClone(row)
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

        await runUserModalSmoke();
        await runExperimentModalSmoke();
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

        await waitFor(
            () => {
                globalScope.switchModule?.('analytics');
                return document.getElementById('module-analytics')?.classList.contains('active')
                    ? document.getElementById('module-analytics')
                    : null;
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
            () => globalScope.reloadAnalyticsDashboard({ reason: 'smoke-analytics-initial', includeExperiments: false }),
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
                `Analytics 概览 KPI 未完成渲染 (active=${document.getElementById('module-analytics')?.classList.contains('active') === true ? 'yes' : 'no'}, dau=${String(document.getElementById('kpiDauValue')?.textContent || '').trim() || '<empty>'}, reloads=${smokeState.analyticsReloadCalls.length}, rpcCalls=${smokeState.analyticsRpcCallCount}, smokeClient=${globalScope.supabaseClient?.__localSmokeClient === true ? 'yes' : 'no'}, overviewSite=${smokeState.analyticsRpcLastParams.get_overview_stats_with_trend?.p_site || '<missing>'}, topDays=${smokeState.analyticsRpcLastParams.get_content_top?.p_days || '<missing>'}, runtime=${smokeState.runtimeErrors.slice(-6).join(' | ') || '<none>'})`
            );
        }
        recordResult('Analytics 概览 KPI 已渲染', /^\d/.test(kpiValue), `dau=${kpiValue}`);

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
            { message: 'Analytics 代理漏斗提示未出现', timeoutMs: 20000 }
        );
        recordResult(
            'Analytics 代理漏斗会显示口径提示',
            /代理口径/.test(String(proxyHint?.textContent || '')),
            String(proxyHint?.textContent || '').trim().slice(0, 64)
        );

        const reloadCountBeforeRange = smokeState.analyticsReloadCalls.length;
        const rangeTrigger = document.querySelector('[data-admin-action="analytics-toggle-range-dropdown"]');
        const presetThirtyDays = document.querySelector('.preset-btn[data-range="30"][data-admin-action="analytics-select-preset-range"]');
        if (rangeTrigger instanceof HTMLElement && presetThirtyDays instanceof HTMLElement) {
            rangeTrigger.click();
            await sleep(80);
            presetThirtyDays.click();
            await waitFor(
                () => String(document.getElementById('dateRangeLabel')?.textContent || '').includes('30'),
                { message: 'Analytics 日期标签未切到 30 天' }
            );
            await waitFor(
                () => Number(smokeState.analyticsRpcLastParams.get_content_top?.p_days) === 30,
                { message: 'Analytics 热门内容 RPC 未收到 30 天窗口参数' }
            );

            const topContentText = String(document.getElementById('topContentList')?.textContent || '');
            const topContentMeta = String(document.getElementById('topContentMeta')?.textContent || '').trim();
            recordResult(
                'Analytics 日期预设会更新整页范围标签',
                String(document.getElementById('dateRangeLabel')?.textContent || '').includes('30'),
                String(document.getElementById('dateRangeLabel')?.textContent || '').trim()
            );
            recordResult(
                'Analytics 日期切换会把窗口参数传给关键 RPC',
                smokeState.analyticsReloadCalls.length > reloadCountBeforeRange
                    && Number(smokeState.analyticsRpcLastParams.get_content_top?.p_days) === 30
                    && Number(smokeState.analyticsRpcLastParams.get_redemption_funnel?.p_days) === 30,
                `reload+${smokeState.analyticsReloadCalls.length - reloadCountBeforeRange} / top=${smokeState.analyticsRpcLastParams.get_content_top?.p_days || 'n/a'} / funnel=${smokeState.analyticsRpcLastParams.get_redemption_funnel?.p_days || 'n/a'}`
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

        globalScope.switchAnalyticsTab?.('monetization');
        await sleep(80);
        const pointsTabActive = document.getElementById('analytics-tab-monetization')?.classList.contains('active') === true;
        const pointsIncome = String(document.getElementById('kpiPointsInValue')?.textContent || '').trim();
        recordResult(
            'Analytics 分栏切到积分与交易后仍保留关键指标',
            pointsTabActive && pointsIncome && pointsIncome !== '--',
            `active=${pointsTabActive} / income=${pointsIncome || '<empty>'}`
        );

        globalScope.switchAnalyticsTab?.('verify');
        await sleep(80);
        const verifyTabActive = document.getElementById('analytics-tab-verify')?.classList.contains('active') === true;
        const verifyRequests = String(document.getElementById('kpiVerifyRequestsValue')?.textContent || '').trim();
        recordResult(
            'Analytics 验证服务分栏会渲染业务摘要',
            verifyTabActive && verifyRequests && verifyRequests !== '--',
            `active=${verifyTabActive} / requests=${verifyRequests || '<empty>'}`
        );

        globalScope.switchAnalyticsTab?.('growth');
        await sleep(80);
        const growthTabActive = document.getElementById('analytics-tab-growth')?.classList.contains('active') === true;
        const growthMessages = String(document.getElementById('kpiGrowthMessagesValue')?.textContent || '').trim();
        recordResult(
            'Analytics 社区与裂变分栏会渲染业务摘要',
            growthTabActive && growthMessages && growthMessages !== '--',
            `active=${growthTabActive} / messages=${growthMessages || '<empty>'}`
        );

        const advancedEntry = document.querySelector('.analytics-advanced-entry[data-analytics-destination="analytics-ai"]');
        const advancedNavButton = document.querySelector('#analyticsTabsNav .admin-tab[data-tab="ai"]');
        recordResult(
            'Analytics 高级分析已移出主流程',
            !advancedEntry && !advancedNavButton,
            `entry=${advancedEntry instanceof HTMLElement ? 'yes' : 'no'} / nav=${advancedNavButton ? 'yes' : 'no'}`
        );

        globalScope.switchAnalyticsTab?.('overview');
        await sleep(60);

        const channelCountBeforeSite = smokeState.analyticsRealtimeChannelsCreated;
        const reloadCountBeforeSite = smokeState.analyticsReloadCalls.length;
        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(180);
        await waitFor(
            () => document.querySelector('.site-selector-label')?.textContent?.trim() === 'EN',
            { message: 'Analytics 站点标签未切到 EN' }
        );
        await waitFor(
            () => smokeState.analyticsRpcLastParams.get_content_top?.p_site === 'intl',
            { message: 'Analytics 站点切换后未透传 site=intl 到内容榜 RPC' }
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

        globalScope.switchModule?.('analytics');
        await waitFor(
            () => document.getElementById('module-analytics')?.classList.contains('active')
                ? document.getElementById('module-analytics')
                : null,
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

    async function runHomepageAdminSmoke() {
        await waitFor(() => globalScope.switchModule && globalScope.AdminSiteFilter?.select, { message: '首页模块入口未加载完成' });
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
            () => document.querySelector('[data-homepage-visibility="gallery"]'),
            { message: '首页分栏显隐卡片未渲染' }
        );
        recordResult(
            '首页分栏显隐卡片已从 homepage_config 渲染',
            galleryVisibilityInput instanceof HTMLInputElement,
            galleryVisibilityInput instanceof HTMLInputElement ? 'gallery visibility rendered' : 'missing gallery visibility input'
        );

        const heroSaveButton = document.querySelector('.hp-section-view[data-hp-view="hero"] [data-admin-action="homepage-save-section"]');
        if (heroSaveButton instanceof HTMLElement) {
            heroTitleInput.value = 'CN Hero 标题（smoke 已保存）';
            heroTitleInput.dispatchEvent(new Event('input', { bubbles: true }));
            heroSaveButton.click();

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

        globalScope.HomepageAdmin?.switchSection?.('guestbook');
        await sleep(60);
        const footerVisibilityInput = await waitFor(
            () => document.querySelector('[data-homepage-visibility="footer"]'),
            { message: '页脚显隐开关未渲染' }
        );
        if (footerVisibilityInput instanceof HTMLInputElement) {
            footerVisibilityInput.click();
            await waitFor(
                () => {
                    const footerRow = getTableRows('homepage_config').find((row) => row.site === 'cn' && row.section === 'footer');
                    return footerRow?.is_visible === false ? footerRow : null;
                },
                { message: '页脚显隐未保存到 homepage_config' }
            );
            recordResult(
                '页脚显隐也通过 homepage_config 保存',
                getTableRows('homepage_config').some((row) => row.site === 'cn' && row.section === 'footer' && row.is_visible === false),
                'cn footer hidden'
            );
        } else {
            recordResult('页脚显隐也通过 homepage_config 保存', false, '未找到 footer visibility input');
        }

        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(160);
        globalScope.HomepageAdmin?.switchSection?.('hero');
        await sleep(80);

        const intlHeroValue = document.getElementById('hp-hero-title')?.value || '';
        const intlFooterVisible = document.querySelector('[data-homepage-visibility="footer"]')?.checked === true;
        recordResult(
            '切换站点后首页配置不会串站',
            intlHeroValue === 'INTL Hero Title' && intlFooterVisible === false,
            `hero=${intlHeroValue || '<empty>'} / footer=${intlFooterVisible ? 'visible' : 'hidden'}`
        );
    }

    async function runAdminGallerySmoke() {
        await waitFor(
            () => globalScope.switchModule && globalScope.switchView && globalScope.AdminSiteFilter?.select && typeof globalScope.editPrompt === 'function',
            { message: '画廊模块入口未加载完成' }
        );

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
                && promptCard?.querySelector('.admin-card-subtitle')
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

        await globalScope.editPrompt?.('prompt-cn-1');
        const titleZhInput = await waitFor(
            () => {
                const input = document.getElementById('promptTitleZh');
                return input instanceof HTMLInputElement && String(input.value || '').trim() ? input : null;
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
            titleZhInput.value = '';
            titleZhInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleEnInput.value = 'CN Prompt Card (smoke updated)';
            titleEnInput.dispatchEvent(new Event('input', { bubbles: true }));

            const form = document.getElementById('promptForm');
            form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

            await waitFor(
                () => {
                    const row = getTableRows('prompts').find((item) => item.id === 'prompt-cn-1');
                    return row?.title_zh === '' && row?.title_en === 'CN Prompt Card (smoke updated)' ? row : null;
                },
                { message: '画廊双语字段保存未写回 prompts 表' }
            );

            recordResult(
                'Gallery 编辑保存会显式写回双语字段',
                getTableRows('prompts').some((item) => item.id === 'prompt-cn-1' && item.title_zh === '' && item.title_en === 'CN Prompt Card (smoke updated)'),
                JSON.stringify(getTableRows('prompts').find((item) => item.id === 'prompt-cn-1') || {})
            );
        } else {
            recordResult('Gallery 编辑保存会显式写回双语字段', false, '未找到英文标题输入框');
        }

        globalScope.AdminSiteFilter.select('intl');
        await nextFrame();
        await sleep(160);
        await globalScope.editPrompt?.('prompt-intl-1');

        const intlTitleEn = await waitFor(
            () => {
                const input = document.getElementById('promptTitleEn');
                return input instanceof HTMLInputElement && String(input.value || '').trim() ? input : null;
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
        await waitFor(
            () => globalScope.switchModule && globalScope.switchPointsView && globalScope.AdminSiteFilter?.select,
            { message: '兑换码/套餐模块入口未加载完成' }
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
            () => document.getElementById('points-view-generate')?.classList.contains('active')
                ? document.getElementById('generateCodesForm')
                : null,
            { message: '兑换码生成视图未切换成功' }
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

            await waitFor(
                () => getTableRows('redemption_batches').some((row) => row.name === 'Smoke 批次生成' && normalizeSmokeSite(row.site) === 'cn'),
                { message: '兑换码生成未通过 points manage handler 创建批次' }
            );

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

        const firstBatchRow = document.querySelector('#batchesTableBody tr[data-batch-id]');
        if (firstBatchRow instanceof HTMLElement) {
            firstBatchRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            await waitFor(
                () => document.querySelector('.codes-modal .codes-table')
                    ? document.querySelector('.codes-modal .codes-table')
                    : null,
                { message: '批次详情未通过 points batches handler 加载兑换码' }
            );

            recordResult(
                '批次详情会通过 points batches handler 加载兑换码',
                Boolean(document.querySelector('.codes-modal .codes-table')),
                `rows=${document.querySelectorAll('.codes-modal .codes-table tbody tr').length}`
            );
        } else {
            recordResult('批次详情会通过 points batches handler 加载兑换码', false, '未找到可点击的批次行');
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
        globalScope.AdminSiteFilter.select('cn');
        await nextFrame();
        await sleep(80);
        globalScope.switchModule?.('comments');

        await waitFor(
            () => document.getElementById('module-comments')?.classList.contains('active')
                ? document.getElementById('module-comments')
                : null,
            { message: '评论模块未切换成功' }
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

    async function runExperimentModalSmoke() {
        await waitFor(() => typeof globalScope.openExperimentModal === 'function', { message: 'A/B 实验弹窗入口未加载完成' });
        globalScope.openExperimentModal();

        const modal = await waitFor(
            () => {
                const node = document.getElementById('experimentModal');
                return node?.classList.contains('active') ? node : null;
            },
            { message: 'A/B 实验弹窗未能打开' }
        );

        await nextFrame();
        await sleep(60);
        modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(120);

        recordResult(
            'A/B 实验弹窗支持点击外部关闭',
            !modal.classList.contains('active'),
            modal.classList.contains('active') ? 'overlay click did not dismiss modal' : 'overlay click dismissed modal'
        );
    }

    async function runAdminChatSmoke() {
        await waitFor(() => typeof globalScope.AdminChat === 'function', { message: '客服工作台脚本未加载完成' });
        globalScope.switchModule?.('chat');

        const instance = await waitFor(
            () => globalScope.adminChatInstance && document.getElementById('sessionQueueOverview') ? globalScope.adminChatInstance : null,
            { message: '客服工作台实例未初始化' }
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
                return rows.length ? rows : null;
            },
            { message: '客服工作台快捷回复未渲染' }
        );
        const statusChips = document.querySelectorAll('#currentChatStatusChips .chat-user-status-chip');
        recordResult(
            '会话上下文与快捷回复已联动渲染',
            replyButtons.length >= 4 && statusChips.length >= 2,
            `模板 ${replyButtons.length} 个 / 状态标签 ${statusChips.length} 个`
        );

        const input = document.getElementById('adminChatInput');
        const orderReply = replyButtons.find((button) => /订单说明/.test(button.textContent || '')) || replyButtons[0];
        if (input instanceof HTMLTextAreaElement && orderReply instanceof HTMLElement) {
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
        await globalScope.initNotificationSystem();
        await waitFor(() => document.getElementById('notifBadge')?.hidden === false, { message: '通知数据未完成初始拉取' });
        globalScope.toggleNotifMenu?.();

        const list = await waitFor(() => document.getElementById('notifDrawerList'));
        await waitFor(() => list.querySelectorAll('.notif-card').length > 0 ? list : null, { message: '通知抽屉未渲染通知卡片' });

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
        } else {
            recordResult('分类筛选只显示命中分类的提醒', false, '未找到 security 筛选按钮');
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
            recordResult('通知置顶会立即影响排序', isPinnedFirst, `首条通知 ${firstCard?.getAttribute('data-id') || 'unknown'}`);
        } else {
            recordResult('通知置顶会立即影响排序', false, '未找到置顶按钮');
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

        await globalScope.markAllNotificationsRead?.();
        await sleep(80);
        const unreadBadgeVisible = document.getElementById('notifBadge')?.hidden === false;
        const unreadCards = list.querySelectorAll('.notif-card.unread').length;
        recordResult('全部已读会同步清空未读态', unreadCards === 0 && unreadBadgeVisible === false, `未读卡片 ${unreadCards} 条`);
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
                if (searchParams.get('module') === 'analytics') {
                    await runAdminAnalyticsSmoke();
                } else if (searchParams.get('module') === 'chat') {
                    await runAdminChatSmoke();
                } else if (searchParams.get('module') === 'shop') {
                    await runAdminShopSmoke();
                } else if (searchParams.get('module') === 'points') {
                    await runAdminPointsSmoke();
                } else if (searchParams.get('module') === 'gallery') {
                    await runAdminGallerySmoke();
                } else if (searchParams.get('module') === 'comments') {
                    await runAdminCommentsSmoke();
                } else if (searchParams.get('module') === 'homepage') {
                    await runHomepageAdminSmoke();
                } else if (searchParams.get('module') === 'tickets') {
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
            finalizeResults();
        }
    }

    installCommonStubs();
    installSupabaseStub();
    installFetchStub();

    globalScope.__ZAOYOE_LOCAL_SMOKE__ = {
        state: smokeState,
        runSmoke
    };

    if (document.readyState === 'complete') {
        globalScope.setTimeout(runSmoke, 0);
    } else {
        globalScope.addEventListener('load', () => {
            globalScope.setTimeout(runSmoke, 0);
        }, { once: true });
    }
})(typeof window !== 'undefined' ? window : globalThis);
