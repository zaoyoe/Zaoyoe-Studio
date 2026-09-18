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
    a3Verify: fs.readFileSync(path.join(MIGRATION_DIR, A3_VERIFY), 'utf8')
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

    const base64url = real.replace(/[+/]/gu, (char) => (char === '+' ? '-' : '_'));
    assert.notEqual(base64url, real, 'the fixture must actually exercise the base64url alphabet');
    assert.equal(pattern.test(base64url), false, 'base64url must be rejected: the CHECK alphabet is [A-Za-z0-9+/=]');

    assert.equal(pattern.test(real.replace('$norm=v1', '')), false, 'a missing norm segment must be rejected');
    assert.equal(pattern.test('Xk9#mQ2$zW'), false, 'a plaintext query password must never satisfy the CHECK');
    assert.equal(pattern.test(''), false);
    assert.equal(pattern.test('scrypt$32768$8$1$norm=v1$AAAAAAAA'), false, 'a truncated hash must be rejected');
});

// ---------------------------------------------------------------------------
// 5. verify 脚本永远只读 + 行清单冻结
// ---------------------------------------------------------------------------

test('all three verify scripts stay read-only', () => {
    const sources = [
        [A0_VERIFY, SOURCES.a0Verify],
        [A1B_VERIFY, SOURCES.a1bVerify],
        [A3_VERIFY, SOURCES.a3Verify]
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
