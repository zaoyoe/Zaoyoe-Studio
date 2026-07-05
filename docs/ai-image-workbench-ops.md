# AI 图片工作台运维手册

## 目标

AI 图片工作台的真实生图链路由三段组成：

1. 用户端提交任务到 Supabase。
2. KVM4 常驻 Worker 领取 `queued` 任务并调用图片模型。
3. 模型返回的高清原图写入 R2，再把公开 CDN 地址写回生成记录。

积分模式只在任务成功后扣费；失败任务不扣积分。API 模式不会使用站点 Key，也不会扣站点积分。

## 模型配置优先级

Worker 调用模型时按下面顺序解析配置：

1. `AI_IMAGE_API_KEY` 环境变量。
2. 后台“AI 图片 > 模型供应商”里加密保存的 `ai_image_api_key`。
3. 共享 `OPENAI_API_KEY` / `CODEX_API_KEY` 环境变量。
4. 后台 Codex Relay 配置。

小规模商用建议使用第 1 或第 2 种，并给 AI 图片单独配 Key，避免和站内文本分析、翻译、Codex 额度混用。

图片生成默认使用 `AI_IMAGE_MODEL`；反推提示词和文本对话默认使用 `AI_IMAGE_CHAT_MODEL`。二者可以指向同一家上游，也可以拆成不同模型，便于控制成本。

## 模型环境变量

```bash
AI_IMAGE_API_KEY=
AI_IMAGE_API_BASE_URL=https://api.openai.com/v1
AI_IMAGE_MODEL=gpt-image-2
AI_IMAGE_CHAT_MODEL=gpt-4o-mini
AI_IMAGE_CHAT_MAX_TOKENS=1600
```

## R2 存储环境变量

当图片模型返回 `b64_json` 时，生产环境必须配置 R2，否则 Worker 会在调用模型前失败，避免生成了图片却无法保存高清原图。

必填：

```bash
AI_IMAGE_R2_ENDPOINT=
AI_IMAGE_R2_ACCESS_KEY_ID=
AI_IMAGE_R2_SECRET_ACCESS_KEY=
AI_IMAGE_R2_BUCKET_NAME=zaoyoeimages
AI_IMAGE_R2_PUBLIC_URL=https://cdn.fatherkey.com
```

兼容旧变量名：

```bash
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
```

仅本地开发可临时使用：

```bash
AI_IMAGE_ALLOW_INLINE_DATA_URLS=true
```

不要在生产启用 inline data URL。它会把图片直接写成 data URL，不适合高清原图下载和缓存。

## KVM4 Worker

Service 模板：

```text
deploy/kvm4/ai-image-worker/zaoyoe-ai-image-worker.service
```

安装 systemd service：

```bash
npm run install:kvm4:ai-image-worker
```

安装并立即启动：

```bash
npm run install:kvm4:ai-image-worker -- --start
```

远端常用命令：

```bash
systemctl status zaoyoe-ai-image-worker.service --no-pager
journalctl -u zaoyoe-ai-image-worker.service -n 120 --no-pager
systemctl restart zaoyoe-ai-image-worker.service
```

默认启动命令：

```bash
npm run ai-image:worker -- --env-file /opt/zaoyoe-verify-server/.env --limit 8 --concurrency 4 --interval-ms 3000
```

KVM4 生产环境通过 `deploy/kvm4/docker-compose.verify-server.yml` 中的 `ai-image-worker` 容器运行 worker，复用 Verify Server 同一份代码和 `.env`。Verify Server 每次从 `main` 部署成功后会同时重建并重启 `verify-server` 和 `ai-image-worker`，避免旧进程继续领取队列任务。

`--limit` 是每轮最多领取的队列任务数，`--concurrency` 是同一时间执行的任务数。当前默认用 `--limit 8 --concurrency 4`，先把队列吞吐抬起来，后续再根据上游限速、R2 转存耗时和失败率微调。

也可以在 `.env` 中设置：

```bash
AI_IMAGE_WORKER_CONCURRENCY=4
```

命令行显式传入 `--concurrency` 时优先使用命令行值。

## 体感等待优化

当前队列会优先领取低成本任务：同一批 `queued` 任务先按 `estimated_points` 从低到高，再按创建时间排序。这样 1K、1 张、反推提示词这类轻任务不会被 4K、多张的大任务长期挡住。

提交积分任务后，公共接口会返回 `queue_position`、`estimated_wait_seconds` 和 `queue_eta_seconds`。前端会立即显示“已受理 / 预计等待 X”，后续轮询任务列表时继续刷新这个估算。估算以当前队列位置、任务分辨率/张数和 `AI_IMAGE_WORKER_CONCURRENCY` 折算；它是用户提示，不是 SLA。

现在的 `preview-first` 是“模型返回结果后，逐张完成预览压缩/存储就先写入结果表，高清原图后台转存”。任务仍保持运行中，前端轮询到已写入的 `ai_image_results` 后会先显示首图，剩余图片继续用生成中占位补齐。最终扣费、API 用量和任务 `succeeded` 收口仍在 Worker 完整执行结束后统一处理，避免只拿到部分图时提前扣满积分。

这能压缩 R2 转存、原图加载和多图后处理带来的体感等待，但前提是上游已经返回了可展示图片。如果 `ai_image_results` 的首条 `created_at` 贴着 task 的 `completed_at`，说明前端轮询时数据库里还没有缩略图，不是用户端在等高清原图。排查时不要只看 `timing.update_task_ms`，它只是最后一次任务状态更新；优先看 `timing.total_run_ms`、`timing.executor_ms`、`timing.upstream_ms`、`timing.upstream_response_ms`、`timing.postprocess_ms` 和 `timing.runtime_unaccounted_ms`。其中 `timing.upstream_ms` 是从本服务发起模型接口请求到读完响应体的接口等待总和；如果要对齐上游后台列表里的“耗时”，通常看 `timing.upstream_response_ms` 更接近。真正的低成本首稿仍需要提交低分辨率/少张数任务，再由用户选择补高清。

为了压缩空等时间，生产建议显式设置：

```bash
AI_IMAGE_PROVIDER_TIMEOUT_MS=120000
AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS=120000
AI_IMAGE_TASK_TIMEOUT_MS=150000
AI_IMAGE_STALE_RUNNING_TIMEOUT_MS=180000
```

`AI_IMAGE_PROVIDER_TIMEOUT_MS` 控制等待上游建立响应的最长时间，`AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS` 控制读取上游响应体的最长时间，`AI_IMAGE_TASK_TIMEOUT_MS` 控制单个任务从开始执行到必须收口的硬截止，`AI_IMAGE_STALE_RUNNING_TIMEOUT_MS` 控制 worker 异常退出或请求卡死后多久回收 running 任务。不要把这些值长期设成 6 到 15 分钟，否则上游实际 50 秒完成但连接/响应体卡住时，用户仍会看到数分钟无预览。

## 成本防火墙

AI 图片公共接口必须使用服务端限流，不依赖前端按钮状态。默认启用这些层级：

- 提交生成：全站、IP、用户、重型请求、模型维度限流。
- 上传参考图：全站、IP、用户维度限流。
- 下载高清原图：全站、IP、用户、单资源维度限流。
- 用户任务容量：默认同一用户最多 `2` 个运行中任务、`5` 个排队任务、`6` 个未完成任务。

可在 `.env` 中按真实流量微调：

```bash
AI_IMAGE_RATE_LIMIT_SUBMIT_GLOBAL_MAX=180
AI_IMAGE_RATE_LIMIT_SUBMIT_IP_MAX=30
AI_IMAGE_RATE_LIMIT_SUBMIT_USER_MAX=12
AI_IMAGE_RATE_LIMIT_SUBMIT_HEAVY_USER_MAX=4
AI_IMAGE_RATE_LIMIT_SUBMIT_MODEL_MAX=6
AI_IMAGE_RATE_LIMIT_UPLOAD_IP_MAX=36
AI_IMAGE_RATE_LIMIT_DOWNLOAD_IP_MAX=180
AI_IMAGE_RATE_LIMIT_DOWNLOAD_RESOURCE_MAX=24
AI_IMAGE_USER_RUNNING_TASK_LIMIT=2
AI_IMAGE_USER_QUEUED_TASK_LIMIT=5
AI_IMAGE_USER_ACTIVE_TASK_LIMIT=6
```

这些限制是保护上游模型、R2 操作次数和数据库写入的成本护栏。不要在没有队列失败率、上游 429、R2 转存耗时监控前直接大幅放宽。

## 启动前检查

1. Supabase 已执行 `20260621_ai_image_workbench_core.sql`。
2. 后台 AI 图片价格规则已配置，尤其是 `points` 模式。
3. AI 图片模型配置已在后台保存，或 KVM4 `.env` 已配置 `AI_IMAGE_API_KEY`。
4. R2 变量已配置，后台“AI 图片 > 运行状态”显示存储就绪。
5. 手动执行一次：

```bash
npm run ai-image:worker -- --env-file server/.env.production --once --limit 2 --concurrency 2
```

6. 确认后台队列统计、生成记录、积分扣费记录都符合预期。

## 真实配置自检 / 模拟清单

这套流程用于首次接入真实模型、R2 和积分扣费前的小流量验收。目标是用最低成本验证“生成、存储、扣费、API 用量、下载记录、安全边界”都闭环。

### 后台配置项

在后台“AI 图片”里先只配置最小可用组合：

1. 模型供应商
   - `Base URL`：OpenAI 兼容 Images / Chat API 地址。
   - `模型名`：先只配 1 个稳定生图模型。
   - `API Key`：使用 AI 图片专用 Key，不和站内其它服务混用。

2. 用户 API 白名单
   - 只启用管理员认可的 Sub2API 地址。
   - 国内站建议：`https://sub2api.fatherkey.com/v1`。
   - 国际站建议：`https://sub2api.zaoyoe.xyz/v1`。
   - 不允许用户输入任意上游地址。

3. 价格规则
   - `points / text / 1k / 1张`：先设低价，例如 8 积分。
   - `points / image / 1k / 1张`：先设低价，例如 12 积分。
   - `points / reverse`：单独定价，例如 3 积分。
   - `api` 模式规则积分必须为 0。

4. 便利智能体
   - 先只启用 1-2 个，例如高清修复、换背景。
   - 每个智能体必须有清晰的场景提示词、默认模型、默认比例、默认分辨率。

5. R2 / CDN
   - 后台运行状态必须显示存储就绪。
   - `AI_IMAGE_R2_PUBLIC_URL` 必须是可公开访问的 CDN 域名。
   - 生产环境不要启用 `AI_IMAGE_ALLOW_INLINE_DATA_URLS=true`。

### 最小真实模拟参数

用测试账号执行，不要用普通用户账号做首轮验收。

- 分辨率：`1k`
- 张数：`1`
- 比例：`1:1`
- 测试账号积分：建议 50-100
- Worker：先用 `--once --limit 2 --concurrency 2` 单次执行，再打开常驻服务
- 失败模拟：只做 1 次，确认失败不扣积分后立即恢复模型配置

### 测试用例

按顺序执行，每一步都记录任务 ID。

| 编号 | 场景 | 操作 | 预期 |
| --- | --- | --- | --- |
| T1 | 积分文生图 | 选择积分计费，输入文字，`1k / 1张 / 1:1` | 任务成功，写入结果图，成功后扣积分 |
| T2 | 积分失败 | 临时使用错误模型名或断开模型配置后提交 1 个任务 | 任务失败，`charged_points = 0`，无负数积分流水 |
| T3 | API 文本对话 | 选择“我的 API”，输入 Sub2API Key，不启用生图工具 | 返回文本，记录 token，不扣本站积分 |
| T4 | API 生图 | API 模式启用“生成图片”，`1k / 1张` | 返回图片，记录 token / 图片用量，不扣本站积分 |
| T5 | 图片发散 | 上传参考图并输入发散描述 | 参考图先上传为 CDN URL，任务里不能出现 `data:` / `blob:` |
| T6 | 反推提示词 | 上传图片并输入“反推这张图的提示词” | 写入 `result_prompt`，不需要比例和分辨率 |
| T7 | 高清原图下载 | 点击生成图右上下载 | 打开原图 URL，并写入 `ai_image_download_events` |

### 数据库核验 SQL

把下面的 `TEST_USER_ID`、`TASK_ID` 替换成测试账号和任务 ID。时间窗口可按实际测试时间调整。

1. 核验任务、结果、扣费状态

```sql
WITH params AS (
  SELECT
    'TEST_USER_ID'::uuid AS user_id,
    NOW() - INTERVAL '2 hours' AS since_at
)
SELECT
  t.id,
  t.site,
  t.mode,
  t.billing_mode,
  t.status,
  t.model,
  t.ratio,
  t.resolution,
  t.quantity,
  t.estimated_points,
  t.charged_points,
  t.points_ledger_reference_id,
  t.api_base_url,
  t.api_key_tail,
  t.input_tokens,
  t.output_tokens,
  t.total_tokens,
  t.error_code,
  t.error_message,
  COUNT(r.id) AS result_count,
  BOOL_OR(r.original_image_url <> '') AS has_original_url
FROM public.ai_image_tasks t
LEFT JOIN public.ai_image_results r ON r.task_id = t.id
JOIN params p ON p.user_id = t.user_id
WHERE t.created_at >= p.since_at
GROUP BY t.id
ORDER BY t.created_at DESC;
```

2. 核验积分扣费只发生在成功的积分任务

```sql
WITH params AS (
  SELECT
    'TEST_USER_ID'::uuid AS user_id,
    NOW() - INTERVAL '2 hours' AS since_at
)
SELECT
  t.id AS task_id,
  t.status,
  t.billing_mode,
  t.estimated_points,
  t.charged_points,
  pl.id AS ledger_id,
  pl.amount,
  pl.reason,
  pl.reference_id,
  pl.created_at
FROM public.ai_image_tasks t
LEFT JOIN public.points_ledger pl
  ON pl.user_id = t.user_id
 AND pl.reference_id = t.id::text
JOIN params p ON p.user_id = t.user_id
WHERE t.created_at >= p.since_at
ORDER BY t.created_at DESC;
```

合格标准：

- `points` 且 `succeeded`：`charged_points = estimated_points`，且只有 1 条负数 `points_ledger`。
- `points` 且 `failed`：`charged_points = 0`，且没有负数 `points_ledger`。
- `api`：`charged_points = 0`，且没有站内积分扣费流水。

3. 核验 API 模式真实用量

```sql
WITH params AS (
  SELECT
    'TEST_USER_ID'::uuid AS user_id,
    NOW() - INTERVAL '2 hours' AS since_at
)
SELECT
  u.id,
  u.task_id,
  u.api_base_url,
  u.api_key_tail,
  u.model,
  u.model_group,
  u.request_type,
  u.input_tokens,
  u.output_tokens,
  u.total_tokens,
  u.image_count,
  u.resolution,
  u.raw_usage,
  u.created_at
FROM public.ai_image_api_usage u
JOIN params p ON p.user_id = u.user_id
WHERE u.created_at >= p.since_at
ORDER BY u.created_at DESC;
```

合格标准：

- API 文本对话至少有 `total_tokens`。
- API 生图至少有 `image_count > 0` 或上游返回的 `raw_usage`。
- 表内不能出现明文 API Key，只能有 `api_key_tail`。

4. 核验参考图和结果图没有本地临时 URL

```sql
WITH params AS (
  SELECT
    'TEST_USER_ID'::uuid AS user_id,
    NOW() - INTERVAL '2 hours' AS since_at
)
SELECT
  t.id,
  t.reference_image_url,
  r.image_url,
  r.original_image_url,
  r.storage_path,
  r.original_storage_path
FROM public.ai_image_tasks t
LEFT JOIN public.ai_image_results r ON r.task_id = t.id
JOIN params p ON p.user_id = t.user_id
WHERE t.created_at >= p.since_at
  AND (
    t.reference_image_url ILIKE 'data:%'
    OR t.reference_image_url ILIKE 'blob:%'
    OR r.image_url ILIKE 'data:%'
    OR r.image_url ILIKE 'blob:%'
    OR r.original_image_url ILIKE 'data:%'
    OR r.original_image_url ILIKE 'blob:%'
  );
```

合格标准：查询结果必须为空。

5. 核验高清原图下载记录

```sql
WITH params AS (
  SELECT
    'TEST_USER_ID'::uuid AS user_id,
    NOW() - INTERVAL '2 hours' AS since_at
)
SELECT
  d.id,
  d.task_id,
  d.result_id,
  d.original_image_url,
  d.original_storage_path,
  d.source,
  d.created_at
FROM public.ai_image_download_events d
JOIN params p ON p.user_id = d.user_id
WHERE d.created_at >= p.since_at
ORDER BY d.created_at DESC;
```

合格标准：每次点击高清原图下载，至少新增 1 条对应用户自己的下载事件。

6. 核验后台白名单

```sql
SELECT
  site,
  label,
  base_url,
  is_active,
  display_order,
  created_at
FROM public.ai_image_api_base_urls
ORDER BY site, display_order, created_at;
```

合格标准：

- 只启用管理员认可的 Sub2API 地址。
- 不存在 `https://api.openai.com/v1`、其它未知代理或用户自定义上游作为用户 API 白名单。

### 异常判断标准

遇到以下情况应立即停止模拟并排查：

- 任意表或日志出现用户 API Key 明文。
- `api` 模式产生了站内积分扣费。
- `points` 失败任务产生了负数积分流水。
- 同一个任务产生多条负数 `points_ledger`。
- 任务或结果里出现 `data:` / `blob:` 图片 URL。
- 生图成功但 `ai_image_results.original_image_url` 为空。
- R2/CDN URL 无法公开访问，或下载到的不是高清原图。
- 用户 API Base URL 可以绕过后台白名单。
- 其它用户能看到或下载测试账号的结果图。

以下情况可以先标记为警告，但不一定阻断：

- Worker 队列延迟超过 60 秒，但最终成功。
- 上游不返回 token usage，`raw_usage` 为空但图片成功返回。
- 下载事件记录失败，但原图直链可打开。需要补查 `ai_image_download_events` 表或 public API 错误日志。
- 便利智能体输出不稳定。优先优化后台 system prompt 和模型，不急着扩大开放。

### 通过标准

真实配置模拟通过必须同时满足：

1. T1-T7 全部完成。
2. 积分扣费、API 用量、下载记录三条链路都能在数据库核验。
3. 没有明文 Key、越权访问、错误扣费、重复扣费。
4. 生成图和参考图均为 CDN / R2 可访问 URL。
5. 前端工作台生成记录、摘要、下载入口表现正常。

## 部署边界

这个 Worker service 安装脚本只复制 systemd unit，不部署应用代码，也不写入密钥。

生产应用代码仍必须遵守 `AGENTS.md`：从最新 `main` 经过 PR 合并后，由现有 Git/Vercel/KVM4 自动链路部署。不要从功能分支手动进行生产部署。
