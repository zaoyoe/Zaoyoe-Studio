'use strict';

const crypto = require('node:crypto');
const { getSupabaseAdmin, sendJson } = require('./_lib/admin');

const GATEWAY_VERSION = 1;
const GATEWAY_PRODUCT = 'newapi';
const GATEWAY_SOURCE = 'newapi_gateway';
const DISPLAY_COMPATIBILITY_SITE = 'cn';
const DEFAULT_MAX_SKEW_SECONDS = 300;
const DEFAULT_MESSAGE_LIMIT = 50;
// A page of 50 maximum-size messages stays below the NewAPI bridge's 1 MiB
// response limit. Keep this in sync with the NewAPI controller and frontend.
const MAX_MESSAGE_LIMIT = 50;
const MAX_RAW_BODY_BYTES = 128 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_MESSAGE_CHARACTERS = 4000;
const NONCE_RETENTION_SKEW_MULTIPLIER = 2;
const NONCE_RETENTION_EXTRA_SECONDS = 60;
const NONCE_CLEANUP_HASH_PREFIX = '00';
const CONVERSATION_SELECT = 'id, product, external_user_id, external_username, external_email, session_id, page_context, created_at, updated_at';
const MESSAGE_SELECT = 'id, content, is_admin, message_type, created_at, client_message_id';
const SUPPORTED_ACTIONS = new Set([
    'context',
    'messages',
    'send_message',
    'admin_conversations',
    'admin_messages',
    'admin_send_message'
]);

class NewApiSupportGatewayError extends Error {
    constructor(message, {
        statusCode = 400,
        code = 'bad_request',
        expose = true
    } = {}) {
        super(message);
        this.name = 'NewApiSupportGatewayError';
        this.statusCode = statusCode;
        this.code = code;
        this.expose = expose;
    }
}

function gatewayError(message, options) {
    return new NewApiSupportGatewayError(message, options);
}

function getHeader(req, name) {
    const headers = req?.headers || {};
    const target = String(name || '').toLowerCase();
    const matchingKey = Object.keys(headers).find((key) => String(key).toLowerCase() === target);
    const value = matchingKey ? headers[matchingKey] : undefined;
    return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function getNowMilliseconds(now) {
    const value = typeof now === 'function' ? now() : now;
    if (value instanceof Date) return value.getTime();
    const milliseconds = Number(value);
    return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

function getMaxSkewSeconds(env = process.env) {
    const configured = String(env?.NEWAPI_SUPPORT_GATEWAY_MAX_SKEW_SECONDS || '').trim();
    if (!configured) return DEFAULT_MAX_SKEW_SECONDS;
    const value = Number(configured);
    if (!Number.isInteger(value) || value < 30 || value > 3600) {
        return DEFAULT_MAX_SKEW_SECONDS;
    }
    return value;
}

function calculateSignature(secret, timestamp, nonce, rawBody) {
    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
    const prefix = Buffer.from(`${timestamp}\n${nonce}\n`, 'utf8');
    return crypto
        .createHmac('sha256', Buffer.from(String(secret || ''), 'utf8'))
        .update(prefix)
        .update(payload)
        .digest('hex');
}

function hashes(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function isSafeSignatureMatch(expected, received) {
    const normalizedReceived = String(received || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(normalizedReceived)) return false;
    const expectedBuffer = Buffer.from(String(expected || ''), 'hex');
    const receivedBuffer = Buffer.from(normalizedReceived, 'hex');
    return expectedBuffer.length === receivedBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function assertNoBrowserIdentityHeaders(req) {
    const prohibitedHeaders = ['authorization', 'cookie', 'x-api-key'];
    const present = prohibitedHeaders.find((header) => getHeader(req, header));
    if (present) {
        throw gatewayError('The support gateway accepts only its HMAC identity envelope', {
            statusCode: 401,
            code: 'unsupported_identity_header'
        });
    }
}

function validateAuthentication(req, rawBody, { env = process.env, now = Date.now } = {}) {
    assertNoBrowserIdentityHeaders(req);

    const secret = String(env?.NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET || '').trim();
    if (!secret) {
        throw gatewayError('The NewAPI support gateway is not configured', {
            statusCode: 500,
            code: 'gateway_not_configured',
            expose: false
        });
    }

    const version = getHeader(req, 'x-newapi-support-version');
    if (version !== String(GATEWAY_VERSION)) {
        throw gatewayError('Unsupported gateway version', {
            statusCode: 401,
            code: 'invalid_gateway_version'
        });
    }

    const timestamp = getHeader(req, 'x-newapi-support-timestamp');
    if (!/^\d{10,11}$/.test(timestamp)) {
        throw gatewayError('Invalid request timestamp', {
            statusCode: 401,
            code: 'invalid_timestamp'
        });
    }

    const timestampSeconds = Number(timestamp);
    if (!Number.isSafeInteger(timestampSeconds) || String(timestampSeconds) !== timestamp) {
        throw gatewayError('Invalid request timestamp', {
            statusCode: 401,
            code: 'invalid_timestamp'
        });
    }

    const nowSeconds = Math.floor(getNowMilliseconds(now) / 1000);
    if (Math.abs(nowSeconds - timestampSeconds) > getMaxSkewSeconds(env)) {
        throw gatewayError('Request timestamp is outside the accepted window', {
            statusCode: 401,
            code: 'stale_timestamp'
        });
    }

    const nonce = getHeader(req, 'x-newapi-support-nonce');
    if (!/^[A-Za-z0-9._~-]{16,200}$/.test(nonce)) {
        throw gatewayError('Invalid request nonce', {
            statusCode: 401,
            code: 'invalid_nonce'
        });
    }

    const signature = getHeader(req, 'x-newapi-support-signature');
    const expectedSignature = calculateSignature(secret, timestamp, nonce, rawBody);
    if (!isSafeSignatureMatch(expectedSignature, signature)) {
        throw gatewayError('Invalid request signature', {
            statusCode: 401,
            code: 'invalid_signature'
        });
    }

    return { nonce, timestamp };
}

async function readRawRequestBody(req, { maxBytes = MAX_RAW_BODY_BYTES } = {}) {
    const suppliedRawBody = req?.rawBody;
    let capturedBody = null;
    if (Buffer.isBuffer(suppliedRawBody)) capturedBody = suppliedRawBody;
    else if (suppliedRawBody instanceof Uint8Array) capturedBody = Buffer.from(suppliedRawBody);
    else if (typeof suppliedRawBody === 'string') capturedBody = Buffer.from(suppliedRawBody, 'utf8');
    else if (Buffer.isBuffer(req?.body)) capturedBody = req.body;
    else if (typeof req?.body === 'string') capturedBody = Buffer.from(req.body, 'utf8');
    if (capturedBody) {
        if (capturedBody.length > maxBytes) {
            throw gatewayError('Request body is too large', {
                statusCode: 413,
                code: 'body_too_large'
            });
        }
        return capturedBody;
    }

    if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
        throw gatewayError('Raw request body is unavailable', {
            statusCode: 400,
            code: 'raw_body_unavailable'
        });
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
            throw gatewayError('Request body is too large', {
                statusCode: 413,
                code: 'body_too_large'
            });
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

function parseRequestBody(rawBody) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        throw gatewayError('A JSON request body is required', { code: 'invalid_body' });
    }

    let parsed;
    try {
        parsed = JSON.parse(rawBody.toString('utf8'));
    } catch (_) {
        throw gatewayError('The request body must be valid JSON', { code: 'invalid_body' });
    }

    if (!isPlainObject(parsed)) {
        throw gatewayError('The request body must be a JSON object', { code: 'invalid_body' });
    }
    return parsed;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBoundedString(value, fieldName, maxLength, { required = false } = {}) {
    if (value === undefined || value === null) {
        if (required) {
            throw gatewayError(`${fieldName} is required`, { code: 'invalid_request' });
        }
        return '';
    }
    if (typeof value !== 'string') {
        throw gatewayError(`${fieldName} must be a string`, { code: 'invalid_request' });
    }
    const normalized = value.trim();
    if (required && !normalized) {
        throw gatewayError(`${fieldName} is required`, { code: 'invalid_request' });
    }
    if (normalized.length > maxLength) {
        throw gatewayError(`${fieldName} is too long`, { code: 'invalid_request' });
    }
    return normalized;
}

function normalizeConversationID(value) {
    const normalized = normalizeBoundedString(value, 'conversation_id', 64, { required: true });
    // Conversation ids are UUIDs generated by Postgres. Keep this strict so
    // the signed bridge cannot be used as a generic database filter.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
        throw gatewayError('conversation_id is invalid', { code: 'invalid_request' });
    }
    return normalized;
}

function normalizePage(page, { required = false } = {}) {
    if (page === undefined || page === null) {
        if (required) {
            throw gatewayError('page is required', { code: 'invalid_request' });
        }
        return null;
    }
    if (!isPlainObject(page)) {
        throw gatewayError('page must be an object', { code: 'invalid_request' });
    }

    const path = normalizeBoundedString(page.path, 'page.path', 512, { required: true });
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('?') || path.includes('#') || path.split('/').includes('..')) {
        throw gatewayError('page.path is invalid', { code: 'invalid_request' });
    }

    const title = normalizeBoundedString(page.title, 'page.title', 160);
    const section = normalizeBoundedString(page.section, 'page.section', 80);
    const requestId = normalizeBoundedString(page.request_id, 'page.request_id', 128);
    return {
        path,
        ...(title ? { title } : {}),
        ...(section ? { section } : {}),
        ...(requestId ? { request_id: requestId } : {})
    };
}

function normalizeCursor(cursor) {
    const value = normalizeBoundedString(cursor, 'cursor', 256);
    if (!value) return 0;
    try {
        const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (!isPlainObject(decoded) || decoded.v !== 1 || !Number.isSafeInteger(decoded.o) || decoded.o < 0 || decoded.o > 100000) {
            throw new Error('Invalid cursor');
        }
        return decoded.o;
    } catch (_) {
        throw gatewayError('cursor is invalid', { code: 'invalid_request' });
    }
}

function encodeCursor(offset) {
    return Buffer.from(JSON.stringify({ v: 1, o: offset }), 'utf8').toString('base64url');
}

function normalizeLimit(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_MESSAGE_LIMIT;
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MESSAGE_LIMIT) {
        throw gatewayError(`limit must be an integer from 1 to ${MAX_MESSAGE_LIMIT}`, { code: 'invalid_request' });
    }
    return value;
}

function normalizeRequestBody(body) {
    if (body.version !== GATEWAY_VERSION || body.product !== GATEWAY_PRODUCT) {
        throw gatewayError('Unsupported support gateway request', { code: 'invalid_request' });
    }
    const action = String(body.action || '').trim();
    if (!SUPPORTED_ACTIONS.has(action)) {
        throw gatewayError('Unsupported support gateway action', { code: 'invalid_action' });
    }
    if (!isPlainObject(body.principal)) {
        throw gatewayError('principal is required', { code: 'invalid_request' });
    }

    const userId = body.principal.user_id;
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw gatewayError('principal.user_id must be a positive integer', { code: 'invalid_request' });
    }
    const username = normalizeBoundedString(body.principal.username, 'principal.username', 160, { required: true });
    const email = normalizeBoundedString(body.principal.email, 'principal.email', 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw gatewayError('principal.email is invalid', { code: 'invalid_request' });
    }

    const isAdminAction = action.startsWith('admin_');
    const page = normalizePage(body.page, { required: !isAdminAction && action !== 'messages' });
    const limit = normalizeLimit(body.limit);
    const cursorOffset = normalizeCursor(body.cursor);
    const conversationID = action === 'admin_messages' || action === 'admin_send_message'
        ? normalizeConversationID(body.conversation_id)
        : '';
    let text = '';
    let clientMessageId = '';
    if (action === 'send_message' || action === 'admin_send_message') {
        text = normalizeBoundedString(body.text, 'text', MAX_MESSAGE_CHARACTERS, { required: true });
        if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
            throw gatewayError('text is too long', { code: 'invalid_request' });
        }
        clientMessageId = normalizeBoundedString(body.client_message_id, 'client_message_id', 128, { required: true });
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(clientMessageId)) {
            throw gatewayError('client_message_id is invalid', { code: 'invalid_request' });
        }
    }

    return {
        action,
        principal: {
            userId,
            externalUserId: String(userId),
            username,
            email: email || null
        },
        page,
        text,
        clientMessageId,
        conversationID,
        limit,
        cursorOffset
    };
}

function maybeSingle(query) {
    if (query && typeof query.maybeSingle === 'function') {
        return query.maybeSingle();
    }
    if (query && typeof query.limit === 'function') {
        return query.limit(1).then(({ data, error }) => ({
            data: Array.isArray(data) ? (data[0] || null) : (data || null),
            error
        }));
    }
    return Promise.resolve({ data: null, error: null });
}

function single(query) {
    if (query && typeof query.single === 'function') {
        return query.single();
    }
    return Promise.resolve(query);
}

function isUniqueViolation(error) {
    return String(error?.code || '') === '23505'
        || /duplicate key|unique constraint/i.test(String(error?.message || ''));
}

async function claimNonce(supabase, request, nonce, rawBody) {
    const { error } = await supabase
        .from('newapi_support_gateway_nonces')
        .insert({
            nonce_hash: hashes(nonce),
            product: GATEWAY_PRODUCT,
            principal_external_user_id: request.principal.externalUserId,
            action: request.action,
            request_body_sha256: hashes(rawBody)
        });

    if (!error) return;
    if (isUniqueViolation(error)) {
        throw gatewayError('This request nonce has already been used', {
            statusCode: 409,
            code: 'replayed_nonce'
        });
    }
    throw gatewayError('Unable to persist support gateway request', {
        statusCode: 500,
        code: 'nonce_persistence_failed',
        expose: false
    });
}

function shouldPruneExpiredNonces(nonce) {
    // Keep normal polling inexpensive while ensuring active gateway traffic
    // eventually removes nonce records that can no longer be replayed.
    return hashes(nonce).startsWith(NONCE_CLEANUP_HASH_PREFIX);
}

async function pruneExpiredNonces(supabase, { env = process.env, now = Date.now } = {}) {
    const retentionSeconds = (getMaxSkewSeconds(env) * NONCE_RETENTION_SKEW_MULTIPLIER)
        + NONCE_RETENTION_EXTRA_SECONDS;
    const cutoff = new Date(getNowMilliseconds(now) - (retentionSeconds * 1000)).toISOString();

    try {
        const table = supabase?.from?.('newapi_support_gateway_nonces');
        if (!table || typeof table.delete !== 'function') return false;
        const query = table.delete();
        if (!query || typeof query.lt !== 'function') return false;
        const { error } = await query.lt('created_at', cutoff);
        if (error) throw error;
        return true;
    } catch (error) {
        // Cleanup must never turn a valid support request into an outage.
        console.warn('[NewAPI support gateway] Nonce cleanup failed:', error?.message || error);
        return false;
    }
}

async function upsertConversation(supabase, request, nowMilliseconds) {
    const payload = {
        product: GATEWAY_PRODUCT,
        external_user_id: request.principal.externalUserId,
        external_username: request.principal.username
    };
    // Polling context/history must not make an idle conversation look active.
    // New conversations receive the table default; sends explicitly advance it.
    if (request.action === 'send_message') {
        payload.updated_at = new Date(nowMilliseconds).toISOString();
    }
    if (request.principal.email) payload.external_email = request.principal.email;
    if (request.page) payload.page_context = request.page;
    let query = supabase
        .from('newapi_support_conversations')
        .upsert(payload, {
            onConflict: 'product,external_user_id'
        });
    if (typeof query.select === 'function') query = query.select(CONVERSATION_SELECT);
    const { data, error } = await single(query);
    if (error || !data?.id || !data?.session_id) {
        throw gatewayError('Unable to resolve support conversation', {
            statusCode: 500,
            code: 'conversation_persistence_failed',
            expose: false
        });
    }
    return data;
}

function serializeMessage(row = {}) {
    return {
        id: String(row.id || ''),
        text: String(row.content || ''),
        author: row.is_admin ? 'admin' : 'user',
        message_type: row.message_type === 'image' ? 'image' : 'text',
        created_at: row.created_at || null,
        client_message_id: row.client_message_id || null
    };
}

function serializeConversation(conversation = {}) {
    return {
        id: String(conversation.id || ''),
        status: 'open'
    };
}

function serializeAdminConversation(conversation = {}) {
    return {
        id: String(conversation.id || ''),
        external_user_id: String(conversation.external_user_id || ''),
        external_username: String(conversation.external_username || ''),
        external_email: conversation.external_email || null,
        page_context: isPlainObject(conversation.page_context) ? conversation.page_context : {},
        created_at: conversation.created_at || null,
        updated_at: conversation.updated_at || null,
        status: 'open'
    };
}

async function listMessages(supabase, conversation, { limit, cursorOffset }) {
    let query = supabase
        .from('chat_messages')
        .select(MESSAGE_SELECT)
        .eq('product', GATEWAY_PRODUCT)
        .eq('session_id', conversation.session_id)
        // The first page is the active end of the conversation. Older pages
        // remain addressable through next_cursor, while the response itself is
        // reversed below so the client can render it chronologically.
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });

    if (typeof query.range === 'function') {
        query = query.range(cursorOffset, cursorOffset + limit);
    } else if (typeof query.limit === 'function') {
        query = query.limit(limit + 1);
    }

    const { data, error } = await query;
    if (error) {
        throw gatewayError('Unable to load support messages', {
            statusCode: 500,
            code: 'message_read_failed',
            expose: false
        });
    }

    const rows = Array.isArray(data) ? data : [];
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse().map(serializeMessage);
    return {
        messages,
        next_cursor: hasMore ? encodeCursor(cursorOffset + limit) : ''
    };
}

async function listAdminConversations(supabase, { limit, cursorOffset }) {
    let query = supabase
        .from('newapi_support_conversations')
        .select(CONVERSATION_SELECT)
        .eq('product', GATEWAY_PRODUCT)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false });

    if (typeof query.range === 'function') {
        query = query.range(cursorOffset, cursorOffset + limit);
    } else if (typeof query.limit === 'function') {
        query = query.limit(limit + 1);
    }

    const { data, error } = await query;
    if (error) {
        throw gatewayError('Unable to load support conversations', {
            statusCode: 500,
            code: 'conversation_read_failed',
            expose: false
        });
    }

    const rows = Array.isArray(data) ? data : [];
    const hasMore = rows.length > limit;
    return {
        conversations: rows.slice(0, limit).map(serializeAdminConversation),
        next_cursor: hasMore ? encodeCursor(cursorOffset + limit) : ''
    };
}

async function findConversation(supabase, conversationID) {
    let query = supabase
        .from('newapi_support_conversations')
        .select(CONVERSATION_SELECT)
        .eq('product', GATEWAY_PRODUCT)
        .eq('id', conversationID);
    const { data, error } = await maybeSingle(query);
    if (error) {
        throw gatewayError('Unable to load support conversation', {
            statusCode: 500,
            code: 'conversation_read_failed',
            expose: false
        });
    }
    if (!data) {
        throw gatewayError('Support conversation was not found', {
            statusCode: 404,
            code: 'conversation_not_found'
        });
    }
    return data;
}

async function findExistingMessage(supabase, conversation, clientMessageId) {
    const query = supabase
        .from('chat_messages')
        .select(MESSAGE_SELECT)
        .eq('product', GATEWAY_PRODUCT)
        .eq('session_id', conversation.session_id)
        .eq('client_message_id', clientMessageId);
    const { data, error } = await maybeSingle(query);
    if (error) {
        throw gatewayError('Unable to load support message', {
            statusCode: 500,
            code: 'message_read_failed',
            expose: false
        });
    }
    return data || null;
}

async function createMessage(supabase, conversation, request) {
    const existing = await findExistingMessage(supabase, conversation, request.clientMessageId);
    if (existing) {
        if (existing.is_admin === true) {
            throw gatewayError('client_message_id is already in use', {
                statusCode: 409,
                code: 'client_message_id_conflict'
            });
        }
        return serializeMessage(existing);
    }

    const row = {
        user_id: null,
        session_id: conversation.session_id,
        // The site field keeps the existing Admin Studio's China queue working;
        // `product` and the external identity are the authoritative boundary.
        site: DISPLAY_COMPATIBILITY_SITE,
        product: GATEWAY_PRODUCT,
        source: GATEWAY_SOURCE,
        external_user_id: request.principal.externalUserId,
        external_username: request.principal.username,
        external_email: request.principal.email,
        client_message_id: request.clientMessageId,
        page_context: request.page || {},
        content: request.text,
        message_type: 'text',
        is_admin: false
    };

    let query = supabase.from('chat_messages').insert(row);
    if (typeof query.select === 'function') query = query.select(MESSAGE_SELECT);
    const { data, error } = await single(query);
    if (!error && data) return serializeMessage(data);

    if (isUniqueViolation(error)) {
        const duplicate = await findExistingMessage(supabase, conversation, request.clientMessageId);
        if (duplicate && duplicate.is_admin !== true) return serializeMessage(duplicate);
        throw gatewayError('client_message_id is already in use', {
            statusCode: 409,
            code: 'client_message_id_conflict'
        });
    }

    throw gatewayError('Unable to create support message', {
        statusCode: 500,
        code: 'message_write_failed',
        expose: false
    });
}

async function createAdminMessage(supabase, conversation, request) {
    const existing = await findExistingMessage(supabase, conversation, request.clientMessageId);
    if (existing) {
        if (existing.is_admin !== true) {
            throw gatewayError('client_message_id is already in use', {
                statusCode: 409,
                code: 'client_message_id_conflict'
            });
        }
        return serializeMessage(existing);
    }

    const row = {
        user_id: null,
        session_id: conversation.session_id,
        site: DISPLAY_COMPATIBILITY_SITE,
        product: GATEWAY_PRODUCT,
        source: 'newapi_admin_gateway',
        external_user_id: conversation.external_user_id,
        external_username: conversation.external_username,
        external_email: conversation.external_email || null,
        client_message_id: request.clientMessageId,
        page_context: request.page || {},
        content: request.text,
        message_type: 'text',
        is_admin: true
    };

    let query = supabase.from('chat_messages').insert(row);
    if (typeof query.select === 'function') query = query.select(MESSAGE_SELECT);
    const { data, error } = await single(query);
    if (!error && data) return serializeMessage(data);

    if (isUniqueViolation(error)) {
        const duplicate = await findExistingMessage(supabase, conversation, request.clientMessageId);
        if (duplicate?.is_admin === true) return serializeMessage(duplicate);
        throw gatewayError('client_message_id is already in use', {
            statusCode: 409,
            code: 'client_message_id_conflict'
        });
    }

    throw gatewayError('Unable to create support message', {
        statusCode: 500,
        code: 'message_write_failed',
        expose: false
    });
}

async function touchConversation(supabase, conversation, nowMilliseconds) {
    const table = supabase?.from?.('newapi_support_conversations');
    if (!table || typeof table.update !== 'function') return;
    let query = table.update({ updated_at: new Date(nowMilliseconds).toISOString() });
    if (typeof query.eq !== 'function') return;
    query = query.eq('id', conversation.id).eq('product', GATEWAY_PRODUCT);
    const result = await query;
    if (result?.error) {
        throw gatewayError('Unable to update support conversation', {
            statusCode: 500,
            code: 'conversation_update_failed',
            expose: false
        });
    }
}

function sendGatewayError(res, error) {
    const statusCode = Number(error?.statusCode) || 500;
    const isExpected = error instanceof NewApiSupportGatewayError;
    const message = isExpected && error.expose !== false
        ? error.message
        : 'The support gateway could not process this request';
    sendJson(res, statusCode, {
        success: false,
        code: isExpected ? error.code : 'internal_error',
        message
    });
}

function createNewApiSupportHandler(options = {}) {
    const resolveSupabase = options.getSupabaseAdmin || getSupabaseAdmin;
    const env = options.env || process.env;
    const now = options.now || Date.now;
    const readBody = options.readRawBody || readRawRequestBody;

    return async function newApiSupportHandler(req, res) {
        try {
            if (String(req?.method || '').toUpperCase() !== 'POST') {
                res.setHeader('Allow', 'POST');
                throw gatewayError('Method not allowed', {
                    statusCode: 405,
                    code: 'method_not_allowed'
                });
            }

            const rawBody = await readBody(req, { maxBytes: MAX_RAW_BODY_BYTES });
            const authentication = validateAuthentication(req, rawBody, { env, now });
            const request = normalizeRequestBody(parseRequestBody(rawBody));
            const supabase = resolveSupabase();
            if (!supabase?.from) {
                throw gatewayError('Support data service is unavailable', {
                    statusCode: 500,
                    code: 'data_service_unavailable',
                    expose: false
                });
            }

            await claimNonce(supabase, request, authentication.nonce, rawBody);
            if (shouldPruneExpiredNonces(authentication.nonce)) {
                await pruneExpiredNonces(supabase, { env, now });
            }

            if (request.action === 'admin_conversations') {
                const conversations = await listAdminConversations(supabase, request);
                return sendJson(res, 200, {
                    success: true,
                    data: conversations
                });
            }

            if (request.action === 'admin_messages' || request.action === 'admin_send_message') {
                const conversation = await findConversation(supabase, request.conversationID);
                if (request.action === 'admin_messages') {
                    const messagePage = await listMessages(supabase, conversation, request);
                    return sendJson(res, 200, {
                        success: true,
                        data: messagePage
                    });
                }

                const message = await createAdminMessage(supabase, conversation, request);
                // The chat message is the authoritative write. This explicit
                // conversation update is only a fallback for deployments that
                // have not applied the trigger migration yet, so a failure
                // here must not turn a successful reply into a retryable 500.
                try {
                    await touchConversation(supabase, conversation, getNowMilliseconds(now));
                } catch (error) {
                    console.warn('[NewAPI support gateway] Could not update conversation activity:', error?.message || error);
                }
                return sendJson(res, 200, {
                    success: true,
                    data: message
                });
            }

            const conversation = await upsertConversation(supabase, request, getNowMilliseconds(now));

            if (request.action === 'context') {
                const messagePage = await listMessages(supabase, conversation, request);
                return sendJson(res, 200, {
                    success: true,
                    data: {
                        conversation: serializeConversation(conversation),
                        messages: messagePage.messages,
                        unread_count: 0
                    }
                });
            }

            if (request.action === 'messages') {
                const messagePage = await listMessages(supabase, conversation, request);
                return sendJson(res, 200, {
                    success: true,
                    data: messagePage
                });
            }

            const message = await createMessage(supabase, conversation, request);
            return sendJson(res, 200, {
                success: true,
                data: message
            });
        } catch (error) {
            if (!(error instanceof NewApiSupportGatewayError)) {
                console.error('[NewAPI support gateway] Unexpected request failure:', error?.message || error);
            }
            return sendGatewayError(res, error);
        }
    };
}

const handler = createNewApiSupportHandler();

module.exports = handler;
module.exports.config = {
    api: {
        bodyParser: false
    }
};
module.exports.NewApiSupportGatewayError = NewApiSupportGatewayError;
module.exports.calculateSignature = calculateSignature;
module.exports.createNewApiSupportHandler = createNewApiSupportHandler;
module.exports.encodeCursor = encodeCursor;
module.exports.normalizeRequestBody = normalizeRequestBody;
module.exports.pruneExpiredNonces = pruneExpiredNonces;
module.exports.readRawRequestBody = readRawRequestBody;
module.exports.shouldPruneExpiredNonces = shouldPruneExpiredNonces;
