# 游客商城浏览器状态矩阵验收记录（2026-09-20）

> 状态：**进行中，仅形成部分本地浏览器证据。** 本文记录 Codex in-app browser（IAB）加载真实商城前端代码、但由本地受控夹具拦截游客 API 后的观察结果。它不是支付沙箱报告，不是生产验收报告，也不构成游客商品启用许可。

## 1. 结论与证据边界

- 已确认：桌面 `configure` 的商品、金额、渠道、五按钮完整计算样式和初始焦点；积分弹窗到游客弹窗的交接不会留下第二个 active overlay。`Escape` 关闭后焦点返回可见商品的直接「购买」按钮。
- 已确认：`creating` 延迟窗口中的创建按钮会同步 `disabled=true` 与 `aria-busy=true`；快速双击只发送一条本地 `/orders` 请求。修复后的当前合同还要求 D「稍后处理」保持可用，但该瞬时浏览器断言尚未签署。
- 待闭合：其余状态的逐项按钮矩阵、自动轮询停止条件、多标签、回跳新标签、移动横竖屏、亮/暗主题、`sessionStorage` 不可用和隐私模式。
- 当前发现并已修复：最初真实 IAB 复测中，游客弹窗关闭后焦点落到 `body`。修复后在转场前保存外部目标，并在目标失效时按已保存商品 ID 回退到可见直接购买按钮；修复后的 IAB 复测通过。
- 本轮没有创建真实订单、没有付款、没有调用真实支付渠道、没有改数据库、没有改 Admin Studio 开关、没有部署。
- Task 2.1 当前总进度为 **20%（阶段 1/5 完成）**，下一阶段是默认关闭生产发布。本文的 `NOT RUN/INCOMPLETE` 会阻塞相应浏览器质量声明或相关扩展功能，不阻塞所有开关保持原状的阶段 2 发布；Task 2.0 的旧 48% 仅是历史快照。

### 1.1 结果标签

| 标签 | 含义 |
| --- | --- |
| `PASS-LOCAL` | 已在真实 IAB 中操作真实前端代码，但后端为本地确定性夹具；只证明浏览器层行为 |
| `PARTIAL` | 只完成部分观察，或存在尚未排除的布局/交互风险 |
| `NOT RUN` | 尚未执行，不能从自动化测试或代码推断为通过 |
| `ENV LIMIT` | 当前 IAB/自动化环境无法可靠模拟；必须换支持该能力的浏览器或真实设备 |
| `OUT OF SCOPE` | 受控夹具刻意不覆盖，必须由真实沙箱、数据库、worker 或生产门禁证据补齐 |

## 2. 环境与安全隔离

| 项目 | 本轮值 | 说明 |
| --- | --- | --- |
| 日期/时区 | 2026-09-20 / Asia/Shanghai | 本文只记录该轮证据 |
| 分支 | `codex/guest-shop-promo-l1l2` | 不是 `main`，不得据此发布生产 |
| 基线 commit | `85504ea5999e8b6f4b47cad6ef2548b34256a50f` | 工作区还有未提交修改，最终归档必须同时记录最终 diff/commit |
| 前端来源 | `http://127.0.0.1:8011` | 只作为静态商城前端的本地上游 |
| 验收入口 | 当前唯一受控入口 `http://127.0.0.1:8017/shop.html?guestScenario=<scenario>` | 本轮清理了旧的 `8014` 夹具进程；当前只保留一个监听 `8017` 的夹具实例。每个用例仍须先 reset audit，所有可写式浏览器交互只允许走受控入口 |
| 浏览器 | Codex in-app browser | 精确 Chromium 版本/UA 尚未归档 |
| 已观察桌面视口 | `1280x720` | 移动端与横屏另见 §6 |
| 夹具商品 A | `browser-fixture-product` / `browser-fixture-sku` | 商品 `¥0.01`，手续费 `¥0.01`，应付 `¥0.02` |
| 夹具商品 B | `browser-fixture-product-b` / `browser-fixture-sku-b` | 商品 `¥0.03`，手续费 `¥0.01`，应付 `¥0.04`；用于旧响应污染测试 |
| 资金/数据库 | 无 | 夹具不会创建真实订单，不连接支付渠道，不写业务数据库 |

### 2.1 夹具的安全合同

夹具脚本为 `scripts/guest-shop-browser-fixture-proxy.js`，其边界如下：

1. 从 `8011` 代理商城 HTML/CSS/JS，使验收对象仍是当前工作区真实前端代码。
2. 用匿名 Supabase stub 替代真实登录连接。
3. 同源拦截目录和全部 `/api/shop/guest/*` 请求，返回确定性状态快照。
4. 其他 `/api/*` 一律 fail-closed 为 `fixture_api_blocked`。
5. 二维码和支付页面只指向本机占位资源，不能付款。
6. `/fixture/audit` 只保留时间、方法、路径和场景，不应包含订单凭证、邮箱、密码、claim/recovery code、二维码原文或卡密。
7. `POST /fixture/audit/reset` 只清空该进程的内存审计记录，用于隔离浏览器用例；不转发、不写业务数据。

`http://127.0.0.1:8011/shop.html` 本身不是支付隔离入口。既有任务记录表明该 preview 可能加载 production-local 配置并使用共享 Supabase，因此不得在 `8011` 上点击真实「创建支付订单」来补本文证据。

### 2.2 2026-09-20 续测夹具 smoke 证据

- `8017` 当前只有一个监听实例；验收前已执行 `POST /fixture/audit/reset`，并在 intent 协议更新后重启夹具以避免旧进程继续提供旧响应格式。
- 本地 `creating` 夹具的 `POST /api/shop/guest/orders` 返回 `201`，端到端延迟约 `1.402s`；本地 `recovering` 夹具的 `POST /api/shop/guest/recover` 返回 `200`，端到端延迟约 `1.409s`。
- 当前脚本的只读 smoke 还验证了 `prepare → inspect → commit`：响应先设置 `fixture-gs-intent` HttpOnly cookie，后续两次请求携带同一夹具会话，去敏 audit 仅出现各一条 `prepare`、`inspect`、`commit`。
- 去敏 audit 没有真实 API、支付渠道或数据库请求。
- 这些是夹具/网络延迟证据，不能替代浏览器瞬时 DOM、焦点、`disabled`/`aria-busy` 或迟到响应隔离证据；对应浏览器项目仍保持 `NOT RUN`/`PARTIAL`。

### 2.3 intent 加固后代码证据（2026-09-20）

本轮服务端恢复凭证加固后重新运行了代码门禁：

- `node --test tests/guest-shop-*.test.js`：`511/511`；
- 客户端竞态 + 前端合同：`56/56`；
- checkout intent、状态恢复和主动查单：`59/59`；
- 订单访问、公开路由和 readiness：`83/83`；
- `node --check server/api-handlers/public/guest-shop.js`、`git diff --check`：通过。

这些读数只证明当前工作区的代码/合同层行为。它们不证明 Vercel rewrite 会转发 `Set-Cookie`，也不证明真实 HTTPS、多标签、移动横屏、回跳、隐私模式或支付渠道行为；下述矩阵仍以真实可见浏览器和去敏 audit 证据为准。

## 3. 五按钮记录口径

五个动作统一缩写如下：

| 缩写 | DOM | 预期动作 |
| --- | --- | --- |
| D | `#guestCashPurchaseDismissBtn` | 稍后处理；只离开当前页面，不取消服务端订单 |
| C | `#guestCashCreateOrderBtn` | 创建支付订单；未知创建结果时可变为「确认原订单结果」 |
| Q | `#guestCashCheckStatusBtn` | 查询支付状态；终态/人工处理态可变为「刷新处理状态」 |
| A | `#guestCashAbandonOrderBtn` | 离开当前订单；不宣称取消或释放库存 |
| R | 页脚 `#guestCashShowRecoveryBtn`；展开后的提交按钮 `#guestCashRecoverBtn` | 前者展开找回面板，后者提交订单号与取货口令 |

每格最终必须记录：`hidden`、计算后的 `display`、`disabled`、`aria-busy`、可见文案、是否可通过 Tab 聚焦。仅看到按钮或仅检查 DOM `hidden` 均不足以签署。

## 4. 浏览器状态矩阵

### 4.1 汇总

| 场景/状态 | D | C | Q | A | R | 自动轮询 | 本轮结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `configure` | 可见 | 可见 | 隐藏 | 隐藏 | 可见 | 否 | `PASS-LOCAL` |
| `creating` | 可见、应可用（未签署） | 可见、busy | 隐藏 | 隐藏 | 可见但 disabled | 否 | `PARTIAL`（双击单飞已证；D 瞬时可用性待 IAB 复测） |
| `awaiting_payment` | 可见 | 隐藏 | 可见 | 可见 | 可见 | 待归档 | `PARTIAL`（视觉与语义通过；计算样式/ARIA/轮询待补） |
| `checking` | 可见 | 隐藏 | 可见、busy | 隐藏 | 可见 | 是 | `PASS-LOCAL`（自动与人工查询单飞） |
| `recovering` | 待测 | 待测 | 待测 | 待测 | 待测 busy | 否 | `NOT RUN` |
| `review/payment_creation_unknown` | 待测 | 待测 | 待测 | 待测 | 待测 | 否/按人工策略 | `NOT RUN` |
| `confirmed + pending/fulfilling` | 待测 | 待测 | 待测 | 待测 | 待测 | 是 | `NOT RUN` |
| `paid_unfulfillable` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `dead_letter` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `delivered` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `expired` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `failed` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `refunded` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `chargeback` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `amount_mismatch` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `overpaid` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |
| `partial` | 待测 | 待测 | 待测 | 待测 | 待测 | 否 | `NOT RUN` |

### 4.2 已确认：`configure`

入口：`/shop.html?guestScenario=configure`，桌面视口 `1280x720`。

| 检查项 | 观察值 | 结果 |
| --- | --- | --- |
| 弹窗 | 从商品 A 的「立即购买」进入游客购买弹窗 | `PASS-LOCAL` |
| 商品/规格 | 显示夹具商品 A 及其规格，不是生产商品 | `PASS-LOCAL` |
| 价格 | 商品 `¥0.01`、手续费 `¥0.01`、应付 `¥0.02` | `PASS-LOCAL` |
| 支付方式 | 支付宝与 USDT 选项存在 | `PASS-LOCAL` |
| D | 「稍后处理」可见 | `PASS-LOCAL` |
| C | 「创建支付订单」可见 | `PASS-LOCAL` |
| Q | DOM 隐藏，计算样式 `display: none` | `PASS-LOCAL` |
| A | DOM 隐藏，计算样式 `display: none` | `PASS-LOCAL` |
| R | 「找回订单」可见 | `PASS-LOCAL` |
| 初始焦点 | `#guestCashPurchaseCloseBtn` | `PASS-LOCAL` |
| 按钮完整字段 | D/C/页脚 R 计算 `display:flex`、未 disabled、`aria-busy=false`；Q/A 为 `hidden + display:none` | `PASS-LOCAL` |
| 弹窗交接 | 游客层 `active`；积分层 `hidden` 且无 `active` | `PASS-LOCAL` |
| Escape 焦点回退 | 修复后落在可见的 `.list-buy` 直接购买按钮，不是 `body` 或隐藏的 `#nextPurchaseStepBtn` | `PASS-LOCAL` |
| 底部操作区首屏可发现性 | `1280x720` 下 dock 位于约 `y=558..675`；dialog 为滚动主体（`scrollHeight=1414`，`clientHeight=678`） | `PASS-LOCAL` |

### 4.3 `creating`（历史观察与当前合同分离）

入口：`/shop.html?guestScenario=creating`，独立 `8015` 夹具标签；在订单 POST 的 1.4 秒延迟窗口内快速双击 C。

| 检查项 | 观察值 | 结果 |
| --- | --- | --- |
| C | 可见，`display:flex`、`disabled=true`、`aria-busy=true`，文案进入处理中状态 | `PASS-LOCAL` |
| D、页脚 R | 修复前标签观察到均 disabled；当前代码合同为 D `disabled=false`、R `disabled=true`，Q/A 为 `hidden + display:none` | `PARTIAL` |
| 单飞 | 夹具 audit 的本场景 `/api/shop/guest/orders` 仅 1 条 | `PASS-LOCAL` |
| 关闭策略 | D 被禁用，但 Escape/backdrop 与 D 的策略尚未统一验收 | `PARTIAL` |

> **续测校正（2026-09-20）**：上述 `8015` 记录来自在途关闭策略修复前的旧标签。当前代码合同已改为创建请求在途时 D 保持 `disabled=false`，并依靠 view/action generation 丢弃迟到响应；由于本轮 IAB 未能稳定截取 1.4 秒瞬时窗口，当前版本仍不能把该项签署为 `PASS-LOCAL`。旧标签中的 D disabled 结论仅保留为历史观察，不应作为现行行为依据。

### 4.4 已观察：`awaiting_payment`

该场景必须在 `guestScenario=awaiting_payment` 下通过夹具创建，且只能看到本机 `LOCAL FIXTURE` 二维码。最终记录不得包含真实支付地址或二维码原文。

| 检查项 | 观察值 | 当前结果 |
| --- | --- | --- |
| 状态语义 | 已显示合成订单号和等待付款上下文；未声称支付成功 | `PASS-LOCAL` |
| 订单上下文 | 合成订单 `GS-BROWSER-FIXTURE-0001`，应付 `¥0.02` | `PASS-LOCAL` |
| D | 「稍后处理」可见 | `PARTIAL`（disabled/ARIA/Tab 待补） |
| C | 隐藏 | `PARTIAL`（计算 `display` 待补） |
| Q | 「查询支付状态」可见 | `PARTIAL`（disabled/ARIA/Tab 待补） |
| A | 「离开当前订单」可见；提示明确不取消服务端订单、不立即释放库存 | `PARTIAL`（disabled/ARIA/Tab 待补） |
| R | 「找回订单」可见 | `PARTIAL`（disabled/ARIA/Tab 待补） |
| 二维码 | 显示本机 `LOCAL FIXTURE` 占位 QR，没有访问真实 provider | `PASS-LOCAL` |
| 倒计时 | 尚未单独归档读数与到期行为 | `NOT RUN` |
| 自动轮询 | 尚未记录 `/fixture/audit` 中 status 请求次数与停止条件 | `NOT RUN` |
| 视口 | 操作区需滚动才可见的风险已在 `1280x720` 观察到 | `PARTIAL` |

该轮可见检查没有生成可持久化的截图文件路径，不能在后续报告中写成“截图已归档”。夹具进程重启后内存态 `/fixture/audit` 也会清空；因此上述 `awaiting_payment` 只能作为视觉/语义证据，轮询与请求次数必须在续测端口重新采集。

### 4.5 已确认：`checking`

入口：独立 `8016` 夹具标签。在先完成一次创建及其自动首查后，快速双击 Q；夹具将每次 `/status` 延迟 1.4 秒，标签在第二次请求仍在途时立即关闭。

| 检查项 | 观察值 | 结果 |
| --- | --- | --- |
| Q | 可见，`display:flex`、`disabled=true`、`aria-busy=true`，文案为「查询中...」 | `PASS-LOCAL` |
| D、页脚 R | 均可见可用；C/A 为 `hidden + display:none` | `PASS-LOCAL` |
| 订单语义 | 合成订单仍为待支付，checkout 面板保持显示，未被 `checking` 瞬态错误覆盖 | `PASS-LOCAL` |
| 单飞 | audit 中仅有首个自动 `/status` 和一条双击人工查单，共 2 条；没有第二条人工并发请求 | `PASS-LOCAL` |
| 状态标签 | `checking` 是请求在途 UI，不是夹具可持久化后端状态；页面稳定状态仍为待支付 | `PASS-LOCAL`（按正确口径） |

## 5. 异步与多标签矩阵

| 用例 | 验收方法 | 通过条件 | 当前结果 |
| --- | --- | --- | --- |
| 双击创建 | `creating` 延迟约 1.4 秒，快速双击 C | 仅 1 次 `/orders`；同一幂等尝试；C disabled + `aria-busy=true` | `PASS-LOCAL`（夹具只审计路径，不能读取幂等键） |
| 查询单飞 | `checking` 延迟约 1.4 秒，快速连点 Q | 同时最多 1 次 `/status`；Q disabled + `aria-busy=true` | `PASS-LOCAL`（首查 + 双击人工查单共 2 条） |
| 找回单飞 | `recovering` 延迟约 1.4 秒，连点 R 并尝试 C | 仅 1 次 `/recover`；不得并发创建 | `NOT RUN` |
| 切商品旧响应隔离 | A 的 preview/status 在途时切到商品 B | 迟到 A 响应不得覆盖 B 的名称、SKU、`¥0.04` 或渠道 | `NOT RUN` |
| 关闭弹窗后的迟到响应 | create/recover 在途时点 D/Escape | 弹窗保持关闭；迟到响应不得重开或污染新上下文；安全订单句柄策略符合合同 | `NOT RUN` |
| 同订单双标签 | 两个 IAB 标签打开同一夹具订单 | 不双发、不双 claim、不互相清除新句柄；请求数可审计 | `NOT RUN` |
| 回跳新标签 | 新标签打开安全 return URL | 回跳不等于支付成功；无敏感参数；先查服务端状态 | `NOT RUN` |
| `sessionStorage` 不可用 | 禁用/抛出 storage 访问 | 页面可降级且给出恢复提示，不白屏、不泄露凭证 | `NOT RUN` |
| 隐私模式 | 支持隔离会话的真实浏览器复核 | 行为与降级说明一致 | `ENV LIMIT`（IAB 是否等价支持尚未确认） |

多标签结论不能只依据单页自动化测试。最终证据至少要包含两个可见标签、各自 URL/商品上下文、操作时间线和 `/fixture/audit` 的去敏请求计数。

## 6. 键盘、移动端与主题

| 环境/动作 | 检查点 | 当前结果 |
| --- | --- | --- |
| 桌面键盘 | 打开后焦点进入首个可用控件 | `PASS-LOCAL`（关闭按钮） |
| 桌面键盘 | Tab/Shift+Tab 在弹窗内循环，隐藏按钮不可聚焦 | `NOT RUN` |
| 桌面键盘 | Escape 关闭；焦点回到触发「立即购买」的按钮 | `PASS-LOCAL`（直接 `.list-buy` 按钮） |
| 读屏语义 | dialog 名称、`aria-describedby`、状态 `aria-live`、busy 变化 | `NOT RUN` |
| 移动竖屏 `390x844` | 弹窗不横向溢出；按钮文字不截断；热区可用；内容可滚动；隐藏 Q/A 与支付/发货面板不进入 Tab | `PASS-LOCAL`（真实 IAB + 本地夹具；未创建订单） |
| 移动横屏 `844x390` | 标题/状态/底部动作不互相遮挡；操作区可达 | `NOT RUN` |
| 桌面亮色 | 文案、边框、disabled、focus ring 和 QR 对比度 | `NOT RUN` |
| 桌面暗色 | 文案、边框、disabled、focus ring 和 QR 对比度 | `NOT RUN` |
| 移动支付交接 | 不访问真实 scheme/provider；只核对本地按钮与布局 | `OUT OF SCOPE`（真实交接需另做沙箱/设备证据） |

完成移动验收后必须把 IAB viewport 恢复到原桌面尺寸，避免后续证据误用移动布局。

## 7. 当前风险与修复优先级

| 优先级 | 风险 | 处理要求 |
| --- | --- | --- |
| P1 UX | 窄屏/横屏仍未验；桌面 `1280x720` 的底部操作区已能首屏发现 | 保持 constrained sticky dock；必须继续验证窄屏/横屏不遮挡正文 |
| P1 证据 | `awaiting_payment` 仅有视觉/语义结果，计算样式、ARIA、焦点和轮询仍未归档；终态矩阵未验 | 按 §4 的固定字段采集，不以截图肉眼印象代替 computed style/ARIA/轮询计数 |
| P1 竞态 | 双标签、切 SKU 和迟到响应尚无真实浏览器证据 | 使用夹具商品 A/B 与延迟场景复现；用 `/fixture/audit` 核对请求数量 |
| P1 恢复 | `sessionStorage` 不可用、隐私模式和回跳新标签未验 | IAB 能力不足时换普通 Chromium/真实手机，不得写成 PASS |
| P1 intent | 无订单 intent 在 commit 窗口内会暂时阻止换 SKU | 保持 fail-closed；后续仅在有原子“确认无订单”证据后评估受限 abort，不得用清 cookie 绕过 |
| P2 可访问性 | 自动化已有焦点合同，但真实键盘和读屏未签署 | 完成键盘闭环；读屏至少用平台辅助技术复核 dialog 名称和 live 状态 |

## 8. 本文不能替代的证据

以下是后续分层证据目录，不是默认关闭发布的一揽子前置。只对实际启用的站点、provider、SKU 和功能适用；INTL、优惠、多件或凭证保持关闭时，其专项证据不阻塞 CN 原价单件基础 SKU：

- 所选站点/provider 的创建、支付、查单、回调、断网同键恢复、金额异常、迟到付款与退款证据；INTL 只在启用 INTL 时要求。
- 数据库订单、支付意图、预占、库存扣减/释放和幂等事件计数；优惠额度只在开启促销时要求。
- KVM4 guest-shop worker 的 timer/journal、履约、dead-letter、补发与退款处理。
- `GUEST_SHOP_BUYER_CREDENTIAL_ENABLED`、`GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED`、preview、静态查询页、API、readiness 与 Admin Studio 的一致性；只要求实际使用组合，不为关闭的功能伪造 ON 证据。
- Vercel production、KVM4 Verify Server、KVM4 Sub2API、KVM4 guest-shop worker 四条发布链路。
- 精确生产白名单 SKU、operator review 和用户按任务 2.1 §61.9.2 作出的明确启用签署。

本文也不得拿既有未支付生产订单补夹具状态，更不得再次创建或支付该订单。生产订单号、claim token、取货口令、二维码、支付地址和卡密都不应写入本文。

## 9. 收口清单

### 9.1 2026-09-20 阶段启动记录

- 自动化门禁：`node --test tests/guest-shop-*.test.js` 实际收集 `512` 项，`512/512 PASS`，退出码 `0`；此前 `511/511` 仍保留为上一轮历史基线。
- 受控夹具：`http://127.0.0.1:8017/shop.html?guestScenario=configure` 已启动并可打开；`POST /fixture/audit/reset` 已执行，审计初始为空。
- 本轮边界：尚未完成完整状态矩阵的逐项 DOM/ARIA/焦点断言；夹具可用不等于矩阵通过。真实生产、支付、订单、数据库、worker 和开关验收均为 `OUT OF SCOPE`。
- 阶段状态：`Task 2.1=20%`、`阶段 1=complete`、`阶段 2=默认关闭生产发布 in_progress`；自动化为 `PASS-LOCAL`，完整真实浏览器矩阵仍为 `NOT RUN/INCOMPLETE`，作为分层 backlog 保留。

- [ ] 补齐 §4 全部状态的五按钮字段、真实文案、焦点和轮询结果。
- [ ] 补齐 `creating/checking/recovering` 三种延迟态的 `disabled` 和 `aria-busy`。
- [ ] 完成商品 A→B 的旧响应隔离和同订单双标签时间线。
- [ ] 完成新标签回跳与敏感 URL 参数检查。
- [ ] 完成桌面键盘、读屏、亮/暗主题。
- [x] 完成 `390x844` 竖屏；`844x390` 横屏仍待测，并恢复桌面 viewport。
- [ ] 在支持的环境完成 `sessionStorage` 不可用和隐私模式；否则保持 `ENV LIMIT` 并登记补测设备。
- [ ] 归档无敏感信息的截图路径和 `/fixture/audit` 摘要。
- [ ] 运行相关自动化测试与 `git diff --check`，但不得用其替代以上浏览器证据。
- [ ] 不把未执行项写成 PASS；默认关闭发布按 §61.9.1 独立推进，指定 SKU 启用只按 §61.9.2 的直接安全门，剩余矩阵阻塞其对应能力或完整质量声明。
