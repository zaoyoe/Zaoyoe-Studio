# KC 自动充值与 TG 独立购买：2026-11-07 本地安全加固记录

本轮完成本地代码修改与离线/mock 回归，专门覆盖 KC 自动充值服务与 TG 独立购买服务。**未提交、未推送、未创建 PR、未合并、未部署、未执行 SQL、未创建真实订单、未启动生产 worker；未读取真实 .env 文件。**

最终结果：KC 安全相关集中回归 204 PASS；KC 全量 1542 PASS / 4 FAIL / 1 SKIP；TG 全量 1117 PASS / 0 FAIL。KC 全量尚未全绿，生产生效状态为 NOT RUN。本记录不是发布批准，也不代表两个业务已经完成全面渗透测试。

## 1. 基线、备份与并行工作

- 工作目录：`/Volumes/chao/AI/xianyu_profit_calculator`。
- 分支：`main`，本轮没有创建提交或切换分支；当前工作区包含多项未提交工作，不是干净发布候选。
- 唯一 origin：`https://github.com/zaoyoe/Zaoyoe-Studio.git`。
- 本轮基准 HEAD：`75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`。
- 再次执行 `git fetch origin main` 后，`HEAD..origin/main` 的提交数为 0，origin/main 与该 SHA 相同。
- 修改前的恢复备份：`/Volumes/chao/AI/.security-backups/kc-tg-20261107-215227`。保留原始 `working-files.tar.gz`、`index`、`staged.patch`、`unstaged.patch`、`status.txt`、`head.txt` 和 `manifest.json`。
- 已逐项从原始归档读回并核对 199 个文件的 SHA256：全部匹配；当前工作区未发现这些原有路径被删除。
- 本轮最终日志、文件快照与哈希另外存入该备份目录下的 `final-local-evidence`，不覆盖原始备份。

与原始备份相比，本轮归属清单以外另有 14 个文件发生并行变化：

```text
admin-studio.html
admin-studio.js
css/auth-sheet.css
css/framer_home.css
css/framer_home_critical.css
css/homepage-overlays.css
css/shop-list-layout.css
css/shop-page.css
inject-auth.js
js/admin-shop.js
prompts-poetry.css
server/api-handlers/admin/shop/supplier-catalog.js
style.css
tests/shop-sales-config-modes.test.js
```

以上变化保留原样，不归属本轮 KC/TG 加固，也没有用回滚、reset 或清理工作区的方式处理。

此前主站/共享接口的加固证据仍独立保存在 `docs/security-hardening-2026-11-07-local-review.md`。其主站全量回归失败不能用本轮 TG 的通过结果代替；本轮没有重新跑整个根目录测试集。

## 2. 本轮文件清单

共 15 个代码、配置示例与测试文件：12 个修改、3 个新增。本文为额外新增的审计记录。

| 文件 | 类型 | 用途 |
| --- | --- | --- |
| `services/kc-pay-gpt/admin-auth.js` | 修改 | 签名密钥、token 入口、可信代理配置、并发限流、2FA challenge、验证码与初始密码规则 |
| `services/kc-pay-gpt/server.js` | 修改 | 启动校验、接入可信代理、公开充值取 IP、登录/二次验证/发码接口 |
| `services/kc-pay-gpt/mysql-store.js` | 修改 | 初始化时保留有效密码记录；无记录时要求显式初始密码；损坏记录拒绝静默恢复 |
| `services/kc-pay-gpt/public/admin-login.html` | 修改 | 发 Telegram 验证码时携带同一 fingerprint |
| `services/kc-pay-gpt/.env.example` | 修改 | 密钥、代理 CIDR 和初始密码的配置契约 |
| `services/kc-pay-gpt/test/admin-auth-security.test.js` | 新增 | helper、真实路由函数与 Express 代理解析的 mock/离线回归 |
| `server/tg/bounded-response.js` | 新增 | 公用有界流式响应读取器 |
| `server/tg/payment-gateway.js` | 修改 | ZPay 与预览回调探针使用有界读取与取消 |
| `server/tg/nowpayments-gateway.js` | 修改 | NOWPayments 使用有界读取，保留原精确数值解析 |
| `server/tg/gramix-client.js` | 修改 | Gramix 成功/错误响应有界读取与超时取消 |
| `tests/gramix-client.test.js` | 修改 | 使用可流式读取的响应 mock，保留既有行为断言 |
| `tests/tg-payment-gateway.test.js` | 修改 | 网关响应 mock 适配流式读取 |
| `tests/tg-usdt-payment.test.js` | 修改 | USDT 网关响应 mock 适配流式读取 |
| `tests/tg-payment-callback-preview.test.js` | 修改 | 预览探针响应 mock 适配流式读取 |
| `tests/tg-upstream-response-security.test.js` | 新增 | 超限、伪造长度、阻塞取消及采购结果不明确的安全回归 |

没有有意修改依赖版本、lockfile、数据库 schema、生产密钥、worker 安装状态或交易开关。

## 3. KC 已落实的修复

### 3.1 管理员凭证与首次初始化

- 移除基于 cwd 派生管理员签名密钥的回退。
- `ADMIN_TOKEN_SECRET` 必须显式配置：去掉首尾空白后的字节数至少 32，原始值不超过 512 字节；否则服务启动失败。长度校验不等于熵校验，后续应配置独立随机密钥。
- 管理员 token 仅从规范 Bearer Authorization 头读取；不再接收 URL query token，拒绝多段、额外空白/字段等歧义输入。
- 校验签名、规范编码、签发/过期时间、对应 token 类型的最大有效期、管理员权限与密码版本等规则；到达过期时刻即失效。
- 新数据库不再使用 `admin123` 之类的已知默认密码。缺少现有密码记录时，要求 `ADMIN_PASSWORD` 去首尾空白后至少 16 字符，原始值不超过 1024 字符。
- 现有格式有效的 scrypt 密码哈希原样保留，不借初始化重置管理员密码。现有空、null 或畸形哈希报显式恢复错误，并在初始化配置 INSERT 前退出。
- 二级密码种子未提供时使用随机值；**原有二级密码中间件依然直接放行，本轮没有启用该功能**。

### 3.2 IP 信任边界与并发限流

- `KC_TRUST_PROXY_CIDRS` 只接收显式 IP 或受限 CIDR；拒绝 `true`、`loopback` 等快捷名、全网 `/0` 与无效地址/掩码；空值默认不信任转发头。
- 管理登录与公开充值都使用 Express 按该信任规则解析后的 `req.ip`。公开充值不再无条件取原始 `X-Forwarded-For` 的第一项，避免直接伪造请求头绕过 IP 冷却。
- 登录尝试在数据库/密码校验的 await 前同步占用额度，避免并行请求都通过旧计数。每个 IP 在 15 分钟窗口最多放行 5 次尝试，达到阈值后锁定 30 分钟；密码阶段与 2FA 阶段分开计数。
- 计数容器有 4096 条上限与过期回收，容量不足时拒绝新增条目；这限制内存增长，但大规模不同 IP 的请求仍可能影响管理员登录可用性。
- 密码正确而 2FA 未完成时不清空密码阶段额度。完整认证成功才清理对应尝试计数。

### 3.3 二次验证与 Telegram 验证码

- 2FA challenge 为 5 分钟、服务端有状态的一次性记录，绑定当前邮箱、密码版本、请求 IP 与 fingerprint；重启后原 challenge 失效。
- 验证接口与发码接口均重新读取当前配置并核验绑定，密码版本变化不能继续使用旧 challenge。
- 同一 challenge 的不同验证方法共用 5 次校验额度，重新发码不重置 challenge 的次数或原到期时间。
- Telegram 发码用 `crypto.randomInt`；每个 challenge 至多 3 次发送、相隔至少 60 秒；发送额度在异步发送前占用。
- TOTP 必须为 6 位数字，不再将短输入自动补零。
- 认证成功先同步消费 challenge，再进入异步审计/返回 token 流程；并发和后续重放不能再用同一 challenge 签发 token。
- 浏览器发送验证码请求时携带与登录、验证一致的 fingerprint，避免新增绑定规则与原前端不兼容。

保留的行为：没有配置可用 2FA 时仍允许密码登录并提示设置；没有强制全体管理员启用 MFA。fingerprint 是客户端提供的绑定字段，不是独立认证因子。

## 4. TG 已落实的修复

发现 ZPay/NOWPayments 原先在整体 `.text()` 后检查长度，Gramix 成功响应整体 `.json()`，会先完整分配上游响应。现统一通过 `readBoundedResponseText` 边读边检查：

| 响应入口 | 正文上限 |
| --- | --- |
| TG ZPay | 64 KiB |
| TG NOWPayments | 64 KiB |
| 本地预览回调健康探针 | 2 KiB |
| Gramix 成功响应 | 1 MiB |
| Gramix 错误正文 | 8 KiB |

- 同时检查声明的 Content-Length 与实际流入字节数，不依赖上游正确填写长度；可覆盖无长度、低报长度与分块响应。
- 预分配有限缓冲区；拒绝非字节流，不用无界 `.text()` / `.json()` 兜底。
- 超时/中止可打断阻塞的正文读取；取消操作不等待可能一直不结束的 cancel；移除监听器、尝试释放 reader，并在各调用方 finally 中中止请求。
- 对外错误不附带供应商原始响应正文；保留 NOWPayments 原有精确数值解析。
- 保留 Gramix 采购前持久化 submitted 标记和结果不明进入 `manual_review` 的既有规则，超限或不可读的采购确认不会触发自动重复下单。

该修复限制应用层正文累计与解析前的分配，不等于对整个 HTTP 栈、解压、单个底层 chunk 或并发总内存作出严格上限保证，也不是已经证明资金或卡密不会被盗。

## 5. 测试与失败归因

全部为本地测试、虚构配置、mock 上游/数据库；没有真实交易、真实验证码发送或生产数据库验证。KC 直接执行 Vitest，不使用会加载真实 `.env` 的 KC `npm test` 包装命令。

| 检查 | 结果 | 最终证据文件名 |
| --- | --- | --- |
| KC 安全相关集中回归，6 文件 | PASS：204 通过 / 0 失败 | `kc-hardening-focused-final.log` |
| 其中新增管理员安全文件 | PASS：52 通过 / 0 失败，包含在上述及全量内 | `kc-hardening-full-final.json` |
| KC 完整回归，67 文件 | FAIL：64 文件通过 / 3 文件失败；1542 测试通过 / 4 失败 / 1 跳过，共 1547 项 | `kc-hardening-full-final.json` |
| TG 原网关/Gramix 4 文件兼容回归 | PASS：88 通过 / 0 失败 | `kc-tg-response-existing.tap` |
| TG 新增上游响应安全回归 | PASS：20 通过 / 0 失败，包含在 TG 全量内 | `tg-response-security.tap` |
| TG 全量 | PASS：1117 通过 / 0 失败 / 0 取消 / 0 跳过 | `tg-hardening-full.tap` |
| 9 个修改/新增实现及安全测试 JS 的语法检查 | PASS | `local-static-checks.log` |
| 本轮限定路径 diff 空白检查 | PASS | `local-static-checks.log` |

数字不能相加当作独立覆盖数：集中/安全用例已被各自全量包含。Vitest JSON 的 suite 数包含嵌套 describe，此处文件数按 testResults 数组统计。

KC 集中命令（在 `services/kc-pay-gpt/`）：

```sh
./node_modules/.bin/vitest --run test/admin-auth-security.test.js test/recharge-routing.test.js test/session-security.test.js test/task-safety.test.js test/public-task-messages.test.js test/task-diagnostics.test.js --maxWorkers=2
```

KC 最终全量命令（同一目录）：

```sh
./node_modules/.bin/vitest --run --maxWorkers=2 --reporter=json
```

TG 全量命令（仓库根目录）：

```sh
node --test tests/tg-*.test.js tests/gramix-client.test.js
```

### 5.1 KC 最终 4 项失败：已在修改前基线重现

基线从该 HEAD 的 `services/kc-pay-gpt` 通过 `git archive` 提取到隔离临时目录；本轮开始前该子目录没有未提交改动。基线与当前版本都用 `--maxWorkers=2` 对照同一组 5 个文件、289 个用例。

| 文件/场景 | 失败现象 |
| --- | --- |
| `grok-commerce.test.js`：GetCheckoutSession token 不一致 | 期望错误包含 `GROK_COMMERCE_UNCONFIRMED`，实际为 `GROK_SESSION_TOKEN_MISMATCH` 对应提示 |
| `grok-commerce.test.js`：AdoptCheckoutSession token 不一致 | 同上 |
| `pricing-flow.test.js`：仅选择 Plus 卡片 | mock 流程缺少 Checkout API 所需 AccessToken |
| `recharge-card-fixed-scroll.test.js`：固定充值卡滚动 | 期望 overflow hidden，实际 visible |

基线对照：285 PASS / 4 FAIL。当前代码五文件对照：284 PASS / 5 FAIL，额外一项是 `grok-native-flow.test.js` 的 cart change during tax recovery backoff 时序用例。最终 KC 全量中此额外项通过。

在更早的全量回归中还出现 Claude metadata-pending 提示和另外两个 Grok tax-recovery 时序失败；这些没有全部在基线复现。最终通过不代表已解释其不稳定原因，仍需单独跟进，不能宣称原有所有失败都已证明与本轮无关。

最终跳过的是 `proxy-region-matcher.test.js` 的数据库池区域选择用例。SKIP 不是数据库兼容性验证通过。

### 5.2 安全回归覆盖与限制

KC 验证了缺失/短密钥、畸形 token/签名/时间、URL token 拒绝、损坏密码记录初始化前停止、首次密码规则、真实 Express 多层代理解析、IP 伪造头、IPv4 映射 IPv6、并发占额、容器容量/回收、挑战绑定/过期/重放、发码冷却/次数、共享验证码额度，以及未配置 2FA 时的原有登录路径。

TG 验证了边界字节、跨 chunk UTF-8、无/伪造长度、超限取消、停滞正文、停滞取消、已中止 signal、无流式接口拒绝、监听器回收、64 KiB / 1 MiB 边界，以及采购确认无法安全读取时只提交一次并进入人工核验。

上述 mock/离线测试不提供浏览器验收、真实供应商兼容性、生产配置或底层数据库事务正确性的证据。

## 6. 打包路径核对

只做源码检查，没有运行镜像构建、部署脚本或 worker 安装器：

- `scripts/deploy-kvm4-verify-server.sh` 的 PACKAGE_PATHS 包含 `server`；`deploy/kvm4/verify-server.Dockerfile` 执行 `COPY server ./server`，新 TG helper 位于该目录中。
- `.vercelignore` 保留 `server/tg/**`；这不改变 TG API 应在 KVM4 Verify Server 执行的既有架构。
- KC Dockerfile 执行 `COPY . .`；其 `.dockerignore` 排除真实 `.env`/`.env.*`（保留 `.env.example`）、debug_screenshots、product_files 与 data/browser-pool 等路径。
- KC 是独立服务，Verify Server 镜像不包含 KC 源码。本轮文件是否由未来 KC 发布包完整携带，仍需在获准发布时按候选 SHA 核验；不能把 Verify 发布成功视为 KC 也已更新。

源码包含关系不等于最终构建产物或生产生效验证。所有生产链路本轮均 NOT RUN。

## 7. 后续配置前提及剩余边界

1. 发布 KC 前必须确认其生产 `ADMIN_TOKEN_SECRET` 独立且足够随机；缺失或过短现在会阻止启动。若未来更换密钥，旧签名 token 将失效。本轮未读取或修改生产值。
2. 必须按 KVM4 实际 ingress、Docker/反代路径核验 `KC_TRUST_PROXY_CIDRS` 与各跳请求头处理，不能猜测 CIDR 或信任全网。默认不信任可防伪造，但代理后的访问可能合并为同一限流 IP。
3. 有效旧密码哈希保留，不能据此宣称弱密码已被更换；MFA 未普遍强制，后台二级密码仍停用。
4. KC 尝试计数、challenge 与验证码在单进程内存中：重启清空，多副本不共享额度；扩容前需另行设计持久化/共享限流与一次性消费。
5. 本轮没有全面审计 KC 公开 CDK、任务查询、WebSocket 所有权与全部充值供应商行为；不能将管理员认证修复外推为整个充值业务已完成授权审计。
6. TG 的正文上限需要将来结合真实供应商合规响应和业务规模验证；真实供应商支付/采购回归未执行。
7. TG 保留原有采购提交标记和人工复核流程，但本轮没有验证真实数据库的持久化、并发事务、回调到账或卡密交付。
8. KC 全量 4 FAIL，以及回归中暴露的提示/时序不稳定仍是开放事项；本轮主站全量为 NOT RUN，不能声明项目整体测试通过。

| 外部验证/操作 | 本轮状态 |
| --- | --- |
| Vercel production、别名、main SHA 一致性 | NOT RUN |
| KVM4 Verify Server / NewAPI 服务版本与健康 | NOT RUN |
| KC 生产服务、MySQL、代理链和环境变量检查 | NOT RUN |
| TG worker 安装、启动与实际履约 | NOT RUN |
| SQL、迁移、RLS、生产数据库查询/写入 | NOT RUN |
| 真实订单、真实支付/退款/采购、浏览器验收 | NOT RUN |

后续提交、合并或发布必须另获用户授权，并按 AGENTS.md 的完整候选提交、恢复备份、测试及发布链路要求执行；本次本地加固不隐含上述授权。
