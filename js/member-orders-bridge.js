'use strict';

/**
 * Account Orders Bridge (§11.4)
 * Connects authenticated member sessions to the unified orders query page.
 * Reuses the storefront order styling and custom filter system without
 * violating guest isolation contracts.
 */
(() => {
    function normalizeText(value, maxLength = 500) {
        return String(value ?? '').trim().slice(0, maxLength);
    }

    function currentSite() {
        const site = normalizeText(window.SiteConfig?.site, 10).toLowerCase();
        return site === 'intl' ? 'intl' : 'cn';
    }

    function getStoredSession() {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const data = JSON.parse(raw);
                    const token = data?.access_token || data?.currentSession?.access_token;
                    if (!token) continue;

                    const part = String(token).split('.')[1];
                    if (!part) continue;
                    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
                    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
                    const payload = JSON.parse(atob(padded));

                    const now = Math.floor(Date.now() / 1000);
                    if (payload && (!payload.exp || payload.exp > now + 10)) {
                        return {
                            token,
                            userId: payload.sub || payload.user_id || payload.id,
                            email: payload.email || ''
                        };
                    }
                }
            }
        } catch (_) {}
        return null;
    }

    function isUserLoggedIn() {
        return Boolean(getStoredSession());
    }

    function adaptMemberOrder(order) {
        const isDelivered = order.delivery_status === 'delivered';
        const isFulfilling = order.delivery_status === 'fulfilling';
        const isRefunded = order.refund_status === 'refunded' || order.status === 'refunded';

        let paymentStatus = 'confirmed';
        if (isRefunded) {
            paymentStatus = 'refunded';
        } else if (order.status === 'created' || order.status === 'pending') {
            paymentStatus = 'pending';
        }

        let fulfillmentStatus = order.delivery_status || (isDelivered ? 'delivered' : (isFulfilling ? 'fulfilling' : 'pending'));
        if (isRefunded) fulfillmentStatus = 'refunded';

        const rawPricePaid = Number(order.price_paid);
        const rawTotalPrice = Number(order.total_price);
        const amount = Number.isFinite(rawPricePaid) ? rawPricePaid : (Number.isFinite(rawTotalPrice) ? rawTotalPrice : 0);
        const totalAmount = Number.isFinite(rawTotalPrice) ? rawTotalPrice : amount;
        const discountAmount = Math.max(0, Number(order.discount_amount || 0) || (totalAmount - amount));

        const orderItems = Array.isArray(order.shop_order_items) ? order.shop_order_items : [];
        const productName = order.snapshot_product_name || orderItems[0]?.snapshot_product_name || '商城商品';
        const itemCount = Number(order.item_count) || Math.max(1, orderItems.length);

        return {
            order_no: String(order.id || '').trim(),
            payment: {
                method: 'points',
                label: '积分支付',
                icon: 'fa-solid fa-coins',
                key: 'points'
            },
            payment_status: paymentStatus,
            fulfillment_status: fulfillmentStatus,
            amount,
            total_amount: totalAmount,
            discount_amount: discountAmount,
            discount_snapshot: order.discount_snapshot || null,
            created_at: order.created_at,
            product_id: order.product_id || '',
            snapshot_product_name: productName,
            item_count: itemCount,
            fulfillment_source: order.fulfillment_source || 'inventory',
            customer_resolution: order.supplier_customer_resolution || null,
            is_member_order: true,
            raw_order: order
        };
    }

    async function loadAccountOrders() {
        const session = getStoredSession();
        if (!session) return null;

        const site = currentSite();
        const url = `/api/wallet/transactions?site=${encodeURIComponent(site)}&limit=100`;

        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${session.token}`
            }
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody?.message || `加载订单失败 (${res.status})`);
        }

        const data = await res.json();
        const rawShopOrders = Array.isArray(data?.shop_orders) ? data.shop_orders : [];
        return rawShopOrders.map(adaptMemberOrder);
    }

    async function loadOrderDetail(orderNo) {
        const session = getStoredSession();
        if (!session) {
            throw new Error('请先登录后查看订单详情');
        }

        const site = currentSite();
        const res = await fetch('/api/wallet/order-detail', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${session.token}`
            },
            body: JSON.stringify({
                orderId: orderNo,
                site
            })
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody?.message || '获取订单详情失败');
        }

        const data = await res.json();
        if (!data.success || !data.data) {
            throw new Error(data?.message || '订单详情不存在');
        }

        const detail = data.data;
        const order = detail.order || {};
        const items = Array.isArray(detail.items) ? detail.items : [];
        const adapted = adaptMemberOrder(order);

        const hasDeliveredContent = items.some((item) => String(item.content || '').trim().length > 0);
        if (!hasDeliveredContent && adapted.fulfillment_status === 'delivered' && adapted.fulfillment_source !== 'manual') {
            adapted.fulfillment_status = 'pending';
        }

        adapted.items = items.map((item) => ({
            product_id: item.shop_product?.id || order.product_id,
            product_name: item.name || adapted.snapshot_product_name,
            quantity: 1,
            content: item.content || '',
            purchase_notes: detail.purchaseNotes || '',
            usage_instructions: detail.usageInstructions || ''
        }));
        adapted.purchase_notes = detail.purchaseNotes || '';
        adapted.usage_instructions = detail.usageInstructions || '';

        const deliveryPayload = {
            items: adapted.items,
            created_at: order.created_at || adapted.created_at
        };

        if (window.GuestOrdersClient?.showMemberOrderDetail) {
            window.GuestOrdersClient.showMemberOrderDetail({
                order: adapted,
                delivery: hasDeliveredContent ? deliveryPayload : null
            });
        }

        void fetchTicketForOrder(orderNo).then((existingTicket) => {
            if (existingTicket && window.GuestOrdersClient?.showTicketStatus) {
                window.GuestOrdersClient.showTicketStatus(existingTicket);
            }
        });

        return { order: adapted, delivery: deliveryPayload };
    }

    async function createTicket({ orderId = '', issueType = 'INVALID_KEY', email = '', description = '', title = '' } = {}) {
        const session = getStoredSession();
        if (!session) {
            throw new Error('请先登录后提交工单');
        }

        const res = await fetch('/api/support', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${session.token}`
            },
            body: JSON.stringify({
                action: 'create_ticket',
                input: {
                    order_id: orderId,
                    contact_email: email || session.email || '',
                    email: email || session.email || '',
                    issue_type: issueType,
                    description: description,
                    reason: description,
                    content: description,
                    title: title || `[售后工单] 订单 ${orderId}`
                },
                order_id: orderId,
                contact_email: email || session.email || '',
                email: email || session.email || '',
                issue_type: issueType,
                description: description,
                reason: description,
                content: description,
                title: title || `[售后工单] 订单 ${orderId}`
            })
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody?.message || `提交工单失败 (${res.status})`);
        }

        return await res.json();
    }

    async function fetchTicketForOrder(orderId) {
        const session = getStoredSession();
        if (!session || !orderId) return null;

        try {
            const res = await fetch('/api/support', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${session.token}`
                },
                body: JSON.stringify({
                    action: 'ticket_history'
                })
            });

            if (!res.ok) return null;
            const data = await res.json();
            const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
            const targetId = String(orderId).trim();
            const matched = tickets.find((t) => {
                if (String(t.order_id || '').trim() === targetId) return true;
                if (t.description && t.description.includes(targetId)) return true;
                if (t.title && t.title.includes(targetId)) return true;
                return false;
            });
            return matched || null;
        } catch (_) {
            return null;
        }
    }

    function applyLoggedInHeaderTransform() {
        const heading = document.querySelector('.guest-orders-heading h1');
        if (heading) {
            heading.textContent = '订单查询';
        }
        const subtitle = document.querySelector('.guest-orders-heading p');
        if (subtitle) {
            subtitle.textContent = '查看你的商城订单与交付卡密';
        }
        document.title = '订单查询 - Zaoyoe';

        const queryCard = document.getElementById('guestOrdersQueryCard');
        if (queryCard) {
            queryCard.hidden = true;
        }

        const protectedContent = document.getElementById('guestOrdersProtectedContent');
        if (protectedContent) {
            protectedContent.hidden = false;
            protectedContent.setAttribute('aria-hidden', 'false');
        }

        const initialSkeleton = document.getElementById('guestOrdersInitialSkeleton');
        if (initialSkeleton) {
            initialSkeleton.hidden = true;
            initialSkeleton.setAttribute('aria-hidden', 'true');
        }

        const gate = document.getElementById('guestOrdersFeatureGate');
        if (gate) {
            gate.hidden = true;
        }
    }

    async function initMemberOrders() {
        const session = getStoredSession();
        if (!session) return;

        applyLoggedInHeaderTransform();

        const resultCard = document.getElementById('guestOrdersResultCard');
        const list = document.getElementById('guestOrdersList');
        if (resultCard) resultCard.hidden = false;
        if (list) {
            if (typeof window.GuestOrdersClient?.renderOrdersSkeleton === 'function') {
                window.GuestOrdersClient.renderOrdersSkeleton(list, 3);
            } else {
                list.textContent = '';
                const loadingNode = document.createElement('div');
                loadingNode.className = 'guest-orders-loading';
                loadingNode.style.display = 'block';
                const icon = document.createElement('i');
                icon.className = 'fas fa-circle-notch fa-spin';
                icon.setAttribute('aria-hidden', 'true');
                loadingNode.appendChild(icon);
                loadingNode.appendChild(document.createTextNode(' 正在加载商城订单...'));
                list.appendChild(loadingNode);
            }
        }

        try {
            const memberOrders = await loadAccountOrders();
            if (window.GuestOrdersClient?.setMemberOrders) {
                window.GuestOrdersClient.setMemberOrders(memberOrders || []);
            }
        } catch (err) {
            console.error('[AccountOrdersBridge] Failed to load orders:', err);
            if (list) {
                list.innerHTML = '';
                const errNode = document.createElement('div');
                errNode.className = 'shop-alert shop-alert--error';
                errNode.style.display = 'block';
                errNode.textContent = '加载订单失败：' + (err.message || '请稍后重试');
                list.appendChild(errNode);
            }
        }
    }

    window.ZaoyoeAccountOrdersBridge = Object.freeze({
        isLoggedIn: isUserLoggedIn,
        getStoredSession,
        loadAccountOrders,
        loadOrderDetail,
        createTicket,
        fetchTicketForOrder,
        refresh: initMemberOrders
    });

    window.addEventListener('storage', (event) => {
        if (!event || !event.key) return;
        if (event.key === 'cached_user_profile' || (event.key.startsWith('sb-') && event.key.endsWith('-auth-token'))) {
            void initMemberOrders();
        }
    });

    window.addEventListener('zaoyoe:auth-state-change', () => {
        void initMemberOrders();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { void initMemberOrders(); }, { once: true });
    } else {
        void initMemberOrders();
    }
})();
