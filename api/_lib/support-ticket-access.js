'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const COOKIE_NAME = '__Host-zaoyoe_support';
const MAX_TICKETS = 12;
const TTL_SECONDS = 30 * 24 * 60 * 60;

function getSecret(env) {
    const secret = env.SUPPORT_TICKET_ACCESS_SECRET;
    return typeof secret === 'string' && Buffer.byteLength(secret) >= 32 ? secret : null;
}

function sign(payload, secret) {
    return createHmac('sha256', secret).update(`support-ticket:v1:${payload}`).digest('base64url');
}

function readGuestTicketAccess(req, { env = process.env, now = Date.now() } = {}) {
    const secret = getSecret(env);
    const result = { enabled: Boolean(secret), tickets: [] };
    if (!secret) return result;
    const cookies = String(req?.headers?.cookie || '').split(';')
        .map(value => value.trim()).filter(value => value.startsWith(`${COOKIE_NAME}=`));
    if (cookies.length !== 1) return result;
    const value = cookies[0].slice(COOKIE_NAME.length + 1);
    if (value.length > 3900) return result;
    const parts = value.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return result;
    const expected = Buffer.from(sign(parts[0], secret));
    if (!timingSafeEqual(expected, Buffer.from(parts[1]))) return result;
    try {
        const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        if (payload.v !== 1 || !Array.isArray(payload.tickets) || payload.tickets.length > MAX_TICKETS) return result;
        result.tickets = payload.tickets.filter(ticket => ticket && typeof ticket.id === 'string'
            && /^[A-Za-z0-9_-]{1,120}$/.test(ticket.id) && ['cn', 'intl'].includes(ticket.site)
            && Number.isSafeInteger(ticket.exp) && ticket.exp > now
            && ticket.exp <= now + TTL_SECONDS * 1000);
    } catch (_) { /* A malformed credential never grants access. */ }
    return result;
}

function grantGuestTicketAccess(res, access, { ticketId, site, env = process.env, now = Date.now() }) {
    const secret = getSecret(env);
    if (!secret || !/^[A-Za-z0-9_-]{1,120}$/.test(ticketId) || !['cn', 'intl'].includes(site)) {
        throw Object.assign(new Error('游客工单凭证暂不可用'), { statusCode: 503, code: 'guest_ticket_access_unavailable' });
    }
    const tickets = access.tickets.filter(ticket => ticket.exp > now && !(ticket.id === ticketId && ticket.site === site));
    tickets.push({ id: ticketId, site, exp: now + TTL_SECONDS * 1000 });
    const payload = Buffer.from(JSON.stringify({ v: 1, tickets: tickets.slice(-MAX_TICKETS) })).toString('base64url');
    // Keep the credential out of JavaScript, URLs, JSON responses and logs.
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${payload}.${sign(payload, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_SECONDS}`);
}

module.exports = { readGuestTicketAccess, grantGuestTicketAccess };
