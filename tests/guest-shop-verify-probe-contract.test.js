'use strict';

/**
 * verify 脚本自身的合同测试（纯静态重放：Codex 不执行 SQL，AGENTS.md 硬禁令）。
 *
 * 为什么必须有这个文件
 * ---------------------------------------------------------------------------
 * 2026-09-18 用户在 Supabase 手工执行 `20260920_verify_guest_shop_buyer_credentials.sql`
 * 时，`buyers_constraints.password_format_pins_scrypt_and_norm_version` 报了 FAIL，
 * 但迁移其实是**正确的**（`tests/guest-shop-buyer-credentials.test.js` 早已用真实
 * scrypt 产物逐字验证过那条 CHECK）。真正错的是 verify 的探针：
 *
 *     def ~ 'norm=v[0-9]+'        -- 正则：要求 norm=v 后面紧跟一个数字
 *
 * 而 `pg_get_constraintdef` 返回的文本里，`norm=v` 后面是字符 `[`：
 *
 *     CHECK ((password_hash)::text ~ '^scrypt\$...\$norm=v[0-9]+\$...')
 *
 * 也就是说，探针把「存着正则源码的 CHECK 定义」当成普通文本去做正则匹配，
 * 永远不可能命中 → 假 FAIL。假 FAIL 的代价很高：它会让运维以为迁移坏了，
 * 从而不敢打开开关，或者更糟——去「修」一个本来正确的迁移。
 *
 * 这个文件把 verify 脚本里所有作用于**约束定义文本**的探针抽出来，在 Node 里按
 * PostgreSQL 语义重放一遍（strpos/LIKE = 字面量，`~`/`!~` = POSIX 正则），断言
 * 它们对真实迁移文本成立。同类错误再犯时，测试会先失败。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_DIR = path.join(REPO_ROOT, 'supabase/migrations');

const security = require('../api/_lib/guest-shop/security');

const A0_MIGRATION = '20260920_guest_shop_buyer_credentials.sql';
const A0_VERIFY = '20260920_verify_guest_shop_buyer_credentials.sql';
const A1B_VERIFY = '20260921_verify_guest_shop_buyer_group_upsert.sql';
const A3_MIGRATION = '20260922_guest_shop_access_resets.sql';
const A3_VERIFY = '20260922_verify_guest_shop_access_resets.sql';
// L1+L2 促销批（2026-09-23）。这两个文件不进入 CONFIGS：CONFIGS 重放的是
// 「约束定义文本」探针，靠迁移里的 CREATE TABLE 重建 pg_get_constraintdef；
// 促销批的约束全部由 ALTER TABLE ... ADD CONSTRAINT 追加，没有可重建的
// CREATE TABLE 主体。促销 verify 的函数体探针由下面第 7 节单独重放。
const PROMO_MIGRATION = '20260923_guest_shop_promo_l1l2.sql';
const PROMO_VERIFY = '20260923_verify_guest_shop_promo_l1l2.sql';

/** 存着「正则源码」的约束：只允许字面量探针，禁止 `~`。 */
const REGEX_BEARING_CONSTRAINTS = [
    'guest_shop_buyers_pwd_format',
    'guest_shop_buyers_hash_check',
    'guest_shop_access_resets_token_check'
];

const SOURCES = {
    a0Migration: fs.readFileSync(path.join(MIGRATION_DIR, A0_MIGRATION), 'utf8'),
    a0Verify: fs.readFileSync(path.join(MIGRATION_DIR, A0_VERIFY), 'utf8'),
    a1bVerify: fs.readFileSync(path.join(MIGRATION_DIR, A1B_VERIFY), 'utf8'),
    a3Migration: fs.readFileSync(path.join(MIGRATION_DIR, A3_MIGRATION), 'utf8'),
    a3Verify: fs.readFileSync(path.join(MIGRATION_DIR, A3_VERIFY), 'utf8'),
    promoMigration: fs.readFileSync(path.join(MIGRATION_DIR, PROMO_MIGRATION), 'utf8'),
    promoVerify: fs.readFileSync(path.join(MIGRATION_DIR, PROMO_VERIFY), 'utf8')
};

// ---------------------------------------------------------------------------
// SQL 静态解析工具（只读文本，不连接数据库）
// ---------------------------------------------------------------------------

function stripSqlComments(source) {
    return String(source)
        .split('\n')
        .map((line) => {
            const index = line.indexOf('--');
            return index === -1 ? line : line.slice(0, index);
        })
        .join('\n');
}

/** 从 `text[openIndex] === '('` 开始做配平扫描，跳过字符串字面量。 */
function balancedSlice(text, openIndex) {
    let depth = 0;
    let inString = false;
    for (let i = openIndex; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (ch === "'") {
                if (text[i + 1] === "'") {
                    i += 1;
                    continue;
                }
                inString = false;
            }
            continue;
        }
        if (ch === "'") {
            inString = true;
            continue;
        }
        if (ch === '(') {
            depth += 1;
        } else if (ch === ')') {
            depth -= 1;
            if (depth === 0) {
                return { body: text.slice(openIndex + 1, i), endIndex: i };
            }
        }
    }
    throw new Error('unbalanced parentheses while scanning verify/migration SQL');
}

/** 去掉整体外层括号：`(a AND b)` -> `a AND b`。 */
function unwrapParens(text) {
    let out = text.trim();
    for (;;) {
        if (!out.startsWith('(')) return out;
        const slice = balancedSlice(out, 0);
        if (slice.endIndex !== out.length - 1) return out;
        out = slice.body.trim();
    }
}

/**
 * 把迁移源码里的 CHECK 体近似成 pg_get_constraintdef 的输出。
 * PostgreSQL 会把 `x BETWEEN 1 AND 5` 反解析成 `x >= 1 AND x <= 5`，
 * 这一步必须模拟，否则数值上界探针无法重放。
 */
function canonicaliseDef(expr) {
    return expr
        .replace(
            /([A-Za-z_][A-Za-z0-9_]*)\s+BETWEEN\s+([0-9]+)\s+AND\s+([0-9]+)/gu,
            '$1 >= $2 AND $1 <= $3'
        )
        .replace(/\s+/gu, ' ')
        .trim();
}

function tableBody(code, tableName) {
    const marker = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tableName}\\s*\\(`, 'u');
    const matched = marker.exec(code);
    assert.ok(matched, `migration must create public.${tableName}`);
    return balancedSlice(code, matched.index + matched[0].length - 1).body;
}

/** conname -> 近似 pg_get_constraintdef 文本。 */
function constraintDefs(code, tableName) {
    const body = tableBody(code, tableName);
    const map = new Map();
    const re = /CONSTRAINT\s+([A-Za-z0-9_]+)\s+(CHECK|UNIQUE|PRIMARY KEY|FOREIGN KEY)\b/giu;
    let matched;
    while ((matched = re.exec(body)) !== null) {
        const name = matched[1];
        const kind = matched[2].toUpperCase();
        const openIndex = body.indexOf('(', re.lastIndex);
        assert.notEqual(openIndex, -1, `constraint ${name} must have a parenthesised body`);
        const inner = balancedSlice(body, openIndex).body;
        map.set(
            name,
            kind === 'CHECK'
                ? `CHECK (${canonicaliseDef(inner)})`
                : `${kind} (${inner.replace(/\s+/gu, ' ').trim()})`
        );
    }
    assert.ok(map.size > 0, `no constraints parsed for ${tableName}`);
    return map;
}

/** guest_shop_orders.buyer_id 是内联 REFERENCES，没有显式约束名。 */
function ordersBuyerFkDef(code) {
    assert.match(
        code,
        /ADD COLUMN IF NOT EXISTS buyer_id UUID\s+REFERENCES public\.guest_shop_buyers\(id\) ON DELETE SET NULL/u,
        'orders.buyer_id must stay a nullable ON DELETE SET NULL foreign key'
    );
    return 'FOREIGN KEY (buyer_id) REFERENCES guest_shop_buyers(id) ON DELETE SET NULL';
}

// ---------------------------------------------------------------------------
// 探针重放：把受限的 SQL 布尔表达式按 PostgreSQL 语义求值
// ---------------------------------------------------------------------------

function escapeForRegex(char) {
    return /[.*+?^${}()|[\]\\]/u.test(char) ? `\\${char}` : char;
}

/** LIKE -> 正则：% 匹配任意串，_ 匹配任意单字符，其余全部字面量。 */
function likeToRegExp(pattern) {
    let out = '';
    for (const char of pattern) {
        if (char === '%') out += '[\\s\\S]*';
        else if (char === '_') out += '[\\s\\S]';
        else out += escapeForRegex(char);
    }
    return new RegExp(out, 'u');
}

const POSIX_CLASSES = {
    '[[:space:]]': '\\s',
    '[[:alpha:]]': '[A-Za-z]',
    '[[:digit:]]': '[0-9]',
    '[[:alnum:]]': '[A-Za-z0-9]'
};

/** POSIX 正则 -> JS 正则（只翻译本仓用到的字符类，遇到未知的一律抛错）。 */
function posixToRegExp(pattern) {
    let out = pattern;
    for (const [posix, js] of Object.entries(POSIX_CLASSES)) {
        out = out.split(posix).join(js);
    }
    const leftover = /\[\[:[a-z]+:\]\]/u.exec(out);
    assert.equal(
        leftover,
        null,
        `verify probe harness cannot translate POSIX class: ${leftover && leftover[0]}`
    );
    return new RegExp(out, 'u');
}

function isWordChar(char) {
    return typeof char === 'string' && /[A-Za-z0-9_]/u.test(char);
}

function splitTopLevel(text, keyword) {
    const parts = [];
    const upper = text.toUpperCase();
    let depth = 0;
    let inString = false;
    let current = '';
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            current += ch;
            if (ch === "'") {
                if (text[i + 1] === "'") {
                    current += "'";
                    i += 1;
                } else {
                    inString = false;
                }
            }
            continue;
        }
        if (ch === "'") {
            inString = true;
            current += ch;
            continue;
        }
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        const isKeyword =
            depth === 0 &&
            upper.startsWith(keyword, i) &&
            !isWordChar(text[i - 1]) &&
            !isWordChar(text[i + keyword.length]);
        if (isKeyword) {
            parts.push(current);
            current = '';
            i += keyword.length - 1;
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts.map((part) => unwrapParens(part)).filter((part) => part.length > 0);
}

/** 单条谓词求值。遇到无法识别的写法一律抛错，避免「静默跳过」造成假通过。 */
function evaluatePredicate(predicate, defText) {
    const text = predicate.replace(/\s+/gu, ' ').trim();
    let matched = /^strpos\((?:c\.)?def, '([^']*)'\) > 0$/u.exec(text);
    if (matched) return { kind: 'strpos', needle: matched[1], ok: defText.includes(matched[1]) };

    matched = /^strpos\((?:c\.)?def, '([^']*)'\) = 0$/u.exec(text);
    if (matched) return { kind: 'strpos-absent', needle: matched[1], ok: !defText.includes(matched[1]) };

    matched = /^(?:c\.)?def LIKE '([^']*)'$/u.exec(text);
    if (matched) return { kind: 'like', needle: matched[1], ok: likeToRegExp(matched[1]).test(defText) };

    matched = /^(?:c\.)?def !~ '([^']*)'$/u.exec(text);
    if (matched) return { kind: 'not-regex', needle: matched[1], ok: !posixToRegExp(matched[1]).test(defText) };

    matched = /^(?:c\.)?def ~ '([^']*)'$/u.exec(text);
    if (matched) return { kind: 'regex', needle: matched[1], ok: posixToRegExp(matched[1]).test(defText) };

    matched = /^COALESCE\(\(substring\((?:c\.)?def from '([^']*)'\)\)::int, 0\) >= ([0-9]+)$/u.exec(text);
    if (matched) {
        const captured = new RegExp(matched[1], 'u').exec(defText);
        const value = captured ? Number.parseInt(captured[1], 10) : 0;
        const bound = Number.parseInt(matched[2], 10);
        return { kind: 'numeric-bound', needle: matched[1], bound, ok: Number.isFinite(value) && value >= bound };
    }

    throw new Error(`verify probe harness does not understand this predicate: ${text}`);
}

function predicateExpression(blockText) {
    const boolAndIndex = blockText.search(/bool_and\(/u);
    if (boolAndIndex !== -1) {
        return balancedSlice(blockText, blockText.indexOf('(', boolAndIndex)).body;
    }
    const whereIndex = blockText.search(/\bWHERE\b/iu);
    assert.notEqual(whereIndex, -1, 'probe subquery must have bool_and() or a WHERE clause');
    let tail = blockText.slice(whereIndex + 5);
    const conname = /conname\s*=\s*'[A-Za-z0-9_]+'\s*(?:AND\b)?/iu.exec(tail);
    if (conname) tail = tail.slice(conname.index + conname[0].length);
    return tail;
}

/** 抽出所有作用于约束定义 CTE 的探针子查询。 */
function probeBlocks(verifyCode, cteNames) {
    const blocks = [];
    const re = /\(\s*SELECT\b/gu;
    let matched;
    while ((matched = re.exec(verifyCode)) !== null) {
        const slice = balancedSlice(verifyCode, matched.index);
        const text = slice.body;
        const from = /\bFROM\s+([A-Za-z0-9_]+)/iu.exec(text);
        if (!from || !cteNames.includes(from[1])) continue;
        if (!/bool_and\(|COUNT\(\*\) = 1/u.test(text)) continue;
        const conname = /conname\s*=\s*'([A-Za-z0-9_]+)'/u.exec(text);
        blocks.push({
            cte: from[1],
            conname: conname ? conname[1] : null,
            expression: unwrapParens(predicateExpression(text))
        });
    }
    return blocks;
}

/** OR 优先级低于 AND：先按顶层 OR 拆分支，再按顶层 AND 拆谓词。 */
function replay(expression, defText) {
    const alternatives = splitTopLevel(expression, 'OR');
    assert.ok(alternatives.length > 0, 'probe expression must not be empty');
    const evaluated = [];
    let pass = false;
    for (const alternative of alternatives) {
        const predicates = splitTopLevel(alternative, 'AND').map((item) => evaluatePredicate(item, defText));
        evaluated.push(...predicates);
        if (predicates.every((item) => item.ok)) pass = true;
    }
    return { pass, predicates: evaluated };
}

const A0_CODE = stripSqlComments(SOURCES.a0Migration);
const A3_CODE = stripSqlComments(SOURCES.a3Migration);

const DEFS = {
    buyers_constraints: constraintDefs(A0_CODE, 'guest_shop_buyers'),
    attempts_constraints: constraintDefs(A0_CODE, 'guest_shop_access_attempts'),
    orders_constraints: new Map([[null, ordersBuyerFkDef(A0_CODE)]]),
    resets_constraints: constraintDefs(A3_CODE, 'guest_shop_access_resets')
};

const CONFIGS = [
    {
        label: A0_VERIFY,
        verifyCode: stripSqlComments(SOURCES.a0Verify),
        ctes: ['buyers_constraints', 'attempts_constraints', 'orders_constraints'],
        minBlocks: 6
    },
    {
        label: A3_VERIFY,
        verifyCode: stripSqlComments(SOURCES.a3Verify),
        ctes: ['resets_constraints'],
        minBlocks: 3
    }
];

function replayAll(config) {
    const blocks = probeBlocks(config.verifyCode, config.ctes);
    assert.ok(
        blocks.length >= config.minBlocks,
        `${config.label}: harness only found ${blocks.length} probe blocks, expected >= ${config.minBlocks}` +
            ' (a parser regression must not silently shrink coverage)'
    );
    return blocks.map((block) => {
        const defs = DEFS[block.cte];
        assert.ok(defs, `${config.label}: unknown constraint CTE ${block.cte}`);
        const key = block.conname === null ? null : block.conname;
        assert.ok(
            defs.has(key),
            `${config.label}: probe targets constraint "${block.conname}" which the migration does not define`
        );
        const defText = defs.get(key);
        const result = replay(block.expression, defText);
        return { ...block, defText, ...result };
    });
}

// ---------------------------------------------------------------------------
// 1. 全量重放：verify 的每条约束探针都必须对真实迁移文本成立
// ---------------------------------------------------------------------------

for (const config of CONFIGS) {
    test(`every constraint probe in ${config.label} holds against the real migration text`, () => {
        const failures = [];
        for (const block of replayAll(config)) {
            if (block.pass) continue;
            for (const predicate of block.predicates) {
                if (predicate.ok) continue;
                const literalHit = predicate.kind === 'regex' && block.defText.includes(predicate.needle);
                failures.push(
                    `  [${block.cte}${block.conname ? `:${block.conname}` : ''}] ` +
                        `${predicate.kind} '${predicate.needle}'` +
                        (literalHit
                            ? '\n      -> LITERAL/REGEX CONFUSION: the needle appears verbatim in the definition, so this' +
                              ' probe matches regex SOURCE with a regex. Use strpos()/LIKE instead.'
                            : '') +
                        `\n      definition: ${block.defText.slice(0, 180)}`
                );
            }
        }
        assert.deepEqual(failures, [], `${config.label} has verify probes that cannot pass:\n${failures.join('\n')}`);
    });
}

// ---------------------------------------------------------------------------
// 2. 存正则源码的约束只能用字面量探针
// ---------------------------------------------------------------------------

test('constraints that store regex source are probed literally, never with ~', () => {
    let guarded = 0;
    for (const config of CONFIGS) {
        for (const block of replayAll(config)) {
            if (!block.conname || !REGEX_BEARING_CONSTRAINTS.includes(block.conname)) continue;
            guarded += 1;
            for (const predicate of block.predicates) {
                assert.ok(
                    predicate.kind === 'strpos' || predicate.kind === 'like' || predicate.kind === 'strpos-absent',
                    `${config.label}: ${block.conname} stores regex source and must not be probed with ` +
                        `"${predicate.kind}" (needle '${predicate.needle}'); use strpos()/LIKE`
                );
            }
        }
    }
    assert.ok(guarded >= 3, `expected to guard all three regex-bearing constraints, only saw ${guarded}`);
});

test('the pwd_format probe pins scrypt, the norm version field and the base64 alphabet', () => {
    const block = replayAll(CONFIGS[0]).find((item) => item.conname === 'guest_shop_buyers_pwd_format');
    assert.ok(block, 'the verify script must keep probing guest_shop_buyers_pwd_format');
    const needles = block.predicates.map((predicate) => predicate.needle);
    for (const required of ['scrypt', 'password_hash', 'norm=v[0-9]+', '[A-Za-z0-9+/=]+']) {
        assert.ok(needles.includes(required), `pwd_format probe must pin the literal "${required}"`);
    }
    // 探针里不允许出现反斜杠：这样它对 standard_conforming_strings 的取值免疫。
    for (const needle of needles) {
        assert.ok(!needle.includes('\\'), `pwd_format probe needle must stay backslash-free: ${needle}`);
    }
    assert.match(SOURCES.a0Verify, /RULE FOR PROBE AUTHORS/u, 'the lesson must stay documented in the verify header');
});

test('the contact_hash probe pins the whole 64-hex class literally', () => {
    const block = replayAll(CONFIGS[0]).find((item) => item.conname === 'guest_shop_buyers_hash_check');
    assert.ok(block, 'the verify script must keep probing guest_shop_buyers_hash_check');
    const needles = block.predicates.map((predicate) => predicate.needle);
    assert.ok(needles.includes('contact_hash'), 'the probe must name the column');
    // 只写 '0-9a-f' 会放过任何长度；必须钉住完整的 {64} 类。
    assert.ok(
        needles.includes('[0-9a-f]{64}'),
        'the probe must pin the full 64-hex class, not just its alphabet'
    );
    for (const predicate of block.predicates) {
        assert.equal(predicate.ok, true, `predicate '${predicate.needle}' must hold against the migration text`);
    }
    // 反向：一个 32 位十六进制的 CHECK 不能通过这条探针。
    const shortened = 'CHECK (contact_hash ~ ' + "'^[0-9a-f]{32}$'" + ')';
    assert.equal(replay(block.expression, shortened).pass, false, 'a shortened hash format must FAIL the probe');
});

// ---------------------------------------------------------------------------
// 3. 分组上界探针必须是数值比较，不能被个位数形状绑死
// ---------------------------------------------------------------------------

test('the credential-group cap probe compares numbers, not digit shapes', () => {
    const block = replayAll(CONFIGS[0]).find((item) => item.conname === 'guest_shop_buyers_group_range');
    assert.ok(block, 'the verify script must keep probing guest_shop_buyers_group_range');
    const numeric = block.predicates.find((predicate) => predicate.kind === 'numeric-bound');
    assert.ok(numeric, 'the group cap must be probed by extracting the upper bound as an integer');
    assert.equal(numeric.bound, 3, 'the DB cap floor is the application cap K38 = 3');

    const def = (cap) => `CHECK (credential_group_no >= 1 AND credential_group_no <= ${cap})`;
    for (const cap of [3, 5, 9, 10, 12, 100]) {
        assert.equal(replay(block.expression, def(cap)).pass, true, `a DB cap of ${cap} (>= app cap 3) must PASS`);
    }
    assert.equal(replay(block.expression, def(2)).pass, false, 'a DB cap below the app cap must FAIL');
    assert.equal(
        replay(block.expression, 'CHECK (credential_group_no >= 1)').pass,
        false,
        'a missing upper bound must FAIL closed, not pass by NULL'
    );
    // 记录被替换掉的旧写法为什么是错的：它把「>= 应用上限」写成了个位数字形状。
    assert.equal(/<= [3-9]/u.test(def(10)), false, 'the retired "<= [3-9]" probe would have failed a two-digit cap');
    assert.equal(/<= [3-9]/u.test(def(5)), true);
});

// ---------------------------------------------------------------------------
// 4. DB CHECK 与应用层真实产物双向一致（正向已有测试，这里补反向）
// ---------------------------------------------------------------------------

function dbPasswordCheckPattern() {
    const matched = SOURCES.a0Migration.match(/guest_shop_buyers_pwd_format\s+CHECK \(password_hash ~ '(.+?)'\)/u);
    assert.ok(matched, 'migration must keep the password_hash format CHECK');
    return new RegExp(matched[1]);
}

test('the password_hash CHECK accepts real minted hashes and rejects look-alikes', () => {
    const pattern = dbPasswordCheckPattern();
    const real = security.hashGuestQueryPassword('Xk9#mQ2$zW');
    assert.equal(pattern.test(real), true, 'a real scrypt hash must satisfy the DB CHECK');

    // 确定性夹具。旧写法直接对随机产物做 base64url 替换，再断言「替换前后不相等」；
    // 但随机盐/哈希里出现 + 或 / 的概率只有约 88%，剩下约 12% 的执行会在这条与
    // 安全无关的断言上随机变红（2026-09-23 实测复现）。这里把 + 与 / 强制放进
    // 盐段和哈希段：既消除了抖动，又顺带证明 CHECK 的字母表确实接受 + 和 /。
    const SEP = String.fromCharCode(36);
    const parts = real.split(SEP);
    assert.equal(parts.length, 7, 'the minted hash must stay scrypt' + SEP + 'N' + SEP + 'r' + SEP + 'p' + SEP + 'norm=v1' + SEP + 'salt' + SEP + 'hash');
    parts[5] = '+' + parts[5].slice(1);
    parts[6] = '/' + parts[6].slice(1);
    const forced = parts.join(SEP);
    assert.equal(pattern.test(forced), true, 'the CHECK alphabet [A-Za-z0-9+/=] must accept + and /');

    const base64url = forced.replace(/[+/]/gu, (char) => (char === '+' ? '-' : '_'));
    assert.notEqual(base64url, forced, 'the fixture must actually exercise the base64url alphabet');
    assert.equal(pattern.test(base64url), false, 'base64url must be rejected: the CHECK alphabet is [A-Za-z0-9+/=]');

    assert.equal(pattern.test(real.replace('$norm=v1', '')), false, 'a missing norm segment must be rejected');
    assert.equal(pattern.test('Xk9#mQ2$zW'), false, 'a plaintext query password must never satisfy the CHECK');
    assert.equal(pattern.test(''), false);
    assert.equal(pattern.test('scrypt$32768$8$1$norm=v1$AAAAAAAA'), false, 'a truncated hash must be rejected');
});

// ---------------------------------------------------------------------------
// 5. verify 脚本永远只读 + 行清单冻结
// ---------------------------------------------------------------------------

test('all four verify scripts stay read-only', () => {
    const sources = [
        [A0_VERIFY, SOURCES.a0Verify],
        [A1B_VERIFY, SOURCES.a1bVerify],
        [A3_VERIFY, SOURCES.a3Verify],
        [PROMO_VERIFY, SOURCES.promoVerify]
    ];
    for (const [name, source] of sources) {
        const code = stripSqlComments(source);
        assert.doesNotMatch(
            code,
            /^\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL)\b/imu,
            `${name} must not contain a statement-leading write/DDL keyword`
        );
        assert.match(source, /Codex does not execute this file/u, `${name} must stay labelled as user-executed`);
    }
});

test('the verify row inventory is frozen so a row cannot be silently dropped', () => {
    function checkNames(source) {
        const names = [];
        const re = /^ {8}'([a-z0-9_]+)'(?:::TEXT AS check_name)?,$/gmu;
        let matched;
        while ((matched = re.exec(source)) !== null) names.push(matched[1]);
        return names;
    }
    assert.deepEqual(checkNames(SOURCES.a0Verify), [
        'buyer_tables_present',
        'buyers_columns',
        'buyers_constraints',
        'buyers_indexes',
        'access_attempts_shape',
        'rls_and_privileges_closed',
        'orders_buyer_id_link',
        'create_order_signature_migrated',
        'create_order_buyer_binding_guards',
        'create_order_grants',
        'a0_is_behaviour_neutral'
    ]);
    // 2026-09-18 补：A1b 的 verify 此前不在冻结清单里，结果文档把它的行数写成 5
    // （真实为 6，见 docs/guest-shop-promo-evidence.md §1.7）。三个 verify 现在全部在册，
    // 少一行或多一行都会红，「静默丢一行校验」不再可能。
    assert.deepEqual(checkNames(SOURCES.a1bVerify), [
        'upsert_fn_present_and_unique',
        'upsert_fn_signature',
        'upsert_fn_security_posture',
        'upsert_fn_grants',
        'upsert_fn_body_guarantees',
        'a1b_is_additive'
    ]);
    assert.deepEqual(checkNames(SOURCES.a3Verify), [
        'resets_table_present',
        'resets_columns',
        'resets_constraints',
        'resets_indexes',
        'attempts_outcome_widened',
        'rls_and_privileges',
        'no_side_effects'
    ]);
    // 2026-09-23 补：促销 verify 首次被执行时是 22 行，其中两行是探针缺陷
    // （见第 7、8 节）。修完后是 23 行：第 16 行去掉被钉死的运维状态、
    // 第 23 行新增 operator_state_review。行数与名字都冻结在这里。
    assert.deepEqual(checkNames(SOURCES.promoVerify), [
        'orders_new_columns',
        'orders_amount_check',
        'orders_quantity_and_code_checks',
        'reservations_multi_row',
        'ledger_table_columns',
        'ledger_constraints',
        'ledger_indexes',
        'ledger_rls_and_privileges',
        'function_arity_single_overload',
        'function_privileges',
        'function_hardening',
        'zero_purchase_guards',
        'resolver_tier_flash_parity',
        'replay_return_types_cast',
        'existing_rows_satisfy_new_checks',
        'no_side_effects',
        'discount_codes_guest_columns',
        'promo_budget_table',
        'promo_breaker_table',
        'promo_breaker_events_table',
        'ledger_return_columns',
        'promo_function_guards',
        'operator_state_review'
    ]);
});

// ---------------------------------------------------------------------------
// 6. 自检：重放工具本身必须能抓到那个 bug，否则前面全是空转
// ---------------------------------------------------------------------------

test('the harness reproduces and diagnoses the retired false-FAIL probe', () => {
    const defText = DEFS.buyers_constraints.get('guest_shop_buyers_pwd_format');
    assert.ok(defText.includes('norm=v[0-9]+'), 'fixture must contain the stored regex source verbatim');

    // 这就是 2026-09-18 在真实 Supabase 上报 FAIL 的那条探针，逐字重放。
    const buggy = replay("def ~ 'scrypt' AND def ~ 'norm=v[0-9]+'", defText);
    assert.equal(buggy.pass, false, 'the retired regex probe must reproduce as a false FAIL');
    const failed = buggy.predicates.find((predicate) => !predicate.ok);
    assert.equal(failed.kind, 'regex');
    assert.equal(
        defText.includes(failed.needle),
        true,
        'the needle appears verbatim in the definition: that is the literal/regex confusion signature'
    );

    // 换成字面量探针后，同一段定义必须通过。
    assert.equal(
        replay("strpos(def, 'scrypt') > 0 AND strpos(def, 'norm=v[0-9]+') > 0", defText).pass,
        true,
        'the literal probe must pass on the very same definition text'
    );
    // LIKE 没有字符类：'[0-9]' 是七个字面字符，绝不会去匹配一个数字。
    assert.equal(replay("def LIKE '%norm=v1%'", defText).pass, false, 'LIKE has no character classes');
    assert.equal(replay("def LIKE '%norm=v[0-9]+%'", defText).pass, true);
});

test('the harness refuses to silently skip a predicate shape it does not know', () => {
    assert.throws(
        () => evaluatePredicate("def SIMILAR TO 'scrypt%'", 'CHECK (password_hash)'),
        /does not understand/u
    );
    assert.throws(() => evaluatePredicate("def ~* 'SCRYPT'", 'CHECK (password_hash)'), /does not understand/u);
    assert.throws(
        () => replay("def ~ '[[:upper:]]+'", 'CHECK (x)'),
        /cannot translate POSIX class/u,
        'an unsupported POSIX class must throw instead of evaluating to false'
    );
});
// ---------------------------------------------------------------------------
// 7. 函数体探针必须先剥注释（2026-09-23 促销 verify 首次执行：假 FAIL 第 3 类）
// ---------------------------------------------------------------------------
//
// 用户在 Supabase 执行 20260923_verify_guest_shop_promo_l1l2.sql 后得到
// 22 行、20 PASS / 2 FAIL。第 12 行 zero_purchase_guards 里唯一为 false 的键是
// evaluate_is_read_only，而 fn_guest_shop_evaluate_discount **确实**是只读的：
// 它整段可执行代码里没有任何 INSERT/UPDATE/DELETE/TRUNCATE/EXECUTE，唯一的
// PERFORM 是 guest_shop_require_service_role。命中的是函数自己的一行注释
// （"deduction is the atomic UPDATE pair in fn_guest_shop_reserve_discount"）。
//
// pg_proc.prosrc 原样保留注释，所以「拿关键字正则扫 prosrc」这类探针天生会
// 把注释当代码。修法只有一个方向：先剥注释再扫（verify 里的 CTE fn_code），
// 绝不允许通过删掉那行注释、或删掉只读断言来「让它变绿」。
//
// 剥注释本身也可能制造更危险的**假 PASS**：如果某个字符串字面量里含有 `--`
// 或 `/*`，朴素剥离会把真实代码一起吃掉，于是「有写操作」被扫成「没有」。
// 第 7.2 节用引号/注释双感知的状态机把这条反向风险钉死。

/** 递归收集 .sql 文件（跳过依赖与构建目录）。 */
function walkSqlFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkSqlFiles(full, out);
        else if (entry.name.endsWith('.sql')) out.push(full);
    }
    return out;
}

const GUEST_FN_HEAD = /CREATE OR REPLACE FUNCTION public\.([A-Za-z0-9_]*guest_shop[A-Za-z0-9_]*)\s*\(/gu;

/** 抽出 `$$ ... $$` 之间的函数体（prosrc 的等价物）。 */
function bodyAt(raw, index) {
    const open = raw.indexOf('$$', index);
    if (open === -1) return null;
    const close = raw.indexOf('$$', open + 2);
    if (close === -1) return null;
    return raw.slice(open + 2, close);
}

/**
 * 迁移目录里的函数体，按文件名顺序「后者覆盖前者」——等价于把迁移依次应用到
 * 一个干净数据库后 pg_proc 里的最终状态。
 */
function migrationBodies() {
    const files = fs
        .readdirSync(MIGRATION_DIR)
        .filter((name) => /^\d{8}_[a-z0-9_]+\.sql$/u.test(name))
        .sort();
    const map = new Map();
    for (const name of files) {
        const raw = fs.readFileSync(path.join(MIGRATION_DIR, name), 'utf8');
        GUEST_FN_HEAD.lastIndex = 0;
        let matched;
        while ((matched = GUEST_FN_HEAD.exec(raw)) !== null) {
            const body = bodyAt(raw, matched.index);
            if (body === null) continue;
            map.set(matched[1], { file: name, body });
        }
    }
    return map;
}

/** 全仓库所有 guest_shop 函数体（含测试夹具），用于反向风险扫描。 */
function everyGuestShopBody() {
    const out = [];
    for (const file of walkSqlFiles(REPO_ROOT).sort()) {
        const raw = fs.readFileSync(file, 'utf8');
        GUEST_FN_HEAD.lastIndex = 0;
        let matched;
        while ((matched = GUEST_FN_HEAD.exec(raw)) !== null) {
            const body = bodyAt(raw, matched.index);
            if (body === null) continue;
            out.push({ file: path.relative(REPO_ROOT, file), fn: matched[1], body });
        }
    }
    return out;
}

/** 与 verify 里 CTE fn_code 完全一致的剥注释顺序：先 `--`（n 标志），再块注释（s 标志）。 */
function stripBodyComments(body) {
    return body.replace(/--[^\n]*/gu, ' ').replace(/\/\*[\s\S]*?\*\//gu, ' ');
}

/**
 * 引号 + 注释双感知扫描：只报告**字符串字面量内部**出现的注释标记。
 * 这是朴素剥注释唯一会吃掉真实代码的场景。
 */
function literalsWithCommentMarkers(body) {
    const hits = [];
    let i = 0;
    let dollarTag = null;
    while (i < body.length) {
        if (dollarTag) {
            const close = body.indexOf(dollarTag, i);
            if (close === -1) break;
            const inner = body.slice(i, close);
            if (inner.includes('--') || inner.includes('/*')) hits.push({ kind: 'dollar', sample: inner.slice(0, 80) });
            i = close + dollarTag.length;
            dollarTag = null;
            continue;
        }
        const ch = body[i];
        if (ch === "'") {
            let j = i + 1;
            let literal = '';
            for (;;) {
                if (j >= body.length) break;
                if (body[j] === "'") {
                    if (body[j + 1] === "'") {
                        literal += "''";
                        j += 2;
                        continue;
                    }
                    j += 1;
                    break;
                }
                literal += body[j];
                j += 1;
            }
            if (literal.includes('--') || literal.includes('/*')) hits.push({ kind: 'single', sample: literal.slice(0, 80) });
            i = j;
            continue;
        }
        const dollar = /^\$([A-Za-z0-9_]*)\$/u.exec(body.slice(i, i + 40));
        if (dollar) {
            dollarTag = dollar[0];
            i += dollar[0].length;
            continue;
        }
        if (ch === '-' && body[i + 1] === '-') {
            const newline = body.indexOf('\n', i);
            i = newline === -1 ? body.length : newline + 1;
            continue;
        }
        if (ch === '/' && body[i + 1] === '*') {
            const close = body.indexOf('*/', i + 2);
            i = close === -1 ? body.length : close + 2;
            continue;
        }
        i += 1;
    }
    return hits;
}

/** PostgreSQL 正则 -> JS 正则：只翻译本仓库实际用到的 `\m` / `\y` 词边界。 */
function pgRegexToJs(pattern) {
    if (/\[[:[=:.]/u.test(pattern)) throw new Error(`cannot translate POSIX class in ${pattern}`);
    return pattern.replace(/\\m/gu, '\\b').replace(/\\y/gu, '\\b');
}

function probeMatches(probe, text) {
    if (probe.kind === 'position') return text.includes(probe.needle);
    return new RegExp(pgRegexToJs(probe.needle), probe.caseInsensitive ? 'iu' : 'u').test(text);
}

/**
 * 把 verify 里所有作用于 `code`（= 剥过注释的 prosrc）的 EXISTS / NOT EXISTS
 * 块抽出来，连同极性与 proname 过滤一起返回，供 Node 静态重放。
 */
function extractCodeProbeBlocks(source) {
    const blocks = [];
    const seen = new Set();
    const headRe = /\b(NOT EXISTS|EXISTS)\s*\(/gu;
    let matched;
    while ((matched = headRe.exec(source)) !== null) {
        const openIndex = source.indexOf('(', matched.index + matched[1].length);
        const { body } = balancedSlice(source, openIndex);
        if (seen.has(body)) continue;
        seen.add(body);
        const probes = [];
        const posRe = /position\('((?:[^']|'')*)'\s+in\s+(?:[fp]\.)?code\)\s*>\s*0/gu;
        let p;
        while ((p = posRe.exec(body)) !== null) probes.push({ kind: 'position', needle: p[1].replace(/''/gu, "'") });
        const regRe = /(?:[fp]\.)?code\s*(~\*|~)\s*'((?:[^']|'')*)'/gu;
        while ((p = regRe.exec(body)) !== null) {
            probes.push({ kind: 'regex', needle: p[2].replace(/''/gu, "'"), caseInsensitive: p[1] === '~*' });
        }
        if (probes.length === 0) continue;
        const names = [...body.matchAll(/proname\s*=\s*'([A-Za-z0-9_]+)'/gu)].map((x) => x[1]);
        blocks.push({
            negative: matched[1] === 'NOT EXISTS',
            body,
            probes,
            names,
            // row 11 的守卫块把 proname 和相关变量 x 比较，无法按字面量归属。
            correlated: /proname\s*=\s*[A-Za-z_]/u.test(body.replace(/proname\s*=\s*'[A-Za-z0-9_]+'/gu, ''))
        });
    }
    return blocks;
}

const PROMO_BODIES = migrationBodies();
const PROMO_BLOCKS = extractCodeProbeBlocks(SOURCES.promoVerify);

test('the retired raw-prosrc probe reproduces as a false FAIL and the stripped probe passes', () => {
    const def = PROMO_BODIES.get('fn_guest_shop_evaluate_discount');
    assert.ok(def, 'the promo migration must define fn_guest_shop_evaluate_discount');

    // 1) 假 FAIL 复现：直接拿 verify 第 12 行那条真实探针（DML 关键字正则）
    //    去扫原始 prosrc，它命中了 —— 命中的是注释。
    const dmlProbe = PROMO_BLOCKS.flatMap((block) => block.probes.map((probe) => ({ block, probe })))
        .find(({ probe }) => probe.kind === 'regex' && /TRUNCATE/u.test(probe.needle));
    assert.ok(dmlProbe, 'row 12 must keep the DML keyword probe');
    assert.equal(dmlProbe.block.negative, true, 'the read-only probe must stay a NOT EXISTS probe');
    assert.equal(probeMatches(dmlProbe.probe, def.body), true, 'raw prosrc must still match the retired probe');
    assert.equal(probeMatches(dmlProbe.probe, stripBodyComments(def.body)), false, 'stripped code must not match it');

    // 2) 而且它只出现在注释里。
    const offending = def.body
        .split('\n')
        .filter((line) => /\bUPDATE\b/iu.test(line));
    assert.ok(offending.length > 0, 'fixture must contain the UPDATE line');
    for (const line of offending) {
        assert.match(line.trim(), /^--/u, `UPDATE must live in a comment line, got: ${line.trim()}`);
    }

    // 3) 剥注释后：没有任何 DML，也没有动态 SQL。
    const code = stripBodyComments(def.body);
    assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/iu.test(code), false, 'stripped body must be DML-free');
    assert.equal(/\bEXECUTE\b/iu.test(code), false, 'stripped body must not build dynamic SQL');

    // 4) 剥离必须是「保真」的：守卫与被调用的共享定价器都还在（fail-closed 键）。
    assert.ok(code.includes('guest_shop_require_service_role'), 'the role guard must survive the strip');
    assert.ok(code.includes('fn_resolve_shop_discount_amount'), 'the shared resolver call must survive the strip');

    // 5) 只读的正面证据：所有 PERFORM 目标都只有角色守卫。
    const performs = [...code.matchAll(/PERFORM\s+([A-Za-z0-9_.]+)/gu)].map((x) => x[1]);
    assert.ok(performs.length > 0, 'the function must keep its PERFORM role guard');
    for (const target of performs) {
        assert.match(target, /^(public\.)?guest_shop_require_service_role$/u, `unexpected PERFORM target ${target}`);
    }
});

test('no guest_shop function body hides a comment marker inside a string literal', () => {
    const bodies = everyGuestShopBody();
    // 覆盖面本身也要钉住：夹具被删光时这个测试不能悄悄变成空转。
    assert.ok(bodies.length >= 50, `expected the whole repository to hold >= 50 guest_shop bodies, saw ${bodies.length}`);
    const risky = [];
    for (const entry of bodies) {
        for (const hit of literalsWithCommentMarkers(entry.body)) risky.push(`${entry.file} ${entry.fn} ${hit.kind} ${JSON.stringify(hit.sample)}`);
    }
    assert.deepEqual(
        risky,
        [],
        'a literal containing "--" or "/*" would let the comment strip eat real code and turn a write into a false PASS:\n' +
            risky.join('\n')
    );
});

test('no guest_shop function body writes the catalogue (row 16 mechanism)', () => {
    const needle = PROMO_BLOCKS.flatMap((block) => block.probes)
        .filter((probe) => probe.kind === 'regex' && /shop_products/u.test(probe.needle))
        .map((probe) => probe.needle);
    assert.equal(needle.length, 1, 'row 16 must keep exactly one catalogue-write probe');
    const re = new RegExp(pgRegexToJs(needle[0]), 'iu');
    const hits = [];
    for (const entry of everyGuestShopBody()) {
        if (re.test(entry.body) || re.test(stripBodyComments(entry.body))) hits.push(`${entry.file} ${entry.fn}`);
    }
    assert.deepEqual(hits, [], `a guest_shop function must never write shop_products / shop_product_skus:\n${hits.join('\n')}`);
});

test('the promo verify routes every function-body scan through fn_code', () => {
    const source = SOURCES.promoVerify;
    assert.match(source, /\), fn_code AS \(/u, 'the fn_code CTE must exist');
    assert.match(source, /SELECT f\.\*,/u, 'fn_code must stay a strict superset of guest_fns');
    assert.match(source, /regexp_replace\(f\.prosrc, '--\.\*', ' ', 'gn'\)/u, 'line comments must be stripped first');
    assert.match(source, /'\/\[\*\]\.\*\?\[\*\]\/', ' ', 'gs'/u, 'block comments must be stripped second');

    // 退役的探针形状必须彻底消失：任何直接对 prosrc 做关键字正则的写法。
    assert.doesNotMatch(source, /prosrc\s*~\*?\s*'/u, 'no probe may regex-scan raw prosrc');
    assert.doesNotMatch(source, /in\s+(?:[fp]\.)?prosrc\b/u, 'no probe may position-scan raw prosrc');

    // 剥掉注释行后，prosrc 只允许出现在两个地方：guest_fns 的列清单、fn_code 的输入。
    const codeLines = source
        .split('\n')
        .map((line, index) => ({ index, line }))
        .filter(({ line }) => !/^\s*--/u.test(line) && /prosrc/u.test(line));
    assert.ok(codeLines.length >= 2, 'the fn_code CTE must still read prosrc');
    for (const { index, line } of codeLines) {
        assert.match(
            line,
            /p\.prosrc, p\.proacl|regexp_replace\(f\.prosrc/u,
            `line ${index + 1} still scans raw prosrc: ${line.trim()}`
        );
    }

    // guest_fns 现在只被 fn_code 自己引用一次；其余全部走 fn_code。
    assert.equal((source.match(/FROM guest_fns\b/gu) || []).length, 1, 'only fn_code may read guest_fns directly');
    assert.ok((source.match(/FROM fn_code\b/gu) || []).length >= 30, 'the checks CTE must read fn_code');

    // 教训必须留在文件头，否则下一个人会把探针改回去。
    assert.match(source, /RULE FOR PROBE AUTHORS/u);
    assert.match(source, /prosrc KEEPS the function's own SQL comments/u);
    assert.match(source, /NEVER "fix" this by deleting the rationale comment/u);
});

test('every code probe in the promo verify replays against the real function bodies', () => {
    const correlated = PROMO_BLOCKS.filter((block) => block.correlated);
    assert.equal(correlated.length, 1, 'only the row-11 entrypoint guard block may be correlated');

    const failures = [];
    let positive = 0;
    let negative = 0;
    let fixedByStrip = 0;
    for (const block of PROMO_BLOCKS) {
        if (block.correlated) continue;
        const targets = block.names.length > 0 ? block.names : [...PROMO_BODIES.keys()];
        for (const name of targets) {
            const def = PROMO_BODIES.get(name);
            if (!def) {
                failures.push(`${name}: no definition found in supabase/migrations`);
                continue;
            }
            const code = stripBodyComments(def.body);
            for (const probe of block.probes) {
                const rawHit = probeMatches(probe, def.body);
                const codeHit = probeMatches(probe, code);
                if (block.negative) {
                    negative += 1;
                    if (codeHit) failures.push(`${name}: NEGATIVE probe '${probe.needle}' still matches executable code`);
                    // 剥注释只允许把「假 FAIL」修成 PASS，绝不允许改变正面探针的结论。
                    if (rawHit && !codeHit) fixedByStrip += 1;
                } else {
                    positive += 1;
                    if (!codeHit) failures.push(`${name}: POSITIVE probe '${probe.needle}' is missing from executable code`);
                    if (rawHit !== codeHit) {
                        failures.push(
                            `${name}: POSITIVE probe '${probe.needle}' disagrees between raw prosrc and stripped code; ` +
                                'a positive probe satisfied only by a comment is a false PASS'
                        );
                    }
                }
            }
        }
    }
    assert.deepEqual(failures, [], `promo verify body probes do not replay:\n${failures.join('\n')}`);
    assert.ok(positive >= 45, `expected >= 45 positive body probes, replayed ${positive}`);
    assert.ok(negative >= 3, `expected >= 3 negative body probes, replayed ${negative}`);
    assert.ok(
        fixedByStrip >= 1,
        'the comment strip must actually rescue at least the retired evaluate_is_read_only probe'
    );
});

test('every entrypoint listed in row 11 keeps its role guard in executable code', () => {
    const marker = /'entrypoints_without_role_guard', \(/u.exec(SOURCES.promoVerify);
    assert.ok(marker, 'row 11 must keep the entrypoints_without_role_guard key');
    const region = SOURCES.promoVerify.slice(marker.index, marker.index + 4000);
    const list = /unnest\(ARRAY\[([\s\S]*?)\]\) AS x/u.exec(region);
    assert.ok(list, 'row 11 must enumerate the guarded entrypoints with unnest(ARRAY[...])');
    const names = [...list[1].matchAll(/'([A-Za-z0-9_]+)'/gu)].map((x) => x[1]);
    assert.ok(names.length >= 15, `expected >= 15 guarded entrypoints, saw ${names.length}`);
    for (const name of names) {
        const def = PROMO_BODIES.get(name);
        assert.ok(def, `${name} must be defined in supabase/migrations`);
        assert.ok(
            stripBodyComments(def.body).includes('guest_shop_require_service_role'),
            `${name} must call guest_shop_require_service_role in EXECUTABLE code, not only in a comment`
        );
    }
});

// ---------------------------------------------------------------------------
// 8. 运维状态不得钉死（2026-09-23 促销 verify 首次执行：假 FAIL 第 4 类）
// ---------------------------------------------------------------------------
//
// 同一次执行里第 16 行 no_side_effects 的 guest_products_enabled 报 observed=2 /
// expected=0。这一行根本不是迁移的性质：迁移全文没有对 shop_products 的任何
// INSERT/UPDATE/DELETE，allow_guest_purchase 只作为读闸门出现；「开了几个游客
// 商品」是运维在 Admin Studio 里的决定。把它钉成常量 0，等于宣告「只要有人开过
// 游客商品，正确的迁移就会 FAIL」——而 FAIL 一旦变成常态，运维就会开始忽略所有 FAIL。
//
// 修法：PASS/FAIL 行里保留**机制**断言（任何 guest_shop 函数都不得写目录表），
// 把实时计数挪到第 23 行 operator_state_review，沿用
// 20260915_verify_guest_shop_credit_pricing.sql 第 8 行已有的 REVIEW 约定。

/** 复刻 verify 最后的 CASE，用来证明新旧判分差异只发生在运维状态行。 */
function gradeRow(checkName, observed, expected) {
    if (checkName === 'operator_state_review') {
        const closed =
            Number(observed.guest_products_enabled) === 0 &&
            Number(observed.guest_skus_enabled) === 0 &&
            Number(observed.guest_discount_codes_open) === 0;
        return closed ? 'PASS' : 'REVIEW';
    }
    return JSON.stringify(observed) === JSON.stringify(expected) ? 'PASS' : 'FAIL';
}

test('operator state is reported for review instead of pinned to a constant', () => {
    const source = SOURCES.promoVerify;
    assert.match(source, /'operator_state_review'/u, 'row 23 must exist');
    assert.match(source, /THEN 'PASS' ELSE 'REVIEW'/u, 'row 23 must use the existing REVIEW convention');
    assert.match(source, /REVIEW is not a migration failure/u, 'the report must say REVIEW is not a failure');
    assert.doesNotMatch(source, /'guest_products_enabled',\s*0/u, 'no operator count may be pinned as an expectation');

    // REVIEW 分支必须排在 observed = expected 之前，否则第 23 行永远走不到它。
    const reviewAt = source.indexOf("WHEN check_name = 'operator_state_review' THEN");
    const equalAt = source.indexOf('WHEN observed = expected THEN');
    assert.ok(reviewAt > 0, 'the final CASE must special-case operator_state_review');
    assert.ok(equalAt > reviewAt, 'the REVIEW branch must be evaluated before the equality branch');

    // 机制断言留在 PASS/FAIL 行里。
    assert.match(source, /'promo_functions_never_write_products', NOT EXISTS/u);
    assert.match(source, /'promo_functions_never_write_products', true/u);

    // 第 23 行必须点名具体商品：光有计数无法据此行动（1 -> 2 的增量就是这样发现的）。
    assert.match(source, /'guest_enabled_products'/u);
    assert.match(source, /'guest_skus_enabled'/u);
    assert.match(source, /'guest_discount_codes_open'/u);

    // 文档侧的硬禁令也要在：verify 不得替运维打开开关。
    assert.match(source, /do not enable products or codes from SQL/u);
});

test('the retired pinned expectation FAILs on a correct database and the REVIEW row does not', () => {
    // 用户 2026-09-23 的真实观测值：2 个游客商品。
    const observed = { guest_products_enabled: 2, guest_skus_enabled: 0, guest_discount_codes_open: 0 };

    // 旧写法：把运维状态钉成常量 -> 正确的迁移也会 FAIL。
    assert.equal(gradeRow('no_side_effects', observed, { guest_products_enabled: 0 }), 'FAIL');

    // 新写法：同一个观测值只要求人工确认，不判失败。
    assert.equal(gradeRow('operator_state_review', observed, 'informational'), 'REVIEW');
    assert.equal(
        gradeRow('operator_state_review', { guest_products_enabled: 0, guest_skus_enabled: 0, guest_discount_codes_open: 0 }, 'informational'),
        'PASS',
        'nothing open to guests must still report PASS'
    );
    // REVIEW 不是「什么都不检查」：机制断言仍然会 FAIL。
    assert.equal(gradeRow('no_side_effects', { promo_functions_never_write_products: false }, { promo_functions_never_write_products: true }), 'FAIL');
});
