'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const planPath = path.join(repoRoot, 'docs', 'guest-purchase-task-2.0.md');
const taskboardPath = path.join(repoRoot, 'docs', 'guest-purchase-execution-taskboard.md');
const archivePath = path.join(repoRoot, 'docs', 'guest-shop-stage5-rollback-archive.md');
const archiveScriptPath = path.join(repoRoot, 'scripts', 'guest-shop-stage5-archive.js');
const archiveTestPath = path.join(repoRoot, 'tests', 'guest-shop-stage5-archive.test.js');
const stageFiveManualPath = path.join(repoRoot, 'docs', 'guest-shop-stage5-remaining-operations-manual.md');
const stageFiveChecklistPath = path.join(repoRoot, 'docs', 'guest-shop-stage5-external-acceptance-checklist.md');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function stageFiveSection(plan) {
    const start = plan.indexOf('### 61.21 2026-09-21 阶段 5 有限范围与责任矩阵');
    assert.notEqual(start, -1, 'Task 2.1 must keep the bounded Stage 5 decision section');
    const nextHeading = plan.indexOf('\n### ', start + 1);
    return plan.slice(start, nextHeading === -1 ? plan.length : nextHeading);
}

function tableRows(section) {
    return section
        .split(/\r?\n/u)
        .filter((line) => /^\| .+ \|$/u.test(line) && !/^\| ---/u.test(line));
}

test('Task 2.1 Stage 5 closeout stays bounded and auditable', () => {
    const plan = read('docs/guest-purchase-task-2.0.md');
    const taskboard = read('docs/guest-purchase-execution-taskboard.md');
    const section = stageFiveSection(plan);
    const rows = tableRows(section);

    assert.match(plan, /当前总进度为 80%（4\/5 阶段完成）/u);
    assert.match(plan, /\| 5 \| 后续扩展与收口 \| 20% \| \*\*in_progress\*\*/u);
    assert.match(taskboard, /阶段 5 已进入 `in_progress`，但总进度仍为 80%/u);
    assert.match(section, /\| 工作包 \| 当前决定 \| 责任角色 \| 只有满足以下条件才重启 \| 最小证据产物 \|/u);

    const expectedPackages = [
        'INTL / NOWPayments',
        'CAPTCHA / 邮箱所有权',
        '优惠码 / 阶梯价 / 闪购 TTL',
        '`quantity > 1` / 购物车 / quote / 登录用户现金购买',
        '多设备 / 多标签 / 无障碍完整矩阵',
        'Admin Studio 运营能力',
        '指定 SKU 回滚演练'
    ];
    const packageRows = rows.filter((line) => expectedPackages.some((name) => line.includes(name)));
    assert.equal(packageRows.length, expectedPackages.length, 'all bounded Stage 5 packages must remain listed');

    for (const row of packageRows) {
        const cells = row.slice(1, -1).split('|').map((cell) => cell.trim());
        assert.equal(cells.length, 5, `Stage 5 row must keep five contract columns: ${row}`);
        assert.ok(cells.every(Boolean), `Stage 5 row must not contain an empty contract cell: ${row}`);
        const isRollbackRow = row.includes('指定 SKU 回滚演练');
        if (isRollbackRow) {
            assert.equal(cells[1], '`complete`', 'the operator-confirmed rollback exercise must be closed out');
        } else {
            assert.match(cells[1], /^(?:`deferred`|`deferred \/ manual_review`|`pending_operator_window`)$/u);
        }
        assert.doesNotMatch(cells[2], /待定|未分配|TBD/iu);
        assert.doesNotMatch(cells[3], /待定|未定义|TBD/iu);
        assert.doesNotMatch(cells[4], /待定|未定义|TBD/iu);
    }

    assert.match(section, /明确停用窗口/u);
    assert.match(section, /关闭后 preview 返回 `guest_product_unavailable`/u);
    assert.match(section, /本阶段不执行：不新增 SQL/u);
    assert.match(section, /不重复创建或支付历史订单/u);
    assert.match(section, /阶段 5 才可从 `in_progress` 更新为 `complete`/u);

    const archive = fs.readFileSync(archivePath, 'utf8');
    assert.match(archive, /guest-shop-stage5-rollback-2026-09-21-test-sku/u);
    assert.match(archive, /guest_product_unavailable/u);
    assert.match(archive, /本归档不自动取消、不代用户支付/u);
    assert.doesNotMatch(archive, /GS\d{10,}/u);
    assert.ok(fs.existsSync(archiveScriptPath), 'Stage 5 archive contract implementation must exist');
    assert.ok(fs.existsSync(archiveTestPath), 'Stage 5 archive regression test must exist');
    assert.match(plan, /阶段 5 指定 SKU 运营归档完成/u);
});

test('Stage 5 acceptance docs follow the current checkout flow and applicability rules', () => {
    const manual = fs.readFileSync(stageFiveManualPath, 'utf8');
    const checklist = fs.readFileSync(stageFiveChecklistPath, 'utf8');

    for (const source of [manual, checklist]) {
        assert.match(source, /适用性分流/u, 'Stage 5 docs must decide applicability before asking for a sample');
        assert.match(source, /没有单独的「预览」按钮/u, 'Stage 5 docs must describe automatic quote refresh');
        assert.match(source, /(?:点击|选择).*付款方式.*创建(?:订单|provider order)/u, 'Stage 5 docs must describe payment-method order creation');
        assert.match(source, /C3[\s\S]{0,240}N\/A/u, 'reader support must stay outside the current Stage 5 gate');
        assert.match(source, /没有批准.*provider[\s\S]{0,120}N\/A/u, 'provider-dependent checks must have an explicit N/A path');
        assert.match(source, /重新适用的触发条件|重新打开对应项目/u, 'N/A must not become an unowned permanent TODO');
        assert.doesNotMatch(source, /^\s*\d+\.\s+.*(?:点击「创建支付订单」|执行 preview)/mu, 'acceptance steps must not require removed controls');
        assert.match(source, /字段标记.*查询密码|查询密码.*字段标记/u, 'credential steps must follow the current product configuration');
    }

    assert.match(manual, /「D1-多件原子预占-测试 \/ D1-成功路径」/u);
    assert.match(manual, /点击「取消订单」/u);
    assert.match(checklist, /quantity=2[\s\S]{0,180}记 `N\/A`/u);
});
