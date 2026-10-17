# TG 站内支付弹窗与通道手续费

本记录对应 2026-10-15 的本地改动，基线为
`6e322240721059eac6909d923cf61148077ef5c0`，分支为
`codex/tg-payment-dialog-fees`。记录时改动尚未提交或部署。
用户要求暂不部署；本轮未执行 SQL、修改生产配置、启用 worker 或发起真实支付。
`docs/tg-premium-redemption.md` 中已有的历史验收记录不由本记录替代。

## 页面与支付入口

原 TG 页面直接打开上游付款 URL；支付宝的二维码 URL 在普通浏览器打开时可能跳到 App 下载页。
现在付款入口打开站内弹窗，使用与游客商城共用的
`css/cash-payment-dialog.css` 和本地二维码库。弹窗保留订单信息、金额明细、
确认订单 / 支付 / 发货步骤、倒计时和状态查询。
TG 仍使用自己的订单、查询凭证和支付 API，不创建游客商城订单。

支付宝和微信优先使用上游 `qrcode` 中的非图片 HTTPS 付款 URL，
否则使用有效的 `payurl`，在本地生成二维码供 App 扫码或识别。
已知下载站、根路径及占位 URL 不会作为付款二维码返回或展示。
二维码图片 URL 不会被误当成二维码内容再次编码；`payurl` 不仅凭文件扩展名判断是否有效。

USDT 弹窗展示 BSC（BEP20）、精确转账金额、收款地址、复制按钮和地址二维码。
地址二维码仅包含地址，用户还需核对网络和金额。
采用订单期限与上游报价期限中的较早值；到期、查询失败、金额不一致或付款完成后清除旧支付资料。

## 金额规则

| 渠道 | 通道手续费 |
| --- | --- |
| 支付宝 | 商品金额的 1% |
| USDT（BSC / BEP20） | 商品金额的 1%；链上 Gas 另付 |
| 微信（如已配置并开放） | 0% |

商品金额、手续费比例和金额、应付总额在购买前、确认订单和支付弹窗中展示。
金额使用整数分计算；手续费按分向上取整，例如商品金额 ¥100.00，
手续费 ¥1.00，应付 ¥101.00。
Stars 商品金额按单价与数量计算，手续费不增加 Stars 数量。

服务端报价绑定支付渠道，订单保存不可变的商品金额和费用快照；
ZPay 的请求金额为含费总额。USDT 按含费总额换算，
NOWPayments 设置 `is_fee_paid_by_user: false`，避免在订单已计费后再次向顾客加费。

少付仍可能收到上游通知，不能以是否回调判断成功。
人民币回调须校验签名、商户、订单、渠道、币种及完整应付金额；
USDT 还须核对签名 IPN 与官方查询结果，实际到账不得少于锁定的 `pay_amount`。
足额校验通过后才能确认支付并创建履约任务。
这些金额校验有本地 mock / 源码契约覆盖，尚无本轮真实付款证据。

## 数据库配套（未执行）

依赖既有 `supabase/migrations/20261015_tg_purchase_usdt_payments.sql`。
本次新增：

1. `supabase/migrations/20261015_tg_purchase_z_fees.sql`
2. `supabase/migrations/20261015_verify_tg_z_purchase_fees.sql`

迁移为报价和订单追加费用字段、渠道绑定、金额约束及不可变快照保护，
更新 RPC 和管理员查询视图。历史订单的商品金额回填为原应付金额，
手续费为 0，不重算已创建的付款。
迁移前报价不能再创建新订单；同一幂等请求仍可恢复原订单。
旧四参数报价 RPC 返回 `quote_stale`，不允许旧客户端继续创建未披露费用的新报价。

SQL 文件只经过源码契约检查，数据库执行与运行时验证为 **NOT RUN**。
未来获准发布时需将迁移、前端和 Verify API 配套安排，
完成用户执行迁移及只读校验后才能把新 API 视为可用。
迁移与旧版报价 API 不兼容的切换阶段会拒绝新报价；不能将其当作无中断升级。
代码仍须按 `AGENTS.md` 经最新 `main` 发布，不能单独上传本地文件。

## 本地验证证据

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| `node --test --test-force-exit tests/tg-*.test.js tests/guest-shop-*.test.js` | PASS：909 / 909，失败 0，跳过 0 | TG、游客商城、readiness 及历史 promo archive 契约 |
| `node --test --test-force-exit tests/admin-shop-guest-order*.test.js` | PASS：39 / 39，失败 0，跳过 0 | 管理员游客订单回归 |
| Playwright 支付流程 | PASS：3 / 3 | 1440×1080 支付宝、390×844 USDT、375×812 支付宝；所有 API mock，外部请求拒绝 |
| 原游客弹窗样式对比 | PASS：4 / 4 | 桌面 / 手机 × 深色 / 浅色，12 个关键节点计算样式与尺寸一致 |
| `git diff --check` | PASS | 补丁格式 |
| SQL 执行、数据库运行时、真实付款与发货 | NOT RUN | 不由 mock 结果替代 |
| 生产部署与生产页面验收 | NOT RUN | 用户明确暂不部署 |

本地临时证据位于 `/tmp/tg-guest-full-tests.log`、
`/tmp/tg-admin-guest-tests.log`、`/tmp/tg-payment-browser-results.json` 和
`/tmp/tg-guest-style-results.json`，不是持久生产验收归档。
浏览器预览使用上述基线加工作区改动，不代表已提交候选或线上版本。

## 2026-10-16：支付状态查询时的布局稳定性

查询同一订单时保留已确认的订单信息、二维码和倒计时，状态未变化时复用原有内容。
查询按钮显示进行中状态，避免重复点击。实际查询失败或响应未通过校验时，
保留此前确认的订单摘要，在付款区域原位显示重试提示并移除二维码、地址和复制操作；
切换订单或查询凭证时清除上一订单。付款码到期和已付款状态仍会移除支付资料。

本次本地验证（基线仍为上述 SHA 加未提交工作区改动）：

- `node --test --test-force-exit tests/tg-public-ui.test.js tests/tg-pages-contract.test.js tests/tg-admin-ui.test.js`：PASS，73 / 73，失败 0、跳过 0。
- Playwright：PASS，4 / 4，桌面 / 手机 × 支付宝 / USDT；模拟慢查询、503、恢复及已付款。
  等待期间、错误提示和恢复后的弹窗顶部与高度一致，未变化的状态保留同一二维码节点。
  所有支付 API 均为 mock，未创建真实订单；结果暂存 `/tmp/tg-payment-refresh-browser-results.json`。
- 本轮未部署、未执行 SQL、未创建真实支付；这些 UI 验证不替代前文的数据库和生产证据。

## 2026-10-16：BSC 实际期限与取消订单（本地未部署）

BSC 倒计时现在取服务端返回的订单截止时间与 NOWPayments
`expiration_estimate_date` 中较早者，不再额外截断为 5 分钟。浏览器使用状态响应中的服务端时间校准本地时钟，避免客户端时钟偏差导致显示错误。
已有保存的 USDT 报价仍保持不可变；追加迁移只影响新建支付快照，不能延长旧报价。

支付弹窗的“查询支付状态”右侧新增“取消订单”。取消请求必须携带订单查询凭证；服务端先读取并严格核对 ZPay / NOWPayments 的订单、商户、渠道、金额和支付状态，再由数据库 RPC 在订单行锁内完成取消。取消后不再展示付款 URL、二维码、USDT 地址或复制动作，也不再轮询或创建履约订单。

ZPay 和 NOWPayments 均没有可依赖的通用关单/撤销收款地址接口。因此这里的“取消”是本系统订单、支付展示和履约链路的终止，不虚称上游付款已撤销。取消后仍到账的回调会保留为 `manual_review`，不会自动发货；已付款、链上确认中、部分到账或已开始履约的订单不能取消。

新增但未执行的数据库文件：

- `supabase/migrations/20261016_tg_purchase_cancellation_expiry.sql`
- `supabase/migrations/20261016_verify_tg_purchase_cancellation_expiry.sql`

SQL 执行、真实支付、真实取消、退款和生产部署均为 **NOT RUN**。本轮没有修改生产配置。

本地验证：

- TG、游客商城、管理员游客订单相关测试：970 / 970 PASS。
- 取消/期限专项测试：100 / 100 PASS（包含接口鉴权、回调竞争、上游状态核对和旧报价不可变）。
- Playwright：4 / 4 PASS（桌面/手机 × 支付宝/BSC）；按钮无横向溢出，取消后付款资料消失，BSC 倒计时按 12 分钟模拟真实期限显示。
- 本地预览 `/healthz`：sourceCommit 为 `6e322240721059eac6909d923cf61148077ef5c0`；数据库迁移和生产部署未执行。

## 2026-10-16：USDT 应付金额与取消后的页面状态（本地未部署）

购买页和确认页的主应付金额现在按所选渠道显示。USDT 使用目录中的公开换算率和含 1% 手续费的人民币总额计算预估值；报价 API 同样以网关的整数金额换算规则返回 `usdt_estimate`。商品金额和手续费仍单独列出人民币明细，不再把人民币总额作为 USDT 应付金额。创建支付后只使用 NOWPayments 锁定的 `pay_amount`：展示向上取整到 4 位小数，复制和到账校验保留完整精度。预估值不能授权付款或发货，数据库的不可变人民币费用快照没有改币种。

用户发起取消、服务端明确返回取消成功后，页面关闭支付弹窗、清除当前订单查询凭证和支付视图、停止轮询并返回购买与兑换工作区。本地历史记录保留，并将已确认取消的记录标为可重试；再次核对并确认才会用新报价、新幂等键和新凭证创建新订单。取消回复丢失时只查询原订单；只有后续查询确认取消后才清理当前状态。取消失败、已到账或状态未确认时仍保留原订单保护，不恢复付款二维码，也不假装创建了替代订单。

普通关闭按钮和原生 Esc 关闭支付弹窗均返回购买与兑换工作区；未取消订单的查询凭证及后台状态轮询保留，可从订单查询继续查看。

本轮通过 KVM4 读取 Supabase REST 元数据（GET、未执行 SQL）：`fn_tg_cancel_purchase` 不在公开 RPC 元数据中，`tg_purchase_orders.cancelled_at` 列也不存在。这确认真实取消功能仍缺少上述 `20261016_tg_purchase_cancellation_expiry.sql` 迁移，截图中的取消请求不能当作取消成功。缺失 RPC 现在返回明确的取消服务不可用提示；订单保持未取消状态。按 `AGENTS.md`，迁移和配套校验 SQL 继续由用户执行；本轮未执行这两个文件，也未部署。

本轮验证（上述基线 SHA 加未提交工作区改动）：

- `node --test --test-reporter=tap --test-force-exit tests/tg-*.test.js`：286 / 286 PASS，失败 0、跳过 0。
- Playwright：4 / 4 PASS（1440 / 390 像素 × 支付宝 / USDT），覆盖购买和确认金额、取消后创建全新订单、关闭按钮 / Esc 返回工作区，以及取消服务 503 时保留原订单且不重复创建。支付 API 全部 mock，未创建真实订单、未付款或发货。
- 浏览器结果暂存 `/tmp/tg-payment-workspace-browser-results.json`；脚本 `/tmp/tg-payment-workspace-browser-check.cjs`；TG 测试日志 `/tmp/tg-payment-workspace-full-tests.log`。临时文件不是生产证据。
- 已确认 `http://127.0.0.1:8000/healthz` 的 sourceCommit 等于上述基线，静态页面和 API 使用本工作区修改。真实取消、迁移运行时和生产部署仍为 **NOT RUN**；缺失迁移没有因 mock 通过而变成 PASS。

## 2026-10-16：确认页单位与过期订单恢复（本地未部署）

确认页的“应付金额（USDT）”保留标签中的币种，数字后不再重复显示 USDT，避免换行。支付弹窗的精确金额复制规则保持不变。

已定位截图中从确认页进入过期旧订单查询页的原因：本地记录仍处于未完成状态时，确认流程会先选中原订单，直到切到订单查询页后才读取服务端状态。服务端此时确认旧单已过期，但该次操作已经结束，没有继续使用本次新报价创建新单。

现在确认流程会先查询有订单号的原请求。服务端验证金额、产品及凭证，并确认原单已过期或已取消且未开始履约后，才使用本次已确认的新报价、新幂等键和新查询凭证创建新支付订单；原单仍待支付时恢复原支付，不重复创建。超时、状态不匹配或原单已有履约时不能据此替换订单。

成功创建或恢复支付后直接打开支付弹窗，底层保持购买与兑换工作区，不再自动切换到订单查询页。创建失败和原订单状态不明的提示移到购买表单与确认区共用的可见位置，保留原请求用于重试。

本轮验证（仍为上述基线 SHA 加未提交工作区改动）：

- `node --test --test-reporter=tap --test-force-exit tests/tg-*.test.js`：289 / 289 PASS，失败 0、跳过 0。
- Playwright：4 / 4 PASS（1440 / 390 像素 × 支付宝 / USDT）；模拟旧单在页面闲置后过期，手机场景额外刷新页面恢复会话。一次确认即可先核对旧单、再创建新单并直接打开支付弹窗；观察页面属性确认全程没有打开订单查询页。状态 503 时保留当前确认页和原请求，不创建替代订单。全部支付 API 为 mock。
- 临时脚本 `/tmp/tg-confirm-order-browser-check.cjs`，结果 `/tmp/tg-confirm-order-browser-results.json`，日志 `/tmp/tg-confirm-recovery-full-tests.log`。本地预览基线已核对，返回的 `js/tg.js` 与当前工作区逐字节一致。
- 本轮未执行 SQL、未发起真实付款或履约、未部署；前文记录的真实取消迁移缺口未由此次 UI 修复替代。

## 2026-10-16：美元参考价误作 USDT 与取消失败后的重复购买（本地未部署）

本节更正前文“USDT 预估金额”的计算方法，保留前文作为历史记录。截图中的 Premium 12 个月商品金额为 21800 分、通道手续费 218 分，合计 22018 分；`usdPriceMinor(22018, '0.1536')` 为 3382 美分，即 **33.82 USD**。此前前端与报价 API 将该美元标价直接命名并显示为 `usdt_estimate`，缺少 USD → USDT 的渠道换算。支付创建请求使用 `price_currency: usd`、`pay_currency: usdtbsc`、`is_fixed_rate: true`；渠道 `pay_amount` 是独立返回的转账金额。截图的 34.2663 USDT 不能从 33.82 USD 直接推出，更不能把两者差额直接认定为第二次 1% 手续费或链上 Gas。人民币总价已含披露的 1%，`is_fee_paid_by_user` 仍为 false。

现在报价阶段通过官方只读 `GET /v1/estimate?amount=33.82&currency_from=usd&currency_to=usdtbsc` 获取实际 USDT 估价，不创建渠道支付。网关核对返回的来源金额、币种和网络，保留原始小数精度，拒绝异常或不可用的结果；不再把美元标价作为 USDT 降级值。目录不再提供给浏览器用于此错误换算的公开率，购买表单显示“核对订单后获取渠道估价”，确认页显示“预估支付（USDT）”，数字后不重复单位。渠道估价接口没有锁定付款金额，实际固定汇率支付仍以创建后的 `pay_amount` 为准，页面明确要求付款前核对；本节不声称预估与实际支付必定相等。金额展示仍向上取 4 位小数，复制及服务端到账校验使用完整金额，签名和官方查询双重核验逻辑保留。手机金额完整显示为一行。

取消失败后关闭支付弹窗、再次确认相同购买时，现在先查询原单，再重试用户已保存的取消意图；查询确认原单已过期或已取消且履约未开始后，才允许用本次报价、新幂等键和新凭证创建新支付。取消失败、已付款、原单状态未知时停留在当前确认页面，显示原订单号及取消未确认原因，不把禁止付款的无二维码旧单重新打开为新的支付弹窗。取消回复丢失时查询同一原单，只有明确的终态允许替换。

本地预览的共享 `js/tg-payment-pricing.js` 曾未纳入 API 模块缓存刷新，长期运行的预览会继续持有旧版导出。已补充 admin/public API 的共享计价模块刷新及行为回归，并重启本地 8000 服务；未部署。临时 8001 对照服务已关闭，生产配置未变更。本地履约开关保持关闭。

本轮验证（基线 `6e322240721059eac6909d923cf61148077ef5c0` 加当前未提交改动）：

- `node --test --test-reporter=tap --test-force-exit tests/tg-*.test.js tests/local-preview-server.test.js`：329 / 329 PASS，失败 0、跳过 0；其中 TG 292 项，本地预览 37 项。日志 `/tmp/tg-estimate-cancel-final-tests.log`。
- Playwright：4 / 4 PASS（1440 / 390 像素 × 支付宝 / BSC），覆盖取消 503 后关闭再下单不打开旧支付弹窗、重试取消成功后新报价/幂等键/凭证/二维码、手机刷新保留意图、精确 USDT 复制、金额不换行及无横向溢出。全部支付 API mock；脚本 `/tmp/tg-estimate-cancel-browser-check.cjs`，结果 `/tmp/tg-estimate-cancel-browser-results.json`。
- 真实只读渠道估价接口返回 200；运行时估价随时间变化，不将本次结果当作付款承诺。更新后的 `http://127.0.0.1:8000/api/tg/purchase/quote` 返回 200，人民币商品/手续费/总价分别为 21800 / 218 / 22018 分，USDT 使用渠道估价。此次仅核价，未创建真实支付订单、付款或履约。
- `/healthz` 的 sourceCommit 与上述基线一致，`tg.html`、`js/tg.js`、`js/tg-payment-pricing.js` 已比较本地服务返回内容与工作区文件相等。预览含未提交修改，不是生产证据。
- 真实取消仍缺少 `20261016_tg_purchase_cancellation_expiry.sql` 迁移（上一节 REST 元数据已记录缺口）；迁移及 `20261016_verify_tg_purchase_cancellation_expiry.sql` 由用户执行。本轮 SQL、真实取消成功验收和部署均为 **NOT RUN**，mock 通过不替代该缺口。

## 2026-10-16：改用 USDT 原币报价，恢复商品页数字（本地未部署）

本节更正上一节的估价方案，保留其测试记录。只把 USD 标价换为渠道 `/estimate` 仍不能保证实际支付一致，而且商品页隐藏数字不满足用户要求。此次恢复商品页明确的 USDT 数字，应付金额按同一个整数计价函数计算，包含一次 1% 通道费。配置优先用 `TG_PURCHASE_USDT_PER_CNY`，未设置时使用已有 `TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE` 数值作为商家 USDT 售价率；不是渠道承诺的美元市场汇率。USDT 售价向上取到 2 位，页面统一展示 4 位，复制及到账校验保持精确值。

真实未付款诊断发现，即使在 USD 固定汇率创建请求传入 `pay_amount`，渠道也没有按该金额收款：本地测试订单 `TGP-5439F472579D4FDABFB6` 请求 21.72，官方创建响应和后续 GET 均为 22.03155386 USDT、`price_currency: usd`、`price_amount: 21.72`。渠道 payment_id 为 5679431443，GET 状态 waiting、actually_paid 0。另一笔本地未付款测试单 `TGP-2B06DE7137EE4C10A76C` 也被服务端金额校验拦截。两单均未返回可支付二维码，数据库进入 manual_review，履约 not_started；不能声称两笔订单已经取消。未转账、未扣除上游余额、未履约，未尝试为同一订单再次创建渠道支付。

最终代码改为复用现有商城的原币报价方式：`price_currency: usdtbsc`、`pay_currency: usdtbsc`、`is_fixed_rate: false`、`is_fee_paid_by_user: false`，避免 USD → USDT 再换算。网关要求渠道原始 `price_amount`、`pay_amount` 与商家售价完全相等，任一原子单位偏差都拒绝支付入口。期限仍取渠道和订单的较早者；缺失渠道期限时只刷新同一 payment_id，不重新创建订单。

商品页、报价 API 和确认页共用售价函数。示例 Stars 500 商品 7000 分、手续费 70 分、总价 7070 分，率 0.1536 对应 10.86 USDT，显示 10.8600；Premium 12 个月 22018 分对应 33.8200。若目录率和 API 售价变化，刷新目录并要求重新核价；恢复旧美元订单时保持其原始精确金额，若与本次确认不同，必须单独核对原单金额后再次确认，不会悄悄展示不同金额的二维码。此前取消意图恢复、取消失败不重开旧支付弹窗等保护仍在。

数据库原有校验只接受 USD，因此必须先补充以下迁移；Codex 未执行任何 SQL：

1. 若尚未应用，先由操作者执行 `supabase/migrations/20261016_tg_purchase_cancellation_expiry.sql`，并执行其 `20261016_verify_tg_purchase_cancellation_expiry.sql` 核验。先前只读元数据已确认取消 RPC 和 cancelled_at 缺失。
2. 执行 `supabase/migrations/20261016_tg_purchase_usdt_native_pricing.sql`。
3. 执行只读 `supabase/migrations/20261016_verify_tg_purchase_usdt_native_pricing.sql`。

新迁移允许旧 USD 和新 usdtbsc 快照共存，USDT 原币报价必须等于实际收款金额；结算校验从固定 USD 改为逐单匹配快照币种，签名+官方 GET、完整金额、取消后付款转人工、过期后付款转人工与履约幂等逻辑保留。迁移不改旧订单、不启用开关。service-only `fn_tg_usdt_pricing_contract()` 用于新 USDT 报价/创建前的只读就绪检查；缺失/陈旧/不可用时在数据库新建订单和渠道请求之前返回 503 `usdt_pricing_migration_required`。支付宝和已有订单状态查询不依赖该迁移。

当前验收证据（基线 `6e322240721059eac6909d923cf61148077ef5c0` 加未提交工作区）：

- `node --test --test-reporter=tap --test-force-exit tests/tg-*.test.js tests/local-preview-server.test.js`：339 / 339 PASS，失败 0、跳过 0；TG 302 项，本地预览 37 项。日志 `/tmp/tg-native-price-full-tests.log`。包括原币报价及严格到账验证、旧美元高精度订单回调、原子单位差额拦截、迁移未就绪禁止创建、旧单单独确认、率更新重新核价、迁移与最新取消结算函数的静态保留契约。
- Playwright：4 / 4 PASS（1440 / 390 像素 × 支付宝 / BSC），验证商品/确认/支付数字相同、手机不换行和无横向溢出、取消失败重试与新二维码、精确复制。全部支付 API mock；不是官方渠道或数据库迁移运行时证据。脚本 `/tmp/tg-native-price-browser-check.cjs`，结果 `/tmp/tg-native-price-browser-results.json`，截图 `/tmp/tg-native-price-*-usdt_bep20-*.png`。
- 本地真实 API 当前按预期返回 503 `usdt_pricing_migration_required`，尚未应用新迁移。没有绕过该保护继续生成新单。原币创建、保存、真实回调/发货的完整验收 **NOT RUN**，待操作者完成上述迁移后继续；不将 mock 通过标成真实支付成功。
- 本地 `/healthz` sourceCommit 与上述基线相同；预览提供的 `tg.html`、`js/tg.js`、`js/tg-payment-pricing.js` 与工作区逐字节相等。预览地址 `http://127.0.0.1:8000/tg`，仅用于本地审查。SQL 运行、资金支付、上游扣款、履约与部署均 **NOT RUN**。

### 同轮后续：操作者迁移完成后的真实未付款验收

用户先确认两份迁移已执行。只读核验当时仅取消迁移生效（取消 RPC/cancelled_at 存在；native-pricing RPC 404、usdtbsc 校验 false），未绕过就绪保护。用户重新执行第二份后，`fn_tg_usdt_pricing_contract` 返回 HTTP 200、数值 1，接着完成以下真实 API/数据库/渠道验收。此记录更新上文“待迁移”状态，不改写其历史结果；SQL 由用户执行，Codex 没有执行 SQL。

- 官方只读 `/estimate` 的 usdtbsc → usdtbsc 检查：10.86 → 10.86、33.82 → 33.82。仅作为原币报价证据，未以它代替真实订单结果。
- Playwright 在本地页面使用真实 API 创建 Stars 500 两次：商品 7000 分、手续费 70 分、合计 7070 分；商品页、确认页、支付页均为 **10.8600 USDT**，精确收款金额 10.86，数据库快照 `price_currency: usdtbsc`、`price_amount_minor: 1086`。
- 订单 `TGP-3D2760C011EB475D94A0` / 渠道 5157290483：真实创建响应 HTTP 201，`price_amount=pay_amount=10.86`；取消前官方 GET HTTP 200、状态 waiting、金额相同。取消 API 成功后弹窗关闭，底层为购买表单，不打开订单查询页。
- 再次相同购买创建 `TGP-10ED30E8E49344F1B96A` / 渠道 6412986577：不同订单与渠道支付 ID，存在新的二维码，应付金额仍为 10.86。第二笔测试完成后也通过真实取消 API 取消。
- 只读数据库复核：两单 payment_status 均为 cancelled，cancelled_at 存在，paid_at 为空，各自关联履约订单数均为 0。BSC 已分配地址在渠道侧不能撤销，取消保留私有绑定用于晚到款人工核对；不将本地取消描述为链上地址失效。
- 脚本 `/tmp/tg-native-price-real-browser.cjs`，结果 `/tmp/tg-native-price-real-browser-results.json`，日志 `/tmp/tg-native-price-real-browser.log`；真实支付页截图为 `/tmp/tg-native-price-real-payment-1.png` / `-2.png`，截图对应的测试单已取消，不可付款。
- `pglast` 对取消迁移、新原币迁移和新核验脚本进行了 SQL/PLpgSQL 语法解析，全部 PASS；只解析文本，没有执行 SQL。只读 SQL 核验文件本身未由 Codex 运行，不把这项记为数据库执行 PASS。
- 本地 8000 服务健康，sourceCommit 仍为 `6e322240721059eac6909d923cf61148077ef5c0` 加未提交修改。此前 339 / 339 自动测试及 4 / 4 mock 页面场景结果保持独立。新增真实验收为创建→取消→相同购买创建新单/二维码→取消，PASS。

已完成的是真实未付款订单金额一致性与取消恢复验证。资金转账、真实到账回调、上游扣款、自动发货、生产部署仍为 **NOT RUN**。此前两笔美元诊断 manual_review 订单没有付款，也没有声称被取消；本轮未篡改旧订单状态。

### 2026-10-16：登录用户余额充值接入共享市场汇率（本地）

用户进一步授权将登录用户 USDT 余额充值与 TG 商城、主商城游客购买统一接入。
此次仍只修改本地代码，不部署、不执行 SQL、不改变生产配置，也没有创建真实充值支付单。
基线为 `6e322240721059eac6909d923cf61148077ef5c0` 加当前未提交工作区。

- 三种购买/充值场景共用 `api/_lib/payments/usdt-market-fx.js` 的 CoinGecko USDT/CNY 数据库快照；按需刷新，每个五分钟区间共用一条快照。
- 充值套餐与自定义充值均先按服务端配置计算一次通道手续费（当前默认 1%），再按快照换算并向上取整至 2 位 USDT。手续费不增加到账余额。
- `server/api-handlers/public/payments.js` 的公开配置在配置缓存之外读取当前快照；钱包前端携带展示的快照 ID。快照更新时拒绝静默换价，刷新金额后要求用户重新确认。
- `api/_lib/payments/provider-adapters.js` 以 `price_currency=pay_currency=usdtbsc`、`is_fixed_rate=false`、`is_fee_paid_by_user=false` 创建充值支付。校验渠道原始金额与锁定报价完全一致，不再刷新渠道估价；快照及支付金额保存在既有 session/order metadata。
- 新市场模式充值回调使用订单保存的 USDT 金额、支付 ID、币种及实际到账金额核验，不通过请求金额回显或 0.01 容差判定足额到账；后续回调保留支付标识和锁定金额。旧固定模式充值的兼容逻辑保留。
- 行情、快照、共享迁移不可用时，新 USDT 充值失败关闭；钱包的配置降级也不会展示固定汇率替代市场估价。支付宝与余额读取继续可用。

运行时文件包括 `api/_lib/payments/{orders,provider-adapters,nowpayments-webhook,usdt-market-fx}.js`、
`server/api-handlers/public/payments.js`、`js/components/WalletModal.js` 和 `lang/{zh,en}.json`。
KVM4 包含 api/server/js 目录；Vercel 静态构建包含钱包前端和语言文件，并由既有静态资源版本器更新缓存版本。

复用操作者手动执行的 `supabase/migrations/20261016_payment_usdt_market_fx.sql`；
登录充值使用既有 metadata，不需要新增充值表迁移。共享迁移执行完成后，
`PAYMENT_USDT_FX_MODE=market` 同时应用于三种场景。示例配置仍默认 `fixed`，没有启用生产市场模式。

验证：

- `node --test --test-force-exit tests/wallet-*.test.js tests/payment-*.test.js tests/nowpayments-*.test.js tests/guest-shop-payment-adapter.test.js tests/tg-*.test.js`：**563 / 563 PASS**，失败 0、跳过 0。日志 `/tmp/wallet-usdt-market-tests.log`。
- 新增 `tests/wallet-usdt-market-fx.test.js`，覆盖共享快照、金额一致、手续费、两类真实代码路径的 mock 下单/存储、行情失败关闭、拒绝渠道改价、过期报价确认、前端配置降级与后台刷新。`tests/nowpayments-webhook-handler.test.js` 增加足额与少付回调的入账/不入账测试；全部使用 mock，不是资金到账验收。
- 本轮变更的 Node 文件语法检查、两份语言 JSON 解析和 `git diff --check` 均 PASS。
- 共享迁移运行、生产市场模式启用、真实资金支付/回调、生产部署：**NOT RUN**。上述测试不替代历史游客购买档案契约，也不构成发布或启用证明。

### 2026-10-16：本地运行环境启用市场汇率

用户授权配置运行环境，使自动换算规则生效；此前“不部署”的约束继续有效。
本次仅为本工作区添加 Git 忽略的 `.env.local`，设置 `PAYMENT_USDT_FX_MODE=market`（权限 `0600`）。
现有 `/tmp/tg-price-preview.cjs` 启动器改为在继承的配置之后读取本地覆盖，并重启 `127.0.0.1:8000`；
其余本地登录、支付配置及关闭自动发货的设置保留。没有修改生产环境或运行部署，没有执行 SQL。

实际本地核验（北京时间约 11:35，基线 `6e322240721059eac6909d923cf61148077ef5c0` 加未提交工作区）：

- `/healthz` 与启动日志的 sourceCommit 均为上述基线 SHA。
- `/api/payments/config?site=cn` 的 NOWPayments 配置为 `fx_mode=market`，通道费为 `0.01`；`/api/tg/catalog` 为 `usdt_fx_mode=market`，支付宝及 USDT 通道仍可见。
- 两个实际接口及重复请求均返回同一快照 `23678033-85d6-4046-9d91-1a9039579994`：`1 USDT = 6.68000000 CNY`，`1 CNY = 0.14970060 USDT`。该快照在北京时间 `11:40:00` 过期。这是当时观察值，不是永久固定汇率。
- 共享计价函数将 `98.00 CNY + 0.98 CNY` 换算为 `14.82 USDT`；五分钟区间首次报价按需取得市场快照，已创建订单保持锁价。
- TG、管理后台、商城三个本地页面均返回各自预期脚本内容。
- `node --test --test-force-exit tests/payment-usdt-market-fx.test.js tests/wallet-usdt-market-fx.test.js tests/guest-shop-payment-adapter.test.js tests/tg-usdt-payment.test.js`：**79 / 79 PASS**，失败 0、跳过 0。日志 `/tmp/local-market-fx-activation-tests.log`。

游客购买共享计价的本次证据为代码路径及自动测试，没有为验证配置创建真实购买或充值支付单。
真实付款、资金到账回调、生产自动汇率启用与部署均 **NOT RUN**。

### 2026-10-16：TG 按钮与可点击卡片统一下压动效（本地）

按用户要求参考 KC 充值页 `services/kc-pay-gpt/public/style.css` 的主、次按钮动效，
在 TG 用户页与管理页共享的 `css/tg.css` 中统一交互：普通控件 hover 下移 `0.75px`、按下下移 `1.5px`；
主按钮分别为 `0.85px` 和 `1.8px`，使用同样的 `150ms cubic-bezier(0.22, 1, 0.36, 1)` 位移过渡。
覆盖套餐、支付方式、数量预设、导航、管理操作、自定义下拉菜单以及弹窗按钮。
移除 hover 图标放大及上浮位移，并缩短按钮和卡片 hover/active 的投影；禁用状态不位移，
系统“减少动态效果”启用时关闭该位移。静态内容面板仍保持原有位置。
两个 HTML 入口同步更新共享样式版本号，现有 `127.0.0.1:8000` 预览直接读取本地新样式。

`node --test --test-force-exit tests/tg-pages-contract.test.js tests/tg-public-ui.test.js tests/tg-admin-ui.test.js`：
**95 / 95 PASS**，失败 0、跳过 0。日志 `/tmp/tg-press-ui-tests.log`。
本次仅调整本地样式及入口样式版本，没有部署或修改生产配置。

Chrome/Playwright 在 `1440px` 与 `390px` 宽度完成 **70 项控件动效检查**，
核对 hover、active、复位、禁用及减少动态效果状态；结果 `/tmp/tg-press-motion-browser-results.json`。
浏览器使用隔离的模拟业务响应，未执行购买、充值或管理业务变更；本地两个页面实际返回的新样式版本也已核验。

### 2026-10-16：NOWPayments USDT 网络选择（本地，未部署）

按用户要求为 TG 商城、主商城游客现金购买和登录用户余额充值增加 USDT 收款网络选择：
BSC (`usdtbsc`)、TON (`usdtton`)、Polygon (`usdtmatic`) 和 TRON (`usdttrc20`)。
买家选定的网络随报价、订单幂等身份和支付请求传递；支付回调按实际 `pay_currency`、订单锁定金额、收款地址及可选 TON Memo 绑定校验，
不以 NOWPayments 的 `outcome_currency` 或商户结算币种替代买家实际付款网络。TON Memo 若渠道返回则在支付信息展示并可复制。
旧订单和省略网络的历史 TG BSC 路径继续兼容；新网络必须与报价绑定，不能在创建支付后改网。

商户收款/结算钱包与买家每笔订单收到的 NOWPayments 入金地址是两回事：
买家按订单二维码向 NOWPayments 生成的地址付款，商户应在 NOWPayments 账户中核对并配置其结算/提现钱包及对应网络支持情况。
是否需要为每条链分别登记钱包，取决于账户结算币种、自动兑换和提现配置；本地代码不能验证账户侧配置。上线前需在 NOWPayments 后台确认四种入金币种可用、结算目标正确以及各网络最低金额；不可把商户钱包地址当作订单付款地址展示给买家。

新增的 operator-applied 迁移为 `supabase/migrations/20261016_payment_usdt_network_selection.sql`。
须在取消/过期迁移、TG USDT 原币定价迁移和共享市场汇率迁移之后，由操作者在目标 Supabase 项目执行；本轮没有执行 SQL。
未应用迁移时不得创建新的多网络 TG USDT 订单。没有启用任何支付开关，也没有部署。

验证（基线 `6e322240721059eac6909d923cf61148077ef5c0` 加未提交工作区）：

- 相关 TG、钱包、支付、NOWPayments、游客商城、游客订单管理和本地预览 Node 测试：**1293 / 1293 PASS**，失败 0、跳过 0。原始 dot 日志 `/tmp/usdt-network-final-suite.log`（1293 个通过标记）。
- 新增网络注册表及迁移静态保护契约，另对网络迁移 SQL/PLpgSQL 做语法解析：15 条 SQL 语句、4 个 PL/pgSQL 函数均 PASS；此为静态语法检查，不是数据库执行证据。
- Playwright 在 `1440px` 桌面及 `390px` 手机宽度分别走过四种网络，共 **8 / 8 PASS**；验证网络切换、不同订单身份、显示收款网络/金额/地址、TON Memo 复制及无水平溢出。所有支付接口均为 mock，结果 `/tmp/tg-network-browser-results.json`；不代表 NOWPayments 商户账号或链上真实验收。
- `git diff --check` PASS；本地预览 `/healthz` sourceCommit 为基线 SHA。工作区有未提交改动，预览不是生产构建证据。
- 数据库迁移、商户钱包配置、真实支付/到账回调/自动发货、生产部署：**NOT RUN**。

### 2026-10-16：商城本地预览的查询与确认配置（未部署）

本轮核对 `origin` 为规范 HTTPS 远端，基线仍为
`6e322240721059eac6909d923cf61148077ef5c0`，`HEAD..origin/main` 为 0。
`shop.html`、`guest-orders.html`、`js/guest-shop-client.js` 和
`css/cash-payment-dialog.css` 的本地 HTTP 响应与工作区文件逐字节一致。
截图中的查询服务不可用、邮箱可选及缺少查询密码框，来自本地游客接口配置与生产不同；
不能据此判定静态页面来自旧快照。本地还包含尚未部署的多网络等工作区改动。

`scripts/local-preview-guest-shop.js` 提供显式启用的查询/报价中继；
本工作区的 Git 忽略文件 `.env.local` 已设置
`LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN=https://verify-api.fatherkey.com`。
中继允许查询登录/退出、订单列表/详情/下载、商品报价和无订单意图 cookie 的只读
`checkoutAction=inspect`。建单、取消、重置凭证、worker 及其他订单写操作均拒绝，
上游故障不回退到本地配置。没有复制生产 peppers 或账户登录令牌。
买家自行在本地查询页输入的邮箱和查询密码会发送至上述正式 Verify API；
本轮未填写或提交真实凭证，也没有核验某个买家的实际订单结果。

修改中继文件或 `.env.local` 后须重启 `node scripts/local-preview-server.js`。
本轮发现旧进程早于最后的中继补丁启动，仍拒绝只读意图检查；确认 PID、命令和
工作目录后已重启当前仓库的 8000 服务。重启后 `/healthz` 显示
`sourceMode=working-tree`、`workingTreeDirty=true`、
`guestShopApi.mode=upstream-query-and-preview`、`orderWritesEnabled=false`。
源提交、分支、工作区脏状态及文件数量也出现在启动日志中。

验证结果：

- `node --test --test-force-exit tests/guest-shop-*.test.js tests/guest-orders-*.test.js tests/admin-shop-guest-order*.test.js tests/payment-usdt-*.test.js tests/local-preview-*.test.js`：**773 / 773 PASS**，失败 0、跳过 0；含历史 promo 档案和 readiness 契约。日志 `/tmp/a8cb-preview-regression.log`。
- 真实只读接口：查询能力 `200 enabled=true`；意图检查 `200 pending=false`；无凭证订单列表返回预期的 `403 guest_order_credentials_invalid`。没有把未登录的 403 当成已登录订单查询成功。
- 浏览器确认查询表单恢复；测试商品确认页显示必填邮箱、必填查询密码、密码要求及服务器报价，未再进入错误的订单恢复状态。截图暂存 `/tmp/a8cb-preview-proof/order-query.jpg` 和 `/tmp/a8cb-preview-proof/checkout.jpg`。
- 中继身份过滤、cookie 转换、来源校验、订单写操作零转发和上游错误行为由隔离 mock 服务测试，未向正式 API 发送订单写请求。
- SQL、真实查询登录、建单/取消、付款、发货及生产部署：**NOT RUN**。这些本地证据不替代前文数据库、支付和生产验收记录。

### 2026-10-16：真实订单中继开启后的单笔游客订单取消修复（未部署）

此记录补充上一节的只读预览状态：用户随后明确选择“真实待付款订单，我来付款测试”，
本地中继已通过 `LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES=true` 开放买家下单、查询、
取消和领取；`/healthz` 显示 `guestShopApi.mode=upstream-checkout`、
`orderWritesEnabled=true`，订单服务仍是 `https://verify-api.fatherkey.com`。

取消失败的根因在 `server/api-handlers/public/guest-shop.js` 的单笔 `cancel` 处理函数：
使用 `db.rpc` 前未执行 `const db = getSupabase()`。核对 KVM4 容器内实际源文件也确认
该函数使用 `db.rpc`，但没有初始化 `db`。有合法凭证的待支付订单因此在调用取消 RPC
前报错；公开错误处理将内部异常隐藏为 HTTP 500“游客购买请求失败”。新增接口测试在
修复前复现 pending/review 取消返回 500，且取消 RPC 调用次数为 0。

本地修复初始化并检查数据库客户端，所有取消均由原有
`fn_guest_shop_cancel_order` 原子事务处理。移除 RPC 报错后分别释放库存、更新支付单和
订单的降级路径，防止越过事务内的付款状态校验或产生部分取消。前端收到 5xx 时说明
“取消订单暂时失败，原订单已保留。请稍后重试或查询支付状态。”，保留原订单句柄；
回归覆盖旧查询响应不覆盖错误提示，以及对同一订单再次取消成功后才清除句柄。

本轮验证结果：

- `node --test tests/guest-shop-client-race.test.js tests/guest-shop-cancel-handler.test.js tests/guest-shop-cancel-order-contract.test.js tests/guest-shop-cancel-review-order-contract.test.js`：**52 / 52 PASS**。
- `node --test --test-force-exit tests/*guest*test.js tests/local-preview*test.js`：61 个文件，**790 / 790 PASS**，失败 0、跳过 0，包含历史 promo 档案与 readiness 契约。
- 修改过的运行代码及测试语法检查、`git diff --check`：**PASS**。本地 HTTP 返回的 `js/guest-shop-client.js` 与工作区逐字节一致，`Cache-Control: no-store`。
- 本地预览基线：`6e322240721059eac6909d923cf61148077ef5c0`，分支 `codex/tg-payment-dialog-fees`，工作区含未提交改动；预览为工作区证据。
- 截图订单只读核验：`payment_status=pending`、`reservation_status=held`、`fulfillment_status=pending`、`refund_status=none`、`cancelled_at=null`。
- 修复后真实订单取消验收：**NOT RUN**。真实请求仍转发到尚未包含此修复的线上服务，需后续用户授权发布后验收。
- 本轮 SQL、真实付款、发货、生产部署：**NOT RUN**。

### 2026-10-16：本地真实取消链路接通及验收（未部署）

本节补充上一节的后续结果，保留上一节当时的 NOT RUN 记录。用户再次遇到的
“取消订单暂时失败”是线上缺陷仍未部署修复的表现；修改前端提示本身并没有取消订单。
用户明确要求暂不部署，并已授权本地页面创建真实待付款订单、自行付款测试。

新增 `scripts/local-preview-guest-cancel.js`，通过显式本地配置
`LOCAL_PREVIEW_GUEST_SHOP_CANCEL_MODE=local-rpc` 接通取消。该模式要求已配置线上中继且
`LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES=true`，默认为原有 upstream 模式，不能自动降级。
来源、Host、loopback socket、方法、字段及请求大小仍经过中继原有校验。单笔取消先调用
线上 `guest/status` 验证原订单 claim cookie，并请求刷新付款状态；claim 失效时，仅在
携带买家 session/credential 的情况下调用线上 `guest/order` 再验证归属及凭证撤销状态。
任何验证失败、返回订单号不一致、数据库公共不可变字段不一致都会阻止本地写入。

验证通过后，本地使用现有 `.env.local` 中的数据库连接调用原有
`fn_guest_shop_cancel_order`，不写入独立的库存/支付更新，不执行迁移或其他 SQL。
数据库拒绝已付款订单时返回 409，取消结果未确认时不报告成功；超时后重试已取消订单
会重新验证买家身份并返回已完成结果，避免重复释放。生产 peppers 没有复制到本机。
`/healthz` 和启动输出新增 `cancellationMode`，清楚标明取消实际执行位置。
该入口仅属于本地预览，生产取消接口的代码修复仍待后续授权发布。

本地运行证据：

- 基线 `6e322240721059eac6909d923cf61148077ef5c0`，规范 HTTPS origin，
  `git fetch origin main` 后 `HEAD..origin/main=0`；分支仍为
  `codex/tg-payment-dialog-fees`，保留全部未提交工作。
- 已重启当前工作区 127.0.0.1:8000 预览，`sourceMode=working-tree`、
  `guestShopApi.mode=upstream-checkout`、`orderWritesEnabled=true`、
  `cancellationMode=local-rpc`；Git 忽略的 `.env.local` 权限仍为 `0600`。
- **真实未付款订单取消 PASS**：通过本地 prepare/commit 创建测试订单
  `GS202610160935403853C57F48D361F`，获得实际付款二维码，但没有付款。
  取消前为 `payment_status=pending`、`reservation_status=held`、`cancelled_at=null`；
  本地取消响应 `200 cancelled=true`，取消后为 `expired` / `released`，
  `cancelled_at=2026-10-16T09:35:45.472389+00:00`（北京时间 17:35:45）。
  对同一订单重复取消返回 `200 cancelled=true`；随后 ack 原建单意图返回 200。
- 另从 KVM4 生产容器执行只读核验：本地与线上 Supabase 项目一致；线上运行环境读取
  上述测试订单也确认 `expired` / `released` 和同一取消时间。测试结果不是 mock。
  没有使用用户截图订单的凭证，也没有声称该截图订单已经取消。
- 新增边界与行为测试覆盖来源伪造、非法字段、失效/撤销凭证、上游校验故障、订单/数据库
  不匹配、付款抢先确认、RPC 失败和丢失响应后的重试。
  `node --test tests/local-preview-guest-cancel.test.js tests/local-preview-guest-shop.test.js tests/guest-shop-cancel-handler.test.js tests/guest-shop-client-race.test.js`：
  **90 / 90 PASS**，失败 0、跳过 0。
- `node --test --test-force-exit tests/*guest*test.js tests/local-preview*test.js`：
  **62 个文件，812 / 812 PASS**，失败 0、跳过 0；包括历史 promo 档案与 readiness 契约。
  日志 `/tmp/guest-cancel-local-rpc-regression-20261016.log`。
- JS 语法检查及 `git diff --check`：**PASS**。
- 用户原截图订单的浏览器点击取消、真实付款、到账/发货、SQL、生产部署：**NOT RUN**。
  真实取消验收仅针对上面的独立测试订单。没有变更线上商品或支付开关。


### 2026-10-16：TG 支付宝到账未记账的交易号核对修复（本地，待数据库迁移，未部署）

真实订单 `TGP-247EDB2ED0E0405EBB6E`（50 Stars，商品 ¥7.00 + 1% 手续费 ¥0.07）
经易支付商户认证接口只读查询，已确认收到完整 ¥7.07。渠道正式交易号与建单保存的
`provider_trade_no=order_no` 占位别名不同，原子结算函数因此拒绝回调。
审计记录有 6 次 `purchase_payment_rejected / payment_binding_mismatch`，北京时间
16:52:23、16:52:25、16:52:28、16:52:31、16:55:24、17:06:24。
本次根因是回调到达后被绑定校验拒绝；手续费已付足。原状态查询仅查询数据库，不能主动查单恢复。
本地旧临时回调隧道随后失效，属于另一个需要修复的环境问题。

本地修复：

- 支付网关新增商户认证只读查单，逐项核对商户、订单、渠道、币种、含费总额及交易号。
  只有尚未收款、原交易号为空或为该订单自身别名时允许查单提供正式交易号；已绑定的真实交易号不能换绑。
  不记录或返回渠道原始响应、查询密钥及签名。
- 状态接口先验证买家查询凭证，再主动核对渠道收款。已签名通知发生旧别名绑定冲突时，
  必须经过独立认证查单且所有结算字段与通知一致，才可重试原原子结算入口。
- 新增 `supabase/migrations/20261016_tg_purchase_zpay_reconciliation.sql`，同时修正
  `fn_tg_confirm_purchase_payment` 和 `tg_guard_purchase_identity` 的严格例外。
  完整服务端查单证明必须精确匹配旧别名、订单、商户、正式交易号、渠道、金额及币种；
  缺失字段或 SQL NULL 均拒绝放行，且不能已有履约记录。保留其他身份/报价不可变检查、
  原有 crypto 多网络精确到账绑定、取消及过期保护、锁和幂等发货逻辑。
  readiness RPC 同时检查结算函数和不可变触发器。
- 渠道已确认收款但数据库尚未同步时，页面显示“渠道已收款，等待核对”，隐藏付款二维码、
  入口及倒计时，禁用取消并继续查单。页内按订单记住收款确认，后续渠道故障或陈旧 pending
  响应不能恢复付款/取消入口；未将数据库状态伪装为 paid。
- 恢复仅公开签名 webhook 的本地回调 relay 与临时隧道。新增随机 challenge 健康探测，
  新支付在创建前检查回调可达性和数据库 readiness，条件缺失时明确失败，不继续建单。
  隧道仍为本地临时进程；主动查单恢复不依赖原通知地址继续可达。

最终验证结果：

- 规范 HTTPS origin，`git fetch origin main` 后 `HEAD..origin/main=0`；
  基线 `6e322240721059eac6909d923cf61148077ef5c0`，分支
  `codex/tg-payment-dialog-fees`。保留工作区全部既有改动，未做 reset/rebase/切分支。
- 完整 TG、local-preview、guest-shop、admin guest-order、USDT 网络/汇率及钱包回归：
  `node --test --test-force-exit tests/tg-*.test.js tests/local-preview-*.test.js tests/guest-shop-*.test.js tests/admin-shop-guest-order*.test.js tests/payment-usdt-*.test.js tests/wallet-usdt-market-fx.test.js`：
  **1158 / 1158 PASS**，失败 0、取消 0、跳过 0。包括 guest-shop 历史档案与 readiness 契约。
  日志 `/tmp/tg-zpay-final-regression-20261016.log`。
- 9 个本次支付修复 JS/测试文件语法检查及 `git diff --check`：**PASS**。
- 本地 `/healthz`：200、status=ok，启动及当前 source SHA 与基线一致，
  sourceMode=working-tree、workingTreeDirty=true；这些是本地工作区证据。
- 真实临时回调 challenge 与网关下单前连通检查：**PASS**；非法签名 webhook 返回 **401**。
- 数据库 reconciliation readiness：**NOT READY**，只读检查 RPC 404 / PGRST202。
  本地支付宝 quote 返回 **503 payment_reconciliation_migration_required**，没有创建新支付订单。
- 截至最后一次真实只读核验，上述已付款订单在数据库仍为 expired、paid_at=null、
  履约记录 0；支付到期时间为北京时间 17:06:45。迁移文件仅定义函数，应用本身不结算订单。
  用户手动应用迁移后再经真实查单及原子结算，已过期订单应进入 manual_review，不能直接自动发货。
- 浏览器视觉/交互验收：**NOT RUN**。浏览器工具获取已有本地 tab 时被 URL 安全策略拒绝；
  未改用其他浏览器、CDP 或脚本绕过。单元测试和普通服务/API 检查不能替代浏览器验收。
- SQL 执行、真实订单到账写入、上游扣款、Stars 发货、生产部署：**NOT RUN**。
  本轮不修改生产服务，不打开新的商品或支付开关，不声称订单已补记或已发货。


### 2026-10-16：TG 支付核对迁移应用后的真实到账恢复（本地验收，未部署）

本节补充上一节的后续结果，保留上一节当时的 NOT READY / NOT RUN 状态。
用户确认手动执行迁移后，当前项目 `fn_tg_purchase_payment_reconciliation_ready`
实际返回 true，结算函数和不可变触发器的新校验已生效。

`git fetch origin main` 后 `HEAD..origin/main=0`，HEAD / origin/main 仍为
`6e322240721059eac6909d923cf61148077ef5c0`；本地预览 `/healthz` 200，
启动 SHA 与当前 source SHA 一致，sourceMode=working-tree、workingTreeDirty=true。
本轮保留全部既有改动，没有切分支、重置或部署。

真实订单 `TGP-247EDB2ED0E0405EBB6E` 的恢复核验：

- 恢复前重新读取，确认该单为 @zaoyoe 的 50 Stars，商品 ¥7.00 + 手续费 ¥0.07，
  数据库 expired、paid_at=null、交易号为自身订单号别名、履约记录 0。
- 易支付商户认证只读查单再次确认已付完整 ¥7.07，所有商户、订单、渠道及金额绑定相符。
  将网关真实返回的 authenticated_query 证明原样传入应用原有
  `fn_tg_confirm_purchase_payment`，未直接更新订单表，未伪造到账数据或签名通知。
- 原子核对返回 success=true、existing=false，真实数据库回读为 **manual_review**，
  `paid_at=2026-10-16T10:14:31.392691+00:00`（北京时间18:14:31的补记时间），
  正式交易号已绑定；原因 `payment_received_after_expiry`。
  该原因反映恢复核对时订单窗口已结束，不是判定用户原付款晚于到期时间。
- 同一真实查单证明重复调用原结算入口，返回 success=true、existing=true，
  状态仍为 manual_review，**幂等核验 PASS**。
- 回读审计有 `purchase_payment_trade_reconciled` 与
  `purchase_payment_manual_review`，时间与本次补记一致；履约记录仍为 **0**。
  订单到账已补记，50 Stars **尚未发货**；没有绕过既有过期人工核对规则。

运行接口核验：

- 本地支付回调连通检查：**PASS**。
- 通过真实临时回调公网入口提交非法签名通知：返回 **401**，**PASS**。
- 本地支付宝 50 Stars 报价：**200 success=true**，currency=CNY、total_minor=707、
  payment_fee_minor=7，**PASS**。迁移拦截已解除；本次仅创建报价，没有创建新的支付订单。
- 本轮无运行代码变更；自动化回归沿用上一节同一工作区的 **1158 / 1158 PASS** 记录，
  没有将接口核验冒记为新增自动化测试或浏览器实测。
- 浏览器视觉/交互验收仍为 **NOT RUN**，沿用上一节的 URL 安全策略阻断边界。
- 本轮 Codex SQL 执行、上游扣款、Stars 发货、生产部署：**NOT RUN**。
  迁移由用户执行；本轮真实业务写入仅经已有原子结算 RPC 恢复上述订单到账及其审计。

### 2026-10-16：购买订单审核补发流程（本地实现，迁移待人工应用，未部署）

本节追加审核入口和后续操作说明，保留上一节真实到账恢复的历史证据。
本次只实施代码及文件变更，并只读核对原订单；没有批准真实补发、退款、上游采购，
也没有切换 worker、销售或支付开关。

#### 审核入口与适用范围

本地管理员入口为 `http://127.0.0.1:8000/tg-admin`。超级管理员登录后，在“购买订单”
中点击对应订单的“审核补发”；其他状态的订单可点“详情 / 核对”只读查看。
弹窗分别显示接收账号、商品数量、含手续费金额、渠道实时查单结果、到账记录时间、
原发货任务和审核历史，不把“进入发货队列”显示为“已经发货”。

首次审核仅允许：易支付支付宝或微信订单、已记录足额到账、原因
`payment_received_after_expiry`、未取消，且完全没有关联发货任务。
USDT、未确认收款、取消订单、其他人工核对原因或已有发货任务的订单均不得用此入口重新发货。
既有失败或结果不明确的任务也不能被此入口重置，须继续调查原任务及上游订单。
“到账记录时间”是系统补记到账的时间，不是实际付款时间，不能据此判定用户付款晚了。

#### 数据库依赖与应用状态

前置迁移 `20261016_tg_purchase_zpay_reconciliation.sql` 已由用户执行并只读确认 ready=true。
新增文件：

1. `/Users/wangyongchao/.codex/worktrees/a8cb/xianyu_profit_calculator/supabase/migrations/20261016_tg_purchase_fulfillment_review.sql`
2. `/Users/wangyongchao/.codex/worktrees/a8cb/xianyu_profit_calculator/supabase/migrations/20261016_verify_tg_purchase_fulfillment_review.sql`

本轮 Codex 未执行上述 SQL。北京时间 **2026-10-16 18:55:11** 真实只读检查显示，
`fn_tg_purchase_fulfillment_review_ready` 尚未生效，接口返回
`review.ready=false`、`can_approve=false`、`blocked_code=migration_required`。
管理员可以查看收款核对，提交补发保持关闭。

用户如决定启用此审核入口，需在与该订单相同的 Supabase 项目依次人工执行以上两个文件。
第一份只定义审核与 readiness 函数，不审批任何已有订单；第二份只核对安装状态和函数安全约束，
不调用审核函数，也不修改订单。执行成功后刷新本地管理页并重新核对。
迁移应用不等同于对任何真实订单的补发授权。

#### 管理员操作步骤

1. 在支付后台核对原商户订单、完整实收金额、退款记录及进行中的退款。
   如已决定退款，继续走退款核对流程，不同时审批补发；退款与发货必须由运营协同处理。
2. 在 TG 后台打开该购买订单，核对收款查单结果、接收账号、Stars 数量或 Premium 时长，
   并确认没有通过其他方式发货。渠道查单失败或绑定不一致时不能审批。
3. 填写 6–500 字审核备注，分别确认“未退款且没有进行中的退款”和“未另行发货”。
   备注应记录核对依据，不应包含密钥、卡密或其他支付凭证秘密。
4. 点击“确认审核并补发”。该操作会创建真实履约任务；现有 worker 处理任务时可能消耗上游余额。
   服务端在提交时重新进行商户认证查单，核对的是包含 1% 通道手续费的完整金额。
5. 审核成功后留在当前弹窗，可查看原发货任务及审核记录；实际交付以原任务的最终结果为准。
   自动履约开关关闭时会显示等待 worker 的提示，此入口不会启动或启用 worker。
6. 若提交响应丢失或结果未确认，保留原订单，点击“重新核对收款与发货”。
   不另建订单或另行采购。重新核对会清空两项确认，保留同一订单的审核备注，供再次人工确认。

商户认证查单只证明渠道返回的已付状态及金额/身份相符，不能替代运营核对退款记录，
也不能保证查单之后没有其他管理员在支付后台发起退款。两项人工确认仍是必需步骤。

#### 原子审批、重试与审计

`server/tg/purchase-review.js` 只允许服务端可信查单结果进入审核 RPC。
提交字段白名单不接受浏览器提供的支付证明、金额、发货状态或审核人身份；
审核人来自已验证的超级管理员会话。GET/POST 沿用 TG 管理域权限；POST 要求受信 Origin 与 JSON。
渠道查询证明进入 RPC 前再按字段白名单裁剪，原始响应或凭证不进入审计。

`fn_tg_approve_purchase_fulfillment` 仅允许 service_role 调用，固定 search_path。
事务按原结算顺序锁定交易号、购买订单和发货任务，检查最近 120 秒内的认证查单证明、
订单/商户/正式交易/原交易/渠道/完整金额/币种绑定、交易复用及精确 `updated_at` 版本。
状态更新、创建唯一任务及写入审核审计在同一事务中完成；任一步失败都不返回审批成功。

新任务使用正常付款结算相同的 `purchase_id` 唯一约束、原状态令牌哈希和
`tg-purchase:` / `tg-purchase-` 幂等命名空间，交给现有 worker；该接口不直接调用上游购买。
保留原金额、手续费、到账时间、正式交易号、接收账号和商品快照。
已审批订单的重复请求仅在原任务不可变绑定及原审核审计均吻合时返回原任务，
不重置状态、上游单号、租约、重试次数，也不新增审核记录。
审计保存真实 `actor_user_id`、备注、核对时间、此前原因、金额币种、两项人工确认和履约 ID。

#### 本轮验收证据与边界

- `git fetch origin main` 后基线仍为
  `6e322240721059eac6909d923cf61148077ef5c0`，`HEAD..origin/main=0`。
  继续原有工作区，没有丢弃此前改动。
- 专项测试：
  `node --test tests/tg-purchase-review.test.js tests/tg-purchase-review-contract.test.js tests/tg-admin-ui.test.js tests/tg-purchase.test.js`：
  **180 / 180 PASS**，失败 0、取消 0、跳过 0。
  日志 `/tmp/tg-review-focused-20261016.log`。
- 完整相关回归：
  `node --test --test-force-exit tests/tg-*.test.js tests/local-preview-*.test.js tests/guest-shop-*.test.js tests/guest-orders-*.test.js tests/admin-shop-guest-order*.test.js tests/payment-usdt-*.test.js tests/wallet-usdt-market-fx.test.js tests/payment-zpay-webhook-handler.test.js tests/payment-public-zpay-webhook-endpoint.test.js tests/nowpayments-*.test.js`：
  **1299 / 1299 PASS**，失败 0、取消 0、跳过 0。
  日志 `/tmp/tg-review-full-regression-20261016.log`。
  包含 guest-shop 历史 promo 档案与 readiness 契约；这些结果仍独立于线上或人工验收。
- 新测试覆盖权限/来源、费用与全部收款绑定、证明缺失或错配、迁移缺失、旧版本、
  已有任务、重复请求、未知提交结果、弹窗关闭/切单/退出后的异步响应、
  审批后旧 GET 不能覆盖已确认结果，以及 SQL 的锁顺序/唯一性/原子审计/服务角色授权静态约束。
  并发与事务部分是模拟及源码契约，**不冒记为真实数据库并发测试**。
- 普通 HTTP 检查：`/healthz` 200，当前及启动 source SHA 同基线，sourceMode=working-tree、
  workingTreeDirty=true；`/tg-admin` 200，包含审核弹窗及新资源版本；
  `/js/tg-admin.js` 与工作区文件完全一致；未登录访问审核详情返回 **401**。
  本地工作区证据不作为生产发布证据。
- 北京时间 **2026-10-16 18:55:11**，通过新服务的只读详情核对真实订单
  `TGP-247EDB2ED0E0405EBB6E`：@zaoyoe、50 Stars、¥7.07、
  payment_status=manual_review、fulfillment_status=not_started、关联履约 0、审核记录 0，
  商户认证查单 confirmed。因新迁移未生效，can_approve=false。
- SQL 执行、真实数据库审批/并发验收、真实补发、上游扣款、退款、部署：**NOT RUN**。
  浏览器视觉/交互验收：**NOT RUN**，沿用此前 URL 安全策略阻断边界，未绕过。


### 2026-10-16：原发货任务上游查询与履约开关作用域修正（本地，未部署）

#### 已确认的原因与历史记录补充

上一节的“自动履约开关关闭时会显示等待 worker 的提示”描述的是当时页面行为，
不是线上 worker 的运行证据。本轮只读核验发现该提示仅使用当前 API 的
`TG_FULFILLMENT_ENABLED`，因此本地预览关闭该值时，会错误暗示线上 worker 也未启用。
现已明确标注“当前 API”，并声明独立 worker 状态未在此接口核验，不再把两者混同。
上一节 18:55 的订单与迁移状态是历史快照，保留原结果；用户随后执行迁移并审核后，
本轮核验已存在下述唯一发货任务，不再适用“关联履约 0”的旧快照。

- KVM4 `/opt/zaoyoe-verify-server/.current-release` 为
  `6e322240721059eac6909d923cf61148077ef5c0`。
  只读检查主机/verify 容器配置确认自动履约已开启、Gramix 已配置；
  `zaoyoe-tg-worker.timer` 为 `active`、`enabled`，本轮末再次检查仍一致。
  本轮未启停 timer、未改生产配置。
- 购买订单 `TGP-247EDB2ED0E0405EBB6E` 审核后关联原发货单
  `TG-89BDCCE141CC425BB5BE`（`f43af4e6-e5dd-4498-810d-944cd2a69a31`）。
  当前任务 `manual_review`、`attempt_count=1`、`provider_order_id=null`，
  `submitted_at=2026-10-16T11:01:33.161643+00:00`，异常 `gramix_http_error`。
  这证明 worker 已尝试提交，但不能仅凭 HTTP 错误判断上游绝对未受理或未扣款。
- 北京时间 **2026-10-16 19:22:45**，使用本地新查询服务读取真实原任务，
  Gramix 当前账号列表返回 0 条，结果为 `not_found`、`verified=false`、
  `pages=1`、`scanned=0`、`exhausted=true`。
  查前/查后全部选定任务字段一致（含状态、提交次数、更新时间）。
  这是服务函数及真实数据库/上游只读验收，未冒记为已登录浏览器端到端验收。
- 北京时间 **2026-10-16 19:24:13**，Gramix 认证余额查询 HTTP 200：
  USDT `0.0000`、GRAM `0.0000`。此前一次较短查询失败，延长单次超时后查询成功。
  当前余额为零是需要处理的运营条件，但现有持久化日志不足以断定此前失败的具体原因。
  客户支付给商户与上游账号可用余额需分别核对；本轮未充值、转账或重发。

#### 查询接口与后台入口

增强现有受超级管理员权限保护的 GET 接口：

`/api/admin/tg/orders?orderId=<原发货任务 UUID>&reconcile=1`

- 有上游订单号时 GET 详情，复用 worker 的身份、接收账号、商品权益、API 来源、
  保存的扣款币种、合法金额、状态和可选幂等键校验。
- 无上游订单号且没有提交记录时返回 `not_submitted`，不调用上游。
- 有提交记录但无上游订单号时，最多扫描 3 页、每页 100 条，每次上游请求限时 3 秒。
  只按原任务持久化提交标识精确关联，再次 GET 并校验详情；不按用户名、数量或时间猜测。
  若上游列表不提供可关联字段，返回 `submission_unknown`，不伪造关联结果。
- 分别返回未提交、提交未确认、未找到、范围受限、不匹配、查询不可用或已核验结果。
  “未找到”不等于“允许重发”；上游查询失败也不等于订单失败。
- 查询不新建任务、不写回找回的上游 ID、不改变原任务、不调用购买接口。
  保留旧响应兼容字段；不返回原始上游响应、提交幂等键、凭证或签名 URL。
- 审核详情与 provider/orders 响应增加当前 API 作用域诊断，
  `worker_status=unverified` 不冒充对远程 timer 的实时监控。

管理页的“购买订单 → 详情 / 核对”内增加“查询上游状态”，结果留在同一审核弹窗；
原发货任务详情也始终可查询，包括缺少上游订单号的任务。
结果同时展示本地状态与上游状态、原发货单、提交/查询时间和异常码，
并保留“查看原发货任务”。查询按钮防止重复点击；关闭、切单、退出后迟到响应不重开弹窗或覆盖别单。
JS 资源版本为 `20261016-upstream-status`。

#### 本地环境与验收

- 本轮修改前文件备份：`/tmp/tg-upstream-query-before-20261016.tar.gz`。
  原本地环境备份：`/tmp/tg-local-upstream-env-before-20261016`，权限 `0600`。
  前者是本轮相关文件备份，不是整个工作区的 Git 恢复备份，不能据此做破坏性 Git 操作。
- 重启预览前再次 `git fetch origin main`，`HEAD..origin/main=0`，
  HEAD 和 origin/main 同为上述 SHA。保留此前全部工作区改动。
- 为本地查询配置现有应用的 Gramix 凭证，保存在被 Git 忽略的 `.env.local`，权限 `0600`。
  未改本地自动履约开关、未启用本地 worker、未改任何生产配置。
- 8000 端口预览已重载。`/healthz` HTTP 200，启动/当前 source SHA 一致，
  sourceMode=`working-tree`、workingTreeDirty=true。
  guest-shop 仍为原 `upstream-checkout`、真实待付款写入开启、`cancellationMode=local-rpc`，
  未回退既有支付与取消配置。
- `/tg-admin` HTTP 200 且包含新 JS 版本；JS 与工作区文件哈希一致。
  未登录访问真实任务的 `reconcile=1` 接口返回 **401**。
- 专项测试：
  `node --test tests/tg-upstream-status.test.js tests/tg-handlers.test.js tests/tg-admin-ui.test.js tests/tg-purchase-review.test.js`：
  **214 / 214 PASS**，失败 0、取消 0、跳过 0。
  日志 `/tmp/tg-upstream-focused-20261016.log`。
- 完整相关回归：
  `node --test --test-force-exit tests/tg-*.test.js tests/local-preview-*.test.js tests/guest-shop-*.test.js tests/guest-orders-*.test.js tests/admin-shop-guest-order*.test.js tests/payment-usdt-*.test.js tests/wallet-usdt-market-fx.test.js tests/payment-zpay-webhook-handler.test.js tests/payment-public-zpay-webhook-endpoint.test.js tests/nowpayments-*.test.js tests/gramix-client.test.js`：
  **1357 / 1357 PASS**，失败 0、取消 0、跳过 0。
  日志 `/tmp/tg-upstream-full-regression-20261016.log`。
  含历史 promo 档案契约与 readiness 契约，仍独立于生产/人工验收。
- 语法检查、`git diff --check`：PASS。
  本轮无新 SQL，无需数据库迁移。
- 浏览器视觉/交互验收：**NOT RUN**，沿用此前 URL 安全策略阻断边界，未绕过。
  真实审核 POST、重发、上游扣款、退款、SQL 执行、部署：**NOT RUN**。
  新查询入口与提示目前仅在本地工作区生效，不作为生产发布证据。

### 2026-10-16：上游具体错误与当前余额分开诊断（本地，未部署）

#### 原订单只读核对及处理边界

- 本轮基线：分支 `codex/tg-payment-dialog-fees`，HEAD 与 origin/main 均为
  `6e322240721059eac6909d923cf61148077ef5c0`；已 fetch，`HEAD..origin/main=0`。
  保留工作区此前全部修改，未切分支、重置、变基或执行清理。
- 本轮修改前相关文件备份：`/tmp/tg-error-diagnostics-before-20261016.tar.gz`，已验证可读。
  此为相关文件备份，不是整个工作区 Git 备份，不作为破坏性 Git 操作的授权或依据。
- 北京时间 **2026-10-16 19:45:49**，再次读取原发货任务
  `TG-89BDCCE141CC425BB5BE`，状态仍为 `manual_review`，提交次数仍为 `1`。
  新查询函数返回 `not_found`，只扫描一页、0 条记录、已读完本次返回列表。
  当前上游 USDT `0.0000`、GRAM `0.0000`；任务持久化扣款币种为 `usdt`。
  查前、查后选定任务字段一致，未购买、写回订单或触发 worker。
- 原记录仍只有 `gramix_http_error`，历史具体 HTTP 状态和响应内容未留存。
  当前余额为 0 和查单无匹配结果，不能回填为原请求的确定失败原因，
  也不能单独证明原请求没有扣款。旧记录展示“历史记录仅保留通用错误码，具体 HTTP 状态和上游原因未留存”。
- 运营处理应核对当前 API Key 所属 Gramix 账户及其 USDT 采购余额，并核对原提交时间
  （北京时间 2026-10-16 19:01:33）附近的上游订单与扣款记录。
  确认原请求结果后再处理原任务；补足余额不会自动恢复 `manual_review`。
  本轮没有实现或调用恢复/重试接口，不新增补发任务，不将“未找到”解释为允许重发。

#### 错误保留与管理页展示

- 新增 `server/tg/gramix-errors.js`，按明确的 HTTP 状态及精确消息识别错误，
  返回固定的错误码、中文原因、HTTP 状态和处理建议。
  官方接口参考：`https://gramix.io/resellers/api/documentation`。
  支持官方列出的身份认证、参数/提交标识、会员时长、余额不足、资源不存在、
  请求方法与服务器异常，保留精确兼容消息的识别。
  未知 403 不推断为余额不足；未知、超长、非 JSON 或状态不符的消息不透传。
- Gramix 客户端最多读取 8192 字节错误体，保留整体超时与中止机制。
  已收到 HTTP 状态但错误体超时的情况仍保留该状态，不误报为未收到响应的连接超时。
  不向后台或数据库写入原始响应、API Key、签名 URL 或任意上游消息。
- worker 利用既有 `fn_tg_finish_order` 的 `p_error_code` / `p_error_message` 保存诊断，
  格式例如 `[HTTP 403] 上游余额不足（Insufficient balance）`。
  提交异常仍进入人工审核并停止自动重试；轮询的既有重试策略不变。
  本轮无新 SQL、无数据库迁移，也未执行 SQL。
- 上游 GET 查询分别返回 `diagnostics.recorded_error` 和 `diagnostics.balance`；
  余额查询限时 3 秒，只对有错误或待人工审核任务追加。
  当前查单错误、当前余额错误与历史任务错误互不替代，不改变查单结论。
- TG 管理页的审核详情及发货任务详情分别展示原任务错误、原 HTTP 状态、处理建议、
  本次查单异常和当前余额/检查时间。既有业务校验错误仍保留原说明。
  原有权限校验、关闭弹窗及切单后的异步响应保护继续有效。
  JS 版本为 `20261016-upstream-errors`。

#### 验收记录

- 首轮专项测试：客户端、worker、上游查询、管理接口和管理页交互
  **196 / 196 PASS**，失败 0、取消 0、跳过 0。
  日志 `/tmp/tg-error-diagnostics-focused-20261016.log`。
- 首轮完整相关回归 **1390 / 1390 PASS**；随后补齐官方错误格式与业务错误回退测试。
  最终执行：
  `node --test --test-force-exit tests/tg-*.test.js tests/local-preview-*.test.js tests/guest-shop-*.test.js tests/guest-orders-*.test.js tests/admin-shop-guest-order*.test.js tests/payment-usdt-*.test.js tests/wallet-usdt-market-fx.test.js tests/payment-zpay-webhook-handler.test.js tests/payment-public-zpay-webhook-endpoint.test.js tests/nowpayments-*.test.js tests/gramix-client.test.js`：
  **1397 / 1397 PASS**，失败 0、取消 0、跳过 0。
  最终日志 `/tmp/tg-error-diagnostics-full-regression-20261016.log`。
  历史 promo 档案契约、readiness 契约与人工运营验收仍为不同证据集。
- 5 个修改的运行时 JS 文件语法检查及 `git diff --check`：PASS。
- 北京时间 **2026-10-16 19:49:09**，本地 `/healthz` HTTP 200，启动/当前 source SHA 均与上述 HEAD 相同。
  `sourceMode=working-tree`，工作区有未提交修改；本地预览代表此工作区，不作为生产证据。
  guest-shop 保留 `mode=upstream-checkout`、原上游 origin、真实待付款写入开启及 `cancellationMode=local-rpc`。
  `/tg-admin` HTTP 200 并引用新版本；所服务 JS 与磁盘哈希一致。
  未登录访问原任务 `reconcile=1` 返回 **401**。
  HTTP 验收记录 `/tmp/tg-error-diagnostics-preview-20261016.json`。
- 新模块处于既有 Verify 打包的 `server` 目录及 Docker `COPY server` 输入内，
  Vercel `.vercelignore` 也已包含 `!server/tg/**`；本轮未构建或上传生产制品。
- 浏览器视觉/登录端到端验收：**NOT RUN**，沿用此前 URL 安全策略边界，未绕过。
  真实补发、恢复任务、上游扣款、充值、退款、SQL 执行、部署：**NOT RUN**。
  本轮仅本地代码改动及只读核对，未改变任何生产开关或生产配置。

### 2026-10-16：已付款待复核订单与再次购买分开确认（仅本地）

#### 原因与改动

- 用户报告同商品、同接收者再次购买时出现“检测到尚未完成的原订单”，
  继续确认又回到已付款待人工复核的 `TGP-247EDB2ED0E0405EBB6E`。
  原逻辑仅在发货成功时设置购买记录 `completed`，把已付款但尚未发货的订单
  一直当作必须恢复的下单请求；价格变化时还会将新报价覆盖成旧订单金额。
- 在 `js/tg.js` 区分恢复原请求、普通购买及明确确认另购。
  接口核验原订单为 `paid` 后，首次确认仅提示原订单已付款及履约状态，保留本次新报价，
  提供“查看原订单”和“确认另购并创建新订单”。只有下一次明确确认并再次核验原状态后，
  才用新报价、新幂等键及新查询凭证创建独立订单；不改写原订单的履约结果。
- 同一购买指纹优先恢复最新的未决请求，防止另购响应丢失或刷新后重新命中较早的已付款订单。
  待付款、查询失败、返回内容不匹配、支付待核对或仅渠道收款待入账，均不能借另购确认绕过恢复保护。
  返回修改、改变选择及刷新会清除另购确认；状态查询期间改变选择不会恢复旧确认或创建新单。
- 独立保留最近一次已核验的新报价。若旧待付款订单在恢复旧金额后变成已付款，
  另购仍使用已展示的本次新报价，不重复使用旧订单已消耗的报价 ID。
- `tg.html` / `css/tg.css` 增加本标签页最近订单入口，选择只查询，保留原订单和查询凭证。
  列表只显示商品、用户名、订单号，不展示查询凭证。
  已付款弹窗改为“订单进度”“已付金额”，明确提示无需重复付款，并移除继续付款的提示。
  前端 JS/CSS 缓存版本为 `20261016-paid-order-repurchase-v1`。
- 本轮改动文件：`js/tg.js`、`tg.html`、`css/tg.css`、`tests/tg-public-ui.test.js`、本文档。
  修改前的上述文件已逐项核验可从 `/tmp/tg-paid-order-repurchase-before-20261016-7kJ84d` 读回，
  目录权限 `0700`。这是相关文件备份，不作为破坏性 Git 操作所需的完整工作区备份。

#### 验收记录

- 基线：分支 `codex/tg-payment-dialog-fees`，HEAD 和已获取的 `origin/main` 均为
  `6e322240721059eac6909d923cf61148077ef5c0`；`HEAD..origin/main` 为 0。
  origin 为规范 HTTPS 地址。保留既有未提交工作，没有切分支、重置或变基。
- 首轮现有页面/交互回归 **61 / 62 PASS，1 FAIL**，日志
  `/tmp/tg-paid-order-repurchase-baseline-20261016.log`。
  失败项是原取消重试测试对“接口已确认付款”分支仍要求显示未确认取消。
  针对该分支改为验证已付款提示、另购二次确认及原订单查询；其他取消重试保护断言保留。
- 增加 6 项行为回归（内部覆盖多组履约状态、价格、刷新、异常及切换场景）：
  已付款待处理/处理中/等待官方确认/人工复核/失败时的明确另购；
  新旧报价与凭证隔离；最近订单查询；较新的待付款订单恢复；
  另购响应丢失后的幂等重试和刷新；确认撤销及异步状态切换。
  最终 `node --test tests/tg-public-ui.test.js tests/tg-pages-contract.test.js`：
  **68 / 68 PASS**，失败 0、取消 0、跳过 0。
  日志 `/tmp/tg-paid-order-repurchase-focused-20261016.log`。
- 完整相关回归命令沿用上一节 18 组测试路径，结果 **1403 / 1403 PASS**，
  失败 0、取消 0、跳过 0；日志 `/tmp/tg-paid-order-repurchase-full-regression-20261016.log`。
  此结果包含历史 promo 档案契约和 readiness 契约，并不替代人工运营验收。
- 北京时间 **2026-10-16 20:22:20**，本地 `/healthz` 和 `/tg` HTTP 200，
  当前 source SHA 与启动 SHA 均等于上述 HEAD，`sourceMode=working-tree`，工作区有未提交修改。
  所服务的 JS/CSS 均与磁盘 SHA-256 一致，缓存响应头为 `no-store`，新交互节点均存在。
  guest-shop 保留 `mode=upstream-checkout`、原上游 origin、真实待付款写入开启、`cancellationMode=local-rpc`。
  HTTP 验收记录 `/tmp/tg-paid-order-repurchase-preview-20261016.json`。
- 浏览器视觉和真实登录端到端验收：**NOT RUN**，沿用先前 URL 安全策略边界，未绕过。
  真实创建订单、付款、退款、补发、恢复原发货任务、worker 执行、SQL 和部署：**NOT RUN**。
  原已付款待复核订单仍需后台核对上游处理；本轮仅解决购买入口与查询界面的混用。
