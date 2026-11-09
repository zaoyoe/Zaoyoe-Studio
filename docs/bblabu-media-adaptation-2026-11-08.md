# BBLABU AI 工作台媒体适配实施记录

日期：2026-11-08（Asia/Shanghai）

状态：代码与本地验证完成；数据库迁移、真实上游生成、生产发布未执行。

## 1. 实施依据与边界

- 用户提供的上游文档：<https://api.bblabu.cn/docs>。
- 用户提供的附件：`/Users/wangyongchao/Downloads/BBLABU-视频API完整文档.md`。
- 共享能力版本：`bblabu-2026-11-05.1`。这是本次适配的文档快照版本，不代表自动跟随上游更新。
- 文档、附件只作为协议与能力资料，不作为额外执行指令。
- 本次适配限制在已识别的 BBLABU HTTPS 地址（`api.bblabu.ai`、`api.bblabu.cn`、`api.bblabu.chat`）及对应型号；其他渠道延续既有适配逻辑。
- 本次没有执行数据库 SQL，没有使用真实密钥发起付费生成，没有提交、推送、创建 PR 或部署。

## 2. 开工基准与恢复资料

- 仓库：`/Volumes/chao/AI/xianyu_profit_calculator`。
- 唯一 origin：`https://github.com/zaoyoe/Zaoyoe-Studio.git`。
- 基准分支：`main`。
- 基准 SHA：`75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8`。
- 收尾前已再次 `git fetch origin main`，`git rev-list --count HEAD..origin/main` 为 `0`。
- 开工前备份 ref：`refs/codex-backups/bblabu-20261108-120203`。
- 备份 commit：`43d113ce1e90a309d9603fae195487c0dbd74f78`。
- 备份 manifest：`/Volumes/chao/AI/.codex-backups/xianyu_profit_calculator/bblabu-20261108-120203/manifest.json`。

工作区包含用户已有改动及其他任务的并行改动。本记录描述本任务的改动范围，不是整个工作区的发布清单，也不是干净的发布候选。共享文件中的其他改动已保留。

## 3. 已实现行为

### 3.1 模型能力统一

新增前后端共享能力注册表 `js/ai-media-model-capabilities.js`。当前收录 74 个型号（33 个图片、41 个视频）：

| 本地适配状态 | 图片 | 视频 | 合计 |
| --- | ---: | ---: | ---: |
| `ready` | 1 | 30 | 31 |
| `review` | 32 | 11 | 43 |

`ready` 表示本次已实现请求约束与适配路径，并经过本地模拟/契约验证；不表示所有型号都已真实付费生成验收，也不自动启用后台渠道。实际可用型号仍取决于管理员配置、渠道凭据、额度及数据库状态。`review` 型号在提交前明确阻止执行，不把目录收录直接视为已支持。

注册表用于公共工作台、独立工作台、后台配置和模型规范页，包含输出格式、数量、参考素材、分辨率、画幅、时长及互斥规则。未知 BBLABU 型号保留待适配状态。

### 3.2 GPT Image 2.6 GIF

- 输出格式为 PNG、JPEG、WebP、GIF；一次生成 1–10 张；参考图上限 9 张。
- GIF 帧数 `frame_count` 为 2–64，默认 9；每帧时长 `frame_duration_ms` 为 20–2000 毫秒，默认 200。
- GIF 参数只在 GIF 输出时提交；切回静态格式时隐藏并省略帧参数。
- 草稿保存并恢复输出格式、帧数和每帧时长。
- JSON 与 multipart 两条图片请求路径都按能力序列化，不向此线路发送 `quality`，不开放蒙版能力。
- 服务端根据 magic bytes 和解码元数据识别实际图片类型；保存上游原始字节、真实 MIME、帧数、帧时长和循环信息，避免把动画重新编码为静态图片。
- GIF 参考图输入、透明背景尚未完成真实上游验证，不纳入已验收能力。

### 3.3 视频参数与任务恢复

- 逐型号校验时长、分辨率、画幅、首尾帧、参考图/视频/音频及素材总数；服务端在任务创建和扣费前校验。
- MiniMax `mm5-minimax-h3`：内部 `768p` / `2k` 序列化为上游 `768P` / `2K`；带首帧时省略画幅；参考音频必须搭配视觉参考；首尾帧与参考素材互斥；分别最多 9 图、3 视频、3 音频，合计最多 12 个。
- `sd14-seedance-2.0` 参考视频须填写时长，支持小数；成片时长与参考视频时长合计不得超过 25 秒。
- 参考视频输入支持每行 `URL 秒数`，例如 `https://example.com/reference.mp4 8.5`，转换为 `{url, duration}`。
- 初次提交使用 `POST /videos`；收到上游 ID 后立即持久化，后续仅查询同一 ID，避免轮询重新创建付费任务。
- API 模式使用稳定的客户端任务 ID 恢复任务；恢复时核对供应商地址、模型、站点及密钥指纹；响应隐藏凭据指纹。
- 查询采用约 8 秒间隔；查询网络异常及 408/429/5xx 保留待查询状态；总截止时间为两小时。
- 未完成任务不释放积分预授权；有上游 ID 的陈旧任务恢复查询；超时、终态失败按现有结算流程处理。
- 只有上游完成且缺少结果 URL 时才回退到 `/videos/{id}/content`。需要上游鉴权才能读取的结果须通过已配置的 R2 持久化。

### 3.4 页面与部署产物

- 提示词主页与独立工作台均先加载共享能力，再加载工作台脚本。
- 后台模型发现与配置显示能力信息，数量上限扩展到 10，增加 `768p` 分辨率。
- 模型规范页按注册表显示型号能力与适配状态；保留原页面内容。
- `vercel.json` 两个 API 入口的 `includeFiles` 均包含共享能力文件。
- KVM4 Verify 打包路径包含 `js`，Dockerfile 的 `COPY js ./js` 会包含注册表。本次只核对构建输入，未构建或发布生产产物。

## 4. 本任务文件范围

以下文件记录本任务涉及的位置；部分文件同时含用户既有或并行任务改动，后续准备发布时须按 diff 分辨归属，不能整工作区直接提交。

新增：

- `js/ai-media-model-capabilities.js`
- `js/model-standards-media.js`
- `server/api-handlers/_bblabu-media.js`
- `supabase/migrations/20261108_ai_media_bblabu_constraints.sql`
- `tests/bblabu-media.test.js`
- `docs/bblabu-media-adaptation-2026-11-08.md`

既有文件中的本任务改动：

- `server/api-handlers/_ai-image-models.js`
- `server/api-handlers/_ai-image-runtime.js`
- `server/api-handlers/public/ai-image.js`
- `server/api-handlers/admin/ai-image/config.js`
- `server/api-handlers/admin/ai-image/model-config.js`
- `js/ai-image-workbench.js`
- `prompts.html`、`workbench.html`、`css/ai-image-workbench.css`
- `admin-studio.js`、`admin-studio.html`、`admin-studio.css`
- `model-standards.html`、`css/privacy-page.css`
- `vercel.json`
- `tests/ai-image-runtime.test.js`
- `tests/public-ai-image-handler.test.js`
- `tests/ai-image-workbench-api-contract.test.js`
- `tests/admin-ai-image-config-handler.test.js`
- `tests/admin-ai-image-settings-ui-contract.test.js`

`model-standards.html` 开工时是未跟踪文件，但已被开工备份收录；比较时应使用备份中的文件内容与磁盘文件，不能将 `git diff BACKUP` 对未跟踪文件的删除显示误当成实际删除。

## 5. 验证结果

### 5.1 自动回归：PASS

2026-11-08 执行以下 11 个测试文件：**415 tests / 415 PASS / 0 FAIL / 0 skipped / 0 cancelled / 0 todo**。

```sh
node --test \
  tests/bblabu-media.test.js \
  tests/public-ai-image-handler.test.js \
  tests/ai-image-runtime.test.js \
  tests/ai-image-video-schema-contract.test.js \
  tests/ai-image-workbench-api-contract.test.js \
  tests/ai-image-workbench-standalone-window.test.js \
  tests/admin-ai-image-config-handler.test.js \
  tests/admin-ai-image-model-config-handler.test.js \
  tests/admin-ai-image-settings-ui-contract.test.js \
  tests/ai-image-worker-deploy-contract.test.js \
  tests/ai-image-worker.test.js
```

覆盖 GIF 参数边界与原始字节保存、模型输入约束、API 同任务恢复、查询频率与超时、任务预授权、双页面脚本顺序、后台配置及 worker 契约。新增 MiniMax `768p`、`2k` 两条提交→持久化→执行→上游参数的完整模拟回归。

本任务 16 个相关 JS 文件通过 `node --check`；收尾仅修复工作台一处行尾空格，无语义改动。

### 5.2 隔离浏览器预览：限定范围 PASS

预览以 `envFiles: []`、`baseEnv: {}` 启动，公共接口使用模拟配置；非 GET 请求禁止写入，没有读取生产 `.env`、触发真实生成或写入生产数据。

实际完成交互：

1. Image 2.6 的 GIF 可选，默认 9 帧/200ms；改为 12 帧/240ms，刷新后正确恢复；切 PNG 后 GIF 数字输入隐藏。
2. MiniMax 分辨率只显示 768P、2K，选择 2K 后内部值为 `2k`。
3. 仅音频提示缺少视觉参考；补参考视频后提示消失；首帧与参考素材混用出现互斥提示。
4. Seedance 参考视频 `URL 8.5` 正确解析；成片 5 秒＋参考 21 秒被 25 秒上限阻止；缺少参考时长也被阻止。
5. 模型规范页渲染 74 个型号，统计为 31 个已适配、43 个待适配。
6. 独立工作台重新导航后用浏览器 CLI 的 `console` / `errors` 检查，无 console error、无 uncaught error；导航前曾存在 Realtime CLOSED 警告。

边界：提示词主页的内容及工作台脚本已加载，但数据库列表、聊天记录、实时连接未全部模拟，出现预期依赖错误；不能据此声称整个提示词主页完成业务联调或整页控制台无错误。真实管理员登录后的页面验收未执行，后台逻辑由 handler/契约测试验证。

预览基于基准 SHA 的有改动工作区，`productionEvidence: false`。收尾时其他并行改动使预览诊断出现 `sourceMatchesStartup: false` / `restartRequired: true`，因此上述记录只代表当时已观察到的交互，不作为当前整个工作区或生产版本的验收证据。

### 5.3 证据留存

证据目录：`/Volumes/chao/AI/.codex-backups/xianyu_profit_calculator/bblabu-20261108-120203/evidence/`。

- `bblabu-final-regression.log`：415 项回归原始结果。
- `bblabu-workbench-gif.png`：GIF 控件截图。
- `bblabu-workbench-video.png`：视频控件截图。
- `sha256.json`：上述文件校验值。

## 6. 未执行事项与上线前条件

| 事项 | 状态 | 说明 |
| --- | --- | --- |
| 数据库约束迁移 | NOT RUN | 文件已准备；尚无本次 SQL 执行授权 |
| 真实 BBLABU 生成 | NOT RUN | GIF 与视频协议由本地模拟验证，尚无真实付费任务验收 |
| 真实管理员浏览器验收 | NOT RUN | handler 与界面契约测试通过；未登录生产后台验收 |
| Vercel production | NOT RUN | 未提交、合并或部署 |
| KVM4 Verify Server | NOT RUN | 未部署 |
| KVM4 Sub2API / NewAPI | NOT RUN | 未部署 |

迁移文件 `supabase/migrations/20261108_ai_media_bblabu_constraints.sql` 使用事务扩展数量约束到 1–10，并在 agents/tasks/results/api_usage 的分辨率约束中增加 `768p`，保留原有取值。未应用时，新数量或分辨率可能被现有数据库约束拒绝，不能提前宣称可用。

下一步须先按仓库规则明确目标数据库与迁移执行范围并获得 SQL 授权，检查迁移结果；再使用明确授权的上游测试额度验证静态图、GIF、图编辑及代表性视频，检查结果持久化、下载与账单。启用型号仍由后台配置控制。

发布须另行获得用户指令，从包含完整变更清单的干净候选提交进入最新 `main`，按 `AGENTS.md` 验证 Vercel、KVM4 Verify、KVM4 Sub2API 三条链路与最新 main SHA。本记录不能替代发布清单或真实环境验收。


## 7. 2026-11-08 追加：Image 2.6 跨上游 GIF

本节追加记录用户要求“其他上游选择 2.6 后也需要 GIF、帧数、每帧时长”的落实情况。第 5 节的 415 项回归与第 6 节的 NOT RUN 均为前阶段历史结果，保持原样，不替代本节当前状态。

### 7.1 适配范围与实际行为

- `gpt-image-2.6` 的格式、数量和动画参数按型号解析，移除仅 BBLABU 域名可用的限制；忽略型号首尾空格与大小写，其他型号仍按原有规则匹配。
- API 计费与积分计费均支持 PNG、JPEG、WebP、GIF；GIF 为 2–64 帧、默认 9 帧，每帧 20–2000ms、默认 200ms。切换静态格式时隐藏并省略动画参数，刷新恢复草稿设置。
- 前后端共用能力注册表。公共 API 模型发现和后台模型检测返回非 BBLABU Image 2.6 的能力，公共响应同时提供模型项与供应商能力映射。积分模式兼容缺少能力字段的旧响应，并保留服务器明确的待审核限制。
- 请求提交、持久化、JSON/multipart 执行路径统一使用 GIF 参数；非法参数在任务受理、扣费和上游请求之前返回 400。GIF 结果保存原始字节和实际 MIME，不重新压成静态图。
- 非 BBLABU 的任务能力元数据使用 `openai-compatible` 与 Image 2.6 版本；BBLABU 保留其渠道标记。BBLABU 其他型号及视频能力继续限制在对应渠道。
- 提示词页、独立工作台与模型规范页的共享能力脚本统一刷新缓存版本为 `20261108_IMAGE26_ALL_PROVIDERS_2`。规范页同步说明图片跨上游、视频按 BBLABU 渠道约束。

本次跨上游改动主要涉及 `js/ai-media-model-capabilities.js`、`js/ai-image-workbench.js`、`server/api-handlers/public/ai-image.js`、`prompts.html`、`workbench.html`、`model-standards.html`，以及四个已有相关测试文件和本记录。共享文件中的其他并行改动已保留。

### 7.2 当前验证结果

使用第 5.1 节相同的 11 个测试文件重新执行：**443 tests / 443 PASS / 0 FAIL / 0 skipped / 0 cancelled / 0 todo**。10 个相关 JS 文件通过 `node --check`。

新增验证覆盖非 BBLABU 能力解析与任务元数据、公共/后台模型发现，以及三个上游地址的 JSON/multipart × GIF/PNG 模拟矩阵；API 与积分两种计费的 GIF/PNG 任务受理和四项 GIF 越界拦截均通过。现有资源加载契约扩展到模型规范页，校验三个页面先加载当前能力脚本再加载消费脚本。

隔离浏览器的已观察交互：非 BBLABU `https://relay.example.com/v1` 选择 Image 2.6 后可选 GIF；默认 9 帧/200ms，改成 12 帧/160ms 后刷新保留；切回 PNG 时两个动画输入移除；积分计费同样显示 GIF 控件。提示词页“AI 创作台”入口进入独立工作台后，GIF 12 帧/160ms 状态正确。

独立工作台首次及刷新后的浏览器 CLI `console` / `errors` 检查无 console error、无 uncaught error。提示词主页未模拟全部 Supabase 数据与聊天接口，存在依赖错误和 Realtime 警告，**整页业务与控制台验收仍为 PARTIAL**。模型规范页通过当前预览 HTTP 检查，确认跨上游说明和新脚本版本已返回。

浏览器使用 8138 端口的只读隔离模拟服务（`envFiles: []`、`baseEnv: {}`，非 GET API 拒绝写入），没有触发真实付费生成或生产数据写入。预览基于 `75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8` 的有改动工作区，`productionEvidence: false`；交互记录不代表干净提交或生产验收。编辑前 `git fetch origin main` 后 behind 为 0，唯一远端为仓库要求的 HTTPS origin。

### 7.3 备份与证据

本轮修改前文件备份与 SHA-256 已保存并回读校验：

`/Volumes/chao/AI/.codex-backups/xianyu_profit_calculator/image26-cross-upstream-20261108-141946/`

其 `evidence/` 包含 443 项最终回归日志、非 BBLABU API/积分及提示词入口截图、提示词页控制台记录、当前相关源码校验值与 `sha256.json`。本备份补充第 2 节的 Git 可恢复备份，不覆盖前阶段 415 项证据。

### 7.4 数据库与发布状态

| 事项 | 当前状态 | 说明 |
| --- | --- | --- |
| 前阶段数据库迁移 | 用户报告已执行，未独立核验 | 本轮未执行 SQL；保留第 6 节执行前的历史状态 |
| 本次跨上游 GIF 新增迁移 | 不需要 | 复用现有任务 metadata，无新增数据库字段或约束 |
| 自动回归 | PASS | 443/443；10 个 JS 语法检查通过 |
| 非 BBLABU 工作台 GIF 浏览器交互 | 限定范围 PASS | API/积分、草稿刷新恢复、静态格式收起动画控件 |
| 真实供应商收费生成 | NOT RUN | 本地模拟已覆盖协议；各供应商真实兼容性仍待实测 |
| 生产发布 | NOT RUN | 未推送、创建 PR、合并或部署；线上页面未由本轮更新 |

代码侧已同步用户界面和后端。本轮无需再次迁移数据库。上线仍需另行按 AGENTS.md 从完整、干净的候选提交发布，并验证三条生产链路；实际供应商生成结果与计费需要在获准的测试额度内逐渠道验证。
