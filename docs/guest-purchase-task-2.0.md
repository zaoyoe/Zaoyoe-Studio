# 游客现金直付购买：任务 2.0 执行合同

> 工作目录：`/Volumes/chao/AI/xianyu_profit_calculator`  
> 当前分支：`codex/guest-shop-cash-purchase`（从最新 `origin/main` 派生）  
> 任务 1.0 看板：`docs/guest-purchase-execution-taskboard.md`（冻结，不再作为执行源）  
> 运行手册：`docs/guest-shop-payment-fulfillment-runbook.md`  
> 部署规范：`AGENTS.md`

## 0. 任务 2.0 是什么

任务 1.0 已经完成核心方案、数据库、独立订单/支付/预占、回调验签、异步履约、取货凭证、自动化契约和只读后台异常列表。它停在 **代码/自动化收口 → 真实环境接线**，按原看板保守口径为 **82%**。

任务 2.0 不是重做 1.0，而是把剩余工作收成一份可执行、可验收、不允许停在 99% 的合同。进度从 0 重新计算，但 1.0 已完成项默认继承，不重复开发。

### 0.1 进度口径

- 当前总进度：**30%**
- 当前阶段：`C 完成且 20260914 SQL 5/5 PASS` → `D 真实支付沙箱矩阵 blocked`
- 阻断原因：D 仍缺生产拓扑上的游客购买代码发布、CN/INTL 支付沙箱账号、可见浏览器和内部测试 SKU。SQL 已不再是阻断项。
- 当前执行者动作：用户已明确授权“按 AGENTS.md 发布游客购买代码；发布不等于启用游客商品；不要从功能分支 vercel prod deploy；不要执行 SQL”。正在走专用分支 → PR → main → Vercel Git 集成 + KVM4 工作流。发布完成后 D 仍缺沙箱账号/可见浏览器/内部测试 SKU，保持 blocked。不得用 mock 开始 D，也不得把总进度写成 99%。
- 进度按下方阶段权重计算，不按文件数量，不用“基本完成”。
- 被用户、SQL、沙箱账号、真实设备或 KVM4 权限阻断时，状态记为 `blocked`，并写明责任人和证据缺口。禁止把 blocked 写成 99%。
- 只有第 0.2 节全部满足，才能从任何 90%+ 数字改成 **100%**。

### 0.2 任务 2.0 完成标准（全部满足才是 100%）

1. 游客入口、预览、服务端重算价格、原子预占、独立现金支付、回调验签、worker 履约、凭证取货均在生产拓扑上工作：前端在 Vercel，API/webhook/worker 在 KVM4 Verify Server。
2. 登录用户积分购买、折扣、购物车、后台原有订单/库存流程无回归。
3. 所有 P0 安全不变量有自动化测试 **和** 真实沙箱/实机证据：未付款不发货；回跳不发货；前端不能改价格/商品/站点/用途；同一库存不双发；充值回调不给游客单发货；游客回调不加积分。
4. 跨设备恢复语义已冻结并验收：`recovery_code` 只在创建响应展示一次；status/recover/claim 不再返回该口令；同一口令可幂等重试找回；口令不是“用一次即作废”的一次性消耗令牌。
5. 后台异常订单可筛选、可定位；写操作（退款/补发/解锁）有 RBAC、二次确认、原因和审计。没有写路径不得宣称运营完成。
6. 桌面和移动端视觉验收通过，UI 使用现有 `premium-modal` / `shop-btn` / 商城 token，不引入突兀英文 eyebrow 或新的视觉体系。
7. KVM4 guest-shop worker 已在最新 `main` 对应的 verify 发布上安装，timer 证据齐全；安装器未改 canonical root，未执行 SQL。
8. 只灰度 **一个** 低价值、非共享、自动发货 SKU；观察期指标达标后，关闭开关回滚演练成功。
9. 最终验收记录、风险清单、运行手册和上线/回滚步骤已归档。
10. 用户在本文件第 J 节签署“可以启用该灰度 SKU”。在此之前游客商品必须保持关闭。

不满足任何一条，总进度最高只能记到 **90%**，不能记 100%。

### 0.3 硬性规则

- Codex 不执行 SQL。需要新 SQL 时写入文件，给出绝对路径，等当前阶段结束再告诉用户执行。
- 已通过的 20260913 迁移和验证不得重复执行。
- 未确认无游客订单时不得回滚数据库。
- 不从功能分支直接生产部署。
- 部署不等于启用游客商品。
- 不把自动化全绿误报成生产已就绪。
- 不把 secret、卡密、claim token、recovery_code 明文写入日志或最终回复。
- 前端改动必须复用现有商城风格；发现突兀再当场改，不等到最后视觉阶段才发现。
- 每完成一步必须按第 11 节格式汇报，并回写本文件的待执行清单。

### 0.4 已冻结的 1.0 基线（继承，不重做）

- 数据库：基础迁移、atomic RPC、preflight 8/8、postflight 10/10 已由用户执行。`orphan_payment_events=0`，游客订单/支付/预占=0，启用游客商品=0。
- 独立表：`guest_shop_orders` / `guest_shop_payment_orders` / `guest_shop_payment_events` / `guest_shop_inventory_reservations`。
- 独立用途：`shop_direct`。不走 `fn_purchase_shop_item`，不混充值积分入账。
- 生产拓扑：Vercel 前端 + `/api/shop/*` 反代到 `verify-api.fatherkey.com`。
- 游客商品默认关闭。

---

## 1. 阶段总览

| 阶段 | 内容 | 权重 | 状态 | 退出条件 |
| --- | --- | ---: | --- | --- |
| A | 分支隔离、部署规范、2.0 合同 | 8% | 已完成 | 专用分支基于最新 main；AGENTS.md 含游客发布禁令 |
| B | 代码/自动化/恢复语义/UI 契约收口 | 12% | 已完成 | 完整测试、静态检查、readiness 契约、恢复语义测试通过 |
| C | 后台写路径：RBAC、二次确认、审计 | 10% | 已完成 | 退款/补发/解锁有权限、确认、原因、审计测试；20260914 SQL 5/5 PASS |
| D | 真实支付沙箱矩阵 | 18% | blocked | T3 每条都有通过证据或书面阻断；缺代码发布/沙箱账号/可见浏览器时保持 blocked |
| E | 真实数据库并发与限流 | 8% | 未开始 | 最后一张卡、预占释放、回调竞态有数据库证据 |
| F | KVM4 worker 安装与健康 | 10% | 未开始 | 最新 main 上 timer/journal 证据 |
| G | 桌面/移动视觉验收 | 8% | 未开始 | 清单状态均有截图，风格不突兀 |
| H | 告警、对账、退款/隐私政策 | 8% | 未开始 | 阈值、值班入口、政策文本就绪 |
| I | 低价值 SKU 灰度 | 10% | 未开始 | 单一 SKU、指标达标、关闭开关可停新单 |
| J | 回滚演练与最终签署 | 8% | 未开始 | 用户签署；此时才允许打开该灰度 SKU |
| **合计** |  | **100%** |  |  |

---

## A. 分支隔离、部署规范、2.0 合同

### 已完成

- [x] 布局预览残留移出工作区：`/tmp/shop-layout-toggle-preview-hold/`
- [x] 从最新 `origin/main`（`22a0494ea`，PR #645 merge）创建 `codex/guest-shop-cash-purchase`
- [x] 游客购买未提交改动随工作区带到新分支
- [x] `AGENTS.md` 增加 Guest Shop Deployment Rules：禁止功能分支 prod deploy；发布≠启用；四条链路；worker 必须等 verify 到最新 main；禁止部署时执行 SQL
- [x] 运行手册增加“发布不等于启用”
- [x] 本文件成为 2.0 执行合同

### 持续约束（A 已完成，全程有效）

- 未到用户明确要求“按 AGENTS.md 完整部署”之前：不推送、不提 PR、不生产部署
- 旧分支 `codex/shop-list-layout` 不再追加游客购买提交
- 游客购买只允许在 `codex/guest-shop-cash-purchase` 或后续从最新 `origin/main` 派生的专用 `codex/guest-shop-*` 分支上继续

### 完成标准

专用分支存在且指向最新 main；部署规范写明四条链路和“不得打开游客商品”。

---

## B. 代码/自动化/恢复语义/UI 契约收口

### B1. 恢复语义冻结（本轮已定稿）

`recovery_code` **不是**一次性消耗令牌。

| 行为 | 合同 |
| --- | --- |
| 创建订单 | 响应可返回 `recovery_code`；它由幂等键 + `GUEST_SHOP_CLAIM_DERIVATION_PEPPER` 派生 |
| 幂等重试创建 | 同一 idempotency key 得到同一口令，避免丢响应后无法找回 |
| status / recover / claim | 不得再返回 `recovery_code` |
| 跨设备找回 | 必须同时提供订单号 + 口令；成功后重发 HttpOnly cookie |
| 找回重试 | 同一口令可重复提交；网络失败不得把用户锁死 |
| 浏览器 | 口令只展示一次，不写入 `sessionStorage` / URL / 埋点 |
| 失败锁定 | 口令错误累计到上限后拒绝，不改口令本身 |

### B2. 本轮已完成

- [x] 补 `api/shop/guest/recover.js`，并加入 `.vercelignore`（生产仍走 public dispatcher / verify 反代）
- [x] readiness 校验 recover 路由、recover 入口文件、`readiness:guest-shop = node -- scripts/guest-shop-readiness.js`
- [x] 增加 Node 25 参数转发契约：缺少 `node --` 时 `--fail-on-not-ready` 会被 Node 当成运行时选项
- [x] 增加跨设备找回幂等测试：重复 recover 成功且不回吐口令
- [x] 前端契约：口令只显示一次、不持久化、弹层复用 `premium-modal` / `shop-btn`
- [x] 去掉突兀英文 eyebrow `Guest checkout`，改为中文 `无需登录`

### B3. 待执行

- [x] 运行完整游客/请求安全回归，记录准确 PASS 数，替换旧任务板 `135/135`
  - 游客相关 `tests/guest-shop-*.test.js` + `tests/admin-shop-guest-orders-*.test.js`：**156 passed / 0 failed**
  - 含 runtime config / request-security 的更大集合：**354 passed / 0 failed**
- [x] 运行静态检查：`node --check` + `git diff --check` = `STATIC_OK`
- [x] 运行 `npm run readiness:guest-shop -- --fail-on-invalid --fail-on-not-ready`，离线严格模式退出码 **3**，`operational_ready: false`
- [x] 审核 create 幂等重试会再次返回同一派生 `recovery_code`；前端 `showRecoveryCode()` 用已有口令直接 return，只展示一次，不写入存储
- [x] 确认游客商品开关代码路径默认关闭，未启用商品时 preview/order 返回 409 `guest_product_unavailable`
- [x] 本轮回归未把缺陷带进 C/D

### 完成标准

- 完整测试有数字证据
- package script 契约通过
- 恢复语义测试通过
- UI 契约通过
- 严格 readiness 在缺少人工证据时 fail-closed
- 无新增 SQL，或有 SQL 则暂停等用户执行

---

## C. 后台写路径

只读异常列表已经存在，不算运营完成。

### 待执行

- [x] 盘点现有 admin 权限模型，游客写操作复用现有 `shop.manage` + `writeAdminAuditLog`，不发明第二套管理员体系
- [x] 退款申请：二次确认、原因必填、操作者、审计行；RPC `fn_guest_shop_admin_queue_refund`
- [x] 补发/人工履约：仅 `paid_unfulfillable` + confirmed + quantity=1；`FOR UPDATE OF i SKIP LOCKED` 改绑唯一预占行
- [x] 解锁/重放死信：单笔，不批量；确认无活动 worker 租约，并清掉 metadata 死信标记
- [x] 所有写接口拒绝返回卡密明文到浏览器控制台/列表页；缺 RPC 时 503 fail-closed
- [x] 后台 UI 使用 `admin-studio` 现有表格、`shop-refund-modal`、copy 按钮 token，不另做一套高饱和仪表盘
- [x] handler / UI / worker / SQL 契约测试通过
- [x] 回写部署规范与运行手册：`docs/vercel-release-checklist.md`、`docs/kvm4-verify-server-deploy.md`、`docs/guest-shop-payment-fulfillment-runbook.md`、1.0 看板指针

### 完成标准

没有 RBAC + 二次确认 + 审计的写按钮不得出现在生产后台。

阶段 C 代码/测试/文档已完成。20260914 SQL 已由用户执行，verify **5/5 PASS**。

**SQL 通过不等于可运营。** 代码尚未合入 `main`、尚未发布到 Vercel/KVM4；公开商品仍关闭。生产后台写路径要等对应 commit 发布后才可用。

### SQL 状态（用户已执行）

- [20260914_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_guest_shop_admin_ops.sql) 已执行
- [20260914_verify_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_verify_guest_shop_admin_ops.sql) 已执行，5/5 `PASS`

已通过的 20260913 迁移不要重跑。未确认无游客订单时不得 rollback。

---

## D. 真实支付沙箱矩阵

状态：`blocked`。SQL 闸门已解除。剩余责任人：用户（是否发布代码、沙箱账号、可见浏览器、内部测试 SKU）；Codex 不得用 mock、本地假支付或“代码已覆盖”代替本阶段。

### D0. 解除 blocked 的前置（缺一不可）

- [x] 用户已执行并回传：
  - [20260914_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_guest_shop_admin_ops.sql)
  - [20260914_verify_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_verify_guest_shop_admin_ops.sql)
- [x] verify 结果 5/5 `PASS`：`admin_ops_functions` / `admin_ops_grants` / `admin_ops_return_columns` / `baseline_atomic_rpcs_still_present` / `merge_metadata_volatility`
- [x] 已通过的 20260913 迁移 **不要重跑**；未确认无游客订单时 **不得 rollback**（本轮未 rollback）
- [ ] 游客购买代码已按 AGENTS.md 从专用分支 PR 合入最新 `main`，Vercel + KVM4 Verify 已发布该 commit。发布不等于启用游客商品，也不得在发布过程执行 SQL
- [ ] 准备好 CN ZPay 沙箱账号、INTL NOWPayments 沙箱账号，以及可被主线程看见的浏览器或真机
- [ ] 游客公开商品保持关闭。本阶段最多允许打开 **一个内部测试 SKU** 的 `allow_guest_purchase`；该 SKU 必须低价值、非共享、自动发货、不作为公开主推。D 结束后若未进入 I，必须先关掉该 SKU

未满足剩余 D0 时，本阶段保持 `blocked`，总进度停在 **30%**，禁止改成 99%。

验收表： [guest-purchase-d-sandbox-evidence.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/guest-purchase-d-sandbox-evidence.md)

### D1. 证据模板（每条案例必填，缺字段=未完成）

把结果记在本文件后续执行记录或单独验收表，字段固定为：

`案例ID | 站点 cn/intl | 渠道 ZPay/NOWPayments | 本站订单号 | provider 订单号 | 事件键 | 金额/币种 | 期望状态 | 实际状态 | PASS 或 BLOCKED+原因 | 证据位置`

禁止写入：卡密明文、claim token、`recovery_code`、支付密钥。

### D2. 渠道覆盖最低集

- [ ] CN × ZPay：成功支付、未付过期、假回调、重复回调、退款成功/失败至少各 1 条
- [ ] INTL × NOWPayments `usdtbsc`：成功支付、错网络、金额或币种不匹配、回调丢失补偿至少各 1 条
- [ ] 串单：CN 回调打到 INTL 订单、INTL 回调打到 CN 订单，均必须拒绝且不发货

### D3. 场景清单

每条都必须留下 D1 字段。禁止用 mock 代替。

- [ ] 正常下单并支付成功
- [ ] 未付款订单过期并释放预占
- [ ] 假回调
- [ ] 重复回调
- [ ] 乱序回调
- [ ] 少付
- [ ] 多付
- [ ] 错币种
- [ ] 错网络（NOWPayments 非 `usdtbsc`）
- [ ] 回调丢失后对账补偿
- [ ] provider 超时
- [ ] provider 结果未知进入 `review`，不重复扣款
- [ ] 支付成功后 worker 履约
- [ ] 支付成功但库存耗尽 → `paid_unfulfillable`
- [ ] 后台申请退款后退款成功（20260914 RPC 已安装；仍需代码发布和真实沙箱退款）
- [ ] 退款失败/悬挂
- [ ] 跨设备恢复（关浏览器、换设备、支付 App 切回）；同一口令可重复找回，status/recover/claim 不回吐口令
- [ ] 关闭该测试 SKU 后，历史已付款订单仍可履约/退款，新单被拒绝
- [ ] CN / INTL 串单隔离
- [ ] 充值回调不会给游客单发货；游客回调不会给登录用户加积分

### 完成标准

上表每行是 `PASS` 或 `BLOCKED+原因`。不允许空白。任何一条用 mock 顶替，本阶段不得标记完成。

---

## E. 真实数据库并发与限流

前置：D0 SQL 已 PASS。并发/限流必须打到目标 Supabase，不允许只跑本地 mock；完整支付竞态仍等 D 的代码发布。

- [ ] 最后一张卡：两个游客请求只有一个预占成功
- [ ] 预占超时释放后可被新单使用
- [ ] 回调与 worker 并发不会把同一库存标 sold 两次
- [ ] 生产限流存储不可用时 fail-closed
- [ ] 不新增破坏性 SQL；若要诊断查询，写成只读 SQL 文件后等用户执行

---

## F. KVM4 worker

前置：最新 `main` 已在 Vercel + Verify Server 发布成功；`.current-release` 等于该 commit。安装器禁止自定义 `--root`，禁止执行 SQL，禁止打开游客商品。

- [ ] `npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid`
- [ ] 确认 `/opt/zaoyoe-verify-server/.env` 权限 `0600`，含独立 worker secret 和两个 claim pepper
- [ ] `npm run install:kvm4:guest-shop-worker` **不带** `--start`
- [ ] 核对 unit、`ConditionPathExists`、loopback `127.0.0.1:3001`、无请求体
- [ ] 显式 `--start`
- [ ] `systemctl status` / `list-timers` / `journalctl` 证据
- [ ] 连续 503 先停 timer，不扩大商品范围

禁止：自定义 `--root`；安装器执行 SQL；把 worker secret 写进 unit。

---

## G. 视觉验收

截图必须来自主线程可见浏览器或真实设备。风格对照现有积分购买弹层，不允许新视觉语言。

- [ ] 桌面：配置/创建订单
- [ ] 桌面：支付中（ZPay 打开支付页 / NOWPayments 地址金额）
- [ ] 桌面：支付核验中（回跳后不得显示已付款发货）
- [ ] 桌面：已发货 + 复制卡密
- [ ] 桌面：退款/人工审核
- [ ] 桌面：取货口令只出现一次
- [ ] 桌面：刷新恢复（无口令回吐）
- [ ] 移动端同样 7 项，底部 sheet、按钮全宽
- [ ] 支付 App 切回
- [ ] 关闭浏览器后用订单号+口令找回
- [ ] 亮色/暗色主题都不刺眼，不出现英文 `Guest checkout`

发现突兀立刻改 CSS/文案，再继续下一张截图。

---

## H. 告警、对账、政策

- [ ] `paid_unfulfilled_count` 非零 10 分钟告警
- [ ] 履约 P95/P99 阈值
- [ ] 金额不匹配、review、死信、退款悬挂告警
- [ ] 对账任务：本站支付事件 vs provider
- [ ] 数字商品退款/争议政策
- [ ] 隐私告知、数据保留、删除范围
- [ ] 值班手册入口保持本 runbook

---

## I. 低价值 SKU 灰度

- [ ] 选择一个低价值、非共享、自动发货、非人工发货 SKU
- [ ] 仅该 SKU 打开游客购买，其余保持关闭
- [ ] 观察成功率、发货延迟、预占占用、`paid_unfulfillable`、退款失败
- [ ] 预设阈值未达成则关闭该 SKU，不扩大范围

---

## J. 回滚演练与最终签署

- [ ] 关闭游客开关：新单拒绝，已付款继续履约/退款
- [ ] 不执行数据库 rollback
- [ ] 归档最终验收记录（日期、commit、四条链路、沙箱证据、截图索引）
- [ ] 用户签署：允许启用该灰度 SKU
- [ ] 只有签署后才打开该 SKU

**100% 只在本节最后两项完成后标记。**

---

## 11. 每一步汇报格式

1. 已完成什么，以及证据文件/测试结果
2. 总进度和当前阶段进度
3. 下一步具体动作
4. 新风险、影响、修正
5. 待执行清单变化
6. SQL 状态：无新增 / 有新增但未执行（绝对路径） / 用户已执行结果

---

## 12. 2026-09-14 任务 2.0 启动记录

- 从已合并的 `codex/shop-list-layout` 迁出，基线 `origin/main` = `22a0494ea`
- 布局预览三件套不进入本分支
- 补齐 recover 入口、readiness/npm 参数转发契约、跨设备找回幂等测试、中文 eyebrow
- 未部署，未打开游客商品，未执行 SQL

### SQL 状态

启动阶段没有新增 SQL。阶段 C 新增两条未执行 SQL，见第 13 节。

---

## 13. 2026-09-14 阶段 B 收口 + 阶段 C 完成记录

- 静态检查：`node --check` + `git diff --check` = `STATIC_OK`
- 游客相关测试：156 passed / 0 failed
- 含 runtime config 的更大集合：354 passed / 0 failed
- readiness 离线严格模式：退出码 3，`operational_ready: false`
- 恢复语义：幂等创建可再次返回同一派生口令；status/recover/claim 不回吐；前端只展示一次
- 后台写路径：POST `/api/admin?route=shop/guest-orders`，action 白名单 `request_refund | manual_fulfill | unlock_dead_letter`
- worker：两次查询合并 candidate，delivered/dead_letter + pending refund 可被扫描且不会被 skip
- 未推送、未提 PR、未部署、未打开游客商品、未执行 SQL
- 总进度记 **30%**。100% 只在第 J 节用户签署之后。

### SQL 状态

有新增但未执行：

- `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_guest_shop_admin_ops.sql`
- `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_verify_guest_shop_admin_ops.sql`

## 14. 2026-09-14 阶段 C 文档/部署规范收口

- 1.0 看板只改执行指针，冻结进度仍为 **82%**，不改 1.0 checkbox
- `docs/vercel-release-checklist.md`：游客购买必须走专用分支；禁止功能分支 prod deploy；发布≠启用；部署不执行 SQL
- `docs/kvm4-verify-server-deploy.md`：guest worker 只能在 verify 发布该 commit 后安装；禁止自定义 root；部署不执行 SQL
- `docs/guest-shop-payment-fulfillment-runbook.md`：补后台写路径（退款/补发/解锁）操作说明
- `AGENTS.md` Guest Shop Deployment Rules 增加上述文档交叉引用
- 未推送、未提 PR、未部署、未打开游客商品、未执行 SQL
- 总进度仍记 **30%**。下一动作是用户执行 20260914 SQL；在此之前 D 保持 `blocked`

### SQL 状态

有新增但未执行（与第 13 节相同，不重复生成）：

- `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_guest_shop_admin_ops.sql`
- `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_verify_guest_shop_admin_ops.sql`

## 15. 2026-09-14 用户执行 20260914 SQL

用户已在目标 Supabase 执行阶段 C SQL，并回传 verify 结果。Codex 未代执行。

| sort_order | check_name | status |
| ---: | --- | --- |
| 1 | admin_ops_functions | PASS |
| 2 | admin_ops_grants | PASS |
| 3 | admin_ops_return_columns | PASS |
| 4 | baseline_atomic_rpcs_still_present | PASS |
| 5 | merge_metadata_volatility | PASS |

关键观察：

- 6 个 admin helper/RPC 均存在，`search_path` 钉死
- 仅 `service_role` 可 EXECUTE；`anon` / `authenticated` / `public` 已撤销
- 写 RPC 返回状态字段；`manual_fulfill` 虽然 SQL 层有 `inventory_id`，HTTP handler 不得回吐
- 20260913 atomic RPC 仍在，`present_count=6`
- `guest_shop_merge_admin_action_metadata` 为 STABLE（`provolatile=s`）

未推送、未提 PR、未部署、未打开游客商品、未 rollback。

总进度仍记 **30%**。D 的数据库闸门已解除；下一动作是用户确认代码发布和沙箱准备，不是假装开始真实支付。

### SQL 状态

用户已执行并通过：

- [20260914_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_guest_shop_admin_ops.sql)
- [20260914_verify_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_verify_guest_shop_admin_ops.sql)

本轮无新增 SQL。

## 16. 2026-09-14 用户确认“是否可以部署测试”

用户在 20260914 SQL 5/5 PASS 后询问：是否可以部署测试。

澄清结论（本轮未部署）：

1. **可以发布代码，给阶段 D 接线。** 真实 ZPay / NOWPayments 回调必须打到 KVM4 Verify；未发布前不得用 mock、Preview 或功能分支 prod deploy 顶 D。
2. **发布 ≠ 启用游客商品。** 部署过程不得打开任何公开 SKU 的 `allow_guest_purchase`，也不得执行 SQL。
3. **合法路径只有一条：** 专用分支 `codex/guest-shop-cash-purchase` → commit/push → PR 合入最新 `main` → Vercel Git 集成 + Deploy KVM4 Verify Server + Deploy KVM4 Sub2API。verify 的 `.current-release` 等于该 commit 后，才能安装 guest-shop worker。
4. **当前仓库状态还不构成“已经可以点部署”：** 改动仍全部未提交，分支尚未 push，没有 PR。用户未给出明确“按 AGENTS.md 发布”授权前，Codex 不得开始这条链路。
5. 发布成功后，D 仍缺：CN ZPay 沙箱、INTL NOWPayments 沙箱（网络固定 `usdtbsc`）、可见浏览器/真机、仅一个内部测试 SKU。缺这些时 D 继续 `blocked`。

总进度仍记 **30%**。阶段 D 保持 `blocked`。

### SQL 状态

本轮无新增 SQL。20260914 已由用户执行并通过，不重跑。

## 17. 2026-09-14 用户授权按 AGENTS.md 发布代码

用户明确授权：

> 按 AGENTS.md 发布游客购买代码。发布不等于启用游客商品，不要从功能分支 vercel prod deploy，也不要执行 SQL。

本轮执行约束：

- 工作分支：`codex/guest-shop-cash-purchase`
- 发布路径：commit → push → PR 合入最新 `main` → Vercel Git 集成；禁止 `npx vercel deploy --prod`
- 部署过程不得执行 SQL，不得打开 `allow_guest_purchase`
- verify `.current-release` 等于该 `main` commit 后，才能安装 guest-shop worker；默认不 `--start`，除非 secrets/health 已确认
- 发布成功只解除 D0 的“代码未发布”闸门，不把阶段 D 标完成，总进度仍按 30% 记，直到沙箱矩阵开始有真实证据

本地发布前检查：

- `node --check` + `git diff --check` = `STATIC_OK`
- 游客相关 + runtime/security 集合：354 passed / 0 failed
- `allow_guest_purchase` 列默认 `false`；本次不改任何商品开关

### SQL 状态

本轮无新增 SQL。不重跑 20260913 / 20260914。
