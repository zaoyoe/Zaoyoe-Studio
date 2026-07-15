const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    createWalletHandlers
} = require('../server/api-handlers/public/wallet');

const walletHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/wallet.js');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function createQueryBuilder(executor) {
    const state = {
        selectClause: '',
        filters: [],
        order: null,
        limit: null,
        singleMode: ''
    };

    const builder = {
        select(value) {
            state.selectClause = String(value || '');
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        ilike(column, value) {
            state.filters.push({ op: 'ilike', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [values] });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        lte(column, value) {
            state.filters.push({ op: 'lte', column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, ascending: options.ascending !== false };
            return builder;
        },
        limit(value) {
            state.limit = Number(value) || 0;
            return builder;
        },
        maybeSingle() {
            state.singleMode = 'maybeSingle';
            return builder;
        },
        single() {
            state.singleMode = 'single';
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') return row[column] === value;
        if (op === 'in') return value.includes(row[column]);
        if (op === 'gte') return String(row[column] || '') >= String(value || '');
        if (op === 'lte') return String(row[column] || '') <= String(value || '');
        if (op === 'ilike') {
            const pattern = String(value || '').replace(/%/g, '').toLowerCase();
            return String(row[column] || '').toLowerCase().includes(pattern);
        }
        return true;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) return rows.slice();
    const sorted = rows.slice().sort((left, right) => {
        const leftValue = left?.[order.column];
        const rightValue = right?.[order.column];
        return String(leftValue || '').localeCompare(String(rightValue || ''));
    });
    return order.ascending === false ? sorted.reverse() : sorted;
}

function createSupabaseStub(state = {}) {
    const pointsBalance = state.pointsBalance || [];
    const pointsLedger = state.pointsLedger || [];
    const shopOrders = state.shopOrders || [];
    const shopOrderItems = state.shopOrderItems || [];
    const shopInventory = state.shopInventory || [];
    const shopProducts = state.shopProducts || [];
    const prompts = state.prompts || [];
    const verificationLogs = state.verificationLogs || [];
    const missingColumns = state.missingColumns || {};

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                const missingForTable = new Set(Array.isArray(missingColumns[table]) ? missingColumns[table] : []);
                const selectedColumns = String(query.selectClause || '')
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .map((item) => item.split(/\s+/)[0].split('(')[0].trim())
                    .filter(Boolean);
                const filteredColumns = (query.filters || []).map((item) => String(item.column || '').trim()).filter(Boolean);
                const missingColumn = [...selectedColumns, ...filteredColumns].find((column) => missingForTable.has(column));
                if (missingColumn) {
                    return {
                        data: null,
                        error: {
                            message: `column ${table}.${missingColumn} does not exist`
                        }
                    };
                }

                const selectRows = (rows) => {
                    let output = sortRows(applyFilters(rows, query.filters), query.order);
                    if (query.limit && query.limit > 0) {
                        output = output.slice(0, query.limit);
                    }
                    if (query.singleMode === 'single' || query.singleMode === 'maybeSingle') {
                        return {
                            data: output[0] || null,
                            error: null
                        };
                    }
                    return {
                        data: output,
                        error: null
                    };
                };

                if (table === 'points_balance') return selectRows(pointsBalance);
                if (table === 'points_ledger') return selectRows(pointsLedger);
                if (table === 'shop_orders') return selectRows(shopOrders);
                if (table === 'shop_order_items') return selectRows(shopOrderItems);
                if (table === 'shop_inventory') return selectRows(shopInventory);
                if (table === 'shop_products') return selectRows(shopProducts);
                if (table === 'prompts') return selectRows(prompts);
                if (table === 'verification_logs') return selectRows(verificationLogs);

                throw new Error(`Unexpected table access: ${table}`);
            });
        }
    };
}

function createHandlers(state = {}) {
    const supabase = createSupabaseStub(state);
    const handlers = createWalletHandlers({
        admin: {
            async requireAuthenticatedUser() {
                return {
                    user: { id: 'user-wallet-1' },
                    requestSupabase: supabase,
                    adminSupabase: supabase,
                    supabase
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        site: {
            requireSupportedSite(value) {
                return ['cn', 'intl'].includes(String(value || '').trim().toLowerCase())
                    ? String(value || '').trim().toLowerCase()
                    : 'cn';
            }
        }
    });

    return handlers;
}

test('wallet overview handler returns balance and recent visible history via service-side query', async () => {
    const handlers = createHandlers({
        pointsBalance: [
            { user_id: 'user-wallet-1', site: 'cn', paid_balance: 18, bonus_balance: 2, total_balance: 20 }
        ],
        pointsLedger: [
            { id: 'ledger-hidden', user_id: 'user-wallet-1', site: 'cn', amount: 9, reason: 'hidden', reference_id: 'x', is_visible: false, created_at: '2026-04-16T08:00:00.000Z' },
            { id: 'ledger-1', user_id: 'user-wallet-1', site: 'cn', amount: 5, reason: 'daily_checkin', reference_id: 'checkin-1', is_visible: true, created_at: '2026-04-16T09:00:00.000Z' }
        ]
    });
    const res = createMockResponse();

    await handlers.overview({
        method: 'GET',
        query: {
            site: 'cn',
            history_limit: '20'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.balance.total_balance, 20);
    assert.equal(payload.balance_scope, 'site');
    assert.equal('site_balances' in payload, false);
    assert.equal('other_site_balances' in payload, false);
    assert.equal(payload.recent_history.length, 1);
    assert.equal(payload.recent_history[0].id, 'ledger-1');
  });

test('wallet overview handler keeps other site balances private when current site balance is empty', async () => {
    const handlers = createHandlers({
        pointsBalance: [
            { user_id: 'user-wallet-1', site: 'intl', paid_balance: 6, bonus_balance: 4, total_balance: 10 }
        ]
    });
    const res = createMockResponse();

    await handlers.overview({
        method: 'GET',
        query: {
            site: 'cn',
            history_limit: '20'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.balance.total_balance, 0);
    assert.equal(payload.current_site_has_account, false);
    assert.equal('site_balances' in payload, false);
    assert.equal('other_site_balances' in payload, false);
});

test('wallet overview handler remains compatible when points_ledger.is_visible is missing', async () => {
    const handlers = createHandlers({
        missingColumns: {
            points_ledger: ['is_visible']
        },
        pointsBalance: [
            { user_id: 'user-wallet-1', site: 'cn', paid_balance: 7, bonus_balance: 1, total_balance: 8 }
        ],
        pointsLedger: [
            { id: 'legacy-ledger-1', user_id: 'user-wallet-1', site: 'cn', amount: 3, reason: 'legacy_recharge', reference_id: 'legacy-1', created_at: '2026-04-16T09:00:00.000Z' }
        ]
    });
    const res = createMockResponse();

    await handlers.overview({
        method: 'GET',
        query: {
            site: 'cn',
            history_limit: '20'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.balance.total_balance, 8);
    assert.equal(payload.recent_history.length, 1);
    assert.equal(payload.recent_history[0].id, 'legacy-ledger-1');
});

test('wallet transactions handler returns browse payload with prompt title map', async () => {
    const handlers = createHandlers({
        shopOrders: [
            {
                id: 'shop-1',
                user_id: 'user-wallet-1',
                site: 'cn',
                price_paid: 2,
                total_price: 20,
                discount_code: 'FREEONE',
                discount_amount: 18,
                discount_snapshot: {
                    applied_discounts: [
                        {
                            code: 'FREEONE',
                            discount_type: 'percent',
                            discount_value: 10,
                            discount_amount: 18
                        }
                    ]
                },
                item_count: 1,
                status: 'completed',
                created_at: '2026-04-16T09:10:00.000Z',
                snapshot_product_name: '商城商品',
                shop_order_items: [{ id: 'item-1', snapshot_product_name: '商城商品' }]
            }
        ],
        pointsLedger: [
            {
                id: 'ledger-prompt-1',
                user_id: 'user-wallet-1',
                site: 'cn',
                amount: -3,
                reason: 'unlock_prompt',
                reference_id: 'prompt-1',
                is_visible: true,
                created_at: '2026-04-16T09:00:00.000Z'
            },
            {
                id: 'ledger-hidden-release',
                user_id: 'user-wallet-1',
                site: 'cn',
                amount: 0,
                reason: 'AI 文本对话未完成，释放预授权',
                reference_id: 'task-hidden',
                is_visible: false,
                created_at: '2026-04-16T09:05:00.000Z'
            }
        ],
        prompts: [
            { id: 'prompt-1', title: '高级提示词' }
        ]
    });
    const res = createMockResponse();

    await handlers.transactions({
        method: 'GET',
        query: {
            site: 'cn',
            limit: '100'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.shop_orders.length, 1);
    assert.equal(payload.shop_orders[0].price_paid, 2);
    assert.equal(payload.shop_orders[0].total_price, 20);
    assert.equal(payload.shop_orders[0].discount_code, 'FREEONE');
    assert.equal(payload.shop_orders[0].discount_amount, 18);
    assert.equal(payload.shop_orders[0].discount_snapshot.applied_discounts[0].code, 'FREEONE');
    assert.equal(payload.ledger_entries.length, 1);
    assert.equal(payload.ledger_entries[0].amount, -3);
    assert.equal(payload.ledger_entries.some((entry) => entry.id === 'ledger-hidden-release'), false);
    assert.equal(payload.prompt_titles['prompt-1'], '高级提示词');
});

test('wallet transactions handler remains compatible when points_ledger.is_visible is missing', async () => {
    const handlers = createHandlers({
        missingColumns: {
            points_ledger: ['is_visible']
        },
        pointsLedger: [
            {
                id: 'legacy-ledger-transaction',
                user_id: 'user-wallet-1',
                site: 'cn',
                amount: 3,
                reason: 'legacy_recharge',
                reference_id: 'legacy-transaction-1',
                created_at: '2026-04-16T09:00:00.000Z'
            }
        ]
    });
    const res = createMockResponse();

    await handlers.transactions({
        method: 'GET',
        query: {
            site: 'cn',
            limit: '100'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.ledger_entries.length, 1);
    assert.equal(payload.ledger_entries[0].id, 'legacy-ledger-transaction');
});

test('wallet transactions handler selects paid and gross shop order totals', () => {
    const source = fs.readFileSync(walletHandlerPath, 'utf8');

    const browseSource = source.slice(
        source.indexOf('async function queryWalletBrowseData'),
        source.indexOf('async function queryWalletSearchData')
    );
    const searchSource = source.slice(
        source.indexOf('async function queryWalletSearchData'),
        source.indexOf('async function findWalletVerifyLog')
    );
    const uuidSearchStart = searchSource.indexOf('if (isUuidQuery)');
    const uuidSearchSource = searchSource.slice(
        uuidSearchStart,
        searchSource.indexOf('ledgerRequests.push(', uuidSearchStart)
    );

    assert.match(browseSource, /from\('shop_orders'\)[\s\S]*id,[\s\S]*price_paid,[\s\S]*total_price,[\s\S]*discount_code,[\s\S]*discount_amount,[\s\S]*discount_snapshot,/);
    assert.match(searchSource, /from\('shop_orders'\)[\s\S]*id,[\s\S]*price_paid,[\s\S]*total_price,[\s\S]*discount_code,[\s\S]*discount_amount,[\s\S]*discount_snapshot,/);
    assert.match(
        uuidSearchSource,
        /from\('shop_orders'\)[\s\S]*\.select\(`[\s\S]*price_paid,[\s\S]*total_price,[\s\S]*discount_code,[\s\S]*discount_amount,[\s\S]*discount_snapshot,[\s\S]*\.eq\('id', trimmedQuery\)/,
        'uuid search fallback should select paid, gross, and discount fields'
    );
});

test('wallet transactions handler search path expands prompt-title and verify-log related ledger matches', async () => {
    const handlers = createHandlers({
        pointsLedger: [
            {
                id: 'ledger-prompt-search',
                user_id: 'user-wallet-1',
                site: 'cn',
                amount: -4,
                reason: 'unlock_prompt',
                reference_id: 'prompt-2',
                is_visible: true,
                created_at: '2026-04-16T09:00:00.000Z'
            },
            {
                id: 'ledger-verify-search',
                user_id: 'user-wallet-1',
                site: 'cn',
                amount: -2,
                reason: 'verify_google_one',
                reference_id: 'verify-job-1',
                is_visible: true,
                created_at: '2026-04-16T09:05:00.000Z'
            },
            {
                id: 'ledger-hidden-search',
                user_id: 'user-wallet-1',
                site: 'cn',
                amount: 0,
                reason: '礼包隐藏释放记录',
                reference_id: 'hidden-search',
                is_visible: false,
                created_at: '2026-04-16T09:07:00.000Z'
            }
        ],
        prompts: [
            { id: 'prompt-2', title: '谷歌礼包提示词' }
        ],
        verificationLogs: [
            {
                verification_id: 'verify-job-1',
                user_id: 'user-wallet-1',
                site: 'cn',
                status: 'completed',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'verify-job-1',
                    email: 'wallet@example.com'
                }),
                points_deducted: 2,
                created_at: '2026-04-16T09:06:00.000Z'
            }
        ]
    });

    const promptRes = createMockResponse();
    await handlers.transactions({
        method: 'GET',
        query: {
            site: 'cn',
            q: '礼包'
        }
    }, promptRes);
    const promptPayload = promptRes.json();
    assert.equal(promptRes.statusCode, 200);
    assert.equal(promptPayload.ledger_entries.some((entry) => entry.id === 'ledger-prompt-search'), true);
    assert.equal(promptPayload.ledger_entries.some((entry) => entry.id === 'ledger-hidden-search'), false);
    assert.equal(promptPayload.prompt_titles['prompt-2'], '谷歌礼包提示词');

    const verifyRes = createMockResponse();
    await handlers.transactions({
        method: 'GET',
        query: {
            site: 'cn',
            q: 'wallet@example.com'
        }
    }, verifyRes);
    const verifyPayload = verifyRes.json();
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyPayload.ledger_entries.some((entry) => entry.id === 'ledger-verify-search'), true);
});

test('wallet prompt titles handler returns a server-side title map for requested prompt ids', async () => {
    const handlers = createHandlers({
        prompts: [
            { id: 'prompt-a', title: '标题 A' },
            { id: 'prompt-b', title: '标题 B' }
        ]
    });
    const res = createMockResponse();

    await handlers.promptTitles({
        method: 'POST',
        query: {
            site: 'cn'
        },
        body: {
            ids: ['prompt-a', 'prompt-b']
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.prompt_titles['prompt-a'], '标题 A');
    assert.equal(payload.prompt_titles['prompt-b'], '标题 B');
});

test('wallet verify log handler resolves and normalizes the matching verify record server-side', async () => {
    const handlers = createHandlers({
        verificationLogs: [
            {
                verification_id: 'verify-job-77',
                user_id: 'user-wallet-1',
                site: 'cn',
                status: 'success',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'verify-job-77',
                    email: 'wallet@example.com',
                    url: 'https://example.com/job/77'
                }),
                points_deducted: 2,
                created_at: '2026-04-16T10:00:30.000Z'
            }
        ]
    });
    const res = createMockResponse();

    await handlers.verifyLog({
        method: 'POST',
        query: {
            site: 'cn'
        },
        body: {
            reference_id: 'verify-job-77',
            created_at: '2026-04-16T10:00:00.000Z',
            points_paid: 2,
            reason: '核销账号 wallet@example.com'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.verify_log.verification_id, 'verify-job-77');
    assert.equal(payload.verify_log.points_deducted, 2);
    assert.equal(payload.verify_log.payload.email, 'wallet@example.com');
    assert.equal(payload.verify_log.payload.job_id, 'verify-job-77');
});

test('wallet order detail handler returns purchased content and guidance through the wallet route', async () => {
    const handlers = createHandlers({
        shopOrders: [
            {
                id: '341186be-1111-4222-8333-4444444423e8',
                user_id: 'user-wallet-1',
                site: 'cn',
                product_id: '6f8468aa-2222-4333-8444-555555555555',
                inventory_id: 'inv-1',
                snapshot_product_name: '满两年带2FA随机地区gmail',
                created_at: '2026-04-14T03:42:00.000Z',
                price_paid: 1,
                total_price: 1,
                discount_code: null,
                discount_amount: 0,
                discount_snapshot: null,
                item_count: 1
            }
        ],
        shopInventory: [
            {
                id: 'inv-1',
                content: 'sdf'
            }
        ],
        shopProducts: [
            {
                id: '6f8468aa-2222-4333-8444-555555555555',
                show_purchase_notes: true,
                purchase_notes: '注意事项 A',
                show_usage_instructions: true,
                usage_instructions: '使用说明 B'
            }
        ]
    });
    const res = createMockResponse();

    await handlers.orderDetail({
        method: 'POST',
        body: {
            orderId: '341186be-1111-4222-8333-4444444423e8'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.order.snapshot_product_name, '满两年带2FA随机地区gmail');
    assert.equal(payload.data.items.length, 1);
    assert.equal(payload.data.items[0].content, 'sdf');
    assert.equal(payload.data.guidance.purchase_notes, '注意事项 A');
    assert.equal(payload.data.guidance.usage_instructions, '使用说明 B');
});

test('wallet order detail handler does not return another site order', async () => {
    const handlers = createHandlers({
        shopOrders: [
            {
                id: '341186be-1111-4222-8333-4444444423e8',
                user_id: 'user-wallet-1',
                site: 'intl',
                product_id: '6f8468aa-2222-4333-8444-555555555555',
                inventory_id: 'inv-1',
                snapshot_product_name: 'INTL order',
                created_at: '2026-04-14T03:42:00.000Z',
                price_paid: 1,
                total_price: 1,
                discount_code: null,
                discount_amount: 0,
                discount_snapshot: null,
                item_count: 1
            }
        ]
    });
    const res = createMockResponse();

    await handlers.orderDetail({
        method: 'POST',
        query: {
            site: 'cn'
        },
        body: {
            orderId: '341186be-1111-4222-8333-4444444423e8'
        }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 404);
    assert.equal(payload.success, false);
});
