'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const ordersHtml = fs.readFileSync(path.join(REPO_ROOT, 'guest-orders.html'), 'utf8');
const ordersCss = fs.readFileSync(path.join(REPO_ROOT, 'css', 'guest-orders.css'), 'utf8');
const ordersJs = fs.readFileSync(path.join(REPO_ROOT, 'js', 'guest-orders-client.js'), 'utf8');
const memberBridgeJs = fs.readFileSync(path.join(REPO_ROOT, 'js', 'member-orders-bridge.js'), 'utf8');

test('guest-orders.html defines #guestOrdersInitialSkeleton matching real card positions', () => {
    // 1. Initial skeleton host exists outside protected content
    assert.match(ordersHtml, /id="guestOrdersInitialSkeleton"[^>]*class="[^"]*guest-orders-skeleton-host[^"]*"/);

    const skeletonIdx = ordersHtml.indexOf('id="guestOrdersInitialSkeleton"');
    const protectedIdx = ordersHtml.indexOf('id="guestOrdersProtectedContent"');
    assert.ok(skeletonIdx >= 0, '#guestOrdersInitialSkeleton must exist');
    assert.ok(protectedIdx >= 0, '#guestOrdersProtectedContent must exist');
    assert.ok(skeletonIdx < protectedIdx, '#guestOrdersInitialSkeleton must precede #guestOrdersProtectedContent');

    // 2. Guest view skeleton matches #guestOrdersQueryCard layout
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-view--guest[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-query-card[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-bar--title[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-form[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-bar--label-sm[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-bar--label-md[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-bar--label-lg[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-button[^"]*"/);

    // 3. Member view skeleton matches Tabs, Filter Card and Result List
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-view--member[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-tabs-wrap[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-tabs[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-filter-card[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-bar--filter-title[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-badge--count[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-input--search[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-dropdown[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-skel-result-card[^"]*"/);
    assert.match(ordersHtml, /class="[^"]*guest-orders-item\s+is-skeleton[^"]*"/);
});

test('order item skeleton matches 1:1 real .guest-orders-item structure', () => {
    assert.match(ordersHtml, /class="guest-orders-item-top"[\s\S]*class="guest-orders-skel-bar guest-orders-skel-bar--order-no"/);
    assert.match(ordersHtml, /class="guest-orders-item-badges"[\s\S]*class="guest-orders-skel-badge"/);
    assert.match(ordersHtml, /class="guest-orders-item-body"[\s\S]*class="guest-orders-skel-thumb"/);
    assert.match(ordersHtml, /class="guest-orders-item-content"[\s\S]*class="guest-orders-skel-bar guest-orders-skel-bar--item-title"/);
    assert.match(ordersHtml, /class="guest-orders-skel-bar guest-orders-skel-bar--item-meta"/);
    assert.match(ordersHtml, /class="guest-orders-item-amount"[\s\S]*class="guest-orders-skel-bar guest-orders-skel-bar--item-price"/);
});

test('css/guest-orders.css defines shimmer sweep animation, theme support, and responsive rules', () => {
    // 1. Sweep keyframes
    assert.match(ordersCss, /@keyframes guestOrdersSkelSweep/);
    assert.match(ordersCss, /transform:\s*translateX\(-100%\)/);
    assert.match(ordersCss, /transform:\s*translateX\(100%\)/);

    // 2. Light & Dark theme background colors
    assert.match(ordersCss, /rgba\(148,\s*163,\s*184,\s*0\.16\)/);
    assert.match(ordersCss, /html\[data-theme="dark"\]\s+\.guest-orders-skel-bar/);
    assert.match(ordersCss, /rgba\(255,\s*255,\s*255,\s*0\.08\)/);

    // 3. View switching styles
    assert.match(ordersCss, /\.guest-orders-skel-view--guest\s*\{[^}]*display:\s*block/);
    assert.match(ordersCss, /html\.guest-orders-member-mode\s+\.guest-orders-skel-view--guest\s*\{[^}]*display:\s*none\s*!important/);
    assert.match(ordersCss, /html\.guest-orders-member-mode\s+\.guest-orders-skel-view--member\s*\{[^}]*display:\s*flex\s*!important/);

    // 4. Responsive media queries for mobile
    assert.match(ordersCss, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*\.guest-orders-skel-form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(ordersCss, /@media\s*\(max-width:\s*680px\)\s*\{[\s\S]*\.guest-orders-skel-dropdown\s*\{[^}]*flex:\s*1\s+1\s+100%/);
});

test('guest-orders-client hides skeleton when ready and exports renderOrdersSkeleton without innerHTML', () => {
    // 1. hideInitialSkeleton called on availability check
    assert.match(ordersJs, /hideInitialSkeleton/);
    assert.match(ordersJs, /setHidden\(['"]guestOrdersInitialSkeleton['"],\s*true\)/);

    // 2. Dynamic skeleton renderer exists and does NOT use innerHTML
    assert.match(ordersJs, /function renderOrdersSkeleton\(container/);
    assert.match(ordersJs, /renderOrdersSkeleton\(container,\s*count\)/);

    // Clean check
    const clientCode = ordersJs.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/^[ \t]*\/\/.*$/gmu, '');
    assert.doesNotMatch(clientCode, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test('member-orders-bridge hides initial skeleton and renders order skeleton in list', () => {
    assert.match(memberBridgeJs, /['"]guestOrdersInitialSkeleton['"]/);
    assert.match(memberBridgeJs, /renderOrdersSkeleton/);
});
