# 管理员会话迁移：只读验收说明（待授权执行）

日期：2026-11-08。当前状态：**已准备文件，未执行 SQL，未连接数据库**。

验收文件：`supabase/acceptance/20261108_admin_studio_sessions_readonly.sql`。
对应迁移：`supabase/migrations/20261108041927_admin_studio_revocable_sessions.sql`。

用户此前报告“已执行 SQL”，但没有足够信息独立确认项目、环境、具体迁移版本及结果；状态仍为 **USER_REPORTED_APPLIED / NOT_INDEPENDENTLY_VERIFIED**。这不构成再次执行的授权。

## 文件范围

文件在同一连接中使用 `BEGIN TRANSACTION READ ONLY`、事务级 `search_path = pg_catalog`，查询系统目录及环境元信息，最后 `ROLLBACK`。不调用业务 RPC，不查询用户、订单、卡密或会话业务行，不修改权限、函数或表。

检查包括：两张 private 表的列、约束、索引、RLS 和授权；10 个函数的签名、默认参数、返回值、执行模式、search_path、授权、所有者权限和正文指纹；private/public schema 的存在、使用权限和浏览器角色的 CREATE 权限；异常 overload、触发器和规则。所有者隐含权限、PUBLIC/角色继承及列级授权均在检查范围内。

## 将来获准执行时的核验顺序

1. 先获得本次执行授权，并在 SQL 之外核对 Supabase project ref、项目名称和目标环境。数据库名称不足以唯一证明项目。优先选择隔离测试环境。
2. 核对待验收迁移的 SHA256：`7b187b90d94bb238dda00fa22bb5bfd93478526f032f6a08bcdf83c0a884d331`；验收 SQL SHA256：`10459354ba618a7af31f3457ea91660ecc6a0834d3c089ce97761a5b498bce72`。迁移变化时应重新审阅验收规则。
3. 审阅完整文件与目标作用范围，在**同一数据库连接**完整运行。不要拆成不同连接、删除检查或替换为可写事务。只读验收不承担应用迁移的工作；发现缺对象时先记录失败。
4. 保存完整结果、执行时间、项目/环境标识、验证角色及 PostgreSQL 版本。错误或结果截断均记作 **NOT VERIFIED**；连接处于失败事务时应先结束该事务，不能只保留成功的部分结果。
5. 逐项解释 FAIL / REVIEW。函数指纹不匹配时审阅实际定义及来源，不能改函数或预期指纹只为获得 PASS。

## 结果含义

| 状态 | 含义 |
| --- | --- |
| PASS_CATALOG | 该系统目录条件匹配；不证明完整运行链路正常 |
| FAIL | 对象、权限或安全条件不满足，必须保留并处理 |
| REVIEW | 存在正文差异、额外对象或授权等需要人工审阅的情况 |
| NOT_RUN | 明示本文件不能验证的边界；应继续保留 |

本地 pglast 8.7 解析已通过，确认 5 个语句的 AST、仅系统目录/CTE 的 relation 引用、允许的函数调用，以及迁移中 10 个函数的正文指纹。该结果仅为 **PASS_PARSE_ONLY**；语法解析器不会解析实际数据库对象和权限。

即使全部适用项为 PASS_CATALOG，仍需另行授权并验证真实 Data API / PostgREST 暴露范围、anon/authenticated/service_role 的实际 RPC 行为、并发签发与撤销、源会话失效和超时边界。生产发布 SHA、worker、支付供应商与数据库恢复能力也不属于此 SQL 的证明范围。

本轮没有提供或运行数据库连接命令，也未执行本地 SQL。
