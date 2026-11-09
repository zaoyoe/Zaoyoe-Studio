**2026-11-08 本地安全加固交付记录：后台会话撤销、KC 敏感操作与内部验证码边界**

记录时间：2026-11-08T13:41:08+08:00。本轮已完成本地实现和下述验证；生产状态为 **NOT RUN，尚未生效**。本记录承接前一阶段审计，不替代、重写或提高历史记录的验证等级。

- 仓库：`/Volumes/chao/AI/xianyu_profit_calculator`
- 当前分支：`main`；基线 HEAD：`75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`。
- 唯一 origin：`https://github.com/zaoyoe/Zaoyoe-Studio.git`。写入报告前已执行 `git fetch origin main`，`HEAD..origin/main` 计数为 **0**。
- 工作区有其他任务及前阶段的未提交改动；当前内容不是干净、完整的发布候选。没有提交、推送、PR、合并、部署、生产配置变更、SQL 执行、真实订单或 worker 启动。
- 未读取真实 `.env` 内容；没有输出实际密钥、卡密、TOTP 种子或恢复码。虎皮椒与爱发电不在本轮范围。

**实现范围与安全收益**

| 系统 | 本地实现 | 仍需明确的边界 |
| --- | --- | --- |
| 主站后台及 TG 共用后台认证 | v2 Cookie 绑定用户、会话标识、签发及到期时间，最长 1 小时；持久 grant 与来源会话撤销检查；签发仅接受 Bearer，Cookie 不可自续签；POST/DELETE 检查 Origin | 依赖新增数据库迁移；迁移未应用，真实事务及并发尚未验证 |
| 主站/TG 会话签发与退出 | grant、签名、关键签发审计完成后才返回 Cookie；失败丢弃本次 grant；退出撤销 Cookie 与已验证的 Bearer 来源；前端 generation/in-flight/clear promise 处理签发与退出竞态 | 本轮关键路径失败时拒绝继续，不能推导为全站所有历史审计调用点均已失败拒绝 |
| KC 管理员敏感操作 | 5 分钟近期验证 proof 绑定管理员 token 摘要、IP、passwordVersion；使用当前密码和已配置因子；配置不完整拒绝；challenge 最多 128 个、每个最多 5 次猜测，异步查询后单次消费并再次检查期限与版本 | proof/challenge 使用进程内存；真实 MySQL、浏览器端到端及生产行为未验证 |
| KC 管理员因子与凭证 | TOTP 待绑定状态与旧因子隔离，确认前旧因子有效；二维码改为本地生成；密码、因子及 TG 配置变更提升版本使旧登录失效 | 需在隔离环境验证实际恢复流程与多端失效；未对生产因子或密码做任何变更 |
| KC 卡池与账单 | 列表仅提供 PAN 末 4 位；单条卡密读取先审计；普通账单查询缩减投影，不返回完整 CDK、Stripe 标识或上游原始错误；新增单条账单 secret 接口，近期验证、严格 ID 校验，先审计再读取；账单导出先审计 | `/api/admin/data` 为保留业务功能仍可返回必要凭证，但要求近期验证；明文导出仍是敏感能力，不能声称明文完全消失 |
| KC 前端敏感信息 | proof 仅页面内存保存，隐藏/退出清理；明文展示 30 秒自动清理；弹窗关闭清空 CDK；CSV 公式防护；Response body 读取及 clone 检查 generation/token，阻止退出、隐藏或切换弹窗后的旧响应回填 | 本地验证含行为模拟和静态契约，未做完整真实浏览器联调；不能撤回已经复制或保存到本地的内容 |
| KC 内部验证码链路 | 同时校验 loopback socket 和随机内部 token，不相信 X-Forwarded-For；worker 固定连接 127.0.0.1，关闭代理和跳转；容量 128、TTL 5 分钟、每任务仅一个 waiter；非法 JSON 形状被拒绝 | 未对供应商真实验证码流程或生产反代进行联调 |

关键实现文件：

- [会话持久层](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin-session-store.js)、[后台鉴权](/Volumes/chao/AI/xianyu_profit_calculator/api/_lib/admin.js)、[会话签发与撤销接口](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/access/session.js)、[后台前端会话管理](/Volumes/chao/AI/xianyu_profit_calculator/js/admin-access.js)。
- [数据库迁移候选](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20261108041927_admin_studio_revocable_sessions.sql)。
- [KC 近期验证](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/admin-security.js)、[KC 接口接入](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/server.js)、[KC 账单查询](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/mysql-store.js)、[KC 前端敏感请求保护](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/public/admin-security.js)、[KC 内部验证码鉴权](/Volumes/chao/AI/xianyu_profit_calculator/services/kc-pay-gpt/internal-captcha-security.js)。

**数据库与兼容要求**

迁移候选新增 private grant 和已撤销来源会话记录；create/revoke 使用同一个 `auth.sessions` 行锁。private 函数使用 `SECURITY DEFINER` 和固定空 `search_path`，public wrapper 使用 `SECURITY INVOKER`，撤销 PUBLIC/anon/authenticated 调用权限并仅授予 service_role；活动状态检查使用 VOLATILE 和 `clock_timestamp()`。

以上为源码与静态契约结论，**不构成真实 PostgreSQL 锁、事务、快照或角色权限验证**。本轮没有执行迁移或任意 SQL。后续必须把代码与迁移作为配套变更安排；RPC 未应用时后台会失败拒绝，可能返回 503。旧 v1 Cookie 不再有效，管理员需要重新登录。这些是兼容影响，不能视为生产已具备会话撤销能力。

TG 本轮新增收益集中于共用后台认证边界。TG 支付回调、订单和上游响应等在扩展回归范围内；这不是“本轮重写了全部 TG 交易流程”的证据。既有登录退出调用点仍需后续核查远端撤销失败时的用户反馈，不能以页面退出代替确认服务端撤销成功。

**本地验证结果**

| 验证组 | 文件/范围 | 结果 | 证据 |
| --- | --- | --- | --- |
| 主站/TG 后台会话专项 | 9 个 Node 测试文件 | **72 PASS，0 FAIL，0 SKIP** | `logs/security-admin-suite-final-v2.tap` |
| KC 明确测试文件 | 9 个 Vitest 文件 | **250 PASS，0 FAIL** | `logs/security-kc-nine-files-final-v2.log` |
| 扩展安全/支付/交易回归 | 104 个 Node 测试文件 | **1,954 PASS，0 FAIL，0 SKIP** | `logs/security-broader-isolated-final-v2.tap`，退出码 0 |
| 迁移静态契约 | 已包含在后台专项，5 个用例 | **5 PASS**，不得重复加总 | `logs/security-admin-migration-contract-v1.tap` |
| 脚本语法 | 14 个运行时 JS、两页后台 HTML 的 4 段内联脚本 | **PASS** | `checks/security-static-final-20261108.json` |
| 本轮局部空白检查 | 14 个已跟踪文件、10 个新增第一方文件 | **PASS** | 同上；第三方源码保留来源格式 |
| 打包输入静态核对 | 11 项输入、引用和静态公开面检查 | **PASS_STATIC_ONLY** | `checks/security-packaging-inputs-final-20261108.json` |

72 项专项与 1,954 项扩展回归有文件重叠，**不相加为独立测试总数**。重叠文件为：`tests/session-security-boundaries.test.js`, `tests/tg-admin-session-isolation.test.js`。完整文件列表记录在 `verification-manifest.json`。

KC 使用明确的 `node ./node_modules/vitest/vitest.mjs run <九个文件>`，没有运行 KC `npm test`。扩展回归使用环境白名单运行：阻断仓库内真实 `.env*` 读取，允许 example/sample/template 和仓库外临时 fixture；TCP 仅允许 loopback，阻断外网及 Unix socket；子 Node 继承隔离 preload。隔离自测通过。日志记录拦截的方法和路径，不含文件内容。历史测试定位错误及其修正日志保留；它们不记作行为测试失败，也不改写历史验证结果。

**打包与第三方来源**

- `.vercelignore` 的输入规则保留新会话模块、会话处理器、公共后台 JS 和迁移候选；`api/admin.js` / `api/public.js` 的 includeFiles 覆盖新增 `.js` 模块、处理器及迁移。`.mjs` 通过已有字面量动态 import 引用，实际 bundle 内容仍为 **NOT RUN**。
- Verify 发布脚本的 PACKAGE_PATHS 与 Docker COPY 覆盖 api/server/js/supabase 等所需目录；KC Docker `COPY . .` 及其窄范围 dockerignore 保留新模块、lib/public/vendor 文件。只检查输入关系，未执行部署脚本、构建、打包上传或预览。
- 在隔离子进程仅调用 `shouldCopyStaticAsset`，确认 `js/admin-access.js` 纳入公开静态资源，api/server/services/supabase 不被静态公开。没有调用 buildStaticOutput/runVercelBuild。
- 本地 Lucide 0.468.0 的 JS 与许可证已对照 npm 包核验。二维码生成器对照 qrcode-generator 1.4.4 的 tarball 完整性通过，保留一处已记录的 `renderTo2dContext` 坐标修正，状态为 **PASS_WITH_DOCUMENTED_LOCAL_PATCH**，不能描述为逐字节完全一致。本轮补齐二维码库许可证及来源记录，未执行下载代码或 npm 生命周期。来源核对不等于第三方漏洞评估。

**证据与恢复边界**

本轮最终证据目录：`/Users/wangyongchao/.codex/backups/security-delivery-20261108-134108`（目录权限 0700，内部证据文件 0600）。包含 31 个当前范围文件快照、SHA256、测试清单和日志、隔离运行器及自测、打包与来源核对、Git 身份/工作区状态以及范围内聚合 patch。源码快照中的报告含本记录；30 个源码/测试/迁移/第三方记录文件在归档前均与静态检查哈希一致。

该 patch 是选定文件相对 HEAD 的完整聚合差异，可能含前阶段或其他任务在同一文件的修改，**不能当作只包含本轮的干净补丁直接发布**。新增文件以 source-snapshot 和 manifest 保存；没有擅自清理、重置或拆分其他任务工作。

下列已有恢复备份全部保留：

- `/Users/wangyongchao/.codex/backups/security-20261108-091130`
- `/Users/wangyongchao/.codex/backups/security-implementation-20261108-114345`
- `/Users/wangyongchao/.codex/backups/security-sensitive-read-followup-20261108-130125`
- `/Users/wangyongchao/.codex/backups/security-response-race-20261108-130719`
- `/Users/wangyongchao/.codex/backups/security-final-boundaries-20261108-131539`

第二份备份 manifest 声明的 314 个归档文件已逐项回读并核验 SHA256；3 个不在增量归档内的干净跟踪文件另从记录的 Git base 验证可读。初始校验曾把两个缺失哈希相等误当作匹配；已纠正为严格成员/哈希检查加独立 Git base 校验，保留初始记录和纠正说明。最终状态 PASS，不影响应用代码和行为测试。

这些是增量源码归档加 Git base，以及本地交付证据，**不是数据库、服务器或机密恢复备份**。前阶段报告 `docs/security-hardening-2026-11-08-local-review.md` 保持原文，其中旧 KC 3 文件 132 PASS 和旧 23 文件快照仍属于历史阶段，不改写成本轮成绩。其归档前 SHA256 为 `af484b62500d0a6f3ae6d1a924d7b01c69aaaf9d564948c0a1fe2121be57f5c5`。

**尚未验证、不能提高为 PASS 的事项**

| 项目 | 状态与下一步 |
| --- | --- |
| 数据库迁移应用、实际授权与并发撤销 | **NOT RUN**；需获准后，在已核验的隔离数据库先应用迁移并验证实际角色权限、锁与事务行为 |
| 主站/TG/KC 完整浏览器及供应商联调 | **NOT RUN**；需验证实际登录退出、因子切换、充值/购买、支付回调与交付边界 |
| Vercel bundle、Verify/KC Docker 实际产物 | **NOT RUN**；当前只有静态输入证据，不能替代实际产物验证 |
| 生产防火墙、主机配置、服务健康及发布 SHA | **NOT RUN**；本轮没有访问或调整生产环境 |
| Vercel、KVM4 Verify、NewAPI service-slot、独立 KC、TG/guest worker 发布 | **NOT RUN**；当前工作区仍需整理完整候选、恢复证据与发布清单，任何上线另需用户授权并按 AGENTS.md |
| TG/游客功能开关与真实订单 | **未启用、未创建**；部署本身也不构成功能启用授权 |

仍不能保证所有攻击路径均已排除；本轮交付是可复核的本地修复与验证记录。外部盗站帖及评论的原因未可靠取得，不能据此认定事故根因或声称本站已排除同因。
