# Supabase 吞吐分担审计与实施清单

审计日期：2026-10-29（Asia/Shanghai）

代码基线：`9748be9c8373edd617ec15b7b5c0d52865554f14`，与本次 fetch 后 `origin/main` 相同。

范围：本地只读代码审计；只新增本文档，未修改运行时代码、执行 SQL、访问业务记录、迁移、付款或部署。

> 阶段说明：§1–§5 保留 2026-10-29 初始只读审计时的原始记录；其中“本轮”“未修改运行时代码”及 NOT RUN 均指该阶段。后续本地实现与验证结果追加在 §6，不覆盖前一阶段结果。

## 1. 决策与证据边界

先复用现有 R2/CDN 和公共目录缓存，缩减工作台重复读取，保留 Supabase Auth、订单、余额和结算。此方案不是免费容量承诺。账期内 46.63446 GB 的来源尚未获得响应字节与服务拆分证据，不能全部归因于图片或工作台。

用户此前提供的历史账期为 2026-09-10 至 2026-10-09；既有日志审计只覆盖暂停后的 540/OPTIONS，请勿拿这些错误请求解释历史成功响应的流量。

源码能力不等于生产启用；迁移 SQL 文件存在不等于已应用。本文不核定最新套餐额度或计费规则，不新增 Cloudflare/其他平台订阅。

## 2. 文件与 URL 迁移清单

| 数据位置 | 字段 | 已有实现/工具 | 下一步与权限边界 |
| --- | --- | --- | --- |
| shop_products | icon_url, image_assets | upload-avatar 的 product 类型 → R2 products/，含卡片变体 | 统计旧 URL；只迁公开展示图，核对变体和原图 |
| profiles | avatar_url | upload-avatar → R2 avatars/ | 确认头像公开策略与更换后的缓存更新，不能只按扩展名判断公开 |
| prompts | images, image_assets | upload-to-r2；migrate-prompt-images-to-r2.js | 核对全部变体；迁移脚本主要处理 images，不得假设自动覆盖 image_assets |
| prompt_comments | image_url | upload-avatar 的 comment 类型 → comments/ | 核对评论及附件可见性，再决定公共 CDN 或鉴权访问 |
| guestbook_messages | image_url | upload-avatar 的 guestbook 类型 → guestbook/ | 核对隐藏/删除内容策略，先公开可见图片 |
| chat_messages | content（image 类型） | ChatWidget 调用 upload-avatar；migrate-chat-images-to-r2.js | 私聊附件须单独审查访问控制，不能直接放入公开 CDN |
| homepage_config | content（嵌套对象） | admin-homepage 调用 upload-avatar → homepage/ | 公开配图优先；嵌入 base64 也应统计，它会扩大数据库响应 |
| ai_image_tasks | reference_image_url/path, metadata 等 | 工作台上传链路待结合调用路径核验 | 参考图可能私密，不自动公开；统计 URL 与内联图像体积 |
| ai_image_results | image_url, original_image_url, storage_path, original_storage_path, metadata | _ai-image-models.js 已实现 R2 上传，默认 cdn.fatherkey.com | 审计预览图/原图各自位置与权限，不能假设 AI 图片仍放 Supabase Storage |
| ai_image_download_events | image_url/original_image_url 和路径 | usage/download 查询读取历史引用 | URL 字段可重复引用同一文件，统计唯一对象与引用次数，避免重复搬运 |

现有只读工具：`scripts/audit-image-delivery.js`，入口 `npm run audit:image-delivery -- --max-examples 0`。它读取前七张表并列出四个旧 bucket 的配置；它不覆盖 AI 三表、文件字节、下载量、签名路径完整分类，也不能证明公开访问权限。缺表/列可能被标为 skipped；不能把 skipped 当作零记录。

旧 bucket 候选为 prompt-images、comment-images、chat-assets、chat-images。桶锁定脚本和迁移会修改桶配置，迁移前禁止直接执行，否则可能先把仍在使用的图片切断。

静态 URL 扫描：根目录与脚本中的 .js/.ts/.html/.css/.json，排除 services、tests、supabase、vendor、node_modules、package-lock。找到 180 个 `https://cdn.fatherkey.com` URL 字面引用、分布于 28 文件；没有找到完整 `.supabase.co/storage/v1/` URL 字面引用。此数包含工具及样例，不是线上资源数，不包含数据库动态 URL、拼接 URL 或完整资产清单。

线上清单建议仅记录：表/字段、脱敏记录标识、域名、bucket、public/sign/authenticated 路径类别、唯一对象数、引用数、文件字节和可见性。不要把签名 token、会话、聊天正文或完整私密 URL 写入报告。

## 3. 请求优化清单

| 优先级 | 入口/代码 | 当前事实 | 拟修改及验证 |
| --- | --- | --- | --- |
| P1 | js/ai-image-workbench.js 的 scheduleRemoteRecordsPoll/loadRemoteRecords | 生图忙碌时 700ms×6、1200ms×42，之后 2200ms；快速阶段每六轮才取 usage，常规阶段每轮取；有任务/待原图才持续轮询 | 拆分状态与历史刷新，后台标签页退避；恢复前台立即同步；保留任务完成停止和原图就绪机制 |
| P1 | public/ai-image.js 的 listTasksHandler | 客户端 limit=40；TASK_SELECT 含 prompt/result_prompt/metadata/token_usage；关联 RESULT_SELECT 无显式行数限制，含 prompt/revised_prompt/metadata | 新增轻量状态/增量读取，历史仅首次/按需读取；先核对序列化和前端依赖，不能直接删字段或截断多结果 |
| P1 | public/ai-image.js 的 usageHandler | 客户端 limit=40，同时读 usage（含 raw_usage）和 downloads；响应重复暴露多组兼容键 | 普通轮询不重复拉完整历史；仅任务结算/用户打开用量页等必要时刷新；诊断字段按需读取；兼容键删改须审查全部消费者 |
| P1 | listTasksHandler 的 maybeRecoverTaskWithResults / maybeReconcileSub2ApiActualCostTask | GET 列表包含条件性恢复、上游对账路径，不是纯查询 | 缓存/拆分前保留恢复与扣费幂等语义；不能因降低读取而丢失结算与余额更新 |
| P2 | estimateQueueForTasks | 队列估算条件下查询最多 200 行 | 测量触发频率，评估服务端短缓存；缓存不得改变实际排队和计费决策 |
| P2 | public/shop.js 的公开目录 | 已有热缓存及 max-age=60/s-maxage=300/stale-while-revalidate=86400 | 先看线上响应头与命中率，再调缓存；按 site/language/category/view 隔离；目录缓存不用于权威结算/库存承诺 |
| P2 | 公告、分类、公开介绍 | 还未逐个确认权限及响应差异 | 建立纯公开 DTO 和短 TTL 后才允许 CDN 缓存，明确失效与更新延迟 |

常规忙碌阶段静态估算：60/2.2≈27 轮/分钟；每轮 tasks+results+usage+downloads 四次查询时约 109 次/分钟/活跃工作台。实际间隔还含网络耗时，额外恢复、鉴权和队列读取可能增加查询；不是实测 QPS 或历史账单归因。

跨平台分担建议：R2 承担已批准公开的文件下载；公共读取优先复用现有缓存；KVM4 若引入短缓存，必须按用户/site/权限隔离并处理失效，先确认容量与 Redis 使用边界。暂不同时引入多个 BaaS 数据库。

私有 tasks、usage、订单、余额、聊天正文与签名 URL 不进共享公共缓存。单纯把请求经 CDN 转发而仍每次回源数据库，不算卸载数据库出站。

## 4. 实施顺序与验收

1. **完成线上只读清单（PENDING）**：核实目标 mmkugdibsaeoevliebzk；确认审计凭据只用于该目标。优先只取最小 URL 字段和分页；不执行 SQL。补充 AI 三表审计与 URL 类别/体积汇总，严禁输出私密正文和 token。大规模全表扫描本身也有出站开销，安排一次受控扫描。
2. **采样基线（PENDING）**：在服务可用时以自己的会话记录首页/商店/工作台启动、忙碌与完成场景的请求数及响应体大小，并区分浏览器响应、服务端 PostgREST 响应与文件下载；现有历史日志不可回补缺失字节。不得用他人账号数据。
3. **首批代码优化（NOT RUN）**：轻量状态读取、usage 按需刷新、后台退避和请求合并。验证生图/视频/聊天、完成恢复、原图、取消、跨用户隔离、结算及余额刷新。与基线比较同场景字节和查询数量。
4. **公共资源试点（NOT RUN）**：先公开商品或首页少量图片。保存旧新 URL 映射与文件校验，复制并验证内容/类型/CORS/缓存更新，回写前遵守生产变更与备份确认要求。保留旧文件和回退映射；不直接删除或锁桶。
5. **生产发布（NOT RUN）**：遵循 AGENTS.md 从最新 main 走 PR 和完整发布链验证；不把本次清单当作部署授权。
6. **额度决策（PENDING）**：观察完整账期及高峰、留出余量，同时核对数据库、Auth、Storage 和其他额度。仅当实测满足 Free 约束才考虑降级；不保证零故障或固定节省比例。

## 5. 本轮执行记录

- fetch origin main 成功；HEAD 落后提交数 0；开始时工作区干净、detached HEAD；未切分支或变更历史。
- 尝试 `npm run audit:image-delivery -- --max-examples 0`：FAIL，缺少 dotenv，尚未连接数据库。
- `.env.local` 和 `server/.env` 均不存在。即使补齐依赖，也还缺少此工具所需的连接配置。本轮未寻找、输出或复制服务密钥。
- 当前浏览器项目 URL 来自界面上下文；未在本轮读取已登录控制台内容，不推定项目状态、配置或线上记录数。
- 本文是源码清单，不是线上迁移完成证据。运行时代码测试/线上数据审计/迁移/发布均 NOT RUN。


## 6. 本地首批实现与验证（2026-10-29）

### 6.1 范围、基线与恢复点

本阶段实现工作台请求合并、隐藏页面停止自动轮询和账号切换后的记录响应失效处理。§4 第 3 项仅完成上述子集；轻量状态接口、usage 历史精简、生产流量采样仍为 PENDING。公共资源迁移及生产发布均为 NOT RUN。

- 工作分支：`codex/supabase-egress-reduction`。
- 唯一远端：`origin = https://github.com/zaoyoe/Zaoyoe-Studio.git`。
- 实现基线：`9748be9c8373edd617ec15b7b5c0d52865554f14`；修改前再次 fetch，`HEAD..origin/main` 为 0。提交后的候选 SHA 以该分支 Git 记录为准。
- 切分支/实现前的恢复提交：`13c82657e3423a7ea16fbf15a65447d7c415b44e`。
- 恢复引用：`refs/codex-backups/supabase-egress-20261029-before-implementation`；原始审计文档已从该提交读回核对。
- 恢复提交通过临时 index 记录原有 tracked/untracked 内容，未覆盖实际 index。它是实现前恢复点，不能替代后续生产发布前的完整恢复核验。

### 6.2 变更清单

| 文件 | 行为/用途 | 生产归属 |
| --- | --- | --- |
| `js/ai-image-workbench.js` | 合并进行中的记录读取；强制刷新只保留一轮待续读取，并保留 usage 刷新意图；隐藏页面清除定时器，恢复前台同步；轮询与前台刷新共享恢复链；用户状态切换后忽略旧记录响应 | Vercel 前端静态文件；已用 `shouldCopyStaticAsset()` 核验为 true，尚未构建/部署 |
| `tests/ai-image-workbench-polling.test.js` | 18 项行为测试，执行实际函数，模拟请求、计时器和可见性，覆盖合并、错误重试、账号切换、原图就绪、完成用量刷新和慢恢复请求 | 本地/CI 测试，不属于静态发布文件 |
| `tests/ai-image-workbench-api-contract.test.js` | 更新恢复回调断言以匹配账号/可见性守卫，保留原有恢复契约 | 本地/CI 测试 |
| `docs/supabase-egress-offload-plan-2026-10-29.md` | 保留初始审计，追加本阶段范围、验证和未完成条件 | 运维证据，不属于静态发布文件 |

本阶段没有数据库迁移或 SQL 应用项，也未变更后端计费、Auth、订单、余额及 R2 配置。任务完成后的完整用量读取、卡住任务的 client-id 恢复、原图轮询上限仍有测试覆盖。任务/用量响应字段与历史列表大小仍沿用现有接口，响应体精简属于后续工作。

### 6.3 验证与证据

最终相关回归命令：

```sh
node --test --test-reporter=tap \
  tests/ai-image-workbench-polling.test.js \
  tests/ai-image-workbench-api-contract.test.js \
  tests/public-ai-image-handler.test.js \
  tests/ai-workbench-billing-v2.test.js \
  tests/ai-image-runtime.test.js \
  tests/ai-image-worker.test.js
```

最终结果：**318 tests / 318 PASS / 0 FAIL / 0 skipped / 0 cancelled**。本地 TAP：`/tmp/fatherkey-egress-ai-regression-20261029-final.tap`。

同时通过运行时及新增测试的 `node --check`、`git diff --check`。静态产物规则确认运行时 JS 会复制，测试和本文不会作为公共静态资源复制。没有启动本地预览或构建，因此这不是浏览器交互或生产运行证据。

验证过程保留如下边界与纠正记录：

- 修改前原有前端契约：68 PASS / 0 FAIL。
- 初次扩大回归范围时因缺少 dotenv/sharp 失败；执行 `npm ci --ignore-scripts --no-audit --no-fund` 安装 211 个包，package/lock 文件未修改。随后 317 项相关回归全部通过，原日志为 `/tmp/fatherkey-egress-ai-regression-20261029.tap`。
- 最后复查新增“恢复请求未完成时不得排下一轮轮询”测试，先得到 1 FAIL，复现了提前排定时器的问题；修正后前端相关测试 86 PASS / 0 FAIL，最终上述六文件回归为 318 PASS / 0 FAIL。
- 模拟证据：10 个同时初始读取只发 1 次 tasks + 1 次 usage；进行中的 tasks-only 读取收到 8 次强制刷新后，只追加 1 轮 tasks + usage。该数字是测试场景请求数，不是生产节省比例。

运行时/测试 SHA-256（最终回归对应内容）：

```text
7845d989edd3f14089c78c5d2d7640551e605c837f4d835ede9a4f7ceb010a2a  js/ai-image-workbench.js
ef45b2d93d56f8440a3663b6b5679c0327b1a8b73083ece9bc7c189249e54b84  tests/ai-image-workbench-api-contract.test.js
0c95c875e22d23286840c0a19d75e36ee194ef4b5f12d31497b73db6a9134c9f  tests/ai-image-workbench-polling.test.js
```

### 6.4 线上审计状态与下一步

依赖补齐后重试 `npm run audit:image-delivery -- --max-examples 0`，在连接前报错：`Missing Supabase URL: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_URL`。本地缺少审计所需连接配置；数据库记录数、唯一 Storage 对象数及字节均未读取。该失败不能记为零数据或审计通过。

已登录浏览器的 tab 清单可见，但读取 Supabase tab 的连接返回 `browser.user is unavailable`，因此本阶段没有重新核实控制台项目、账单或用量。原生 Codex app 访问另被工具安全规则拒绝，未通过其他途径绕过。界面上下文 URL 与 tab 标题不作为控制台状态证据。

后续按以下顺序继续：

1. 恢复授权浏览器的读取连接或配置目标项目的受控只读连接，核实项目 `mmkugdibsaeoevliebzk`；运行最小字段分页盘点，补充 AI 三表和唯一对象/引用统计，避免输出完整私密 URL。
2. 在服务可用时记录同一场景的前后请求数、PostgREST 字节与文件字节；随后评估轻量状态接口、usage 按需刷新和现有公开目录缓存命中率。
3. 从已确认公开的商品/首页图片选小批 R2 试点，先准备校验和、URL 映射与回退记录；数据库回写与权限变更继续遵守生产变更要求。
4. 本地候选完成后，生产发布仍单独按 AGENTS.md 执行 PR、检查、合并及三条部署链验证。本阶段没有推送、PR、合并或部署；三条生产链均 NOT RUN。

实际 Egress 降幅、历史 46.63446 GB 的来源分布、Free 套餐能否承载当前业务均为 **PENDING**。本地通过测试不表示线上账单已停止、网站已恢复或 CDN 迁移已完成。
