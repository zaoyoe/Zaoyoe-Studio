# Admin Studio 商城 Phase B 测试清单

这份清单用于统一执行 `Phase B` 联调、回归和 bug 回收。

适用范围：

- `SC-B1` 商品发布检查器
- `SC-B2` 告警参数配置化二期
- `SC-B3` 分类与批量写操作事务化
- `SC-B4` 后台检索与运营筛选增强

建议按“先执行 SQL -> 再跑自动化 -> 再跑真人运营链路 -> 最后集中修 bug”的顺序推进。

## 1. 执行前准备

1. 先执行 SQL migration：
   - [supabase/migrations/20260409_phase_b_shop_guardrails.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_phase_b_shop_guardrails.sql)
2. 准备 1 个管理员账号：
   - 可以访问 `/admin-studio.html`
   - 可以进入 `商城系统`
   - 可以进入 `运营保障 / Ops Alerts`
3. 准备至少 6 类测试样本：
   - `KEY 商品` 已上架但无可售库存 1 个
   - `API 商品` 缺失或故意填错 `Webhook URL` 1 个
   - `限购配置冲突商品` 1 个
   - `可重命名分类` 1 个，且分类下至少有 2 个商品
   - `可删除分类` 1 个，且分类下至少有 1 个商品
   - `订单邮箱检索样本` 1 单
4. 额外准备至少 4 类库存搜索样本：
   - 带 `batch_id`
   - 带 `remark`
   - 已绑定 `order_id`
   - 已绑定 `buyer_email`
5. 浏览器准备：
   - Chrome 桌面端
   - 窄屏视口 `390 x 844`
6. 记录方式：
   - 每条检查项标记 `通过 / 失败 / 阻塞`
   - 失败时记录 `页面路径 / 商品号或订单号 / 复现步骤 / 截图 / 是否阻塞上线`

## 2. 自动化基线

执行下面这组 targeted tests，确认当前基线仍然通过：

```bash
node --test \
  tests/admin-shop-mutate-site-guard.test.js \
  tests/admin-shop-mutate-product-category-actions.test.js \
  tests/admin-shop-mutate-product-validation.test.js \
  tests/admin-shop-products-handler.test.js \
  tests/admin-shop-orders-handler.test.js \
  tests/admin-shop-inventory-handler.test.js \
  tests/admin-ops-alerts-settings.test.js \
  tests/admin-workbench-builders.test.js \
  tests/shop-inventory-alerts.test.js \
  tests/shop-order-delivery-alerts.test.js \
  tests/shop-order-risk-alerts.test.js
```

如果自动化基线失败，优先修复阻塞项，再进入真人联调。

## 3. 真人运营链路回归

### 3.1 商品发布检查器

1. 进入 `商城系统 -> 商品`，打开商品编辑弹窗。
2. 测试 `API 商品`：
   - 清空 `Webhook URL`
   - 保存商品
3. 确认：
   - 保存被阻止
   - 错误提示明确指向 `Webhook URL`
4. 测试 `KEY 商品`：
   - 选择一个 `is_active = true` 且库存为 `0` 的商品
   - 保存商品
5. 确认：
   - 不会直接静默保存
   - 会先看到风险提示，再由人工确认是否继续
6. 测试限购冲突：
   - 设置 `max_purchase_quantity > per_account_purchase_limit`
   - 或只填写窗口数量，不填写窗口分钟数
7. 确认：
   - 保存被阻止
   - 提示语义明确，不会混成通用失败提示
8. 测试说明字段：
   - 对 1 个上架商品清空 `purchase_notes` 和 `usage_instructions`
9. 确认：
   - 保存前能看到非阻塞警告
   - 不会误报成接口异常

### 3.2 分类与批量动作事务化

1. 选择一个有商品的分类执行重命名。
2. 确认：
   - 分类名变更成功
   - 分类下商品同步迁移到新分类
   - 商品不会残留在旧分类
3. 选择另一个有商品的分类执行删除。
4. 确认：
   - 商品被迁到 `other` 或指定 fallback 分类
   - 分类删除后，列表刷新结果一致
5. 拖动 2-3 个商品执行批量排序。
6. 确认：
   - 刷新后顺序保持不变
   - 跨分类排序时分类和排序都正确
7. 如果能构造失败样本：
   - 人为让其中 1 个商品 ID 无效
8. 确认：
   - 接口返回明确失败
   - 不会出现部分商品已更新、部分未更新的半成功状态

### 3.3 商品 / 订单 / 库存检索增强

1. 在 `商品` 页分别搜索：
   - 商品名
   - 分类名
   - 商品 ID
2. 再切换发货模式筛选：
   - `仅 KEY 商品`
   - `仅 API 商品`
3. 确认：
   - 商品列表结果正确
   - 搜索与发货模式筛选可叠加
4. 在 `订单` 页分别搜索：
   - `SHOP_ORDER_xxx`
   - 商品名
   - 用户邮箱
   - 用户名
5. 再切换筛选：
   - `仅已退款`
   - `仅正常订单`
   - `待履约 / 处理中 / 死信 / 已履约`
6. 确认：
   - 邮箱和用户名能命中对应订单
   - 手动切换筛选后再搜索，不会把筛选偷偷清掉
   - 导出订单时会带上当前关键字和筛选条件
7. 在 `库存` 页分别搜索：
   - `content`
   - `batch_id`
   - `remark`
   - `order_id`
   - `SHOP_ORDER_xxx`
   - `buyer_email`
8. 确认：
   - SQL 执行后，以上关键字都能命中
   - 翻页后结果仍然一致

### 3.4 告警参数配置化

1. 进入 `运营保障 / Ops Alerts`。
2. 调整 `shop_inventory` 的低库存阈值。
3. 调整 `shop_order_delivery` 相关阈值或摘要配置。
4. 调整 `shop_risk` 或统一摘要的工作时段、静默或汇总参数。
5. 保存后刷新页面。
6. 确认：
   - 配置值刷新后仍能保留
   - 工作台摘要、策略卡片和保存值口径一致
7. 额外确认：
   - 临时静默到某时间仍能正常展示
   - 汇总模式和汇总时间提示文案与当前配置一致
   - 不同模块的配置互不串写

## 4. 兼容性与异常值回归

至少人工验证下面 5 组场景：

1. `KEY 商品` 上架但无库存
2. `API 商品` 缺失 Webhook
3. `订单邮箱检索`
4. `库存按订单号 / 邮箱搜索`
5. `分类删除后商品自动归档到 fallback`

额外确认：

1. 移动端窄屏下，商品工具栏和订单筛选不会挤坏。
2. 多次连续搜索后，商品和订单列表不会残留上一轮筛选。
3. 告警配置保存失败时，会有明确提示，不是静默失败。

## 5. Bug 回收模板

每条失败项建议至少记录：

- 模块
- 页面路径
- 测试账号
- 商品号 / 分类号 / 订单号 / 库存号
- 复现步骤
- 实际结果
- 预期结果
- 截图
- 是否阻塞上线

建议额外打 1 个标签，方便统一修复：

- `PhaseB-发布检查`
- `PhaseB-分类事务`
- `PhaseB-商品检索`
- `PhaseB-订单检索`
- `PhaseB-库存检索`
- `PhaseB-OpsAlerts`

## 6. 本轮最低放行标准

满足下面条件，才建议把 `Phase B` 视为真人回归通过：

1. 高风险商品配置能在保存前被拦下或明确警告。
2. 分类重命名、删除、批量排序不会留下半成功状态。
3. 商品、订单、库存三类搜索至少覆盖运营常用的关键字段。
4. 订单筛选、商品筛选和导出行为与当前界面状态一致。
5. Ops Alerts 的阈值、静默、汇总和工作台展示口径一致。
6. 自动化基线通过，且真人回归没有阻塞上线的高优问题。
