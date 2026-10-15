# Grok 普通订阅购物车数量与报价兼容修正（2026-10-13）

## 故障与依据

任务 `di8ttdin` 使用 `grok_bundle_plus_monthly`，14:15:52 登录确认成功，14:15:56 单次选择 Plus 月付，14:16:16 在银行卡填写前报 `GROK_COMMERCE_UNCONFIRMED`。本次 `proxy=no`；失败截图显示官方结账已打开，Plus、Monthly subscription 与 Due today 均为 $8.00。卡密已按原任务日志回滚为未使用。

旧错误文本合并了会话、SKU、数量、周期与支付平台六项判断，未保存失败请求原始字段，因此不能仅凭该错误确定哪个字段命中。但只读核对官方公开脚本后确认了可稳定复现这一拦截的实现缺口：普通非席位订阅的 CheckoutProvider 使用 `[{skuId, interval}]`，不发送 quantity；只有 seats 分支才发送 quantity。RPC adapter 把该值原样传入 GetCartForSession 的 Selection。我们的 proto3 解码器将缺失 quantity 补为 0，旧校验无条件要求 quantity === 1，导致官方普通订阅被拒绝。

官方页面资产证据来自本轮实际浏览器列出的 URL（2026-10-13）：

- `https://cdn.grok.com/_next/static/chunks/2rxmswdzpuy5m.js`：CheckoutProvider 的 seats / 非 seats selections 分支；报价按 SKU、country、platform 和 interval 匹配。
- `https://cdn.grok.com/_next/static/chunks/10cb12a5u7l9x.js`：GetCartForSession 请求转换原样传递 quantity 与 recurrence；价格从 pricing.details.interval 转换。

另两处兼容缺口也一并修正：同一个 SKU 可返回月付和年付报价，旧校验仅按 SKU + Stripe 要求全局唯一；英文页面显示 `$8.00`，旧金额解析只允许 `US$` / `USD`。

## 修正与约束

- 解码器保留非枚举的字段存在性信息，同时保留 proto3 的默认值。只有 quantity 真正未传递，或明确为 1，才允许进入普通单 SKU 订阅校验。明确传递的 0、负数、2 或其他非法值仍被拦截；未知来源的普通对象中 quantity: 0 也被拦截。
- 报价按 SKU、US、Stripe 和本次选定周期匹配，排除 displayOnly 条目。目标周期存在多个有效候选仍报错；不能将年价替代月价或使用年付折算月价。
- 页面允许裸 `$` 作为金额显示形式，但必须先由关联的官方 SKU、购物车及最终税费确认 USD，且金额和周期完全一致。裸 `$` 本身不作为币种依据。金额解析匹配完整字符串，拒绝未知币种、错误千分位、额外文本和今日应付中的周期后缀。
- 会话关联、期限、单 SKU、团队/迁移拦截、首期与续费标准价、税费、标价上限、最终可见摘要及单次提交校验继续生效。
- 错误分别指出会话、SKU、数量、周期或支付平台问题，不输出会话 token、银行卡或地址信息。

## 验证

6 个文件、180 项测试通过：Commerce 60，原生流程 41，另含 Grok 历史流程、登录、支付重试及任务安全。夹具按官方行为调整为普通订阅省略 quantity、同 SKU 同时提供月付/年付报价、英文使用裸 `$`。回归覆盖 JSON / protobuf 缺失字段与显式非法数量、重复目标报价、Plus $8 月付以及资金校验错误场景。

浏览器流程测试请求全部由本地夹具响应，浏览器阻断外网；未用真实账户提交付款。脚本语法及 `git diff --check` 通过。本轮没有执行 SQL、生成或修改卡密，也没有进行账号合并或订阅迁移。

确认活跃任务为 0、旧服务无子进程、3100 监听属于本项目后，已重启本地服务，PID `83926` → `93294`。重启后 runtime 正常，首页、后台及共享套餐目录均为 HTTP200；目录内容与工作区一致。受限权限日志：`/tmp/kc-grok-commerce-fix-server-20261013.log`。
