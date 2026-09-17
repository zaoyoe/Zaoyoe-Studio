# 即时发货功能部署指南

## 📋 概述

本次优化实现了**即时发货功能**（Immediate Fulfillment），将支付确认后的发货延迟从 **~10秒** 降低到 **1-3秒**。

## 🎯 优化目标

- **当前延迟**：~10秒（依赖定时 Worker 每5秒轮询）
- **优化后延迟**：1-3秒（支付确认后立即触发发货）
- **用户体验提升**：支付后几乎立即收到卡密，减少等待焦虑

## 📝 修改的文件

### 1. 核心 Worker 文件
- **`server/guest-shop-worker.js`**
  - 添加了详细的诊断日志
  - 实现了 `kick()` 函数的日志记录（包括文件日志备份）
  - 优化了发货流程的时序记录

### 2. 独立路由文件（关键）
这些文件需要传入 `kickFulfillment` 参数才能启用即时发货：

- **`api/shop/guest/status.js`** ✅ 已修改
  - 添加了 `immediateFulfillment` 初始化
  - 传入 `kickFulfillment: immediateFulfillment?.kick`

- **`api/shop/guest/webhooks/zpay.js`** ✅ 已修改
  - 添加了 `immediateFulfillment` 初始化
  - 传入 `kickFulfillment: immediateFulfillment?.kick`

- **`api/shop/guest/webhooks/nowpayments.js`** ✅ 已修改
  - 添加了 `immediateFullment` 初始化
  - 传入 `kickFulfillment: immediateFulfillment?.kick`

### 3. 共享路由文件（已存在）
- **`api/public.js`**
  - 已经正确实现了 `kickFulfillment` 支持
  - 用于 Express 服务器模式

## 🔧 环境变量配置

确保生产环境设置了以下环境变量：

```bash
# 启用即时发货
GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED=true

# 启用 Worker 系统
VERIFY_SERVER_WORKERS_ENABLED=true
```

## 🚀 部署步骤

### 1. 部署前检查

```bash
# 检查环境变量
echo $GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED  # 应该是 true
echo $VERIFY_SERVER_WORKERS_ENABLED              # 应该是 true

# 确认代码已提交
git status
```

### 2. 部署到生产环境

根据你的部署方式选择：

#### Vercel 部署
```bash
# 提交代码
git add .
git commit -m "feat: 实现即时发货优化，降低发货延迟到1-3秒"
git push origin main

# Vercel 会自动部署
```

#### 手动部署
```bash
# 上传代码到服务器
# 重启服务
pm2 restart all
# 或
npm run start
```

### 3. 部署后验证

#### 方法1：浏览器性能监控

在浏览器控制台运行以下代码，然后进行一次支付测试：

```javascript
(function() {
    const originalFetch = window.fetch;
    const timings = [];
    
    window.fetch = function(...args) {
        const url = args[0];
        if (url && url.includes('/api/shop/guest/status')) {
            const startTime = Date.now();
            console.log(`🔍 [${new Date().toISOString()}] 开始轮询订单状态`);
            
            return originalFetch.apply(this, args).then(response => {
                return response.clone().json().then(data => {
                    const endTime = Date.now();
                    const duration = endTime - startTime;
                    
                    if (data.order) {
                        const timing = {
                            time: new Date().toISOString(),
                            duration: duration,
                            payment_status: data.order.payment_status,
                            fulfillment_status: data.order.fulfillment_status,
                            paid_at: data.order.paid_at,
                            delivered_at: data.order.delivered_at
                        };
                        timings.push(timing);
                        
                        console.log(`✅ 订单状态: 支付=${data.order.payment_status}, 发货=${data.order.fulfillment_status}, 耗时=${duration}ms`);
                        
                        if (data.order.payment_status === 'confirmed' && data.order.fulfillment_status === 'delivered') {
                            const paidTime = new Date(data.order.paid_at).getTime();
                            const deliveredTime = new Date(data.order.delivered_at).getTime();
                            const totalDelay = deliveredTime - paidTime;
                            console.log(`🎉 发货完成！从支付到发货总延迟: ${totalDelay}ms`);
                            console.table(timings);
                        }
                    }
                    
                    return response;
                });
            });
        }
        return originalFetch.apply(this, args);
    };
    
    console.log('✅ 性能监控已启动，请进行支付测试');
})();
```

#### 方法2：查看服务器日志

```bash
# 查看 Worker 日志
tail -f /tmp/worker-kick.log

# 查看应用日志
pm2 logs
# 或
tail -f /var/log/app.log
```

查找以下关键日志：
- `[Immediate Kicker] ⚡ 即时发货被触发!`
- `[Worker Fulfillment] Order XXX:`
- `🎉 发货成功！总耗时: XXXms`

#### 方法3：数据库查询

```sql
-- 查询最近订单的发货延迟
SELECT 
    order_no,
    paid_at,
    delivered_at,
    EXTRACT(EPOCH FROM (delivered_at - paid_at)) as delay_seconds
FROM guest_shop_orders
WHERE payment_status = 'confirmed'
  AND fulfillment_status = 'delivered'
  AND paid_at > NOW() - INTERVAL '1 hour'
ORDER BY paid_at DESC
LIMIT 10;
```

**预期结果**：`delay_seconds` 应该在 **1-3秒** 范围内

## ✅ 验证标准

### 成功标准
- ✅ 支付确认后 1-3秒内完成发货
- ✅ 服务器日志显示 `[Immediate Kicker]` 相关日志
- ✅ 数据库记录显示 `paid_at` 和 `delivered_at` 时间差 < 5秒
- ✅ 用户体验：支付后几乎立即看到卡密

### 失败标准（需要排查）
- ❌ 发货延迟仍然是 10秒左右
- ❌ 服务器日志没有 `[Immediate Kicker]` 日志
- ❌ 日志显示 `即时发货未启用` 或 `immediate_fulfillment_disabled`

## 🐛 故障排查

### 问题1：日志显示"即时发货未启用"

**原因**：环境变量未设置或值不正确

**解决**：
```bash
# 检查环境变量
echo $GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED

# 应该输出：true
# 如果不是，请在 .env 或环境配置中设置
```

### 问题2：没有看到任何 Kicker 日志

**原因**：可能使用了缓存的旧代码

**解决**：
```bash
# 清除 Node.js 缓存
rm -rf node_modules/.cache

# 重启服务
pm2 restart all

# 或强制重新部署
vercel --force
```

### 问题3：发货延迟仍然是 10秒

**原因**：
1. 可能 webhook 没有正确触发 `kickFulfillment`
2. Kicker 初始化失败（数据库连接问题）

**排查**：
```bash
# 查看完整日志
tail -100 /var/log/app.log | grep -E "Kicker|Worker|Fulfillment"

# 检查数据库连接
psql -h <host> -U <user> -d <database> -c "SELECT 1"
```

## 📊 性能对比

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 平均发货延迟 | ~10秒 | 1-3秒 | **70-90%** |
| 支付确认到发货 | 依赖定时轮询（5秒间隔） | 即时触发 | **实时** |
| 用户等待体验 | 明显等待 | 几乎无感 | **显著提升** |

## 🔄 回滚方案

如果部署后发现问题，可以快速回滚：

```bash
# 方法1：禁用即时发货（不需要代码回滚）
export GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED=false
pm2 restart all

# 方法2：Git 回滚
git revert HEAD
git push origin main
```

## 📞 联系与支持

如果遇到问题，请检查：
1. 环境变量配置
2. 服务器日志（`/tmp/worker-kick.log` 和应用日志）
3. 数据库查询结果

---

**部署日期**：2026-09-17
**优化目标**：降低发货延迟 70-90%
**预期效果**：支付后 1-3秒内完成发货
