const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
const script = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');

function guestExceptionViewHtml() {
    const start = html.indexOf('id="shop-view-guest-exceptions"');
    assert.notEqual(start, -1);
    const end = html.indexOf('id="shop-view-fulfillment"', start);
    assert.notEqual(end, -1);
    return html.slice(start, end);
}

function guestOpsModalSource() {
    const start = script.indexOf('openGuestExceptionOpsModal');
    const end = script.indexOf('submitGuestExceptionWrite');
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return script.slice(start, end);
}

test('shop admin exposes a guest exception tab with an operations column', () => {
    const view = guestExceptionViewHtml();
    assert.match(html, /data-shop-tab="guest-exceptions"/);
    assert.match(view, /id="guestExceptionsTableBody"/);
    assert.match(view, /id="guestExceptionFilter"/);
    assert.match(view, /<th>操作<\/th>/);
    assert.doesNotMatch(view, /<th>定位<\/th>/);
    assert.match(script, /SHOP_TAB_IDS:\s*\[[\s\S]*?['"]guest-exceptions['"]/);
    assert.match(script, /buildAdminShopUrl\('shop\/guest-orders'/);
});

test('guest exception UI keeps secrets out of rendering and uses the existing confirm modal', () => {
    const modal = guestOpsModalSource();
    assert.doesNotMatch(script, /row\.(?:claim_secret_hash|content|raw_payload)/);
    assert.match(script, /loadGuestOrdersViaAdminApi[\s\S]*?credentials:\s*'include'/);
    assert.match(script, /scanTruncated/);
    assert.match(script, /guest-exception-copy-order/);
    assert.match(script, /guest-exception-write/);
    assert.match(script, /request_refund/);
    assert.match(script, /manual_fulfill/);
    assert.match(script, /unlock_dead_letter/);
    assert.match(script, /confirm:\s*true/);
    assert.match(modal, /shop-refund-modal/);
    assert.match(modal, /refund-btn-cancel/);
    assert.match(modal, /refund-btn-confirm/);
    assert.match(modal, /guestExceptionOpsReason/);
    assert.match(modal, /至少 8 个字/);
    assert.doesNotMatch(modal, /shop-refund-status-grid/);
    assert.doesNotMatch(modal, /Guest checkout|eyebrow/i);
    assert.doesNotMatch(script, /shop-guest-exception-readonly/);
});

/* ------------------------------------------------------------------ *
 * Guest Shop Order Access 2.0 (A3) — 管理台「买家访问」
 * docs/guest-shop-order-access-2.0.md §10.5 / §13.2 / §18
 * 后端：server/api-handlers/admin/shop/guest-buyer-access.js
 * ------------------------------------------------------------------ */

const css = fs.readFileSync(path.resolve(__dirname, '../css/admin-studio-page.css'), 'utf8');

function guestBuyerAccessSource() {
    const start = script.indexOf('GUEST_BUYER_ACCESS_ACTIONS: Object.freeze');
    const end = script.indexOf('getGuestExceptionMeta: function (key)');
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.ok(start < end, 'buyer access helpers must live after submitGuestExceptionWrite');
    return script.slice(start, end);
}

test('guest exception rows expose a buyer access entry wired to the A3 admin route', () => {
    const access = guestBuyerAccessSource();
    // 行内入口
    assert.match(script, /renderGuestBuyerAccessButton: function/);
    assert.match(script, /\$\{this\.renderGuestBuyerAccessButton\(row\)\}/);
    assert.match(script, /data-shop-action="guest-buyer-access-open"/);
    // 事件分发
    for (const action of [
        'guest-buyer-access-open',
        'guest-buyer-access-close',
        'guest-buyer-access-refresh',
        'guest-buyer-access-action',
        'guest-buyer-access-copy-link'
    ]) {
        assert.match(script, new RegExp(`case '${action}':`), `missing dispatch for ${action}`);
    }
    // 路由：读写都走 shop/guest-buyer-access，且 GET 只带 orderNo
    assert.match(access, /buildAdminShopUrl\('shop\/guest-buyer-access', \{ orderNo: normalizedOrderNo \}\)/);
    assert.match(access, /buildAdminShopUrl\('shop\/guest-buyer-access'\)/);
    assert.match(access, /credentials: 'include'/);
    // 动作白名单必须与后端 ACTIONS 完全一致，不得静默扩张
    const frozen = access.match(/GUEST_BUYER_ACCESS_ACTIONS:\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    assert.ok(frozen, 'action allow-list must be frozen');
    const actions = frozen[1].match(/'[a-z_]+'/g).map((item) => item.replace(/'/g, ''));
    assert.deepEqual(actions, [
        'unlock_buyer_login',
        'issue_password_reset_link',
        'revoke_password_reset_link'
    ]);
    assert.match(access, /confirm: true/);
    // 缓存戳：JS 与 CSS 都要换
    assert.equal(html.split('guestBuyerAccess=20260922_ADMIN_GUEST_BUYER_ACCESS_1').length - 1, 2);
});

test('the buyer access modal never persists, logs or links the one-time reset token', () => {
    const access = guestBuyerAccessSource();
    // 一次性展示
    assert.match(access, /本次仅显示一次/);
    assert.match(access, /id="guestBuyerAccessResetLink"/);
    assert.match(access, /id="guestBuyerAccessResetLink"[\s\S]{0,200}readonly/);
    assert.match(access, /copyTextToClipboard\(link\)/);
    // 关窗即清 token（内存 + DOM）
    assert.match(access, /closeGuestBuyerAccessModal: function \(\) \{\s*\n\s*\/\/[^\n]*\n\s*this\.guestBuyerAccessResetToken = '';/);
    assert.match(access, /if \(linkInput\) linkInput\.value = '';/);
    // 不落盘、不进日志（断言"调用"而非"提及"，注释里写禁令是允许的）
    assert.doesNotMatch(access, /localStorage\s*\./);
    assert.doesNotMatch(access, /sessionStorage\s*\./);
    assert.doesNotMatch(access, /indexedDB\s*\./);
    assert.doesNotMatch(access, /document\.cookie\s*=/);
    assert.doesNotMatch(access, /console\.(?:log|info|warn|debug|error)\([^)]*(?:token|reset_path|absoluteUrl|link)/i);
    // 不生成会把 token 写进地址栏/历史的锚点
    assert.doesNotMatch(access, /<a[^>]*guestBuyerAccessResetLink/);
    assert.doesNotMatch(access, /window\.open\(/);
    assert.doesNotMatch(access, /location\.(?:href|assign|replace)\s*=/);
    // 复制失败时也不回显链接
    assert.match(access, /请手动选中输入框内容复制/);
    // 服务端投影之外的秘密字段一律不出现在管理台代码里
    assert.doesNotMatch(access, /contact_hash|password_hash|token_hash|claim_secret|query_password/);
});

test('buyer access is selected by order number only, never by a typed email', () => {
    const access = guestBuyerAccessSource();
    assert.match(access, /data-order-no=/);
    // 写请求体被钉死成这四个字段，邮箱没有位置可以塞进来（§6.4）
    assert.match(access, /JSON\.stringify\(\{ action, orderNo, confirm: true, reason \}\)/);
    assert.doesNotMatch(access, /type="email"/);
    assert.doesNotMatch(access, /id="[^"]*[Ee]mail/);
    assert.doesNotMatch(access, /\bemail\w*\s*:/);
    assert.doesNotMatch(access, /orderNo:\s*(?:email|contact)/i);
    // §13.2：未绑定订单给出自助升级话术，管理台不代设密码
    assert.match(access, /尚未绑定查询密码/);
    assert.doesNotMatch(access, /action:\s*'(?:reset_password|set_password|reset_guest_password)'/);
    assert.doesNotMatch(access, /temp(?:orary)?_password/i);
});

test('buyer access writes are double-gated by a reason and an explicit identity confirmation', () => {
    const access = guestBuyerAccessSource();
    // 三个写按钮初始 disabled
    assert.match(access, /data-shop-action="guest-buyer-access-action"[\s\S]{0,420}disabled>/);
    // 门禁 = 原因 ≥8 字 且 勾选核实
    assert.match(access, /id="guestBuyerAccessConfirm"/);
    assert.match(access, /const ready = reason\.length >= 8 && confirmed;/);
    assert.match(access, /button\.disabled = !ready;/);
    assert.match(access, /至少 8 个字/);
    // 提交前再校验一次（不依赖 UI 状态）
    assert.match(access, /submitGuestBuyerAccessAction[\s\S]*?if \(reason\.length < 8 \|\| !document\.getElementById\('guestBuyerAccessConfirm'\)\?\.checked\)/);
    // 一次操作后必须重新勾选，防连点
    assert.match(access, /if \(confirmBox\) confirmBox\.checked = false;/);
    // 生成链接会让整个分组会话失效，必须显式告知
    assert.match(access, /password_version \+1/);
    assert.match(access, /所有已登录会话立即失效/);
    // 审计写失败要冒泡给运营，而不是吞掉
    assert.match(access, /audit_recorded === false/);
    assert.match(access, /审计写入失败，请人工补记/);
});

test('the buyer access modal reuses the shop modal shell and has its own styles', () => {
    const access = guestBuyerAccessSource();
    assert.match(access, /shop-refund-modal-overlay/);
    assert.match(access, /refund-btn-cancel/);
    assert.match(access, /refund-btn-confirm/);
    assert.match(access, /bindOverlayDismiss\('guestBuyerAccessModal'/);
    assert.match(access, /closeDynamicModal\('guestBuyerAccessModal'\)/);
    for (const token of [
        '.shop-guest-buyer-access-modal',
        '.shop-guest-buyer-access-flag--danger',
        '.shop-guest-buyer-access-facts',
        '.shop-guest-buyer-access-link-input',
        '.shop-guest-buyer-access-action:disabled',
        '.shop-guest-exception-action--access'
    ]) {
        assert.ok(css.includes(token), `missing style ${token}`);
    }
    // 既有 A2 之前的断言不得被 A3 破坏
    assert.doesNotMatch(guestOpsModalSource(), /guestBuyerAccess/);
});
