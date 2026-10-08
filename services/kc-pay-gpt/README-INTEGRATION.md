# KC-PAY-GPT 独立服务（商城仓库托管）

本目录托管 KC-PAY-GPT 的独立运行单元。它与商城页面、商城订单和供应商适配器保持进程与代码边界隔离；商城只负责销售/发放 CDK，KC 服务负责兑换、Session 校验、充值流程和自动续费关闭。

## 目录边界

- 运行时源码与前端：本目录内；
- 生产配置：仅保存在 KVM4 `/opt/kc-pay-gpt/.env`，不得提交；
- MySQL 数据：由本目录的 Compose 服务挂载持久卷；
- 迁移 SQL：仅作为发布附件/人工执行材料，部署流程不自动执行 SQL；
- 公网入口：`redeem.fatherkey.com`；管理入口：`adm.fatherkey.com`；反向代理配置不放入商城仓库的生产 secret。

## 多平台预留

KC 是单独服务，不应复用商城的供应商 adapter registry。今后接入其它独立充值平台时，应在本目录内增加 provider contract/registry，并为每个 provider 做独立配置、测试和故障隔离；不要把平台密钥写入商城前端或提交到 Git。

## 发布原则

生产发布只能从 `main` 的合并提交触发。此目录的加入不等于启用真实充值，也不自动执行 SQL。发布前需人工核对 `.env`、数据库迁移状态、Caddy 路由及健康检查；验证阶段禁止真实扣款。
