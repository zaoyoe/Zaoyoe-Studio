# 发卡站第二轮安全加固实施记录（2026-11-08）

本轮在本地工作区完成支付金额校验、供应商媒体与富文本处理、KC 公共接口保护、KC 充值任务准入和 TOTP 加密的代码修改与针对性验证。覆盖主站、KC 自动充值、TG 购买的相关边界；虎皮椒与爱发电不在接入范围。

**本记录不是上线证明，也不是全站安全通过证明。没有 commit、push、创建 PR、部署、执行 SQL、连接生产数据库、启动 worker、启用游客购买或创建真实交易。** 当前工作区包含大量既有未提交内容，不是干净发布候选。

本记录及证据是新增档案；不替换 `docs/security-card-store-attack-audit-2026-11-08.md` 或 `docs/security-audit-evidence/2026-11-08-card-store/` 中的历史结论。

## 1. 源码基线和操作边界

| 项目 | 记录 |
|---|---|
| 工作目录 | `/Volumes/chao/AI/xianyu_profit_calculator` |
| 当前分支 | `main`；未切换分支 |
| HEAD / origin/main | `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8` |
| canonical origin | `https://github.com/zaoyoe/Zaoyoe-Studio.git` |
| 修改前新鲜度门禁 | 本次续接执行 `git fetch origin main` 成功，`git rev-list --count HEAD..origin/main` 为 `0` |
| 新证据归档前 dirty 项 | `349`；这是整个工作区数量，不能全归因于本轮 |
| 发布候选 | `NOT_A_CLEAN_RELEASE_CANDIDATE`；没有新候选 commit |
| 用户此前报告 SQL 已执行 | `USER_REPORTED_APPLIED / NOT_INDEPENDENTLY_VERIFIED` |
| 本轮 SQL、生产操作、实际构建 | `NOT RUN` |

保留既有文件、暂存状态及其他改动；未执行 reset、restore、rebase、切分支、清理 dirty 文件或强制推送。新增报告前的完整路径清单见证据目录 `baseline-and-boundaries.json`。

## 2. 已实施的代码加固

### 2.1 主站 ZPAY：缺失或不一致的查单证据不得入账

文件：

- `api/_lib/payments/zpay-amount.js`（新增）
- `api/_lib/payments/provider-adapters.js`
- `api/_lib/payments/zpay-webhook.js`

金额仅接受正的十进制数、最多两位小数；先使用十进制字符串和 BigInt 计算整数分，再检查安全整数范围。provider 对外仍使用 number，因而还验证转换后能恢复相同分值。拒绝极小金额、额外小数位、非有限值及无法无损表达的极大金额；不通过四舍五入把不同输入合并。

本轮金额边界测试先复现了旧 helper 的问题：`1e-10` 被处理成 0 分，`"90071992547409.90"` 与 `"90071992547409.91"` 被处理成同一分值。新增 28 项边界测试在修复前为 **23 PASS / 5 FAIL**，原始失败保留；修复后 helper、adapter 与 webhook 联合验证为 **71 PASS / 0 FAIL**，这部分已包含在最后的 239 项中。

成功入账需要核对应付金额、回调原始金额及主动查单金额。主动查单缺少订单号、交易号或金额时，不能用通知或请求中的值补齐；按可重试错误处理，不据此入账。

TG 的支付实现是独立的 `server/tg/payment-gateway.js`，不能声称 TG 与主站共用本次 adapter。TG 支付网关、对账、鉴权查单和支付完成契约已做本地回归；未向 TG 生产接口发起交易。

### 2.2 供应商媒体：校验地址、连接目标与响应内容

文件：

- `server/api-handlers/admin/shop/_remote-media-security.js`（新增）
- `server/api-handlers/admin/shop/_r2-media.js`
- `server/api-handlers/admin/shop/_product-image-assets.js`
- `server/api-handlers/admin/shop/supplier-catalog.js`

远程媒体下载限制 HTTP(S)、80/443 和无 userinfo 的 URL；拒绝实现中列出的私网、回环、链路本地、保留及特殊用途地址。校验该跳的全部 DNS 答案，把连接固定到已检查地址，并保留原域名的 Host/TLS 校验。每次跳转重新检查，最多三跳，禁止 HTTPS 向 HTTP 降级。

对响应采用流式大小限制，拒绝压缩响应，并匹配 MIME 与文件头白名单。封面下载复用同一下载器，源文件上限 12 MiB，保留 sharp 像素与动画预算及现有变体处理。R2 上传和封面处理有整体 deadline；商品 HTML 的媒体处理限制 40 个资源及 30 秒总预算。DNS 或底层图像任务不一定能被即时取消，因此这些 deadline 不能被解释成操作系统层面的强制资源隔离。

已配置 R2 的下载拒绝不能回退到原始不安全 URL。**无 R2 时仅做静态 URL 校验，没有服务器 DNS/下载检查，不能把这一分支算作同等防护。** 文件头匹配不等于恶意文件扫描，未验证生产 R2 配置。

### 2.3 供应商富文本：修复占位符绕过与动态文本注入

文件：`server/api-handlers/admin/shop/supplier-catalog.js`、`js/admin-shop.js`。

前后端富文本清洗修复链接正文经占位符恢复时绕过清洗的问题；重建允许的结构标签、转义属性并限制 URL/CSS，同时保留正常格式、文本和签名链接中的 query 实体。

KC 的 `services/kc-pay-gpt/public/index.html` 中，`showStatus` 与 `showCapsule` 的动态文字改用 `textContent`，保留静态 SVG。这里只覆盖已修改的渲染入口，不声称所有页面都已接受完整浏览器 XSS 验证。

### 2.4 KC 公共高成本接口：限流、并发和安全头

新增 `services/kc-pay-gpt/public-request-security.js`，接入 `services/kc-pay-gpt/server.js`，保护以下 POST：

- `/api/public/subscription/check`
- `/api/public/probe-account`
- `/api/verify-cdk`
- `/api/cdk/query`
- `/api/run-process`

默认每分钟 IP 30 次、CDK 12 次、全局 180 次；全局同时在途 24 个、每 IP 3 个。CDK 按数据库大小写不敏感语义归一化后取哈希，有界 Map 并回收过期计数。IP 使用 Express 可信代理配置处理后的 `req.ip`，不在 limiter 中直接采信请求头。

客户端断开不提前释放尚在执行的上游任务容量；实际响应结束后幂等释放。关闭 `x-powered-by`，增加 no-store 及相关浏览器安全头。

**限流和容量计数只在单个 Node 进程内共享。多副本/多进程或进程重启下不能声称有统一预算。** 实际反向代理信任链、线上 WAF、分布式限流及封禁策略均未独立核验。当前 CSP 保留 `unsafe-inline` 与 `unpkg.com`，仍不属于严格 CSP。

### 2.5 KC 充值准入：消除 await 前容量空档并保护失败恢复

文件：`services/kc-pay-gpt/server.js`。

`handleActivationRequest` 在容量检查后、下一次 await 前同步登记 `admission:${crypto.randomUUID()}`；任务创建后先登记 task slot，再释放 admission。未转交的预约由 finally 释放，worker 负责最终 task slot 释放。

同步派发失败时，先把已建 task 标为 failed/not_started，再返还本请求拥有的 CDK 锁。若任务收尾本身失败，则保留 CDK 锁供人工复核，同时释放容量；未创建 task 的失败可返还本请求拥有的锁。

测试从真实源码提取 handler 与 Set helpers 至 VM，验证并发预约、释放及失败恢复；未启动 KC 服务或连接数据库。**CDK 核销与 task 创建仍存在进程崩溃时的一致性窗口，本轮未完成数据库事务化或持久任务编排。** 测试覆盖受控异常，不等于证明突然断电、进程终止后已无重复充值或锁遗留风险。

### 2.6 KC 管理员 TOTP：加入独立 AES-256-GCM envelope

文件：

- `services/kc-pay-gpt/credential-security.js`（新增）
- `services/kc-pay-gpt/mysql-store.js`
- `services/kc-pay-gpt/.env.example`（仅样例变量）

active 和 pending TOTP 使用 AES-256-GCM、随机 IV、独立 keyring，AAD 绑定用途、版本及 key-id。pending 转 active 时按新用途重新加密；损坏 envelope、未知版本或解密失败不会降级为明文。

缺少 key 时拒绝新的敏感写入；仅对符合旧格式的 TOTP 明文保留读取兼容。配置名为 `KC_CREDENTIAL_ACTIVE_KEY_ID` 与 `KC_CREDENTIAL_KEYRING_JSON`。**本轮没有配置生产 key、轮换密钥或迁移历史明文；线上配置是否已存在也没有独立核验。** 后续发布前需确认 key 可用，否则新绑定/变更 TOTP 会失败关闭。轮换时须保留解密仍在使用的旧 key 的能力。

密码保持哈希存储原则，不改成可逆加密。本次也没有把普通卡池、KC 银行卡/CVV、产品凭证全部改成密文。

## 3. 本地验证与失败证据

测试运行使用 Node `v25.9.0`，设置：

```sh
NODE_OPTIONS='--require=/tmp/security-test-isolation-20261108/preload.cjs'
```

preload 拦截仓库真实 `.env*` 的 Node 文件读取，允许 example/sample/template；阻止外部 TCP 及 Unix socket，允许本地 loopback fixture。拦截审计只记录路径，不记录文件内容。原始 preload 和 `blocked-reads.jsonl` 已复制到证据目录 `raw/`。

这是测试进程内的 Node API 防护，不是操作系统或容器沙箱。没有读取真实 `.env`，没有连接生产数据库。KC 测试直接运行 Vitest，不使用会带入 `--env-file=.env` 的 `npm test`。

### 3.1 最终执行结果

| 组别 | 文件数 | PASS | FAIL | SKIP | 结果依据 |
|---|---:|---:|---:|---:|---|
| 本轮定向（含新增金额边界） | 12 | 239 | 0 | 0 | `raw/security-round2-final-verified.tap`；exit 0 |
| 主站/TG/游客支付回归 | 11 | 166 | 0 | 0 | `raw/security-payment-tg-guest-verified.tap`；exit 0 |
| KC 受影响文件串行复测 | 5 | 260 | 0 | 0 | `raw/security-round2-kc-affected-final-results.json`；执行返回 0、JSON success=true |
| 最终 JS 语法检查 | 22 | 22 文件通过 | 0 | — | `raw/security-round2-static-checks-final.json` |
| 本轮范围 `git diff --check` | — | exit 0 | — | — | 同上 |

前三组含不同层次的验证，不作为端到端生产验收；历史复测与最终测试有重叠，不重复累计成独立覆盖率。完整文件名、命令、工作目录、环境覆盖和原始执行元数据见 `final-commands.json` 与 `raw/security-round2-final-verification-commands.json`。

KC 最终复测的精确命令（工作目录为 `services/kc-pay-gpt`）：

```sh
NODE_OPTIONS='--require=/tmp/security-test-isolation-20261108/preload.cjs' \
node ./node_modules/vitest/vitest.mjs run \
  test/recharge-routing.test.js \
  test/billing-form.test.js \
  test/claude-navigation.test.js \
  test/claude-payment-flow.test.js \
  test/grok-native-flow.test.js \
  --no-file-parallelism --maxWorkers=1 \
  --reporter=json \
  --outputFile=/tmp/security-round2-kc-affected-final-results.json
```

归档的 preload 可改用当前证据目录中 `raw/preload.cjs` 的绝对路径重放；上面的 `/tmp` 路径是实际执行记录。KC 单独退出码元数据未留独立文件，执行观察和 Vitest JSON 分别保留，不能假称额外的原始文件存在。

### 3.2 KC 全量没有通过；不能把全部失败归为历史问题

首次当前全量执行：**71 个测试文件，1693 项，1620 PASS / 72 FAIL / 1 SKIP，exit 1**。Vitest 的 suite 数不是文件数。原始 JSON 为 `raw/security-round2-kc-full-results.json`。

为对照，复制了 180 个源码、测试和页面文件，排除真实 env/数据，复用本地 node_modules；再以最初备份覆盖并核验 `server.js`、`mysql-store.js`、`public/index.html`。在这个对照副本中仅执行首次失败的 12 个文件，得到 **502 项，454 PASS / 48 FAIL，exit 1**。这是针对三个文件的修改前副本，不是 pristine Git main，也不是完整修改前全量。

| 文件 | 修改前副本 FAIL | 首次当前全量 FAIL | 最终情况 |
|---|---:|---:|---|
| billing-form.test.js | 0 | 1 | 串行 71 PASS |
| checkout-debug-server.test.js | 26 | 26 | 未再次执行 |
| claude-navigation.test.js | 0 | 1 | 串行 36 PASS |
| claude-payment-flow.test.js | 0 | 1 | 串行 6 PASS |
| gpt-outsourcing-admin.test.js | 2 | 2 | 未再次执行 |
| grok-commerce.test.js | 2 | 2 | 未再次执行 |
| grok-native-flow.test.js | 0 | 5 | 串行 93 PASS |
| local-preview-recovery.test.js | 5 | 5 | 未再次执行 |
| pricing-flow.test.js | 1 | 1 | 未再次执行 |
| recharge-card-fixed-scroll.test.js | 1 | 1 | 未再次执行 |
| recharge-routing.test.js | 7 | 23 | 修 fixture 依赖后串行 54 PASS |
| recharge-ui.test.js | 4 | 4 | 未再次执行 |

`recharge-routing` 保留原业务断言，补齐 crypto、合成 task token 及从实际代码提取的 reserve/release helpers，移除空的 reserve mock，使测试使用真实 Set 记账。没有通过弱化鉴权修复测试。

七个未再次执行文件在前后对照中有 41 项同样失败；但**没有重新运行最终全量，不能推断最终全量只剩 41 FAIL，更不能报告全量已绿**。billing/navigation/payment/native-flow 的 8 项首次并行失败在对照中不失败、最终串行通过，只能记录为执行波动，不能武断称为历史失败。

尚未解决的 fixture/断言线索包括 checkout-debug-server 中未定义的 `publicCaptchaHandler`、local-preview-recovery 的 WebSocket fixture、recharge-ui 的 stack trace/状态断言，以及其他后台和价格/UI 契约。具体原始失败保留在 JSON 中，本轮未删除这些断言。

### 3.3 其他已纠正的失败仍保留

- 金额新增 28 项先红后绿：修复前 23 PASS / 5 FAIL；联合验证后 71 PASS / 0 FAIL。原始 TAP 都已归档。
- 媒体/富文本首次 110 PASS / 10 FAIL，是 VM 提取 fixture 遗漏 async；修 fixture 后 120 PASS / 0 FAIL，未弱化断言。
- KC activation 聚焦验证 20 PASS / 0 FAIL；已包含在最终定向组。
- 最终外部验证脚本首次误用 CommonJS 顶层 await，测试进程尚未启动即 exit 1；改为 async 函数后才执行最终两组验证。原始纠正说明为 `raw/security-round2-final-verification-runner-correction.json`，不把脚本启动失败伪装成产品测试通过。
- 先前 211 项定向结果与 166 项支付结果保留在原始 regression 记录中；最终定向 239 项是加入金额测试后的执行结果。

## 4. 文件清单、备份和打包边界

证据目录：`docs/security-audit-evidence/2026-11-08-card-store-round2/`。

- `source-manifest.json`：42 个当前文件的 SHA256/字节数/Git 状态，包含 14 个本轮运行时或样例配置文件、10 个本轮测试或 fixture 文件、18 个仅作回归的测试文件。文件可包含此前未提交工作，不能把整份 diff 都归为本轮。
- `baseline-and-boundaries.json`：分支、SHA、remote、dirty 清单和操作状态。
- `test-results-summary.json`、`final-commands.json`：最终及历史计数与命令来源；没有把缺失的退出码单独证据补造成存在。
- `evidence-copy-index.json`：36 份原始测试、隔离日志、执行元数据和备份 manifest 的精确副本及 SHA256。
- `raw/security-round2-backup-verification-final.json`：8 份本地备份清单、共 33 个文件快照，均读回并匹配 SHA256。

本轮备份身份如下，均为 `/tmp` 中的文件备份，**不是 Git backup commit、stash 或生产数据库备份**。备份内容仍在这些路径；只把 manifest 与验证结果归档，没有把临时存储表述为永久恢复保证：

```text
/tmp/security-hardening-20261108-round2-before/manifest.json
/tmp/security-hardening-20261108-round2-continuation/manifest.json
/tmp/security-hardening-20261108-round2-finalization-before/manifest.json
/tmp/security-hardening-20261108-round2-media-before/manifest.json
/tmp/security-hardening-20261108-round2-sanitizer-before/manifest.json
/tmp/security-hardening-20261108-round2-dispatch-before/manifest.json
/tmp/security-hardening-20261108-round2-routing-fixture-before/manifest.json
/tmp/security-hardening-20261108-round2-amount-final-before/manifest.json
```

打包规则仅静态检查，记录见 `packaging-static-review.json`：

- Verify 的 `scripts/deploy-kvm4-verify-server.sh` 打包 api/server/js，Dockerfile COPY 覆盖对应目录。
- Vercel 的 includeFiles 与 `.vercelignore` 放行 `server/api-handlers/**`；新增金额 helper 由支付模块静态 require 引入。
- KC 的 Dockerfile 使用 `COPY . .`，`.dockerignore` 未排除两个新增 JS helper。

未运行部署脚本、Vercel 构建或 Docker 构建；静态包含关系不能充当实际发布产物已包含新代码的证据。历史游客 promo 档案契约与 A5–G3 手工验收没有在本轮重跑；二者均不得用本轮支付回归代替。

## 5. 剩余风险与下一步优先级

| 优先级 | 事项 | 当前状态与需要的工作 |
|---|---|---|
| P1 | 卡密、银行卡/CVV、产品凭证的完整存储加密 | 未完成。主站须同时覆盖后台、TG、guest、快照和导出；不可导致给用户发密文。`card_assets.card_number VARCHAR(32)` 参与查询/去重，不能直接换成 envelope。需要协调字段、查重和密钥轮换设计。 |
| P1 | KC 核销与任务创建的崩溃一致性 | 本轮改善受控异常恢复，尚未事务化。需持久幂等键、事务/任务状态恢复和真实隔离数据库故障注入验证。 |
| P1 | 数据库与实际生产边界 | 实际库存约束、幂等约束、RLS/权限、WAF/可信代理、三系统 release SHA 和实际资金链路均未独立核验。历史 SQL 只能记用户报告，不能写 PASS。 |
| P1 | TOTP 上线准备 | 本轮未配置生产 key 或迁移旧明文。须在后续授权生产操作中核验独立 key、恢复和轮换能力；缺 key 时新写入会失败关闭。 |
| P2 | KC 多副本共享预算 | 当前 limiter/并发为单进程；需要共享限流/任务容量存储及可信代理联调。 |
| P2 | 富文本与媒体更强隔离 | CSP 仍含 unsafe-inline/unpkg；无 R2 分支仅静态 URL 校验；magic 检查不代替扫描；未做完整浏览器验收和底层任务强制资源隔离。 |
| P2 | KC 全量测试欠账 | 首次 72 项失败的原始结果保留，修改前对照与最终串行结果单列；尚未完成最终全量复跑及剩余失败修复。 |

上述事项不能通过补写“已验证”解决。本轮代码与本地针对性测试已完成，生产状态保持未验证。

## 6. 生产与数据库证据状态

| 链路/动作 | 状态 | SHA/依据 |
|---|---|---|
| 本地工作区基线 | 已记录 | `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8` + dirty 文件快照；无新提交 |
| Vercel production | NOT RUN | 未部署、未核验线上 SHA/Ready |
| KVM4 Verify Server | NOT RUN | 未部署、未 SSH 核验 release/health |
| KVM4 Sub2API/NewAPI | NOT RUN | 未部署、未核验容器和 release |
| KC production | NOT RUN | 未修改 `/opt/kc-pay-gpt` 或生产配置 |
| TG/guest worker | NOT RUN | 未安装或启动、未核验线上运行情况 |
| 本轮数据库 SQL | NOT RUN | 没有执行 |
| 用户此前报告 SQL | USER_REPORTED_APPLIED / NOT_INDEPENDENTLY_VERIFIED | 没有独立数据库证据 |
| 真实支付/退款/充值/交付 | NOT RUN | 仅本地 mock/契约/VM 测试 |
| 游客商品/SKU 开关 | NOT RUN | 未启用 |

后续任何发布仍需用户明确指令，并按 AGENTS.md 从最新 main 的完整候选提交走发布流程；本记录不构成发布或启用授权。
