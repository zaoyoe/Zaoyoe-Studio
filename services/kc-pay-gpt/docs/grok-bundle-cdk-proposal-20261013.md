# Grok 新组合订阅与 CDK 调整实施记录（2026-10-13）

## 核验结论

**不能将旧 Lite/SuperGrok/Plus/Heavy 与新 Plus/Premium/Super/Ultra 当成同一商品直接改名。** 官方脚本存在等级显示名映射，但官方文档明确新产品是 The X Subscription：组合 Grok、Cursor、X，Grok 与 Cursor 共用每周包含用量。旧计划继续，切换可选。切换时选中的旧订阅取消、剩余时间按比例退款，并开始新账期。账号统一不可撤销，客服也不能撤销。

来源已在官网实际读取：

- [官方概览](https://docs.x.ai/x-subscription/overview)，更新日期 2026-10-12，尤其 `What happens when you switch` 和 `What happens to your old plans`。
- [官方价格](https://docs.x.ai/x-subscription/pricing)，更新日期 2026-10-11，尤其 `Existing plans` 和 `When you switch`。
- [组合订阅条款](https://x.ai/legal/bundled-subscription-terms?us=unified)，更新日期 2026-10-07。

在明确新旧商品并不等价后，用户以“开始调整”授权实施下列独立商品目录与新版履约分支。代码和隔离回归测试已完成，真实扣款、账号统一及旧订阅迁移未执行。

## 已新增的独立 CDK 类型

以下为美国 USD 的官方未税标价，不是 CDK 零售定价，也不是保证所有账号都能购买的价格。现有平台标识可继续为 `grok`，商品族单独标记为 `x_subscription`，避免登录平台和商品名称混淆。使用全新的 `plan_type`，明确周期，不沿用任何旧键。

| 新商品 | 月付 CDK 类型 | 月付标价 | 年付 CDK 类型 | 年付标价 |
| --- | --- | --- | --- | --- |
| The X Subscription Plus | `grok_bundle_plus_monthly` | USD 8/月 | `grok_bundle_plus_annual` | USD 80/年 |
| The X Subscription Premium | `grok_bundle_premium_monthly` | USD 30/月 | `grok_bundle_premium_annual` | USD 300/年 |
| The X Subscription Super | `grok_bundle_super_monthly` | USD 100/月 | `grok_bundle_super_annual` | USD 1000/年 |
| The X Subscription Ultra | `grok_bundle_ultra_monthly` | USD 200/月 | `grok_bundle_ultra_annual` | USD 2000/年 |

Free 不需要充值 CDK。团队席位和用量充值属于另一种购买目标，不混入这八个个人订阅类型。年付必须核验年度总额，不把官方展示的折算月价当作今日应付。

本次 `/plans` 页面曾展示 Premium/Super/Ultra 首期 15/50/100 的月付优惠，随后为 30/100/200。不得把一次实查优惠固化为 CDK 商品价格；每次购买分别核验首期、续费、币种、周期、税费与官方购物车。

## 已实施的旧类型处理

1. 从 CDK 新建和导入选项中移除旧 SuperGrok 四档及其别名；后端同样拒绝新建旧类型，不能只隐藏前端选项。
2. 对于目标为仅提供新版目录的系统，同步停止新建旧 X Premium/Premium+ 类型。
3. 保留旧类型的历史名称、筛选与记录解析。现有卡密的 `plan_type`、金额含义、使用状态与资产均不批量转换、不删除。旧 CDK 自动充值入口已停止，提示联系客服且卡密未使用；不能自动兑换新组合订阅，由商家按原承诺处理或另行确认换发。
4. `grok_plus` 当前代表旧 SuperGrok Plus，系统配置为 USD 100；`grok_premium` 当前代表旧 X Premium，系统配置为 USD 8。不得将它们复用为新版 Plus USD 8 或 Premium USD 30。
5. 未知类型、套餐与平台不一致时明确拒绝；已移除存储层与自动化入口静默回退 ChatGPT Plus 的路径。套餐验证在生成、导入、激活与执行入口统一进行，激活验证先于资产锁定与任务创建。

## 实施范围与资金核验

`public/grok-plan-catalog.js` 提供前后端共用的八种新商品与历史标签；`cdk-plan-catalog.js` 提供统一的套餐验证。`region-config.js`、`mysql-store.js`、`server.js`、后台生成/导入目录及前后台展示均已接入。

新版分支由 `grok-native-checkout.js`、`grok-native-billing.js`、`grok-native-payment.js` 实现。新商品从 `/plans` 选择官方动态 SKU，在原地 Commerce 弹窗完成周期、动态账单地址和税费核验；旧 hosted Stripe 辅助分支保留独立含义，不用于履约新商品。实际页面依据见 [实查报告](grok-commerce-audit-20261013.md)。

`grok-commerce.js` 在导航前开始只读观察官方页面请求，按会话、SKU、购物车版本、税费、purchaseId 关联。`grok-commerce-wire.js` 对 JSON、protobuf 与 grpc-web 做有界解码，不主动调用官方私有 RPC。

付款前分别确认产品族、档位、周期、USD 标准价、优惠资格与续费金额、完整年度总额、官方地址与税费、可见订单摘要及购物车有效期。初始未计算税费的购物车仅可作为预览；提交必须取得匹配当前购物车与地址的官方税费结果。出现账号合并、旧订阅迁移、团队席位、改订或需要优惠审核时停止。

只操作受信 Stripe 银行卡 iframe，读回官方账单字段，再核验最新订单。官方页面只提交一次：明确且关联本次购买的拒付才可进入既有换卡策略；结果未知时保留待核对资产，转人工复核，不能依据泛化页面文字核销或再次付款。

本轮适配及账单隔离测试以美国 USD、Oregon 地址为依据；其他地区或官方结构变动不能通过时明确停止。`plan_type` 已为 VARCHAR(64)，无需数据库迁移。本次没有执行 SQL、生成卡密、真实提交付款、修改已有订阅或数据批量转换。

## 验证与维护

聚焦回归共 **197 项通过，10 个测试文件**，覆盖 Commerce 契约与关联、八种新套餐的离线完整流程、历史 Grok/Claude 支付、卡字段定位、支付重试和任务安全、人机验证翻译及内容就绪。新版完整流程测试使用隔离浏览器，所有请求由本地夹具响应并阻断外网。语法检查通过：15 个相关 JavaScript 文件及三个 HTML 页面中的 5 个内联脚本。

重点覆盖月付/年付、首期优惠与续费、动态地址、税费、单次提交、错误金额/迁移/优惠审核/伪造 Stripe 主机拦截、页面金额异步变化、明确拒付与未知结果分离。真实支付和真实订阅成功未验证，不能将隔离测试通过视为真实扣款成功。

`grok-commerce-schema.json` 来自本机已保存的官方公开脚本。维护时可离线重建并对比：

```sh
python3 scripts/extract-grok-commerce-schema.py /tmp/kc-grok-assets --output /tmp/kc-grok-schema-recheck.json
cmp grok-commerce-schema.json /tmp/kc-grok-schema-recheck.json
```

本次重建得到 55 个消息、11 个枚举、7 个方法，与保存的 schema 完全一致。更新公开描述符后应审查变更并重新运行资金流程测试。

在确认活跃任务为 0、服务没有自动化子进程、3100 监听属于本项目后，本地服务已重启，PID `57172` → `78783`。重启后运行状态接口正常，首页、后台页面与共享目录脚本均为 HTTP200，内容与工作区文件一致。受限权限日志保存在 `/tmp/kc-grok-restart-20261013.log`。已打开的前后台页面需要刷新后使用新目录；本次不涉及生产部署。

首次真实运行暴露的英文周期组、中文年度选项及年度摘要结构遗漏已另行修正，详见 [后续修正记录](grok-native-period-fix-20261013.md)；该轮聚焦测试 161 项通过，服务再次重启为 PID `83926`。
