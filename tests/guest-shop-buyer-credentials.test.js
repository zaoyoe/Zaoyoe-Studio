'use strict';

/**
 * Order Access 2.0 (A1a) unit tests for the guest query-password primitives.
 *
 * Contract: docs/guest-shop-order-access-2.0.md
 *   §6.1.1 P1-P10 password policy
 *   §6.1.2 frozen normalization (norm=v1)
 *   §6.2   scrypt hashing + transparent parameter upgrade
 *   §6.3   contact-hash pepper is mandatory and never reuses another secret
 *   §7.1   X-Guest-Order-Credential transport header
 *   §8.3   the query password is never an input to any other authentication
 *   §8.4   constant cost for unknown-email vs wrong-password
 *
 * Several assertions below are deliberately "frozen value" assertions.  They
 * are not tautologies: editing a frozen constant invalidates every stored hash
 * and makes every existing guest order permanently unreachable, so a change
 * must fail a test loudly instead of shipping.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SECURITY_MODULE_PATH = path.join(REPO_ROOT, 'api/_lib/guest-shop/security.js');
const BUYER_MIGRATION_PATH = path.join(
    REPO_ROOT,
    'supabase/migrations/20260920_guest_shop_buyer_credentials.sql'
);

const security = require('../api/_lib/guest-shop/security');
const {
    BUYER_SCRYPT_MIN_PARAMS,
    BUYER_SCRYPT_PARAMS,
    GENERATED_QUERY_PASSWORD_LENGTH,
    GUEST_ORDER_CREDENTIAL_HEADER,
    GUEST_QUERY_PASSWORD_DENYLIST,
    GUEST_QUERY_PASSWORD_MAX_LENGTH,
    GUEST_QUERY_PASSWORD_MIN_LENGTH,
    GUEST_QUERY_PASSWORD_NORM_VERSION,
    GuestShopSecurityError,
    assertGuestQueryPasswordPolicy,
    buildGuestOrderCredentialHeader,
    generateGuestQueryPassword,
    getGuestContactHashPepper,
    hashGuestContact,
    hashGuestQueryPassword,
    normalizeGuestQueryPassword,
    parseGuestOrderCredentialHeader,
    parseGuestQueryPasswordHash,
    runDummyGuestQueryPasswordVerification,
    validateGuestQueryPasswordPolicy,
    verifyGuestQueryPassword
} = security;

const {
    GUEST_QUERY_PASSWORD_DUMMY_HASH,
    buildGuestQueryPasswordHashString,
    foldFullwidthAscii,
    longestMonotonicRun,
    longestRepeatRun
} = security._private;

const STRONG_PEPPER = 'guest-contact-hash-pepper-0123456789-abcdefghijklmnopqrstuvwx';
const CLAIM_PEPPER = 'guest-claim-pepper-0123456789-abcdefghijklmnopqrstuvwxyz';
const SERVICE_ROLE = 'service-role-key-0123456789-abcdefghijklmnopqrstuvwxyz';
const PEPPER_ENV = Object.freeze({ GUEST_SHOP_CONTACT_HASH_PEPPER: STRONG_PEPPER });

// Passes P1-P10 and is not a denylist/stem/sequence/structure hit.  Used as
// the "known good" password throughout so a single policy change cannot mask
// an unrelated regression.
const VALID_PASSWORD = 'Ab3!xY9#';
const VALID_EMAIL = 'alice@example.com';

function ruleOf(password, options) {
    const result = validateGuestQueryPasswordPolicy(password, options);
    return result.ok ? '' : result.rule;
}

/**
 * Comments are prose; code is the contract.  The isolation assertions below
 * must fail on a real reference to the account auth system, not on a docblock
 * that merely mentions it, so block comments and whole-line comments are
 * removed before matching.  Trailing `// ...` on a code line is deliberately
 * left alone: a URL inside a string literal must not be mangled.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, ' ')
        .replace(/^[ \t]*\/\/.*$/gmu, '');
}

function toFullwidth(value) {
    let out = '';
    for (const ch of value) {
        const codePoint = ch.codePointAt(0);
        out += (codePoint >= 0x21 && codePoint <= 0x7e)
            ? String.fromCharCode(codePoint + 0xfee0)
            : ch;
    }
    return out;
}

// ---------------------------------------------------------------------------
// §6.2 / §6.1.2 — frozen constants
// ---------------------------------------------------------------------------

test('buyer scrypt parameters and normalization version are frozen at the documented values', () => {
    assert.deepEqual({ ...BUYER_SCRYPT_PARAMS }, { N: 32768, r: 8, p: 1, keylen: 32, saltBytes: 32 });
    assert.deepEqual({ ...BUYER_SCRYPT_MIN_PARAMS }, { N: 16384, r: 8, p: 1, keylen: 32 });
    assert.equal(GUEST_QUERY_PASSWORD_NORM_VERSION, 'v1');
    assert.equal(GUEST_QUERY_PASSWORD_MIN_LENGTH, 8);
    assert.equal(GUEST_QUERY_PASSWORD_MAX_LENGTH, 64);
    assert.equal(GENERATED_QUERY_PASSWORD_LENGTH, 12);
    assert.equal(GUEST_ORDER_CREDENTIAL_HEADER, 'x-guest-order-credential');
    assert.ok(Object.isFrozen(BUYER_SCRYPT_PARAMS));
    assert.ok(Object.isFrozen(BUYER_SCRYPT_MIN_PARAMS));
    // The floor must never exceed the operating point, otherwise every minted
    // hash would immediately be flagged for a rehash.
    assert.ok(BUYER_SCRYPT_PARAMS.N >= BUYER_SCRYPT_MIN_PARAMS.N);
    assert.ok(BUYER_SCRYPT_PARAMS.r >= BUYER_SCRYPT_MIN_PARAMS.r);
});

test('minted hash satisfies the database CHECK constraint verbatim', () => {
    const migration = fs.readFileSync(BUYER_MIGRATION_PATH, 'utf8');
    const constraint = migration.match(/guest_shop_buyers_pwd_format\s+CHECK \(password_hash ~ '(.+?)'\)/u);
    assert.ok(constraint, 'migration must keep the password_hash format CHECK');
    // The captured CHECK is a Postgres POSIX regex, and `\$` is already a
    // valid JavaScript escape for a literal `$`.  It must be compiled
    // VERBATIM: rewriting `\$` into `$` would turn every field separator
    // into an end-of-string anchor and the pattern would match nothing.
    const pattern = new RegExp(constraint[1]);
    for (let index = 0; index < 3; index += 1) {
        const hash = hashGuestQueryPassword(VALID_PASSWORD);
        assert.ok(pattern.test(hash), `hash must satisfy the DB CHECK: ${hash.replace(/\$/gu, '|')}`);
        assert.match(hash, /^scrypt\$32768\$8\$1\$norm=v1\$/u);
        // Standard base64 (with +/=), NOT base64url: the CHECK alphabet is
        // [A-Za-z0-9+/=] and a base64url hash would be rejected by Postgres.
        assert.doesNotMatch(hash, /[_-]/u);
    }
});

// ---------------------------------------------------------------------------
// §6.1.1 — P1..P10
// ---------------------------------------------------------------------------

test('P1 rejects short passwords and the configured minimum can only be raised', () => {
    assert.equal(ruleOf('Ab3!xY9'), 'P1');
    assert.equal(ruleOf(''), 'P4');
    assert.equal(ruleOf(VALID_PASSWORD), '');
    // An operator may tighten the minimum (K26 allows 6..20 in runtime config)
    // but the module floor of 8 is never lowered by a smaller request.
    assert.equal(ruleOf('Ab3!xY9#', { minLength: 12 }), 'P1');
    assert.equal(ruleOf('Ab3!xY9#kQ2z', { minLength: 12 }), '', 'twelve characters, still four-class');
    assert.equal(ruleOf('Ab3!xY9', { minLength: 4 }), 'P1');
    assert.equal(ruleOf('Ab3!xY9#', { minLength: 1 }), '');
});

test('P2a-P2d require all four character classes and report the missing one', () => {
    assert.equal(ruleOf('abcd123!'), 'P2a', 'no uppercase');
    assert.equal(ruleOf('ABCD123!'), 'P2b', 'no lowercase');
    assert.equal(ruleOf('Abcdefg!'), 'P2c', 'no digit');
    assert.equal(ruleOf('Abcd1234'), 'P2d', 'no punctuation');
    assert.equal(ruleOf('Xk9#mQ2$zW'), '');
});

test('P3 rejects over-long passwords, including absurd lengths, without expensive work', () => {
    assert.equal(ruleOf(`${'Xk9#mQ2$zW'}${'aB3!'.repeat(14)}`), 'P3');
    assert.equal(ruleOf('A1!'.repeat(30)), 'P3');
    // A megabyte-scale string is refused by the pre-fold length guard, so a
    // hostile caller cannot make the fold loop or scrypt expensive.
    const started = process.hrtime.bigint();
    assert.equal(ruleOf('A1!b'.repeat(300000)), 'P3');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 500, `oversized password must be rejected cheaply, took ${elapsedMs}ms`);
});

test('P4 rejects spaces, control characters and every non-ASCII character after fullwidth folding', () => {
    assert.equal(ruleOf('Ab3!xY9# '), 'P4', 'trailing space');
    assert.equal(ruleOf('Ab3 xY9#z'), 'P4', 'inner space');
    assert.equal(ruleOf('Ab3!xY9#\t'), 'P4', 'tab');
    assert.equal(ruleOf('Ab3!xY9#\n'), 'P4', 'newline');
    assert.equal(ruleOf('Ab3!xY9#\u0000'), 'P4', 'NUL');
    assert.equal(ruleOf('Ab3!xY9#\u007f'), 'P4', 'DEL');
    assert.equal(ruleOf('Ab3!xY9#密'), 'P4', 'CJK');
    assert.equal(ruleOf('Ab3!xY9#🔐'), 'P4', 'emoji');
    assert.equal(ruleOf('Ab3!xY9#\u200b'), 'P4', 'zero-width space');
    // Ideographic space folds to an ASCII space, which P4 then rejects: the
    // fold must never become a way to smuggle whitespace into a stored hash.
    assert.equal(ruleOf('Ab3!xY9#\u3000'), 'P4');
    assert.equal(ruleOf(12345678), 'P4');
    assert.equal(ruleOf(null), 'P4');
    assert.equal(ruleOf(undefined), 'P4');
    assert.equal(ruleOf({ toString: () => 'Ab3!xY9#' }), 'P4');
});

test('P5 accepts every printable ASCII punctuation character', () => {
    const punctuation = [];
    for (let codePoint = 0x21; codePoint <= 0x7e; codePoint += 1) {
        const ch = String.fromCharCode(codePoint);
        if (!/[A-Za-z0-9]/.test(ch)) punctuation.push(ch);
    }
    assert.equal(punctuation.length, 32, 'P5 documents exactly 32 punctuation characters');
    for (const ch of punctuation) {
        const candidate = `Xk9${ch}mQ2${ch}zW`;
        const result = validateGuestQueryPasswordPolicy(candidate);
        assert.ok(result.ok || result.rule !== 'P2d',
            `punctuation ${JSON.stringify(ch)} must count towards the four-class rule`);
    }
    // A password made only of punctuation still fails the letter/digit classes.
    assert.equal(ruleOf('!@#$%^&*()'), 'P2a');
});

test('P6 rejects a password that collides with the email local part in either direction', () => {
    // The documented shape: abc@x.com + a password containing "abc".
    assert.equal(ruleOf('Michael9#x', { email: 'michael@example.com' }), 'P6');
    assert.equal(ruleOf('mICHAEL9#x', { email: 'Michael@Example.COM' }), 'P6', 'case-insensitive');
    // "互相包含": the local part contains the password.
    assert.equal(ruleOf('Zb9#xk2m', { email: 'qzb9#xk2mw@example.com' }), 'P6');
    // Exact equality with a very short local part is still rejected.
    assert.equal(ruleOf('Xk9#mQ2$zW', { email: 'xk9#mQ2$zW@example.com' }), 'P6');
    // No collision -> no rejection.
    assert.equal(ruleOf('Xk9#mQ2$zW', { email: VALID_EMAIL }), '');
    // Mailboxes shorter than 3 characters only collide by exact equality:
    // applying substring matching there would reject nearly every password a
    // real user can invent, which is a purchase wall rather than a control.
    assert.equal(ruleOf('Xab9#kQ2', { email: 'ab@example.com' }), '');
    // A malformed email option is ignored rather than throwing.
    assert.equal(ruleOf('Xk9#mQ2$zW', { email: 'not-an-email' }), '');
    assert.equal(ruleOf('Xk9#mQ2$zW', { email: 42 }), '');
});

test('P7a rejects common passwords that satisfy the four-class rule', () => {
    for (const weak of ['Password1!', 'Passw0rd!', 'P@ssw0rd1', 'Admin123!', 'Test123!',
        'Iloveyou1!', 'Welcome1!', 'Qwerty1!', 'Letmein1!', 'Sunshine1!', 'Abc123!@#']) {
        assert.equal(ruleOf(weak), 'P7a', `${weak} must hit the denylist`);
    }
    assert.ok(GUEST_QUERY_PASSWORD_DENYLIST.size > 2000,
        'the expanded denylist must cover at least the documented Top-2000 space');
    assert.ok(GUEST_QUERY_PASSWORD_DENYLIST.has('password'));
    assert.ok(GUEST_QUERY_PASSWORD_DENYLIST.has('password1!'));
    // The builder enumerates the FULLY leet-folded form of every core word.
    // Partially folded forms are not enumerated — that would be exponential in
    // the number of substitutable characters — they are resolved at check time
    // by leetUnfold(), which is why `Passw0rd!` and `P@55w0rd!` both land on
    // P7a even though neither string is in the set.
    assert.ok(GUEST_QUERY_PASSWORD_DENYLIST.has('p455w0rd'), 'fully folded leet forms are enumerated');
    assert.equal(ruleOf('P455w0rd!'), 'P7a');
    assert.equal(ruleOf('P@55w0rd!'), 'P7a', 'partial leet is resolved by unfolding, not enumeration');
});

test('P7b rejects weak stems, keyboard/sequential runs and the word+digits+bang shape', () => {
    // ① stems (substring, leet-unfolded)
    assert.equal(ruleOf('Xadm1n#9kQ'), 'P7b');
    assert.equal(ruleOf('MyP4ssw0rd#'), 'P7b');
    // ② keyboard rows in both directions
    assert.equal(ruleOf('Qwer1234!'), 'P7b');
    assert.equal(ruleOf('!4321rewQ'), 'P7b');
    assert.equal(ruleOf('Xzxcv9#kQ'), 'P7b');
    // ② monotonic alphabet / digit runs of four or more
    assert.equal(ruleOf('Xmnop9#kQ'), 'P7b');
    assert.equal(ruleOf('X9876#kQm'), 'P7b');
    // ③ Capitalized word + digits + a single trailing punctuation
    assert.equal(ruleOf('Kzvqm93!'), 'P7b');
    assert.equal(ruleOf('Abcd1234!'), 'P7a', 'denylist fires before the shape rule');
});

test('P9 rejects repeated characters, case-insensitively for letters', () => {
    assert.equal(ruleOf('Aaaa1111!!!!'), 'P9');
    assert.equal(ruleOf('ZaAaA9!x'), 'P9', 'aAAa counts as a run of four "a"');
    assert.equal(ruleOf('Xk9####mQ2'), 'P9', 'a run of four is rejected');
    assert.equal(ruleOf('Xk9###mQ2z'), '', 'a run of three is allowed');
    assert.equal(ruleOf('Xk9##mQ22z'), '', 'a run of two is allowed');
    assert.equal(longestRepeatRun('aAAa'), 4);
    assert.equal(longestRepeatRun('abab'), 1);
});

test('P10 rejects passwords with fewer than five distinct characters', () => {
    assert.equal(ruleOf('Aa1!Aa1!'), 'P10');
    assert.equal(ruleOf('Ab3!xY9#'), '', 'eight distinct characters');
});

test('the documented passing example passes every rule', () => {
    const result = validateGuestQueryPasswordPolicy(VALID_PASSWORD, {
        email: VALID_EMAIL,
        orderNo: 'GS2026092012345678ABCDEF01',
        forbiddenTokens: ['fatherkey.com', 'zaoyoe.xyz', 'www.fatherkey.com']
    });
    assert.deepEqual({ ok: result.ok, rule: result.rule, reason: result.reason },
        { ok: true, rule: '', reason: '' });
    assert.equal(result.value, VALID_PASSWORD);
});

test('P8 rejects order numbers and site domains', () => {
    // A synthetic order number on purpose: a real one is hex-heavy, so its
    // `abcdef` run would trip the P7b stem rule first (and its `0123456789`
    // run the sequence rule), and this test would prove nothing about P8.
    const orderNo = 'GS2026092099887766FFEE01';
    assert.equal(ruleOf('Xk9#mQ2$zW', { orderNo }), '');
    assert.equal(ruleOf(`A#${orderNo.toLowerCase()}`, { orderNo }), 'P8');

    // Whole-domain containment.
    assert.equal(ruleOf('Zk9#mQ2$fatherkey.com', { forbiddenTokens: ['fatherkey.com'] }), 'P8');
    // A domain LABEL alone is enough: nobody types the TLD into a password
    // field, and the static denylist cannot be expected to know every
    // operator's brand.  Labels shorter than four characters are skipped, so
    // `www` / `co` / `xyz` never reject a legitimate password.
    assert.equal(ruleOf('Zk9#mQ2$nightjar', { forbiddenTokens: ['nightjar.shop'] }), 'P8');
    assert.equal(ruleOf('Zk9#mQ2$zW', { forbiddenTokens: ['fatherkey.com', 'zaoyoe.xyz'] }), '');
    // Short or empty context tokens never fire: they would reject everything.
    assert.equal(ruleOf('Zk9#mQ2$zW', { forbiddenTokens: ['', '  ', 'x', 'co', 'shop'] }), '');
    assert.equal(ruleOf('Zk9#mQ2$zW', { orderNo: null, forbiddenTokens: null }), '');
});

test('assertGuestQueryPasswordPolicy reports the failing rule but never the password', () => {
    assert.equal(assertGuestQueryPasswordPolicy(VALID_PASSWORD), VALID_PASSWORD);
    assert.throws(
        () => assertGuestQueryPasswordPolicy('abcd123!', { email: VALID_EMAIL }),
        (error) => {
            assert.ok(error instanceof GuestShopSecurityError);
            assert.equal(error.statusCode, 400);
            assert.equal(error.code, 'guest_password_weak');
            assert.equal(error.rule, 'P2a');
            assert.equal(error.reason, 'missing_uppercase');
            assert.equal(error.field, 'orderPassword');
            assert.doesNotMatch(error.message, /abcd123!/u);
            return true;
        }
    );
    assert.throws(
        () => assertGuestQueryPasswordPolicy('abcd123!', { field: 'guestPassword' }),
        (error) => error.field === 'guestPassword'
    );
});

// ---------------------------------------------------------------------------
// §6.1.2 — frozen normalization
// ---------------------------------------------------------------------------

test('normalization folds fullwidth ASCII and never trims or case-folds', () => {
    assert.deepEqual(normalizeGuestQueryPassword('Ａｂｃ１２３！'),
        { ok: true, value: 'Abc123!', rule: '', reason: '' });
    assert.equal(foldFullwidthAscii('！＠＃＄'), '!@#$');
    assert.equal(foldFullwidthAscii('ＡＢＣａｂｃ０１９'), 'ABCabc019');
    // Fullwidth chars outside the ASCII range are left alone and then fail P4.
    assert.equal(normalizeGuestQueryPassword('Ｘｋ９＃ｍＱ２＄ｚＷ密').ok, false);
    // No trim: the trailing space is a P4 rejection, not a silent fix.
    assert.equal(normalizeGuestQueryPassword('Xk9#mQ2$zW ').rule, 'P4');
    // No case folding: the value is returned byte-identical.
    assert.equal(normalizeGuestQueryPassword('Xk9#mQ2$zW').value, 'Xk9#mQ2$zW');
    assert.equal(normalizeGuestQueryPassword('xk9#MQ2$Zw').value, 'xk9#MQ2$Zw');
});

test('fullwidth and halfwidth forms of the same password are interchangeable end to end', () => {
    const fullwidth = toFullwidth(VALID_PASSWORD);
    assert.notEqual(fullwidth, VALID_PASSWORD);
    assert.equal(foldFullwidthAscii(fullwidth), VALID_PASSWORD);

    const halfwidthHash = hashGuestQueryPassword(VALID_PASSWORD);
    assert.equal(verifyGuestQueryPassword(fullwidth, halfwidthHash).ok, true,
        'set in halfwidth, query in fullwidth');

    const fullwidthHash = hashGuestQueryPassword(fullwidth);
    assert.equal(verifyGuestQueryPassword(VALID_PASSWORD, fullwidthHash).ok, true,
        'set in fullwidth, query in halfwidth');
});

test('the stored hash records norm=v1 and the parser reads it back consistently', () => {
    const hash = hashGuestQueryPassword(VALID_PASSWORD);
    const parsed = parseGuestQueryPasswordHash(hash);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.norm, GUEST_QUERY_PASSWORD_NORM_VERSION);
    assert.equal(parsed.N, BUYER_SCRYPT_PARAMS.N);
    assert.equal(parsed.r, BUYER_SCRYPT_PARAMS.r);
    assert.equal(parsed.p, BUYER_SCRYPT_PARAMS.p);
    assert.equal(parsed.keylen, BUYER_SCRYPT_PARAMS.keylen);
    assert.equal(parsed.salt.length, BUYER_SCRYPT_PARAMS.saltBytes);
    assert.match(hash, /norm=v1/u);
});

// ---------------------------------------------------------------------------
// §6.2 — hashing and verification
// ---------------------------------------------------------------------------

test('scrypt hashing is salted, round-trips and rejects a wrong password', () => {
    const first = hashGuestQueryPassword(VALID_PASSWORD);
    const second = hashGuestQueryPassword(VALID_PASSWORD);
    assert.notEqual(first, second, 'every row gets fresh entropy');
    assert.notEqual(parseGuestQueryPasswordHash(first).salt, parseGuestQueryPasswordHash(second).salt);
    assert.deepEqual(verifyGuestQueryPassword(VALID_PASSWORD, first), { ok: true, needsRehash: false, reason: '' });
    assert.deepEqual(verifyGuestQueryPassword(VALID_PASSWORD, second), { ok: true, needsRehash: false, reason: '' });
    assert.equal(verifyGuestQueryPassword('Xk9#mQ2$zW', first).ok, false);
    assert.equal(verifyGuestQueryPassword(VALID_PASSWORD.toLowerCase(), first).ok, false,
        'case folding is not applied, so a differently cased password must not verify');
    assert.equal(verifyGuestQueryPassword(toFullwidth(VALID_PASSWORD), first).ok, true);
});

test('a lower-parameter row verifies and is flagged for a transparent rehash', () => {
    const salt = crypto.randomBytes(BUYER_SCRYPT_PARAMS.saltBytes);
    const legacyParams = { N: 16384, r: 8, p: 1 };
    const derived = crypto.scryptSync(Buffer.from(VALID_PASSWORD, 'utf8'), salt, BUYER_SCRYPT_PARAMS.keylen, {
        ...legacyParams,
        maxmem: 64 * 1024 * 1024
    });
    const legacyHash = buildGuestQueryPasswordHashString({
        params: legacyParams,
        norm: GUEST_QUERY_PASSWORD_NORM_VERSION,
        salt,
        hash: derived
    });
    const result = verifyGuestQueryPassword(VALID_PASSWORD, legacyHash);
    assert.equal(result.ok, true);
    assert.equal(result.needsRehash, true, 'operator raises the cost -> login rehashes');
    assert.equal(verifyGuestQueryPassword('Xk9#mQ2$zW', legacyHash).needsRehash, false,
        'a failed verification never triggers a rehash');

    // An unknown future norm version also rehashes on success.
    const futureHash = buildGuestQueryPasswordHashString({
        params: BUYER_SCRYPT_PARAMS,
        norm: 'v2',
        salt,
        hash: crypto.scryptSync(Buffer.from(VALID_PASSWORD, 'utf8'), salt, BUYER_SCRYPT_PARAMS.keylen, {
            N: BUYER_SCRYPT_PARAMS.N, r: BUYER_SCRYPT_PARAMS.r, p: BUYER_SCRYPT_PARAMS.p,
            maxmem: 64 * 1024 * 1024
        })
    });
    const future = verifyGuestQueryPassword(VALID_PASSWORD, futureHash);
    assert.equal(future.ok, true);
    assert.equal(future.needsRehash, true);
});

test('hashing refuses weak parameters and unnormalizable input; verification is total', () => {
    assert.throws(
        () => hashGuestQueryPassword(VALID_PASSWORD, { params: { N: 1024, r: 8, p: 1 } }),
        (error) => error.code === 'guest_password_hash_params_invalid' && error.expose === false
    );
    assert.throws(
        () => hashGuestQueryPassword(VALID_PASSWORD, { params: { N: 32768, r: 1, p: 1 } }),
        (error) => error.code === 'guest_password_hash_params_invalid'
    );
    // Hashing enforces NORMALIZABILITY (charset + length), never P1-P10.  The
    // split is deliberate: if the hasher also enforced policy, tightening a
    // rule later would make every pre-existing row impossible to re-mint and
    // the transparent upgrade of §6.2 would dead-end.  Policy is the order
    // path's job alone (assertGuestQueryPasswordPolicy, §6.1.4).
    for (const unhashable of ['Ab3!xY9#密码', 'Ab3! xY9#', 'Ab3!xY9#\u0000', 'A1!b'.repeat(40),
        null, undefined, 42, {}]) {
        assert.throws(
            () => hashGuestQueryPassword(unhashable, {}),
            (error) => error.code === 'guest_password_weak',
            `a value that cannot be normalized must never be hashed: ${String(unhashable).slice(0, 24)}`
        );
    }
    // ...and the converse holds: a policy-weak but well-formed value still
    // hashes and still verifies, so an old row survives a policy tightening.
    const weakHash = hashGuestQueryPassword('abcd123!');
    assert.match(weakHash, /^scrypt\$/u);
    assert.deepEqual(verifyGuestQueryPassword('abcd123!', weakHash),
        { ok: true, needsRehash: false, reason: '' });
    assert.equal(validateGuestQueryPasswordPolicy('abcd123!').ok, false,
        'rejected at the door, just not by the hasher');
    assert.throws(
        () => hashGuestQueryPassword(VALID_PASSWORD, { salt: Buffer.alloc(8) }),
        (error) => error.code === 'guest_password_hash_params_invalid'
    );

    for (const bad of [undefined, null, '', 'nope', 'scrypt$32768$8$1', 'hmac-sha256:v1:' + 'a'.repeat(64),
        'scrypt$abc$8$1$norm=v1$AAAA$BBBB', {}, 42]) {
        const result = verifyGuestQueryPassword(VALID_PASSWORD, bad);
        assert.equal(result.ok, false, `unparseable row must not verify: ${String(bad)}`);
        assert.equal(result.needsRehash, false);
        assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
        assert.ok(!result.reason.includes(VALID_PASSWORD), 'reason must not echo the password');
    }
    assert.equal(parseGuestQueryPasswordHash('scrypt$32768$8$1$norm=v1$AAAA$BBBB').ok, false);
});

test('verification refuses absurd stored parameters instead of allocating memory', () => {
    const salt = Buffer.alloc(32, 1).toString('base64');
    const digest = Buffer.alloc(32, 2).toString('base64');
    for (const params of ['999999999$256$16', '32768$256$16', '1048576$8$1', '2$1$1']) {
        const result = verifyGuestQueryPassword(VALID_PASSWORD, `scrypt$${params}$norm=v1$${salt}$${digest}`);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'params_unsupported', `${params} must be clamped`);
    }
});

// ---------------------------------------------------------------------------
// §8.4 — timing / cost equivalence
// ---------------------------------------------------------------------------

test('the dummy verification burns exactly one scrypt like a real mismatch', () => {
    const realHash = hashGuestQueryPassword(VALID_PASSWORD);
    const originalScrypt = crypto.scryptSync;
    let calls = 0;
    crypto.scryptSync = (...args) => { calls += 1; return originalScrypt(...args); };
    try {
        calls = 0;
        const unknownEmail = runDummyGuestQueryPasswordVerification();
        const dummyCalls = calls;

        calls = 0;
        const wrongPassword = verifyGuestQueryPassword('Xk9#mQ2$zW', realHash);
        const mismatchCalls = calls;

        calls = 0;
        const rightPassword = verifyGuestQueryPassword(VALID_PASSWORD, realHash);
        const matchCalls = calls;

        assert.equal(unknownEmail.ok, false);
        assert.equal(wrongPassword.ok, false);
        assert.equal(rightPassword.ok, true);
        assert.equal(dummyCalls, 1, 'unknown email must cost one scrypt');
        assert.equal(mismatchCalls, 1);
        assert.equal(matchCalls, 1);
        assert.equal(dummyCalls, mismatchCalls,
            'unknown_email and bad_password must be cost-indistinguishable');
    } finally {
        crypto.scryptSync = originalScrypt;
    }
    assert.equal(GUEST_QUERY_PASSWORD_DUMMY_HASH.split('$')[1], String(BUYER_SCRYPT_PARAMS.N),
        'the dummy must run at the current cost parameters');
    assert.equal(verifyGuestQueryPassword(VALID_PASSWORD, GUEST_QUERY_PASSWORD_DUMMY_HASH).ok, false,
        'the dummy hash must never verify a real password');
});

// ---------------------------------------------------------------------------
// §6.1.3 — the mandatory "帮我生成" companion
// ---------------------------------------------------------------------------

test('the generated query password is 12 chars, four-class, ambiguity-free and always policy-valid', () => {
    const forbidden = new Set(['0', 'O', 'o', '1', 'l', 'I', '|']);
    const seen = new Set();
    for (let index = 0; index < 200; index += 1) {
        const candidate = generateGuestQueryPassword();
        assert.equal(candidate.length, GENERATED_QUERY_PASSWORD_LENGTH);
        assert.equal([...candidate].length, GENERATED_QUERY_PASSWORD_LENGTH);
        assert.ok(validateGuestQueryPasswordPolicy(candidate).ok, `generated password must pass policy: ${candidate}`);
        assert.match(candidate, /[A-Z]/u);
        assert.match(candidate, /[a-z]/u);
        assert.match(candidate, /[0-9]/u);
        assert.match(candidate, /[^A-Za-z0-9]/u);
        for (const ch of candidate) assert.ok(!forbidden.has(ch), `ambiguous glyph ${ch} leaked into ${candidate}`);
        seen.add(candidate);
    }
    assert.ok(seen.size > 190, 'generation must not collapse onto a small set');
    assert.notEqual(generateGuestQueryPassword(), generateGuestQueryPassword());
    // Rejection sampling keeps a caller-supplied stricter minimum honoured.
    assert.equal(generateGuestQueryPassword({ minLength: 12 }).length, GENERATED_QUERY_PASSWORD_LENGTH);
});

// ---------------------------------------------------------------------------
// §7.1 — X-Guest-Order-Credential
// ---------------------------------------------------------------------------

test('the credential header round-trips and normalizes the email only', () => {
    const header = buildGuestOrderCredentialHeader('  Alice@Example.COM ', VALID_PASSWORD);
    assert.match(header, /^[A-Za-z0-9_-]+={0,2}$/u);
    assert.doesNotMatch(header, /\s/u, 'the credential never travels as plaintext');
    assert.deepEqual(parseGuestOrderCredentialHeader(header), { email: VALID_EMAIL, password: VALID_PASSWORD });
    assert.equal(parseGuestOrderCredentialHeader(`  ${header}  `).email, VALID_EMAIL,
        'HTTP optional whitespace is tolerated');
    // The password is NOT trimmed or case-folded; the email is.
    const exact = buildGuestOrderCredentialHeader(VALID_EMAIL, 'Xk9#mQ2$zW');
    assert.equal(parseGuestOrderCredentialHeader(exact).password, 'Xk9#mQ2$zW');
    // Fullwidth passwords fold on the way in so a mobile IME cannot lock a
    // user out of their own order.
    const folded = parseGuestOrderCredentialHeader(
        Buffer.from(`${VALID_EMAIL}\n${toFullwidth(VALID_PASSWORD)}`, 'utf8').toString('base64url')
    );
    assert.equal(folded.password, VALID_PASSWORD);
    assert.equal(verifyGuestQueryPassword(folded.password, hashGuestQueryPassword(VALID_PASSWORD)).ok, true);
});

test('malformed credential headers are rejected with a single 400 code', () => {
    const encode = (text) => Buffer.from(text, 'utf8').toString('base64url');
    const malformed = [
        undefined, null, 42, {}, '', '   ', 'not-base64!!', 'YWxpY2VAZXhhbXBsZS5jb20=',
        encode('alice@example.com'),                      // no separator
        encode('alice@example.com\nA\nB'),                // two separators
        encode('\nXk9#mQ2$zW'),                           // empty email
        encode('alice@example.com\n'),                    // empty password
        encode('alice.example.com\nXk9#mQ2$zW'),          // invalid email
        encode('alice@x\nXk9#mQ2$zW'),                    // invalid email
        encode(`alice@example.com\r\nXk9#mQ2$zW`),        // CR smuggling
        encode(`alice@example.com\nXk9#mQ2$\rW`),         // CR in the password
        encode(`${'a'.repeat(321)}@x.com\nXk9#mQ2$zW`),   // email over 320
        encode(`alice@example.com\n${'A1!b'.repeat(40)}`),// password over 128
        'x'.repeat(1025),
        encode('alice@example.com\nXk9#mQ2$zW').replace(/.$/u, '%')
    ];
    for (const value of malformed) {
        assert.throws(
            () => parseGuestOrderCredentialHeader(value),
            (error) => {
                assert.ok(error instanceof GuestShopSecurityError, `expected a security error for ${String(value).slice(0, 40)}`);
                assert.equal(error.statusCode, 400);
                assert.equal(error.code, 'guest_credential_malformed');
                assert.equal(error.field, GUEST_ORDER_CREDENTIAL_HEADER);
                assert.doesNotMatch(error.message, /Xk9#mQ2\$zW/u, 'the message must not echo the credential');
                return true;
            },
            `must reject ${String(value).slice(0, 48)}`
        );
    }
});

test('a non-canonical base64url encoding of a valid credential is rejected', () => {
    // The payload has to be 1 mod 3 bytes: only then does the final base64url
    // character carry slack bits, i.e. only then does a DIFFERENT encoding of
    // the SAME credential exist to reject.  With a 15-byte payload every
    // re-encoding decodes to different bytes and the test proves nothing.
    const email = 'a@b.co';
    const password = 'Xk9#mQ2$z';
    const payload = `${email}\n${password}`;
    assert.equal(Buffer.byteLength(payload, 'utf8') % 3, 1, 'the test needs slack bits');
    assert.equal(validateGuestQueryPasswordPolicy(password).ok, true);
    const canonical = Buffer.from(payload, 'utf8').toString('base64url');
    const bytes = Buffer.from(payload, 'utf8');
    let variant = '';
    for (let codePoint = 0; codePoint < 128; codePoint += 1) {
        const ch = String.fromCharCode(codePoint);
        if (!/^[A-Za-z0-9_-]$/.test(ch)) continue;
        const candidate = canonical.slice(0, -1) + ch;
        if (candidate === canonical) continue;
        if (Buffer.from(candidate, 'base64url').equals(bytes)) { variant = candidate; break; }
    }
    assert.ok(variant, 'the test needs a non-canonical re-encoding to prove strictness');
    assert.deepEqual(parseGuestOrderCredentialHeader(canonical), { email, password });
    assert.throws(() => parseGuestOrderCredentialHeader(variant),
        (error) => error.code === 'guest_credential_malformed');
});

test('a charset-invalid password in the header is a unified 403-shaped failure, not a 400', () => {
    // Structural problems are 400.  A password that merely violates P4 can
    // never have been stored, so it must flow through to the verifier and come
    // back as the same "invalid credentials" answer as a wrong password:
    // answering 400 there would hand out a free distinguishing signal.
    const header = Buffer.from(`${VALID_EMAIL}\n密码Ab3!xY9#`, 'utf8').toString('base64url');
    const parsed = parseGuestOrderCredentialHeader(header);
    assert.equal(parsed.email, VALID_EMAIL);
    const stored = hashGuestQueryPassword(VALID_PASSWORD);
    const result = verifyGuestQueryPassword(parsed.password, stored);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'password_invalid');
    assert.notEqual(result.reason, 'bad_password',
        'internally distinguishable for the audit row, externally identical');
});

// ---------------------------------------------------------------------------
// §6.3 — contact-hash pepper and derivation stability
// ---------------------------------------------------------------------------

function legacyHashContact(env, value) {
    // Byte-for-byte copy of the inline hashContact() in
    // server/api-handlers/public/guest-shop.js, which produced every
    // guest_shop_orders.buyer_contact_hash that already exists.
    if (!value) return null;
    const pepper = String(env.GUEST_SHOP_CONTACT_HASH_PEPPER || env.GUEST_SHOP_CLAIM_PEPPER || '').trim();
    if (!pepper) return null;
    return crypto.createHmac('sha256', pepper).update(String(value).trim().toLowerCase()).digest('hex');
}

test('hashGuestContact is byte-identical to the legacy inline derivation', () => {
    const envs = [
        { GUEST_SHOP_CONTACT_HASH_PEPPER: STRONG_PEPPER, GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER },
        { GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER },
        {},
        { GUEST_SHOP_CONTACT_HASH_PEPPER: STRONG_PEPPER }
    ];
    for (const env of envs) {
        for (const email of ['Alice@Example.COM', '  bob@x.io  ', 'c@d.co']) {
            assert.equal(
                hashGuestContact(email, { env, strict: false }),
                legacyHashContact(env, email),
                `derivation drifted for ${JSON.stringify(env)}`
            );
        }
    }
    const strict = hashGuestContact('Alice@Example.COM', { env: PEPPER_ENV });
    assert.equal(strict, legacyHashContact(PEPPER_ENV, 'Alice@Example.COM'));
    assert.match(strict, /^[0-9a-f]{64}$/u, 'the DB CHECK requires 64 lowercase hex');
    assert.equal(hashGuestContact('  ALICE@example.com ', { env: PEPPER_ENV }), strict,
        'the email is the only value that gets lower(trim(...))');
});

test('the strict contact pepper fails closed and refuses to reuse another secret', () => {
    assert.throws(() => hashGuestContact(VALID_EMAIL, { env: {} }),
        (error) => error.statusCode === 503 && error.code === 'guest_shop_misconfigured' && error.expose === false);
    assert.throws(() => hashGuestContact(VALID_EMAIL, { env: { GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER } }),
        (error) => error.code === 'guest_shop_misconfigured',
        'no claim-pepper fallback on the strict path: a later pepper rotation would orphan every stored hash');
    assert.throws(() => hashGuestContact('', { env: PEPPER_ENV }),
        (error) => error.code === 'required_field');
    assert.equal(hashGuestContact('', { env: PEPPER_ENV, strict: false }), null);

    for (const [name, value] of [
        ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE],
        ['CRON_SECRET', 'cron-secret-0123456789-abcdefghijklmnopqrstuvwxyz'],
        ['GUEST_SHOP_CLAIM_PEPPER', CLAIM_PEPPER],
        ['GUEST_SHOP_CLAIM_DERIVATION_PEPPER', 'derivation-pepper-0123456789-abcdefghijklmnopqrstu']
    ]) {
        assert.throws(
            () => getGuestContactHashPepper({ GUEST_SHOP_CONTACT_HASH_PEPPER: value, [name]: value }),
            (error) => error.code === 'guest_shop_misconfigured',
            `${name} must never double as the contact-hash pepper`
        );
    }
    assert.throws(() => getGuestContactHashPepper({ GUEST_SHOP_CONTACT_HASH_PEPPER: 'short-pepper' }),
        (error) => error.code === 'guest_shop_misconfigured');
    assert.throws(() => getGuestContactHashPepper({ GUEST_SHOP_CONTACT_HASH_PEPPER: 'x'.repeat(31) }),
        (error) => error.code === 'guest_shop_misconfigured');
    assert.equal(getGuestContactHashPepper({ GUEST_SHOP_CONTACT_HASH_PEPPER: 'x'.repeat(32) }), 'x'.repeat(32));
    assert.equal(getGuestContactHashPepper({}, { strict: false }), '');
    assert.equal(getGuestContactHashPepper({ GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER }, { strict: false }), CLAIM_PEPPER);
    for (const env of [{}, { GUEST_SHOP_CONTACT_HASH_PEPPER: 'short' }]) {
        try {
            getGuestContactHashPepper(env);
            assert.fail('expected a fail-closed error');
        } catch (error) {
            assert.doesNotMatch(error.message, /short|pepper-value/u);
            // `includes('')` is unconditionally true, so the leak assertion is
            // only meaningful for the non-empty misconfiguration.
            const configured = String(env.GUEST_SHOP_CONTACT_HASH_PEPPER || '');
            if (configured) {
                assert.ok(!String(error.message).includes(configured),
                    'the error message must not leak the secret');
            }
            assert.equal(error.statusCode, 503);
            assert.equal(error.expose, false, 'a misconfiguration is never a client-facing detail');
        }
    }
});

// ---------------------------------------------------------------------------
// §8.3 — isolation and secret hygiene
// ---------------------------------------------------------------------------

test('the query password is never an input to any other credential or authentication', () => {
    const idempotencyKey = 'GSa1B2c3D4e5F6g7H8i9J0';
    const derivationEnv = { GUEST_SHOP_CLAIM_DERIVATION_PEPPER: CLAIM_PEPPER };
    const before = security.deriveClaimSecretFromIdempotencyKey(idempotencyKey, { site: 'cn', env: derivationEnv });
    // Hashing / verifying a buyer password must not perturb any other
    // credential derivation: the two systems share no key material.
    hashGuestQueryPassword(VALID_PASSWORD);
    verifyGuestQueryPassword(VALID_PASSWORD, hashGuestQueryPassword(VALID_PASSWORD));
    const after = security.deriveClaimSecretFromIdempotencyKey(idempotencyKey, { site: 'cn', env: derivationEnv });
    assert.equal(before, after);

    const claimHash = security.hashClaimSecret(security.generateClaimSecret(), {
        env: { GUEST_SHOP_CLAIM_PEPPER: CLAIM_PEPPER }
    });
    const passwordHash = hashGuestQueryPassword(VALID_PASSWORD);
    assert.ok(claimHash.startsWith('hmac-sha256:v1:'));
    assert.ok(passwordHash.startsWith('scrypt$'));
    assert.notEqual(claimHash, passwordHash);

    const source = fs.readFileSync(SECURITY_MODULE_PATH, 'utf8');
    const credentialSection = stripComments(source.slice(source.indexOf('Order Access 2.0 (A1)')));
    assert.doesNotMatch(credentialSection, /auth\.users|supabase\.auth|signIn|access_token|refresh_token/u,
        'the query password must never reach the account auth system');
    assert.doesNotMatch(credentialSection, /GUEST_SHOP_BUYER_PASSWORD_PEPPER/u,
        '§6.3: no password pepper, salt only');
    assert.doesNotMatch(source, /console\.(log|info|warn|error)\([^)]*password/ui,
        'the password must never be logged');
});

test('the query password is redacted by the existing log sanitizer', () => {
    const sanitized = security.sanitizeGuestLogContext({
        email: VALID_EMAIL,
        orderPassword: VALID_PASSWORD,
        order_password: VALID_PASSWORD,
        password: VALID_PASSWORD,
        credential: buildGuestOrderCredentialHeader(VALID_EMAIL, VALID_PASSWORD),
        passwordHash: hashGuestQueryPassword(VALID_PASSWORD),
        quantity: 1
    });
    assert.equal(sanitized.orderPassword, '[REDACTED]');
    assert.equal(sanitized.order_password, '[REDACTED]');
    assert.equal(sanitized.password, '[REDACTED]');
    assert.equal(sanitized.credential, '[REDACTED]');
    assert.equal(sanitized.passwordHash, '[REDACTED]');
    assert.equal(sanitized.quantity, 1);
    assert.ok(!JSON.stringify(sanitized).includes(VALID_PASSWORD));
});

test('policy results never echo the candidate password', () => {
    for (const candidate of ['Ab3!xY9#', 'abcd123!', 'Password1!', 'Qwer1234!', 'Aa1!Aa1!', '密码Ab3!xY9#']) {
        const result = validateGuestQueryPasswordPolicy(candidate);
        assert.doesNotMatch(result.reason || '', new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
        const normalized = normalizeGuestQueryPassword(candidate);
        // `value` is the normalized candidate (needed by the order path to
        // hash it) and must therefore never be serialized into a response.
        assert.ok(normalized.value === candidate || normalized.value === foldFullwidthAscii(candidate));
    }
    assert.throws(() => assertGuestQueryPasswordPolicy('Password1!'), (error) => {
        assert.doesNotMatch(error.message, /Password1!/u);
        assert.equal(error.rule, 'P7a');
        return true;
    });
});

test('monotonic and repeat run helpers behave on boundaries', () => {
    assert.equal(longestMonotonicRun('abc'), 3);
    assert.equal(longestMonotonicRun('abcd'), 4);
    assert.equal(longestMonotonicRun('dcba'), 4);
    assert.equal(longestMonotonicRun('1234'), 4);
    assert.equal(longestMonotonicRun('9876'), 4);
    assert.equal(longestMonotonicRun('a1'), 1, 'digit and letter are not adjacent in code point order');
    assert.equal(longestMonotonicRun('ab!cd'), 2, 'punctuation breaks the run');
    assert.equal(longestRepeatRun('aaab'), 3);
    assert.equal(longestRepeatRun('a!a!a!'), 1);
});
