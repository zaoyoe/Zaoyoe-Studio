# 第七轮证据索引

本地 KC 支付保护与重复付款防护；报告见 ../../security-card-store-hardening-round7-2026-11-08.md。

- verification-results.json：最终 26 个实际测试文件，1001 PASS / 0 FAIL；中间失败与缺失 selector 单列，禁止重复相加。
- runs/：已保留的命令计划、结果与 11 文件语法检查。
- logs/ 与 log-provenance.json：无匹配日志按原字节复制；有敏感形态匹配的日志是脱敏副本，原始哈希和替换数量单列。有限扫描不能证明没有秘密。
- backup-manifests/、backup-verification.json、delta/、delta-recovery-verification.json：10 个既有 dirty 文件的修改前快照读回验证，另 1 个新增测试；补丁仅含本轮增量，已在临时副本逆向恢复、正向重放。快照原件在 /tmp，不是完整工作区或数据库备份。
- source-manifest.json：本轮与验收涉及源码哈希；dirty 来源，不是发布候选。
- isolation/：环境清理和 Node 层保护程序；不是操作系统完整隔离。
- packaging-boundary.json：KC Docker 输入的静态检查；未构建、未上线。
- historical-round6-integrity.json、final-integrity.json：43 个第六轮历史文件及当前范围完整性核验。
- evidence-manifest.json：报告及除自身外证据文件哈希，避免自引用；不等于签名或不可篡改存档。

未提交、未推送、未创建 PR、未部署、未执行 SQL、未连接真实数据库、未实际付款或启动生产 worker。本轮不能验收主站、TG、NewAPI、WAF 或生产恢复。
