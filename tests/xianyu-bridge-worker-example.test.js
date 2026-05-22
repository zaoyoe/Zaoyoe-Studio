const test = require('node:test');
const assert = require('node:assert/strict');

const {
    loadPaidOrdersFromXianyuBot,
    postXianyuOrder,
    resolveDeliveryContent,
    runBridgeWorker,
    sendDeliveryToXianyuChat
} = require('../adapters/xianyu/bridge-worker.example');

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
        order: {
            orderId: 'XY-BRIDGE-1001',
            status: '买家已付款'
        },
        fetchImpl
    });

    assert.equal(submitted.body.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://www.zaoyoe.com/api/marketplace/xianyu/orders?account=main');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        order: {
            orderId: 'XY-BRIDGE-1001',
            status: '买家已付款'
        }
    });
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
                    content: 'card-secret-1002'
                }
            });
        }
    });

    const summary = await runBridgeWorker({
        env: {
            XIANYU_BRIDGE_BASE_URL: 'https://www.zaoyoe.com',
            XIANYU_BRIDGE_ACCOUNT: 'main',
            XIANYU_BRIDGE_INGEST_TOKEN: 'test-token'
        },
        fetchImpl,
        async loadOrders() {
            return [
                {
                    orderId: 'XY-BRIDGE-1002',
                    status: '买家已付款'
                }
            ];
        },
        async sendChat({ order, content }) {
            chatMessages.push({
                order,
                content
            });
        }
    });

    assert.equal(summary.delivered, 1);
    assert.equal(summary.failed, 0);
    assert.deepEqual(chatMessages, [
        {
            order: {
                orderId: 'XY-BRIDGE-1002',
                status: '买家已付款'
            },
            content: 'card-secret-1002'
        }
    ]);
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
            XIANYU_BRIDGE_INGEST_TOKEN: 'test-token'
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
                    status: '买家已付款'
                }
            ];
        },
        async sendChat() {
            chatSendCount += 1;
        }
    });

    assert.equal(summary.delivered, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.results[0].reason, 'duplicate_order');
    assert.equal(chatSendCount, 0);
});

test('xianyu bridge resolves delivery content from supported response shapes', () => {
    assert.equal(resolveDeliveryContent({
        data: {
            delivery: {
                content: 'nested-content'
            }
        }
    }), 'nested-content');
});