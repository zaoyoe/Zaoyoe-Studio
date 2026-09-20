# 游客现金直付购买：任务 2.1 执行合同（2.0 增量升级）

> **当前计划版本：2.1（2026-09-19）**。本文件路径暂保留为 `docs/guest-purchase-task-2.0.md`，仅为兼容既有引用；本文件从本行起的新增规范以 2.1 为准。§12–§60 是 2.0 的历史证据，不回写成新的事实，也不另建第二份执行源。

> 工作目录：`/Volumes/chao/AI/xianyu_profit_calculator`  
> 2.0 历史基线分支：`codex/guest-shop-cash-purchase`（从当时最新 `origin/main` 派生）；2.1 实施必须从届时最新 `https-origin/main` 新建专用 `codex/guest-shop-*` 分支
> 任务 1.0 看板：`docs/guest-purchase-execution-taskboard.md`（冻结，不再作为执行源）  
> 运行手册：`docs/guest-shop-payment-fulfillment-runbook.md`  
> 部署规范：`AGENTS.md`

## 0. 任务 2.1 是什么

任务 1.0 已经完成核心方案、数据库、独立订单/支付/预占、回调验签、异步履约、取货凭证、自动化契约和只读后台异常列表。它停在 **代码/自动化收口 → 真实环境接线**，按原看板保守口径为 **82%**。

任务 2.0 不是重做 1.0，而是把剩余工作收成一份可执行、可验收、不允许停在 99% 的合同。任务 2.1 是在 2.0 基线之上的增量升级：不重算 2.0 历史进度，不把自动化全绿当成真实环境完成，并把本次审查发现的收银台动作语义、状态机、竞态、身份恢复、开关门禁和运营护栏纳入同一份执行合同。

2.1 的核心判断是：当前弹窗并非“按钮都有就算完成”。「稍后处理」是隐藏本地界面，「关闭当前订单」是清理本地句柄而不是服务端取消；创建支付结果未知、主动查单并发、找回订单跨商品展示和隐藏按钮的 CSS 显隐都可能造成重复付款、错误商品或错误状态。因此，2.1 先完成 P0 闭环和证据，再谈扩大促销、件数或游客商品范围。

### 0.1 进度口径

- **任务 2.1 是当前唯一执行版本，当前总进度为 40%（2/5 阶段完成）。** 阶段 1「代码与合同」和阶段 2「默认关闭生产发布」已完成；当前进入阶段 3「指定 SKU 游客启用」。
- **任务 2.0 的 48% 已冻结为历史快照。** 它只说明当时 A–J 合同执行到哪里，不再参与 2.1 计分，也不阻塞默认关闭发布或指定 SKU 的独立启用评审。§12–§60 内重复出现的 48% 均按历史运行日志解释，不再动态更新。
- 2.1 五阶段各占 20%，状态只使用 `not_started / in_progress / blocked / complete / deferred`。`blocked` 和 `NOT RUN` 都不等于通过，但未启用功能的证据缺口也不会阻塞不包含该功能的阶段。
- 每阶段都有独立退出条件；通过的证据绑定一个固定候选或生产 commit。只有代码、配置、环境、选定 SKU 或事故事实发生变化时才重开对应阶段，不因 `main` 后续自然前进而循环重验。
- 默认关闭生产发布和游客商品启用分开计分。阶段 2 完成只证明代码已安全发布且所有游客开关保持原状态；阶段 3 才审查并启用一个明确的 product/SKU。
- 当前事实：发布候选自动化为游客商城 `516/516 PASS`、全量安全 `3450/3450 PASS`；代码已由 PR #656 发布到 production commit `40da7b557659b0f097a478437cb9034138f2ea2e`。指定「测试」SKU 在发布前后都已能返回游客 preview，本次发布没有新增或扩大商品/功能开关；邮箱密码凭证与查询页开关仍关闭。本轮未执行 SQL、未创建新订单、未支付既有订单。

### 0.2 任务 2.0 历史完成标准（仅供追溯）

以下十项是旧 2.0 合同的历史完成定义，不是 2.1 阶段 2 或阶段 3 的整体验收门。2.1 只按第 1 节和 §61.9 的分层门禁执行；与当前发布或所选 SKU 无关的 INTL、促销、多件、凭证、全量设备矩阵和未来功能不得被重新解释为当前硬门。

1. 游客入口、预览、服务端重算价格、原子预占、独立现金支付、回调验签、worker 履约、凭证取货均在生产拓扑上工作：前端在 Vercel，API/webhook/worker 在 KVM4 Verify Server。
2. 登录用户积分购买、折扣、购物车、后台原有订单/库存流程无回归。
3. 所有 P0 安全不变量有自动化测试 **和** 真实沙箱/实机证据：未付款不发货；回跳不发货；前端不能改价格/商品/站点/用途；同一库存不双发；充值回调不给游客单发货；游客回调不加积分。
4. 跨设备恢复语义已冻结并验收：`recovery_code` 只在创建响应展示一次；status/recover/claim 不再返回该口令；同一口令可幂等重试找回；口令不是“用一次即作废”的一次性消耗令牌。
5. 后台异常订单可筛选、可定位；写操作（退款/补发/解锁）有 RBAC、二次确认、原因和审计。没有写路径不得宣称运营完成。
6. 桌面和移动端视觉验收通过，UI 使用现有 `premium-modal` / `shop-btn` / 商城 token，不引入突兀英文 eyebrow 或新的视觉体系。
7. KVM4 guest-shop worker 已在最新 `main` 对应的 verify 发布上安装，timer 证据齐全；安装器未改 canonical root，未执行 SQL。
8. 只灰度**已批准白名单 SKU 集合**；每个 SKU 都必须低价值、非共享、自动发货且未公开上架。按批次和指标扩围，任何一个 SKU 都能单独关闭并完成回滚演练；“一个 SKU”仅是第一批保守起点，不是永久数量上限。
9. 最终验收记录、风险清单、运行手册和上线/回滚步骤已归档。
10. 用户在本文件第 J 节签署“可以启用该白名单灰度 SKU 集合”。在此之前公开/灰度游客商品必须保持关闭；§60.8.2 已确认的内部沙箱商品只能按白名单和本合同资质要求保留，不得误当成公开启用。

旧合同曾规定不满足任何一条时 2.0 不能记 100%；该规则随 2.0 一并冻结。它不改变当前 2.1 的 40% 进度，也不覆盖 §61.9 针对发布、基础 SKU 和扩展功能分别定义的退出条件。

### 0.3 硬性规则

- Codex 不执行 SQL。需要新 SQL 时写入文件，给出绝对路径，等当前阶段结束再告诉用户执行。
- 已通过的 20260913 迁移和验证不得重复执行。
- 未确认无游客订单时不得回滚数据库。
- 不从功能分支直接生产部署。
- 部署不等于启用游客商品。
- 不把自动化全绿误报成生产已就绪。
- 不把 secret、卡密、claim token、recovery_code 明文写入日志或最终回复。
- 前端改动必须复用现有商城风格；发现突兀再当场改，不等到最后视觉阶段才发现。
- 每个阶段退出时按第 11 节格式汇报，并只更新第 0.1 节、第 1 节及对应证据记录；不再为每个命令向历史正文追加运行日志。

### 0.4 已冻结的 1.0 基线（继承，不重做）

- 数据库：基础迁移、atomic RPC、preflight 8/8、postflight 10/10 已由用户执行。`orphan_payment_events=0`，游客订单/支付/预占=0 是 **1.0 历史基线**，启用游客商品=0 也只是当时快照；当前运维状态以 §60.8.2 的 `operator_state_review`、Admin Studio 开关和 §61.9/§61.10 白名单闸门为准。
- 独立表：`guest_shop_orders` / `guest_shop_payment_orders` / `guest_shop_payment_events` / `guest_shop_inventory_reservations`。
- 独立用途：`shop_direct`。不走 `fn_purchase_shop_item`，不混充值积分入账。
- 生产拓扑：Vercel 前端 + `/api/shop/*` 反代到 `verify-api.fatherkey.com`。
- 游客商品默认关闭；当前运维开关状态不以本条历史基线推断，须按 §60.8.2 的动态管理员开关和 §61.9 的发布/启用闸门复核。

---

## 1. 任务 2.1 阶段总览（当前唯一计分表）

| 阶段 | 内容 | 权重 | 状态 | 退出条件 |
| --- | --- | ---: | --- | --- |
| 1 | 代码与合同 | 20% | **complete** | P0 安全切片、按钮语义、自动化 `516/516` 和 2.1 分层合同完成；扩展项明确关闭或延期 |
| 2 | 默认关闭生产发布 | 20% | **complete** | PR #656 合入当时最新 `main`；Vercel、Verify、Sub2API、guest-shop worker 四链绑定 production commit `40da7b557659b0f097a478437cb9034138f2ea2e` 且健康；未执行 SQL、未改变游客商品/功能开关 |
| 3 | 指定 SKU 游客启用 | 20% | **in_progress** | 精确 product/SKU 通过 operator review 和 §61.9 基础安全门；用户确认后只打开该 SKU，扩展开关保持关闭 |
| 4 | 观察与回滚 | 20% | **not_started** | 按预先写定的窗口、样本和阈值完成对账与履约观察；关闭该 SKU 后新单被拒、在途已付款单继续履约或退款 |
| 5 | 后续扩展与收口 | 20% | **not_started** | INTL、促销、多件、凭证增强、完整可访问性等逐项实施或明确 `deferred`；归档最终状态与后续责任人 |
| **合计** |  | **100%** |  |  |

阶段 1 已在 2026-09-20 以发布候选代码和 `516/516` 游客商城自动化基线完成；阶段 2 已由 §61.14 的同 commit 四链证据完成。当前进度 **40%**，剩余 **3/5 阶段，60%**；阶段 3 先核清指定 SKU 已存在的 allowlist 状态和邮箱密码链路前置，不能重复建单或盲目重开开关。

下方 A–J、§12–§60 和早期 K 表述均是 2.0/实施历史，保留用于审计，不再构成当前计分表或一揽子阻断门。若历史段落与本节或 §61.9 冲突，以本节和 §61.9 为准。

---

## A. 分支隔离、部署规范、2.0 合同

### 已完成

- [x] 布局预览残留移出工作区：`/tmp/shop-layout-toggle-preview-hold/`
- [x] 从最新 `origin/main`（`22a0494ea`，PR #645 merge）创建 `codex/guest-shop-cash-purchase`
- [x] 游客购买未提交改动随工作区带到新分支
- [x] `AGENTS.md` 增加 Guest Shop Deployment Rules：禁止功能分支 prod deploy；发布≠启用；四条链路；worker 必须等 verify 到最新 main；禁止部署时执行 SQL
- [x] 运行手册增加“发布不等于启用”
- [x] 本文件成为 2.0 执行合同；2026-09-19 起新增 §61，内容版本升级为 2.1，路径保持兼容
- [x] 回写 `AGENTS.md` / `docs/kvm4-verify-server-deploy.md` / `docs/guest-shop-payment-fulfillment-runbook.md` / `docs/vercel-release-checklist.md`：改 `.env` 后必须 `docker compose up -d --no-deps --force-recreate --no-build verify-server` 重载 `env_file`；禁止 `docker restart`；禁止打印 secret；禁止复用 `CRON_SECRET`

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

状态：`in_progress`。20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919 SQL 闸门已解除。D3-01 CN ZPay 已现网付款、本地 worker 履约、浏览器确认 delivered（D3-13/D3-17 同期 PASS）。D3-04 已把同一已付款 ZPay 回调重放到本地 preview，返回 `duplicate: true`，未二次发货。D3-03 伪造签名返回 202 `accepted: false`，写入 invalid-bucket rejected 事件，不改 D3-01 终态。D3-02 未付款单 `GS202609150429213472D4D87B04A50` 到期后官方 worker 释放预占，库存回到 available，D3-01 sold/delivered 不变。D3-05 对 D3-01 补发签名正确但 `WAIT_BUYER_PAY` 的乱序回调，返回 202 `accepted: false`，新 invalid-bucket rejected 事件，不回退 delivered。D3-08 已记 `BLOCKED+ZPay currency is site-derived`。D3-11/D3-12 已用本机 hang proxy 对 `zpayz.cn` CONNECT 真实超时：租约期内重试 409，未知结果后订单行+支付行都进 `review` / `payment_creation_unknown`，再重试 503，hang log 只有 1 次渠道 CONNECT。D3-10 已确认 D3-01 就是回调丢失后的对账补偿：现网支付宝已付、ZPay 官方查单 `paid`，本地 webhook 当时未到，用官方字段+商户签名补进本地验签事件后 confirmed→delivered；D3-04 同事件 `duplicate: true`；processed 事件仍 1；未付款/超时单渠道 pending 且无 `trade_no`，不得补偿确认。D3-18/D3-14/D3-15 已 PASS。D3-09 错网络已 PASS（涨价到 144 后建成 `usdtbsc` 发票，错网络 `usdttrc20` webhook 202 `{accepted:false}`，未 confirm、未发货）。卡住点不是代码，而是 INTL 成功支付：官方发票 `5250755581` 已 expired 且 `actually_paid=0`；用户在支付宝页说已付，现网没有新支付宝单。其余未完成项是重建 INTL 发票并真扣 USDT-BEP20，以及 D3-16 退款失败/悬挂；阶段 D 的 18% 不计分。Codex 不得用 mock、本地假支付或“代码已覆盖”代替本阶段。

### D0. 解除 blocked 的前置（缺一不可）

- [x] 用户已执行并回传：
  - [20260914_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_guest_shop_admin_ops.sql)
  - [20260914_verify_guest_shop_admin_ops.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260914_verify_guest_shop_admin_ops.sql)
- [x] verify 结果 5/5 `PASS`：`admin_ops_functions` / `admin_ops_grants` / `admin_ops_return_columns` / `baseline_atomic_rpcs_still_present` / `merge_metadata_volatility`
- [x] 已通过的 20260913 迁移 **不要重跑**；未确认无游客订单时 **不得 rollback**（本轮未 rollback）
- [x] 用户已执行 20260915 迁移：
  - [20260915_guest_shop_credit_pricing.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260915_guest_shop_credit_pricing.sql)
- [x] 用户已重跑修正后的 verify：
  - [20260915_verify_guest_shop_credit_pricing.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260915_verify_guest_shop_credit_pricing.sql)
  - 1-7 `PASS`；第 8 项 `REVIEW`（`enabled_count=1`，信息项，不是约束失败）
- [x] 游客购买代码已按 AGENTS.md 从专用分支 PR 合入最新 `main`，Vercel + KVM4 Verify 已发布该 commit。发布不等于启用游客商品，也不得在发布过程执行 SQL
- [x] KVM4 游客专用密钥已写入 `/opt/zaoyoe-verify-server/.env`（mode `0600`，不回显、不复用 `CRON_SECRET`）；verify-server 已重建加载 `env_file`；guest-shop worker timer 已启动且空 tick 成功
- [x] 可见浏览器已接上：Codex in-app browser 打开 `http://localhost:8000/shop.html`，游客购买弹窗可操作
- [x] 内部测试 SKU 已确认：Gemini「测试 2」/ 规格「测试」；`product_id=c16212d8-6ad8-4b3c-831c-3cc68b2d7a52`；`sku_id=db8cc9bd-898a-49ff-adb4-cc07f94d7d8f`；`price_points=0.01`；`delivery_type=KEY`；自动发货；非共享；库存 42。~~不得再开第二个~~【2026-09-19 更新：计数上限作废——游客商品数由 Admin Studio 游客开关动态决定，无固定上限；每个被打开的商品仍须低价值/非共享/自动发货且不得公开上架。见 §60.8.2 / 证据 §2.10.2】
- [x] CN ZPay：现有配置没有独立沙箱，实际走现网 `zpayz.cn` + 支付宝。D3-01 按现网 ¥0.01 执行，不把沙箱缺失写成 PASS
- [x] INTL NOWPayments：现有配置也是现网 `api.nowpayments.io` / `usdtbsc`，没有沙箱密钥。20260916 已执行 3/3 PASS，INTL create-order 闸门已解除。测试 SKU 已涨到 `price_points=144`（现网 min ≈ `$19.05` USD），已能建成 `usdtbsc` 发票。网络仍固定 `usdtbsc`，商品标价 CNY，USDT 按充值同一套汇率折算，不得把 USD quote 当结算币种。当前成功支付发票已过期且 `actually_paid=0`，不得再付旧地址
- [x] 游客公开商品保持关闭。当前库里已有 **1** 个 `allow_guest_purchase=true`（用户确认主动打开为测试准备，非代码故障）。D 结束后若未进入 I，必须先关掉该 SKU

D0 的 CN 可见浏览器/测试 SKU 已齐。阶段 D 仍是 `in_progress`，总进度仍记 **48%**（A+B+C+F+H），因为 D 矩阵未按合同收口。禁止改成 99%。打开内部测试商品必须走 Admin Studio 开关，不得用 SQL 改 `allow_guest_purchase`。20260915 已把 create-order 切到积分价 CNY；20260916 已让数据库在缺国际积分价时回退复用 CN 积分价，INTL create-order 闸门已解除。仍只有 1 个游客测试 SKU，不要新开。

验收表： [guest-purchase-d-sandbox-evidence.md](/Volumes/chao/AI/xianyu_profit_calculator/docs/guest-purchase-d-sandbox-evidence.md)

### D1. 证据模板（每条案例必填，缺字段=未完成）

把结果记在本文件后续执行记录或单独验收表，字段固定为：

`案例ID | 站点 cn/intl | 渠道 ZPay/NOWPayments | 本站订单号 | provider 订单号 | 事件键 | 金额/币种 | 期望状态 | 实际状态 | PASS 或 BLOCKED+原因 | 证据位置`

禁止写入：卡密明文、claim token、`recovery_code`、支付密钥。

### D2. 渠道覆盖最低集

- [ ] CN × ZPay：成功支付、未付过期、假回调、重复回调、乱序回调、少付、多付、回调丢失补偿、退款成功已有证据；错币种已记 `BLOCKED+ZPay currency is site-derived`；仍缺退款失败/悬挂 1 条
- [ ] INTL × NOWPayments `usdtbsc`：错网络已 PASS（`GS20260915150703326FB1F73A265FA` / `payment_id=5250755581`，`usdttrc20` webhook 202 `{accepted:false}`）。成功支付未入账：官方发票 expired / `actually_paid=0`，本地仍 pending；金额或币种不匹配、回调丢失补偿未开始
- [x] 串单：CN 回调打到 INTL 订单、INTL 回调打到 CN 订单，均必须拒绝且不发货（D3-19 PASS：NOWPayments 打 D3-01、ZPay 打 INTL 失败单均 live HTTP 202 `{accepted:false}`，rejected 事件 `payment_order_id=null`，未 confirm、未发货）

### D3. 场景清单

每条都必须留下 D1 字段。禁止用 mock 代替。

- [x] 正常下单并支付成功（D3-01 PASS）
- [x] 未付款订单过期并释放预占（D3-02 PASS：`GS202609150429213472D4D87B04A50` worker `expired_reservations=1`，预占 released，库存 available，SKU available=41 / sold=1，D3-01 仍 delivered）
- [x] 假回调（D3-03 PASS：伪造签名 202 `accepted: false`，invalid-bucket rejected，D3-01 delivered 不变）
- [x] 重复回调（D3-04 PASS：同一已付款 ZPay 体重放 200 `duplicate: true`，事件仍 1 条 processed，库存 sold 仍 1）
- [x] 乱序回调（D3-05 PASS：对 D3-01 重签 `WAIT_BUYER_PAY`，202 `accepted: false`，invalid-bucket rejected，`signature_verified=true` / `final_status_verified=false`，D3-01 仍 delivered / sold）
- [x] 少付（D3-06 PASS：对 D3-01 重签 `money=0.00`，202 `accepted: false`，invalid-bucket rejected，`signature_verified=true` / `amount_verified=false` / `observed_amount=0`，支付单仍 paid_amount=0.01，D3-01 仍 delivered / sold）
- [x] 多付（D3-07 PASS：对 D3-01 重签 `money=1.00`，202 `accepted: false`，invalid-bucket rejected，`observed_amount=1` / `amount_verified=false`，支付单仍 paid_amount=0.01，D3-01 仍 delivered / sold）
- [x] 错币种（D3-08 `BLOCKED+ZPay currency is site-derived`：CN ZPay `currencyForSite()` 恒为 CNY；生产 webhook 把 `payload.currency` 覆盖成站点币种，binding 用 `expected.currency` 对比自身；金额正确 + `currency=USD` 的 in-process handler 会 200 接受并 `confirm_payment`。本轮未打 live webhook。真实错币种放到 INTL NOWPayments quote / `actually_paid_currency`）
- [x] 错网络（NOWPayments 非 `usdtbsc`）（D3-09 PASS：涨价到 `price_points=144` 后 live create HTTP 201，订单 `GS20260915150703326FB1F73A265FA` / 支付行 `667d6ff5-b0a2-4227-b079-2d0a78eaec6a` / `payment_id=5250755581` / 标价 144 CNY / 应付 `20.48 usdtbsc`。错网络 webhook `actually_paid_currency=usdttrc20` 返回 HTTP 202 `{accepted:false}`；新事件 `af1ad08a-818a-418b-bd53-4c319e03b02f` / `nowpayments:invalid-bucket` / rejected / `observed_status=wrong_asset`。未 confirm、未发货；预占 held；库存该行 reserve；sold 仍 1，D3-01 仍 delivered。旧 ¥0.01 失败单 `GS20260915095329434CB3A9D9F6DAE` 只作历史对照，不要付款）
- [x] 回调丢失后对账补偿（D3-10 PASS：D3-01 `GS2026091500585007432D22B143D38` 现网支付宝已付后官方查单 `status=paid` / `trade_no=2026091523001409501422068607`，本地 webhook 当时未到；用官方字段+商户签名补进本地验签事件 `577d818d-0342-41f8-b53e-4603c5286679` → confirmed → worker delivered。D3-04 同事件 `duplicate: true`。processed 事件仍 1。D3-02/两张超时单渠道 pending 且无 trade_no，不得补偿确认）
- [x] provider 超时（D3-11 PASS：`GS20260915070900686E811B0791BB0` 租约期内 request2=409 `guest_payment_creation_in_progress`；hang proxy 仅 1 次 `zpayz.cn` CONNECT；request1 无 checkout）
- [x] provider 结果未知进入 `review`，不重复扣款（D3-12 PASS：同单订单行+支付行 `review` / `payment_creation_unknown`；request3=503 `guest_payment_reconciliation_required`；预占 held；库存 reserve 未 sold；D3-01 delivered 不变）
- [x] 支付成功后 worker 履约（D3-13，由 D3-01 本地 worker 覆盖）
- [x] 支付成功但库存耗尽 → `paid_unfulfillable`（D3-14 PASS：`GS20260915131639759F6E8976B5F06` 现网支付宝已付；官方查单 paid 后本地补偿 webhook 200；`confirm_payment` 后 `payment=confirmed` / `fulfillment=paid_unfulfillable` / `refund=pending` / 预占仍 released；库存 frozen 41 / sold 1，sold 仍是 D3-01；worker 未 delivered）
- [x] 退款成功（D3-15 PASS：paid_unfulfillable 的生产路径是 `confirm_payment` 置 `refund_pending` + worker 自动退款，不是再点一次 Admin `request_refund`。worker scanned=1 / refunded=1 / delivered=0；终态 `payment=refunded` / `fulfillment=refunded` / `refund_status=succeeded`；官方 ZPay 查单 `status=2 refunded` / money=0.01。Admin `request_refund` 对已 succeeded 会 `guest_admin_not_eligible`，不再另开一笔。未退 D3-01）
- [ ] 退款失败/悬挂
- [x] 跨设备恢复（关浏览器、换设备、支付 App 切回）；同一口令可重复找回，status/recover/claim 不回吐口令（D3-17，D3-01 设备 cookie 403 后用弹窗口令找回）
- [x] 关闭该测试 SKU 后，历史已付款订单仍可履约/退款，新单被拒绝（D3-18 PASS：Admin Studio `upsert_product` 关 `allow_guest_purchase` 后 CN/INTL create-order 均 409 `guest_product_unavailable`，无 order / recovery_code / checkout；D3-01 仍 confirmed/consumed/delivered/refund_status=none / sold；processed 事件 `577d818d-0342-41f8-b53e-4603c5286679` 不变；SKU available=41 / sold=1 全程未变；随后 mutate_on 恢复 true。未退 D3-01）
- [x] CN / INTL 串单隔离（D3-19 PASS：两向 live 202 rejected / `payment_order_id=null`；D3-01 仍 delivered；INTL 仍 failed/released；SKU available=41 / sold=1；原 processed 事件不变。handler 跨 provider 命中不再绑支付行，避免 P0001）
- [x] 充值回调不会给游客单发货；游客回调不会给登录用户加积分（D3-20 PASS：游客已付回调打到 `/api/payments/zpay/webhook` 返回 503 `payment order not ready`，`points_ledger` 无 `zpay_GS...`；充值单打到游客 webhook 202 `accepted:false` / invalid-bucket rejected / `payment_order_id=null`；D3-01 仍 delivered，充值单仍 redeemed）

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

- [x] 生产 readiness 对 KVM4 `/opt/zaoyoe-verify-server/.env` 执行：5 个游客专用密钥均 configured。剩余 `invalid=3` 仅为 compact verify 镜像不含 `deploy/kvm4/guest-shop-worker/*`；host 安装器已落地单元，不作为启动失败。`--fail-on-not-ready` 在沙箱证据齐前仍应 fail-closed
- [x] `/opt/zaoyoe-verify-server/.env` 权限 `0600`，含独立 `GUEST_SHOP_WORKER_SECRET`、两个 claim pepper，以及独立 contact/request hash pepper；均不复用 `CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY`
- [x] `npm run install:kvm4:guest-shop-worker` **不带** `--start`（发布后已安装）
- [x] 核对 unit、`ConditionPathExists=/opt/zaoyoe-verify-server/.env`、loopback `127.0.0.1:3001`、无请求体、`ProtectSystem=strict`
- [x] 显式 `npm run install:kvm4:guest-shop-worker -- --start`
- [x] `systemctl` / `list-timers` / `journalctl` 证据：timer `active/waiting`，oneshot 与 timer tick 均为 `Result=success`、`scanned=0`
- [x] 连续 503 先停 timer、不扩大商品范围：该运行规则仍有效；当前 tick 为 200 空扫描，未触发
- [x] 回写部署规范与契约：改 `.env` 后必须重建 verify-server 重载 compose `env_file`；compact 镜像缺 `deploy/kvm4/guest-shop-worker/*` 不是启动失败；guest adapter 优先 stored secret

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
- [ ] 按 §61.3 逐状态截图五个动作：稍后处理、创建支付订单、查询支付状态、离开/取消、找回订单；同时记录 computed `display`、disabled、focus 和 `aria-busy`
- [ ] `configure/creating/awaiting_payment/checking/review/confirmed/paid_unfulfillable/dead_letter/delivered` 与全部支付/退款终态均有真实文案，不把 review/金额异常/退款误标成“支付超时”

发现突兀立刻改 CSS/文案，再继续下一张截图。

---

## H. 告警、对账、政策

- [x] `paid_unfulfilled_count` 非零 10 分钟告警
- [x] 履约 P95/P99 阈值
- [x] 金额不匹配、review、死信、退款悬挂告警
- [x] 对账任务：本站支付事件 vs provider
- [x] 数字商品退款/争议政策
- [x] 隐私告知、数据保留、删除范围
- [x] 值班手册入口保持本 runbook

### 完成标准

- 独立模块 `api/_lib/guest-shop-alerts.js`，`source=guest_shop_monitor`，未并入 `shop_order_delivery`
- verify server 启动 `startGuestShopAlertSweep()`，阈值只用 env + 模块默认
- `npm run reconcile:guest-shop` 默认 `--local-only`；`--query-provider` 失败保持 review
- 值班手册、公开退款政策、隐私政策已同步；readiness 契约覆盖上述入口

---

## I. 低价值 SKU 灰度

- [ ] 选择一个低价值、非共享、自动发货、非人工发货 SKU
- [ ] 按 Admin Studio 白名单逐批打开游客购买；每个 SKU 单独记录资质、operator review 和开关，不以固定商品数量替代审核
- [ ] 观察成功率、发货延迟、预占占用、`paid_unfulfillable`、退款失败
- [ ] §61.3 五按钮状态矩阵、未知支付、迟到付款和跨设备恢复证据均已归档后，才允许扩大范围
- [ ] 预设阈值未达成则关闭该 SKU，不扩大范围

---

## J. 回滚演练与最终签署

- [ ] 关闭游客开关：新单拒绝，已付款继续履约/退款
- [ ] 验证关闭的是业务开关而非客户端“关闭当前订单”；`review`/未知支付订单保留对账线索
- [ ] 不执行数据库 rollback
- [ ] 归档最终验收记录（日期、commit、四条链路、沙箱证据、截图索引）
- [ ] 用户签署：允许启用已审计的白名单灰度 SKU 集合
- [ ] 只有签署后才按白名单逐个打开对应 SKU

**历史说明：** 本节属于旧 2.0 A–J 模型，不再决定 2.1 百分比。当前启用顺序和签署条件以第 1 节五阶段及 §61.9 为准。

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

## 18. 2026-09-14 按 AGENTS.md 发布完成（发布 ≠ 启用）

用户授权后执行：专用分支 commit/push → PR #646 → 检查通过后 merge 到 `main`。未从功能分支执行 `npx vercel deploy --prod`，未执行 SQL，未打开 `allow_guest_purchase`。

| 链路 | 结果 | 证据 |
| --- | --- | --- |
| Vercel production | Ready | 部署 `dpl_4yfSaTaLiiYZEtVFxbE5pC7cXKwu`，别名 `https://www.fatherkey.com`，Git SHA `44b3f4203` |
| KVM4 Verify Server | success | Actions run 34823283373；`/opt/zaoyoe-verify-server/.current-release` = `44b3f4203d5183867cf0646936645e1745a12b7a`；容器 healthy；`/healthz` ok |
| KVM4 Sub2API | success | Actions run 34823283376；`/opt/sub2api/.current-release` = `44b3f4203d5183867cf0646936645e1745a12b7a`；`https://new.fatherkey.com/health` ok；postgres/redis healthy；无 `sub2api-legacy` |
| KVM4 guest-shop worker | installed, not started | 单元/timer 已安装且 `enabled`；`ActiveState=inactive`。缺 `GUEST_SHOP_WORKER_SECRET` 等专用密钥，按规范不 `--start` |

现场探活（商品仍关闭）：

- `GET /api/shop/catalog?site=cn` 200，22 个商品，catalog 未暴露已开启的 guest flag
- `GET /api/payments/config?site=cn` 200，登录用户支付仍为 zpay
- `GET /api/shop/guest/preview?site=cn` 400 `invalid_uuid`（路由已上线，fail-closed）
- 容器内 `guest-shop-readiness --fail-on-invalid`：`ok=false` `ready=false` `invalid=6`。其中 3 项是生产缺少游客 pepper/worker secret；另外 3 项是 compact verify 镜像不含 `deploy/kvm4/guest-shop-worker/*`（host 上已由安装器落地，不作为启动依据）

明确未做：

- 未执行任何 SQL
- 未打开任何公开或内部 SKU 的游客开关
- 未启动 worker timer
- 未开始真实支付沙箱矩阵，总进度仍 **30%**

下一动作：用户补齐 KVM4 游客专用密钥（写入 `/opt/zaoyoe-verify-server/.env`，mode 0600，不回显），并准备 CN ZPay / INTL NOWPayments 沙箱、可见浏览器、仅一个内部测试 SKU。齐套后才能把 D 从 blocked 改为执行中。

### SQL 状态

本轮无新增 SQL。不重跑 20260913 / 20260914。

## 19. 2026-09-14 写入 KVM4 游客密钥并启动 worker（仍不启用商品）

用户指示“继续下一步”。本轮只补齐 D0/F 的密钥与 worker 启动，不打开游客商品，不执行 SQL，不为文档再合 `main`。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| `.env` 备份 | 已做 | `/opt/zaoyoe-verify-server/backups/env.guest-shop-pre-secrets.20260914090046.bak`（mode `0600`） |
| 新增密钥（仅名） | 5 个独立密钥 | `GUEST_SHOP_CLAIM_PEPPER` / `GUEST_SHOP_CLAIM_DERIVATION_PEPPER` / `GUEST_SHOP_CONTACT_HASH_PEPPER` / `GUEST_SHOP_REQUEST_HASH_PEPPER` / `GUEST_SHOP_WORKER_SECRET`。值未回显，未复用 `CRON_SECRET` 或 service_role |
| `.env` 权限 | `0600 root:root` | 写入后复核 |
| verify 容器 | 已 `--no-deps --force-recreate --no-build` | 普通 restart 不会重读 compose `env_file`；重建后 `/healthz` ok，uptime 重新计算 |
| 容器内密钥 | 5/5 set + strong + distinct | 不回显值 |
| 现场探活 | 商品仍关闭 | catalog 200 / 22 商品 / `CATALOG_GUEST_TRUE=0`；payments/config 200；`GET /api/shop/guest/preview` 400 `invalid_uuid`；无密钥 POST worker 401 `invalid_worker_secret`（此前缺密钥会是 503） |
| 容器 readiness | `ok=false` `ready=false` `invalid=3` | 3 项全是 compact 镜像缺 `deploy/kvm4/guest-shop-worker/*`。密钥相关检查全部 configured |
| worker oneshot | success | `scanned=0 processed=0 duration_ms=104` |
| worker timer | enabled + active/waiting | `LastTriggerUSec=2026-09-14 09:06:07 UTC`，timer tick `duration_ms=226` `scanned=0` `Result=success` |
| `.current-release` | 未改发布 | `44b3f4203d5183867cf0646936645e1745a12b7a` |

支付密钥核对：guest adapter **不是只读 env**。它走 `resolvePaymentProviderSecrets`，优先后台 stored secret，env 仅回退。KVM4 `.env` 仍无 `ZPAY_PKEY` / `NOWPAYMENTS_API_KEY`，登录支付能跑是预期现象，不作为本轮缺口。

明确未做：

- 未执行任何 SQL
- 未打开任何公开或内部 SKU 的 `allow_guest_purchase`
- 未开始真实支付沙箱矩阵，D 保持 `blocked`
- 未把文档再合入 `main`，避免无代码变更的生产部署

总进度改记 **40%**。100% 只在第 J 节用户签署之后。

下一动作：用户提供 CN ZPay 沙箱、INTL NOWPayments 沙箱（网络固定 `usdtbsc`）、可见浏览器/真机、仅一个低价值非共享自动发货内部测试 SKU。齐套并授权打开该测试 SKU 后才能把 D 从 blocked 改为执行中。

### SQL 状态

本轮无新增 SQL。不重跑 20260913 / 20260914。

## 20. 2026-09-14 F 部署规范收口（env_file 重建，仍不启用商品）

用户指示“继续下一步”。本轮只把 F 的现场经验写进部署规范和契约测试，防止之后改密钥却用 `docker restart` 导致 worker 401/503。不打开游客商品，不执行 SQL，不把文档再合入 `main`。

| 项 | 结果 |
| --- | --- |
| `AGENTS.md` Guest Shop extra chain | 写明 pause watchdog → `docker compose up -d --no-deps --force-recreate --no-build verify-server` → `/healthz` → 恢复 watchdog；禁止 `docker restart`；禁止打印/复用密钥 |
| `docs/kvm4-verify-server-deploy.md` | 增加 Reload guest-shop secrets；compact 镜像缺 `deploy/` 不是启动失败；guest adapter 优先 stored secret |
| `docs/guest-shop-payment-fulfillment-runbook.md` | 同步重建步骤、contact/request pepper、stored secret 回退 |
| `docs/vercel-release-checklist.md` §1.1 | 同步 env_file 重建禁令 |
| 契约 | readiness runbook 检查 + worker scheduler 文档契约覆盖上述命令 |

明确未做：

- 未执行任何 SQL
- 未打开任何公开或内部 SKU 的 `allow_guest_purchase`
- 未开始真实支付沙箱矩阵，D 保持 `blocked`
- 未把文档再合入 `main`，避免无应用代码变更的生产部署
- 未开始 H 的告警接线；H 是下一可执行阶段

总进度仍记 **40%**（A+B+C+F）。100% 只在第 J 节用户签署之后。

下一动作：开始 H（告警、对账、退款/隐私政策）。D 仍等用户提供 CN ZPay 沙箱、INTL NOWPayments 沙箱（网络固定 `usdtbsc`）、可见浏览器/真机、仅一个低价值非共享自动发货内部测试 SKU。

### SQL 状态

本轮无新增 SQL。不重跑 20260913 / 20260914。

## 21. 2026-09-14 阶段 H 告警/对账/政策落地（仍不启用商品）

用户指示“下一步该做什么了”。本轮完成 H：独立游客告警 sweep、本地对账脚本、值班手册与公开退款/隐私补充。不打开游客商品，不执行 SQL，不合入 `main`。

| 项 | 结果 |
| --- | --- |
| 告警模块 | `/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/guest-shop-alerts.js`，`source=guest_shop_monitor`，`skipSummary: true` |
| verify 接线 | `server/index.js` 调用 `startGuestShopAlertSweep()`，首轮 delay 7200ms；不读 ops-alerts runtime.guest_shop |
| 对账 | `npm run reconcile:guest-shop` → `node -- scripts/guest-shop-reconcile.js`，默认 `--local-only` |
| 值班手册 | 独立告警、对账命令、数字商品退款与争议、HMAC/财务保留 |
| 公开政策 | `refund-policy.html` 插入无编号 h2；`privacy.html` 补充收集/存储/Cookie/删除范围，不改既有编号标题 |
| 契约 | readiness +5→+7；alerts/reconcile/legal/worker scheduler 聚焦测试 |

明确未做：

- 未执行任何 SQL
- 未打开任何公开或内部 SKU 的 `allow_guest_purchase`
- 未开始真实支付沙箱矩阵，D 保持 `blocked`
- 未开始 G 的可见浏览器/真机截图
- 未把本轮合入 `main`，避免无启用授权的生产部署

总进度记 **48%**（A+B+C+F+H）。100% 只在第 J 节用户签署之后。

下一动作：G 需要主线程可见浏览器或真机截图；或等用户提供 D 的 CN ZPay 沙箱、INTL NOWPayments 沙箱（网络固定 `usdtbsc`）、仅一个低价值非共享自动发货内部测试 SKU。

### SQL 状态

本轮无新增 SQL。不重跑 20260913 / 20260914。

## 22. 2026-09-14 Admin Studio「允许游客购买」开关（未发布，仍不启用公开商品）

用户要求在后台编辑商品设置里加「允许游客购买」开关，打开后自己买一次再查日志。本轮只做商品级配置入口，不开始 D 沙箱矩阵，不打开任何 SKU，不执行 SQL，不合入 `main`。

| 项 | 结果 |
| --- | --- |
| UI | `admin-studio.html` 发货状态后、注意事项前：开关 + CNY/USD 现金价 + 国内 ZPay / 国际 USDT-BEP20。复用现有 `toggle-switch` / `modern-form-group` / `shop-product-sku-row__toggle` |
| 前端 | `js/admin-shop.js` 回填、新建默认关、保存前校验；打开开关时按站点默选通道，关闭不清空价格/通道 |
| 服务端 | `upsert_product` 打开时硬拦 KEY / 非人工 / 至少一个合法价格 / 至少一个合法通道；关闭时允许空价格空通道，非法价格/mock 通道仍拦 |
| SKU | 保存路径不写 `allow_guest_purchase` / 现金价 / 通道，继续回落到商品级 |
| 测试 | `tests/admin-shop-mutate-product-validation.test.js` 扩 guest upsert；新增 `tests/admin-shop-guest-purchase-toggle.test.js` |

明确未做：

- 未执行任何 SQL
- 未打开任何公开或内部 SKU 的 `allow_guest_purchase`
- 未开始真实支付沙箱矩阵，D 保持 `blocked`
- 未从功能分支生产部署，未合入 `main`。生产 Admin Studio 在发布前看不到该开关

总进度仍记 **48%**（A+B+C+F+H）。本轮是 D0 的操作入口，不是 D 完成。100% 只在第 J 节用户签署之后。

下一动作：用户授权按 AGENTS.md 发布本开关后，在生产后台打开 **一个** 低价值、非共享、自动发货内部测试商品，自己购买一次，只回传订单号，不要密钥/卡密/`recovery_code`。之后 Codex 查游客订单/支付/worker 日志。

### SQL 状态

本轮无新增 SQL。不重跑 20260913 / 20260914。

## 23. 2026-09-14 游客购买复用积分价 / 人民币结算（迁移随后已执行，仍不启用商品）

用户要求：游客购买不要单独定价；商品标价始终人民币，复用现有积分价/阶梯价/闪购，1 积分 = 1 元。国内站和国际站一样，国际站 ≠ 必须用 USD。易支付/ZPay 始终人民币；NOWPayments 始终 USDT-BEP20（`usdtbsc`），按登录用户充值同一套逻辑把人民币折成实时等额 USDT。本轮只改定价/结算合同，不开始 D，不打开任何 SKU，不执行 SQL，不合入 `main`。

### 本轮做了什么

- 游客 preview/order 改走 `guest-credit-v1`：站点 SKU 积分价 + qty=1 阶梯 + 闪购 `LEAST`，不回退商品价，不读 leftover `guest_cash_price_*`
- Admin Studio 去掉游客现金价输入；通道文案改为 `ZPay（人民币）` / `NOWPayments USDT-BEP20`；保存时把 leftover 现金价列置 `null`，开启游客购买不再要求单独现金价
- 国内站和国际站结算币种都是 `CNY`。ZPay 按人民币收款；NOWPayments 用充值路径 `convertCnyAmountToPriceAmount` 把人民币转 USD quote，再收 `usdtbsc`
- create-order RPC 替换件写入 20260915：`v_currency := 'CNY'`，价格只来自 `guest_shop_resolve_credit_unit_amount(...)`，仍不接受客户端金额；若库里已有非 CNY 结算行则 `RAISE EXCEPTION`，不静默改写
- webhook 绑定用订单结算币种 `expected.currency`（CNY），不把 NOWPayments parser 的 USD quote 当成结算币种
- 新增/更新契约测试：积分价 JS、20260915 SQL 合同、adapter 结算/metadata、webhook USD quote 仍绑定 CNY、前端应付金额始终 `¥`。SQL 合同不再把注释 `does not enable guest products` 误判成启用商品；断言只拦截 `SET allow_guest_purchase = true` 和对 `shop_products/shop_product_skus` 的开关 UPDATE。聚焦测试 96/96、扩围测试 60/60 已绿。

### 本轮没做什么

- 未执行任何 SQL
- 未推送、未提 PR、未部署
- 未打开 `allow_guest_purchase`
- 未删除 leftover `guest_cash_price_*` 列
- 未开始真实支付沙箱矩阵

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。积分价/人民币结算的**代码与自动化收口已完成**；本轮是已完成 B 阶段上的定价纠偏，不是 D 完成，也不把总进度改成 99%。
- 100% 只在第 J 节用户签署之后。

### 下一步

1. ~~用户在目标 Supabase 执行 20260915 SQL~~ 已执行
2. ~~用户只重跑修正后的 verify~~ 已重跑：1-7 PASS，第 8 项 REVIEW（`enabled_count=1`）
3. ~~verify 前不要打开内部测试 SKU~~ 用户已主动打开 1 个商品做测试准备，非代码故障；~~不得再开第二个~~，也不得公开上架【2026-09-19 更新：计数上限作废——数量由 Admin Studio 游客开关动态决定；资质三条与「不得公开上架」保留。见 §60.8.2 / 证据 §2.10.2】
4. 仍保持 D `blocked`，直到确认该 SKU 低价值/非共享/自动发货，并且 CN ZPay 沙箱、INTL NOWPayments 沙箱（`usdtbsc`）、可见浏览器/真机齐套

### 风险和修正

- **create-order 已切到积分价 CNY。** 首次 verify 第 5 项 FAIL 是脚本误伤，不是 RPC 没换。
- **库里没有非 CNY 游客结算行。** observed `orders=0, payments=0`。禁止 rollback 20260913/20260914。
- **NOWPayments parser 仍可能报告 `USD`。** 修正：这是 USD quote，不是结算币种；绑定和落库用 CNY，metadata 保留 `local_currency/local_amount/cny_to_usd_rate`。事件约束仍允许 observed USD。
- **leftover 现金价列还在。** 修正：代码不再读取；后台保存置空；本轮不 DROP COLUMN。
- **误以为国际站要用 USD 标价。** 修正：国际站积分价仍是人民币金额；USDT 只是 NOWPayments 的收款资产。

### 待执行任务清单（同步后）

- [x] 用户执行 20260915 迁移
- [x] 用户重跑修正后的 verify：1-7 PASS；第 8 项 REVIEW（`enabled_count=1`，用户确认主动打开）
- [x] 内部测试 SKU 最多一个，且走 Admin Studio 开关（当前 1 个，用户主动打开）
- [ ] 确认该 SKU 低价值、非共享、自动发货，不是公开主推
- [ ] 未齐套沙箱/真机前禁止真实付款；本地弹层不等于 D 开始
- [ ] 不从功能分支 vercel prod deploy；发布仍须走 AGENTS.md
- [ ] ~~不得再打开第二个游客商品~~（2026-09-19 更新：计数上限作废，数量由 Admin Studio 游客开关动态决定，见 §60.8.2），不得公开上架
- [ ] D 仍缺：CN ZPay 沙箱、INTL NOWPayments 沙箱、可见浏览器/真机
- [ ] G 视觉验收、E 真实并发、I 灰度、J 回滚签署均未开始

### SQL 状态

迁移已执行。修正后的 verify 已重跑：1-7 PASS，第 8 项 REVIEW。

1. [20260915_guest_shop_credit_pricing.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260915_guest_shop_credit_pricing.sql)（不要重跑）
2. [20260915_verify_guest_shop_credit_pricing.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260915_verify_guest_shop_credit_pricing.sql)（已重跑，不要再跑）

不重跑 20260913 / 20260914 / 20260915。Codex 不代执行。

## 24. 2026-09-15 verify 第 5 项误伤修正（不重跑迁移）

用户已执行 20260915 并回传 verify：1-4、6-8 PASS，第 5 项 `settlement_currency_constraints` FAIL。

### 本轮做了什么

- 核对 observed：订单/支付约束已是 `currency = CNY`（pg dump 形态 `(currency)::text = 'CNY'::text`），国内站和国际站都要求 CNY；事件 observed 仍允许 USD quote；非 CNY 行 0；游客商品仍 0
- 判定第 5 项是校验脚本用源 SQL 字符串去 ILIKE pg canonical dump，不是约束错误，也不是要改迁移
- 修正 verify：按 boolean flags 匹配 pg dump；不 DROP、不启用商品、不 rollback
- SQL 合同测试已更新并 4/4 通过

### 本轮没做什么

- 未重跑 20260915 迁移
- 未执行任何 SQL
- 未推送、未提 PR、未部署
- 未打开 `allow_guest_purchase`
- 未开始 D

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。迁移已落地，但 D 的沙箱矩阵未开始，禁止改成 99%。
- 100% 只在第 J 节用户签署之后。

### 下一步

1. ~~用户只重跑 verify~~ 已重跑，见第 25 节
2. 不要再跑 20260915 迁移或 verify
3. 仍不发布、不开始真实付款，直到沙箱/真机齐套，并确认那 1 个已开商品只是内部测试 SKU

### 风险和修正

- **把 FAIL 当成约束没建上而重跑迁移。** 修正：迁移不要重跑；verify 已重跑通过 1-7。
- **把 observed USD 当成国际站结算币种。** 修正：那是 NOWPayments quote 允许值，结算仍是 CNY。
- **把第 8 项 REVIEW 当成 SQL 失败。** 修正：这是信息项；`enabled_count=1` 表示有 1 个商品开了游客购买。
- **verify 通过后立刻付款。** 修正：D 还缺沙箱/真机；本地弹层不等于沙箱矩阵。

### 待执行任务清单（同步后）

- [x] 用户重跑修正后的 verify 并回传
- [x] 不重跑 20260915 迁移
- [ ] 不从功能分支部署
- [ ] ~~不得再打开第二个游客商品~~（2026-09-19 更新：计数上限作废，数量由 Admin Studio 游客开关动态决定，见 §60.8.2），不得公开上架

## 25. 2026-09-15 verify 闸门关闭 + 用户确认 1 个测试商品（不开始 D）

用户已重跑修正后的 [20260915_verify_guest_shop_credit_pricing.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260915_verify_guest_shop_credit_pricing.sql)，并确认库里那 1 个 `allow_guest_purchase=true` 商品是自己主动打开为测试准备，**非代码故障**。Codex 未代执行 SQL，未部署，未开始真实付款。

### 本轮做了什么

- 核对重跑结果：1-7 `PASS`，第 8 项 `guest_products_remain_disabled_or_review` = `REVIEW`（`enabled_count: 1`）
- 判定第 8 项是信息项，不是约束失败，也不是迁移没装上
- 回写任务 2.0：SQL 闸门关闭；D 仍 `blocked`；总进度保持 48%
- 把 `enabled_count=1` 记成用户主动测试准备，而不是缺陷

| sort_order | check_name | status | 说明 |
| ---: | --- | --- | --- |
| 1 | credit_pricing_functions | PASS | helper STABLE invoker；create-order SECURITY DEFINER；都钉 `search_path` |
| 2 | credit_pricing_grants | PASS | 仅 `service_role` 可 EXECUTE |
| 3 | create_order_credit_price_body | PASS | 结算 CNY；用积分价 helper；不接受客户端金额 |
| 4 | helper_credit_price_body | PASS | SKU 积分价 + qty=1 阶梯 + 闪购 `LEAST`；不回退商品价 |
| 5 | settlement_currency_constraints | PASS | 订单/支付 CNY；国内站和国际站都是 CNY；事件允许 observed USD quote |
| 6 | leftover_cash_price_columns_kept | PASS | leftover 现金价列仍在，`present_count: 4`，本轮不 DROP |
| 7 | no_non_cny_settlement_rows | PASS | `orders:0, payments:0` |
| 8 | guest_products_remain_disabled_or_review | REVIEW | `enabled_count: 1`；用户确认主动打开，非代码故障 |

### 本轮没做什么

- 未重跑 20260913 / 20260914 / 20260915 迁移
- 未从功能分支生产部署，未合入 `main`
- 未开始 D 沙箱矩阵，未用 mock 顶真实支付
- 未再打开第二个游客商品
- 未用 SQL 改 `allow_guest_purchase`

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。SQL 闸门关闭不等于 D 完成，也不把总进度改成 99%。
- 100% 只在第 J 节用户签署之后。

### 下一步

1. 确认当前这 1 个已开商品满足：低价值、非共享、自动发货、不是公开主推。可选只读查询（用户执行，Codex 不代跑）：

```sql
SELECT id, name, allow_guest_purchase, guest_payment_channels, is_active, delivery_type
FROM public.shop_products
WHERE allow_guest_purchase IS TRUE;
```

2. 若该商品是公开/高价值/共享库存/人工发货，先在 Admin Studio 关掉，另选一个内部测试 SKU
3. 补齐 D0 剩余项：CN ZPay 沙箱、INTL NOWPayments 沙箱（网络固定 `usdtbsc`）、主线程可见浏览器或真机
4. 齐套前不得真实付款，不得发布功能分支，~~不得再开第二个游客商品~~（2026-09-19 更新：计数上限作废，数量由 Admin Studio 游客开关动态决定，见 §60.8.2）

### 风险和修正

- **把 REVIEW 当 SQL 失败而重跑迁移。** 修正：1-7 已 PASS；第 8 项只是告诉你有 1 个商品开了开关。不要再跑任何 20260913/14/15 SQL。
- **把用户主动打开的测试商品当故障关掉，或反过来当成可以公开上架。** 修正：保留这 1 个内部测试 SKU 可以，但必须确认它低价值、非共享、自动发货；公开主推商品必须先关。
- **本地 `http://localhost:8000/` 能打开购买弹层，就以为 D 开始了。** 修正：没有沙箱账号和可见浏览器证据，D 继续 blocked。
- **从 `codex/guest-shop-cash-purchase` 直接 vercel prod deploy。** 修正：发布仍须按 AGENTS.md 从最新 `main` 走 PR。
- **NOWPayments 用 USD 标价或非 `usdtbsc` 网络。** 修正：商品标价始终人民币；NOWPayments 只收 USDT-BEP20，按下单时人民币折算。

### 待执行任务清单（同步后）

- [x] 20260915 迁移已执行，不要重跑
- [x] 修正后的 verify 已重跑：1-7 PASS / 8 REVIEW
- [x] 用户确认 `enabled_count=1` 是主动测试准备，非代码故障
- [ ] 确认该 SKU：低价值、非共享、自动发货、非公开主推
- [ ] 补齐 CN ZPay 沙箱账号
- [ ] 补齐 INTL NOWPayments 沙箱账号（`usdtbsc`）
- [ ] 补齐主线程可见浏览器或真机
- [ ] 齐套后才开始 D 沙箱矩阵；每条案例按 D1 字段归档
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮无新增 SQL。已通过且不要再跑：

1. [20260915_guest_shop_credit_pricing.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260915_guest_shop_credit_pricing.sql)
2. [20260915_verify_guest_shop_credit_pricing.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260915_verify_guest_shop_credit_pricing.sql)

不重跑 20260913 / 20260914。上面的 `SELECT` 只是可选只读核对，不是迁移。Codex 不代执行。

## 26. 2026-09-15 D3-01 CN ZPay 已创建未付款 + 订单号展示修正

### 本轮做了什么

- 确认内部测试 SKU 就是 Gemini「测试 2」，标价 0.01 积分 = ¥0.01，KEY 自动发货、非共享、库存 42；没有打开第二个游客商品
- 从现有配置确认：没有独立 CN ZPay 沙箱 / INTL NOWPayments 沙箱密钥。CN 实际走现网易支付，INTL 实际走现网 NOWPayments `usdtbsc`
- 本地 preview `:8000` 与 Cloudflare tunnel 仍在；游客 webhook 指向该 tunnel，不打 KVM4
- Codex 可见浏览器打开 CN 商城游客购买弹窗，默认支付宝，应付金额 ¥0.01
- 已点击「创建支付订单」（这一步还没有扣款）。D1 字段：
  - 案例ID：D3-01
  - 站点：cn
  - 渠道：ZPay / alipay
  - 本站订单号：`GS2026091500585007432D22B143D38`
  - provider 订单号：`GS2026091500585007432D22B143D38`
  - 事件键：无（尚未回调）
  - 金额/币种：`0.01 CNY`
  - 期望状态：已确认并履约
  - 实际状态：订单 `pending` / 支付单 `created` / 预占 `held` / 履约 `pending`
  - 结果：进行中，待现网支付宝 ¥0.01 付款
- 边执行边修正：游客弹窗原先只显示取货口令、不显示订单号，找回文案却要求订单号。已在现有商品信息区增加「订单号」行，不改视觉风格。当前已打开的弹窗没有热更新，订单号先以本记录为准
- 前端契约测试 `tests/guest-shop-frontend-contract.test.js` 10/10 通过

### 本轮没做什么

- 没有打开支付宝支付页，没有真实扣款
- 没有执行任何 SQL，没有从功能分支 vercel prod deploy
- 没有开始 INTL D3，也没有把 D 或总进度改成完成/99%
- 没有把取货口令、卡密、claim token、支付密钥写入文档或日志

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 从 `blocked` 改为 `in_progress`，但 D3-01 未付款，D 的 18% 不计分。100% 只在第 J 节用户签署之后。

### 下一步

1. 用户确认后，才打开当前弹窗里的「打开支付页面」，用现网支付宝支付 ¥0.01
2. 支付成功后，用本地 `POST /api/shop/guest/worker` 履约，归档 D3-01 PASS 或 BLOCKED+原因
3. INTL D3 开始前，请用户执行：
   1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
   2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

### 风险和修正

- **现网扣款，不是沙箱。** 修正：金额固定 ¥0.01；付款前必须再确认；失败则 D3-01 记 BLOCKED+原因，不改价、不换 SKU
- **回调必须打到当前功能分支的 tunnel，不能打 KVM4。** 生产 JS 还没有积分价回退。修正：保持现有 `GUEST_SHOP_ZPAY_WEBHOOK_URL` 指向 trycloudflare，不改生产 webhook
- **订单号没显示在当前已打开弹窗。** 修正：代码已补，本单先用上面的订单号；用户请同时保存弹窗里一次性显示的取货口令，口令不会写入文档
- **INTL `price_points_intl` 为空时，数据库 create-order 仍可能失败。** 修正：CN 本单不受影响；INTL 等 20260916

### 待执行任务清单（同步后）

- [x] 确认测试 SKU：Gemini「测试 2」，0.01，自动发货，非共享
- [x] 可见浏览器已接上
- [x] D3-01 CN ZPay 创建未付款订单 `GS2026091500585007432D22B143D38`
- [x] 游客弹窗补订单号展示（当前打开的弹窗未热更新）
- [ ] 用户确认后完成现网支付宝 ¥0.01 付款
- [ ] 本地 worker 履约并归档 D3-01
- [ ] 继续 D3 其余案例；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要**为 CN D3-01 执行 SQL。不要重跑 20260913 / 20260914 / 20260915。

INTL create-order 开始前才需要用户执行：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。

## 27. 2026-09-15 D3-01 现网支付宝已付，履约被 42702 阻断

### 本轮做了什么

- 用户已用现网支付宝支付订单 `GS2026091500585007432D22B143D38`，金额 ¥0.01
- 本地 preview 已按生产顺序安装 guest webhook raw-body capture；无效签 form IPN 返回 `202 accepted=false`，不再是 `guest_webhook_raw_body_unavailable`
- ZPay 官方查单 `status=paid` / `trade_no=2026091523001409501422068607` 后，用官方查单字段 + 商户签名补进本地 webhook（D3-10 对账补偿，不是 mock）
- 支付已确认：`guest_shop_payment_orders.status=confirmed`，`paid_amount=0.01`，事件 `577d818d-0342-41f8-b53e-4603c5286679` `processed`
- 查清 confirm RPC **不会**消耗库存；履约由 worker 调 `fn_guest_shop_claim_fulfillment`
- worker 已跑过 1 次：`fulfillment_status=dead_letter`，`last_error_code=42702`，`column reference "fulfillment_status" is ambiguous`
- 原因：`RETURNS TABLE(fulfillment_status TEXT)` 使 `SELECT fulfillment_status FROM guest_shop_orders` 非法；RPC 整段回滚，所以库存仍 `reserve`、预占仍 `held`
- 已把 20260913 源 SQL 的 RETURN QUERY 改成表别名；新增 20260917 给已落地库热修
- 操作恢复（不是假支付）：TTL / 预占 / 支付过期时间延到 `2026-09-15T06:00:00Z`，避免修 SQL 期间过期释放
- 契约测试：`tests/guest-shop-atomic-rpcs-contract.test.js` + `tests/guest-shop-qualify-fulfillment-columns-sql-contract.test.js` **19/19 PASS**

### 本轮没做什么

- 没有把 D3-01 记成 PASS；货还没发出
- 没有解锁 dead_letter，没有再跑 worker（SQL 未落地前再跑会重复 42702）
- 没有执行/重跑 20260913 / 20260914 / 20260915 / 20260916
- 没有从功能分支 vercel prod deploy，没有打开第二个游客商品，没有改价
- 没有把取货口令、卡密、worker secret、支付密钥写入文档

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`，D3-01 未履约，D 的 18% 不计分。100% 只在第 J 节用户签署之后。

### 下一步

1. 用户现在执行 20260917 迁移和只读 verify（为已付款订单履约所必需，不等阶段 D 全部结束）
2. verify 全 PASS 后，Codex 解锁 D3-01 dead_letter，跑本地 `POST /api/shop/guest/worker`
3. 用可见浏览器点「查询支付状态」，确认 `delivered`；口令不写入文档
4. 按真实结果把 D3-01 记 PASS 或继续 BLOCKED+原因
5. INTL D3 开始前仍要执行 20260916，与本热修独立

### 风险和修正

- **已付款未发货。** 修正：不改价、不换 SKU、不退款；先修 RPC 列限定，再解锁并履约
- **dead_letter 会让 claim RPC 直接 `guest_payment_not_fulfillable`。** 修正：SQL 落地前不跑 worker；落地后用 admin unlock / 等价操作把履约从 dead_letter 拉回 `failed`
- **TTL 刚过 `2026-09-15T02:00:33Z`。** 修正：已延长到 `2026-09-15T06:00:00Z`；若再接近过期，继续延长，不让 expiry sweep 把已付款库存放回 available
- **生产 worker 若扫到同一行。** 修正：当前 `dead_letter` 会被跳过；解锁必须发生在 20260917 落地之后
- **现网扣款，不是沙箱。** 修正：金额保持 ¥0.01；失败则 D3-01 记 BLOCKED+原因，不换商品

### 待执行任务清单（同步后）

- [x] 确认测试 SKU：Gemini「测试 2」，0.01，自动发货，非共享
- [x] 可见浏览器已接上
- [x] D3-01 CN ZPay 创建订单 `GS2026091500585007432D22B143D38`
- [x] 现网支付宝 ¥0.01 已付，支付单 confirmed
- [x] 查清 42702 根因并写出 20260917
- [x] 用户执行 20260917 迁移和 verify（4/4 PASS，但仍不够）
- [ ] 用户执行 20260918 迁移和 verify
- [ ] 解锁 D3-01 dead_letter 并本地 worker 履约
- [ ] 可见浏览器确认 delivered，归档 D3-01 PASS 或 BLOCKED+原因
- [ ] 继续 D3 其余案例；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

有新增但未执行。不要重跑 20260913 / 20260914 / 20260915。为完成 D3-01 履约，请用户现在执行：

1. [20260917_guest_shop_qualify_fulfillment_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260917_guest_shop_qualify_fulfillment_columns.sql)
2. [20260917_verify_guest_shop_qualify_fulfillment_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260917_verify_guest_shop_qualify_fulfillment_columns.sql)

INTL create-order 开始前仍需要（本轮不要一起跑，除非用户明确要提前做）：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。

## 28. 2026-09-15 20260917 已落地但仍 42702，写出 20260918

### 本轮做了什么

- 用户已执行 20260917，verify 4/4 PASS（claim/release 的 RETURN QUERY 已加表别名）
- 官方 `fn_guest_shop_admin_unlock_dead_letter` 同样 42702：RETURNS TABLE 输出列与 `UPDATE ... SET fulfillment_status = CASE WHEN fulfillment_status ...` 冲突
- 等价解锁曾成功一次，随后生产 worker 抢跑调用 `fn_guest_shop_claim_fulfillment`，成功路径里的 SET-clause CASE 再次 42702，整段回滚，订单被重新打成 `dead_letter`
- 根因升级：20260917 只修 RETURN QUERY，没修 UPDATE SET 右侧未限定列名；verify 也只查 RETURN QUERY，所以 4/4 PASS 仍会运行失败
- 新增热修 [20260918_guest_shop_qualify_update_set_status_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260918_guest_shop_qualify_update_set_status_columns.sql)，把 claim / release / confirm / record-refund / queue-refund / unlock 的 CASE 右侧改成 `v_order.<column>`
- 同步改了 20260913 / 20260914 / 20260917 源 SQL，避免以后重跑旧定义
- 新增只读 verify [20260918_verify_guest_shop_qualify_update_set_status_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260918_verify_guest_shop_qualify_update_set_status_columns.sql)，断言函数体不再出现未限定 `WHEN fulfillment_status` / `THEN fulfillment_status` / `WHEN refund_status`
- 契约测试：`tests/guest-shop-qualify-update-set-sql-contract.test.js` + 既有 atomic/admin/20260917 测试 **31/31 PASS**
- 店铺弹窗仍开着，不要 reload，不要再创建订单

### 本轮没做什么

- 没有把 D3-01 记成 PASS；货还没发出
- 没有再次解锁 dead_letter，没有再跑 worker（20260918 落地前再解锁会被生产 worker 再次打回 dead_letter）
- 没有执行/重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917
- 没有从功能分支 vercel prod deploy，没有打开第二个游客商品，没有改价
- 没有把取货口令、卡密、worker secret、支付密钥写入文档

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`，D3-01 未履约，D 的 18% 不计分。100% 只在第 J 节用户签署之后。

### 下一步

1. 用户现在执行 20260918 迁移和只读 verify（为已付款订单履约所必需，不等阶段 D 全部结束）
2. verify 全 PASS 后，Codex 解锁 D3-01 dead_letter，立刻跑本地 `POST /api/shop/guest/worker`（不要带 body）
3. 用可见浏览器点「查询支付状态」，确认 `delivered`；若仍 403，用弹窗现有口令走「找回订单」，口令不写入文档
4. 按真实结果把 D3-01 记 PASS 或继续 BLOCKED+原因
5. INTL D3 开始前仍要执行 20260916，与本热修独立

### 风险和修正

- **已付款未发货。** 修正：不改价、不换 SKU、不退款；先落地 20260918，再解锁并履约
- **dead_letter 会让 claim RPC 直接 `guest_payment_not_fulfillable`。** 修正：20260918 落地前不解锁、不跑 worker
- **生产 worker 会抢跑。** 修正：SQL 未修好时抢跑会再次 42702；SQL 修好后抢跑也可以 delivered
- **TTL 仍是 `2026-09-15T06:00:00Z`。** 修正：当前 UTC `2026-09-15T02:52Z` 尚未接近；若再接近过期，继续延长，不让 expiry sweep 把已付款库存放回 available
- **现网扣款，不是沙箱。** 修正：金额保持 ¥0.01；失败则 D3-01 记 BLOCKED+原因，不换商品

### 待执行任务清单（同步后）

- [x] 确认测试 SKU：Gemini「测试 2」，0.01，自动发货，非共享
- [x] 可见浏览器已接上
- [x] D3-01 CN ZPay 创建订单 `GS2026091500585007432D22B143D38`
- [x] 现网支付宝 ¥0.01 已付，支付单 confirmed
- [x] 查清 42702 根因并写出 20260917
- [x] 用户执行 20260917 迁移和 verify（4/4 PASS，但仍不够）
- [x] 写出 20260918 SET-clause 热修和 verify
- [ ] 用户执行 20260918 迁移和 verify
- [ ] 解锁 D3-01 dead_letter 并本地 worker 履约
- [ ] 可见浏览器确认 delivered，归档 D3-01 PASS 或 BLOCKED+原因
- [ ] 继续 D3 其余案例；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

有新增但未执行。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917。为完成 D3-01 履约，请用户现在执行：

1. [20260918_guest_shop_qualify_update_set_status_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260918_guest_shop_qualify_update_set_status_columns.sql)
2. [20260918_verify_guest_shop_qualify_update_set_status_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260918_verify_guest_shop_qualify_update_set_status_columns.sql)

INTL create-order 开始前仍需要（本轮不要一起跑，除非用户明确要提前做）：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。

## 29. 2026-09-15 20260918 已落地，claim 吃库存后 mark_fulfilled 再 42702

### 本轮做了什么

- 用户已执行 20260918，verify 6/6 PASS（UPDATE SET CASE 已改成 `v_order.<column>`）
- 官方 `fn_guest_shop_admin_unlock_dead_letter` 成功：履约从 `dead_letter` 拉到 `failed`，worker metadata `fulfillment_status=retry_waiting`
- 本地 `POST http://127.0.0.1:8000/api/shop/guest/worker`（无 body）返回 200：`scanned=1 processed=1 delivered=0 dead_lettered=1`
- `fn_guest_shop_claim_fulfillment` 提交成功：预占 `consumed`，库存 `sold`
- 随后独立调用 `fn_guest_shop_mark_fulfilled` 因 `column reference "order_id" is ambiguous` 失败；worker 把该 SQLSTATE 当不可重试，第一次 attempt 就 dead_letter
- 根因升级：20260917 只修 RETURN QUERY；20260918 只修 UPDATE SET CASE，且明确不替换 `mark_fulfilled`。该函数 `RETURNS TABLE (..., order_id UUID, fulfillment_status TEXT, ...)`，函数体仍有未限定 `WHERE order_id = p_order_id` 和 `AND fulfillment_status <> 'delivered'`
- 同类未爆雷点一并修掉：`fn_guest_shop_admin_queue_refund` 的 `AND refund_status ...`，`fn_guest_shop_admin_manual_fulfill` 的 `WHERE order_id` / `AND payment_status` / `AND fulfillment_status`
- 新增热修 [20260919_guest_shop_qualify_where_out_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260919_guest_shop_qualify_where_out_columns.sql)
- 同步改了 20260913 `mark_fulfilled`、20260914 `queue_refund`/`manual_fulfill`、20260918 `queue_refund`（保持 20260918 与 20260914 函数体相等）
- 新增只读 verify [20260919_verify_guest_shop_qualify_where_out_columns.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260919_verify_guest_shop_qualify_where_out_columns.sql)
- 契约测试：`tests/guest-shop-qualify-where-out-sql-contract.test.js` + 既有 atomic/admin/20260917/20260918
- 当前不一致态：钱已付、货已从库存划走、订单未 delivered。claim 的 consumed 幂等路径可以再吐 content，但 claim 会先拒绝 `fulfillment_status=dead_letter`，所以仍要先 unlock 到 `failed`，而且必须等 mark_fulfilled 修好
- 店铺弹窗仍开着，不要 reload，不要再创建订单

### 本轮没做什么

- 没有把 D3-01 记成 PASS；货还没标 delivered
- 没有在 20260919 落地前再次解锁 dead_letter，也没有再跑 worker
- 没有执行/重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918
- 没有从功能分支 vercel prod deploy，没有打开第二个游客商品，没有改价，没有退款
- 没有把取货口令、卡密、worker secret、支付密钥写入文档

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`，D3-01 未履约，D 的 18% 不计分。100% 只在第 J 节用户签署之后。

### 下一步

1. ~~用户现在执行 20260919 迁移和只读 verify~~ 已执行，verify 6/6 PASS
2. 见第 30 节：unlock + 本地 worker + 浏览器确认已完成，D3-01 PASS

### 风险和修正

- **已付款、库存已消耗、订单未 delivered。** 修正：不改价、不换 SKU、不退款、不再消耗第二张卡；先落地 20260919，再解锁并履约
- **dead_letter 会让 claim RPC 直接 `guest_payment_not_fulfillable`，发生在 consumed 幂等返回之前。** 修正：20260919 落地前不解锁、不跑 worker
- **TTL 对 held 预占才危险；当前预占已 consumed。** 修正：expiry sweep 不应把已 sold 库存放回 available；仍不要乱改 TTL
- **生产 worker 可能抢跑。** 修正：SQL 未修好时抢跑会再次 42702；SQL 修好后抢跑也可以 delivered
- **现网扣款，不是沙箱。** 修正：金额保持 ¥0.01；失败则 D3-01 记 BLOCKED+原因，不换商品

### 待执行任务清单（同步后）

- [x] 确认测试 SKU：Gemini「测试 2」，0.01，自动发货，非共享
- [x] 可见浏览器已接上
- [x] D3-01 CN ZPay 创建订单 `GS2026091500585007432D22B143D38`
- [x] 现网支付宝 ¥0.01 已付，支付单 confirmed
- [x] 查清 42702 根因并写出 20260917
- [x] 用户执行 20260917 迁移和 verify（4/4 PASS，但仍不够）
- [x] 写出 20260918 SET-clause 热修和 verify
- [x] 用户执行 20260918 迁移和 verify（6/6 PASS，但仍不够）
- [x] 写出 20260919 WHERE OUT-column 热修和 verify
- [x] 用户执行 20260919 迁移和 verify（6/6 PASS）
- [x] 解锁 D3-01 dead_letter 并本地 worker 履约
- [x] 可见浏览器确认 delivered，归档 D3-01 PASS
- [ ] 继续 D3 其余案例；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

20260919 已由用户执行，verify 6/6 PASS。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

INTL create-order 开始前仍需要（本轮不要一起跑，除非用户明确要提前做）：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。

## 30. 2026-09-15 20260919 已落地，D3-01 已 delivered

### 本轮做了什么

- 用户已执行 20260919，verify 6/6 PASS（WHERE OUT 列已加表别名）
- 查库确认不一致态仍在：支付 confirmed、预占 consumed、库存 sold、履约 dead_letter、`last_error_code=42702`
- 官方 `fn_guest_shop_admin_unlock_dead_letter` 成功：履约 `dead_letter → failed`，worker metadata `fulfillment_status=retry_waiting`，attempt=0
- 立刻本地 `POST http://127.0.0.1:8000/api/shop/guest/worker`（无 body）返回 200：`scanned=1 processed=1 delivered=1 dead_lettered=0`
- 再查库：订单 `GS2026091500585007432D22B143D38` / `6b31e1b4-ef71-47ab-979d-26e6ee4e0cda` 现为 `payment_status=confirmed`，`fulfillment_status=delivered`，`reservation_status=consumed`，`refund_status=none`，`fulfilled_at=2026-09-15T03:42:28.412784Z`，`last_error_code=null`
- 预占 `338d689e-313a-4953-b307-bbc7c27e57ee` 仍 consumed；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold / 非共享
- 可见浏览器点「查询支付状态」因设备 cookie 403；用弹窗已有口令走「找回订单」后，页面显示「支付已确认，订单已发货。」，发货面板可见。口令与卡密不写入文档
- D3-01 / D3-13 / D3-17 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919
- 没有从功能分支 vercel prod deploy，没有打开第二个游客商品，没有改价，没有退款
- 没有把取货口令、卡密、worker secret、支付密钥写入文档

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 继续 D3 其余 CN 案例。优先 D3-04 重复回调（重放已付款事件，期望幂等、不二次发货），再 D3-03 假回调
2. D3-02 未付款过期需要另建未付款单，不要动已 delivered 的 D3-01，也不要再开第二个游客商品
3. INTL D3 开始前仍要执行 20260916，与本轮独立
4. 不要 reload 店铺页去再点「创建支付订单」，不要退款，不要换 SKU

### 风险和修正

- **已 delivered 的库存不可再划回。** 修正：后续案例不要对 D3-01 做 expiry sweep、不要手工改库存、不要退款除非专门跑 D3-15
- **设备 cookie 丢失会 403。** 修正：跨设备必须走订单号+口令；口令不写入日志/文档
- **生产 worker 可能再扫到已 delivered 单。** 修正：delivered 必须幂等 skip，不得再次 claim 新库存
- **现网扣款，不是沙箱。** 修正：不再为 D3-01 扣第二笔；后续需要真支付的案例单独建单并保持 ¥0.01
- **INTL 仍缺 20260916。** 修正：不提前跑 INTL create-order

### 待执行任务清单（同步后）

- [x] 确认测试 SKU：Gemini「测试 2」，0.01，自动发货，非共享
- [x] 可见浏览器已接上
- [x] D3-01 CN ZPay 创建订单 `GS2026091500585007432D22B143D38`
- [x] 现网支付宝 ¥0.01 已付，支付单 confirmed
- [x] 查清 42702 根因并写出 20260917 / 20260918 / 20260919
- [x] 用户执行 20260917 / 20260918 / 20260919 迁移和 verify
- [x] 解锁 D3-01 dead_letter 并本地 worker 履约
- [x] 可见浏览器确认 delivered，归档 D3-01 / D3-13 / D3-17 PASS
- [ ] 继续 D3 其余案例；优先 D3-04 重复回调、D3-03 假回调；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。20260919 已执行并通过。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

INTL create-order 开始前仍需要（本轮不要一起跑，除非用户明确要提前做）：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。


## 31. 2026-09-15 D3-04 重复回调 PASS

### 本轮做了什么

- 从已处理事件 `577d818d-0342-41f8-b53e-4603c5286679` 的 `payload_redacted` 还原非敏感字段，用现网 ZPay 密钥重签，并按原 `body_sha256` 对齐表单字段顺序
- 将同一已付款 ZPay 回调 POST 到本地 preview `http://127.0.0.1:8000/api/shop/guest/webhooks/zpay`
- HTTP 200：`{ success: true, accepted: true, duplicate: true }`
- 重放前后对照：
  - 订单 `GS2026091500585007432D22B143D38` 仍 `payment_status=confirmed` / `fulfillment_status=delivered` / `reservation_status=consumed` / `refund_status=none`
  - `fulfilled_at` 仍是 `2026-09-15T03:42:28.412784Z`，`paid_at` 仍是 `2026-09-15T01:48:46.722452Z`
  - 支付事件仍只有 1 条，`processing_status=processed`，`event_key` 不变
  - 预占 `338d689e-313a-4953-b307-bbc7c27e57ee` 仍 consumed
  - 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold / 非共享；该 SKU 仍是 sold=1 / available=41
- D3-04 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有新扣款，没有新 SKU，没有退款，没有 unlock，没有再跑履约 worker
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919
- 没有从功能分支 vercel prod deploy
- 没有把取货口令、卡密、worker secret、支付密钥写入文档

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-03 假回调：对同一订单 POST 伪造签名，期望拒绝、不发货、不改 D3-01 终态
2. D3-02 未付款过期必须另建未付款单，不要动已 delivered 的 D3-01
3. INTL D3 开始前仍要执行 20260916，与本轮独立
4. 不要 reload 店铺页去再点「创建支付订单」，不要退款，不要换 SKU

### 风险和修正

- **已 delivered 的库存不可再划回。** 修正：后续案例不要对 D3-01 做 expiry sweep、不要手工改库存、不要退款除非专门跑 D3-15
- **重复回调若字段顺序不同，会变成 `event_key_body_conflict` 而不是 `duplicate`。** 修正：D3-04 已按原 `body_sha256` 对齐真实表单体；业务上两种路径都不得二次发货
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-04 重放前就存在的取货凭证失败痕迹，不是本轮回归。修正：不要为清这个字段再 claim/unlock；D3-03 继续以 delivered 终态为准
- **现网扣款，不是沙箱。** 修正：不再为 D3-01 扣第二笔
- **INTL 仍缺 20260916。** 修正：不提前跑 INTL create-order

### 待执行任务清单（同步后）

- [x] 确认测试 SKU：Gemini「测试 2」，0.01，自动发货，非共享
- [x] 可见浏览器已接上
- [x] D3-01 CN ZPay 创建订单 `GS2026091500585007432D22B143D38`
- [x] 现网支付宝 ¥0.01 已付，支付单 confirmed
- [x] 查清 42702 根因并写出 20260917 / 20260918 / 20260919
- [x] 用户执行 20260917 / 20260918 / 20260919 迁移和 verify
- [x] 解锁 D3-01 dead_letter 并本地 worker 履约
- [x] 可见浏览器确认 delivered，归档 D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [ ] 继续 D3 其余案例；下一步 D3-02 未付款过期（另建未付款单）；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。20260919 已执行并通过。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

INTL create-order 开始前仍需要（本轮不要一起跑，除非用户明确要提前做）：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。


## 32. 2026-09-15 D3-03 假回调 PASS

### 本轮做了什么

- 对 D3-01 同一商户订单号构造伪造 `sign` 的 ZPay 表单，POST 到本地 preview `http://127.0.0.1:8000/api/shop/guest/webhooks/zpay`
- HTTP 202：`{ success: true, accepted: false }`
- 原业务事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 `processed` / `signature_verified=true`，event_key 未被假回调占用
- 新审计事件 `43b073b9-0ad8-4c5e-88fc-e9c73cb979e4`：`processing_status=rejected`，`signature_verified=false`，`error_code=guest_webhook_verification_failed`，event_key 属于 `zpay:invalid-bucket:...`
- 订单终态未变：`confirmed` / `delivered` / `consumed` / `none`；`fulfilled_at` 仍是 `2026-09-15T03:42:28.412784Z`
- 预占仍 consumed，库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；SKU 仍 sold=1 / available=41
- D3-03 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有新扣款，没有退款，没有 unlock，没有再跑履约 worker
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-02 未付款过期：必须另建未付款单，不要动已 delivered 的 D3-01，也不要再开第二个游客商品
2. 之后再评估仍可不扣款完成的 CN 案例；需要真支付的保持 ¥0.01 并单独建单
3. INTL D3 开始前仍要执行 20260916
4. 不要 reload 店铺页去再点「创建支付订单」，不要退款

### 风险和修正

- **假回调若占用业务 event_key，合法回调会被当成 duplicate。** 本轮已确认伪造签名进入 invalid-bucket，没有抢业务键
- **已 delivered 库存不可再划回。** D3-02 必须新单，禁止对 D3-01 做 expiry sweep
- **订单上已有 `last_error_code=guest_claim_invalid`。** 假回调前后都存在，不是 D3-03 引入
- **INTL 仍缺 20260916。** 不提前跑 INTL create-order

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [ ] D3-02 未付款过期：另建未付款单并释放预占
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

INTL create-order 开始前仍需要：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。

## 33. 2026-09-15 D3-02 未付款过期 PASS

### 本轮做了什么

- 另建未付款单 `GS202609150429213472D4D87B04A50` / `e59d7bc1-b182-4a46-9c68-7b505e1197bf`（CN ZPay/alipay，¥0.01，同一测试 SKU Gemini「测试 2」）
- 创建时预占 `4c93bd92-2b91-41f1-a145-da48b7a35c8b` `held`，库存 `0ac8f64a-bf2a-4df9-99ee-819e8908d018` `reserve`；SKU 从 available=41 / sold=1 变为 available=40 / reserve=1 / sold=1
- TTL 官方下限 300s：`expires_at` / `reserved_until=2026-09-15T04:34:21.347977Z`。checkout host `qr.alipay.com`，**没有付款**
- 到期后本地官方 `POST http://127.0.0.1:8000/api/shop/guest/worker`（无 body）返回 200：`expired_reservations=1`，`scanned=0 processed=0 delivered=0`
- 释放后：预占 `released` / `release_reason=expired` / `released_at=2026-09-15T04:35:12.329282Z`；库存回到 `available`；订单仍 `payment_status=pending`、`fulfillment_status=pending`、`refund_status=none`、未付未履约
- 支付单 `818e4efb-ede8-4224-bd0c-e0aa68867bcd` 仍 `created` / expected 0.01，未确认
- D3-01 `GS2026091500585007432D22B143D38` 仍 `confirmed` / `consumed` / `delivered` / `none`；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；SKU 回到 available=41 / sold=1
- 本地 preview 已从 TTL=300 恢复为 `.env.local` 默认 1800；tunnel 未动。D3-02 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有改 `.env.local` 里的 TTL=1800

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-05 乱序回调：对已 delivered 的 D3-01 补发更早状态的 ZPay 回调（wait/created），期望不回退终态、不改库存、不二次发货
2. 之后优先仍可不扣款完成的 CN 案例：D3-06/D3-07/D3-08 金额或币种不匹配、D3-20 充值/游客回调隔离。需要真支付的保持 ¥0.01 并单独建单
3. INTL D3 开始前仍要执行 20260916
4. 不要 reload 店铺页去再点「创建支付订单」，不要付款 D3-02，不要退款

### 风险和修正

- **expiry sweep 可能误伤已 delivered 库存。** 本轮已确认 D3-01 sold/delivered 未被划回；后续仍禁止拿 D3-01 当过期样本
- **已过期未付款单若补合法 paid 回调，可能变成 paid_unfulfillable 或再次占库存。** 修正：不要给 D3-02 补付款或补合法 paid 回调
- **preview TTL=300 只用于本案例。** 修正：已恢复默认 1800，后续新单不要再依赖 5 分钟 TTL
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock
- **INTL 仍缺 20260916。** 不提前跑 INTL create-order

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [ ] D3-05 乱序回调：对 D3-01 补发更早状态回调，不回退 delivered
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] INTL 开始前执行 20260916 迁移和 verify
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

INTL create-order 开始前仍需要：

1. [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
2. [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)

Codex 不代执行。

## 34. 2026-09-15 20260916 INTL 积分价回退 3/3 PASS

### 本轮做了什么

- 用户已执行：
  - [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql)
  - [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)
- 用户回传 3/3 `PASS`：
  1. `intl_fallback_helper_present`
  2. `intl_fallback_helper_grants`
  3. `intl_missing_points_reuse_cn`
- 含义：INTL create-order 在缺国际积分价时回退复用 CN 积分价，数量固定 1，不回落到商品标价。闸门已解除。当前库里仍只有 1 个游客测试 SKU，不要新开
- 本轮没有据此创建 INTL 订单，也没有 NOWPayments 扣款

### 本轮没做什么

- 没有执行/重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919
- 没有从功能分支 vercel prod deploy
- 没有打开第二个游客商品，没有改价
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`。100% 只在第 J 节用户签署之后。

### 下一步

1. 先把已跑完的 D3-05 乱序回调写入证据，再继续 CN 不扣款案例
2. 不要本轮立刻新开 INTL 扣款

### 风险和修正

- **INTL 现可 create-order，不等于可以开始扣款。** 修正：仍用同一测试 SKU；NOWPayments 网络固定 `usdtbsc`；商品标价 CNY；USDT 按充值同一套汇率折算，不得把 USD quote 当结算币种
- **不要重跑已 PASS 的 20260913–20260919**

### 待执行任务清单（同步后）

- [x] 20260916 迁移和 verify 3/3 PASS
- [ ] D3-05 乱序回调证据回写
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品

### SQL 状态

本轮 SQL 已由用户执行并通过。**不要重跑** 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 35. 2026-09-15 D3-05 乱序回调 PASS

### 本轮做了什么

- 对已 delivered 的 D3-01 `GS2026091500585007432D22B143D38` 用真实 ZPay 商户密钥重签，把 `trade_status` 从 `TRADE_SUCCESS` 改成 `WAIT_BUYER_PAY`，POST 本地 preview `http://127.0.0.1:8000/api/shop/guest/webhooks/zpay`
- HTTP **202** `{ success:true, accepted:false }`
- 新事件 `27ed9756-e976-4fcd-91aa-83d8e7ccaa19`：
  - `event_key` 属于 `zpay:invalid-bucket:...`
  - `processing_status=rejected`
  - `observed_status=pending`
  - `signature_verified=true`（与 D3-03 假签名不同）
  - `amount_verified=true` / `currency_verified=true` / `final_status_verified=false`
  - `error_code=guest_webhook_verification_failed`（非终态即使签名正确也不会 `confirm_payment`，`valid` 要求 `isFinalPaymentStatus`）
- 原业务事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 `processed` / `observed_status=paid` / `signature_verified=true`
- D3-01 终态未变：`confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784+00:00`
- 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 **sold**
- D3-02 未被碰到：预占仍 `released`，库存 `0ac8f64a-bf2a-4df9-99ee-819e8908d018` 仍 **available**，支付仍 pending
- SKU 仍 available=41 / sold=1
- 证据：`/tmp/d3-05-out-of-order-evidence.json`。D3-05 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 补付款或补合法 paid 回调
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有改业务代码；本轮只补文档并继续 CN 不扣款案例

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-06 少付：对已 delivered 的 D3-01 重签，把 `money` 改小（如 `0.00`），期望拒绝/review，不改 delivered，不改金额
2. 然后 D3-07 多付、D3-08 错币种、D3-20 充值/游客回调隔离
3. 需要真支付的保持 ¥0.01 并单独建单。INTL 现可 create-order，但不要本轮立刻新扣款
4. 不要 reload 店铺页去再点「创建支付订单」，不要付款 D3-02，不要退款

### 风险和修正

- **乱序非终态回调即使签名正确也不得回退 delivered。** 本轮已确认 D3-01 sold/delivered 未被划回；后续金额/币种异常回调同样禁止改终态
- **已过期未付款单若补合法 paid 回调，可能变成 paid_unfulfillable 或再次占库存。** 修正：不要给 D3-02 补付款或补合法 paid 回调
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock
- **INTL 闸门已开，不等于开始扣款。** 修正：仍用同一测试 SKU；NOWPayments 网络固定 `usdtbsc`；标价 CNY；不得把 USD quote 当结算币种

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [ ] D3-06 少付：对 D3-01 重签改小金额，不改 delivered / 不改金额
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 36. 2026-09-15 D3-06 少付 PASS

### 本轮做了什么

- 对已 delivered 的 D3-01 `GS2026091500585007432D22B143D38` 用真实 ZPay 商户密钥重签，把 `money` 从 `0.01` 改成 `0.00`，保持 `TRADE_SUCCESS`，POST 本地 preview `http://127.0.0.1:8000/api/shop/guest/webhooks/zpay`
- HTTP **202** `{ success:true, accepted:false }`
- 新事件 `18552844-665c-40ef-a057-ec6b8a08107b`：
  - `event_key` 属于 `zpay:invalid-bucket:...`
  - `processing_status=rejected`
  - `observed_status=paid`
  - `observed_amount=0`
  - `signature_verified=true`
  - `amount_verified=false` / `currency_verified=true` / `final_status_verified=true`
  - `error_code=guest_webhook_verification_failed`
- 原业务事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 `processed` / `observed_amount=0.01` / `amount_verified=true`
- 支付单 `152be175-4c1b-4d40-8236-2b25d6e39dbc` 仍 `confirmed`，`expected_amount=0.01`，`paid_amount=0.01`，金额未被改小
- D3-01 终态未变：`confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784+00:00`
- 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 **sold**；SKU available=41 / sold=1
- D3-02 仍 released / available / pending
- 证据：`/tmp/d3-06-underpay-evidence.json`。D3-06 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 补付款或补合法 paid 回调
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-07 多付：对已 delivered 的 D3-01 重签，把 `money` 改大（如 `1.00`），期望拒绝/review，不改 delivered，不改金额
2. 然后 D3-08 错币种、D3-20 充值/游客回调隔离
3. 需要真支付的保持 ¥0.01 并单独建单。INTL 现可 create-order，但不要本轮立刻新扣款
4. 不要 reload 店铺页去再点「创建支付订单」，不要付款 D3-02，不要退款

### 风险和修正

- **少付终态回调即使签名正确也不得改金额、不得回退 delivered。** 本轮已确认 `paid_amount` 仍 0.01，库存仍 sold
- **已过期未付款单若补合法 paid 回调，可能变成 paid_unfulfillable 或再次占库存。** 修正：不要给 D3-02 补付款或补合法 paid 回调
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock
- **INTL 闸门已开，不等于开始扣款。** 修正：仍用同一测试 SKU；NOWPayments 网络固定 `usdtbsc`；标价 CNY；不得把 USD quote 当结算币种

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [ ] D3-07 多付：对 D3-01 重签改大金额，不改 delivered / 不改金额
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 37. 2026-09-15 D3-07 多付 PASS

### 本轮做了什么

- 对已 delivered 的 D3-01 `GS2026091500585007432D22B143D38` 用真实 ZPay 商户密钥重签，把 `money` 从 `0.01` 改成 `1.00`，保持 `TRADE_SUCCESS`，POST 本地 preview `http://127.0.0.1:8000/api/shop/guest/webhooks/zpay`
- 第一次落在 D3-06 同一 5 分钟 invalid-bucket（`5964831`），返回 202 `{accepted:false, code:event_key_body_conflict}`，未改终态
- 等 bucket `5964832` 后重放成功写入审计事件：HTTP **202** `{ success:true, accepted:false }`
- 新事件 `75bcb4c4-ee17-4fdf-9495-bb6f9e5778f3`：
  - `event_key` 属于 `zpay:invalid-bucket:5964832:...`
  - `processing_status=rejected`
  - `observed_status=paid`
  - `observed_amount=1`
  - `signature_verified=true`
  - `amount_verified=false` / `currency_verified=true` / `final_status_verified=true`
  - `error_code=guest_webhook_verification_failed`
- 原业务事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 `processed` / `observed_amount=0.01`
- 支付单 `152be175-4c1b-4d40-8236-2b25d6e39dbc` 仍 `confirmed`，`expected_amount=0.01`，`paid_amount=0.01`，金额未被改大
- D3-01 终态未变：`confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784+00:00`
- 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 **sold**；SKU available=41 / sold=1
- D3-02 仍 released / available / pending
- 证据：`/tmp/d3-07-overpay-evidence.json`、`/tmp/d3-07-overpay-verdict.json`。D3-07 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 补付款或补合法 paid 回调
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-08 错币种：CN ZPay 结算币种由站点推导为 CNY，payload 里的 currency 可能被忽略；若渠道无法独立表达错币种，记 BLOCKED+原因，把真实错币种放到 INTL NOWPayments
2. D3-20 充值/游客回调隔离：游客已付回调打到 `/api/payments/zpay/webhook` 不得加积分；充值回调打到游客 webhook 不得给 D3-01 发货
3. 需要真支付的保持 ¥0.01 并单独建单。INTL 现可 create-order，但不要本轮立刻新扣款
4. 不要 reload 店铺页去再点「创建支付订单」，不要付款 D3-02，不要退款

### 风险和修正

- **同一 IP 的 invalid-bucket 窗口是 5 分钟。** 连续异常回调会 `event_key_body_conflict`，这是拒绝而不是接受；要留下独立审计事件必须等下一个 bucket
- **多付终态回调即使签名正确也不得改金额、不得回退 delivered。** 本轮已确认 `paid_amount` 仍 0.01，库存仍 sold
- **已过期未付款单若补合法 paid 回调，可能变成 paid_unfulfillable 或再次占库存。** 修正：不要给 D3-02 补付款或补合法 paid 回调
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock
- **INTL 闸门已开，不等于开始扣款。** 修正：仍用同一测试 SKU；NOWPayments 网络固定 `usdtbsc`；标价 CNY；不得把 USD quote 当结算币种

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [ ] D3-08 错币种
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 38. 2026-09-15 D3-20 充值/游客回调隔离 PASS

### 本轮做了什么

- 补齐本地 preview 缺失的独立入口 [`api/payments/zpay/webhook.js`](/Volumes/chao/AI/xianyu_profit_calculator/api/payments/zpay/webhook.js)，与现有 [`api/payments/nowpayments/webhook.js`](/Volumes/chao/AI/xianyu_profit_calculator/api/payments/nowpayments/webhook.js) 同构；不改充值入账或游客发货业务逻辑
- 先只读确认 `payment_orders` 没有 `GS2026091500585007432D22B143D38`，`points_ledger` 没有 `zpay_GS2026091500585007432D22B143D38`，避免误命中后走现网 `queryOrder` / 加积分
- 方向 A：把 D3-01 已付 ZPay 体重签后打到充值入口 `POST http://127.0.0.1:8000/api/payments/zpay/webhook`
  - HTTP **503** 纯文本 `payment order not ready`
  - 充值 handler 先 `recordPaymentEvent` 再 `deletePaymentEvent`，**没有**调用 `rechargePointsForPayment`
  - 之后 `payment_orders` 仍 0 条该游客单，`points_ledger` 仍 0 条该 reference，`payment_events` 无残留
- 方向 B：取一笔已存在的 ZPay 充值单 `ZPA6A4FEC49A2FBBCF29BCA108546C30`（`redeemed` / `0.02` / site=intl；不打印 user_id/email），重签后打到游客入口 `POST http://127.0.0.1:8000/api/shop/guest/webhooks/zpay`
  - HTTP **202** `{ success:true, accepted:false }`
  - 新事件 `25be3fb8-841a-4955-927c-f4145283dd9e`：`zpay:invalid-bucket:5964836:...` / rejected / `payment_order_id=null` / `signature_verified=true` / `amount_verified=false` / `currency_verified=false`
  - 未调用 `fn_guest_shop_confirm_payment`，未给 D3-01 发货
- D3-01 终态未变：`confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784+00:00`
- 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 **sold**；SKU available=41 / sold=1
- 充值单仍 `redeemed`，`paid_amount=0.02` 未变
- 证据：`/tmp/d3-20-isolation-evidence.json`、`/tmp/d3-20-isolation-verdict.json`。D3-20 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 补付款或补合法 paid 回调
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email 或积分余额

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20 PASS，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-08 错币种：CN ZPay 结算币种由站点推导为 CNY，binding 用 `expected.currency` 对比自身，payload 里的 `currency` 可能被忽略。**不要**用「金额正确 + 只改 currency」去打已 delivered 的 D3-01，以免插入新的 business processed 事件。若渠道无法独立表达错币种，记 `BLOCKED+ZPay currency is site-derived`，把真实错币种放到 INTL NOWPayments
2. 之后仍可不扣款：D3-11/D3-12 等。需要真支付的保持 ¥0.01 并单独建单。INTL 现可 create-order，但不要本轮立刻新扣款
3. 不要 reload 店铺页去再点「创建支付订单」，不要付款 D3-02，不要退款

### 风险和修正

- **游客已付回调打到充值入口，找不到充值单时返回 503。** 这是拒绝入账，不是接受。ZPay 官方若收到 503 可能重试，但重试同样找不到充值单，不会加积分
- **不要用「金额正确 + 只改 currency」重放 D3-01。** `confirm_payment` 对已 consumed/delivered 幂等，不会划回库存，但会新插 business processed 事件污染 D3-01 日志
- **同一 IP 的 invalid-bucket 窗口是 5 分钟。** 连续异常回调会 `event_key_body_conflict`；本轮 reverse 事件落在 bucket `5964836`，未冲突
- **已过期未付款单若补合法 paid 回调，可能变成 paid_unfulfillable 或再次占库存。** 修正：不要给 D3-02 补付款或补合法 paid 回调
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock
- **INTL 闸门已开，不等于开始扣款。** 修正：仍用同一测试 SKU；NOWPayments 网络固定 `usdtbsc`；标价 CNY；不得把 USD quote 当结算币种

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [ ] D3-08 错币种
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 39. 2026-09-15 D3-08 错币种 BLOCKED+ZPay currency is site-derived

### 本轮做了什么

- 按合同收口 D3-08，**没有**用「金额正确 + 只改 currency」去打已 delivered 的 D3-01，也没有给 D3-02 补合法 paid 回调
- 用真实 [`api/_lib/payments/guest-shop-adapter.js`](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/guest-shop-adapter.js) `parseGuestWebhook` 证明：ZPay payload `currency=USD` + `site=cn/intl` 都会被写成 `CNY`；只有不传 site 时才保留 payload 币种。生产 webhook 始终传入 `expected?.site || 'cn'`
- 用真实 [`server/api-handlers/public/guest-shop.js`](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js) `providerQuoteChecks` 证明：非 NOWPayments 直接 `{valid:true}`
- 用真实 [`api/_lib/guest-shop/security.js`](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/guest-shop/security.js) 证明：`SITE_CURRENCIES = {cn:'CNY', intl:'CNY'}`；生产 binding 的 `received.currency` 用的是 `expected.currency`，自己和自己比。若诚实传入 payload `USD`，`checks.currency` 才会失败
- 用真实 handler + 真实 parser 做 in-process 对照：签名视为通过、`money=0.01`、`currency=USD` 时 HTTP **200** `{accepted:true}`，会调用 `fn_guest_shop_confirm_payment`，且 `p_observed_currency=CNY`。这正是不能对 D3-01 打 live 重放的原因
- NOWPayments 侧已证明渠道**能**独立表达错币种：`actually_paid_currency=usdttrc20` → `wrong_asset`；quote `usd` vs 订单 `cny` → `providerQuoteChecks.failures=['quote']`
- 只读核对 D3-01 / D3-02 / 库存未变：事件仍 5 条；`confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784+00:00`；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；SKU available=41 / sold=1；D3-02 仍 released / available
- 证据：`/tmp/d3-08-currency-evidence.json`、`/tmp/d3-08-currency-verdict.json`。D3-08 记 `BLOCKED+ZPay currency is site-derived`。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 补付款或补合法 paid 回调
- 没有对 D3-01 发送 live 错币种 webhook
- 没有为“补” CN 错币种闸门改业务代码
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email 或积分余额

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20 PASS，D3-08 BLOCKED+原因，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-11 provider 超时、D3-12 provider 结果未知进入 `review`：继续 CN 不扣款案例。不要 reload 店铺页去再点「创建支付订单」；若 D3-11 必须新建未付款单，先停下来说明，不要自行连点创建
2. 真实错币种 / 错网络放到 INTL NOWPayments（D3-08 真实覆盖 + D3-09 `usdtbsc`）。INTL 现可 create-order，但不要本轮立刻新扣款
3. 不要付款 D3-02，不要退款，不要打开第二个游客商品

### 风险和修正

- **金额正确 + 只改 currency 的 ZPay 回调在生产路径上会被当成合法 CNY 支付。** 修正：CN D3-08 记 BLOCKED，不打 live；真实错币种用 NOWPayments 的 quote / `actually_paid_currency`
- **已 delivered 订单的 `confirm_payment` 对 consumed/delivered 幂等，不会划回库存，但会新插 business processed 事件。** 修正：本轮只做 in-process 对照，未打 live
- **已过期未付款单若补合法 paid 回调，可能变成 paid_unfulfillable 或再次占库存。** 修正：不要给 D3-02 补付款或补合法 paid 回调
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock
- **INTL 闸门已开，不等于开始扣款。** 修正：仍用同一测试 SKU；NOWPayments 网络固定 `usdtbsc`；标价 CNY；不得把 USD quote 当结算币种
- **同一 IP 的 invalid-bucket 窗口是 5 分钟。** 后续异常回调若打 live，注意 `event_key_body_conflict`

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 40. 2026-09-15 D3-11/D3-12 现有订单无法进入创建租约

### 本轮做了什么

- 按合同调查 D3-11 provider 超时 / D3-12 结果未知进 `review`，**没有** reload 店铺页，**没有**点「创建支付订单」，**没有**新建未付款单，**没有**打 webhook，**没有**改业务代码去补闸门
- 只读核对库内全部游客单（3 笔）和 `purpose=shop_direct` 支付行：
  - D3-01 `GS2026091500585007432D22B143D38`：`confirmed` / `consumed` / `delivered`；支付单 `confirmed` 且已有 `provider_order_no`；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；事件仍 5 条
  - D3-02 `GS202609150429213472D4D87B04A50`：订单 `payment_status=pending`，预占 `released/expired`，支付单 `status=created` 且已有 `provider_order_no` + checkout；库存 `0ac8f64a-bf2a-4df9-99ee-819e8908d018` 仍 available
  - 更早未付款单 `GS2026091501055434718EEA66572FC`：同样是预占 released/expired，支付单 `created` 且已有 `provider_order_no`
- 创建租约只在 `guest_shop_payment_orders.status=pending` 且 `last_error_*` 为空、且还没有 `provider_order_no` 时才会调用 `createGuestPayment`。当前：pending 支付行 0、review 0、lease 0、created-without-ref 0
- 因此复用现单只会走这些路径，**碰不到超时/未知结果**：
  1. D3-01 confirmed → 回放，不再创建支付
  2. D3-02 / 早期未付款单已有 provider 引用 → `buildStoredCheckout` 回放，不再调用 ZPay
  3. 若支付行已是 `review/created/failed/expired` 且缺引用 → 503 `guest_payment_reconciliation_required`，同样不第二次下单
- 代码路径（只读，未改）：[`server/api-handlers/public/guest-shop.js`](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js) `acquirePaymentCreationLease` / `markPaymentCreationReview`；ZPay `requestZpayJson` 无 AbortSignal，网络失败抛无 `code` 的 Error，会被收成 `payment_creation_unknown` → `review`，而 `gatewayCode !== '1'` 才是 definitive `guest_provider_create_failed` 并释放预占
- 自动化对照（**不得当作 D 的 PASS**）：`tests/guest-shop-orders-idempotency.test.js` 已覆盖并发只拿一个 lease、stale lease fail-closed 不发第二张 provider 单
- 证据：`/tmp/d3-11-readonly-snapshot.json`。D3-11/D3-12 仍未记 PASS/BLOCKED。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 补付款或补合法 paid 回调
- 没有 reload 店铺页，没有点「创建支付订单」，没有用新 idempotency key 调 create-order
- 没有用 mock/单元测试把 D3-11/D3-12 记 PASS
- 没有为“补超时闸门”改 `requestZpayJson` 或业务代码
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email 或积分余额

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20 PASS，D3-08 BLOCKED+原因，D3-11/D3-12 调查完成但未跑真实超时。100% 只在第 J 节用户签署之后。

### 下一步

1. **等待用户确认**：是否允许 Codex 用 API（不 reload 店铺页、不点「创建支付订单」、不付款）新建一笔同一测试 SKU 的 ¥0.01 CN ZPay 未付款 pending 单，并在调用易支付 mapi 时用本机网络层制造超时/丢响应。用于同时收口 D3-11（租约期内重试 409，不第二次下单）和 D3-12（未知结果进 `review`，再重试 503，不重复扣款）
2. 若用户不同意新建单，D3-11/D3-12 只能记 `BLOCKED+needs new unpaid pending order`，不能用 mock 顶
3. 真实错币种 / 错网络仍放到 INTL NOWPayments；本轮仍不新扣款。不要付款 D3-02，不要退款，不要打开第二个游客商品

### 风险和修正

- **现有 created 支付行若被强行再次调用 ZPay，会生成第二张渠道单。** 修正：现单全部已有 `provider_order_no`，本轮不重放 create-order，不拿它们做超时实验
- **已过期未付款单若补合法 paid 回调，可能变成 paid_unfulfillable 或再次占库存。** 修正：不要给 D3-02 / `GS2026091501055434718EEA66572FC` 补付款或补合法 paid 回调
- **新建 pending 单会再预占 1 张测试 SKU。** 修正：仅在用户确认后用同一 SKU、¥0.01、TTL 默认 1800；超时后保持预占进 review，不释放后再二次下单；不要付款
- **ZPay `requestZpayJson` 没有 AbortSignal。** 修正：不先改业务代码补超时；真实超时用本机网络层丢包/阻断 mapi，让 fetch 以无 `code` 的网络错误返回，从而走 `payment_creation_unknown`
- **丢响应时渠道侧可能已经建单。** 修正：这正是 D3-12 要验的未知结果；后续只能对账，不得用新 out_trade_no 再下一单
- **店铺可见 tab 仍停在 checkout。** 修正：继续不要 reload，不要点「创建支付订单」
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [ ] D3-11 / D3-12：现有订单无法进入创建租约，等待用户确认是否允许 API 新建一笔 ¥0.01 未付款 pending 单；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。


## 41. 2026-09-15 D3-11/D3-12 真实超时与订单回写 PASS

### 本轮做了什么

- 用户已允许用 API 新建同一测试 SKU 的 ¥0.01 CN ZPay 未付款单，并在本机网络层制造易支付超时。本轮**没有** reload 店铺页，**没有**点「创建支付订单」，**没有**付款，**没有**退款，**没有**打开第二个游客商品
- 旧超时单 `GS202609150642336739E865BD005BA` 已坐实 D3-11 真实 409，但当时 `markPaymentCreationReview` 把 `.catch()` 挂在 PostgREST thenable builder 上，PATCH 发出前 TypeError，支付行进了 `review`、订单行仍 `pending`。证据备份：`/tmp/d3-11-timeout-evidence-before-order-writeback-fix.json`
- 已修 [`server/api-handlers/public/guest-shop.js`](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js) `markPaymentCreationReview`：先更新支付行，再 **await** 订单 PATCH（`order.order_id || order.id`，`payment_status IN ('pending','review')`）；订单写失败只吞在请求发出之后。回归：`tests/guest-shop-orders-idempotency.test.js` 新增「unknown provider create error marks payment and order review and blocks a second charge」。单测不得当作 D 的 PASS
- 只杀旧 `:8011` PID 78173，按原 env double-fork 重启新代码 preview PID 82065（`PORT=8011`，`HTTP(S)_PROXY=http://127.0.0.1:18081`）。未杀 `:8000` PID 59004 / cloudflared PID 20601 / hang proxy PID 77668
- 用 `/tmp/d3-12-timeout-run.js` 对 `http://127.0.0.1:8011/api/shop/guest/orders` 再开一笔同一 Gemini「测试 2」SKU 的 CN ZPay/alipay 未付款超时单。证据：`/tmp/d3-12-timeout-evidence.json`
- 真实结果（`verdict.pass=true`）：
  - 新单 `GS20260915070900686E811B0791BB0` / `order_id=b1ba554e-ace7-429b-bfc2-53bb84e44649` / `payment_id=52654e91-12e3-4385-832b-848632de123f` / 预占 `934d04b8-920c-429a-9084-926c5740169e` / 库存 `0ec997de-891b-48f6-b04d-2e814eeda59a`
  - 租约 `leaseSeenAt=2026-09-15T07:09:02.079Z`，`last_error_code=payment_creation_in_progress`
  - request2 HTTP 409 `guest_payment_creation_in_progress`（822ms）
  - request1 HTTP 500 `guest_shop_request_failed`，无 checkout / 无 order_no 回放（12588ms）
  - 之后订单行 **和** 支付行都是 `review` + `payment_creation_unknown`；支付行无 `provider_order_no`、无 checkout
  - request3 HTTP 503 `guest_payment_reconciliation_required`（619ms）
  - hang log 本轮只有 1 次 `zpayz.cn` CONNECT（07:09:01 hang，07:09:19 destroy）；request2/3 未再打渠道
  - 预占 held，库存 `reserve` 未 sold；SKU available 40→39、reserve 1→2、sold 仍 1
  - D3-01 `GS2026091500585007432D22B143D38` 仍 delivered / `fulfilled_at=2026-09-15T03:42:28.412784+00:00`；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold
  - 直连 ZPay query：`status=pending`、`amount=0`、无 `trade_no`，未发现第二张可对账渠道单
- 验完后已停新 `:8011` PID 82065 和 hang proxy PID 77668。`:8000` / cloudflared 仍在。店铺可见 tab 未 reload
- D3-11 / D3-12 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 / 两张超时单补付款或补合法 paid 回调
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有用 mock/单元测试把 D3-11/D3-12 记 PASS
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email 或积分余额
- 没有 SQL 释放当前 held 库存

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12 PASS，D3-08 BLOCKED+原因，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 不要付款、不要退款两张超时单：`GS202609150642336739E865BD005BA`（旧回写失败样本）和 `GS20260915070900686E811B0791BB0`（D3-11/D3-12 PASS 样本）。不要付款 D3-02
2. 继续其余 D3。优先仍可不新扣款的案例；D3-10 回调丢失对账补偿如果必须另建「已付款但拦 webhook」的单，先说明再扣 ¥0.01。INTL D3-09 / D2-INTL-NOW 仍未开始，本轮先不新开 INTL 扣款
3. 不要 reload 店铺页去再点「创建支付订单」，不要打开第二个游客商品

### 风险和修正

- **旧超时单订单行仍可能是 pending。** 修正：D3-12 PASS 只认修代码后的新单 `GS20260915070900686E811B0791BB0`；旧单 `GS202609150642336739E865BD005BA` 只作回归对照，不要付款、不要 SQL 释放
- **两张超时单都预占了测试 SKU。** 修正：过期扫描只看 `held && reserved_until <= now`，不看 review。到期后 `:8000` worker 可能释放；在此之前不要再为超时实验新建第三张单
- **丢响应时渠道侧可能已经建单。** 修正：本轮 hang log 只有 1 次 CONNECT，支付行无 `provider_order_no`，直连 query 也没有 trade_no；后续只能对账，不得用新 out_trade_no 再下一单
- **店铺可见 tab 仍停在 checkout。** 修正：继续不要 reload，不要点「创建支付订单」
- **订单上已有 `last_error_code=guest_claim_invalid`。** 这是 D3-01 设备 cookie/claim 旧痕迹，本轮未变；不要为清这个字段再 claim/unlock
- **PostgREST builder 没有 `Promise.catch()`。** 修正：已从 `markPaymentCreationReview` 去掉 builder `.catch()`；单测 stub 本身无 `.catch`，回退会红

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock。下一步优先 D3-10 / INTL D3-09，不要付款超时单
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 42. 2026-09-15 D3-10 回调丢失后对账补偿 PASS

### 本轮做了什么

- 用户说「继续下一步」= 做 D3-10。本轮**没有**新扣款、**没有**付款超时单、**没有**打开第二个游客商品、**没有** SQL、**没有**从功能分支 vercel prod deploy
- 只读核对脚本：`/tmp/d3-10-evidence.js`；证据：`/tmp/d3-10-evidence.json`（`verdict.pass=true`，`at=2026-09-15T07:40:13.955Z`）
- 正例不是另建「拦 webhook」单，也不是 mock。第 27 节已经写明：现网支付宝付 ¥0.01 后，ZPay 官方查单 `status=paid` / `trade_no=2026091523001409501422068607`，当时本地 webhook 未到，用官方字段 + 商户签名补进本地 webhook。这就是 D3-10 对账补偿
- 此刻仍成立：
  - 订单 `GS2026091500585007432D22B143D38`：confirmed / consumed / delivered，`paid_at=2026-09-15T01:48:46.722452+00:00`，`fulfilled_at=2026-09-15T03:42:28.412784+00:00`
  - 支付单 `152be175-4c1b-4d40-8236-2b25d6e39dbc`：confirmed，paid_amount=0.01 CNY
  - **唯一** processed 事件 `577d818d-0342-41f8-b53e-4603c5286679` / `event_key=zpay:2026091523001409501422068607:paid:e566e673d99deadba2094ad2`；signature/amount/currency/final_status 全 true
  - 另 4 条 invalid-bucket rejected = D3-03/05/06/07，不是第二张扣款
  - D3-04 已把同一事件重放成 `duplicate: true`，未二次发货
  - 现网查单仍 `status=paid`，amount=0.01，有 trade_no，merchant_order_no 匹配
  - 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold / 非共享
  - SKU 聚合：available **41** / sold **1**（两张超时预占已被 worker 释放）
- 反例：未付款不得补偿确认
  - D3-02 `GS202609150429213472D4D87B04A50`：本地 pending/created，渠道 pending / 无 trade_no，预占 released
  - 旧超时 `GS202609150642336739E865BD005BA`：订单 pending、支付行 review，渠道 pending / amount=0 / 无 trade_no，预占 released 07:13:07Z
  - D3-12 `GS20260915070900686E811B0791BB0`：订单+支付行 review，渠道 pending / amount=0 / 无 trade_no，预占 released 07:39:14Z
- `scripts/guest-shop-reconcile.js` 是只读发现器，**不会**自动 confirm。`--query-provider` 仅在 provider 已付且本地 pending/created/review 时记 `provider_paid_local_pending`。超时单渠道未付，不得补偿确认
- D3-10 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有再扣 ¥0.01，没有停 tunnel 另建「拦 webhook」单
- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品
- 没有给 D3-02 / 两张超时单补付款或补合法 paid 回调
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有用 mock/单元测试把 D3-10 记 PASS
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email 或积分余额
- 没有新开 INTL 扣款

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10 PASS，D3-08 BLOCKED+原因，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 不要付款、不要退款两张超时单：`GS202609150642336739E865BD005BA`（旧回写失败样本）和 `GS20260915070900686E811B0791BB0`（D3-11/D3-12 PASS 样本）。不要付款 D3-02
2. 下一优先 INTL D3-09 / D2-INTL-NOW。先创建未付款 INTL NOWPayments 单，用错网络 webhook 验证拒绝且不发货；成功支付（真实 USDT）必须先说明再扣，本轮不立刻新扣款
3. 不要 reload 店铺页去再点「创建支付订单」，不要打开第二个游客商品

### 风险和修正

- **不要把 D3-10 理解成必须再拦一次 webhook。** 修正：D3-01 本身就是丢失回调后的官方查单补偿；再扣 ¥0.01 只会制造第二张已付款单
- **只读 reconcile 不会自动 confirm。** 修正：未付款/超时单即使本地 pending/review，渠道 pending 且无 trade_no 也不得补偿确认
- **D3-01 `last_error_code=guest_claim_invalid` 是旧 claim 痕迹。** 修正：不要为清它再 claim/unlock
- **店铺可见 tab 仍停在 checkout。** 修正：继续不要 reload，不要点「创建支付订单」
- **INTL 是现网 `api.nowpayments.io`，没有沙箱密钥。** 修正：先做未付款错网络拒绝；成功支付再说明后扣等额 USDT，网络固定 `usdtbsc`，标价始终 CNY

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock。下一步优先 INTL D3-09 / D2-INTL-NOW，先说明再扣；不要付款超时单
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 43. 2026-09-15 D3-09 错网络 BLOCKED+NOWPayments amountTo is too small

### 本轮做了什么

- 用户说「继续下一步」= 收口 INTL D3-09。本轮**没有**扣 USDT、**没有**付款超时单、**没有**打开第二个游客商品、**没有**改价、**没有** SQL、**没有**从功能分支 vercel prod deploy
- 根因已由现网探测确认：`¥0.01` → `0.01 * 0.14` roundUp = **`$0.01` USD quote**。`GET /v1/min-amount?currency_from=usd&currency_to=usdtbsc` min ≈ **`$19.04779209942144`**；`usdtbsc→usdtbsc` min ≈ **`0.087` USDT**。`POST /v1/payment` 真实失败 `amountTo is too small`（约 438ms），无 `payment_id`、无 pay_address。INTL 没有沙箱密钥，就是现网 `api.nowpayments.io`
- 因此 D3-09 **不能**走「真实未付款发票 + `usdttrc20` webhook」路径。合同要求缺真实能力记 `BLOCKED+原因`，不用 mock
- 旧 500/`payment_creation_unknown` 是因为 `createNowpaymentsPayment()` 抛无 `code` 的 `Error`，guest-shop 把它当未知结果留 review + 预占。本轮把 4xx 收成 definitive reject：
  - [`api/_lib/payments/nowpayments.js`](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/nowpayments.js) `throwNowpaymentsResponseError()`：4xx → `code=nowpayments_rejected` + `statusCode`
  - [`api/_lib/payments/guest-shop-adapter.js`](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/guest-shop-adapter.js) 4xx / `amountTo is too small` → `GuestShopPaymentError code=guest_provider_create_failed`（文案：`金额低于 NOWPayments 最低限额，无法创建支付`）。网络失败**不**映射该 code，继续走 review
- 用应用 RPC `fn_guest_shop_release_reservation` 释放旧 review 预占（已确认无 invoice，不是 SQL）：
  - 订单 `GS2026091509172377102A1273B61EB` / `4e131f7b-36d9-4f87-ad64-f6af5aad87bd`
  - 预占 `2ce11624-6cc1-4066-9798-a3259e6c4b28` → `released` / `payment_create_failed:amount_too_small` / `released_at=2026-09-15T09:48:11.16289Z`
  - 库存 `0ac8f64a-bf2a-4df9-99ee-819e8908d018` → available；SKU available **41** / sold **1**
- 重启 local preview PID **8164**（PPID 1；`VERCEL_ENV=preview` + 代理 7897 + memory limiter）。不要杀 cloudflared **20601**。缺字段 POST 已是 **400** 不是 503
- live create：`POST http://127.0.0.1:8000/api/shop/guest/orders` `{site:'intl', provider:'nowpayments', channel:'usdtbsc', quantity:1}`，耗时 3815ms
  - HTTP **400** `guest_provider_create_failed` / `金额低于 NOWPayments 最低限额，无法创建支付`
  - 新单 `GS20260915095329434CB3A9D9F6DAE`：site=intl，currency=CNY，total=0.01，payment_status=pending，reservation_status=released，无 `recovery_code`
  - 支付行 `0c5cec8b-45b7-44c3-a629-5cc2b1e9f9c6`：provider=nowpayments / channel=usdtbsc / status=`failed` / `last_error_code=guest_provider_create_failed` / 无 `provider_order_no` / 无 pay_address / paid_amount=null
  - 预占 `13633401-5459-4241-9bd2-040440c414ab` released，`release_reason=payment_create_failed:guest_provider_create_failed`
  - 库存仍 available；SKU available **41** / sold **1**；D3-01 仍 delivered / sold
- 证据：`/tmp/d3-09-nowpayments-create-probe.json`、`/tmp/d3-09-release-old-review.json`、`/tmp/d3-09-live-create.json`。D3-09 记 `BLOCKED+NOWPayments amountTo is too small`。阶段 D 仍未完成

### 本轮没做什么

- 没有扣 USDT，没有建成 NOWPayments 发票，因此没有打错网络 webhook
- 没有付款、没有退款、没有 unlock、没有打开第二个游客商品、没有改价
- 没有付款 D3-02 / 两张超时单 / 旧 review 单 / 本轮新失败单
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有用 mock/单元测试把 D3-09 记 PASS
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、pay_address 或积分余额

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10 PASS，D3-08/D3-09 BLOCKED+原因，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 不要付款、不要退款两张超时单：`GS202609150642336739E865BD005BA`、`GS20260915070900686E811B0791BB0`。不要付款 D3-02，不要付款 `GS20260915095329434CB3A9D9F6DAE`
2. 下一优先 **D3-19 串单隔离**（可不新扣款）：CN 回调打 INTL 单、INTL 回调打 CN 单，均应拒绝且不发货
3. D3-09 解开条件是把测试 SKU 提到 NOWPayments 最低额以上；在用户明确同意前**不要改价、不要开第二个游客商品**。成功支付（真实 USDT）必须先说明再扣
4. 不要 reload 店铺页去再点「创建支付订单」

### 风险和修正

- **¥0.01 永远建不成 NOWPayments 发票。** 修正：D3-09 记 BLOCKED，不 mock 错网络 webhook；解开要先涨价
- **无 invoice 的 review/failed 单不能当错网络样本。** 修正：不要对 `GS2026091509172377102A1273B61EB` / `GS20260915095329434CB3A9D9F6DAE` 发 NOWPayments webhook
- **不要把 USD quote 当结算币种。** 修正：标价和结算始终 CNY；NOWPayments 只是把人民币折算成实时等额 USDT，网络固定 `usdtbsc`
- **网络失败不能当 definitive reject。** 修正：4xx / `amountTo is too small` 才释放预占；超时/5xx 继续 review
- **D3-01 `last_error_code=guest_claim_invalid` 是旧痕迹。** 修正：不要为清它再 claim
- **店铺可见 tab 仍停在 checkout。** 修正：继续不要 reload，不要点「创建支付订单」
- **成功支付仍须先说明再扣 USDT。** 修正：本轮不扣；D3-14/15/16/18 更重，D3-15 用户说过不要退款

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 `BLOCKED+NOWPayments amountTo is too small`
- [ ] 其余 D3；缺真实能力的记 BLOCKED+原因，不用 mock。下一步优先 D3-19 串单隔离，不要付款超时单，不要扣 USDT
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 44. 2026-09-15 D3-19 串单隔离 PASS

### 本轮做了什么

- 用户说「继续任务」= 收口 D3-19。本轮**没有**付款、**没有** claim、**没有**退款、**没有**扣 USDT、**没有**打开第二个游客商品、**没有**改价、**没有** SQL、**没有**从功能分支 vercel prod deploy
- 上一轮 live 两向都 HTTP 500 `P0001`：lookup 只按 `merchant_order_no`，NOWPayments 打到 D3-01 的 zpay 行、ZPay 打到 INTL 的 nowpayments 行。binding 因 `provider` 失败，本不会 confirm；但 rejected 事件仍带着对方 `payment_order_id` 去 insert，触发器 `guest_shop_validate_payment_event` 按跨 provider 抛 P0001，审计行插不进去
- 边执行边修正，只改 handler，不写 migration：
  - [`server/api-handlers/public/guest-shop.js`](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js)：lookup 命中但 `expected.provider !== routeProvider` 时当成未知单，`payment_order_id=null`，走 202 `{accepted:false}`，永不 `fn_guest_shop_confirm_payment`
  - [`tests/guest-shop-webhook.test.js`](/Volumes/chao/AI/xianyu_profit_calculator/tests/guest-shop-webhook.test.js)：跨 provider 命中必须 202、不 confirm、事件 `payment_order_id=null`。`node --test tests/guest-shop-webhook.test.js` **11/11 PASS**
- 重启 local preview PID **17884**（PPID 1；`VERCEL_ENV=preview` + 代理 7897 + memory limiter）。不要杀 cloudflared **20601**
- live 隔离 `/tmp/d3-19-isolation.js` **PASS**（`failed=[]`）：
  - NOWPayments `finished/usdtbsc` HMAC-SHA512 valid → D3-01：HTTP **202** `{accepted:false}`；新事件 `6ab2dd4c-9abb-4c80-891f-2e1a4d071480` / `nowpayments:invalid-bucket` / rejected / `payment_order_id=null` / `signature_verified=true`
  - ZPay 已签名 `TRADE_SUCCESS 0.01 CNY` MD5 valid → INTL 失败单：HTTP **202** `{accepted:false}`；新事件 `6117d4ae-832a-4d9c-b6c2-f52bd0563827` / `zpay:invalid-bucket` / rejected / `payment_order_id=null` / `signature_verified=true`
  - D3-01 仍 delivered / consumed / sold / paid_amount=0.01；原 processed 事件 `577d818d-0342-41f8-b53e-4603c5286679` 不变
  - INTL `GS20260915095329434CB3A9D9F6DAE` 订单仍 pending/released，支付行仍 `failed` / `guest_provider_create_failed`，无 `provider_order_no`
  - SKU available **41** / sold **1**；D3-02 仍 released
- 证据：`/tmp/d3-19-isolation-evidence.json`、`/tmp/d3-19-isolation-verdict.json`。D2-CROSS 与 D3-19 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有 claim、没有打开第二个游客商品、没有改价
- 没有付款 D3-02 / 两张超时单 / INTL 失败单
- 没有对 D3-01 再打金额正确的同渠道 ZPay paid
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、pay_address 或积分余额

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10/D3-19 PASS，D3-08/D3-09 BLOCKED+原因，其余 D3 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 不要付款、不要退款两张超时单：`GS202609150642336739E865BD005BA`、`GS20260915070900686E811B0791BB0`。不要付款 D3-02，不要付款 `GS20260915095329434CB3A9D9F6DAE`
2. 下一优先仍可不新扣款的剩余 D3：**D3-14 库存耗尽** 或 **D3-18 关闭测试 SKU 后旧单**。D3-15/16 退款更重，且用户说过不要退款
3. D3-09 解开条件是把测试 SKU 提到 NOWPayments 最低额以上；在用户明确同意前**不要改价、不要开第二个游客商品**。成功支付（真实 USDT）必须先说明再扣
4. 不要 reload 店铺页去再点「创建支付订单」

### 风险和修正

- **merchant_order_no lookup 仍不按 provider 过滤。** 修正：跨 provider 命中后丢弃 expected，事件 `payment_order_id=null`；不要绑到被打中的支付行
- **DB 触发器挡住了串单写事件，但合同要的是 202 + rejected。** 修正：不要再让 mismatch 行带着对方 id 去 insert，否则 P0001 → HTTP 500，审计丢失
- **不要对 D3-01 再打金额正确的同渠道 ZPay paid。** 修正：本轮只打跨渠道
- **D3-01 `last_error_code=guest_claim_invalid` 是旧痕迹。** 修正：不要为清它再 claim
- **店铺可见 tab 仍停在 checkout。** 修正：继续不要 reload，不要点「创建支付订单」
- **成功支付仍须先说明再扣 USDT。** 修正：本轮不扣；解开 D3-09 要用户同意涨价

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 `BLOCKED+NOWPayments amountTo is too small`
- [x] D3-19 串单隔离 PASS
- [ ] 其余 D3（D3-14/15/16/18）；缺真实能力的记 BLOCKED+原因，不用 mock。不要付款超时单，不要退款，不要扣 USDT
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 45. 2026-09-15 D3-18 关闭测试 SKU 后旧单继续、新单拒绝 PASS

### 本轮做了什么

- 用户批准剩余 1–4：D3-18 关开关（不花钱）、再付一笔新的 ¥0.01 跑 D3-14、允许退该新单跑 D3-15/16、涨价并扣真实 USDT 解开 D3-09。本轮只做第 1 条并回写文档，未开始扣款。
- Admin Studio 认证走 `api/_lib/admin-studio-access.mjs` 签发 `zaoyoe_admin_studio` cookie，`POST http://127.0.0.1:8000/api/admin?route=shop/mutate` `action=upsert_product` `site=cn`。payload 来自 admin GET product，只翻 `allow_guest_purchase`，**不带 `skus`**，避免 sync SKU。SKU `allow_guest_purchase=null`，闸门 `Boolean(sku?.allow_guest_purchase ?? product?.allow_guest_purchase)`，关商品开关足够。
- live `/tmp/d3-18-toggle.js` **PASS**（checks 全 true）：
  - `mutate_off` HTTP 200，`allow_guest_purchase=false`，`guestProductCount=0`，warning_count=1（非阻塞）
  - 关闭期间 CN/INTL create-order 均 HTTP **409** `guest_product_unavailable` / 「商品暂不支持游客购买」；`has_order=false` / `has_recovery_code=false` / `has_checkout=false`
  - D3-01 `GS2026091500585007432D22B143D38` 全程 `confirmed / consumed / delivered / refund_status=none`；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；processed 事件 `577d818d-0342-41f8-b53e-4603c5286679` 不变
  - SKU available **41** / sold **1** 全程未变，无新单
  - `mutate_on` HTTP 200，开关恢复 true，`guestProductCount=1`
- 证据：`/tmp/d3-18-toggle-evidence.json`。D3-18 记 PASS。阶段 D 仍未完成

### 本轮没做什么

- 没有付款、没有退款、没有 unlock、没有 claim、没有打开第二个游客商品、没有改价
- 没有退 D3-01，没有付款 D3-02 / 两张超时单 / INTL 失败单
- 没有对 D3-01 再打金额正确的同渠道 ZPay paid
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有把阶段 D 或总进度记成完成；D 的 18% 仍不计分
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、cookie、token、pay_address 或积分余额

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10/D3-19/D3-18 PASS，D3-08/D3-09 BLOCKED+原因，D3-14/15/16 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. D3-14 库存耗尽：CN ZPay 新建 ¥0.01 单（预占 1/41）→ Admin Studio `inventory_update_status` 把其余 available 改成可逆非 available（避开 D3-01 sold）→ 释放该单预占并把释放卡也改掉 → 新 tab 打开支付宝 checkout，请用户再付一笔现网 ¥0.01。支付成功后验收 `fulfillment_status=paid_unfulfillable` / `refund_status=pending`
2. 用 D3-14 那笔新单（不要退 D3-01）跑 D3-15；D3-16 用失败/悬挂退款
3. 最后把测试 SKU 提到 NOWPayments 最低额以上并扣真实 USDT，解开 D3-09 / INTL 成功路径
4. 不要付款 `GS202609150642336739E865BD005BA`、`GS20260915070900686E811B0791BB0`、D3-02、`GS20260915095329434CB3A9D9F6DAE`。不要 reload 店铺页去再点「创建支付订单」

### 风险和修正

- **upsert 若带 `skus` 会 sync SKU。** 修正：payload 从 admin GET 来，只翻商品开关
- **SKU `allow_guest_purchase=null` 回退商品开关。** 修正：关商品开关即可；不要另开第二个游客商品
- **D3-01 `last_error_code=guest_claim_invalid` 是旧痕迹。** 修正：不要为清它再 claim，也不要退 D3-01
- **店铺可见 tab 仍停在 checkout。** 修正：继续不要 reload，新支付在新 tab 打开
- **create-order 在无库存时会失败。** 修正：D3-14 必须先下单再掏空；支付前 available 打到 0，避免「库里还有货却标 paid_unfulfillable」
- **冻结库存必须可逆。** 修正：用 Admin `inventory_update_status` 改为 `frozen`（失败则 `fault`），不要 delete；D3-14 验收后、D3-15 补发或 INTL 成功路径前再改回 available
- **成功支付仍须真扣。** 修正：D3-14 再付一笔新的现网支付宝 ¥0.01；INTL 成功路径另扣 USDT，且先涨价

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 `BLOCKED+NOWPayments amountTo is too small`
- [x] D3-19 串单隔离 PASS
- [x] D3-18 关闭测试 SKU 后旧单继续、新单拒绝 PASS
- [ ] D3-14 库存耗尽 → `paid_unfulfillable`（需再付一笔新的现网支付宝 ¥0.01）
- [ ] D3-15/16 对 D3-14 新单退款成功 / 失败悬挂；不要退 D3-01
- [ ] 涨价后 INTL NOWPayments 成功支付（真扣 USDT）以解开 D3-09
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 46. 2026-09-15 D3-14 setup ready（等人付现网支付宝 ¥0.01）

### 本轮做了什么

- 用户问「D3 是不是卡住了」。结论：**没有卡住。** D3-18 已 PASS；D3-14 setup 在 21:17 已完成，上一拍停在等人付款，文档当时没把 setup 回写成“进行中”，看起来像停住。
- 只读复核（21:27–21:28 CST）：
  - 新单 `GS20260915131639759F6E8976B5F06` / `f513b751-9da6-4fff-a9c8-38cb6aec126c`：`pending / released / pending / refund_status=none` / `paid_at=null`
  - 支付行 `a75e17d6-5e05-463a-be58-24d38e297eed`：ZPay/alipay / `created` / 0.01 CNY / `paid_amount=null` / 有 `provider_order_no`
  - 预占 `fdc80ec4-86d5-4ad7-8602-d7e2cd4a85ee`：`released` / `release_reason=d3_14_inventory_exhaustion`
  - 库存：frozen **41** / sold **1**；sold 仍是 D3-01 的 `052c5e12-7d10-496b-b610-2a74139dcc1f`；无 reserve
  - D3-01 仍 `confirmed / consumed / delivered`
  - 新单尚无支付事件；create HTTP 201，`has_recovery_code=true`（口令不入库、不入聊天）
  - checkout host `qr.alipay.com`；本轮已重新 `open` 该收银台
- setup 路径（证据 `/tmp/d3-14-setup-evidence.json`）：create CN ZPay → Admin `inventory_update_status` 把其余 available 改为 `frozen` → `fn_guest_shop_release_reservation` → 释放卡也 `frozen`。`drainStatus=frozen`，可逆，不要 delete。
- D3-14 **未记 PASS**。必须真付成功后看到 `fulfillment_status=paid_unfulfillable` / `refund_status=pending` / 库存不 sold / D3-01 仍 delivered，才能 PASS。
- 阶段 D 仍未完成；总进度仍 48%

### 本轮没做什么

- 没有替用户点支付宝确认支付
- 没有把 D3-14 记 PASS，没有退款，没有 claim，没有改价，没有打开第二个游客商品
- 没有付款 D3-01 / D3-02 / 两张超时单 / INTL 失败单
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、cookie、token、pay_address 或积分余额

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10/D3-19/D3-18 PASS，D3-08/D3-09 BLOCKED+原因，D3-14 setup ready 等人付款，D3-15/16 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. **请用户现在付** `GS20260915131639759F6E8976B5F06` 现网支付宝 ¥0.01。TTL `expires_at=2026-09-15T13:46:39.759454Z`（约本地 21:46）。预占已释放，过期后付款仍应走 late-success → `paid_unfulfillable`
2. 付完立刻核对新单 `paid_unfulfillable` / `refund_status=pending`；必要时 `POST /api/shop/guest/worker`
3. 用**这一笔新单**跑 D3-15 `request_refund`；不要退 D3-01。D3-16 用失败/悬挂退款
4. 涨价到 NOWPayments 最低额以上 + 真扣 USDT，解开 D3-09
5. 不要付款 `GS202609150642336739E865BD005BA`、`GS20260915070900686E811B0791BB0`、D3-02、`GS20260915095329434CB3A9D9F6DAE`、D3-01。不要 reload 店铺页去再点「创建支付订单」

### 风险和修正

- **文档没回写 setup 会被误判为卡住。** 修正：本轮已回写 D3-14 进行中，未记 PASS
- **订单 TTL 只到约 21:46。** 修正：请立刻付这一笔；过期后仍可 late-success，但收银台可能失效，不要另开第二笔游客商品
- **create-order 在无库存时会失败。** 修正：已经先下单再掏空；支付前 available=0
- **冻结库存必须可逆。** 修正：41 张 `frozen` id 在 `/tmp/d3-14-frozen-ids.json`；D3-14 验收后、D3-15 补发或 INTL 成功路径前再改回 available
- **IAB 支付宝桌面页不可靠。** 修正：用系统默认浏览器打开 `qr.alipay.com`，不要 reload `shop.html`
- **D3-01 已 delivered 不可再划回。** 修正：不要退 D3-01，不要 claim，不要再打金额正确的同渠道 ZPay paid

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 `BLOCKED+NOWPayments amountTo is too small`
- [x] D3-19 串单隔离 PASS
- [x] D3-18 关闭测试 SKU 后旧单继续、新单拒绝 PASS
- [x] D3-14 库存耗尽 → `paid_unfulfillable`（PASS：webhook 快照 confirmed / paid_unfulfillable / refund_pending；库存未新增 sold）
- [x] D3-15 对 D3-14 新单退款成功（PASS：worker 自动退款；官方 ZPay status=2 refunded；未退 D3-01）
- [ ] D3-16 退款失败/悬挂；不要退 D3-01
- [ ] 涨价后 INTL NOWPayments 成功支付（真扣 USDT）以解开 D3-09
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 47. 2026-09-15 D3-14 PASS + D3-15 PASS（库存耗尽 late-success 后自动退款）

### 本轮做了什么

- 用户回复「已经支付成功」。21:48 CST 只读时本地仍 pending（D3-10 式回调丢失）。TTL 已过，预占已 `released` / `d3_14_inventory_exhaustion`。
- 补偿脚本 `/tmp/d3-14-confirm.js`：ZPay 官方查单 paid / money=0.01 / out_trade_no 匹配 → 用商户 pkey 重签 → `POST /api/shop/guest/webhooks/zpay` HTTP 200 `{accepted:true, confirmed:true}`。
- **D3-14 验收点是 webhook 之后、worker 之前**（`afterWebhook`）：
  - 订单 `GS20260915131639759F6E8976B5F06` / `f513b751-9da6-4fff-a9c8-38cb6aec126c`：`payment_status=confirmed` / `reservation_status=released` / `fulfillment_status=paid_unfulfillable` / `refund_status=pending` / `last_error_code=paid_inventory_not_reservable` / `paid_at=2026-09-15T13:58:10.226157Z`
  - 支付行 `a75e17d6-5e05-463a-be58-24d38e297eed`：confirmed / paid_amount=0.01
  - 预占 `fdc80ec4-86d5-4ad7-8602-d7e2cd4a85ee` 仍 released，未重新预占
  - 库存 frozen **41** / sold **1**；sold 仍是 D3-01 `052c5e12-7d10-496b-b610-2a74139dcc1f`；无 reserve
  - D3-01 仍 confirmed / consumed / delivered / refund_status=none
  - 新事件 `ab1eddd3-1a6d-4eda-b2be-073352cec4cf` / `zpay:2026091523001409501430682610:paid:de00b3e7421ada0536d32f1b` processed；signature/amount/currency/final_status 均 verified；原事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 processed
- 脚本随后立刻打 worker。worker 对 `paid_unfulfillable` + `refund_pending` **自动退款**（这是生产补偿路径，不是验收脚本误伤）：
  - worker 200：scanned=1 / processed=1 / delivered=0 / refunded=1 / paid_unfulfillable=0
  - 终态：订单 `payment=refunded` / `fulfillment=refunded` / `refund_status=succeeded`；支付行 refunded / paid_amount 仍 0.01；`fulfilled_at=null`
  - 22:08 CST 官方查单：`status=refunded` / `status_raw=2` / money=0.01 / out_trade_no 匹配。这是真退 ¥0.01，不是本地假状态。
- 合同修正：D3-15 原写「后台申请退款」。paid_unfulfillable 的生产路径是 `confirm_payment` 置 pending + worker 自动退款；Admin `request_refund` 对已 succeeded 会 not_eligible。不另开一笔、不退 D3-01。
- 阶段 D 仍未完成；总进度仍 48%

### 本轮没做什么

- 没有付款 D3-01 / D3-02 / 两张超时单 / INTL 失败单
- 没有 claim，没有打开第二个游客商品，没有改价
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、cookie、token、pay_address 或积分余额
- 尚未把 41 张 frozen 改回 available

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10/D3-19/D3-18/D3-14/D3-15 PASS，D3-08/D3-09 BLOCKED+原因，D3-16 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 把 `/tmp/d3-14-frozen-ids.json` 里 41 张 frozen 用 Admin `inventory_update_status` 改回 `available`（避开 D3-01 sold）
2. 涨价到 NOWPayments 最低额以上（约 ¥20+ / ~$19 USD），真扣 USDT `usdtbsc`，解开 D3-09
3. D3-16 用 INTL NOWPayments 退款人工队列/悬挂；不要退 D3-01
4. 不要付款 `GS202609150642336739E865BD005BA`、`GS20260915070900686E811B0791BB0`、D3-02、`GS20260915095329434CB3A9D9F6DAE`、D3-01。不要 reload 店铺页去再点「创建支付订单」

### 风险和修正

- **验收脚本在 webhook 后立刻打 worker，会把 paid_unfulfillable 快照冲掉。** 修正：D3-14 PASS 以 `afterWebhook` 为准；worker 自动退款记入 D3-15
- **paid_unfulfillable 会自动退款，Admin request_refund 不再是这条路径的必要步骤。** 修正：合同把 D3-15 完成标准改成真实渠道退款成功；Admin 写路径仍留给 delivered 单，本轮不退 D3-01
- **冻结库存必须可逆。** 修正：下一步先恢复 41 张 frozen，再跑 INTL 成功路径
- **D3-01 已 delivered 不可再划回。** 修正：不要退 D3-01，不要 claim，不要再打金额正确的同渠道 ZPay paid
- **官方查单从 paid 变成 refunded 证明真退了 ¥0.01。** 修正：不要再对同一笔补付或重复退

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 `BLOCKED+NOWPayments amountTo is too small`
- [x] D3-19 串单隔离 PASS
- [x] D3-18 关闭测试 SKU 后旧单继续、新单拒绝 PASS
- [x] D3-14 库存耗尽 → `paid_unfulfillable`
- [x] D3-15 对 D3-14 新单退款成功；未退 D3-01
- [ ] 恢复 41 张 frozen 库存为 available
- [ ] D3-16 退款失败/悬挂；不要退 D3-01
- [ ] 涨价后 INTL NOWPayments 成功支付，解开 D3-09

## 48. 2026-09-15 D3-09 错网络 PASS；INTL 成功支付未入账（不是代码卡死）

### 卡在哪里

- **没有卡在代码、SQL、preview 或 worker。** preview PID `17884` 仍在 `:8000`；cloudflared `20601` 未杀。
- 卡在阶段 D 的 **INTL 成功支付**。D3-09 错网络已经 PASS，但成功路径还没入账，所以阶段 D 的 18% 仍不计分，总进度仍 **48%**。
- 用户在支付宝下载页回复「已经支付成功」。现网核对：**没有新支付宝单**。最新已付单仍是已退的 D3-14 `GS20260915131639759F6E8976B5F06`。当前待付对象从来不是支付宝，而是 INTL NOWPayments `usdtbsc`。

### 本轮做了什么（此前未回写的现网事实）

- D3-14/D3-15 之后已把 frozen 库存改回 available，SKU 涨价 `0.01 → 144`（`price_points_intl=null`，商品价仍 1；游客结算走 SKU 积分价）。现网 min `usd → usdtbsc` ≈ `19.052892`。证据：`/tmp/d3-09-raise-price-evidence.json`（`at=2026-09-15T15:00:17.717Z`）。
- 新建 INTL 单 `GS20260915150703326FB1F73A265FA`：create HTTP **201**，标价 **144 CNY**，`site=intl`，`provider=nowpayments`，`channel=usdtbsc`，NOWPayments `payment_id=5250755581`，发票应付 **20.48 USDTBSC**。
- D3-09 错网络 live webhook：`actually_paid_currency=usdttrc20`，HTTP **202** `{accepted:false}`。新事件 `af1ad08a-818a-418b-bd53-4c319e03b02f` / `nowpayments:invalid-bucket` / rejected / `observed_status=wrong_asset`。未 confirm、未发货。证据：`/tmp/d3-09-wrong-network-raised-evidence.json`（`at=2026-09-15T15:07:15.309Z`，`status=PASS`）。
- 23:29–23:31 CST 只读复核：
  - 本地订单仍 `pending / held / pending / refund_status=none`，`paid_at=null`
  - 支付行 `667d6ff5-b0a2-4227-b079-2d0a78eaec6a` 仍 `created`，`paid_amount=null`
  - 预占 `5f0b5782-062a-4a1b-8cd8-9ff1e7666d91` 仍 held，库存行 `0ac8f64a-bf2a-4df9-99ee-819e8908d018` 仍 `reserve`
  - SKU available **40** / reserve **1** / sold **1**；sold 仍是 D3-01 `052c5e12-7d10-496b-b610-2a74139dcc1f`
  - 另有 quote 过期 webhook `b918da7c-6162-490a-bc92-06cd31fd4534` / invalid-bucket / rejected / `observed_status=expired`（签名通过，但未把本站单改成 expired）
  - 官方 NOWPayments 查单：`payment_status=expired`，`actually_paid=0`，`pay_amount≈20.4739254`，`updated_at=2026-09-15T15:12:30.422Z`
- 游客商品仍 1 个；该商品只有 1 个 SKU；D3-01 仍 confirmed / consumed / delivered / refund_status=none
- 阶段 D 仍未完成；总进度仍 48%

### 遇到了什么问题

1. **支付对象错了。** 浏览器停在支付宝客户端下载页，用户按支付宝路径理解「已经支付成功」。本轮要付的是 **20.48 USDT-BEP20**，不是支付宝，也不是 TRC20/ERC20。
2. **NOWPayments 发票已过期且链上未入账。** 官方 `actually_paid=0`。再往这张旧发票打款有丢币风险，**不要付** `GS20260915150703326FB1F73A265FA`。
3. **文档滞后。** 合同此前仍写 D3-09 `BLOCKED+NOWPayments amountTo is too small`，但涨价后错网络已经 PASS。本轮把合同改成现态，避免看起来像停在旧 BLOCKED。
4. **quote TTL 短于订单 TTL。** quote 15:12Z 过期，本站预占到 15:37Z。quote 过期 webhook 被正确拒绝，没有把未付款成功单误标 expired；但渠道发票本身已经 expired。

### 本轮没做什么

- 没有把用户这句话当成新的支付宝入账，没有重开第二笔支付宝
- 没有付款 D3-01 / D3-02 / 两张超时单 / 旧 INTL 失败单 / 已退 D3-14 / 已过期 INTL 单
- 没有 claim，没有打开第二个游客商品，没有再改价
- 没有 reload 店铺页，没有点「创建支付订单」
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、cookie、token、pay_address 或积分余额
- 没有把阶段 D 或总进度记成完成

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10/D3-19/D3-18/D3-14/D3-15/D3-09 PASS，D3-08 BLOCKED+原因，INTL 成功支付未入账，D3-16 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. **不要付** 已过期发票 `GS20260915150703326FB1F73A265FA` / `payment_id=5250755581`
2. 等本地预占 15:37Z 到期后打 worker 释放库存，或确认已 released；SKU 应回到 available=41 / sold=1
3. 另建一张新的 INTL NOWPayments 发票（仍是同一测试 SKU，标价 144 CNY，网络 `usdtbsc`），请用户用钱包付**新发票**显示的等额 USDT-BEP20
4. 入账后验收 confirm → worker 履约，这才是 INTL 成功路径
5. D3-16 用这一笔 INTL 成功单做退款失败/悬挂；不要退 D3-01
6. 不要付款 `GS202609150642336739E865BD005BA`、`GS20260915070900686E811B0791BB0`、D3-02、`GS20260915095329434CB3A9D9F6DAE`、D3-01、已退 D3-14。不要 reload 店铺页去再点「创建支付订单」

### 风险和修正

- **支付宝下载页会被理解成已经付款。** 修正：INTL 路径只走 NOWPayments `usdtbsc` 付款页；不再打开支付宝 checkout
- **过期发票仍显示地址。** 修正：官方 `expired` + `actually_paid=0` 后禁止再付；释放预占后重建发票
- **quote 过期 ≠ 本站订单过期。** 修正：本站预占仍 held 到 15:37Z；worker 到期释放，不把 quote expired webhook 当成功/失败终态
- **涨价后不要漏传其它 SKU。** 修正：Admin mutate 的 `skus` 必须带全量；该商品只有 1 个 SKU，本轮未误归档
- **D3-01 已 delivered 不可再划回。** 修正：不要退 D3-01，不要 claim，不要再打金额正确的同渠道 ZPay paid
- **成功支付仍须真扣 USDT-BEP20。** 修正：金额必须与新发票完全一致；不要 TRC20/ERC20，不要支付宝

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 PASS（涨价后 `usdttrc20` webhook 拒绝且不发货）
- [x] D3-19 串单隔离 PASS
- [x] D3-18 关闭测试 SKU 后旧单继续、新单拒绝 PASS
- [x] D3-14 库存耗尽 → `paid_unfulfillable`
- [x] D3-15 对 D3-14 新单退款成功；未退 D3-01
- [x] 恢复 frozen 库存为 available，并涨价到 144
- [ ] 不要付已过期 INTL 发票 `GS20260915150703326FB1F73A265FA`
- [ ] 预占到期释放后另建新 INTL 发票，真扣 USDT-BEP20，完成 INTL 成功支付
- [ ] D3-16 用该 INTL 成功单做退款失败/悬挂；不要退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 49. 2026-09-16 用户自建 INTL USDT 游客单并付款

### 本轮做了什么

- 用户要求：自己创建 USDT 游客订单并完成支付，之后 Codex 按实际付款情况继续 D。
- 07:05 CST 只读复核：
  - 库存 available **41** / sold **1**；sold 仍是 D3-01 `052c5e12-7d10-496b-b610-2a74139dcc1f`；无 reserve
  - SKU `price_points=144`；游客商品仍 1 个（Gemini「测试 2」）
  - 旧 INTL 单 `GS20260915150703326FB1F73A265FA`：pending / released / expired，官方 `actually_paid=0`
  - 另有一张 CN 站 NOWPayments 单 `GS20260915154204621A4A9522C7A10`：create 15:42Z，预占 16:12Z expired 已 released，支付行仍 created / `paid_amount=null`。这是在 `localhost` 默认 CN 站下的 USDT 单，**不是** INTL 成功路径，不要付款
- 合同修正：INTL 成功支付不再由 Codex 代建付款页。用户用 `http://localhost:8000/shop.html?site=intl` 自建，渠道选 `USDT-BEP20（NOWPayments）`，付完后 Codex 查官方 NOWPayments + 本站订单/worker。
- 阶段 D 仍未完成；总进度仍 48%

### 本轮没做什么

- 没有代用户建新发票，没有打开支付宝
- 没有付款任何旧单，没有 claim，没有打开第二个游客商品，没有改价
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、cookie、token、pay_address

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-09 错网络 PASS，INTL 成功支付等人自建并真付，D3-16 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 用户打开 `http://localhost:8000/shop.html?site=intl`（必须带 `?site=intl`，否则会建成 CN 站 USDT 单）
2. 只买 Gemini「测试 2」/ 规格「测试」；渠道选 **USDT-BEP20（NOWPayments）**
3. 点一次「创建支付订单」后立刻付**新发票**显示的等额 USDT-BEP20；NOWPayments quote 大约 5 分钟过期
4. 付完后把**新订单号**发回来（不要发付款地址、口令、卡密）。Codex 核验 confirm → worker 履约
5. D3-16 用这一笔 INTL 成功单；不要退 D3-01
6. 不要付款任何旧 GS 单，不要再点第二次「创建支付订单」除非当前发票已明确过期且预占已释放

### 风险和修正

- **localhost 默认是 CN 站。** 修正：必须 `?site=intl`，否则 NOWPayments 单会记成 `site=cn`，不能当 D2-INTL 成功路径
- **NOWPayments quote 约 5 分钟过期。** 修正：建单后立刻付；过期后不要往旧地址打款
- **旧发票仍可能显示地址。** 修正：不要付 `GS20260915150703326FB1F73A265FA` 和 `GS20260915154204621A4A9522C7A10`
- **金额必须完全一致，网络必须 BEP20。** 修正：不要 TRC20/ERC20，不要支付宝
- **口令只显示一次。** 修正：用户自己保存；不要发到聊天

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 PASS
- [x] D3-19 串单隔离 PASS
- [x] D3-18 关闭测试 SKU 后旧单继续、新单拒绝 PASS
- [x] D3-14 库存耗尽 → `paid_unfulfillable`
- [x] D3-15 对 D3-14 新单退款成功；未退 D3-01
- [x] 恢复 frozen 库存为 available，并涨价到 144
- [x] 过期 INTL/CN USDT 预占已释放，库存 available=41 / sold=1
- [ ] 用户在 `?site=intl` 自建新 USDT-BEP20 游客单并真付
- [ ] Codex 按实际付款核验 confirm / worker 履约
- [ ] D3-16 用该 INTL 成功单做退款失败/悬挂；不要退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 50. 2026-09-16 07:12 复确认：用户自建 INTL USDT 单

### 本轮做了什么

- 用户再次确认：自己创建 USDT 游客订单并完成支付，之后 Codex 按实际付款继续 D。
- 07:12 CST 只读复核（不建单、不付款、不 claim）：
  - preview `:8000` HTTP 200 / healthz ok
  - 游客商品仍 1 个：Gemini「测试 2」`c16212d8-6ad8-4b3c-831c-3cc68b2d7a52`，`allow_guest_purchase=true`
  - SKU `db8cc9bd-898a-49ff-adb4-cc07f94d7d8f` `price_points=144`
  - 库存 available **41** / sold **1**；sold 仍是 D3-01 `052c5e12-7d10-496b-b610-2a74139dcc1f`；held 预占 **0**
  - 最新单仍是已过期 CN 站 USDT `GS20260915154204621A4A9522C7A10`（不要付）
  - 最新 INTL USDT 仍是已过期 `GS20260915150703326FB1F73A265FA`（不要付）
  - 最新已付仍是已退 D3-14；D3-01 仍 delivered
- 合同维持第 49 节：Codex 不代建付款页，不打开支付宝。用户必须用 `http://localhost:8000/shop.html?site=intl` 自建。
- 阶段 D 仍未完成；总进度仍 48%

### 本轮没做什么

- 没有代用户建新发票，没有打开支付宝，没有生成付款二维码
- 没有付款任何旧单，没有 claim，没有打开第二个游客商品，没有改价
- 没有执行/重跑 20260913-20260919 SQL
- 没有从功能分支 vercel prod deploy
- 没有打印口令、卡密、pkey、sign、user_id、email、cookie、token、pay_address

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。D 仍 `in_progress`：D3-09 错网络 PASS，INTL 成功支付等人自建并真付，D3-16 未跑。100% 只在第 J 节用户签署之后。

### 下一步

1. 用户打开 `http://localhost:8000/shop.html?site=intl`（必须带 `?site=intl`）
2. 打开 Gemini「测试 2」/ 规格「测试」，点「游客购买」
3. 渠道选 **USDT-BEP20（NOWPayments）**，点一次「创建支付订单」
4. 立刻按页面显示的金额付 **USDT-BEP20 / BNB Smart Chain**；quote 大约 5 分钟过期
5. 付完后只把**新订单号**发回来（不要发付款地址、口令、卡密）
6. Codex 核验官方 NOWPayments confirm → 打 worker 履约 → 用该成功单做 D3-16
7. 不要付款任何旧 GS 单；不要 reload 后再点第二次「创建支付订单」，除非当前发票已明确过期且预占已释放

### 风险和修正

- **localhost 默认是 CN 站。** 修正：地址栏必须能看到 `?site=intl`，否则会建成 CN 站 USDT 单，不能当 D2-INTL 成功路径
- **NOWPayments quote 约 5 分钟过期。** 修正：建单后立刻付；过期后不要往旧地址打款
- **旧发票仍可能显示地址。** 修正：不要付 `GS20260915150703326FB1F73A265FA` 和 `GS20260915154204621A4A9522C7A10`
- **金额必须完全一致，网络必须 BEP20。** 修正：不要 TRC20/ERC20，不要支付宝
- **口令只显示一次。** 修正：用户自己保存；不要发到聊天

### 待执行任务清单（同步后）

- [x] D3-01 / D3-13 / D3-17 PASS
- [x] D3-04 重复回调 PASS
- [x] D3-03 假回调 PASS
- [x] D3-02 未付款过期 PASS
- [x] 20260916 INTL 积分价回退 3/3 PASS
- [x] D3-05 乱序回调 PASS
- [x] D3-06 少付 PASS
- [x] D3-07 多付 PASS
- [x] D3-20 充值/游客回调隔离 PASS
- [x] D3-08 错币种 `BLOCKED+ZPay currency is site-derived`
- [x] D3-11 provider 超时 PASS
- [x] D3-12 provider 结果未知进入 `review` PASS
- [x] D3-10 回调丢失后对账补偿 PASS
- [x] D3-09 错网络 PASS
- [x] D3-19 串单隔离 PASS
- [x] D3-18 关闭测试 SKU 后旧单继续、新单拒绝 PASS
- [x] D3-14 库存耗尽 → `paid_unfulfillable`
- [x] D3-15 对 D3-14 新单退款成功；未退 D3-01
- [x] 恢复 frozen 库存为 available，并涨价到 144
- [x] 过期 INTL/CN USDT 预占已释放，库存 available=41 / sold=1
- [x] 07:12 CST 只读复核：preview 健康、无 held 预占、无新单
- [ ] 用户在 `?site=intl` 自建新 USDT-BEP20 游客单并真付
- [ ] Codex 按实际付款核验 confirm / worker 履约
- [ ] D3-16 用该 INTL 成功单做退款失败/悬挂；不要退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品
- [ ] E 真实并发、G 视觉验收、I 灰度、J 回滚签署均未开始

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 51. 2026-09-16 07:19 INTL 目录看不到游客 USDT 商品

### 本轮做了什么

- 用户问：现在 intl 是不是没有可使用 USDT 的商品。
- 只读复核：
  - 游客商品仍只有 Gemini「测试 2」；`guest_payment_channels=["zpay","nowpayments"]`
  - CN catalog 有该商品；INTL catalog 19 件商品里没有它
  - 原因：SKU `price_points=144`，`price_points_intl=null`。公开目录按站点价格字段过滤，INTL 没定价就不展示
  - guest preview `site=intl` HTTP 200，标价 144 CNY，通道仍含 `nowpayments`
  - 其它 INTL 在售商品（Gemini 3.1pro 等）未开游客购买，不能当 D2-INTL 成功路径
- 结论：从商城列表看，intl 当前没有可见的游客 USDT 商品。从支付能力看，USDT 通道已开，只是测试 SKU 被目录隐藏。
- 未改价、未开第二个游客商品、未建单。总进度仍 48%

### 本轮没做什么

- 没有把 `price_points_intl` 写成 144（会让「测试 2」出现在国际站公开目录，需用户确认）
- 没有打开第二个游客商品
- 没有执行 SQL，没有 vercel prod deploy

### 进度

- 总进度仍 **48%**。D 仍 `in_progress`。这不是代码卡死，是 INTL 目录可见性缺口。

### 下一步

1. ~~用户确认后补 `price_points_intl=144`~~ 已在第 52 节完成
2. 打开 [http://localhost:8000/shop.html?site=intl](http://localhost:8000/shop.html?site=intl)，Gemini 分类应能看到「测试 2」
3. 游客购买选 USDT-BEP20 并真付；把新订单号发回
4. 不要付旧单

### 风险和修正

- **补国际站积分价会影响公开目录。** 修正：只改现有测试 SKU，不加第二个游客开关；生产国际站若还没有游客 UI，该商品会以 144 积分商品出现
- **不要误以为需要新开一件 USDT 商品。** 修正：通道已开，缺的是 INTL 目录定价

### 待执行任务清单（同步后）

- [x] 确认 INTL 目录隐藏「测试 2」是因为 `price_points_intl=null`
- [x] 确认 guest preview intl 仍可用 nowpayments
- [x] 用户确认后补现有 SKU `price_points_intl=144`
- [ ] 用户在 `?site=intl` 自建 USDT-BEP20 并真付
- [ ] Codex 核验 confirm / worker 履约
- [ ] D3-16 用该成功单；不退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913-20260919。

## 52. 2026-09-16 07:27 补现有 SKU `price_points_intl=144`

### 本轮做了什么

- 用户确认：把现有 Gemini「测试 2」SKU 的国际站积分价补成 144。
- 走 admin GET 全量商品+全部 SKU，再 `upsert_product` mutate；只改现有 SKU `db8cc9bd-898a-49ff-adb4-cc07f94d7d8f` 的 `price_points_intl=null → 144`。CN `price_points` 保持 144。
- 未改 `allow_guest_purchase`，未加第二个游客商品，未改 `guest_payment_channels=["zpay","nowpayments"]`，未建单，未付款，未 claim，未退 D3-01。
- 核验：
  - DB SKU `price_points=144` / `price_points_intl=144`
  - catalog `site=intl&refresh=1`：商品数 19 → 20，出现「测试 2」；规格价 144
  - catalog `site=cn` 仍有该商品
  - guest preview `site=intl` HTTP 200，标价 144 CNY，通道仍含 `nowpayments`
  - 游客商品仍 1 个；该商品仍 1 个 SKU；库存 available=41 / sold=1；held=0
  - D3-01 仍 `confirmed/consumed/delivered`，库存行仍 sold
- 商品级 `price_points_intl` 仍为 null、商品级 `price_points` 仍为 1。公开目录靠 SKU 站点价过滤，因此 INTL 列表已能看到「测试 2」，不需要再开第二个游客商品。
- 证据：`/tmp/d3-fill-intl-price-144-evidence.json`（`at=2026-09-15T23:27:59.875Z`，checks 全部 true）
- 总进度仍 48%

### 本轮没做什么

- 没有打开第二个游客商品
- 没有代建 NOWPayments 发票
- 没有执行 SQL，没有 vercel prod deploy
- 没有退 D3-01，没有对旧过期发票付款

### 进度

- 总进度仍 **48%**。D 仍 `in_progress`。INTL 目录可见性缺口已修；INTL 成功支付仍等人自建并真付。

### 下一步

1. 打开 [http://localhost:8000/shop.html?site=intl](http://localhost:8000/shop.html?site=intl)。localhost 默认是 CN，不带 `?site=intl` 会建成 CN 站单。
2. 只买 Gemini「测试 2」/ 规格「测试」
3. 渠道选 **USDT-BEP20（NOWPayments）**，不是支付宝
4. 点一次「创建支付订单」后立刻付新发票等额 USDT-BEP20；quote 大约 5 分钟过期
5. 网络必须 BEP20 / `usdtbsc`；金额必须完全一致
6. 付完后只把**新订单号**发回来。不要发付款地址、口令、卡密
7. 不要 reload 后再点第二次「创建支付订单」，除非当前发票已明确过期且预占已释放

### 风险和修正

- **生产国际站公开目录也会出现「测试 2」（144 积分）。** 修正：只改了现有测试 SKU，没有加第二个游客开关；生产 Vercel 来自 `main`，游客购买 UI 还在功能分支，所以生产上它会以普通积分商品出现
- **不带 `?site=intl` 会再次建成 CN 站 USDT 单。** 修正：必须打开带站点参数的 localhost 预览页
- **旧发票不要付。** 修正：`GS20260915150703326FB1F73A265FA`、`GS20260915154204621A4A9522C7A10` 均已过期释放

### 待执行任务清单（同步后）

- [x] 确认 INTL 目录隐藏「测试 2」是因为 `price_points_intl=null`
- [x] 确认 guest preview intl 仍可用 nowpayments
- [x] 用户确认后补现有 SKU `price_points_intl=144`
- [x] 核验 INTL catalog 出现「测试 2」，preview intl 仍 200 / nowpayments
- [ ] 用户在 `?site=intl` 自建 USDT-BEP20 并真付
- [ ] Codex 核验 confirm / worker 履约
- [ ] D3-16 用该成功单；不退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 53. 2026-09-16 07:35 补商品级 `price_points_intl=144`（页面过滤）

### 本轮做了什么

- 用户反馈：intl 站还是看不到「测试 2」。
- 只读复核：catalog API `site=intl` 已经返回该商品（20 件里有「测试 2」），SKU `price_points_intl=144`；但商品级 `price_points_intl` 仍为 `null`。
- 根因：`js/site-config.js` 的 `getProductPrice` / `filterProductsForCurrentSite` 只看**商品级** `price_points_intl`。SKU 有国际站价不够，shop 页面会把商品滤掉。
- 走 admin GET 全量 + mutate，只把商品级 `price_points_intl` 从 `null` 改成 `144`。CN 商品级 `price_points` 仍为 1；SKU 两档价格仍为 144。
- 未改游客开关，未加第二个游客商品，未改通道，未建单。
- 核验：catalog 商品级 `price_points_intl=144`；按前端过滤规则 `frontendWouldShow=true`；guest preview intl 仍 200 / 144 CNY / nowpayments；游客商品仍 1 个；库存 available=41 / sold=1。
- 证据：`/tmp/d3-fill-product-intl-price-144-evidence.json`（`at=2026-09-15T23:35:07.315Z`）
- 总进度仍 48%

### 本轮没做什么

- 没有改前端过滤逻辑
- 没有打开第二个游客商品
- 没有代建发票，没有执行 SQL，没有 vercel prod deploy

### 进度

- 总进度仍 **48%**。D 仍 `in_progress`。

### 下一步

1. **硬刷新** [http://localhost:8000/shop.html?site=intl](http://localhost:8000/shop.html?site=intl)（浏览器有 catalog 缓存，只切分类可能仍看到旧列表）
2. 打开 Gemini 分类，应能看到「测试 2」
3. 游客购买选 USDT-BEP20 并真付；把新订单号发回
4. 不要付旧单

### 风险和修正

- **页面缓存会继续藏商品。** 修正：必须硬刷新带 `?site=intl` 的预览页
- **生产国际站也会以 144 积分商品出现「测试 2」。** 修正：只改了这一件测试商品，没有加第二个游客开关

### 待执行任务清单（同步后）

- [x] 补 SKU `price_points_intl=144`
- [x] 补商品级 `price_points_intl=144`，让 shop 前端 intl 过滤放行
- [ ] 用户硬刷新 `?site=intl` 后看到「测试 2」
- [ ] 用户自建 USDT-BEP20 并真付
- [ ] Codex 核验 confirm / worker 履约
- [ ] D3-16 用该成功单；不退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913-20260919。

## 54. 2026-09-16 游客支付宝改成登录充值同款二维码 + 倒计时（INTL 暂停）

### 本轮做了什么

- 用户要求先暂停 INTL USDT。游客选支付宝后没有弹出登录充值同款的二维码和付款倒计时，而是打开支付宝官方下载页 `https://render.alipay.com/p/yuyan/180020040001212700/?cid=wap_dc`。这是严重 UX bug，必须立刻修。
- 根因：游客 ZPay 面板以前是 `target=_blank` 的「打开支付页面」。`checkoutDetails()` 只吃 `checkout_url` / `payment_url`，丢掉了后端已有的 `qrcode_url` / `qrcode_image_url`。桌面/IAB 打开 ZPay WAP，就会被支付宝打到下载页。
- 登录充值走 `js/components/WalletModal.js`：宽屏站内 hosted QR + 倒计时 + 轮询，不把 WAP 丢给浏览器；真机窄屏才 `alipays://`，并保留当前页。
- 本轮对齐该逻辑，且不加载 `wallet.css`（`shop.html` 只用 `css/shop-page.css`）：
  - `shop.html`：去掉 `#guestCashCheckoutLink` / `target=_blank`。ZPay 面板改成 `#guestCashZpayQrImage`、`#guestCashZpayCountdown`、`#guestCashZpayOpenBtn`。cache bust `20260916_GUEST_ALIPAY_QR_2`
  - `js/guest-shop-client.js`：解析 `qrcode_url` / `qrcode_image_url`；宽屏/IAB 用站内二维码（优先渠道图片，否则 qrserver 生成），禁止 `window.open` / WAP `location.assign`；真机窄屏只显示「打开支付宝支付」并走 `alipays://`；倒计时用 `state.expiresAt`；出码后隐藏配置面板
  - `css/shop-page.css`：补 `.guest-shop-modal__qr-*`，视觉对齐 `wallet-payment-qr-*` / `wallet-crypto-countdown`，含 light theme，不引入新 eyebrow
  - `tests/guest-shop-frontend-contract.test.js`：契约覆盖桌面不打开 WAP、渲染 QR/倒计时、移动走 scheme、解析 qr 字段、无 `guestCashCheckoutLink` / `window.open`
- INTL USDT 成功路径暂停，等本 UX 验收后再恢复。总进度仍 48%

### 本轮没做什么

- 没有恢复 INTL USDT 真付
- 没有打开第二个游客商品，没有改 `allow_guest_purchase`
- 没有执行 SQL，没有 vercel prod deploy
- 没有退 D3-01，没有对旧 GS 单再付款
- 没有把 D 或总进度改成完成/99%

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。这是 D 进行中的 UX 热修，不是 D 完成。100% 只在第 J 节用户签署之后。

### 下一步

1. 硬刷新 [http://localhost:8000/shop.html](http://localhost:8000/shop.html)（CN 站，不要带 `?site=intl`）
2. 打开 Gemini「测试 2」/ 规格「测试」，点「游客购买」，渠道保持支付宝
3. 点「创建支付订单」后，弹窗内应出现站内二维码和「付款剩余」倒计时，**不要**再跳到支付宝下载页
4. 本轮验收只看二维码是否出现。不要付款旧 GS 单；如果要付，必须是这一次新出的码，并把新订单号发回
5. 该 UX 验收通过后，再恢复 INTL `?site=intl` USDT-BEP20 真付

### 风险和修正

- **桌面/IAB 打开 ZPay WAP 会进支付宝下载页。** 修正：宽屏一律 hosted QR，不再 `window.open` / `location.assign` WAP
- **Codex IAB 的 UA 可能带 mobile。** 修正：`isMobileAlipayHandoff()` 还要求视口 `max-width: 760px`，宽屏 IAB 仍出码
- **shop.html 不加载 wallet.css。** 修正：QR/倒计时样式写在 `css/shop-page.css`，并覆盖 light theme
- **旧 GS 单不要再付。** 修正：`GS2026091500585007432D22B143D38` 等旧单全部禁止；只测新出的码
- **口令/卡密不要发到聊天。** 修正：只回传订单号

### 待执行任务清单（同步后）

- [x] 游客支付宝改为站内二维码 + 倒计时（对齐登录充值）
- [x] shop-page.css 补 QR 样式，不依赖 wallet.css
- [x] 前端契约测试覆盖不打开 WAP / 解析 qr 字段
- [ ] 用户硬刷新 CN `shop.html`，确认站内二维码+倒计时出现，不再跳下载页
- [ ] 该 UX 验收通过后再恢复 INTL USDT-BEP20 真付
- [ ] Codex 按实际付款核验 confirm / worker 履约
- [ ] D3-16 用 INTL 成功单；不退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 55. 2026-09-16 未付款游客订单可关闭并重新下单

### 本轮做了什么

- 用户反馈：每次打开该商品都会自动弹出上一次未付款订单，希望有「关闭当前订单」按钮；点关闭后可以重新创建（改规格等）。
- 根因：未付款单写在 `sessionStorage` `guest_shop_checkout_v1`。`maybeRestoreReturn()` 在 `shop.html` 加载时只要有 saved unpaid order 就 `openGuestModal()`；`closeGuestModal()` /「稍后处理」/ X 只藏弹窗，不清会话。点「游客购买」时若 `state.orderNo` 还在，只恢复旧单并隐藏「创建支付订单」。没有公开 cancel API；库存预占仍靠到期 worker 释放（D3-02 已 PASS）。
- 本轮按客户端放弃未付款会话实现，**不**加 cancel RPC、**不**执行 SQL：
  - `/Volumes/chao/AI/xianyu_profit_calculator/shop.html`：footer 增加 `#guestCashAbandonOrderBtn`，文案「关闭当前订单」，`shop-btn shop-btn-secondary`，默认 hidden，放在「查询支付状态」旁边。cache bust `20260916_GUEST_ABANDON_ORDER_1`
  - `/Volumes/chao/AI/xianyu_profit_calculator/js/guest-shop-client.js`：`abandonCurrentOrder()` 停轮询/倒计时，清 `STORAGE_KEY` 和 `orderNo` / `idempotencyKey` / `expiresAt` / `checkout` / `provider` / `channel` / `recoveryCode`，`resetOrderUi()` 后重新显示配置面板和「创建支付订单」。已付（`paymentConfirmed` / `confirmed`）或已发货（`delivered`）禁止放弃。
  - 「稍后处理」/ X 语义不变：只关弹窗，未点关闭前仍可 hydrate 恢复未付单。
  - `/Volumes/chao/AI/xianyu_profit_calculator/tests/guest-shop-frontend-contract.test.js`：契约覆盖关闭按钮、清 `STORAGE_KEY`、已交付不放弃、无 cancel RPC、无 `window.open`、无 `guestCashCheckoutLink`。`node --test tests/guest-shop-frontend-contract.test.js` **12/12 绿**。
- 游客数量保持 `quantity: 1`。改规格仍是关游客弹窗后在父购买弹窗换 SKU，再点游客购买。
- INTL USDT 成功路径继续暂停，等支付宝 UX（二维码 + 可关闭重开）验收后再恢复。总进度仍 48%。

### 本轮没做什么

- 没有服务端 cancel / 没有新 SQL / 没有 vercel prod deploy
- 没有打开第二个游客商品，没有改 `allow_guest_purchase`
- 没有改 `quantity: 1`，没有退 D3-01，没有对旧 GS 单再付款
- 没有恢复 INTL USDT 真付
- 没有把 D 或总进度改成完成/99%

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。这是 D 进行中的 UX 热修，不是 D 完成。100% 只在第 J 节用户签署之后。

### 下一步

1. 硬刷新 [http://localhost:8000/shop.html](http://localhost:8000/shop.html)（CN 站，不要带 `?site=intl`）
2. 打开 Gemini「测试 2」/ 规格「测试」。若自动弹出未付款单，点 **「关闭当前订单」**（不是「稍后处理」）
3. 关闭后应回到支付方式选择，并可重新点「创建支付订单」。如需改规格：先关游客弹窗，在父购买窗口换 SKU，再点「游客购买」
4. 新单选支付宝后，弹窗内仍应出现站内二维码和「付款剩余」倒计时，**不要**再跳到支付宝下载页
5. 不要付款旧 GS 单；如果要付，必须是这一次新出的码，并把新订单号发回
6. 该 UX 验收通过后，再恢复 INTL `?site=intl` USDT-BEP20 真付

### 风险和修正

- **点「稍后处理」/ X 仍会在下次打开时恢复未付单。** 这是有意保留：只有「关闭当前订单」才清 `sessionStorage`。
- **关闭只放弃客户端会话，服务端预占不会立刻释放。** 修正：提示不要再付旧付款码；旧预占等过期 worker 释放（D3-02）。不要做 cancel RPC。
- **已付/履约中误点关闭会丢本机订单句柄。** 修正：`isAbandonableOrder()` 在 `delivered` / `confirmed` / `paymentConfirmed` / `claimInFlight` 时隐藏并拒绝关闭。
- **关闭后若不换 `idempotencyKey`，重建会打回同一旧单。** 修正：`abandonCurrentOrder()` 同时清空 `idempotencyKey`。
- **旧 GS 单不要再付。** 修正：`GS2026091500585007432D22B143D38` 等旧单全部禁止；只测新出的码。
- **口令/卡密不要发到聊天。** 修正：只回传订单号。

### 待执行任务清单（同步后）

- [x] 游客支付宝改为站内二维码 + 倒计时（对齐登录充值）
- [x] 未付款游客订单增加「关闭当前订单」，清客户端会话后可重新下单
- [x] 前端契约测试覆盖关闭按钮 / 清 STORAGE_KEY / 已交付不放弃 / 无 cancel RPC
- [ ] 用户硬刷新 CN `shop.html`，确认：未付款单可关闭并重新创建；新单仍出站内二维码+倒计时，不再跳下载页
- [ ] 该 UX 验收通过后再恢复 INTL USDT-BEP20 真付
- [ ] Codex 按实际付款核验 confirm / worker 履约
- [ ] D3-16 用 INTL 成功单；不退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 56. 2026-09-16 游客支付宝/USDT 应付金额自动加 1% 手续费

### 本轮做了什么

- 用户反馈：游客支付宝弹出的应付款是商品实际金额，没有自动加易支付 1% 手续费；少付则不会付款成功、不会发货，付款后网站也不跳转发货页。USDT 同样应自动加 1%。
- 根因：后台 stored `surcharge_rate=0` 被前端 `normalizeSurchargeRate()` 当成 0%；旧未付款单仍按商品价创建。用户手动改支付宝金额也无法让 webhook 与 `expected_amount` 对齐。
- 本轮让应付金额自动等于 **商品价 + 1%**，禁止依赖用户手改：
  - `/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/guest-shop/pricing.js`：stored 空/0% 回退 `DEFAULT_GUEST_SURCHARGE_RATE=0.01`；`¥0.01 + 1%` 向上取整为 `¥0.02`。
  - `/Volumes/chao/AI/xianyu_profit_calculator/js/guest-shop-client.js`：`paymentProviderSummary()` 对 `zpay` / `nowpayments` 在 parsed 费率 `<= 0` 时回退 1%。
  - `/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js`：创建支付前把应付金额写入 `unit_amount` / `total_amount` / `expected_amount` / `payment_pricing`。
  - `/Volumes/chao/AI/xianyu_profit_calculator/shop.html`：cache bust `20260916_GUEST_PAYABLE_FEE_2`。
  - 测试覆盖 stored `0% → 1%`、`¥0.01 → ¥0.02`、create 发送 `12.34 + 1% = 12.47`、前端手续费 DOM 与 fallback。
- INTL USDT 成功路径继续暂停。总进度仍 48%。没有 SQL，没有打开第二个游客商品，没有功能分支 prod deploy。

### 本轮没做什么

- 没有服务端 cancel / 没有新 SQL / 没有 vercel prod deploy
- 没有打开第二个游客商品，没有改 `allow_guest_purchase`
- 没有改 `quantity: 1`，没有退 D3-01，没有对旧 GS 单再付款
- 没有恢复 INTL USDT 真付
- 没有把 D 或总进度改成完成/99%

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。这是 D 进行中的应付金额热修，不是 D 完成。100% 只在第 J 节用户签署之后。

### 下一步

1. 硬刷新 [http://localhost:8000/shop.html](http://localhost:8000/shop.html)（CN 站，不要带 `?site=intl`）
2. 若自动弹出未付款单，点 **「关闭当前订单」**（不是「稍后处理」）。旧单仍是商品价，不能再付
3. 重新创建支付宝订单后，应付金额应自动变成商品价 + 1%。测试 SKU `¥0.01` 会显示 `¥0.02`，这是 1 分钱向上取整，不要手改回 `¥0.01`
4. 新单选支付宝后，弹窗内仍应出现站内二维码和「付款剩余」倒计时，**不要**再跳到支付宝下载页，也不要在支付宝里手动改金额
5. 不要付款旧 GS 单；如果要付，必须是这一次新出的码，并把新订单号发回
6. 该 UX 验收通过后，再恢复 INTL `?site=intl` USDT-BEP20 真付（同样自动加 1%）

### 风险和修正

- **旧未付款会话仍是旧金额。** 修正：必须点「关闭当前订单」后重新创建；不要手改支付宝金额去凑旧单。
- **测试 SKU `¥0.01 + 1%` 向上取整为 `¥0.02`。** 这是预期，不是算错。
- **后台 stored 0% 不能再把应付金额打回商品价。** 修正：服务端 `resolveGuestSurchargeRate()` 与前端 `parsedRate > 0 ? parsedRate : fallbackRate` 都回退 1%。
- **少付不会发货。** 易支付/NOWPayments 按应付金额收款；webhook 校验 `expected_amount`，金额不对则不 confirm。
- **口令/卡密不要发到聊天。** 修正：只回传订单号。

### 待执行任务清单（同步后）

- [x] 游客支付宝改为站内二维码 + 倒计时（对齐登录充值）
- [x] 未付款游客订单增加「关闭当前订单」，清客户端会话后可重新下单
- [x] 游客支付宝/USDT 应付金额自动加 1% 通道手续费，stored 0% 回退 1%
- [ ] 用户硬刷新 CN `shop.html`，关闭旧未付款单后重新创建；确认应付金额已含 1%，不要手改支付宝金额
- [ ] 该 UX 验收通过后再恢复 INTL USDT-BEP20 真付
- [ ] Codex 按实际付款核验 confirm / worker 履约
- [ ] D3-16 用 INTL 成功单；不退 D3-01
- [ ] 不从功能分支 vercel prod deploy
- [ ] 不得再打开第二个游客商品

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 57. 2026-09-16 根因修复：游客直付补齐「主动查单」自愈闭环

### 本轮做了什么

- 用户反馈游客订单 `GS202609160455236231CF70169C6AB` 已支付成功，但页面未显示支付成功、也未发货；用户明确要求**先不处理该订单**，只从根源修复，修好后用**新订单**验证。
- 根因定位（对齐登录充值）：登录用户在钱包充值时，支付状态查询接口里带主动查单
  [`attemptZpayPaymentStatusRefresh`](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/orders.js)，即使渠道回调丢失/延迟也能自愈；游客直付此前只有 webhook 单闭环，回调丢失后订单永久停在待支付，页面既不会跳成功也不会触发 worker 发货。
- 修复：游客状态接口补齐同构的主动查单
  - [`server/api-handlers/public/guest-shop.js`](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js)：新增 `attemptGuestPaymentStatusQuery`，在 `status()` 内对 `pending/created/review` 的 `zpay` / `nowpayments` 支付行调用 `paymentAdapter.queryGuestPayment`，复用 `providerQuoteChecks` + `security.verifyPaymentBinding`（purpose `shop_direct`、站点、币种、金额、终态）校验，校验通过才写 `guest_shop_payment_events`（`event_key = <provider>:status-query:<paymentId>`）并调用 `fn_guest_shop_confirm_payment`；provider/RPC/事件任何失败都静默降级为仍返回 pending，不产生 5xx。
  - 节流：普通轮询 8s、手动强制刷新 1200ms，时间戳写在支付行 `provider_metadata`，避免刷爆渠道查单接口。
  - [`js/guest-shop-client.js`](/Volumes/chao/AI/xianyu_profit_calculator/js/guest-shop-client.js)：`fetchStatus({ forceRefresh })` 会带 `force_provider_refresh=1`；「查询支付状态」按钮强制查单，后台自动轮询保持非强制。
  - [`api/shop/guest/status.js`](/Volumes/chao/AI/xianyu_profit_calculator/api/shop/guest/status.js)：注入 `paymentAdapter`，与 `orders.js` 同构。
- 前端 cache bust：`js/guest-shop-client.js` 本轮改过，`shop.html` 的 JS 版本号从 `20260916_GUEST_PAYABLE_FEE_2` 升到 `20260916_GUEST_STATUS_ACTIVE_REFRESH_1`（CSS 的 `guestPayableFee` 参数不变），避免浏览器沿用旧缓存的客户端逻辑。
- 入口一致性核对（三个入口同一份 handler）
  - Vercel：`/api/shop/:path*` 反代到 `https://verify-api.fatherkey.com/api/shop/:path*`。
  - KVM4 Verify Server：`node server/index.js` 把 `/api/shop/*` 交给 `api/public.js`，其中 `guest/status` 就是本次改动的 `createGuestShopHandlers().status`，并注入游客专用 `paymentAdapter`。
  - 本地 preview：`scripts/local-preview-server.js` 加载独立的 `api/shop/guest/status.js`。
- 顺带收口两个与代码无关的仓库卫生问题（不改业务逻辑）
  - [`.vercelignore`](/Volumes/chao/AI/xianyu_profit_calculator/.vercelignore)：把本地 preview 专用入口 `api/payments/zpay/webhook.js` 排除出 Vercel 部署。生产 `/api/payments/zpay/webhook` 一直由 KVM4 `server/index.js` 提供；该文件只是让本地 preview 能解析同一路由，不应占用 Hobby 的 serverless 槽位（此前使入口数从 5 变 6，触发 `vercel hobby deployment routes public endpoints through the shared handler with headroom` 失败）。
  - 清走仓库根目录遗留的调试产物 `tmp-d3-09-usdt-pay.html` / `tmp-d3-09-usdt-pay-qr.png` / `tmp-d3-14-alipay-qr.png`（已移入系统废纸篓，未提交）。`tmp-d3-09-usdt-pay.html` 含内联 `<style>`，会让仓库 HTML 卫生测试失败，也会作为静态资源被部署。

### 证据

- 新增 [`tests/guest-shop-status-active-refresh.test.js`](/Volumes/chao/AI/xianyu_profit_calculator/tests/guest-shop-status-active-refresh.test.js)：10/10 PASS，覆盖 webhook 丢失→主动查单→写事件→`confirm_payment`→订单 confirmed；provider 未支付不写事件不 confirm；金额不符不 confirm；8s/1200ms 节流；terminal 订单不再查渠道；无效 claim 403 且 0 次支付读取；adapter 抛错与 RPC 失败均返回 200 pending；已 processed 事件幂等不重复 confirm。
- [`tests/guest-shop-frontend-contract.test.js`](/Volumes/chao/AI/xianyu_profit_calculator/tests/guest-shop-frontend-contract.test.js)：14/14 PASS，新增「手动查询强制实时查单、后台轮询不强制」契约。
- 全仓回归 `node --test --test-force-exit tests/*.test.js`：**3146 pass / 0 fail**（此前 2 个失败均为上述遗留文件导致，已消除）。

### 本轮没做什么

- 没有处理订单 `GS202609160455236231CF70169C6AB`：未核销、未补发、未解锁、未改状态、未查该单 claim token。
- 没有执行任何 SQL（含只读排查）；没有新增迁移。
- 没有打开游客商品/SKU 开关，没有改 `allow_guest_purchase`。
- 没有部署：没有推分支、没有开/合 PR、没有 `vercel deploy`，也没有触发 KVM4 发布。

### 下一步

1. 新订单验证需要先让修复进入运行环境：本分支 → PR → `main` → Vercel + KVM4 Verify Server（按 AGENTS.md 四条链路），否则 KVM4 上的 `/api/shop/guest/status` 仍是旧逻辑。
2. 发布成功后再用新订单验证：`http://localhost:8000/shop.html`（本地）只适合做 UI/契约验证，本地 preview 连的是同一套 Supabase，且没有公网 webhook，真实验证应在 verify 环境走「下单 → 付款 → 回调或主动查单 → confirmed → worker 发货」。
3. 新订单必须由用户新开，不接受对 `GS202609160455236231CF70169C6AB` 补测。

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 58. 2026-09-17 商品详情弹窗移除「游客购买」按钮，未登录时并入主按钮

### 本轮做了什么

- 用户要求：商城 → 单个商品详情弹窗里**移除「游客购买」按钮**；未登录时把游客购买能力**并入「兑换」主按钮**。用户明确不要「未登录可直接现金购买」提示行，并要求在下达部署指令前**不发布**。
- 旧行为（两个问题）：
  1. `js/guest-shop-client.js` 用 `window.setInterval(syncPurchaseButton, 350)` 轮询商城购买弹窗来决定 `#guestCashPurchaseBtn` 显隐，**完全不看登录状态**，所以已登录用户也会看到「游客购买」。
  2. 「兑换」在未登录时只会 `promptLoginForPurchase()` 弹登录框，游客链路必须靠第二个按钮才能进入。
- 新行为：
  - `/Volumes/chao/AI/xianyu_profit_calculator/shop.html`：删除 `#guestCashPurchaseBtn`（连带 `shop-guest-cash-purchase-btn` 类名，仓库里已无任何残留引用）；`js/guest-shop-client.js` 的 cache bust 采用叠加形态 `?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1&guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1`（保留 #649 的 token，其三条契约断言按子串仍能匹配）；`js/shop-client.js` 追加 `&guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1`（保留原 `?v=20260520_SHOP_CARD_PROMPT_BREATHE_3` 前缀，多个测试按子串断言它）。CSS 的 `guestPayableFee` 参数本轮未改。
  - `/Volumes/chao/AI/xianyu_profit_calculator/js/guest-shop-client.js`：删掉 `syncPurchaseButton` / `handlePurchaseButtonClick` / 350ms 轮询 / capture 点击监听；`loadPreview()` 不再操作按钮，改为返回 `{ available, reason }`；新增只读桥接
    `window.GuestShopCheckout = { peekAvailability, probeAvailability, startGuestCheckout }`，按 `contextKey` 缓存可用性并去重 in-flight 探测。`loadPreview` 改为**串行队列**（`previewQueue` + `runPreviewRequest`），所以「加载中」不会再被当成「不可用」；瞬时失败（`pending` / `rate_limited` / `preview_error`）**不写缓存**，后续点击可重试。
  - `/Volumes/chao/AI/xianyu_profit_calculator/js/shop-client.js`：由它独家判断登录态（`shopAuthStateKnown`，`onAuthStateChange` + `getSession()` 维护）。仅当 **已确认未登录** + 探测到游客可购 + 选择项一致时 `isGuestCashEntryActive()` 才为真，此时主按钮文案切「立即购买 / Buy now」，并隐藏数量与优惠码两个 stage、锁定数量输入为 1（游客单固定 `quantity: 1` 且不支持积分券）。`confirmPurchase` 保持原有顺序「优惠码同步 → 取 token」，只在 `!token` 分支改为先 `startGuestCashCheckout()`，未启动才回落 `promptLoginForPurchase()`。**没有**新增埋点：`window.UserEventTracker.track()` 在没有登录用户时直接 `return null`，而这条路径只在未登录时执行，加了也永远打不上；游客漏斗指标需要一条匿名的服务端事件通道，本轮不做。
  - `/Volumes/chao/AI/xianyu_profit_calculator/lang/zh.json` / `lang/en.json`：新增 `shop.guestCashBuyNow`（立即购买 / Buy now）。
- 隔离不变量保持：`js/guest-shop-client.js` 仍不含 `supabase` / `access_token` / `Authorization` / `localStorage` / `Math.random()`，`STORAGE_VERSION` 仍是 3，也不再引用 `shopPurchaseModal`。登录态判断全部留在 `shop-client.js`。
- **已登录用户路径逐字未变**：所有游客分支都以 `shopAuthStateKnown !== false` 或 `guestCashActive` 为前置条件，积分兑换、优惠码同步、购物车结算的既有契约测试全部保持原样通过。

### 证据

- `tests/guest-shop-frontend-contract.test.js`：**18/18 PASS**（基线 17/17，新增「merged logged-out entry」契约）。原第 21 行的 `#guestCashPurchaseBtn` 断言改为「必须不存在」；三处版本号断言改为同时匹配 `20260917_GUEST_POLL_RATE_LIMIT_SAFE_1` 与追加的 `guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1`。
- 全仓回归 `node --test --test-force-exit tests/*.test.js`：**3156 pass / 0 fail**。
- 过程中发现并修回两处真实回归（都来自最初把 token 检查提到优惠码同步之前）：
  - `tests/shop-discount-preview-selection-regression.test.js`「coupon-list sync a short chance before buying without a coupon」
  - `tests/shop-purchase-guidance-regression.test.js`「refreshes latest notes and versions prefetched product snapshots」
  两者都按既有契约的字面顺序断言 `waitForPurchaseDiscountAssetsBeforeSubmit()` → `getAccessToken()` → `if (!token)`，以及 `setPurchaseStage` 里的 `shouldShow` 谓词。已恢复原顺序（未登录时优惠码请求本就直接返回空 payload，不发网络请求，因此没有额外延迟），并把游客专属的 stage 隐藏挪到通用遍历之后。

### 本轮没做什么

- 已 rebase 到最新 `main`（`2424dcc14`，含 #649 轮询限流修复、#650 worker 安装工作流）。冲突只有两处：`shop.html` 的 guest 脚本 cache bust（改为叠加两个 token）与契约测试的同名断言（改为同时断言两个 token）；`js/guest-shop-client.js` 自动合并，#649 的 `SMART_POLL_INTERVALS` 硬下限与本轮的 `loadPreview` 串行队列/桥接互不重叠。
- 没有部署：没有推分支、没有开/合 PR、没有 `vercel deploy`、没有触发 KVM4 任何链路、没有安装或启动 guest-shop worker。用户明确要求等指令。
- 没有执行任何 SQL，没有新增迁移。
- 没有打开游客商品/SKU 开关，没有改 `allow_guest_purchase`。
- 没有按用户要求添加「未登录可直接现金购买」提示行（契约测试里反向断言它不存在）。
- 没有给**已登录**用户新增现金购买入口。这是一个产品决策缺口：积分不足的登录用户现在只剩积分兑换一条路。本轮按用户原始诉求只处理未登录场景，未擅自扩权。

### 风险和修正

- **登录用户失去现金出路。** 现状：改完后已登录用户看不到任何现金购买入口（旧版反而能看到「游客购买」）。修正建议：在积分不足报错处补一个「改用现金购买」入口，或让登录用户走已有的钱包充值。等产品确认后再做。
- **游客模式下金额摘要仍显示积分。** 数量锁定为 1，摘要按单价积分展示，但点下去是人民币/USDT 现金支付，存在语义落差。本轮按用户要求不加提示行；如需彻底消除，建议游客模式下把摘要区切成现金口径，这是后续可选项。
- **可用性探测失败会回落登录框。** 预览接口 5xx / 限速时，未登录用户点主按钮会看到登录提示而不是游客收银台。已做到瞬时失败不缓存、下次点击重试；仍属 fail-closed，符合「发布不等于启用」的保守口径。
- **购物车结算未动。** `shopCartCheckout` 仍要求登录，本轮没有把游客能力接进购物车。

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。本轮是 P0-5 前端 UI 的入口收敛，不是 D 阶段推进。100% 只在第 J 节用户签署之后。

### 下一步

1. 用户在本地硬刷新 `http://localhost:8010/shop.html`（CN，不要 `?site=intl`；`:8010` 是 `codex/guest-shop-entry-merge` 工作树的 `scripts/local-preview-server.js`，`:8000` 服务的是主仓库另一个分支，看不到本轮改动），**退出登录**后打开一个已开启游客支付的商品：主按钮应为「立即购买」，且看不到数量/优惠码两块；点击直接进入游客收银台。
2. 同一商品**登录后**再看：主按钮应为「兑换」，数量与优惠码恢复，走积分流程，且**不再出现**任何现金购买入口。
3. 未开启游客支付 / 人工发货 / 售罄 / 预览失败四种商品，未登录点击应回落登录弹窗。
4. 上述 UI 验收通过后，再由用户下达部署指令；届时按 `AGENTS.md` 走 `codex/guest-shop-entry-merge` → PR → `main` → 四条链路，不得从功能分支 `vercel deploy --prod`。
5. 产品决策待确认：是否给已登录用户保留现金购买入口。

### SQL 状态

本轮**不需要用户执行 SQL**。不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919。

Codex 不代执行。

## 59. 2026-09-19 游客促销 L1+L2 合并批：阶梯价/闪购/优惠码全部服务端定价，附带时代感知探针修复

### 本轮做了什么

- 用户指令是「按『L1+L2 合并一批』开工」，并沿用既有红线：**安全第一、绝不零元购、防掏鸟蛋、防刷**；
  所有折扣**只走服务端定价**，客户端不参与金额计算；阶梯价与闪购的库存/限购/幂等校验全部保留。
- 按 `docs/guest-shop-promo-hardening-plan.md` §14 的分期表，「L1+L2 合并一批」等价于
  **L1 + L2 + L3 的「定价权威」部分同批交付**。§14 明确禁止 L2/L3 拆开发布：拆开就会出现
  「前端能报价、后端不认账」→ `amount_mismatch` → **已付款不发货**。**L4（后台运营界面）不在本批。**
- 库侧（新增 `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_guest_shop_promo_l1l2.sql`，3531 行）：
  - **L1**：`guest_shop_resolve_credit_unit_amount` 放开 `p_quantity`，阶梯价/闪购与登录用户走**同一个 resolver**
    （积分与现金等值，游客因此能享受登录用户的阶梯价与闪购）；`fn_guest_shop_create_order` 一条语句预占 N 行卡密。
  - **L1 件数四处取小**：`min(env GUEST_SHOP_MAX_QUANTITY, sku.guest_max_quantity, product.guest_max_quantity,
    product.max_purchase_quantity, 5)` —— 运维调高 env **永远不可能**放宽某个 SKU 的上限。
  - **L2**：`fn_guest_shop_evaluate_discount`（只读试算）+ `fn_guest_shop_reserve_discount`（原子扣减）；
    `discount_codes` 加 `guest_*` 五列做券级硬预算；新增 `guest_shop_promo_budget`（站点级日预算）、
    `guest_shop_discount_redemptions`（身份配额台账，按 `buyer_contact_hash` 计数）、
    `guest_shop_promo_breaker` + `_events`（熔断，**只有 closed/open 两值，无半开**，人工恢复）。
  - **L3 定价权威**：create-order 内**重算**金额，并用 `guest_shop_orders_amount_check` 一次性钉住五条红线 ——
    ① `unit_amount > 0 AND total_amount > 0`（**任何情况下都不存在 0 元单**）；
    ② `discount_amount < ROUND(list_unit_amount * quantity, 2)`（**零元购地板**，折扣必须**严格小于**折前总额）；
    ③ `discount_amount <= 折前总额 * 0.5`（**单笔最多折 50%**）；
    ④ `payment_fee_amount <= unit_amount*quantity*0.1 + 0.01`（通道费硬顶 10%）；
    ⑤ `total_amount = unit_amount*quantity + payment_fee_amount`（金额三者必须自洽）。
    另有 `guest_shop_orders_quantity_check`（1..5）、`discount_codes_guest_caps_check`
    （让「超发的游客额度」在数据库层**不可表示**）。四张新表全部 `ENABLE ROW LEVEL SECURITY` +
    `REVOKE FROM PUBLIC, anon, authenticated`，七个促销函数全部 `SECURITY DEFINER` + `SET search_path` + 非 `IMMUTABLE` + **各自唯一重载**。
  - **签名变更**：`fn_guest_shop_create_order` 13 → **15** 参（新增 `p_quantity INTEGER DEFAULT 1`、
    `p_discount_code TEXT DEFAULT NULL`）。旧 13 参签名被**精确 DROP**，DEFAULT 参数**连续排在末尾**
    （否则 PostgREST 具名调用无法解析）。
- 应用侧：
  - `/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/guest-shop/promo.js`（新，510 行）：开关解析 + 券码/数量归一化 + 展示整形。
    **红线写在文件头注释里：本模块永远不计算金额**，每个价格/折扣/手续费都由 SQL 函数产出；
    本文件的取值只能让游客通道**更严**，不可能更松（所有 cap 取 env 与数据库上限的 `min()`，
    env 解析失败一律**降级到 P0 行为**：数量 1、不带券码）。
  - `/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/guest-shop/runtime-config.js`：新增 `GUEST_SHOP_MAX_QUANTITY`
    （integer，default **1**，min 1，max **5** = 数据库 CHECK 硬顶）；`GUEST_SHOP_DISCOUNT_ENABLED`（boolean，default **OFF**，
    解析不出真假值即视为 OFF）。生效折扣开关 = `GUEST_SHOP_DISCOUNT_ENABLED` **AND** `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED`。
  - `/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/guest-shop/security.js`：fingerprint 扩展为含
    `quantity` + 归一化券码 + 折扣额，换券或换数量重放 → `guest_idempotency_conflict`（不是覆盖旧单）。
  - `/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js`（+491/−70）：
    preview 只回 `quantity_cap` / `discount_enabled` 等**能力标志**，绝不回可被信任的金额；
    create 路径服务端重算并落库。
  - `/Volumes/chao/AI/xianyu_profit_calculator/shop.html` + `/Volumes/chao/AI/xianyu_profit_calculator/js/guest-shop-client.js`（+495/−8）：
    数量步进器与优惠码区块**默认 `hidden`**，只有 `GET /guest/preview` 报 `quantity_cap >= 2` / `discount_enabled` 才显示；
    preview 的 `URLSearchParams` 白名单**只有** `site/productId/skuId/quantity`（券码**不进 URL**，§17 第 8 条）；
    切换商品/SKU 时 `resetPromoSelection` 清空数量与券码；cache bust 叠加 `guestPromo=20260923_GUEST_PROMO_L1L2_1`。
    隔离不变量保持：`js/guest-shop-client.js` 仍不含 `supabase` / `access_token` / `Authorization` / `Math.random()`。
- **错误码对外归一（C-E6）**：券生命周期的一切细码（含 `guest_discount_code_rejected`）对外**只**呈现
  `guest_discount_unavailable` 一个中性 400，不泄漏 `SQLSTATE` 与内部细码，防止券码枚举探测。
- **附带修复：时代感知探针（D-10 同类事故第二次）。** 15 参签名让两个**已归档**的 verify 探针假 FAIL ——
  它们把「13 参」「固定 1 件」写死在字面量里。修法是**改成时代感知，而不是再钉一个新常量**：
  `20260920_verify` 的 `fn`/`fn_grants` 改按 `pronamespace+proname` 解析、新增 `fn_era` CTE
  （`a0_signature` 13 参 / `l1l2_signature` 15 参），键名 `new_13_param_signature_present` → `known_signature_present`、
  `quantity_still_hardcoded_to_one` → `quantity_policy_matches_era`，`arity` 期望值由 `fn_era` 推导（`min(arity)`）；
  `20260921_verify` 的 `create_order_rpc_still_13_params` → `create_order_rpc_known_signature`（两个时代命中其一）。
  **`20260920` / `20260921` / `20260922` 三个迁移一行未改，不需要重跑**；改的始终是校验器。

### 证据

- 全量回归 `npm run test:security`：**3361 tests / 3361 pass / 0 fail**，`EXIT=0`（`main` 基线 3156，**+205**）。
  开发中出现过一次 **3314** 读数，诊断为 `--test-force-exit` 在高负载下的**瞬时少计**，随后三次连续运行稳定 3361；
  已登记而不追猎（证据文档 §2.7）。
- 聚焦测试全部本机复跑核实：promo-error-contract **9/9**（新）、frontend-contract **26/26**（基线 25）、
  create-order-signature-compat **15/15**（原 8 + 新 §5 的 7）、buyer-order-credentials **31/31**、
  verify-probe-contract **11/11**、readiness **28/28**、credit-pricing **13/13**、security **10/10**、
  orders-idempotency **7/7**、order-access-endpoints **43/43**。聚焦小计 **120/120**。
- 就绪度 `node scripts/guest-shop-readiness.js --json`：**296 项检查全部 `ok:true`**，`invalid_count` **0**，
  `warning_count` 5（全是「本地无 `.env.production` / 无 production 标识 / 两个 pepper 未配置 / NOWPayments 退款需人工」，
  属本地环境的预期告警），`manual_review_count` **14 → 20**（新增 6 项全在 `promo` 组），`ok: true`、**`ready: false`**。
  `--fail-on-invalid` 退出 **0**；`--fail-on-not-ready` 退出 **3** —— **这是本批的正确终态，不是待修故障**
  （没有实机证据就不该 ready；§17 第 9 条禁止用 `|| true` 绕过）。
- 新增 `promo` 就绪度组共 **108** 项：迁移 81 present / 17 absent（禁令）+ env 旋钮 + 客户端券码泄漏静态扫描 +
  6 项 `manual_review`。其中 `no-phantom-percent-knob` 禁令专门防止运维去配一个**不存在**的
  `GUEST_SHOP_DISCOUNT_MAX_PERCENT`（早期草稿提过，**未实现**；要收紧单券用 `guest_max_uses` /
  `guest_max_total_discount`，要收紧整站用 `guest_shop_promo_budget.daily_budget_cny`，
  要提高 50% 本身只能改迁移并重跑 verify）。
- 时代感知探针的守门员（两道，均已跑绿）：compat 测试 **§5 的 7 例**自动从迁移推导出**每一个历史签名**，
  断言归档 verify 认识当前签名、**绝不发明任何迁移没装过的签名**、按函数名而非精确签名解析、已退役键名保持退役、
  arity 的 CASE 覆盖当前时代；readiness 新增要求项 `verify-era-aware-signature` / `verify-known-signature-key` /
  `verify-era-aware-quantity`，禁止项 `verify-no-signature-pinned-cte` / `verify-no-era-pinned-arity` /
  `verify-retired-13-param-key` / `verify-retired-quantity-key`（A0）与 `verify-a1b-era-aware-rpc` /
  `verify-a1b-retired-rpc-key`（A1b）。
- 文档：`docs/guest-shop-promo-hardening-plan.md` 新增 **§23**（实现记录与 6 项偏差，**冲突时以 §23 为准**）；
  `docs/guest-shop-promo-evidence.md` 新增 **§2**（本批证据，含 22 行 verify 待跑清单【**2026-09-19 勘误：首次执行后已升级为 23 行，见 §60**】、§15.4 九项 0/9 登记表、
  4 个待排除文件的说明）与 §1.5 / §1.7 的两段探针勘误；`docs/guest-shop-payment-fulfillment-runbook.md` +159 行。

### 本轮没做什么

- **没有部署**：没有推分支、没有开/合 PR、没有 `vercel deploy`、没有触发 KVM4 任何链路、没有安装或启动 guest-shop worker。
  用户明确要求等指令。改动**至今未提交**。
- **没有执行任何 SQL**。`20260923` 迁移与 22 行 verify 只写成文件，绝对路径已交付（§2.4），由用户执行。
  【**2026-09-19 后续**：用户已执行，22 行报 20 PASS / 2 FAIL，两处均为探针缺陷，已修为 23 行 —— 见 **§60**。】
- **没有打开任何开关、没有启用游客商品/SKU**：`GUEST_SHOP_DISCOUNT_ENABLED` 默认 OFF，`GUEST_SHOP_MAX_QUANTITY` 默认 **1**。
  即使代码发布，游客单仍固定 1 件、仍不带券码，行为与 P0 一致。
- **本批没有 quote 端点**（偏差 1，§23.2）：`POST /api/shop/guest/quote`、`p_mode='quote'`、quote 令牌绑定与
  `guest_quote_stale` 全部延后。折扣改为在 **create 时**服务端应用并校验，券不可用即统一 400
  `guest_discount_unavailable`，**不产生订单行**。代价是用户「下单后才知道券不能用」，属可接受的体验折衷。
- **C-D3（库存占比闸）/ C-D4（并发未付款单闸）/ C-D5（促销单 TTL）未实现**（偏差 4，§23.5）。
  这三项是放开 `GUEST_SHOP_MAX_QUANTITY >= 2` 的**前置条件**，因此该值**本批禁止调高**。
- **L4 后台运营界面未开工**：券的 `allow_guest`、游客预算、熔断状态与人工恢复目前没有 UI，
  熔断恢复只能由运维手工执行 `SELECT public.fn_guest_shop_promo_set_breaker('closed', '<actor>', '<reason>')`。
- **§7.4 阶梯锁定退避未实现**（偏差 6，§23.7）：由 24h 台账配额 + 熔断替代。
- **A4（邮箱 OTP + 游客订单并入账号）未做**：按 §22.3 必须排在本批之后。
- **提交时必须排除 4 个无关未跟踪文件**：`DEPLOYMENT_STEPS.md`、`deploy-guest-shop-worker.sh`、
  `kvm4-deployment-guide.md`、`kvm4-env-template.txt`。它们是 2026-09-17 的部署草稿/包装脚本，非本批产物；
  `kvm4-deployment-guide.md` 自身首行即标注「本文件已作废（v1 草稿）」，`deploy-guest-shop-worker.sh`
  绕过 `AGENTS.md` 规定的 `npm run deploy:kvm4:*` 与 host installer 路径。**不得随本批进入 `main`。**

### 风险和修正

- **最大风险：多件（quantity ≥ 2）在 C-D3/C-D4 缺席下会被刷库存。** 现状：件数上限虽由四处取小钳制，
  但「批量创建不付款单占住卡密」这条攻击路径**没有闸**。修正：`GUEST_SHOP_MAX_QUANTITY` 保持 **1** 直到
  C-D3/C-D4/C-D5 落地；§15.4 第 7 项在此之前**必然不通过**，不要把它当作偶发失败去绕过。
- **零元购已被数据库层堵死，但依赖迁移真的落库。** `guest_shop_orders_amount_check` 的五条红线在**数据库**里，
  迁移未执行时它们并不存在。修正：启用前必须看到 §2.5 第 2、9、12、22 行 PASS，不接受「代码里已经写了」作为证据。
- **假 FAIL 会再次发生，只要有人再往探针里钉常量。** 本轮已是 D-10 同类事故**第二次**。修正：compat §5
  从迁移**自动推导**每一个历史签名（不再手抄），readiness 用禁止项挡住「按精确签名解析 CTE」「arity 写死 13」
  「已退役键名复活」三种写法。下次再犯会先在 CI 里红，而不是在用户的 SQL editor 里红。
- **没有 quote 端点意味着券失败发生在下单时。** 用户填了券、点了购买，才知道券不可用。修正：对外只回一个中性
  `guest_discount_unavailable`（不泄漏是「券不存在」「已用尽」还是「不允许游客」，防枚举）；若运营反馈失败率过高，
  再按 §23.10 第 3 项补 quote 端点。
- **熔断无半开、且没有 UI。** 促销被打停后不会自动恢复，运维必须手工执行 SQL 函数。这是**刻意的**保守选择
  （自动半开会让攻击者用定时探测把熔断变成周期性放闸）。修正：L4 落地前，把恢复 SQL 写进 runbook（已 +159 行）。
- **客户端只信服务端标志，但 preview 仍可能被限速/5xx。** 此时数量与券码区块保持 `hidden`，游客退回单件无券下单 ——
  fail-closed，符合「发布不等于启用」的口径。

### 进度

- 总进度仍记 **48%**（A+B+C+F+H）。**本批属于促销加固批次（L1+L2），不在 A–J 阶段记账内，不计入总进度**；
  D 仍 `in_progress`（INTL 成功支付仍未入账）。100% 只在第 J 节用户签署之后。
- 促销加固自身的口径按 §17 第 12 条：**没有 §15.4 实机证据，不得宣称游客促销「完成」或「可启用」**。
  当前状态是「代码 + 迁移文件 + 22 行 verify【**勘误：现为 23 行，见 §60**】 + 自动化守门员 + 就绪度扫描全部就位并跑绿，
  实机证据 **0/9**、迁移**未落库**」，`ready:false` / 退出码 3 就是这个状态的机器可读表达。

### 下一步

1. **用户执行迁移**（写操作，落库后行为仍中立，因为开关默认关闭）：
   `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_guest_shop_promo_l1l2.sql`
2. **用户执行 verify**（只读、可重复，**22 行**【**已被 §60 取代：现为 23 行，第 1–22 行须 PASS，第 23 行 PASS/REVIEW**】），把输出贴回来由我归档进证据文档 §2.5：
   `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql`
   必须看到 PASS 的四行：`orders_amount_check`(2)、`function_arity_single_overload`(9)、
   `zero_purchase_guards`(12)、`promo_function_guards`(22)。
   【**2026-09-19 已执行**：这四行里 (2)(9)(22) PASS，(12) 因探针缺陷假 FAIL，已修，待复跑 —— 见 **§60**。】
3. 如需在同一座库上重跑**已归档**的两个旧 verify，用修复后的版本，并预期看到新键名与 `arity: 15`：
   `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260920_verify_guest_shop_buyer_credentials.sql`（11 行）、
   `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260921_verify_guest_shop_buyer_group_upsert.sql`（6 行）。
   **A0 的三个迁移不需要重跑。**
4. **用户执行 §15.4 九项沙箱实机验证**（第 7 项需先补 C-D3/C-D4；第 5、6 项是 §22.5 反杀熟守门员，**不可删除**）。
5. 上述完成后，由用户下达**明确部署指令**，我才按 `AGENTS.md` 的游客购买流程发布：专用分支 → PR → `main` →
   **四条链路**（Vercel production、KVM4 Verify Server、KVM4 Sub2API、KVM4 guest-shop worker），
   不得从功能分支 `vercel deploy --prod`。
6. **发布 ≠ 启用**。启用另需 §14 的灰度许可签署 + §15.4 实机证据归档；回滚用**开关**，不用 DB 回滚（§17 第 10 条）。
7. 后续批次（§23.10）：L4 后台运营界面 → C-D3/C-D4/C-D5（多件前置）→ 可选 quote 端点 → 可选 §7.4 阶梯退避 → A4。

### SQL 状态

本轮**新增 2 个 SQL 文件待用户执行**（§59「下一步」第 1、2 条），Codex **不代执行**。

不要重跑 20260913 / 20260914 / 20260915 / 20260916 / 20260917 / 20260918 / 20260919 /
20260920 / 20260921 / 20260922 这十个迁移 —— 其中 `20260920` / `20260921` / `20260922` 三个**迁移**本批一行未改
（只改了同名的 **verify 探针**，探针只读、可重复执行，重跑不是重跑迁移）。


---

## 60. 2026-09-19 促销 verify 首次实机执行：22 行报 2 FAIL，两处均为**探针缺陷**（D-10 第 3、4 类），已升级为 23 行

> 日期口径：真实执行日 **2026-09-19**（与 §59 同日、晚于其归档）。代码注释里出现的
> 「2026-09-23」沿用迁移文件名 `20260923_*` 的序号日期，指的是**同一个事件**，不是另一天。

### 60.1 用户实机输出（原样登记）

- 迁移 `20260923_guest_shop_promo_l1l2.sql`：**已在目标 Supabase 落库**。
- verify `20260923_verify_guest_shop_promo_l1l2.sql`：首次执行，**22 行 → 20 PASS / 2 FAIL**。
- FAIL 行 1：第 **12** 行 `zero_purchase_guards`，15 个键里唯一为 `false` 的是 `evaluate_is_read_only`
  （observed `false` / expected `true`），其余 14 键全 `true`。
- FAIL 行 2：第 **16** 行 `no_side_effects`，唯一不符的是 `guest_products_enabled`
  （observed **2** / expected **0**），其余 6 键全 `true`、`writable_browser_policies` 为 `[]`。

### 60.2 结论：**迁移一行未改**，两处都是 verify 探针自身的缺陷

| # | FAIL 位置 | 根因 | D-10 类别 | 修法 |
|---|---|---|---|---|
| 1 | 第 12 行 `zero_purchase_guards.evaluate_is_read_only` | `pg_proc.prosrc` **原样保留函数自己的 SQL 注释**。`fn_guest_shop_evaluate_discount` 在说明原子性时写了 “deduction is the atomic UPDATE pair in `fn_guest_shop_reserve_discount`”，退役探针 `prosrc ~* UPDATE` 把这句**注释**当成了 DML，于是判定一个真正只读的函数「会写库」 | **第 3 类**：注释文本被当作可执行代码 | 新增 CTE `fn_code`，先剥 `--` 行注释与 `/* */` 块注释再扫描；本文件**所有**函数体探针（正向与负向）统一改跑 `fn_code`，避免「只被注释满足的正向探针」这一更危险的同源假 PASS |
| 2 | 第 16 行 `no_side_effects.guest_products_enabled` | 把**运维状态**（已开放游客结账的商品数）钉成常量 `0`。用户为测试开了 2 个商品，这是人的决定，任何迁移都无权、也无法把它变回 0 | **第 4 类**：把运维状态钉死成常量 | 第 16 行只保留**机制**断言 `promo_functions_never_write_products`（任何 `guest_shop*` 函数都不得写 `shop_products`）；实时状态挪到**新增的第 23 行** `operator_state_review`，输出 `PASS` 或 `REVIEW` |

两处都符合 D-10 的既有结论：**报 FAIL 的是校验器，不是被校验的对象**（同类事故第 1、2 次见 §1.3 / §1.5 / §1.7）。
处置方式也一致：**不重跑迁移**，只重跑修复后的 verify（只读、可重复执行）。

### 60.3 「剥注释」为什么不会把真缺陷放过去（安全性证明）

这是本轮唯一需要论证的改动方向 —— 剥注释天然是**放松**扫描，必须证明它只影响注释、不影响正文：

1. **字面量扫描**：用引号感知扫描器取出仓库里全部 **53** 个 `guest_shop*` 函数体中的字符串/美元引用字面量，
   其中包含 `--` 或 `/*` 的字面量数 = **0** → 剥注释不可能吃掉任何被断言的正文文本。
2. **探针静态重放**：把全部函数体探针分别在 raw `prosrc` 与 `fn_code` 上重放，**正向探针结果逐一相同**；
   唯一发生变化的是那条负向只读 DML 探针（`FAIL → PASS`），正是本次要修的目标。
   **不存在任何 `PASS → FAIL` 方向的漂移。**
3. **反向保险**：`fn_code` 定义为 `SELECT f.*, regexp_replace(...) AS code FROM guest_fns f`，是 `guest_fns` 的**严格超集**，
   `prosrc` 仍在；将来若某条探针确实需要原文（例如断言注释本身存在），可继续用 `prosrc`。
4. **fail-closed 键**：verify 内保留证明「剥注释没有把函数体剥空」的键；
   守门员测试 `tests/guest-shop-verify-probe-contract.test.js` **§7** 逐字验证剥注释逻辑保住字符串字面量与美元引用体、只丢散文，
   并断言四个 verify 脚本**全部只读**。
5. **规则入档**：文件头 `RULE FOR PROBE AUTHORS` 从 3 类扩到 **4 类**，并写明
   「正向体探针在 raw 与 fn_code 上结果相同；唯一刻意的例外是负向只读 DML 探针（FAIL→PASS）；
   任何体探针都不得因剥注释而向 PASS→FAIL 方向漂移」。

**明确禁止的两种「修法」**（都会把安全断言换掉而不是修探针，已在 readiness 里设为禁止项）：
删掉 `fn_guest_shop_evaluate_discount` 里那句原子性说明注释；或直接删掉 `evaluate_is_read_only` 断言。

### 60.4 本轮变更清单（全部 amend 进 `codex/guest-shop-promo-l1l2` 顶端那**一个**提交）

| 文件 | 变更 |
|---|---|
| `supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql` | **22 行 → 23 行**，1279 → **1433** 行；新增 `fn_code` CTE 并把全部体探针切过去；第 16 行改为机制断言；新增第 23 行 `operator_state_review`；文件头规则 3 扩写 + 新增规则 4。**仍是单条只读语句**（libpg-query 解析：1 statement） |
| `supabase/migrations/20260923_guest_shop_promo_l1l2.sql` | **只改 §9 运维注释**（说明 23 行、第 1–22 行须 PASS、第 23 行 REVIEW 语义）。**DDL / 函数体 / CHECK / 索引 / 权限一行未动** |
| `tests/guest-shop-verify-probe-contract.test.js` | 11 → **19** 例（+8）。新增 §7「体探针必须剥注释」与 §8「运维状态不得钉死」；「四个 verify 全部只读」；冻结行清单补到 **23** 个促销行名；顺带修掉 `password_hash` 用例约 12% 的偶发变红（注入确定性 `+` / `/`）。连跑 ×5 稳定、flake 测试 ×40 稳定 |
| `scripts/guest-shop-readiness.js` | 新增 **9** 条 `PROMO_VERIFY_REQUIREMENTS` + **3** 条 `PROMO_VERIFY_PROHIBITIONS`；修正 `promo-schema-applied` 文案（23 行 + REVIEW 语义）。checks **296 → 308**（`promo` 组 108 → **120**），`invalid 0`、`manual_review 20`（不变）、`ready:false`（不变） |
| `tests/guest-shop-readiness.test.js` | 28 → **29** 例。促销 verify 篡改测试新增 **7** 个 fail-closed 变体（含「行名必须全局替换，只换第一处会假绿」的守卫） |
| `docs/*` | 本节（§60）+ `docs/guest-shop-promo-evidence.md` §2.1/§2.2/§2.3/§2.4/§2.5/§2.7/§2.8 计数与状态更新、新增 **§2.9** 归档首次 20 PASS / 2 FAIL + 新增 **§2.10** 待复跑清单 + `docs/guest-shop-payment-fulfillment-runbook.md` 启用前置清单第 2 条 |

**顺带修掉一个提交完整性缺陷**：§59 那个提交实际只含 **26** 个文件，
`tests/guest-shop-readiness.test.js` 与 `tests/guest-shop-verify-probe-contract.test.js` 的改动**只留在工作区、没进提交**
（源码进了、对应守门员测试没进 —— 正是「守门员没随规则一起上线」这类最危险的漏项）。
本轮 amend 已把两者补进**同一个**提交，完整口径为 **4 个新文件 + 24 个已跟踪文件改动 = 28 个文件**。
证据文档 §2.1 的文件表已按 `git show --numstat` 重新生成，并写明「+/− 是快照、会随 amend 漂移，
权威口径是 numstat；稳定的只有文件清单与 4/24/28 这三个计数」—— 与本批「不写死 commit hash」是同一条纪律。

全量回归：`npm run test:security` **3361 → 3370 pass / 0 fail**（+9 = 探针合同 +8、readiness +1），满足「pass 只增不减、fail 恒为 0」；
**连续两次独立运行均为 3370 / 3370 / 0 fail、`EXIT=0`**（第二次在全部文档改完之后跑，确认文档改动没有踩到任何 `docs` 区就绪度断言）。
就绪度退出码：`--fail-on-invalid` = **0**，`--fail-on-not-ready` = **3**（仍是**预期的 fail-closed**，不得 `|| true` 绕过）。

### 60.5 ⚠️ 必须请用户当面确认的运维状态（第 23 行点名的内容）

verify 第 23 行报出 **`guest_products_enabled = 2`**，而 §59 之前的既有口径是 **1** 个
（§45 附近的常设规则原文：「用户已主动打开 1 个商品做测试准备，非代码故障；**不得再开第二个**，也不得公开上架」）。

第 23 行会把这两个商品**逐一点名**（光有计数无法据此行动 —— 1 → 2 的增量正是这样发现的），请核对后二选一：

- **若是有意开启**（例如新加的沙箱测试 SKU）：把该 SKU 写进白名单说明并更新上面那条常设规则；
  同时确认它满足「低价值 / 非共享 / 自动发货」三条，且**未公开上架**。
- **若是误开**：立刻关掉（`allow_guest_purchase = false`）。
  按 §17 第 10 条，**回滚游客结账的正确方式是关开关，不是 DB 回滚，也不是 Vercel 回滚。**

**在用户确认之前**：`GUEST_SHOP_MAX_QUANTITY` 保持 **1**、`GUEST_SHOP_DISCOUNT_ENABLED` 保持 **OFF**、
`guest_shop_promo_budget` 保持 `enabled=false / daily_budget_cny=0`、熔断保持 `closed`。
Codex **不代为打开任何开关、不执行任何 SQL**。

### 60.6 下一步（替换 §59「下一步」第 2 条）

1. **用户复跑修复后的 verify**（只读、可重复执行，**23 行**）：
   `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql`
   预期：**第 1–22 行全 PASS，第 23 行 `operator_state_review` 为 PASS 或 REVIEW**。
   仍必须逐行看到 PASS 的四行：`orders_amount_check`(2)、`function_arity_single_overload`(9)、
   `zero_purchase_guards`(12)、`promo_function_guards`(22)。
2. 把 23 行输出贴回来，由我归档进 `docs/guest-shop-promo-evidence.md` **§2.10**
   （首次的 20 PASS / 2 FAIL 已作为 D-10 第 3、4 类事故归档在 **§2.9**，**保留不删**，作为探针纪律的实证锚点）。
3. 按 §60.5 确认第 23 行的运维状态。
4. 其余顺序**不变**：§15.4 九项沙箱实机验证（第 7 项需先补 C-D3/C-D4；第 5、6 项是反杀熟守门员，不可删除）
   → 用户下达**明确部署指令** → 按 `AGENTS.md` 走专用分支 + **四条链路** → **发布 ≠ 启用**（启用另需 §14 灰度许可签署）。

### 60.7 风险和修正

- **风险：探针「变绿」比「变红」更危险。** 剥注释是放松扫描，若有人顺手把正向探针也切到 `fn_code`
  却不做重放证明，就可能造出「只被注释满足」的假 PASS。修正：§60.3 的 5 条证明 + 守门员测试 §7 把
  「字面量不含注释标记」「正向探针两种口径结果相同」「不得 PASS→FAIL 漂移」全部固化成断言。
- **风险：第 23 行 REVIEW 被误读成「迁移失败」或被误读成「可以忽略」。** 修正：verify 文件头、迁移 §9、
  runbook 启用前置清单第 2 条、readiness 的 `promo-schema-applied` 文案**四处**同时写明 REVIEW 语义
  （= 必须有人逐条核对列出的运维状态，≠ 迁移失败），并由 readiness 禁止项挡住「删掉 REVIEW 分支」的写法。
- **风险：篡改测试的 needle 过期导致空转假绿。** 本轮真的踩到一次：行名替换只换了第一处
  （`checks` CTE 里换了、最后的判分 `CASE` 里没换），闸门仍然命中，测试却绿着。修正：改为**全局替换**，
  并在每个变体后加 `assert.notEqual(tampered, realVerify)`，篡改没生效就直接红。
- **不变的红线**：安全第一、绝不零元购、防掏鸟蛋、防刷。本轮**没有**为了让输出变绿而弱化任何一条安全断言：
  零元购地板、50% 折扣硬顶、通道费 10% 硬顶、15 参唯一重载、`evaluate` 只读、白名单 + 配额闸、
  原子扣预算与计数 —— 全部**原样保留**，只修了它们的**观测方式**。

### 60.8 2026-09-19 后续：23 行 verify **复跑闭合** + 第 23 行用户裁决 + §9.5 parity 交付

> 本节晚于 §60.1–§60.7 归档，记录三件事：①修复后的 23 行 verify 已由用户**复跑**并闭合；
> ②第 23 行 `operator_state_review` 的 REVIEW 已由用户**当面裁决**；③补上 §9.5 要求的
> **≥40 条黄金向量 parity 测试 + 配套只读 SQL**。详细逐行读数与权威边界见
> `docs/guest-shop-promo-evidence.md` **§2.10 / §2.11**（本节只做索引与决策登记，不重复证据）。

#### 60.8.1 复跑结果（替换 §60.6 第 1、2 条的「待复跑」状态）

- 用户已用 §2.9.6 升级后的 **23 行**版 `20260923_verify_guest_shop_promo_l1l2.sql` 复跑（**未重跑迁移**，
  落库版本与当前文件在 DDL / 函数体 / CHECK / 索引 / 权限上逐字等价）。
- 结果：**第 1–22 行全 PASS（22/0），第 23 行 `operator_state_review` = REVIEW**。用户回执「验证结果符合预期」。
- 与「绝不零元购」直接相关的四行 `orders_amount_check`(2)、`function_arity_single_overload`(9)、
  `zero_purchase_guards`(12)、`promo_function_guards`(22) **复跑全部 PASS**；首跑假 FAIL 的 (12) 修复后兑现
  （§2.9.2 / §60.2），第 16 行改机制断言后亦 PASS（§2.9.3）。**首跑 20 PASS / 2 FAIL 归档（§2.9）保留不删。**
- 归档位：`docs/guest-shop-promo-evidence.md` **§2.10.1**（原样登记复跑输出）。

#### 60.8.2 第 23 行 REVIEW 的用户裁决（运维状态，**推翻旧常设规则的「固定 1 个」前提**）

第 23 行点名 `guest_products_enabled = 2`：`52246f1d-…-581296f43de9`「测试」、`c16212d8-…-3cc68b2d7a52`「测试 2」，
均 `is_active=true`、`guest_skus=0`、未公开上架；`guest_skus_enabled=0`、`guest_discount_codes_open=0`。用户裁决：

- **保留这 2 个游客商品**（本人手动开启的沙箱测试商品）。
- **关键澄清**：某商品是否属于游客商品，**取决于管理员在 Admin Studio 里打开了哪个商品的游客开关**，
  是**动态、管理员可控**的，**既不是固定 1 个、也不是固定 2 个**。
- 据此**作废旧常设规则中的「计数上限」一句**（§45 附近原文「用户已主动打开 1 个商品做测试准备……
  **不得再开第二个**，也不得公开上架」里的「不得再开第二个」），改为：「**游客商品数量由管理员开关决定，
  无固定上限；但每一个被打开的商品都必须满足低价值 / 非共享 / 自动发货，且未公开上架**」。
  **「不得公开上架」与三条资质要求原样保留。**
- **REVIEW 机制保留不删**：第 23 行继续逐次点名当前所有游客商品（而非只给计数），供每次复跑人工对账 ——
  这正是 1 → 2 增量当初被发现的机制（§2.9.5 / §60.5），不因计数上限作废而削弱。
- **技术护栏一条未弱化**：`GUEST_SHOP_MAX_QUANTITY=1`、`GUEST_SHOP_DISCOUNT_ENABLED=OFF`、
  `guest_shop_promo_budget` `enabled=false / daily_budget_cny=0`、熔断 `closed`。Codex **不代为打开任何开关、
  不执行任何 SQL、不部署**。
- 常设规则同步更新处（注解 / 取代而非删除，保留审计轨迹）：本文档第 **202 / 659 / 678 / 733 / 782** 行、
  `docs/guest-shop-promo-evidence.md` **§2.9.5**。归档位：**§2.10.2**。

#### 60.8.3 §9.5 黄金向量 parity 交付（readiness `promo-parity-evidence` 硬证据之一）

| 交付物 | 绝对路径 | 规模 | 实测状态 |
|---|---|---|---|
| parity 测试 | `/Volumes/chao/AI/xianyu_profit_calculator/tests/guest-shop-pricing-parity.test.js` | 380 行 / 9 例 / **74 条黄金向量**（A32·B10·C20·D12） | `node --test` **9 pass / 0 fail** |
| 配套只读 SQL | `/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260923_verify_guest_shop_promo_parity.sql` | 120 行 / **单条** `WITH...SELECT` / 32 条 group-A fixture | libpg-query `statements: 1`；注释外无任何写关键字 |

- 权威边界：`resolveGuestCreditUnitAmount` 是 SQL resolver 的**只读镜像**，只算单价 / 列表价（基础 / 闪购 / 阶梯），
  **从不算折扣**；`buildGuestAmountBreakdown` 只整形 **DB 已返回**的金额，零值 / 负值 / 不自洽（`net+fee≠total`）
  一律 **fail-closed 返回 null**；件数天花板 resolver `99`、breakdown/order `5`，越界 env **降级到 1 绝不放大**。
- 防漂移：配套 SQL 由测试源码生成，group-A VALUES 与 JS fixture 逐字一致（32/32），`p_now` 两侧统一
  `'2026-09-14T12:00:00.000Z'`；测试断言 SQL 文件存在、含每个 group-A id、剥注释后无写关键字。
- resolver 仅 `GRANT service_role`，配套 SQL 由用户在 SQL Editor 执行，**Codex 不执行**。
- 归档位：`docs/guest-shop-promo-evidence.md` **§2.11**（含权威边界、防漂移、回归读数）。

#### 60.8.4 回归读数（本机实测，2026-09-19）

```text
node --test --test-force-exit tests/guest-shop-pricing-parity.test.js  →  tests 9  pass 9  fail 0
npm run test:security                                                  →  tests 3379 pass 3379 fail 0  EXIT=0
node scripts/guest-shop-readiness.js --json     →  checks 308  ok 308/308  invalid 0  warning 5  manual_review 20  ready false
node scripts/guest-shop-readiness.js --fail-on-invalid    →  EXIT 0
node scripts/guest-shop-readiness.js --fail-on-not-ready  →  EXIT 3   （预期的 fail-closed，禁止 || true 绕过）
```

全量 **3370 → 3379**（+9 = parity 9 例），满足「pass 只增不减、fail 恒为 0」。本轮首跑曾报 `tests 3340`，
第二次独立运行即恢复 `3379`，属 §2.7 / 证据文档 §2.11.3 登记的**瞬时少计**，以复跑后的 3379 为权威，不追猎、不改测试。

#### 60.8.5 状态与下一步（替换 §60.6）

- **§2.10 复跑已闭合、§2.11 parity 已交付**；但 `ready` 仍为 **false**：`promo-parity-evidence` 只满足
  「≥40 条黄金向量」一半，**§15.4 九项沙箱实机验证仍 0/9**（§2.6），故**不得宣称完成或可启用**。
- 接下来严格按序：① **用户执行 §15.4 九项沙箱实机验证**（第 7 项需先补 C-D3/C-D4；第 5、6 项是反杀熟守门员，
  不可删除）→ ② 用户下达**明确部署指令** → ③ 按 `AGENTS.md` 走专用分支 + **四条链路** →
  ④ **发布 ≠ 启用**（启用另需 §14 灰度许可签署）。Codex **不执行 SQL、不打开开关、不部署**，直至用户明确下令。

---

## 61. 2026-09-19 任务 2.1：游客收银台五按钮、身份恢复与运行护栏升级计划

> **状态：阶段 1、2 已完成，2.1 总进度 40%。** 安全切片已经由 PR #656 发布并完成四链同 commit 验证；这仍不把自动化或默认关闭发布误报为指定 SKU 启用完成。P0-C 的短期「离开」语义和 P0-D 的终态展示已有前置切片；剩余证据按 §61.9 分层使用，当前进入阶段 3 的精确 SKU 与凭证能力评审。

### 61.1 审查结论：按钮存在，不等于动作闭环完整

本节最初以用户提供的游客结账弹窗截图，以及当时的 `shop.html`、`js/guest-shop-client.js`、`server/api-handlers/public/guest-shop.js` 和 `api/public.js` 为证据。下表保留审查基线和风险判断；本轮实施后的准确状态以 §61.7–§61.10 的实施记录和未闭合证据为准：

| 动作 | 当前实现 | 严重度 | 主要风险 | 2.1 判断 |
| --- | --- | --- | --- | --- |
| 「稍后处理」 | `closeGuestModal()` 只清输入框、停止轮询/倒计时并隐藏弹窗；订单、cookie、`sessionStorage` 和库存预占保留；刷新时还可能自动恢复弹窗 | P2（语义）/P1（竞态） | 用户以为订单暂停或取消；隐藏弹窗后异步创建/找回响应仍可能写入旧状态；“稍后”是否自动弹出没有明确承诺 | 保留“离开页面”能力，但必须改文案、提示、自动恢复说明和代数隔离 |
| 「创建支付订单」 | 有服务端重算、幂等键、原子预占和 provider lease；但锁在首个 `await loadPreview()` 之后才建立，且无效支付 QR/地址的错误状态可能被后续“订单已创建”文案覆盖 | P1 | 双击/快速点击可并发预览或创建；服务端已建单但客户端超时/丢响应时，界面没有订单号和恢复入口；没有可支付凭证时却继续引导付款 | 先锁请求，再预览；未知结果和无效 checkout 必须进入 `review` 并提供找回路径，禁止重复付款 |
| 「查询支付状态」 | 后端有 claim 校验、主动查单、节流和 worker kick；按钮每次点击都 `resetWindow + force_provider_refresh`，无前端互斥 | P1 | 快速连点并发查渠道、触发限流；`review`/终态仍可能显示普通查询；状态文案可能把金额异常/退款显示成超时 | 统一状态机、busy/debounce、终态映射和手动重试上限 |
| 「关闭当前订单」 | `abandonCurrentOrder()` 只清本地句柄；没有 `/guest/cancel` 路由或取消 RPC，服务端预占等 TTL 释放；该分支还需显式清除查询密码 | **P0** | 按钮名暗示订单已关闭；旧付款码在 TTL 内仍可能付款，造成 `paid_unfulfillable`/退款；`review`、未知金额等状态可能被清掉本地证据，旧密码可能污染下一次下单 | 在真正取消能力上线前不得使用“关闭订单”语义；短期改成“离开当前订单”，长期再做有条件幂等取消 |
| 「找回订单」 | 旧链路为订单号+取货口令；邮箱+查询密码入口按开关显示；recover 返回的快照缺商品/站点/渠道上下文 | P1 | 找回期间旧轮询未停；跨商品/跨站可能沿用当前页面商品、旧二维码或旧金额；终态先闪现“核验中” | 双链路按开关分流，先隔离旧状态，再用服务端快照重建界面；不泄露凭证 |

另有一个纯 UI 闸门：`.shop-btn` 在作者样式中强制 `display:flex`，而五个按钮主要依赖 HTML `hidden`。如果没有显式的 `.guest-shop-modal__actions .shop-btn[hidden] { display:none !important; }`，计算样式可能覆盖隐藏意图，导致“不该出现的按钮”仍占位或可聚焦。契约测试必须检查计算样式，不只检查 DOM 属性。

**“线上像回退老版本”的首要判定：** 当前生产表现还可能只是 fail-closed 开关，而不是代码回滚。`GUEST_SHOP_BUYER_CREDENTIAL_ENABLED`、`GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED`、`GUEST_SHOP_DISCOUNT_ENABLED` 未启用时，预览会返回 `buyer_credential_required:false`、`discount_enabled:false`，`GUEST_SHOP_MAX_QUANTITY` 默认 1；查询 API 也可能返回 `guest_feature_disabled`。2.1 要求先记录 commit、env 开关、preview 响应和页面/API 门禁，再判断是否真回退；禁止靠手工改前端或直接打开所有开关“验证”。

### 61.2 2.1 设计原则与范围

1. **一个状态机、一个动作策略。** 所有按钮的显隐、禁用、文案、`aria-*` 和轮询策略由同一个 `deriveGuestActionPolicy(state)`（名称可调整）输出；禁止在几十个事件分支里各自 `setHidden()` 形成漂移。
2. **服务端状态优先。** 商品、SKU、站点、数量、阶梯价、优惠、手续费、应付金额、支付终态、库存和退款状态均由服务端/数据库裁决，客户端只渲染经过 allowlist 的快照。
3. **未知不等于未支付。** provider 超时、响应丢失、回写失败、金额/币种无法核对统一进入 `review/payment_creation_unknown`，不得显示“请继续付款”、不得释放可能已付款的预占，也不得允许盲目重新创建。
4. **无破坏性假动作。** 没有服务端取消和渠道状态确认时，客户端只能“离开当前页面”；不能声称订单已关闭、不能声称库存已释放、不能抹掉用户唯一恢复线索。
5. **凭证分层。** 凭证开关开启时，新订单以邮箱+查询密码为主；旧订单号+`recovery_code` 仅兼容迁移。任何 status/recover/claim 响应都不得回吐 `recovery_code`、密码、claim token、卡密或原始 provider payload。
6. **发布、配置、启用三者分离。** 代码部署成功不代表邮箱凭证、查询页、优惠码或多件购买已开启；readiness、页面门禁和 Admin Studio 开关必须能准确反映实际运行状态。

### 61.3 目标状态机与五按钮矩阵

符号：`✓` = 可用；`—` = 隐藏；`忙` = 显示但必须锁定；`条件` = 只有满足行内条件才可用。以下是 2.1 的目标合同，当前实现未全部满足前不得宣称完成。

| 状态 | 自动轮询 | 稍后处理 D | 创建支付 C | 查询状态 Q | 离开/取消 A | 找回 R | 必须显示的事实 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `configure`（尚未建单） | 否 | ✓ | ✓ | — | — | ✓ | 当前商品、SKU、服务端报价、支付方式 |
| `creating`（预览/建单中） | 否 | 条件：标记当前代数失效 | 忙 | — | — | 忙/— | 正在创建；禁止第二个 idempotency key |
| `awaiting_payment`（已建单、已知未付款） | 是 | ✓（仅离开，不取消） | — | ✓（节流） | 条件：短期本地离开；长期仅真取消 API | ✓ | 订单号、应付金额、渠道、过期时间、不可重复付款提示 |
| `checking`（查单/发货核验中） | 是 | ✓ | — | 忙/节流 | —，除非服务端明确仍未付款 | ✓ | “正在核验”，不能误报成功或超时 |
| `review/payment_creation_unknown` | 否或按人工策略 | ✓ | — | ✓（人工刷新，受限） | — | ✓ | “支付结果未知/人工对账”，保留订单号和客服入口 |
| `confirmed + pending/fulfilling` | 是 | ✓ | — | ✓（刷新发货状态） | — | ✓ | 已确认付款、发货阶段、退款/补发说明 |
| `confirmed + paid_unfulfillable/dead_letter` | 否 | ✓ | — | 条件：刷新人工处理状态 | — | ✓ | 库存/履约异常、退款或人工补发进度、客服入口 |
| `failed/expired/refunded/chargeback/amount_mismatch/overpaid/partial` | 否 | ✓ | 条件：先回到配置并明确新单 | ✓：仅查详情/退款状态 | —；不能把已收款单当未付款清掉 | ✓ | 真实终态、金额/退款状态；不得统一套“支付超时” |
| `delivered` | 否 | 条件：已复制或有可用恢复路径后关闭 | 条件：关闭已完成展示后重新购买 | — | — | ✓ | 卡密、发货状态、复制操作 |
| `recovering`（找回请求中） | 否（先停旧代数） | 条件：离开后响应不得回写 | — | — | — | 忙 | 找回进度；禁止旧订单 UI 与新响应交叉 |

矩阵补充规则：

- `D` 关闭弹窗不会释放服务端预占；按钮旁必须明确“仅离开本页，旧付款码不要再付，库存按 TTL 释放”（若未来真取消 API 上线，另行替换文案）。
- `Q` 在同一订单同一时刻最多一个请求；自动轮询达到 15 分钟上限后停止，手动查询只恢复一个受限窗口，不得无限绕过 provider throttle。
- `A` 对 `review`、未知支付、已收款、金额异常、退款/争议、`claimInFlight` 一律禁用或要求人工确认；不能仅依据客户端 `paymentConfirmed=false` 判断“未付款”。
- `R` 不能直接覆盖活动订单；必须先停旧轮询、清理旧 checkout/context，或要求用户确认在新窗口找回。
- `delivered` 的 D 动作必须保护未复制的发货内容；关闭不是删除，除非查询页/邮箱密码恢复已经实际可用并通过实机验证。

### 61.4 五个动作的执行合同

#### 61.4.1 「稍后处理」：离开，不是暂停/取消

- 保留本地订单句柄和 HttpOnly claim cookie，以便同一设备重开后继续；密码输入框立即清空，口令不写存储。
- 在按钮或状态区写明：**“仅离开当前页面，不会取消订单，不会立即释放库存，也不会发送付款成功通知。”**
- 当前邮箱提示中的“获取发货通知”只有在真实通知链路、退订、失败告警和隐私留存都上线后才能保留；在此之前改为“用于查询订单”，不得让用户以为离开弹窗后一定会收到邮件。
- 点击时递增 `viewGeneration`/`pollGeneration`，使尚未返回的 preview/create/recover 响应失效；隐藏弹窗后不得新建轮询。
- 已 `delivered` 时不得用同一个“稍后处理”动作静默清掉尚未复制的卡密；应改成“关闭已发货内容”并二次确认，或在有可用邮箱密码/订单查询恢复路径时才允许关闭。
- 刷新、重开、跨标签和 `sessionStorage` 不可用时，必须分别有可理解的恢复路径；是否自动弹出恢复窗口要在文案中明确，不得让“稍后处理”既像离开又像强制下次弹出。

#### 61.4.2 「创建支付订单」：幂等、未知结果可恢复

- 在**第一个异步操作之前**取得全局 request lock、禁用按钮并记录 context/quote generation；双击、键盘 Enter、重复事件只能进入一次。
- preview、create、provider-create、回写每一层都携带同一个 idempotency key；响应丢失时重试只能得到同一订单，不得再开库存预占或支付意图。
- provider 超时或回写失败时，返回/渲染 `review/payment_creation_unknown`，尽可能提供已安全返回的订单号；若无法返回订单号，下一次同 key 的 status/recover 必须可定位，不得只给“创建失败，请重试”。
- 错误文案必须引导“先查询/找回，勿重复付款”，并区分可重试的校验错误、需要人工对账的未知结果和不可重试的终态。
- `renderCheckout()` 发现二维码、支付地址或金额无效时，必须保留 `manual_review/error`，停止“完成付款”引导和轮询；不能被随后统一的 `awaiting_payment` 文案覆盖。

#### 61.4.3 「查询支付状态」：单飞、节流、终态准确

- 前端 `statusRequestInFlight` + `aria-busy` + disabled 防止连续点击；已有请求未结束时再次点击只聚焦状态提示，不再发 GET。
- `force_provider_refresh=1` 只用于手动动作的首个请求，后续回到普通轮询；服务端节流/限流被命中时显示下一次可查时间。
- 明确记录 `GET /guest/status` 不是纯读：它可能触发 provider 查单、写支付事件、confirm 和 worker kick；这些副作用必须幂等、可观测，并纳入限流/审计，而不是让前端无限刷新掩盖问题。
- `review` 不显示“等待支付确认”；`amount_mismatch/overpaid/partial/refunded/chargeback` 不显示 ZPay“付款已超时”；`paid_unfulfillable/dead_letter` 显示人工处理进度而非继续打渠道。
- 终态停止自动轮询；按钮要么隐藏，要么改成明确的“刷新处理状态”，不能让用户误以为再次查询会重新付款。

#### 61.4.4 「关闭当前订单」：两阶段决策

**短期（2.1 P0，未有服务端取消前）：**

- 将按钮改名为「离开当前订单」或「暂时离开」，保留本地句柄清理，但不宣称服务端订单已关闭。
- 对已知未付款且无 provider 创建未知状态的订单，二次确认后才清理本地 UI；确认框明确旧码不可再付、预占按 TTL 释放。
- 对 `review`、provider 未知、金额异常、已确认付款、退款/争议、人工履约和任何 claim in flight 隐藏/禁用，并保留订单号与客服路径。
- 清理本地订单时同步清空邮箱/查询密码输入和临时生成密码；不得把上一个买家的凭证带入换 SKU、换邮箱后的新单。
- 如果取货口令刚生成但用户尚未确认已复制/保存，不能让“离开”静默清掉唯一口令；应先要求确认已保存，且仍不得把口令写入 storage、URL 或日志。

**长期（2.1 P1，若产品确实需要“关闭订单”）：**

- 新增 claim 授权的幂等 cancel endpoint/RPC，仅允许订单所有者、明确未付款、未过期且没有 provider 未知状态时调用。
- 服务端原子更新订单状态、支付意图、预占和优惠额度；释放库存必须可审计、可重试、不可重复释放。
- provider 已创建但不能撤销时，不做本地假取消，转 `review` 并等待渠道查单；迟到付款必须进入退款/人工队列，不能发货。
- 增加跨标签、迟到 webhook、取消与 worker 竞态测试后，才可恢复“关闭当前订单”名称。

#### 61.4.5 「找回订单」：按开关分流，先隔离上下文

- 凭证开关 **ON**：主入口引导 `/guest-orders.html` 的邮箱+查询密码；旧订单号+取货口令只作为迁移兼容，并记录弃用日期，不同时让用户面对两个等价入口。
- 凭证开关 **OFF**：保留订单号+取货口令找回；不得暗中要求邮箱密码或泄露“该订单是否存在”。
- recover 开始前停止旧轮询、清空旧 checkout/provider/product/context，保存一个新的 request generation；响应回来后只允许匹配当前 generation 的结果更新 UI。
- 从 `sessionStorage` 或回跳恢复时先进入 `recovering/checking`，不能因 `hydrateCheckout()` 的默认状态短暂显示“确认商品信息”并同时展示查询/关闭按钮；首个服务端 snapshot 决定最终面板。
- `publicOrderSnapshot` 至少返回经 allowlist 的 `site/product_id/sku_id/product_name/sku_name/provider/channel/amount/currency/payment_status/fulfillment_status/refund_status/expires_at`；不返回 recovery code、密码、原始 payload 或卡密。
- 找回已过期、已退款、已发货、金额异常等终态时直接渲染真实终态，不先闪现“正在核验”；不得沿用当前页面商品或旧二维码。
- G3 删除旧入口的条件：邮箱密码链路已在生产完成 G1 全链路实机证据（下单→支付→查询→发货→锁定→重置），客服/运营有迁移路径，且旧订单兼容窗口与数据保留期限已公告并归档。

### 61.5 身份、开关与促销的 2.1 补强项

这些不是按钮代码的“顺手优化”，而是决定游客体验是否会再次看起来像回退老版本的运行条件，必须纳入同一计划：

| 优先级 | 缺口 | 2.1 交付与验收 |
| --- | --- | --- |
| P0 | 生产凭证开关未开时，邮箱显示可选、密码隐藏；查询页 API 可能 404，但静态 `/guest-orders.html` 仍可直接访问 | readiness、preview、API、静态页面四者同源；开关 OFF 时页面有明确受控提示/不可操作，ON 时才展示邮箱+密码和查询入口；分别留存 OFF/ON 实测证据 |
| P0 | 邮箱+查询密码目标链路仍允许回退到可选邮箱的旧行为；密码策略虽有 P1–P10 代码，但尚未完成生产 G1 证据 | 凭证开关 ON 时邮箱和查询密码均必填，服务端强制 8 位及四类字符/弱密码拒绝；同一邮箱同价同券，身份字段不得进入定价；下单、支付、查询、发货、锁定、重置全链路实测通过 |
| P1 | CAPTCHA 只有阈值/错误码，公开处理器和前端未真正接线 | 先做威胁模型和成本评估，再决定接入或明确限流替代；不能把“有配置项”当成已防刷 |
| P1 | 邮箱未做 OTP 所有权验证；`registered_user_match` 目前公开下单传 `null` | 在不改变同价/同券原则的前提下补记录链路；OTP/并入账号单独做 A4，不把未验证邮箱描述成已验证身份 |
| P1 | 旧 recovery code 与邮箱密码双入口并存 | 设定迁移、客服、弃用和 G3 删除条件；任何升级/重置不得回吐旧口令 |
| P0/P1 | `GUEST_SHOP_MAX_QUANTITY` 仍为 1；C-D3 库存占比、C-D4 并发未付款单、C-D5 促销 TTL 尚未完成 | 在三项通过前不得调高数量，不得开启多件阶梯价；每项有最后一张库存、批量占用、释放和优惠额度证据 |
| P1 | 阶梯价、闪购、优惠码需要与登录用户价格 resolver 保持一致，但 parity 实机与 quote 语义仍未完全闭合 | 以服务端/数据库 resolver 为唯一价格源，覆盖基础价、阶梯、闪购、同价同券、手续费和限购向量；前端只展示结果，不能让游客因身份而加价 |
| P1 | 少付/金额异常尚未统一写入促销熔断事件；日预算耗尽无通知 | 将金额异常、重复拒绝、预算耗尽接入 breaker/audit/告警；告警必须含匿名订单维度，不含凭证/卡密 |
| P1 | L4 后台运营 UI 未做，券额度/预算/熔断只能 SQL 操作 | 复用 Admin Studio，提供 RBAC、二次确认、原因、审计和只读状态；没有 UI/审计不得宣称促销运营完成 |
| P2 | 无独立 quote 端点；优惠码到 create 才知道结果 | 先完成服务端 create 原子校验；再评估 quote token/过期/绑定，不能为改善提示而引入可重放折扣票据 |
| P2 | 已登录用户无现金购买入口、购物车游客结算未做 | 作为独立产品决策，不在 2.1 P0 偷渡；先评估积分/现金、库存和优惠语义是否一致 |

### 61.6 竞态、隐私与可访问性验收

- **上下文代数：** 延迟 preview 时切换 SKU、站点、数量、优惠码或关闭弹窗；旧响应必须被丢弃，不能覆盖新商品价格、渠道、身份开关或 quote。
- **请求互斥：** create/status/recover 各自单飞；跨动作（找回进行中点创建、创建进行中点关闭、关闭后旧响应回来）必须按 generation 拒绝过期结果。
- **多页面：** 同一订单在两个标签页操作时，不得双发、双 claim 或互相清除新句柄；`storage` 不可用、隐私模式、回跳新标签均有降级提示。
- **回跳安全：** return URL 只携带非敏感订单句柄；回跳不等于支付成功；站点、商品和 claim 仍由服务器校验。
- **焦点与读屏：** modal 关闭后焦点回到触发按钮；busy/错误/状态使用 `aria-live`，隐藏按钮不可聚焦；移动端按钮顺序与点击热区可用。
- **匿名观测：** 记录 `action`、`outcome`、`state`、耗时、provider/channel 的最小匿名指标（如 `create_unknown`、`status_refresh`、`local_abandon`、`recover`）；禁止记录订单凭证、邮箱、密码、claim/recovery code、二维码原文和卡密。

### 61.7 实施顺序与交付物

| 批次 | 工作包 | 依赖 | 退出条件 |
| --- | --- | --- | --- |
| 2.1-P0-A | 状态机/按钮策略与 CSS hidden 修复 | 无 | 目标矩阵逐状态可计算；hidden、disabled、focus、aria 契约测试通过 |
| 2.1-P0-B | create/status/recover 单飞、代数隔离、未知结果恢复 | P0-A | 双击、丢响应、延迟 preview、跨 SKU、隐藏弹窗响应测试通过；无重复支付/预占 |
| 2.1-P0-C | “离开”短期语义或真正 cancel API 设计落地 | P0-B、产品决策 | 没有服务端取消时不再出现误导性“关闭”；若做 cancel，RPC/审计/迟到支付竞态全绿 |
| 2.1-P0-D | 终态/退款/人工处理映射和恢复快照 | P0-B | §61.3 列出的全部支付/履约/退款终态都有正确文案、按钮和轮询行为；跨商品找回不串单 |
| 2.1-P0-E | 运行开关与静态查询页门禁 | P0-D | OFF/ON 两套生产-like 实测；readiness 与页面/API 一致；默认仍 fail-closed |
| 2.1-P1-A | 邮箱密码 G1、CAPTCHA 决策、旧入口迁移 | P0-E | 邮箱密码全链路实机证据；未验证邮箱不冒充已验证身份；G3 删除条件可执行 |
| 2.1-P1-B | C-D3/C-D4/C-D5、金额异常熔断、预算告警 | P0-D | 多件/并发/TTL/少付/预算的真实证据齐全；数量和优惠开关仍按门禁开启 |
| 2.1-P1-C | L4 Admin Studio 运营与审计 | P1-B | RBAC、二次确认、原因、审计、恢复和只读监控可用 |
| 2.1-P2 | quote、登录现金购买、购物车、体验优化 | P1 完成后 | 单独产品评审和灰度，不阻塞 P0 安全闭环，也不能绕过其门禁 |

#### 61.7.1 本轮实施记录（P0-A/P0-B 部分实施）

以下均为代码和自动化证据，不能替代 §61.8 的实机/沙箱证据，也不表示对应工作包已满足全部退出条件：

- **unknown-create 同键恢复：** 浏览器现在只提交 `prepare → commit` 和不带敏感字段的 `inspect/ack` 动作；服务端在内部把同一 intent 映射为显式 `resumeUnknown:true` 恢复分支，并在实时价格、库存 RPC 和支付渠道调用前按 `site + idempotency_key` 查旧单。商品、SKU、数量、优惠码、claim 派生值、渠道以及已绑定的买家/联系方式不一致时 fail-closed，凭证订单仍执行共享密码认证和锁定预算且不新分配买家组。命中旧单只返回数据库持久化的安全 checkout；`review` 且无 provider reference 时返回订单句柄、该 create 响应允许的恢复口令和 `checkout:null`；过期、失败、退款等终态优先，不能重新暴露旧付款码。未命中旧单时才按当前数量/优惠开关走正常创建，自动化断言不会重复调用 provider 或新增预占。
- **客户端竞态隔离：** unknown 重试复用原幂等键和不可变请求字段；create/status/recover 使用单飞与 generation/context 校验隔离迟到响应。关闭弹窗后的迟到 unknown 不再把界面卡在“正在确认”；recover 与旧 poll 交叉、延迟 preview、双击 create 和切换商品上下文已有定向覆盖。处于 unknown/detached 状态时禁止“找回订单”切单，恢复成功、离开、终态或上下文重置会清理 detached 状态。
- **查单期间离开保护：** 手动或自动 `/status` 请求在途时，策略层隐藏“离开当前订单”，执行层的 `isAbandonableOrder()` 也拒绝清理本地订单句柄；迟到的 `confirmed`/`review` 响应因此仍可落到原订单。动态回归覆盖了查询按钮 busy、订单号与 `sessionStorage` 保留，以及迟到确认不被旧离开动作污染。
- **弹窗可访问性前置：** 游客弹窗补齐 `aria-hidden` 开关、`aria-describedby` 状态关联、打开后的首个可用控件焦点、Escape 关闭和 Tab 循环；关闭仍恢复触发器焦点。该切片已纳入前端合同测试，但真实读屏、移动键盘和视觉焦点截图仍属于 §61.8 未闭合证据。
- **短期离开语义：** 前端已把「关闭当前订单」改为「离开当前订单」，确认文案明确这不会取消服务端订单、不会立即释放库存，并警告旧付款码不要再付；本轮没有新增 cancel API，因此 P0-C 整批仍未完成。
- **恢复终态展示：** create 恢复路径可直接渲染 `expired`、`failed`、`refunded` 等终态并抑制 checkout，不再把旧二维码/地址重新展示为可付款；完整的 §61.3 支付、履约、退款和人工处理矩阵仍需继续逐项验收，因此 P0-D 仍未完成。
- **orderless intent 的 fail-closed 边界：** `prepare` 产生的无订单 intent 在约 5 分钟 commit 窗口内不会被客户端静默清除；关闭弹窗后若响应可能仍在途，服务端继续保留该 intent，暂时阻止换 SKU/重新 prepare，以避免重复预占或重复支付。当前没有新增宽松的 `abort` 动作，也不把“离开当前订单”解释为取消。后续若要缩短阻塞，必须设计仅限“确认无订单且无 provider 请求在途”的服务端原子 abort，并补跨标签、迟到响应和 provider 竞态证据；在此之前保持 fail-closed。
- **自动化结果（各套件单独运行，子集数字不累加）：** 早期切片的 `482/482`、`13/13`、`43/43`、`25/25`、`30/30`、`22/22`、`509/509` 及 `512/512` 仅作为历史记录保留，不再作为当前门禁。当前发布候选权威基线为 `516/516`；这些结果仍只证明代码/合同层行为，不证明指定 SKU、真实渠道或邮箱密码开关已完成启用。

**2026-09-20 续做记录：** 在 §61.7.1 的切片上补入查单在途离开保护、找回在途合成创建保护和弹窗键盘/ARIA 前置；正式站只做只读商城列表与「测试」商品详情核对，未触发游客建单、支付或开关变更。P0-A/P0-B、实机状态矩阵和运行开关门禁仍未闭合。

**2026-09-20 续做记录（本轮）：** 本地浏览器夹具统一收口到 `127.0.0.1:8017`，清理了旧 `8014` 监听实例，避免审计计数和延迟窗口被两个夹具进程混合。该轮中间读数 `493/493` 和其后的 `509/509` 均已被下一条 `512/512` 复测取代。夹具 smoke 已确认 `creating` 建单延迟约 `1.402s`、`recovering` 找回延迟约 `1.409s`，各自仅一条去敏请求，但不能替代浏览器瞬时 DOM 证据。真实 IAB 已有 `390x844` 竖屏布局 `PASS-LOCAL`，但创建/找回在途瞬时窗口、横屏、双标签、回跳、存储禁用、读屏和亮暗主题仍未签署，不能据此关闭 §61.8 或启用游客商品。

**2026-09-20 续做记录（intent 加固后复测）：** 全量 `node --test tests/guest-shop-*.test.js` 为 `511/511`；客户端竞态 + 前端合同定向套件为 `58/58`；checkout intent、状态恢复与主动查单定向套件为 `59/59`；订单访问、公开路由与 readiness 门禁定向套件为 `83/83`。`node --check server/api-handlers/public/guest-shop.js` 与 `git diff --check` 均通过。新增/更新的 `prepare → commit → inspect → ack`、生产 Origin/Fetch-Metadata 校验、claim proof 绑定、unknown-create 同键恢复，以及终态/发货状态下 ack 失败重试均只证明代码/合同层安全性质；真实 HTTPS 浏览器 Cookie 回传、多标签/移动横屏/回跳、真实 provider、数据库和运行开关仍未闭合，不能据此关闭 §61.8 或启用游客商品。

**2026-09-20 下一阶段启动复测：** 重新执行 `node --test tests/guest-shop-*.test.js`，当前 glob 实际收集 `512` 项，结果 `512/512 PASS`，退出码为 0。此前 `511/511` 保留为上一轮历史基线；本次新增测试纳入当前门禁。8017 受控夹具已启动并可打开商城页，已通过 `POST /fixture/audit/reset` 清空去敏审计；本轮尚未完成逐状态真实 DOM 断言，故不把夹具启动记为矩阵通过。

### 61.7.2 本轮本地门禁证据（2026-09-19）

- 启动只读本地预览 `http://127.0.0.1:8011`：`/api/shop/catalog?site=cn&language=zh&view=full` 返回 `success=true`，目录快照为 23 个商品、7 个分类；未改目录和任何商品开关。
- OFF 门禁：本地默认凭证开关关闭时，`POST /api/shop/guest/access/login` 返回 `404 guest_feature_disabled`；`/guest-orders.html` 静态页面返回 `200`，页面/API 仍需由前端开关和服务端门禁共同决定可操作性。
- readiness：`npm run readiness:guest-shop -- --fail-on-invalid` 返回 `PASS (automated)`、`findings: none`、`operational_ready=false`、`manual_review_count=20`；本地没有 production env/database，因此不能据此放行游客商品。
- ON 代码级矩阵：使用非生产的合成环境值运行 `runReadiness`，`GUEST_SHOP_BUYER_CREDENTIAL_ENABLED=true` 与 `GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED=true` 均被识别为 `enabled`，没有硬失败；仍有 22 项 manual review，未触碰真实环境变量、数据库或开关。
- 定向门禁测试 `tests/guest-shop-order-access-endpoints.test.js`、`tests/guest-shop-public-route-contract.test.js`、`tests/guest-shop-readiness.test.js` 共 `83/83` 通过；这组结果与当前 `516/516` 游客商城套件一样，只证明代码/合同，不替代真实浏览器、数据库和 provider 证据。

### 61.7.3 本地预览与低价测试商品复核（2026-09-19）

- `http://127.0.0.1:8011/healthz` 返回 HTTP 200。该 preview 按 `scripts/local-preview-server.js` 加载 `server/.env.staging`、`server/.env`、`.env.local` 和 `.vercel/.env.production.local`；其中 production-local 配置参与解析，且项目既有记录说明本地 preview 使用共享 Supabase。它不是隔离的支付沙箱；任何建单都按真实数据库/支付渠道写入处理。
- 目录 GET 返回 23 个商品。当前 `¥0.01` 的「测试」实际为 `product_id=52246f1d-b98d-4920-9129-581296f43de9`、`sku_id=cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d`，不是此前备案的内部商品。
- §2.10 备案的「测试 2 / 测试」仍是 `product_id=c16212d8-6ad8-4b3c-831c-3cc68b2d7a52`、`sku_id=db8cc9bd-898a-49ff-adb4-cc07f94d7d8f`，当前目录价为 CNY 144。对这两个商品分别执行只读 guest preview GET，均返回 `success=true`、`buyer_credential_required=false`、`quantity_cap=1`、`discount_enabled=false`、支付渠道 `zpay/nowpayments`、通道费率 1%。因此当前 API 接受两个商品进入游客报价，与历史单 SKU 记录不一致；在 Admin Studio 白名单/当前运行状态核清前，不得创建 ¥0.01 商品的订单或据此认定其已获测试批准。
- ¥0.01 商品按当前 1% 通道费规则，预计应付额向上取整为 ¥0.02。此次只读取 `/healthz`、catalog 和两条 preview；未调用 create-order/status/recover、未创建订单、未支付、未执行 SQL、未修改商品开关。
- 本轮浏览器只确认商城列表页可见；购买弹窗内逐状态显隐、键盘焦点、ARIA 与双标签/回跳的可见验收仍未完成，继续按 §61.8 保持未闭合。
- 2026-09-20 按用户明确授权，在正式站点 `https://www.fatherkey.com/api/shop/guest/orders` 为「测试 / 默认规格」提交一次游客建单：`product_id=52246f1d-b98d-4920-9129-581296f43de9`、`sku_id=cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d`、`provider=zpay`、`channel=alipay`、数量 1；HTTP 201，订单号 `GS20260919160122435663839CB0983`，响应金额 `0.02 CNY`，已生成支付凭证，仍未付款。未记录恢复口令、二维码、支付 URL 或 claim 凭证；临时响应文件已清理。该笔订单只作为本轮按钮/支付前状态验收，不得重复付款或重复建单。
- **本次建单的验收边界：** 请求由正式站点 API 完成，没有把响应中的 claim cookie 写入用户浏览器；状态/找回接口要求 claim 证明，因此当前浏览器不能安全地回显这笔订单的付款凭证。不得为弥补这一点再建第二笔订单，也不得猜测或手工拼接支付 URL；该单按未付款订单正常等待 TTL 释放，浏览器端完整「建单→回显→支付前暂停」证据仍未闭合。

### 61.8 测试与真实证据清单

本节是**分层证据目录**，不是要求在默认关闭发布或单个基础 SKU 启用前把所有条目一次跑完。证据按实际开启的站点、provider 和功能选取：阶段 2 只需要代码与默认关闭发布门；阶段 3 只需要所选 SKU、CN 基础购买和本次实际开启的凭证能力；INTL、促销、多件、完整辅助技术矩阵等只阻塞对应扩展。已绑定固定 commit 且代码、配置、环境未变化的有效证据可以复用，不重复执行。

**自动化最小集合：**

- `tests/guest-shop-frontend-contract.test.js`：五按钮 DOM/文案/hidden 计算样式、状态策略、无 WAP 误跳转、`aria-busy`、缓存版本。
- 新增状态机合同测试：覆盖 `configure/creating/awaiting_payment/checking/review/confirmed/paid_unfulfillable/dead_letter/delivered` 及 `expired/failed/refunded/chargeback/amount_mismatch/overpaid/partial`。
- 新增异步竞态测试：延迟 preview、双击 create、响应丢失、recover 与旧 poll 交叉、关闭弹窗后旧响应、切换 SKU/站点/数量；每项断言旧 generation 不得写 DOM/状态。
- `tests/guest-shop-orders-idempotency.test.js`、`tests/guest-shop-status-recovery.test.js`、`tests/guest-shop-status-active-refresh.test.js`：补 provider unknown、终态快照、查单单飞和限流退避断言。
- 后端/API 合同：cancel（若实施）、claim 授权、迟到 webhook、金额异常、退款悬挂、`publicOrderSnapshot` allowlist、静态页面门禁和匿名 telemetry 脱敏。
- readiness：开关 OFF/ON、worker、凭证、查询页、促销和 operator state 分层显示；`--fail-on-not-ready` 的非零退出保持 fail-closed，不得用 `|| true` 绕过。

**本轮后仍缺的证据：**

- §61.3 每个状态的完整自动化映射和桌面/移动真实浏览器证据尚未逐项签署；当前 `516/516` 只能证明代码回归，不能替代矩阵验收。
- 人为断网后的真实 provider 同单恢复、真实库存/预占数量、迟到付款/退款与人工履约结果尚未留证；不得用 mock provider 的“不重复调用”断言顶替。
- 双标签/新标签回跳、`sessionStorage` 禁用、隐私模式、跨标签句柄竞争、键盘/读屏、focus 和亮暗主题证据尚未归档。
- `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 与 `GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED` 的 OFF/ON 组合，及 preview、静态查询页、API、readiness、Admin Studio 的一致性尚未做 production-like 证据。
- 默认关闭发布已完成并归档于 §61.14；本轮仍未新增/扩大游客商品、未运行新真实支付。阶段 3 尚缺精确 SKU operator review、邮箱密码链路生产前置和启用后的聚焦证据。

**实机/沙箱分层集合：**

1. **基础 CN / 指定 SKU：** 配置→创建→站内二维码→付款→主动查单→confirmed→worker→delivered。
2. **基础直接安全：** 创建响应人为断网后，重开/找回得到同一订单，不重复扣款、不重复占库。
3. 点击「稍后处理」：旧单可恢复，明确不取消；隐藏期间的异步响应不污染新 SKU。
4. 点击「离开当前订单」：旧付款码被警告；迟到付款进入人工/退款，不发货。
5. 快速连点「查询支付状态」：只有一个 provider 查询，按钮显示 busy，终态停止轮询。
6. review、金额不足/多付、expired、refunded、paid_unfulfillable、dead_letter：逐一核对文案、按钮、退款/客服入口。
7. **凭证功能开启时：** 清 cookie/换设备后按邮箱+查询密码或旧口令兼容链路找回；跨商品找回不显示当前商品的二维码和金额。凭证关闭时本项不阻塞不含凭证的发布，但本任务阶段 3 若按目标开启强制邮箱密码，则必须完成对应聚焦证据。
8. **浏览器扩展：** sessionStorage 禁用、移动端回跳、新标签、双标签并发、键盘/读屏和亮暗主题截图；未涉及的设备/辅助技术缺口保留在扩展 backlog，不阻塞默认关闭发布。
9. **所启用功能的运行开关：** OFF/ON、静态 `/guest-orders.html`、API 404/200、preview 字段和 Admin Studio 开关保持一致。关闭中的促销、多件或 INTL 不要求伪造 ON 证据。

每条证据必须登记：环境、commit、站点、SKU、订单号（可脱敏）、起止时间、状态转移、按钮矩阵结果、provider 事件数量、库存/履约结果、截图路径和是否涉及真实资金；不得登记口令、卡密、claim token、邮箱或二维码原文。

### 61.9 发布、启用与回滚闸门

#### 61.9.1 阶段 2：默认关闭生产发布门

- 代码只能从专用游客购买分支经 PR 合入当时最新 `main`；不从功能分支直接 `vercel deploy --prod`，不在部署中执行 SQL。
- 发布前固定候选 commit，相关自动化全绿、`git diff --check`、生产构建/静态合同和 `readiness --fail-on-invalid` 通过；确认部署动作不会修改商品/SKU 白名单、数据库开关或功能开关。
- 发布后必须把 Vercel production、KVM4 Verify Server、KVM4 Sub2API、KVM4 guest-shop worker 四条链路和 `.current-release` 绑定到同一个 `main` commit，并确认健康状态。
- §61.8 的完整真实浏览器、真实付款、INTL、促销、多件、读屏和多设备矩阵**不是默认关闭发布的前置**。它们保持 `NOT RUN` 不得被写成 PASS，但也不得阻止代码在开关不变的前提下发布。
- 阶段 2 的完成只表示“代码已发布且默认/既有开关状态未被扩大”，不表示任何游客商品已获启用许可。

#### 61.9.2 阶段 3：指定 SKU 基础启用门

只评审本次明确选定的 product/SKU 和实际启用配置，不要求无关历史矩阵或未来扩展先完成。启用前必须同时满足：

1. 阶段 2 已完成，生产四链仍指向同一固定 `main` commit。
2. operator review 记录精确 product ID、SKU ID、站点、价格和责任人；SKU 为低价值、非共享、自动发货、可单独关闭，且不会因目录状态误开放其他商品。
3. 服务端定价和金额校验、未确认付款不发货、订单/支付/provider/claim 绑定、幂等创建/恢复、库存单发和敏感凭证不回显等直接安全不变量已有当前 commit 的自动化或有效既有证据。
4. 启用配置明确记录。当前目标为 CN、单件、原价、指定 SKU；优惠码、多件和未审计站点保持关闭。若同时开启强制邮箱密码，则 focused 证据必须确认 preview 要求凭证、缺失/弱凭证被服务端拒绝、密码不回显且找回链路可用。
5. 启用前写明阶段 4 的观察窗口、最小样本、停止阈值和关闭 SKU 的负责人；用户对精确 product/SKU 与配置作明确确认后，才执行单独的启用动作并记录前后状态。

#### 61.9.3 扩展功能门与回滚

- INTL provider、优惠码、`quantity > 1`、凭证迁移/G3、完整设备与辅助技术覆盖、quote、购物车等，只在开启对应能力前补齐各自证据；关闭或 `deferred` 时不阻塞 CN 单件基础 SKU。
- 回滚优先关闭受影响商品/SKU 或功能开关；已付款订单继续履约或退款，不能用 DB rollback、Vercel-only rollback 或清客户端 storage 假装回滚。
- 若发现重复支付、错误商品、未付款发货、迟到付款发货、claim 泄露、库存未释放或状态文案误导，立即关受影响 SKU/开关，保留证据并进入人工对账；不得继续扩大灰度。

### 61.10 2.1 完成定义与当前待办

2.1 以第 1 节五阶段为唯一完成定义。每阶段满足自身退出条件后计 20%；后续阶段出现的新证据缺口不会倒扣已经绑定固定 commit 的阶段，除非代码、配置、环境、选定 SKU 或事故变化使原证据失效。

- [x] **阶段 1：代码与合同。** 五按钮/竞态/恢复安全切片、`516/516` 游客商城自动化基线和分层门禁已归档。
- [x] **阶段 2：默认关闭生产发布。** PR #656 已合并，production commit `40da7b557659b0f097a478437cb9034138f2ea2e` 的四链验证见 §61.14；未执行 SQL、未打开或扩大游客商品。
- [ ] **阶段 3：指定 SKU 游客启用（进行中）。** 只对 `52246f1d-b98d-4920-9129-581296f43de9` / `cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d` 执行 §61.9.2；先核清其已存在的 preview allowlist 和邮箱密码生产前置，再由用户确认精确切换动作。
- [ ] **阶段 4：观察与回滚。** 按启用前写定的窗口、样本和阈值形成继续/关闭/修复结论，并验证关闭 SKU 后新单拒绝、在途单继续处理。
- [ ] **阶段 5：后续扩展与收口。** 每项扩展要么完成专属门禁，要么明确记为 `deferred` 并给出重启条件；延期本身可以完成本阶段，不要求无限实现所有未来设想。

当前唯一下一步是阶段 3 的 operator review 和邮箱密码链路前置核验。指定 SKU 已能在生产返回游客 preview，不能把“再次打开商品开关”当作下一步；应先证明其低价值、非共享、自动发货、可单独关闭，并确认凭证迁移/配置后再决定单独切换。完整浏览器矩阵继续作为质量 backlog 保存；不得重复创建或支付 §61.7.3 的既有未付款订单。

### 61.11 2026-09-20 阶段性交付边界

本轮阶段性实现可交付范围已经收口为“代码安全切片 + 本地受控夹具基线”，不等同于 2.1 完成或游客商品启用：

- [x] 五按钮统一策略、`hidden`/`disabled`/`aria-busy`、焦点恢复和 Escape/Tab 前置实现。
- [x] create/status/recover 单飞、代数隔离、unknown-create 同键恢复、终态旧支付凭证抑制实现。
- [x] `sessionStorage` 降级提示、找回凭证清理、短期「离开当前订单」语义实现。
- [x] 本地 `8017` 夹具、去敏 audit、延迟 smoke 和历史 `512/512` 自动化基线；发布候选补强后的当前基线为 `516/516`（`511/511`、`512/512` 保留为历史读数）。
- [ ] 真实 IAB 的在途瞬时断言、完整终态矩阵、横屏/主题/读屏、多标签和回跳证据。
- [ ] production-like 开关/readiness/Admin Studio 一致性、真实 provider/库存/worker 与发布链路证据。

因此本节是阶段 1 的交付证据。未完成项继续保留在 §61.8，并按 §61.9 分层使用；它们不再被整体解释为阶段 2 的发布前置。

**本节不新增 SQL、不执行 SQL、不打开游客商品、不启动新的真实支付。** 任何需要数据库变更的取消、OTP、促销或告警方案，先写成独立 SQL 文件并由用户执行，再更新本合同的证据状态。

### 61.12 下一阶段启动：默认关闭生产发布

阶段 1 已完成，下一阶段正式进入阶段 2。当前工作顺序固定如下：

1. **冻结发布候选：** 审查当前脏工作区，区分本任务文件与无关修改；在专用 `codex/guest-shop-*` 分支形成可审查 commit，不吞并或回退用户改动。
2. **本地门禁：** 对候选 commit 运行相关自动化、`git diff --check`、生产构建/静态合同及 `readiness --fail-on-invalid`；记录扩展开关仍关闭或保持既有值。
3. **PR 与合并：** 推送专用分支，创建或更新 PR 到当时最新 `main`，检查可接受后合并；禁止从功能分支手动执行 Vercel production deploy。
4. **四链验证：** 等 Vercel Git 集成、KVM4 Verify Server 和 KVM4 Sub2API 完成；verify 到同一 commit 后再按规范验证 guest-shop worker。确认 `.current-release`、健康检查和容器状态。
5. **阶段归档：** 记录固定 production commit、四链结果和开关前后状态。阶段 2 到此结束；不得在该部署动作中执行 SQL 或打开游客商品。

阶段 2 退出条件是 §61.9.1 全部满足。浏览器验收文档中剩余的 `NOT RUN/INCOMPLETE` 继续诚实保留，既不冒充 PASS，也不阻塞默认关闭发布。阶段 2 完成后，才进入指定 SKU 的 §61.9.2 审查和单独启用动作。

### 61.13 2026-09-20 发布候选前端阻断收口

在冻结阶段 2 候选前，独立审查发现并闭合三项不能带入发布的回归；这些修复不改变任何生产商品或功能开关：

- [x] `shop-client.js`、`guest-shop-client.js`、`ios-scroll-lock.js` 和 `guest-orders-client.js` 都有本批独立 cache-buster，避免一年 `immutable` 缓存继续运行旧弹窗交接或旧查询页逻辑。
- [x] “订单号 + 取货口令”历史恢复区移出邮箱密码能力门禁；availability 为 `404`、网络失败或开关 OFF 时仍显示、可展开并可调用 `/guest/recover`。历史订单升级为邮箱密码的表单继续单独默认隐藏，只在新能力明确 ON 时显示。
- [x] 积分购买弹窗到游客弹窗采用连续滚动锁交接；共享锁按 modal owner 释放，游客弹窗关闭不得误释放后来打开的认证/公告弹窗。慢 availability 响应在打开游客弹窗前复核来源 modal、同一 purchase 对象、product/SKU 和 handoff generation，来源已关闭或切换时返回 `source_stale`，不再幽灵打开或错误弹登录。
- [x] 连续 `purchase -> guest -> auth` 弹窗交接只把仍连接 DOM 且保持 `active` 的 modal 记为可恢复 owner；已失活 purchase 不再挤占唯一恢复槽，关闭 auth 后 guest 仍持有背景滚动锁。
- [x] 一次性 reset token 在从 URL 清除后立即只存入内存；availability 瞬时失败会提供原地重试，成功后继续展开 reset card，不刷新、不把 token 放回 URL，legacy/retry/受保护监听均只绑定一次。
- [x] 行为回归覆盖 availability `404`/网络失败下的旧恢复、reset token `503 -> retry -> submit`、慢探测来源失效、滚动锁 owner 恢复；本轮风险聚焦回归 `72/72 PASS`。
- [x] 发布候选复测为游客商城套件 `516/516 PASS`、全量安全套件 `3450/3450 PASS`；readiness `findings: none` 且保持 `operational_ready=false`。从 Git 暂存区导出的隔离快照构建生成 812 个静态文件，5 个未跟踪草稿/诱饵均未进入候选。

本节的候选已通过 PR #656 合入并完成 §61.14 的四链验证，因此阶段 2 已由 `in_progress` 更新为 `complete`，Task 2.1 总进度为 **40%**。该结论只覆盖默认关闭发布，不代表指定 SKU 或邮箱密码链路已完成启用。

### 61.14 2026-09-20 阶段 2 生产发布归档

- **候选与合并：** 专用分支候选 `3204aea885d0aba3422b89d86be7a98c86cccea4` 经 PR #656 的 11 项检查全部通过后正常合并；未使用 `--admin`。固定 production commit 为 `40da7b557659b0f097a478437cb9034138f2ea2e`。
- **Vercel production：** deployment `dpl_6Br5GJ8fBpJpurmMobntfqfbKUrf` 为 `READY`，target 为 `production`，Git source 为 `main` / `40da7b557659b0f097a478437cb9034138f2ea2e`。线上 `shop.html` 和 `guest-orders.html` 静态资源版本均已改写为 `v=40da7b557659`，重试按钮与本批 modal cache marker 可见。
- **KVM4 Verify Server：** GitHub Actions run `35507620953` 成功；`/opt/zaoyoe-verify-server/.current-release` 等于 production commit，容器 `zaoyoe-verify-server` healthy，内外 `/healthz` 均正常，`.env` 权限为 `0600`。
- **KVM4 Sub2API / NewAPI：** run `35507620930` 首次因 GitHub runner 到 SSH 端口连续超时而失败，未上传/切换 release；同一 run 的 failed-job rerun（attempt 2）成功。`/opt/sub2api/.current-release` 等于 production commit，`sub2api`、PostgreSQL、Redis 均 healthy，`https://new.fatherkey.com/health` 正常，`sub2api-legacy` 不存在。
- **KVM4 guest-shop worker：** host installer 已落地的 timer 为 enabled + active，最近 service 结果 `success`、退出码 0；发布后 30 分钟窗口内检出 360 条 systemd 成功标记（同一次 tick 可产生多条标记，不把它误报为订单数）。KVM4 health watchdog active。本批未重跑 installer，也未修改 worker secret。
- **生产 readiness 口径：** 完整仓库本地 `--fail-on-invalid` 为 `findings: none`。生产容器内检查确认 claim/contact/request peppers 均已配置且未复用 service-role secret；唯一 3 个 `invalid` 是 compact verify image 按设计不携带的 host-only worker 脚本/service/timer，`AGENTS.md` 明确该情况不算启动失败，且对应 host units 已由上一条实况验证。凭证开关和查询页开关都未设置，保持默认关闭。
- **开关前后状态：** 指定「测试」商品在发布前后都返回 `success=true` 的生产 preview，数量上限 1、优惠关闭、邮箱密码要求关闭、渠道仍为 ZPay/NOWPayments；本部署没有执行 SQL、没有调用商品/功能开关写接口、没有创建或支付订单。`/api/shop/guest/access/availability` 返回预期的 `404 guest_feature_disabled`，证明邮箱密码查询尚未启用而非前端回退。

阶段 2 退出条件已经全部满足。阶段 3 只评审「测试」商品 `52246f1d-b98d-4920-9129-581296f43de9`、SKU `cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d`（不是「测试 2」）；下一步先完成 operator review、数据库迁移存在性证明、凭证开关配置方案和阶段 4 观察/停止阈值，未经再次精确确认不改生产开关。

### 61.15 2026-09-20 阶段 3 生产事实、范围冲突与阶段 4 草案

本节是阶段 3 的当前只读审查快照。采样时最新生产 `main` 记录为 `b2c0590e3fc68b37b09a248e6e2d3423007a9cb5`；§61.14 绑定固定 commit 的阶段 2 证据继续有效，不因 `main` 自然前进而循环重验。以下事实不等于启用批准，本轮没有执行 SQL、没有修改商品或功能开关，也没有创建、支付或修改订单。

#### 61.15.1 指定商品与库存 operator review

本阶段唯一目标保持为 Gemini 分组下的「测试」，不是「测试 2」：

| 项目 | 只读生产事实 | 阶段 3 判断 |
| --- | --- | --- |
| Product | `52246f1d-b98d-4920-9129-581296f43de9`；名称「测试」；active；已出现在公开商城目录；`allow_guest_purchase=true` | 商品游客入口当前已经打开，不能把后续动作描述成“首次打开商品” |
| SKU | `cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d`；名称「默认规格」；active；`allow_guest_purchase=null` | SKU 继承商品级游客开关；当前没有独立 SKU 级凭证隔离 |
| 价格与范围 | 商品价 ¥0.01；按当前费率预计支付宝应付 ¥0.02；仅 1 个 active SKU | 满足低价值首批条件；阶段 3 仍限定 CN、单件、原价，不开启优惠、多件或未审计站点 |
| 发货 | `delivery_type=KEY`；Product/SKU 均不是人工发货 | 满足自动发货前置 |
| 库存来源 | 自有库存池；没有其他 SKU 来源；216 条库存中 168 `available`、48 `sold`，全部 `is_shared=false` | 满足非共享前置；启用后仍须核对预占、售出和释放守恒 |

既有未付款订单 `GS20260919160122435663839CB0983` 仍为 pending，但对应预占已进入 `released/expired`。它不是可继续验收的活动付款单：不得支付、修改、补回调或用它重复建单；阶段 4 只统计用户再次明确批准启用后产生的新订单。

#### 61.15.2 数据库与凭证能力证据

通过只读生产 REST schema 探针已确认：

- `guest_shop_buyers`、`guest_shop_access_attempts`、`guest_shop_access_resets` 均存在；
- `guest_shop_orders.buyer_id` 存在；
- `fn_guest_shop_create_order` 是当前 15 参数版本，包含 buyer 与 promo 参数。

这些结果证明凭证数据模型和当前建单 RPC 已存在，不证明所有新增迁移、数据保留策略或生产开关已经生效。本轮没有执行 SQL；任何待执行迁移仍必须由用户在受控 SQL Editor 中执行并以独立 verify 文件验收。

当前生产 `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED` 和 `GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED` 均未设置，按默认值保持 OFF；`/api/shop/guest/access/availability` 返回 `404 guest_feature_disabled` 是预期的 fail-closed 行为。因此“购买弹窗没有强制邮箱和查询密码”不是代码回退，而是生产凭证能力尚未开启。开启前仍须以同一候选验证 preview 强制凭证、缺失/弱凭证被服务端拒绝、密码不回显、查询页/API 同源可用以及失败计数和阶梯锁定。

#### 61.15.3 CAPTCHA 明确延期，不得误报已实现

当前实现没有客户端 challenge token、CAPTCHA provider 配置、服务端 `siteverify` 校验或约定的 HTTP 428 challenge 闭环。现有 IP 限流、买家失败计数和阶梯锁定是纵深防护，不能被描述成 CAPTCHA。

- CAPTCHA 状态记为 `deferred / manual_review`；readiness 必须继续如实显示人工评审，不能改写成 PASS。
- 若首批灰度不接 CAPTCHA，必须由用户明确接受“24 小时且最多 5 单”的剩余防刷风险并登记责任人；没有该确认不得进入阶段 4。
- 完整 CAPTCHA 以后作为独立扩展能力实施，届时补 token 生命周期、provider 故障策略、服务端校验、防重放和真实浏览器证据；它不因本次延期而被永久删除。

#### 61.15.4 全局凭证开关的第二商品范围冲突

凭证与查询页主开关是全局能力，不是 product/SKU 级开关。当前至少有两个商品可成功进入游客 preview：

| 商品 | Product / SKU | 开启全局凭证后的影响 |
| --- | --- | --- |
| 本阶段「测试」 | `52246f1d-b98d-4920-9129-581296f43de9` / `cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d` | 本阶段预期范围 |
| 非本阶段「测试 2」 | `c16212d8-6ad8-4b3c-831c-3cc68b2d7a52` / `db8cc9bd-898a-49ff-adb4-cc07f94d7d8f` | 也会被同时切换到邮箱密码链路，超出当前单 SKU 批准范围 |

因此启用凭证前必须二选一并留存前后状态：

1. **推荐：** 先关闭「测试 2」的游客购买入口，只保留本阶段「测试」进入 preview，再开启全局凭证与查询页能力；或
2. 对「测试 2」完成与本节同等级的 operator review，并由用户明确把它纳入本次范围。

在用户选择前不得开启全局凭证开关。若发生回滚，应关闭受影响商品的游客入口；不能仅关闭凭证开关后继续让商品以“邮箱可选、密码隐藏”的旧流程接单。

#### 61.15.5 阶段 4 有界观察草案（启用前必须确认）

观察范围拟固定为：从精确启用动作完成时起连续 **24 小时**，最多接受 **5 笔新游客订单**，任一上限先到即停止继续放量并进行对账；不把 §61.15.1 的旧 pending 单计入样本，也不为凑样本自动建单或自动付款。若 24 小时内没有至少 1 笔真实已付款且完成履约的订单，只能记录“流量不足”，不得把支付/履约观察写成 PASS；延长窗口或安排新支付必须再次取得用户明确确认。

以下任一条件命中即停止，不等待 24 小时或第 5 单：

- 任意错误商品/SKU/站点/金额、重复订单或 provider 支付、未确认付款发货、同一库存双发、敏感凭证/邮箱/密码/claim 泄露或跨买家/跨商品找回；
- 任意新 `paid_unfulfillable`、`dead_letter`、退款失败、异常 `amount_mismatch/partial/overpaid`，或已确认付款连续两个 worker 调度周期仍未进入预期履约/人工处理状态；
- 任意缺失或弱查询密码被服务端接受、锁定预算失效、查询页/API/preview 开关状态不一致；
- 库存、预占、支付、订单或 provider 对账出现 1 条无法解释的差异，过期预占超过既定 TTL 加一个 worker 调度周期仍未释放；
- Vercel/Verify/Sub2API/worker 任一必要链路不健康、release commit 漂移，或 create/status/recover 连续两次出现服务端失败。

停止动作固定为：立即关闭受影响商品/SKU 的游客购买入口，停止新单；保留并对账在途单，已付款单继续履约或退款，不做数据库回滚，不清客户端状态冒充回滚。达到 5 单但没有异常属于计划内停表复核，不记为事故。

启用前仍须由用户明确指定并记录三类责任人：**商品开关与紧急关闭负责人、支付/退款与在途单负责人、技术监控与证据归档负责人**。当前三项均为 `pending_confirmation`；责任人、联系方式/值守窗口、第二商品处理选择和 CAPTCHA 风险接受未确认前，阶段 3 不得记为 complete。

#### 61.15.6 测试基线与当前结论

- 阶段 1 固定基线仍是游客商城自动化 `516/516 PASS`，绑定其当时发布候选；它不因后续增加测试而改写。
- 阶段 3 当前本地候选为游客商城 `545/545 PASS`、全量安全 `3479/3479 PASS`；隔离 worktree 的 Vercel 构建成功生成 812 个静态文件。这是包含本阶段补强的候选读数，不与 `516` 相加，也不代表这些未发布改动已在生产生效。
- 本候选已补齐访问审计 retention 的独立开关、每十分钟最多 `10 × 1000` 行的有界 worker 清理、错误/积压 HTTP 503、凭证 ON + retention OFF 的持续运行时 503 互锁，以及 read-only verify 对 service-role 内部守卫、事务 advisory lock、唯一函数重载、有效角色权限和精确有效 `(created_at ASC, id ASC)` 索引的检查。KVM4 compact image 仅将 3 个 host-only systemd 资产降为人工核验，源码检出缺失仍硬失败；hosted 页面还必须与 `server/.release-commit` 对齐。
- 当前 Task 2.1 进度仍为 **40%**。阶段 3 已完成目标 SKU、库存和数据库的只读事实核验，但仍缺候选发布、待执行迁移的用户侧验证、第二商品范围选择、CAPTCHA 剩余风险接受、三类责任人和精确启用确认。上述项目闭合并完成聚焦启用证据后，阶段 3 才能从 `in_progress` 更新为 `complete`；随后才进入阶段 4 的 24 小时/最多 5 单观察。
