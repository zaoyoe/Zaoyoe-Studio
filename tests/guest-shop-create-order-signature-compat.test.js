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
 * 如果哪天有人把调用改成位置参数，或者把新参数插到默认值参数前面，
 * 第 10 位就会把 `p_request_ip_hash` 的 TEXT 塞进 UUID 参数——线上直接
 * `function does not exist`，或者更糟：静默错位。这个文件让那种改动先在 CI 里红。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(REPO_ROOT, 'supabase/migrations/20260920_guest_shop_buyer_credentials.sql');
const CALLER = path.join(REPO_ROOT, 'server/api-handlers/public/guest-shop.js');
const SCAN_DIRS = ['api', 'server'];

const migrationSql = fs.readFileSync(MIGRATION, 'utf8');
const callerSource = fs.readFileSync(CALLER, 'utf8');

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

/** 解析 CREATE OR REPLACE FUNCTION 的参数列表 → [{name, type, hasDefault, raw}] */
function signatureParams(fnName) {
    const createAt = migrationSql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}(`);
    assert.ok(createAt >= 0, `migration must keep CREATE OR REPLACE FUNCTION public.${fnName}`);
    const open = migrationSql.indexOf('(', createAt);
    const body = balancedSlice(migrationSql, open);
    return splitTopLevel(body).map((raw) => {
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

test('the caller passes exactly the 13 declared parameters, with no typos', () => {
    const params = signatureParams('fn_guest_shop_create_order');
    assert.equal(params.length, 13, 'the migrated signature must have 13 parameters');

    const callAt = callerSource.indexOf(".rpc('fn_guest_shop_create_order', {");
    assert.ok(callAt >= 0, 'caller must keep the named-argument object form');
    const open = callerSource.indexOf('{', callAt);
    const body = balancedBraces(callerSource, open);
    const keys = [...body.matchAll(/(?:^|[,{])\s*(p_[a-z0-9_]+)\s*:/gmu)].map((m) => m[1]);

    assert.deepEqual(
        [...new Set(keys)].sort(),
        params.map((param) => param.name).sort(),
        'caller keys and declared parameters must be the same set'
    );
    assert.equal(keys.length, new Set(keys).size, 'no parameter may be passed twice');
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
