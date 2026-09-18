'use strict';

/**
 * Guest Shop Order Access 2.0 (A3) — SQL 合同测试。
 *
 * Codex 不执行 SQL（AGENTS.md 硬禁令）。这个文件的作用是：把
 * `20260922_guest_shop_access_resets.sql` 里**安全关键**的语句钉成合同，
 * 这样任何人（包括未来的 agent）改动迁移文件时，测试会先失败，而不是等到
 * 线上出现「anon 能通过 PostgREST 读到找回链接行」这种事故。
 *
 * 覆盖的四类不变量：
 *   1. 严格增量：不删表、不删列、不改写既有数据
 *   2. token_hash 只能装 sha256 hex，装不下明文 token
 *   3. RLS + REVOKE 双保险，且没有任何浏览器可达的 policy
 *   4. 应用层常量（TTL / reason 长度 / outcome 取值）与 DB 约束一致
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase/migrations/20260922_guest_shop_access_resets.sql');
const VERIFY_PATH = path.join(REPO_ROOT, 'supabase/migrations/20260922_verify_guest_shop_access_resets.sql');
const CREDENTIAL_MIGRATION_PATH = path.join(
    REPO_ROOT,
    'supabase/migrations/20260920_guest_shop_buyer_credentials.sql'
);

const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
const verifySql = fs.readFileSync(VERIFY_PATH, 'utf8');
const credentialSql = fs.readFileSync(CREDENTIAL_MIGRATION_PATH, 'utf8');

const buyerAccessAdmin = require('../api/_lib/guest-shop/buyer-access-admin');

/** 去掉 SQL 注释后再做「禁止出现」断言，避免注释里的解释文字误伤。 */
function stripSqlComments(source) {
    return String(source)
        .split('\n')
        .map((line) => {
            const index = line.indexOf('--');
            return index === -1 ? line : line.slice(0, index);
        })
        .join('\n');
}

const code = stripSqlComments(sql);

function constraintOf(name) {
    const pattern = new RegExp(`CONSTRAINT ${name}\\s+CHECK \\(([\\s\\S]*?)\\)(,|\\s*\\n\\s*\\))`, 'u');
    const matched = code.match(pattern);
    return matched ? matched[1].replace(/\s+/g, ' ').trim() : '';
}

test('the A3 migration is strictly additive and touches no existing row', () => {
    assert.match(code, /CREATE TABLE IF NOT EXISTS public\.guest_shop_access_resets/u);
    // 只允许 DROP 那一个被放宽的 CHECK 约束
    const drops = code.match(/DROP\s+(?:TABLE|COLUMN|INDEX|VIEW|FUNCTION|TRIGGER)[\s\S]{0,60}/gi) || [];
    assert.deepEqual(drops, [], 'A3 migration must not drop any object');
    const droppedConstraints = code.match(/DROP CONSTRAINT[^\n;]*/gi) || [];
    assert.deepEqual(droppedConstraints, [
        'DROP CONSTRAINT IF EXISTS guest_shop_access_attempts_outcome_check'
    ]);
    assert.doesNotMatch(code, /\bTRUNCATE\b/iu);
    assert.doesNotMatch(code, /\bDELETE\s+FROM\b/iu);
    assert.doesNotMatch(code, /\bUPDATE\s+public\./iu);
    assert.doesNotMatch(code, /\bINSERT\s+INTO\b/iu);
    // 不得顺手打开任何开关或建定时任务
    assert.doesNotMatch(code, /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EVENT\s+)?TRIGGER/iu);
    assert.doesNotMatch(code, /\bcron\b/iu);
    assert.doesNotMatch(sql, /CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY|GUEST_SHOP_[A-Z_]*PEPPER/u);
});

test('token_hash can only ever hold a sha256 hex, never the plaintext token', () => {
    const check = constraintOf('guest_shop_access_resets_token_check');
    const captured = check.match(/token_hash ~ '(.+?)'/u);
    assert.ok(captured, 'token_hash format CHECK must exist');
    const pattern = new RegExp(captured[1], 'u');

    // 真实产物必须通过：issueResetToken 的 hash 就是 sha256 hex
    const { token, tokenHash } = buyerAccessAdmin.issueResetToken();
    assert.ok(pattern.test(tokenHash), 'sha256 hex must satisfy the DB CHECK');
    assert.equal(tokenHash.length, 64);
    assert.match(tokenHash, /^[0-9a-f]{64}$/u);

    // 明文 token 必须被拒：这是「不小心把 token 存进库」的最后一道闸
    assert.ok(buyerAccessAdmin.RESET_TOKEN_PATTERN.test(token));
    assert.equal(token.length, 43);
    assert.ok(!pattern.test(token), 'plaintext reset token must NOT satisfy token_hash CHECK');
    assert.ok(!pattern.test(tokenHash.toUpperCase()), 'uppercase hex must be rejected too');
    assert.ok(!pattern.test(`${tokenHash}0`), 'over-long hex must be rejected');

    // contact_hash 用同一条格式约束
    const contactCheck = constraintOf('guest_shop_access_resets_hash_check');
    assert.match(contactCheck, /contact_hash ~ '\^\[0-9a-f\]\{64\}\$'/u);
    // 全文不得出现任何明文 token 样例
    assert.doesNotMatch(sql, /\b[A-Za-z0-9_-]{43}\b/u);
});

test('reset-link lifetime, single use and admin reason are enforced in the database', () => {
    const ttl = constraintOf('guest_shop_access_resets_ttl_check');
    assert.equal(ttl, "expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours'");
    // 应用层 15 分钟必须落在 DB 上界之内
    assert.equal(buyerAccessAdmin.RESET_LINK_TTL_SECONDS, 15 * 60);
    assert.ok(buyerAccessAdmin.RESET_LINK_TTL_SECONDS <= 24 * 60 * 60);

    const reason = constraintOf('guest_shop_access_resets_reason_check');
    const bounds = reason.match(/char_length\(reason\) BETWEEN (\d+) AND (\d+)/u);
    assert.ok(bounds, 'reason length CHECK must exist');
    assert.equal(Number(bounds[1]), buyerAccessAdmin.MIN_ADMIN_REASON_LENGTH);
    assert.equal(Number(bounds[2]), buyerAccessAdmin.MAX_ADMIN_REASON_LENGTH);

    // used / revoked 互斥，且消费必须发生在有效期内
    assert.equal(
        constraintOf('guest_shop_access_resets_state_check'),
        'NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL)'
    );
    assert.equal(
        constraintOf('guest_shop_access_resets_used_live'),
        'used_at IS NULL OR used_at <= expires_at'
    );
    assert.equal(
        constraintOf('guest_shop_access_resets_used_order'),
        'used_at IS NULL OR used_at >= created_at'
    );
    assert.equal(
        constraintOf('guest_shop_access_resets_revoked_order'),
        'revoked_at IS NULL OR revoked_at >= created_at'
    );
    // purpose 白名单只有一项，扩展必须显式改这里
    assert.equal(
        constraintOf('guest_shop_access_resets_purpose_check'),
        "purpose IN ('password_reset')"
    );
});

test('one pending link per credential group is a hard database guard, not an app convention', () => {
    assert.match(code, /CONSTRAINT guest_shop_access_resets_token_uniq\s+UNIQUE \(token_hash\)/u);
    assert.match(
        code,
        /CREATE UNIQUE INDEX IF NOT EXISTS guest_shop_access_resets_one_pending_per_buyer\s+ON public\.guest_shop_access_resets \(buyer_id\)\s+WHERE used_at IS NULL AND revoked_at IS NULL;/u
    );
    // 两个查询索引都必须是部分索引/覆盖索引，不能退化成全表扫
    assert.match(
        code,
        /CREATE INDEX IF NOT EXISTS guest_shop_access_resets_token_idx\s+ON public\.guest_shop_access_resets \(token_hash\)\s+WHERE used_at IS NULL AND revoked_at IS NULL;/u
    );
    assert.match(
        code,
        /CREATE INDEX IF NOT EXISTS guest_shop_access_resets_buyer_idx\s+ON public\.guest_shop_access_resets \(buyer_id, created_at DESC\);/u
    );
    // 一条链接只属于一个分组：buyer_id 是外键且级联删除
    assert.match(code, /buyer_id\s+UUID\s+NOT NULL\s+REFERENCES public\.guest_shop_buyers\(id\) ON DELETE CASCADE/u);
    // 归因列刻意不是外键，删号不能抹掉证据
    assert.match(code, /created_by_admin_id UUID\s+NOT NULL/u);
    assert.doesNotMatch(code, /created_by_admin_id[\s\S]{0,80}REFERENCES/u);
});

test('RLS and REVOKE are both present and no browser role can reach the table', () => {
    assert.match(code, /ALTER TABLE public\.guest_shop_access_resets ENABLE ROW LEVEL SECURITY;/u);
    assert.match(
        code,
        /REVOKE ALL ON TABLE public\.guest_shop_access_resets FROM PUBLIC, anon, authenticated;/u
    );
    assert.match(code, /GRANT ALL ON TABLE public\.guest_shop_access_resets TO service_role;/u);
    // 没有任何浏览器可达的 policy（读写都走 service_role，绕过 RLS）
    assert.doesNotMatch(code, /CREATE POLICY/iu);
    assert.doesNotMatch(code, /GRANT[\s\S]{0,80}TO\s+(?:PUBLIC|anon|authenticated)/iu);
    assert.doesNotMatch(code, /security_definer/iu);
    // 迁移不得创建任何 view（若将来要建，必须 security_invoker=on）
    assert.doesNotMatch(code, /CREATE(?:\s+OR\s+REPLACE)?\s+VIEW/iu);
});

test('the widened outcome CHECK is a strict superset of the A1 list', () => {
    function outcomesOf(source) {
        const matched = source.match(
            /guest_shop_access_attempts_outcome_check CHECK \(outcome IN\s*\(([\s\S]*?)\)\)/u
        );
        assert.ok(matched, 'outcome CHECK must exist');
        return matched[1].match(/'[a-z_]+'/g).map((item) => item.replace(/'/g, ''));
    }
    const previous = outcomesOf(credentialSql);
    const next = outcomesOf(sql);
    assert.deepEqual(previous, [
        'success', 'bad_password', 'unknown_email', 'locked', 'captcha_required',
        'rate_limited', 'credential_conflict'
    ]);
    for (const outcome of previous) {
        assert.ok(next.includes(outcome), `existing outcome must survive: ${outcome}`);
    }
    assert.deepEqual(
        next.filter((outcome) => !previous.includes(outcome)).sort(),
        ['reset_invalid', 'reset_success', 'upgrade_invalid', 'upgrade_success']
    );
});

test('the verify script covers the A3 objects and stays read-only', () => {
    assert.match(verifySql, /guest_shop_access_resets/u);
    assert.match(verifySql, /guest_shop_access_resets_one_pending_per_buyer/u);
    assert.match(verifySql, /guest_shop_access_attempts_outcome_check/u);
    const verifyCode = stripSqlComments(verifySql);
    assert.doesNotMatch(verifyCode, /\bINSERT\s+INTO\b/iu);
    assert.doesNotMatch(verifyCode, /\bUPDATE\s+public\./iu);
    assert.doesNotMatch(verifyCode, /\bDELETE\s+FROM\b/iu);
    assert.doesNotMatch(verifyCode, /\bDROP\s+(?:TABLE|INDEX|CONSTRAINT)\b/iu);
    assert.doesNotMatch(verifyCode, /\bGRANT\b|\bREVOKE\b/iu);
});

test('the migration is documented as user-executed and never auto-applied by the repo', () => {
    assert.match(sql, /Codex does not execute this file/u);
    assert.match(sql, /20260922_verify_guest_shop_access_resets\.sql/u);
    // 部署脚本 / worker 不得引用这两个 SQL 文件
    const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const scripts = JSON.stringify(packageJson.scripts || {});
    assert.doesNotMatch(scripts, /guest_shop_access_resets/u);
    const workflows = path.join(REPO_ROOT, '.github/workflows');
    if (fs.existsSync(workflows)) {
        for (const entry of fs.readdirSync(workflows)) {
            const body = fs.readFileSync(path.join(workflows, entry), 'utf8');
            assert.doesNotMatch(body, /guest_shop_access_resets/u, `${entry} must not run the A3 migration`);
        }
    }
});
