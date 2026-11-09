'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readGuestTicketAccess, grantGuestTicketAccess } = require('../api/_lib/support-ticket-access');

const env = { SUPPORT_TICKET_ACCESS_SECRET: 'support-fixture-secret-independent-32bytes-minimum' };
const now = Date.UTC(2026, 10, 7);
const ttl = 30 * 24 * 60 * 60 * 1000;
const cookieName = '__Host-zaoyoe_support';
function issue(access = { tickets: [] }, options = {}) {
    let header;
    grantGuestTicketAccess({ setHeader(name, value) {
        assert.equal(name, 'Set-Cookie'); header = value;
    } }, access, { ticketId: 'ticket-1', site: 'cn', env, now, ...options });
    return { header, req: { headers: { cookie: header.split(';')[0] } } };
}
function signedPayload(payload, secret = env.SUPPORT_TICKET_ACCESS_SECRET) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret).update(`support-ticket:v1:${encoded}`).digest('base64url');
    return { headers: { cookie: `${cookieName}=${encoded}.${signature}` } };
}

test('guest ticket credential round trips with host-only, script-inaccessible cookie flags', () => {
    const { req, header } = issue();
    assert.match(header, /^__Host-zaoyoe_support=/);
    for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=2592000']) {
        assert.ok(header.split('; ').includes(flag), flag);
    }
    assert.doesNotMatch(header, /Domain=/i);
    assert.deepEqual(readGuestTicketAccess(req, { env, now }), {
        enabled: true, tickets: [{ id: 'ticket-1', site: 'cn', exp: now + ttl }]
    });
});

test('guest credentials expire at the exact boundary and cannot be extended beyond the issue TTL', () => {
    const { req } = issue();
    assert.equal(readGuestTicketAccess(req, { env, now: now + ttl - 1 }).tickets.length, 1);
    assert.equal(readGuestTicketAccess(req, { env, now: now + ttl }).tickets.length, 0);
    assert.equal(readGuestTicketAccess(signedPayload({ v: 1, tickets: [
        { id: 'future', site: 'cn', exp: now + ttl + 1 }
    ] }), { env, now }).tickets.length, 0);
});

test('adding a ticket preserves existing expiry and drops expired grants', () => {
    const { req } = issue({ tickets: [
        { id: 'old', site: 'intl', exp: now + 1000 },
        { id: 'expired', site: 'cn', exp: now }
    ] });
    assert.deepEqual(readGuestTicketAccess(req, { env, now }).tickets, [
        { id: 'old', site: 'intl', exp: now + 1000 },
        { id: 'ticket-1', site: 'cn', exp: now + ttl }
    ]);
});

test('ticket credentials cap browser grants at twelve and discard the oldest entry', () => {
    const tickets = Array.from({ length: 12 }, (_, index) => ({ id: `old-${index}`, site: 'cn', exp: now + index + 1 }));
    const access = readGuestTicketAccess(issue({ tickets }).req, { env, now });
    assert.equal(access.tickets.length, 12);
    assert.equal(access.tickets[0].id, 'old-1');
    assert.equal(access.tickets.at(-1).id, 'ticket-1');
    assert.ok(issue({ tickets }).header.length < 4096);
});

test('regranting one ticket replaces only its matching site grant', () => {
    const { req } = issue({ tickets: [
        { id: 'ticket-1', site: 'cn', exp: now + 100 },
        { id: 'ticket-1', site: 'intl', exp: now + 200 }
    ] });
    assert.deepEqual(readGuestTicketAccess(req, { env, now }).tickets, [
        { id: 'ticket-1', site: 'intl', exp: now + 200 },
        { id: 'ticket-1', site: 'cn', exp: now + ttl }
    ]);
});

test('missing, weak, or rotated independent secrets never accept an existing grant', () => {
    const { req } = issue();
    for (const weak of [{}, { SUPPORT_TICKET_ACCESS_SECRET: '' }, { SUPPORT_TICKET_ACCESS_SECRET: 'short' }]) {
        assert.deepEqual(readGuestTicketAccess(req, { env: weak, now }), { enabled: false, tickets: [] });
        assert.throws(() => issue({ tickets: [] }, { env: weak }), { statusCode: 503 });
    }
    assert.equal(readGuestTicketAccess(req, { env: { SUPPORT_TICKET_ACCESS_SECRET: 'different-independent-secret-32bytes' }, now }).tickets.length, 0);
});

test('tampering, duplicate cookie names, oversized values, and malformed signatures fail closed', () => {
    const cookie = issue().req.headers.cookie;
    const value = cookie.slice(cookieName.length + 1);
    const cases = [
        `${cookieName}=${value.replace(/^./, value[0] === 'a' ? 'b' : 'a')}`,
        `${cookieName}=${value.slice(0, -1)}!`,
        `${cookieName}=${value.slice(0, -2)}`,
        `${cookie}; ${cookie}`,
        `${cookieName}=${'a'.repeat(3901)}`,
        `${cookieName}=bad.parts.extra`,
        `${cookieName}=@@@.${'a'.repeat(43)}`
    ];
    for (const cookieValue of cases) {
        assert.deepEqual(readGuestTicketAccess({ headers: { cookie: cookieValue } }, { env, now }).tickets, []);
    }
    assert.equal(readGuestTicketAccess({ headers: { cookie: `unrelated=ok; ${cookie}` } }, { env, now }).tickets.length, 1);
});

test('invalid signed payloads and out-of-scope ticket claims never authorize access', () => {
    const ticket = { id: 'ok', site: 'cn', exp: now + 1000 };
    for (const payload of [null, {}, { v: 2, tickets: [ticket] }, { v: 1, tickets: {} },
        { v: 1, tickets: Array.from({ length: 13 }, () => ticket) }]) {
        assert.deepEqual(readGuestTicketAccess(signedPayload(payload), { env, now }).tickets, []);
    }
    const invalid = [null, { ...ticket, id: '../other' }, { ...ticket, id: '' },
        { ...ticket, id: 'a'.repeat(121) }, { ...ticket, site: 'other' },
        { ...ticket, exp: String(ticket.exp) }, { ...ticket, exp: now }, { ...ticket, exp: now + 0.5 }];
    const result = readGuestTicketAccess(signedPayload({ v: 1, tickets: [ticket, ...invalid] }), { env, now });
    assert.deepEqual(result.tickets, [ticket]);
});

test('issuing a credential rejects unsupported site and ticket identifiers', () => {
    for (const options of [{ ticketId: '../other' }, { ticketId: '' }, { ticketId: 'a'.repeat(121) }, { site: 'other' }]) {
        assert.throws(() => issue({ tickets: [] }, options), { statusCode: 503 });
    }
});
