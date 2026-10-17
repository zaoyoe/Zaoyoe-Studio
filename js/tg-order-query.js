(function initTgOrderQuery(globalScope) {
    'use strict';
    const patterns = { purchase: /^TGP-[A-Z0-9]{20}$/, redeem: /^TG-[A-Z0-9]{12,24}$/ };
    const paymentLabels = { pending: '等待付款', paid: '已付款', expired: '已过期', cancelled: '已取消', closed: '已完结', failed: '支付未完成', manual_review: '待人工核对' };
    const deliveryLabels = { not_started: '等待付款', pending: '等待发货', processing: '正在处理', retry_waiting: '等待官方确认', succeeded: '发货完成', failed: '处理失败', manual_review: '正在人工复核', cancelled: '已取消', closed: '订单已完结' };
    const redemptionLabels = { pending: '等待处理', processing: '正在开通', retry_waiting: '等待官方确认', succeeded: '开通完成', failed: '处理失败', manual_review: '正在人工复核', cancelled: '已取消', closed: '已完结' };
    const prefixes = { purchase: 'tgPurchaseQuery', redeem: 'tgRedeemQuery' };
    const trim = value => String(value ?? '').trim();
    const networkNames = { usdtbsc: 'BSC (BEP20)', usdtton: 'TON', usdtmatic: 'Polygon', usdttrc20: 'TRON (TRC20)' };
    function element(tag, className, value) {
        const node = globalScope.document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value;
        return node;
    }
    const append = (parent, ...nodes) => { parent.replaceChildren(...nodes); return parent; };
    function createCard({ order, kind = 'purchase', onOpen, onError = () => {} }) {
        const purchase = kind === 'purchase';
        const date = new Date(order.created_at);
        const dateLabel = Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '本标签页保存的订单';
        const number = append(element('div', 'tg-orders-card-number'), element('strong', '', order.order_no), element('small', '', dateLabel));
        const statuses = element('div', 'tg-orders-card-status');
        const badge = (state, labels) => element('span', `tg-orders-badge is-${Object.hasOwn(labels, state) ? state : 'unknown'}`, labels[state] || '查看最新状态');
        if (purchase && order.payment_status) {
            statuses.append(badge(order.payment_status, paymentLabels), badge(order.fulfillment_status, deliveryLabels));
        } else statuses.append(badge(order.status, redemptionLabels));
        const head = append(element('div', 'tg-orders-card-head'), number, statuses);
        const product = order.product_family === 'telegram_stars' ? `Stars · ${Number(order.stars_quantity).toLocaleString('zh-CN')} 颗` : `Premium · ${order.term_months} 个月`;
        const cryptoSnapshot = order.crypto_checkout || order.crypto_payment;
        const network = order.crypto_network || networkNames[cryptoSnapshot?.pay_currency] || cryptoSnapshot?.network;
        const channel = ({ alipay: '支付宝', wxpay: '微信支付', usdt_bep20: 'USDT' })[order.payment_channel] || '—';
        const info = append(element('div'), element('h3', '', product), element('p', '', `接收账号：@${order.username}`), element('p', '', purchase ? `支付方式：${channel}${network ? ` · ${network}` : ''}` : '兑换码订单'));
        let amount = '兑换码订单';
        if (purchase) {
            // Native crypto amounts alone may be labelled as USDT.
            const cryptoAmount = globalScope.TgPaymentPricing?.displayCryptoAmount(cryptoSnapshot?.pay_amount);
            // A local saved card without a fetched status may still be missing its checkout summary.
            const canQueryCheckout = !order.payment_status || order.payment_status === 'pending' && order.fulfillment_status === 'not_started' && !order.closed_at;
            amount = order.payment_channel === 'usdt_bep20' ? cryptoAmount ? `${cryptoAmount} USDT`
                : canQueryCheckout ? 'USDT 金额见详情' : '未记录 USDT 金额'
                : Number.isSafeInteger(order.total_minor) ? `¥${(order.total_minor / 100).toFixed(2)}` : '金额见详情';
        }
        const closed = purchase ? order.fulfillment_status === 'closed' : order.status === 'closed';
        if (closed && order.completion_note) info.append(element('p', 'tg-orders-completion-note', `完结说明：${order.completion_note}`));
        const button = element('button', 'tg-button tg-button-secondary', '查看详情'); button.type = 'button';
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await onOpen(); } catch (error) { onError(error); } finally { button.disabled = false; }
        });
        const actions = append(element('div', 'tg-orders-card-bottom'), element('strong', 'tg-orders-card-amount', amount), button);
        return append(element('article', 'tg-panel tg-orders-order-card'), head, append(element('div', 'tg-orders-card-body'), info, actions));
    }
    function create({ request, onOpen, onClear = () => {} }) {
        const document = globalScope.document;
        const $ = id => document.getElementById(id);
        let enabled = false;
        let kind = 'purchase';
        let version = 0;
        let busy = false;
        let auth = null;
        let currentPage = 1;
        let total = 0;
        const fold = value => globalScope.GuestQueryPassword?.foldFullwidth(value) ?? String(value ?? '');
        const showError = message => { $('tgOrdersError').textContent = message; $('tgOrdersError').hidden = !message; };
        function credentials(email, password, creating = false, confirmation) {
            email = trim(email).toLowerCase(); password = fold(password);
            if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效的查询邮箱。');
            if (!password || password.length > 64 || /[\x00-\x1f\x7f]/.test(password)) throw new Error('请输入有效的查询密码。');
            if (creating) {
                if (!globalScope.GuestQueryPassword || globalScope.GuestQueryPassword.policyFailure(password)) throw new Error('查询密码至少 8 位，需包含大写字母、小写字母、数字和符号。建议点击“帮我生成”。');
                if (fold(confirmation) !== password) throw new Error('两次输入的查询密码不一致。');
            }
            return { email, password };
        }
        function readCreation(mode) {
            if (!enabled) return {};
            const prefix = prefixes[mode];
            try {
                const value = credentials($(prefix + 'Email').value, $(prefix + 'Password').value, true, $(prefix + 'PasswordConfirm').value);
                $(prefix + 'CredentialMessage').textContent = '';
                return { query_email: value.email, query_password: value.password };
            } catch (error) {
                $(prefix + 'CredentialMessage').textContent = error.message;
                const target = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim($(prefix + 'Email').value)) ? 'Email'
                    : fold($(prefix + 'Password').value) !== fold($(prefix + 'PasswordConfirm').value) ? 'PasswordConfirm' : 'Password';
                $(prefix + target).focus?.();
                throw error;
            }
        }
        function credentialHeader(value) {
            const bytes = new globalScope.TextEncoder().encode(`${value.email}\n${value.password}`);
            return globalScope.btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        function card(order, access, cardKind) {
            const cardVersion = version;
            return createCard({ order, kind: cardKind,
                async onOpen() {
                    if (cardVersion !== version || auth !== access) return;
                    await onOpen(order, credentialHeader(access), cardKind);
                },
                onError() { if (cardVersion === version) showError('订单详情暂时无法打开，请稍后重试。'); }
            });
        }
        function clearResults() {
            $('tgOrdersResults').hidden = true;
            $('tgOrdersList').replaceChildren();
            $('tgOrdersPager').hidden = true;
            total = 0; currentPage = 1;
        }
        function syncBusy(value) {
            busy = value;
            $('tgOrdersSubmit').disabled = busy || !enabled;
            $('tgOrdersQueryForm').setAttribute('aria-busy', String(busy));
            $('tgOrdersPrevious').disabled = busy || currentPage <= 1;
            $('tgOrdersNext').disabled = busy || currentPage * 20 >= total || currentPage >= 10000;
        }
        async function query(page = 1) {
            if (!enabled || busy) return;
            let value; let orderNo;
            try {
                value = credentials($('tgOrdersEmail').value, $('tgOrdersPassword').value);
                orderNo = trim($('tgOrdersOrderNo').value).toUpperCase();
                if (orderNo && !patterns[kind].test(orderNo)) throw new Error(kind === 'purchase' ? '请输入 TGP- 开头的购买订单号，或留空查询全部。' : '请输入 TG- 开头的兑换订单号，或留空查询全部。');
            } catch (error) { showError(error.message); return; }
            const requestVersion = ++version; const requestedKind = kind;
            auth = null; onClear(); clearResults(); showError(''); syncBusy(true);
            try {
                const { response, data } = await request('/api/tg/orders/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, kind: requestedKind, order_no: orderNo, page }) });
                if (requestVersion !== version) return;
                if (!response.ok || data.success !== true) throw new Error(trim(data.message) || '查询失败，请稍后重试。');
                if (data.kind !== requestedKind || data.page !== page || data.page_size !== 20 || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.orders) || data.orders.length > 20
                    || data.orders.some(order => !order || !patterns[requestedKind].test(order.order_no))) throw new Error('订单查询结果尚未确认，请重试。');
                auth = value; currentPage = page; total = data.total;
                $('tgOrdersList').replaceChildren(...data.orders.map(order => card(order, value, requestedKind)));
                $('tgOrdersResultTitle').textContent = requestedKind === 'purchase' ? '购买订单' : '兑换订单';
                $('tgOrdersResultCount').textContent = `共 ${data.total} 笔`;
                $('tgOrdersResults').hidden = false;
                $('tgOrdersEmpty').hidden = data.orders.length !== 0;
                $('tgOrdersPager').hidden = data.total <= 20;
                $('tgOrdersPageLabel').textContent = `第 ${page} / ${Math.max(1, Math.ceil(data.total / 20))} 页`;
            } catch (error) { if (requestVersion === version) { clearResults(); showError(error.message || '查询失败，请稍后重试。'); } }
            finally { if (requestVersion === version) syncBusy(false); }
        }
        function forget() {
            version++; auth = null; clearResults(); showError(''); syncBusy(false); onClear();
        }
        function clearQueryInputs() {
            for (const id of ['tgOrdersEmail', 'tgOrdersPassword', 'tgOrdersOrderNo']) $(id).value = '';
            $('tgOrdersPassword').type = 'password';
            $('tgOrdersTogglePassword').textContent = '显示';
            $('tgOrdersTogglePassword').setAttribute('aria-label', '显示查询密码');
            $('tgOrdersTogglePassword').setAttribute('aria-pressed', 'false');
        }
        // Browsers may restore form values after scripts initialize, including
        // back/forward cache restores. Query credentials belong to this visit.
        clearQueryInputs();
        globalScope.addEventListener('pageshow', clearQueryInputs);
        for (const prefix of ['tgOrders', ...Object.values(prefixes)]) {
            $(prefix + 'TogglePassword')?.addEventListener('click', () => {
                const input = $(prefix + 'Password'); const visible = input.type === 'password';
                input.type = visible ? 'text' : 'password';
                $(prefix + 'TogglePassword').textContent = visible ? '隐藏' : '显示';
                $(prefix + 'TogglePassword').setAttribute('aria-label', visible ? '隐藏查询密码' : '显示查询密码');
                $(prefix + 'TogglePassword').setAttribute('aria-pressed', String(visible));
            });
        }
        for (const prefix of Object.values(prefixes)) {
            $(prefix + 'GeneratePassword')?.addEventListener('click', () => {
                try {
                    const password = globalScope.GuestQueryPassword.generate();
                    $(prefix + 'Password').value = password; $(prefix + 'PasswordConfirm').value = password;
                    $(prefix + 'CredentialMessage').textContent = '已生成查询密码，请复制并妥善保存。';
                } catch (_) { $(prefix + 'CredentialMessage').textContent = '暂时无法生成，请手动设置查询密码。'; }
            });
            $(prefix + 'CopyPassword')?.addEventListener('click', async () => {
                try {
                    const password = $(prefix + 'Password').value; if (!password) throw new Error('empty');
                    await globalScope.navigator.clipboard.writeText(password);
                    $(prefix + 'CredentialMessage').textContent = '已复制查询密码，请保存到安全位置。';
                } catch (_) { $(prefix + 'CredentialMessage').textContent = '请填写查询密码，并手动保存。'; }
            });
        }
        $('tgOrdersQueryForm').addEventListener('submit', event => { event.preventDefault(); return query(1); });
        $('tgOrdersPrevious').addEventListener('click', () => query(currentPage - 1));
        $('tgOrdersNext').addEventListener('click', () => query(currentPage + 1));
        for (const id of ['tgOrdersEmail', 'tgOrdersPassword', 'tgOrdersOrderNo']) $(id).addEventListener('input', forget);
        $('tgOrdersClear').addEventListener('click', () => { clearQueryInputs(); forget(); });
        return {
            creationCredentials: readCreation,
            reset: forget,
            rememberCreation(value) {
                if (!enabled || !value?.query_email || !value.query_password) return;
                forget();
                $('tgOrdersEmail').value = value.query_email; $('tgOrdersPassword').value = value.query_password;
                $('tgOrdersOrderNo').value = '';
            },
            setReady(value) {
                enabled = value === true;
                for (const mode of ['purchase', 'redeem']) $(prefixes[mode] + 'Credentials').hidden = !enabled;
                $('tgOrdersAvailability').textContent = enabled ? '' : '邮箱查询暂不可用，请切换为订单号与原凭证查询。';
                syncBusy(busy);
            },
            setKind(value) {
                if (value === kind) return;
                kind = value === 'redeem' ? 'redeem' : 'purchase';
                const repeat = !!auth;
                $('tgOrdersOrderNo').value = ''; forget();
                if (repeat && enabled) return query(1);
            },
            dispose() {
                forget(); clearQueryInputs();
                for (const prefix of Object.values(prefixes)) {
                    $(prefix + 'Password').value = '';
                    if ($(prefix + 'PasswordConfirm')) $(prefix + 'PasswordConfirm').value = '';
                }
            }
        };
    }
    globalScope.TgOrderQuery = Object.freeze({ create, createCard });
})(window);
