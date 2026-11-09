# 发卡站攻击清单验证：主站、KC、TG

审计日期：2026-11-08（Asia/Shanghai）。结论：**三个系统已经有交易安全防线，但尚不能判定全部抵御清单中的攻击。发现三个隔离可复现缺口、若干源码层面的薄弱点，以及生产证据缺口。没有证据证明普通访客已可免费购买、同卡重复充值或匿名读取卡池。**

## 1. 范围和证据边界

- 主站：充值支付、积分购买、普通库存与 CDK 库存、游客购买的关键支付/访问边界、商品媒体导入和头像上传。
- KC：CDK 核销、充值任务、卡池领取、外包未知支付状态、公开查询、任务访问、后台认证和敏感数据存储。
- TG：ZPay/NOWPayments 支付确认、订单访问、持久限流、履约领取/租约/重试。
- 排除：虎皮椒、爱发电；没有执行真实下单、扣款、充值、SQL、生产配置修改或 worker 启动。
- 源码基线：`main` / `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`。报告写入前已 fetch，`HEAD..origin/main` 落后数为 0。工作区已有大量未提交修改，**审计对象是当前本地文件，不代表这个 HEAD 的纯净源码或生产运行版本**。
- 源文件完成时 SHA256： [source-manifest.json](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-08-card-store/source-manifest.json)。哈希记录完成时文件内容，不能证明审计期间没有共享编辑。
- “源码存在”只证明实现可见；“隔离复现”采用真实函数与内存替身；“生产观察”仅限匿名页面响应头。三者不相互替代。
- 用户此前表示“已执行 SQL”，记录为 `USER_REPORTED_APPLIED / NOT_INDEPENDENTLY_VERIFIED`。本轮没有执行任何 SQL，包括只读或本地 SQL。

## 2. 发现与处理优先级

优先级表示修复顺序和潜在业务影响，不能当作已发生入侵的等级。P1 优先处理资金证明、秘密泄露影响和可触及内网的条件路径；P2 处理容量、防刷与浏览器防护。

### F1 / P1：主站 ZPay 主动查单缺关键字段仍可入账

证据：[zpay-webhook.js:563](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/zpay-webhook.js:563)、[provider-adapters.js:699](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/provider-adapters.js:699)。

- 查单缺 `paidAmount` 时回退到通知中的 `amount`。
- 查单订单号、交易号仅在非空时比较；adapter 还会把请求订单号/交易号回填到标准化结果。
- 这使“主动查单与回调相互独立”的证明减弱：字段缺失没有统一拒绝。

隔离结果：

| 查单/通知场景 | HTTP | 是否调用入账 RPC |
|---|---:|---|
| 完整且匹配的 paid 查单 | 200 | 是，正常基线 |
| paid 查单缺金额 | 200 | **是，缺口** |
| paid 查单缺金额、订单号、交易号 | 200 | **是，缺口** |
| 查单金额 0.01，本地应付 12.34 | 200 | 否 |
| 查单 pending | 503 | 否 |
| 通知签名无效 | 401 | 否 |

限制：通知验签、本地订单和本地应付金额检查仍在。探针预设通知验签有效、查单依赖返回异常结构；不构成任意访客能伪造有效支付或实际盗款的证明。

建议：按供应商原始查单字段契约，严格要求查询成功、最终状态、本地商户、订单、通道、交易号和完整金额匹配；缺字段转待核验且允许安全重试，不用通知或请求字段替代查单证据。以真实供应商测试环境验证兼容性。

对照：[guest-shop.js:2319](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js:2319) 已校验 ZPay 原始查询商户、订单、通道、交易号和金额；[nowpayments-webhook.js:623](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/payments/nowpayments-webhook.js:623) 对保存的 payment ID 与原始查询最终状态等另有检查。本发现不能扩张为所有支付渠道都缺少主动核验。

### F2 / P1：应用层加密没有覆盖全部库存和 KC 秘密

- 普通库存导入原文写入 `shop_inventory.content`：[mutate.js:4326](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/mutate.js:4326)，交付读取见 [shop.js:3657](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/shop.js:3657)。
- 专用 CDK 已有 AES-256-GCM：[shop-cdk-secrets.js](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/shop-cdk-secrets.js)，不能把这项保护泛化为所有普通库存。
- KC 卡号、有效期和 CVC 原值写入卡池：[mysql-store.js:1171](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/mysql-store.js:1171)。
- KC 商品密码、token、IMAP key 原值入库：[mysql-store.js:3123](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/mysql-store.js:3123)。
- KC 管理员 TOTP 种子原值写入配置表：[mysql-store.js:2795](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/mysql-store.js:2795)。
- KC 新 session 写入已有独立密钥加密与缺配置拒绝机制，但保留历史明文兼容路径；历史清洗状态未知：[session-security.js](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/session-security.js)。

影响：数据库、备份或有权读取配置的账户一旦失守，可直接扩大为库存、代充凭证和第二因素种子泄露。**没有证明这些表对匿名用户可读；磁盘/TDE、备份加密状态也未核验。**

建议：对必要的可恢复秘密采用独立密钥的认证加密，保留密钥版本和轮换；减少支付卡验证值等敏感材料的留存；分批处理历史数据，避免明文兼容永久存在。用户密码继续使用适当的慢哈希，不能改成可解密密码。

### F3 / P2：KC 公开查询缺少可见的统一防刷预算

抽查入口：[server.js:1939](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js:1939) `/api/public/subscription/check`、[server.js:4513](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js:4513) `/api/public/probe-account`、[server.js:4616](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js:4616) `/api/verify-cdk`、[server.js:4698](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js:4698) `/api/cdk/query`。

未在这些入口看到统一的 IP/请求对象预算、通用失败次数约束或升级人机验证。已有部分 cooldown 主要针对特定无资格失败，不能等同于所有入口均受限。部分查询会访问数据库或供应商；可见风险是资源消耗、探测和供应商额度消耗。

限制：没有进行生产刷接口测试；Nginx/Cloudflare 可能另有限制，本轮未读取其配置。CDK 有效性查询能成为探测反馈，但实际猜中概率还取决于 CDK 熵，不能据此宣称可爆破成功。

建议：在应用和统一持久存储实施分层预算；上游调用另设容量、超时与熔断；高风险请求再升级验证，返回信息避免暴露多余状态。

### F4 / P2：KC 并发上限存在检查与占位竞态

证据：[server.js:4334](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js:4334) 检查 `activeForegroundJobs.size`，多个 await 后才在 [server.js:4457](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js:4457) reserve；reserve 自身只是进程内 Set 写入。

隔离复现：配置上限 1，两个**不同有效 CDK** 同时进入真实激活函数，两个请求均返回成功，启动 2 个 worker，槽位数为 2。

定性：能越过容量保护，并且进程内计数不覆盖多实例。**不是同一 CDK 双充、卡池重复领取或重复扣款的证明。** CDK 核销有数据库条件更新，卡池领取有行锁。

此外，核销 CDK 与创建任务分为两步（4437、4444）；进程崩溃可产生“卡已核销、任务未落地”的恢复窗口，目前未做故障注入验证。

建议：把全局容量预约、CDK 核销与持久任务创建设计成可恢复的原子流程；任务用唯一业务键和租约控制。错误和崩溃恢复必须区分“未提交”“已提交”“结果未知”。

### F5 / P1（有条件）：商品远程媒体导入可触发 SSRF / 无界下载

证据：[\_r2-media.js:29](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/_r2-media.js:29)、[\_r2-media.js:102](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/_r2-media.js:102)、[supplier-catalog.js:1818](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/shop/supplier-catalog.js:1818)。

- 接受任意绝对 http(s) 媒体 URL，未限制私网/回环地址或目标域名，未显式拒绝重定向。
- 超时定时器在拿到响应后、读取正文前清除；`arrayBuffer()` 没有大小上限。
- 信任远端 Content-Type，没有与头像上传相同的 magic-bytes 校验。
- 入口需要 `shop.manage` 管理权限；供应商内容中的媒体 URL 也可在管理员同步导入后到达这里。R2 未配置时直接返回原 URL，不会下载。

隔离探针验证：在“R2 已配置”的内存替身下，真实函数把回环地址交给 fetch，并把 `text/html` 内容交给 S3 上传替身。**没有真实 fetch、R2 上传、内网访问或匿名入口利用。**

建议：限制媒体来源及解析后的目标地址，阻断私网/回环/链路本地等目的地；每一跳重定向重新验证或直接拒绝；下载流设置总超时和大小上限，并验证格式。对出站访问另设网络边界。

对照：[upload-avatar/index.ts:109](/Volumes/chao/AI/xianyu_profit_calculator/supabase/functions/upload-avatar/index.ts:109) 已有 HTTPS、域名白名单、拒绝重定向、流式大小与文件格式检查。两条下载链路保护强度不一致。

### F6 / P2：KC 公开首页安全响应头与主站/TG 不一致

2026-11-08 16:36（上海时间），匿名 GET 采样：

| 页面最终响应 | 状态 | CSP / HSTS / nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy |
|---|---:|---|
| 主站首页 | 200 | 六项均有 |
| TG 首页（跟随到 `/tg`） | 200 | 六项均有 |
| KC `redeem` 首页 | 200 | 六项均未返回；有 `X-Powered-By: Express` |

限制：只代表所采页面。主站 HSTS 的 includeSubDomains 可能保护已有该策略的浏览器，不能仅凭 KC 本次缺头断言 HTTPS 可降级。`Server: cloudflare` 也不能证明 WAF 自定义规则或限流配置有效。

建议：在 KC 实际入口设置合适的 CSP、反嵌入、MIME、防敏感 URL 外泄等响应策略，核实独立域名首次访问场景；先验证页面所需脚本，避免直接复制主站策略导致功能故障。

### F7 / P2（条件证据）：KC 有未转义 DOM 写入，尚未证明跨用户 XSS

证据：[index.html:1676](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/public/index.html:1676)、[index.html:3317](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/public/index.html:3317)、[index.html:3346](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/public/index.html:3346)。

从用户粘贴的 session JSON 取得 email 后，部分消息模板直接插入 email；`showStatus` 和 `showCapsule` 使用 innerHTML。其他位置已有 escape，不能因此推导全部显示点均安全。

限制：目前邮箱路径需要用户粘贴 JSON，接近诱导粘贴/self-XSS 条件；未证实无需交互的跨用户注入、存储型 XSS 或真实盗号。服务端错误消息到前端的完整可控性链尚未证明。

建议：用户、上游和错误消息默认用 textContent；必要的结构化 HTML 与动态文本分离；为可信 HTML 定义独立接口，避免通用消息函数默认解释 HTML。

## 3. 对用户清单逐项判定

此处“有防线”不等于生产验收通过。

| 清单项目 | 主站 | KC | TG |
|---|---|---|---|
| 库存/订单竞态 | 购买函数源码有库存和余额锁；需验证生产最终定义 | CDK 条件核销和卡池行锁；容量竞态已复现，崩溃恢复有窗口 | 订单锁、交易身份排重、领取租约；需真实并发验证 |
| 支付伪造/重放 | 验签、本地应付和幂等路径存在；ZPay 查单缺字段放行见 F1 | 主要是 CDK 换充值；提交后未知状态保留人工审核；实际供应商执行未联调 | 验签、本地订单/金额/币种/交易身份、主动查单均有源码 |
| 前端篡改订单状态 | 抽查关键入账/购买由服务端完成；DB 权限仍需验 | 服务端核 CDK 和任务；管理接口有鉴权 | 支付确认服务端核验后调用受限 RPC |
| 价格/优惠绕过 | 服务端重算价格/数量，购买事务有余额/库存约束；生产优惠最终函数未重建验收 | 从 CDK 的 plan/platform 决定开通内容，校验请求平台；无同构优惠券结论 | 服务端本地订单金额与支付结果核对 |
| 卡密泄露/重复发放 | 专用 CDK 加密；普通库存原文；交付绑定订单归属 | 多类秘密原值入库；核销与卡池有并发保护 | 上游幂等、提交标记、未知结果人工审核；不是普通卡密库存 |
| SQL 注入/最小权限 | 抽查用参数化客户端/RPC；未覆盖全部历史动态 SQL | 多处占位符；默认权限/多语句属于纵深风险，未证实注入 | 客户端/RPC 调用及受限函数源码存在 |
| IDOR/接口鉴权 | 订单同时匹配 id/user_id/site；游客需独立凭证 | 任务 HMAC 凭证/管理鉴权；公开查询边界另见 F3 | 状态 token 或邮箱加独立凭证，不能只凭订单号 |
| 登录/会话/二次验证 | 既有本地加固与历史测试；生产会话撤销存储未验 | scrypt、TOTP、近期 step-up、任务 token；TOTP 种子保护不足 | 后台共用认证边界；生产配置未验 |
| XSS/CSRF | CSP 已观察；部分来源校验受配置开关控制，值未知 | CSP 缺失及 F7；Bearer 鉴权不能仅因缺 CSRF token 就判可利用 | CSP 已观察；来源校验有源码 |
| 上传/后台入口 | 头像校验较完整；媒体导入见 F5 | 诊断媒体位于管理员鉴权和 step-up 后，未发现匿名下载 | 管理/公开边界抽查存在；未做全量上传审计 |
| 限流/人机/设备 | IP/用户/指纹预算和部分升级校验源码可见；开关未知 | F3/F4，不能判已充分防刷 | IP/email 持久限流，生产后端不可用拒绝；未做压测 |
| HTTPS/WAF/端口 | 页面头已观察；规则和源站绕过未核验 | 页面头差异见 F6；网络边界未核验 | 页面头已观察；WAF规则/直连源站未核验 |
| 审计/告警/恢复 | 有审计实现及历史加固记录；告警投递、值守、恢复演练未验 | 有任务/管理日志；非全路径告警及恢复证明 | 有订单/履约状态记录；生产告警与恢复未验 |

关键源码定位：

- 主站订单归属：[shop.js:3541](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/shop.js:3541)。购买 HTTP 边界与来源校验：[shop.js:4827](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/shop.js:4827)。
- 库存锁：[20260615_site_scoped_shop_sku_inventory_sources.sql:266](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260615_site_scoped_shop_sku_inventory_sources.sql:266)。其中可复用共享库存可按业务重复交付，不能一概误报为重复发卡。后续迁移会修改购买函数，单独读此文件不能当作最终生产定义。
- 购买 RPC 权限收口：[20261107114915_purchase_security_boundary.sql:1](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20261107114915_purchase_security_boundary.sql:1)。必须确认所有重载仅授权 service_role；未应用时可能直调 RPC 绕过 HTTP 风控。
- KC CDK 条件核销：[mysql-store.js:1524](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/mysql-store.js:1524)，卡池领取：[mysql-store.js:3373](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/mysql-store.js:3373)，plan 绑定：[activation-routing.js:8](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/activation-routing.js:8)。
- KC 未知支付不自动释放：[server.js:4222](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js:4222)。任务凭证：[task-access.js](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/task-access.js)。
- TG 回调主动查单：[tg-purchase.js:396](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/tg-purchase.js:396)，加密货币核验：[nowpayments-gateway.js:195](/Volumes/chao/AI/xianyu_profit_calculator/server/tg/nowpayments-gateway.js:195)。
- TG 锁和幂等：[20261108013826_tg_authenticated_payment_query.sql:41](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20261108013826_tg_authenticated_payment_query.sql:41)。提交前持久化及未知结果策略：[worker.js:132](/Volumes/chao/AI/xianyu_profit_calculator/server/tg/worker.js:132)。
- 游客领取/订单归属：[guest-shop.js:4393](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js:4393)、[guest-shop.js:5227](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/guest-shop.js:5227)。本次属于关键边界抽查，未宣称完成游客全链路生产验收。

## 4. 实际验证记录

### 本轮执行/留存

- 真实主站 ZPay handler + 内存支付/DB 替身：6 个支付场景，见 F1。
- 真实 KC 激活函数 + 内存 store/worker：1 个双请求竞态场景，见 F4。
- 真实媒体下载 helper + 内存 fetch/S3：1 个私网 URL 与内容类型场景，见 F5。
- 5 个测试文件：**135 PASS / 0 FAIL / 0 SKIP / 0 CANCELLED**，退出码 0。覆盖游客支付适配器、webhook、安全、订单访问和供应商媒体已有契约。它们没有覆盖或否定 F1/F4/F5。
- 三个生产公开首页匿名 GET：只记录白名单响应头，丢弃正文；不是漏洞扫描或真实支付试单。

隔离测试使用环境白名单及 preload 阻止读取仓库真实 `.env*`，阻断外网及 Unix socket。preload 允许本机 TCP 测试夹具；上述探针未使用数据库，五个测试文件使用内存 mock。本轮没有创建数据库连接或执行 SQL。

证据文件：

- [支付/并发结果](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-08-card-store/isolated-probes-result.json)
- [媒体导入结果](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-08-card-store/media-import-isolated-probe-result.json)
- [响应头采样](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-08-card-store/public-page-headers.json)
- [135 项测试结果](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-08-card-store/guest-media-focused-tests-result.json)及[原始日志](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-audit-evidence/2026-11-08-card-store/guest-media-focused-tests.tap)

原始探针脚本位于 `/tmp/security-card-store-audit-20261108/isolated-probes.cjs` 与 `media-import-isolated-probe.cjs`。JSON 中的 assertions 是探针元数据，不代表独立安全项目全部通过，也不与单测总数累加。

### 历史结果，不冒充本轮新增执行

- 主站/TG 后台专项：9 文件，72 PASS / 0 FAIL。
- KC 明确九文件：250 PASS / 0 FAIL。
- 扩展安全回归：104 文件，1954 PASS / 0 FAIL / 0 SKIP。
- **KC 历史全量：1542 PASS / 4 FAIL / 1 SKIP，仍按历史记录保留。** 本轮没有重跑 KC 全量，不能用上述绿色子集宣称全量通过。

历史说明见 [2026-11-08 本地安全记录](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-hardening-2026-11-08-local-review.md:49) 与 [管理员专项记录](/Volumes/chao/AI/xianyu_profit_calculator/docs/security-hardening-2026-11-08-admin-session-step-up-local-review.md:41)。上述集合可能重叠，不求和生成“通过总数”。

## 5. 上线安全判定尚缺的证据

1. 生产实际代码 SHA 与本地修改是否一致；主站/Vercel、Verify/TG、KC 各自运行版本未知。
2. PostgreSQL 最终函数、事务锁、唯一约束、RLS 和全部 RPC 重载授权；MySQL 最终 schema、运行账户权限和多进程行为。
3. 购买权限收口、TG 查询确认及近期安全迁移的真实应用状态，不能仅凭文件或用户概括性回报记 PASS。
4. Cloudflare/Vercel/Nginx 的有效规则、源站直连控制、数据库监听/防火墙、容器网络、管理入口网络策略。
5. 真实支付平台异常字段契约、回调重放、同交易跨订单复用、超时后对账和供应商未知状态恢复。
6. 真实数据库并发、进程中断和恢复演练，尤其库存、CDK 核销/任务落地、TG 租约交接及外包已提交状态。
7. 历史明文清洗、密钥轮换、备份保护、告警实际投递及可恢复性演练。

这些均为 **NOT INDEPENDENTLY VERIFIED**，不能在未完成证据核验前把“本地已有加固”写成“三系统生产已全部防住”。

## 6. 用户清单中需要按业务调整的建议

- UUID 只增加标识不可预测性，不能替代本地已有的用户/站点/凭证归属校验。
- 当前已经使用数据库锁和条件更新的流程，重点应验证原子性与恢复，不必为了形式再叠加 RedLock。
- 支付金额要与下单时服务端保存的应付金额比对；只“信支付返回”仍不足以绑定本地订单。
- 时间戳防重放取决于支付协议是否签名覆盖时间字段；本地交易唯一性、状态机和幂等仍需成立。
- 游客购买、CDK 兑换及供应商回调不都适合强制用户登录；应使用各自独立的订单/卡密/回调信任边界。
- 密码采用慢哈希；卡密、上游 token、TOTP 种子等必要可恢复秘密才采用认证加密。它们的存储策略不能混为一谈。
- IP/设备强绑定会遇到正常网络变化，隐藏后台路径也不能替代鉴权；应以风险升级验证、最小权限和可撤销会话为核心。

本轮仅新增本报告及审计证据。未修改业务代码，未提交、推送、创建 PR、部署、执行 SQL、修改生产配置或操作订单资金。
