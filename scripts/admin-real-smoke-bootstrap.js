#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_SUPER_SESSION_FILE = '/tmp/real_admin_session.json';
const DEFAULT_LIMITED_SESSION_FILE = '/tmp/limited_admin_session.json';
const DEFAULT_CUSTOMER_SESSION_FILE = '/tmp/real_customer_session.json';
const DEFAULT_PROBE_FILE = '/tmp/real_admin_probe_context.json';
const DEFAULT_LIMITED_PERMISSIONS = Object.freeze([
    'chat.manage',
    'tickets.manage',
    'users.manage'
]);
const DEFAULT_SUPER_PERMISSIONS = Object.freeze(['*']);

function parseArgs(argv = []) {
    const options = {
        baseUrl: DEFAULT_BASE_URL,
        superSessionFile: DEFAULT_SUPER_SESSION_FILE,
        limitedSessionFile: DEFAULT_LIMITED_SESSION_FILE,
        customerSessionFile: DEFAULT_CUSTOMER_SESSION_FILE,
        probeFile: DEFAULT_PROBE_FILE,
        limitedEmail: '',
        limitedPassword: '',
        customerEmail: '',
        customerPassword: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim() || DEFAULT_BASE_URL;
            index += 1;
            continue;
        }
        if (value === '--super-session-file') {
            options.superSessionFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }
        if (value === '--limited-session-file') {
            options.limitedSessionFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }
        if (value === '--customer-session-file') {
            options.customerSessionFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }
        if (value === '--probe-file') {
            options.probeFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }
        if (value === '--limited-email') {
            options.limitedEmail = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--limited-password') {
            options.limitedPassword = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--customer-email') {
            options.customerEmail = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--customer-password') {
            options.customerPassword = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
    }

    return options;
}

function normalizeBaseUrl(value) {
    const raw = String(value || '').trim() || DEFAULT_BASE_URL;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return normalized.replace(/\/+$/, '');
}

function createPassword(prefix = 'Codex') {
    return `${prefix}!${Date.now()}Aa1${crypto.randomBytes(4).toString('hex')}`;
}

function createEmail(prefix = 'codex.real') {
    return `${prefix}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}@example.com`;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function toBase64Url(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

async function fetchRuntimeConfig(baseUrl) {
    const response = await fetch(`${baseUrl}/api/runtime/supabase-config`, {
        headers: {
            Accept: 'application/javascript'
        },
        signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Failed to load runtime config (${response.status})`);
    }

    const match = text.match(/var config = (\{[\s\S]*?\});/);
    if (!match) {
        throw new Error('Failed to parse runtime Supabase config');
    }

    return JSON.parse(match[1]);
}

function createPublicClient(publicConfig) {
    return createClient(publicConfig.url, publicConfig.publishableKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            flowType: 'implicit'
        }
    });
}

async function restoreSession(client, sessionPayload = {}) {
    const access_token = String(sessionPayload.access_token || '').trim();
    const refresh_token = String(sessionPayload.refresh_token || '').trim();
    if (!access_token || !refresh_token) {
        throw new Error('Session file is missing access_token or refresh_token');
    }

    const { data, error } = await client.auth.setSession({
        access_token,
        refresh_token
    });
    if (error) {
        throw new Error(error.message || 'Failed to restore Supabase session');
    }
    if (!data?.session) {
        throw new Error('Supabase session restore returned no session');
    }
    return data.session;
}

async function verifyAdminAccess(client, expected = 'super') {
    const {
        data: { user }
    } = await client.auth.getUser();
    if (!user?.id) {
        throw new Error('No authenticated user is available after session restore');
    }

    const { data, error } = await client.rpc('get_user_permissions', { p_user_id: user.id });
    if (error) {
        throw new Error(error.message || 'Failed to resolve admin access');
    }
    if (!data?.is_admin && !data?.is_super_admin) {
        throw new Error(`Expected ${expected} admin access but current session is not an admin`);
    }
    if (expected === 'super' && data?.is_super_admin !== true) {
        throw new Error('Expected a super-admin session for real smoke bootstrap');
    }

    return {
        user,
        access: data
    };
}

async function signUpOrSignIn(client, email, password, baseUrl) {
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (!signInError && signInData?.session?.access_token) {
        return {
            session: signInData.session,
            user: signInData.user || null,
            mode: 'sign_in'
        };
    }

    const { data: signUpData, error: signUpError } = await client.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${baseUrl}/auth-callback.html`
        }
    });
    if (signUpError) {
        throw new Error(signUpError.message || `Failed to create user ${email}`);
    }

    if (signUpData?.session?.access_token) {
        return {
            session: signUpData.session,
            user: signUpData.user || null,
            mode: 'sign_up'
        };
    }

    const { data: retrySignInData, error: retrySignInError } = await client.auth.signInWithPassword({ email, password });
    if (retrySignInError || !retrySignInData?.session?.access_token) {
        throw new Error(
            retrySignInError?.message
                || `Created ${email} but failed to obtain a usable login session`
        );
    }

    return {
        session: retrySignInData.session,
        user: retrySignInData.user || signUpData?.user || null,
        mode: 'sign_in_after_sign_up'
    };
}

async function ensureAuthUser(options = {}, publicConfig, baseUrl) {
    const email = String(options.email || '').trim() || createEmail(options.emailPrefix || 'codex.user');
    const password = String(options.password || '').trim() || createPassword(options.passwordPrefix || 'Codex');
    const client = createPublicClient(publicConfig);
    const result = await signUpOrSignIn(client, email, password, baseUrl);
    const {
        data: { user }
    } = await client.auth.getUser();

    if (!user?.id) {
        throw new Error(`Failed to resolve created user identity for ${email}`);
    }

    return {
        email,
        password,
        userId: user.id,
        session: result.session,
        authMode: result.mode
    };
}

async function grantAdminRole(superClient, grantorUserId, targetUserId, options = {}) {
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await superClient
        .from('admin_roles')
        .upsert({
            user_id: targetUserId,
            role_name: String(options.roleName || 'admin').trim() || 'admin',
            permissions: Array.isArray(options.permissions) ? options.permissions : [],
            expires_at: options.expiresAt || expiresAt,
            granted_by: grantorUserId,
            granted_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

    if (error) {
        throw new Error(error.message || 'Failed to grant admin role');
    }

    return {
        permissions: Array.isArray(options.permissions) ? options.permissions : [],
        expiresAt: options.expiresAt || expiresAt,
        roleName: String(options.roleName || 'admin').trim() || 'admin'
    };
}

async function verifyLimitedAdmin(client, userId) {
    const { data, error } = await client.rpc('get_user_permissions', { p_user_id: userId });
    if (error) {
        throw new Error(error.message || 'Failed to verify limited admin permissions');
    }
    if (!data?.is_admin || data?.is_super_admin) {
        throw new Error('Limited admin session did not resolve to a non-super admin role');
    }
    return data;
}

async function safeMaybeSingle(queryPromise) {
    const { data, error } = await queryPromise;
    if (error) {
        throw new Error(error.message || 'Supabase query failed');
    }
    return data || null;
}

async function safeSelect(queryPromise) {
    const { data, error } = await queryPromise;
    if (error) {
        throw new Error(error.message || 'Supabase query failed');
    }
    return Array.isArray(data) ? data : [];
}

async function fetchUserProbeContext(client, userId) {
    const [
        profile,
        orders,
        payments,
        verifications,
        tickets,
        chatMessages
    ] = await Promise.all([
        safeMaybeSingle(
            client
                .from('profiles')
                .select('id, email, display_name, username, avatar_url')
                .eq('id', userId)
                .maybeSingle()
        ).catch(() => null),
        safeSelect(
            client
                .from('shop_orders')
                .select('id, user_id, created_at, price_paid, snapshot_product_name, refund_status, delivery_status')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(2)
        ).catch(() => []),
        safeSelect(
            client
                .from('payment_orders')
                .select('id, user_id, created_at, package_name, paid_amount, expected_amount, status, provider')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(2)
        ).catch(() => []),
        safeSelect(
            client
                .from('verification_logs')
                .select('verification_id, user_id, status, message, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(2)
        ).catch(() => []),
        safeSelect(
            client
                .from('shop_tickets')
                .select('id, user_id, order_id, issue_type, status, description, session_id, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(2)
        ).catch(() => []),
        safeSelect(
            client
                .from('chat_messages')
                .select('id, session_id, user_id, is_admin, content, message_type, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(10)
        ).catch(() => [])
    ]);

    const userMessage = chatMessages.find((item) => item?.is_admin !== true) || chatMessages[0] || null;
    const chatSessionId = String(
        userMessage?.session_id
        || tickets[0]?.session_id
        || chatMessages[0]?.session_id
        || ''
    ).trim();
    const score = [
        chatSessionId,
        orders[0]?.id,
        payments[0]?.id,
        verifications[0]?.verification_id,
        tickets[0]?.id
    ].filter(Boolean).length;

    return {
        score,
        profile,
        chatSessionId,
        userId,
        userEmail: String(profile?.email || '').trim(),
        chat: userMessage || null,
        order: orders[0] || null,
        payment: payments[0] || null,
        verification: verifications[0] || null,
        ticket: tickets[0] || null,
        orders,
        payments,
        verifications,
        tickets
    };
}

async function buildProbeContext(client, excludedUserIds = []) {
    const candidateUserIds = [];
    const pushCandidate = (value) => {
        const normalized = String(value || '').trim();
        if (!normalized) return;
        if (excludedUserIds.includes(normalized)) return;
        if (!candidateUserIds.includes(normalized)) {
            candidateUserIds.push(normalized);
        }
    };

    const [tickets, chats, orders, payments] = await Promise.all([
        safeSelect(
            client
                .from('shop_tickets')
                .select('id, user_id, created_at')
                .order('created_at', { ascending: false })
                .limit(20)
        ).catch(() => []),
        safeSelect(
            client
                .from('chat_messages')
                .select('id, user_id, session_id, is_admin, created_at')
                .order('created_at', { ascending: false })
                .limit(60)
        ).catch(() => []),
        safeSelect(
            client
                .from('shop_orders')
                .select('id, user_id, created_at')
                .order('created_at', { ascending: false })
                .limit(20)
        ).catch(() => []),
        safeSelect(
            client
                .from('payment_orders')
                .select('id, user_id, created_at')
                .order('created_at', { ascending: false })
                .limit(20)
        ).catch(() => [])
    ]);

    tickets.forEach((item) => pushCandidate(item?.user_id));
    chats
        .filter((item) => item?.is_admin !== true)
        .forEach((item) => pushCandidate(item?.user_id));
    orders.forEach((item) => pushCandidate(item?.user_id));
    payments.forEach((item) => pushCandidate(item?.user_id));

    if (!candidateUserIds.length) {
        throw new Error('Failed to discover a usable real user probe context');
    }

    let bestContext = null;
    for (const userId of candidateUserIds.slice(0, 10)) {
        const context = await fetchUserProbeContext(client, userId);
        if (!bestContext || context.score > bestContext.score) {
            bestContext = context;
        }
        if (context.score >= 4) {
            break;
        }
    }

    if (!bestContext) {
        throw new Error('Failed to build a probe context from recent real data');
    }

    return {
        generatedAt: new Date().toISOString(),
        userId: bestContext.userId,
        userEmail: bestContext.userEmail,
        chatSessionId: bestContext.chatSessionId,
        orderId: String(bestContext.order?.id || '').trim(),
        paymentId: String(bestContext.payment?.id || '').trim(),
        verificationId: String(bestContext.verification?.verification_id || '').trim(),
        ticketId: String(bestContext.ticket?.id || '').trim(),
        profile: bestContext.profile || null,
        chat: bestContext.chat || null,
        order: bestContext.order || null,
        payment: bestContext.payment || null,
        verification: bestContext.verification || null,
        ticket: bestContext.ticket || null,
        counts: {
            orders: bestContext.orders.length,
            payments: bestContext.payments.length,
            verifications: bestContext.verifications.length,
            tickets: bestContext.tickets.length
        }
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const publicConfig = await fetchRuntimeConfig(baseUrl);

    const superSessionPayload = readJson(options.superSessionFile);
    const superClient = createPublicClient(publicConfig);
    const restoredSuperSession = await restoreSession(superClient, superSessionPayload);
    const superAccess = await verifyAdminAccess(superClient, 'super');

    writeJson(options.superSessionFile, {
        ...superSessionPayload,
        email: String(superAccess.user.email || superSessionPayload.email || '').trim(),
        access_token: restoredSuperSession.access_token,
        refresh_token: restoredSuperSession.refresh_token,
        expires_at: restoredSuperSession.expires_at
    });

    const superTestAccount = await ensureAuthUser({
        emailPrefix: 'codex.super.admin',
        passwordPrefix: 'CodexSuper'
    }, publicConfig, baseUrl);
    await grantAdminRole(superClient, superAccess.user.id, superTestAccount.userId, {
        roleName: 'super_admin',
        permissions: [...DEFAULT_SUPER_PERMISSIONS]
    });
    const superTestClient = createPublicClient(publicConfig);
    const restoredSuperTestSession = await restoreSession(superTestClient, superTestAccount.session);
    const resolvedSuperTestAccess = await verifyAdminAccess(superTestClient, 'super');

    writeJson(options.superSessionFile, {
        email: superTestAccount.email,
        password: superTestAccount.password,
        user_id: superTestAccount.userId,
        access_token: restoredSuperTestSession.access_token,
        refresh_token: restoredSuperTestSession.refresh_token,
        expires_at: restoredSuperTestSession.expires_at,
        is_super_admin: resolvedSuperTestAccess.access?.is_super_admin === true
    });

    const limitedAccount = await ensureAuthUser({
        email: options.limitedEmail,
        password: options.limitedPassword,
        emailPrefix: 'codex.limited.admin',
        passwordPrefix: 'CodexLimited'
    }, publicConfig, baseUrl);
    const grantResult = await grantAdminRole(superClient, superAccess.user.id, limitedAccount.userId, {
        roleName: 'admin',
        permissions: [...DEFAULT_LIMITED_PERMISSIONS]
    });
    const limitedClient = createPublicClient(publicConfig);
    const restoredLimitedSession = await restoreSession(limitedClient, limitedAccount.session);
    const limitedAccess = await verifyLimitedAdmin(limitedClient, limitedAccount.userId);

    writeJson(options.limitedSessionFile, {
        email: limitedAccount.email,
        password: limitedAccount.password,
        user_id: limitedAccount.userId,
        access_token: restoredLimitedSession.access_token,
        refresh_token: restoredLimitedSession.refresh_token,
        expires_at: restoredLimitedSession.expires_at,
        permissions: limitedAccess.permissions || grantResult.permissions,
        is_super_admin: limitedAccess.is_super_admin === true
    });

    const customerAccount = await ensureAuthUser({
        email: options.customerEmail,
        password: options.customerPassword,
        emailPrefix: 'codex.support.customer',
        passwordPrefix: 'CodexCustomer'
    }, publicConfig, baseUrl);
    const customerClient = createPublicClient(publicConfig);
    const restoredCustomerSession = await restoreSession(customerClient, customerAccount.session);
    writeJson(options.customerSessionFile, {
        email: customerAccount.email,
        password: customerAccount.password,
        user_id: customerAccount.userId,
        access_token: restoredCustomerSession.access_token,
        refresh_token: restoredCustomerSession.refresh_token,
        expires_at: restoredCustomerSession.expires_at
    });

    const probe = await buildProbeContext(superClient, [
        superAccess.user.id,
        superTestAccount.userId,
        limitedAccount.userId,
        customerAccount.userId
    ]);
    writeJson(options.probeFile, {
        ...probe,
        probeBase64: toBase64Url(probe)
    });

    process.stdout.write([
        `base_url=${baseUrl}`,
        `bootstrap_super_admin=${String(superAccess.user.email || superAccess.user.id || '').trim()}`,
        `super_admin=${superTestAccount.email}`,
        `limited_admin=${limitedAccount.email}`,
        `limited_permissions=${(limitedAccess.permissions || grantResult.permissions || []).join(',') || '(none)'}`,
        `customer_user=${customerAccount.email}`,
        `probe_user=${probe.userEmail || probe.userId || '(unknown)'}`,
        `probe_chat_session=${probe.chatSessionId || '(none)'}`,
        `probe_order=${probe.orderId || '(none)'}`,
        `probe_payment=${probe.paymentId || '(none)'}`,
        `probe_ticket=${probe.ticketId || '(none)'}`,
        `probe_verify=${probe.verificationId || '(none)'}`,
        `wrote_limited_session=${options.limitedSessionFile}`,
        `wrote_customer_session=${options.customerSessionFile}`,
        `wrote_probe=${options.probeFile}`
    ].join('\n') + '\n');
}

main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
});
