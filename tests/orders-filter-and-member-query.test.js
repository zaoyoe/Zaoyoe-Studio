'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const ordersPage = fs.readFileSync(path.join(REPO_ROOT, 'guest-orders.html'), 'utf8');
const ordersClient = fs.readFileSync(path.join(REPO_ROOT, 'js', 'guest-orders-client.js'), 'utf8');
const ordersStyles = fs.readFileSync(path.join(REPO_ROOT, 'css', 'guest-orders.css'), 'utf8');
const memberBridge = fs.readFileSync(path.join(REPO_ROOT, 'js', 'member-orders-bridge.js'), 'utf8');

function extractFunction(src, name) {
    const startIdx = src.indexOf(`function ${name}(`);
    assert.ok(startIdx >= 0, `function ${name} must exist`);
    let braceCount = 0;
    let foundFirstBrace = false;
    let endIdx = startIdx;
    for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') {
            braceCount++;
            foundFirstBrace = true;
        } else if (src[i] === '}') {
            braceCount--;
            if (foundFirstBrace && braceCount === 0) {
                endIdx = i + 1;
                break;
            }
        }
    }
    return src.slice(startIdx, endIdx);
}

test('guest-orders.html defines custom filter card with no native select elements and starts hidden', () => {
    // 1. Filter card element
    assert.match(ordersPage, /<section id="guestOrdersFilterCard"[^>]*class="[^"]*guest-orders-filter-card[^"]*"[^>]*hidden/);
    
    // 2. Custom search input
    assert.match(ordersPage, /id="ordersFilterSearchInput"[^>]*class="custom-filter-input"/);
    assert.match(ordersPage, /id="ordersFilterSearchClearBtn"/);

    // 3. Custom dropdowns (Status, Delivery, Sort)
    assert.match(ordersPage, /id="ordersStatusDropdown"/);
    assert.match(ordersPage, /id="ordersStatusTrigger"/);
    assert.match(ordersPage, /id="ordersStatusMenu"/);

    assert.match(ordersPage, /id="ordersDeliveryDropdown"/);
    assert.match(ordersPage, /id="ordersDeliveryTrigger"/);
    assert.match(ordersPage, /id="ordersDeliveryMenu"/);

    assert.match(ordersPage, /id="ordersDateDropdown"/);
    assert.match(ordersPage, /id="ordersDateTrigger"/);
    assert.match(ordersPage, /id="ordersDateMenu"/);

    assert.match(ordersPage, /id="ordersSortDropdown"/);
    assert.match(ordersPage, /id="ordersSortTrigger"/);
    assert.match(ordersPage, /id="ordersSortMenu"/);

    // 4. Must NOT contain native select elements inside filter card
    const filterCardStart = ordersPage.indexOf('id="guestOrdersFilterCard"');
    const filterCardEnd = ordersPage.indexOf('</section>', filterCardStart);
    const filterCardSnippet = ordersPage.slice(filterCardStart, filterCardEnd);
    assert.doesNotMatch(filterCardSnippet, /<select\b/i, 'Filter card must not use native browser select elements');

    // 5. Active tags and count badge
    assert.match(ordersPage, /id="ordersFilterCountBadge"/);
    assert.match(ordersPage, /id="ordersFilterResetBtn"/);
    assert.match(ordersPage, /id="ordersFilterTagsRow"/);

    // 6. Bridge script mounted
    assert.match(ordersPage, /src="\.\/js\/member-orders-bridge\.js\?v=[^"]*"/);
});

test('css/guest-orders.css contains high quality custom styling for filter controls', () => {
    assert.match(ordersStyles, /\.guest-orders-filter-card/);
    assert.match(ordersStyles, /\.custom-filter-input/);
    assert.match(ordersStyles, /\.custom-dropdown/);
    assert.match(ordersStyles, /\.custom-dropdown-trigger/);
    assert.match(ordersStyles, /\.custom-dropdown-menu/);
    assert.match(ordersStyles, /\.custom-dropdown-item/);
    assert.match(ordersStyles, /\.orders-filter-tag/);
});

test('matchOrderStatus correctly categorizes different payment and fulfillment combinations', () => {
    const sandbox = {
        normalizeText: (v, max = 500) => String(v ?? '').trim().slice(0, max),
        resolveOrderStatus: (order) => {
            const p = String(order.payment_status || '').toLowerCase();
            const f = String(order.fulfillment_status || '').toLowerCase();
            if (p === 'confirmed') {
                if (f === 'delivered') return { text: '已完成' };
                if (f === 'fulfilling') return { text: '发货中' };
                return { text: '已付款·待发货' };
            }
            if (p === 'refunded' || f === 'refunded') return { text: '已退款' };
            return { text: '待支付' };
        }
    };

    const fnCode = extractFunction(ordersClient, 'matchOrderStatus');
    vm.runInNewContext(`${fnCode}; globalThis.matchOrderStatus = matchOrderStatus;`, sandbox);

    const deliveredOrder = { payment_status: 'confirmed', fulfillment_status: 'delivered' };
    const fulfillingOrder = { payment_status: 'confirmed', fulfillment_status: 'fulfilling' };
    const pendingOrder = { payment_status: 'pending', fulfillment_status: 'pending' };
    const refundedOrder = { payment_status: 'refunded', fulfillment_status: 'refunded' };

    assert.equal(sandbox.matchOrderStatus(deliveredOrder, 'all'), true);
    assert.equal(sandbox.matchOrderStatus(deliveredOrder, 'completed'), true);
    assert.equal(sandbox.matchOrderStatus(deliveredOrder, 'fulfilling'), false);

    assert.equal(sandbox.matchOrderStatus(fulfillingOrder, 'fulfilling'), true);
    assert.equal(sandbox.matchOrderStatus(fulfillingOrder, 'completed'), false);

    assert.equal(sandbox.matchOrderStatus(pendingOrder, 'pending'), true);
    assert.equal(sandbox.matchOrderStatus(pendingOrder, 'completed'), false);

    assert.equal(sandbox.matchOrderStatus(refundedOrder, 'refunded'), true);
    assert.equal(sandbox.matchOrderStatus(refundedOrder, 'completed'), false);
});

test('matchOrderDeliveryType differentiates auto and manual fulfillment', () => {
    const sandbox = {
        normalizeText: (v, max = 500) => String(v ?? '').trim().slice(0, max)
    };
    const fnCode = extractFunction(ordersClient, 'matchOrderDeliveryType');
    vm.runInNewContext(`${fnCode}; globalThis.matchOrderDeliveryType = matchOrderDeliveryType;`, sandbox);

    const autoOrder = { fulfillment_source: 'inventory' };
    const manualOrder = { fulfillment_source: 'manual' };

    assert.equal(sandbox.matchOrderDeliveryType(autoOrder, 'all'), true);
    assert.equal(sandbox.matchOrderDeliveryType(autoOrder, 'auto'), true);
    assert.equal(sandbox.matchOrderDeliveryType(autoOrder, 'manual'), false);

    assert.equal(sandbox.matchOrderDeliveryType(manualOrder, 'manual'), true);
    assert.equal(sandbox.matchOrderDeliveryType(manualOrder, 'auto'), false);
});

test('matchOrderKeyword matches order number, title, and item contents', () => {
    const sandbox = {};
    const fnCode = extractFunction(ordersClient, 'matchOrderKeyword');
    vm.runInNewContext(`${fnCode}; globalThis.matchOrderKeyword = matchOrderKeyword;`, sandbox);

    const order = {
        order_no: 'ORD-987654321',
        snapshot_product_name: 'Claude 3.7 Sonnet',
        items: [
            { name: 'Claude 3.7 Sonnet', content: 'account:key_secret_abc123' }
        ]
    };

    assert.equal(sandbox.matchOrderKeyword(order, ''), true);
    assert.equal(sandbox.matchOrderKeyword(order, '98765'), true);
    assert.equal(sandbox.matchOrderKeyword(order, 'Sonnet'), true);
    assert.equal(sandbox.matchOrderKeyword(order, 'abc123'), true);
    assert.equal(sandbox.matchOrderKeyword(order, 'nonexistent_foo'), false);
});

test('sortOrders properly handles time and amount sorting', () => {
    const sandbox = {};
    const fnCode = extractFunction(ordersClient, 'sortOrders');
    vm.runInNewContext(`${fnCode}; globalThis.sortOrders = sortOrders;`, sandbox);

    const orders = [
        { id: '1', created_at: '2026-11-01T10:00:00Z', amount: 10 },
        { id: '2', created_at: '2026-11-03T10:00:00Z', amount: 50 },
        { id: '3', created_at: '2026-11-02T10:00:00Z', amount: 20 }
    ];

    const timeDesc = sandbox.sortOrders(orders, 'time_desc');
    assert.equal(timeDesc.map((o) => o.id).join(','), '2,3,1');

    const timeAsc = sandbox.sortOrders(orders, 'time_asc');
    assert.equal(timeAsc.map((o) => o.id).join(','), '1,3,2');

    const amtDesc = sandbox.sortOrders(orders, 'amount_desc');
    assert.equal(amtDesc.map((o) => o.id).join(','), '2,3,1');

    const amtAsc = sandbox.sortOrders(orders, 'amount_asc');
    assert.equal(amtAsc.map((o) => o.id).join(','), '1,3,2');
});

test('member-orders-bridge adapts member shop orders into unified format', () => {
    const sandbox = {
        normalizeText: (v, max = 500) => String(v ?? '').trim().slice(0, max)
    };
    const fnCode = extractFunction(memberBridge, 'adaptMemberOrder');
    vm.runInNewContext(`${fnCode}; globalThis.adaptMemberOrder = adaptMemberOrder;`, sandbox);

    const rawOrder = {
        id: 'uuid-1234',
        snapshot_product_name: 'Gemini 3.1pro',
        price_paid: 46,
        total_price: 46,
        discount_amount: 0,
        delivery_status: 'delivered',
        status: 'completed',
        created_at: '2026-11-06T10:00:00Z',
        fulfillment_source: 'inventory',
        product_id: 'prod-gemini'
    };

    const adapted = sandbox.adaptMemberOrder(rawOrder);
    assert.equal(adapted.order_no, 'uuid-1234');
    assert.equal(adapted.payment_status, 'confirmed');
    assert.equal(adapted.fulfillment_status, 'delivered');
    assert.equal(adapted.amount, 46);
    assert.equal(adapted.payment.method, 'points');
    assert.equal(adapted.payment.label, '积分支付');
    assert.equal(adapted.is_member_order, true);
});

test('matchOrderDate properly filters orders across all date ranges', () => {
    const sandbox = {};
    const fnCode = extractFunction(ordersClient, 'matchOrderDate');
    vm.runInNewContext(`${fnCode}; globalThis.matchOrderDate = matchOrderDate;`, sandbox);

    const now = new Date();
    const todayOrder = { created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() }; // 2 hours ago
    const threeDaysAgoOrder = { created_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() };
    const twentyDaysAgoOrder = { created_at: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString() };
    const sixtyDaysAgoOrder = { created_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString() };
    const lastYearOrder = { created_at: new Date(now.getFullYear() - 1, 5, 1).toISOString() };

    // 'all'
    assert.equal(sandbox.matchOrderDate(todayOrder, 'all'), true);
    assert.equal(sandbox.matchOrderDate(lastYearOrder, 'all'), true);

    // 'today'
    assert.equal(sandbox.matchOrderDate(todayOrder, 'today'), true);
    assert.equal(sandbox.matchOrderDate(threeDaysAgoOrder, 'today'), false);

    // '7days'
    assert.equal(sandbox.matchOrderDate(threeDaysAgoOrder, '7days'), true);
    assert.equal(sandbox.matchOrderDate(twentyDaysAgoOrder, '7days'), false);

    // '30days'
    assert.equal(sandbox.matchOrderDate(twentyDaysAgoOrder, '30days'), true);
    assert.equal(sandbox.matchOrderDate(sixtyDaysAgoOrder, '30days'), false);

    // '90days'
    assert.equal(sandbox.matchOrderDate(sixtyDaysAgoOrder, '90days'), true);
    assert.equal(sandbox.matchOrderDate(lastYearOrder, '90days'), false);

    // 'year'
    assert.equal(sandbox.matchOrderDate(todayOrder, 'year'), true);
    assert.equal(sandbox.matchOrderDate(lastYearOrder, 'year'), false);
});

test('magnifying dock routes orders button directly to guest-orders page', () => {
    const dockScript = fs.readFileSync(path.join(REPO_ROOT, 'js', 'magnifying-dock.js'), 'utf8');
    assert.match(dockScript, /key:\s*["']orders["']/);
    assert.match(dockScript, /\/guest-orders\.html\?site=/);
});

test('order detail page features ticket entry, custom ticket modal without select, and delivery pending banner', () => {
    // 1. Pending delivery banner in guest-orders.html
    assert.match(ordersPage, /id="guestOrdersDeliveryPendingBox"[^>]*class="[^"]*guest-orders-delivery-pending-box[^"]*"[^>]*hidden/);
    assert.match(ordersPage, /订单待发货/);

    // 2. Ticket history status card
    assert.match(ordersPage, /id="guestOrdersTicketStatusCard"[^>]*class="[^"]*guest-orders-ticket-status-card[^"]*"[^>]*hidden/);
    assert.match(ordersPage, /id="ticketStatusTitle"/);
    assert.match(ordersPage, /id="ticketStatusBadge"/);
    assert.match(ordersPage, /id="ticketStatusDesc"/);
    assert.match(ordersPage, /id="ticketStatusReplyRow"/);

    // 3. Action bar & Open ticket button
    assert.match(ordersPage, /id="guestOrdersDetailActions"[^>]*class="guest-orders-detail-actions"/);
    assert.match(ordersPage, /id="guestOrdersOpenTicketBtn"[^>]*class="guest-orders-ticket-btn"/);
    assert.match(ordersPage, /提交售后工单/);

    // 4. Ticket submission modal & custom dropdown (no native select)
    assert.match(ordersPage, /id="guestOrdersTicketModal"[^>]*class="[^"]*guest-orders-modal-overlay[^"]*"[^>]*hidden/);
    assert.match(ordersPage, /id="guestOrdersTicketForm"/);
    assert.match(ordersPage, /id="ticketModalOrderNo"/);
    assert.match(ordersPage, /id="ticketModalProductName"/);
    assert.match(ordersPage, /id="ticketIssueDropdown"/);
    assert.match(ordersPage, /id="ticketIssueTrigger"/);
    assert.match(ordersPage, /id="ticketIssueMenu"/);
    assert.match(ordersPage, /id="ticketModalEmail"/);
    assert.match(ordersPage, /id="ticketModalDescription"/);
    assert.match(ordersPage, /id="ticketModalCharCount"/);

    const ticketModalStart = ordersPage.indexOf('id="guestOrdersTicketModal"');
    const ticketModalEnd = ordersPage.indexOf('</div>\n        </div>\n\n        <footer', ticketModalStart);
    const modalSnippet = ordersPage.slice(ticketModalStart, ticketModalEnd > ticketModalStart ? ticketModalEnd : undefined);
    assert.doesNotMatch(modalSnippet, /<select\b/i, 'Ticket modal must not contain native browser select elements');
});

test('member-orders-bridge exports ticket creation & query APIs and correctly detects pending delivery', () => {
    assert.match(memberBridge, /createTicket/);
    assert.match(memberBridge, /fetchTicketForOrder/);
    assert.match(memberBridge, /isLoggedIn/);
    assert.match(memberBridge, /getStoredSession/);

    const sandbox = {
        normalizeText: (v, max = 500) => String(v ?? '').trim().slice(0, max)
    };
    const fnCode = extractFunction(memberBridge, 'adaptMemberOrder');
    vm.runInNewContext(`${fnCode}; globalThis.adaptMemberOrder = adaptMemberOrder;`, sandbox);

    // Unfulfilled order with pending delivery status
    const pendingOrder = {
        id: 'uuid-pending-1',
        total_price: 20,
        price_paid: 20,
        status: 'completed', // payment completed
        delivery_status: 'pending',
        snapshot_product_name: '未发货商品'
    };
    const adaptedPending = sandbox.adaptMemberOrder(pendingOrder);
    assert.equal(adaptedPending.payment_status, 'confirmed');
    assert.equal(adaptedPending.fulfillment_status, 'pending');

    // Fulfilled order with delivered status
    const deliveredOrder = {
        id: 'uuid-delivered-1',
        total_price: 20,
        price_paid: 20,
        status: 'completed',
        delivery_status: 'delivered',
        snapshot_product_name: '已发货商品'
    };
    const adaptedDelivered = sandbox.adaptMemberOrder(deliveredOrder);
    assert.equal(adaptedDelivered.payment_status, 'confirmed');
    assert.equal(adaptedDelivered.fulfillment_status, 'delivered');
});

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, ' ')
        .replace(/^[ \t]*\/\/.*$/gmu, '');
}

test('guest-orders-client exposes showTicketStatus and handles pending delivery banner', () => {
    assert.match(ordersClient, /showTicketStatus\(ticket\)/);
    assert.match(ordersClient, /guestOrdersDeliveryPendingBox/);
    assert.match(ordersClient, /guestOrdersOpenTicketBtn/);
    assert.match(ordersClient, /ticketIssueDropdown/);
    // Crucial isolation check: client must never import account auth tokens directly
    const code = stripComments(ordersClient);
    assert.doesNotMatch(code, /supabase|access_token|Authorization\s*:|Bearer/i);
    assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test('my-tickets section features view tabs, 5 stat cards, search bar and custom type dropdown', () => {
    // 1. View tabs
    assert.match(ordersPage, /id="guestOrdersViewTabs"/);
    assert.match(ordersPage, /id="tabBtnOrders"/);
    assert.match(ordersPage, /id="tabBtnTickets"/);
    assert.match(ordersPage, /id="myTicketsBadgeCount"/);

    // 2. My Tickets section
    assert.match(ordersPage, /id="myTicketsSection"[^>]*class="my-tickets-section"[^>]*hidden/);
    assert.match(ordersPage, /服务支持/);
    assert.match(ordersPage, /我的工单/);
    assert.match(ordersPage, /id="myTicketsCreateBtn"/);

    // 3. 5 Stat cards
    assert.match(ordersPage, /id="statCardAll"/);
    assert.match(ordersPage, /id="statCardPending"/);
    assert.match(ordersPage, /id="statCardReplied"/);
    assert.match(ordersPage, /id="statCardResolved"/);
    assert.match(ordersPage, /id="statCardClosed"/);
    assert.match(ordersPage, /data-stat-filter="all"/);
    assert.match(ordersPage, /data-stat-filter="pending"/);
    assert.match(ordersPage, /data-stat-filter="replied"/);
    assert.match(ordersPage, /data-stat-filter="resolved"/);
    assert.match(ordersPage, /data-stat-filter="closed"/);

    // 4. Ticket records search and type dropdown
    assert.match(ordersPage, /id="myTicketsSearchInput"/);
    assert.match(ordersPage, /id="myTicketsTypeDropdown"/);
    assert.match(ordersPage, /id="myTicketsEmptyState"/);
    assert.match(ordersPage, /id="myTicketsListContainer"/);
});

test('resolveTicketStatus correctly classifies open, replied, resolved, and closed statuses', () => {
    const sandbox = {};
    const fnCode = extractFunction(ordersClient, 'resolveTicketStatus');
    vm.runInNewContext(`${fnCode}; globalThis.resolveTicketStatus = resolveTicketStatus;`, sandbox);

    const openState = sandbox.resolveTicketStatus('open', false);
    assert.equal(openState.statKey, 'pending');
    assert.equal(openState.text, '待客服回复');

    const repliedState = sandbox.resolveTicketStatus('open', true);
    assert.equal(repliedState.statKey, 'replied');
    assert.equal(repliedState.text, '待我回复');

    const explicitReplied = sandbox.resolveTicketStatus('replied', false);
    assert.equal(explicitReplied.statKey, 'replied');

    const resolvedState = sandbox.resolveTicketStatus('resolved', true);
    assert.equal(resolvedState.statKey, 'resolved');
    assert.equal(resolvedState.text, '已经解决');

    const closedState = sandbox.resolveTicketStatus('closed', true);
    assert.equal(closedState.statKey, 'closed');
    assert.equal(closedState.text, '已经关闭');
});

test('ticket button is positioned before copy all and problem description focus uses brand blue', () => {
    // 1. Delivery actions bar positions open ticket button first, copy all second
    const renderDeliveryCode = extractFunction(ordersClient, 'renderDelivery');
    const openTicketIdx = renderDeliveryCode.indexOf('actionsBar.appendChild(openTicketBtn)');
    const copyAllIdx = renderDeliveryCode.indexOf('targetBar.appendChild(copyAllBtn)');
    assert.ok(openTicketIdx >= 0, 'openTicketBtn must be added');
    assert.ok(copyAllIdx >= 0, 'copyAllBtn must be added');
    assert.ok(openTicketIdx < copyAllIdx, 'openTicketBtn must be added before copyAllBtn');

    // 2. Textarea focus border gently illuminates without harsh colored halo
    assert.match(ordersStyles, /\.guest-orders-ticket-textarea:focus\s*\{[^}]*box-shadow:\s*none/);
    assert.match(ordersStyles, /\.my-ticket-reply-composer:focus-within\s*\{[^}]*border-color:/);

    // 3. GuestOrdersClient exports tab and ticket methods
    assert.match(ordersClient, /switchView\(view\)/);
    assert.match(ordersClient, /loadMyTickets\(\)/);
    assert.match(ordersClient, /getMyTickets\(\)/);
});

test('my-tickets monochrome styling, back-to-shop hover motion, card gap, and sliding tab component', () => {
    // 1. View tabs wrapper is hidden before authentication / query and placed above the orders view pane
    assert.match(ordersPage, /id="guestOrdersTabsWrapper"[^>]*hidden/);
    const tabsWrapperIdx = ordersPage.indexOf('id="guestOrdersTabsWrapper"');
    const ordersViewPaneIdx = ordersPage.indexOf('id="guestOrdersOrdersView"');
    assert.ok(tabsWrapperIdx >= 0 && ordersViewPaneIdx >= 0, 'Tabs wrapper and orders view pane must exist');
    assert.ok(tabsWrapperIdx < ordersViewPaneIdx, 'Tabs wrapper must be positioned above orders view pane');

    // 2. Sliding indicator slider exists inside view tabs
    assert.match(ordersPage, /id="guestOrdersTabSlider"/);
    assert.match(ordersStyles, /\.guest-orders-tab-slider\s*\{[^}]*transition:[^}]*transform/);

    // 3. Card vertical gap defined on .guest-orders-view-pane to prevent squished cards (Fig 2 fix)
    assert.match(ordersStyles, /\.guest-orders-view-pane\s*\{[^}]*display:\s*flex[^}]*gap:\s*2[0-9]px/);

    // 4. Black and white / monochrome styling: no orange in service tag, no card lifting on hover
    assert.match(ordersStyles, /\.my-tickets-service-tag\s*\{[^}]*color:\s*var\(--go-muted\)/);
    assert.match(ordersStyles, /\.my-tickets-stat-card:hover\s*\{[^}]*transform:\s*none/);
    assert.match(ordersStyles, /\.my-ticket-item-card:hover\s*\{[^}]*transform:\s*none/);

    // 5. Button hover effect matches back-to-shop button with micro-sink transform
    assert.match(ordersStyles, /\.my-tickets-create-btn:hover\s*\{[^}]*transform:\s*translateY\(0\.75px\)/);
    assert.match(ordersStyles, /\.my-tickets-action-btn:hover\s*\{[^}]*transform:\s*translateY\(0\.75px\)/);
    assert.match(ordersStyles, /\.guest-orders-ticket-btn:hover\s*\{[^}]*transform:\s*translateY\(0\.75px\)/);
});

test('order detail direct open, 10 items pagination, unified pill buttons, and modal sink hover', () => {
    // 1. Order detail direct in-place opening (no jump/animation delay) & title switch
    assert.match(ordersClient, /resultTitle\.textContent\s*=\s*detail\s*\?\s*['"]订单详情['"]\s*:\s*['"]订单列表['"]/);
    assert.match(ordersClient, /setHidden\(['"]guestOrdersFilterCard['"],\s*Boolean\(detail\)/);
    const openDetailCode = extractFunction(ordersClient, 'openDetail');
    assert.doesNotMatch(openDetailCode, /scrollIntoView/);

    // 2. 10 items per page pagination
    assert.match(ordersClient, /const\s+PAGE_SIZE\s*=\s*10;/);
    assert.match(ordersClient, /orders\.slice\(startIndex,\s*startIndex\s*\+\s*PAGE_SIZE\)/);

    // 3. Unified button styles: Copy all card codes and submit ticket button both share .guest-orders-ticket-btn capsule styling
    assert.match(ordersClient, /guest-orders-ticket-btn guest-orders-delivery-copy-all-btn/);
    assert.match(ordersStyles, /\.guest-orders-delivery-actions-bar\s+\.guest-orders-ticket-btn,\s*\.guest-orders-delivery-actions-bar\s+\.guest-orders-delivery-copy-all-btn\s*\{[^}]*border-radius:\s*999px\s*!important/);
    assert.match(ordersStyles, /\.guest-orders-delivery-copy-all-btn:hover\s*\{[^}]*transform:\s*translateY\(0\.75px\)/);
    assert.match(ordersStyles, /\.guest-orders-delivery-copy-all-btn:active\s*\{[^}]*transform:\s*translateY\(1\.25px\)/);

    // 4. Ticket modal actions micro-sink hover & active
    assert.match(ordersStyles, /\.guest-orders-modal-actions\s+#ticketModalCancelBtn:hover\s*,\s*\.guest-orders-modal-actions\s+\.guest-orders-secondary-btn:hover\s*\{[^}]*transform:\s*translateY\(0\.75px\)/);
    assert.match(ordersStyles, /\.guest-orders-modal-actions\s+#ticketModalCancelBtn:active\s*,\s*\.guest-orders-modal-actions\s+\.guest-orders-secondary-btn:active\s*\{[^}]*transform:\s*translateY\(1\.25px\)/);
    assert.match(ordersStyles, /\.guest-orders-modal-actions\s+#ticketModalSubmitBtn:hover:not\(:disabled\)[^}]*transform:\s*translateY\(0\.75px\)/);
    assert.match(ordersStyles, /\.guest-orders-modal-actions\s+#ticketModalSubmitBtn:active:not\(:disabled\)[^}]*transform:\s*translateY\(1\.25px\)/);

    // 5. Tab badge anti-overlap: Fixed box-sizing, dimensions, ResizeObserver and reactive slider updates
    assert.match(ordersStyles, /\.my-tickets-tab-badge\s*\{[^}]*min-width:\s*18px/);
    assert.match(ordersStyles, /\.my-tickets-tab-badge\s*\{[^}]*height:\s*18px/);
    assert.match(ordersStyles, /\.guest-orders-view-tab\s*\{[^}]*white-space:\s*nowrap/);
    assert.match(ordersClient, /ResizeObserver/);
    const updateStatsCode = extractFunction(ordersClient, 'updateMyTicketsStats');
    assert.match(updateStatsCode, /updateTabSlider/);

    // 6. Ticket Detail Modal: HTML structure, timeline, reissued card copy, and interactive ticket card
    assert.match(ordersPage, /id="myTicketDetailModal"/);
    assert.match(ordersPage, /id="timelineStepSubmit"/);
    assert.match(ordersPage, /id="timelineStepProcessing"/);
    assert.match(ordersPage, /id="timelineStepDone"/);
    assert.match(ordersPage, /id="ticketDetailReissuedCard"/);
    assert.match(ordersPage, /id="ticketDetailCopyCardBtn"/);
    assert.match(ordersStyles, /\.my-ticket-detail-dialog/);
    assert.match(ordersStyles, /\.my-ticket-timeline/);
    assert.match(ordersStyles, /\.my-ticket-view-detail-btn/);
    assert.match(ordersClient, /openTicketDetail\(t\)/);
    assert.match(ordersClient, /openTicketDetail\(ticket\)/);
    assert.match(ordersClient, /closeTicketDetail\(\)/);

    // 7. Unified Search Input: My Tickets uses .custom-filter-input with 40px height and 12px border radius
    assert.match(ordersPage, /id="myTicketsSearchInput"[^>]*class="[^"]*custom-filter-input[^"]*my-tickets-search-input[^"]*"/);
    assert.match(ordersStyles, /\.my-tickets-search-input\s*\{[^}]*height:\s*40px\s*!important/);
    assert.match(ordersStyles, /\.my-tickets-search-input\s*\{[^}]*border-radius:\s*12px\s*!important/);
    assert.match(ordersStyles, /\.my-tickets-type-dropdown\s+\.custom-dropdown-trigger\s*\{[^}]*height:\s*40px/);
    assert.match(ordersStyles, /\.my-tickets-type-dropdown\s+\.custom-dropdown-trigger\s*\{[^}]*border-radius:\s*12px/);
});

test('ticket conversation continuity, refined color styling, and order loading state', () => {
    const ordersPage = fs.readFileSync(path.join(__dirname, '..', 'guest-orders.html'), 'utf8');
    const ordersStyles = fs.readFileSync(path.join(__dirname, '..', 'css', 'guest-orders.css'), 'utf8');
    const ordersClient = fs.readFileSync(path.join(__dirname, '..', 'js', 'guest-orders-client.js'), 'utf8');
    const adminTicketsJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-tickets.js'), 'utf8');
    const adminProcessJs = fs.readFileSync(path.join(__dirname, '..', 'server', 'api-handlers', 'admin', 'tickets', 'process.js'), 'utf8');

    // 1. User Reply & Conversation Stream DOM
    assert.match(ordersPage, /id="ticketDetailConversationSection"/);
    assert.match(ordersPage, /id="ticketDetailConversationStream"/);
    assert.match(ordersPage, /id="ticketDetailUserReplySection"/);
    assert.match(ordersPage, /id="ticketDetailReplyInput"/);
    assert.match(ordersPage, /id="ticketDetailReplySubmitBtn"/);

    // 2. Refined color styling for timeline and replies (not stark monochrome, not gaudy)
    assert.match(ordersStyles, /\.my-ticket-timeline-step\.is-complete\s+\.step-dot\s*\{[^}]*background:\s*#10b981/);
    assert.match(ordersStyles, /\.my-ticket-timeline-step\.is-active\s+\.step-dot\s*\{[^}]*color:\s*#2563eb/);
    assert.match(ordersStyles, /\.detail-reply-content\s*\{[^}]*border-left:\s*3\.5px solid #10b981/);
    assert.match(ordersStyles, /\.my-ticket-msg-bubble--user\s*\{[^}]*border-left:\s*3\.5px solid #3b82f6/);
    assert.match(ordersStyles, /\.my-ticket-msg-bubble--staff\s*\{[^}]*border-left:\s*3\.5px solid #10b981/);

    // 3. Order detail item loading state
    assert.match(ordersStyles, /\.guest-orders-item\.is-loading\s*\{[^}]*cursor:\s*wait/);
    assert.match(ordersStyles, /\.guest-orders-item\.is-loading\s+\.guest-orders-meta-hint\s*\{[^}]*color:\s*#2563eb/);
    assert.match(ordersClient, /classList\.add\('is-loading'\)/);
    assert.match(ordersClient, /正在加载详情\.\.\./);

    // 4. Client reply action binding
    assert.match(ordersClient, /ticketDetailReplySubmitBtn/);
    assert.match(ordersClient, /action:\s*'reply_ticket'/);

    // 5. Admin Studio conversation continuity
    assert.match(adminTicketsJs, /\[用户补充/);
    assert.match(adminTicketsJs, /用户补充信息/);
    assert.match(adminProcessJs, /normalizedAdminReply/);
    assert.match(adminProcessJs, /\[客服回复/);

    // 6. Ticket Detail Modal auto-hiding scrollbar & clean non-glaring textarea focus
    assert.match(ordersStyles, /\.my-ticket-detail-dialog\s*\{[^}]*scrollbar-color:\s*transparent transparent/);
    assert.match(ordersStyles, /\.my-ticket-detail-body\s*\{[^}]*scrollbar-color:\s*transparent transparent/);
    assert.match(ordersStyles, /\.my-ticket-detail-body::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*transparent/);
    assert.match(ordersStyles, /\.guest-orders-ticket-textarea:focus\s*\{[^}]*box-shadow:\s*none\s*!important/);
    assert.match(ordersStyles, /\.my-ticket-reply-textarea:focus\s*\{[^}]*box-shadow:\s*none\s*!important/);
    assert.match(ordersStyles, /\.my-ticket-reply-composer:focus-within\s*\{[^}]*border-color:\s*rgba/);

    // 7. Elegant view fade-in transition without jumping
    assert.match(ordersStyles, /@keyframes guestOrdersViewFadeIn/);
    assert.match(ordersStyles, /\.my-tickets-section\s*\{[^}]*animation:\s*guestOrdersViewFadeIn/);

    // 8. Modal overlay backdrop & blur synced with login modal standards
    assert.match(ordersStyles, /\.guest-orders-modal-overlay\s*\{[^}]*background:\s*var\(--app-modal-backdrop/);
    assert.match(ordersStyles, /\.guest-orders-modal-overlay\s*\{[^}]*backdrop-filter:\s*var\(--app-modal-backdrop-filter/);
});

