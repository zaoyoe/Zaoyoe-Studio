# Grok 地址联想弹层遮挡州选择器（2026-10-13）

## 证据

任务 `jlew43im` 已完成真实登录、Plus 月付 USD 8 购物车校验、Stripe 卡字段和街道/城市/邮编填写。20:28:48 的失败步骤明确为 `billing.state`、timeout、`submitted=false`，最终 `PAYMENT_STATE:not_started`。银行卡已安全释放，CDK 已回滚。

录像总长约 13.72 秒：第 10 秒可见已经展开的手动地址字段及填写后的城市、邮编；第 11 秒起街道联想建议覆盖了地址行 2、城市、州和邮编所在区域，持续到结束。失败截图中的下拉建议含 `Enter address manually`。因此页面仍然停留在 `/plans`，但州控件被建议弹层挡住。它不是之前 Escape 导致退出结账的故障，也没有本次代理连接失败证据。

缓存官方 AddressTypeahead 组件表明：输入后异步查询建议，支持一个专用的 `Enter address manually` 选项；该选项调用 `onManualEntry`，并不猜选地址建议。只调用输入框 blur 可以展开详细字段，但未保证异步建议结果之后不会再次打开弹层。

新增离线复现先在旧代码上运行，准确重现 `billing.state` / timeout / plans / submitted=false，测试失败。修复后的同一场景通过。

## 修复

- 州操作前检查与唯一街道输入框关联的可见建议列表；优先以 `aria-controls` / `aria-owns` 关联 portal。旧控件没有关联属性时只识别唯一列表中的精确“手动输入地址”选项。
- 只点击官方手动输入入口，要求选项唯一、弹层随后关闭、街道内容未发生改变。缺失、歧义、没有关闭或地址改变时停止，禁止猜选联想地址。
- 异步建议在州点击等待期间才弹出时，仅对这一明确遮挡恢复一次。没有检测到建议弹层的普通超时继续停止。
- 不使用 Escape、force click、隐藏/删除 DOM，也不直接修改国家或州的隐藏 input。州仍通过可见官方选择器选中，并严格读回 OR；账单、金额、购物车、税费、条款和单次支付保护保留。
- 在账单填写结束时再次检查剩余联想弹层。后台只记录固定诊断信息；充值用户错误仍使用公共文案边界。

## 验证范围

新增 8 个浏览器场景，覆盖遮挡、迟到弹层、关联 portal 的中英文手动入口、入口缺失/重复、点击后弹层不关闭、街道改变。成功场景精确读取 OR 和完整税费请求，支付仅提交一次；不确定场景没有 EstimateTax 或 Acquire 请求，也没有 Escape 或猜选地址建议。

所有测试使用离线 Chromium fixtures、合成卡及地址、模拟官方 RPC。没有真实付款、订阅变更、SQL 或生产部署。实际官网下一次充值是否走完整流程仍需后续任务结果确认。

9 个测试文件、342 项检查通过，涵盖 Grok 原生流程、Commerce 购物车与税费关联、付款重试安全、任务资金保护、Claude 与 GPT 信用卡方式回归、公共错误边界及俄勒冈地址策略。两个修改的驱动文件语法检查通过。

确认活跃任务为 0、3100 唯一监听属于本项目且没有自动化子进程后，SIGTERM 正常关闭旧服务，PID 57258 → 62891。重启后 `/`、`/admin`、`/api/public/runtime`、`/grok-plan-catalog.js`、`/task-messages.js` 均返回 200，活动任务为 0；启动日志权限为 0600。

## 后续复盘与二次修复（任务 rv2xliqq）

任务 `rv2xliqq` 执行时报错 `step=billing.state, code=GROK_ENTRY_AMBIGUOUS, reason=guard`（错误信息：`账单 state 无法唯一确认，尚未提交支付`）。

### 根因
1. **时序颠倒**：`selectCustom` 中原先在获取触发器 `uniqueVisible` **之后**才调用 `closeAddressSuggestions`；当联想弹层覆盖或触发器未就绪时，`uniqueVisible` 率先抛出 `GROK_ENTRY_AMBIGUOUS`，导致 `closeAddressSuggestions` 根本没有执行机会。
2. **手动按钮与容器兼容性**：Google Places / Base UI 弹层底部的“Enter address manually”可能渲染为标准 `<button>` 或带文本的容器节点，且容器不仅限于 `[role="listbox"]`（还包括 `.pac-container` 及 autocomplete 相关 slot）。原先仅依赖 `getByRole('option')` 易导致漏判。
3. **触发器查找缺乏稳定等待**：`uniqueVisible` 为即时单次断言；在弹层关闭后 DOM 状态重新稳定期间，缺乏合理轮询。

### 修复措施
1. 将 `closeAddressSuggestions` 提前至查找 state trigger **之前**执行，确保遮挡先被清理、手动模式先被确立。
2. 扩充 `findManualAddressActions`，兼容 `role="option"`、`role="button"`、标准 `<button>` 以及包含文案的目标节点；支持 `.pac-container` 等多种补全容器。
3. 增加 `getSelectTrigger` 轮询等待（最长 3000ms），支持 `[data-slot="xds-select-trigger"]` 唯一性回退，超时后再执行安全断言。
4. 全套 30 个测试文件、841 项契约测试全部通过（包含 `grok-native-flow.test.js` 88 项）。
5. 优雅重启 Node 服务，PID 75814 → 81994，端口 3100 就绪，活动任务为 0。
