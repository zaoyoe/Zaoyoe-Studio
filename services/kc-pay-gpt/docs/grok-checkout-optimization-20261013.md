# Grok 充值流程优化（2026-10-13）

> 本文记录已实现的旧版 Stripe hosted 分支。2026-10-13 登录官网实查发现新版统一 Commerce 页面使用 Plus/Premium/Super/Ultra，并在 `/plans` 内嵌入支付表单；下文的旧卡片与 hosted Stripe 规则不能覆盖此分支。实际组件、请求链路、缺口与适配顺序见 [Grok Commerce 实查](grok-commerce-audit-20261013.md)。此前测试通过不代表新版流程已适配。

原流程从首页寻找泛化的 Upgrade / Subscribe 按钮，再等待 Stripe 页面。此前任务 `0e18s51a`、`ss17v116` 未观察到创建 Checkout 的请求；首页广告中的按钮不能证明已进入订阅链路，也不能据此认定代理异常。

## 已实现的旧版 Stripe hosted 流程

1. 注入登录 Cookie 后直接进入官方 `https://grok.com/plans`；X Premium 使用 `https://x.com/settings/premium`。账号资料 JSON 仅能用于预览，不能作为登录凭据。Grok 使用真实 `/api/auth/session` 独立确认账号，并核对输入中的账号信息。
2. 在官方套餐页关闭 `Save with annual` 年付开关，定位目标套餐卡片的准确入口，单次点击。兼容入口限定在唯一的目标套餐范围内，多个匹配或未找到入口时停止。
3. 监听当前页面、本次点击后的官方 `/rest/subscriptions/subscribe/new` 请求，检查已观察到的周期与套餐类型；跟随响应 `data.url`，或接管本次产生的官方 Checkout 页面。支付链接必须为可信 Stripe Checkout 地址，旧响应、旧弹窗及其他页面请求不能建立本次会话。
4. 填卡前确认目标套餐和月付基础价格。先填写账单国家，再重新识别动态重建的地址字段；提交前读回账号、表单、套餐、币种和最终应付金额。
5. 单次提交支付，观察当前 Checkout 会话的官方结果。人工人机验证仍由用户完成。只有明确拒付才允许换卡；超时、页面关闭、验证未完成或模糊购买失败均保留为结果未知，暂停自动重试，并保留卡密与银行卡供人工复核。
6. 整个任务只在尚未提交支付的明确网络、导航失败时重试。身份、套餐、金额或入口无法确认时停止。

账号预览会按域名、路径和有效期过滤 Cookie，只向 grok.com 发送适用于 `/api/auth/session` 的 Cookie，并禁止自动跟随重定向。前后端均拒绝仅含设备 Cookie、外站认证 Cookie、短登录值、无凭据 cURL 及账号资料 JSON 的输入。

## 旧版官方页面依据与边界

依据本机保存的官方 `/plans` 前端资源，套餐标识如下：

| 套餐 | 官方卡片 / CTA 后缀 | 官方请求类型 |
| --- | --- | --- |
| SuperGrok | `supergrok` | `REQUESTED_TIER_GROK_PRO` |
| Lite | `supergrok-lite` | `REQUESTED_TIER_SUPER_GROK_LITE` |
| Plus | `supergrok-plus` | `REQUESTED_TIER_SUPER_GROK_PLUS` |
| Heavy | `supergrok-heavy` | `REQUESTED_TIER_SUPER_GROK_PRO` |

旧版卡片分别使用 `plan-card-*`、`plan-cta-*`，新版 Commerce 实际卡片没有这些标识。旧版官方 `subscribeViaStripe` 使用服务端返回的 `url` 导航，因此不能使用固定支付链接，也没有凭空拼接官方请求体或价格 ID。仅返回嵌入式 clientSecret 的流程暂不支持，会安全停止；新版 Commerce 整条链路仍待适配。

共享的 Stripe 字段识别与人工验证组件继续使用，Grok 的入口、套餐核验、账单填写和支付结果观察已使用独立逻辑。真实 hosted Stripe 的展示文案与 X Premium 界面未做线上支付验证；官方结构变更可能触发安全停止，需要按日志更新识别规则。

## 验证

测试使用本地模拟官方页面和响应，浏览器请求被拦截，不加载 `.env`，不执行真实支付或直接操作数据库。覆盖直接导航、月付切换、官方响应与新弹窗、排除旧会话、账号核验、金额拦截、账单字段重建、单次提交、结果未知的资产保留，以及前后端凭据校验一致性。相关 JavaScript 和前端内嵌脚本同时执行语法检查。

最终验证：8 个测试文件、128 项测试全部通过；10 个 JavaScript 文件及前端 2 段内嵌脚本语法检查通过。本地服务已重启，3100 端口、更新后的首页、运行状态接口及两类无效凭据拒绝检查通过。没有触发充值任务。

减少的是首页按钮探测和盲等 Checkout 的等待；没有实际充值耗时对比，不宣称已经测得提速比例。用户故意延长的人机验证和测试卡拒付时间不计入速度评估。
