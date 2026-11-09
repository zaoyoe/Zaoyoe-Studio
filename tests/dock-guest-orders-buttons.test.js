const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DOCK_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'magnifying-dock.js'),
    'utf8'
);
const GUEST_ORDERS_JS = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', 'guest-orders-client.js'),
    'utf8'
);

test('Contract: magnifying-dock.js defines tickets and backList icons', () => {
    assert.match(DOCK_JS, /tickets:\s*`<svg[^>]*>[\s\S]*<\/svg>`/);
    assert.match(DOCK_JS, /backList:\s*`<svg[^>]*>[\s\S]*<\/svg>`/);
});

test('Contract: guest-orders dock places "返回首页" before "返回商城"', () => {
    assert.match(DOCK_JS, /case "guest-orders":[\s\S]*key:\s*"home"[\s\S]*label:\s*"返回首页"[\s\S]*key:\s*"shop"[\s\S]*label:\s*"返回商城"/);
});

test('Contract: guest-orders gate keeps "查询订单" until email and password are verified', () => {
    assert.match(DOCK_JS, /function isGuestOrdersVerified\(\)/);
    assert.match(DOCK_JS, /let initialLabel = "查询订单"/);
    assert.match(DOCK_JS, /if \(!isVerified\)\s*\{[\s\S]*guestOrdersEmail[\s\S]*guestOrdersPassword/);
    assert.match(DOCK_JS, /let targetLabel = "查询订单"/);
    assert.match(DOCK_JS, /if \(isVerified\)\s*\{[\s\S]*targetLabel = isTicketsView \? "订单查询" : "我的工单"/);
});

test('Contract: syncLivePageState toggles between "我的工单" and "订单查询" when verified', () => {
    assert.match(DOCK_JS, /targetLabel = isTicketsView \? "订单查询" : "我的工单"/);
    assert.match(DOCK_JS, /targetGlyph = isTicketsView \? "search" : "tickets"/);
    assert.match(DOCK_JS, /queryBtn\.setAttribute\("aria-label", targetLabel\)/);
});

test('Contract: back-list button collapses when not in order detail and expands in order detail', () => {
    assert.match(DOCK_JS, /isGuestOrderDetailActive\(\)/);
    assert.match(DOCK_JS, /backListBtn\.dataset\.collapsed = collapsedStr/);
    assert.match(DOCK_JS, /shouldCollapseInitial\s*=\s*isTopItem/);
});

test('Contract: guest-orders-client dispatches guest-orders-view-change on view switch and detail render', () => {
    assert.match(GUEST_ORDERS_JS, /guest-orders-view-change/);
    assert.match(GUEST_ORDERS_JS, /syncMagnifyingDockState/);
});

test('Behavior simulation: dock button labels and actions in guest-orders page', () => {
    // Simulate DOM elements for guest-orders page
    const elements = {
        myTicketsSection: { hidden: true },
        guestOrdersOrdersView: { hidden: false },
        guestOrdersTabsWrapper: { hidden: true },
        guestOrdersDetail: { hidden: true },
        guestOrdersBackToListBtn: { hidden: true, clicked: false, click() { this.clicked = true; } },
        tabBtnOrders: { clicked: false, click() { this.clicked = true; } },
        tabBtnTickets: { clicked: false, click() { this.clicked = true; } },
        guestOrdersLoading: { hidden: true },
        guestOrdersResultCard: { hidden: true, scrollIntoViewCalled: false, scrollIntoView() { this.scrollIntoViewCalled = true; } },
        myTicketsBadgeCount: { hidden: true, textContent: '0' },
        guestOrdersEmail: { value: '', focused: false, focus() { this.focused = true; }, scrollIntoView() {} },
        guestOrdersPassword: { value: '', focused: false, focus() { this.focused = true; }, scrollIntoView() {} },
        guestOrdersSubmitBtn: { clicked: false, click() { this.clicked = true; } }
    };

    const mockDocument = {
        getElementById(id) {
            return elements[id] || null;
        }
    };

    function isGuestOrdersVerified() {
        const tabsWrapper = mockDocument.getElementById("guestOrdersTabsWrapper");
        if (!tabsWrapper || tabsWrapper.hidden) return false;
        const resultCard = mockDocument.getElementById("guestOrdersResultCard");
        const myTicketsSection = mockDocument.getElementById("myTicketsSection");
        const hasOrdersResult = Boolean(resultCard && !resultCard.hidden);
        const isTicketsActive = Boolean(myTicketsSection && !myTicketsSection.hidden);
        return hasOrdersResult || isTicketsActive;
    }

    function isGuestOrderDetailActive() {
        if (!isGuestOrdersVerified()) return false;
        const ticketsSection = mockDocument.getElementById("myTicketsSection");
        const isTicketsActive = Boolean(ticketsSection && !ticketsSection.hidden);
        if (isTicketsActive) return false;
        const detailEl = mockDocument.getElementById("guestOrdersDetail");
        const backBtn = mockDocument.getElementById("guestOrdersBackToListBtn");
        return Boolean(
            detailEl && !detailEl.hidden &&
            backBtn && !backBtn.hidden
        );
    }

    // 1. Initial state (unverified: user has NOT verified email and password)
    assert.equal(isGuestOrdersVerified(), false, 'unverified initially');
    assert.equal(isGuestOrderDetailActive(), false, 'order detail is not active initially');

    // Gate verification: before verifying credentials, dock MUST show "查询订单" and NEVER "我的工单"
    let isVerified = isGuestOrdersVerified();
    let isTicketsView = Boolean(isVerified && elements.myTicketsSection && !elements.myTicketsSection.hidden);
    let targetLabel = "查询订单";
    let targetGlyph = "search";
    if (isVerified) {
        targetLabel = isTicketsView ? "订单查询" : "我的工单";
        targetGlyph = isTicketsView ? "search" : "tickets";
    }
    assert.equal(targetLabel, "查询订单", 'dock MUST show 查询订单 when unverified');
    assert.equal(targetGlyph, "search");

    // Action of query button when clicked while unverified: must focus form / submit, NOT open tickets
    elements.tabBtnTickets.clicked = false;
    elements.guestOrdersEmail.focused = false;
    if (!isVerified) {
        if (!elements.guestOrdersEmail.value.trim()) {
            elements.guestOrdersEmail.focus();
        } else if (!elements.guestOrdersPassword.value.trim()) {
            elements.guestOrdersPassword.focus();
        } else {
            elements.guestOrdersSubmitBtn.click();
        }
    } else {
        elements.tabBtnTickets.click();
    }
    assert.equal(elements.tabBtnTickets.clicked, false, 'cannot click tickets tab while unverified');
    assert.equal(elements.guestOrdersEmail.focused, true, 'focuses email input');
    assert.equal(elements.guestOrdersTabsWrapper.hidden, true, 'tabsWrapper remains hidden');

    // 2. Credentials verified (lookup succeeded: resultCard & tabsWrapper become visible)
    elements.guestOrdersResultCard.hidden = false;
    elements.guestOrdersTabsWrapper.hidden = false;
    assert.equal(isGuestOrdersVerified(), true, 'verified after lookup succeeds');

    isVerified = isGuestOrdersVerified();
    isTicketsView = Boolean(isVerified && elements.myTicketsSection && !elements.myTicketsSection.hidden);
    if (isVerified) {
        targetLabel = isTicketsView ? "订单查询" : "我的工单";
        targetGlyph = isTicketsView ? "search" : "tickets";
    }
    assert.equal(targetLabel, "我的工单", 'dock now safely shows 我的工单 in verified orders list');
    assert.equal(targetGlyph, "tickets");

    // Clicking "我的工单" now safely opens tickets tab
    elements.tabBtnTickets.clicked = false;
    if (isVerified) {
        if (isTicketsView) {
            elements.tabBtnOrders.click();
        } else {
            elements.tabBtnTickets.click();
        }
    }
    assert.equal(elements.tabBtnTickets.clicked, true, 'clicks tickets tab when verified');

    // 3. In tickets view
    elements.myTicketsSection.hidden = false;
    elements.guestOrdersOrdersView.hidden = true;
    isVerified = isGuestOrdersVerified();
    isTicketsView = Boolean(isVerified && elements.myTicketsSection && !elements.myTicketsSection.hidden);
    if (isVerified) {
        targetLabel = isTicketsView ? "订单查询" : "我的工单";
        targetGlyph = isTicketsView ? "search" : "tickets";
    }
    assert.equal(targetLabel, "订单查询", 'dock shows 订单查询 in tickets view');
    assert.equal(targetGlyph, "search");

    // Clicking "订单查询" clicks orders tab
    elements.tabBtnOrders.clicked = false;
    if (isVerified) {
        if (isTicketsView) {
            elements.tabBtnOrders.click();
        } else {
            elements.tabBtnTickets.click();
        }
    }
    assert.equal(elements.tabBtnOrders.clicked, true, 'clicks orders tab to return');

    // 4. In order detail view
    elements.myTicketsSection.hidden = true;
    elements.guestOrdersOrdersView.hidden = false;
    elements.guestOrdersDetail.hidden = false;
    elements.guestOrdersBackToListBtn.hidden = false;

    assert.equal(isGuestOrderDetailActive(), true, 'order detail is recognized as active');
    const shouldCollapseBackList = !isGuestOrderDetailActive();
    assert.equal(shouldCollapseBackList, false, 'back-list button must NOT collapse in detail view');

    // Clicking back-list button
    elements.guestOrdersBackToListBtn.clicked = false;
    const backBtn = mockDocument.getElementById("guestOrdersBackToListBtn");
    if (backBtn && !backBtn.hidden) {
        backBtn.click();
        const resultCard = mockDocument.getElementById("guestOrdersResultCard");
        if (resultCard) {
            resultCard.scrollIntoView();
        }
    }
    assert.equal(elements.guestOrdersBackToListBtn.clicked, true, 'triggers back to list click');
    assert.equal(elements.guestOrdersResultCard.scrollIntoViewCalled, true);

    // After returning to list
    elements.guestOrdersDetail.hidden = true;
    elements.guestOrdersBackToListBtn.hidden = true;
    assert.equal(isGuestOrderDetailActive(), false, 'order detail is no longer active');
    const shouldCollapseAfterBack = !isGuestOrderDetailActive();
    assert.equal(shouldCollapseAfterBack, true, 'back-list button collapses after returning to list');
});
