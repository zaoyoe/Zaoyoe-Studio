const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateSignature,
    createNewApiSupportHandler
} = require('../api/newapi-support');

const SECRET = 'newapi-support-admin-test-secret';
const NOW_MS = Date.parse('2026-09-09T12:00:00.000Z');
const CONVERSATION_ID = '123e4567-e89b-12d3-a456-426614174000';
const SESSION_ID = 'newapi:3fb7e5ae-f7bf-4b30-8ec0-7e13cbf0f6e4';

function response() {
    const state = { statusCode: 200, body: '' };
    return {
        status(code) { state.statusCode = code; return this; },
        setHeader() { return this; },
        end(body = '') { state.body = String(body); return this; },
        json() { return JSON.parse(state.body || '{}'); },
        get statusCode() { return state.statusCode; }
    };
}

function createAdminFakeSupabase({ failConversationUpdate = false } = {}) {
    const state = {
        nonces: new Set(),
        conversations: [{
            id: CONVERSATION_ID,
            product: 'newapi',
            external_user_id: '42',
            external_username: 'newapi-admin-test',
            external_email: 'newapi@example.com',
            session_id: SESSION_ID,
            page_context: { path: '/dashboard' },
            created_at: '2026-09-09T11:00:00.000Z',
            updated_at: '2026-09-09T12:00:00.000Z',
            last_message_is_admin: false
        }],
        messages: [{
            id: 'user-message-1',
            product: 'newapi',
            session_id: SESSION_ID,
            content: 'Can you help?',
            is_admin: false,
            message_type: 'text',
            created_at: '2026-09-09T11:01:00.000Z',
            client_message_id: 'user-message-1'
        }]
    };

    const clone = (value) => JSON.parse(JSON.stringify(value));
    function queryRows(table, filters, sorts, range, limit) {
        let rows = [...table];
        rows = rows.filter((row) => filters.every(({ field, value }) => String(row[field] ?? '') === String(value ?? '')));
        for (const { field, ascending } of [...sorts].reverse()) {
            rows.sort((left, right) => {
                const a = String(left[field] ?? '');
                const b = String(right[field] ?? '');
                return (ascending ? 1 : -1) * a.localeCompare(b);
            });
        }
        if (range) rows = rows.slice(range[0], range[1] + 1);
        if (limit !== null) rows = rows.slice(0, limit);
        return rows;
    }

    function selectQuery(table) {
        const filters = [];
        const sorts = [];
        let range = null;
        let limit = null;
        const execute = () => clone(queryRows(table, filters, sorts, range, limit));
        return {
            eq(field, value) { filters.push({ field, value }); return this; },
            order(field, options = {}) { sorts.push({ field, ascending: options.ascending !== false }); return this; },
            range(from, to) { range = [from, to]; return this; },
            limit(value) { limit = value; return this; },
            async maybeSingle() { return { data: execute()[0] || null, error: null }; },
            then(resolve, reject) { return Promise.resolve({ data: execute(), error: null }).then(resolve, reject); }
        };
    }

    return {
        state,
        from(tableName) {
            if (tableName === 'newapi_support_gateway_nonces') {
                return {
                    async insert(payload) {
                        if (state.nonces.has(payload.nonce_hash)) return { error: { code: '23505' } };
                        state.nonces.add(payload.nonce_hash);
                        return { error: null };
                    },
                    delete() { return { async lt() { return { error: null }; } }; }
                };
            }
            if (tableName === 'newapi_support_conversations') {
                return {
                    select() { return selectQuery(state.conversations); },
                    update(payload) {
                        return {
                            eq(field, value) {
                                if (failConversationUpdate) {
                                    return this;
                                }
                                if (field === 'id') {
                                    const row = state.conversations.find((item) => item.id === value);
                                    if (row) Object.assign(row, payload);
                                }
                                return this;
                            },
                            then(resolve, reject) {
                                const result = failConversationUpdate
                                    ? { error: { message: 'temporary conversation update failure' } }
                                    : { error: null };
                                return Promise.resolve(result).then(resolve, reject);
                            }
                        };
                    }
                };
            }
            if (tableName === 'chat_messages') {
                return {
                    select() { return selectQuery(state.messages); },
                    insert(payload) {
                        return {
                            select() {
                                return {
                                    async single() {
                                        if (state.messages.some((message) => message.client_message_id === payload.client_message_id)) {
                                            return { data: null, error: { code: '23505' } };
                                        }
                                        const row = { id: 'admin-message-1', created_at: '2026-09-09T12:00:00.000Z', ...payload };
                                        state.messages.push(row);
                                        return { data: clone(row), error: null };
                                    }
                                };
                            }
                        };
                    }
                };
            }
            throw new Error(`Unexpected table ${tableName}`);
        }
    };
}

async function call(handler, payload, nonce) {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const request = {
        method: 'POST',
        rawBody,
        headers: {
            'x-newapi-support-version': '1',
            'x-newapi-support-timestamp': String(Math.floor(NOW_MS / 1000)),
            'x-newapi-support-nonce': nonce,
            'x-newapi-support-signature': calculateSignature(SECRET, String(Math.floor(NOW_MS / 1000)), nonce, rawBody)
        }
    };
    const result = response();
    await handler(request, result);
    return { result, payload: result.json() };
}

function adminPayload(action, overrides = {}) {
    return {
        version: 1,
        product: 'newapi',
        action,
        principal: { user_id: 7, username: 'operator', email: 'operator@example.com' },
        limit: 50,
        ...overrides
    };
}

test('NewAPI admin gateway lists conversations without exposing the private chat session id', async () => {
    const supabase = createAdminFakeSupabase();
    const handler = createNewApiSupportHandler({
        env: { NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET: SECRET },
        now: NOW_MS,
        getSupabaseAdmin: () => supabase
    });

    const result = await call(handler, adminPayload('admin_conversations'), 'admin-list-nonce-012345');
    assert.equal(result.result.statusCode, 200);
    assert.equal(result.payload.success, true);
    assert.deepEqual(result.payload.data.conversations[0], {
        id: CONVERSATION_ID,
        external_user_id: '42',
        external_username: 'newapi-admin-test',
        external_email: 'newapi@example.com',
        page_context: { path: '/dashboard' },
        created_at: '2026-09-09T11:00:00.000Z',
        updated_at: '2026-09-09T12:00:00.000Z',
        last_message_is_admin: false,
        status: 'open'
    });
    assert.equal(JSON.stringify(result.payload).includes(SESSION_ID), false);
});

test('NewAPI admin gateway reads and writes the same product conversation', async () => {
    const supabase = createAdminFakeSupabase();
    const handler = createNewApiSupportHandler({
        env: { NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET: SECRET },
        now: NOW_MS,
        getSupabaseAdmin: () => supabase
    });

    const history = await call(handler, adminPayload('admin_messages', { conversation_id: CONVERSATION_ID }), 'admin-history-nonce-012345');
    assert.equal(history.result.statusCode, 200);
    assert.equal(history.payload.data.messages[0].author, 'user');

    const reply = await call(handler, adminPayload('admin_send_message', {
        conversation_id: CONVERSATION_ID,
        text: 'Of course.',
        client_message_id: 'admin-message-1'
    }), 'admin-reply-nonce-012345');
    assert.equal(reply.result.statusCode, 200);
    assert.equal(reply.payload.data.author, 'admin');
    assert.equal(supabase.state.messages.at(-1).is_admin, true);
    assert.equal(supabase.state.messages.at(-1).source, 'newapi_admin_gateway');
    assert.equal(supabase.state.conversations[0].last_message_is_admin, true);
});

test('NewAPI admin gateway rejects an idempotency key already owned by a user message', async () => {
    const supabase = createAdminFakeSupabase();
    const handler = createNewApiSupportHandler({
        env: { NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET: SECRET },
        now: NOW_MS,
        getSupabaseAdmin: () => supabase
    });

    const reply = await call(handler, adminPayload('admin_send_message', {
        conversation_id: CONVERSATION_ID,
        text: 'This must not reuse the user message.',
        client_message_id: 'user-message-1'
    }), 'admin-role-conflict-nonce-012345');

    assert.equal(reply.result.statusCode, 409);
    assert.equal(reply.payload.code, 'client_message_id_conflict');
    assert.equal(supabase.state.messages.length, 1);
});

test('NewAPI admin gateway returns the inserted reply when the activity fallback fails', async (t) => {
    const supabase = createAdminFakeSupabase({ failConversationUpdate: true });
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    t.after(() => { console.warn = originalWarn; });
    const handler = createNewApiSupportHandler({
        env: { NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET: SECRET },
        now: NOW_MS,
        getSupabaseAdmin: () => supabase
    });

    const reply = await call(handler, adminPayload('admin_send_message', {
        conversation_id: CONVERSATION_ID,
        text: 'The reply must remain successful.',
        client_message_id: 'admin-message-update-fallback'
    }), 'admin-update-fallback-nonce-012345');

    assert.equal(reply.result.statusCode, 200);
    assert.equal(reply.payload.success, true);
    assert.equal(reply.payload.data.text, 'The reply must remain successful.');
    assert.equal(supabase.state.messages.length, 2);

    const retry = await call(handler, adminPayload('admin_send_message', {
        conversation_id: CONVERSATION_ID,
        text: 'The reply must remain successful.',
        client_message_id: 'admin-message-update-fallback'
    }), 'admin-update-fallback-retry-nonce-012345');

    assert.equal(retry.result.statusCode, 200);
    assert.equal(retry.payload.data.id, reply.payload.data.id);
    assert.equal(supabase.state.messages.length, 2);
    assert.equal(warnings.length, 2);
});

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ADMIN_IMAGE_CDN_URL = 'https://cdn.fatherkey.com/chat/newapi-admin/pixel.png';

test('NewAPI admin gateway uploads an image reply and persists the public CDN URL', async () => {
    const supabase = createAdminFakeSupabase();
    const uploads = [];
    const handler = createNewApiSupportHandler({
        env: { NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET: SECRET },
        now: NOW_MS,
        getSupabaseAdmin: () => supabase,
        uploadChatImage: async (input) => {
            uploads.push(input);
            return ADMIN_IMAGE_CDN_URL;
        }
    });

    const reply = await call(handler, adminPayload('admin_send_message', {
        conversation_id: CONVERSATION_ID,
        text: undefined,
        message_type: 'image',
        image_data: PNG_DATA_URL,
        client_message_id: 'admin-image-1'
    }), 'admin-image-nonce-012345');

    assert.equal(reply.result.statusCode, 200);
    assert.equal(reply.payload.success, true);
    assert.equal(reply.payload.data.author, 'admin');
    assert.equal(reply.payload.data.message_type, 'image');
    assert.equal(reply.payload.data.text, ADMIN_IMAGE_CDN_URL);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].imageData, PNG_DATA_URL);
    assert.equal(uploads[0].sessionId, SESSION_ID);
    assert.equal(supabase.state.messages.at(-1).is_admin, true);
    assert.equal(supabase.state.messages.at(-1).content, ADMIN_IMAGE_CDN_URL);
    assert.equal(supabase.state.messages.at(-1).message_type, 'image');
    assert.equal(JSON.stringify(supabase.state.messages.at(-1)).includes(PNG_DATA_URL), false);
    assert.equal(supabase.state.conversations[0].last_message_is_admin, true);
});

test('NewAPI admin gateway does not re-upload an image for a retried client_message_id', async () => {
    const supabase = createAdminFakeSupabase();
    const uploads = [];
    const handler = createNewApiSupportHandler({
        env: { NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET: SECRET },
        now: NOW_MS,
        getSupabaseAdmin: () => supabase,
        uploadChatImage: async (input) => {
            uploads.push(input);
            return ADMIN_IMAGE_CDN_URL;
        }
    });
    const payload = adminPayload('admin_send_message', {
        conversation_id: CONVERSATION_ID,
        text: undefined,
        message_type: 'image',
        image_data: PNG_DATA_URL,
        client_message_id: 'admin-image-retry-1'
    });

    const first = await call(handler, payload, 'admin-image-retry-nonce-01');
    const second = await call(handler, payload, 'admin-image-retry-nonce-02');

    assert.equal(first.result.statusCode, 200);
    assert.equal(second.result.statusCode, 200);
    assert.equal(first.payload.data.id, second.payload.data.id);
    assert.equal(uploads.length, 1);
    assert.equal(supabase.state.messages.filter((row) => row.client_message_id === 'admin-image-retry-1').length, 1);
});
