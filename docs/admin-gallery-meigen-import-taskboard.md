# Admin Gallery Meigen 导入助手任务单

## 当前完成

- [x] 2026-07-11：入队前按原作品链接及中英提示词精确匹配仓库，重复项不再写入暂存队列，并向插件返回跳过数量。
- [x] 2026-07-11：修复 `清空当前队列` 后已清理行被状态刷新重新标记为失败并“复活”；默认查询排除 `cleaned`，终态不再被失败同步覆盖。
- [x] 2026-07-11：清空时同步断开旧批次、清除高级导入文本，并禁止在上传 / 刷新进行中清空。
- [x] 2026-07-11：`Prompt not found` 等已保存作品回读异常改为“作品读取失败”，不再误报“图片上传失败”。
- [x] 2026-07-11：图片代理逐跳校验重定向、拦截常见内网 / 元数据地址并校验文件签名，避免 SSRF 跳转和 HTML 伪图片进入 R2。
- [x] 2026-07-11：Admin 登录态桥只注入 Admin Studio，页面数据缓存增加总量上限，扩展版本升至 `0.1.1`。
- [x] 2026-07-11：修复批量长提示词去重把正文放进查询 URL 导致 `Bad Request`；改为固定分页扫描并在服务端计算指纹，扩展版本升至 `0.1.2`。
- [x] 2026-07-11：明确“最多作品”是上限；当前页发现数不足时提示改用滚动采集或翻页采集。
- [x] 2026-07-11：修复详情补抓重复触发 `click`、主页面详情链接导航导致 Popup 和内容脚本被销毁；已有详情 URL 改走隐藏详情环境，采集结果按进度写入 `storage.session`，扩展版本升至 `0.1.3` / 采集器 `.49`。
- [x] 2026-07-11：Import 上传队列并发选项由 1–3 条扩展为 1–6 条；高并发 worker 按 0.4 秒错峰启动，默认仍为 2 条。
- [x] 2026-07-11：修正 `.49` 详情补抓全部转隐藏环境造成多图作品只抓首图的回归；`.50` 恢复真实卡片轮播补抓，同时阻止 `<a>` 默认导航并保留会话快照兜底，扩展版本升至 `0.1.4`。
- [x] 2026-07-11：隐藏详情 iframe 改为视口内近透明渲染以触发懒加载；未知张数不再凭静态首图提前完成，必须等待动态轮播稳定或读到权威 `1 / N`，扩展版本升至 `0.1.5` / 采集器 `.51`。
- [x] 2026-07-11：`采集当前页` 升级为两阶段智能采集：未达到作品上限时先自动滚动到上限或页面稳定，再只对 Prompt / 来源 / 图片数量确有缺口的条目补详情；收藏数仅在启用收藏筛选时强制补，扩展版本升至 `0.1.6` / 采集器 `.52`。
- [x] 2026-07-11：修复社区详情页误收相邻 X/Twitter 作品图片：社区条目禁止接收 `/tweets/...` 图片，数字作品详情只保留与当前 status id 一致的图片，扩展版本升至 `0.1.7` / 采集器 `.53`。
- [x] 2026-07-11：修复 Meigen 结构化 Prompt 在 160 字符处无省略号硬截断：将固定长度预览识别为未完成内容，继续读取“复制 Prompt”全文，并以权威完整标记保护详情结果不被短预览覆盖；扩展版本升至 `0.1.8` / 采集器 `.54`。
- [x] 2026-07-11：修复昵称误抓 Prompt 正文和模型标签：无可见 handle 时只从详情面板收藏操作之前读取昵称，拒绝 `Model: ...` 标签和与 Prompt 完全相同的 hover 候选，并允许详情真实昵称覆盖无效 hover 缓存；扩展版本升至 `0.1.9` / 采集器 `.55`。
- [x] 2026-07-11：过滤没有详情、Prompt、来源且只有 Community 生成图的不可解析占位卡；Gallery Import 从 X/Twitter status URL 自动补原作者 ID；Community 图片直链与 CDN 代理按生成 ID 去重，扩展版本升至 `0.1.10` / 采集器 `.56`。
- [x] 2026-07-11：打通全自动采集导入：采集按钮自动执行补量、详情补抓和入队；Admin Studio 增加持久化“自动检测队列并上传”开关，每 5 秒按当前站点检测新队列，通过跨标签锁防止重复运行，仅自动处理新任务并保留失败项人工复核；扩展版本升至 `0.1.11` / 采集器 `.57`。
- [x] 2026-07-11：Gallery Import 并发上限从 6 提升到 10，并用动态任务池替代固定 worker：最多从 6 并发起步，连续稳定完成当前档位数量后逐级升压；遇到限流、网关、超时或网络压力时并发减半并冷却 6 秒，内容错误不触发降压。
- [x] 2026-07-11：Gallery Import 升级为持久流式流水线：详情采集按 3 条微批追加到同一批次；Supabase 使用 `SKIP LOCKED` 租约安全领取任务；KVM4 `prompt-import-worker` 在 Admin Studio 关闭后继续完成图片保存、多模态分析、双语补全、发布与清理；Admin 自动检测仅监控服务端进度，扩展版本升至 `0.1.12` / 采集器 `.58`。
- [x] 2026-07-11：补齐流式入队可观测性：扩展显示尝试、实际入队、仓库重复与未接收数量；Admin Studio 可选择最近批次并查看 Worker 阶段、尝试次数与更新时间，自动检测跳过空批次；扩展版本升至 `0.1.13` / 采集器 `.59`。
- [x] 2026-07-11：修复详情页结构化文本被误判为图片、异常 `1/N` 扩张和跨作品提示词串条；清空队列会撤销 Worker 租约并阻止已领取任务后写复活；扩展版本升至 `0.1.14` / 采集器 `.60`。
- [x] 2026-07-11：修复 community 卡片容器过宽时借用相邻 tweet 图片造成“同图不同 Prompt”；数字详情只接受同 status tweet 图片，community 详情拒绝全部 tweet 图片并回源自己的 generation 素材。
- [x] Gallery 在 `Create` 与 `Manage` 中间新增独立 `Import` 分栏，并放置 `Gallery 导入助手`。
- [x] `Import` 分栏提供 `打开 Meigen`、`导入抓取结果`、`粘贴结果`、`刷新队列` 入口，管理员不用进入 Manage 找批量导入。
- [x] `Import` 分栏提供 `复制采集器` 入口，第一版 Meigen 浏览器辅助采集器可导出兼容队列的 JSON 结果。
- [x] 新增 Chrome 插件版 Meigen 采集器，支持采集当前页、下载结果、直接送入 Import 队列。
- [x] Chrome 插件支持低频详情页补抓、暂停 / 继续和失败重试，补抓结果会合并回同一条提示词。
- [x] Chrome 插件支持低频滚动采集和停止滚动，自动合并滚动中新加载的作品。
- [x] Chrome 插件支持下一页 / 更多按钮识别和多页面批次采集，默认低频翻 5 页并可停止。
- [x] Chrome 插件在送入队列前会自动补抓缺失提示词的详情，减少管理员误送半成品。
- [x] Chrome 插件采集前会触发卡片 hover，尽量读取 hover 后出现的 X 原链接。
- [x] Chrome 插件详情补抓支持结构化页面数据和隐藏详情页渲染兜底。
- [x] Chrome 插件弹窗支持设置 `最多作品`，默认 20 条，当前页 / 滚动 / 翻页 / 送入队列都会遵守。
- [x] Chrome 插件弹窗支持设置 `收藏最少`、`收藏最多`，留空表示不限；当前页 / 滚动 / 翻页 / 送入队列都会遵守。
- [x] Chrome 插件按页面视觉顺序采集作品：从上到下，同一行从左到右；滚动 / 翻页会保持首次发现顺序。
- [x] Chrome 插件不会因为列表页卡片里出现 `1 / N` 文本就误判成单个详情页，`最多作品` 会继续作为列表采集上限生效。
- [x] Chrome 插件过滤头像、图标、小尺寸 UI 图片和相关内容图，只保留更可能是作品的大图。
- [x] Chrome 插件会清理提示词里的按钮文案，如 `展开`、`更多相关内容`、`使用 Prompt`、`用作参考图`。
- [x] Chrome 插件只把带 `status/{id}` 的 X / Twitter 原帖链接当作原作品链接，不再把作者主页当原作品链接。
- [x] Chrome 插件会从 hover 后的 `在 X 上查看` 控件读取原作品 `status/{id}` 链接。
- [x] Chrome 插件会从详情页作者区读取原作者昵称和 `@` 开头 ID。
- [x] Chrome 插件会从详情页顶部作者行兜底读取昵称，避免作者链接无文本时只抓到 `@ID`。
- [x] Chrome 插件会解码分享 / 跳转按钮里的 X 原帖链接，支持从 encoded URL 中提取 `status/{id}`。
- [x] Chrome 插件详情补抓会尝试点击 `复制Prompt` 并读取完整提示词，避免只抓到折叠省略版。
- [x] Chrome 插件会优先从详情页作者主页链接文字读取昵称，例如 `Duet | AI`，避免把提示词开头误当昵称。
- [x] Chrome 插件在详情页只有作者 ID 和长数字作品 ID 时，可拼出 `https://x.com/{作者}/status/{id}` 原作品链接。
- [x] Chrome 插件不再从列表 / hover 预览推断作者昵称，避免把 `likes / views` 当成原作者昵称。
- [x] Chrome 插件详情页图片只按轮播计数所在的主作品区域提取；定位不到主轮播时不再全页兜底抓大图，避免把 `更多相关内容` 图片带进同一条提示词。
- [x] Chrome 插件详情页会参考左上角 `1 / N` 轮播计数限制最终图片数，避免候选图被合并到 12 张。
- [x] Chrome 插件详情补抓即使暂时没有识别到主图，也会把详情里的提示词、作者和原链接合并回列表里已有作品。
- [x] Chrome 插件对缺提示词或只有封面图的列表项，会在当前页点击卡片打开详情弹窗，再点击 `复制Prompt` 并补抓详情图。
- [x] Chrome 插件详情补抓不会在提示词仍是省略版时提前结束，会继续等待展开 / 复制结果。
- [x] Chrome 插件会优先点击真正的 `复制Prompt` 按钮，避免误点包含整段详情文字的外层容器。
- [x] Chrome 插件默认静默读取详情里的完整 Prompt，不再自动触发 Meigen 的复制按钮，避免页面弹出 `复制失败`。
- [x] Chrome 插件在静默读取失败时，会等待 0.65 秒再模拟点击 `复制Prompt`，并用页面内桥接捕获复制文本，减少 `复制失败` 干扰。
- [x] Chrome 插件详情页会先去重再按 `1 / N` 补满图片，避免主图和第一个缩略图重复后只剩 1 张。
- [x] Chrome 插件采集当前页、送入队列、下载结果前只要发现缺提示词或只有 1 张图，就会自动补抓详情。
- [x] Chrome 插件送入队列直连遇到 `Unauthorized` 时，会自动通过已登录的 Admin Studio 标签页同站转发，避免扩展跨站请求丢失 Strict Cookie。
- [x] Chrome 插件新增页面数据层采集桥：优先读取 Meigen 页面脚本、Next 数据、fetch/XHR JSON 缓存里的完整 Prompt、作者、原帖链接和多图，减少对 `复制Prompt` 点击的依赖。
- [x] Chrome 插件会按当前详情 URL、X status ID、封面图和作者 ID 匹配数据层候选，避免把 `更多相关内容` 的图片或其它作品的 Prompt 混入当前作品。
- [x] Chrome 插件会直接读取详情页 `提示词` 后的可见正文，即使 `复制Prompt` 或 `展开` 暂时没点成功，也不会把明明可见的 Prompt 统计为未抓到。
- [x] Chrome 插件补抓详情时支持按详情链接、图片路径 / 文件名模糊定位当前卡片，避免缩略图 URL 和原图 URL 不完全一致导致补抓跳过。
- [x] Chrome 插件送入队列连接失败时会给出中文处理提示，不再只显示浏览器底层的 `Failed to fetch`。
- [x] Chrome 插件详情页不再只取第一个弹窗 / 图片区域；会同时读取图片区、右侧提示词区和整页，再合并成同一条作品。
- [x] Chrome 插件打开详情后会优先锁定右侧详情栏：只在同时包含 `复制Prompt` 和 `提示词` 的栏里读取正文、点击复制按钮。
- [x] Chrome 插件弹窗显示当前采集器版本，并提供 `复制诊断`，可查看最近一次采集 / 补抓的详情日志。
- [x] Chrome 插件修复“详情已读到 Prompt，但列表项没有详情链接时没有合并回原条目”的问题，补抓结果会优先回填原列表项 ID。
- [x] Chrome 插件弹窗打开时会立即检测 Meigen 页面并显示采集器版本，不必等到点击采集后才更新。
- [x] Chrome 插件补抓详情命中原列表项后，会直接把 Prompt、图片、详情链接写回原条目，避免通用合并器再次丢失补抓结果。
- [x] Chrome 插件详情写回时会优先按原列表 `source_item_id` 精确匹配，避免详情 URL / 图片兜底误写到第一条已有 Prompt 的作品。
- [x] Chrome 插件详情补抓完成后会保留每个首页作品自己的 `source_item_id`，避免多个作品因详情 URL 相同被压缩成 1 条。
- [x] Chrome 插件当前卡片详情未真正打开时不会用整页内容冒充 Prompt，避免把作者列表、`使用创意` 等页面杂文本填入导入队列。
- [x] Chrome 插件送入队列遇到 Admin Studio 桥接脚本缺失时会自动补注入，并把 Chrome 连接错误转换成中文处理提示。
- [x] Chrome 插件可从封面图地址里的 `tweets/{长数字}` 推导 Meigen 详情页和 X 原帖链接，卡片点击打不开时也能继续走详情页补抓。
- [x] Chrome 插件详情页只暴露 `tweets/{id}/0.jpg` 但轮播显示多张时，会按编号补齐同组 `1.jpg`、`2.jpg` 等作品图。
- [x] Chrome 插件只在可信轮播计数存在时补齐 `tweets/{id}/{序号}.jpg`，避免单图作品因提示词中的 `1 / 3` 等文本被误扩成多图。
- [x] Chrome 插件以详情左上短节点 `1 / N` 作为多图权威数量；没有该计数时按单图处理，不再用结构化相关图数量猜测。
- [x] Chrome 插件详情补抓必须确认当前 URL 匹配目标 `/prompt/{id}` 且右侧 Prompt 面板已出现，才会把详情结果标记为成功，避免刷新后复用旧预览图 / 旧 Prompt。
- [x] Chrome 插件结构化缓存按当前页面 / 当前作品过滤，并且每次刷新都会清空旧缓存，避免上一批详情页的图片、收藏数和预览图串到新采集结果。
- [x] Chrome 插件诊断会输出每条前 4 个图片 URL 和收藏数，便于直接定位预览图、张数、收藏数来源。
- [x] Chrome 插件详情补抓拿到权威详情数据时，收藏数以详情页为准，不再用列表或旧缓存里的较大值覆盖。
- [x] Chrome 插件列表页结构化图片会按当前作品 `tweets/{statusId}` 过滤，避免一条作品混入其它作品图片。
- [x] Chrome 插件会把同一 `tweets/{statusId}/{序号}.jpg` 的缩略图和原图视为同一张，优先保留原图，避免 2 张被统计成 3 张。
- [x] Chrome 插件会过滤 Meigen UI 占位图、头像、`gallery-card-front/back`、`/prompt/...#image` 伪图片，避免导入队列预览显示成头像 / 卡片素材。
- [x] Chrome 插件会把过短 Prompt 和站点介绍文案视为待补，不再把列表开头句子当完整提示词直接上传。
- [x] Chrome 插件详情补抓只要读到完整 Prompt，就会先回填 Prompt；即使图片数量暂未补齐，也不会被后续静态兜底的短句覆盖。
- [x] Chrome 插件会从详情右侧栏顶部 `昵称 + @ID` 回填原作者昵称。
- [x] Import 上传保存时不再用抓到的 Prompt 截断生成 Title，Title 留给分析流程自动生成。
- [x] 支持三种任务模式：`仅抓取预览`、`边抓边上传`、`仅上传队列`。
- [x] 面板展示抓取进度、上传进度、总进度和导入结果摘要。
- [x] Import 分栏支持 `清空当前队列`，可清理旧的异常 / 待处理抓取暂存。
- [x] Import 分栏空队列会提示下一步操作，支持直接粘贴采集器诊断 / 下载结果生成预览，再点 `开始任务` 写入队列。
- [x] 批量重分析支持远程图片读取兜底：浏览器因 CORS 读不到图片时，自动通过管理员后台读取后再分析。
- [x] 编辑页 `重新分析元数据` 也复用远程图片读取兜底；只要当前作品有缩略图 / 图片资产，就会尝试恢复图片用于分析。
- [x] Meigen 导入不会再把英文提示词自动写入 `提示词（中文）`。
- [x] 支持一个提示词对应多张图片，按一条 Gallery Prompt 保存。
- [x] 原作品链接、原作者昵称、原作者 ID 为上传必填字段；缺任意一项会忽略上传并保留在队列里提示原因。
- [x] 成功上传后清空暂存条目的提示词和原图片来源，只保留最终 Prompt ID、最终图片资产和轻量状态。
- [x] 失败、疑似重复、缺少提示词、图片保存失败的条目会留在队列里，供管理员重试或清理。
- [x] `上传队列` 已升级为一键发布流程：完整条目会依次保存图片、分析图片、补全双语并设为已上线。
- [x] `上传队列`、Create `Analyze` 和 Manage `分析` 现在共用同一套完整图片分析结果：标题、描述、分类、对象、场景、风格、氛围、用途、商业属性、难度和主色全部落库；多图作品最多取 6 张合成分析。
- [x] Manage 的 `批量分析并补全双语` 已合并完整分析、六个双语字段补全和数据库回读确认；标题仍为 `Untitled Prompt`、属性或双语字段缺失时会明确显示失败阶段，不再误报成功。
- [x] Manage 保留 `仅补全双语` 作为旧作品修复入口，日常批量处理无需再分两次点击。
- [x] 完整分析会保留已有运营状态和导入来源信息，不再因为重分析直接覆盖 `ai_tags.admin`。
- [x] `上传队列` 不再允许用预设 `live` 绕过分析；新作品先保存为待复核，数据库确认完整分析、六个双语字段和 `已上线` 状态后才计为发布成功。
- [x] 分析、双语、发布每一阶段完成后都会重新读取数据库验证；标题仍为 `Untitled Prompt`、属性缺失或状态未上线时会保留为待处理，不再清理暂存或误报成功。
- [x] `刷新处理状态` 会扫描最近导入批次，通过保留的最终 Prompt ID 恢复此前误报成功的草稿；再次点击 `上传队列` 会从缺失阶段续跑，不会重复上传图片或创建新作品。
- [x] `上传队列` 会自动跳过缺提示词、缺图片、缺原作者昵称、缺作者 ID、缺 X 原帖链接或疑似重复的条目。
- [x] 一键发布只有整条完成后才自动清理抓取暂存；已保存但分析 / 双语 / 上线失败的条目会保留并标记失败原因。
- [x] Import 分栏的输入框、数字框、下拉菜单和复选框已改为自定义样式，不再使用浏览器默认控件外观。
- [x] 新增 `/api/admin/prompts/imports` 管理接口。
- [x] 新增 Supabase 暂存表 migration。
- [x] 修复导入暂存表的最终 Prompt ID 字段，兼容现有数字 Prompt ID。

## SQL 执行信息

新增 SQL 文件：

- `supabase/migrations/20260709_prompt_gallery_import_staging.sql`
- `supabase/migrations/20260709_prompt_gallery_import_prompt_ids_text.sql`

用户已确认 `20260709_prompt_gallery_import_staging.sql` 已执行。

本阶段新增 `20260709_prompt_gallery_import_prompt_ids_text.sql`，需要执行后再重试上传。

2026-07-09 本轮修复没有新增 SQL。

2026-07-09 本轮追加修复没有新增 SQL：仅更新 Chrome 采集器、弹窗和测试。

2026-07-09 16:30 后续修复没有新增 SQL：仅修复详情提示词合并、轮播计数图片上限和测试。

2026-07-09 16:56 后续修复没有新增 SQL：仅修复原作品链接和原作者昵称兜底。

2026-07-09 17:08 后续修复没有新增 SQL：仅修复列表页被误判为详情页导致最多作品未抓满的问题。

2026-07-09 17:15 后续修复没有新增 SQL：仅修复列表项详情弹窗交互补抓、复制 Prompt 控件识别和多图补抓。

2026-07-09 17:15 二次后续修复没有新增 SQL：仅更新 Chrome 采集器 `.11`、弹窗自动补抓条件和测试。

2026-07-09 17:49 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.12`，默认静默读取 Prompt，避免自动采集时触发 Meigen 的 `复制失败` 提示。

2026-07-09 17:58 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.13`，增加页面内复制桥接和 0.65 秒延迟点击，用于补抓只靠 `复制Prompt` 才能取得完整提示词的作品。

2026-07-09 18:11 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.14`，增加 Admin Studio 标签页桥接，解决扩展直连导入接口因 Strict Cookie 未携带导致的 `Unauthorized`。

2026-07-09 18:26 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.15`，增加页面数据层 / 网络缓存桥接，优先从 Meigen 页面内部数据补齐完整 Prompt 和多图。

2026-07-09 18:52 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.16`，增强详情页 `提示词` 可见正文提取，并优化弹窗对待补提示词的状态提示。

2026-07-09 19:00 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.17`，增强当前卡片模糊匹配、详情补抓失败记录和送入队列连接失败提示。

2026-07-09 19:08 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.18`，修复详情页左侧图片区和右侧提示词区分离时只抓到图片、漏掉 Prompt 的问题。

2026-07-09 19:50 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.19`，新增右侧详情栏专用 Prompt 提取和复制按钮定位，覆盖 `{ "subject": ... }` 这类 JSON 风格提示词。

2026-07-09 20:08 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.20`，增加弹窗版本显示和 `复制诊断` 日志，便于确认是否重载成功以及定位待补原因。

2026-07-09 20:16 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.21`，根据诊断日志修复详情补抓结果未按原列表 `source_item_id` 合并的问题。

2026-07-09 21:01 后续修复没有新增 SQL：仅更新 Chrome 插件弹窗初始化逻辑，打开弹窗即 ping 当前 Meigen 页面并显示采集器版本。

2026-07-09 21:08 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.22`，根据 `.21` 诊断继续修复详情补抓已读到 Prompt 但合并写回后仍待补的问题。

2026-07-09 21:15 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.23`，根据 `.22` 诊断修复详情写回优先级，先按原列表 `source_item_id` 精确匹配，再用 URL / 图片兜底。

2026-07-09 21:27 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.24`，根据 `.23` 诊断修复详情补抓成功后最终合并按同一详情 URL 压缩的问题，采集上限 3 条时应保留 3 个原列表作品。

2026-07-09 21:41 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.25`，根据 `.24` 诊断修复当前卡片详情未打开时把整页作者列表误当 Prompt 的问题，并增强送入队列的 Admin 桥接补注入和中文错误提示。

2026-07-09 21:53 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.26`，根据 `.25` 诊断修复无详情链接卡片点不开后只能待补的问题，改为从封面图 `tweets/{id}` 推导 `/prompt/{id}` 和 X 原帖链接，并优先用详情页补抓。

2026-07-09 21:59 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.27`，根据 `.26` 诊断修复详情页期望 4 张但只暴露第 0 张图片的问题，按 `tweets/{id}/{序号}.jpg` 补齐同组作品图。

2026-07-09 22:24 后续修复没有新增 SQL：更新 Chrome 采集器 `.28` 和导入保存逻辑，修复单图作品被误扩成多图、详情昵称未回填、导入时用 Prompt 预填 Title 的问题。

2026-07-09 22:46 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.29`，根据 `.28` 诊断和截图修复图片数量标准，详情左上 `1 / N` 为唯一多图权威；无该计数时按单图，避免相关内容 / 结构化候选把 1 张误判为 3 张、2 张误判为 4 张。

2026-07-09 23:03 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.30`，根据 `.29` 诊断修复最终合并仍沿用列表页猜测张数的问题；详情页确认单图时会把列表页 4 张裁成 1 张，详情左上 `1 / 4` 但页面只短暂加载 1-2 张时会按同组 `tweets/{id}/{序号}.jpg` 补齐到 4 张。

2026-07-09 23:28 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.31`，改为详情补抓优先打开当前页面真实卡片弹窗，读取真实左侧主图 / 缩略图区域；详情模式明确禁用列表页结构化缓存，避免单张拼图被缓存误判为 4 张，也避免 `1 / 4` 轮播因静态详情页未加载缩略图只抓到 1 张。

2026-07-09 23:50 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.32`，修复当前页卡片点击目标不准导致真实弹窗未打开的问题，优先按 `/prompt/{id}` 精确匹配卡片链接；补抓进度只按作品数显示，不再把详情页回退步骤显示成额外作品；当详情显示 `1 / 4` 但实际只读到 1 张且无法补齐时，不再把该结果标记为权威，避免覆盖其它候选图。

2026-07-10 09:16 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.33`，采集当前页 / 滚动采集 / 翻页采集前会自动关闭仍打开的详情弹窗，避免把详情页当成 1 个作品导致只显示“作品 1、图片 24”；详情回退步骤不再增加补抓进度总数，且不完整 `1 / 4` 详情结果会保留列表候选图，不再只剩 1 张。

2026-07-10 09:36 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.34`，列表采集不再把 `main`/整页 `item` 容器当成 1 个作品；同一张封面但不同 `/prompt/...` 详情链接的卡片会按卡片边界分别保留，并用各自详情链接精确匹配结构化提示词/作者/原作品链接；结构化详情链接只接受真实 URL，避免把作者用户名误拼成详情页。

2026-07-10 10:08 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.35`，详情补抓时只保留当前作品的最佳详情结果，避免详情页多个区域同时返回 3 条候选；合并时不允许后续 1 张图候选截短前面已补到的完整多图结果；详情作者昵称优先覆盖列表卡片作者；图片候选会校验 `/tweets/{statusId}/` 与当前 `/prompt/{id}` 是否一致，避免上一条详情残留图片串到下一条。

2026-07-10 10:34 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.36`，详情页采到的图片如果 URL 中带 `/tweets/{statusId}/`，必须与当前 `/prompt/{id}` 或原作品 status id 一致；不一致的残留图会被丢弃，避免后续作品预览显示成上一批 `LOOK UP` 图片，单图详情无可靠图片时会保留列表卡片真实预览图等待后续补抓。

2026-07-10 10:55 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.37`，详情补抓必须命中目标详情 URL 和右侧 Prompt 面板才算成功；结构化缓存按当前页面 / 当前作品过滤并清空旧值；诊断新增图片 URL 与收藏数字段；详情权威数据会覆盖旧列表收藏数。

2026-07-10 11:12 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.38`，列表页结构化图片按当前作品 `tweets/{statusId}` 过滤，并按 `statusId + 序号` 去重缩略图 / 原图，修复 1-2-2 被抓成 12-3-3 的图片数量膨胀问题。

2026-07-10 11:36 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.39`，过滤 UI 占位图 / 头像 / `#image` 伪图片；短 Prompt 和 Meigen 站点介绍文案继续视为待补；详情补抓读到完整 Prompt 时会先回填 Prompt，避免静态 fallback 的短句覆盖完整提示词。

2026-07-10 11:58 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.40`，对带 X status id 的作品禁用 `generations/.../community_...` 这类无法对应原推文的公共临时图，避免两个不同作品反复共用同一张 `LOOK UP` 图；详情补抓只有这种临时图时不再标为图片数量权威，也不会覆盖已有真实推文图。

2026-07-10 12:18 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.41`，详情页图片数量严格以左上角 `1 / N` 为准；没有 `1 / ?` 时按单图处理，并用这个详情数量截断列表页 / 结构化缓存推出来的图片，避免 1、3 张作品被猜成 4 张；详情图片过滤继续排除作者头像和“更多相关内容”之后的图片；`Free GPT Image...no prompt engineering` 这类站点推广文案不再当作提示词。

2026-07-10 12:54 后续修复没有新增 SQL：仅优化 Admin Import 队列操作，空队列会明确提示先 `送入队列` 或 `粘贴结果 / 导入抓取结果`；新增 `粘贴结果`，可把采集器复制的诊断 JSON 直接读成预览，再点 `开始任务` 写入队列。

2026-07-10 13:16 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.42`，把详情页外层已识别到的左上 `1 / N` 数量显式传给采集器，避免详情内部又按单图降级；并从详情右侧栏 `复制Prompt` 前的数字读取收藏数，避免列表大容器把同一个收藏数串给多条作品。

2026-07-10 13:42 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.43`，把收藏数为 0 / 缺失的作品纳入自动详情补抓；有收藏筛选条件时先不在列表阶段把未知 0 过滤掉，等详情补齐收藏数后再筛选。

2026-07-10 14:06 后续修复没有新增 SQL：仅更新 Chrome 采集器 `.44`，送入队列前只在图片数量未满足详情权威数量时才再次补抓，单图作品不再重复补抓；同时把 `WebPage` 视为无效作者名，让详情右侧栏的真实昵称覆盖它。

2026-07-10 14:29 后续修复没有新增 SQL：仅更新 Admin Import 上传队列、导入接口和样式；`上传队列` 会自动完成保存、分析、补双语、上线和成功后清理，缺提示词 / 缺图片条目自动跳过。

2026-07-10 来源必填规则调整没有新增 SQL：仅收紧 Admin Import 上传前检查和导入接口，原作者昵称、作者 ID、X 原帖链接缺失或提示词重复时忽略上传。

2026-07-10 20:33 后续修复没有新增 SQL：统一 Create / Manage / Import 完整分析，增加数据库阶段校验、历史误报草稿恢复、完整双语校验和真实上线确认。

2026-07-10 21:42 后续修复没有新增 SQL：Manage 批量分析集成完整双语补全，增加分析 / 双语 / 保存确认分阶段进度和严格结果校验。

已执行后需要确认以下表存在：

- `public.prompt_import_batches`
- `public.prompt_import_items`

新增修复 SQL 执行后需要确认：

- `public.prompt_import_items.final_prompt_id` 为 `TEXT`
- `public.prompt_import_items.duplicate_of_prompt_id` 为 `TEXT`

## 已验证

- `node --check server/api-handlers/admin/prompts/imports.js`
- `node --check admin-studio.js`
- `node --check integrations/meigen-gallery-collector/content.js`
- `node --check integrations/meigen-gallery-collector/popup.js`
- `node --check integrations/meigen-gallery-collector/meigen-gallery-collector.user.js`
- `node --test tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js tests/admin-gallery-import-assistant-contract.test.js`，当前 60 个相关测试通过。
- `node --check integrations/meigen-gallery-collector/background.js`
- `node --check integrations/meigen-gallery-collector/content-prelude.js`
- `node --check integrations/meigen-gallery-collector/content.js`
- `node --check integrations/meigen-gallery-collector/popup.js`
- `node --check integrations/meigen-gallery-collector/meigen-gallery-collector.user.js`
- `node --test tests/admin-gallery-import-assistant-contract.test.js`
- `node --test tests/admin-handler-permissions.test.js`
- `node --test tests/admin-prompts-manage-handler.test.js`
- `node --test tests/admin-gallery-bilingual-fields.test.js`
- `node --test tests/prompts-source-attribution-contract.test.js`
- `node --test tests/admin-gallery-p2-ops-map-contract.test.js`
- `node --test tests/admin-gallery-p1-linkage-contract.test.js`
- `node --test tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js tests/admin-gallery-import-assistant-contract.test.js tests/admin-handler-permissions.test.js tests/admin-prompts-manage-handler.test.js tests/admin-gallery-bilingual-fields.test.js tests/prompts-source-attribution-contract.test.js tests/admin-gallery-p2-ops-map-contract.test.js tests/admin-gallery-p1-linkage-contract.test.js`，当前 85 个相关测试通过。
- `node --test tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js`，当前 46 个 Meigen 采集器测试通过。
- `node --test tests/admin-gallery-import-assistant-contract.test.js`，当前 3 个导入助手契约测试通过。
- `git diff --check`
- `node --test tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js tests/admin-gallery-import-assistant-contract.test.js tests/admin-handler-permissions.test.js tests/admin-prompts-manage-handler.test.js tests/admin-gallery-bilingual-fields.test.js tests/prompts-source-attribution-contract.test.js tests/admin-gallery-p2-ops-map-contract.test.js tests/admin-gallery-p1-linkage-contract.test.js`，当前 91 个相关测试通过。
- `node --test tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js`，当前 28 个 Meigen 采集器测试通过。
- `node --test tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js tests/admin-gallery-import-assistant-contract.test.js tests/admin-handler-permissions.test.js tests/admin-prompts-manage-handler.test.js tests/admin-gallery-bilingual-fields.test.js tests/prompts-source-attribution-contract.test.js tests/admin-gallery-p2-ops-map-contract.test.js tests/admin-gallery-p1-linkage-contract.test.js`，当前 101 个相关测试通过。
- 本地预览已确认 Chrome 插件弹窗包含 `滚动采集`、`翻页采集`、`停止翻页`、`送入队列`。
- 本地预览已确认 Chrome 插件弹窗包含 `最多作品`。
- 本地预览已确认 Admin Import 分栏包含 `清空当前队列`。
- 本地预览已确认内容脚本包含翻页批次采集标记与执行逻辑。
- `node --test tests/admin-gallery-*.test.js tests/admin-prompts-manage-handler.test.js tests/admin-ai-budget-contract.test.js tests/admin-handler-permissions.test.js tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js tests/prompts-source-attribution-contract.test.js`，当前 152 个相关测试通过。
- `node --test tests/admin-gallery-*.test.js tests/admin-prompts-manage-handler.test.js tests/admin-ai-budget-contract.test.js tests/admin-handler-permissions.test.js tests/meigen-gallery-collector-contract.test.js tests/meigen-gallery-collector-extension-contract.test.js tests/prompts-source-attribution-contract.test.js`，当前 153 个相关测试通过。
- `npm run smoke:admin-local -- --module gallery --smoke-dom full`，Gallery 本地冒烟测试通过。

## 下一步阶段

- [ ] P0：给 `prompts` 增加服务端规范化指纹和数据库唯一性 / 幂等约束，消除两个管理员并发导入时“先查后写”的竞态窗口。
- [ ] P0：图片代理增加 DNS 解析后的私网地址复核及域名 allowlist，覆盖 DNS rebinding 和非常规 IP 表示法。
- [ ] P1：把保存图片、创建 Prompt、更新暂存状态收敛为可恢复的服务端任务状态机，避免浏览器关闭后半完成。
- [ ] P1：增加过期批次定时清理、R2 孤儿对象回收和单条失败重试 / 放弃操作。
- [ ] P1：减少 MAIN world 对 `fetch`、XHR、clipboard 的 monkey patch，增加站点 DOM / 数据协议版本探测和失效告警。
- [ ] P2：增加队列批次选择、来源 / 状态筛选、单条编辑以及失败原因结构化统计。
- [ ] 为采集器增加批次任务历史和失败页面列表导出。
- [ ] 为导入队列增加按批次选择、筛选和单条编辑后上传。
- [ ] 增加生产环境清理任务，定期清理超期失败暂存数据。
