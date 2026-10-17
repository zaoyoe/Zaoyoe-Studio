# Telegram 独立购买与兑换服务

## 范围与业务边界

提供 Telegram Premium **3 / 6 / 12 个月**和 Telegram Stars 的即时支付购买、兑换码兑换、上游履约、订单查询、只读对账与人工复核。用户可直接选商品付款，也可使用已有兑换码，两种入口并存。

- 用户端：`https://tg.fatherkey.com`，页面入口 `tg.html`。
- 管理端：`https://tg.adm.fatherkey.com`，页面入口 `tg-admin.html`。
- API 与 worker：KVM4 Verify Server；前端通过同源 `/api/tg/*`、`/api/admin/tg/*` 访问。
- 上游：Gramix。API 密钥只在服务端使用，浏览器不直连上游。
- 独立 `tg_*` 数据表，不复用商城商品、积分兑换码、余额或游客购买订单。
- 复用现有 Supabase 身份、管理员会话、安全预检、持久化限流及部署基础设施。首期只允许已有 `super_admin` 管理 TG 业务。

即时购买使用独立的 TG 商品、报价、支付订单及回调，人民币渠道复用现有商城 `cn` ZPay 商户和协议工具，USDT 渠道使用 NOWPayments；不记入商城钱包、积分或游客购买订单。将既有商户运行时配置中的 PID、商户密钥和官方 API origin 安全快照到 TG 服务端环境变量，TG 运行时不动态解析商城商户配置，也不修改商城配置。TG 后台以人民币标价，可通过支付宝或已配置的 USDT（BSC / BEP20）渠道付款；Gramix 上游仍从独立 USDT 余额扣款，客户付款不等于上游账户自动充值。代理分销不在本次范围。

代码交付时购买、兑换、履约三个业务开关均默认关闭，商品默认停售且无售价。域名 rewrite 已配置，但 DNS、Vercel 域名绑定、生产环境配置和真实支付/上游交易均未在本次开发中执行。用户于 2026-10-15 确认第 1–8 份 SQL 均已执行。Codex 已通过只读 REST GET 核对所选新增字段、商品初始数据及匿名直读商品表被拒绝；尚未完成真实 PostgreSQL 并发、完整 RPC 权限与运行时调用、付款或上游交付验收。

## 即时购买与后台定价

超级管理员在 TG 后台配置 Premium 3 / 6 / 12 个月各自售价，以及 Stars 每颗售价，单独控制每个商品是否出售。价格使用人民币，不从上游扣款币种自动换算。Premium 价格存为整数分；Stars 单价存为人民币微单位（最多六位小数），总价按 `ceil(单价微单位 × 数量 / 10000)` 向上取整到分，避免浮点金额误差。Stars 可购买范围为 50–1,000,000 颗。页面选择会员时长或输入有效 Stars 数量时展示本地预估总价，付款前仍须服务端报价确认；已定价但停售的商品可以展示价格，购买按钮保持禁用。无售价时显示“价格暂未公布”，不会编造金额或从上游价格推定零售价。

购买与兑换输入 Telegram 用户名后，停顿 450 毫秒或离开输入框即读取公开昵称与头像；清空或修改用户名会取消旧查询，旧响应不能覆盖新账号。Gramix API v1 没有接收者资料查询接口，本功能只读取固定 `https://t.me/{username}` 公开资料，不要求登录、密码或验证码，不证明账号所有权或上游可交付性。无公开头像时展示昵称占位；未找到账号和网络暂不可用分别提示。频道、群组或机器人会提示核对个人用户名。资料接口限制每 IP 每分钟 30 次，生产使用持久化限流；固定官方域名、禁止重定向、限制响应体及超时，不作为通用 URL 代理。

USDT 结算使用单独、明确配置的 CNY/USD 十进制汇率，最多八位小数，且大于 0、小于 10；没有默认汇率。商品人民币价格与支付结算金额分别保存，不将 `USDT` 冒充商品币种。人民币页面实时价格只是商品标价；USDT 应付数量以服务器创建的特定订单为准，浏览器不得自行决定结算汇率或到账金额。当前只实现 `usdtbsc`（BSC / BEP20），不接受将 TRC20、ERC20 或其他资产视为等价到账。

`/quote` 只绑定人民币商品报价；在 `/orders` 取得数据库独占创建租约后，才向 NOWPayments 创建固定报价。USD 整数分按 `ceil(人民币分 × 显式汇率)` 用 BigInt 计算；官方返回的 USDT 数量、地址、支付 ID、USD 报价和期限独立持久化，不能由浏览器回传覆盖。有效期取本地订单期限、官方期限与创建后五分钟中的最早时间，真实付款数量和网络以该订单付款区为准。

USDT 到账必须同时通过签名 IPN 与独立官方 GET：订单号、支付 ID、USD 报价、`pay_currency=usdtbsc`、约定数量和地址均匹配，状态为 `finished`，且两份结果中的 `actually_paid` 均不少于约定数量。按 [NOWPayments 官方协议](https://documenter.getpostman.com/view/7907941/S1a32n38?version=latest)，实际到账数量使用该支付记录的 `pay_currency` 计价，官方 IPN 和 GET 示例均可省略 `actually_paid_currency`；任何一份结果如明确提供该字段，都必须为 `usdtbsc`，显式空值或其他资产会被拒绝。不会用“应付数量”冒充“实际到账”，也不会用出金币种 `outcome_currency` 代替用户付款网络。少付、错链、迟到到账或缺少已持久化快照不会自动发货；创建结果未知不重复建单。

1. 用户选择商品、Stars 数量和 Telegram 用户名，向服务端获取有效期 10 分钟的报价。
2. 报价绑定商品、接收人、数量、总价和价格版本；创建订单时重新核对商品状态及版本。报价过期或后台调价后需重新确认。
3. 浏览器在首次创建购买订单前保存幂等键和查询凭证，不在 URL 中放查询凭证。
4. 数据库先建立独立支付订单，并持久化支付商户、渠道和创建租约，再单次调用支付网关。相同请求不会自动重复创建支付。
5. 支付宝 `alipay` 复用商城商户，不传 `cid`；微信 `wxpay` 需另行核验商户能力后加入配置。USDT 使用 `usdt_bep20` 渠道、固定官方 `https://api.nowpayments.io` API 与独立通知地址；只有 API key、IPN secret、明确汇率全部有效才展示渠道。浏览器返回页面只用于恢复查询，不能证明到账。
6. 服务端验证支付通知签名、商户、订单号、渠道、币种和金额，在同一事务中标记付款并创建唯一的 TG 履约任务。重复通知不会重复发货。
7. 独立 worker 使用 Gramix 发货；只有后续官方 GET 对订单和权益核验完成，才显示已完成。支付创建结果未知或上游提交结果未知进入人工复核，禁止自动重复下单。

停售和关闭新购买开关不会拦截已有订单查询或合法支付回调；履约开关单独控制 worker。已付款但发货失败的订单必须保留付款事实，人工核查后处理补发或退款；本次没有自动退款或强制重发接口。

## 管理与兑换流程

1. 超级管理员在独立管理页登录，选择时长、数量（1–1000）、批次名称和可选有效期。
2. 服务端生成 128 位随机兑换码，并原子写入批次与兑换码。明文仅在本次成功响应中返回；弹窗要求确认已安全保存后才允许关闭，关闭后清除页面中的明文。
3. 用户输入兑换码和 Telegram 用户名，无需 Telegram 密码、验证码或 Cookie。
4. 浏览器在提交前生成查询凭证和幂等键，将它们与请求指纹保存在当前标签页的 `sessionStorage`；不保存明文兑换码。网络丢响应、刷新、重复点击复用原凭证。
5. 数据库在同一事务中绑定兑换码、接收用户名、幂等键和查询凭证摘要，返回订单号。
6. worker 领取订单，先提交持久化 submission marker，再向 Gramix 发起一次对应 Premium 或 Stars 购买。
7. 收到购买受理响应只进入处理中；后续通过订单 GET 核对上游订单 ID、接收用户名、产品、时长或 Stars 数量、API 来源和完成状态，匹配后才记为成功。Stars 数量按官方 `extraData.quantityStars` 核对。

用户名提交后不能更换。用户应妥善保存订单号和查询凭证；关闭标签页后不再保证浏览器保存凭证。查询凭证具有订单查询权限，不应出现在 URL、日志或客服公开截图中。

### 管理员 Google 登录与回调配置

TG 管理页复用现有 Supabase 用户身份，支持 Google 登录及已设置密码的邮箱账号。商城的 Google 用户不需要为了访问 TG 后台新建账号或设置密码；Google 身份认证成功后仍必须通过现有 `super_admin` 权限核验，普通用户不能进入管理界面或调用管理 API。

Google 使用同标签页 PKCE 跳转，固定返回当前 origin 的 `/tg-admin.html`，不接受外部提供的返回地址，也不复用商城的 `/auth-callback.html`。TG Supabase 客户端使用独立 `storageKey=tg-admin-auth-v1`，不导入商城本地保存的 Token 或 refresh token。后台会话签发、缓存复用及自动续期保留这一隔离约束。授权前在当前标签页 `sessionStorage` 保存一次性 pending 标记，有效期十分钟；回调必须匹配尚未消费且未过期的标记。PKCE verifier 仍由同一客户端保存在同源存储中，不通过 URL 传递。

回调读取结果后先用 `history.replaceState` 清除 URL 中的 code、错误参数及 hash，再交换授权码。OAuth code、access token、refresh token 和完整回调 URL 不得写入控制台、日志或错误提示；失败或过期后重新发起 Google 登录，不复用旧回调。Google 交换成功后使用真实认证邮箱执行既有登录安全预检，IP 封禁或账号锁定不能因为选择 Google 登录而跳过；随后才进行管理员权限核验与管理会话签发。邮箱登录继续沿用原安全预检和失败计数。

在**现有 Supabase 项目 → Authentication → URL Configuration → Redirect URLs** 中核对以下所需精确地址，缺失时逐条添加，保留原有列表：

```text
http://127.0.0.1:8000/tg-admin.html
http://localhost:8000/tg-admin.html
https://tg.adm.fatherkey.com/tg-admin.html
```

本地仅保留实际使用的 host/port；`127.0.0.1` 与 `localhost` 是不同 origin，发起和完成授权必须使用同一个地址、浏览器和标签页。其他预览端口也需要单独登记精确地址，不开放泛域名、任意路径或任意端口通配。现有商城的 **Site URL 保持 `https://www.fatherkey.com`**，不要改成 TG 域名。Google Console 的 OAuth redirect URI 仍为现有 Supabase 项目的 `/auth/v1/callback`，无需将上述 TG 页面登记为 Google provider 回调。

2026-10-15 核查：现有项目公开 `/auth/v1/settings` 返回 HTTP 200，`external.google=true`，Google provider 已启用。随后使用已授权的 Google 账号完成浏览器授权往返，已实测成功返回 `http://127.0.0.1:8000/tg-admin.html` 并清除回调 URL 中的授权参数；真实邮箱安全预检正确识别账号临时锁定，未解除锁定或签发管理会话。该结果确认上述 `127.0.0.1:8000` 精确回调当前可用，但不代表后台业务登录或购买验收已完成。

2026-10-15 补充只读核查：使用本机现有 Supabase CLI 管理身份，通过官方 Management API `GET /v1/projects/mmkugdibsaeoevliebzk/config/auth` 成功读取实际配置（HTTP 200）。`https://tg.adm.fatherkey.com/tg-admin.html` 不在 `uri_allow_list` 的精确条目中，现有通配符也不覆盖此地址；`site_url` 仍为 `https://www.fatherkey.com`。生产登录启用前须补充上述精确回调。本次没有修改远程身份配置或执行 SQL，未输出管理凭据或完整认证配置。

`http://localhost:8000/tg-admin.html` 和生产授权往返尚未实测。若回调回到商城首页，应优先核对精确白名单，不通过改变商城 Site URL、借用商城登录存储或放宽管理员权限绕过。

## 状态与重复提交边界

| 订单状态 | 含义与处理 |
| --- | --- |
| `pending` | 已占用兑换码或已确认付款，等待 worker |
| `processing` | worker 已领取，或已受理且等待上游结果 |
| `retry_waiting` | 仅重试已知上游订单的状态查询，不重复购买 |
| `succeeded` | 独立 GET 核验完成，兑换码核销 |
| `failed` | 上游确认失败，或未领取的兑换占用超时；只有后者可安全释放兑换码，购买订单不自动退款 |
| `manual_review` | 提交结果未知、订单绑定不一致或领取后失联，冻结并人工核查 |
| `cancelled` | 预留状态，当前没有公开取消入口或自动转换 |

兑换码状态为 `available → reserved → fulfilling → fulfilled`，并支持 `failed`、`revoked`、`expired`。过期的未履约占用可由数据库在后续兑换时安全核对；已领取、已提交或结果未知的权益不会因占用超时自动重新售出。

并发重复兑换在取得兑换码行锁后再次核对幂等绑定；相同请求返回原订单，更换接收人或凭证则拒绝。worker 使用 lease token 做结果更新校验，失联后没有上游订单 ID 的任务转人工复核。

购买订单与履约订单分别记录状态；尚未付款的购买不会进入履约队列。购买履约使用 `order_source=purchase`、`purchase_id`，不伪造兑换码；原兑换使用 `order_source=redemption`。旧 worker 领取 RPC 只允许领取兑换来源，防止旧代码误领新购买订单；新版 worker 使用支持两种来源的 `fn_tg_claim_fulfillment_order`。

Gramix 创建订单必须返回匹配的 `idempotencyKey`。GET 订单若提供该字段也必须匹配；按协议允许 GET 不返回它，此时仍要求其余订单绑定字段全部匹配。HTTP 201 或浏览器提示均不能单独证明履约成功。

实际扣款币种与 submission marker 在同一数据库事务中保存为 `provider_payment_currency`；只有数据库回传的币种与本次选择一致才发送购买请求。后续 GET 核验使用该订单的历史币种，不依赖现在的环境配置。官方订单字段使用 `gram` 或 `usd`，其中请求 `usdt` 对应订单 `usd`，见官方 Node SDK [固定版本说明](https://github.com/gramix-io/gramix-node-sdk/blob/79df455e7d5de1c0e3813dab4fe8e0f5ff426889/README.md#L95)。币种缺失或不一致不能核销兑换码；缺少历史币种的已提交订单进入人工复核，不自动回填。

**恢复限制：**创建请求超时且尚未保存上游订单 ID 时，当前不会自动按幂等键查回、重买或解冻。管理员应联系上游核对，另行设计带审计的恢复操作。管理页的“上游对账”只读，不会修改本地状态或补发。

## 环境变量

以下配置仅放服务端环境文件或密钥管理器，不加入前端 runtime 配置，不提交实际值。

补充模板为 `server/.env.tg.example`。**只将 TG 配置合并到既有 `/opt/zaoyoe-verify-server/.env`，不要用模板覆盖该文件**，否则会破坏商城及现有服务的配置。复用既有 Supabase 项目、公开登录 key 和管理会话秘密；真实环境文件保持 root 所有、`0600` 权限。生产需保留 `APP_ENV=production` 或 `DEPLOYMENT_TIER=production`；仅设置 `NODE_ENV` 不会触发所有持久化安全策略。

支付商户沿用现有商城 `cn` ZPay 商户，无需另建商户。TG 使用单独的 `TG_PURCHASE_ZPAY_*` 环境变量保存同一商户的配置快照，订单与通知路由仍属于 TG；商城配置不会因此改动。商户 PID、密钥和 API origin 必须与既有商户同步核对。尚有旧 `pending` 或创建结果未知的订单时，不变更 PID、密钥；需要轮换时，先对账并制定旧单通知验签、补偿查询及切换方案，再同步商城与 TG 配置。当前实现没有历史支付密钥选择器，不能直接替换密钥后假定旧单回调仍可验签。

当前交接状态（2026-10-15）：Gramix 专用 API key 已录入本地私有补充文件 `.env.tg.local`。文件权限为 `0600`，包含两枚独立随机 TG 密钥和关闭的业务开关，且由 Git、Vercel 静态输出和 Verify 部署归档排除。一次只读余额请求已验证 API key 可用，但 Gram 与 USDT 余额均未检测到非零值；未发起购买。币种配置已按用户要求切换为 `usdt`，客户端、worker 缺省值与补充模板同步使用 USDT。两种币种均受上游协议支持，但余额彼此独立，系统不会自动兑换或切换扣款余额。KVM4 `.env` 尚未写入 TG 配置；须待代码安全审查并发布后再合并，避免在旧代码上重启生产服务。

现有商城 `cn` ZPay 商户的 PID、商户密钥与官方 API origin 已安全快照到上述本地私有文件，渠道为 `alipay`，无 `cid`；三个业务开关仍为 `false`。两次只读数据库 GET 核对了来源商户及配置一致性；使用实际配置和完全 mock 的 fetch 验证 TG 独立回调、请求签名、精确金额以及拒绝篡改和商城订单，实际支付请求数为 0。脱敏证据在 `/private/tmp/tg-zpay-reuse-check.json`。本地离线 readiness 无无效项，仅保留 7 项人工验收 pending；这不代表真实付款已通过。生产环境文件未修改，尚未加载 TG 支付配置。

同日只读上线核对：Google 与 Cloudflare 公共 DNS 查询均对两个 TG 域名返回 NXDOMAIN，TLS 尚未就绪；线上 Verify 的 `/api/tg/catalog` 返回 404，TG API 尚未发布。现有域名 rewrite 只能证明源码配置已具备，不能证明线上可访问。`tg.adm.fatherkey.com` 需要单独验证的证书，`*.fatherkey.com` 不能覆盖它。

USDT 新增配置为独立的 `TG_PURCHASE_NOWPAYMENTS_*`，不能因为既有 ZPay 或 Gramix 密钥有效就认定 USDT 收款已具备条件。NOWPayments API key、IPN secret 均为 16–300 字符，不允许首尾空白或换行，必须彼此独立且不得复用管理员、数据库、ZPay、Gramix、TG 兑换或 worker 秘密。真实 USDT 建单、到账和付款后发货均尚未验收；禁止以 mock 测试通过代替真实资金链路验收。

2026-10-15 本轮只读解析确认现有商城 `cn` NOWPayments 渠道已启用，收款网络为 `usdtbsc`，商户配置中有明确 CNY/USD 汇率 `0.1536`。API/IPN 秘密和该明确汇率已安全快照到本地 `.env.tg.local`，权限保持 `0600`，渠道为 `alipay,usdt_bep20`，三个业务开关仍为 `false`。三次只读数据库 GET 核对来源，支付请求为 0，离线 readiness 无无效项；脱敏记录为 `/private/tmp/tg-usdt-reuse-check.json`。TG 固定使用 USD 报价与 `usdtbsc` 收款，独立记录结算，不照搬商城的 `priceCurrency` 或通知地址。生产环境未修改；第 9 份 SQL、真实 USDT 建单及资金联调尚未验收。

两个现有 sidecar（`ai-image-worker`、`prompt-import-worker`）虽然沿用共享 env_file，但 Compose 明确清空 TG pepper、加密密钥、ZPay 密钥、NOWPayments API/IPN 秘密及 Gramix API key，并强制关闭其 TG 开关。真实 TG 配置仅交由 Verify API 与其容器内 TG worker 使用；契约测试覆盖模板中新加入的 TG/Gramix secret。

| 变量 | 要求 / 默认值 |
| --- | --- |
| `SUPABASE_URL` | 复用既有服务端数据库项目地址 |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅 API 与 worker 可用，不向浏览器下发 |
| `SUPABASE_PUBLISHABLE_KEY` / 既有 anon key | 保留现有公开登录凭证，管理页登录需要；不得填 service-role secret |
| `ADMIN_STUDIO_ACCESS_SECRET` / `ADMIN_CONFIG_ENCRYPTION_KEY` | 保留现有管理会话秘密，不更改商城会话体系 |
| `TG_REDEMPTION_ENABLED` | 默认 `false`；控制新兑换请求，不影响已有订单查询 |
| `TG_PURCHASE_ENABLED` | 默认 `false`；控制新报价和新购买，不影响已有订单查询或合法回调 |
| `TG_FULFILLMENT_ENABLED` | 默认 `false`；控制 worker 是否领取和处理订单 |
| `TG_PUBLIC_ORIGIN` | 支付通知与返回地址绑定 `https://tg.fatherkey.com` |
| `TG_PURCHASE_CHANNELS` | `alipay`、`wxpay`、`usdt_bep20` 的逗号分隔列表；仅配置所选渠道，配置齐全才展示；当前人民币商户仅核对 `alipay` |
| `TG_PURCHASE_ZPAY_API_BASE_URL` | 从现有商城 `cn` 商户快照的官方纯 HTTPS origin；代码默认 `https://zpayz.cn` |
| `TG_PURCHASE_ZPAY_PID` | 现有商城 `cn` ZPay 商户 PID 的 TG 配置快照，不要求另建商户 |
| `TG_PURCHASE_ZPAY_KEY` | 同一商城商户密钥的 TG 配置快照，16–200 字符；不与数据库/兑换/上游秘密复用 |
| `TG_PURCHASE_NOWPAYMENTS_API_KEY` | USDT 专用 API key，16–300 字符；仅选择 USDT 渠道时要求配置 |
| `TG_PURCHASE_NOWPAYMENTS_IPN_SECRET` | USDT 独立回调 HMAC 秘密，16–300 字符，与 API key 及其他应用秘密不同 |
| `TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE` | 明确的 CNY/USD 汇率，十进制最多八位小数且大于 0、小于 10；无默认值，不自动抓取或猜测 |
| `TG_REDEMPTION_CODE_PEPPER` | 独立随机秘密，32–512 UTF-8 字节；用于 HMAC-SHA256 |
| `TG_REDEMPTION_CODE_ENCRYPTION_KEY` | 独立 32 字节 AES-256-GCM 密钥，64 位十六进制或标准带填充 base64 |
| `GRAMIX_API_KEY` | Gramix 专用 API key |
| `GRAMIX_API_BASE_URL` | 默认 `https://api.gramix.io/api/v1`；只允许 HTTPS，禁止重定向 |
| `GRAMIX_API_TIMEOUT_MS` | 默认 `15000`，范围 250–120000 毫秒，覆盖响应体读取 |
| `GRAMIX_PAYMENT_CURRENCY` | `usdt`（默认）或显式指定 `gram`；不会自动切换余额 |
| `TG_FULFILLMENT_POLL_SECONDS` | 默认 `15`，范围 5–3600 秒；状态查询指数退避至最多 3600 秒 |
| `TG_FULFILLMENT_LEASE_SECONDS` | 默认 `120`，范围 30–600 秒 |
| `TG_PUBLIC_ORIGINS` | 可选，逗号分隔的额外公开端精确 origin；也兼容单值 `TG_PUBLIC_ORIGIN` |

兑换码 pepper、加密密钥彼此独立，不得复用 `CRON_SECRET` 或 service-role key；运行时会拒绝上述直接复用。不要随意轮换 pepper：存量兑换码按原 pepper 生成摘要，当前没有多版本密钥迁移工具。

数据库只保存兑换码摘要、AES-GCM 密文和末四位；查询凭证、请求幂等键只保存 SHA-256 摘要。API 列表不返回兑换码密文或摘要，当前也不提供明文重新导出接口。数据库备份和密钥必须分开保护。

## 数据库文件与执行顺序

**SQL 由用户或数据库管理员在 Supabase SQL Editor 执行；Codex 未执行 SQL。**用户已于 2026-10-15 确认以下第 1–8 份均执行完成。Codex 随后仅通过 REST GET 核对所选新增字段、商品初始数据及匿名直读商品表被拒绝，未调用 RPC 或写入数据库。三份 `verify` 文件是结构/权限检查，不是上游购买验证，也不能覆盖真实并发与运行时 RPC 检查。

1. `supabase/migrations/20261015_add_tg_premium_redemption_domain.sql`
2. `supabase/migrations/20261015_tg_redemption_worker.sql`
3. `supabase/migrations/20261015_verify_tg_premium_redemption_domain.sql`
4. `supabase/migrations/20261015_verify_tg_redemption_worker.sql`
5. `supabase/migrations/20261015_tg_payment_currency_guard.sql`
6. `supabase/migrations/20261015_tg_stars_redemption.sql`
7. `supabase/migrations/20261015_tg_purchase_domain.sql`
8. `supabase/migrations/20261015_verify_tg_stars_purchase_domain.sql`
9. `supabase/migrations/20261015_tg_purchase_usdt_payments.sql`（本轮新增，尚待用户执行）

原四份无需因本次变更重跑。第 5 份为追加迁移，在原四份之后执行，包含自身的结构/权限核对；用户已于 2026-10-15 确认执行完成，Codex 已完成相关所选字段的只读 REST 核对，尚未验收 RPC 授权与运行时调用。它为订单增加可空的历史币种字段，新增三参数提交标记，并关闭旧两参数标记的购买授权；JS 和 SQL 均要求历史币种与官方订单一致。文件使用事务，不执行购买、不回填旧订单，也不打开业务开关。**不要重跑原第 2 份 worker SQL，以免覆盖第 5 份的新保护；启用新版 worker 前仍须完成运行时权限及联调验收**。旧数据库上的三参数调用会失败，系统不会降级成未记录币种的购买。

第 6 份追加 Stars 批次、兑换、查询及数量核验；第 7 份追加商品价格、报价、支付订单和购买履约来源；第 8 份仅做结构/权限检查。用户已确认三份执行完成，无需重跑已执行的第 1–8 份。新增商品均为 `enabled=false`、价格 NULL，不会自动开售。

第 9 份为独立 USDT 支付绑定及结算扩展，需接在第 8 份之后由用户执行；本轮 Codex 未执行，不能仅发布 JavaScript 后开启 USDT。第 1–8 份的执行确认不包含本轮第 9 份；不要重跑旧购买 SQL 覆盖新的支付绑定逻辑。

2026-10-15 的只读 REST 核验中，9 项 TG 表/视图的所选新增字段均可访问；商品表实际包含 `premium_3`、`premium_6`、`premium_12`、`stars`，均为 `enabled=false`、价格 NULL、`price_version=1`，币种为 CNY。现有公开 key 直接读取商品表返回 HTTP 401 / PostgreSQL `42501`。证据保存在 `/private/tmp/tg-database-readonly-check.json`；该核验未执行 SQL、RPC、写入或交易，不覆盖全部 ACL、真实并发及履约结果。

基础表为 `tg_redemption_batches`、`tg_redemption_codes`、`tg_redemption_orders`、`tg_fulfillment_attempts`、`tg_audit_events`，购买追加 `tg_purchase_products`、`tg_purchase_quotes`、`tg_purchase_orders`。表启用 RLS，撤销 `anon` / `authenticated` 直访权限；写入、查询、领取、提交标记及结果 RPC 仅授权 service role。不要给浏览器角色补开这些权限。

## API 契约

公共 API 的响应均 `Cache-Control: no-store`。生产采用持久化 IP 限流：兑换每分钟 10 次，查询每分钟 60 次；安全存储不可用时拒绝请求。

| 方法与路径 | 请求 / 作用 |
| --- | --- |
| `GET /api/tg/catalog` | 返回兑换/购买开关、Premium/Stars 目录、可售商品及支付渠道 |
| `GET /api/tg/recipient?username=...` | 读取 Telegram 公开昵称、头像和接收者类型；不代表账号所有权或可交付保证 |
| `POST /api/tg/purchase/quote` | JSON：商品 ID、用户名和可选 Stars 数量；返回服务端报价、价格版本和到期时间 |
| `POST /api/tg/purchase/orders` | JSON：报价 ID、商品/数量/用户名、确认金额/版本、渠道、查询凭证和幂等键；创建或恢复独立 TG 购买订单 |
| `GET /api/tg/purchase/status?order_no=...` | 凭证使用 `X-TG-Status-Token`；返回付款及发货状态 |
| `POST /api/tg/purchase/cancel` | JSON：`order_no`，查询凭证仅放 `X-TG-Status-Token`；安全关闭允许关闭的未付款订单 |
| `GET/POST /api/tg/purchase/webhooks/zpay` | 支付平台签名回调；到账事务核验并创建唯一履约任务 |
| `POST /api/tg/purchase/webhooks/nowpayments` | USDT 独立 IPN 回调；核对签名、币种、网络、金额、支付 ID 和本地订单绑定 |
| `POST /api/tg/preview` | JSON：`code`；只读返回实际产品、权益和期限，不预约兑换码；每 IP 每分钟 10 次 |
| `POST /api/tg/redeem` | JSON：`code`、`username`、`status_token`、`idempotency_key`；首次成功返回订单及凭证 |
| `GET /api/tg/status?order_no=...` | 凭证仅使用 `X-TG-Status-Token` header；URL query token 不接受 |
| `GET /api/admin/tg/codes?page=1&pageSize=50` | 批次分页，`pageSize` 最大 100 |
| `GET /api/admin/tg/codes?batchId=UUID` | 批次详情，最多 1000 条兑换码摘要信息 |
| `POST /api/admin/tg/codes` | JSON `action=generate`：产品类型、时长或 Stars 数量、`count`、可选 `name`、`notes`、`valid_until` |
| `POST /api/admin/tg/codes` | JSON `action=revoke`：`code_id` 或 `batch_id` 二选一，可选 `reason` |
| `GET /api/admin/tg/orders?page=1&pageSize=50&status=...` | 订单分页与状态筛选 |
| `GET /api/admin/tg/orders?orderId=UUID&reconcile=1` | 本地订单详情、最近处理记录及已知上游订单的只读核验 |
| `POST /api/admin/tg/orders` | `order_id`、`action`、`note`、`expected_updated_at`；操作为 `reconcile` / `resume_unsubmitted` / `close` / `note` |
| `GET /api/admin/tg/provider` | 只读余额、当前扣款币种、配置健康状态及业务开关；不返回密钥 |
| `GET/POST /api/admin/tg/products` | 查询、配置 Premium 售价或 Stars 单价、控制商品停售/开售 |
| `GET /api/admin/tg/purchases?page=1&pageSize=50` | 购买订单分页与组合筛选，付款和履约状态；不返回查询凭证 |
| `GET /api/admin/tg/purchases?order_no=...&reconcile=1` | 购买详情、关联履约单、处理记录和可选只读上游核验 |
| `POST /api/admin/tg/purchases` | `order_no`、`action`、`note`、`expected_updated_at`；操作为 `close` / `approve_payment` / `note` |

客户端应在发出兑换前生成足够随机的 `status_token`（32–128 位允许字符）和 `idempotency_key`（16–128 位允许字符），重试时保持四项兑换参数一致。也支持 `Idempotency-Key` header。服务器可以代生成未提供的凭证，但自定义客户端若需在首个响应丢失后恢复，必须预先生成并保存它们。

管理 API 使用既有管理会话 / 授权机制并再次要求 `super_admin`。跨 TG 子域 CORS 只开放对应必要接口，不开放商城钱包或其它后台操作。所有管理写请求（包括 Bearer 客户端）必须携带 `Origin: https://tg.adm.fatherkey.com` 和 `Content-Type: application/json`，不能只依赖 `SameSite` Cookie 或 CORS。非生产本地调试仅接受与请求实际协议、Host 和端口完全相同的 `localhost` / `127.0.0.1` origin。

`TG_PUBLIC_ORIGINS` 仅扩展公共 handler 的来源校验；新增跨域接入还需要同步配置服务器路由与 CORS，单独增加环境变量不会开放完整跨域访问。

## Worker 运行方式

需要 Node.js 20+，从仓库根目录运行。环境文件必须由部署环境私下创建并保护，不能把凭证作为命令行参数。

```bash
node --env-file=server/.env scripts/tg-fulfillment-worker.js --once
```

每次执行最多处理一个当前到期订单。指定本地订单 UUID：

```bash
node --env-file=server/.env scripts/tg-fulfillment-worker.js --once --order-id UUID
```

`--order-id` 仍遵守数据库的到期时间、状态和 lease，不是强制重试或重买命令。开关关闭时不初始化数据库或上游客户端；开关开启后该命令可能执行真实购买，不是 dry-run。

### KVM4 调度器（安装不等于启动）

`deploy/kvm4/tg-worker/` 提供独立的 systemd oneshot service、15 秒 timer、host wrapper 和容器内 runner。它们不依赖商城支付 worker，不新增公开履约 HTTP 接口，也不将密钥复制到第二份配置文件。正常每次调度最多处理一个订单；worker 运行期间的 tick 不并行执行，停机期间的 tick 不补跑。

host wrapper 使用 `flock` 串行化，并核对固定根目录 `/opt/zaoyoe-verify-server`、预期 commit、`.current-release`、release `.commit`、容器健康及 Compose 身份。实际容器里的 worker 代码摘要必须匹配 host release；TG/Gramix/数据库配置必须与私有 env_file 一致，避免只改文件但忘记重建容器。任何不一致均停止 tick，不触发购买。

容器内进程继承当前 Verify Server 环境。配置通过 stdin 比较，不 `source` host `.env`，不把密钥放到 `docker exec -e` 或命令行，也不输出原始上游响应。相关配置使用直接字面值；不要在 TG / Gramix / 数据库变量中依赖 Compose 插值或另一份 override，歧义或不一致应先排查，不能绕过检查。

仅在按 AGENTS.md 完成发布、对应最新 `main` 已在 KVM4 Verify Server 健康运行后，从干净的最新 `main` 安装：

```bash
npm run install:kvm4:tg-worker -- --expected-commit FULL_MAIN_SHA
```

`FULL_MAIN_SHA` 替换为已经完成发布的 40 位 commit。安装器只安装调度材料、校验配置，**保持 timer disabled / stopped，不开启业务开关，不运行购买**。不支持 `--start`、自定义 `--root` 或 `KVM4_ROOT`。本轮没有执行该安装命令。

每次 Verify Server 更新后都需要检查 TG 调度版本锁；不匹配时它会停止处理。待新提交验证通过后，重新安装对应版本，并按当次启用流程决定是否恢复 timer，不能只修改 expected-release 来绕过代码或配置校验。

新增或修改服务端秘密后，暂停 KVM4 health watchdog，在 canonical root 重建 Verify Server 以重新加载 Compose env_file：

```bash
cd /opt/zaoyoe-verify-server
docker compose up -d --no-deps --force-recreate --no-build verify-server
```

确认 `/healthz`、容器健康、离线配置及调度器 `--check` 后，再恢复 watchdog。`docker restart` 和 `docker compose restart` 不会重新读取 env_file。不要重置现有商城变量或更换服务根目录。

正式启用应另行确认数据库、域名、支付商户、售价、上游余额、权限和受控测试证据。届时可先仅开启履约并做指定订单的受控测试，再启动 timer，最后按授权开放新兑换/购买及对应商品；配置变动均按上面的 env_file 重建步骤执行。当前不启动 timer，不开启任何开关。正式运行后监控：

```bash
systemctl status zaoyoe-tg-worker.timer zaoyoe-tg-worker.service
journalctl -u zaoyoe-tg-worker.service --since '30 minutes ago'
```

timer 处于 active 不能单独证明订单已交付，还需检查最近 tick 的脱敏结果、待处理队列和人工复核订单。达到每 15 秒最多一单的调度容量时，应先评估积压与上游限流，再调整并发；不能复制多套 worker 盲目提速。

正常维护时先关闭新购买/兑换，保留回调、查询和履约以便排空已受理订单，再停止 timer。紧急停止可执行 `systemctl disable --now zaoyoe-tg-worker.timer`，它不会强行杀死当前正在执行的一次 worker；随后关闭业务开关并重建容器。已提交或结果未知的订单保持冻结，不能直接将兑换码恢复可用或对已付款订单自动重买。

## 离线就绪检查

仓库内运行以下命令只检查文件与配置，不初始化数据库连接、不执行 SQL、不请求 Gramix、不更改开关：

```bash
npm run readiness:tg -- --fail-on-invalid
npm run readiness:tg -- --env-file /private/path/verify.env --json --fail-on-invalid
```

在 Verify 容器内使用 `node scripts/tg-readiness.js --runtime --fail-on-invalid`。`--runtime` 仍完全离线，只省略不属于 API 镜像的 Vercel 页面与主机 systemd 文件检查；相关材料须在源码和 KVM4 host 分别核对。Verify 发布归档包含 `deploy/kvm4/tg-worker/` 供主机安装器比对，紧凑镜像不复制该目录。不能用 runtime profile 替代完整源码检查。

配置文件中的内容按 dotenv 字面解析，已有进程环境变量优先；这与 Node `--env-file` 一致。输出只包含检查名和状态，不包含配置值。`--env-file` 必须指向私有普通文件，权限 `0600` 或更严，不能是符号链接。

退出码 `0` 表示没有无效的已配置项；开关关闭时允许尚未录入秘密，仍逐项显示 `pending`。开关开启后缺少关键配置会失败。`--fail-on-invalid` 遇到无效配置返回 `2`；`--fail-on-not-ready` 在仍有人工验收事项时返回 `3`，不能用 `|| true` 跳过。离线工具始终返回 `ready: false`，测试通过或退出码 `0` 均不代表可以启用真实兑换。

## 验证与正式启用前提

本地测试覆盖 Gramix 请求契约、超时与脱敏、handler 权限/参数/限流、用户凭证重放、worker 提交边界、路由隔离、SQL 源码契约、离线就绪检查及调度器版本/配置/日志保护。SQL 契约测试不等于真实 PostgreSQL 并发、权限和迁移验证，mock 上游不等于真实交付验证。

本轮完整检查的 238 项定向测试全部通过，覆盖 TG 页面、实时价格与用户名预览、购买/兑换 API、ZPay/USDT 支付网关、原始金额精度、回调请求体、SQL 源码契约、履约 worker、路由、构建和环境隔离。第 6–9 份 SQL 及其 PL/pgSQL 函数通过纯语法解析，未因此执行 SQL。本地 `.env.tg.local` 已保存现有商城 `cn` ZPay 与 NOWPayments 商户配置快照并通过离线有效性检查，三个业务开关均关闭；生产环境尚未加载 TG 配置。本地浏览器已实际核对公开昵称/头像及 USDT 选项，两张页面均 HTTP 200，目录返回四个未定价且停售商品。实际配置的签名、金额与隔离检查使用完全 mock 的 fetch，未发送支付请求。自动测试使用离线配置、数据库 mock 和模拟上游，不证明真实付款、PostgreSQL 并发或上游交付已通过。第 1–8 份 SQL 均已有用户执行确认，第 9 份待用户执行；另已完成真实数据库的只读 REST 字段、商品初始数据及匿名商品表访问拒绝核验，尚未完成真实并发、完整 RPC、付款或上游交付验收。本轮没有部署、写入生产环境、开启业务或发起真实购买。

正式启用前仍需完成完整数据库 ACL、运行时 RPC 与真实并发验收、服务端独立密钥配置、Gramix 账户余额/权限确认、两个域名与 TLS 配置、worker 调度和告警，以及另行授权的受控上游联调。上线代码与打开业务开关应分别执行；部署仍遵守仓库 AGENTS.md 的 latest-main 发布流程。

推荐交接顺序：在已有只读核验基础上完成完整 ACL、真实并发/运行时 RPC 验证 → 配置域名且开关保持关闭 → PR/CI 合并最新 main 并验证既有三条发布链路 → 合并生产私有 TG 与支付配置并按 env_file 重建流程载入 → 安装但不启动 TG timer → 配置后台售价并保持停售 → 确认 USDT 余额并完成获准的受控支付/上游联调和告警演练 → 另行开放兑换或即时购买。此顺序不构成自动部署或真实购买授权。

日志、审计和异常输出不得包含 API key、明文兑换码、查询凭证或完整上游响应。对外错误使用通俗提示，管理员通过订单号和脱敏错误码排查。


## 2026-10-17 操作闭环补齐（本地工作区，尚未发布）

本节记录本次新增操作能力及其验收边界。上文关于“238 项测试”“第 1–8 份执行确认”“第 9 份待执行”和环境配置的叙述是前一轮的历史记录，原样保留；不代表本次已重新核验数据库、生产配置或完成部署。本次基于 `6e322240721059eac6909d923cf61148077ef5c0` 的 `codex/tg-operations-closure` 工作区实现。工作区改动尚不是生产发布证据。

### 已补齐的业务操作

| 能力 | 用户或管理员操作 | 系统保护与结果 |
| --- | --- | --- |
| 兑换码预览 | 用户输入兑换码和收件人，首次点击预览实际权益，再次确认才兑换 | 使用摘要只读查询；不预约、不返回码内容或其他用户信息；预览仅在当前页面内保留 60 秒，输入变化后失效；提交时原兑换事务重新校验 |
| 用户关闭购买单 | 查询原订单后点击“关闭未付款订单”并确认 | 查询凭证校验及购买单行锁；有付款、支付请求结果不明、租约或履约任务时拒绝关闭；提交关单后隐藏付款入口，响应丢失时保留原订单凭证用于查询 |
| 管理员关闭订单 | 在购买详情关闭安全的未付款单；在兑换详情关闭从未提交上游的兑换单 | 必填处理原因及订单版本；兑换单只有无提交标记、无上游身份、无币种、无 attempt 证据才可释放原码；不能关闭已提交或付款后履约单 |
| 到账人工复核 | 对已保存验证到账证据的 `manual_review` 购买单核准发货 | 仅使用数据库中回调已验证的付款事实，保留原账号、金额和权益；在同一事务创建唯一履约单，不接受浏览器传入的付款证明 |
| 履约人工复核 | 对 `manual_review` 履约单核验同步，或恢复从未提交的任务 | 核验同步时服务端重新 GET 上游并核对订单身份、账号、权益、币种、method 和状态，再复用 worker 结案函数；不会重新购买；缺少提交身份的未知结果继续冻结 |
| 上游只读查询 | 购买详情或履约详情点击“只读核对上游订单” | 返回脱敏核验结果和检查时间，不改变本地状态；“核验上游并同步结果”是另一次明确写操作 |
| 后台组合筛选 | 按编号、产品、用户名、来源、支付/履约状态、渠道与创建时间筛选 | 各列表使用其适用字段；输入经服务端白名单验证；分页保留筛选，重置回第一页；创建时间起点包含、终点不包含 |
| 处理记录 | 详情中保存核对记录、查看最近 50 条审计 | 操作人取服务端管理员会话，原因必填；旧版本写入拒绝并保留输入；审计只返回允许字段，备注按纯文本渲染 |

关单只关闭本站订单，**不会撤销已发出的支付平台收款请求，也不是退款**。关单、过期或待复核订单后续收到合法回调时，仍保留验证后的到账事实并进入人工核对，禁止自动发货。管理员确认客户原收件人和权益后可按原单核准；若需退款，应走独立的支付渠道处理流程并记录结果，本次没有退款接口或退款自动结案能力。

已保存原兑换请求凭证时，重试仍使用原参数；已有订单直接查询，避免已预约兑换码被新预览阻断。批次仍有效且预约已过期、从未尝试提交的码允许只读预览，真正回收由原兑换 RPC 加锁处理。上游结果未知且缺少订单 ID、历史币种或提交证据不完整时，不能强制成功、释放原码或重新购买；应保留冻结状态，通过上游支持核查并在详情记录进展。

### 追加 SQL 与部署前置

本次新增两份 SQL，均由用户或数据库管理员执行，**Codex 未执行 SQL**。必须先确认上文第 9 份 `20261015_tg_purchase_usdt_payments.sql` 及全部前置 TG 迁移已完成，然后依次执行：

10. `supabase/migrations/20261017_tg_operations_closure.sql`：追加 `cancelled` 支付状态、预览/关单/人工复核 RPC；保留最新版 USDT 订单字段、支付绑定和精度校验，更新迟到付款处理；新 RPC 只授权 `service_role`。
11. `supabase/migrations/20261017_verify_tg_operations_closure.sql`：只读检查结构、ACL 与函数保护。其通过不代表事务、并发或真实交易验收通过。

不要重跑较早的 worker、购买或 USDT 迁移覆盖本次函数。此次变更不自动启用购买、兑换、履约或商品。API 和共享 `server/tg/operations.js` 属于 KVM4 Verify Server，静态页面属于 Vercel；发布时两端须来自同一最新 `main`，并按 AGENTS.md 核验 worker 的匹配版本。离线 readiness 已将新模块和两份 SQL 纳入源码文件检查。

### 本次本地验证记录

以下结果对应上述基线提交上的本地工作区改动；API、数据库、支付、上游及浏览器登录均使用模拟数据，未产生真实交易。历史记录中的 238 项结果继续保留，本表单独记录本次回归结果。

| 检查 | 本次结果 | 证据与边界 |
| --- | --- | --- |
| 完整 TG 定向测试 | PASS：272 项通过，0 失败、0 取消、0 跳过、0 待办 | `node --test --test-reporter=spec --test-force-exit tests/tg-*.test.js`；包含 API、页面、worker、路由、打包、readiness 和 SQL 源码契约 |
| JavaScript 语法检查 | PASS：16 个新增或修改的 JS 文件 | 逐文件运行 `node --check`，不代表真实服务联调 |
| SQL 静态解析 | PASS：主迁移 17 条语句、5 个 PL/pgSQL 函数体；验证脚本 4 条语句、1 个 PL/pgSQL 代码块 | 使用 pglast `parse_sql` / `parse_plpgsql`，没有连接数据库或执行 SQL |
| Chromium 页面交互 | PASS：6 项，1440px 桌面 / 390px 手机 | 预览后确认兑换、关单隐藏付款入口、组合筛选、关联履约、只读上游查询与明确同步、审计；无页面脚本错误、意外网络请求或页面横向溢出；全部接口由本地 mock 响应 |
| 离线 readiness | 50 项 ok、18 项 pending、0 项 invalid；`ready: false` | `runReadiness({ env: {} })`，未加载密钥；缺失配置与人工验收继续 pending，不能据此启用业务 |

本地临时证据位于 `/tmp/tg-closure-full-tests.log`、`/tmp/tg-closure-readiness.json` 和 `/tmp/tg-closure-browser-20261017/`（交互报告及截图）；这些路径不属于生产证据或持久发布归档。浏览器报告明确记录 `working_tree: true`、`all_network_mocked: true`、`production_evidence: false`。

### 尚待真实环境验收

| 验收项 | 本次状态 | 必须确认的结果 |
| --- | --- | --- |
| 两份追加 SQL 应用及真实 ACL/RPC | NOT RUN | 新函数仅 service role 可用、预览无状态写入，返回字段与页面/API 一致 |
| 关单与回调、重复关单并发 | NOT RUN | 无漏款、无重复履约；合法迟到付款进入人工复核；已付款不可误关 |
| 人工放行与 worker 并发 | NOT RUN | 版本冲突、锁顺序、租约及唯一履约约束生效，旧页面不能覆盖新结果 |
| 上游真实状态核验与同步 | NOT RUN | 已知成功/失败/处理中状态核验一致；状态同步不产生第二次购买 |
| 真实兑换码预览与预约到期回收 | NOT RUN | 预览不占用库存，最终兑换重新校验；失效/已使用码不可兑换 |
| 真实付款、USDT 到账与 Gramix 交付 | NOT RUN | 签名、独立 GET、金额/地址/网络绑定及实际交付均有受控证据 |
| 生产部署、配置、业务启用 | NOT RUN | 本轮未推送、合并、部署、修改生产配置或打开任何业务开关 |

自动测试、SQL 静态解析及模拟浏览器交互仅用于验证实现，不能替代上述真实环境证据。


## 2026-10-17 本地预览合并恢复补充记录

较早工作区的支付弹窗、USDT 四网络、hover 和后台六分栏已恢复到当前操作闭环工作区。
来源备份、组合迁移依赖、677 项 TG 回归、276 项共享样式回归，以及用户登录后发现的
`closed_at` 缺字段问题，分别记录于 `docs/tg-preview-reconciliation-20261017.md`。
此补充不改变上文历史结果。原 `approve_payment` 快捷核准在组合版本中已停用，
统一使用重新核对渠道收款且确认退款/发货状态的审核流程。
最终组合 SQL、真实业务与并发验收仍为 NOT RUN；恢复预览不代表生产发布或业务验收完成。


### 2026-10-17 review_resolution 前置门禁失败补充更正

用户实际执行返回 `TG purchase fulfillment review is not ready`。已确认原安装顺序中
operations_closure 会覆盖 payment reconciliation 所需定义，使后续门禁失败。
当前恢复入口为 `supabase/migrations/20261017_tg_runtime_recovery.sql`，把恢复支付证明、
复核、关闭状态、最终组合与结构检查封装在一个事务中；具体操作见
`docs/tg-preview-reconciliation-20261017.md` 文末。原迁移及历史结果保留。
此文件由操作者手动执行；Codex 本轮未执行 SQL，业务及并发验收仍为 NOT RUN。


### 原上游订单恢复与凭据结案（2026-10-17 追加）

本节补齐原请求已经提交但缺少上游单号的处理入口。当前管理页购买详情内可只读核验并补录
本次原上游单，或登记上游明确未受理且不会后续发货的凭据后结案；两条路径均在提交时重新查单，
并核对购买/任务两个版本和工作租约。原请求标识、提交时间、币种与尝试历史保留，不重买、不自动退款。
本节与后续手册描述当前增量行为；上文历史结果继续保留，不改写既有 NOT RUN。

操作顺序、字段要求、阻断情况和独立验收矩阵见
`docs/tg-purchase-upstream-recovery.md`。安装时在已有 runtime recovery/reconciliation 与
purchase review resolution 就绪后，手动执行
`supabase/migrations/20261017_tg_purchase_upstream_recovery.sql`，再执行
`supabase/migrations/20261017_verify_tg_purchase_upstream_recovery.sql`。
结构成功提示仍明确保留 concurrent/business acceptance remains NOT RUN。Codex 本轮未执行 SQL。


### 2026-10-17 兑换码复制与弹窗交互补充（本地工作区）

本节更新上文“只在生成时显示完整兑换码、没有重新查看入口”的历史描述：超级管理员
可在批次详情点击兑换码尾号，将完整码复制到剪贴板。只有此次显式点击才会调用
POST /api/admin/tg/codes 的 reveal 动作；列表和详情 GET 继续只返回摘要。
服务端校验 TG 管理来源、JSON 请求及超级管理员权限，验证原有 AES-GCM 加密原文、
码格式、尾号与 HMAC 摘要，严格写入不含完整码的审计记录后才返回结果，响应禁止缓存。
缺少加密原文的旧码会明确提示使用生成时保存的原码；本次不需要新增数据库迁移。

较早的本地资源版本 20261017-dialog-copy-v7 在复制后展开完整码，并在自动复制失败时
选中完整码供手动复制。该版回归为 832/832、定向为 179/179，记录保留为历史证据。
依据用户后续要求，当前版本 20261017-copy-toast-v8 始终只显示尾号，移除“查看并复制”
和展开原码的输入框；悬停只变色并轻微下压，不显示矩形底色或边框。
点击会复制完整码，在浏览器底部浮出“复制成功”胶囊，约 2.4 秒后隐藏；失败仅提示
允许浏览器访问剪贴板后重试，不展开原码。详情关闭、重新打开或会话失效后，旧响应
不能更新页面或显示成功提示；原码不进入页面字段、存储或 URL。

本轮同时保留三个弹窗的遮罩点击关闭、提交中及新生成兑换码未确认保存时的关闭保护，
以及输入框聚焦的一层高亮边框。当前相关回归 834/834、定向 181/181，通过了真实批次
只读恢复及剪贴板格式/尾号核验。实际生成、撤销、付款、退款、订单关闭/补发/结案、
数据库并发及生产部署仍为 NOT RUN；上述界面证据不能替代业务验收。


### 2026-10-17 批次使用率与撤销操作区补充（本地工作区）

当前本地资源版本为 20261017-batch-usage-v9。批次列表在“生成张数”与“状态”之间
新增“使用率”，以已成功兑换张数 redeemed_count / 实际生成张数 generated_count
计算，显示百分比、已用/生成数量与细进度条。预留中、履约中、已撤销的码不计入成功
兑换；quantity 是申请生成量，不作为使用率分母。0/0 显示 0%，缺失或非法统计显示
“—”；使用原有列表统计字段，不额外读取完整兑换码，也不新增数据库迁移。

批次详情的“撤销此批次”移入独立操作区，与兑换码表格相隔 24px，避免中间隐藏的
复制反馈元素使原相邻选择器失效。撤销成功后清除旧提示、刷新列表及当前详情，移除
右下角“撤销操作已完成”；撤销确认、失败错误和原有复制胶囊继续保留。实际列表、
空态和加载骨架同步为七列。桌面与 390×844 窄屏均核对了按钮间距与内部表格滚动。

本轮定向测试 186/186、完整 TG / Gramix / USDT / local-preview 相关回归 839/839，
失败、取消、跳过和 todo 均为 0。本轮仅只读核对真实批次；实际生成、撤销、兑换、
付款/退款、订单关闭/补发/结案、数据库并发和生产部署仍为 NOT RUN。测试成功不替代
业务验收；历史记录和前序授权改动继续保留。


## 2026-10-17 数据中心增量

本地新增数据中心、只读聚合与列表筛选联动；统计口径、数据库接入顺序及独立验证记录见
`docs/tg-data-center.md`。迁移尚未应用，真实数据/并发/业务验收与生产部署均为 NOT RUN。
此增量不修改前文历史验收结果。
