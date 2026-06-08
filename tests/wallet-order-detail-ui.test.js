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
    assert.match(script, /tone:\s*'notice'/);
    assert.match(script, /tone:\s*'usage'/);
    assert.match(script, /wallet-order-guidance-toggle--\$\{this\.escapeAttribute\(item\.tone \|\| item\.key\)\}/);
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
    assert.match(styles, /\.wallet-order-guidance-toggle--notice\s*\{[\s\S]*rgba\(255,\s*214,\s*102,\s*0\.12\)/);
    assert.match(styles, /\.wallet-order-guidance-toggle--usage\s*\{[\s\S]*rgba\(114,\s*229,\s*208,\s*0\.12\)/);
    assert.match(styles, /\.wallet-order-guidance-toggle--notice\[aria-expanded="true"\]\s*\{[\s\S]*inset 0 0 0 1px rgba\(255,\s*214,\s*102,\s*0\.16\)/);
    assert.match(styles, /\.wallet-order-guidance-toggle--usage\[aria-expanded="true"\]\s*\{[\s\S]*inset 0 0 0 1px rgba\(114,\s*229,\s*208,\s*0\.16\)/);
    assert.match(styles, /\.wallet-order-guidance-toggle--notice:active,[\s\S]*\.wallet-order-guidance-toggle--usage:active\s*\{[\s\S]*scale\(0\.98\)/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.wallet-order-guidance-toggle--notice\s*\{[\s\S]*rgba\(245,\s*158,\s*11,\s*0\.08\)/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.wallet-order-guidance-toggle--usage\s*\{[\s\S]*rgba\(16,\s*185,\s*129,\s*0\.08\)/);
    assert.match(styles, /\.wallet-order-action-btn:hover,[\s\S]*\.wallet-order-action-btn:focus-visible\s*\{[\s\S]*transform:\s*translateY\(-1px\);/);
    assert.match(styles, /\.wallet-order-action-btn-copy:hover,[\s\S]*\.wallet-order-action-btn-copy:focus-visible\s*\{[\s\S]*rgba\(148,\s*163,\s*184,\s*0\.1\)/);
    assert.match(styles, /\.wallet-order-action-btn-danger:hover,[\s\S]*\.wallet-order-action-btn-danger:focus-visible\s*\{[\s\S]*rgba\(239,\s*68,\s*68,\s*0\.12\)/);
    assert.match(styles, /\.wallet-order-guidance-panel\[hidden\]\s*\{[\s\S]*display:\s*none !important;/);
    assert.doesNotMatch(script, /fa-box-open[\s\S]{0,500}wallet-order-close-btn js-wallet-order-close[\s\S]{0,500}wallet-order-modal-body/);
    assert.match(shopHandler, /purchase_notes_zh',\s*'purchase_notes_en/);
    assert.match(shopHandler, /usage_instructions_zh',\s*'usage_instructions_en/);
    assert.match(shopHandler, /purchase_notes:\s*purchaseNotes \|\| null/);
    assert.match(shopHandler, /has_purchase_notes:\s*purchaseNotes\.length > 0/);
});

test('wallet shop order content cards wrap long card secrets inside adaptive boxes', () => {
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(styles, /\.wallet-content-grid\s*\{[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;/);
    assert.match(styles, /\.wallet-content-grid--stacked\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.wallet-copy-card--compact,[\s\S]*\.wallet-copy-card--link\s*\{[\s\S]*height:\s*auto;/);
    assert.match(styles, /\.wallet-copy-card--compact,[\s\S]*\.wallet-copy-card--link\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
    assert.match(styles, /\.wallet-copy-card--compact\s*\{[\s\S]*width:\s*100%;/);
    assert.match(styles, /\.wallet-copy-card--compact:hover\s*\{[\s\S]*transform:\s*translateY\(-1px\);/);
    assert.match(styles, /\.wallet-copy-card--compact:hover\s*\{[\s\S]*border-color:\s*rgba\(148,\s*163,\s*184,\s*0\.26\);/);
    assert.match(styles, /\.wallet-copy-card--compact:active\s*\{[\s\S]*transform:\s*translateY\(0\);/);
    assert.match(styles, /\.item-content-box--plain\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
    assert.match(styles, /\.wallet-order-modal-body \.content-section\s*\{[\s\S]*margin-right:\s*0;[\s\S]*margin-left:\s*0;[\s\S]*padding:\s*16px 0 0;[\s\S]*width:\s*100%;/);
    assert.match(styles, /\.wallet-content-grid--stacked \.wallet-copy-card--compact\s*\{[\s\S]*width:\s*min\(100%,\s*420px\);[\s\S]*min-width:\s*min\(100%,\s*340px\);/);
    assert.match(styles, /\.wallet-copy-card--compact \.item-text,[\s\S]*\.wallet-copy-card--link \.item-text\s*\{[\s\S]*white-space:\s*pre-wrap;/);
    assert.match(styles, /\.wallet-copy-card--compact \.item-text,[\s\S]*\.wallet-copy-card--link \.item-text\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.wallet-content-grid--stacked \.wallet-copy-card--compact\s*\{[\s\S]*justify-self:\s*stretch;[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
});

test('wallet order detail copying uses mobile-safe fallback path', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /async writeTextWithLegacyClipboard\(text\)/);
    assert.match(script, /document\.execCommand\('copy'\)/);
    assert.match(script, /async writeTextToClipboard\(text\)/);
    assert.match(script, /window\.isSecureContext/);
    assert.match(script, /navigator\.clipboard\?\.writeText/);
    assert.match(script, /Clipboard API failed, trying legacy copy/);
    assert.match(script, /async copyToClipboard\(text, event, options = \{\}\)/);
    assert.match(script, /const copyAllOrderContent = \(\) => \{\s*this\.copyToClipboard\(allContent, null, \{/);
    assert.match(script, /copyOrderContent\(element\)[\s\S]*this\.copyToClipboard\(content, null, \{/);
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
    const sanitizerSource = sliceSourceBetween(
        script,
        'sanitizeWalletOrderRichTextHtml(html)',
        'renderStoredWalletOrderRichText(content)'
    );

    assert.match(script, /renderStoredWalletOrderRichText\(item\.content\)/);
    assert.match(script, /sanitizeWalletOrderRichTextHtml\(html\)/);
    assert.match(script, /looksLikeWalletOrderRichTextHtml\(content\)/);
    assert.match(script, /decodeWalletOrderHtmlEntities\(content\)/);
    assert.match(script, /lt\|gt\|quot\|amp\|#39\|apos/);
    assert.match(script, /linkifyWalletOrderRichText\(this\.escapeHtml\(normalized\)\)/);
    assert.doesNotMatch(script, /window\.ShopClient\.renderStoredRichText\(normalized\)/);
    assert.doesNotMatch(sanitizerSource, /allowedColor/);
    assert.doesNotMatch(sanitizerSource, /prop === 'color'/);
    assert.doesNotMatch(sanitizerSource, /setAttribute\('color'/);
    assert.match(styles, /\.wallet-order-guidance-content\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
    assert.match(styles, /\.wallet-order-guidance-content\s*\{[\s\S]*word-break:\s*break-word;/);
    assert.match(styles, /20260428_WALLET_ORDER_GUIDANCE_LIGHT_TEXT_1/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.wallet-order-guidance-content,\s+html:not\(\[data-theme="dark"\]\) \.wallet-order-guidance-content :not\(a\)[\s\S]*-webkit-text-fill-color:\s*rgba\(23, 32, 51, 0\.74\) !important;/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.wallet-order-guidance-content a,\s+html:not\(\[data-theme="dark"\]\) \.wallet-order-guidance-content a \*[\s\S]*-webkit-text-fill-color:\s*#31506f !important;/);
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

test('wallet ledger list labels redemption revocations separately from redemption credits', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');
    const reversalIndex = script.indexOf('this.isRedemptionReversalReason(entry.reason, entry.reference_id, entryAmount)');
    const redeemIndex = script.indexOf("entry.reason === 'redeem_code' || (entry.reason && entry.reason.includes('兑换码'))");

    assert.notEqual(reversalIndex, -1, 'wallet should detect redemption revocation ledger rows');
    assert.notEqual(redeemIndex, -1, 'wallet should still detect redemption credit ledger rows');
    assert.equal(reversalIndex < redeemIndex, true, 'redemption revocation rows must be classified before generic redemption rows');
    assert.match(script, /transactionType = 'redemption_reversal'/);
    assert.match(script, /order\.transactionType === 'redeem' \|\| order\.transactionType === 'redemption_reversal'/);
    assert.match(script, /getRedemptionReversalDisplayName\(reason = '', referenceId = ''\)/);
    assert.match(script, /getRedemptionReversalMeta\(reason = '', referenceId = ''\)/);
    assert.match(script, /renderRedemptionReversalName\(order\.rawReason, order\.referenceId\)/);
    assert.match(script, /buildRedemptionReversalDetailMarkup\(reason, referenceId\)/);
    assert.match(script, /wallet\.redeemCodeRevocation/);
    assert.match(script, /wallet\.redeemCodeBatchRevocation/);
    assert.match(script, /wallet\.pointsDeducted/);
    assert.match(styles, /\.order-item--redemption-reversal\s*\{/);
    assert.match(styles, /\.wallet-redemption-reversal-reason\s*\{/);
    assert.match(styles, /\.wallet-redemption-reversal-detail\s*\{/);
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
