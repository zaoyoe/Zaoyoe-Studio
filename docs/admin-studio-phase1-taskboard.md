# Admin Studio Phase 1 开发任务单

这份文档用于把 `Admin Studio` 第一阶段改造压成可以直接开工的任务单。

配套文档：

- [admin-studio-rebuild-roadmap.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-rebuild-roadmap.md)
- [admin-studio-safe-rebuild-plan.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/admin-studio-safe-rebuild-plan.md)

## 1. Phase 1 目标

第一阶段只解决一个核心问题：

- 后台写入底座不统一
- `all` 视图仍可能偷偷写到 `cn`

这一阶段不做业务重构，只做“写入口收口”和“错误写入止血”。

## 2. Phase 1 完成标准

满足以下条件，才算第一阶段完成：

1. `all` 视图下不能执行保存、删除、生成、退款、补偿类动作
2. 所有新增 admin handler 写路径都显式透传 `site`
3. 公共审计日志稳定记录 `site`
4. 老模块里最危险的 `all -> cn` 默认写入被清掉
5. 纯查看动作不受影响

## 3. 分支策略

主分支建议：

- `codex/admin-foundation`

建议按下面顺序拆 commit：

1. 公共 helper 和权限测试
2. 前端公共 guard
3. 高风险老模块补丁
4. 文档和回归清单

## 4. 任务总览

| 任务 ID | 任务名 | 建议负责人 | 预估工时 | 前置依赖 | 是否阻塞后续 |
|---|---|---|---|---|---|
| `P1-1` | Admin Site Helper 收口 | 平台/后端 | `0.5-1 天` | 无 | 是 |
| `P1-2` | 前端站点写保护 Guard | 前端 | `0.5-1 天` | `P1-1` | 是 |
| `P1-3` | Homepage 写入口止血 | 前端 | `0.5 天` | `P1-2` | 否 |
| `P1-4` | Points 写入口止血 | 前端 | `0.5 天` | `P1-2` | 否 |
| `P1-5` | Shop / Discounts / Gallery 写入口止血 | 前端 | `1 天` | `P1-2` | 否 |
| `P1-6` | 回归测试与 Smoke 验收 | QA / 联调 | `0.5-1 天` | `P1-3` `P1-4` `P1-5` | 是 |

## 5. 任务明细

## `P1-1` Admin Site Helper 收口

目标：

- 在服务端建立统一的站点写规则
- 给后续 handler 提供可复用 helper

涉及文件：

- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)
- [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/admin.js)
- [admin-handler-permissions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-handler-permissions.test.js)

要做的事：

1. 在 [admin.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js) 新增 `normalizeAdminSite()`
2. 新增 `requireWritableAdminSite()`
3. 统一 `writeAdminAuditLog()` 的 `site` 记录口径
4. 如果路由分发层需要，补一层公共 `site` 参数规范化

验收标准：

- 写请求传 `all` 会被明确拒绝
- `cn / intl` 会被正确保留
- audit 稳定带上 `site`

建议测试：

```bash
node --test tests/admin-handler-permissions.test.js
```

## `P1-2` 前端站点写保护 Guard

目标：

- 在公共前端层拦截错误写入
- 减少每个模块各自处理站点逻辑

涉及文件：

- [admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)
- [admin-studio-bootstrap.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-studio-bootstrap.js)

要做的事：

1. 在 [admin-site-filter.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-site-filter.js) 新增：
   - `isAllSitesSelected()`
   - `getWritableSite()` 或 `requireWritableSite()`
2. 在 [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js) 的委托动作入口前加 mutation guard
3. 在 [admin-studio-bootstrap.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-studio-bootstrap.js) 的 fallback 绑定里补同样 guard
4. 错误提示统一成“请先选择 `cn` 或 `intl`”

验收标准：

- 查看、筛选、分页不受影响
- 保存、删除、生成、退款类动作在 `all` 下被阻止
- 用户能看懂为什么被阻止

建议测试：

- 新增 [admin-site-guard.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-site-guard.test.js)
- 至少覆盖纯读动作不受影响和写动作被拦截两类场景

## `P1-3` Homepage 写入口止血

目标：

- 去掉首页模块的 `all -> cn` 写入默认值

涉及文件：

- [admin-homepage.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-homepage.js)

要做的事：

1. 找出首页保存时的站点默认逻辑
2. 删除 `all` 自动回落到 `cn` 的写法
3. 保存前统一改用公共 `writableSite`

验收标准：

- `all` 下保存首页被阻止
- `cn / intl` 下仍能保存
- 不出现 silent fallback

## `P1-4` Points 写入口止血

目标：

- 去掉积分/兑换码模块的隐式站点写入

涉及文件：

- [admin-points.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-points.js)

要做的事：

1. 找出生成批次、兑换码或相关保存动作的站点默认逻辑
2. 删除 `all -> cn` 回落
3. 保存前统一走公共 `writableSite`

验收标准：

- `all` 下不能生成兑换码或保存批次
- `cn / intl` 下行为保持正常

## `P1-5` Shop / Discounts / Gallery 写入口止血

目标：

- 补掉其余高风险模块的错误写入口

涉及文件：

- [admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js)
- [admin-discounts.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-discounts.js)
- [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js)

要做的事：

1. 在 [admin-shop.js](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-shop.js) 拦住商品编辑、财务类动作的 `all` 写入
2. 在 [admin-discounts.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-discounts.js) 拦住创建、编辑、删除折扣的 `all` 写入
3. 在 [admin-studio.js](/Volumes/chao/AI/xianyu_profit_calculator/admin-studio.js) 的 prompt create/update/delete 动作里改用公共 `writableSite`

验收标准：

- `all` 下不能进行写操作
- `cn / intl` 下流程保持可用

## `P1-6` 回归测试与 Smoke 验收

目标：

- 确认公共 guard 没有误伤
- 确认所有高风险写入口都已收住

涉及文件：

- [admin-handler-permissions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-handler-permissions.test.js)
- [admin-payments-actions.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-payments-actions.test.js)
- [admin-tickets-process.test.js](/Volumes/chao/AI/xianyu_profit_calculator/tests/admin-tickets-process.test.js)
- 新增的前端 guard 测试

自动测试命令：

```bash
node --test tests/admin-handler-permissions.test.js
node --test tests/admin-payments-actions.test.js
node --test tests/admin-tickets-process.test.js
```

如果要跑全量安全测试：

```bash
npm run test:security
```

手工 Smoke 清单：

1. 在 `all` 视图尝试保存首页
2. 在 `all` 视图尝试生成兑换码
3. 在 `all` 视图尝试执行商品写操作
4. 在 `all` 视图尝试创建或修改折扣
5. 在 `all` 视图尝试保存 prompt
6. 切到 `cn` 后重复上述关键保存
7. 切到 `intl` 后重复上述关键保存

放行标准：

- `all` 下的写操作都被阻止
- `cn / intl` 下的关键保存仍然可用
- 没有新增明显白屏、死按钮或整页报错

## 6. 建议排期

建议按 5 个工作日推进：

### Day 1

- 完成 `P1-1`
- 起草前端 guard 接口约定

### Day 2

- 完成 `P1-2`
- 补最小单测

### Day 3

- 完成 `P1-3`
- 完成 `P1-4`

### Day 4

- 完成 `P1-5`
- 补高风险模块回归

### Day 5

- 完成 `P1-6`
- 出一轮联调和发布说明

## 7. 风险点

第一阶段最常见的翻车点有 3 类：

1. Guard 写得太宽，把纯查看动作也拦了
2. 某些模块还有隐藏的 `all -> cn` 默认值没有查到
3. 提示做得太隐蔽，运营会误以为“按钮坏了”

因此这阶段一定要优先保证：

- 行为明确
- 报错可理解
- 公共逻辑先收口，再补模块差异

## 8. 交付物

Phase 1 结束后，应该交付这些东西：

1. 一条可复用的 admin site helper 能力
2. 一条可复用的前端站点写保护能力
3. 5 个高风险模块的止血补丁
4. 最小回归测试集
5. 一份发布前 smoke 结论
