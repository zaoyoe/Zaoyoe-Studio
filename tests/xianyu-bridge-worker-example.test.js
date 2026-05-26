const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildBridgeMarketplaceConfigFromEnv,
    loadPaidOrdersFromXianyuBot,
    postXianyuOrder,
    resolveDeliveryContent,
    resolveUsageInstructions,
    runBridgeLoop,
    runBridgeWorker,
    sendDeliveryToXianyuChat
} = require('../adapters/xianyu/bridge-worker');

test('xianyu bridge posts raw orders to the recommended marketplace endpoint', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({
            url,
            options
        });
        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    success: true,
                    normalized_order: {
                        external_order_id: 'XY-BRIDGE-1001'
                    },
                    data: {
                        content: 'delivery-secret'
                    }
                });
            }
        };
    };

    const submitted = await postXianyuOrder({
        baseUrl: 'https://www.zaoyoe.com/',
        accountKey: 'main',
        ingestToken: 'test-token',
        marketplaceConfig: {
            product_mappings: [
                {
                    xianyu_item_id: 'XY-BRIDGE-ITEM-1001',
                    product_id: '11111111-1111-4111-8111-111111111111'
                }
            ]
        },
        order: {
            orderId: 'XY-BRIDGE-1001',
            status: '买家已付款',
            item: {
                itemId: 'XY-BRIDGE-ITEM-1001'
            }
        },
        fetchImpl
    });

    assert.equal(submitted.body.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://www.zaoyoe.com/api/marketplace/orders');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(calls[0].options.body).product_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(JSON.parse(calls[0].options.body).external_order_id, 'XY-BRIDGE-1001');
    assert.equal(JSON.parse(calls[0].options.body).account, 'main');
});

test('xianyu bridge sends returned delivery content to the chat adapter', async () => {
    const chatMessages = [];
    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        async text() {
            return JSON.stringify({
                success: true,
                duplicate: false,
                normalized_order: {
                    external_order_id: 'XY-BRIDGE-1002'
                },
                data: {
                    content: 'card-secret-1002',
                    usage_instructions: '请先登录官网，再兑换卡密。',
                    show_usage_instructions: true
                }
            });
        }
    });

    const summary = await runBridgeWorker({
        env: {
            XIANYU_BRIDGE_BASE_URL: 'https://www.zaoyoe.com',
            XIANYU_BRIDGE_ACCOUNT: 'main',
            XIANYU_BRIDGE_INGEST_TOKEN: 'test-token',
            XIANYU_BRIDGE_PRODUCT_MAPPINGS: JSON.stringify([
                {
                    xianyu_item_id: 'XY-BRIDGE-ITEM-1002',
                    product_id: '22222222-2222-4222-8222-222222222222'
                }
            ])
        },
        fetchImpl,
        async loadOrders() {
            return [
                {
                    orderId: 'XY-BRIDGE-1002',
                    status: '买家已付款',
                    item: {
                        itemId: 'XY-BRIDGE-ITEM-1002'
                    }
                }
            ];
        },
        async sendChat({ order, content, usageInstructions }) {
            chatMessages.push({
                order,
                content,
                usageInstructions
            });
        }
    });

    assert.equal(summary.delivered, 1);
    assert.equal(summary.failed, 0);
    assert.deepEqual(chatMessages, [
        {
            order: {
                orderId: 'XY-BRIDGE-1002',
                status: '买家已付款',
                item: {
                    itemId: 'XY-BRIDGE-ITEM-1002'
                }
            },
            content: 'card-secret-1002',
            usageInstructions: '请先登录官网，再兑换卡密。'
        }
    ]);
});

test('xianyu bridge reports per-order delivery timing diagnostics', async () => {
    const diagnostics = [];
    const nowValues = [
        200_000,
        200_010,
        200_040,
        200_050,
        200_060,
        200_260,
        200_270,
        200_390,
        200_460,
        200_500
    ];
    const now = () => nowValues.shift() ?? 200_500;

    const summary = await runBridgeWorker({
        env: {
            XIANYU_BRIDGE_BASE_URL: 'https://www.zaoyoe.com',
            XIANYU_BRIDGE_ACCOUNT: 'main',
            XIANYU_BRIDGE_INGEST_TOKEN: 'test-token',
            XIANYU_BRIDGE_PRODUCT_MAPPINGS: JSON.stringify([
                {
                    xianyu_item_id: 'XY-BRIDGE-ITEM-1005',
                    product_id: '55555555-5555-4555-8555-555555555555'
                }
            ]),
            XIANYU_BRIDGE_DIAGNOSTICS: '1'
        },
        now,
        diagnosticLogger(record) {
            diagnostics.push(record);
        },
        async fetchImpl() {
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        duplicate: false,
                        normalized_order: {
                            external_order_id: 'XY-BRIDGE-1005'
                        },
                        data: {
                            content: 'card-secret-1005'
                        }
                    });
                }
            };
        },
        async loadOrders() {
            return [
                {
                    orderId: 'XY-BRIDGE-1005',
                    paidAt: 125,
                    item: {
                        itemId: 'XY-BRIDGE-ITEM-1005'
                    }
                }
            ];
        },
        async sendChat() {
            return {
                status: 'sent',
                attempts: 2
            };
        }
    });

    assert.equal(summary.delivered, 1);
    assert.deepEqual(summary.timing_ms, {
        load_orders_ms: 30,
        total_ms: 500
    });
    assert.deepEqual(summary.results[0].timing_ms, {
        order_paid_age_ms: 75050,
        load_orders_ms: 30,
        queue_wait_ms: 10,
        website_ms: 200,
        chat_send_ms: 120,
        total_ms: 410
    });
    assert.equal(summary.results[0].chat_attempts, 2);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].event, 'order_delivered');
    assert.equal(diagnostics[0].external_order_id, 'XY-BRIDGE-1005');
    assert.deepEqual(diagnostics[0].timing_ms, summary.results[0].timing_ms);
});

test('xianyu bridge refreshes admin mappings after a local mapping miss', async () => {
    const diagnostics = [];
    const websiteRequests = [];
    let configReads = 0;
    const configs = [
        {
            website_base_url: 'https://www.zaoyoe.com',
            account: 'main',
            ingest_token: 'old-token',
            product_mappings: []
        },
        {
            website_base_url: 'https://www.zaoyoe.com',
            account: 'main',
            ingest_token: 'fresh-token',
            product_mappings: [
                {
                    xianyu_item_id: 'XY-BRIDGE-ITEM-1006',
                    product_id: '66666666-6666-4666-8666-666666666666'
                }
            ]
        }
    ];

    const summary = await runBridgeWorker({
        env: {
            XIANYU_BRIDGE_BASE_URL: 'https://www.zaoyoe.com',
            XIANYU_BRIDGE_ACCOUNT: 'main',
            XIANYU_BRIDGE_FROM_ADMIN: 'true',
            XIANYU_BRIDGE_MAPPING_MISS_RETRY_DELAY_MS: '0',
            XIANYU_BRIDGE_DIAGNOSTICS: '1'
        },
        async loadMarketplaceConfig() {
            configReads += 1;
            return configs[Math.min(configReads - 1, configs.length - 1)];
        },
        diagnosticLogger(record) {
            diagnostics.push(record);
        },
        async fetchImpl(url, options) {
            websiteRequests.push({
                url,
                options
            });
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        normalized_order: {
                            external_order_id: 'XY-BRIDGE-1006'
                        },
                        data: {
                            content: 'card-secret-1006'
                        }
                    });
                }
            };
        },
        async loadOrders() {
            return [
                {
                    orderId: 'XY-BRIDGE-1006',
                    status: '买家已付款',
                    item: {
                        itemId: 'XY-BRIDGE-ITEM-1006'
                    }
                }
            ];
        },
        async sendChat() {
            return {
                status: 'sent',
                attempts: 1
            };
        }
    });

    assert.equal(configReads, 2);
    assert.equal(websiteRequests.length, 1);
    assert.equal(websiteRequests[0].options.headers.Authorization, 'Bearer fresh-token');
    assert.equal(JSON.parse(websiteRequests[0].options.body).product_id, '66666666-6666-4666-8666-666666666666');
    assert.equal(summary.delivered, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.results[0].mapping_retry_count, 1);
    assert.equal(diagnostics[0].event, 'mapping_retry');
    assert.equal(diagnostics[1].event, 'order_delivered');
    assert.equal(diagnostics[1].mapping_retry_count, 1);
});

test('xianyu bridge loads paid orders from a bot HTTP endpoint', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({
            url,
            options
        });
        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    success: true,
                    data: {
                        orders: [
                            {
                                orderId: 'XY-BOT-1001',
                                status: '买家已付款'
                            }
                        ]
                    }
                });
            }
        };
    };

    const orders = await loadPaidOrdersFromXianyuBot({
        XIANYU_BOT_ORDERS_URL: 'http://127.0.0.1:19090/orders/paid',
        XIANYU_BOT_TOKEN: 'bot-token'
    }, { fetchImpl });

    assert.deepEqual(orders, [
        {
            orderId: 'XY-BOT-1001',
            status: '买家已付款'
        }
    ]);
    assert.equal(calls[0].url, 'http://127.0.0.1:19090/orders/paid');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer bot-token');
});

test('xianyu bridge loop keeps running after a single worker failure', async () => {
    const summaries = [];
    let callCount = 0;

    const summary = await runBridgeLoop({
        env: {
            XIANYU_BOT_ORDERS_URL: 'http://127.0.0.1:19090/orders/paid'
        },
        intervalMs: 1,
        stopAfterRuns: 2,
        onSummary(entry) {
            summaries.push(entry);
        },
        fetchImpl: async () => {
            callCount += 1;
            if (callCount === 1) {
                throw new Error('fetch failed');
            }
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        orders: []
                    });
                }
            };
        }
    });

    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].failed, 1);
    assert.equal(summaries[0].error.message, 'fetch failed');
    assert.equal(summaries[1].failed, 0);
    assert.equal(summary.failed, 0);
});

test('xianyu bridge posts delivery content to a bot chat endpoint', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({
            url,
            options
        });
        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    success: true,
                    sent: true
                });
            }
        };
    };

    const result = await sendDeliveryToXianyuChat({
        order: {
            orderId: 'XY-BOT-1002',
            buyerId: 'buyer-1002',
            buyerNick: '闲鱼买家'
        },
        content: 'delivery-secret-1002',
        response: {
            data: {
                order_id: 'site-order-1002'
            }
        },
        env: {
            XIANYU_BOT_SEND_MESSAGE_URL: 'http://127.0.0.1:19090/chat/send',
            XIANYU_BOT_TOKEN: 'bot-token'
        },
        fetchImpl
    });

    assert.equal(result.status, 'sent');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:19090/chat/send');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer bot-token');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        external_order_id: 'XY-BOT-1002',
        buyer_id: 'buyer-1002',
        buyer_name: '闲鱼买家',
        chat_id: '',
        sid: '',
        cookie_id: '',
        item_id: '',
        content: 'delivery-secret-1002',
        usage_instructions: '',
        order: {
            orderId: 'XY-BOT-1002',
            buyerId: 'buyer-1002',
            buyerNick: '闲鱼买家'
        },
        marketplace_response: {
            data: {
                order_id: 'site-order-1002'
            }
        }
    });
});

test('xianyu bridge forwards usage instructions to the chat adapter payload', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({ success: true });
            }
        };
    };

    await sendDeliveryToXianyuChat({
        order: {
            orderId: 'XY-BOT-1005',
            buyerId: 'buyer-1005',
            buyerNick: '说明买家'
        },
        content: 'delivery-secret-1005',
        usageInstructions: '使用说明先看这里',
        response: {},
        env: {
            XIANYU_BOT_SEND_MESSAGE_URL: 'http://127.0.0.1:19090/chat/send'
        },
        fetchImpl
    });

    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.usage_instructions, '使用说明先看这里');
    assert.equal(payload.content, 'delivery-secret-1005');
});

test('xianyu bridge includes chat and account context when sending delivery content', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({
            url,
            options
        });
        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    success: true
                });
            }
        };
    };

    await sendDeliveryToXianyuChat({
        order: {
            orderId: 'XY-BOT-1004',
            buyerId: 'buyer-1004',
            buyerNick: '闲鱼买家',
            chatId: 'chat-1004@goofish',
            sid: 'chat-1004@goofish',
            cookie_id: 'main-cookie',
            item: {
                itemId: '1051635270711'
            }
        },
        content: 'delivery-secret-1004',
        response: {},
        env: {
            XIANYU_BOT_SEND_MESSAGE_URL: 'http://127.0.0.1:19090/chat/send'
        },
        fetchImpl
    });

    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.chat_id, 'chat-1004');
    assert.equal(payload.sid, 'chat-1004@goofish');
    assert.equal(payload.cookie_id, 'main-cookie');
    assert.equal(payload.item_id, '1051635270711');
});

test('xianyu bridge treats duplicate website orders as already handled', async () => {
    let chatSendCount = 0;
    const summary = await runBridgeWorker({
        env: {
            XIANYU_BRIDGE_BASE_URL: 'https://www.zaoyoe.com',
            XIANYU_BRIDGE_ACCOUNT: 'main',
            XIANYU_BRIDGE_INGEST_TOKEN: 'test-token',
            XIANYU_BRIDGE_PRODUCT_MAPPINGS: JSON.stringify([
                {
                    xianyu_item_id: 'XY-BRIDGE-ITEM-1003',
                    product_id: '33333333-3333-4333-8333-333333333333'
                }
            ])
        },
        async fetchImpl() {
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        duplicate: true,
                        normalized_order: {
                            external_order_id: 'XY-BRIDGE-1003'
                        },
                        data: {
                            content: 'already-created-content'
                        }
                    });
                }
            };
        },
        async loadOrders() {
            return [
                {
                    orderId: 'XY-BRIDGE-1003',
                    status: '买家已付款',
                    item: {
                        itemId: 'XY-BRIDGE-ITEM-1003'
                    }
                }
            ];
        },
        async sendChat() {
            chatSendCount += 1;
        }
    });

    assert.equal(summary.delivered, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(chatSendCount, 1);
});

test('xianyu bridge can read product mappings from env JSON', () => {
    const config = buildBridgeMarketplaceConfigFromEnv({
        XIANYU_BRIDGE_BASE_URL: 'https://www.zaoyoe.com',
        XIANYU_BRIDGE_ACCOUNT: 'main',
        XIANYU_BRIDGE_INGEST_TOKEN: 'test-token',
        XIANYU_BRIDGE_PRODUCT_MAPPINGS: JSON.stringify([
            {
                xianyu_item_id: 'xy-env-item',
                product_id: '44444444-4444-4444-8444-444444444444'
            }
        ])
    });

    assert.equal(config.product_mappings.length, 1);
    assert.equal(config.product_mappings[0].product_id, '44444444-4444-4444-8444-444444444444');
});

test('xianyu bridge resolves delivery content from supported response shapes', () => {
    assert.equal(resolveDeliveryContent({
        data: {
            delivery: {
                content: 'nested-content'
            }
        }
    }), 'nested-content');
    assert.equal(resolveDeliveryContent({
        content: 'top-level-content'
    }), 'top-level-content');
});

test('xianyu bridge resolves enabled usage instructions from supported response shapes', () => {
    assert.equal(resolveUsageInstructions({
        data: {
            usage_instructions: 'nested-usage',
            show_usage_instructions: true
        }
    }), 'nested-usage');
    assert.equal(resolveUsageInstructions({
        usage_instructions: 'top-level-usage',
        show_usage_instructions: true
    }), 'top-level-usage');
    assert.equal(resolveUsageInstructions({
        data: {
            usage_instructions: 'hidden-usage',
            show_usage_instructions: false
        }
    }), '');
});
