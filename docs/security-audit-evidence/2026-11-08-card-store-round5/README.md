# 第 5 轮 KC 归属释放与锁顺序证据

报告：`docs/security-card-store-hardening-round5-2026-11-08.md`。

- `baseline-and-boundaries.json` 和两个 expanded status 清单：Git 基线、dirty 状态、隔离与 NOT RUN 边界。
- `backup-manifests/`、`backup-verification.json`：三份逐文件 dirty 快照哈希及读回结果。原快照留在 JSON 指向的 /tmp 路径；不是完整工作区/数据库备份。
- `delta/` 和 `delta-recovery-verification.json`：对本轮修改前文件的精确增量；在临时字节副本逆向恢复并核对修改前哈希。不是 HEAD 到当前完整发布清单。
- `raw/`、`raw-provenance.json`、`verification-results.json`：原始中断、失败、中间通过、最终通过、命令和退出码。最终定向 151 + 306 = 457 PASS；全量为 1672 PASS / 40 FAIL，退出 1；UI 两项复跑仍 FAIL。
- `full-regression-comparison.json`：与第 2 轮历史失败按文件/fullName 对照，36 重复、4 新观察；不改历史结果。
- `source-manifest.json`：归档时未提交源码哈希，不追认干净候选提交。
- `whitespace-results.json`：无空白诊断，no-index 有差异退出 1，不能报成退出 0。
- `packaging-boundary.json`：仅静态 KC Docker 包含关系，线上镜像/host compose 未核验。
- `log-pattern-scan.json`：有限的凭证形态扫描，不是完整无秘密证明。
- `final-integrity.json`：归档后复核原状态行保留、源码/历史证据哈希、Git HEAD/index/staging 和备份。
- `evidence-manifest.json`：除自身外的归档文件与报告哈希；不自称不可篡改的签名证据。

未执行提交、推送、PR、部署、SQL、真实数据库连接、真实支付或生产配置变更；线上未生效。未闭环风险见报告第 6 节。
