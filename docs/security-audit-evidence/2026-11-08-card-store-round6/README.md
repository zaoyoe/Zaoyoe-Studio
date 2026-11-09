# 第 6 轮 KC 银行卡锁归属证据

报告：docs/security-card-store-hardening-round6-2026-11-08.md。

- baseline-and-boundaries.json、两个 expanded 状态清单：Git/dirty 基线、隔离和 NOT RUN 边界，以及本轮范围外改动的记录。
- backup-manifests/、backup-verification.json：7 份逐文件 dirty 快照清单和读回核验；快照字节仍在记录的 /tmp 路径，不是完整工作区或数据库备份。
- delta/、delta-recovery-verification.json：7 个已存在文件和 2 个新测试的本轮精确增量；仅在临时字节副本逆向恢复并正向重放核对哈希，未 restore 工作区。
- raw/、raw-provenance.json、verification-results.json：原始失败、中间和最终日志；4 个最终调用合计 710 PASS / 0 FAIL；历史第 5 轮全量 40 FAIL 保留，本轮未重跑。
- source-manifest.json：归档时 dirty 源码哈希，不是干净发布候选，也不是原测试执行瞬间不可变证明。
- raw/syntax-results.json、whitespace-results.json：9 个 JS 语法结果、逐文件 delta 空白检查的真实退出码。
- packaging-boundary.json：只验证静态 KC Docker 包含关系；未构建镜像、未验收任何生产运行版本。
- log-pattern-scan.json：复制日志前有限形态扫描，不是完整无秘密证明，不输出匹配值。
- final-integrity.json、evidence-manifest.json：归档后的本地完整性检查与文件哈希；不是签名证据。

源码与调用测试的初始/中间版本未全部快照化，命令和退出码部分来自会话记录，详见 raw-provenance.json。离线状态模型不代替真实 MySQL、实际扣款、崩溃恢复或生产验收。

未暂存、未提交、未推送、未创建 PR、未部署、未执行 SQL、未连接真实数据库或进行真实支付；本地修复尚未上线。未闭环的支付持久恢复、超时/批量清理和相同 owner 重入风险见报告。

归档收录补充：最终核验发现根目录 `*.log` 规则忽略了本轮 10 份原始日志。本目录新增 `.gitignore`，仅为 `raw/*.log` 添加收录例外；日志原字节和测试结果未改写。补充前后哈希、Git 可见性及工作区复核记录见 `archive-inclusion-verification.json`。`final-integrity.json` 保留补充前的检查时点，最新检查以该补充记录为准。

补充核验边界：本轮 9 个变更文件、22 个归档源码文件和第 5 轮 39 个历史证据文件的哈希均与归档记录一致；551 条原始 dirty 状态行仍保留。范围外 `js/engagement-runtime-loader.js` 的当前哈希与先前归档时不同，来源未归因，未恢复或纳入本轮补丁。整份工作区的字节一致性不能据此标为 PASS；该范围外变化记录为 REVIEW，详见 `archive-inclusion-verification.json`。本次只补日志收录和归档检查，没有重跑测试。
