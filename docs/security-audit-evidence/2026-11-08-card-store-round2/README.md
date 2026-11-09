# 第二轮安全加固证据（2026-11-08）

配套报告：`../../security-card-store-hardening-round2-2026-11-08.md`。

本目录为新建记录，不替换此前攻击审计目录或历史结果。生产部署、SQL、真实支付、worker 启动均为 **NOT RUN**。本地文件有既有未提交改动，不是干净发布候选。

| 文件 | 用途 |
|---|---|
| `baseline-and-boundaries.json` | 基线 SHA、canonical origin、dirty 清单、授权边界 |
| `source-manifest.json` | 42 个本轮实现/测试与相关回归文件的当前哈希；角色分别列出 |
| `test-results-summary.json` | 最终通过组和历史失败组；不推断全量已通过 |
| `final-commands.json` | 精确测试命令、来源及隔离重放方式 |
| `packaging-static-review.json` | 打包规则静态检查，不代表构建或部署成功 |
| `evidence-copy-index.json` | 原始输出精确副本的来源和 SHA256 |
| `backup-manifests/` | 8 份本地备份清单；备份内容仍在原 `/tmp` 路径 |
| `raw/` | 原始 TAP、Vitest JSON、执行记录、preload 与拦截路径日志 |
| `archive-integrity.json` | 归档完成后的逐文件 SHA256；它本身不自包含 |

最终定向 239 PASS、主站/TG/游客支付 166 PASS、KC 五文件串行 260 PASS。它们不能替代 KC 首次全量 **1620 PASS / 72 FAIL / 1 SKIP**；最终没有再次执行完整 KC 全量。原始失败和对照副本结果完整保留。

隔离 preload 是 Node API 层保护，允许 loopback fixture，不能称为 OS/容器沙箱。重放时使用本目录 `raw/preload.cjs` 的绝对路径，仍然不要运行带真实 env 的 KC `npm test`。不要读取真实 `.env`、连接生产数据库或把用户报告的 SQL 写成独立验证通过。
