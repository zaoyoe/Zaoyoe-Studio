# TG 邮箱与查询密码查单

## 本地实现范围

TG 购买与兑换表单增加独立的查询邮箱、查询密码和确认密码。它们不用于邮箱或 Telegram 登录，也不发送邮件。同一组邮箱与查询密码可以查询多笔 TG 订单；主商城订单仍由主商城查询。

订单查询页沿用主商城的查询卡片、结果列表、状态标签及分页布局，保留 TG 配色和已有下压交互。支持：

- 购买订单、兑换码订单分别查询，每页 20 笔，按创建时间和主键稳定倒序。
- 订单号可选；不填写时查询该邮箱与密码组的全部对应类型订单。
- 待付款购买订单先重新核对状态，再打开既有支付弹窗；查看进度、刷新、取消仍走原有业务校验。
- 修改邮箱、密码、筛选条件或清空查询时，撤销旧结果与相关查询轮询，丢弃迟到的状态响应，防止旧订单详情或二维码恢复。
- 下单及兑换仍保留原有幂等、断线恢复、原订单凭证及显式另购确认。

这不是注册或登录系统。同一邮箱使用不同密码会分为不同的查询组，互不可见；每个邮箱最多 5 组。建议持续使用已保存的同一组信息。密码不能凭邮箱自行重置。

## 历史订单

历史订单没有邮箱关联，不能仅凭邮箱猜测归属。使用折叠入口中的原订单号和原查询凭证查询成功后，可在“为历史订单绑定邮箱查询”表单中设置并绑定查询信息。

绑定前验证原凭证，数据库再次锁定并核验原订单。已经绑定其他密码组的订单不能重新归属；原查询凭证继续有效。购买创建/兑换预留与新查询组绑定在同一个数据库事务中，绑定冲突会回滚本次创建，且 API 不继续请求支付渠道。

## 凭证与接口

- 邮箱规范化后使用现有 TG code pepper 生成带用途隔离的 HMAC 索引，数据库不保存明文邮箱。
- 查询密码使用主商城已有的带独立随机盐的 scrypt 实现。新密码至少 8 位，包含大写字母、小写字母、数字和符号，并应用商城弱密码校验。
- 前端复用 `js/guest-query-password.js` 的密码规范、生成能力；只有用户点击复制按钮才写入剪贴板。
- 邮箱与密码只通过 POST 请求体或 `X-TG-Order-Credential` 请求头传输。查询密码及编码凭证不写入 URL、浏览器存储、结果卡片或日志；页面退出时清空密码字段和内存查询状态。
- `POST /api/tg/orders/query`：邮箱、密码、订单类型、可选订单号、页码。
- `POST /api/tg/orders/bind`：原凭证请求头、原订单号、订单类型及新查询信息。
- 原购买/兑换状态接口、取消接口支持邮箱凭证请求头，先验证密码组与订单归属，再使用既有内部凭证执行业务校验；内部哈希不返回浏览器。
- 新查单接口包含 IP 与邮箱限流。错误邮箱与错误密码使用同一拒绝响应，不返回数据库错误原文。
- 新表启用 RLS，匿名和登录用户均无表权限；新增 RPC 只对服务角色开放，固定 `search_path`。
- 现有 TG pepper 必须持续保留；更换它会改变邮箱索引，不能以常规配置更新的方式随意轮换。

## 数据库应用步骤（待用户执行）

本轮没有执行任何 SQL。请在现有 TG 表所在的同一 Supabase 项目中手动执行：

1. `supabase/migrations/20261016_tg_order_email_query.sql`
2. `supabase/migrations/20261016_verify_tg_order_email_query.sql`

第一份为增量迁移：增加查询组表、两类订单的可空关联列和索引、7 个服务角色 RPC，不删除旧凭证，不开通购买开关，不退款、补发或运行 worker。第二份只检查契约版本、RLS、函数权限与固定搜索路径，各检查列应为 `true`，函数列表应有 7 行。

`/api/tg/catalog` 的 `order_query.enabled` 仅在数据库契约就绪后变为 `true`。执行成功后刷新本地页面即可显示新建订单的查询信息字段并启用邮箱查询。迁移未生效时仍保留原订单号与凭证查询。

当前未取得迁移后的数据库验收证据，不将 SQL 文件或单元测试视为数据库已生效。

## 2026-10-16 本地验收记录

### 基线与保留工作

- 分支：`codex/tg-payment-dialog-fees`。
- 本轮获取的 `origin/main` 与 HEAD 均为 `6e322240721059eac6909d923cf61148077ef5c0`，`HEAD..origin/main` 为 0。
- origin 为规范 HTTPS 地址，保留现有未提交工作；没有重置、恢复、变基、切换分支或清理工作区。
- 修改前相关文件备份目录：`/tmp/tg-email-query-before-20261016-chud9eqp`。该目录仅为相关文件备份，不作为破坏性 Git 操作要求的完整备份。

### 变更范围

- 前端：`tg.html`、`js/tg.js`、`js/tg-order-query.js`、`css/tg-order-query.css`。
- API：`api/public.js`、`server/tg/order-query.js`、`server/api-handlers/public/tg-order-query.js`、`server/api-handlers/public/tg.js`、`server/api-handlers/public/tg-purchase.js`。
- 两份新增迁移与校验 SQL、`tests/tg-order-query.test.js`、`tests/tg-public-ui.test.js`、本文档。
- 新后端模块位于现有 Verify 打包的 `server` 目录和 Docker `COPY server` 输入内；Vercel ignore 规则包含 `!server/tg/**` 与 `!server/api-handlers/**`。本轮未构建或上传生产制品。

### 自动化验证

- 新邮箱查单后端与 TG 前端交互：
  `node --test --test-force-exit tests/tg-public-ui.test.js tests/tg-order-query.test.js`
  **91 / 91 PASS**，失败 0、取消 0、跳过 0。
  日志：`/tmp/tg-email-query-new-tests.log`。
- 完整相关回归：
  `node --test --test-force-exit tests/tg-*.test.js tests/local-preview-*.test.js tests/guest-shop-*.test.js tests/guest-orders-*.test.js tests/admin-shop-guest-order*.test.js tests/payment-usdt-*.test.js tests/wallet-usdt-market-fx.test.js tests/payment-zpay-webhook-handler.test.js tests/payment-public-zpay-webhook-endpoint.test.js tests/nowpayments-*.test.js tests/gramix-client.test.js`
  **1432 / 1432 PASS**，失败 0、取消 0、跳过 0。
  日志：`/tmp/tg-email-query-regression-tests.log`。
- 本轮 7 个运行时 JS、2 个测试 JS 的语法检查及 `git diff --check`：PASS。
- 历史 promo 档案契约和 readiness 契约包含在上述相关回归中；该结果不替代人工运营或数据库运行时验收。

### 预览与未执行项

- 北京时间 2026-10-16 21:12:36：`/healthz`、`/tg?view=orders`、`/tg-admin` 均 HTTP 200，诊断的启动与当前源码 SHA 等于上述 HEAD。
- `sourceMode=working-tree`、`workingTreeDirty=true`。页面和所引用的新 JS、CSS、共享密码脚本与磁盘 SHA-256 一致，响应为 `no-store`。预览代表当前未提交工作区，不作为生产证据。
- 新查询路由对 GET 返回 405，确认本地 API 分发已加载新实现；catalog 返回 `order_query.enabled=false`，等待用户执行迁移。
- 沿用正在运行的预览进程，未改其配置；现有动态 API loader 会刷新相关模块。
- guest-shop 保留 `mode=upstream-checkout`、原 API origin、真实待付款写入开启与 `cancellationMode=local-rpc`；没有改变当前自动履约设置。
- HTTP 验收记录：`/tmp/tg-email-query-preview-20261016.json`。
- 浏览器视觉和端到端验收：**NOT RUN**。沿用此前 URL 安全策略边界，未换浏览器或绕过限制。
- 真实订单创建、支付、取消、退款、补发、重试发货任务、worker 执行、SQL 执行和部署：**NOT RUN**。


## 2026-10-16 确认订单整合与后台分类导航验收记录

### 本轮范围与来源

- 用户购买确认区：把查询邮箱、查询密码和确认密码移入 `tgPurchaseConfirmation`，位于订单摘要之后、最终确认按钮之前。邮箱整行，密码桌面两列、手机单列；报价前不再要求填写，只在最终创建新订单前验证。验证失败留在确认区、聚焦对应字段，不进入未知订单恢复分支；已知原订单查询保持原流程。
- 后台顶部增加订单查询、购买订单、兑换订单、兑换码、商品定价、上游服务六个分类。每次只显示选中面板；支持方向键、Home/End 和刷新后恢复分类。浏览器只存分类名，不持久化管理员查询条件与查询结果。
- 后台订单查询复用 TG 订单卡片视觉，购买和兑换分开，可按邮箱、完整订单号或 Telegram 用户名查找，每页 20 笔。管理员无需用户查询密码；详情继续进入既有购买审核、收款核对和上游状态界面。输入、类型、查询方式、清空或退出使旧响应、旧详情按钮和旧分页按钮失效。
- 新增 `POST /api/admin/tg/order-query`，通过既有管理员分发器验证超级管理员身份，并验证可信 Origin 与 JSON。仅查询持久化订单和履约状态，不写库、不请求支付商、不运行 worker；邮箱只读取 HMAC 索引匹配的查询组 ID，不读取用户密码或其哈希，不返回原始支付凭证。
- 本轮没有新增 SQL。管理员按订单号或用户名查询不依赖邮箱迁移；邮箱查询依据既有迁移契约就绪状态。
- 变更文件：`tg.html`、`tg-admin.html`、`css/tg-order-query.css`、`css/tg-admin.css`、`js/tg.js`、`js/tg-order-query.js`、`js/tg-admin.js`、`api/admin.js`、`server/api-handlers/admin/tg/order-query.js`、`tests/tg-public-ui.test.js`、`tests/tg-admin-ui.test.js`、`tests/tg-admin-order-query.test.js` 和本文档。保留工作区此前的支付、兑换及主商城改动。
- 分支仍为 `codex/tg-payment-dialog-fees`；本轮再次 fetch 后，HEAD 与 origin/main 均为 `6e322240721059eac6909d923cf61148077ef5c0`，落后计数为 0。未变基、切换分支、重置或清理工作区。
- 修改前针对性文件备份：`/var/folders/wl/8wb6rp_13z17vf97m3fkk0dw0000gn/T/tg-confirm-admin-before-20261016-lp7ephfn`，`manifest.json` 的 11 个文件 SHA-256 复核通过。该目录不是全仓备份，不能作为破坏性 Git 操作的备份依据。
- 新后端文件位于 Verify 部署包已有的 `server` 路径与 Docker `COPY server` 内，并由 `api/admin.js` 注册；Vercel ignore 规则包含 `!server/api-handlers/**`。本轮未构建或部署生产制品。

### 自动化与只读验收

- 重点套件：`node --test --test-reporter=tap --test-force-exit tests/tg-admin-order-query.test.js tests/tg-admin-ui.test.js tests/tg-public-ui.test.js tests/tg-pages-contract.test.js tests/tg-order-query.test.js`：**197 / 197 PASS**，失败 0、取消 0、跳过 0。日志：`/tmp/tg-confirm-admin-focused-tests.log`。
- 完整相关回归：`node --test --test-reporter=tap --test-force-exit tests/tg-*.test.js tests/local-preview-*.test.js tests/guest-shop-*.test.js tests/guest-orders-*.test.js tests/admin-shop-guest-order*.test.js tests/payment-usdt-*.test.js tests/wallet-usdt-market-fx.test.js tests/payment-zpay-webhook-handler.test.js tests/payment-public-zpay-webhook-endpoint.test.js tests/nowpayments-*.test.js tests/gramix-client.test.js`：**1469 / 1469 PASS**，失败 0、取消 0、跳过 0。日志：`/tmp/tg-confirm-admin-regression-tests.log`。
- 新后端测试使用注入的离线数据库和管理员模拟，不初始化生产数据库 SDK；前端交互在离线 VM 中验证。覆盖权限、私密 POST、白名单输出、稳定分页、原订单恢复、创建前验证与慢响应隔离。
- 8 个运行时/测试 JS 的 `node --check` 与 `git diff --check`：PASS。
- HTML 结构验收：`tg.html` 143 个唯一 ID、`tg-admin.html` 104 个唯一 ID，闭合结构、确认区字段归属、六组 tab/panel 引用与默认显隐均 PASS。
- 本地只读 HTTP 时间：`2026-10-16T21:53:41.446489+08:00`。`/healthz`、`/tg`、`/tg?view=orders`、`/tg-admin` 均 200，启动与当前源码 SHA 均匹配上述 HEAD。页面及 14 项 JS/CSS 资源与磁盘内容一致，响应 `no-store`，资源版本为 `20261016-confirm-admin-query-v2`。
- `sourceMode=working-tree`、`workingTreeDirty=true`；预览代表当前未提交工作区，不作为生产证据。沿用已有预览进程，没有重配或重启服务。
- 管理员接口匿名 GET 返回 401 `admin_access_required`，由分发器先执行登录验证；handler 的仅 POST/405 行为由离线测试验证。初次 HTTP 检查误将外层认证后的结果预期为 405，已按实际认证顺序修正验收断言，未放宽接口权限。
- 用户查询接口 GET 返回 405 且 `Allow: POST`。catalog 只读检查返回 `success=true`、`order_query.enabled=true`、`password_min_length=8`，当前邮箱查询契约已就绪。此记录是对上方早先 `enabled=false` 状态的后续核验，不覆盖原历史记录，也不代替用户执行数据库完整校验 SQL 的证据。
- 本地 guest-shop 仍为 `mode=upstream-checkout`、`cancellationMode=local-rpc`，本轮未修改环境配置、自动履约设置或购买开关。
- HTTP 证据：`/tmp/tg-confirm-admin-preview-20261016.json`。

### 明确未执行的验收

- 浏览器视觉与端到端：**NOT RUN**。此前 URL 安全策略拒绝后未换浏览器、CDP 或其他路径绕过；本轮只读 HTTP 和离线 VM 不作为浏览器实测。
- 真实管理员订单查询、真实订单创建/支付/取消/退款/补发、worker 执行、SQL 执行及生产部署：**NOT RUN**。数据库完整校验 SQL 的人工执行结果本轮未收集。
