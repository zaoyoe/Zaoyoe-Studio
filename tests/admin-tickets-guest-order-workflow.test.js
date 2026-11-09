const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminTicketsPath = path.resolve(__dirname, '../js/admin-tickets.js');

function loadAdminTickets() {
    const code = fs.readFileSync(adminTicketsPath, 'utf8');
    const window = {
        addEventListener() {},
        removeEventListener() {},
        setTimeout(fn) { fn(); return 1; },
        clearTimeout() {},
        showToast() {},
        document: {
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        }
    };
    const context = {
        console,
        window,
        document: window.document,
        Date,
        URL,
        URLSearchParams,
        globalThis: window
    };
    vm.runInNewContext(code, context);
    return window.AdminTickets;
}

test('AdminTickets extractOrderId correctly parses order IDs from various patterns', () => {
    const AdminTickets = loadAdminTickets();

    assert.equal(
        AdminTickets.extractOrderId({ description: '[关联订单: GS202611060143452393B54BEBDC4C3] 请及时处理' }),
        'GS202611060143452393B54BEBDC4C3'
    );
    assert.equal(
        AdminTickets.extractOrderId({ reason: '订单号: 50b07741-c698-4a55-8890-6a43b3b4ff72 出现卡密失效' }),
        '50b07741-c698-4a55-8890-6a43b3b4ff72'
    );
    assert.equal(
        AdminTickets.extractOrderId({ order_id: 'DIRECT_ORDER_123', description: 'some text' }),
        'DIRECT_ORDER_123'
    );
});

test('AdminTickets extractEmail correctly parses email addresses from text', () => {
    const AdminTickets = loadAdminTickets();

    assert.equal(
        AdminTickets.extractEmail({ description: '卡密无法使用 (联系邮箱: wangyongchao802@gmail.com)' }),
        'wangyongchao802@gmail.com'
    );
    assert.equal(
        AdminTickets.extractEmail({ reason: '联系邮箱：custom_buyer@foxmail.com' }),
        'custom_buyer@foxmail.com'
    );
    assert.equal(
        AdminTickets.extractEmail({ user_email: 'direct@test.com' }),
        'direct@test.com'
    );
});

test('AdminTickets buildReplyModalDetailState resolves guest order details and formats', () => {
    const AdminTickets = loadAdminTickets();

    const guestTicket = {
        id: 'ticket-g-1',
        status: 'PENDING',
        issue_type: 'INVALID_KEY',
        description: '[关联订单: GS202611060143452393B54BEBDC4C3] 请及时处理，谢谢 (联系邮箱: wangyongchao802@gmail.com)',
        product_name: 'Outlook 斯洛伐克号',
        sku_name: '标准版',
        quantity: 1,
        order_price_paid: '5.00',
        order_card_content: 'test_account----test_password'
    };

    const detailState = AdminTickets.buildReplyModalDetailState(guestTicket, 'RESOLVED');

    assert.equal(detailState.summaryItems.some(item => item.label === '用户 ID' && item.value === '游客买家'), true);
    assert.equal(detailState.summaryItems.some(item => item.label === '用户邮箱' && item.value === 'wangyongchao802@gmail.com'), true);
    assert.equal(detailState.summaryItems.some(item => item.label === '订单号' && item.value === 'GS202611060143452393B54BEBDC4C3'), true);
    assert.equal(detailState.summaryItems.some(item => item.label === '关联商品' && item.value === 'Outlook 斯洛伐克号'), true);
    assert.equal(detailState.summaryItems.some(item => item.label === '订单实付' && item.value === '¥5.00'), true);
});

test('AdminTickets renderReplyModalOrderCard renders full order details and operational actions', () => {
    const AdminTickets = loadAdminTickets();

    const guestTicket = {
        id: 'ticket-g-2',
        order_id: 'GS202611060143452393B54BEBDC4C3',
        user_email: 'wangyongchao802@gmail.com',
        product_name: 'ChatGPT Plus 独享号',
        sku_name: '美区一手',
        quantity: 2,
        order_price_paid: '120.00',
        order_payment_status: 'paid',
        order_delivery_status: 'delivered',
        order_card_content: 'gpt_user@domain.com----SecurePass123',
        is_guest_order: true,
        can_refund: true
    };

    const html = AdminTickets.renderReplyModalOrderCard(guestTicket, { canRefund: true });

    assert.equal(html.includes('游客现金订单'), true);
    assert.equal(html.includes('GS202611060143452393B54BEBDC4C3'), true);
    assert.equal(html.includes('ChatGPT Plus 独享号'), true);
    assert.equal(html.includes('美区一手 × 2'), true);
    assert.equal(html.includes('¥120.00'), true);
    assert.equal(html.includes('gpt_user@domain.com----SecurePass123'), true);
    assert.equal(html.includes('补发卡密'), true);
    assert.equal(html.includes('发起退款'), true);
    assert.equal(html.includes('在订单管理中查看'), true);
    assert.equal(html.includes('复制邮箱'), true);

    const adminStudioHtml = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
    assert.equal(adminStudioHtml.includes('ticketReissueSection'), true);
    assert.equal(adminStudioHtml.includes('自动从库存补发'), true);
});

test('AdminTickets buildRefundConfirmationMessage differentiates guest orders from member orders', () => {
    const AdminTickets = loadAdminTickets();

    const guestMsg = AdminTickets.buildRefundConfirmationMessage({
        id: 'ticket-1',
        order_id: 'GS202611060143452393B54BEBDC4C3'
    }, '处理说明', '内部备注');
    assert.equal(guestMsg.includes('现金原路退款申请'), true);

    const memberMsg = AdminTickets.buildRefundConfirmationMessage({
        id: 'ticket-2',
        order_id: '50b07741-c698-4a55-8890-6a43b3b4ff72'
    }, '处理说明', '内部备注');
    assert.equal(memberMsg.includes('退还订单积分'), true);
});

test('AdminTickets buildDefaultReplyTemplates includes card reissue and dynamic refund templates', () => {
    const AdminTickets = loadAdminTickets();

    const guestTicket = {
        id: 'ticket-g-3',
        order_id: 'GS202611060143452393B54BEBDC4C3',
        issue_type: 'INVALID_KEY',
        is_guest_order: true
    };

    const templates = AdminTickets.buildDefaultReplyTemplates(guestTicket, {
        normalizedNextStatus: 'RESOLVED',
        canRefund: true
    });

    const reissueTemplate = templates.find(t => t.key === 'resolved_reissue_card');
    assert.ok(reissueTemplate);
    assert.equal(reissueTemplate.title, '补发卡密通知');
    assert.equal(reissueTemplate.tag, '补发');

    const refundTemplate = templates.find(t => t.key === 'resolved_refund');
    assert.ok(refundTemplate);
    assert.equal(refundTemplate.body.includes('现金退款申请已提交'), true);
});
