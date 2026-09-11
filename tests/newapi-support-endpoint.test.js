const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateSignature,
    createNewApiSupportHandler,
    encodeCursor,
    pruneExpiredNonces
} = require('../api/newapi-support');
const {
    shouldCaptureNewApiSupportRawBody
} = require('../scripts/local-preview-server');

const SECRET = 'newapi-support-test-secret';
const NOW_MS = Date.parse('2026-09-09T12:00:00.000Z');

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
        },
        get headers() {
            return state.headers;
        },
        get body() {
            return state.body;
        }
    };
}

function createFakeSupabase(initial = {}) {
    const state = {
        nonces: [...(initial.nonces || [])],
        nonceHashes: new Set(),
        nonceCleanupCutoffs: [],
        messages: [...(initial.messages || [])],
        conversation: initial.conversation || null,
        conversationUpserts: [],
        messageInserts: [],
        queryLog: [],
        nextMessageId: 1
    };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    const sortRows = (rows, sorts) => {
        const sorted = [...rows];
        for (const { field, ascending } of [...sorts].reverse()) {
            sorted.sort((left, right) => {
                const a = String(left[field] || '');
                const b = String(right[field] || '');
                const comparison = a.localeCompare(b);
                return ascending === false ? -comparison : comparison;
            });
        }
        return sorted;
    };

    const createMessageSelectQuery = () => {
        const filters = [];
        const sorts = [];
        let range = null;
        let limit = null;
        const execute = () => {
            let rows = state.messages.filter((row) => filters.every(({ field, value }) => String(row[field] ?? '') === String(value ?? '')));
            rows = sortRows(rows, sorts);
            if (range) rows = rows.slice(range[0], range[1] + 1);
            if (limit !== null) rows = rows.slice(0, limit);
            return clone(rows);
        };
        return {
            eq(field, value) {
                state.queryLog.push({ type: 'eq', field, value });
                filters.push({ field, value });
                return this;
            },
            order(field, options = {}) {
                sorts.push({ field, ascending: options.ascending !== false });
                return this;
            },
            range(from, to) {
                range = [from, to];
                return this;
            },
            limit(value) {
                limit = value;
                return this;
            },
            async maybeSingle() {
                return { data: execute()[0] || null, error: null };
            },
            then(resolve, reject) {
                return Promise.resolve({ data: execute(), error: null }).then(resolve, reject);
            }
        };
    };

    const createMessageInsertQuery = (payload) => ({
        select() {
            return {
                async single() {
                    const duplicate = state.messages.find((row) => (
                        row.product === payload.product
                        && row.session_id === payload.session_id
                        && row.client_message_id
                        && row.client_message_id === payload.client_message_id
                    ));
                    if (duplicate) {
                        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
                    }
                    const inserted = {
                        id: `message-${state.nextMessageId++}`,
                        created_at: `2026-09-09T12:00:0${state.nextMessageId}.000Z`,
                        ...payload
                    };
                    state.messages.push(inserted);
                    state.messageInserts.push(clone(inserted));
                    return { data: clone(inserted), error: null };
                }
            };
        }
    });

    const createConversationUpsertQuery = (payload) => ({
        select() {
            return {
                async single() {
                    if (!state.conversation) {
                        state.conversation = {
                            id: 'conversation-opaque-1',
                            session_id: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f',
                            created_at: '2026-09-09T11:00:00.000Z',
                            ...payload
                        };
                    } else {
                        state.conversation = {
                            ...state.conversation,
                            ...payload
                        };
                    }
                    state.conversationUpserts.push(clone(payload));
                    return { data: clone(state.conversation), error: null };
                }
            };
        }
    });

    const createConversationSelectQuery = () => {
        const filters = [];
        const matches = () => state.conversation && filters.every(({ field, value }) => (
            String(state.conversation[field] ?? '') === String(value ?? '')
        ));
        return {
            eq(field, value) {
                state.queryLog.push({ type: 'eq', field, value });
                filters.push({ field, value });
                return this;
            },
            async maybeSingle() {
                return { data: matches() ? clone(state.conversation) : null, error: null };
            }
        };
    };

    return {
        state,
        from(table) {
            if (table === 'newapi_support_gateway_nonces') {
                return {
                    async insert(payload) {
                        if (state.nonceHashes.has(payload.nonce_hash)) {
                            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
                        }
                        state.nonceHashes.add(payload.nonce_hash);
                        const inserted = {
                            created_at: '2026-09-09T12:00:00.000Z',
                            ...payload
                        };
                        state.nonces.push(clone(inserted));
                        return { data: clone(inserted), error: null };
                    },
                    delete() {
                        return {
                            async lt(field, cutoff) {
                                state.nonceCleanupCutoffs.push({ field, cutoff });
                                state.nonces = state.nonces.filter((row) => String(row?.[field] || '') >= cutoff);
                                return { data: null, error: null };
                            }
                        };
                    }
                };
            }
            if (table === 'newapi_support_conversations') {
                return {
                    select() {
                        return createConversationSelectQuery();
                    },
                    upsert(payload) {
                        return createConversationUpsertQuery(payload);
                    }
                };
            }
            if (table === 'chat_messages') {
                return {
                    select() {
                        return createMessageSelectQuery();
                    },
                    insert(payload) {
                        return createMessageInsertQuery(payload);
                    }
                };
            }
            throw new Error(`Unexpected table ${table}`);
        }
    };
}

function requestPayload(overrides = {}) {
    return {
        version: 1,
        product: 'newapi',
        action: 'send_message',
        principal: {
            user_id: 123,
            username: 'newapi-user',
            email: 'newapi-user@example.com'
        },
        page: {
            path: '/dashboard/keys',
            title: 'API Keys',
            section: 'keys',
            request_id: 'request-1'
        },
        text: 'Need help with my key.',
        client_message_id: 'message-1',
        ...overrides
    };
}

async function callGateway(handler, payload, {
    nonce = 'nonce-0123456789abcdef',
    timestamp = String(Math.floor(NOW_MS / 1000)),
    signature = ''
} = {}) {
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = {
        method: 'POST',
        rawBody,
        headers: {
            'x-newapi-support-version': '1',
            'x-newapi-support-timestamp': timestamp,
            'x-newapi-support-nonce': nonce,
            'x-newapi-support-signature': signature || calculateSignature(SECRET, timestamp, nonce, rawBody)
        }
    };
    const res = createMockResponse();
    await handler(req, res);
    return { req, res, payload: res.json() };
}

function createHandler(supabase, extra = {}) {
    return createNewApiSupportHandler({
        env: { NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET: SECRET },
        now: NOW_MS,
        getSupabaseAdmin: () => supabase,
        ...extra
    });
}

test('NewAPI support send_message authenticates and persists isolated conversation state', async () => {
    const supabase = createFakeSupabase();
    const result = await callGateway(createHandler(supabase), requestPayload());

    assert.equal(result.res.statusCode, 200);
    assert.equal(result.payload.success, true);
    assert.equal(result.payload.data.author, 'user');
    assert.equal(result.payload.data.text, 'Need help with my key.');
    assert.equal(result.payload.data.message_type, 'text');
    assert.equal(result.payload.data.client_message_id, 'message-1');
    assert.equal(supabase.state.nonces.length, 1);
    assert.equal(supabase.state.nonces[0].product, 'newapi');
    assert.equal(supabase.state.messageInserts.length, 1);
    assert.deepEqual(supabase.state.messageInserts[0], {
        id: 'message-1',
        created_at: '2026-09-09T12:00:02.000Z',
        user_id: null,
        session_id: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f',
        site: 'cn',
        product: 'newapi',
        source: 'newapi_gateway',
        external_user_id: '123',
        external_username: 'newapi-user',
        external_email: 'newapi-user@example.com',
        client_message_id: 'message-1',
        page_context: {
            path: '/dashboard/keys',
            title: 'API Keys',
            section: 'keys',
            request_id: 'request-1'
        },
        content: 'Need help with my key.',
        message_type: 'text',
        is_admin: false
    });
    assert.equal(supabase.state.conversation.last_message_is_admin, false);
    assert.equal(supabase.state.conversationUpserts[0].last_message_is_admin, false);
    assert.notEqual(supabase.state.conversation.session_id, 'newapi:user:123');
    assert.match(supabase.state.conversation.session_id, /^newapi:[0-9a-f-]{36}$/);
});

test('NewAPI support rejects an invalid signature before any database write', async () => {
    const supabase = createFakeSupabase();
    const result = await callGateway(createHandler(supabase), requestPayload(), {
        signature: '0'.repeat(64)
    });

    assert.equal(result.res.statusCode, 401);
    assert.equal(result.payload.success, false);
    assert.equal(result.payload.code, 'invalid_signature');
    assert.equal(supabase.state.nonces.length, 0);
    assert.equal(supabase.state.messageInserts.length, 0);
    assert.equal(supabase.state.conversation, null);
});

test('NewAPI support rejects stale timestamps before any database write', async () => {
    const supabase = createFakeSupabase();
    const staleTimestamp = String(Math.floor(NOW_MS / 1000) - 301);
    const result = await callGateway(createHandler(supabase), requestPayload(), {
        timestamp: staleTimestamp
    });

    assert.equal(result.res.statusCode, 401);
    assert.equal(result.payload.code, 'stale_timestamp');
    assert.equal(supabase.state.nonces.length, 0);
    assert.equal(supabase.state.messageInserts.length, 0);
});

test('NewAPI support persists nonce replay protection', async () => {
    const supabase = createFakeSupabase();
    const handler = createHandler(supabase);
    const payload = requestPayload({
        action: 'context',
        text: undefined,
        client_message_id: undefined
    });
    const first = await callGateway(handler, payload, { nonce: 'nonce-replay-0123456789' });
    const replay = await callGateway(handler, payload, { nonce: 'nonce-replay-0123456789' });

    assert.equal(first.res.statusCode, 200);
    assert.equal(replay.res.statusCode, 409);
    assert.equal(replay.payload.code, 'replayed_nonce');
    assert.equal(supabase.state.nonces.length, 1);
});

test('NewAPI support context does not create an empty conversation for an idle user', async () => {
    const supabase = createFakeSupabase();
    const result = await callGateway(createHandler(supabase), requestPayload({
        action: 'context',
        text: undefined,
        client_message_id: undefined
    }), { nonce: 'nonce-idle-context-012345678' });

    assert.equal(result.res.statusCode, 200);
    assert.equal(result.payload.data.conversation, undefined);
    assert.deepEqual(result.payload.data.messages, []);
    assert.equal(result.payload.data.unread_count, 0);
    assert.equal(supabase.state.conversation, null);
    assert.equal(supabase.state.conversationUpserts.length, 0);
});

test('NewAPI support messages returns an empty page before the first user message', async () => {
    const supabase = createFakeSupabase();
    const result = await callGateway(createHandler(supabase), requestPayload({
        action: 'messages',
        page: undefined,
        text: undefined,
        client_message_id: undefined
    }), { nonce: 'nonce-idle-messages-012345678' });

    assert.equal(result.res.statusCode, 200);
    assert.deepEqual(result.payload.data, { messages: [], next_cursor: '' });
    assert.equal(supabase.state.conversation, null);
    assert.equal(supabase.state.conversationUpserts.length, 0);
});

test('NewAPI support opportunistically prunes nonce records outside the replay window', async () => {
    const supabase = createFakeSupabase({
        nonces: [
            { nonce_hash: 'expired', created_at: '2026-09-09T11:48:00.000Z' },
            { nonce_hash: 'current', created_at: '2026-09-09T11:50:00.000Z' }
        ]
    });

    const cleaned = await pruneExpiredNonces(supabase, { now: NOW_MS });

    assert.equal(cleaned, true);
    assert.deepEqual(supabase.state.nonceCleanupCutoffs, [{
        field: 'created_at',
        cutoff: '2026-09-09T11:49:00.000Z'
    }]);
    assert.deepEqual(supabase.state.nonces.map((row) => row.nonce_hash), ['current']);
});

test('NewAPI support returns the existing message for a retried client_message_id', async () => {
    const supabase = createFakeSupabase();
    const handler = createHandler(supabase);
    const first = await callGateway(handler, requestPayload(), { nonce: 'nonce-idempotent-012345' });
    const second = await callGateway(handler, requestPayload(), { nonce: 'nonce-idempotent-987654' });

    assert.equal(first.res.statusCode, 200);
    assert.equal(second.res.statusCode, 200);
    assert.equal(first.payload.data.id, second.payload.data.id);
    assert.equal(supabase.state.messageInserts.length, 1);
    assert.equal(supabase.state.nonces.length, 2);
});

test('NewAPI support client_message_id idempotency is scoped to its opaque conversation', async () => {
    const conversation = {
        id: 'conversation-opaque-1',
        product: 'newapi',
        external_user_id: '123',
        external_username: 'newapi-user',
        session_id: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f'
    };
    const supabase = createFakeSupabase({
        conversation,
        messages: [{
            id: 'other-conversation-message',
            product: 'newapi',
            session_id: 'newapi:different-opaque-session',
            client_message_id: 'message-1',
            content: 'An unrelated message',
            is_admin: false,
            created_at: '2026-09-09T11:00:00.000Z'
        }]
    });

    const result = await callGateway(
        createHandler(supabase),
        requestPayload(),
        { nonce: 'nonce-conversation-scoped-012345' }
    );

    assert.equal(result.res.statusCode, 200);
    assert.equal(supabase.state.messageInserts.length, 1);
    assert.equal(supabase.state.messageInserts[0].session_id, conversation.session_id);
});

test('NewAPI support messages remain scoped to the mapped product conversation and include admin replies', async () => {
    const conversation = {
        id: 'conversation-opaque-1',
        product: 'newapi',
        external_user_id: '123',
        external_username: 'newapi-user',
        session_id: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f'
    };
    const supabase = createFakeSupabase({
        conversation,
        messages: [
            {
                id: 'user-message',
                product: 'newapi',
                session_id: conversation.session_id,
                external_user_id: '123',
                content: 'User question',
                is_admin: false,
                created_at: '2026-09-09T11:00:00.000Z',
                client_message_id: 'user-message-1'
            },
            {
                id: 'admin-reply',
                product: 'newapi',
                session_id: conversation.session_id,
                content: 'https://cdn.example.test/support-reply.png',
                is_admin: true,
                message_type: 'image',
                created_at: '2026-09-09T11:01:00.000Z',
                client_message_id: null
            },
            {
                id: 'other-user',
                product: 'newapi',
                session_id: 'newapi:different-opaque-session',
                external_user_id: '999',
                content: 'Other user message',
                is_admin: false,
                created_at: '2026-09-09T11:02:00.000Z'
            },
            {
                id: 'legacy-collision',
                product: 'legacy',
                session_id: conversation.session_id,
                content: 'Legacy message',
                is_admin: true,
                created_at: '2026-09-09T11:03:00.000Z'
            }
        ]
    });
    const result = await callGateway(createHandler(supabase), requestPayload({
        action: 'messages',
        page: undefined,
        text: undefined,
        client_message_id: undefined,
        limit: 20
    }), { nonce: 'nonce-messages-012345678' });

    assert.equal(result.res.statusCode, 200);
    assert.equal(result.payload.success, true);
    assert.deepEqual(result.payload.data.messages.map((message) => message.id), ['user-message', 'admin-reply']);
    assert.deepEqual(result.payload.data.messages.map((message) => message.author), ['user', 'admin']);
    assert.deepEqual(result.payload.data.messages.map((message) => message.message_type), ['text', 'image']);
    assert.equal(result.payload.data.next_cursor, '');
    assert.equal(supabase.state.queryLog.some((entry) => entry.field === 'product' && entry.value === 'newapi'), true);
    assert.equal(supabase.state.queryLog.some((entry) => entry.field === 'session_id' && entry.value === conversation.session_id), true);
    assert.equal(supabase.state.conversationUpserts.length, 0);
});

test('NewAPI support rejects a user idempotency key already owned by an admin reply', async () => {
    const conversation = {
        id: 'conversation-opaque-1',
        product: 'newapi',
        external_user_id: '123',
        external_username: 'newapi-user',
        session_id: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f'
    };
    const supabase = createFakeSupabase({
        conversation,
        messages: [{
            id: 'admin-message-with-colliding-id',
            product: 'newapi',
            session_id: conversation.session_id,
            client_message_id: 'message-1',
            content: 'Administrator reply',
            is_admin: true,
            created_at: '2026-09-09T11:00:00.000Z'
        }]
    });

    const result = await callGateway(createHandler(supabase), requestPayload(), {
        nonce: 'nonce-role-conflict-012345678'
    });

    assert.equal(result.res.statusCode, 409);
    assert.equal(result.payload.code, 'client_message_id_conflict');
    assert.equal(supabase.state.messageInserts.length, 0);
});

test('NewAPI support caps a maximum-size history page below the bridge response limit', async () => {
    const conversation = {
        id: 'conversation-opaque-1',
        product: 'newapi',
        external_user_id: '123',
        external_username: 'newapi-user',
        session_id: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f'
    };
    const supabase = createFakeSupabase({
        conversation,
        messages: Array.from({ length: 50 }, (_, index) => ({
            id: `maximum-message-${index}`,
            product: 'newapi',
            session_id: conversation.session_id,
            content: 'x'.repeat(16 * 1024),
            is_admin: false,
            created_at: `2026-09-09T11:${String(index).padStart(2, '0')}:00.000Z`
        }))
    });
    const handler = createHandler(supabase);
    const pagePayload = requestPayload({
        action: 'messages',
        page: undefined,
        text: undefined,
        client_message_id: undefined,
        limit: 50
    });

    const page = await callGateway(handler, pagePayload, {
        nonce: 'nonce-maximum-history-page-012345'
    });
    assert.equal(page.res.statusCode, 200);
    assert.equal(page.payload.data.messages.length, 50);
    assert.ok(Buffer.byteLength(page.res.body, 'utf8') < (1 << 20));

    const oversizedPage = await callGateway(handler, {
        ...pagePayload,
        limit: 51
    }, {
        nonce: 'nonce-oversized-history-page-012345'
    });
    assert.equal(oversizedPage.res.statusCode, 400);
    assert.equal(oversizedPage.payload.code, 'invalid_request');
});

test('NewAPI support starts history at the newest page and returns each page chronologically', async () => {
    const conversation = {
        id: 'conversation-opaque-1',
        product: 'newapi',
        external_user_id: '123',
        external_username: 'newapi-user',
        session_id: 'newapi:70e83ef5-0181-4efd-9a7b-f827655e243f'
    };
    const supabase = createFakeSupabase({
        conversation,
        messages: Array.from({ length: 5 }, (_, index) => ({
            id: `message-${index + 1}`,
            product: 'newapi',
            session_id: conversation.session_id,
            content: `Message ${index + 1}`,
            is_admin: index === 4,
            created_at: `2026-09-09T11:0${index + 1}:00.000Z`
        }))
    });
    const handler = createHandler(supabase);
    const basePayload = {
        action: 'messages',
        page: undefined,
        text: undefined,
        client_message_id: undefined,
        limit: 2
    };

    const newest = await callGateway(handler, requestPayload(basePayload), {
        nonce: 'nonce-newest-page-012345678'
    });
    assert.equal(newest.res.statusCode, 200);
    assert.deepEqual(
        newest.payload.data.messages.map((message) => message.id),
        ['message-4', 'message-5']
    );
    assert.equal(newest.payload.data.next_cursor, encodeCursor(2));

    const older = await callGateway(handler, requestPayload({
        ...basePayload,
        cursor: newest.payload.data.next_cursor
    }), {
        nonce: 'nonce-older-page-0123456789'
    });
    assert.equal(older.res.statusCode, 200);
    assert.deepEqual(
        older.payload.data.messages.map((message) => message.id),
        ['message-2', 'message-3']
    );
    assert.equal(older.payload.data.next_cursor, encodeCursor(4));
});

test('NewAPI support rejects invalid product and external user identity', async () => {
    const supabase = createFakeSupabase();
    const invalidProduct = await callGateway(createHandler(supabase), requestPayload({ product: 'legacy' }), {
        nonce: 'nonce-invalid-product-0123'
    });
    const invalidUser = await callGateway(createHandler(supabase), requestPayload({
        principal: { user_id: 0, username: 'bad-user' }
    }), {
        nonce: 'nonce-invalid-user-id-0123'
    });

    assert.equal(invalidProduct.res.statusCode, 400);
    assert.equal(invalidUser.res.statusCode, 400);
    assert.equal(supabase.state.nonces.length, 0);
});

test('local preview captures only the NewAPI support gateway raw body', () => {
    assert.equal(shouldCaptureNewApiSupportRawBody({ originalUrl: '/api/newapi-support?test=1' }), true);
    assert.equal(shouldCaptureNewApiSupportRawBody({ originalUrl: '/api/support' }), false);
});

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMAGE_CDN_URL = 'https://cdn.fatherkey.com/chat/newapi-session/pixel.png';

test('NewAPI support send_message uploads an image and persists the public CDN URL', async () => {
    const supabase = createFakeSupabase();
    const uploads = [];
    const handler = createHandler(supabase, {
        uploadChatImage: async (input) => {
            uploads.push(input);
            return IMAGE_CDN_URL;
        }
    });
    const result = await callGateway(handler, requestPayload({
        text: undefined,
        message_type: 'image',
        image_data: PNG_DATA_URL,
        client_message_id: 'image-1'
    }), { nonce: 'nonce-image-upload-01234567' });

    assert.equal(result.res.statusCode, 200);
    assert.equal(result.payload.success, true);
    assert.equal(result.payload.data.message_type, 'image');
    assert.equal(result.payload.data.text, IMAGE_CDN_URL);
    assert.equal(result.payload.data.author, 'user');
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].imageData, PNG_DATA_URL);
    assert.match(uploads[0].sessionId, /^newapi:[0-9a-f-]{36}$/);
    assert.equal(supabase.state.messageInserts.length, 1);
    assert.equal(supabase.state.messageInserts[0].content, IMAGE_CDN_URL);
    assert.equal(supabase.state.messageInserts[0].message_type, 'image');
    assert.equal(JSON.stringify(supabase.state.messageInserts[0]).includes('image_data'), false);
    assert.equal(JSON.stringify(supabase.state.messageInserts[0]).includes(PNG_DATA_URL), false);
    assert.equal(JSON.stringify(supabase.state.messageInserts[0]).includes('base64,'), false);
});

test('NewAPI support does not re-upload an image for a retried client_message_id', async () => {
    const supabase = createFakeSupabase();
    const uploads = [];
    const handler = createHandler(supabase, {
        uploadChatImage: async (input) => {
            uploads.push(input);
            return IMAGE_CDN_URL;
        }
    });
    const payload = requestPayload({
        text: undefined,
        message_type: 'image',
        image_data: PNG_DATA_URL,
        client_message_id: 'image-retry-1'
    });

    const first = await callGateway(handler, payload, { nonce: 'nonce-image-retry-01234567' });
    const second = await callGateway(handler, payload, { nonce: 'nonce-image-retry-98765432' });

    assert.equal(first.res.statusCode, 200);
    assert.equal(second.res.statusCode, 200);
    assert.equal(first.payload.data.id, second.payload.data.id);
    assert.equal(uploads.length, 1);
    assert.equal(supabase.state.messageInserts.length, 1);
});

test('NewAPI support rejects invalid image_data before uploading', async () => {
    const supabase = createFakeSupabase();
    const uploads = [];
    const result = await callGateway(createHandler(supabase, {
        uploadChatImage: async (input) => {
            uploads.push(input);
            return IMAGE_CDN_URL;
        }
    }), requestPayload({
        text: undefined,
        message_type: 'image',
        image_data: 'https://cdn.fatherkey.com/chat/not-a-data-url.png',
        client_message_id: 'image-invalid-1'
    }), { nonce: 'nonce-image-invalid-012345' });

    assert.equal(result.res.statusCode, 400);
    assert.equal(result.payload.code, 'invalid_request');
    assert.equal(uploads.length, 0);
    assert.equal(supabase.state.messageInserts.length, 0);
});
