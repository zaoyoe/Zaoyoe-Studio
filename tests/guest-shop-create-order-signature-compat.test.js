'use strict';

/**
 * 下单 RPC 签名与调用方的兼容性合同（纯静态：Codex 不执行 SQL、不连库）。
 *
 * 为什么必须有这个文件
 * ---------------------------------------------------------------------------
 * 迁移 `20260920` 把 `fn_guest_shop_create_order` 从 **12 参**换成 **13 参**
 * （新增 `p_buyer_id UUID DEFAULT NULL`），并按精确签名 DROP 掉旧函数。
 * 但「迁移先落库、代码后发布」是本项目**必然**会出现的时间差：
 * 用户在 Supabase 执行 SQL 的那一刻，线上跑的还是 main 分支的旧调用方。
 *
 * 这个时间差之所以安全，靠的是三件事，缺一不可：
 *   1. 调用方用 **PostgREST 具名参数**（对象），不是位置参数数组；
 *   2. 新参数带 `DEFAULT`，且 PG 要求「带默认值的参数必须连续到末尾」，
 *      于是少传 `p_buyer_id` 的具名调用照样能解析到 13 参函数；
 *   3. 函数体里 `IF p_buyer_id IS NOT NULL` 才做绑定校验，`ELSE v_buyer_id := NULL`，
 *      即「不传 = 老行为」，不是「不传 = 报错」。
 *
 * 迁移 `20260923`（促销 L1/L2）又把它从 **13 参**换成 **15 参**
 * （新增 `p_quantity INTEGER DEFAULT 1`、`p_discount_code TEXT DEFAULT NULL`），
 * 同样按精确签名 DROP 旧重载。安全前提完全相同：具名参数 + 尾部 DEFAULT +
 * 「不传 = 老行为」（`COALESCE(p_quantity,1)` / `NULLIF(p_discount_code,'')`）。
 *
 * 如果哪天有人把调用改成位置参数，或者把新参数插到默认值参数前面，
 * 第 10 位就会把 `p_request_ip_hash` 的 TEXT 塞进 UUID 参数——线上直接
 * `function does not exist`，或者更糟：静默错位。这个文件让那种改动先在 CI 里红。
 *
 * 两次签名变更都必须留在合同里：`20260920` 已经在生产库执行过，它断言的
 * DROP/GRANT/REVOKE 形状不能被后续迁移改坏；`20260923` 是**当前**签名，
 * 调用方的键集合必须和它逐字一致。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(REPO_ROOT, 'supabase/migrations/20260920_guest_shop_buyer_credentials.sql');
// Promo L1/L2: the migration that owns the *current* 15-parameter signature.
const MIGRATION_L1L2 = path.join(REPO_ROOT, 'supabase/migrations/20260923_guest_shop_promo_l1l2.sql');
const CALLER = path.join(REPO_ROOT, 'server/api-handlers/public/guest-shop.js');
const SCAN_DIRS = ['api', 'server'];

const migrationSql = fs.readFileSync(MIGRATION, 'utf8');
const l1l2Sql = fs.readFileSync(MIGRATION_L1L2, 'utf8');
const callerSource = fs.readFileSync(CALLER, 'utf8');

// The 13-parameter signature, spelled the way both migrations must spell it.
const LEGACY_13_SIGNATURE = 'TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER';
const CURRENT_15_SIGNATURE = `${LEGACY_13_SIGNATURE}, INTEGER, TEXT`;

// ---------------------------------------------------------------------------
// 静态解析工具
// ---------------------------------------------------------------------------

/** 从 `text[open] === '('` 开始配平扫描，跳过单引号字符串。 */
function balancedSlice(text, open) {
    assert.equal(text[open], '(', 'balancedSlice must start at an open paren');
    let depth = 0;
    let inString = false;
    for (let i = open; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (ch === "'") inString = false;
            continue;
        }
        if (ch === "'") { inString = true; continue; }
        if (ch === '(') depth += 1;
        else if (ch === ')') {
            depth -= 1;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    throw new Error('unbalanced parens');
}

/** 顶层逗号切分（忽略括号内与字符串内的逗号）。 */
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let inString = false;
    let current = '';
    for (const ch of text) {
        if (inString) {
            current += ch;
            if (ch === "'") inString = false;
            continue;
        }
        if (ch === "'") { inString = true; current += ch; continue; }
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
        current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts.map((part) => part.trim());
}

/**
 * 去掉 SQL 行注释（`-- ...`），但保留单引号字符串里的内容。
 * 迁移的参数列表里允许写注释（L1/L2 迁移就给 p_quantity 写了两行说明），
 * 解析器必须先把它们剥掉，否则注释会被当成参数声明而解析失败。
 */
function stripSqlLineComments(text) {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            out += ch;
            if (ch === "'") inString = false;
            continue;
        }
        if (ch === "'") { inString = true; out += ch; continue; }
        if (ch === '-' && text[i + 1] === '-') {
            while (i < text.length && text[i] !== '\n') i += 1;
            out += '\n';
            continue;
        }
        out += ch;
    }
    return out;
}

/** 解析 CREATE OR REPLACE FUNCTION 的参数列表 → [{name, type, hasDefault, raw}] */
function signatureParams(fnName, sql = migrationSql) {
    const createAt = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}(`);
    assert.ok(createAt >= 0, `migration must keep CREATE OR REPLACE FUNCTION public.${fnName}`);
    const open = sql.indexOf('(', createAt);
    const body = stripSqlLineComments(balancedSlice(sql, open));
    return splitTopLevel(body).filter((part) => part !== '').map((raw) => {
        const matched = raw.match(/^(p_[a-z0-9_]+)\s+([A-Za-z0-9_ ]+?)(\s+DEFAULT\s+(.+))?$/isu);
        assert.ok(matched, `unparsable parameter declaration: ${raw}`);
        return {
            name: matched[1],
            type: matched[2].trim().toUpperCase(),
            hasDefault: Boolean(matched[3]),
            defaultValue: matched[4] ? matched[4].trim() : null,
            raw
        };
    });
}

/** 收集仓库里所有 `.rpc('fn_guest_shop_*'` 调用点的第二参数首字符。 */
function rpcCallSites() {
    const sites = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
            if (entry.name === 'node_modules') continue;
            const full = path.join(REPO_ROOT, dir, entry.name);
            if (entry.isDirectory()) { walk(path.join(dir, entry.name)); continue; }
            if (!entry.name.endsWith('.js')) continue;
            const source = fs.readFileSync(full, 'utf8');
            const re = /\.rpc\(\s*'(fn_guest_shop_[a-z0-9_]+)'\s*,\s*([\[{])/gu;
            let matched;
            while ((matched = re.exec(source)) !== null) {
                sites.push({ file: path.join(dir, entry.name), fn: matched[1], opener: matched[2] });
            }
        }
    };
    for (const dir of SCAN_DIRS) walk(dir);
    return sites;
}

// ---------------------------------------------------------------------------
// 1. 调用方必须用具名参数
// ---------------------------------------------------------------------------

test('every fn_guest_shop_* RPC call site uses named arguments, never positional', () => {
    const sites = rpcCallSites();
    const createSites = sites.filter((site) => site.fn === 'fn_guest_shop_create_order');
    assert.ok(createSites.length >= 1, 'the order-creation RPC must have at least one runtime caller');
    for (const site of sites) {
        assert.equal(
            site.opener,
            '{',
            `${site.file} calls ${site.fn} with positional arguments; a signature change would silently mis-bind them`
        );
    }
});

// ---------------------------------------------------------------------------
// 2. 调用方的键集合与签名逐字一致
// ---------------------------------------------------------------------------

function callerKeys() {
    const callAt = callerSource.indexOf(".rpc('fn_guest_shop_create_order', {");
    assert.ok(callAt >= 0, 'caller must keep the named-argument object form');
    const open = callerSource.indexOf('{', callAt);
    const body = balancedBraces(callerSource, open);
    return [...body.matchAll(/(?:^|[,{])\s*(p_[a-z0-9_]+)\s*:/gmu)].map((m) => m[1]);
}

test('the caller passes exactly the 15 declared parameters, with no typos', () => {
    const params = signatureParams('fn_guest_shop_create_order', l1l2Sql);
    assert.equal(params.length, 15, 'the L1/L2 signature must have 15 parameters');
    // The two new parameters are the last two, in this order: PG requires every
    // DEFAULT-carrying parameter to be contiguous through the end, otherwise a
    // named call that omits them cannot resolve.
    assert.equal(params[13].name, 'p_quantity');
    assert.equal(params[13].type, 'INTEGER');
    assert.equal(params[13].defaultValue, '1');
    assert.equal(params[14].name, 'p_discount_code');
    assert.equal(params[14].type, 'TEXT');
    assert.equal(params[14].defaultValue, 'NULL');

    const keys = callerKeys();
    assert.deepEqual(
        [...new Set(keys)].sort(),
        params.map((param) => param.name).sort(),
        'caller keys and declared parameters must be the same set'
    );
    assert.equal(keys.length, new Set(keys).size, 'no parameter may be passed twice');

    // The 20260920 contract still holds: the upgraded caller is a strict superset
    // of the 13 parameters that migration declared, so that already-applied
    // migration cannot silently invalidate this caller.
    const legacyNames = signatureParams('fn_guest_shop_create_order').map((param) => param.name);
    assert.equal(legacyNames.length, 13);
    for (const name of legacyNames) {
        assert.ok(keys.includes(name), `caller dropped ${name}, which the 20260920 signature still declares`);
    }
});

test('a deployed caller that omits p_quantity/p_discount_code still resolves to the 15-parameter function', () => {
    const params = signatureParams('fn_guest_shop_create_order', l1l2Sql);

    // main 分支（= 20260923 落库当时线上跑的代码）只传 13 个具名参数。
    const deployedArgs = params
        .map((param) => param.name)
        .filter((name) => name !== 'p_quantity' && name !== 'p_discount_code');
    assert.equal(deployedArgs.length, 13);

    const firstDefault = params.findIndex((param) => param.hasDefault);
    assert.ok(firstDefault >= 0, 'the new parameters must carry defaults');
    for (let i = firstDefault; i < params.length; i += 1) {
        assert.equal(
            params[i].hasDefault,
            true,
            `${params[i].name} follows a DEFAULT parameter without having one: an omitted-argument named call would not resolve`
        );
    }
    for (const param of params) {
        if (deployedArgs.includes(param.name)) continue;
        assert.equal(param.hasDefault, true, `${param.name} has no DEFAULT, so the deployed 13-argument call would break`);
        assert.ok(
            ['p_quantity', 'p_discount_code'].includes(param.name),
            `only p_quantity/p_discount_code may be absent from the deployed call, got ${param.name}`
        );
    }
});

test('omitting p_quantity/p_discount_code keeps the pre-L1/L2 behaviour instead of raising', () => {
    // 「不传 = 老行为」必须由函数体显式保证，而不是靠 DEFAULT 的字面值碰运气。
    assert.match(l1l2Sql, /v_quantity := COALESCE\(p_quantity, 1\);/u,
        'an omitted quantity must resolve to 1 unit, exactly as before L1');
    assert.match(l1l2Sql, /v_discount_code := NULLIF\(UPPER\(BTRIM\(COALESCE\(p_discount_code, ''\)\)\), ''\);/u,
        'an omitted discount code must resolve to NULL, never to an empty string');
    // 越界与畸形值必须 fail-closed，而不是被夹取或忽略。
    assert.match(l1l2Sql, /RAISE EXCEPTION 'guest_invalid_quantity';/u);
    assert.match(l1l2Sql, /RAISE EXCEPTION 'guest_quantity_not_allowed';/u);
    assert.match(l1l2Sql, /RAISE EXCEPTION 'guest_invalid_discount_code';/u);
    // 数量上限必须在锁行之后用商品/SKU 配置再夹一次，硬顶 5。
    assert.match(l1l2Sql, /v_guest_quantity_cap := LEAST\(\s*5,/u);
});

test('the legacy 13-parameter signature is dropped exactly by the L1/L2 migration', () => {
    // 两个重载并存会让 13 参具名调用 "could not choose the best candidate function"。
    assert.match(
        l1l2Sql,
        /DROP FUNCTION IF EXISTS public\.fn_guest_shop_create_order\(\s*TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\s*\);/u,
        'the old 13-parameter signature must be dropped by its exact parameter list'
    );
    assert.doesNotMatch(
        l1l2Sql,
        /DROP FUNCTION[^;]*fn_guest_shop_create_order[^;]*CASCADE/iu,
        'CASCADE could silently drop dependent objects'
    );
    const creates = l1l2Sql.match(/CREATE OR REPLACE FUNCTION public\.fn_guest_shop_create_order\(/gu) || [];
    assert.equal(creates.length, 1, 'exactly one create_order definition may exist in the L1/L2 migration');
    // service_role 执行权必须按 15 参签名重新授予（DROP 会带走旧授权），
    // 浏览器侧仍必须不可达。
    assert.ok(
        l1l2Sql.includes(`GRANT EXECUTE ON FUNCTION public.fn_guest_shop_create_order(${CURRENT_15_SIGNATURE}) TO service_role;`),
        'the 15-parameter signature must be granted to service_role'
    );
    assert.ok(
        l1l2Sql.includes(`REVOKE ALL ON FUNCTION public.fn_guest_shop_create_order(${CURRENT_15_SIGNATURE}) FROM PUBLIC, anon, authenticated;`),
        'the 15-parameter signature must stay unreachable from the browser'
    );
    // 授权语句不得再引用已 DROP 的 13 参签名（那会重新暴露一个不该存在的重载）。
    assert.doesNotMatch(
        l1l2Sql,
        /(?:GRANT EXECUTE|REVOKE ALL) ON FUNCTION public\.fn_guest_shop_create_order\(\s*TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\s*\)/u,
        'grants must not reference the dropped 13-parameter signature'
    );
});

function balancedBraces(text, open) {
    assert.equal(text[open], '{');
    let depth = 0;
    let inString = null;
    for (let i = open; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i += 1; continue; }
            if (ch === inString) inString = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    throw new Error('unbalanced braces');
}

// ---------------------------------------------------------------------------
// 3. 「迁移先落库、代码后发布」的时间差必须是安全的
// ---------------------------------------------------------------------------

test('a deployed caller that omits p_buyer_id still resolves to the 13-parameter function', () => {
    const params = signatureParams('fn_guest_shop_create_order');

    // main 分支（= 迁移落库当时线上跑的代码）只传 12 个具名参数，不含 p_buyer_id：
    // server/api-handlers/public/guest-shop.js 里的 rpc({...}) 调用。
    const deployedArgs = params
        .map((param) => param.name)
        .filter((name) => name !== 'p_buyer_id');
    assert.equal(deployedArgs.length, 12);

    // PG 规则：带默认值的参数必须连续排到末尾，否则省略中间的参数无法解析。
    const firstDefault = params.findIndex((param) => param.hasDefault);
    assert.ok(firstDefault >= 0, 'the new parameters must carry defaults');
    for (let i = firstDefault; i < params.length; i += 1) {
        assert.equal(
            params[i].hasDefault,
            true,
            `${params[i].name} follows a DEFAULT parameter without having one: an omitted-argument named call would not resolve`
        );
    }

    // 部署中的调用方省略的每一个参数都必须带 DEFAULT。
    for (const param of params) {
        if (deployedArgs.includes(param.name)) continue;
        assert.equal(param.hasDefault, true, `${param.name} has no DEFAULT, so the deployed 12-argument call would break`);
        assert.equal(param.name, 'p_buyer_id', 'only p_buyer_id may be absent from the deployed call');
        assert.equal(param.type, 'UUID');
        assert.equal(param.defaultValue, 'NULL', 'p_buyer_id must default to NULL so "not passed" means "not bound"');
    }
});

test('omitting p_buyer_id keeps the pre-2.0 behaviour instead of raising', () => {
    // 「不传 = 老行为」必须由函数体显式保证：只有 IS NOT NULL 才做绑定校验，
    // 否则把 v_buyer_id 置 NULL。少一个分支，旧调用方就会开始报错。
    assert.match(
        migrationSql,
        /IF\s+p_buyer_id\s+IS\s+NOT\s+NULL\s+THEN[\s\S]*?ELSE\s+v_buyer_id\s*:=\s*NULL;\s*END IF;/iu,
        'the RPC must treat a missing p_buyer_id as "no binding", not as an error'
    );
    // 传了 buyer_id 就必须校验 (site, contact_hash) 三元组，不匹配即 fail-closed。
    assert.match(migrationSql, /RAISE EXCEPTION 'guest_buyer_contact_required'/u);
    assert.match(migrationSql, /RAISE EXCEPTION 'guest_buyer_mismatch'/u);
    assert.match(migrationSql, /AND b\.contact_hash = p_buyer_contact_hash;/u);
});

// ---------------------------------------------------------------------------
// 4. 旧签名必须被精确 DROP，且不得留下第二个重载
// ---------------------------------------------------------------------------

test('the legacy 12-parameter signature is dropped exactly, without CASCADE', () => {
    assert.match(
        migrationSql,
        /DROP FUNCTION IF EXISTS public\.fn_guest_shop_create_order\(\s*TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER\s*\);/u,
        'the old signature must be dropped by its exact parameter list'
    );
    assert.doesNotMatch(
        migrationSql,
        /DROP FUNCTION[^;]*fn_guest_shop_create_order[^;]*CASCADE/iu,
        'CASCADE could silently drop dependent objects'
    );
    // 只有一个 CREATE：两个重载并存会让 12 参调用绑到旧实现，绕过 buyer_id 守卫。
    const creates = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.fn_guest_shop_create_order\(/gu) || [];
    assert.equal(creates.length, 1, 'exactly one create_order definition may exist in this migration');
    // service_role 的执行权必须按**新**签名重新授予（DROP 会带走旧授权）。
    assert.match(
        migrationSql,
        /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_create_order\(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\) TO service_role/u,
        'the new 13-parameter signature must be granted to service_role'
    );
    assert.match(
        migrationSql,
        /REVOKE ALL ON FUNCTION public\.fn_guest_shop_create_order\(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\) FROM PUBLIC, anon, authenticated/u,
        'the new signature must stay unreachable from the browser'
    );
});

// ---------------------------------------------------------------------------
// 5. 归档 verify 探针必须「认时代」（2026-09-23 假 FAIL 事故）
//
// 运维会反复重跑 verify 脚本。`20260920_verify_*` / `20260921_verify_*` 曾经把
// `fn_guest_shop_create_order` 按 **13 参精确签名**解析，L1/L2 迁移换成 15 参后，
// CTE 变空 → 第 8/9/10 行（以及 A1b 第 6 行）对**完全正确**的库报 FAIL。
// 假 FAIL 的代价是运维不再相信 verify 输出，甚至去「修」一个没坏的迁移。
// 下面这组断言保证：任何改动签名的迁移，都必须在同一个提交里把新签名登记进
// 归档 verify 的时代清单，否则 CI 先红。
// ---------------------------------------------------------------------------

const MIGRATION_DIR = path.join(REPO_ROOT, 'supabase/migrations');
const A0_VERIFY_FILE = '20260920_verify_guest_shop_buyer_credentials.sql';
const A1B_VERIFY_FILE = '20260921_verify_guest_shop_buyer_group_upsert.sql';

/** 所有曾经定义过 create_order 的迁移（按文件名时间顺序）→ 每个时代的签名。 */
function createOrderEras() {
    const files = fs
        .readdirSync(MIGRATION_DIR)
        .filter((name) => /^\d{8}_(?!verify)[a-z0-9_]+\.sql$/u.test(name))
        .sort();
    const eras = [];
    for (const name of files) {
        const sql = fs.readFileSync(path.join(MIGRATION_DIR, name), 'utf8');
        if (!sql.includes('CREATE OR REPLACE FUNCTION public.fn_guest_shop_create_order(')) continue;
        const params = signatureParams('fn_guest_shop_create_order', sql);
        eras.push({
            migration: name,
            params,
            arity: params.length,
            // to_regprocedure() 接受的是小写、逗号+空格分隔的规范拼写。
            signature: `public.fn_guest_shop_create_order(${params.map((param) => param.type.trim().toLowerCase()).join(', ')})`
        });
    }
    assert.ok(eras.length >= 3, `expected several create_order eras, got ${eras.length}`);
    return eras;
}

const ERAS = createOrderEras();
const CURRENT_ERA = ERAS[ERAS.length - 1];

/**
 * 读归档 verify 源码。
 * 签名/键名断言必须用**去注释**后的文本：时代说明注释里会逐字提到已经退休的
 * 键名（「renamed from `new_13_param_signature_present`」），带着注释断言
 * 「退休键不得复活」会永远为假。
 */
function verifySource(fileName) {
    return stripSqlLineComments(fs.readFileSync(path.join(MIGRATION_DIR, fileName), 'utf8'));
}

/** 归档 verify 里出现过的所有 create_order to_regprocedure 字面量。 */
function referencedSignatures(source) {
    return [...source.matchAll(/to_regprocedure\(\s*'(public\.fn_guest_shop_create_order\([^)]*\))'\s*\)/gu)].map((m) => m[1]);
}

test('the current create_order era is derived from the newest migration that defines it', () => {
    assert.equal(CURRENT_ERA.migration, '20260923_guest_shop_promo_l1l2.sql');
    assert.equal(CURRENT_ERA.arity, 15);
    assert.equal(CURRENT_ERA.signature, `public.fn_guest_shop_create_order(${CURRENT_15_SIGNATURE.toLowerCase()})`);
    // 历史时代必须全部被解析出来，否则「签名必须是真实历史时代」这条断言没有约束力。
    // 注意：同一个签名可以被多次 CREATE OR REPLACE（20260913 与 20260915 都是
    // 12 参，后者只换函数体），所以这里按「不同签名」而不是「不同迁移」去重。
    const inventory = ERAS.map((era) => `${era.migration.slice(0, 8)}:${era.arity}`).join(', ');
    assert.equal(ERAS.length, 4, `expected 4 create_order redefinitions, got ${inventory}`);
    assert.deepEqual([...new Set(ERAS.map((era) => era.signature))].length, 3, `unexpected signature inventory: ${inventory}`);
    assert.ok(ERAS.some((era) => era.arity === 13), 'the A0 13-parameter era must be in the inventory');
    assert.ok(ERAS.some((era) => era.arity === 12), 'the legacy 12-parameter era must be in the inventory');
});

test('every archived verify probe recognises the CURRENT create_order signature', () => {
    for (const fileName of [A0_VERIFY_FILE, A1B_VERIFY_FILE]) {
        const source = verifySource(fileName);
        assert.ok(
            source.includes(`to_regprocedure('${CURRENT_ERA.signature}')`),
            `${fileName} does not list the signature installed by ${CURRENT_ERA.migration}:\n` +
                `  ${CURRENT_ERA.signature}\n` +
                '  -> re-running this verify script would report a FALSE FAIL against a correct database.\n' +
                '  Add the new era to that script in the same commit that changes the signature.'
        );
    }
});

test('no archived verify invents a create_order signature that no migration ever installed', () => {
    // 拼错的签名会让 known_signature_present 永远为假（假 FAIL），或者更糟：
    // 让一个未经评审的形状被当成「已知时代」放行。
    const known = new Set(ERAS.map((era) => era.signature));
    for (const fileName of [A0_VERIFY_FILE, A1B_VERIFY_FILE]) {
        const referenced = referencedSignatures(verifySource(fileName));
        assert.ok(referenced.length >= 2, `${fileName} must keep referencing create_order signatures, got ${referenced.length}`);
        for (const signature of referenced) {
            assert.ok(
                known.has(signature),
                `${fileName} references a create_order signature no migration ever installed:\n  ${signature}`
            );
        }
    }
});

test('archived verifies resolve create_order BY NAME, never by an exact signature', () => {
    // CTE 用精确签名解析 = 签名一变整个 CTE 变空 = 所有依赖它的行同时假 FAIL。
    for (const fileName of [A0_VERIFY_FILE, A1B_VERIFY_FILE]) {
        const source = verifySource(fileName);
        assert.doesNotMatch(
            source,
            /WHERE\s+p\.oid\s*=\s*to_regprocedure\(\s*'public\.fn_guest_shop_create_order/u,
            `${fileName} must resolve create_order by proname so a later signature change cannot empty its CTE`
        );
    }
    const a0 = verifySource(A0_VERIFY_FILE);
    assert.match(a0, /AND p\.proname = 'fn_guest_shop_create_order'/u, 'the fn/fn_grants CTEs must resolve by name');
    assert.match(a0, /\), fn_era AS \(/u, 'the era list must live in a single, commented fn_era CTE');
});

test('the retired era-pinned probe keys stay retired', () => {
    const retired = [
        [A0_VERIFY_FILE, 'new_13_param_signature_present', 'known_signature_present'],
        [A0_VERIFY_FILE, 'quantity_still_hardcoded_to_one', 'quantity_policy_matches_era'],
        [A1B_VERIFY_FILE, 'create_order_rpc_still_13_params', 'create_order_rpc_known_signature']
    ];
    for (const [fileName, oldKey, newKey] of retired) {
        const source = verifySource(fileName);
        assert.ok(!source.includes(oldKey), `${fileName} reintroduced the era-pinned key ${oldKey}`);
        assert.ok(source.includes(newKey), `${fileName} lost the era-aware key ${newKey}`);
    }
    // A0 时代无关的保证必须原样保留：单一重载、旧 12 参签名消失、service-role-only 授权。
    const a0 = verifySource(A0_VERIFY_FILE);
    for (const kept of ['legacy_12_param_signature_absent', 'single_overload', 'create_order_signature_migrated',
        'create_order_buyer_binding_guards', 'create_order_grants', 'search_path_pinned']) {
        assert.ok(a0.includes(kept), `A0 verify lost the era-independent assertion ${kept}`);
    }
});

test('the A0 verify arity expectation covers every era it tolerates, including the current one', () => {
    const a0 = verifySource(A0_VERIFY_FILE);
    const matched = /'arity', \(SELECT (CASE[\s\S]*?END) FROM fn_era\)/u.exec(a0);
    assert.ok(matched, 'row 8 must derive the expected arity from fn_era instead of a bare constant');
    const numbers = [...new Set([...matched[1].matchAll(/\b(\d+)\b/gu)].map((m) => Number(m[1])))].sort((x, y) => x - y);
    const historicalArities = new Set(ERAS.map((era) => era.arity));
    for (const value of numbers) {
        assert.ok(historicalArities.has(value), `arity CASE mentions ${value}, which no create_order era ever had`);
    }
    assert.ok(numbers.includes(CURRENT_ERA.arity), `arity CASE must cover the current ${CURRENT_ERA.arity}-parameter era`);
    assert.doesNotMatch(a0, /'arity', 13,/u, 'a constant arity expectation is exactly the false-FAIL bug');
});

test('the era-aware quantity probe keeps the L1/L2 fail-closed guard as its condition', () => {
    // 放宽「固定 1 件」不等于放宽安全：新时代必须同时证明服务端数量闸门还在。
    const a0 = verifySource(A0_VERIFY_FILE);
    assert.match(a0, /THEN def ~ 'p_quantity' AND def ~ 'guest_quantity_not_allowed'/u);
    assert.match(a0, /ELSE def !~ 'p_quantity'/u);
    assert.match(l1l2Sql, /RAISE EXCEPTION 'guest_quantity_not_allowed';/u);
});
