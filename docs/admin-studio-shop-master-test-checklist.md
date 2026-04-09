# Admin Studio 商城系统总测试清单

这份清单用于统一执行商城系统当前版本的联调、回归、bug 回收与放行判断。

适用范围：

- `Phase A` 交易主链与履约收口
- `Phase B` 商品发布护栏、事务化与搜索筛选增强
- `Phase C` 内容经营页与用户价值驾驶舱

建议执行顺序：

1. 先核对前置 SQL 与样本准备
2. 再跑自动化基线
3. 再跑一轮 `30-45 分钟` 快速冒烟
4. 最后做全量真人联调并集中修 bug

## 1. 前置检查

### 1.1 SQL 状态

先确认下面两条 migration 已执行完成：

- [20260409_phase_a_shop_linkage_closeout.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_phase_a_shop_linkage_closeout.sql)
- [20260409_phase_b_shop_guardrails.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_phase_b_shop_guardrails.sql)

补充说明：

- `Phase C` 本轮没有新增必须执行的 SQL
- 如果环境不确定，优先核对历史单库存订单、库存搜索和分类事务化能力是否已生效

### 1.2 账号与环境

至少准备：

- 1 个管理员账号，可访问 `/admin-studio.html`
- 可进入 `商城系统`
- 可进入 `经营分析`
- 可进入 `运营保障 / Ops Alerts`

浏览器建议：

- Chrome 桌面端
- 窄屏视口 `390 x 844`

### 1.3 样本矩阵

至少准备下面这些样本：

- `KEY 商品` 已售订单 1 单
- `API 商品` 已售订单 1 单
- `多件订单` 1 单
- `已退款订单` 1 单
- `KEY 商品` 上架但无可售库存 1 个
- `API 商品` 缺失或故意填错 `Webhook URL` 1 个
- `限购配置冲突商品` 1 个
- `可重命名分类` 1 个，分类下至少 2 个商品
- `可删除分类` 1 个，分类下至少 1 个商品
- `死信任务` 1 条
- `锁冲突任务` 1 条
- `可人工重放任务` 1 条
- `订单邮箱检索样本` 1 单
- 带 `batch_id` 的库存样本 1 条
- 带 `remark` 的库存样本 1 条
- 有明确带货支付的 Prompt 1 条
- 有购买意图但未成交的 Prompt 1 条
- 有退款或履约风险的内容样本 1 条
- 有首单、复购、跨商品购买的用户样本 1 组

### 1.4 统一记录方式

每条检查项都建议标记：

- `通过`
- `失败`
- `阻塞`

失败项至少记录：

- 模块
- 页面路径
- 测试账号
- 商品号 / 订单号 / 库存号 / 任务号 / Prompt 标识 / 用户标识
- 复现步骤
- 实际结果
- 预期结果
- 截图
- 是否阻塞上线

## 2. 自动化基线

先执行下面这组基线：

```bash
node --test \
  tests/admin-shop-orders-handler.test.js \
  tests/admin-shop-inventory-handler.test.js \
  tests/admin-shop-inventory-detail-handler.test.js \
  tests/admin-shop-order-detail-handler.test.js \
  tests/admin-shop-delivery-actions-handler.test.js \
  tests/admin-shop-delivery-tasks-handler.test.js \
  tests/admin-shop-mutate-site-guard.test.js \
  tests/admin-shop-mutate-product-category-actions.test.js \
  tests/admin-shop-mutate-product-validation.test.js \
  tests/admin-shop-products-handler.test.js \
  tests/admin-ops-alerts-settings.test.js \
  tests/admin-workbench-builders.test.js \
  tests/shop-inventory-alerts.test.js \
  tests/shop-order-delivery-alerts.test.js \
  tests/shop-order-risk-alerts.test.js
```

再执行分析侧基线：

```bash
node -c /Volumes/chao/AI/xianyu_profit_calculator/admin-analytics.js
node -c /Volumes/chao/AI/xianyu_profit_calculator/js/admin-analytics-panel-loaders.js
node -c /Volumes/chao/AI/xianyu_profit_calculator/js/admin-analytics-workbench.js
node --test tests/frontend-supabase-runtime-config.test.js
node --test tests/admin-analytics-panel-support-bundle.test.js
node --test tests/admin-analytics-visual-panel-bundle.test.js
node --test tests/admin-analytics-product-bundles.test.js
```

放行要求：

- 自动化基线失败时，先修阻塞问题，再进入真人联调
- 如果只做快速冒烟，也至少先跑商城主链和分析侧语法基线

## 3. 快速冒烟清单

这部分建议控制在 `30-45 分钟`，先判断当前构建是否具备继续全量测试的价值。

### 3.1 商品

1. 进入 `商城系统 -> 商品`
2. 检查：
   - 商品分类切换正常
   - 搜索与发货模式筛选可用
   - 商品卡片列表能正常展示
   - 搜索框、筛选框、搜索按钮、清空按钮布局正常

### 3.2 库存

1. 进入 `商城系统 -> 库存`
2. 检查：
   - 列表能正常加载
   - 搜索 `content / batch / order / email` 能返回结果
   - 打开 1 条库存详情不报错

### 3.3 订单

1. 进入 `商城系统 -> 订单`
2. 检查：
   - 搜索订单号、商品名、邮箱能命中
   - 退款状态和履约状态筛选可用
   - 打开 1 条订单详情弹窗不报错

### 3.4 履约

1. 进入 `商城系统 -> API 履约`
2. 检查：
   - 主列表能加载
   - 死信列表能加载
   - 锁冲突列表能加载
   - 至少 1 个动作按钮可点开并正常反馈

### 3.5 分析

1. 进入 `经营分析 -> 内容经营`
2. 进入 `经营分析 -> 增长经营`
3. 检查：
   - 独立“内容经营页”可见
   - 独立“用户价值驾驶舱”可见
   - 页面不报错、不白屏

只要快速冒烟有阻塞级问题，就先停全量联调，集中修复。

## 4. 全量联调清单

### 4.1 商品页与发布检查器

1. 在 `商品` 页分别搜索：
   - 商品名
   - 分类名
   - 商品 ID
2. 切换筛选：
   - `仅 KEY 商品`
   - `仅 API 商品`
3. 确认：
   - 搜索与筛选可叠加
   - 清空后状态恢复正常
   - 工具栏窄屏下不挤坏

再检查发布护栏：

1. 打开商品编辑弹窗
2. 测试 `API 商品` 缺失 `Webhook URL`
3. 预期：
   - 保存被阻止
   - 提示明确指向 `Webhook URL`
4. 测试 `KEY 商品` 上架但库存为 `0`
5. 预期：
   - 先出现风险提示
   - 不会直接静默保存
6. 测试限购冲突
7. 预期：
   - 保存被阻止
   - 提示语义明确
8. 测试上架商品缺 `purchase_notes` / `usage_instructions`
9. 预期：
   - 出现非阻塞警告
   - 不误报成接口异常

### 4.2 分类与批量动作

1. 选择有商品的分类执行重命名
2. 确认：
   - 分类名变更成功
   - 关联商品同步迁移
   - 不残留在旧分类
3. 选择另一个分类执行删除
4. 确认：
   - 商品迁移到 fallback 分类
   - 分类删除后列表刷新一致
5. 调整 2-3 个商品排序
6. 确认：
   - 刷新后顺序保持
   - 不出现部分成功、部分失败

### 4.3 库存列表与库存详情

1. 在 `库存` 页分别搜索：
   - `content`
   - `batch_id`
   - `remark`
   - `order_id`
   - `SHOP_ORDER_xxx`
   - `buyer_email`
2. 确认：
   - 以上关键字都能命中
   - 翻页后结果一致
3. 打开已售库存详情
4. 确认：
   - 能准确回到唯一订单
   - 同订单商品项展示正确
   - 不再错绑到同用户同商品其他订单
5. 抽查 1 条历史单库存订单
6. 确认：
   - 仍能返回正确 `order_id`

### 4.4 订单列表与订单详情

1. 在 `订单` 页分别搜索：
   - `SHOP_ORDER_xxx`
   - 商品名
   - 用户 ID 或用户名
   - 用户邮箱
2. 切换筛选：
   - `仅已退款`
   - `仅正常订单`
   - `待履约 / 处理中 / 死信 / 已履约`
3. 确认：
   - 搜索与筛选叠加后口径正确
   - 导出会带当前筛选状态

再检查订单详情：

1. 打开订单详情弹窗
2. 确认可以正常看到：
   - 用户摘要
   - 支付摘要
   - 库存摘要
   - 履约摘要
   - 工单摘要
   - 风控摘要
3. 缺某个子系统数据时确认：
   - 只显示空态
   - 页面不报错
4. 点击 `库存详情`
5. 确认：
   - 能继续打开对应库存详情
   - 上下文一致
6. 抽查 1 单 `多件订单`
7. 确认：
   - 商品项数量正确
   - 每件商品都能对应真实库存或真实商品项

### 4.5 退款与异常状态

1. 对 1 单可退款订单执行退款
2. 确认：
   - 退款动作成功
   - 订单状态刷新正确
   - 订单详情刷新正确
   - 库存状态与订单状态一致
3. 再查看 1 单已退款订单
4. 确认：
   - 不出现重复退款可操作态
   - 状态标签与详情摘要一致

### 4.6 履约值班台

检查主列表：

1. 切换不同状态和搜索条件
2. 确认：
   - 列表正常分页
   - 切筛选不卡顿
   - 总数和分页一致

检查死信列表：

1. 测试翻页、原因筛选、搜索
2. 确认：
   - `人工死信 / 5xx / 冲突策略` 分类正确
   - 翻页后不重复、不跳页

检查锁冲突列表：

1. 测试翻页、锁状态筛选、任务定位
2. 确认：
   - `活跃锁 / 过期锁 / 缺锁` 口径正确
   - 列表与摘要统计一致

### 4.7 履约动作

至少各执行 1 次：

- `人工重放`
- `转死信`
- `强制解锁`
- `标记已履约`
- `重排队`

确认：

1. 动作成功后，列表状态刷新正确
2. 若订单详情弹窗正打开，详情会同步刷新
3. 订单列表、订单详情、履约列表三处口径一致
4. 异常返回有明确提示，不是静默失败

### 4.8 Ops Alerts

1. 进入 `运营保障 / Ops Alerts`
2. 调整：
   - `shop_inventory` 低库存阈值
   - `shop_order_delivery` 阈值或摘要配置
   - `shop_risk` 或统一摘要的工作时段、静默、汇总参数
3. 保存并刷新页面
4. 确认：
   - 配置值刷新后仍能保留
   - 工作台摘要、策略卡片、保存值口径一致
   - 不同模块配置互不串写
5. 额外确认：
   - 临时静默到某时间展示正常
   - 汇总模式与汇总时间提示正确

### 4.9 内容经营页

1. 打开 `经营分析 -> 内容经营`
2. 确认：
   - 顶部先看到独立“内容经营页”
   - 不是直接落到旧的“内容带货详情”
3. 检查主视图
4. 确认：
   - 有内容级经营判断
   - 有窗口摘要、指标卡、建议动作
   - 有“当前最值得盯的内容”列表
5. 点击：
   - `看带货详情`
   - `看主带货商品`
   - `看订单链`
6. 确认：
   - 跳转正常
   - 保留来源上下文
7. 检查问题摘要卡与复查结论
8. 确认：
   - 有问题样本时展示真实内容
   - 无样本时只显示空态，不报错

### 4.10 用户价值驾驶舱

1. 打开 `经营分析 -> 增长经营`
2. 确认：
   - 有独立“用户价值驾驶舱”
   - 不是只出现在总览附属块中
3. 检查主视图
4. 确认：
   - 有首单、复购、跨商品承接、高价值样本
   - 有价值层结论与建议动作
5. 点击：
   - 高价值用户样本
   - `首购商品去向`
   - `后续复购去向`
6. 确认：
   - 能跳到用户详情或商品经营详情
   - 保留用户价值上下文
7. 检查退款风险与仅意图场景
8. 确认：
   - 不会把“仅意图”误报成“已形成复购”

### 4.11 跨页联动与回写刷新

1. 从内容经营页跳到支付 / 售后 / 订单后完成处理
2. 预期：
   - 回到分析页后，内容经营页和内容带货详情会刷新
3. 从用户价值驾驶舱跳到支付 / 售后 / 订单后完成处理
4. 预期：
   - 回到增长页后，用户价值驾驶舱会刷新
5. 从总览里的经营导航进入 `内容经营页` / `用户价值驾驶舱`
6. 预期：
   - 焦点落到独立主视图

## 5. 窄屏与视觉回归

重点检查：

- 商品工具栏
- 订单筛选条
- 内容经营页 Hero 与卡片区
- 用户价值驾驶舱卡片区

确认：

1. 不出现横向溢出
2. 按钮换行后仍可点击
3. 搜索框、下拉框、按钮高度和间距一致
4. 卡片内容不会被截断到不可读

## 6. Bug 标签建议

建议统一使用以下标签，方便集中修复：

- `Shop-商品`
- `Shop-发布检查`
- `Shop-分类事务`
- `Shop-库存`
- `Shop-订单`
- `Shop-订单详情`
- `Shop-履约列表`
- `Shop-履约动作`
- `Shop-OpsAlerts`
- `Shop-内容经营`
- `Shop-用户价值`
- `Shop-跨页联动`
- `Shop-窄屏样式`

## 7. 总放行标准

满足下面条件，再建议视为本轮商城系统可交付：

1. 自动化基线全绿
2. 交易主链稳定：
   - 订单、库存、履约能唯一关联
   - 不出现主要错绑
3. 商品发布护栏稳定：
   - 高风险配置能拦截或明确警告
4. 分类与批量动作稳定：
   - 不出现半成功状态
5. 检索与筛选稳定：
   - 商品、订单、库存能覆盖运营常用字段
6. 履约值班稳定：
   - 主列表、死信、锁冲突分页筛选正常
   - 关键动作执行后多入口口径一致
7. 内容经营页与用户价值驾驶舱稳定：
   - 主视图可用
   - 跳转稳定
   - 回写后可刷新
8. 窄屏与视觉回归无阻塞级问题
9. 真人联调没有阻塞上线的高优缺陷

## 8. 关联文档

分阶段清单仍可继续参考：

- [admin-studio-shop-phase-a-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-a-test-checklist.md)
- [admin-studio-shop-phase-b-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-b-test-checklist.md)
- [admin-studio-shop-phase-c-test-checklist.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-phase-c-test-checklist.md)
- [admin-studio-shop-closeout-taskboard.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-shop-closeout-taskboard.md)
