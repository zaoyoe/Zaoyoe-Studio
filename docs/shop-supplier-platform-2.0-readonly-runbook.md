# 商城供应商 2.0：首轮只读接入与验收记录

记录日期：2026-10-19。本文记录 P0 安全契约准备与 P1 只读开发切片；不代表 2.0 自动采购、代理 API、数据库迁移或生产发布已经完成。原规划中的 NOT RUN 是规划时点的记录，继续保留。

## 1. 本轮交付与阶段边界

Admin Studio → 商城 → 供应商目录：选择供应商、商户账号和站点，读取目录、搜索、查看详情，选择受支持的种类，读取库存与询价，再导入下架草稿。商品编辑页增加折叠的「货源与交付」只读摘要，并可从导入结果进入该草稿。

| 范围 | 当前结果 |
| --- | --- |
| 多账号基础 | 每次请求按持久化账号的 credential_ref 解析独立凭据；切换供应商、账号或站点后旧响应失效 |
| 虾仁只读 Adapter | 仅目录、详情、库存、询价四类上游请求；有签名、超时、体积限制和固定 HTTPS 主机 |
| 规格边界 | 支持默认规格与明确的 race；复杂 SKU、自定义填写、预选卡及限时配置等保留为预览，不允许绕过规格核验导入 |
| 导入 | 仅 CN；服务端重新读取详情并核验规格，通过新 RPC 原子生成产品、默认 SKU 关联、映射和审计；只读询价数量固定为一 |
| 默认状态 | 新虾仁账号停用；导入产品下架、游客购买关闭、价格/库存为零、国际价格为空、来源映射停用 |
| 重复导入 | 同账号/站点/货号/规格返回原草稿，不覆盖商品；实际锁竞争仍需数据库并发验收 |
| 现有路径 | 保留 16688 目录/导入兼容；本轮不改现有积分购买、游客支付、TG、KC、NewAPI 的运行入口 |
| P0 未决项 | 真实币种、交付枚举、询价金额口径、复杂规格及丢失下单响应后的恢复契约尚待商户核验 |
| P2–P4 | 原子订单/资金/outbox、真实采购与恢复、交付/售后、经营联动、多源路由、代理账本与开放 API 尚未实现 |

「只读」指不向上游创建订单或扣款；导入草稿是经过管理员授权的本地数据库写入。代码中没有新增虾仁采购 worker、购买开关或代理公开路由。完整货源配置与采购运营界面留在后续切片。

## 2. 来源与恢复记录

- 分支：codex/shop-supplier-platform-2。
- 声明的唯一远端：https://github.com/zaoyoe/Zaoyoe-Studio.git。
- 本轮基线 HEAD / origin/main：e9db00863fddaaab782c00aef14bb1bd21040314；最终复测前 fetch 后 HEAD..origin/main 为 0。
- 初始恢复引用：refs/codex-backups/supplier-platform-2-20261019-114430，提交 9b6936de9482265562a520dd0c00418b8614e806。它保存起始资料，不包含后续实现。
- 本轮实现的恢复引用：refs/codex-backups/supplier-platform-2-p1-20261019-final；收尾时用独立临时 Git index 保存全部受版本管理和非忽略未跟踪文件，并逐文件读回核验。它是恢复快照，不是已发布的候选提交；分支 HEAD 不因该备份前移。
- 当前实现包含工作区差异，尚未形成干净发布候选，未 push / PR / merge / deploy。后续发布仍须按 AGENTS.md 重新核对最新 main、变更清单、完整测试和所有生产链 SHA。

### 2.1 完整变更清单

| 文件 | 用途 |
| --- | --- |
| admin-studio.html | 供应商/账号选择、详情操作、商品货源摘要与资源版本参数 |
| js/admin-shop.js | 只读工作区、规格预览/导入、上下文与过期响应隔离 |
| css/admin-studio-page.css | 供应商界面、详情骨架、窄屏及亮暗主题的局部样式 |
| server/.env.example | 无实际值的商户环境变量说明 |
| server/integrations/suppliers/contract.js | 增加库存读取能力契约 |
| server/integrations/suppliers/registry.js | 按账号与凭据引用创建 Adapter，保留旧提供商兼容 |
| server/integrations/suppliers/xiareng/client.js | 虾仁只读协议、签名、归一化和规格门禁 |
| server/api-handlers/admin/shop/supplier-catalog.js | 管理员权限、账号、目录/详情/询价、原子草稿导入和映射摘要 |
| supabase/migrations/20261019_shop_supplier_platform_v2_readonly.sql | 增量字段、唯一索引、停用账号、service_role 专用草稿 RPC |
| supabase/migrations/20261019_verify_shop_supplier_platform_v2_readonly.sql | 只读结构核验；不请求商户、不导入、不验证真实并发 |
| tests/admin-shop-supplier-catalog-handler.test.js | 管理 API、隔离、导入与兼容回归 |
| tests/admin-shop-supplier-workspace.test.js | 执行实际前端脚本，核验账号切换、过期响应、规格和导入反馈 |
| tests/shop-supplier-xiareng-client.test.js | 签名向量、规范化、错误、边界及账号凭据隔离 |
| tests/shop-supplier-v2-migration-contract.test.js | 静态 SQL/权限/默认关闭与产物路径契约；不执行 SQL |
| scripts/smoke-shop-supplier-readonly.js | 使用实际界面代码的隔离浏览器模拟检查与来源诊断 |
| docs/shop-supplier-platform-2.0-plan.md | 2.0 计划；末尾追加本轮进度链接 |
| docs/shop-supplier-platform-2.0-readonly-runbook.md | 本操作手册和分层验收记录 |

产物路径静态检查：Vercel 的 ignore 规则保留 server/integrations；既有 admin 入口包含 supplier-catalog；KVM4 打包清单和 Docker 输入包含 server、js、scripts、docs、supabase。生产构建与容器文件实际落地仍为 NOT RUN，不能用路径检查替代部署核验。

## 3. 数据库准备：交由用户执行

Codex 未执行任何 SQL，也没有连接数据库应用或验证本迁移。

先确认既有商城表、审计表、20260523_add_shop_product_skus.sql 的默认 SKU 触发器，以及 20261006_add_shop_supplier_catalog_core.sql 已就绪。旧环境不应在未核对已有迁移历史时批量重放全部迁移。

由用户审核并按顺序执行：

1. supabase/migrations/20261019_shop_supplier_platform_v2_readonly.sql。
2. supabase/migrations/20261019_verify_shop_supplier_platform_v2_readonly.sql。

首份迁移将旧映射默认保留为 default 规格，唯一性扩展为账号/站点/货号/规格。已有币种值保留；新未知币种不再默认为 CNY。商品创建、映射和审计在一次 RPC 事务中完成，缺少默认 SKU 则整体报错回滚。没有删表、清空业务数据或修改已有商品发布状态。

第二份脚本是只读事务，核验字段、唯一索引、RLS、默认 SKU 触发器、固定 SECURITY DEFINER search_path 和 service_role 执行权限。预期结果包含：

> Supplier P0/P1 structural checks passed; concurrent/merchant/business acceptance remains NOT RUN

这句话只证明本脚本覆盖的结构通过，不能把商户、并发、退款或业务验收改记为 PASS。若提示 RPC/默认 SKU/权限未就绪，先保留失败结果，再核对迁移顺序；接口不会降级成非事务的虾仁导入。

## 4. 账号配置与只读联调

商户凭据只配置在服务端受保护环境，不写入浏览器、商品、数据库明文凭据列、聊天或日志。当前没有收到或使用用户的 app_id/app_key。

| 账号引用 | 服务端变量 |
| --- | --- |
| env:SUPPLIER_XIARENG | SUPPLIER_XIARENG_APP_ID、SUPPLIER_XIARENG_APP_KEY、可选 SUPPLIER_XIARENG_CURRENCY、SUPPLIER_XIARENG_TIMEOUT_MS |
| env:SUPPLIER_XIARENG_SECOND | 同前缀加 _SECOND，再接 _APP_ID / _APP_KEY / _CURRENCY / _TIMEOUT_MS |

第二账号需要独立的 shop_supplier_accounts 记录、唯一 account_key 和对应 credential_ref；本轮仅提供账号选择与按账号解析，没有增加密钥编辑界面。16688 继续使用其独立的 SUPPLIER_16688[_账号] 引用，不能跨供应商读取凭据。

CURRENCY 留空表示待核验；只有商户结算币种已获得明确证据后才填写三位币种代码。TIMEOUT_MS 默认 10000，有效范围限制为 500–30000。商户接入如要求 IP 白名单，需核对真实 KVM4 出口，不使用本地预览出口代替。

迁移创建的虾仁账号 is_enabled=false。需要进行真实只读联调时，由操作者审核服务端配置并单独允许该账号只读访问；不要因此启用商品、映射或游客购买。生产服务的环境重载必须使用已有运行手册中的受控步骤，不能把本手册当成部署授权。

只读验收顺序：

1. 用有 shop.manage 权限的管理员打开供应商目录；无凭据/账号停用应显示明确原因，不能悄悄改用其他账号。
2. 对照商户后台的目录、货号、会员采购参考价和种类。缺少会员价格时不得拿游客价补齐；币种未知仍显示待核验。
3. 对一个普通商品读取详情、库存、数量一询价；保存脱敏的响应时间、规格、金额和界面结果。报价未锁库存，单价/总额口径未知，不形成结算价。
4. 分别核验默认规格、race 规格、复杂 SKU/填写项商品。受限商品仍可查看，但导入必须被阻断。
5. 在隔离验收环境导入标准草稿，确认产品下架、游客关闭、映射关闭、国际价格为空；从结果进入编辑页并看到货源摘要。
6. 切换两账号和两站点，故意让旧请求延迟；确认目录、详情、询价和导入反馈不会串到新上下文。虾仁非 CN 导入应阻断。

不得把上游价格/库存快照当成交付保证；delivery_way 的数字目前不推断为自动或人工交付。查询不到上游订单、超时或 paid 状态，也不能作为未发货/已交付结论。

## 5. 数据库并发与失败验收：NOT RUN

以下必须在用户审核的隔离验收环境另行执行并归档；静态契约测试不替代这些证据：

| 场景 | 预期观察 |
| --- | --- |
| 两个独立请求同时导入同账号/站点/货号/规格 | 相同 productId / mappingId，只有一份产品、映射和导入审计；重复方返回 already_imported |
| 同货号不同 race | 形成独立规格身份；不覆盖既有映射或价格 |
| 同货号不同账号/站点 | 不跨作用域复用映射；虾仁非 CN 保持阻断 |
| 导入后再次请求 | 返回原草稿，商品字段、发布开关和库存没有被覆盖 |
| 默认 SKU 或审计写入故障 | 整次导入回滚，没有孤立产品或半份映射 |
| 与账号停用并发 | 锁序和结果可解释；停用生效后新导入不能成功 |
| anon / authenticated 直接调用 RPC | 权限拒绝；只有受权限保护的服务端路径可正常调用 |

## 6. 本轮已运行的验证

所有结果针对上列基线上的工作区实现，不能作为生产版本证据。

| 证据 | 结果 | 范围与限制 |
| --- | --- | --- |
| 相关自动回归 | PASS：94 文件、971 测试，971 通过、0 失败、0 跳过、0 取消 | admin-shop、guest-shop（含历史 archive）、shop-supplier、shop-cart、shop-auth-login-prompt |
| 供应商子集 | PASS：69 测试 | 包含上表 971 中，不能重复相加；SQL 测试为静态契约 |
| JS 语法 | PASS：10 文件 | Adapter、注册、契约、handler、前端、4 测试文件、浏览器脚本 |
| 浏览器模拟 | PASS：4 场景 | 1440×1000 / 390×844，亮/暗；目录无横向溢出、工具栏高度、详情骨架/尺寸、规格门禁、询价、导入反馈 |
| 数据库应用/结构实际运行 | NOT APPLIED / NOT RUN | 迁移与 verify 文件已写出，未执行 |
| 真实商户凭据与请求 | NOT RUN | 未读取余额、未创建采购、未进行真实目录联调 |
| 事务竞争/真实业务/生产部署 | NOT RUN | 需独立证据及适用授权 |

回归执行清单：/tmp/supplier-v2-regression-manifest-20261019.json；完整输出：/tmp/supplier-v2-regression-20261019.log。浏览器来源：e9db00863fddaaab782c00aef14bb1bd21040314 + workingTree=true，UI 源文件组合 SHA256：0a577e3538577f1d913adaba680b2068862d0c04b026fbc01f351fe72a68dc97。

浏览器报告和 12 张截图：/var/folders/wl/8wb6rp_13z17vf97m3fkk0dw0000gn/T/supplier-readonly-smoke-wOOZU5/report.json。该脚本使用实际管理台 HTML、CSS、admin-shop.js 和模拟 AdminApi，临时端口与独立 Chrome 配置；未占用或刷新 8000，未访问真实商户/数据库。外部图标字体在隔离 fixture 中不加载，因此截图的图标留白不是生产验收结论。

本轮浏览器检查曾先发现 390px 商品说明溢出，修正了名称/说明布局、文字换行及亮色提示对比度后，上述最终四场景通过。早期失败日志不作为通过证据；最终结果以所列来源摘要为准。

后续可复测：

```sh
node scripts/smoke-shop-supplier-readonly.js
```

Chrome 默认路径为 macOS Google Chrome，也可通过 CHROME_BIN 指定本机可执行文件。每次生成独立来源诊断和临时截图目录，不读取项目环境密钥。

## 7. 下一阶段进入条件

P2 首个切片应先固定并实现原子订单/资金/outbox。真实采购入口继续关闭，直到商户明确回答：创建请求是否有可复用的业务幂等键、丢失创建响应且拿不到 tradeNo 时如何找回原请求、价格与币种口径、交付内容与终态、退款/拒单证据。

即使暂时无法得到恢复保证，也可以先实现和测试订单/资金/outbox 的内部契约；不能用盲目重试下单、切换上游或把超时当失败补发来填补上游契约缺口。经营数据、促销回写和代理 API 必须依赖同一套已验证交易事实，未知采购成本不填零，也不能重复统计充值和积分消费。

## 8. 2026-10-19 用户执行反馈与后续切片（追加）

用户反馈「已执行 sql，继续下一步」。记录为 P0/P1 SQL 已由用户报告执行；未提供实际结果、环境或结构输出，Codex 未连接数据库，因此第 6 节原 NOT APPLIED / NOT RUN 保留为首轮交付时点的历史记录。本次反馈不改记商户、并发或业务验收 PASS。

随后准备 P2A 内部资金事务边界：绑定真实原订单、匹配资金凭据、预算占用、采购意图、blocked outbox 和事务事件。当前没有接通原生结算调用、上游采购或代理接口；P2 尚未整阶段完成。新两份 SQL、用户执行顺序及独立验收记录见 [P2A 资金事务边界手册](shop-supplier-platform-2.0-funding-boundary-runbook.md)。


## 9. 2026-10-19 P2B 衔接进度（追加）

P2A 后用户再次报告已执行 SQL，本次仅记录该反馈，未独立观察目标库输出。随后完成 P2B 原生积分/游客结算接线的本地开发；采购提交保持阻断，销售默认关闭。P0/P1 的历史验收与本次结算证据分别保存，不将只读能力或结构检查视为自动采购闭环。

当前完整回归为 117 文件 / 1,217 项全部通过；数据库事务/并发、真实商户和完整业务仍为 NOT RUN。新 SQL、限制及证据见 [P2B 原生结算衔接手册](shop-supplier-platform-2.0-native-checkout-runbook.md)，无需为本轮重放已报告执行的 P0/P1 迁移。
