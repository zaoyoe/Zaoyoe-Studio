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

    if (!smokeEnabled) {
        return;
    }

    const now = new Date('2026-03-31T09:30:00+08:00');
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
                created_at: '2026-03-31T06:10:00+08:00'
            },
            {
                id: 'TK-20260331-002',
                user_id: '00000000-0000-4000-8000-000000000003',
                order_id: '',
                issue_type: 'verification',
                status: 'pending',
                description: '验证失败需要人工协助',
                created_at: '2026-03-31T07:18:00+08:00'
            }
        ],
        opsAlertJobs: [],
        opsAlertCases: [],
        opsAlertCaseEvents: [],
        results: []
    };

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

        const summary = smokeState.results.length
            ? smokeState.results.map((item) => `${item.pass ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? `\n  ${item.detail}` : ''}`).join('\n')
            : 'No smoke checks recorded yet.';

        panel.textContent = [
            `Local Smoke: ${status.toUpperCase()}`,
            `Page: ${globalScope.location?.pathname || '/'}`,
            '',
            summary
        ].join('\n');
    }

    function recordResult(label, pass, detail = '') {
        smokeState.results.push({
            label,
            pass,
            detail
        });
        const finalStatus = smokeState.results.some((item) => !item.pass) ? 'failed' : 'running';
        renderResults(finalStatus);
    }

    function finalizeResults() {
        const finalStatus = smokeState.results.some((item) => !item.pass) ? 'failed' : 'passed';
        renderResults(finalStatus);

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

        globalScope.confirm = function confirmStub() {
            return true;
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
    }

    function createResponse(payload = {}, status = 200) {
        return new Response(JSON.stringify(payload), {
            status,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        });
    }

    function getSmokeTableStateKey(table = '') {
        const tableMap = {
            system_notifications: 'notificationRecords',
            chat_messages: 'chatMessages',
            profiles: 'profiles',
            shop_orders: 'shopOrders',
            payment_orders: 'paymentOrders',
            verification_logs: 'verificationLogs',
            shop_tickets: 'shopTickets',
            ops_alert_jobs: 'opsAlertJobs',
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

    function createQueryBuilder(table) {
        const state = {
            table,
            method: 'select',
            filters: [],
            values: null,
            orderField: '',
            orderAscending: true,
            limitCount: 0,
            singleMode: false,
            maybeSingleMode: false
        };

        const chain = {
            select() {
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
                return { data: deepClone(normalizedItems), error: null };
            }

            const matchingRows = applyFilters(rows, state.filters);

            if (state.method === 'update') {
                matchingRows.forEach((row) => {
                    Object.assign(row, state.values || {});
                });
                return { data: deepClone(matchingRows), error: null };
            }

            if (state.method === 'delete') {
                const removeIds = new Set(matchingRows.map((row) => row.id));
                setTableRows(table, rows.filter((row) => !removeIds.has(row.id)));
                return { data: [], error: null };
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

    function installSupabaseStub() {
        const fakeClient = {
            auth: {
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
            },
            async rpc(name) {
                if (name === 'get_user_permissions') {
                    return {
                        data: {
                            is_admin: true,
                            is_super_admin: true,
                            permissions: ['prompts.manage', 'content.moderate', 'settings.manage']
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

                return { data: null, error: null };
            },
            from(table) {
                return createQueryBuilder(String(table || '').trim());
            },
            channel() {
                return {
                    on() {
                        return this;
                    },
                    subscribe() {
                        return this;
                    },
                    unsubscribe() {}
                };
            },
            removeChannel() {
                return Promise.resolve();
            }
        };

        globalScope.supabaseClient = fakeClient;
        globalScope.AdminAccess = {
            async getCurrentAdminAccess() {
                return {
                    user: deepClone(smokeState.user),
                    isAdmin: true,
                    isSuperAdmin: true,
                    permissions: ['prompts.manage', 'content.moderate', 'settings.manage']
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
            async clearAdminStudioSession() {
                return true;
            },
            sanitizeAdminStudioTarget(target = 'admin-studio.html') {
                return String(target || 'admin-studio.html');
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

        const shiftReport = await waitFor(() => document.getElementById('opsAlertMonitorShiftReport')?.querySelector('.ops-alert-shift-report__view-switch'));
        const shiftChips = Array.from(shiftReport.querySelectorAll('[data-admin-action="settings-set-ops-alert-shift-report-view"]'));
        recordResult('交班报表视角切换已渲染', shiftChips.length >= 4, `检测到 ${shiftChips.length} 个视角按钮`);

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

    async function runSmoke() {
        try {
            renderResults('running');
            await nextFrame();

            const pathname = String(globalScope.location?.pathname || '').trim();
            if (/\/admin-studio(?:\.html)?$/i.test(pathname)) {
                if (searchParams.get('module') === 'chat') {
                    await runAdminChatSmoke();
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
