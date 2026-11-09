# 安全加固本地验收补充记录（2026-11-08）

本记录承接 `docs/security-hardening-2026-11-08-admin-session-step-up-local-review.md`，原报告与历史失败结果保持原文。范围为主站/TG 管理员会话、KC 敏感操作的浏览器验收、数据库只读验收文件准备，以及公开静态构建的边界验证。

**本轮没有 Git 提交、推送、PR、部署、生产配置变更或 SQL 执行，也没有启用游客商品、worker 或创建真实交易。** 当前为共享脏工作区，不是可直接发布的候选。

Git HEAD：`75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`；分支 `main`；origin 为 `https://github.com/zaoyoe/Zaoyoe-Studio.git`。编辑前已 fetch，`HEAD..origin/main` 为 0。该 SHA 只标识基础提交，不能代表未提交的源码内容；浏览器和构建结果均另存源码哈希并标记 dirty。

## 新发现与修复

隔离构建向非公开路径注入假私密标记时发现：`js/private-fixture.test.js` 被复制进入 `.vercel-static`。原过滤器允许 test 标记的前边界为连字符或下划线，没有覆盖常见点号命名。该本地构建结果为真实失败，已保留原日志及修复前源码。

已调整 `api/_lib/vercel-build.js`：覆盖点号分隔的 `.test` / `.spec` 命名，并将现有私有文件名过滤应用于 `.mjs` / `.cjs`。普通公开模块保持可用。新增实际产物回归测试同时检查私有路径与假标记内容被排除，并确认公开模块保留。没有证据表明生产曾发布包含真实秘密的此类文件，不能由本次假标记复现推定生产事故。

## 本轮验证结果

| 验证 | 结果 | 证据范围 |
| --- | --- | --- |
| Chromium 浏览器 | 14 PASS / 0 FAIL | 实际源码模块与 DOM，HTTP API 为 mock |
| WebKit 浏览器 | 14 PASS / 0 FAIL | 实际源码模块与 DOM，HTTP API 为 mock |
| 静态构建、版本及缓存回归 | 3 文件，9 PASS / 0 FAIL / 0 SKIP | 含新增的文件名泄露回归；隔离环境运行 |
| 隔离静态产物 | PASS_STATIC_BUILD_ONLY | 739 个真实公开输入，616 个输出；35 个假私密路径及标记内容均被排除 |
| 迁移只读验收 SQL | PASS_PARSE_ONLY | pglast 8.7，5 个语句，10 个函数正文指纹；未执行 SQL |

浏览器总计为 **28 PASS / 0 FAIL / 0 NOT RUN**，Playwright 1.59.1，serverErrors 为空。两种浏览器覆盖相同的 14 类场景，不能描述为 28 类不同攻击路径。窗口隐藏测试使用合成 visibility 事件，尚未验证真实设备切后台。

浏览器场景包括：KC 密码+TOTP 的近期验证、并发请求共用 challenge、单次重试、取消与无效 expiry 拒绝、proof 仅内存保存、退出或身份切换取消旧 dialog、退出后延迟分段响应及 clone reader 拒绝、明文以 textContent 显示及关闭/30 秒清除；主站待签发 Set-Cookie 与 DELETE 的顺序、退出失败可见性和本地缓存清理；TG 自身身份与主站 storage 隔离；KC 实际登录页面渲染和 mock 无效登录拒绝。

隔离构建调用真实 `runVercelBuild`，构建输入在仓库外，未对实际工作区运行构建。输出保留主站/TG 入口和 `js/admin-access.js`，608 个资源引用完成版本改写；741 个源码/构建器文件的哈希在该次构建前后相同。`/api/runtime/supabase-config` 是动态运行时响应，单列 **NOT_RUN_DYNAMIC_API**，不能当作静态文件或联调通过证据。未读取真实 env，私有目录以假标记表示。此验证不覆盖完整 Vercel serverless bundle 或 Verify/KC Docker 镜像。

共享工作区在不同构建快照之间存在 10 个其他公开文件变化，记录于 `snapshot-drift.json`。它们没有由本轮回退或覆盖；每次结果仅对应各自 manifest。前阶段归档的 31 个安全范围文件在本轮核对时均未变化，浏览器验收的 3 个源码文件与最终工作区哈希一致。本轮对构建器的变更由新增 9 项相关回归覆盖，未将之前的整个工作区测试成绩冒充为当前所有改动的验收。

前阶段专项结果保持为主站/TG 72 PASS、KC 250 PASS、扩展回归 104 文件 1954 PASS。专项与扩展存在重叠，本轮构建相关文件也可能重叠，**各阶段数量不相加为独立总数**。

## 历史失败与边界

- 最早浏览器记录：Chromium 14 PASS，WebKit NOT RUN，原因是缺匹配浏览器缓存。
- WebKit 中间记录：13 PASS / 1 FAIL。流式 fixture 仅发送 header 时被缓冲，已改为先发送有效 JSON 前缀再延迟正文；保留失败日志，退出后读者拒绝的断言未削弱，运行时代码未为该 fixture 修改。
- 第一次静态构建：验收器将动态 `/api/runtime/supabase-config` 误当成静态文件而失败；已分类并保留原记录。
- 第二次静态构建：`.test.js` 假私密文件实际进入产物；已修运行时过滤器与回归测试，保留修复前证据。

空白检查工具最初把 `git diff --no-index --check` 的“文件存在差异”退出码 1 误记为失败。已用正常/尾随空白两个 fixture 核验退出码分别为 1/3，并复查全部 6 个本轮文件；最终空白检查通过，初始 JSON 保留，未修改产品行为以迎合检查。3 个 JS 语法检查也通过。

数据库验收文件和说明分别位于 `supabase/acceptance/20261108_admin_studio_sessions_readonly.sql` 与同目录 `20261108_admin_studio_sessions_README.md`。用户此前报告“已执行 SQL”的状态仍为 **USER_REPORTED_APPLIED / NOT_INDEPENDENTLY_VERIFIED**，不推定本次迁移已应用或授权新执行。

| 尚待验证事项 | 状态 |
| --- | --- |
| 真实数据库对象绑定、角色/RPC 权限、源会话及并发撤销 | NOT RUN；只有解析证据 |
| 主站充值、KC 充值、TG 购买的完整登录至支付交付联调 | NOT RUN；浏览器 API mock 不替代业务联调 |
| 生产防火墙、主机配置、服务健康与发布 SHA | NOT RUN；本轮未访问或调整生产 |
| Vercel serverless bundle、Verify/KC Docker 实际产物 | NOT RUN；静态构建不能替代 |
| Vercel、KVM4 Verify、NewAPI service-slot、独立 KC 及 TG/guest worker 发布 | NOT RUN；等待用户明确发布指令 |

## 证据与恢复

工作证据目录：`/tmp/security-local-acceptance-20261108-135813`。
本轮持久恢复归档：`/Users/wangyongchao/.codex/backups/security-local-acceptance-20261108-142610`。归档保存范围内源码、浏览器结果及截图、SQL 解析器脚本与结果、静态构建验证器/输入输出哈希、回归日志、历史失败记录和 Git 元信息，配套 SHA256 与逐项回读校验。浏览器/pglast 二进制及约 45 MB 的临时构建输入目录不复制入归档；版本、输入 manifest 与输出哈希保留。

前阶段恢复归档 `/Users/wangyongchao/.codex/backups/security-delivery-20261108-134108` 及更早备份均保留。任何范围内聚合 diff 可能包含同文件更早任务的修改，不能作为干净独立发布补丁。该归档是源码和本地证据恢复资料，不是数据库、服务器或生产秘密备份。

将来发布仍需用户明确指令，依 AGENTS.md 整理完整候选与恢复清单，走最新 main 的 PR 链路，并分别验证所有适用服务。当前结果不构成生产验收或绝对安全保证。
