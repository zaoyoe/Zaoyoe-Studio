## Worker 性能日志增强

为了诊断 12秒问题，建议临时添加以下日志：

### 1. 在 server/guest-shop-worker.js 的 processFulfillment 开头添加

```javascript
async function processFulfillment(order) {
    const startTime = Date.now();
    console.log(`[DEBUG] processFulfillment started for order ${order.order_no}`);
    
    if (['delivered', 'refunded', 'dead_letter'].includes(order.fulfillment_status)) {
        return { status: 'skipped', reason: 'fulfillment_terminal' };
    }
    if (order.payment_status !== 'confirmed') {
        return { status: 'skipped', reason: 'payment_not_confirmed' };
    }
    const { state } = getWorkerMetadata(order);

    const attempt = normalizeNonNegativeInteger(state.fulfillment_attempt_count, 0) + 1;
    const isFirstAttempt = attempt === 1;
    const paidAtMs = Date.parse(String(order.paid_at || '').trim());
    const isRecentlyConfirmed = Number.isFinite(paidAtMs) && (currentDate().getTime() - paidAtMs) < 10000;
    const shouldSkipBackoff = isFirstAttempt && isRecentlyConfirmed;

    console.log(`[DEBUG] attempt=${attempt}, paid_at=${order.paid_at}, isRecentlyConfirmed=${isRecentlyConfirmed}, shouldSkipBackoff=${shouldSkipBackoff}`);

    if (!shouldSkipBackoff) {
        if (state.fulfillment_terminal || (state.fulfillment_next_attempt_at && !isRetryDue({ next_attempt_at: state.fulfillment_next_attempt_at }, currentDate().getTime()))) {
            console.log(`[DEBUG] Skipped due to backoff, next_attempt_at=${state.fulfillment_next_attempt_at}`);
            return { status: 'skipped', reason: 'fulfillment_backoff' };
        }
    } else {
        console.log(`[DEBUG] ✅ Skipping backoff - immediate fulfillment!`);
    }
    
    // ... 继续原有代码
    
    // 在函数返回前添加
    console.log(`[DEBUG] processFulfillment completed in ${Date.now() - startTime}ms`);
}
```

### 2. 在 server/api-handlers/public/guest-shop.js 的 kickConfirmedOrder 添加

```javascript
function kickConfirmedOrder(orderId) {
    const id = String(orderId || '').trim();
    if (!id || !kickFulfillment) return;
    console.log(`[DEBUG] kickConfirmedOrder called for ${id}`);
    Promise.resolve()
        .then(() => {
            console.log(`[DEBUG] Calling kickFulfillment.kick()`);
            return kickFulfillment.kick(id);
        })
        .catch((error) => {
            console.error('[DEBUG] kickConfirmedOrder failed', error);
        });
}
```

### 3. 重启服务并查看日志

```bash
# 重启服务
pkill -f "node.*local-preview-server"
npm run preview:local

# 另一个终端实时查看日志
tail -f /tmp/server-detailed.log | grep -E "DEBUG|GuestShopWorker"
```

### 预期日志输出

```
[DEBUG] kickConfirmedOrder called for xxx
[DEBUG] Calling kickFulfillment.kick()
[DEBUG] processFulfillment started for order GS20260917-xxx
[DEBUG] attempt=1, paid_at=2026-09-17T..., isRecentlyConfirmed=true, shouldSkipBackoff=true
[DEBUG] ✅ Skipping backoff - immediate fulfillment!
[DEBUG] processFulfillment completed in 234ms
```

如果看不到这些日志，说明 Worker 未被立即触发。
