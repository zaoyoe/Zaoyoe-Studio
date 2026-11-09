# 第 4 轮 KC 本地结算证据

关联报告：`docs/security-card-store-hardening-round4-2026-11-08.md`。

- `baseline-and-boundaries.json`：基线与本轮边界；两个展开 dirty 清单；归档本身会新增文档路径。
- `backup-verification.json`、`backup-manifests/`：8 份预存哈希核验通过，另 3 份无预存 manifest 的快照只证明本次可读。原逐文件备份保留在 JSON 指向的 `/tmp` 位置，不是全工作区备份。
- `delta/`：对本轮修改前 dirty 备份的差异；不能作为 HEAD 到当前完整发布清单。
- `raw/`：原始失败、中间通过、最终通过、语法与空白检查；未覆盖历史失败。
- `verification-results.json`：最终 107 + 185 = 292 定向通过。命令和退出码整理自会话，原日志按字节复制。KC 全量本轮 NOT RUN。
- `whitespace-interpretation.json`：保留 no-index 原退出 1，以本机对照解释；未因包装脚本误判而改源码。
- `source-manifest.json`：归档时当前文件哈希，不是干净候选提交或对以前运行的追溯绑定。
- `packaging-boundary.json`：静态 KC/Verify 包含范围，生产 NOT RUN。
- `raw-provenance.json` / `evidence-manifest.json`：复制源、字节一致性与归档哈希。

测试隔离工具是 Node API guard，不是 OS 沙箱。`run.py` 中绝对路径指向原 `/tmp/security-test-isolation-20261108/`；原文件保留。若复现，请输出到新的日志文件，勿覆盖归档及原始失败记录。round4 原生测试基线覆写环境名是 `KC_LOCAL_STORE_SOURCE`，而 launcher 的 `--baseline-store` 设置的是其他测试使用的 `KC_ATOMIC_STORE_SOURCE`；两者不可混用。

没有执行 SQL、真实数据库/支付、部署或生产 worker。本轮没有主站/TG/WAF 运行时验收。报告中的后续事项保持待办，归档不表示批准上线。
