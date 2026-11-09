# 归档日志的 Git 可见性

归档后检查发现根 `.gitignore:4` 的 `*.log` 隐藏了 16 份原始测试/语法日志。此目录新增局部 `.gitignore`，仅对 `raw/*.log` 解除忽略，让未来审阅发布清单时能看见这些证据；没有暂存或提交。

`evidence-manifest.initial.json` 保留首次封存清单。它描述的原始文件均未修改；最终 `evidence-manifest.json` 增加此说明、局部规则和首次清单的哈希。两个清单都可核验，源码及测试结果未变化。

生成归档的 `archive-procedure.py` 保留初次归档过程。局部规则和本说明为其后的可见性补充，不将归档脚本当作测试执行记录。
