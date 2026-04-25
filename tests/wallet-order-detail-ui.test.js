const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const walletScriptPath = path.resolve(__dirname, '../js/components/WalletModal.js');
const walletStylesPath = path.resolve(__dirname, '../css/wallet.css');
const shopHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/shop.js');

function sliceSourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

test('wallet order detail modal uses roomier sizing with bounded scrolling', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(styles, /max-width:\s*560px/);
    assert.match(styles, /width:\s*min\(92vw,\s*560px\)/);
    assert.match(styles, /\.wallet-order-modal--shop-detail\s*\{[\s\S]*max-width:\s*560px;/);
    assert.match(styles, /\.wallet-order-modal--shop-detail\s*\{[\s\S]*width:\s*min\(92vw,\s*560px\);/);
    assert.match(styles, /\.wallet-order-modal--shop-detail\s*\{[\s\S]*min-height:\s*min\(420px,\s*82vh\);/);
    assert.match(styles, /\.wallet-order-modal--shop-detail\s*\{[\s\S]*max-height:\s*min\(86vh,\s*620px\);/);
    assert.match(styles, /max-height:\s*min\(86vh,\s*780px\)/);
    assert.match(styles, /\.wallet-order-modal-body\s*\{[\s\S]*overflow-y:\s*auto;/);
    assert.match(styles, /--wallet-scrollbar-thumb:\s*var\(--auth-sheet-scrollbar-thumb/);
    assert.match(styles, /\.wallet-order-modal-body::-webkit-scrollbar-thumb/);
    assert.match(script, /buildWalletOrderLoadingMarkup\(t\('wallet\.loading', '加载详情\.\.\.'\), \{\s*modalClass: 'wallet-order-modal--shop-detail'\s*\}\)/);
});

test('wallet shop order detail uses dots loading and explicit product guidance controls', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');
    const shopHandler = fs.readFileSync(shopHandlerPath, 'utf8');

    assert.match(script, /buildWalletOrderLoadingMarkup\(message = '', options = \{\}\)/);
    assert.match(script, /wallet-order-loading-dots/);
    assert.match(script, /wallet-order-content-loading-inline/);
    assert.doesNotMatch(script, /wallet-order-content-loading-card/);
    assert.match(script, /replaceWalletOrderModalContent\(modal, markup = ''\)/);
    assert.match(script, /waitForWalletOrderTransition\(120\)/);
    assert.match(script, /aria-label="\$\{this\.escapeAttribute\(loadingLabel\)\}"/);
    assert.doesNotMatch(script, /fa-circle-notch fa-spin wallet-order-loading-icon/);
    assert.doesNotMatch(script, /wallet-order-loading-text/);
    assert.match(script, /detail\?\.guidance\?\.purchase_notes/);
    assert.match(script, /wallet-order-product-name/);
    assert.match(script, /openShopProductFromWalletDetail\(productId = '', detailOverlay = null\)/);
    assert.match(script, /js-wallet-open-shop-product/);
    assert.match(script, /\/shop\.html\?productId=\$\{encodeURIComponent\(normalizedProductId\)\}/);
    assert.match(script, /wallet-order-guidance-toggle js-wallet-toggle-guidance/);
    assert.match(script, /wallet-order-guidance-panel js-wallet-guidance-panel/);
    assert.doesNotMatch(script, /product-dot product-dot--info/);
    assert.match(styles, /\.wallet-order-detail-toolbar\s*\{[\s\S]*justify-content:\s*space-between;/);
    assert.match(styles, /\.wallet-modal-actions--toolbar\s*\{[\s\S]*margin-left:\s*auto;/);
    assert.match(styles, /animation:\s*walletOrderModalIn 0\.22s/);
    assert.match(styles, /@keyframes walletOrderModalIn/);
    assert.match(styles, /\.wallet-order-content-loading-inline\s*\{/);
    assert.doesNotMatch(styles, /\.wallet-order-content-loading-card\s*\{/);
    assert.match(styles, /\.wallet-order-modal--content-swapping > \*\s*\{/);
    assert.match(styles, /\.wallet-order-modal-body--entering\.is-visible\s*\{/);
    assert.match(styles, /@keyframes walletOrderContentIn/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(script, /wallet\.submitTicket'[\s\S]*提交工单/);
    assert.match(styles, /\.wallet-order-guidance-toggle\s*\{/);
    assert.match(styles, /\.wallet-order-guidance-panel\[hidden\]\s*\{[\s\S]*display:\s*none !important;/);
    assert.doesNotMatch(script, /fa-box-open[\s\S]{0,500}wallet-order-close-btn js-wallet-order-close[\s\S]{0,500}wallet-order-modal-body/);
    assert.match(shopHandler, /show_purchase_notes,\s*purchase_notes,\s*show_usage_instructions,\s*usage_instructions/);
    assert.match(shopHandler, /purchase_notes:\s*purchaseNotes \|\| null/);
    assert.match(shopHandler, /has_purchase_notes:\s*purchaseNotes\.length > 0/);
});

test('wallet prompt, redeem, and shop details expose clickable names with green status checks', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');
    const promptDetailSource = sliceSourceBetween(
        script,
        'showPromptOrderDetail(orderId, promptName, price, createdAt, promptId)',
        'showRedeemOrderDetail(orderId, amount, createdAt, redeemCode)'
    );
    const redeemDetailSource = sliceSourceBetween(
        script,
        'showRedeemOrderDetail(orderId, amount, createdAt, redeemCode)',
        'async showAffiliateRewardDetail(orderId, amount, createdAt, reason = \'\', referenceId = \'\')'
    );
    const shopDetailSource = sliceSourceBetween(
        script,
        'async showOrderDetail(orderId)',
        'openTicketModal(orderId)'
    );

    assert.match(promptDetailSource, /detail-val copyable wallet-detail-link wallet-order-product-name js-wallet-open-prompt-order/);
    assert.match(promptDetailSource, /openPromptFromWalletDetail\(promptId, detailOverlay\)/);
    assert.match(promptDetailSource, /wallet-status-check/);
    assert.doesNotMatch(promptDetailSource, /wallet\.viewPrompt|查看提示词|fa-eye/);
    assert.match(redeemDetailSource, /wallet-status-check/);
    assert.match(shopDetailSource, /detail-val mono copyable wallet-order-product-name wallet-detail-link js-wallet-open-shop-product/);
    assert.match(shopDetailSource, /this\.openShopProductFromWalletDetail\(/);
    assert.match(styles, /\.wallet-detail-link\s*\{/);
    assert.match(styles, /\.wallet-detail-link:hover,[\s\S]*color:\s*#FFD700 !important;/);
    assert.match(styles, /\.wallet-detail-link:active\s*\{[\s\S]*transform:\s*scale\(0\.98\);/);
});

test('wallet order filters label Google One records explicitly', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(script, /wallet-filter-value': 'verify', 'wallet-filter-label': 'Google One'/);
    assert.match(script, /fa-shield-alt', '#60a5fa'\)}Google One/);
    assert.match(script, /Google One 邮箱/);
    assert.match(styles, /#order-filter-popup\s*\{[^}]*min-width:\s*172px;/);
    assert.match(styles, /\.filter-chip\s*\{[^}]*white-space:\s*nowrap;/);
    assert.match(styles, /\.filter-option\s*\{[^}]*white-space:\s*nowrap;/);
    assert.match(
        script,
        /data-value="recharge"[\s\S]*data-value="shop"[\s\S]*data-value="prompt"[\s\S]*data-value="redeem"[\s\S]*data-value="verify"/
    );
    assert.doesNotMatch(script, /wallet-filter-label': window\.i18n\?\.t\('wallet\.verifyPurchase'\) \|\| '认证'/);
});

test('wallet recharge detail omits the top-right close button', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');
    const rechargeDetailSource = sliceSourceBetween(
        script,
        'showRechargeOrderDetail(orderId, amount, createdAt, reason = \'\', referenceId = \'\', balanceSnapshot = {})',
        'showVerifyOrderDetail(orderId, referenceId, pointsPaid, createdAt, reason = \'\')'
    );

    assert.match(rechargeDetailSource, /wallet\.rechargeDetails/);
    assert.match(rechargeDetailSource, /wallet-order-modal-title/);
    assert.doesNotMatch(rechargeDetailSource, /wallet-order-close-btn js-wallet-order-close/);
    assert.doesNotMatch(rechargeDetailSource, /wallet\.businessRef|业务关联|js-copy-ledger-ref|shortRefId/);
    assert.doesNotMatch(styles, /\.detail-val\.copyable::after/);
});

test('wallet ledger history and recharge details hide internal business reference ids', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.doesNotMatch(script, /<span>业务关联<\/span>/);
    assert.doesNotMatch(script, /js-copy-ledger-ref/);
    assert.doesNotMatch(script, /shortRefId/);
});

test('wallet product and order detail modals omit top-right close buttons consistently', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const detailSections = [
        ['prompt', 'showPromptOrderDetail(orderId, promptName, price, createdAt, promptId)', 'showRedeemOrderDetail(orderId, amount, createdAt, redeemCode)'],
        ['redeem', 'showRedeemOrderDetail(orderId, amount, createdAt, redeemCode)', 'async showAffiliateRewardDetail(orderId, amount, createdAt, reason = \'\', referenceId = \'\')'],
        ['affiliate', 'async showAffiliateRewardDetail(orderId, amount, createdAt, reason = \'\', referenceId = \'\')', 'showRechargeOrderDetail(orderId, amount, createdAt, reason = \'\', referenceId = \'\', balanceSnapshot = {})'],
        ['recharge', 'showRechargeOrderDetail(orderId, amount, createdAt, reason = \'\', referenceId = \'\', balanceSnapshot = {})', 'showVerifyOrderDetail(orderId, referenceId, pointsPaid, createdAt, reason = \'\')'],
        ['verify', 'showVerifyOrderDetail(orderId, referenceId, pointsPaid, createdAt, reason = \'\')', 'async showOrderDetail(orderId)'],
        ['shop', 'async showOrderDetail(orderId)', 'openTicketModal(orderId)']
    ];

    for (const [name, startMarker, endMarker] of detailSections) {
        const section = sliceSourceBetween(script, startMarker, endMarker);
        assert.doesNotMatch(section, /wallet-order-close-btn js-wallet-order-close/, `${name} detail should not render an X close button`);
    }
});

test('wallet order usage instructions render through local sanitizer instead of leaking raw rich text', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(script, /renderStoredWalletOrderRichText\(item\.content\)/);
    assert.match(script, /sanitizeWalletOrderRichTextHtml\(html\)/);
    assert.match(script, /looksLikeWalletOrderRichTextHtml\(content\)/);
    assert.match(script, /decodeWalletOrderHtmlEntities\(content\)/);
    assert.match(script, /lt\|gt\|quot\|amp\|#39\|apos/);
    assert.match(script, /linkifyWalletOrderRichText\(this\.escapeHtml\(normalized\)\)/);
    assert.doesNotMatch(script, /window\.ShopClient\.renderStoredRichText\(normalized\)/);
    assert.match(styles, /\.wallet-order-guidance-content\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
    assert.match(styles, /\.wallet-order-guidance-content\s*\{[\s\S]*word-break:\s*break-word;/);
});

test('wallet ledger details map check-in and rewards by reason instead of positive amount as recharge', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /getLedgerTransactionTypeLabel\(reason = '', amount = 0\)/);
    assert.match(script, /rawReason === 'daily_checkin'[\s\S]*每日签到/);
    assert.match(script, /rawReason === 'signup_bonus'[\s\S]*注册奖励/);
    assert.match(script, /rawReason === 'makeup_checkin_cost'[\s\S]*补签扣分/);
    assert.doesNotMatch(
        script,
        /const typeLabel = normalizedAmount >= 0\s*\?\s*\(window\.i18n\?\.t\('wallet\.rechargeType'\) \|\| '充值'\)/
    );
});

test('wallet recharge detail shows balance snapshots and hides internal type/name rows', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');
    const rechargeDetailSource = sliceSourceBetween(
        script,
        'showRechargeOrderDetail(orderId, amount, createdAt, reason = \'\', referenceId = \'\', balanceSnapshot = {})',
        'showVerifyOrderDetail(orderId, referenceId, pointsPaid, createdAt, reason = \'\')'
    );

    assert.match(script, /annotateLedgerEntriesWithBalanceSnapshots\(ledgerEntries = \[\]\)/);
    assert.match(script, /async ensureWalletBalanceForOrderSnapshots\(\)/);
    assert.match(script, /await this\.ensureWalletBalanceForOrderSnapshots\(\)/);
    assert.match(script, /resolveOrderBalanceSnapshot\(orderId = '', balanceSnapshot = \{\}\)/);
    assert.match(rechargeDetailSource, /const resolvedBalanceSnapshot = this\.resolveOrderBalanceSnapshot\(orderId, balanceSnapshot\)/);
    assert.match(script, /balanceBefore:\s*this\.normalizeOptionalPointValue\(entry\.balanceBefore \?\? existingSnapshot\.balanceBefore\)/);
    assert.match(script, /wallet-balance-before/);
    assert.match(script, /readOptionalPointDataset\(actionEl\.dataset\.walletBalanceBefore\)/);
    assert.match(rechargeDetailSource, /到账前积分/);
    assert.match(rechargeDetailSource, /到账后积分/);
    assert.match(rechargeDetailSource, /wallet-status-check/);
    assert.doesNotMatch(rechargeDetailSource, /wallet\.transactionType|交易类型/);
    assert.doesNotMatch(rechargeDetailSource, /wallet\.productName|商品名称/);
    assert.match(styles, /\.wallet-status-check\s*\{[\s\S]*color:\s*#22c55e;/);
});
