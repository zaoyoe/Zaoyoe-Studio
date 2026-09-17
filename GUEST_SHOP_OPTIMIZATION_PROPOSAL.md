# 游客购买发货速度优化方案

## 问题分析

当前支付成功后等待发货时间过长，主要原因：
1. 前端轮询间隔 3.5秒（未确认）→ 1秒（已确认）
2. 后端主动查询节流 8秒
3. Worker 基础回退 15秒
4. 多层延迟叠加导致最坏情况 20-40秒

## 智能优化方案

### 方案 A: 前端自适应轮询（推荐）

#### 1. 动态轮询间隔
```javascript
// 根据订单状态和查询历史智能调整
const POLL_INTERVALS = {
    AWAITING_PAYMENT: 3500,           // 等待支付：3.5秒
    PAYMENT_CONFIRMED_PENDING: 800,    // 支付确认，等待发货：0.8秒（激进）
    PAYMENT_CONFIRMED_FULFILLING: 600, // 正在发货：0.6秒（更激进）
    PROVIDER_QUERY_THROTTLED: 5000,   // 后端节流中：5秒（避免无效请求）
    MANUAL_CHECK: 500,                // 用户手动查询：0.5秒
    ERROR_RETRY: 2000                 // 出错重试：2秒
};
```

#### 2. 前端增加查询历史追踪
```javascript
const pollState = {
    lastQueryVerifiedAt: null,  // 后端上次查询提供商的时间
    consecutiveThrottled: 0,    // 连续被节流次数
    paymentConfirmedAt: null,   // 支付确认时间
};

// 从响应中提取节流信息
function updatePollState(payload) {
    const metadata = payload?.payment?.provider_metadata;
    if (metadata?.query_verified_at) {
        pollState.lastQueryVerifiedAt = new Date(metadata.query_verified_at);
    }
    if (payload?.order?.payment_status === 'confirmed' && !pollState.paymentConfirmedAt) {
        pollState.paymentConfirmedAt = Date.now();
    }
}

// 智能计算下次轮询间隔
function getNextPollInterval(status, metadata) {
    const paymentStatus = status.paymentStatus;
    const fulfillmentStatus = status.fulfillmentStatus;
    
    // 支付确认后，根据时长动态调整
    if (paymentStatus === 'confirmed') {
        const timeSinceConfirmed = Date.now() - (pollState.paymentConfirmedAt || Date.now());
        
        if (fulfillmentStatus === 'fulfilling') {
            return POLL_INTERVALS.PAYMENT_CONFIRMED_FULFILLING; // 0.6秒
        }
        
        // 前3秒：0.8秒一次（激进）
        if (timeSinceConfirmed < 3000) {
            return POLL_INTERVALS.PAYMENT_CONFIRMED_PENDING;
        }
        
        // 3-10秒：1.2秒一次
        if (timeSinceConfirmed < 10000) {
            return 1200;
        }
        
        // 10秒后：2秒一次（可能遇到问题）
        return 2000;
    }
    
    // 检查后端节流状态
    if (pollState.lastQueryVerifiedAt) {
        const timeSinceQuery = Date.now() - pollState.lastQueryVerifiedAt.getTime();
        // 后端8秒内查过，等5秒再问
        if (timeSinceQuery < 8000) {
            return POLL_INTERVALS.PROVIDER_QUERY_THROTTLED;
        }
    }
    
    return POLL_INTERVALS.AWAITING_PAYMENT;
}
```

### 方案 B: 后端分阶段节流

#### 1. 根据支付状态动态调整节流
```javascript
// server/api-handlers/public/guest-shop.js

// 分阶段节流窗口
const GUEST_STATUS_QUERY_THROTTLE_MS = 8 * 1000;              // 未支付：8秒
const GUEST_STATUS_QUERY_CONFIRMED_THROTTLE_MS = 3 * 1000;    // 支付确认后：3秒
const GUEST_STATUS_QUERY_FORCE_THROTTLE_MS = 1200;            // 用户强制：1.2秒

async function attemptGuestPaymentStatusQuery({ 
    order, 
    payment, 
    forceProviderRefresh = false 
} = {}) {
    // ... 现有代码 ...
    
    const metadata = storedPlainObject(payment.provider_metadata);
    const lastQueryMs = Date.parse(String(metadata.query_verified_at || ''));
    
    // ✨ 新增：支付确认后使用更短的节流窗口
    const isPaymentConfirmed = String(order?.payment_status || '').toLowerCase() === 'confirmed';
    let throttleMs;
    
    if (forceProviderRefresh === true) {
        throttleMs = GUEST_STATUS_QUERY_FORCE_THROTTLE_MS;  // 1.2秒
    } else if (isPaymentConfirmed) {
        throttleMs = GUEST_STATUS_QUERY_CONFIRMED_THROTTLE_MS;  // 3秒
    } else {
        throttleMs = GUEST_STATUS_QUERY_THROTTLE_MS;  // 8秒
    }
    
    if (Number.isFinite(lastQueryMs) && (Date.now() - lastQueryMs) < throttleMs) {
        return { refreshed: false, reason: 'query_throttled', nextAllowedMs: lastQueryMs + throttleMs };
    }
    
    // ... 继续现有逻辑 ...
}
```

#### 2. 返回节流信息给前端
```javascript
// 在 status 响应中包含节流状态
return sendJson(res, 200, {
    success: true,
    order: publicOrderSnapshot(order),
    ...(checkout ? { checkout } : {}),
    // ✨ 新增：提供节流提示
    throttle_hint: {
        query_verified_at: payment?.provider_metadata?.query_verified_at,
        next_query_allowed_ms: nextQueryAllowedMs  // 下次允许查询的时间戳
    }
});
```

### 方案 C: Worker 即时触发优化

#### 1. 添加高优先级队列
```javascript
// server/guest-shop-worker.js

async function loadCandidates(limit) {
    const now = Date.now();
    const RECENT_CONFIRMATION_MS = 10 * 1000;  // 10秒内确认的订单
    
    // 分两批加载：最近确认的 + 常规候选
    const [recentRows, regularRows] = await Promise.all([
        fetchCandidateRows(limit, [
            { type: 'eq', field: 'payment_status', value: 'confirmed' },
            { type: 'in', field: 'fulfillment_status', value: ['pending', 'fulfilling'] }
        ]),
        fetchCandidateRows(limit, [
            { type: 'eq', field: 'payment_status', value: 'confirmed' },
            { type: 'in', field: 'fulfillment_status', value: ['failed', 'paid_unfulfillable'] }
        ])
    ]);
    
    // ✨ 优先处理刚确认的订单
    const prioritized = recentRows
        .map(row => ({
            ...row,
            priority: Math.max(0, RECENT_CONFIRMATION_MS - (now - Date.parse(row.paid_at || row.updated_at)))
        }))
        .sort((a, b) => b.priority - a.priority);
    
    return [...prioritized, ...regularRows].slice(0, limit);
}
```

#### 2. 减少首次发货延迟
```javascript
// 针对刚确认的订单，跳过第一次回退
async function fulfillOrder(order) {
    const metadata = order.metadata || {};
    const isRecentlyConfirmed = Date.parse(order.paid_at) > (Date.now() - 5000);
    
    if (isRecentlyConfirmed && !metadata.fulfillment_attempt_count) {
        // ✨ 首次尝试，立即执行，无回退
        return await attemptFulfillment(order, { skipBackoff: true });
    }
    
    // 常规重试逻辑
    const backoffMs = calculateBackoff(metadata.fulfillment_attempt_count);
    // ...
}
```

### 方案 D: 前端预加载优化

#### 1. 支付跳转前开始轮询
```javascript
async function createOrder() {
    // ... 创建订单 ...
    
    if (payload.checkout) {
        renderCheckout(payload.checkout);
        
        // ✨ 在用户跳转支付前就开始轮询（频率较低）
        startPolling({ 
            initialInterval: 5000,  // 前几次5秒轮询
            rampUp: true            // 逐步加快
        });
    }
}
```

#### 2. 支付页返回时立即查询
```javascript
async function maybeRestoreReturn() {
    const returnOrderNo = readReturnOrderNo();
    
    if (returnOrderNo) {
        hydrateReturnOrderNo(returnOrderNo);
        clearQueryReturnMarker();
        
        // ✨ 从支付页返回，立即强制查询（绕过节流）
        openGuestModal(null);
        await pollStatus({ 
            immediate: true, 
            forceProviderRefresh: true  // 强制刷新
        });
    }
}
```

## 效果预期

### 优化前时间线（最坏情况）
```
T=0s    支付成功
T=3.5s  前端第一次轮询，后端节流中
T=7s    前端第二次轮询，后端节流中
T=10.5s 前端第三次轮询，后端终于查询提供商
T=11s   支付确认，切换1秒轮询
T=12s   触发 Worker
T=27s   Worker 完成发货（15秒基础回退）
总计：27秒
```

### 优化后时间线（最佳情况）
```
T=0s    支付成功
T=0.8s  前端第一次轮询（支付确认后间隔）
T=1s    后端查询提供商（3秒节流）
T=1.2s  支付确认
T=1.3s  触发 Worker（高优先级）
T=2s    Worker 立即发货（跳过首次回退）
总计：2秒
```

### 优化后时间线（典型情况）
```
T=0s    支付成功
T=0.8s  前端第一次轮询，后端节流中
T=1.6s  前端第二次轮询
T=2.4s  前端第三次轮询
T=3.2s  后端查询提供商（3秒节流）
T=3.3s  支付确认，触发 Worker
T=4s    Worker 发货
总计：4-5秒
```

## 实施优先级

### Phase 1: 低风险优化（立即实施）
- [ ] 前端动态轮询间隔
- [ ] 后端返回节流提示
- [ ] 支付返回时强制查询

### Phase 2: 中等风险（测试后实施）
- [ ] 后端分阶段节流（8秒→3秒）
- [ ] Worker 高优先级队列

### Phase 3: 高影响优化（充分测试）
- [ ] Worker 跳过首次回退
- [ ] 预加载轮询

## 安全保障

1. **节流保护**：即使前端轮询更快，后端仍有节流保护
2. **幂等性**：所有操作保持幂等，不会重复发货
3. **降级策略**：优化失败时回退到原有逻辑
4. **监控告警**：添加发货时长监控

## 测试计划

1. **单元测试**：验证轮询间隔计算逻辑
2. **集成测试**：模拟 webhook 丢失场景
3. **压力测试**：确保高并发下节流正常
4. **端到端测试**：完整支付流程计时

## 回滚方案

所有优化都通过环境变量/feature flag控制，可以随时回滚：
```javascript
const ENABLE_SMART_POLLING = process.env.GUEST_SHOP_SMART_POLLING !== 'false';
const ENABLE_FAST_FULFILLMENT = process.env.GUEST_SHOP_FAST_FULFILL !== 'false';
```
